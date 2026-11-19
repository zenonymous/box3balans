import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { D, type Decimal } from "../../lib/decimal.js";
import { assetRef, isFiat } from "../assets.js";
import { type Balance, type ExchangeProvider, ProviderError, type ProviderContext, type SyncEvent } from "../types.js";
import { msg, trn } from "../../i18n/index.js";

const HOST = "www.bitstamp.net";
const PAGE = 1000;

const creds = z.object({
  apiKey: z.string().trim().min(10),
  apiSecret: z.string().trim().min(10),
});
type Creds = z.infer<typeof creds>;

/**
 * Bitstamp's v2 signature: lowercase hex HMAC-SHA256, keyed with the secret, over "BITSTAMP " + key,
 * the method, host and path, the query, the content type (only with a body), the nonce, the
 * timestamp, "v2" and the body.
 */
export function bitstampSignature(
  secret: string,
  parts: {
    apiKey: string;
    method: string;
    path: string;
    query?: string;
    nonce: string;
    timestamp: string;
    body: string;
  },
): string {
  const contentType = parts.body ? "application/x-www-form-urlencoded" : "";
  const message =
    `BITSTAMP ${parts.apiKey}${parts.method}${HOST}${parts.path}${parts.query ?? ""}` +
    `${contentType}${parts.nonce}${parts.timestamp}v2${parts.body}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

async function privateCall<T>(
  c: Creds,
  ctx: ProviderContext,
  endpoint: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const path = `/api/v2/${endpoint}/`;
  for (let attempt = 0; ; attempt++) {
    const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const nonce = randomUUID();
    const timestamp = String(Date.now());
    const headers: Record<string, string> = {
      "X-Auth": `BITSTAMP ${c.apiKey}`,
      "X-Auth-Signature": bitstampSignature(c.apiSecret, {
        apiKey: c.apiKey,
        method: "POST",
        path,
        nonce,
        timestamp,
        body,
      }),
      "X-Auth-Nonce": nonce,
      "X-Auth-Timestamp": timestamp,
      "X-Auth-Version": "v2",
      Accept: "application/json",
    };
    // Without a body Bitstamp wants no content type, in the header or the signature.
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const res = await ctx.fetchFn(`https://${HOST}${path}`, {
      method: "POST",
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as
      T | { status?: string; reason?: unknown; code?: string; response_code?: string } | null;
    const error = data && !Array.isArray(data) && typeof data === "object" && "status" in data ? data : null;
    if (res.ok && data !== null && !(error && error.status === "error")) return data as T;
    // 400.002: over the rate limit. API0004: a nonce seen before (a retry gets a new one).
    const code = error?.code ?? error?.response_code ?? "";
    const retryable = res.status === 429 || res.status >= 500 || code === "400.002" || code === "API0004";
    if (retryable && attempt < 5) {
      await ctx.sleep(code === "400.002" || res.status === 429 ? 10_000 : 2_000);
      continue;
    }
    const reason = typeof error?.reason === "string" ? error.reason : JSON.stringify(error?.reason ?? "");
    throw new ProviderError(`Bitstamp: ${[code, reason].filter(Boolean).join(" ") || `HTTP ${res.status}`}`);
  }
}

/** One row of /api/v2/user_transactions/: the amounts sit under each currency's code. */
export type BsTx = Record<string, unknown> & { id: number; datetime: string; type: string | number; fee?: string };

// Fields that aren't a currency. Keys with "_" are a pair's rate ("btc_eur") or an id.
const NOT_CURRENCY = new Set(["id", "datetime", "type", "fee", "order_id", "self_trade", "self_trade_order_id"]);

// Bitstamp's codes for the same coin under another name.
const ALIASES: Record<string, string> = { ETH2R: "ETH", ETH2: "ETH" };
const symbol = (code: string) => {
  const c = code.toUpperCase();
  return ALIASES[c] ?? c;
};

const TRADES = new Set(["2", "36", "53", "55"]); // market trade, simple buy, small balance conversions
const DEPOSIT = "0";
const WITHDRAWAL = "1";
const REWARDS = new Set(["27", "32"]); // staking reward, referral reward
// Moves between your own Bitstamp accounts: the coins leave or enter this one.
const ACCOUNT_TRANSFERS = new Set(["14", "35"]);
// Coins sent to staking and back: still yours, still at Bitstamp.
const STAKING_MOVES = new Set(["25", "26"]);

/** "2022-03-01 10:54:53.849000", in UTC. */
const parseTime = (s: string) => new Date(`${s.trim().replace(" ", "T").slice(0, 23)}Z`);

/**
 * Turns user transactions into events. A trade's amounts are without its fee, which is charged in
 * the quote currency (as rotki reads them): a purchase costs the amount plus the fee, a sale brings
 * in the amount minus it; a withdrawal takes the amount plus the fee. Derivatives, settlements and
 * kinds not listed are counted in `skipped`.
 */
export function mapBitstampTransactions(rows: BsTx[]): { events: SyncEvent[]; skipped: number } {
  const events: SyncEvent[] = [];
  let skipped = 0;
  for (const r of rows) {
    const type = String(r.type);
    const id = `bitstamp:${r.id}`;
    const at = parseTime(r.datetime);
    const fee = D(typeof r.fee === "string" && r.fee ? r.fee : 0);
    const legs: [string, Decimal][] = [];
    for (const [k, v] of Object.entries(r)) {
      if (NOT_CURRENCY.has(k) || k.includes("_") || (typeof v !== "string" && typeof v !== "number")) continue;
      const amount = D(v);
      if (!amount.isZero()) legs.push([k, amount]);
    }
    if (STAKING_MOVES.has(type)) continue;

    if (TRADES.has(type) && legs.length === 2) {
      const plus = legs.find(([, a]) => a.gt(0));
      const minus = legs.find(([, a]) => a.lt(0));
      if (!plus || !minus) {
        skipped++;
        continue;
      }
      // The pair's key names the asset first ("btc_eur"); without one, money is the quote and
      // between two coins the one given up.
      const pair = Object.keys(r).find((k) => k.includes("_") && !NOT_CURRENCY.has(k));
      const base = pair?.split("_")[0];
      const baseIsIn =
        base !== undefined && (base === plus[0] || base === minus[0])
          ? base === plus[0]
          : !(isFiat(symbol(plus[0])) && !isFiat(symbol(minus[0])));
      const [asset, quote] = baseIsIn ? [plus, minus] : [minus, plus];
      const side = baseIsIn ? "buy" : "sell";
      const quoteAmount = side === "buy" ? quote[1].abs().plus(fee) : quote[1].abs().minus(fee);
      events.push({
        kind: "trade",
        id,
        at,
        side,
        asset: assetRef(symbol(asset[0])),
        quantity: asset[1].abs().toFixed(),
        quote: { amount: quoteAmount.toFixed(), currency: symbol(quote[0]) },
        feeQuote: fee.isZero() ? undefined : fee.toFixed(),
        note: type === "2" ? undefined : `Bitstamp ${type === "36" ? "simple buy" : "small balance conversion"}`,
      });
      continue;
    }

    if (legs.length !== 1) {
      skipped++;
      continue;
    }
    const [code, amount] = legs[0]!;
    const asset = assetRef(symbol(code));
    if (type === DEPOSIT && amount.gt(0)) {
      events.push({ kind: "deposit", id, at, asset, quantity: amount.minus(fee).toFixed() });
    } else if (type === WITHDRAWAL && amount.lt(0)) {
      events.push({ kind: "withdrawal", id, at, asset, quantity: amount.abs().plus(fee).toFixed() });
    } else if (REWARDS.has(type) && amount.gt(0)) {
      const note = type === "27" ? "Bitstamp staking reward" : "Bitstamp referral reward";
      events.push({ kind: "reward", id, at, asset, quantity: amount.toFixed(), note });
    } else if (ACCOUNT_TRANSFERS.has(type)) {
      const kind = amount.gt(0) ? "deposit" : "withdrawal";
      events.push({
        kind,
        id,
        at,
        asset,
        quantity: amount.abs().toFixed(),
        note: "Bitstamp transfer between accounts",
      });
    } else skipped++;
  }
  return { events, skipped };
}

export const bitstamp: ExchangeProvider<Creds> = {
  id: "bitstamp",
  label: "Bitstamp",
  accountKind: "exchange",
  fields: [
    { name: "apiKey", label: msg("API key"), secret: false },
    { name: "apiSecret", label: msg("API secret"), secret: true },
  ],
  instructions: [
    msg("Log in to bitstamp.net → Settings → API access → New API key."),
    msg(
      "Tick only “Account balance” and “User transactions”. Leave every trading, deposit and withdrawal permission off.",
    ),
    msg("Copy the key and the secret, then activate the key with the link in the e-mail Bitstamp sends."),
  ],
  credentials: creds,
  hint: (c) => `…${c.apiKey.slice(-4)}`,

  async test(c, ctx) {
    await privateCall(c, ctx, "account_balances");
  },

  async fetch(c, ctx) {
    const lastId = typeof ctx.cursor?.lastId === "number" ? ctx.cursor.lastId : 0;
    const rows: BsTx[] = [];
    let since = lastId + 1;
    for (;;) {
      const page = await privateCall<BsTx[]>(c, ctx, "user_transactions", {
        since_id: since,
        limit: PAGE,
        sort: "asc",
        offset: 0,
      });
      const fresh = (Array.isArray(page) ? page : []).filter((r) => Number(r.id) >= since);
      rows.push(...fresh);
      if (page.length < PAGE || fresh.length === 0) break;
      since = Math.max(...fresh.map((r) => Number(r.id))) + 1;
      await ctx.sleep(500);
    }
    const { events, skipped } = mapBitstampTransactions(rows);
    const nextLast = Math.max(lastId, ...rows.map((r) => Number(r.id)));

    const bal = await privateCall<{ currency: string; total: string }[]>(c, ctx, "account_balances");
    const totals = new Map<string, Decimal>();
    for (const b of Array.isArray(bal) ? bal : []) {
      const sym = symbol(b.currency);
      totals.set(sym, (totals.get(sym) ?? D(0)).plus(D(b.total || 0)));
    }
    const balances: Balance[] = [...totals]
      .filter(([, q]) => !q.isZero())
      .map(([sym, q]) => ({ asset: assetRef(sym), quantity: q.toFixed() }));

    return {
      events,
      balances,
      balanceScope: "all",
      cursor: { lastId: nextLast },
      warnings: skipped
        ? [
            trn(
              skipped,
              "{n} Bitstamp transaction of another kind (derivatives, settlements) was left out.",
              "{n} Bitstamp transactions of other kinds (derivatives, settlements) were left out.",
            ),
          ]
        : [],
    };
  },
};
