import { bech32 } from "@scure/base";
import { D, type Decimal } from "../lib/decimal.js";
import { HttpRequestError } from "../lib/http.js";
import type { AssetRef, Balance } from "../sync/types.js";
import { ChainError, type ChainAdapter, type ChainContext, type Fee, type Movement, type Reward } from "./types.js";

const LOVELACE = D(1_000_000);
// Shelley epochs are five days; epoch 208 started 2020-07-29 21:44:51 UTC.
const SHELLEY_EPOCH = 208;
const SHELLEY_START = 1_596_059_091;
const EPOCH_SECONDS = 432_000;
const epochStart = (epoch: number) => new Date((SHELLEY_START + (epoch - SHELLEY_EPOCH) * EPOCH_SECONDS) * 1000);

// Koios's public tier limits request bodies to 1 KB: about ten transaction hashes per call.
const TX_BATCH = 10;
const PAGE = 1000;

interface KoiosOutput {
  payment_addr: { bech32: string } | null;
  stake_addr: string | null;
  value: string;
  asset_list:
    | { policy_id: string; asset_name: string | null; fingerprint: string; decimals: number | null; quantity: string }[]
    | null;
}

interface KoiosTx {
  tx_hash: string;
  tx_timestamp: number;
  block_height: number;
  fee: string;
  inputs: KoiosOutput[];
  outputs: KoiosOutput[];
  withdrawals: { amount: string; stake_addr: string }[] | null;
}

const bech32Bytes = (s: string, prefix: string): Uint8Array | null => {
  try {
    const { prefix: p, words } = bech32.decode(s.toLowerCase() as `${string}1${string}`, 1023);
    return p === prefix ? bech32.fromWords(words) : null;
  } catch {
    return null;
  }
};

/**
 * The stake (reward) address of a Shelley base address, which groups all addresses of a wallet,
 * or null for addresses without a stake part (enterprise, pointer).
 */
export function stakeAddressOf(address: string): string | null {
  const bytes = bech32Bytes(address, "addr");
  if (!bytes || bytes.length !== 57) return null;
  const type = bytes[0]! >> 4;
  if (type > 3) return null;
  const network = bytes[0]! & 0x0f;
  // Types 0/1 delegate with a key hash, 2/3 with a script hash.
  const header = ((type < 2 ? 0xe : 0xf) << 4) | network;
  return bech32.encode("stake", bech32.toWords(Uint8Array.of(header, ...bytes.slice(29))), 1023);
}

type TokenInfo = { policy_id: string; asset_name: string | null; fingerprint: string; decimals: number | null };

/** ASCII token name when printable, else the asset fingerprint. */
function tokenSymbol(a: TokenInfo): string {
  const hex = a.asset_name ?? "";
  const text = hex.length && hex.length % 2 === 0 ? Buffer.from(hex, "hex").toString("latin1") : "";
  return /^[\x20-\x7e]{1,16}$/.test(text) ? text.trim() : a.fingerprint.slice(0, 14);
}

// Native tokens are keyed by policy id + asset name: CoinGecko's Cardano contract format.
const tokenRef = (a: TokenInfo): AssetRef => ({
  kind: "crypto",
  symbol: tokenSymbol(a),
  chain: "cardano",
  contract: `${a.policy_id}${a.asset_name ?? ""}`.toLowerCase(),
});

export function cardanoAdapter(base = "https://api.koios.rest/api/v1"): ChainAdapter {
  const native: AssetRef = { kind: "crypto", symbol: "ADA", coingeckoId: "cardano", name: "Cardano" };

  async function call<T>(ctx: ChainContext, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await ctx.fetchFn(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      // Bursts over ~100 calls per 10 s get a 60 s pause from Koios.
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await ctx.sleep(res.status === 429 ? 61_000 : 3_000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new HttpRequestError(`Koios ${path.split("?")[0]}: HTTP ${res.status}`, res.status);
      await ctx.sleep(120);
      return (await res.json()) as T;
    }
  }

  /** All pages of a list endpoint (Koios returns at most 1000 rows per call). */
  async function all<T>(ctx: ChainContext, path: string, body?: unknown): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const sep = path.includes("?") ? "&" : "?";
      const page = await call<T[]>(ctx, `${path}${sep}limit=${PAGE}&offset=${offset}`, body);
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  }

  return {
    id: "cardano",
    label: "Cardano",
    nativeSymbol: "ADA",
    addressHint: "stake1… stake address, or any addr1… address of the wallet",
    supportsXpub: false,

    normalise(input) {
      const s = input.trim().toLowerCase();
      if (s.startsWith("stake1")) {
        const b = bech32Bytes(s, "stake");
        if (!b || b.length !== 29 || (b[0]! & 0x0f) !== 1) throw new ChainError("Not a valid Cardano stake address");
        return s;
      }
      if (s.startsWith("addr_test") || s.startsWith("stake_test"))
        throw new ChainError("Testnet addresses aren't tracked");
      if (!s.startsWith("addr1")) {
        throw new ChainError(
          "Use a stake1… address or a Shelley addr1… address (old Byron addresses aren't supported)",
        );
      }
      const b = bech32Bytes(s, "addr");
      if (!b || (b[0]! & 0x0f) !== 1) throw new ChainError("Not a valid Cardano address");
      // A wallet spreads its funds over many addresses that share one stake key; track them all.
      return stakeAddressOf(s) ?? s;
    },

    async fetch(inputs, ctx) {
      const lastBlock = (ctx.cursor?.lastBlock as Record<string, number> | undefined) ?? {};
      const nextBlock: Record<string, number> = {};
      const stakes = new Set(inputs.map((i) => i.address).filter((a) => a.startsWith("stake1")));
      const addrs = new Set(inputs.map((i) => i.address).filter((a) => a.startsWith("addr1")));

      // New transactions since the last sync, per stake address or plain address.
      const hashes = new Set<string>();
      for (const a of [...stakes, ...addrs]) {
        const after = lastBlock[a] ?? 0;
        const list = a.startsWith("stake1")
          ? await all<{ tx_hash: string; block_height: number }>(
              ctx,
              `/account_txs?_stake_address=${a}&_after_block_height=${after}`,
            )
          : await all<{ tx_hash: string; block_height: number }>(ctx, "/address_txs", {
              _addresses: [a],
              _after_block_height: after,
            });
        let max = after;
        for (const t of list) {
          hashes.add(t.tx_hash);
          max = Math.max(max, t.block_height);
        }
        nextBlock[a] = max;
      }

      const ours = (o: KoiosOutput) =>
        (!!o.stake_addr && stakes.has(o.stake_addr)) || (!!o.payment_addr && addrs.has(o.payment_addr.bech32));
      const movements: Movement[] = [];
      const fees: Fee[] = [];
      const list = [...hashes];
      for (let i = 0; i < list.length; i += TX_BATCH) {
        const txs = await call<KoiosTx[]>(ctx, "/tx_info", {
          _tx_hashes: list.slice(i, i + TX_BATCH),
          _inputs: true,
          _assets: true,
          _withdrawals: true,
          _metadata: false,
          _certs: false,
          _scripts: false,
          _bytecode: false,
          _governance: false,
        });
        for (const t of txs) {
          const at = new Date(t.tx_timestamp * 1000);
          const mine = { in: t.inputs.filter(ours), out: t.outputs.filter(ours) };
          const weSpend = mine.in.length > 0;
          const sum = (os: KoiosOutput[]) => os.reduce((a, o) => a.plus(o.value), D(0));
          // Rewards withdrawn into the wallet were already counted when earned (see rewards below).
          const withdrawn = (t.withdrawals ?? [])
            .filter((w) => stakes.has(w.stake_addr))
            .reduce((a, w) => a.plus(w.amount), D(0));
          const fee = weSpend ? D(t.fee) : D(0);
          const net = sum(mine.out).minus(sum(mine.in)).minus(withdrawn).plus(fee);
          if (!net.isZero()) movements.push({ tx: t.tx_hash, at, asset: native, amount: net.div(LOVELACE) });
          if (fee.gt(0)) fees.push({ tx: t.tx_hash, at, asset: native, amount: fee.div(LOVELACE) });

          const tokens = new Map<string, { a: TokenInfo; qty: Decimal }>();
          const add = (os: KoiosOutput[], sign: 1 | -1) => {
            for (const o of os)
              for (const a of o.asset_list ?? []) {
                const key = `${a.policy_id}${a.asset_name ?? ""}`.toLowerCase();
                const cur = tokens.get(key);
                tokens.set(key, { a, qty: (cur?.qty ?? D(0)).plus(D(a.quantity).mul(sign)) });
              }
          };
          add(mine.out, 1);
          add(mine.in, -1);
          for (const { a, qty } of tokens.values()) {
            if (qty.isZero()) continue;
            movements.push({ tx: t.tx_hash, at, asset: tokenRef(a), amount: qty.div(D(10).pow(a.decimals ?? 0)) });
          }
        }
      }

      // Staking rewards: credited to the stake account when they become spendable.
      const rewards: Reward[] = [];
      const balances: Balance[] = [];
      let ada = D(0);
      if (stakes.size) {
        const [tip] = await call<{ epoch_no: number }[]>(ctx, "/tip");
        for (const s of stakes) {
          const history = await all<{ earned_epoch: number; spendable_epoch: number; amount: string; type: string }>(
            ctx,
            "/account_reward_history",
            { _stake_addresses: [s] },
          );
          for (const r of history) {
            if (r.spendable_epoch > (tip?.epoch_no ?? Infinity) || D(r.amount).isZero()) continue;
            // Deposit refunds return your own money; everything else (member, leader, treasury,
            // reserves) is income.
            const refund = r.type === "refund";
            rewards.push({
              id: `reward:${s}:${r.earned_epoch}:${r.type}`,
              kind: refund ? "deposit" : "reward",
              at: epochStart(r.spendable_epoch),
              asset: native,
              amount: D(r.amount).div(LOVELACE),
              note: refund ? "Deposit refund" : `Staking reward, epoch ${r.earned_epoch}`,
            });
          }
        }
        const info = await call<{ total_balance: string }[]>(ctx, "/account_info", { _stake_addresses: [...stakes] });
        for (const i of info) ada = ada.plus(i.total_balance);
      }
      const held: (TokenInfo & { quantity: string })[] = [];
      if (stakes.size)
        held.push(
          ...(await all<TokenInfo & { quantity: string }>(ctx, "/account_assets", { _stake_addresses: [...stakes] })),
        );
      if (addrs.size) {
        const info = await call<{ balance: string }[]>(ctx, "/address_info", { _addresses: [...addrs] });
        for (const i of info) ada = ada.plus(i.balance);
        held.push(...(await all<TokenInfo & { quantity: string }>(ctx, "/address_assets", { _addresses: [...addrs] })));
      }
      balances.push({ asset: native, quantity: ada.div(LOVELACE).toFixed() });
      const tokenTotals = new Map<string, { a: TokenInfo; qty: Decimal }>();
      for (const h of held) {
        const key = `${h.policy_id}${h.asset_name ?? ""}`;
        const cur = tokenTotals.get(key);
        tokenTotals.set(key, { a: h, qty: (cur?.qty ?? D(0)).plus(h.quantity) });
      }
      for (const { a, qty } of tokenTotals.values()) {
        balances.push({ asset: tokenRef(a), quantity: qty.div(D(10).pow(a.decimals ?? 0)).toFixed() });
      }

      return {
        movements,
        fees,
        rewards,
        balances,
        cursor: { lastBlock: { ...lastBlock, ...nextBlock } },
        warnings: [],
      };
    },
  };
}
