import { createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { D } from "../lib/decimal.js";
import { getJson } from "../lib/http.js";
import type { AssetRef, Balance } from "../sync/types.js";
import { ChainError, type ChainAdapter, type ChainContext, type Fee, type Movement } from "./types.js";
import { msg, tr } from "../i18n/index.js";

const b58c = createBase58check(sha256);
const SUN = D(1_000_000);
const API = "https://api.trongrid.io";

/** Tron hex address (41…) → base58 (T…). */
export const tronHexToBase58 = (hex: string) =>
  b58c.encode(hexToBytes(hex.startsWith("0x") ? `41${hex.slice(2)}` : hex));

interface Meta {
  links?: { next?: string };
}

interface TrxTx {
  txID: string;
  block_timestamp: number;
  ret?: { contractRet?: string; fee?: number }[];
  energy_fee?: number;
  net_fee?: number;
  raw_data: {
    contract: {
      type: string;
      parameter: { value: { amount?: number; owner_address?: string; to_address?: string } };
    }[];
  };
}

interface Trc20Tx {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  value: string;
  type: string;
  token_info: { address: string; symbol: string; decimals: number; name: string };
}

export function tronAdapter(): ChainAdapter {
  const native: AssetRef = { kind: "crypto", symbol: "TRX", coingeckoId: "tron", name: "TRON" };

  async function all<T>(ctx: ChainContext, url: string): Promise<T[]> {
    const out: T[] = [];
    for (let next: string | undefined = url; next;) {
      const page: { data: T[]; meta?: Meta } = await getJson<{ data: T[]; meta?: Meta }>(next, {
        fetchFn: ctx.fetchFn,
        retries: 3,
      });
      out.push(...page.data);
      next = page.meta?.links?.next;
      // Only follow pagination links that stay on TronGrid.
      if (next && !next.startsWith(`${API}/`))
        throw new ChainError(tr("TronGrid returned an unexpected next-page link"));
      // Without an API key TronGrid allows only a few requests per second.
      if (next) await ctx.sleep(400);
    }
    return out;
  }

  return {
    id: "tron",
    label: "Tron",
    nativeSymbol: "TRX",
    addressHint: msg("T… address"),
    supportsXpub: false,

    normalise(input) {
      const s = input.trim();
      try {
        const raw = b58c.decode(s);
        if (raw.length === 21 && raw[0] === 0x41) return s;
      } catch {
        // fall through
      }
      throw new ChainError(tr("Not a valid Tron address (starts with T)"));
    },

    async fetch(inputs, ctx) {
      const since = (ctx.cursor?.lastTs as Record<string, number> | undefined) ?? {};
      const next: Record<string, number> = {};
      const movements: Movement[] = [];
      const fees: Fee[] = [];
      const balances: Balance[] = [];

      for (const { address } of inputs) {
        // Re-read an hour of overlap; duplicates are dropped by id.
        const min = since[address] ? since[address]! - 3_600_000 : 0;
        let maxTs = since[address] ?? 0;
        const decimals = new Map<string, { decimals: number; symbol: string; name: string }>();

        const txs = await all<TrxTx>(
          ctx,
          `${API}/v1/accounts/${address}/transactions?only_confirmed=true&limit=200&min_timestamp=${min}`,
        );
        for (const t of txs) {
          maxTs = Math.max(maxTs, t.block_timestamp);
          const at = new Date(t.block_timestamp);
          const c = t.raw_data.contract[0];
          if (!c) continue;
          const v = c.parameter.value;
          const owner = v.owner_address ? tronHexToBase58(v.owner_address) : "";
          if (owner === address) {
            const fee = t.ret?.[0]?.fee ?? (t.energy_fee ?? 0) + (t.net_fee ?? 0);
            if (fee > 0) fees.push({ tx: t.txID, at, asset: native, amount: D(fee).div(SUN) });
          }
          if (c.type !== "TransferContract" || t.ret?.[0]?.contractRet !== "SUCCESS" || !v.amount) continue;
          const amount = D(v.amount).div(SUN);
          const to = v.to_address ? tronHexToBase58(v.to_address) : "";
          if (owner === address) movements.push({ tx: t.txID, at, asset: native, amount: amount.neg() });
          if (to === address) movements.push({ tx: t.txID, at, asset: native, amount });
        }

        const trc20 = await all<Trc20Tx>(
          ctx,
          `${API}/v1/accounts/${address}/transactions/trc20?only_confirmed=true&limit=200&min_timestamp=${min}`,
        );
        for (const t of trc20) {
          maxTs = Math.max(maxTs, t.block_timestamp);
          if (t.type !== "Transfer") continue;
          const ti = t.token_info;
          decimals.set(ti.address, { decimals: ti.decimals, symbol: ti.symbol, name: ti.name });
          const asset: AssetRef = {
            kind: "crypto",
            symbol: ti.symbol.toUpperCase(),
            name: ti.name,
            chain: "tron",
            contract: ti.address,
          };
          const amount = D(t.value).div(D(10).pow(ti.decimals));
          const at = new Date(t.block_timestamp);
          if (t.from === address) movements.push({ tx: t.transaction_id, at, asset, amount: amount.neg() });
          if (t.to === address) movements.push({ tx: t.transaction_id, at, asset, amount });
        }
        next[address] = maxTs;

        const acct = await getJson<{ data: { balance?: number; trc20?: Record<string, string>[] }[] }>(
          `${API}/v1/accounts/${address}`,
          {
            fetchFn: ctx.fetchFn,
            retries: 3,
          },
        );
        const d = acct.data[0];
        balances.push({
          asset: native,
          quantity: D(d?.balance ?? 0)
            .div(SUN)
            .toFixed(),
        });
        for (const entry of d?.trc20 ?? []) {
          for (const [contract, raw] of Object.entries(entry)) {
            const info = decimals.get(contract);
            // Without known decimals (no transfer seen) the raw balance can't be interpreted.
            if (!info) continue;
            balances.push({
              asset: { kind: "crypto", symbol: info.symbol.toUpperCase(), name: info.name, chain: "tron", contract },
              quantity: D(raw).div(D(10).pow(info.decimals)).toFixed(),
            });
          }
        }
      }
      return { movements, fees, balances, cursor: { lastTs: { ...since, ...next } }, warnings: [] };
    },
  };
}
