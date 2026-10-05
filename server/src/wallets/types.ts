import type { Decimal } from "../lib/decimal.js";
import type { FetchFn } from "../lib/http.js";
import type { AssetRef, Balance } from "../sync/types.js";

export interface WalletInput {
  address: string;
  scriptType?: string | null;
}

/** A signed change of one asset in our addresses within one on-chain transaction. */
export interface Movement {
  tx: string;
  at: Date;
  asset: AssetRef;
  amount: Decimal; // positive = received, negative = sent (excluding the network fee)
}

/** Network fee paid by one of our addresses for a transaction. */
export interface Fee {
  tx: string;
  at: Date;
  asset: AssetRef;
  amount: Decimal;
}

export interface ChainFetchResult {
  movements: Movement[];
  fees: Fee[];
  balances: Balance[];
  cursor: Record<string, unknown>;
  warnings: string[];
  /** Token contracts the chain explorer itself flags as spam; never looked up or imported. */
  spamContracts?: string[];
  /** True when older history is still being backfilled in later syncs (rate-limited chains). */
  partial?: boolean;
  /** e.g. number of addresses derived from an xpub. */
  info?: string;
}

export interface ChainContext {
  fetchFn: FetchFn;
  sleep(ms: number): Promise<void>;
  cursor: Record<string, unknown> | null;
}

export interface ChainAdapter {
  id: string;
  label: string;
  nativeSymbol: string;
  /** Placeholder / help text for the address field. */
  addressHint: string;
  supportsXpub: boolean;
  /** Returns the normalised address/xpub, or throws with a user-facing message. */
  normalise(input: string): string;
  fetch(inputs: WalletInput[], ctx: ChainContext): Promise<ChainFetchResult>;
}

export class ChainError extends Error {}
