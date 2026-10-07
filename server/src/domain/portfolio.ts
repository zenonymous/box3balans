import { asc } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, metalItems, netWorthSnapshots, pricesLatest, transactions } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { D, Decimal, ZERO, money2 } from "../lib/decimal.js";
import { replayLedger, type CostMethod, type LedgerResult } from "./ledger.js";
import { getCostMethod } from "./settings.js";
import { computeHistory, pointOn } from "./history.js";
import { tr } from "../i18n/index.js";
import { displayName } from "../db/seed.js";

export type AssetClassKey = "stock" | "etf" | "crypto" | "metal" | "cash" | "other";
const CLASSES: AssetClassKey[] = ["stock", "etf", "crypto", "metal", "cash", "other"];

export interface HoldingAccountRow {
  accountId: number;
  accountName: string;
  quantity: string;
  valueEur: string;
  costEur: string;
}

export interface Holding {
  key: string;
  assetId: number;
  name: string;
  symbol: string;
  assetClass: AssetClassKey;
  unit: string;
  physical: boolean;
  quantity: string;
  avgCostEur: string | null;
  costEur: string;
  priceEur: string | null;
  valueEur: string;
  unrealizedEur: string;
  unrealizedPct: string | null;
  realizedEur: string;
  incomeEur: string;
  feesEur: string;
  // For holdings bought in a foreign currency: unrealized P&L split into the part from the price
  // moving (at the exchange rate you paid) and the part from the currency moving.
  localCurrency: string | null;
  priceEffectEur: string | null;
  fxEffectEur: string | null;
  changePct24h: string | null;
  dayChangeEur: string;
  weightPct: string;
  priceFetchedAt: string | null;
  priceStale: boolean;
  accounts: HoldingAccountRow[];
}

export interface PortfolioSummary {
  totalEur: string;
  costEur: string;
  unrealizedEur: string;
  realizedEur: string;
  incomeEur: string;
  dayChangeEur: string;
  dayChangePct: string | null;
  byClass: Record<AssetClassKey, string>;
  byAccount: { accountId: number; name: string; kind: string; valueEur: string }[];
  periodChanges: { period: "1W" | "1M" | "YTD"; fromDay: string; changeEur: string; changePct: string | null }[];
  missingPrices: string[];
  warnings: string[];
}

export interface Portfolio {
  holdings: Holding[];
  summary: PortfolioSummary;
  ledger: LedgerResult;
}

interface Acc {
  quantity: Decimal;
  costEur: Decimal;
  realizedEur: Decimal;
  incomeEur: Decimal;
  feesEur: Decimal;
  valueEur: Decimal;
  // Cost in the trade currency, while all positions share one (undefined = none seen yet).
  costLocal: Decimal | null;
  localCurrency: string | null | undefined;
  accounts: Map<number, { quantity: Decimal; valueEur: Decimal; costEur: Decimal }>;
}

const newAcc = (): Acc => ({
  quantity: ZERO,
  costEur: ZERO,
  realizedEur: ZERO,
  incomeEur: ZERO,
  feesEur: ZERO,
  valueEur: ZERO,
  costLocal: ZERO,
  localCurrency: undefined,
  accounts: new Map(),
});

const pct = (num: Decimal, den: Decimal): string | null => (den.isZero() ? null : num.div(den).mul(100).toFixed(2));

export async function loadLedger(db: DB, method?: CostMethod): Promise<LedgerResult> {
  const [txs, m] = await Promise.all([
    db.select().from(transactions).orderBy(asc(transactions.occurredAt)),
    method ? Promise.resolve(method) : getCostMethod(db),
  ]);
  return replayLedger(txs, m);
}

/**
 * Values the whole portfolio at latest prices. `staleAfterMs` marks prices older than that as stale.
 */
export async function buildPortfolio(db: DB, opts: { staleAfterMs: number; now?: Date }): Promise<Portfolio> {
  const now = opts.now ?? new Date();
  const method = await getCostMethod(db);
  const [ledger, assetRows, accountRows, priceRows, items] = await Promise.all([
    loadLedger(db, method),
    db.select().from(assets),
    db.select().from(accounts),
    db.select().from(pricesLatest),
    db.select().from(metalItems),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const priceByAsset = new Map(priceRows.map((p) => [p.assetId, p]));
  const metalAssetByCode = new Map(assetRows.filter((a) => a.priceSource === "metal").map((a) => [a.priceRef, a]));

  const byKey = new Map<string, Acc & { assetId: number; physical: boolean }>();
  const missing = new Set<string>();
  const byAccount = new Map<number, Decimal>();

  const accFor = (key: string, assetId: number, physical: boolean) => {
    let a = byKey.get(key);
    if (!a) {
      a = { ...newAcc(), assetId, physical };
      byKey.set(key, a);
    }
    return a;
  };

  const addToAccount = (acc: Acc, accountId: number, quantity: Decimal, valueEur: Decimal, costEur: Decimal) => {
    const row = acc.accounts.get(accountId) ?? { quantity: ZERO, valueEur: ZERO, costEur: ZERO };
    row.quantity = row.quantity.plus(quantity);
    row.valueEur = row.valueEur.plus(valueEur);
    row.costEur = row.costEur.plus(costEur);
    acc.accounts.set(accountId, row);
    byAccount.set(accountId, (byAccount.get(accountId) ?? ZERO).plus(valueEur));
  };

  for (const p of ledger.positions) {
    const asset = assetById.get(p.assetId);
    // Hidden assets (e.g. spam tokens kept for the record) are left out of totals.
    if (!asset || asset.hidden) continue;
    const price = priceByAsset.get(p.assetId);
    const hasQty = !p.quantity.isZero();
    if (hasQty && !price) missing.add(asset.symbol);
    const value = price && hasQty ? p.quantity.mul(D(price.priceEur)) : ZERO;
    const acc = accFor(`a${p.assetId}`, p.assetId, false);
    acc.quantity = acc.quantity.plus(p.quantity);
    acc.costEur = acc.costEur.plus(p.costEur);
    acc.realizedEur = acc.realizedEur.plus(p.realizedEur);
    acc.incomeEur = acc.incomeEur.plus(p.incomeEur);
    acc.feesEur = acc.feesEur.plus(p.feesEur);
    acc.valueEur = acc.valueEur.plus(value);
    if (hasQty) {
      // Trade-currency cost only adds up when every open position uses the same currency.
      if (p.costLocal === null || (acc.localCurrency !== undefined && acc.localCurrency !== p.localCurrency)) {
        acc.costLocal = null;
        acc.localCurrency = null;
      } else if (acc.costLocal !== null) {
        acc.costLocal = acc.costLocal.plus(p.costLocal);
        acc.localCurrency = p.localCurrency;
      }
    }
    if (hasQty) addToAccount(acc, p.accountId, p.quantity, value, p.costEur);
  }

  // Physical metal: one holding per metal, valued at spot by fine weight (grams).
  for (const item of items) {
    const metalAsset = metalAssetByCode.get(METAL_CODES[item.metal]);
    if (!metalAsset) continue;
    if (item.soldDate) {
      const acc = accFor(`p${metalAsset.id}`, metalAsset.id, true);
      acc.realizedEur = acc.realizedEur.plus(D(item.salePriceEur).minus(D(item.purchasePriceEur)));
      continue;
    }
    const fineG = D(item.grossWeightG).mul(D(item.purity)).mul(item.quantity);
    const price = priceByAsset.get(metalAsset.id);
    if (!price) missing.add(metalAsset.symbol);
    const value = price ? fineG.mul(D(price.priceEur)) : ZERO;
    const acc = accFor(`p${metalAsset.id}`, metalAsset.id, true);
    acc.quantity = acc.quantity.plus(fineG);
    acc.costEur = acc.costEur.plus(D(item.purchasePriceEur));
    acc.valueEur = acc.valueEur.plus(value);
    addToAccount(acc, item.accountId, fineG, value, D(item.purchasePriceEur));
  }

  let total = ZERO;
  for (const a of byKey.values()) total = total.plus(a.valueEur);

  const byClass = Object.fromEntries(CLASSES.map((c) => [c, ZERO])) as Record<AssetClassKey, Decimal>;
  let cost = ZERO;
  let unrealized = ZERO;
  let realized = ZERO;
  let income = ZERO;
  let dayChange = ZERO;
  const holdings: Holding[] = [];

  for (const [key, a] of byKey) {
    const asset = assetById.get(a.assetId)!;
    const price = priceByAsset.get(a.assetId);
    const open = !a.quantity.isZero();
    const cls = asset.assetClass as AssetClassKey;
    byClass[cls] = byClass[cls].plus(a.valueEur);
    // Cash is valued at face; its "cost" is not an investment cost basis.
    const isCash = cls === "cash";
    const unreal = open && price && !isCash ? a.valueEur.minus(a.costEur) : ZERO;
    const change = price?.changePct24h ? D(price.changePct24h) : null;
    // Value yesterday = value / (1 + change%), so the EUR move is value - that.
    const dayEur = change && open ? a.valueEur.minus(a.valueEur.div(change.div(100).plus(1))) : ZERO;
    if (!isCash) {
      cost = cost.plus(open ? a.costEur : ZERO);
      unrealized = unrealized.plus(unreal);
    }
    realized = realized.plus(a.realizedEur);
    income = income.plus(a.incomeEur);
    dayChange = dayChange.plus(dayEur);

    if (!open && a.realizedEur.isZero() && a.incomeEur.isZero()) continue;
    const fetchedAt = price?.fetchedAt ?? null;
    const fx = open && !isCash && !a.physical ? fxSplit(a, price) : null;
    holdings.push({
      key,
      assetId: a.assetId,
      name: a.physical
        ? tr("{name} (physical)", { name: displayName(asset) })
        : cls === "metal"
          ? tr("{name} (vaulted)", { name: displayName(asset) })
          : displayName(asset),
      symbol: asset.symbol,
      assetClass: cls,
      unit: asset.unit,
      physical: a.physical,
      quantity: a.quantity.toFixed(),
      avgCostEur: open && !isCash ? a.costEur.div(a.quantity).toFixed(6) : null,
      costEur: money2(open ? a.costEur : ZERO),
      priceEur: price ? D(price.priceEur).toFixed(6) : null,
      valueEur: money2(a.valueEur),
      unrealizedEur: money2(unreal),
      unrealizedPct: open && !isCash ? pct(unreal, a.costEur) : null,
      realizedEur: money2(a.realizedEur),
      incomeEur: money2(a.incomeEur),
      feesEur: money2(a.feesEur),
      localCurrency: fx?.currency ?? null,
      priceEffectEur: fx ? money2(fx.priceEffect) : null,
      fxEffectEur: fx ? money2(fx.fxEffect) : null,
      changePct24h: change ? change.toFixed(2) : null,
      dayChangeEur: money2(dayEur),
      weightPct: pct(a.valueEur, total) ?? "0",
      priceFetchedAt: fetchedAt ? fetchedAt.toISOString() : null,
      priceStale: fetchedAt ? now.getTime() - fetchedAt.getTime() > opts.staleAfterMs : open,
      accounts: [...a.accounts.entries()].map(([accountId, r]) => ({
        accountId,
        accountName: accountById.get(accountId)?.name ?? `#${accountId}`,
        quantity: r.quantity.toFixed(),
        valueEur: money2(r.valueEur),
        costEur: money2(r.costEur),
      })),
    });
  }
  holdings.sort((x, y) => D(y.valueEur).cmp(D(x.valueEur)));

  const periodChanges = await periodChangesFor(db, method, total, now);
  const prevTotal = total.minus(dayChange);

  return {
    holdings,
    ledger,
    summary: {
      totalEur: money2(total),
      costEur: money2(cost),
      unrealizedEur: money2(unrealized),
      realizedEur: money2(realized),
      incomeEur: money2(income),
      dayChangeEur: money2(dayChange),
      dayChangePct: pct(dayChange, prevTotal),
      byClass: Object.fromEntries(CLASSES.map((c) => [c, money2(byClass[c])])) as Record<AssetClassKey, string>,
      byAccount: [...byAccount.entries()]
        .map(([accountId, v]) => ({
          accountId,
          name: accountById.get(accountId)?.name ?? `#${accountId}`,
          kind: accountById.get(accountId)?.kind ?? "other",
          valueEur: money2(v),
        }))
        .sort((x, y) => D(y.valueEur).cmp(D(x.valueEur))),
      periodChanges,
      missingPrices: [...missing],
      warnings: ledger.warnings,
    },
  };
}

/** Net worth change over standard periods, against the computed daily history. */
async function periodChangesFor(
  db: DB,
  method: CostMethod,
  total: Decimal,
  now: Date,
): Promise<PortfolioSummary["periodChanges"]> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const minus = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const { points } = await computeHistory(db, method);
  const periods = [
    { period: "1W" as const, from: day(minus(7)) },
    { period: "1M" as const, from: day(minus(30)) },
    { period: "YTD" as const, from: `${now.getUTCFullYear() - 1}-12-31` },
  ];
  const out: PortfolioSummary["periodChanges"] = [];
  for (const p of periods) {
    const base = pointOn(points, p.from);
    if (!base) continue;
    const b = D(base.totalEur);
    out.push({
      period: p.period,
      fromDay: base.day,
      changeEur: money2(total.minus(b)),
      changePct: pct(total.minus(b), b),
    });
  }
  return out;
}

/**
 * Splits unrealized P&L of a foreign-currency holding: avgFx = EUR cost / trade-currency cost;
 * price effect = (value in trade currency − cost in trade currency) × avgFx;
 * currency effect = value in trade currency × (FX now − avgFx). Together they equal value − cost.
 */
function fxSplit(a: Acc, price: { price: string; currency: string; priceEur: string } | undefined) {
  if (!price || !a.localCurrency || a.localCurrency === "EUR" || !a.costLocal || a.costLocal.isZero()) return null;
  if (price.currency.toUpperCase() !== a.localCurrency) return null;
  const local = D(price.price);
  if (local.isZero()) return null;
  const avgFx = a.costEur.div(a.costLocal);
  const fxNow = D(price.priceEur).div(local);
  const localValue = a.quantity.mul(local);
  return {
    currency: a.localCurrency,
    priceEffect: localValue.minus(a.costLocal).mul(avgFx),
    fxEffect: localValue.mul(fxNow.minus(avgFx)),
  };
}

/** Upserts today's net-worth snapshot (called after every price refresh). */
export async function recordSnapshot(db: DB, summary: PortfolioSummary, day: string): Promise<void> {
  const row = { totalEur: summary.totalEur, byClass: summary.byClass };
  await db
    .insert(netWorthSnapshots)
    .values({ day, ...row })
    .onConflictDoUpdate({ target: netWorthSnapshots.day, set: row });
}
