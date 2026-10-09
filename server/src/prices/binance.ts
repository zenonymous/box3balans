import { D, type Decimal } from "../lib/decimal.js";
import { getJson, type FetchFn } from "../lib/http.js";

const DAY = 86_400_000;
const LIMIT = 1000;

/**
 * Daily closes of a Binance pair (e.g. "FLOWUSDT") between two days, oldest first, from its public
 * klines (no key). Binance keeps long histories of coins European exchanges have dropped; the
 * quote is in USDT, which callers treat as US dollars.
 */
export async function binanceDailyCloses(
  pair: string,
  from: string,
  to: string,
  fetchFn?: FetchFn,
): Promise<{ day: string; close: Decimal }[]> {
  const end = Date.parse(to) + DAY - 1;
  let start = Date.parse(from);
  const out: { day: string; close: Decimal }[] = [];
  while (start <= end) {
    const rows = await getJson<[number, string, string, string, string, ...unknown[]][]>(
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=1d&startTime=${start}&endTime=${end}&limit=${LIMIT}`,
      { fetchFn },
    );
    for (const [openTime, , , , close] of rows) {
      out.push({ day: new Date(openTime).toISOString().slice(0, 10), close: D(close) });
    }
    if (rows.length < LIMIT) break;
    start = rows.at(-1)![0] + DAY;
  }
  return out;
}

/** Last price and 24h change (%) of a Binance pair, in its quote currency. */
export async function binanceQuote(
  pair: string,
  fetchFn?: FetchFn,
): Promise<{ price: Decimal; changePct24h: Decimal }> {
  const t = await getJson<{ lastPrice: string; priceChangePercent: string }>(
    `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`,
    { fetchFn, retries: 1 },
  );
  return { price: D(t.lastPrice), changePct24h: D(t.priceChangePercent) };
}
