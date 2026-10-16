import { z } from "zod";
import { D, type Decimal } from "../../lib/decimal.js";
import { msg, tr, trn } from "../../i18n/index.js";
import {
  type AssetRef,
  type Balance,
  type ExchangeProvider,
  ProviderError,
  type ProviderContext,
  type SyncEvent,
} from "../types.js";

/**
 * Bitpanda's public API (api.public.bitpanda.com, the successor of the legacy API that stops on
 * 31 January 2027). A key with only read scopes: Balances (the portfolio), Transaction (the history)
 * and Trade (Read) (asset names). Built on the published OpenAPI description, not yet tested with a
 * real key: the documentation lists the fields of an operation but not the values of its types, so
 * the mapping goes by what is certain (direction, amounts, a trade's presence) and uses the type
 * names only to recognise rewards.
 */

const BASE = "https://api.public.bitpanda.com";

const creds = z.object({
  apiKey: z.string().trim().min(16, "The API key is a long string"),
});
type Creds = z.infer<typeof creds>;

interface BpAmount {
  value: string;
  asset_id?: string;
  currency_id?: string;
}
export interface BpTransaction {
  transaction_id: string;
  asset_id?: string;
  currency_id?: string;
  asset_amount?: BpAmount;
  fee_amount?: BpAmount;
  transaction_type?: string;
  flow?: "INCOMING" | "OUTGOING";
  credited_at?: string;
  trade?: { trade_id?: string; fee?: BpAmount };
}
export interface BpOperation {
  operation_id: string;
  operation_type?: string;
  transactions: BpTransaction[];
}
export interface BpAsset {
  id: string;
  symbol: string;
  name?: string;
  isin?: string;
  type?: string;
  group?: string;
}
interface Page<T> {
  data: T[];
  next_cursor?: string;
  has_next_page?: boolean;
}
interface BpPortfolioItem {
  asset_id?: string;
  currency_id?: string;
  balance?: BpAmount;
}

async function call<T>(c: Creds, ctx: ProviderContext, path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await ctx.fetchFn(`${BASE}${path}`, {
      headers: { "x-api-key": c.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: { code?: string } }) | null;
    if (res.ok && data) return data;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await ctx.sleep(1_500 * (attempt + 1));
      continue;
    }
    if (res.status === 401 || res.status === 403)
      throw new ProviderError(
        tr(
          "Bitpanda refused the key. Check that it hasn't expired and has the scopes Balances, Transaction and Trade (Read).",
        ),
      );
    throw new ProviderError(`Bitpanda: ${data?.error?.code ?? `HTTP ${res.status}`}`);
  }
}

/** Reads every page of a cursor-paged list. */
async function all<T>(c: Creds, ctx: ProviderContext, path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let cursor: string | undefined, n = 0; n < 1_000; n++) {
    const page = await call<Page<T>>(
      c,
      ctx,
      `${path}${sep}page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    out.push(...page.data);
    if (!page.has_next_page || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

/** What an amount is in Box3balans's terms, from Bitpanda's ids. */
export interface Lookup {
  assets: Map<string, BpAsset>;
  currencies: Map<string, string>; // id → "EUR"
}

function refOf(amount: BpAmount | undefined, look: Lookup): AssetRef | "unsupported" | null {
  if (!amount) return null;
  if (amount.currency_id) {
    const code = look.currencies.get(amount.currency_id);
    return code ? { kind: "fiat", currency: code } : null;
  }
  const a = amount.asset_id ? look.assets.get(amount.asset_id) : undefined;
  if (!a) return null;
  const type = `${a.type ?? ""} ${a.group ?? ""}`.toUpperCase();
  if (type.includes("CRYPTO")) return { kind: "crypto", symbol: a.symbol.toUpperCase(), name: a.name };
  // Shares and ETFs ("stocks" on Bitpanda): found by their ISIN.
  if (a.isin) return { kind: "security", symbol: a.symbol, isin: a.isin, currency: "EUR", name: a.name };
  // Metals and commodities (in grams on Bitpanda) aren't mapped yet.
  return "unsupported";
}

const keyOf = (r: AssetRef): string =>
  r.kind === "fiat" ? `fiat:${r.currency}` : r.kind === "crypto" ? r.symbol : (r.isin ?? r.symbol);
// Only clear income: getting staked coins back (unstaking) is not a reward.
const REWARD = /reward|interest|airdrop|bonus|cashback/i;

export interface Mapped {
  events: SyncEvent[];
  /** Trades between two non-money assets: no value in euros, left out. */
  swaps: number;
  /** Lines in metals or commodities, which aren't mapped yet. */
  unsupported: Set<string>;
}

/**
 * Bitpanda operations as events. An operation with a trade has a leg out and a leg in: money for an
 * asset is a purchase, an asset for money a sale. Without a trade, a leg in is a deposit (a reward
 * when its type says so) and a leg out a withdrawal; two equal legs of one asset cancel out (a move
 * between Bitpanda's own wallets).
 */
export function mapBitpandaOperations(ops: BpOperation[], look: Lookup): Mapped {
  const events: SyncEvent[] = [];
  const unsupported = new Set<string>();
  let swaps = 0;
  for (const op of ops) {
    const legs = op.transactions
      .map((t) => ({ t, ref: refOf(t.asset_amount, look), qty: D(t.asset_amount?.value ?? "0").abs() }))
      .filter((l) => l.ref && !l.qty.isZero());
    if (legs.some((l) => l.ref === "unsupported")) {
      for (const l of legs)
        if (l.ref === "unsupported") unsupported.add(look.assets.get(l.t.asset_amount?.asset_id ?? "")?.symbol ?? "?");
      continue;
    }
    const at = (t: BpTransaction) => new Date(t.credited_at ?? 0);
    const type = `${op.operation_type ?? ""} ${legs.map((l) => l.t.transaction_type ?? "").join(" ")}`;
    const trade = op.transactions.find((t) => t.trade);
    const out = legs.find((l) => l.t.flow === "OUTGOING");
    const into = legs.find((l) => l.t.flow === "INCOMING");
    if (trade && out && into) {
      const gave = out.ref as AssetRef;
      const got = into.ref as AssetRef;
      const fee = trade.trade?.fee ?? trade.fee_amount;
      const feeRef = refOf(fee, look);
      const feeIn = (r: AssetRef) =>
        fee && feeRef && feeRef !== "unsupported" && keyOf(feeRef) === keyOf(r) && !D(fee.value).isZero()
          ? D(fee.value).abs().toFixed()
          : undefined;
      const id = trade.trade?.trade_id ?? op.operation_id;
      if (gave.kind === "fiat" && got.kind !== "fiat")
        events.push({
          kind: "trade",
          id,
          at: at(into.t),
          side: "buy",
          asset: got,
          quantity: into.qty.toFixed(),
          quote: { amount: out.qty.toFixed(), currency: gave.currency },
          feeQuote: feeIn(gave),
          note: "Bitpanda",
        });
      else if (got.kind === "fiat" && gave.kind !== "fiat")
        events.push({
          kind: "trade",
          id,
          at: at(out.t),
          side: "sell",
          asset: gave,
          quantity: out.qty.toFixed(),
          quote: { amount: into.qty.toFixed(), currency: got.currency },
          feeQuote: feeIn(got),
          note: "Bitpanda",
        });
      else swaps++;
      continue;
    }
    // Two equal legs of the same asset: a move between Bitpanda's own wallets.
    if (out && into && keyOf(out.ref as AssetRef) === keyOf(into.ref as AssetRef) && out.qty.eq(into.qty)) continue;
    for (const l of legs) {
      const ref = l.ref as AssetRef;
      const note = (l.t.transaction_type ?? op.operation_type ?? "").replace(/_/g, " ").toLowerCase() || undefined;
      if (l.t.flow === "INCOMING")
        events.push({
          kind: REWARD.test(type) && ref.kind !== "fiat" ? "reward" : "deposit",
          id: l.t.transaction_id,
          at: at(l.t),
          asset: ref,
          quantity: l.qty.toFixed(),
          note,
        });
      else if (l.t.flow === "OUTGOING") {
        events.push({
          kind: "withdrawal",
          id: l.t.transaction_id,
          at: at(l.t),
          asset: ref,
          quantity: l.qty.toFixed(),
          note,
        });
        // A network fee in the asset itself.
        const fee = refOf(l.t.fee_amount, look);
        if (fee && fee !== "unsupported" && keyOf(fee) === keyOf(ref) && !D(l.t.fee_amount!.value).isZero())
          events.push({
            kind: "fee",
            id: `${l.t.transaction_id}:fee`,
            at: at(l.t),
            asset: ref,
            quantity: D(l.t.fee_amount!.value).abs().toFixed(),
          });
      }
    }
  }
  return { events, swaps, unsupported };
}

/** Looks up the assets and currencies the operations and the portfolio refer to. */
async function lookup(c: Creds, ctx: ProviderContext, ids: Set<string>): Promise<Lookup> {
  const currencies = new Map(
    (await call<{ data: { id: string; symbol: string }[] }>(c, ctx, "/v1/currencies")).data.map((x) => [
      x.id,
      x.symbol.toUpperCase(),
    ]),
  );
  const assets = new Map<string, BpAsset>();
  const wanted = [...ids].filter((id) => !currencies.has(id));
  for (let i = 0; i < wanted.length; i += 50) {
    const q = wanted
      .slice(i, i + 50)
      .map((id) => `id=${encodeURIComponent(id)}`)
      .join("&");
    for (const a of await all<BpAsset>(c, ctx, `/v1/assets?${q}`)) assets.set(a.id, a);
  }
  return { assets, currencies };
}

export const bitpanda: ExchangeProvider<Creds> = {
  id: "bitpanda",
  label: "Bitpanda",
  accountKind: "exchange",
  fields: [{ name: "apiKey", label: msg("API key"), secret: true }],
  instructions: [
    msg("Bitpanda → Account settings → API Keys → New API key (or app.bitpanda.com/my-account/apikey)."),
    msg(
      "Tick only the read scopes: Balances, Transaction and Trade (Read). Not Trade (Write) or Earn (Write): with those a key can trade.",
    ),
    msg("Set an expiry date (at most a year) and paste the key here; Bitpanda shows it only once."),
    msg(
      "Built on Bitpanda's documentation and not yet tested with a real key: check the balances after the first sync.",
    ),
  ],
  credentials: creds,
  hint: (c) => `…${c.apiKey.slice(-4)}`,

  async test(c, ctx) {
    await call(c, ctx, "/v1/portfolio");
  },

  async fetch(c, ctx) {
    const warnings: string[] = [];
    // After the first sync, from a week before the newest operation seen (late credits included).
    const since =
      typeof ctx.cursor?.newest === "string" ? new Date(Date.parse(ctx.cursor.newest) - 7 * 86_400_000) : null;
    const ops = await all<BpOperation>(
      c,
      ctx,
      `/v1/operations${since ? `?from=${encodeURIComponent(since.toISOString())}` : ""}`,
    );
    const portfolio = (await call<{ data: BpPortfolioItem[] }>(c, ctx, "/v1/portfolio")).data;

    const ids = new Set<string>();
    for (const op of ops)
      for (const t of op.transactions)
        for (const a of [t.asset_amount, t.fee_amount, t.trade?.fee]) if (a?.asset_id) ids.add(a.asset_id);
    for (const p of portfolio) if (p.asset_id) ids.add(p.asset_id);
    const look = await lookup(c, ctx, ids);

    const mapped = mapBitpandaOperations(ops, look);
    const known = await ctx.isKnown(mapped.events.map((e) => e.id));
    const events = mapped.events.filter((e) => !known.has(e.id));
    if (mapped.swaps)
      warnings.push(
        trn(
          mapped.swaps,
          "{n} trade between two coins was left out: it has no value in money. Correct that balance afterwards.",
          "{n} trades between two coins were left out: they have no value in money. Correct those balances afterwards.",
        ),
      );
    if (mapped.unsupported.size)
      warnings.push(
        tr("Metals and commodities at Bitpanda aren't read yet ({symbols}); add them by hand.", {
          symbols: [...mapped.unsupported].sort().join(", "),
        }),
      );

    const totals = new Map<string, { ref: AssetRef; qty: Decimal }>();
    for (const p of portfolio) {
      const ref = refOf(p.balance ?? { value: "0", asset_id: p.asset_id, currency_id: p.currency_id }, look);
      if (!ref || ref === "unsupported" || !p.balance) continue;
      const k = keyOf(ref);
      totals.set(k, { ref, qty: (totals.get(k)?.qty ?? D(0)).plus(D(p.balance.value)) });
    }
    const balances: Balance[] = [...totals.values()]
      .filter((b) => !b.qty.isZero())
      .map((b) => ({ asset: b.ref, quantity: b.qty.toFixed() }));
    if (ops.length === 0 && balances.length === 0 && !since)
      warnings.push(
        tr(
          "Bitpanda shows no operations and no balances for this key. Check that it has the scopes Balances and Transaction.",
        ),
      );

    const newest = ops
      .flatMap((op) => op.transactions.map((t) => t.credited_at ?? ""))
      .filter(Boolean)
      .sort()
      .at(-1);
    return {
      events,
      // Metals are left out of both, so the balances can still be compared.
      balances,
      balanceScope: "all",
      cursor: { newest: newest ?? ctx.cursor?.newest ?? null },
      warnings,
    };
  },
};
