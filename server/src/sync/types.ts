import type { z } from "zod";
import type { FetchFn } from "../lib/http.js";

/** How a provider identifies an asset, before it is matched to a row in `assets`. */
export type AssetRef =
  | {
      kind: "crypto";
      symbol: string;
      // Exact CoinGecko id when known (native coins), avoiding symbol ambiguity.
      coingeckoId?: string;
      // Token contract (mint on Solana) and the chain it lives on.
      chain?: string;
      contract?: string;
      name?: string;
      // The exchange it came from, when that exchange's own EUR market can price it.
      venue?: "bitvavo";
    }
  | { kind: "fiat"; currency: string }
  | {
      kind: "security";
      isin?: string;
      symbol: string;
      currency: string;
      // Provider's exchange code (e.g. IBKR listingExchange "AEB").
      exchange?: string;
      name?: string;
      etf?: boolean;
    };

export interface Money {
  amount: string; // always positive
  currency: string; // fiat code or crypto symbol
}

/**
 * Provider-neutral account events. Quantities are the *net* change of the account balance, so
 * replaying them reproduces the exchange balance:
 * - trade buy: `quantity` received; `quote` debited (including any fee charged in the quote currency).
 * - trade sell: `quantity` debited (including any fee in the asset); `quote` credited (after fees).
 * - deposit / withdrawal: amount credited / debited (withdrawal includes the network fee).
 * `feeQuote` is the part of `quote` that was fee; it is reported, not subtracted again.
 * When `quote` is absent, `valueEur` (the EUR value of the trade) must be given and no cash is booked.
 */
export type SyncEvent =
  | {
      kind: "trade";
      id: string;
      at: Date;
      side: "buy" | "sell";
      asset: AssetRef;
      quantity: string;
      quote?: Money;
      // Full reference for the quote asset when a currency code isn't enough (on-chain tokens).
      quoteRef?: AssetRef;
      feeQuote?: string;
      valueEur?: string;
      note?: string;
    }
  | {
      kind: "deposit" | "withdrawal";
      id: string;
      at: Date;
      asset: AssetRef;
      quantity: string;
      valueEur?: string;
      note?: string;
    }
  | { kind: "reward"; id: string; at: Date; asset: AssetRef; quantity: string; valueEur?: string; note?: string }
  // Network fee paid in the asset itself (gas); leaves the account at cost, no gain or loss.
  | { kind: "fee"; id: string; at: Date; asset: AssetRef; quantity: string; note?: string }
  | {
      kind: "dividend";
      id: string;
      at: Date;
      asset: AssetRef;
      currency: string;
      gross: string;
      tax: string; // positive = withheld, negative = refunded
      note?: string;
    };

export interface Balance {
  asset: AssetRef;
  quantity: string;
}

export interface FetchResult {
  events: SyncEvent[];
  /** Current balances as reported by the provider, for reconciliation. Null when unavailable. */
  balances: Balance[] | null;
  /** "securities" when the provider's balances don't include cash. */
  balanceScope: "all" | "securities";
  cursor: Record<string, unknown> | null;
  warnings: string[];
}

export interface ProviderContext {
  fetchFn: FetchFn;
  cursor: Record<string, unknown> | null;
  /** Which of these external ids are already stored (or deliberately deleted) for this account. */
  isKnown(ids: string[]): Promise<Set<string>>;
  sleep(ms: number): Promise<void>;
}

export interface CredentialField {
  name: string;
  label: string;
  secret: boolean;
  multiline?: boolean;
  placeholder?: string;
}

export interface ExchangeProvider<C = Record<string, string>> {
  id: "bitvavo" | "kraken" | "coinbase" | "ibkr";
  label: string;
  accountKind: "exchange" | "broker";
  fields: CredentialField[];
  /** Step-by-step instructions for creating a read-only key. */
  instructions: string[];
  credentials: z.ZodType<C>;
  /** Short, non-secret identifier shown in the UI. */
  hint(creds: C): string;
  /** Cheap authenticated call that proves the credentials work. */
  test(creds: C, ctx: ProviderContext): Promise<void>;
  fetch(creds: C, ctx: ProviderContext): Promise<FetchResult>;
}

export class ProviderError extends Error {}
