import { base58 } from "@scure/base";
import { D, type Decimal } from "../lib/decimal.js";
import type { AssetRef, Balance } from "../sync/types.js";
import { ChainError, type ChainAdapter, type ChainContext, type Fee, type Movement } from "./types.js";
import { msg, tr } from "../i18n/index.js";

const LAMPORTS = D(1_000_000_000);
const WSOL = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
// The public RPC allows ~40 getTransaction calls per 10 s; stay a bit below.
const TX_SPACING_MS = 300;
// Transactions fetched per sync; the rest continues on the next sync.
const TX_BUDGET = 1500;

interface SigInfo {
  signature: string;
  blockTime: number | null;
  err: unknown;
}

interface TokenBal {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

interface SolTx {
  blockTime: number | null;
  meta: {
    fee: number;
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBal[];
    postTokenBalances?: TokenBal[];
  } | null;
  transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } };
}

interface AddrCursor {
  // Newest signature processed. Everything up to and including it is imported.
  newest?: string;
}

export function solanaAdapter(
  rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
): ChainAdapter {
  const native: AssetRef = { kind: "crypto", symbol: "SOL", coingeckoId: "solana", name: "Solana" };
  let id = 0;

  async function rpc<T>(ctx: ChainContext, method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await ctx.fetchFn(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 5) throw new ChainError(`Solana RPC: HTTP ${res.status}`);
        await ctx.sleep(2_000 * (attempt + 1));
        continue;
      }
      const data = (await res.json()) as { result?: T; error?: { message: string } };
      if (data.error) throw new ChainError(`Solana RPC: ${data.error.message}`);
      return data.result as T;
    }
  }

  const keyOf = (k: { pubkey: string } | string) => (typeof k === "string" ? k : k.pubkey);

  /** Our SOL and token changes in one transaction, plus the fee if we paid it. */
  function parse(sig: string, tx: SolTx, address: string, movements: Movement[], fees: Fee[]) {
    if (!tx.meta) return;
    const at = new Date((tx.blockTime ?? 0) * 1000);
    const keys = tx.transaction.message.accountKeys.map(keyOf);
    const idx = keys.indexOf(address);
    const feePayer = keys[0] === address;
    const fee = feePayer ? D(tx.meta.fee).div(LAMPORTS) : D(0);
    if (idx >= 0) {
      const net = D(tx.meta.postBalances[idx] ?? 0)
        .minus(tx.meta.preBalances[idx] ?? 0)
        .div(LAMPORTS)
        .plus(fee);
      if (!net.isZero()) movements.push({ tx: sig, at, asset: native, amount: net });
    }
    if (fee.gt(0)) fees.push({ tx: sig, at, asset: native, amount: fee });

    // Token balance changes of token accounts owned by this address.
    const changes = new Map<string, Decimal>();
    const apply = (list: TokenBal[] | undefined, sign: 1 | -1) => {
      for (const b of list ?? []) {
        if (b.owner !== address) continue;
        const amt = D(b.uiTokenAmount.amount).div(D(10).pow(b.uiTokenAmount.decimals)).mul(sign);
        changes.set(b.mint, (changes.get(b.mint) ?? D(0)).plus(amt));
      }
    };
    apply(tx.meta.postTokenBalances, 1);
    apply(tx.meta.preTokenBalances, -1);
    for (const [mint, amount] of changes) {
      if (amount.isZero()) continue;
      // Wrapped SOL is SOL; wrapping/unwrapping nets out against the native change.
      const asset: AssetRef =
        mint === WSOL ? native : { kind: "crypto", symbol: mint.slice(0, 6), chain: "solana", contract: mint };
      movements.push({ tx: sig, at, asset, amount });
    }
  }

  return {
    id: "solana",
    label: "Solana",
    nativeSymbol: "SOL",
    addressHint: msg("Solana wallet address (base58)"),
    supportsXpub: false,

    normalise(input) {
      const s = input.trim();
      try {
        if (base58.decode(s).length === 32) return s;
      } catch {
        // fall through
      }
      throw new ChainError(tr("Not a valid Solana address"));
    },

    async fetch(inputs, ctx) {
      const cursors = (ctx.cursor?.addresses as Record<string, AddrCursor> | undefined) ?? {};
      const next: Record<string, AddrCursor> = {};
      const movements: Movement[] = [];
      const fees: Fee[] = [];
      const balances: Balance[] = [];
      let budget = TX_BUDGET;
      let partial = false;

      for (const { address } of inputs) {
        const cur = cursors[address] ?? {};
        // All signatures newer than the cursor (on the first sync: the whole history), newest first.
        const sigs: SigInfo[] = [];
        for (let before: string | undefined; ;) {
          const page = await rpc<SigInfo[]>(ctx, "getSignaturesForAddress", [
            address,
            { limit: 1000, before, until: cur.newest },
          ]);
          sigs.push(...page);
          if (page.length < 1000) break;
          before = page[page.length - 1]!.signature;
        }
        // Process oldest first, so the cursor only ever advances over a contiguous imported range.
        const todo = sigs.reverse().slice(0, Math.max(0, budget));
        for (const s of todo) {
          const tx = await rpc<SolTx | null>(ctx, "getTransaction", [
            s.signature,
            { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" },
          ]);
          if (tx) parse(s.signature, tx, address, movements, fees);
          await ctx.sleep(TX_SPACING_MS);
        }
        budget -= todo.length;
        if (todo.length < sigs.length) partial = true;
        next[address] = todo.length ? { newest: todo[todo.length - 1]!.signature } : cur;

        const lamports = await rpc<{ value: number }>(ctx, "getBalance", [address, { commitment: "finalized" }]);
        balances.push({ asset: native, quantity: D(lamports.value).div(LAMPORTS).toFixed() });
        const byMint = new Map<string, Decimal>();
        for (const programId of TOKEN_PROGRAMS) {
          const res = await rpc<{
            value: {
              account: {
                data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } };
              };
            }[];
          }>(ctx, "getTokenAccountsByOwner", [
            address,
            { programId },
            { encoding: "jsonParsed", commitment: "finalized" },
          ]);
          for (const acc of res.value) {
            const { mint, tokenAmount } = acc.account.data.parsed.info;
            const amt = D(tokenAmount.amount).div(D(10).pow(tokenAmount.decimals));
            if (amt.isZero()) continue;
            byMint.set(mint, (byMint.get(mint) ?? D(0)).plus(amt));
          }
        }
        for (const [mint, q] of byMint) {
          balances.push({
            asset:
              mint === WSOL ? native : { kind: "crypto", symbol: mint.slice(0, 6), chain: "solana", contract: mint },
            quantity: q.toFixed(),
          });
        }
      }

      return {
        movements,
        fees,
        balances,
        cursor: { addresses: { ...cursors, ...next } },
        warnings: partial
          ? ["Large history: the remaining Solana transactions import over the next syncs (public RPC rate limit)."]
          : [],
        partial,
      };
    },
  };
}
