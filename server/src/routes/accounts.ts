import type { FastifyInstance } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, metalItems, transactions } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";

const body = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["broker", "exchange", "vault", "wallet", "bank", "physical", "other"]),
  provider: z.string().trim().max(50).nullish(),
  notes: z.string().max(2000).nullish(),
  archived: z.boolean().optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function accountRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get("/", async () => {
    const rows = await db
      .select({
        account: accounts,
        // Qualified explicitly: interpolated columns render unqualified and would bind to the subquery table.
        txCount: sql<number>`(select count(*)::int from transactions t where t.account_id = "accounts"."id")`,
        itemCount: sql<number>`(select count(*)::int from metal_items m where m.account_id = "accounts"."id")`,
      })
      .from(accounts)
      .orderBy(asc(accounts.name));
    return rows.map((r) => ({ ...r.account, txCount: r.txCount, itemCount: r.itemCount }));
  });

  app.post("/", async (req) => {
    const data = body.parse(req.body);
    const [row] = await db.insert(accounts).values(data).returning();
    await audit(db, "account", row!.id, "create", null, row);
    return row;
  });

  app.put("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const data = body.partial().parse(req.body);
    const [before] = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!before) throw notFound("Account");
    const [row] = await db.update(accounts).set(data).where(eq(accounts.id, id)).returning();
    await audit(db, "account", id, "update", before, row);
    return row;
  });

  app.delete("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!before) throw notFound("Account");
    const [used] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.accountId, id))
      .limit(1);
    const [usedItem] = await db
      .select({ id: metalItems.id })
      .from(metalItems)
      .where(eq(metalItems.accountId, id))
      .limit(1);
    if (used || usedItem) throw new HttpError(409, "Account has transactions or items; archive it instead");
    await db.delete(accounts).where(eq(accounts.id, id));
    await audit(db, "account", id, "delete", before, null);
    return { ok: true };
  });
}
