import { and, asc, gte, inArray, lt, lte } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, metalItems, priceHistory, transactions } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { D, Decimal, ZERO } from "../lib/decimal.js";
import { fromLocal, localDay, localToday } from "../lib/time.js";
import { type Box3Config, type Category, categoryOf } from "./box3.js";
import { attribute, loadHousehold } from "./household.js";
import { LedgerData, holdingsOn } from "./valuation.js";
import { incomeStaysInAccount, loadYearly, taxWithheldAbroad, yearlyClass, yearlyValue } from "./yearly.js";
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

/**
 * A home or other real estate in box 3, for the planned system (from 2028): it taxes the gain when
 * the property is sold and, each year, its rent or a share of its WOZ value. Amounts are the
 * household's share.
 */
export interface PropertyYear {
  accountId: number;
  returnEur: number; // what it adds to this actual return: value change and rent
  wozEur: number; // the value on 1 January, without the leegwaarderatio
  yearShare: number; // the part of the year this return covers: less than 1 in the running year
  rentEur: number;
  costsEur: number; // inside the year's costs
  rented: boolean; // let with rent protection, so all year
  // Next 1 January − this one − in + out, without the leegwaarderatio; in a home's first year
  // here only in + out, as the bill starts from the WOZ value a year later (see below).
  gainEur: number;
  sold: boolean; // worth nothing on the next 1 January, or out of box 3 from then
}

export interface ActualReturn {
  year: number;
  // False for the running year: "so far", with today's values as the end.
  complete: boolean;
  endDay: string;
  parts: Record<Kind, ReturnPart>;
  // Inside the totals: costs that may not be deducted (fees), and tax withheld on dividends and on
  // interest abroad (both count gross).
  costsEur: number;
  taxWithheldEur: number;
  // Accounts left out: green investments (exempt) and accounts outside box 3.
  leftOut: { category: "exempt" | "excluded"; returnEur: number }[];
  extraReturnEur: number; // on assets the app doesn't track, entered for the year
  // Interest paid on debts: entered for the year plus debt accounts.
  debtInterestEur: number;
  totalEur: number; // the actual return; may be negative
  property: PropertyYear[]; // homes and other real estate, inside the total
  // Accounts kept as values per year that miss a value the return needs.
  warnings: string[];
}

// To cents with halves away from zero, in decimals (Math.round on floats rounds 1.005 to 1.00).
const num = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
const emptyPart = () => ({ start: ZERO, end: ZERO, in: ZERO, out: ZERO, direct: ZERO });
// What a value did over the year, apart from what came in and went out.
const valueChange = (p: { start: Decimal; end: Decimal; in: Decimal; out: Decimal }) =>
  p.end.minus(p.start).minus(p.in).plus(p.out);

/**
 * The actual box 3 return of one calendar year, per the tegenbewijsregeling: direct return plus all
 * value changes (realised or not) of everything held during the year, without deducting costs,
 * minus interest paid on debts. Computed per position (account × asset): a buy paid from the
 * account's cash moves value between positions, so it's neither return nor cost.
 */
export async function actualReturn(
  db: DB,
  year: number,
  config: Box3Config,
  data = new LedgerData(db),
): Promise<ActualReturn> {
  const today = localToday();
  const complete = `${year}-12-31` < today;
  const endDay = complete ? `${year}-12-31` : today;
  const startDay = `${year - 1}-12-31`;
  const from = fromLocal(year, 1, 1, 0, 0, 0);
  const until = complete ? fromLocal(year + 1, 1, 1, 0, 0, 0) : new Date();

  const fiscalPartner = config.years[String(year)]?.partner ?? false;
  const [startRows, endRows, txs, assetRows, accountRows, items, household, yearly] = await Promise.all([
    holdingsOn(db, startDay, data),
    holdingsOn(db, endDay, data),
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
  // Interest on cash booked in the first week of January: often December's (see the warning below).
  let januaryInterest = ZERO;
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
        if (isCash && day <= `${year}-01-07`) januaryInterest = januaryInterest.plus(v);
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
  let taxWithheld = ZERO;
  const addTo = (
    cat: Category,
    assetClass: string,
    w: Decimal,
    p: { start: Decimal; end: Decimal; in: Decimal; out: Decimal; direct: Decimal },
    costs: Decimal,
    tax: Decimal,
  ) => {
    const ret = valueChange(p).plus(p.direct).mul(w);
    if (cat === "exempt" || cat === "excluded") {
      leftOut.set(cat, (leftOut.get(cat) ?? ZERO).plus(ret));
      return;
    }
    inScopeCosts = inScopeCosts.plus(costs.mul(w));
    taxWithheld = taxWithheld.plus(tax.mul(w));
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
    const cat = categoryOf(config, { accountId: p.accountId, accountKind: acc.kind, assetClass: a.assetClass }, year);
    addTo(cat, a.assetClass, weight(p.accountId), p, costByPos.get(p) ?? ZERO, taxByPos.get(p) ?? ZERO);
  }

  // Accounts kept as values per year: from this 1 January to the next, plus what came in, went out
  // and was received. A debt only adds the interest paid (repaying it isn't a return).
  const warnings: string[] = [];
  // Interest counts in the year it accrues, but a transaction counts in the year of its date.
  if (januaryInterest.gt(0))
    warnings.push(
      tr(
        "Interest of {amount} was booked in the first week of January {year}. If it's for December, it belongs to {previous}: it counts for {year} here.",
        { amount: num(januaryInterest).toFixed(2), year, previous: year - 1 },
      ),
    );
  let accountDebtInterest = ZERO;
  const property: PropertyYear[] = [];
  const inBox3 = (c: Category) => c !== "exempt" && c !== "excluded";
  // The part of the year the return covers: all of it, or up to today in the running year.
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const yearShare = complete
    ? 1
    : Math.round(
        ((day(endDay) - day(`${year}-01-01`) + 86_400_000) / (day(`${year + 1}-01-01`) - day(`${year}-01-01`))) *
          10_000,
      ) / 10_000;
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
    const next = yearlyValue(acc.kind, byYear?.get(year + 1));
    if (start == null || (next == null && complete)) {
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
    const cat = categoryOf(config, { accountId: acc.id, accountKind: acc.kind, assetClass: cls }, year);
    const income = D(row.incomeEur);
    const tax = taxWithheldAbroad(row);
    // Income credited to the account (what's left after tax withheld abroad) is in its end value:
    // book it as coming in too, as for a reward, so the value change shows the price movement and
    // the income shows once, gross.
    const inEur = D(row.inEur).plus(incomeStaysInAccount(acc.kind) ? income.minus(tax) : ZERO);
    const outEur = D(row.outEur);
    // The running year has no end value yet: the start with what came in and went out since.
    const endOf = (from: Decimal, to: Decimal | null) => to ?? from.plus(inEur).minus(outEur);
    const end = endOf(start, next);
    addTo(cat, cls, w, { start, end, in: inEur, out: outEur, direct: income }, D(row.costsEur), tax);
    if (acc.kind === "property" && inBox3(cat)) {
      // The planned system values a home at its WOZ value, whether it's let or not.
      const woz = D(row.valueEur);
      const nextWoz = byYear?.get(year + 1)?.valueEur;
      // A home that leaves box 3 counts as sold just before it does, at its value then (art. 5.31):
      // the WOZ value with that waardepeildatum is the one of the year after, if it's filled in.
      const leaves = !inBox3(
        categoryOf(config, { accountId: acc.id, accountKind: acc.kind, assetClass: cls }, year + 1),
      );
      const exitWoz = leaves ? (byYear?.get(year + 2)?.valueEur ?? nextWoz) : nextWoz;
      const wozEnd = endOf(woz, exitWoz != null ? D(exitWoz) : null);
      // Sold: held this year and worth nothing on the next 1 January.
      const sold = leaves || (nextWoz != null && D(nextWoz).isZero() && (woz.gt(0) || inEur.gt(0)));
      // For a home held on 1 January 2028 the bill starts from the WOZ value with waardepeildatum
      // 1 January 2028: the WOZ value of 2029 (art. 10a.31). Here, for a home held from its first
      // year, that's the next year's value, so that year's change in WOZ value doesn't count.
      const from = !byYear?.has(year - 1) && woz.gt(0) && !sold ? wozEnd : woz;
      property.push({
        accountId: acc.id,
        returnEur: num(valueChange({ start, end, in: inEur, out: outEur }).plus(income).mul(w)),
        wozEur: num(woz.mul(w)),
        yearShare,
        rentEur: num(income.mul(w)),
        costsEur: num(D(row.costsEur).mul(w)),
        rented: !!row.details?.rented,
        gainEur: num(valueChange({ start: from, end: wozEnd, in: inEur, out: outEur }).mul(w)),
        sold,
      });
    }
  }

  const input = config.years[String(year)];
  const debtInterest = D(input?.debtInterestEur ?? 0).plus(accountDebtInterest);
  const extraReturn = D(input?.extraReturnEur ?? 0);
  let total = extraReturn.minus(debtInterest);
  const outParts = {} as Record<Kind, ReturnPart>;
  for (const [k, p] of Object.entries(parts) as [Kind, ReturnType<typeof emptyPart>][]) {
    const change = valueChange(p);
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
    taxWithheldEur: num(taxWithheld),
    leftOut: [...leftOut.entries()].map(([category, v]) => ({ category, returnEur: num(v) })),
    extraReturnEur: num(extraReturn),
    debtInterestEur: num(debtInterest),
    totalEur: num(total),
    property,
    warnings,
  };
}
