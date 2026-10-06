import { D } from "../lib/decimal.js";
import { getJson } from "../lib/http.js";
import type { AssetRef, Balance } from "../sync/types.js";
import { ChainError, type ChainAdapter, type ChainContext, type Fee, type Movement } from "./types.js";

interface EvmChain {
  id: string;
  label: string;
  // Blockscout instance (free, no API key).
  explorer: string;
  native: { symbol: string; coingeckoId: string; name: string };
}

const ETH = { symbol: "ETH", coingeckoId: "ethereum", name: "Ethereum" };

export const EVM_CHAINS: EvmChain[] = [
  { id: "ethereum", label: "Ethereum", explorer: "https://eth.blockscout.com", native: ETH },
  { id: "arbitrum", label: "Arbitrum One", explorer: "https://arbitrum.blockscout.com", native: ETH },
  { id: "optimism", label: "Optimism", explorer: "https://explorer.optimism.io", native: ETH },
  { id: "base", label: "Base", explorer: "https://base.blockscout.com", native: ETH },
  {
    id: "polygon",
    label: "Polygon PoS",
    explorer: "https://polygon.blockscout.com",
    native: { symbol: "POL", coingeckoId: "polygon-ecosystem-token", name: "Polygon" },
  },
  { id: "unichain", label: "Unichain", explorer: "https://unichain.blockscout.com", native: ETH },
  { id: "ink", label: "Ink", explorer: "https://explorer.inkonchain.com", native: ETH },
  { id: "soneium", label: "Soneium", explorer: "https://soneium.blockscout.com", native: ETH },
];

interface Page<T> {
  items: T[];
  next_page_params: Record<string, string | number | null> | null;
}

interface BsTx {
  hash: string;
  timestamp: string;
  block_number: number;
  value: string;
  status: string | null;
  result: string;
  from: { hash: string };
  to: { hash: string } | null;
  fee: { value: string } | null;
}

interface BsInternal {
  transaction_hash: string;
  timestamp: string;
  block_number: number;
  index: number;
  value: string;
  success: boolean;
  from: { hash: string };
  to: { hash: string } | null;
}

interface BsToken {
  address_hash?: string;
  address?: string;
  symbol: string | null;
  name: string | null;
  decimals: string | null;
  type: string;
  reputation?: string | null;
}

interface BsTokenTransfer {
  transaction_hash: string;
  timestamp: string;
  block_number: number;
  log_index: number;
  from: { hash: string };
  to: { hash: string };
  token: BsToken;
  total: { value: string; decimals: string | null } | null;
}

const WEI = D(10).pow(18);
const lc = (s: string | undefined | null) => (s ?? "").toLowerCase();
const tokenAddr = (t: BsToken) => lc(t.address_hash ?? t.address);

export function evmAdapter(c: EvmChain): ChainAdapter {
  const native: AssetRef = {
    kind: "crypto",
    symbol: c.native.symbol,
    coingeckoId: c.native.coingeckoId,
    name: c.native.name,
  };
  const api = `${c.explorer}/api/v2`;

  /** Pages newest-first until items are older than `sinceBlock` (incremental) or history ends. */
  async function pages<T extends { block_number: number }>(
    ctx: ChainContext,
    path: string,
    sinceBlock: number,
  ): Promise<T[]> {
    const out: T[] = [];
    let params: Record<string, string | number | null> | null = {};
    while (params) {
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)]),
      ).toString();
      const sep = path.includes("?") ? "&" : "?";
      const page: Page<T> = await getJson<Page<T>>(`${api}${path}${qs ? sep + qs : ""}`, {
        fetchFn: ctx.fetchFn,
        retries: 3,
        timeoutMs: 30_000,
      });
      const fresh = page.items.filter((i) => i.block_number >= sinceBlock);
      out.push(...fresh);
      if (fresh.length < page.items.length) break;
      params = page.next_page_params;
      if (params) await ctx.sleep(200);
    }
    return out;
  }

  return {
    id: c.id,
    label: c.label,
    nativeSymbol: c.native.symbol,
    addressHint: "0x… address (same address works on every EVM chain)",
    supportsXpub: false,
    evm: true,

    normalise(input) {
      const s = input.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(s))
        throw new ChainError("Not a valid EVM address (0x followed by 40 hex characters)");
      return s.toLowerCase();
    },

    async fetch(inputs, ctx) {
      const ours = new Set(inputs.map((i) => lc(i.address)));
      const lastBlocks = (ctx.cursor?.lastBlock as Record<string, number> | undefined) ?? {};
      const newLastBlocks: Record<string, number> = {};
      const movements: Movement[] = [];
      const fees: Fee[] = [];
      const spam = new Set<string>();
      const seenTx = new Set<string>();
      const seenInternal = new Set<string>();
      const seenTransfer = new Set<string>();
      const balances: Balance[] = [];

      for (const input of inputs) {
        const a = lc(input.address);
        // Re-read a few blocks of overlap; duplicates are dropped by id.
        const since = lastBlocks[a] ? lastBlocks[a]! - 50 : 0;
        let maxBlock = lastBlocks[a] ?? 0;

        for (const t of await pages<BsTx>(ctx, `/addresses/${input.address}/transactions`, since)) {
          maxBlock = Math.max(maxBlock, t.block_number);
          if (seenTx.has(t.hash)) continue;
          seenTx.add(t.hash);
          const at = new Date(t.timestamp);
          const ok = t.result === "success" || t.status === "ok";
          const value = D(t.value || 0).div(WEI);
          if (ok && !value.isZero()) {
            if (ours.has(lc(t.from.hash))) movements.push({ tx: t.hash, at, asset: native, amount: value.neg() });
            if (t.to && ours.has(lc(t.to.hash))) movements.push({ tx: t.hash, at, asset: native, amount: value });
          }
          // The sender pays gas even when the transaction fails.
          if (ours.has(lc(t.from.hash)) && t.fee?.value)
            fees.push({ tx: t.hash, at, asset: native, amount: D(t.fee.value).div(WEI) });
        }

        for (const it of await pages<BsInternal>(ctx, `/addresses/${input.address}/internal-transactions`, since)) {
          maxBlock = Math.max(maxBlock, it.block_number);
          const key = `${it.transaction_hash}:${it.index}`;
          // index 0 is the top-level call, already counted above.
          if (it.index === 0 || !it.success || seenInternal.has(key)) continue;
          seenInternal.add(key);
          const value = D(it.value || 0).div(WEI);
          if (value.isZero()) continue;
          const at = new Date(it.timestamp);
          if (ours.has(lc(it.from.hash)))
            movements.push({ tx: it.transaction_hash, at, asset: native, amount: value.neg() });
          if (it.to && ours.has(lc(it.to.hash)))
            movements.push({ tx: it.transaction_hash, at, asset: native, amount: value });
        }

        for (const tt of await pages<BsTokenTransfer>(
          ctx,
          `/addresses/${input.address}/token-transfers?type=ERC-20`,
          since,
        )) {
          maxBlock = Math.max(maxBlock, tt.block_number);
          const key = `${tt.transaction_hash}:${tt.log_index}`;
          if (seenTransfer.has(key) || !tt.total?.value) continue;
          seenTransfer.add(key);
          const contract = tokenAddr(tt.token);
          if (tt.token.reputation && tt.token.reputation !== "ok") spam.add(contract);
          const decimals = Number(tt.total.decimals ?? tt.token.decimals ?? 18);
          const amount = D(tt.total.value).div(D(10).pow(decimals));
          const asset: AssetRef = {
            kind: "crypto",
            symbol: (tt.token.symbol ?? "?").toUpperCase(),
            name: tt.token.name ?? undefined,
            chain: c.id,
            contract,
          };
          const at = new Date(tt.timestamp);
          if (ours.has(lc(tt.from.hash))) movements.push({ tx: tt.transaction_hash, at, asset, amount: amount.neg() });
          if (ours.has(lc(tt.to.hash))) movements.push({ tx: tt.transaction_hash, at, asset, amount });
        }
        newLastBlocks[a] = maxBlock;

        const info = await getJson<{ coin_balance: string | null }>(`${api}/addresses/${input.address}`, {
          fetchFn: ctx.fetchFn,
          retries: 3,
        });
        balances.push({
          asset: native,
          quantity: D(info.coin_balance ?? 0)
            .div(WEI)
            .toFixed(),
        });
        const tokens = await getJson<{ token: BsToken; value: string }[]>(
          `${api}/addresses/${input.address}/token-balances`,
          {
            fetchFn: ctx.fetchFn,
            retries: 3,
            timeoutMs: 30_000,
          },
        );
        for (const tb of tokens) {
          if (tb.token.type !== "ERC-20" || !tb.token.decimals) continue;
          const contract = tokenAddr(tb.token);
          if (tb.token.reputation && tb.token.reputation !== "ok") spam.add(contract);
          balances.push({
            asset: {
              kind: "crypto",
              symbol: (tb.token.symbol ?? "?").toUpperCase(),
              name: tb.token.name ?? undefined,
              chain: c.id,
              contract,
            },
            quantity: D(tb.value)
              .div(D(10).pow(Number(tb.token.decimals)))
              .toFixed(),
          });
        }
      }

      return {
        movements,
        fees,
        balances,
        cursor: { lastBlock: { ...lastBlocks, ...newLastBlocks } },
        warnings: [],
        spamContracts: [...spam],
      };
    },
  };
}
