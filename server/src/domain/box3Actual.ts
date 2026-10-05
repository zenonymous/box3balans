import { and, asc, gte, inArray, lt, lte } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, metalItems, priceHistory, transactions } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { D, type Decimal, ZERO } from "../lib/decimal.js";
import { fromLocal, localDay, localToday } from "../lib/time.js";
import { type Box3Config, type Category, categoryOf } from "./box3.js";
import { holdingsOn } from "./valuation.js";

/** Where an amount of the actual return sits, as the Opgaaf werkelijk rendement groups it. */
export type Kind = "bank" | "investments" | "crypto" | "metals" | "cash" | "other";

export interface ReturnPart {
  startEur: number; // value on 1 January (end of 31 December before)
  endEur: number; // value on 31 December (or today, for the running year)
  inEur: number; // money and assets that came in: purchases, deposits, transfers in
  outEur: number; // what went out: sales, withdrawals, transfers out, units spent on fees
  valueChangeEur: number; // end − start − in + out: realised and unrealised
  directEur: number; // interest, dividends (gross), staking rewards
  returnEur: number; // value change + direct
}

export interface ActualReturn {
  year: number;
  // False for the running year: "so far", with today's values as the end.
  complete: boolean;
  endDay: string;
  parts: Record<Kind, ReturnPart>;
  // Inside the totals: costs that may not be deducted (fees), and dividend tax (dividends count gross).
  costsEur: number;
  dividendTaxEur: number;
  // Accounts left out: green investments (exempt) and accounts outside box 3.
  leftOut: { category: "exempt" | "excluded"; returnEur: number }[];
  extraReturnEur: number; // on assets the app doesn't track, entered for the year
  debtInterestEur: number;
  totalEur: number; // the actual return; may be negative
}

const num = (d: Decimal) => Math.round(d.toNumber() * 100) / 100;
const emptyPart = () => ({ start: ZERO, end: ZERO, in: ZERO, out: ZERO, direct: ZERO });

/**
 * The actual box 3 return of one calendar year, per the tegenbewijsregeling: direct return plus all
 * value changes (realised or not) of everything held during the year, without deducting costs,
 * minus interest paid on debts. Computed per position (account × asset): a buy paid from the
 * account's cash moves value between positions, so it's neither return nor cost.
 */
export async function actualReturn(db: DB, year: number, config: Box3Config): Promise<ActualReturn> {
  const today = localToday();
  const complete = `${year}-12-31` < today;
  const endDay = complete ? `${year}-12-31` : today;
  const startDay = `${year - 1}-12-31`;
  const from = fromLocal(year, 1, 1, 0, 0, 0);
  const until = complete ? fromLocal(year + 1, 1, 1, 0, 0, 0) : new Date();

  const [startRows, endRows, txs, assetRows, accountRows, items] = await Promise.all([
    holdingsOn(db, startDay),
    holdingsOn(db, endDay),
    db
      .select()
      .from(transactions)
      .where(and(gte(transactions.occurredAt, from), lt(transactions.occurredAt, until)))
      .orderBy(asc(transactions.occurredAt)),
    db.select().from(assets),
    db.select().from(accounts),
    db.select().from(metalItems),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const accountById = new Map(accountRows.map((a) => [a.id, a]));

  // Market values for assets moving in or out without a price (deposits, transfers, fees).
  const needPrices = [...new Set(txs.map((t) => t.assetId))];
  const closes = new Map<number, { day: string; eur: Decimal }[]>();
  if (needPrices.length) {
    const rows = await db
      .select({ assetId: priceHistory.assetId, day: priceHistory.day, closeEur: priceHistory.closeEur })
      .from(priceHistory)
      .where(
        and(
          inArray(priceHistory.assetId, needPrices),
          gte(priceHistory.day, `${year - 1}-12-20`),
          lte(priceHistory.day, endDay),
        ),
      )
      .orderBy(asc(priceHistory.day));
    for (const r of rows) closes.set(r.assetId, [...(closes.get(r.assetId) ?? []), { day: r.day, eur: D(r.closeEur) }]);
  }
  const closeOn = (assetId: number, day: string): Decimal | null => {
    let found: Decimal | null = null;
    for (const c of closes.get(assetId) ?? []) {
      if (c.day > day) break;
      found = c.eur;
    }
    return found;
  };

  type Pos = ReturnType<typeof emptyPart> & { accountId: number; assetId: number; physical: boolean };
  const positions = new Map<string, Pos>();
  const pos = (accountId: number, assetId: number, physical = false) => {
    const k = `${accountId}|${assetId}|${physical ? "p" : "l"}`;
    let p = positions.get(k);
    if (!p) {
      p = { ...emptyPart(), accountId, assetId, physical };
      positions.set(k, p);
    }
    return p;
  };
  for (const h of startRows) pos(h.accountId, h.assetId, h.physical).start = h.valueEur;
  for (const h of endRows) pos(h.accountId, h.assetId, h.physical).end = h.valueEur;

  const costByPos = new Map<Pos, Decimal>();
  const addCost = (p: Pos, v: Decimal) => costByPos.set(p, (costByPos.get(p) ?? ZERO).plus(v));
  const taxByPos = new Map<Pos, Decimal>();

  for (const t of txs) {
    const a = assetById.get(t.assetId);
    if (!a || a.hidden) continue;
    const day = localDay(t.occurredAt);
    const isCash = a.assetClass === "cash";
    const q = D(t.quantity);
    const fx = D(t.fxRate);
    const gross = q.mul(D(t.price)).mul(fx);
    const fee = D(t.feeEur);
    const market = isCash
      ? q.mul(fx)
      : (() => {
          const c = closeOn(t.assetId, day);
          return c ? q.mul(c) : gross;
        })();
    const p = pos(t.accountId, t.assetId);
    const cash = t.settleAssetId ? pos(t.accountId, t.settleAssetId) : null;
    switch (t.type) {
      case "buy":
        p.in = p.in.plus(gross);
        if (cash) cash.out = cash.out.plus(gross).plus(fee);
        if (fee.gt(0)) addCost(p, fee);
        break;
      case "sell":
        p.out = p.out.plus(gross);
        if (cash) cash.in = cash.in.plus(gross).minus(fee);
        if (fee.gt(0)) addCost(p, fee);
        break;
      case "deposit":
      case "transfer_in":
        p.in = p.in.plus(market);
        break;
      case "withdrawal":
      case "transfer_out":
        p.out = p.out.plus(market);
        if (fee.gt(0)) addCost(p, fee);
        break;
      case "dividend": {
        const g = D(t.amount).mul(fx);
        const tax = D(t.taxWithheld).mul(fx);
        p.direct = p.direct.plus(g);
        taxByPos.set(p, (taxByPos.get(p) ?? ZERO).plus(tax));
        if (cash) cash.in = cash.in.plus(g.minus(tax));
        break;
      }
      case "reward": {
        // Interest on cash counts at its amount; staking rewards at the value they were booked at.
        const v = isCash ? q.mul(fx) : gross;
        p.direct = p.direct.plus(v);
        p.in = p.in.plus(v);
        break;
      }
      case "fee":
        // Units given up as a fee left the position; costs aren't deducted, so it's an outflow.
        p.out = p.out.plus(market);
        addCost(p, market);
        break;
    }
  }

  // Physical metal: bought or sold during the year.
  const metalAsset = new Map(assetRows.filter((a) => a.priceSource === "metal").map((a) => [a.priceRef, a.id]));
  for (const it of items) {
    const id = metalAsset.get(METAL_CODES[it.metal]);
    if (!id) continue;
    if (it.purchaseDate >= `${year}-01-01` && it.purchaseDate <= endDay) {
      const p = pos(it.accountId, id, true);
      p.in = p.in.plus(it.purchasePriceEur);
    }
    if (it.soldDate && it.salePriceEur && it.soldDate >= `${year}-01-01` && it.soldDate <= endDay) {
      const p = pos(it.accountId, id, true);
      p.out = p.out.plus(it.salePriceEur);
    }
  }

  const kindOf = (cat: Category, assetClass: string): Kind =>
    cat === "bank"
      ? "bank"
      : assetClass === "stock" || assetClass === "etf"
        ? "investments"
        : assetClass === "crypto"
          ? "crypto"
          : assetClass === "metal"
            ? "metals"
            : assetClass === "cash"
              ? "cash"
              : "other";
  const parts = Object.fromEntries(
    (["bank", "investments", "crypto", "metals", "cash", "other"] as Kind[]).map((k) => [k, emptyPart()]),
  ) as Record<Kind, ReturnType<typeof emptyPart>>;
  const leftOut = new Map<"exempt" | "excluded", Decimal>();
  let inScopeCosts = ZERO;
  let dividendTax = ZERO;
  for (const p of positions.values()) {
    const acc = accountById.get(p.accountId);
    const a = assetById.get(p.assetId);
    if (!acc || !a) continue;
    const cat = categoryOf(config, { accountId: p.accountId, accountKind: acc.kind, assetClass: a.assetClass });
    const ret = p.end.minus(p.start).minus(p.in).plus(p.out).plus(p.direct);
    if (cat === "exempt" || cat === "excluded") {
      leftOut.set(cat, (leftOut.get(cat) ?? ZERO).plus(ret));
      continue;
    }
    inScopeCosts = inScopeCosts.plus(costByPos.get(p) ?? ZERO);
    dividendTax = dividendTax.plus(taxByPos.get(p) ?? ZERO);
    const part = parts[kindOf(cat, a.assetClass)];
    part.start = part.start.plus(p.start);
    part.end = part.end.plus(p.end);
    part.in = part.in.plus(p.in);
    part.out = part.out.plus(p.out);
    part.direct = part.direct.plus(p.direct);
  }

  const input = config.years[String(year)];
  const debtInterest = D(input?.debtInterestEur ?? 0);
  const extraReturn = D(input?.extraReturnEur ?? 0);
  let total = extraReturn.minus(debtInterest);
  const outParts = {} as Record<Kind, ReturnPart>;
  for (const [k, p] of Object.entries(parts) as [Kind, ReturnType<typeof emptyPart>][]) {
    const change = p.end.minus(p.start).minus(p.in).plus(p.out);
    total = total.plus(change).plus(p.direct);
    outParts[k] = {
      startEur: num(p.start),
      endEur: num(p.end),
      inEur: num(p.in),
      outEur: num(p.out),
      valueChangeEur: num(change),
      directEur: num(p.direct),
      returnEur: num(change.plus(p.direct)),
    };
  }

  return {
    year,
    complete,
    endDay,
    parts: outParts,
    costsEur: num(inScopeCosts),
    dividendTaxEur: num(dividendTax),
    leftOut: [...leftOut.entries()].map(([category, v]) => ({ category, returnEur: num(v) })),
    extraReturnEur: num(extraReturn),
    debtInterestEur: num(debtInterest),
    totalEur: num(total),
  };
}
