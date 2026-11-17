import type { DB } from "../db/client.js";
import { D, Decimal, ZERO } from "../lib/decimal.js";
import { tr } from "../i18n/index.js";
import { type Box3Config, categoryOf } from "./box3.js";
import { capitalGains, isFinancialInstrument, ownerShare } from "./box3Future.js";
import { attribute, loadHousehold } from "./household.js";
import type { LedgerTx } from "./ledger.js";
import { LedgerData, holdingsOn } from "./valuation.js";

export interface HouseholdGainsYear {
  gainEur: number;
  regularBenefitsEur: number;
}

/**
 * The capital gain on financial instruments and their regular benefits per year, for you and your
 * fiscal partner together, as the novelle would tax them (ADR 0013). Each of you has your own
 * average acquisition price over your own accounts and your share of joint ones. The preview starts
 * in `start`: what's held on 1 January of that year counts at its value then, as holdings will on
 * 1 January 2029.
 *
 * Simplifications: whose an account is comes from the last year with box 3 settings (whether there's
 * a fiscal partner), and whether it counts in box 3 from `to`, the last year shown; accounts kept as
 * values per year have no sales and stay on their yearly change.
 */
export async function householdGains(
  db: DB,
  config: Box3Config,
  range: { start: number; to: number },
  data = new LedgerData(db),
): Promise<{ years: Map<number, HouseholdGainsYear>; warnings: string[] }> {
  const [{ txRows, assetRows, accountRows }, household, startHoldings] = await Promise.all([
    data.load(),
    loadHousehold(db),
    holdingsOn(db, `${range.start - 1}-12-31`, data),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  // The running year often has no settings yet: the last year that has them says whether there's a
  // fiscal partner.
  const set = Object.keys(config.years)
    .map(Number)
    .filter((y) => y <= range.to)
    .sort((a, b) => b - a)[0];
  const fiscalPartner = set != null && (config.years[String(set)]?.partner ?? false);

  // Which accounts' assets are financial instruments in box 3, and each partner's share of them.
  const counts = (accountId: number, assetId: number) => {
    const acc = accountById.get(accountId);
    const a = assetById.get(assetId);
    if (!acc || !a || a.hidden || acc.tracking === "yearly") return false;
    if (!isFinancialInstrument({ accountKind: acc.kind, assetClass: a.assetClass })) return false;
    const cat = categoryOf(config, { accountId, accountKind: acc.kind, assetClass: a.assetClass }, range.to);
    return cat !== "exempt" && cat !== "excluded";
  };
  const shares = new Map(
    accountRows.map((acc) => [acc.id, attribute(acc, household, set ?? range.to, fiscalPartner)] as const),
  );

  // The value on 1 January of the start, per unit.
  const startValue = new Map<number, { qty: Decimal; eur: Decimal }>();
  for (const h of startHoldings) {
    if (h.physical || h.priceEur == null || !counts(h.accountId, h.assetId)) continue;
    const v = startValue.get(h.assetId) ?? { qty: ZERO, eur: ZERO };
    startValue.set(h.assetId, { qty: v.qty.plus(h.quantity), eur: v.eur.plus(h.quantity.mul(h.priceEur)) });
  }
  const startPrices = new Map(
    [...startValue].filter(([, v]) => v.qty.gt(0)).map(([id, v]) => [id, v.eur.div(v.qty).toFixed()] as const),
  );

  const years = new Map<number, HouseholdGainsYear>();
  for (let y = range.start; y <= range.to; y++) years.set(y, { gainEur: 0, regularBenefitsEur: 0 });
  const warnings: string[] = [];
  const missing = new Set<number>();
  for (const owner of ["self", "partner"] as const) {
    const txs: LedgerTx[] = [];
    for (const tx of txRows) {
      if (!counts(tx.accountId, tx.assetId)) continue;
      const share = shares.get(tx.accountId)?.[owner] ?? ZERO;
      if (share.gt(0)) txs.push(share.eq(1) ? tx : ownerShare(tx, share));
    }
    if (!txs.length) continue;
    const result = capitalGains(txs, { start: range.start, to: range.to, startPrices });
    for (const r of result.years) {
      const y = years.get(r.year)!;
      y.gainEur = D(y.gainEur).plus(r.gainEur).toNumber();
      y.regularBenefitsEur = D(y.regularBenefitsEur).plus(r.regularBenefitsEur).toNumber();
    }
    for (const id of result.missingStartValue) missing.add(id);
    if (result.warnings.length)
      warnings.push(
        tr(
          "Some investments were sold or sent away before they were bought, so a purchase is probably missing. Only what was held is counted.",
        ),
      );
  }
  for (const id of missing)
    warnings.push(
      tr("No value on 1 January {year} for {asset}: it's left out of the tax on selling investments.", {
        year: range.start,
        asset: assetById.get(id)?.name ?? `#${id}`,
      }),
    );
  return { years, warnings: [...new Set(warnings)] };
}
