import { D, type Decimal } from "../lib/decimal.js";
import { getJson, type FetchFn } from "../lib/http.js";
import type { PriceProvider, Quote } from "./types.js";

/**
 * Bitvavo's public market data (no key, 1,000 requests a minute): its EUR markets, their prices
 * and daily candles back to 2019. For coins held at Bitvavo it's the natural price source: the
 * same coin, in euros, without CoinGecko's rate limits.
 */
const BASE = "https://api.bitvavo.com/v2";

/** EUR markets that trade (or have traded), by base symbol: "BTC" → "BTC-EUR". */
export async function bitvavoEurMarkets(fetchFn?: FetchFn): Promise<Map<string, string>> {
  const markets = await getJson<{ market: string; base: string; quote: string; status: string }[]>(`${BASE}/markets`, {
    fetchFn,
    retries: 1,
  });
  return new Map(
    markets
      .filter((m) => m.quote === "EUR" && m.status !== "halted")
      .map((m) => [m.base.toUpperCase(), m.market] as const),
  );
}

/** Full names of the coins Bitvavo lists, by symbol ("BTC" → "Bitcoin"). */
export async function bitvavoAssetNames(fetchFn?: FetchFn): Promise<Map<string, string>> {
  const list = await getJson<{ symbol: string; name: string }[]>(`${BASE}/assets`, { fetchFn, retries: 1 });
  return new Map(list.map((a) => [a.symbol.toUpperCase(), a.name]));
}

/** Latest price and 24h change of every market, in one call. */
export async function bitvavoTickers(fetchFn?: FetchFn): Promise<Map<string, { last: Decimal; open?: Decimal }>> {
  const data = await getJson<{ market: string; open: string | null; last: string | null }[]>(`${BASE}/ticker/24h`, {
    fetchFn,
    retries: 1,
  });
  const out = new Map<string, { last: Decimal; open?: Decimal }>();
  for (const m of data) {
    if (!m.last || D(m.last).lte(0)) continue;
    out.set(m.market, { last: D(m.last), open: m.open && D(m.open).gt(0) ? D(m.open) : undefined });
  }
  return out;
}

export function bitvavoProvider(fetchFn?: FetchFn): PriceProvider {
  return {
    name: "bitvavo",
    async quotes(refs) {
      const tickers = await bitvavoTickers(fetchFn);
      const out = new Map<string, Quote>();
      for (const ref of refs) {
        const t = tickers.get(ref);
        if (!t) continue;
        const change = t.open ? t.last.div(t.open).minus(1).mul(100) : undefined;
        out.set(ref, { price: t.last, currency: "EUR", changePct24h: change, source: "bitvavo" });
      }
      return out;
    },
  };
}

const DAY = 86_400_000;
const MAX_CANDLES = 1440;

/**
 * Daily closes of a market between two days (YYYY-MM-DD, inclusive), oldest first. Bitvavo
 * returns at most 1,440 candles per call, newest first, so longer ranges take a few calls.
 */
export async function bitvavoCandles(
  market: string,
  from: string,
  to: string,
  fetchFn?: FetchFn,
): Promise<{ day: string; close: Decimal }[]> {
  const start = Date.parse(from);
  let end = Date.parse(to) + DAY;
  const byDay = new Map<string, Decimal>();
  while (end > start) {
    const rows = await getJson<[number, string, string, string, string, string][]>(
      `${BASE}/${encodeURIComponent(market)}/candles?interval=1d&start=${start}&end=${end}&limit=${MAX_CANDLES}`,
      { fetchFn },
    );
    for (const [ts, , , , close] of rows) byDay.set(new Date(ts).toISOString().slice(0, 10), D(close));
    if (rows.length < MAX_CANDLES) break;
    end = Math.min(...rows.map((r) => r[0]));
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, close]) => ({ day, close }));
}
