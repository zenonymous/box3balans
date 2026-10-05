import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, transactions } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { D } from "../lib/decimal.js";

const HOUR = 3_600_000;
// A deposit may be credited before the withdrawal timestamp (clock skew) or days later.
const EARLY_MS = 2 * HOUR;
const LATE_MS = 5 * 24 * HOUR;
// The received amount may be lower than the amount sent by up to 5% (network fees).
const MIN_RECEIVED_RATIO = D("0.95");

/**
 * Links crypto withdrawals from one account with the matching deposit into another account
 * (e.g. Bitvavo → Ledger), turning them into a transfer so the cost basis moves along instead of
 * the deposit starting at market value. At least one side must come from a sync.
 */
export function matchTransfers(db: DB): Promise<number> {
  // Syncs can finish at the same moment; matching one at a time keeps a withdrawal from being
  // linked to two different deposits.
  const run = queue.then(() => matchTransfersNow(db));
  queue = run.catch(() => undefined);
  return run;
}

let queue: Promise<unknown> = Promise.resolve();

async function matchTransfersNow(db: DB): Promise<number> {
  const rows = await db
    .select({ tx: transactions })
    .from(transactions)
    .innerJoin(assets, eq(assets.id, transactions.assetId))
    .where(
      and(
        inArray(transactions.type, ["withdrawal", "deposit"]),
        isNull(transactions.transferGroup),
        // Rows the user unlinked stay unlinked.
        eq(transactions.noAutoMatch, false),
        eq(assets.assetClass, "crypto"),
      ),
    );
  const withdrawals = rows.map((r) => r.tx).filter((t) => t.type === "withdrawal");
  const deposits = rows.map((r) => r.tx).filter((t) => t.type === "deposit");
  withdrawals.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const used = new Set<number>();
  let matched = 0;

  for (const w of withdrawals) {
    const sent = D(w.quantity);
    const t = w.occurredAt.getTime();
    const candidates = deposits.filter((d) => {
      if (used.has(d.id) || d.assetId !== w.assetId || d.accountId === w.accountId) return false;
      if (w.source === "manual" && d.source === "manual") return false;
      const dt = d.occurredAt.getTime() - t;
      if (dt < -EARLY_MS || dt > LATE_MS) return false;
      const got = D(d.quantity);
      return got.lte(sent) && got.gte(sent.mul(MIN_RECEIVED_RATIO));
    });
    if (candidates.length === 0) continue;
    // Closest amount first, then closest in time.
    candidates.sort(
      (a, b) =>
        sent.minus(D(a.quantity)).cmp(sent.minus(D(b.quantity))) ||
        Math.abs(a.occurredAt.getTime() - t) - Math.abs(b.occurredAt.getTime() - t),
    );
    const d = candidates[0]!;
    used.add(d.id);
    const group = randomUUID();
    const note = (n: string | null) => [n, "auto-matched transfer"].filter(Boolean).join(" · ");
    await db.transaction(async (trx) => {
      await trx
        .update(transactions)
        .set({ type: "transfer_out", transferGroup: group, notes: note(w.notes), updatedAt: new Date() })
        .where(eq(transactions.id, w.id));
      await trx
        .update(transactions)
        .set({ type: "transfer_in", transferGroup: group, notes: note(d.notes), updatedAt: new Date() })
        .where(eq(transactions.id, d.id));
    });
    await audit(db, "transaction", w.id, "update", w, { type: "transfer_out", transferGroup: group });
    await audit(db, "transaction", d.id, "update", d, { type: "transfer_in", transferGroup: group });
    matched++;
  }
  return matched;
}
