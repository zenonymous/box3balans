import { and, asc, gte, inArray, lt, lte } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, metalItems, priceHistory, transactions } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { D, type Decimal, ZERO } from "../lib/decimal.js";
import { fromLocal, localDay, localToday } from "../lib/time.js";
import { type Box3Config, type Category, categoryOf } from "./box3.js";
import { attribute, loadHousehold } from "./household.js";
import { holdingsOn } from "./valuation.js";
import { incomeStaysInAccount, loadYearly, yearlyClass, yearlyValue } from "./yearly.js";
import { tr } from "../i18n/index.js";

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
  // Interest paid on debts: entered for the year plus debt accounts.
  debtInterestEur: number;
  totalEur: number; // the actual return; may be negative
  // Accounts kept as values per year that miss a value the return needs.
  warnings: string[];
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

  const fiscalPartner = config.years[String(year)]?.partner ?? false;
  const [startRows, endRows, txs, assetRows, accountRows, items, household, yearly] = await Promise.all([
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
    loadHousehold(db),
    loadYearly(db),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  // The part of each account that counts for you and your fiscal partner (owner, children).
  const weight = (accountId: number) => {
    const acc = accountById.get(accountId);
    if (!acc) return D(1);
    const a = attribute(acc, household, year, fiscalPartner);
    return a.self.plus(a.partner);
  };

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
  const addTo = (
    cat: Category,
    assetClass: string,
    w: Decimal,
    p: { start: Decimal; end: Decimal; in: Decimal; out: Decimal; direct: Decimal },
    costs: Decimal,
    tax: Decimal,
  ) => {
    const ret = p.end.minus(p.start).minus(p.in).plus(p.out).plus(p.direct).mul(w);
    if (cat === "exempt" || cat === "excluded") {
      leftOut.set(cat, (leftOut.get(cat) ?? ZERO).plus(ret));
      return;
    }
    inScopeCosts = inScopeCosts.plus(costs.mul(w));
    dividendTax = dividendTax.plus(tax.mul(w));
    const part = parts[kindOf(cat, assetClass)];
    part.start = part.start.plus(p.start.mul(w));
    part.end = part.end.plus(p.end.mul(w));
    part.in = part.in.plus(p.in.mul(w));
    part.out = part.out.plus(p.out.mul(w));
    part.direct = part.direct.plus(p.direct.mul(w));
  };
  for (const p of positions.values()) {
    const acc = accountById.get(p.accountId);
    const a = assetById.get(p.assetId);
    if (!acc || !a || acc.tracking === "yearly") continue;
    const cat = categoryOf(config, { accountId: p.accountId, accountKind: acc.kind, assetClass: a.assetClass });
    addTo(cat, a.assetClass, weight(p.accountId), p, costByPos.get(p) ?? ZERO, taxByPos.get(p) ?? ZERO);
  }

  // Accounts kept as values per year: from this 1 January to the next, plus what came in, went out
  // and was received. A debt only adds the interest paid (repaying it isn't a return).
  const warnings: string[] = [];
  let accountDebtInterest = ZERO;
  for (const acc of accountRows) {
    if (acc.tracking !== "yearly") continue;
    const byYear = yearly.get(acc.id);
    const row = byYear?.get(year);
    if (!row) continue;
    const w = weight(acc.id);
    if (acc.kind === "debt") {
      accountDebtInterest = accountDebtInterest.plus(D(row.incomeEur).mul(w));
      continue;
    }
    const start = yearlyValue(acc.kind, row);
    // The running year: its end value is the latest known one.
    const end = yearlyValue(acc.kind, byYear?.get(year + 1)) ?? (complete ? null : start);
    if (start == null || end == null) {
      warnings.push(
        tr("{name}: no value on 1 January {day}, so its return for {year} is left out.", {
          name: acc.name,
          day: start == null ? year : year + 1,
          year,
        }),
      );
      continue;
    }
    const cls = yearlyClass(acc.kind);
    const cat = categoryOf(config, { accountId: acc.id, accountKind: acc.kind, assetClass: cls });
    const income = D(row.incomeEur);
    addTo(
      cat,
      cls,
      w,
      // Income credited to the account is already in its end value: book it as coming in too (as
      // for a reward), so the value change shows the price movement and the income shows once.
      {
        start,
        end,
        in: D(row.inEur).plus(incomeStaysInAccount(acc.kind) ? income : ZERO),
        out: D(row.outEur),
        direct: income,
      },
      D(row.costsEur),
      ZERO,
    );
  }

  const input = config.years[String(year)];
  const debtInterest = D(input?.debtInterestEur ?? 0).plus(accountDebtInterest);
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
    warnings,
  };
}
