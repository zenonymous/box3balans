import { createHmac } from "node:crypto";
import { z } from "zod";
import { messageLanguage, msg, tr, trn } from "../../i18n/index.js";
import { D, type Decimal } from "../../lib/decimal.js";
import { assetRef, isFiat } from "../assets.js";
import { type Balance, type ExchangeProvider, ProviderError, type ProviderContext, type SyncEvent } from "../types.js";

// Bybit EU (Austria, MiCA), where Dutch accounts are since Bybit.nl closed in 2025.
const HOST = "api.bybit.eu";
const RECV_WINDOW = "10000";
const DAY = 86_400_000;
// Nothing older: Bybit EU started in 2025, and Bybit.nl's history didn't move along.
const EARLIEST = Date.parse("2025-01-01T00:00:00Z");
// Spot fills go back two years; an hour's margin keeps the first window inside that.
const FILLS_BACK = 2 * 365 * DAY - 3_600_000;
// Each sync starts two days before the last one stopped, for what was booked late.
const OVERLAP = 2 * DAY;

const creds = z.object({
  apiKey: z.string().trim().min(10),
  apiSecret: z.string().trim().min(10),
});
type Creds = z.infer<typeof creds>;

/**
 * Bybit's v5 signature for a GET: lowercase hex HMAC-SHA256, keyed with the secret, over the
 * timestamp, the key, the receive window and the query string as sent.
 */
export function bybitSignature(
  secret: string,
  parts: { timestamp: string; apiKey: string; recvWindow: string; query: string },
): string {
  return createHmac("sha256", secret)
    .update(`${parts.timestamp}${parts.apiKey}${parts.recvWindow}${parts.query}`)
    .digest("hex");
}

/** A spot fill from /v5/execution/list. execFee is what was paid (a rebate is negative). */
export interface BybitExecution {
  symbol: string;
  execId: string;
  orderId: string;
  side: string; // "Buy" or "Sell"
  execQty: string;
  execValue: string;
  execFee: string;
  feeCurrency: string;
  execTime: string;
  execType: string;
}

export type Pairs = Map<string, { base: string; quote: string }>;

/**
 * Turns spot fills into trades. A fee in the coin bought comes off what arrives, in the coin sold
 * on top of what leaves; a fee in the money comes on top of a purchase and off a sale. A fee in a
 * third coin is a line of its own. Fills that aren't trades, or of a market not in `pairs`, are
 * counted in `skipped`.
 */
export function mapBybitExecutions(rows: BybitExecution[], pairs: Pairs): { events: SyncEvent[]; skipped: number } {
  const events: SyncEvent[] = [];
  let skipped = 0;
  for (const r of rows) {
    const pair = pairs.get(r.symbol);
    const side = r.side === "Buy" ? "buy" : r.side === "Sell" ? "sell" : null;
    if (r.execType !== "Trade" || !pair || !side) {
      skipped++;
      continue;
    }
    const id = `bybit:exec:${r.execId}`;
    const at = new Date(Number(r.execTime));
    const fee = D(r.execFee || 0);
    const feeIn = r.feeCurrency.toUpperCase();
    const inBase = !fee.isZero() && feeIn === pair.base;
    const inQuote = !fee.isZero() && feeIn === pair.quote;
    const qty = D(r.execQty);
    const value = D(r.execValue);
    const quantity = inBase ? (side === "buy" ? qty.minus(fee) : qty.plus(fee)) : qty;
    const quoteAmount = inQuote ? (side === "buy" ? value.plus(fee) : value.minus(fee)) : value;
    events.push({
      kind: "trade",
      id,
      at,
      side,
      asset: assetRef(pair.base),
      quantity: quantity.toFixed(),
      quote: { amount: quoteAmount.toFixed(), currency: pair.quote },
      feeQuote: inQuote ? fee.toFixed() : undefined,
    });
    if (!fee.isZero() && !inBase && !inQuote && fee.gt(0) && feeIn)
      events.push({
        kind: "fee",
        id: `${id}:fee`,
        at,
        asset: assetRef(feeIn),
        quantity: fee.toFixed(),
        note: "Bybit fee",
      });
  }
  return { events, skipped };
}

/** A conversion from /v5/asset/exchange/query-convert-history (Convert, also on the web or app). */
export interface BybitConvert {
  exchangeTxId: string;
  accountType: string;
  fromCoin: string;
  toCoin: string;
  fromAmount: string;
  toAmount: string;
  exchangeStatus: string;
  createdAt: string;
}

/**
 * Turns finished conversions into trades: against money a purchase or sale of the coin, between two
 * coins a purchase paid with the coin given up. Bybit's rate includes its spread, so there's no
 * fee apart.
 */
export function mapBybitConverts(rows: BybitConvert[]): { events: SyncEvent[] } {
  const events: SyncEvent[] = [];
  for (const r of rows) {
    if (r.exchangeStatus !== "success") continue;
    const from = r.fromCoin.toUpperCase();
    const to = r.toCoin.toUpperCase();
    const sell = !isFiat(from) && isFiat(to);
    const [asset, qty, quote, amount] = sell
      ? [from, r.fromAmount, to, r.toAmount]
      : [to, r.toAmount, from, r.fromAmount];
    events.push({
      kind: "trade",
      id: `bybit:convert:${r.exchangeTxId}`,
      at: msTime(r.createdAt),
      side: sell ? "sell" : "buy",
      asset: assetRef(asset),
      quantity: D(qty).abs().toFixed(),
      quote: { amount: D(amount).abs().toFixed(), currency: quote },
      note: "Bybit Convert",
    });
  }
  return { events };
}

/** Bybit gives times in milliseconds, a few in seconds. */
const msTime = (t: string | number) => {
  const n = Number(t);
  return new Date(n < 1e12 ? n * 1000 : n);
};

/** An on-chain deposit from /v5/asset/deposit/query-record; status 3 is a deposit that went through. */
export interface BybitDeposit {
  id: string;
  coin: string;
  amount: string;
  txID: string;
  status: number;
  successAt: string;
  depositFee: string;
}

/** A withdrawal from /v5/asset/withdraw/query-record; the fee is apart from the amount. */
export interface BybitWithdrawal {
  withdrawId: string;
  coin: string;
  amount: string;
  withdrawFee: string;
  status: string;
  updateTime: string;
}

/** A line of the Funding account's history (/v5/asset/fundinghistory); times in seconds. */
export interface BybitFunding {
  currcCursor: string;
  currency: string;
  ioDirection: string; // "I" in, "O" out
  txnAmt: string;
  createTime: string;
  showBusiTypeEn: string;
  descriptionEn: string;
}

/**
 * Deposits and withdrawals. Coins come from their own records: a deposit at the amount credited,
 * a withdrawal at the amount plus Bybit's fee (as rotki reads them). Money only shows in the Funding
 * account's history, so euro deposits and withdrawals are taken from there; its other lines are
 * already read elsewhere (Convert) or are moves within Bybit.
 */
export function mapBybitTransfers(src: {
  deposits: BybitDeposit[];
  withdrawals: BybitWithdrawal[];
  funding: BybitFunding[];
}): { events: SyncEvent[] } {
  const events: SyncEvent[] = [];
  for (const d of src.deposits) {
    if (Number(d.status) !== 3) continue;
    events.push({
      kind: "deposit",
      id: `bybit:deposit:${d.id || d.txID}`,
      at: msTime(d.successAt),
      asset: assetRef(d.coin.toUpperCase()),
      quantity: D(d.amount).abs().toFixed(),
    });
  }
  for (const w of src.withdrawals) {
    if (w.status !== "success") continue;
    events.push({
      kind: "withdrawal",
      id: `bybit:withdrawal:${w.withdrawId}`,
      at: msTime(w.updateTime),
      asset: assetRef(w.coin.toUpperCase()),
      quantity: D(w.amount)
        .abs()
        .plus(D(w.withdrawFee || 0))
        .toFixed(),
    });
  }
  for (const f of src.funding) {
    const currency = f.currency.toUpperCase();
    if (!isFiat(currency)) continue;
    const what = `${f.showBusiTypeEn} ${f.descriptionEn}`.toLowerCase();
    const kind =
      f.ioDirection === "I" && /deposit/.test(what) && !/cancel|refund/.test(what)
        ? "deposit"
        : f.ioDirection === "O" && /withdraw/.test(what)
          ? "withdrawal"
          : null;
    if (!kind) continue;
    events.push({
      kind,
      id: `bybit:fund:${f.currcCursor}`,
      at: msTime(f.createTime),
      asset: assetRef(currency),
      quantity: D(f.txnAmt).abs().toFixed(),
    });
  }
  return { events };
}

type Envelope<T> = { retCode?: number; retMsg?: string; result?: T };

class BybitRefused extends ProviderError {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

// Codes Bybit gives for a key that's wrong, expired or not allowed.
const KEY_TROUBLE: Record<number, () => string> = {
  10003: () =>
    tr("Bybit doesn't know this API key. Check that you made it at bybit.eu (not bybit.com) and copied all of it."),
  10004: () => tr("Bybit says the signature is wrong. Check that the API secret is copied in full."),
  10005: () => tr("This Bybit key may not read this. Give it the read-only permissions the steps list."),
  10010: () => tr("This Bybit key is tied to other IP addresses than the one Box3balans connects from."),
  33004: () => tr("This Bybit API key has expired. Extend it, or make a new one, under API management at bybit.eu."),
  [-2015]: () => tr("This Bybit API key has expired. Extend it, or make a new one, under API management at bybit.eu."),
};

/**
 * Query string in the order given, each value encoded (Bybit's page cursors hold "="): the
 * signature covers exactly what is sent.
 */
const queryOf = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

async function call<T>(
  c: Creds | null,
  ctx: ProviderContext,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const query = queryOf(params);
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (c) {
      const timestamp = String(Date.now());
      Object.assign(headers, {
        "X-BAPI-API-KEY": c.apiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": RECV_WINDOW,
        "X-BAPI-SIGN": bybitSignature(c.apiSecret, { timestamp, apiKey: c.apiKey, recvWindow: RECV_WINDOW, query }),
      });
    }
    const res = await ctx.fetchFn(`https://${HOST}/v5/${path}${query ? `?${query}` : ""}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as Envelope<T> | null;
    const code = typeof data?.retCode === "number" ? data.retCode : null;
    if (res.ok && code === 0 && data?.result !== undefined) return data.result;
    // 10006 and 10018: over a rate limit. 10002: the clock drifted (a retry has a new timestamp).
    // 10000 and 10016: Bybit's own trouble.
    const retryable =
      res.status === 429 ||
      res.status >= 500 ||
      code === 10006 ||
      code === 10018 ||
      code === 10002 ||
      code === 10000 ||
      code === 10016;
    if (retryable && attempt < 5) {
      await ctx.sleep(code === 10006 || code === 10018 || res.status === 429 ? 5_000 : 2_000);
      continue;
    }
    if (res.status === 403 && code === null)
      throw new ProviderError(
        tr("Bybit refused the connection (HTTP 403): too many requests, or a country it doesn't serve."),
      );
    const known = code !== null ? KEY_TROUBLE[code] : undefined;
    const detail = [code, data?.retMsg].filter((x) => x !== null && x !== undefined && x !== "").join(" ");
    throw new BybitRefused(
      code ?? res.status,
      `Bybit: ${known ? `${known()} (${detail})` : detail || `HTTP ${res.status}`}`,
    );
  }
}

/** Spans of at most `size` from `from` to `to`, back to back; `step` is the unit Bybit counts in. */
function* windows(from: number, to: number, size: number, step = 1): Generator<[number, number]> {
  for (let a = from; a <= to;) {
    const b = Math.min(a + size - step, to);
    yield [a, b];
    a = b + step;
  }
}

/** Every page of a window, following nextPageCursor. */
async function pages<T>(
  c: Creds,
  ctx: ProviderContext,
  path: string,
  key: "list" | "rows",
  params: Record<string, string | number>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const r = await call<{ list?: T[]; rows?: T[]; nextPageCursor?: string }>(c, ctx, path, { ...params, cursor });
    const rows = r[key] ?? [];
    out.push(...rows);
    if (!r.nextPageCursor || rows.length === 0 || r.nextPageCursor === cursor) return out;
    cursor = r.nextPageCursor;
    await ctx.sleep(120);
  }
}

/** Spot markets and their two coins, from Bybit's public list. */
async function spotPairs(ctx: ProviderContext): Promise<Pairs> {
  const pairs: Pairs = new Map();
  let cursor: string | undefined;
  for (;;) {
    const r = await call<{ list?: { symbol: string; baseCoin: string; quoteCoin: string }[]; nextPageCursor?: string }>(
      null,
      ctx,
      "market/instruments-info",
      { category: "spot", limit: 1000, cursor },
    );
    for (const i of r.list ?? [])
      pairs.set(i.symbol, { base: i.baseCoin.toUpperCase(), quote: i.quoteCoin.toUpperCase() });
    if (!r.nextPageCursor || r.nextPageCursor === cursor || !r.list?.length) return pairs;
    cursor = r.nextPageCursor;
  }
}

/** What Bybit says about the key (user/query-api); null when it doesn't answer. */
async function keyInfo(c: Creds, ctx: ProviderContext): Promise<{ readOnly: boolean; expires: Date | null } | null> {
  try {
    const k = await call<{ readOnly?: number; expiredAt?: string }>(c, ctx, "user/query-api");
    const expires = k.expiredAt ? new Date(k.expiredAt) : null;
    return { readOnly: Number(k.readOnly) === 1, expires: expires && !Number.isNaN(+expires) ? expires : null };
  } catch (e) {
    // A key Bybit refuses outright is said by the calls after this one.
    if (e instanceof BybitRefused) return null;
    throw e;
  }
}

const notReadOnly = () =>
  tr(
    "This Bybit key can do more than read. Make a new key with “Read-Only”: Box3balans only reads, and a key that can do more is worth more to anyone who gets hold of it.",
  );

const longDate = (d: Date) =>
  new Intl.DateTimeFormat(messageLanguage() === "nl" ? "nl-NL" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  }).format(d);

export const bybit: ExchangeProvider<Creds> = {
  id: "bybit",
  label: "Bybit",
  accountKind: "exchange",
  fields: [
    { name: "apiKey", label: msg("API key"), secret: false },
    { name: "apiSecret", label: msg("API secret"), secret: true },
  ],
  instructions: [
    msg("Log in to bybit.eu → your profile → API → Create New Key → System-generated API Keys."),
    msg("Choose “Read-Only”. Leave trading, withdrawals and every other permission off."),
    msg(
      "A key without IP addresses expires after 90 days. Tie it to your server's public IP address to keep it, or extend it at bybit.eu before then; Box3balans warns two weeks ahead.",
    ),
    msg("Copy the key and the secret: Bybit shows the secret only once."),
  ],
  credentials: creds,
  hint: (c) => `…${c.apiKey.slice(-4)}`,

  async test(c, ctx) {
    await call(c, ctx, "account/wallet-balance", { accountType: "UNIFIED" });
    if ((await keyInfo(c, ctx))?.readOnly === false) throw new ProviderError(notReadOnly());
  },

  async fetch(c, ctx) {
    const now = Date.now();
    const nowS = Math.floor(now / 1000) * 1000;
    const synced = typeof ctx.cursor?.syncedTo === "number" ? ctx.cursor.syncedTo : null;
    const from = synced === null ? EARLIEST : Math.max(EARLIEST, synced - OVERLAP);
    const warnings: string[] = [];
    const key = await keyInfo(c, ctx);
    // A key made before this check, or changed since: said at every sync.
    if (key?.readOnly === false) warnings.push(notReadOnly());
    if (key?.expires && key.expires.getTime() - now < 14 * DAY)
      warnings.push(
        tr(
          "This Bybit API key expires on {date}. Extend it under API management at bybit.eu, or tie it to your server's IP address so it doesn't expire.",
          { date: longDate(key.expires) },
        ),
      );

    const fillsFrom = Math.max(from, now - FILLS_BACK);
    if (fillsFrom > from)
      warnings.push(
        tr(
          "Bybit gives spot trades for the last two years only. Trades between {from} and {to} couldn't be read; import them from Bybit's Data Export (CSV).",
          { from: longDate(new Date(from)), to: longDate(new Date(fillsFrom)) },
        ),
      );
    const pairs = await spotPairs(ctx);
    const fills: BybitExecution[] = [];
    for (const [a, b] of windows(fillsFrom, now, 7 * DAY)) {
      fills.push(
        ...(await pages<BybitExecution>(c, ctx, "execution/list", "list", {
          category: "spot",
          startTime: a,
          endTime: b,
          limit: 100,
        })),
      );
      await ctx.sleep(120);
    }

    const converts: BybitConvert[] = [];
    for (let index = 1; ; index++) {
      const r = await call<{ list?: BybitConvert[] }>(c, ctx, "asset/exchange/query-convert-history", {
        index,
        limit: 100,
      });
      const list = r.list ?? [];
      converts.push(...list);
      if (list.length < 100) break;
      // Newest first: once a whole page is imported, older pages are too.
      if (synced !== null) {
        const done = list.filter((x) => x.exchangeStatus === "success" || x.exchangeStatus === "failure");
        const known = await ctx.isKnown(done.map((x) => `bybit:convert:${x.exchangeTxId}`));
        if (
          done.length === list.length &&
          done.every((x) => x.exchangeStatus === "failure" || known.has(`bybit:convert:${x.exchangeTxId}`))
        )
          break;
      }
      await ctx.sleep(120);
    }

    const deposits: BybitDeposit[] = [];
    const withdrawals: BybitWithdrawal[] = [];
    for (const [a, b] of windows(from, now, 30 * DAY)) {
      deposits.push(
        ...(await pages<BybitDeposit>(c, ctx, "asset/deposit/query-record", "rows", {
          startTime: a,
          endTime: b,
          limit: 50,
        })),
      );
      withdrawals.push(
        ...(await pages<BybitWithdrawal>(c, ctx, "asset/withdraw/query-record", "rows", {
          withdrawType: 2,
          startTime: a,
          endTime: b,
          limit: 50,
        })),
      );
      await ctx.sleep(120);
    }
    const funding: BybitFunding[] = [];
    for (const [a, b] of windows(Math.floor(from / 1000) * 1000, nowS, 7 * DAY, 1000)) {
      funding.push(
        ...(await pages<BybitFunding>(c, ctx, "asset/fundinghistory", "list", {
          createTimeFrom: a / 1000,
          createTimeTo: b / 1000,
          limit: 100,
        })),
      );
      await ctx.sleep(120);
    }

    const trades = mapBybitExecutions(fills, pairs);
    const events = [
      ...trades.events,
      ...mapBybitConverts(converts).events,
      ...mapBybitTransfers({ deposits, withdrawals, funding }).events,
    ];

    // What's yours: the Unified Trading Account without what was borrowed, plus the Funding account.
    const totals = new Map<string, Decimal>();
    const add = (coin: string, q: Decimal) =>
      totals.set(coin.toUpperCase(), (totals.get(coin.toUpperCase()) ?? D(0)).plus(q));
    const uta = await call<{ list?: { coin?: { coin: string; walletBalance: string; spotBorrow?: string }[] }[] }>(
      c,
      ctx,
      "account/wallet-balance",
      { accountType: "UNIFIED" },
    );
    const borrowed: string[] = [];
    for (const a of uta.list ?? [])
      for (const x of a.coin ?? []) {
        const loan = D(x.spotBorrow || 0);
        if (loan.gt(0)) borrowed.push(`${loan.toFixed()} ${x.coin.toUpperCase()}`);
        add(x.coin, D(x.walletBalance || 0).minus(loan));
      }
    const fund = await call<{ balance?: { coin: string; walletBalance: string }[] }>(
      c,
      ctx,
      "asset/transfer/query-account-coins-balance",
      {
        accountType: "FUND",
      },
    );
    for (const x of fund.balance ?? []) add(x.coin, D(x.walletBalance || 0));
    const balances: Balance[] = [...totals]
      .filter(([, q]) => !q.isZero())
      .map(([sym, q]) => ({ asset: assetRef(sym), quantity: q.toFixed() }));

    // Counted over every sync: the cursor moves past them, the warning stays.
    const skipped = (typeof ctx.cursor?.skipped === "number" ? ctx.cursor.skipped : 0) + trades.skipped;
    if (skipped)
      warnings.push(
        trn(
          skipped,
          "{n} Bybit spot trade on a market Box3balans doesn't know was left out. If a balance differs from Bybit's, it's the likely cause.",
          "{n} Bybit spot trades on markets Box3balans doesn't know were left out. If a balance differs from Bybit's, they're the likely cause.",
        ),
      );
    if (borrowed.length)
      warnings.push(
        tr(
          "{coins} at Bybit is borrowed (spot margin) and isn't counted as yours. Enter the loan as a debt if it was still open on 1 January.",
          { coins: borrowed.join(", ") },
        ),
      );

    return { events, balances, balanceScope: "all", cursor: { syncedTo: now, skipped }, warnings };
  },
};
