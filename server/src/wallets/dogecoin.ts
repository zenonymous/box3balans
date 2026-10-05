import { D, type Decimal } from "../lib/decimal.js";
import { HttpRequestError } from "../lib/http.js";
import type { AssetRef } from "../sync/types.js";
import { type UtxoChain, addressFor, isValidAddress, parseExtendedKey } from "./bitcoin.js";
import { ChainError, type ChainAdapter, type ChainContext, type Fee, type Movement } from "./types.js";

/** Dogecoin has no SegWit: legacy (D…) and P2SH (9…/A…) addresses, BIP44 keys as dgub or xpub. */
export const DOGECOIN: UtxoChain = {
  id: "dogecoin",
  label: "Dogecoin",
  symbol: "DOGE",
  coingeckoId: "dogecoin",
  api: "https://api.blockcypher.com/v1/doge/main",
  hrp: "doge",
  p2pkh: 0x1e,
  p2sh: 0x16,
  versions: { "02facafd": "p2pkh", "0488b21e": "p2pkh" },
};

const KOINU = D(100_000_000);
const GAP_LIMIT = 20;
const PAGE = 50;
// BlockCypher without a token: 3 requests a second, 100 an hour.
const SPACING_MS = 400;

interface BcAddress {
  balance: number;
  n_tx: number;
  hasMore?: boolean;
  txs?: BcTx[];
}

interface BcTx {
  hash: string;
  block_height: number;
  confirmed?: string;
  fees: number;
  inputs: { addresses?: string[] | null; output_value?: number }[];
  outputs: { addresses?: string[] | null; value: number }[];
}

class RateLimited extends Error {}

const isExtendedKey = (s: string) => /^[a-zA-Z]{4}[1-9A-HJ-NP-Za-km-z]{100,}$/.test(s.trim());

export function dogecoinAdapter(c: UtxoChain = DOGECOIN): ChainAdapter {
  const native: AssetRef = { kind: "crypto", symbol: c.symbol, coingeckoId: c.coingeckoId, name: c.label };

  async function get<T>(ctx: ChainContext, path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await ctx.fetchFn(`${c.api}${path}`, { signal: AbortSignal.timeout(30_000) });
      await ctx.sleep(SPACING_MS);
      if (res.status === 429) {
        // A per-second burst clears quickly; the hourly allowance doesn't.
        if (attempt < 2) {
          await ctx.sleep(2_000);
          continue;
        }
        throw new RateLimited();
      }
      if (res.status >= 500 && attempt < 2) continue;
      if (!res.ok) throw new HttpRequestError(`BlockCypher: HTTP ${res.status}`, res.status);
      return (await res.json()) as T;
    }
  }

  /** Confirmed transactions of an address above `after` (block height), newest first. */
  async function newTxs(ctx: ChainContext, address: string, after: number) {
    const txs = new Map<string, BcTx>();
    let before: number | undefined;
    let info: BcAddress | undefined;
    for (;;) {
      const q = `limit=${PAGE}&txlimit=1000&after=${after}${before ? `&before=${before}` : ""}`;
      const page = await get<BcAddress>(ctx, `/addrs/${address}/full?${q}`);
      info ??= page;
      let added = 0;
      for (const t of page.txs ?? []) {
        if (t.block_height < 0 || txs.has(t.hash)) continue;
        txs.set(t.hash, t);
        added++;
      }
      if (!page.hasMore || added === 0) break;
      // `before` is exclusive; ask from the lowest block again so a block split over pages isn't lost.
      before = Math.min(...(page.txs ?? []).filter((t) => t.block_height >= 0).map((t) => t.block_height)) + 1;
    }
    return { info: info!, txs: [...txs.values()] };
  }

  return {
    id: c.id,
    label: c.label,
    nativeSymbol: c.symbol,
    addressHint: "D… address, or a dgub/xpub extended public key",
    supportsXpub: true,

    normalise(input) {
      const s = input.trim();
      if (isExtendedKey(s)) {
        parseExtendedKey(c, s);
        return s;
      }
      if (!isValidAddress(c, s) || s.toLowerCase().startsWith(`${c.hrp}1`)) {
        throw new ChainError(`Not a valid ${c.label} address`);
      }
      return s;
    },

    async fetch(inputs, ctx) {
      const prev = (ctx.cursor ?? {}) as {
        heights?: Record<string, number>;
        derived?: Record<string, string[]>;
      };
      const heights = { ...(prev.heights ?? {}) };
      const derived = { ...(prev.derived ?? {}) };
      const warnings: string[] = [];
      let partial = false;

      // Our addresses: plain ones, plus those derived from extended keys (receive and change chain,
      // until 20 unused in a row). Known used addresses come from the cursor; only the gap is checked.
      const addresses = new Set(inputs.filter((i) => !isExtendedKey(i.address)).map((i) => i.address));
      try {
        for (const input of inputs.filter((i) => isExtendedKey(i.address))) {
          const { hd } = parseExtendedKey(c, input.address);
          const used = new Set(derived[input.address] ?? []);
          for (const branch of [0, 1]) {
            let gap = 0;
            for (let i = 0; gap < GAP_LIMIT; i++) {
              const a = addressFor(c, hd.deriveChild(branch).deriveChild(i).publicKey!, "p2pkh");
              if (used.has(a)) {
                gap = 0;
                continue;
              }
              const info = await get<BcAddress>(ctx, `/addrs/${a}/balance`);
              if (info.n_tx > 0) {
                used.add(a);
                gap = 0;
              } else gap++;
            }
          }
          derived[input.address] = [...used];
          for (const a of used) addresses.add(a);
        }
      } catch (err) {
        if (!(err instanceof RateLimited)) throw err;
        partial = true;
      }

      const txs = new Map<string, BcTx>();
      let balance: Decimal = D(0);
      if (!partial) {
        try {
          for (const a of addresses) {
            const { info, txs: list } = await newTxs(ctx, a, heights[a] ?? 0);
            balance = balance.plus(info.balance);
            for (const t of list) txs.set(t.hash, t);
            heights[a] = Math.max(heights[a] ?? 0, ...list.map((t) => t.block_height));
          }
        } catch (err) {
          if (!(err instanceof RateLimited)) throw err;
          partial = true;
        }
      }
      if (partial) {
        warnings.push(
          "BlockCypher's free limit (100 requests an hour) was reached; the rest of the history follows in the next sync.",
        );
      }

      const movements: Movement[] = [];
      const fees: Fee[] = [];
      for (const t of txs.values()) {
        const at = new Date(t.confirmed ?? 0);
        const mine = (addrs?: string[] | null) => !!addrs?.some((a) => addresses.has(a));
        let spent = D(0);
        let received = D(0);
        let weSpend = false;
        for (const i of t.inputs) {
          if (mine(i.addresses)) {
            spent = spent.plus(i.output_value ?? 0);
            weSpend = true;
          }
        }
        for (const o of t.outputs) if (mine(o.addresses)) received = received.plus(o.value);
        const fee = weSpend ? D(t.fees) : D(0);
        const net = received.minus(spent).plus(fee);
        if (!net.isZero()) movements.push({ tx: t.hash, at, asset: native, amount: net.div(KOINU) });
        if (fee.gt(0)) fees.push({ tx: t.hash, at, asset: native, amount: fee.div(KOINU) });
      }

      return {
        movements,
        fees,
        // Only a complete pass has a meaningful balance to reconcile against.
        balances: partial ? [] : [{ asset: native, quantity: balance.div(KOINU).toFixed() }],
        // A partial pass keeps the old heights, so what was missed is fetched again next time.
        cursor: partial ? { heights: prev.heights ?? {}, derived } : { heights, derived },
        warnings,
        partial,
        info: Object.keys(derived).length
          ? `${Object.values(derived).reduce((n, a) => n + a.length, 0)} used addresses found from the extended key`
          : undefined,
      };
    },
  };
}
