import { HDKey } from "@scure/bip32";
import { bech32, bech32m, createBase58check } from "@scure/base";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { D, type Decimal } from "../lib/decimal.js";
import { getJson } from "../lib/http.js";
import type { AssetRef, Balance } from "../sync/types.js";
import {
  ChainError,
  type ChainAdapter,
  type ChainContext,
  type Fee,
  type Movement,
  type WalletInput,
} from "./types.js";
import { msg, tr, trn } from "../i18n/index.js";

const b58c = createBase58check(sha256);
const hash160 = (b: Uint8Array) => ripemd160(sha256(b));

export type ScriptType = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh" | "p2tr";
export const SCRIPT_TYPES: ScriptType[] = ["p2pkh", "p2sh-p2wpkh", "p2wpkh", "p2tr"];

export interface UtxoChain {
  id: string;
  label: string;
  symbol: string;
  coingeckoId: string;
  api: string;
  hrp: string;
  p2pkh: number;
  p2sh: number;
  // Extended-key version prefixes (hex) and the script type they imply.
  versions: Record<string, ScriptType>;
}

const BTC_VERSIONS: Record<string, ScriptType> = {
  "0488b21e": "p2pkh",
  "049d7cb2": "p2sh-p2wpkh",
  "04b24746": "p2wpkh",
};

export const BITCOIN: UtxoChain = {
  id: "bitcoin",
  label: "Bitcoin",
  symbol: "BTC",
  coingeckoId: "bitcoin",
  api: "https://mempool.space/api",
  hrp: "bc",
  p2pkh: 0x00,
  p2sh: 0x05,
  versions: BTC_VERSIONS,
};

export const LITECOIN: UtxoChain = {
  id: "litecoin",
  label: "Litecoin",
  symbol: "LTC",
  coingeckoId: "litecoin",
  api: "https://litecoinspace.org/api",
  hrp: "ltc",
  p2pkh: 0x30,
  p2sh: 0x32,
  // Ltub / Mtub, plus Bitcoin-style prefixes some wallets use for Litecoin.
  versions: { "019da462": "p2pkh", "01b26ef6": "p2sh-p2wpkh", ...BTC_VERSIONS },
};

const GAP_LIMIT = 20;
const STANDARD_XPUB = hexToBytes("0488b21e");

/** Parses any SLIP-132 extended public key (xpub/ypub/zpub/Ltub/Mtub…) for the chain. */
export function parseExtendedKey(c: UtxoChain, key: string): { hd: HDKey; impliedType: ScriptType } {
  let raw: Uint8Array;
  try {
    raw = b58c.decode(key.trim());
  } catch {
    throw new ChainError(tr("Not a valid extended public key (checksum failed)"));
  }
  if (raw.length !== 78) throw new ChainError(tr("Not a valid extended public key"));
  const version = bytesToHex(raw.slice(0, 4));
  const impliedType = c.versions[version];
  if (!impliedType)
    throw new ChainError(
      tr("Unsupported extended key type for {chain} (multisig and private keys are not accepted)", { chain: c.label }),
    );
  const hd = HDKey.fromExtendedKey(b58c.encode(concatBytes(STANDARD_XPUB, raw.slice(4))));
  if (hd.privateKey) throw new ChainError(tr("That is a private key. Only paste the public key (xpub/ypub/zpub)."));
  return { hd, impliedType };
}

/** Address for a compressed public key and script type. */
export function addressFor(c: UtxoChain, pub: Uint8Array, type: ScriptType): string {
  switch (type) {
    case "p2pkh":
      return b58c.encode(concatBytes(Uint8Array.of(c.p2pkh), hash160(pub)));
    case "p2sh-p2wpkh": {
      const redeem = concatBytes(Uint8Array.of(0x00, 0x14), hash160(pub));
      return b58c.encode(concatBytes(Uint8Array.of(c.p2sh), hash160(redeem)));
    }
    case "p2wpkh":
      return bech32.encode(c.hrp, [0, ...bech32.toWords(hash160(pub))]);
    case "p2tr": {
      // BIP86 key-path output: Q = lift_x(P) + H_TapTweak(P_x)·G.
      const xOnly = pub.slice(1);
      const P = schnorr.utils.lift_x(BigInt(`0x${bytesToHex(xOnly)}`));
      const t = BigInt(`0x${bytesToHex(schnorr.utils.taggedHash("TapTweak", xOnly))}`);
      const Q = P.add(secp256k1.Point.BASE.multiply(t));
      const qx = Q.toAffine().x.toString(16).padStart(64, "0");
      return bech32m.encode(c.hrp, [1, ...bech32m.toWords(hexToBytes(qx))]);
    }
  }
}

export function isValidAddress(c: UtxoChain, addr: string): boolean {
  const a = addr.trim();
  if (a.toLowerCase().startsWith(`${c.hrp}1`)) {
    for (const codec of [bech32, bech32m]) {
      try {
        const { prefix, words } = codec.decode(a.toLowerCase() as `${string}1${string}`);
        if (prefix !== c.hrp) continue;
        const version = words[0];
        // v0 must be bech32, v1+ bech32m (BIP350).
        if ((version === 0) !== (codec === bech32)) continue;
        return true;
      } catch {
        // try the other encoding
      }
    }
    return false;
  }
  try {
    const raw = b58c.decode(a);
    return raw.length === 21 && (raw[0] === c.p2pkh || raw[0] === c.p2sh);
  } catch {
    return false;
  }
}

const isExtendedKey = (s: string) => /^[a-zA-Z]{4}[1-9A-HJ-NP-Za-km-z]{100,}$/.test(s.trim());

interface AddrStats {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats: { tx_count: number };
}

interface MempoolTx {
  txid: string;
  fee: number;
  status: { confirmed: boolean; block_time?: number };
  vin: { prevout?: { scriptpubkey_address?: string; value: number } | null }[];
  vout: { scriptpubkey_address?: string; value: number }[];
}

const SATS = D(100_000_000);

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

export function utxoAdapter(c: UtxoChain): ChainAdapter {
  const native: AssetRef = { kind: "crypto", symbol: c.symbol, coingeckoId: c.coingeckoId };

  const stats = (ctx: ChainContext, a: string) =>
    getJson<AddrStats>(`${c.api}/address/${a}`, { fetchFn: ctx.fetchFn, retries: 3 });

  /** Derives addresses until GAP_LIMIT consecutive unused ones on both the receive and change chain. */
  async function scanXpub(ctx: ChainContext, key: string, override?: string | null) {
    const { hd, impliedType } = parseExtendedKey(c, key);
    const type = (override as ScriptType) || impliedType;
    const found: { address: string; stats: AddrStats }[] = [];
    for (const branch of [0, 1]) {
      let index = 0;
      let gap = 0;
      while (gap < GAP_LIMIT) {
        // Check a batch of addresses in parallel, then evaluate the gap in order.
        const batch = Array.from({ length: GAP_LIMIT - gap }, (_, k) => index + k);
        const results = await mapLimit(batch, 5, async (i) => {
          const address = addressFor(c, hd.deriveChild(branch).deriveChild(i).publicKey!, type);
          return { address, stats: await stats(ctx, address) };
        });
        for (const r of results) {
          index++;
          const used = r.stats.chain_stats.tx_count + r.stats.mempool_stats.tx_count > 0;
          if (used) {
            found.push(r);
            gap = 0;
          } else gap++;
          if (gap >= GAP_LIMIT) break;
        }
      }
    }
    return found;
  }

  async function addressTxs(ctx: ChainContext, a: string, expected: number): Promise<MempoolTx[]> {
    const txs: MempoolTx[] = [];
    let page = await getJson<MempoolTx[]>(`${c.api}/address/${a}/txs`, { fetchFn: ctx.fetchFn, retries: 3 });
    for (;;) {
      const confirmed = page.filter((t) => t.status.confirmed);
      txs.push(...confirmed);
      if (txs.length >= expected || confirmed.length === 0) break;
      const last = confirmed[confirmed.length - 1]!.txid;
      page = await getJson<MempoolTx[]>(`${c.api}/address/${a}/txs/chain/${last}`, {
        fetchFn: ctx.fetchFn,
        retries: 3,
      });
      if (page.length === 0) break;
    }
    return txs;
  }

  return {
    id: c.id,
    label: c.label,
    nativeSymbol: c.symbol,
    addressHint:
      c.id === "bitcoin"
        ? msg("bc1… / 1… / 3… address, or an xpub/ypub/zpub")
        : msg("ltc1… / L… / M… address, or an xpub/ypub/zpub/Ltub/Mtub"),
    supportsXpub: true,

    normalise(input) {
      const s = input.trim();
      if (isExtendedKey(s)) {
        parseExtendedKey(c, s);
        return s;
      }
      if (!isValidAddress(c, s)) throw new ChainError(tr("Not a valid {chain} address", { chain: c.label }));
      return s.toLowerCase().startsWith(`${c.hrp}1`) ? s.toLowerCase() : s;
    },

    async fetch(inputs: WalletInput[], ctx: ChainContext) {
      const addrStats = new Map<string, AddrStats>();
      let derived = 0;
      for (const input of inputs) {
        if (isExtendedKey(input.address)) {
          const found = await scanXpub(ctx, input.address, input.scriptType);
          derived += found.length;
          for (const f of found) addrStats.set(f.address, f.stats);
        } else {
          addrStats.set(input.address, await stats(ctx, input.address));
        }
      }
      const ours = new Set(addrStats.keys());

      // Only re-read addresses whose confirmed tx count changed since the last sync.
      const seen = (ctx.cursor?.txCounts as Record<string, number> | undefined) ?? {};
      const txCounts: Record<string, number> = {};
      const txs = new Map<string, MempoolTx>();
      const changed = [...addrStats].filter(([a, s]) => {
        txCounts[a] = s.chain_stats.tx_count;
        return s.chain_stats.tx_count > 0 && seen[a] !== s.chain_stats.tx_count;
      });
      for (const [a, s] of changed) {
        for (const t of await addressTxs(ctx, a, s.chain_stats.tx_count)) txs.set(t.txid, t);
      }

      const movements: Movement[] = [];
      const fees: Fee[] = [];
      for (const t of txs.values()) {
        const at = new Date((t.status.block_time ?? 0) * 1000);
        let spent = D(0);
        let received = D(0);
        let weSpend = false;
        for (const i of t.vin) {
          if (i.prevout?.scriptpubkey_address && ours.has(i.prevout.scriptpubkey_address)) {
            spent = spent.plus(i.prevout.value);
            weSpend = true;
          }
        }
        for (const o of t.vout)
          if (o.scriptpubkey_address && ours.has(o.scriptpubkey_address)) received = received.plus(o.value);
        // When we fund the transaction we pay its whole fee; the rest of the net change is the transfer.
        const fee = weSpend ? D(t.fee) : D(0);
        const net = received.minus(spent).plus(fee);
        if (!net.isZero()) movements.push({ tx: t.txid, at, asset: native, amount: net.div(SATS) });
        if (fee.gt(0)) fees.push({ tx: t.txid, at, asset: native, amount: fee.div(SATS) });
      }

      let total: Decimal = D(0);
      for (const s of addrStats.values())
        total = total.plus(D(s.chain_stats.funded_txo_sum).minus(s.chain_stats.spent_txo_sum));
      const balances: Balance[] = [{ asset: native, quantity: total.div(SATS).toFixed() }];

      return {
        movements,
        fees,
        balances,
        cursor: { txCounts: { ...seen, ...txCounts } },
        warnings: [],
        info: derived
          ? trn(
              derived,
              "{n} used address found from the extended key",
              "{n} used addresses found from the extended key",
            )
          : undefined,
      };
    },
  };
}
