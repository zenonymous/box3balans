import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { accounts, integrations } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { PROVIDERS } from "../sync/service.js";
import { purgeSynced } from "../sync/purge.js";
import { ProviderError } from "../sync/types.js";

const PROVIDER_IDS = ["bitvavo", "kraken", "coinbase", "ibkr"] as const;

const createBody = z.object({
  provider: z.enum(PROVIDER_IDS),
  // Either connect an existing account or create one named after the provider.
  accountId: z.number().int().positive().optional(),
  accountName: z.string().trim().min(1).max(100).optional(),
  credentials: z.record(z.string(), z.string()),
});

const updateBody = z.object({
  enabled: z.boolean().optional(),
  credentials: z.record(z.string(), z.string()).optional(),
});

// Never expose credentials or the sync cursor.
const publicFields = {
  id: integrations.id,
  accountId: integrations.accountId,
  accountName: accounts.name,
  provider: integrations.provider,
  keyHint: integrations.keyHint,
  enabled: integrations.enabled,
  lastSyncAt: integrations.lastSyncAt,
  lastStatus: integrations.lastStatus,
  lastResult: integrations.lastResult,
  createdAt: integrations.createdAt,
};

export async function integrationRoutes(app: FastifyInstance) {
  const { db, sync, secrets, config } = app.deps;

  /** Validates credentials with a live, read-only call; maps failures to 400s without echoing secrets. */
  const verify = async (provider: string, raw: unknown) => {
    try {
      return await sync.testCredentials(provider, raw);
    } catch (err) {
      if (err instanceof ZodError) throw err;
      const msg = err instanceof ProviderError ? err.message : `Could not reach ${provider}: ${(err as Error).message}`;
      throw new HttpError(400, msg);
    }
  };

  app.get("/providers", async () =>
    Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      accountKind: p.accountKind,
      fields: p.fields,
      instructions: p.instructions,
    })),
  );

  app.get("/", async () => {
    const rows = await db
      .select(publicFields)
      .from(integrations)
      .innerJoin(accounts, eq(accounts.id, integrations.accountId))
      .orderBy(asc(accounts.name));
    return rows.map((r) => ({ ...r, running: sync.isRunning(r.id), intervalHours: config.SYNC_INTERVAL_HOURS }));
  });

  app.post("/", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const body = createBody.parse(req.body);
    const { provider, creds } = await verify(body.provider, body.credentials);

    let accountId = body.accountId;
    if (accountId) {
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId));
      if (!acc) throw new HttpError(400, "Unknown account");
      const [taken] = await db
        .select({ id: integrations.id })
        .from(integrations)
        .where(eq(integrations.accountId, accountId));
      if (taken) throw new HttpError(409, "This account already has a connection");
    } else {
      const [acc] = await db
        .insert(accounts)
        .values({ name: body.accountName ?? provider.label, kind: provider.accountKind, provider: provider.id })
        .returning();
      await audit(db, "account", acc!.id, "create", null, acc);
      accountId = acc!.id;
    }

    const [row] = await db
      .insert(integrations)
      .values({ accountId, provider: provider.id, credentials: secrets.seal(creds), keyHint: provider.hint(creds) })
      .returning({ id: integrations.id });
    await audit(db, "integration", row!.id, "create", null, { accountId, provider: provider.id });
    // First import runs in the background.
    sync.start(row!.id);
    return { id: row!.id, accountId, started: true };
  });

  app.put("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
    if (!row) throw notFound("Connection");
    const patch: Partial<typeof integrations.$inferInsert> = {};
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.credentials) {
      const { provider, creds } = await verify(row.provider, body.credentials);
      patch.credentials = secrets.seal(creds);
      patch.keyHint = provider.hint(creds);
    }
    await db.update(integrations).set(patch).where(eq(integrations.id, id));
    await audit(
      db,
      "integration",
      id,
      "update",
      { enabled: row.enabled, keyHint: row.keyHint },
      { enabled: patch.enabled, keyHint: patch.keyHint },
    );
    return { ok: true };
  });

  // Starts a sync in the background (large histories take minutes); the UI polls GET /.
  app.post("/:id/sync", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.select({ id: integrations.id }).from(integrations).where(eq(integrations.id, id));
    if (!row) throw notFound("Connection");
    if (!sync.start(id)) throw new HttpError(409, "A sync is already running");
    return reply.code(202).send({ started: true });
  });

  // Removes the connection; optionally also the transactions it imported.
  app.delete("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const { deleteTransactions } = z
      .object({ deleteTransactions: z.enum(["true", "false"]).default("false") })
      .parse(req.query);
    const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
    if (!row) throw notFound("Connection");
    if (sync.isRunning(id)) throw new HttpError(409, "Wait for the running sync to finish");
    let removed = 0;
    if (deleteTransactions === "true") removed = await purgeSynced(db, row.accountId, "api");
    await db.delete(integrations).where(eq(integrations.id, id));
    await audit(
      db,
      "integration",
      id,
      "delete",
      { accountId: row.accountId, provider: row.provider, removedTransactions: removed },
      null,
    );
    return { ok: true, removedTransactions: removed };
  });
}
