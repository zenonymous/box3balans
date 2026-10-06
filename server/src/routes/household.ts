import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { accounts, persons } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const body = z.object({
  name: z.string().trim().min(1).max(100),
  role: z.enum(["self", "partner", "child"]),
  birthDate: isoDate.nullish(),
  custody: z.enum(["together", "self", "self_half", "partner"]).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

/** The household for box 3: you, a partner and children. */
export async function householdRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get("/", async () => db.select().from(persons).orderBy(asc(persons.id)));

  app.post("/", async (req) => {
    const data = body.parse(req.body);
    if (data.role !== "child") {
      const [exists] = await db.select({ id: persons.id }).from(persons).where(eq(persons.role, data.role));
      if (exists)
        throw new HttpError(
          409,
          data.role === "self" ? "You're already in the household" : "There's already a partner",
        );
    }
    const [row] = await db
      .insert(persons)
      .values({ ...data, birthDate: data.role === "child" ? (data.birthDate ?? null) : null })
      .returning();
    await audit(db, "person", row!.id, "create", null, row);
    return row;
  });

  app.put("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const data = body.omit({ role: true }).partial().parse(req.body);
    const [before] = await db.select().from(persons).where(eq(persons.id, id));
    if (!before) throw notFound("Person");
    const [row] = await db.update(persons).set(data).where(eq(persons.id, id)).returning();
    await audit(db, "person", id, "update", before, row);
    return row;
  });

  app.delete("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select().from(persons).where(eq(persons.id, id));
    if (!before) throw notFound("Person");
    await db.transaction(async (trx) => {
      // Accounts of a removed child or partner become yours, rather than counting for nobody.
      if (before.role === "child")
        await trx
          .update(accounts)
          .set({ owner: "self", ownerChildId: null })
          .where(and(eq(accounts.owner, "child"), eq(accounts.ownerChildId, id)));
      if (before.role === "partner")
        await trx.update(accounts).set({ owner: "self" }).where(eq(accounts.owner, "partner"));
      await trx.delete(persons).where(eq(persons.id, id));
    });
    await audit(db, "person", id, "delete", before, null);
    return { ok: true };
  });
}
