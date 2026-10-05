import type { Decimal } from "../lib/decimal.js";

export interface Quote {
  price: Decimal;
  currency: string;
  changePct24h?: Decimal;
  source: string;
}

export interface PriceProvider {
  name: string;
  /** Quotes for the given provider refs. Refs that cannot be priced are omitted from the result. */
  quotes(refs: string[]): Promise<Map<string, Quote>>;
}

export interface HistoryPoint {
  day: string; // YYYY-MM-DD
  close: Decimal;
}

export interface AssetCandidate {
  assetClass: "stock" | "etf" | "crypto";
  name: string;
  symbol: string;
  priceSource: "yahoo" | "coingecko";
  priceRef: string;
  exchange?: string;
  isin?: string;
}
