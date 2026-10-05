import { D, TROY_OUNCE_G } from "../lib/decimal.js";
import { getJson, type FetchFn } from "../lib/http.js";
import type { PriceProvider, Quote } from "./types.js";
import { yahooQuote } from "./yahoo.js";

// COMEX/NYMEX front-month futures, used only when the spot source is unavailable.
const FUTURES: Record<string, string> = { XAU: "GC=F", XAG: "SI=F", XPT: "PL=F", XPD: "PA=F" };

/**
 * Spot prices per gram in USD. Primary source is gold-api.com (free, no key); fallback is
 * Yahoo futures, which trade at a small premium to spot.
 */
export function metalsProvider(fetchFn?: FetchFn): PriceProvider {
  const spot = async (code: string): Promise<Quote> => {
    try {
      const data = await getJson<{ price: number; currency: string }>(`https://api.gold-api.com/price/${code}`, {
        fetchFn,
      });
      if (!data.price || data.currency !== "USD") throw new Error(`unexpected gold-api response for ${code}`);
      return { price: D(data.price).div(TROY_OUNCE_G), currency: "USD", source: "gold-api" };
    } catch (err) {
      const ticker = FUTURES[code];
      if (!ticker) throw err;
      const q = await yahooQuote(ticker, fetchFn);
      return { ...q, price: q.price.div(TROY_OUNCE_G), source: "yahoo-futures" };
    }
  };

  return {
    name: "metal",
    async quotes(refs) {
      const out = new Map<string, Quote>();
      const results = await Promise.allSettled(refs.map(spot));
      results.forEach((r, i) => {
        if (r.status === "fulfilled") out.set(refs[i]!, r.value);
      });
      return out;
    },
  };
}
