import { D, type Decimal } from "../lib/decimal.js";
import type { AssetRef, Balance } from "../sync/types.js";
import { ChainError, type ChainAdapter, type ChainContext, type Fee, type Movement } from "./types.js";

/**
 * EVM chains without a free explorer API, read through Ankr's Advanced API (a free account, 50
 * requests a minute). Ankr reports transactions and token transfers but not internal
 * transactions, so the native coin paid out by a contract (e.g. swapping a token for BNB) is
 * missing; the balance check shows it as a difference.
 */
export interface AnkrChain {
  id: string;
  label: string;
  // Ankr's blockchain name.
  ankr: string;
  native: { symbol: string; coingeckoId: string; name: string };
}

export const BSC: AnkrChain = {
  id: "bsc",
  label: "BNB Chain",
  ankr: "bsc",
  native: { symbol: "BNB", coingeckoId: "binancecoin", name: "BNB" },
};

const ENDPOINT = "https://rpc.ankr.com/multichain/";
// Freemium allows 50 Advanced API requests a minute.
const SPACING_MS = 1_300;
const PAGE_SIZE = 1_000;

interface AnkrTx {
  hash: string;
  blockNumber: string;
  timestamp: string;
  from: string;
  to?: string | null;
  value: string;
  gasPrice?: string;
  gasUsed?: string;
  status?: string;
}

interface AnkrTransfer {
  transactionHash: string;
  blockHeight: number;
  timestamp: number;
  fromAddress?: string;
  toAddress?: string;
  contractAddress?: string;
  value: string;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals: number;
}

interface AnkrAsset {
  tokenType: string;
  tokenSymbol: string;
  tokenName: string;
  contractAddress?: string;
  balance: string;
}

const WEI = D(10).pow(18);
const lc = (s: string | undefined | null) => (s ?? "").toLowerCase();
const hex = (s: string | undefined | null): Decimal => D(BigInt(s || "0x0").toString());

export function ankrAdapter(c: AnkrChain, apiKey = process.env.ANKR_API_KEY?.trim()): ChainAdapter {
  const native: AssetRef = {
    kind: "crypto",
    symbol: c.native.symbol,
    coingeckoId: c.native.coingeckoId,
    name: c.native.name,
  };
  const unavailable = apiKey
    ? undefined
    : `${c.label} needs a free Ankr API key: set ANKR_API_KEY (see the README) and restart.`;
  let id = 0;
  let calls = 0;

  async function rpc<T>(ctx: ChainContext, method: string, params: Record<string, unknown>): Promise<T> {
    if (calls++ > 0) await ctx.sleep(SPACING_MS);
    for (let attempt = 0; ; attempt++) {
      const res = await ctx.fetchFn(ENDPOINT + apiKey, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
      if (res.ok && data?.result !== undefined && !data.error) return data.result;
      const message = data?.error?.message ?? `HTTP ${res.status}`;
      if ((res.status === 429 || res.status >= 500 || /rate limit|too many/i.test(message)) && attempt < 4) {
        await ctx.sleep(15_000 * (attempt + 1));
        continue;
      }
      if (res.status === 401 || res.status === 403 || /api key|unauthori[sz]ed|forbidden/i.test(message))
        throw new ChainError(`Ankr refused the API key (${message}). Check ANKR_API_KEY.`);
      throw new ChainError(`Ankr: ${message}`);
    }
  }

  async function pages<T>(
    ctx: ChainContext,
    method: string,
    params: Record<string, unknown>,
    key: "transactions" | "transfers",
  ): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;
    do {
      const r = await rpc<Record<string, unknown> & { nextPageToken?: string }>(ctx, method, {
        ...params,
        blockchain: [c.ankr],
        pageSize: PAGE_SIZE,
        descOrder: false,
        ...(pageToken ? { pageToken } : {}),
      });
      out.push(...((r[key] as T[] | undefined) ?? []));
      pageToken = r.nextPageToken || undefined;
    } while (pageToken);
    return out;
  }

  return {
    id: c.id,
    label: c.label,
    nativeSymbol: c.native.symbol,
    addressHint: "0x… address (same address works on every EVM chain)",
    supportsXpub: false,
    evm: true,
    unavailable,

    normalise(input) {
      const s = input.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(s))
        throw new ChainError("Not a valid EVM address (0x followed by 40 hex characters)");
      return s.toLowerCase();
    },

    async fetch(inputs, ctx) {
      if (unavailable) throw new ChainError(unavailable);
      calls = 0;
      const ours = new Set(inputs.map((i) => lc(i.address)));
      const lastBlocks = (ctx.cursor?.lastBlock as Record<string, number> | undefined) ?? {};
      const newLastBlocks: Record<string, number> = {};
      const movements: Movement[] = [];
      const fees: Fee[] = [];
      const balances: Balance[] = [];
      // Re-read a few blocks of overlap; the same transaction yields the same event ids.
      const since = (a: string) => (lastBlocks[a] ? Math.max(0, lastBlocks[a]! - 50) : 0);

      const seenTx = new Set<string>();
      for (const input of inputs) {
        const a = lc(input.address);
        let maxBlock = lastBlocks[a] ?? 0;
        const txs = await pages<AnkrTx>(
          ctx,
          "ankr_getTransactionsByAddress",
          { address: a, fromBlock: since(a) },
          "transactions",
        );
        for (const t of txs) {
          const block = Number(hex(t.blockNumber));
          maxBlock = Math.max(maxBlock, block);
          if (seenTx.has(t.hash)) continue;
          seenTx.add(t.hash);
          const at = new Date(Number(hex(t.timestamp)) * 1000);
          const value = hex(t.value).div(WEI);
          // Missing status: a transaction from before receipts carried one, which succeeded.
          const ok = !t.status || t.status === "0x1";
          if (ok && !value.isZero()) {
            if (ours.has(lc(t.from))) movements.push({ tx: t.hash, at, asset: native, amount: value.neg() });
            if (ours.has(lc(t.to))) movements.push({ tx: t.hash, at, asset: native, amount: value });
          }
          // The sender pays gas even when the transaction fails.
          const fee = hex(t.gasUsed).mul(hex(t.gasPrice)).div(WEI);
          if (ours.has(lc(t.from)) && fee.gt(0)) fees.push({ tx: t.hash, at, asset: native, amount: fee });
        }
        newLastBlocks[a] = maxBlock;
      }

      // One query for all addresses, so a transfer between two of them comes back once.
      const from = Math.min(...inputs.map((i) => since(lc(i.address))));
      const transfers = await pages<AnkrTransfer>(
        ctx,
        "ankr_getTokenTransfers",
        { address: [...ours], fromBlock: from },
        "transfers",
      );
      const seenTransfer = new Set<string>();
      for (const tt of transfers) {
        const contract = lc(tt.contractAddress);
        if (!contract || !tt.value) continue;
        const key = [tt.transactionHash, contract, lc(tt.fromAddress), lc(tt.toAddress), tt.value].join("|");
        if (seenTransfer.has(key)) continue;
        seenTransfer.add(key);
        for (const a of ours) {
          if (tt.blockHeight > (newLastBlocks[a] ?? 0)) newLastBlocks[a] = tt.blockHeight;
        }
        const amount = D(tt.value);
        const asset: AssetRef = {
          kind: "crypto",
          symbol: (tt.tokenSymbol || "?").toUpperCase(),
          name: tt.tokenName || undefined,
          chain: c.id,
          contract,
        };
        const at = new Date(tt.timestamp * 1000);
        if (ours.has(lc(tt.fromAddress))) movements.push({ tx: tt.transactionHash, at, asset, amount: amount.neg() });
        if (ours.has(lc(tt.toAddress))) movements.push({ tx: tt.transactionHash, at, asset, amount });
      }

      for (const a of ours) {
        const r = await rpc<{ assets: AnkrAsset[] }>(ctx, "ankr_getAccountBalance", {
          walletAddress: a,
          blockchain: [c.ankr],
          onlyWhitelisted: false,
        });
        for (const b of r.assets ?? []) {
          if (b.tokenType === "NATIVE") balances.push({ asset: native, quantity: D(b.balance).toFixed() });
          else if (b.contractAddress)
            balances.push({
              asset: {
                kind: "crypto",
                symbol: (b.tokenSymbol || "?").toUpperCase(),
                name: b.tokenName || undefined,
                chain: c.id,
                contract: lc(b.contractAddress),
              },
              quantity: D(b.balance).toFixed(),
            });
        }
      }

      return {
        movements,
        fees,
        balances,
        cursor: { lastBlock: { ...lastBlocks, ...newLastBlocks } },
        warnings: [],
      };
    },
  };
}
