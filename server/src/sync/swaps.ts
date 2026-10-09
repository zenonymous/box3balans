import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, auditLog, transactions } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { D, type Decimal, str } from "../lib/decimal.js";
import type { HistoryService } from "../prices/history.js";

// As mapBitvavoItem notes a "manually_assigned" history item.
const NOTE = "Bitvavo manually assigned";
// Both halves of a swap are booked within a minute or two of each other.
const WINDOW_MS = 3_600_000;

const day = (d: Date) => d.toISOString().slice(0, 10);

type Row = typeof transactions.$inferSelect;
type Asset = typeof assets.$inferSelect;

/**
 * Bitvavo books a coin it renames or swaps (MATIC for POL, LIT for HEI) as two "manually assigned"
 * entries: the old coin out, the new one in. Imported as they are, the old coin leaves for €0 and
 * the new one arrives worth €0, so its purchase cost is lost. Each such pair becomes a swap: a sale
 * of the old coin and a purchase of the new one at the same EUR value, as other crypto-to-crypto
 * trades are booked. A pair whose value isn't known yet waits for a later sync; rows you edited
 * stay as they are.
 */
export async function bookBitvavoSwaps(db: DB, history: HistoryService, accountId: number): Promise<number> {
  const rows = await db
    .select({ tx: transactions, asset: assets })
    .from(transactions)
    .innerJoin(assets, eq(assets.id, transactions.assetId))
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.source, "api"),
        inArray(transactions.type, ["withdrawal", "deposit"]),
        isNull(transactions.transferGroup),
        eq(transactions.notes, NOTE),
        eq(assets.assetClass, "crypto"),
      ),
    );
  if (rows.length < 2) return 0;
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
              rows.map((r) => r.tx.id),
            ),
          ),
        )
    ).map((r) => r.id),
  );
  const todo = rows.filter((r) => !edited.has(r.tx.id));
  const outs = todo.filter((r) => r.tx.type === "withdrawal").sort((a, b) => +a.tx.occurredAt - +b.tx.occurredAt);
  const ins = todo.filter((r) => r.tx.type === "deposit");
  const used = new Set<number>();
  let booked = 0;

  for (const out of outs) {
    const t = out.tx.occurredAt.getTime();
    const [into] = ins
      .filter(
        (r) =>
          !used.has(r.tx.id) && r.tx.assetId !== out.tx.assetId && Math.abs(r.tx.occurredAt.getTime() - t) <= WINDOW_MS,
      )
      // Most swaps are one for one: an equal amount first, then the nearest in time.
      .sort(
        (a, b) =>
          Number(!D(a.tx.quantity).eq(out.tx.quantity)) - Number(!D(b.tx.quantity).eq(out.tx.quantity)) ||
          Math.abs(a.tx.occurredAt.getTime() - t) - Math.abs(b.tx.occurredAt.getTime() - t),
      );
    if (!into) continue;
    // Valued at what was given up if known, else at what was received.
    const value = (await valueOf(history, out.asset, out.tx)) ?? (await valueOf(history, into.asset, into.tx));
    if (!value) continue;
    used.add(into.tx.id);
    const notes = `${NOTE} · swap ${out.asset.symbol} → ${into.asset.symbol}`;
    const legs: [Row, "sell" | "buy"][] = [
      [out.tx, "sell"],
      [into.tx, "buy"],
    ];
    for (const [tx, type] of legs) {
      const set = {
        type,
        price: str(value.div(tx.quantity)),
        currency: "EUR",
        fxRate: "1",
        notes,
        updatedAt: new Date(),
      };
      await db.update(transactions).set(set).where(eq(transactions.id, tx.id));
      await audit(db, "transaction", tx.id, "update", tx, { ...set, via: "sync" });
    }
    booked++;
  }
  return booked;
}

async function valueOf(history: HistoryService, asset: Asset, tx: Row): Promise<Decimal | null> {
  const d = day(tx.occurredAt);
  try {
    await history.ensureRange(asset, d, d);
  } catch {
    // no price for that day yet
  }
  const eur = await history.eurOn(asset.id, d);
  return eur?.gt(0) ? eur.mul(D(tx.quantity)) : null;
}
