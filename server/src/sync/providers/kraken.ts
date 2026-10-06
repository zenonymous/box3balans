import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { D, type Decimal } from "../../lib/decimal.js";
import { getJson } from "../../lib/http.js";
import { assetRef, isFiat } from "../assets.js";
import { type Balance, type ExchangeProvider, ProviderError, type ProviderContext, type SyncEvent } from "../types.js";

const BASE = "https://api.kraken.com";

const creds = z.object({
  apiKey: z.string().trim().min(10),
  apiSecret: z
    .string()
    .trim()
    .refine((s) => /^[A-Za-z0-9+/=]+$/.test(s), "The private key should be base64"),
});
type Creds = z.infer<typeof creds>;

/** API-Sign = base64(HMAC-SHA512(path + SHA256(nonce + postData), base64decode(secret))). */
export function krakenSignature(path: string, nonce: string, postData: string, secret: string): string {
  const hash = createHash("sha256")
    .update(nonce + postData)
    .digest();
  return createHmac("sha512", Buffer.from(secret, "base64"))
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest("base64");
}

let lastNonce = 0;
const nextNonce = () => {
  lastNonce = Math.max(Date.now() * 1000, lastNonce + 1);
  return String(lastNonce);
};

async function privateCall<T>(
  c: Creds,
  ctx: ProviderContext,
  method: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const path = `/0/private/${method}`;
  for (let attempt = 0; ; attempt++) {
    const nonce = nextNonce();
    const body = new URLSearchParams({
      nonce,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    }).toString();
    const res = await ctx.fetchFn(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "API-Key": c.apiKey,
        "API-Sign": krakenSignature(path, nonce, body, c.apiSecret),
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as { error?: string[]; result?: T } | null;
    const errors = data?.error ?? [];
    if (res.ok && data && errors.length === 0) return data.result as T;
    const retryable = errors.some((e) => /Rate limit|Invalid nonce|Busy|Unavailable/i.test(e)) || res.status >= 500;
    if (retryable && attempt < 5) {
      await ctx.sleep(errors.some((e) => /Rate limit/i.test(e)) ? 10_000 : 2_000);
      continue;
    }
    throw new ProviderError(`Kraken: ${errors.join(", ") || `HTTP ${res.status}`}`);
  }
}

interface LedgerEntry {
  refid: string;
  time: number;
  type: string;
  subtype?: string;
  asset: string;
  amount: string;
  fee: string;
}

// Kraken's legacy asset codes and staking/earn variants.
const ALIASES: Record<string, string> = { XBT: "BTC", XDG: "DOGE", ETH2: "ETH", "ETH2.S": "ETH" };

/** Normalises a Kraken asset code (XXBT, ZEUR, DOT.S, ETH2, USDC.M …) to a common symbol. */
export function normaliseKrakenAsset(code: string, altnames: Record<string, string> = {}): string {
  let c = code.toUpperCase();
  // Staked, earn, bonded and on-chain variants: DOT.S, DOT28.S (bonding days), XBT.M, ETH.F,
  // EUR.HOLD, ETH.INK, USDT0.TEMPO … The digits only belong to the variant before ".S".
  c = c.replace(/\d+\.S$|\.[A-Z]+$/, "");
  c = altnames[c] ?? c;
  if (/^[XZ][A-Z]{3}$/.test(c) && !altnames[code]) {
    // XXBT → XBT, ZEUR → EUR (only for the classic 4-letter codes)
    const stripped = c.slice(1);
    if (
      isFiat(stripped) ||
      ["XBT", "ETH", "LTC", "XRP", "XLM", "XMR", "ZEC", "ETC", "REP", "MLN", "XDG"].includes(stripped)
    )
      c = stripped;
  }
  return ALIASES[c] ?? c;
}

// Fee credits Kraken hands out to pay trading fees with: not an asset you own. Matched on the
// raw code: its altname is "FEE".
const isFeeCredit = (code: string) => code.toUpperCase() === "KFEE";

// Moves between Kraken's spot and staking/earn wallets: not portfolio changes.
const INTERNAL_SUBTYPES = new Set([
  "spottostaking",
  "stakingfromspot",
  "spotfromstaking",
  "stakingtospot",
  "spottofutures",
  "spotfromfutures",
  "allocation",
  "deallocation",
  "autoallocate",
  "autoallocation",
  "migration",
]);
const TRADE_TYPES = new Set(["trade", "spend", "receive", "conversion", "sale", "margin", "settled"]);
const REWARD_TYPES = new Set(["staking", "reward", "dividend", "credit", "invite bonus"]);
// Kinds of entry Kraken sometimes books as two legs under different refids (e.g. staked ETH2.S
// converted back to ETH): an equal and opposite pair close together is a move, not a change.
const PAIRABLE_TYPES = new Set(["transfer", "earn", "adjustment", "custodytransfer"]);
const PAIR_WINDOW_S = 2 * 86_400;

const isInternal = (e: LedgerEntry) =>
  ((e.type === "transfer" || e.type === "earn") && INTERNAL_SUBTYPES.has(e.subtype ?? "")) ||
  // Earn entries from before subtypes existed: with a fee it's a reward, without one a move.
  (e.type === "earn" && !e.subtype && D(e.fee || 0).isZero());

/** Whether an incoming amount is income (staking, earn rewards, airdrops, forks) rather than a deposit. */
const isIncome = (type: string, subtype: string) =>
  REWARD_TYPES.has(type) ||
  ((type === "earn" || type === "transfer") && (subtype === "reward" || subtype === "airdrop")) ||
  (type === "earn" && !subtype) ||
  (type === "transfer" && !subtype) ||
  type === "adjustment";

interface Leg {
  refid: string;
  id: string;
  time: number;
  sym: string;
  amount: Decimal;
  type: string;
  subtype: string;
}

/** Groups ledger entries by refid and turns each group into events. */
export function mapKrakenLedger(
  entries: LedgerEntry[],
  altnames: Record<string, string> = {},
  now = Date.now() / 1000,
): SyncEvent[] {
  return krakenEvents(entries, altnames, now).events;
}

/**
 * Also returns the legs held back: a move's other leg may still be on its way, so a pairable leg
 * younger than the pairing window waits for a later sync.
 */
export function krakenEvents(entries: LedgerEntry[], altnames: Record<string, string>, now: number) {
  const groups = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    if (isFeeCredit(e.asset)) continue;
    const g = groups.get(e.refid) ?? [];
    g.push(e);
    groups.set(e.refid, g);
  }
  const events: SyncEvent[] = [];
  const legs: Leg[] = [];
  for (const [refid, group] of groups) {
    const time = Math.min(...group.map((e) => e.time));
    const at = new Date(time * 1000);
    const types = new Set(group.map((e) => e.type));
    if (group.every(isInternal)) continue;

    // Net balance change per normalised asset (Kraken: balance changes by amount − fee).
    const net = new Map<string, Decimal>();
    const fees = new Map<string, Decimal>();
    for (const e of group) {
      const sym = normaliseKrakenAsset(e.asset, altnames);
      net.set(sym, (net.get(sym) ?? D(0)).plus(D(e.amount)).minus(D(e.fee || 0)));
      fees.set(sym, (fees.get(sym) ?? D(0)).plus(D(e.fee || 0)));
    }
    for (const [k, v] of net) if (v.isZero()) net.delete(k);
    if (net.size === 0) continue;

    const plus = [...net].filter(([, v]) => v.gt(0));
    const minus = [...net].filter(([, v]) => v.lt(0));

    const delisting = group.some((e) => e.subtype === "delistingconversion");
    if (([...types].some((t) => TRADE_TYPES.has(t)) || delisting) && plus.length === 1 && minus.length === 1) {
      const [inSym, inAmt] = plus[0]!;
      const [outSym, outAmt] = minus[0]!;
      // Fiat is always the quote; for crypto-to-crypto the asset given up is the quote.
      const sell = isFiat(inSym) && !isFiat(outSym);
      const [asset, qty, quoteSym, quoteAmt] = sell
        ? [outSym, outAmt.abs(), inSym, inAmt]
        : [inSym, inAmt, outSym, outAmt.abs()];
      const fee = fees.get(quoteSym);
      events.push({
        kind: "trade",
        id: refid,
        at,
        side: sell ? "sell" : "buy",
        asset: assetRef(asset),
        quantity: qty.toFixed(),
        quote: { amount: quoteAmt.toFixed(), currency: quoteSym },
        feeQuote: fee && !fee.isZero() ? fee.toFixed() : undefined,
        note: delisting ? "Kraken delisting conversion" : undefined,
      });
      continue;
    }

    const multi = net.size > 1;
    for (const [sym, amount] of net) {
      const entry = group.find((e) => normaliseKrakenAsset(e.asset, altnames) === sym);
      legs.push({
        refid,
        id: multi ? `${refid}:${sym}` : refid,
        time,
        sym,
        amount,
        type: entry?.type ?? "",
        subtype: entry?.subtype ?? "",
      });
    }
  }

  // Cancel out moves booked as separate legs. Rewards and airdrops never are one (nor an earn
  // entry without a subtype that got this far: it carried a fee, so it's a reward).
  const pairable = (l: Leg) =>
    PAIRABLE_TYPES.has(l.type) && !["reward", "airdrop"].includes(l.subtype) && !(l.type === "earn" && !l.subtype);
  const paired = new Set<Leg>();
  const sorted = legs.filter(pairable).sort((a, b) => a.time - b.time);
  for (const out of sorted) {
    if (!out.amount.lt(0) || paired.has(out)) continue;
    const back = sorted.find(
      (l) =>
        !paired.has(l) &&
        l.sym === out.sym &&
        l.amount.eq(out.amount.neg()) &&
        Math.abs(l.time - out.time) <= PAIR_WINDOW_S,
    );
    if (back) {
      paired.add(out);
      paired.add(back);
    }
  }

  const held: Leg[] = [];
  for (const l of legs) {
    if (paired.has(l)) continue;
    if (pairable(l) && l.time > now - PAIR_WINDOW_S) {
      held.push(l);
      continue;
    }
    const at = new Date(l.time * 1000);
    const quantity = l.amount.abs().toFixed();
    const note =
      l.type === "deposit" || l.type === "withdrawal"
        ? undefined
        : `Kraken ${[l.type, l.subtype].filter(Boolean).join(" / ")}`;
    const kind = l.amount.gt(0) ? (isIncome(l.type, l.subtype) ? "reward" : "deposit") : "withdrawal";
    events.push({ kind, id: l.id, at, asset: assetRef(l.sym), quantity, note });
  }
  return { events: events.sort((a, b) => a.at.getTime() - b.at.getTime()), held };
}

export const kraken: ExchangeProvider<Creds> = {
  id: "kraken",
  label: "Kraken",
  accountKind: "exchange",
  fields: [
    { name: "apiKey", label: "API key", secret: false },
    { name: "apiSecret", label: "Private key", secret: true },
  ],
  instructions: [
    "Log in to kraken.com → Settings → API → Create API key.",
    "Enable only: “Query Funds” and “Query Ledger Entries”. Leave every trading, deposit and withdrawal permission off.",
    "Copy the API key and the private key.",
  ],
  credentials: creds,
  hint: (c) => `…${c.apiKey.slice(-4)}`,

  async test(c, ctx) {
    await privateCall(c, ctx, "Balance");
  },

  async fetch(c, ctx) {
    const altnames: Record<string, string> = {};
    try {
      const assets = await getJson<{ result: Record<string, { altname: string }> }>(`${BASE}/0/public/Assets`, {
        fetchFn: ctx.fetchFn,
      });
      for (const [code, a] of Object.entries(assets.result ?? {})) altnames[code] = a.altname;
    } catch {
      // normaliseKrakenAsset has built-in fallbacks for the common codes
    }

    const lastTime = typeof ctx.cursor?.lastTime === "number" ? (ctx.cursor.lastTime as number) : null;
    const start = lastTime ? lastTime - 2 * 86_400 : undefined;
    const entries: LedgerEntry[] = [];
    let maxTime = lastTime ?? 0;
    for (let ofs = 0; ;) {
      const res = await privateCall<{ ledger: Record<string, LedgerEntry>; count: number }>(c, ctx, "Ledgers", {
        ofs,
        ...(start ? { start } : {}),
      });
      const page = Object.values(res.ledger ?? {});
      entries.push(...page);
      for (const e of page) maxTime = Math.max(maxTime, Math.floor(e.time));
      ofs += page.length;
      if (page.length === 0 || ofs >= res.count) break;
      // Ledgers costs 2 points of a slowly decaying budget; pace large histories.
      await ctx.sleep(ofs > 200 ? 3_000 : 1_000);
    }

    // Groups handled by the previous sync (re-read in the overlap) are skipped: their events are in,
    // and pairing them again could leave out what they were paired with.
    const seen = new Set((ctx.cursor?.seen as string[] | undefined) ?? []);
    const { events, held } = krakenEvents(
      entries.filter((e) => !seen.has(e.refid)),
      altnames,
      Date.now() / 1000,
    );
    const heldRefids = new Set(held.map((l) => l.refid));
    // Re-read from the oldest held-back leg next time.
    const nextLast = Math.min(maxTime, ...held.map((l) => Math.floor(l.time)));
    const nextSeen = [
      ...new Set(
        entries.filter((e) => e.time >= nextLast - 2 * 86_400 && !heldRefids.has(e.refid)).map((e) => e.refid),
      ),
    ];
    const bal = await privateCall<Record<string, string>>(c, ctx, "Balance");
    const totals = new Map<string, Decimal>();
    // Held-back legs aren't booked yet: compare the balance without them.
    for (const l of held) totals.set(l.sym, (totals.get(l.sym) ?? D(0)).minus(l.amount));
    for (const [code, q] of Object.entries(bal)) {
      if (isFeeCredit(code)) continue;
      const sym = normaliseKrakenAsset(code, altnames);
      totals.set(sym, (totals.get(sym) ?? D(0)).plus(D(q)));
    }
    const balances: Balance[] = [...totals]
      .filter(([, q]) => !q.isZero())
      .map(([sym, q]) => ({ asset: assetRef(sym), quantity: q.toFixed() }));

    return {
      events,
      balances,
      balanceScope: "all",
      cursor: { lastTime: nextLast, seen: nextSeen },
      warnings: [],
    };
  },
};
