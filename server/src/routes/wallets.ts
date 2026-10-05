import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { accounts, walletAddresses } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { purgeSynced } from "../sync/purge.js";
import { SCRIPT_TYPES } from "../wallets/registry.js";
import { ChainError } from "../wallets/types.js";

const createBody = z.object({
  chain: z.string(),
  address: z.string().trim().min(1).max(200),
  label: z.string().trim().max(100).nullish(),
  scriptType: z.enum(SCRIPT_TYPES as [string, ...string[]]).nullish(),
  includeUnlisted: z.boolean().optional(),
  accountId: z.number().int().positive().optional(),
  accountName: z.string().trim().min(1).max(100).optional(),
  // Skip the immediate first sync (e.g. when adding the same address on several chains at once).
  sync: z.boolean().default(true),
});

const updateBody = z.object({
  label: z.string().trim().max(100).nullish(),
  enabled: z.boolean().optional(),
  includeUnlisted: z.boolean().optional(),
  scriptType: z.enum(SCRIPT_TYPES as [string, ...string[]]).nullish(),
});

export async function walletRoutes(app: FastifyInstance) {
  const { db, wallets } = app.deps;

  app.get("/chains", async () =>
    Object.values(wallets.chains).map((c) => ({
      id: c.id,
      label: c.label,
      nativeSymbol: c.nativeSymbol,
      addressHint: c.addressHint,
      supportsXpub: c.supportsXpub,
      scriptTypes: c.supportsXpub ? SCRIPT_TYPES : [],
    })),
  );

  app.get("/", async () => {
    const rows = await db
      .select({ w: walletAddresses, accountName: accounts.name })
      .from(walletAddresses)
      .innerJoin(accounts, eq(accounts.id, walletAddresses.accountId))
      .orderBy(asc(accounts.name), asc(walletAddresses.chain), asc(walletAddresses.id));
    // The sync cursor is internal state; don't send it to the browser.
    return rows.map(({ w, accountName }) => ({
      ...w,
      cursor: undefined,
      accountName,
      running: wallets.isRunning(w.accountId, w.chain),
    }));
  });

  app.post("/", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = createBody.parse(req.body);
    const chain = wallets.chains[body.chain];
    if (!chain) throw new HttpError(400, `Unsupported chain ${body.chain}`);
    let address: string;
    try {
      address = chain.normalise(body.address);
    } catch (err) {
      throw new HttpError(400, err instanceof ChainError ? err.message : "Invalid address");
    }
    if (body.scriptType && !chain.supportsXpub)
      throw new HttpError(400, "Script types only apply to Bitcoin-like chains");

    let accountId = body.accountId;
    if (accountId) {
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId));
      if (!acc) throw new HttpError(400, "Unknown account");
    } else {
      const [acc] = await db
        .insert(accounts)
        .values({ name: body.accountName ?? `${chain.label} wallet`, kind: "wallet" })
        .returning();
      await audit(db, "account", acc!.id, "create", null, acc);
      accountId = acc!.id;
    }
    const [dupe] = await db
      .select({ id: walletAddresses.id })
      .from(walletAddresses)
      .where(
        and(
          eq(walletAddresses.accountId, accountId),
          eq(walletAddresses.chain, chain.id),
          eq(walletAddresses.address, address),
        ),
      );
    if (dupe) throw new HttpError(409, "This address is already tracked in that account");

    const [row] = await db
      .insert(walletAddresses)
      .values({
        accountId,
        chain: chain.id,
        address,
        label: body.label ?? null,
        scriptType: body.scriptType ?? null,
        includeUnlisted: body.includeUnlisted ?? false,
      })
      .returning();
    await audit(db, "wallet_address", row!.id, "create", null, { accountId, chain: chain.id, address });
    // The first import runs in the background; the UI polls GET / for `running` and `lastResult`.
    const started = body.sync ? wallets.start(accountId, chain.id) : false;
    // `address` as stored, e.g. a Cardano receive address becomes its stake address.
    return { id: row!.id, accountId, address, started };
  });

  app.put("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const [before] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, id));
    if (!before) throw notFound("Address");
    const [row] = await db.update(walletAddresses).set(body).where(eq(walletAddresses.id, id)).returning();
    await audit(db, "wallet_address", id, "update", { ...before, cursor: undefined }, { ...row, cursor: undefined });
    return { ok: true };
  });

  app.post("/sync", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { accountId, chain } = z
      .object({ accountId: z.number().int().positive(), chain: z.string() })
      .parse(req.body);
    if (!wallets.chains[chain]) throw new HttpError(400, `Unsupported chain ${chain}`);
    if (!wallets.start(accountId, chain)) throw new HttpError(409, "A sync is already running");
    return reply.code(202).send({ started: true });
  });

  // Stops tracking an address. Remaining addresses of the wallet re-import on their next sync; with
  // deleteTransactions and no addresses left on that chain, its imported history is removed too.
  app.delete("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const { deleteTransactions } = z
      .object({ deleteTransactions: z.enum(["true", "false"]).default("false") })
      .parse(req.query);
    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, id));
    if (!row) throw notFound("Address");
    if (wallets.isRunning(row.accountId, row.chain)) throw new HttpError(409, "Wait for the running sync to finish");
    await db.delete(walletAddresses).where(eq(walletAddresses.id, id));
    const remaining = await db
      .select({ id: walletAddresses.id })
      .from(walletAddresses)
      .where(and(eq(walletAddresses.accountId, row.accountId), eq(walletAddresses.chain, row.chain)));
    let removed = 0;
    if (remaining.length === 0 && deleteTransactions === "true")
      removed = await purgeSynced(db, row.accountId, "chain", `${row.chain}:`);
    await audit(
      db,
      "wallet_address",
      id,
      "delete",
      { accountId: row.accountId, chain: row.chain, address: row.address, removedTransactions: removed },
      null,
    );
    return { ok: true, removedTransactions: removed, resyncNeeded: remaining.length > 0 };
  });
}
