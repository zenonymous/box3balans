import { asc, count, max } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, metalItems, priceHistory, pricesLatest, transactions } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { D, type Decimal, ZERO } from "../lib/decimal.js";
import { Ledger, sortTransactions, type CostMethod } from "./ledger.js";
import type { AssetClassKey } from "./portfolio.js";
import { localDay, localToday } from "../lib/time.js";

export interface HistoryPoint {
  day: string;
  totalEur: number;
  byClass: Record<AssetClassKey, number>;
  // Cost basis of everything held except cash (what you put in, net of what you took out at cost).
  investedEur: number;
  // Value − invested for non-cash holdings.
  unrealizedEur: number;
}

export interface History {
  points: HistoryPoint[];
  // Assets valued at cost for more than a few days because no price history was available
  // (a market holiday on the purchase day doesn't count).
  estimated: { symbol: string; until: string }[];
}

const CLASSES: AssetClassKey[] = ["stock", "etf", "crypto", "metal", "cash", "other"];
const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDay = (day: string) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS));

/** Walks a per-asset price series forward in time, carrying the last close over gaps (weekends). */
class PriceCursor {
  private i = -1;
  constructor(private series: { day: string; closeEur: Decimal }[]) {}
  at(day: string): Decimal | null {
    while (this.i + 1 < this.series.length && this.series[this.i + 1]!.day <= day) this.i++;
    return this.i >= 0 ? this.series[this.i]!.closeEur : null;
  }
}

let cache: { key: string; value: History } | null = null;

/** Cheap fingerprint of everything the history depends on, to reuse a computed result. */
async function fingerprint(db: DB, method: CostMethod): Promise<string> {
  const [[tx], [ph], [mi], [pl]] = await Promise.all([
    db.select({ n: count(), u: max(transactions.updatedAt) }).from(transactions),
    db.select({ n: count(), d: max(priceHistory.day) }).from(priceHistory),
    db.select({ n: count(), u: max(metalItems.updatedAt) }).from(metalItems),
    db.select({ u: max(pricesLatest.fetchedAt) }).from(pricesLatest),
  ]);
  return JSON.stringify([method, tx, ph, mi, pl, localToday()]);
}

/**
 * Daily net worth from the first transaction until today, valuing each day's holdings at that
 * day's close (today at the latest live prices). Holdings without any price yet count at cost.
 */
export async function computeHistory(db: DB, method: CostMethod): Promise<History> {
  const key = await fingerprint(db, method);
  if (cache?.key === key) return cache.value;

  const [txRows, assetRows, priceRows, latest, items] = await Promise.all([
    db.select().from(transactions),
    db.select().from(assets),
    db
      .select({ assetId: priceHistory.assetId, day: priceHistory.day, closeEur: priceHistory.closeEur })
      .from(priceHistory)
      .orderBy(asc(priceHistory.day)),
    db.select().from(pricesLatest),
    db.select().from(metalItems),
  ]);
  const txs = sortTransactions(txRows);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const series = new Map<number, { day: string; closeEur: Decimal }[]>();
  for (const r of priceRows) {
    const list = series.get(r.assetId) ?? [];
    list.push({ day: r.day, closeEur: D(r.closeEur) });
    series.set(r.assetId, list);
  }
  const cursors = new Map<number, PriceCursor>();
  const priceOf = (assetId: number, day: string) => {
    let c = cursors.get(assetId);
    if (!c) {
      c = new PriceCursor(series.get(assetId) ?? []);
      cursors.set(assetId, c);
    }
    return c.at(day);
  };
  const latestById = new Map(latest.map((p) => [p.assetId, D(p.priceEur)]));
  const metalAsset = new Map(assetRows.filter((a) => a.priceSource === "metal").map((a) => [a.priceRef, a]));

  const firstTx = txs[0] ? localDay(txs[0].occurredAt) : null;
  const firstItem = items.reduce<string | null>((m, i) => (!m || i.purchaseDate < m ? i.purchaseDate : m), null);
  const start = [firstTx, firstItem].filter((d): d is string => !!d).sort()[0];
  const today = localToday();
  if (!start) return { points: [], estimated: [] };

  const ledger = new Ledger(method);
  const estimated = new Map<string, { until: string; days: number }>();
  const markEstimated = (symbol: string, day: string) => {
    const e = estimated.get(symbol) ?? { until: day, days: 0 };
    estimated.set(symbol, { until: day, days: e.days + 1 });
  };
  const points: HistoryPoint[] = [];
  let ti = 0;

  for (let day = start; day <= today; day = addDay(day)) {
    // Transactions belong to their calendar day in the user's time zone.
    while (ti < txs.length && localDay(txs[ti]!.occurredAt) <= day) ledger.apply(txs[ti++]!);
    const isToday = day === today;
    const byClass = Object.fromEntries(CLASSES.map((c) => [c, ZERO])) as Record<AssetClassKey, Decimal>;
    let invested = ZERO;
    let nonCashValue = ZERO;

    const unitPrice = (assetId: number): Decimal | null => {
      const a = assetById.get(assetId);
      if (a?.priceSource === "fx" && a.priceRef === "EUR") return D(1);
      if (isToday && latestById.has(assetId)) return latestById.get(assetId)!;
      return priceOf(assetId, day);
    };

    for (const p of ledger.positions.values()) {
      if (p.quantity.isZero()) continue;
      const a = assetById.get(p.assetId);
      if (!a || a.hidden) continue;
      const cls = a.assetClass as AssetClassKey;
      const price = unitPrice(p.assetId);
      let value: Decimal;
      if (price) value = p.quantity.mul(price);
      else {
        // No price known yet for this day: count it at cost rather than as zero.
        value = p.costEur;
        markEstimated(a.symbol, day);
      }
      byClass[cls] = byClass[cls].plus(value);
      if (cls !== "cash") {
        invested = invested.plus(p.costEur);
        nonCashValue = nonCashValue.plus(value);
      }
    }

    for (const it of items) {
      if (it.purchaseDate > day || (it.soldDate && it.soldDate <= day)) continue;
      const a = metalAsset.get(METAL_CODES[it.metal]);
      const fine = D(it.grossWeightG).mul(D(it.purity)).mul(it.quantity);
      const price = a ? unitPrice(a.id) : null;
      const value = price ? fine.mul(price) : D(it.purchasePriceEur);
      if (!price && a) markEstimated(a.symbol, day);
      byClass.metal = byClass.metal.plus(value);
      invested = invested.plus(D(it.purchasePriceEur));
      nonCashValue = nonCashValue.plus(value);
    }

    let total = ZERO;
    for (const c of CLASSES) total = total.plus(byClass[c]);
    points.push({
      day,
      totalEur: total.toDecimalPlaces(2).toNumber(),
      byClass: Object.fromEntries(CLASSES.map((c) => [c, byClass[c].toDecimalPlaces(2).toNumber()])) as Record<
        AssetClassKey,
        number
      >,
      investedEur: invested.toDecimalPlaces(2).toNumber(),
      unrealizedEur: nonCashValue.minus(invested).toDecimalPlaces(2).toNumber(),
    });
  }

  const value: History = {
    points,
    estimated: [...estimated].filter(([, e]) => e.days > 5).map(([symbol, e]) => ({ symbol, until: e.until })),
  };
  cache = { key, value };
  return value;
}

/** Value on the last day on or before `day` (null before the history starts). */
export function pointOn(points: HistoryPoint[], day: string): HistoryPoint | null {
  let lo = 0;
  let hi = points.length - 1;
  let found: HistoryPoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.day <= day) {
      found = points[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Keeps at most ~`max` points (always the first and last), for charts over long ranges. */
export function downsample(points: HistoryPoint[], maxPoints: number): HistoryPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out = points.filter((_, i) => i % step === 0);
  if (out.at(-1) !== points.at(-1)) out.push(points.at(-1)!);
  return out;
}
