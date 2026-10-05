import type { assets } from "../db/schema.js";
import { D, type Decimal } from "../lib/decimal.js";
import { getJson, type FetchFn } from "../lib/http.js";
import type { FxService } from "./fx.js";
import type { Quote } from "./types.js";
import { yahooQuote } from "./yahoo.js";

type Asset = typeof assets.$inferSelect;

/**
 * A second price source, used for assets the main provider gave no quote for (an outage, a rate
 * limit, an API change). Keyed by asset rather than provider id, because a fallback identifies the
 * asset differently (a symbol, an ISIN).
 */
export interface Fallback {
  name: string;
  /** Primary price source this fallback stands in for. */
  covers: string;
  applies(a: Asset): boolean;
  quotes(list: Asset[]): Promise<Map<number, Quote>>;
}

/** Bitvavo's public ticker: every EUR market in one call, no key. */
export function bitvavoFallback(fetchFn?: FetchFn): Fallback {
  return {
    name: "bitvavo",
    covers: "coingecko",
    applies: (a) => a.assetClass === "crypto",
    async quotes(list) {
      const data = await getJson<{ market: string; open: string | null; last: string | null }[]>(
        "https://api.bitvavo.com/v2/ticker/24h",
        { fetchFn, retries: 1 },
      );
      const byMarket = new Map(data.map((m) => [m.market, m]));
      const out = new Map<number, Quote>();
      for (const a of list) {
        const m = byMarket.get(`${a.symbol.toUpperCase()}-EUR`);
        if (!m?.last || D(m.last).lte(0)) continue;
        const change = m.open && D(m.open).gt(0) ? D(m.last).div(m.open).minus(1).mul(100) : undefined;
        out.set(a.id, { price: D(m.last), currency: "EUR", changePct24h: change, source: "bitvavo" });
      }
      return out;
    },
  };
}

/** Yahoo's SYMBOL-EUR crypto pairs (also used for price history). */
export function yahooCryptoFallback(fetchFn?: FetchFn): Fallback {
  return {
    name: "yahoo",
    covers: "coingecko",
    applies: (a) => a.assetClass === "crypto",
    async quotes(list) {
      const out = new Map<number, Quote>();
      for (const a of list.slice(0, 20)) {
        try {
          const q = await yahooQuote(`${a.symbol.toUpperCase()}-EUR`, fetchFn);
          out.set(a.id, { ...q, source: "yahoo" });
        } catch {
          // no such pair
        }
      }
      return out;
    },
  };
}

/** "1 659,20" or 296.85 → Decimal. Tradegate mixes German-formatted strings and numbers. */
function tgNumber(v: unknown): Decimal | null {
  if (typeof v === "number") return Number.isFinite(v) ? D(v) : null;
  if (typeof v !== "string") return null;
  // With a comma it's German style (dots and spaces group thousands); without, a plain number.
  const t = v.replace(/[\s\u00a0\u202f]/g, "");
  const s = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return /^-?\d+(\.\d+)?$/.test(s) ? D(s) : null;
}

/**
 * Tradegate (Berlin): most stocks and ETFs by ISIN, in EUR, during and after trading hours. The
 * quote is converted to the asset's own currency so it lines up with the main source's.
 */
export function tradegateFallback(
  fx: FxService,
  fetchFn?: FetchFn,
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Fallback {
  return {
    name: "tradegate",
    covers: "yahoo",
    applies: (a) => !!a.isin && (a.assetClass === "stock" || a.assetClass === "etf"),
    async quotes(list) {
      const out = new Map<number, Quote>();
      for (const a of list.slice(0, 30)) {
        try {
          const r = await getJson<Record<string, unknown>>(
            `https://www.tradegatebsx.com/refresh.php?isin=${encodeURIComponent(a.isin!)}`,
            { fetchFn, retries: 0 },
          );
          const bid = tgNumber(r.bid);
          const ask = tgNumber(r.ask);
          const eur = tgNumber(r.last) ?? (bid && ask ? bid.plus(ask).div(2) : null) ?? tgNumber(r.close);
          if (!eur || eur.lte(0)) continue;
          const cur = a.currency === "EUR" ? "EUR" : a.currency;
          const price = cur === "EUR" ? eur : eur.div(await fx.eurPerUnit(cur));
          out.set(a.id, { price, currency: cur, changePct24h: tgNumber(r.delta) ?? undefined, source: "tradegate" });
        } catch {
          // not listed there
        }
        await sleep(250);
      }
      return out;
    },
  };
}

/**
 * Whether a fallback quote is believable: within half to double the last known EUR price. Without
 * a known price only native coins and ISIN-keyed securities qualify; a token symbol could belong
 * to a different coin on another exchange.
 */
export function plausible(a: Asset, priceEur: Decimal, lastEur: Decimal | null): boolean {
  if (lastEur && lastEur.gt(0)) {
    const ratio = priceEur.div(lastEur);
    return ratio.gte(0.5) && ratio.lte(2);
  }
  return a.assetClass === "crypto" ? !a.contract : !!a.isin;
}
