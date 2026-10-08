import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, priceHistory, pricesLatest, transactions } from "../db/schema.js";
import { D, type Decimal, TROY_OUNCE_G, str } from "../lib/decimal.js";
import { getJson, type FetchFn } from "../lib/http.js";
import { binanceDailyCloses } from "./binance.js";
import { bitvavoCandles, bitvavoTickers } from "./bitvavo.js";
import { coingeckoProvider } from "./coingecko.js";
import { plausible } from "./fallbacks.js";
import type { FxService } from "./fx.js";
import { normaliseCurrency } from "./yahoo.js";

type Asset = typeof assets.$inferSelect;

const DAY = 86_400_000;
const METAL_FUTURES: Record<string, string> = { XAU: "GC=F", XAG: "SI=F", XPT: "PL=F", XPD: "PA=F" };
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface ChartHistory {
  chart: {
    result:
      | {
          meta: { currency: string; regularMarketPrice?: number; longName?: string; shortName?: string };
          timestamp?: number[];
          indicators: { quote: { close: (number | null)[] }[] };
        }[]
      | null;
  };
}

/**
 * Daily historical closes in EUR, stored in price_history. Used to value staking rewards,
 * crypto-to-crypto trades and deposits at the time they happened (and later for backfills).
 * Existing rows are never overwritten.
 */
export class HistoryService {
  constructor(
    private db: DB,
    private fx: FxService,
    private fetchFn?: FetchFn,
  ) {}

  // Bitvavo's current prices, loaded once per service (one call covers every market).
  private bitvavoQuotes?: Promise<Awaited<ReturnType<typeof bitvavoTickers>>>;
  private bitvavoNow() {
    this.bitvavoQuotes ??= bitvavoTickers(this.fetchFn).catch(() => new Map());
    return this.bitvavoQuotes;
  }

  /** Makes sure price_history covers [from, to] for the asset, fetching what is missing. */
  async ensureRange(asset: Asset, from: string, to: string): Promise<void> {
    const have = await this.db
      .select({ day: priceHistory.day })
      .from(priceHistory)
      .where(and(eq(priceHistory.assetId, asset.id), gte(priceHistory.day, from), lte(priceHistory.day, to)));
    const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
    // Markets close on weekends, so ~70% coverage means the range is already loaded.
    if (have.length >= Math.max(1, Math.floor(span * (asset.assetClass === "crypto" ? 0.95 : 0.65)))) return;

    const points = await this.fetchHistory(asset, from, to);
    if (points.length === 0) return;
    const currency = points[0]!.currency;
    if (currency !== "EUR") await this.fx.ensureRange([currency], from, to);
    const rows = [];
    for (const p of points) {
      const eur = p.close.mul(await this.fx.eurPerUnit(currency, p.day));
      rows.push({ assetId: asset.id, day: p.day, close: str(p.close), currency, closeEur: str(eur) });
    }
    for (let i = 0; i < rows.length; i += 500) {
      await this.db
        .insert(priceHistory)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing();
    }
  }

  /** EUR close on `day`, or the nearest earlier day within a week. */
  async eurOn(assetId: number, day: string): Promise<Decimal | null> {
    const from = isoDay(Date.parse(day) - 7 * DAY);
    const [row] = await this.db
      .select({ closeEur: priceHistory.closeEur })
      .from(priceHistory)
      .where(and(eq(priceHistory.assetId, assetId), lte(priceHistory.day, day), gte(priceHistory.day, from)))
      .orderBy(desc(priceHistory.day))
      .limit(1);
    return row ? D(row.closeEur) : null;
  }

  private async fetchHistory(asset: Asset, from: string, to: string) {
    if (asset.assetClass === "crypto" && asset.priceSource === "manual") return this.delistedCoin(asset, from, to);
    // Metals: COMEX/NYMEX front-month futures in USD per troy ounce, converted to per gram below.
    const futures = asset.priceSource === "metal" && asset.priceRef ? METAL_FUTURES[asset.priceRef] : undefined;
    if (futures) {
      try {
        const { points } = await this.yahoo(futures, from, to);
        return points.map((p) => ({ ...p, close: p.close.div(TROY_OUNCE_G) }));
      } catch {
        return [];
      }
    }
    if (asset.priceSource === "yahoo" && asset.priceRef) {
      try {
        const { points } = await this.yahoo(asset.priceRef, from, to);
        if (points.length) return points;
      } catch {
        // try the next source
      }
    }
    if (asset.priceSource === "bitvavo" && asset.priceRef) {
      try {
        const points = await bitvavoCandles(asset.priceRef, from, to, this.fetchFn);
        if (points.length) return points.map((p) => ({ ...p, currency: "EUR" }));
      } catch {
        // try the next source
      }
    }
    // Bitvavo's EUR market of the same symbol: daily back to 2019, but for a coin priced elsewhere a
    // guess, so only used when its current price matches this coin's (like Yahoo's pairs below).
    if (asset.assetClass === "crypto" && asset.priceSource !== "bitvavo" && asset.priceSource !== "yahoo") {
      try {
        const market = `${asset.symbol.toUpperCase()}-EUR`;
        const current = (await this.bitvavoNow()).get(market)?.last;
        if (current) {
          const points = (await bitvavoCandles(market, from, to, this.fetchFn)).map((p) => ({ ...p, currency: "EUR" }));
          if (points.length && (await this.sameCoin(asset, { points, current }))) return points;
        }
      } catch {
        // try the next source
      }
    }
    // Yahoo's SYM-EUR pair goes back further than CoinGecko's free year, but it's a guess: the
    // symbol may belong to another coin there. Only used when its price matches this one's.
    if (asset.assetClass === "crypto" && asset.priceSource !== "yahoo") {
      try {
        const series = await this.yahoo(`${asset.symbol.toUpperCase()}-EUR`, from, to);
        if (series.points.length && (await this.sameCoin(asset, series))) return series.points;
      } catch {
        // try the next source
      }
    }
    if (asset.priceSource === "coingecko" && asset.priceRef) {
      try {
        return await this.coingecko(asset.priceRef, from, to);
      } catch {
        // CoinGecko's free tier only serves the last 365 days.
      }
    }
    return [];
  }

  /**
   * Whether a guessed Yahoo pair prices the same coin: its current price within half to double of
   * this asset's latest quote (or CoinGecko's, for a coin not priced yet), as for price fallbacks.
   */
  /**
   * A manually priced coin, typically one its exchange has delisted: history from Yahoo's EUR pair or
   * Binance's USDT pair, but only when it demonstrably is this coin. Its closes must match the prices
   * of your own trades in it, or (Yahoo) carry the coin's name.
   */
  private async delistedCoin(asset: Asset, from: string, to: string) {
    const symbol = asset.symbol.toUpperCase();
    const trades = await this.tradePrices(asset.id);
    try {
      const y = await this.yahoo(`${symbol}-EUR`, from, to);
      if (y.points.length && ((await this.matchesTrades(y.points, trades)) ?? sameName(asset, y.name))) return y.points;
    } catch {
      // try the next source
    }
    try {
      // Binance names nothing, so it needs your own trades to compare against.
      const points = (await binanceDailyCloses(`${symbol}USDT`, from, to, this.fetchFn)).map((p) => ({
        ...p,
        currency: "USD",
      }));
      if (points.length && (await this.matchesTrades(points, trades))) return points;
    } catch {
      // not on Binance
    }
    return [];
  }

  /** EUR unit prices of your buys and sells of an asset, by day. */
  private async tradePrices(assetId: number): Promise<{ day: string; eur: Decimal }[]> {
    const rows = await this.db
      .select({ at: transactions.occurredAt, price: transactions.price, fxRate: transactions.fxRate })
      .from(transactions)
      .where(and(eq(transactions.assetId, assetId), inArray(transactions.type, ["buy", "sell"])));
    return rows.map((r) => ({ day: isoDay(r.at.getTime()), eur: D(r.price).mul(r.fxRate) })).filter((r) => r.eur.gt(0));
  }

  /**
   * Whether a price series is the coin you traded: on the days of your trades (or up to three days
   * before), its closes are within half to double of what you paid or got, going by the median.
   * Null when there's nothing to compare.
   */
  private async matchesTrades(
    points: { day: string; close: Decimal; currency: string }[],
    trades: { day: string; eur: Decimal }[],
  ): Promise<boolean | null> {
    const byDay = new Map(points.map((p) => [p.day, p]));
    const ratios: number[] = [];
    for (const t of trades.slice(-12)) {
      let p;
      for (let back = 0; back <= 3 && !p; back++) p = byDay.get(isoDay(Date.parse(t.day) - back * DAY));
      if (!p) continue;
      const eur = p.currency === "EUR" ? p.close : p.close.mul(await this.fx.eurPerUnit(p.currency, p.day));
      ratios.push(eur.div(t.eur).toNumber());
    }
    if (ratios.length === 0) return null;
    const median = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)]!;
    return median >= 0.5 && median <= 2;
  }

  private async sameCoin(
    asset: Asset,
    series: { points: { day: string; close: Decimal; currency: string }[]; current?: Decimal },
  ) {
    const last = series.points.at(-1)!;
    const recent = Date.now() - Date.parse(last.day) < 7 * DAY;
    const now = series.current ?? (recent ? last.close : undefined);
    if (!now || series.points[0]!.currency !== "EUR") return !asset.contract;
    return plausible(asset, now, await this.referenceEur(asset));
  }

  private async referenceEur(asset: Asset): Promise<Decimal | null> {
    const [latest] = await this.db
      .select({ v: pricesLatest.priceEur })
      .from(pricesLatest)
      .where(eq(pricesLatest.assetId, asset.id));
    if (latest) return D(latest.v);
    if (asset.priceSource !== "coingecko" || !asset.priceRef) return null;
    try {
      return (await coingeckoProvider(this.fetchFn).quotes([asset.priceRef])).get(asset.priceRef)?.price ?? null;
    } catch {
      return null;
    }
  }

  private async yahoo(ticker: string, from: string, to: string) {
    const p1 = Math.floor(Date.parse(from) / 1000) - DAY / 1000;
    const p2 = Math.floor(Date.parse(to) / 1000) + DAY / 1000;
    const data = await getJson<ChartHistory>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d`,
      { fetchFn: this.fetchFn },
    );
    const r = data.chart.result?.[0];
    if (!r?.timestamp) return { points: [] };
    const closes = r.indicators.quote[0]?.close ?? [];
    const points: { day: string; close: Decimal; currency: string }[] = [];
    r.timestamp.forEach((ts, i) => {
      const c = closes[i];
      if (c == null) return;
      const n = normaliseCurrency(r.meta.currency, D(c));
      points.push({ day: isoDay(ts * 1000), close: n.price, currency: n.currency });
    });
    const current =
      r.meta.regularMarketPrice != null
        ? normaliseCurrency(r.meta.currency, D(r.meta.regularMarketPrice)).price
        : undefined;
    return { points, current, name: r.meta.longName ?? r.meta.shortName };
  }

  private async coingecko(id: string, from: string, to: string) {
    const data = await getJson<{ prices: [number, number][] }>(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart/range?vs_currency=eur&from=${Math.floor(Date.parse(from) / 1000)}&to=${Math.floor(Date.parse(to) / 1000) + 86_400}`,
      { fetchFn: this.fetchFn },
    );
    const byDay = new Map<string, Decimal>();
    for (const [ms, price] of data.prices ?? []) byDay.set(isoDay(ms), D(price));
    return [...byDay].map(([day, close]) => ({ day, close, currency: "EUR" }));
  }
}

/**
 * Whether Yahoo's name for a pair ("Theta Network EUR") is this coin's name. A coin still named after
 * its symbol proves nothing, so that never matches.
 */
function sameName(asset: Asset, yahooName: string | undefined): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+(eur|usd|usdt)$/, "")
      .replace(/[^a-z0-9]/g, "");
  if (!yahooName || norm(asset.name) === norm(asset.symbol)) return false;
  return norm(yahooName) === norm(asset.name);
}
