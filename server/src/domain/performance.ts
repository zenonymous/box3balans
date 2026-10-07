import type { DB } from "../db/client.js";
import { accounts, assets, metalItems, transactions } from "../db/schema.js";
import { D, type Decimal, ZERO, money2 } from "../lib/decimal.js";
import { computeHistory, pointOn } from "./history.js";
import { replayLedger, type CostMethod } from "./ledger.js";
import { localDay } from "../lib/time.js";

export interface YearResult {
  year: number;
  realizedEur: string;
  dividendsEur: string;
  rewardsEur: string;
  interestEur: string;
  incomeEur: string;
  // Change in open (unrealized) gains over the year.
  unrealizedChangeEur: string;
  // Investment result: realized + income + change in unrealized. Deposits don't count as gains.
  resultEur: string;
  // Already included in the figures above; shown for information.
  feesEur: string;
  taxWithheldEur: string;
  netWorthStartEur: string | null;
  netWorthEndEur: string;
}

export interface RealizedRow {
  // "fee": units of the asset spent as a network fee (a loss of their cost).
  kind: "sale" | "fee";
  txId: number;
  date: string;
  assetId: number;
  symbol: string;
  name: string;
  accountName: string;
  quantity: string;
  proceedsEur: string;
  costEur: string;
  gainEur: string;
  physical: boolean;
}

export interface IncomeRow {
  txId: number;
  date: string;
  kind: "dividend" | "reward" | "interest";
  assetId: number;
  symbol: string;
  name: string;
  accountId: number;
  accountName: string;
  grossEur: string;
  taxEur: string;
  netEur: string;
}

const year = (d: Date | string) => Number((typeof d === "string" ? d : localDay(d)).slice(0, 4));

/** Ledger outcomes enriched with names: realized sales (incl. physical metal) and income events. */
export async function loadEvents(db: DB, method: CostMethod) {
  const [txs, assetRows, accountRows, items] = await Promise.all([
    db.select().from(transactions),
    db.select().from(assets),
    db.select().from(accounts),
    db.select().from(metalItems),
  ]);
  const ledger = replayLedger(txs, method);
  const asset = new Map(assetRows.map((a) => [a.id, a]));
  const account = new Map(accountRows.map((a) => [a.id, a.name]));

  const realized: RealizedRow[] = ledger.realized.map((r) => ({
    kind: r.kind,
    txId: r.txId,
    date: localDay(r.occurredAt),
    assetId: r.assetId,
    symbol: asset.get(r.assetId)?.symbol ?? "?",
    name: asset.get(r.assetId)?.name ?? "?",
    accountName: account.get(r.accountId) ?? "?",
    quantity: r.quantity.toFixed(),
    proceedsEur: money2(r.proceedsEur),
    costEur: money2(r.costEur),
    gainEur: money2(r.gainEur),
    physical: false,
  }));
  const metalId = (m: string) =>
    assetRows.find((a) => a.priceSource === "metal" && a.name.toLowerCase() === m)?.id ?? 0;
  for (const it of items) {
    if (!it.soldDate || it.salePriceEur == null) continue;
    realized.push({
      kind: "sale",
      txId: -it.id,
      date: it.soldDate,
      assetId: metalId(it.metal),
      symbol: it.metal === "gold" ? "XAU" : it.metal === "silver" ? "XAG" : it.metal === "platinum" ? "XPT" : "XPD",
      name: `${it.quantity > 1 ? `${it.quantity}× ` : ""}${it.product}`,
      accountName: account.get(it.accountId) ?? "?",
      quantity: String(it.quantity),
      proceedsEur: money2(D(it.salePriceEur)),
      costEur: money2(D(it.purchasePriceEur)),
      gainEur: money2(D(it.salePriceEur).minus(D(it.purchasePriceEur))),
      physical: true,
    });
  }
  realized.sort((a, b) => b.date.localeCompare(a.date));

  const income: IncomeRow[] = ledger.income
    .map((e) => ({
      txId: e.txId,
      date: localDay(e.occurredAt),
      // Rewards paid on cash balances are interest.
      kind: (e.kind === "reward" && asset.get(e.assetId)?.assetClass === "cash"
        ? "interest"
        : e.kind) as IncomeRow["kind"],
      assetId: e.assetId,
      symbol: asset.get(e.assetId)?.symbol ?? "?",
      name: asset.get(e.assetId)?.name ?? "?",
      accountId: e.accountId,
      accountName: account.get(e.accountId) ?? "?",
      grossEur: money2(e.grossEur),
      taxEur: money2(e.taxEur),
      netEur: money2(e.netEur),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  return { txs, realized, income };
}

/** Investment result per calendar year, from the first year with activity to today. */
export async function computeYears(db: DB, method: CostMethod): Promise<YearResult[]> {
  const [{ txs, realized, income }, history] = await Promise.all([loadEvents(db, method), computeHistory(db, method)]);
  const points = history.points;
  if (points.length === 0) return [];
  const first = year(points[0]!.day);
  const last = year(points.at(-1)!.day);

  const acc = new Map<number, Record<"realized" | "dividends" | "rewards" | "interest" | "fees" | "tax", Decimal>>();
  const get = (y: number) => {
    let r = acc.get(y);
    if (!r) {
      r = { realized: ZERO, dividends: ZERO, rewards: ZERO, interest: ZERO, fees: ZERO, tax: ZERO };
      acc.set(y, r);
    }
    return r;
  };
  for (const r of realized) get(year(r.date)).realized = get(year(r.date)).realized.plus(D(r.gainEur));
  for (const e of income) {
    const r = get(year(e.date));
    const key = e.kind === "dividend" ? "dividends" : e.kind === "interest" ? "interest" : "rewards";
    r[key] = r[key].plus(D(e.netEur));
    r.tax = r.tax.plus(D(e.taxEur));
  }
  for (const t of txs) get(year(t.occurredAt)).fees = get(year(t.occurredAt)).fees.plus(D(t.feeEur));

  const out: YearResult[] = [];
  for (let y = first; y <= last; y++) {
    const startPt = pointOn(points, `${y - 1}-12-31`);
    const endPt = pointOn(points, `${y}-12-31`)!;
    const r = get(y);
    const incomeEur = r.dividends.plus(r.rewards).plus(r.interest);
    const unrealizedChange = D(endPt.unrealizedEur).minus(D(startPt?.unrealizedEur ?? 0));
    out.push({
      year: y,
      realizedEur: money2(r.realized),
      dividendsEur: money2(r.dividends),
      rewardsEur: money2(r.rewards),
      interestEur: money2(r.interest),
      incomeEur: money2(incomeEur),
      unrealizedChangeEur: money2(unrealizedChange),
      resultEur: money2(r.realized.plus(incomeEur).plus(unrealizedChange)),
      feesEur: money2(r.fees),
      taxWithheldEur: money2(r.tax),
      netWorthStartEur: startPt ? money2(D(startPt.totalEur)) : null,
      netWorthEndEur: money2(D(endPt.totalEur)),
    });
  }
  return out.reverse();
}
