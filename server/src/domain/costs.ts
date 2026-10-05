import type { DB } from "../db/client.js";
import { accounts, assets, metalItems } from "../db/schema.js";
import { D, type Decimal, ZERO } from "../lib/decimal.js";
import { localDay } from "../lib/time.js";
import { computeHistory } from "./history.js";
import type { CostMethod } from "./ledger.js";
import { loadEvents } from "./performance.js";

export const COST_CATEGORIES = [
  "trading",
  "network",
  "storage",
  "account",
  "withholding",
  "funds",
  "premiums",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export interface CostLine {
  year: number;
  category: CostCategory;
  accountId: number | null;
  accountName: string | null;
  assetId: number | null;
  symbol: string | null;
  eur: number;
}

export interface CostYear extends Record<CostCategory, number> {
  year: number;
  total: number;
  avgValueEur: number;
  // Costs as a share of the average portfolio value that year.
  pctOfValue: number | null;
}

const round2 = (d: Decimal) => Math.round(d.toNumber() * 100) / 100;

/**
 * Everything investing cost, per year: trading fees, network fees (gas, miner fees), vault storage
 * fees and account fees (paid by selling or giving up some of an asset), dividend tax withheld,
 * fund running costs (estimated from the fund's TER and its daily value) and dealer premiums paid
 * above spot on physical metal.
 */
export async function computeCosts(db: DB, method: CostMethod) {
  const [{ txs, realized, income }, history, assetRows, accountRows, items] = await Promise.all([
    loadEvents(db, method),
    computeHistory(db, method),
    db.select().from(assets),
    db.select().from(accounts),
    db.select().from(metalItems),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const txById = new Map(txs.map((t) => [t.id, t]));
  const lines = new Map<string, CostLine>();
  const add = (
    year: number,
    category: CostCategory,
    accountId: number | null,
    assetId: number | null,
    eur: Decimal,
  ) => {
    if (eur.isZero()) return;
    const key = `${year}|${category}|${accountId}|${assetId}`;
    const cur = lines.get(key);
    if (cur) cur.eur += eur.toNumber();
    else
      lines.set(key, {
        year,
        category,
        accountId,
        accountName: accountId ? (accountById.get(accountId)?.name ?? null) : null,
        assetId,
        symbol: assetId ? (assetById.get(assetId)?.symbol ?? null) : null,
        eur: eur.toNumber(),
      });
  };

  // Fees charged in cash on trades and transfers.
  for (const t of txs) {
    const fee = D(t.feeEur);
    if (fee.gt(0)) add(Number(localDay(t.occurredAt).slice(0, 4)), "trading", t.accountId, null, fee);
  }
  // Fees paid in an asset: what the units given up had cost.
  for (const r of realized) {
    if (r.kind !== "fee") continue;
    const tx = txById.get(r.txId);
    if (!tx) continue;
    const a = assetById.get(r.assetId);
    const acc = accountById.get(tx.accountId);
    const category: CostCategory =
      a?.assetClass === "cash" ? "account" : acc?.kind === "vault" || a?.assetClass === "metal" ? "storage" : "network";
    add(Number(r.date.slice(0, 4)), category, tx.accountId, r.assetId, D(r.costEur));
  }
  for (const e of income) {
    const tax = D(e.taxEur);
    const tx = txById.get(e.txId);
    if (tax.gt(0) && tx) add(Number(e.date.slice(0, 4)), "withholding", tx.accountId, e.assetId, tax);
  }
  // Fund running costs accrue daily: value × TER / 365.
  for (const [key, valueDays] of Object.entries(history.assetValueDays)) {
    const [y, id] = key.split("|");
    const a = assetById.get(Number(id));
    if (!a?.terPct) continue;
    add(Number(y), "funds", null, a.id, D(valueDays).mul(D(a.terPct)).div(100).div(365));
  }
  for (const it of items) {
    if (it.spotValueAtPurchaseEur == null) continue;
    const premium = D(it.purchasePriceEur).minus(D(it.spotValueAtPurchaseEur));
    if (premium.gt(0)) add(Number(it.purchaseDate.slice(0, 4)), "premiums", it.accountId, null, premium);
  }

  // Average portfolio value per year, from the daily history.
  const valueSum = new Map<number, { sum: number; n: number }>();
  for (const p of history.points) {
    const y = Number(p.day.slice(0, 4));
    const v = valueSum.get(y) ?? { sum: 0, n: 0 };
    v.sum += p.totalEur;
    v.n++;
    valueSum.set(y, v);
  }

  const all = [...lines.values()].map((l) => ({ ...l, eur: Math.round(l.eur * 100) / 100 }));
  const years = [...new Set([...valueSum.keys(), ...all.map((l) => l.year)])].sort((a, b) => b - a);
  const out: CostYear[] = years.map((year) => {
    const sums = Object.fromEntries(COST_CATEGORIES.map((c) => [c, ZERO])) as Record<CostCategory, Decimal>;
    for (const l of all) if (l.year === year) sums[l.category] = sums[l.category].plus(l.eur);
    const total = COST_CATEGORIES.reduce((a, c) => a.plus(sums[c]), ZERO);
    const v = valueSum.get(year);
    const avg = v && v.n ? v.sum / v.n : 0;
    return {
      year,
      ...(Object.fromEntries(COST_CATEGORIES.map((c) => [c, round2(sums[c])])) as Record<CostCategory, number>),
      total: round2(total),
      avgValueEur: Math.round(avg * 100) / 100,
      pctOfValue: avg > 0 ? Math.round((total.toNumber() / avg) * 1e6) / 1e4 : null,
    };
  });

  // Funds held without a TER: their running costs are missing from the totals.
  const heldIds = new Set(Object.keys(history.assetValueDays).map((k) => Number(k.split("|")[1])));
  const fundsWithoutTer = assetRows
    .filter((a) => a.assetClass === "etf" && !a.terPct && !a.hidden && heldIds.has(a.id))
    .map((a) => ({ assetId: a.id, symbol: a.symbol, name: a.name }));

  return { years: out, lines: all.sort((a, b) => b.year - a.year || b.eur - a.eur), fundsWithoutTer };
}
