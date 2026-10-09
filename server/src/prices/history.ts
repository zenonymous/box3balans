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
import { migrationOf, type Migration } from "./migrations.js";
import { normaliseCurrency } from "./yahoo.js";

type Asset = typeof assets.$inferSelect;
type Point = { day: string; close: Decimal; currency: string };

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
    // CoinGecko's free tier answers a burst with a rate limit, so its calls are spaced out.
    private coingeckoGapMs = 0,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private lastCoingecko = 0;

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

  private async fetchHistory(asset: Asset, from: string, to: string): Promise<Point[]> {
    if (asset.assetClass === "crypto" && asset.priceSource === "manual") {
      const swap = migrationOf(asset);
      return swap ? this.swapped(asset, swap, from, to) : this.delistedCoin(asset, from, to);
    }
    const points = await this.fromSources(asset, from, to);
    return asset.assetClass === "crypto" ? this.withOlder(asset, from, to, points) : points;
  }

  /** History from the asset's own price source, or a pair that matches it. */
  private async fromSources(asset: Asset, from: string, to: string): Promise<Point[]> {
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
    // CoinGecko's free tier serves the last 365 days, and refuses a range reaching back further.
    if (asset.priceSource === "coingecko" && asset.priceRef) {
      const yearAgo = isoDay(Date.now() - 364 * DAY);
      const start = from > yearAgo ? from : yearAgo;
      if (start <= to) {
        try {
          return await this.coingecko(asset.priceRef, start, to);
        } catch {
          // no history this time
        }
      }
    }
    return [];
  }

  /**
   * The days before what a coin's sources cover (CoinGecko's free year, a market Bitvavo has since
   * closed) from Binance's USDT pair, but only when your own trades in the coin confirm it's the same
   * coin: Binance names nothing. In EUR, as the two parts may come in different currencies.
   */
  private async withOlder(asset: Asset, from: string, to: string, points: Point[]): Promise<Point[]> {
    const start = points.reduce<string | undefined>((min, p) => (min && min <= p.day ? min : p.day), undefined);
    if (start && Date.parse(start) - Date.parse(from) <= 3 * DAY) return points;
    const until = start ? isoDay(Date.parse(start) - DAY) : to;
    try {
      const older = (await binanceDailyCloses(`${asset.symbol.toUpperCase()}USDT`, from, until, this.fetchFn)).map(
        (p) => ({ ...p, currency: "USD" }),
      );
      if (older.length && (await this.matchesTrades(older, await this.tradePrices(asset.id))) === true)
        return this.inEur([...older, ...points], from, to);
    } catch {
      // not on Binance
    }
    return points;
  }

  /**
   * A manually priced coin, typically one its exchange has delisted: history from Yahoo's EUR pair or
   * Binance's USDT pair, but only when it demonstrably is this coin. Its closes must match the prices
   * of your own trades in it, or (Yahoo) carry the coin's name.
   */
  private async delistedCoin(asset: Asset, from: string, to: string, name = asset.name): Promise<Point[]> {
    const symbol = asset.symbol.toUpperCase();
    const trades = await this.tradePrices(asset.id);
    try {
      const y = await this.yahoo(`${symbol}-EUR`, from, to);
      if (y.points.length && ((await this.matchesTrades(y.points, trades)) ?? sameName(name, symbol, y.name)))
        return y.points;
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

  /**
   * A coin swapped for a successor (NU for T): its own history until the swap, from its exchanges'
   * old pairs (known by the coin's old name) or else its Binance pair from the list, then the
   * successor's closes times the rate. In EUR, as the two parts may come in different currencies.
   */
  private async swapped(asset: Asset, swap: Migration, from: string, to: string): Promise<Point[]> {
    const lastOwn = isoDay(Date.parse(swap.since) - DAY);
    const ownTo = to < lastOwn ? to : lastOwn;
    let own = from <= lastOwn ? await this.delistedCoin(asset, from, ownTo, swap.name) : [];
    if (!own.length && swap.binance && from <= lastOwn) {
      try {
        own = (await binanceDailyCloses(swap.binance, from, ownTo, this.fetchFn)).map((p) => ({
          ...p,
          currency: "USD",
        }));
      } catch {
        // not on Binance (any more)
      }
    }
    // Yahoo pads the range by a day; from the swap day on it's the successor's.
    own = own.filter((p) => p.day <= lastOwn);
    const start = from > swap.since ? from : swap.since;
    const next = start <= to ? await this.successorCloses(swap, start, to) : [];
    return this.inEur([...own, ...next.map((p) => ({ ...p, close: p.close.mul(swap.ratio) }))], from, to);
  }

  /** Closes in EUR, at the ECB rate of their day. */
  private async inEur(points: Point[], from: string, to: string): Promise<Point[]> {
    await this.fx.ensureRange([...new Set(points.map((p) => p.currency))], from, to);
    const out: Point[] = [];
    for (const p of points) {
      const close = p.currency === "EUR" ? p.close : p.close.mul(await this.fx.eurPerUnit(p.currency, p.day));
      out.push({ day: p.day, close, currency: "EUR" });
    }
    return out;
  }

  /** Daily closes of a successor coin: its Bitvavo market, with Binance and Yahoo for days it lacks. */
  private async successorCloses(swap: Migration, from: string, to: string): Promise<Point[]> {
    const { bitvavo, binance, yahoo } = swap.to;
    const sources = [
      bitvavo &&
        (async () => (await bitvavoCandles(bitvavo, from, to, this.fetchFn)).map((p) => ({ ...p, currency: "EUR" }))),
      binance &&
        (async () =>
          (await binanceDailyCloses(binance, from, to, this.fetchFn)).map((p) => ({ ...p, currency: "USD" }))),
      yahoo && (async () => (await this.yahoo(yahoo, from, to)).points),
    ];
    const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
    const byDay = new Map<string, Point>();
    for (const load of sources) {
      if (!load || byDay.size >= days) continue;
      try {
        for (const p of await load()) if (p.day >= from && p.day <= to && !byDay.has(p.day)) byDay.set(p.day, p);
      } catch {
        // try the next source
      }
    }
    return [...byDay.values()];
  }

  /** EUR unit prices of your buys and sells of an asset, by day, newest first. */
  private async tradePrices(assetId: number): Promise<{ day: string; eur: Decimal }[]> {
    const rows = await this.db
      .select({ at: transactions.occurredAt, price: transactions.price, fxRate: transactions.fxRate })
      .from(transactions)
      .where(and(eq(transactions.assetId, assetId), inArray(transactions.type, ["buy", "sell"])))
      .orderBy(desc(transactions.occurredAt));
    return rows.map((r) => ({ day: isoDay(r.at.getTime()), eur: D(r.price).mul(r.fxRate) })).filter((r) => r.eur.gt(0));
  }

  /**
   * Whether a price series is the coin you traded: on the days of your trades (or up to three days
   * before), its closes are within half to double of what you paid or got, going by the median of
   * the latest twelve trades the series covers. Null when there's nothing to compare.
   */
  private async matchesTrades(
    points: { day: string; close: Decimal; currency: string }[],
    trades: { day: string; eur: Decimal }[],
  ): Promise<boolean | null> {
    const byDay = new Map(points.map((p) => [p.day, p]));
    const ratios: number[] = [];
    for (const t of trades) {
      if (ratios.length >= 12) break;
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

  /**
   * Whether a guessed Yahoo pair prices the same coin: its current price within half to double of
   * this asset's latest quote (or CoinGecko's, for a coin not priced yet), as for price fallbacks.
   */
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

  private async yahoo(
    ticker: string,
    from: string,
    to: string,
  ): Promise<{ points: Point[]; current?: Decimal; name?: string }> {
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
    const wait = this.lastCoingecko + this.coingeckoGapMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastCoingecko = Date.now();
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
function sameName(name: string, symbol: string, yahooName: string | undefined): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+(eur|usd|usdt)$/, "")
      .replace(/[^a-z0-9]/g, "");
  if (!yahooName || norm(name) === norm(symbol)) return false;
  return norm(yahooName) === norm(name);
}
