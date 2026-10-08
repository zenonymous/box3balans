import type { ActualReturn } from "./box3Actual.js";

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Tegenbewijsregeling: tax on the actual return (no tax-free allowance, no costs deducted, a negative
 * return counts as zero) against the deemed-return tax. You never pay more than the deemed tax, so
 * the lower one applies; filing is worth it when the actual-return tax is lower.
 */
export function compareWithDeemed(
  actual: ActualReturn,
  deemed: { taxEur: number; benefitEur: number } | null,
  ratePct: number | null,
) {
  if (!deemed || ratePct == null) return null;
  const taxable = Math.max(0, actual.totalEur);
  const actualTax = round2((taxable * ratePct) / 100);
  return {
    deemedBenefitEur: deemed.benefitEur,
    deemedTaxEur: deemed.taxEur,
    actualTaxableEur: round2(taxable),
    actualTaxEur: actualTax,
    lowerTaxEur: Math.min(actualTax, deemed.taxEur),
    savingEur: round2(Math.max(0, deemed.taxEur - actualTax)),
    // Only a finished year can be filed.
    worthFiling: actual.complete && actualTax < deemed.taxEur,
  };
}

export interface FutureParams {
  ratePct: number;
  allowanceEur: number; // heffingsvrij resultaat per taxpayer
  lossThresholdEur: number; // smaller losses don't carry over
  carryBackYears: 0 | 1;
}

/** See docs/box3-sources.md. Neither is law yet, hence everything is editable. */
export const FUTURE_PRESETS: Record<string, FutureParams & { label: string }> = {
  bill: {
    label: "Bill as passed by the Tweede Kamer (12 Feb 2026)",
    ratePct: 36,
    allowanceEur: 1800,
    lossThresholdEur: 500,
    carryBackYears: 0,
  },
  // The letter announcing the novelle names the tax-free amount; tax on sale for financial
  // instruments isn't modelled (issue #11), so this still taxes unrealised gains each year.
  letter: {
    label: "Cabinet letter of 29 Sep 2026: €1,000 tax-free (tax on sale not modelled)",
    ratePct: 36,
    allowanceEur: 1000,
    lossThresholdEur: 500,
    carryBackYears: 0,
  },
};

export interface FutureYearInput {
  year: number;
  complete: boolean;
  actualReturnEur: number; // after debt interest, before costs
  costsEur: number; // deductible under the new system
  partner: boolean;
  deemedTaxEur: number | null; // what the current (deemed-return) system charges
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
  deemedTaxEur: number | null;
  differenceEur: number | null; // new − current; negative = the new system is cheaper
}

/**
 * The planned capital-accrual tax applied to past years in order: each year's actual return minus
 * costs; a loss of at least the threshold carries forward (and back one year, if enabled); earlier
 * losses are set off against the result left after the tax-free amount.
 */
export function simulateFuture(years: FutureYearInput[], p: FutureParams): FutureYearRow[] {
  const rows: FutureYearRow[] = [];
  let balance = 0;
  for (const y of [...years].sort((a, b) => a.year - b.year)) {
    const result = y.actualReturnEur - y.costsEur;
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
      deemedTaxEur: y.deemedTaxEur,
      differenceEur: y.deemedTaxEur == null ? null : round2(tax - y.deemedTaxEur),
    });
  }
  return rows;
}
