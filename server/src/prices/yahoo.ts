import { D } from "../lib/decimal.js";
import { getJson, type FetchFn } from "../lib/http.js";
import type { AssetCandidate, PriceProvider, Quote } from "./types.js";

const BASE = "https://query1.finance.yahoo.com";

// Some exchanges quote in minor units (London in pence, Johannesburg in cents).
const MINOR_UNITS: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" };

export function normaliseCurrency(currency: string, price: ReturnType<typeof D>) {
  const major = MINOR_UNITS[currency];
  return major ? { currency: major, price: price.div(100) } : { currency: currency.toUpperCase(), price };
}

interface ChartResponse {
  chart: {
    result:
      | {
          meta: {
            currency: string;
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            regularMarketChangePercent?: number;
          };
        }[]
      | null;
    error: { description: string } | null;
  };
}

export async function yahooQuote(ticker: string, fetchFn?: FetchFn): Promise<Quote> {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  const data = await getJson<ChartResponse>(url, { fetchFn });
  const meta = data.chart.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) {
    throw new Error(`Yahoo has no price for ${ticker}: ${data.chart.error?.description ?? "empty result"}`);
  }
  const { currency, price } = normaliseCurrency(meta.currency, D(meta.regularMarketPrice));
  return {
    price,
    currency,
    changePct24h: meta.regularMarketChangePercent != null ? D(meta.regularMarketChangePercent) : undefined,
    source: "yahoo",
  };
}

export function yahooProvider(fetchFn?: FetchFn): PriceProvider {
  return {
    name: "yahoo",
    async quotes(refs) {
      const out = new Map<string, Quote>();
      // Yahoo has no free batch endpoint; keep concurrency low to stay under rate limits.
      for (let i = 0; i < refs.length; i += 4) {
        const batch = refs.slice(i, i + 4);
        const results = await Promise.allSettled(batch.map((r) => yahooQuote(r, fetchFn)));
        results.forEach((res, j) => {
          if (res.status === "fulfilled") out.set(batch[j]!, res.value);
        });
      }
      return out;
    },
  };
}

interface SearchResponse {
  quotes: { symbol: string; shortname?: string; longname?: string; quoteType?: string; exchDisp?: string }[];
}

export async function yahooSearch(query: string, fetchFn?: FetchFn): Promise<AssetCandidate[]> {
  const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  const data = await getJson<SearchResponse>(url, { fetchFn });
  const isIsin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(query.trim().toUpperCase());
  return (data.quotes ?? [])
    .filter((q) => q.quoteType === "EQUITY" || q.quoteType === "ETF" || q.quoteType === "MUTUALFUND")
    .map((q) => ({
      assetClass: q.quoteType === "EQUITY" ? ("stock" as const) : ("etf" as const),
      name: q.longname ?? q.shortname ?? q.symbol,
      symbol: q.symbol.split(".")[0]!,
      priceSource: "yahoo" as const,
      priceRef: q.symbol,
      exchange: q.exchDisp,
      isin: isIsin ? query.trim().toUpperCase() : undefined,
    }));
}

export interface DividendEvent {
  exDate: string; // YYYY-MM-DD
  amount: ReturnType<typeof D>; // per share, in `currency`
  currency: string;
}

/** Dividends per share over the last two years (ex-dividend dates), from Yahoo's chart events. */
export async function yahooDividends(ticker: string, fetchFn?: FetchFn): Promise<DividendEvent[]> {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=2y&interval=1mo&events=div`;
  const data = await getJson<{
    chart: {
      result:
        | { meta: { currency: string }; events?: { dividends?: Record<string, { amount: number; date: number }> } }[]
        | null;
    };
  }>(url, { fetchFn });
  const r = data.chart.result?.[0];
  if (!r) return [];
  return Object.values(r.events?.dividends ?? {})
    .map((d) => {
      const { currency, price } = normaliseCurrency(r.meta.currency, D(d.amount));
      return { exDate: new Date(d.date * 1000).toISOString().slice(0, 10), amount: price, currency };
    })
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
}
