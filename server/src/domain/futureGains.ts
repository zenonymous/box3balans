import { asc, inArray } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { type accountKind, type accounts, type assetClass, type assets, priceHistory } from "../db/schema.js";
import { D, type Decimal, ZERO, round2 } from "../lib/decimal.js";
import { localDay } from "../lib/time.js";
import { tr } from "../i18n/index.js";
import { type Box3Config, categoryOf, outsideBox3 } from "./box3.js";
import type { InstrumentReturn } from "./box3Actual.js";
import type { FinancialInstrumentsYear } from "./box3Future.js";
import { attribute, loadHousehold } from "./household.js";
import { Ledger, sortTransactions, type LedgerTx, type TxType } from "./ledger.js";
import { LedgerData, holdingsOn } from "./valuation.js";
import { loadYearly, yearlyClass } from "./yearly.js";

/**
 * Tax on the capital gain (vermogenswinst) of financial instruments, as the novelle proposes it from
 * 2029, for the preview (ADR 0013): which holdings it applies to, the gain per owner, and the
 * household's gain per year.
 */

type Account = typeof accounts.$inferSelect;
type Asset = typeof assets.$inferSelect;

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
  /** Sold or sent away beyond what was held: a purchase is probably missing. */
  oversold: number[];
  warnings: string[];
}

/** The two legs of each transfer (by transferGroup), as far as they're among `txs`. */
function transferPairs(txs: LedgerTx[]): Map<string, { out?: LedgerTx; in?: LedgerTx }> {
  const pairs = new Map<string, { out?: LedgerTx; in?: LedgerTx }>();
  for (const t of txs) {
    if (!t.transferGroup || (t.type !== "transfer_in" && t.type !== "transfer_out")) continue;
    const pair = pairs.get(t.transferGroup) ?? {};
    pair[t.type === "transfer_in" ? "in" : "out"] = t;
    pairs.set(t.transferGroup, pair);
  }
  return pairs;
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
  const pairs = transferPairs(txs);
  const ownTransfer = (t: LedgerTx) => {
    const pair = t.transferGroup ? pairs.get(t.transferGroup) : undefined;
    return !!pair?.in && !!pair.out;
  };
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
  const oversold = new Set<number>();

  const years: GainYearRow[] = [];
  for (let year = opts.start; year <= opts.to; year++) {
    const [salesSeen, incomeSeen] = [ledger.realized.length, ledger.income.length];
    for (const t of own) {
      if (yearOf(t) !== year || leftOut.has(t.assetId)) continue;
      const held = ledger.position(OWNER, t.assetId).quantity;
      if (TAKES.has(t.type) && D(t.quantity).gt(held)) {
        // More than is held: an earlier purchase is missing. Only what's held can be sold; a
        // negative holding would spoil the average for every year after.
        oversold.add(t.assetId);
        warnings.push(
          `Transaction ${t.id}: ${t.type} of ${D(t.quantity).toFixed()} exceeds holding of ${held.toFixed()} (asset ${t.assetId}); only the part held is counted`,
        );
        // Its costs too, in proportion.
        if (held.gt(0))
          ledger.apply({
            ...t,
            quantity: held.toFixed(),
            feeEur: D(t.feeEur).mul(held).div(D(t.quantity)).toFixed(),
          });
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
    oversold: [...oversold].sort((a, b) => a - b),
    warnings: [...warnings, ...ledger.warnings],
  };
}

/**
 * Whether a holding is taxed when sold in `year` of the preview: a financial instrument, on an account
 * with transactions, counted in box 3 (not green, not left out). Both the yearly return that makes
 * way and the gain that comes instead go by this, so they always cover the same holdings.
 */
export function taxedWhenSold(
  config: Box3Config,
  account: Pick<Account, "id" | "kind" | "tracking">,
  asset: Pick<Asset, "assetClass" | "hidden">,
  year: number,
): boolean {
  if (asset.hidden || account.tracking === "yearly") return false;
  if (!isFinancialInstrument({ accountKind: account.kind, assetClass: asset.assetClass })) return false;
  const cat = categoryOf(
    config,
    { accountId: account.id, accountKind: account.kind, assetClass: asset.assetClass },
    year,
  );
  return !outsideBox3(cat);
}

export interface HouseholdGainsYear {
  gainEur: number;
  regularBenefitsEur: number;
  /**
   * Assets without a value when they came in (held at the start, or deposited later): they stay on
   * their yearly change in value rather than count as bought for €0.
   */
  withoutValue: number[];
}

/**
 * The capital gain on financial instruments and their regular benefits per year, for you and your
 * fiscal partner together (ADR 0013). Each of you has your own average acquisition price over your
 * own accounts and your share of joint and children's accounts. The preview starts on 1 January of
 * `start`: what's held then counts at its value that day, as holdings will on 1 January 2029.
 *
 * Each year is worked out with that year's shares and box 3 categories, the same ones its yearly
 * return is counted with (actualReturn), as if they had applied from the start. That's why every
 * year replays the transactions from the start again: a year's averages depend on its own shares.
 */
export async function householdGains(
  db: DB,
  config: Box3Config,
  range: { start: number; to: number },
  data = new LedgerData(db),
): Promise<{ years: Map<number, HouseholdGainsYear>; warnings: string[] }> {
  const [{ txRows, assetRows, accountRows }, household, startHoldings, yearly] = await Promise.all([
    data.load(),
    loadHousehold(db),
    holdingsOn(db, `${range.start - 1}-12-31`, data),
    loadYearly(db),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const closeOn = await closeOnOrBefore(db, [
    ...new Set(txRows.filter((t) => assetById.get(t.assetId)?.assetClass !== "cash").map((t) => t.assetId)),
  ]);
  const name = (assetId: number) => assetById.get(assetId)?.name ?? `#${assetId}`;
  const warnings = new Set<string>();

  const years = new Map<number, HouseholdGainsYear>();
  for (let year = range.start; year <= range.to; year++) {
    const fiscalPartner = config.years[String(year)]?.partner ?? false;
    const counts = (accountId: number, assetId: number) => {
      const acc = accountById.get(accountId);
      const a = assetById.get(assetId);
      return !!acc && !!a && taxedWhenSold(config, acc, a, year);
    };
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
    // Up to the end of this year: a later deposit without a value mustn't change this year.
    const counted = txRows.filter(
      (t) => counts(t.accountId, t.assetId) && Number(localDay(t.occurredAt).slice(0, 4)) <= year,
    );

    let gain = ZERO;
    let regular = ZERO;
    const missing = new Set<number>();
    for (const owner of ["self", "partner"] as const) {
      const shareOf = (accountId: number) => {
        const acc = accountById.get(accountId);
        return acc ? attribute(acc, household, year, fiscalPartner)[owner] : ZERO;
      };
      const noValue = new Set<number>();
      const txs = ownerTransactions(counted, shareOf, closeOn, (assetId, day) => {
        noValue.add(assetId);
        warnings.add(
          tr("No value for {asset} on {day}, when it came in: it counts with its yearly change in value instead.", {
            asset: name(assetId),
            day,
          }),
        );
      }).filter((t) => !noValue.has(t.assetId));
      for (const id of noValue) missing.add(id);
      if (!txs.length) continue;
      const result = capitalGains(txs, { start: range.start, from: year, to: year, startPrices });
      const row = result.years[0];
      if (row) {
        gain = gain.plus(row.gainEur);
        regular = regular.plus(row.regularBenefitsEur);
      }
      for (const id of result.missingStartValue) {
        missing.add(id);
        warnings.add(
          tr("No value on 1 January {year} for {asset}: it counts with its yearly change in value instead.", {
            year: range.start,
            asset: name(id),
          }),
        );
      }
      for (const id of result.oversold)
        warnings.add(
          tr(
            "More {asset} was sold or sent away than was held, so a purchase is probably missing. Only what was held is counted.",
            { asset: name(id) },
          ),
        );
    }
    years.set(year, {
      gainEur: round2(gain),
      regularBenefitsEur: round2(regular),
      withoutValue: [...missing].sort((a, b) => a - b),
    });
  }
  // An investment account kept as values per year has no sales to work out a gain from: it stays on
  // its yearly change in value (box3Actual), which the preview says rather than leaving it unsaid.
  for (const acc of accountRows) {
    if (acc.tracking !== "yearly") continue;
    const cls = yearlyClass(acc.kind);
    if (cls === "debt" || !isFinancialInstrument({ accountKind: acc.kind, assetClass: cls })) continue;
    const byYear = yearly.get(acc.id);
    const inRange = [...(byYear?.keys() ?? [])].filter((y) => y >= range.start && y <= range.to);
    const counted = inRange.some(
      (y) => !outsideBox3(categoryOf(config, { accountId: acc.id, accountKind: acc.kind, assetClass: cls }, y)),
    );
    if (counted)
      warnings.add(
        tr("{name} is kept as values per year, so its sales aren't known: it counts with its yearly change in value.", {
          name: acc.name,
        }),
      );
  }
  return { years, warnings: [...warnings] };
}

/**
 * One owner's part of the transactions (`shareOf` gives the owner's share of each account). A transfer
 * between two accounts moves units from one owner to the other when their shares differ, as into a
 * joint account: the part handed over leaves the giver's average without a gain, and comes into the
 * receiver's at its value that day. Units that come in from elsewhere without a price (one leg of a
 * transfer, a deposit, a reward) are valued at that day's close too; `noValue` hears when there is
 * none.
 */
function ownerTransactions(
  txs: LedgerTx[],
  shareOf: (accountId: number) => Decimal,
  closeOn: (assetId: number, day: string) => Decimal | null,
  noValue: (assetId: number, day: string) => void,
): LedgerTx[] {
  const legs = transferPairs(txs);
  const valuedIn = (t: LedgerTx): LedgerTx => {
    if (D(t.price).gt(0)) return t;
    const day = localDay(t.occurredAt);
    const close = closeOn(t.assetId, day);
    if (close) return { ...t, price: close.toFixed(), fxRate: "1", currency: "EUR" };
    noValue(t.assetId, day);
    return t;
  };
  const out: LedgerTx[] = [];
  for (const t of txs) {
    const pair = t.transferGroup ? legs.get(t.transferGroup) : undefined;
    if (pair?.in && pair.out && (t === pair.in || t === pair.out)) {
      if (t !== pair.out) continue; // the pair is handled once
      const [sOut, sIn] = [shareOf(pair.out.accountId), shareOf(pair.in.accountId)];
      if (sOut.eq(sIn)) {
        // Between the owner's own accounts (or none of theirs): nothing changes hands.
        if (sOut.gt(0)) out.push(ownerShare(pair.out, sOut), ownerShare(pair.in, sIn));
        continue;
      }
      const moved = D(pair.out.quantity).mul(sIn.minus(sOut));
      const handed = { transferGroup: null, feeEur: "0", amount: "0", taxWithheld: "0" };
      if (moved.lt(0)) out.push({ ...pair.out, ...handed, type: "withdrawal", quantity: moved.neg().toFixed() });
      else out.push(valuedIn({ ...pair.in, ...handed, type: "deposit", quantity: moved.toFixed(), price: "0" }));
      continue;
    }
    const share = shareOf(t.accountId);
    if (share.lte(0)) continue;
    const mine = share.eq(1) ? t : ownerShare(t, share);
    // Without its other leg, the ledger would take a transfer in at the price on it (often 0).
    if (mine.type === "transfer_in") out.push(valuedIn({ ...mine, type: "deposit", transferGroup: null }));
    else if (mine.type === "deposit" || mine.type === "reward") out.push(valuedIn(mine));
    else out.push(mine);
  }
  return out;
}

/** A lookup of the closing price in euros of an asset on a day, or the last one before it. */
async function closeOnOrBefore(db: DB, assetIds: number[]) {
  const closes = new Map<number, { day: string; eur: Decimal }[]>();
  if (assetIds.length) {
    const rows = await db
      .select({ assetId: priceHistory.assetId, day: priceHistory.day, closeEur: priceHistory.closeEur })
      .from(priceHistory)
      .where(inArray(priceHistory.assetId, assetIds))
      .orderBy(asc(priceHistory.day));
    for (const r of rows) {
      const list = closes.get(r.assetId) ?? [];
      list.push({ day: r.day, eur: D(r.closeEur) });
      closes.set(r.assetId, list);
    }
  }
  return (assetId: number, day: string): Decimal | null => {
    let found: Decimal | null = null;
    for (const c of closes.get(assetId) ?? []) {
      if (c.day > day) break;
      found = c.eur;
    }
    return found;
  };
}

/**
 * What the preview swaps for one year (ADR 0013): the yearly return and trading costs of the holdings
 * taxed when sold make way for their capital gain and regular benefits. Holdings without a value when
 * they came in keep their yearly return. Nothing when there's nothing taxed when sold that year.
 */
export function financialInstrumentsYear(
  holdings: InstrumentReturn[],
  gains: HouseholdGainsYear | undefined,
): FinancialInstrumentsYear | undefined {
  if (!gains) return undefined;
  const left = new Set(gains.withoutValue);
  const kept = holdings.filter((h) => !left.has(h.assetId));
  if (!kept.length && !gains.gainEur && !gains.regularBenefitsEur) return undefined;
  return {
    returnEur: round2(kept.reduce((s, h) => s.plus(h.returnEur), ZERO)),
    tradeCostsEur: round2(kept.reduce((s, h) => s.plus(h.tradeCostsEur), ZERO)),
    gainEur: gains.gainEur,
    regularBenefitsEur: gains.regularBenefitsEur,
  };
}
