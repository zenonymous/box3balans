import type { accountKind, assetClass } from "../db/schema.js";
import { D, Decimal, ZERO } from "../lib/decimal.js";
import { localDay } from "../lib/time.js";
import type { ActualReturn, PropertyYear } from "./box3Actual.js";
import { Ledger, sortTransactions, type LedgerTx, type TxType } from "./ledger.js";

/** To cents, halves away from zero, without float artefacts (Math.round(1.005 * 100) / 100 is 1). */
const round2 = (x: number | Decimal) => D(x).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/**
 * Tegenbewijsregeling: tax on the actual return (no tax-free allowance, no costs deducted, a negative
 * return counts as zero) against the deemed-return tax. You never pay more than the deemed tax, so
 * the lower one applies; filing is worth it when the actual-return tax is lower.
 *
 * The green-investment credit is a heffingskorting on the income tax as a whole, so it applies
 * whichever way box 3 is taxed: it comes off both sides (see docs/box3-sources.md).
 */
export function compareWithDeemed(
  actual: ActualReturn,
  deemed: { netTaxEur: string; benefitEur: string; greenCreditEur: string } | null,
  ratePct: string | null,
) {
  if (!deemed || ratePct == null) return null;
  const taxable = Decimal.max(D(actual.totalEur), 0);
  const credit = D(deemed.greenCreditEur);
  const actualTax = Decimal.max(
    taxable.mul(ratePct).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).minus(credit),
    0,
  );
  const deemedTax = D(deemed.netTaxEur);
  return {
    deemedBenefitEur: round2(D(deemed.benefitEur)),
    deemedTaxEur: round2(deemedTax),
    actualTaxableEur: round2(taxable),
    greenCreditEur: round2(credit),
    actualTaxEur: round2(actualTax),
    lowerTaxEur: round2(Decimal.min(actualTax, deemedTax)),
    savingEur: round2(Decimal.max(deemedTax.minus(actualTax), 0)),
    // Only a finished year can be filed.
    worthFiling: actual.complete && actualTax.lt(deemedTax),
  };
}

export interface FutureParams {
  ratePct: number; // on taxable income up to topRateFromEur per taxpayer
  topRatePct: number; // on the part above it
  topRateFromEur: number; // per taxpayer
  allowanceEur: number; // heffingsvrij resultaat per taxpayer
  lossThresholdEur: number; // smaller losses don't carry over
  carryBackYears: 0 | 1;
  propertyPct: number; // vastgoedbijtelling: a home not let all year counts at least this share of its WOZ value
}

/** See docs/box3-sources.md. Not law yet, hence everything is editable. */
export const FUTURE_PRESETS: Record<string, FutureParams & { label: string }> = {
  bill: {
    // The bill of 12 February 2026 with the novelle and the amendments the Tweede Kamer adopted on
    // 12 November 2026: two rates instead of 36% (amendment 37022 nr. 80, art. 2.13).
    label: "Bill with the novelle, as passed by the Tweede Kamer (12 Nov 2026)",
    ratePct: 35.5,
    topRatePct: 38.5,
    topRateFromEur: 60_000,
    allowanceEur: 1800,
    lossThresholdEur: 500,
    carryBackYears: 0,
    propertyPct: 3.35,
  },
};

export interface FutureYearInput {
  year: number;
  complete: boolean;
  actualReturnEur: number; // after debt interest, before costs
  costsEur: number; // deductible under the new system
  partner: boolean;
  deemedTaxEur: number | null; // what the current (deemed-return) system charges
  property: PropertyYear[]; // homes and other real estate, inside actualReturnEur
}

export interface FutureYearRow {
  year: number;
  complete: boolean;
  resultEur: number; // actual return − costs
  allowanceEur: number;
  lossUsedEur: number; // earlier losses set off this year
  carriedBackEur: number; // this year's taxable income reduced by next year's loss
  taxableEur: number;
  taxEur: number;
  lossBalanceEur: number; // losses still to carry forward after this year
  propertyGainPendingEur: number; // homes' gain since their first value, taxed when they're sold
  deemedTaxEur: number | null;
  differenceEur: number | null; // new − current; negative = the new system is cheaper
}

/** An amount the law gives each taxpayer, for the household: twice it with a fiscal partner. */
const perHousehold = (perTaxpayerEur: number, partner: boolean) => perTaxpayerEur * (partner ? 2 : 1);

/**
 * The tax on a year's taxable income: the rate up to the bracket, the top rate above it. The table
 * is per taxpayer, and fiscal partners divide the income as they like (art. 2.17); an even split
 * keeps the most below the bracket, so partners get a bracket each.
 */
export function taxOnIncome(taxableEur: number, partner: boolean, p: FutureParams): number {
  const bracket = perHousehold(p.topRateFromEur, partner);
  const low = Math.min(taxableEur, bracket);
  const high = Math.max(0, taxableEur - bracket);
  return round2(D(low).mul(p.ratePct).plus(D(high).mul(p.topRatePct)).div(100));
}

/**
 * The planned capital-accrual tax applied to past years in order: each year's actual return minus
 * costs; a loss of at least the threshold carries forward (and back one year, if enabled); earlier
 * losses are set off against the result left after the tax-free amount.
 *
 * Homes and other real estate are taxed on their gain when sold instead (vermogenswinstbelasting),
 * measured from their first value here as the bill measures it from 1 January 2028. Each year
 * their rent counts if they're let all year or the rent is higher, else the vastgoedbijtelling.
 */
export function simulateFuture(years: FutureYearInput[], p: FutureParams): FutureYearRow[] {
  const rows: FutureYearRow[] = [];
  let balance = 0;
  // Per home: its gain so far, until it's sold.
  const gains = new Map<number, Decimal>();
  // Whether the year before had a fiscal partner: a loss carried back is taxed again on its terms.
  let prevPartner = false;
  for (const y of [...years].sort((a, b) => a.year - b.year)) {
    // The homes' actual return makes way for what the bill taxes of them this year.
    let homes = ZERO;
    for (const h of y.property) {
      const gain = (gains.get(h.accountId) ?? ZERO).plus(h.gainEur);
      if (h.sold) gains.delete(h.accountId);
      else gains.set(h.accountId, gain);
      homes = homes.plus(taxedOfHome(h, gain, p.propertyPct)).minus(h.returnEur);
    }
    const result = round2(D(y.actualReturnEur).plus(homes).minus(y.costsEur));
    const allowance = perHousehold(p.allowanceEur, y.partner);
    let taxable = 0;
    let used = 0;
    if (result < 0) {
      let loss = -result >= p.lossThresholdEur ? -result : 0;
      const prev = rows.at(-1);
      if (loss > 0 && p.carryBackYears >= 1 && prev && prev.year === y.year - 1 && prev.taxableEur > 0) {
        const back = Math.min(loss, prev.taxableEur);
        prev.taxableEur = round2(prev.taxableEur - back);
        prev.carriedBackEur = round2(prev.carriedBackEur + back);
        prev.taxEur = taxOnIncome(prev.taxableEur, prevPartner, p);
        prev.differenceEur = prev.deemedTaxEur == null ? null : round2(prev.taxEur - prev.deemedTaxEur);
        loss -= back;
      }
      balance += loss;
    } else {
      const afterAllowance = Math.max(0, result - allowance);
      used = Math.min(balance, afterAllowance);
      balance -= used;
      taxable = afterAllowance - used;
    }
    const tax = taxOnIncome(round2(taxable), y.partner, p);
    rows.push({
      year: y.year,
      complete: y.complete,
      resultEur: round2(result),
      allowanceEur: allowance,
      lossUsedEur: round2(used),
      carriedBackEur: 0,
      taxableEur: round2(taxable),
      taxEur: tax,
      lossBalanceEur: round2(balance),
      propertyGainPendingEur: round2([...gains.values()].reduce((a, b) => a.plus(b), ZERO)),
      deemedTaxEur: y.deemedTaxEur,
      differenceEur: y.deemedTaxEur == null ? null : round2(tax - y.deemedTaxEur),
    });
    prevPartner = y.partner;
  }
  return rows;
}

/**
 * What the bill taxes of a home in a year: its rent if it's let all year or the rent is higher,
 * else the vastgoedbijtelling (for the part of the year passed, in the running year); and in the
 * year it's sold, its gain so far.
 */
function taxedOfHome(h: PropertyYear, gain: Decimal, propertyPct: number) {
  const bijtelling = D(h.wozEur).mul(propertyPct).div(100).mul(h.yearShare);
  const rentCounts = h.rented || D(h.rentEur).gt(bijtelling);
  // Only costs for the rent are deductible (art. 5.38). The home's costs are among the year's,
  // deducted from the result as a whole: with the vastgoedbijtelling they're added back.
  const yearly = rentCounts ? D(h.rentEur) : bijtelling.plus(h.costsEur);
  return h.sold ? yearly.plus(gain) : yearly;
}

/**
 * Whether a holding is a financial instrument, taxed on its capital gain in the preview from 2029
 * (ADR 0013): shares and funds wherever they're held, and at a broker everything but cash, so
 * crypto and precious metal only there, as an ETP or ETC.
 */
export function isFinancialInstrument(h: {
  accountKind: (typeof accountKind.enumValues)[number];
  assetClass: (typeof assetClass.enumValues)[number];
}): boolean {
  if (h.assetClass === "stock" || h.assetClass === "etf") return true;
  return h.accountKind === "broker" && h.assetClass !== "cash";
}

export interface GainAssetRow {
  assetId: number;
  quantity: number; // held at the end of the year
  acquisitionEur: number; // the acquisition price of all of them together (the average × quantity)
  gainEur: number; // capital gain on what was sold this year
  regularBenefitsEur: number; // dividend, interest and other rewards, gross
}

export interface GainYearRow {
  year: number;
  gainEur: number;
  regularBenefitsEur: number;
  assets: GainAssetRow[];
}

export interface CapitalGains {
  years: GainYearRow[];
  /** Held at the start without a value then: left out altogether, not counted as bought for €0. */
  missingStartValue: number[];
  warnings: string[];
}

/** The one "account" all of an owner's accounts are collapsed into: one average per asset. */
const OWNER = 0;
const TAKES: ReadonlySet<TxType> = new Set(["sell", "withdrawal", "fee", "transfer_out"]);

/**
 * A partner's share of a transaction on a joint account (ADR 0013): that share of the units and of
 * every amount, at the same price. A split's quantity is a ratio and stays whole.
 */
export function ownerShare<T extends LedgerTx>(tx: T, fraction: Decimal.Value): T {
  const part = (v: string) => D(v).mul(fraction).toFixed();
  return {
    ...tx,
    quantity: tx.type === "split" ? tx.quantity : part(tx.quantity),
    feeEur: part(tx.feeEur),
    amount: part(tx.amount),
    taxWithheld: part(tx.taxWithheld),
  };
}

/**
 * The capital gain (vermogenswinst) on financial instruments as the novelle proposes it, for one
 * owner (ADR 0013). `txs` are the owner's transactions in financial instruments, a joint account's
 * by the owner's share (ownerShare).
 *
 * - What the owner held on 1 January of `start` counts at its value then (`startPrices`, in euros
 *   per unit), whatever was paid for it. Costs and income before the start play no part.
 * - After that every asset has one average acquisition price over all the owner's accounts: the
 *   ledger's average method, with the accounts collapsed into one. Moving units between the
 *   owner's own accounts changes nothing.
 * - A sale's gain is its proceeds minus the costs of selling, minus the acquisition price of the
 *   part sold, which includes the costs of buying (art. 5.22 and 5.23). Whoever adds these gains to
 *   a year's result must leave those buying and selling costs out of the year's deductible costs,
 *   or they count twice.
 * - Regular benefits (dividend, interest and other rewards) count gross, every year. Units received
 *   as a reward come in at their value then.
 * - Units that leave without a sale (a withdrawal, or sent to someone else) take their acquisition
 *   price with them, with no gain. Units used up as a fee are a cost, not a capital loss.
 *
 * Rows are given for `from` (default: `start`) to `to`.
 */
export function capitalGains(
  txs: LedgerTx[],
  opts: { start: number; to: number; from?: number; startPrices: ReadonlyMap<number, string> },
): CapitalGains {
  const yearOf = (tx: LedgerTx) => Number(localDay(tx.occurredAt).slice(0, 4));
  // A transfer with both legs here is between the owner's own accounts: nothing happens. Cash isn't
  // a financial instrument, so the cash side of a trade (settleAssetId) is left out.
  const legs = new Map<string, Set<TxType>>();
  for (const t of txs)
    if (t.transferGroup) legs.set(t.transferGroup, (legs.get(t.transferGroup) ?? new Set()).add(t.type));
  const ownTransfer = (t: LedgerTx) =>
    !!t.transferGroup &&
    legs.get(t.transferGroup)!.has("transfer_in") &&
    legs.get(t.transferGroup)!.has("transfer_out");
  const own = sortTransactions(txs)
    .filter((t) => !ownTransfer(t))
    .map((t) => ({ ...t, accountId: OWNER, settleAssetId: null }));

  // What's held at the start, at its value then.
  const before = new Ledger("average");
  for (const t of own) if (yearOf(t) < opts.start) before.apply(t);
  const ledger = new Ledger("average");
  const missingStartValue: number[] = [];
  for (const p of before.positions.values()) {
    if (p.quantity.lte(0)) continue;
    const price = opts.startPrices.get(p.assetId);
    if (price === undefined) {
      missingStartValue.push(p.assetId);
      continue;
    }
    ledger.apply({
      id: -p.assetId,
      accountId: OWNER,
      assetId: p.assetId,
      type: "deposit",
      occurredAt: new Date(Date.UTC(opts.start, 0, 1)),
      quantity: p.quantity.toFixed(),
      price,
      fxRate: "1",
      feeEur: "0",
      amount: "0",
      taxWithheld: "0",
      transferGroup: null,
    });
  }
  const leftOut = new Set(missingStartValue);
  const warnings: string[] = [];

  const years: GainYearRow[] = [];
  for (let year = opts.start; year <= opts.to; year++) {
    const [salesSeen, incomeSeen] = [ledger.realized.length, ledger.income.length];
    for (const t of own) {
      if (yearOf(t) !== year || leftOut.has(t.assetId)) continue;
      const held = ledger.position(OWNER, t.assetId).quantity;
      if (TAKES.has(t.type) && D(t.quantity).gt(held)) {
        // More than is held: an earlier purchase is missing. Only what's held can be sold; a
        // negative holding would spoil the average for every year after.
        warnings.push(
          `Transaction ${t.id}: ${t.type} of ${D(t.quantity).toFixed()} exceeds holding of ${held.toFixed()} (asset ${t.assetId}); only the part held is counted`,
        );
        if (held.gt(0)) ledger.apply({ ...t, quantity: held.toFixed() });
        continue;
      }
      ledger.apply(t);
    }
    if (year < (opts.from ?? opts.start)) continue;

    const gain = new Map<number, Decimal>();
    const regular = new Map<number, Decimal>();
    const add = (m: Map<number, Decimal>, id: number, v: Decimal) => m.set(id, (m.get(id) ?? ZERO).plus(v));
    for (const r of ledger.realized.slice(salesSeen)) if (r.kind === "sale") add(gain, r.assetId, r.gainEur);
    for (const i of ledger.income.slice(incomeSeen)) add(regular, i.assetId, i.grossEur);
    const assets: GainAssetRow[] = [...ledger.positions.values()]
      .filter((p) => p.quantity.gt(0) || gain.has(p.assetId) || regular.has(p.assetId))
      .sort((a, b) => a.assetId - b.assetId)
      .map((p) => ({
        assetId: p.assetId,
        quantity: p.quantity.toNumber(),
        acquisitionEur: round2(p.costEur),
        gainEur: round2(gain.get(p.assetId) ?? ZERO),
        regularBenefitsEur: round2(regular.get(p.assetId) ?? ZERO),
      }));
    years.push({
      year,
      gainEur: round2(assets.reduce((s, a) => s.plus(a.gainEur), ZERO)),
      regularBenefitsEur: round2(assets.reduce((s, a) => s.plus(a.regularBenefitsEur), ZERO)),
      assets,
    });
  }
  return {
    years,
    missingStartValue: missingStartValue.sort((a, b) => a - b),
    warnings: [...warnings, ...ledger.warnings],
  };
}
