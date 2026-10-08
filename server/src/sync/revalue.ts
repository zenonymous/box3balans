import { and, eq, inArray, ne } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, auditLog, transactions } from "../db/schema.js";
import { str } from "../lib/decimal.js";
import type { HistoryService } from "../prices/history.js";

// The UTC day, as the importer valued it.
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Rewards and deposits a sync booked at €0, because no price was known for that day, get their value
 * once one is (a price source found later, history loaded since). Rows you edited yourself (the
 * audit log has an update for them) are left alone: a €0 you kept is a choice.
 */
export async function revalueUnpriced(db: DB, history: HistoryService, accountId: number): Promise<number> {
  const rows = await db
    .select({ id: transactions.id, assetId: transactions.assetId, occurredAt: transactions.occurredAt })
    .from(transactions)
    .innerJoin(assets, eq(assets.id, transactions.assetId))
    .where(
      and(
        eq(transactions.accountId, accountId),
        inArray(transactions.type, ["deposit", "reward"]),
        eq(transactions.price, "0"),
        inArray(transactions.source, ["api", "chain"]),
        ne(assets.assetClass, "cash"),
      ),
    );
  if (rows.length === 0) return 0;
  const edited = new Set(
    (
      await db
        .select({ id: auditLog.entityId })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entity, "transaction"),
            eq(auditLog.action, "update"),
            inArray(
              auditLog.entityId,
              rows.map((r) => r.id),
            ),
          ),
        )
    ).map((r) => r.id),
  );
  const todo = rows.filter((r) => !edited.has(r.id));

  // Load each asset's history over the days needed, once.
  const byAsset = new Map<number, { from: string; to: string }>();
  for (const r of todo) {
    const d = day(r.occurredAt);
    const span = byAsset.get(r.assetId);
    if (!span) byAsset.set(r.assetId, { from: d, to: d });
    else {
      if (d < span.from) span.from = d;
      if (d > span.to) span.to = d;
    }
  }
  const assetRows = await db
    .select()
    .from(assets)
    .where(inArray(assets.id, [...byAsset.keys()]));
  for (const a of assetRows) {
    const span = byAsset.get(a.id)!;
    try {
      await history.ensureRange(a, span.from, span.to);
    } catch {
      // still no price: stays at €0 for now
    }
  }

  let revalued = 0;
  for (const r of todo) {
    const eur = await history.eurOn(r.assetId, day(r.occurredAt));
    if (!eur || eur.lte(0)) continue;
    await db
      .update(transactions)
      .set({ price: str(eur), currency: "EUR", fxRate: "1", updatedAt: new Date() })
      .where(eq(transactions.id, r.id));
    revalued++;
  }
  return revalued;
}
