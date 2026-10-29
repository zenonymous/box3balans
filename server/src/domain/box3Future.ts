import { D, Decimal } from "../lib/decimal.js";
import type { ActualReturn, PropertyYear } from "./box3Actual.js";

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
  ratePct: number;
  allowanceEur: number; // heffingsvrij resultaat per taxpayer
  lossThresholdEur: number; // smaller losses don't carry over
  carryBackYears: 0 | 1;
  propertyPct: number; // vastgoedbijtelling: a home not let counts at this share of its WOZ value
}

/** See docs/box3-sources.md. Neither is law yet, hence everything is editable. */
export const FUTURE_PRESETS: Record<string, FutureParams & { label: string }> = {
  bill: {
    label: "Bill as passed by the Tweede Kamer (12 Feb 2026)",
    ratePct: 36,
    allowanceEur: 1800,
    lossThresholdEur: 500,
    carryBackYears: 0,
    propertyPct: 3.35,
  },
  // The letter announcing the novelle names the tax-free amount; tax on sale for financial
  // instruments isn't modelled (issue #11), so this still taxes their unrealised gains each year.
  letter: {
    label: "Cabinet letter of 29 Sep 2026: €1,000 tax-free (tax on selling investments not modelled)",
    ratePct: 36,
    allowanceEur: 1000,
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
  propertyPendingEur: number; // homes' value change since their first value, taxed when they're sold
  deemedTaxEur: number | null;
  differenceEur: number | null; // new − current; negative = the new system is cheaper
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
  const pending = new Map<number, number>();
  for (const y of [...years].sort((a, b) => a.year - b.year)) {
    // The homes' actual return makes way for what the bill taxes of them this year.
    let property = 0;
    for (const h of y.property) {
      const gain = (pending.get(h.accountId) ?? 0) + h.gainEur;
      if (h.sold) pending.delete(h.accountId);
      else pending.set(h.accountId, gain);
      const fixed = (h.wozEur * p.propertyPct) / 100;
      property += (h.let ? h.rentEur : Math.max(h.rentEur, fixed)) + (h.sold ? gain : 0) - h.returnEur;
    }
    const result = y.actualReturnEur + property - y.costsEur;
    const allowance = p.allowanceEur * (y.partner ? 2 : 1);
    let taxable = 0;
    let used = 0;
    if (result < 0) {
      let loss = -result >= p.lossThresholdEur ? -result : 0;
      const prev = rows.at(-1);
      if (loss > 0 && p.carryBackYears >= 1 && prev && prev.year === y.year - 1 && prev.taxableEur > 0) {
        const back = Math.min(loss, prev.taxableEur);
        prev.taxableEur = round2(prev.taxableEur - back);
        prev.carriedBackEur = round2(prev.carriedBackEur + back);
        prev.taxEur = round2((prev.taxableEur * p.ratePct) / 100);
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
    const tax = round2((taxable * p.ratePct) / 100);
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
      propertyPendingEur: round2([...pending.values()].reduce((a, b) => a + b, 0)),
      deemedTaxEur: y.deemedTaxEur,
      differenceEur: y.deemedTaxEur == null ? null : round2(tax - y.deemedTaxEur),
    });
  }
  return rows;
}
