import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.js";
import { accounts, assets, syncIgnored, transactions } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { D, str } from "../lib/decimal.js";
import { HttpError, notFound } from "../lib/errors.js";
import { currencyCode, decimalString, idParam, isoDay } from "../lib/validation.js";
import type { FxService } from "../prices/fx.js";
import { AssetResolver } from "../sync/assets.js";
import { HistoryService } from "../prices/history.js";
import { localDay } from "../lib/time.js";
import { tr } from "../i18n/index.js";

const TX_TYPES = [
  "buy",
  "sell",
  "deposit",
  "withdrawal",
  "transfer_in",
  "transfer_out",
  "dividend",
  "reward",
  "fee",
  "split",
] as const;

const txBody = z
  .object({
    accountId: z.number().int().positive(),
    assetId: z.number().int().positive(),
    type: z.enum(TX_TYPES),
    occurredAt: z.coerce.date(),
    quantity: decimalString.default("0"),
    price: decimalString.default("0"),
    currency: currencyCode.default("EUR"),
    // EUR per unit of currency; looked up from ECB rates when omitted.
    fxRate: decimalString.optional(),
    feeEur: decimalString.default("0"),
    amount: decimalString.default("0"),
    taxWithheld: decimalString.default("0"),
    notes: z.string().max(2000).nullish(),
    // Book the cash side (buy/sell/dividend) against this account's cash balance in `currency`.
    settleCash: z.boolean().optional(),
  })
  .superRefine((t, ctx) => {
    const needsQty = !["dividend"].includes(t.type);
    if (needsQty && D(t.quantity).lte(0)) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: t.type === "split" ? tr("Split ratio must be > 0") : tr("Quantity must be > 0"),
      });
    }
    if (t.type === "dividend" && D(t.amount).lte(0)) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: tr("Dividend amount must be > 0") });
    }
    if (t.occurredAt.getTime() > Date.now() + 86_400_000) {
      ctx.addIssue({ code: "custom", path: ["occurredAt"], message: tr("Date is in the future") });
    }
  });

const transferBody = z.object({
  fromAccountId: z.number().int().positive(),
  toAccountId: z.number().int().positive(),
  assetId: z.number().int().positive(),
  occurredAt: z.coerce.date(),
  quantity: decimalString.refine((v) => D(v).gt(0), { error: () => tr("Quantity must be > 0") }),
  // Quantity received may be lower than sent (network fee paid in the asset).
  receivedQuantity: decimalString.optional(),
  feeEur: decimalString.default("0"),
  notes: z.string().max(2000).nullish(),
});

const listQuery = z.object({
  accountId: z.coerce.number().int().optional(),
  assetId: z.coerce.number().int().optional(),
  type: z.enum(TX_TYPES).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

async function resolveFx(fx: FxService, currency: string, at: Date, given?: string): Promise<string> {
  if (given) return given;
  if (currency === "EUR") return "1";
  try {
    return str(await fx.eurPerUnit(currency, at.toISOString().slice(0, 10)));
  } catch (err) {
    throw new HttpError(
      400,
      tr("No FX rate for {currency}; enter it manually ({error})", {
        currency,
        error: (err as Error).message,
      }),
    );
  }
}

const SETTLES = new Set(["buy", "sell", "dividend"]);

/** Cash asset for `currency` (created if needed) when the transaction should settle in cash. */
async function settleAsset(
  db: DB,
  type: string,
  currency: string,
  settle: boolean | undefined,
): Promise<number | null> {
  if (!settle || !SETTLES.has(type)) return null;
  return (await new AssetResolver(db).resolve({ kind: "fiat", currency })).id;
}

async function assertRefs(db: DB, accountId: number, assetId: number) {
  const [acc] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
  if (!acc) throw new HttpError(400, tr("Unknown account"));
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId));
  if (!asset) throw new HttpError(400, tr("Unknown asset"));
}

export async function transactionRoutes(app: FastifyInstance) {
  const { db, prices } = app.deps;

  app.get("/", async (req) => {
    const q = listQuery.parse(req.query);
    const conds: SQL[] = [];
    if (q.accountId) conds.push(eq(transactions.accountId, q.accountId));
    if (q.assetId) conds.push(eq(transactions.assetId, q.assetId));
    if (q.type) conds.push(eq(transactions.type, q.type));
    if (q.from) conds.push(gte(transactions.occurredAt, new Date(`${q.from}T00:00:00Z`)));
    if (q.to) conds.push(lte(transactions.occurredAt, new Date(`${q.to}T23:59:59.999Z`)));
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
      conds.push(
        or(
          ilike(assets.name, like),
          ilike(assets.symbol, like),
          ilike(accounts.name, like),
          ilike(transactions.notes, like),
        )!,
      );
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select({
        tx: transactions,
        assetName: assets.name,
        assetSymbol: assets.symbol,
        assetClass: assets.assetClass,
        accountName: accounts.name,
      })
      .from(transactions)
      .innerJoin(assets, eq(assets.id, transactions.assetId))
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(where)
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(q.limit)
      .offset(q.offset);
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .innerJoin(assets, eq(assets.id, transactions.assetId))
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(where);
    return {
      total: count?.n ?? 0,
      items: rows.map((r) => ({
        ...r.tx,
        assetName: r.assetName,
        assetSymbol: r.assetSymbol,
        assetClass: r.assetClass,
        accountName: r.accountName,
      })),
    };
  });

  app.post("/", async (req) => {
    const { settleCash, ...data } = txBody.parse(req.body);
    if (data.type === "transfer_in" || data.type === "transfer_out") {
      throw new HttpError(400, tr("Use /api/transactions/transfer to record transfers"));
    }
    await assertRefs(db, data.accountId, data.assetId);
    const fxRate = await resolveFx(prices.fx, data.currency, data.occurredAt, data.fxRate);
    const settleAssetId = await settleAsset(db, data.type, data.currency, settleCash);
    const [row] = await db
      .insert(transactions)
      .values({ ...data, fxRate, settleAssetId, source: "manual" })
      .returning();
    await audit(db, "transaction", row!.id, "create", null, row);
    return row;
  });

  app.post("/transfer", async (req) => {
    const t = transferBody.parse(req.body);
    if (t.fromAccountId === t.toAccountId) throw new HttpError(400, tr("Choose two different accounts"));
    await assertRefs(db, t.fromAccountId, t.assetId);
    await assertRefs(db, t.toAccountId, t.assetId);
    const group = randomUUID();
    const common = {
      assetId: t.assetId,
      occurredAt: t.occurredAt,
      transferGroup: group,
      notes: t.notes,
      source: "manual" as const,
    };
    const rows = await db.transaction(async (trx) => {
      const out = await trx
        .insert(transactions)
        .values({ ...common, accountId: t.fromAccountId, type: "transfer_out", quantity: t.quantity, feeEur: t.feeEur })
        .returning();
      const inn = await trx
        .insert(transactions)
        .values({
          ...common,
          accountId: t.toAccountId,
          type: "transfer_in",
          quantity: t.receivedQuantity ?? t.quantity,
        })
        .returning();
      return [out[0]!, inn[0]!];
    });
    for (const r of rows) await audit(db, "transaction", r.id, "create", null, r);
    return rows;
  });

  app.put("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!before) throw notFound(tr("Transaction"));
    if (before.transferGroup) {
      // Keep transfer legs consistent: only date, quantity, fee and notes are editable per leg.
      const patch = z
        .object({
          occurredAt: z.coerce.date().optional(),
          quantity: decimalString.refine((v) => D(v).gt(0), { error: () => tr("Quantity must be > 0") }).optional(),
          feeEur: decimalString.optional(),
          notes: z.string().max(2000).nullish(),
        })
        .parse(req.body);
      const [row] = await db.transaction(async (trx) => {
        if (patch.occurredAt) {
          await trx
            .update(transactions)
            .set({ occurredAt: patch.occurredAt, updatedAt: new Date() })
            .where(eq(transactions.transferGroup, before.transferGroup!));
        }
        return trx
          .update(transactions)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(transactions.id, id))
          .returning();
      });
      await audit(db, "transaction", id, "update", before, row);
      return row;
    }
    const { settleCash, ...data } = txBody.parse({
      ...before,
      ...(req.body as object),
      occurredAt: (req.body as { occurredAt?: unknown })?.occurredAt ?? before.occurredAt,
    });
    if (data.type === "transfer_in" || data.type === "transfer_out") {
      throw new HttpError(400, tr("Use /api/transactions/transfer to record transfers"));
    }
    await assertRefs(db, data.accountId, data.assetId);
    // Re-resolve the FX rate if currency or date changed and no explicit rate was given.
    const changed = data.currency !== before.currency || data.occurredAt.getTime() !== before.occurredAt.getTime();
    // An explicit rate in the body is used as validated (e.g. "0,91" → "0.91").
    const explicit = (req.body as { fxRate?: unknown })?.fxRate !== undefined ? data.fxRate : undefined;
    const fxRate = explicit ?? (changed ? await resolveFx(prices.fx, data.currency, data.occurredAt) : before.fxRate);
    // Keep settling in cash unless told otherwise; follow currency changes.
    const settleAssetId = await settleAsset(db, data.type, data.currency, settleCash ?? before.settleAssetId != null);
    const [row] = await db
      .update(transactions)
      .set({ ...data, fxRate: String(fxRate), settleAssetId, updatedAt: new Date() })
      .where(eq(transactions.id, id))
      .returning();
    await audit(db, "transaction", id, "update", before, row);
    return row;
  });

  // Undoes a transfer (typically a wrong auto-match): both legs become a plain withdrawal and
  // deposit again and are never auto-matched again.
  app.post("/:id/unlink", async (req) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!row) throw notFound(tr("Transaction"));
    if (!row.transferGroup) throw new HttpError(400, tr("This transaction is not part of a transfer"));
    const legs = await db.select().from(transactions).where(eq(transactions.transferGroup, row.transferGroup));
    const history = new HistoryService(db, prices.fx);
    await db.transaction(async (trx) => {
      for (const leg of legs) {
        const patch: Partial<typeof transactions.$inferInsert> = {
          type: leg.type === "transfer_in" ? "deposit" : "withdrawal",
          transferGroup: null,
          noAutoMatch: true,
          updatedAt: new Date(),
        };
        // A deposit needs a cost basis; manual transfer legs have none, so use that day's price.
        if (leg.type === "transfer_in" && D(leg.price).isZero()) {
          const unit = await history.eurOn(leg.assetId, localDay(leg.occurredAt));
          if (unit) Object.assign(patch, { price: str(unit), currency: "EUR", fxRate: "1" });
        }
        await trx.update(transactions).set(patch).where(eq(transactions.id, leg.id));
      }
    });
    for (const leg of legs) await audit(db, "transaction", leg.id, "update", leg, { unlinked: true });
    return { ok: true, unlinked: legs.length };
  });

  app.delete("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!before) throw notFound(tr("Transaction"));
    // Deleting one leg of a transfer deletes both.
    const victims = before.transferGroup
      ? await db.select().from(transactions).where(eq(transactions.transferGroup, before.transferGroup))
      : [before];
    await db.transaction(async (trx) => {
      for (const v of victims) {
        await trx.delete(transactions).where(eq(transactions.id, v.id));
        // Remember deleted synced rows so the next sync doesn't bring them back.
        if (v.source !== "manual" && v.externalId) {
          await trx
            .insert(syncIgnored)
            .values({ accountId: v.accountId, source: v.source, externalId: v.externalId })
            .onConflictDoNothing();
        }
      }
    });
    for (const v of victims) await audit(db, "transaction", v.id, "delete", v, null);
    return { ok: true, deleted: victims.length };
  });
}
