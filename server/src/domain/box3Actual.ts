import { and, asc, gte, inArray, lt, lte } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, metalItems, priceHistory, transactions } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { D, Decimal, ZERO } from "../lib/decimal.js";
import { fromLocal, localDay, localToday } from "../lib/time.js";
import { type Box3Config, type Category, categoryOf } from "./box3.js";
import { attribute, loadHousehold } from "./household.js";
import { type HoldingOn, LedgerData, holdingsOn } from "./valuation.js";
import {
  type AccountYear,
  incomeStaysInAccount,
  loadYearly,
  taxWithheldAbroad,
  yearlyClass,
  yearlyValue,
} from "./yearly.js";
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
type Part = ReturnType<typeof emptyPart>;
// A part with the costs spent on it and the tax withheld on its income: what Totals adds up.
type Counted = Part & { costs: Decimal; taxWithheld: Decimal };
// What a value did over the year, apart from what came in and went out.
const valueChange = (p: { start: Decimal; end: Decimal; in: Decimal; out: Decimal }) =>
  p.end.minus(p.start).minus(p.in).plus(p.out);
// Green investments (exempt) and accounts outside box 3: left out of the return.
const outsideBox3 = (c: Category): c is "exempt" | "excluded" => c === "exempt" || c === "excluded";

type Account = typeof accounts.$inferSelect;
type Asset = typeof assets.$inferSelect;
type Tx = typeof transactions.$inferSelect;
type MetalItem = typeof metalItems.$inferSelect;

/**
 * The actual box 3 return of one calendar year, per the tegenbewijsregeling: direct return plus all
 * value changes (realised or not) of everything held during the year, without deducting costs,
 * minus interest paid on debts. Computed per holding (account × asset): a buy paid from the
 * account's cash moves value between holdings, so it's neither return nor cost.
 */
export async function actualReturn(
  db: DB,
  year: number,
  config: Box3Config,
  data = new LedgerData(db),
): Promise<ActualReturn> {
  const period = periodOf(year);
  const [startRows, endRows, txs, assetRows, accountRows, items, household, yearly] = await Promise.all([
    holdingsOn(db, period.startDay, data),
    holdingsOn(db, period.endDay, data),
    db
      .select()
      .from(transactions)
      .where(and(gte(transactions.occurredAt, period.from), lt(transactions.occurredAt, period.until)))
      .orderBy(asc(transactions.occurredAt)),
    db.select().from(assets),
    db.select().from(accounts),
    db.select().from(metalItems),
    loadHousehold(db),
    loadYearly(db),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const fiscalPartner = config.years[String(year)]?.partner ?? false;
  // The part of each account that counts for you and your fiscal partner (owner, children).
  const weight = (accountId: number) => {
    const acc = accountById.get(accountId);
    if (!acc) return D(1);
    const a = attribute(acc, household, year, fiscalPartner);
    return a.self.plus(a.partner);
  };

  const closeOn = await closingPrices(db, [...new Set(txs.map((t) => t.assetId))], period);
  const ledger = ledgerHoldings({ period, startRows, endRows, txs, assetById, items, closeOn });
  const totals = new Totals();
  addLedgerHoldings({ holdings: ledger.holdings, accountById, assetById, config, year, weight, totals });
  const warnings: string[] = [];
  // Interest counts in the year it accrues, but a transaction counts in the year of its date.
  if (ledger.januaryInterest.gt(0))
    warnings.push(
      tr(
        "Interest of {amount} was booked in the first week of January {year}. If it's for December, it belongs to {previous}: it counts for {year} here.",
        { amount: num(ledger.januaryInterest).toFixed(2), year, previous: year - 1 },
      ),
    );
  const perYear = addYearlyAccounts({ accountRows, yearly, config, period, weight, totals, warnings });

  const input = config.years[String(year)];
  const debtInterest = D(input?.debtInterestEur ?? 0).plus(perYear.debtInterest);
  const extraReturn = D(input?.extraReturnEur ?? 0);
  const { parts, total } = totals.summary(extraReturn.minus(debtInterest));
  return {
    year,
    complete: period.complete,
    endDay: period.endDay,
    parts,
    costsEur: num(totals.inScopeCosts),
    taxWithheldEur: num(totals.taxWithheld),
    leftOut: [...totals.leftOut.entries()].map(([category, v]) => ({ category, returnEur: num(v) })),
    extraReturnEur: num(extraReturn),
    debtInterestEur: num(debtInterest),
    totalEur: num(total),
    property: perYear.property,
    warnings,
  };
}

/** The days the return covers: the whole year, or up to today in the running year. */
function periodOf(year: number) {
  const today = localToday();
  const complete = `${year}-12-31` < today;
  const endDay = complete ? `${year}-12-31` : today;
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return {
    year,
    complete,
    endDay,
    startDay: `${year - 1}-12-31`,
    from: fromLocal(year, 1, 1, 0, 0, 0),
    until: complete ? fromLocal(year + 1, 1, 1, 0, 0, 0) : new Date(),
    // The part of the year covered: less than 1 in the running year.
    yearShare: complete
      ? 1
      : Math.round(
          ((day(endDay) - day(`${year}-01-01`) + 86_400_000) / (day(`${year + 1}-01-01`) - day(`${year}-01-01`))) *
            10_000,
        ) / 10_000,
  };
}
type Period = ReturnType<typeof periodOf>;

/** Market values for assets moving in or out without a price (deposits, transfers, fees). */
async function closingPrices(db: DB, assetIds: number[], period: Period) {
  const closes = new Map<number, { day: string; eur: Decimal }[]>();
  if (assetIds.length) {
    const rows = await db
      .select({ assetId: priceHistory.assetId, day: priceHistory.day, closeEur: priceHistory.closeEur })
      .from(priceHistory)
      .where(
        and(
          inArray(priceHistory.assetId, assetIds),
          gte(priceHistory.day, `${period.year - 1}-12-20`),
          lte(priceHistory.day, period.endDay),
        ),
      )
      .orderBy(asc(priceHistory.day));
    for (const r of rows) closes.set(r.assetId, [...(closes.get(r.assetId) ?? []), { day: r.day, eur: D(r.closeEur) }]);
  }
  // The last close on or before the day.
  return (assetId: number, day: string): Decimal | null => {
    let found: Decimal | null = null;
    for (const c of closes.get(assetId) ?? []) {
      if (c.day > day) break;
      found = c.eur;
    }
    return found;
  };
}

type Holding = Counted & { accountId: number; assetId: number; physical: boolean };

/**
 * Each holding's value at the start and end of the year, what came in and went out during it, its
 * income, the fees spent on it and the tax withheld on its dividends.
 */
function ledgerHoldings(args: {
  period: Period;
  startRows: HoldingOn[];
  endRows: HoldingOn[];
  txs: Tx[];
  assetById: Map<number, Asset>;
  items: MetalItem[];
  closeOn: (assetId: number, day: string) => Decimal | null;
}) {
  const { period, assetById, closeOn } = args;
  const { year, endDay } = period;
  const holdings = new Map<string, Holding>();
  const holding = (accountId: number, assetId: number, physical = false) => {
    const k = `${accountId}|${assetId}|${physical ? "p" : "l"}`;
    let h = holdings.get(k);
    if (!h) {
      h = { ...emptyPart(), costs: ZERO, taxWithheld: ZERO, accountId, assetId, physical };
      holdings.set(k, h);
    }
    return h;
  };
  for (const r of args.startRows) holding(r.accountId, r.assetId, r.physical).start = r.valueEur;
  for (const r of args.endRows) holding(r.accountId, r.assetId, r.physical).end = r.valueEur;

  // Interest on cash booked in the first week of January: often December's (see the warning).
  let januaryInterest = ZERO;
  for (const t of args.txs) {
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
    const h = holding(t.accountId, t.assetId);
    const cash = t.settleAssetId ? holding(t.accountId, t.settleAssetId) : null;
    switch (t.type) {
      case "buy":
        h.in = h.in.plus(gross);
        if (cash) cash.out = cash.out.plus(gross).plus(fee);
        if (fee.gt(0)) h.costs = h.costs.plus(fee);
        break;
      case "sell":
        h.out = h.out.plus(gross);
        if (cash) cash.in = cash.in.plus(gross).minus(fee);
        if (fee.gt(0)) h.costs = h.costs.plus(fee);
        break;
      case "deposit":
      case "transfer_in":
        h.in = h.in.plus(market);
        break;
      case "withdrawal":
      case "transfer_out":
        h.out = h.out.plus(market);
        if (fee.gt(0)) h.costs = h.costs.plus(fee);
        break;
      case "dividend": {
        const g = D(t.amount).mul(fx);
        const withheld = D(t.taxWithheld).mul(fx);
        h.direct = h.direct.plus(g);
        h.taxWithheld = h.taxWithheld.plus(withheld);
        if (cash) cash.in = cash.in.plus(g.minus(withheld));
        break;
      }
      case "reward": {
        // Interest on cash counts at its amount; staking rewards at the value they were booked at.
        const v = isCash ? q.mul(fx) : gross;
        if (isCash && day <= `${year}-01-07`) januaryInterest = januaryInterest.plus(v);
        h.direct = h.direct.plus(v);
        h.in = h.in.plus(v);
        break;
      }
      case "fee":
        // Units given up as a fee left the holding; costs aren't deducted, so it's an outflow.
        h.out = h.out.plus(market);
        h.costs = h.costs.plus(market);
        break;
    }
  }

  // Physical metal: bought or sold during the year.
  const metalAsset = new Map(
    [...assetById.values()].filter((a) => a.priceSource === "metal").map((a) => [a.priceRef, a.id]),
  );
  for (const it of args.items) {
    const id = metalAsset.get(METAL_CODES[it.metal]);
    if (!id) continue;
    if (it.purchaseDate >= `${year}-01-01` && it.purchaseDate <= endDay) {
      const h = holding(it.accountId, id, true);
      h.in = h.in.plus(it.purchasePriceEur);
    }
    if (it.soldDate && it.salePriceEur && it.soldDate >= `${year}-01-01` && it.soldDate <= endDay) {
      const h = holding(it.accountId, id, true);
      h.out = h.out.plus(it.salePriceEur);
    }
  }
  return { holdings: [...holdings.values()], januaryInterest };
}

/** Adds the holdings of accounts with transactions to the totals, each in its category. */
function addLedgerHoldings(args: {
  holdings: Holding[];
  accountById: Map<number, Account>;
  assetById: Map<number, Asset>;
  config: Box3Config;
  year: number;
  weight: (accountId: number) => Decimal;
  totals: Totals;
}) {
  for (const h of args.holdings) {
    const acc = args.accountById.get(h.accountId);
    const a = args.assetById.get(h.assetId);
    if (!acc || !a || acc.tracking === "yearly") continue;
    const cat = categoryOf(
      args.config,
      { accountId: h.accountId, accountKind: acc.kind, assetClass: a.assetClass },
      args.year,
    );
    args.totals.add(cat, a.assetClass, args.weight(h.accountId), h);
  }
}

const KINDS: Kind[] = ["bank", "investments", "crypto", "metals", "cash", "other"];

/** Where a holding's return goes, as the Opgaaf werkelijk rendement groups it. */
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

/** The year's return added up per part, with what's left out, the costs and the tax withheld. */
class Totals {
  readonly parts = Object.fromEntries(KINDS.map((k) => [k, emptyPart()])) as Record<Kind, Part>;
  readonly leftOut = new Map<"exempt" | "excluded", Decimal>();
  // Of what counts in box 3 only.
  inScopeCosts = ZERO;
  taxWithheld = ZERO;

  /** Adds the household's share (`w`) of a holding or an account kept as values per year. */
  add(cat: Category, assetClass: string, w: Decimal, c: Counted) {
    if (outsideBox3(cat)) {
      const ret = valueChange(c).plus(c.direct).mul(w);
      this.leftOut.set(cat, (this.leftOut.get(cat) ?? ZERO).plus(ret));
      return;
    }
    this.inScopeCosts = this.inScopeCosts.plus(c.costs.mul(w));
    this.taxWithheld = this.taxWithheld.plus(c.taxWithheld.mul(w));
    const part = this.parts[kindOf(cat, assetClass)];
    part.start = part.start.plus(c.start.mul(w));
    part.end = part.end.plus(c.end.mul(w));
    part.in = part.in.plus(c.in.mul(w));
    part.out = part.out.plus(c.out.mul(w));
    part.direct = part.direct.plus(c.direct.mul(w));
  }

  /** Each part's figures, and the total with `otherReturn` (extra return minus debt interest). */
  summary(otherReturn: Decimal) {
    let total = otherReturn;
    const parts = {} as Record<Kind, ReturnPart>;
    for (const k of KINDS) {
      const p = this.parts[k];
      const change = valueChange(p);
      total = total.plus(change).plus(p.direct);
      parts[k] = {
        startEur: num(p.start),
        endEur: num(p.end),
        inEur: num(p.in),
        outEur: num(p.out),
        valueChangeEur: num(change),
        directEur: num(p.direct),
        returnEur: num(change.plus(p.direct)),
      };
    }
    return { parts, total };
  }
}

/**
 * Adds the accounts kept as values per year to the totals: from this 1 January to the next, plus
 * what came in, went out and was received; and a warning for each that misses a value. Returns the
 * interest paid on debts (repaying one isn't a return) and the homes' figures for the 2028 preview.
 */
function addYearlyAccounts(args: {
  accountRows: Account[];
  yearly: Map<number, Map<number, AccountYear>>;
  config: Box3Config;
  period: Period;
  weight: (accountId: number) => Decimal;
  totals: Totals;
  warnings: string[];
}) {
  const { config, period, totals, warnings } = args;
  const { year } = period;
  let debtInterest = ZERO;
  const property: PropertyYear[] = [];
  for (const acc of args.accountRows) {
    if (acc.tracking !== "yearly") continue;
    const byYear = args.yearly.get(acc.id);
    const row = byYear?.get(year);
    if (!byYear || !row) continue;
    const w = args.weight(acc.id);
    if (acc.kind === "debt") {
      debtInterest = debtInterest.plus(D(row.incomeEur).mul(w));
      continue;
    }
    const start = yearlyValue(acc.kind, row);
    const next = yearlyValue(acc.kind, byYear.get(year + 1));
    if (start == null || (next == null && period.complete)) {
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
    const figures = {
      start,
      end: endValue(start, next, inEur, outEur),
      in: inEur,
      out: outEur,
      direct: income,
      costs: D(row.costsEur),
      taxWithheld: tax,
    };
    totals.add(cat, cls, w, figures);
    if (acc.kind === "property" && !outsideBox3(cat))
      property.push(propertyYear({ acc, cls, row, byYear, config, figures, w, yearShare: period.yearShare }));
  }
  return { debtInterest, property };
}

// The value on the next 1 January; the running year has none yet: the start with what came in and
// went out since.
const endValue = (start: Decimal, next: Decimal | null, inEur: Decimal, outEur: Decimal) =>
  next ?? start.plus(inEur).minus(outEur);

/** A home or other real estate's year as the planned system (from 2028) sees it: see PropertyYear. */
function propertyYear(args: {
  acc: Account;
  cls: ReturnType<typeof yearlyClass>;
  row: AccountYear;
  byYear: Map<number, AccountYear>;
  config: Box3Config;
  figures: Counted; // as in the actual return, with the leegwaarderatio
  w: Decimal;
  yearShare: number;
}): PropertyYear {
  const { acc, row, byYear, figures, w } = args;
  const year = row.year;
  // The planned system values a home at its WOZ value, whether it's let or not.
  const woz = D(row.valueEur);
  const nextWoz = byYear.get(year + 1)?.valueEur;
  // A home that leaves box 3 counts as sold just before it does, at its value then (art. 5.31):
  // the WOZ value with that waardepeildatum is the one of the year after, if it's filled in.
  const leaves = outsideBox3(
    categoryOf(args.config, { accountId: acc.id, accountKind: acc.kind, assetClass: args.cls }, year + 1),
  );
  // A 0 there means it was sold since, as your own home say: then the next year's value.
  const later = leaves ? byYear.get(year + 2)?.valueEur : null;
  const exitWoz = later != null && D(later).gt(0) ? later : nextWoz;
  const wozEnd = endValue(woz, exitWoz != null ? D(exitWoz) : null, figures.in, figures.out);
  // Sold: held this year and worth nothing on the next 1 January.
  const sold = leaves || (nextWoz != null && D(nextWoz).isZero() && (woz.gt(0) || figures.in.gt(0)));
  // For a home held on 1 January 2028 the bill starts from the WOZ value with waardepeildatum
  // 1 January 2028: the WOZ value of 2029 (art. 10a.31). Here, for a home held from its first
  // year, that's the next year's value, so that year's change in WOZ value doesn't count.
  const from = !byYear.has(year - 1) && woz.gt(0) && !sold ? wozEnd : woz;
  return {
    accountId: acc.id,
    returnEur: num(valueChange(figures).plus(figures.direct).mul(w)),
    wozEur: num(woz.mul(w)),
    yearShare: args.yearShare,
    rentEur: num(figures.direct.mul(w)),
    costsEur: num(figures.costs.mul(w)),
    rented: !!row.details?.rented,
    gainEur: num(valueChange({ start: from, end: wozEnd, in: figures.in, out: figures.out }).mul(w)),
    sold,
  };
}
