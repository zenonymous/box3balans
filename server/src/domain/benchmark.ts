import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, priceHistory, settings } from "../db/schema.js";
import type { HistoryService } from "../prices/history.js";
import type { HistoryPoint } from "./history.js";
import { msg } from "../i18n/index.js";

/**
 * Benchmarks: what your money would have done in one investment instead. Accumulating funds, so
 * their price return is their whole return.
 */
export const BENCHMARKS = [
  {
    id: "msci-world",
    label: msg("MSCI World (iShares IWDA)"),
    assetClass: "etf",
    source: "yahoo",
    ref: "IWDA.AS",
    symbol: "IWDA",
  },
  {
    id: "all-world",
    label: msg("FTSE All-World (Vanguard VWCE)"),
    assetClass: "etf",
    source: "yahoo",
    ref: "VWCE.DE",
    symbol: "VWCE",
  },
  {
    id: "sp500",
    label: msg("S&P 500 (iShares CSPX)"),
    assetClass: "etf",
    source: "yahoo",
    ref: "CSPX.AS",
    symbol: "CSPX",
  },
  { id: "gold", label: msg("Gold"), assetClass: "metal", source: "metal", ref: "XAU", symbol: "XAU" },
  { id: "bitcoin", label: msg("Bitcoin"), assetClass: "crypto", source: "coingecko", ref: "bitcoin", symbol: "BTC" },
] as const;
export type BenchmarkId = (typeof BENCHMARKS)[number]["id"] | "none";

const KEY = "benchmark";

export async function getBenchmarkId(db: DB): Promise<BenchmarkId> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = row?.value as string | undefined;
  return v === "none" || BENCHMARKS.some((b) => b.id === v) ? (v as BenchmarkId) : "msci-world";
}

export async function setBenchmarkId(db: DB, id: BenchmarkId) {
  await db
    .insert(settings)
    .values({ key: KEY, value: id })
    .onConflictDoUpdate({ target: settings.key, set: { value: id } });
}

/** The benchmark's asset, created hidden (out of holdings, but priced daily) when you don't hold it. */
async function benchmarkAsset(db: DB, b: (typeof BENCHMARKS)[number]) {
  const [existing] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.priceSource, b.source), eq(assets.priceRef, b.ref)));
  if (existing) return existing;
  const [row] = await db
    .insert(assets)
    .values({
      assetClass: b.assetClass,
      name: `${b.label} (benchmark)`,
      symbol: b.symbol,
      priceSource: b.source,
      priceRef: b.ref,
      currency: "EUR",
      unit: b.source === "metal" ? "g" : "unit",
      hidden: true,
    })
    .onConflictDoNothing()
    .returning();
  return row!;
}

/**
 * The same money flows invested in the benchmark: every euro that came into your portfolio buys
 * benchmark units that day, every euro that left sells them. Returns a history with the same days
 * and flows, valued in the benchmark, so the same return calculations apply.
 */
export async function benchmarkHistory(
  db: DB,
  history: HistoryService,
  id: BenchmarkId,
  points: HistoryPoint[],
): Promise<{ label: string; points: HistoryPoint[] } | null> {
  const b = BENCHMARKS.find((x) => x.id === id);
  if (!b || points.length === 0) return null;
  const asset = await benchmarkAsset(db, b);
  try {
    await history.ensureRange(asset, points[0]!.day, points.at(-1)!.day);
  } catch {
    // whatever is stored is used; days before it hold the money as cash
  }
  const closes = await db
    .select({ day: priceHistory.day, closeEur: priceHistory.closeEur })
    .from(priceHistory)
    .where(eq(priceHistory.assetId, asset.id))
    .orderBy(asc(priceHistory.day));
  if (!closes.length) return null;

  let ci = -1;
  let units = 0;
  // Money waiting for the benchmark's first price (its history may start later than yours).
  let pending = 0;
  const out: HistoryPoint[] = [];
  for (const p of points) {
    while (ci + 1 < closes.length && closes[ci + 1]!.day <= p.day) ci++;
    const price = ci >= 0 ? Number(closes[ci]!.closeEur) : null;
    pending += p.flowEur;
    if (price && price > 0 && pending !== 0) {
      // Never sell more than there is: outflows beyond the benchmark's value just empty it.
      units = Math.max(0, units + pending / price);
      pending = 0;
    }
    const value = (price ? units * price : 0) + Math.max(pending, 0);
    out.push({ ...p, totalEur: Math.round(value * 100) / 100 });
  }
  return { label: b.label, points: out };
}
