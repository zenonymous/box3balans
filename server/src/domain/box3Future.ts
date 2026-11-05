import { D, Decimal, ZERO } from "../lib/decimal.js";
import { localDay } from "../lib/time.js";
import type { ActualReturn, PropertyYear } from "./box3Actual.js";
import { replayLedger, sortTransactions, type LedgerTx } from "./ledger.js";

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
  propertyPct: number; // vastgoedbijtelling: a home not let all year counts at least this share of its WOZ value
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
  propertyGainPendingEur: number; // homes' gain since their first value, taxed when they're sold
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
  // Per home: its gain so far, until it's sold.
  const gains = new Map<number, Decimal>();
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
      propertyGainPendingEur: round2([...gains.values()].reduce((a, b) => a.plus(b), ZERO)),
      deemedTaxEur: y.deemedTaxEur,
      differenceEur: y.deemedTaxEur == null ? null : round2(tax - y.deemedTaxEur),
    });
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

export interface GainAssetRow {
  assetId: number;
  quantity: number; // held at the end of the year
  acquisitionPriceEur: number; // per unit: the average acquisition price at the end of the year
  gainEur: number; // capital gain on what was sold this year
  regularEur: number; // regular benefits: dividend and interest, gross
}

export interface GainYearRow {
  year: number;
  gainEur: number;
  regularEur: number;
  assets: GainAssetRow[];
}

/**
 * The capital gain (vermogenswinst) on financial instruments as the novelle proposes it, for one
 * owner (ADR 0013). What the owner already held at the start counts at its value then
 * (`startPrices`, per unit); after that, every asset has one average acquisition price across all
 * the owner's accounts. A sale's gain is its proceeds minus that price of the part sold. Regular
 * benefits count gross, every year. `txs` are the owner's transactions in financial instruments.
 */
export function capitalGains(
  txs: LedgerTx[],
  opts: { from: number; to: number; startPrices: ReadonlyMap<number, string> },
): GainYearRow[] {
  const yearOf = (tx: LedgerTx) => Number(localDay(tx.occurredAt).slice(0, 4));
  const sorted = sortTransactions(txs);
  const held = new Map<number, { qty: Decimal; costEur: Decimal }>();
  for (const p of replayLedger(sorted.filter((t) => yearOf(t) < opts.from)).positions) {
    if (p.quantity.lte(0)) continue;
    const h = held.get(p.assetId) ?? { qty: ZERO, costEur: ZERO };
    h.qty = h.qty.plus(p.quantity);
    held.set(p.assetId, h);
  }
  for (const [assetId, h] of held) h.costEur = h.qty.mul(D(opts.startPrices.get(assetId) ?? "0"));

  const rows: GainYearRow[] = [];
  for (let year = opts.from; year <= opts.to; year++) {
    const gain = new Map<number, Decimal>();
    const regular = new Map<number, Decimal>();
    const add = (m: Map<number, Decimal>, id: number, v: Decimal) => m.set(id, (m.get(id) ?? ZERO).plus(v));
    for (const tx of sorted.filter((t) => yearOf(t) === year)) {
      const h = held.get(tx.assetId) ?? { qty: ZERO, costEur: ZERO };
      held.set(tx.assetId, h);
      const q = D(tx.quantity);
      const valueEur = q.mul(D(tx.price)).mul(D(tx.fxRate));
      switch (tx.type) {
        case "buy":
          h.qty = h.qty.plus(q);
          h.costEur = h.costEur.plus(valueEur);
          break;
        case "sell": {
          const cost = h.qty.isZero() ? ZERO : h.costEur.mul(q).div(h.qty);
          h.qty = h.qty.minus(q);
          h.costEur = h.costEur.minus(cost);
          add(gain, tx.assetId, valueEur.minus(cost));
          break;
        }
        case "dividend":
          add(regular, tx.assetId, D(tx.amount).mul(D(tx.fxRate)));
          break;
        case "split":
          // Same acquisition price in total, over more (or fewer) units.
          if (q.gt(0)) h.qty = h.qty.mul(q);
          break;
      }
    }
    const assets: GainAssetRow[] = [...held]
      .filter(([id, h]) => h.qty.gt(0) || gain.has(id) || regular.has(id))
      .sort(([a], [b]) => a - b)
      .map(([assetId, h]) => ({
        assetId,
        quantity: h.qty.toNumber(),
        acquisitionPriceEur: h.qty.isZero() ? 0 : round2(h.costEur.div(h.qty)),
        gainEur: round2(gain.get(assetId) ?? ZERO),
        regularEur: round2(regular.get(assetId) ?? ZERO),
      }));
    rows.push({
      year,
      gainEur: round2(assets.reduce((s, a) => s.plus(a.gainEur), ZERO)),
      regularEur: round2(assets.reduce((s, a) => s.plus(a.regularEur), ZERO)),
      assets,
    });
  }
  return rows;
}
