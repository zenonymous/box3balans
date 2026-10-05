import { asc, inArray } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, metalItems, priceHistory, transactions } from "../db/schema.js";
import { localDay, localToday } from "../lib/time.js";
import { METAL_CODES } from "../db/seed.js";
import { type CashFlow, xirr } from "./returns.js";

type Tx = typeof transactions.$inferSelect;

/**
 * Return in %: annualised (XIRR) when the money has been in for a year or more, else over the
 * holding period, since annualising a few weeks blows small moves up.
 */
export interface MoneyWeighted {
  pct: number | null;
  annualised: boolean;
}

/**
 * Money-weighted return (XIRR, annualised) per holding and per account, from what went in and
 * came out and what it's worth today. Per holding, every buy is money in and every sale or
 * dividend money out, wherever the cash came from; per account, only money crossing the account's
 * boundary counts (deposits, transfers, trades not paid from its cash, metal bought or sold).
 */
export async function moneyWeightedReturns(
  db: DB,
  current: { byKey: Map<string, number>; byAccount: Map<number, number> },
): Promise<{ byKey: Map<string, MoneyWeighted>; byAccount: Map<number, MoneyWeighted> }> {
  const [txs, assetRows, items] = await Promise.all([
    db.select().from(transactions).orderBy(asc(transactions.occurredAt)),
    db.select().from(assets),
    db.select().from(metalItems),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const isCash = (id: number) => assetById.get(id)?.assetClass === "cash";

  // Market value for assets moving in or out (deposits, withdrawals, transfers).
  const moved = [
    ...new Set(
      txs
        .filter((t) => ["deposit", "withdrawal", "transfer_in", "transfer_out"].includes(t.type) && !isCash(t.assetId))
        .map((t) => t.assetId),
    ),
  ];
  const closes = new Map<number, { day: string; eur: number }[]>();
  if (moved.length) {
    const rows = await db
      .select({ assetId: priceHistory.assetId, day: priceHistory.day, closeEur: priceHistory.closeEur })
      .from(priceHistory)
      .where(inArray(priceHistory.assetId, moved))
      .orderBy(asc(priceHistory.day));
    for (const r of rows)
      closes.set(r.assetId, [...(closes.get(r.assetId) ?? []), { day: r.day, eur: Number(r.closeEur) }]);
  }
  const closeOn = (assetId: number, day: string): number | null => {
    const s = closes.get(assetId);
    if (!s?.length) return null;
    let lo = 0;
    let hi = s.length - 1;
    let found: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid]!.day <= day) {
        found = s[mid]!.eur;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  const num = (v: string) => Number(v);
  const marketValue = (t: Tx) => {
    const day = localDay(t.occurredAt);
    const close = closeOn(t.assetId, day);
    return close != null ? num(t.quantity) * close : num(t.quantity) * num(t.price) * num(t.fxRate);
  };

  const flowsByKey = new Map<string, CashFlow[]>();
  const flowsByAccount = new Map<number, CashFlow[]>();
  const add = <K>(m: Map<K, CashFlow[]>, k: K, day: string, amount: number) => {
    if (!amount) return;
    m.set(k, [...(m.get(k) ?? []), { day, amount }]);
  };

  for (const t of txs) {
    const a = assetById.get(t.assetId);
    if (!a || a.hidden) continue;
    const day = localDay(t.occurredAt);
    const gross = num(t.quantity) * num(t.price) * num(t.fxRate);
    const fee = num(t.feeEur);
    const key = `a${t.assetId}`;
    const settled = !!t.settleAssetId;
    switch (t.type) {
      case "buy":
        if (!isCash(t.assetId)) add(flowsByKey, key, day, -(gross + fee));
        if (!settled) add(flowsByAccount, t.accountId, day, -(gross + fee));
        break;
      case "sell":
        if (!isCash(t.assetId)) add(flowsByKey, key, day, gross - fee);
        if (!settled) add(flowsByAccount, t.accountId, day, gross - fee);
        break;
      case "dividend": {
        const net = (num(t.amount) - num(t.taxWithheld)) * num(t.fxRate);
        add(flowsByKey, key, day, net);
        if (!settled) add(flowsByAccount, t.accountId, day, net);
        break;
      }
      case "deposit":
      case "withdrawal": {
        const v = isCash(t.assetId) ? gross : marketValue(t);
        const sign = t.type === "deposit" ? -1 : 1;
        if (!isCash(t.assetId)) add(flowsByKey, key, day, sign * v);
        add(flowsByAccount, t.accountId, day, sign * v);
        break;
      }
      case "transfer_in":
      case "transfer_out":
        // Between your own accounts: no flow for the holding, but one for each account.
        add(flowsByAccount, t.accountId, day, (t.type === "transfer_in" ? -1 : 1) * marketValue(t));
        break;
    }
  }
  const metalId = new Map(assetRows.filter((a) => a.priceSource === "metal").map((a) => [a.priceRef, a.id]));
  for (const it of items) {
    const id = metalId.get(METAL_CODES[it.metal]);
    const key = id ? `p${id}` : null;
    if (key) add(flowsByKey, key, it.purchaseDate, -num(it.purchasePriceEur));
    add(flowsByAccount, it.accountId, it.purchaseDate, -num(it.purchasePriceEur));
    if (it.soldDate && it.salePriceEur) {
      if (key) add(flowsByKey, key, it.soldDate, num(it.salePriceEur));
      add(flowsByAccount, it.accountId, it.soldDate, num(it.salePriceEur));
    }
  }

  const today = localToday();
  const solve = <K>(flows: Map<K, CashFlow[]>, values: Map<K, number>) => {
    const out = new Map<K, MoneyWeighted>();
    for (const [k, fs] of flows) {
      const r = xirr([...fs, { day: today, amount: values.get(k) ?? 0 }]);
      const first = fs.reduce((m, f) => (f.day < m ? f.day : m), today);
      const years = (Date.parse(today) - Date.parse(first)) / (365 * 86_400_000);
      const annualised = years >= 1;
      const v = r == null ? null : annualised ? r : (1 + r) ** years - 1;
      out.set(k, { pct: v == null || !Number.isFinite(v) ? null : Math.round(v * 1e6) / 1e4, annualised });
    }
    return out;
  };
  return { byKey: solve(flowsByKey, current.byKey), byAccount: solve(flowsByAccount, current.byAccount) };
}
