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
  // Money that came in (+) or went out (−) of the portfolio that day, as opposed to results:
  // deposits and withdrawals, trades or dividends not booked in cash, metal bought or sold.
  flowEur: number;
}

export interface History {
  points: HistoryPoint[];
  // Assets valued at cost for more than a few days because no price history was available
  // (a market holiday on the purchase day doesn't count).
  estimated: { symbol: string; until: string }[];
  // Sum of each asset's daily value per year ("2024|17" → €), for average holdings (e.g. ETF costs).
  assetValueDays: Record<string, number>;
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
  if (!start) return { points: [], estimated: [], assetValueDays: {} };

  const ledger = new Ledger(method);
  const estimated = new Map<string, { until: string; days: number }>();
  const markEstimated = (symbol: string, day: string) => {
    const e = estimated.get(symbol) ?? { until: day, days: 0 };
    estimated.set(symbol, { until: day, days: e.days + 1 });
  };
  const points: HistoryPoint[] = [];
  const assetValueDays: Record<string, number> = {};
  let ti = 0;

  for (let day = start; day <= today; day = addDay(day)) {
    const isToday = day === today;
    const unitPrice = (assetId: number): Decimal | null => {
      const a = assetById.get(assetId);
      if (a?.priceSource === "fx" && a.priceRef === "EUR") return D(1);
      if (isToday && latestById.has(assetId)) return latestById.get(assetId)!;
      return priceOf(assetId, day);
    };

    // Transactions belong to their calendar day in the user's time zone.
    let flow = ZERO;
    while (ti < txs.length && localDay(txs[ti]!.occurredAt) <= day) {
      const tx = txs[ti++]!;
      const a = assetById.get(tx.assetId);
      if (a && !a.hidden) flow = flow.plus(externalFlow(tx, a.assetClass === "cash", unitPrice(tx.assetId)));
      ledger.apply(tx);
    }
    for (const it of items) {
      if (it.purchaseDate === day) flow = flow.plus(D(it.purchasePriceEur));
      if (it.soldDate === day && it.salePriceEur) flow = flow.minus(D(it.salePriceEur));
    }

    const byClass = Object.fromEntries(CLASSES.map((c) => [c, ZERO])) as Record<AssetClassKey, Decimal>;
    let invested = ZERO;
    let nonCashValue = ZERO;
    const yr = day.slice(0, 4);

    for (const p of ledger.positions.values()) {
      if (p.quantity.isZero()) continue;
      const a = assetById.get(p.assetId);
      if (!a || a.hidden) continue;
      const cls = a.assetClass;
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
        const k = `${yr}|${p.assetId}`;
        assetValueDays[k] = (assetValueDays[k] ?? 0) + value.toNumber();
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
      flowEur: flow.toDecimalPlaces(2).toNumber(),
    });
  }

  const value: History = {
    points,
    estimated: [...estimated].filter(([, e]) => e.days > 5).map(([symbol, e]) => ({ symbol, until: e.until })),
    assetValueDays,
  };
  cache = { key, value };
  return value;
}

/**
 * Money moving into (+) or out of (−) the portfolio with one transaction, in EUR. What stays
 * inside (a buy paid from tracked cash, a transfer between your accounts, a reward, a fee) is part
 * of the result, not a flow. Assets moving in or out are counted at that day's market value, else
 * at the price recorded with the transaction.
 */
export function externalFlow(
  tx: {
    type: string;
    quantity: string;
    price: string;
    fxRate: string;
    feeEur: string;
    amount: string;
    taxWithheld: string;
    settleAssetId?: number | null;
  },
  isCash: boolean,
  marketEur: Decimal | null,
): Decimal {
  const q = D(tx.quantity);
  const atPrice = q.mul(D(tx.price)).mul(D(tx.fxRate));
  const valued = isCash ? atPrice : marketEur ? q.mul(marketEur) : atPrice;
  switch (tx.type) {
    case "deposit":
      return valued;
    case "withdrawal":
      return valued.neg();
    case "buy":
      return tx.settleAssetId ? ZERO : atPrice.plus(D(tx.feeEur));
    case "sell":
      return tx.settleAssetId ? ZERO : atPrice.minus(D(tx.feeEur)).neg();
    case "dividend":
      // Paid out to a bank account outside the portfolio: income, then gone.
      return tx.settleAssetId ? ZERO : D(tx.amount).minus(D(tx.taxWithheld)).mul(D(tx.fxRate)).neg();
    default:
      return ZERO;
  }
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
