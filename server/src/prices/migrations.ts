import { D, type Decimal } from "../lib/decimal.js";
import type { FetchFn } from "../lib/http.js";
import { binanceQuote } from "./binance.js";
import { bitvavoTickers } from "./bitvavo.js";
import type { Quote } from "./types.js";

/**
 * A coin swapped for a successor at a fixed rate. Exchanges converted their customers' coins, but
 * coins held elsewhere (or an exchange that didn't convert) keep the old symbol, and can still be
 * swapped: Threshold's vending machine for NU and KEEP has no deadline. From the swap on, the old
 * coin is worth the rate times its successor.
 */
export interface Migration {
  /** Old symbol and name, as exchanges reported them. */
  symbol: string;
  name: string;
  /**
   * The old coin's own Binance USDT pair, for its prices until the swap. Known to be this coin, so
   * used without the checks a guessed pair needs (see history.ts).
   */
  binance?: string;
  /** The successor and where its prices are: a Bitvavo EUR market, a Binance USDT pair, a Yahoo pair. */
  to: { symbol: string; name: string; bitvavo?: string; binance?: string; yahoo?: string };
  /** Successor coins per old coin. */
  ratio: Decimal;
  /** First day the old coin is valued as its successor: the big exchanges' swap. */
  since: string;
}

const THRESHOLD = { symbol: "T", name: "Threshold", bitvavo: "T-EUR", binance: "TUSDT", yahoo: "T-USD" };

export const MIGRATIONS: Migration[] = [
  // Ratios from total supply: 4.5 billion T for each network's holders. Binance swapped in
  // February 2022, Bitvavo on 16 February 2023.
  { symbol: "NU", name: "NuCypher", binance: "NUUSDT", to: THRESHOLD, ratio: D("3.259242"), since: "2022-02-16" },
  {
    symbol: "KEEP",
    name: "Keep Network",
    binance: "KEEPUSDT",
    to: THRESHOLD,
    ratio: D("4.783188"),
    since: "2022-02-16",
  },
  {
    symbol: "MATIC",
    name: "Polygon",
    binance: "MATICUSDT",
    to: { symbol: "POL", name: "POL", bitvavo: "POL-EUR", binance: "POLUSDT" },
    ratio: D(1),
    since: "2024-09-10",
  },
  {
    symbol: "FTM",
    name: "Fantom",
    binance: "FTMUSDT",
    to: { symbol: "S", name: "Sonic", bitvavo: "S-EUR", binance: "SUSDT", yahoo: "S32684-USD" },
    ratio: D(1),
    since: "2025-01-13",
  },
  // Rebrands with a new token, one for one (Bitvavo's bookings of its swaps show equal amounts);
  // `since` is the first day the new coin traded on Binance.
  {
    symbol: "DAR",
    name: "Mines of Dalarna",
    binance: "DARUSDT",
    to: { symbol: "D", name: "Dar Open Network", binance: "DUSDT" },
    ratio: D(1),
    since: "2025-01-09",
  },
  {
    symbol: "LIT",
    name: "Litentry",
    binance: "LITUSDT",
    to: { symbol: "HEI", name: "Heima", bitvavo: "HEI-EUR", binance: "HEIUSDT" },
    ratio: D(1),
    since: "2025-02-13",
  },
  {
    symbol: "ERN",
    name: "Ethernity Chain",
    binance: "ERNUSDT",
    to: { symbol: "EPIC", name: "Epic Chain", bitvavo: "EPIC-EUR", binance: "EPICUSDT" },
    ratio: D(1),
    since: "2025-03-13",
  },
  {
    symbol: "BNX",
    name: "BinaryX",
    binance: "BNXUSDT",
    to: { symbol: "FORM", name: "Four", bitvavo: "FORM-EUR", binance: "FORMUSDT" },
    ratio: D(1),
    since: "2025-03-19",
  },
  // A new ticker for the same token (Circle, 22 September 2023); Bitvavo switched in August 2025.
  {
    symbol: "EUROC",
    name: "Euro Coin",
    to: { symbol: "EURC", name: "EURC", bitvavo: "EURC-EUR", yahoo: "EURC-USD" },
    ratio: D(1),
    since: "2023-09-22",
  },
];

/**
 * The swap that values a coin, if any: only for a coin without a price feed of its own (a manual
 * crypto asset, unless it's a token identified by its contract, which may be anything).
 */
export function migrationOf(asset: {
  assetClass: string;
  symbol: string;
  priceSource: string;
  contract?: string | null;
}): Migration | undefined {
  if (asset.assetClass !== "crypto" || asset.priceSource !== "manual" || asset.contract) return undefined;
  const symbol = asset.symbol.toUpperCase();
  return MIGRATIONS.find((m) => m.symbol === symbol);
}

/** Current prices of successors, by successor symbol: Bitvavo's ticker (one call), else Binance's. */
export async function successorQuotes(list: Migration[], fetchFn?: FetchFn): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const tickers = await bitvavoTickers(fetchFn).catch(() => new Map<string, { last: Decimal; open?: Decimal }>());
  for (const { to } of list) {
    if (out.has(to.symbol)) continue;
    const t = to.bitvavo ? tickers.get(to.bitvavo) : undefined;
    if (t) {
      const change = t.open ? t.last.div(t.open).minus(1).mul(100) : undefined;
      out.set(to.symbol, { price: t.last, currency: "EUR", changePct24h: change, source: "bitvavo" });
      continue;
    }
    const b = to.binance ? await binanceQuote(to.binance, fetchFn).catch(() => null) : null;
    if (b?.price.gt(0))
      out.set(to.symbol, { price: b.price, currency: "USD", changePct24h: b.changePct24h, source: "binance" });
  }
  return out;
}
