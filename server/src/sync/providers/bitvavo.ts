import { createHmac } from "node:crypto";
import { z } from "zod";
import { D, type Decimal } from "../../lib/decimal.js";
import { assetRef } from "../assets.js";
import { type Balance, type ExchangeProvider, ProviderError, type ProviderContext, type SyncEvent } from "../types.js";
import { msg, tr } from "../../i18n/index.js";

const BASE = "https://api.bitvavo.com/v2";

const creds = z.object({
  apiKey: z.string().trim().min(10),
  apiSecret: z.string().trim().min(10),
});
type Creds = z.infer<typeof creds>;

/** Signature per Bitvavo's SDK: hex HMAC-SHA256 of timestamp + method + "/v2" + path?query + body. */
export function bitvavoSignature(secret: string, timestamp: number, method: string, pathWithQuery: string, body = "") {
  return createHmac("sha256", secret).update(`${timestamp}${method}/v2${pathWithQuery}${body}`).digest("hex");
}

async function call<T>(
  c: Creds,
  ctx: ProviderContext,
  path: string,
  query: Record<string, string | number> = {},
): Promise<T> {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
  const pathWithQuery = qs ? `${path}?${qs}` : path;
  for (let attempt = 0; ; attempt++) {
    const ts = Date.now();
    const res = await ctx.fetchFn(`${BASE}${pathWithQuery}`, {
      headers: {
        Accept: "application/json",
        "Bitvavo-Access-Key": c.apiKey,
        "Bitvavo-Access-Signature": bitvavoSignature(c.apiSecret, ts, "GET", pathWithQuery),
        "Bitvavo-Access-Timestamp": String(ts),
        "Bitvavo-Access-Window": "10000",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as (T & { errorCode?: number; error?: string }) | null;
    if (res.ok && data && !(data as { errorCode?: number }).errorCode) return data;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await ctx.sleep(2_000 * (attempt + 1));
      continue;
    }
    throw new ProviderError(`Bitvavo: ${data?.error ?? `HTTP ${res.status}`}`);
  }
}

interface HistoryItem {
  transactionId: string;
  executedAt: string;
  type: string;
  priceCurrency?: string | null;
  priceAmount?: string | null;
  sentCurrency?: string | null;
  sentAmount?: string | null;
  receivedCurrency?: string | null;
  receivedAmount?: string | null;
  feesCurrency?: string | null;
  feesAmount?: string | null;
}

const REWARD_TYPES = new Set(["staking", "fixed_staking", "affiliate", "distribution", "rebate", "loan"]);
// Assets put away (fixed staking, lending) stay yours: putting them away and getting them back
// aren't changes. What comes back on top is the reward.
const LOCK_TYPES = new Set(["fixed_staking", "loan"]);

const amt = (v: string | null | undefined) => D(v || 0);

/**
 * Maps one /account/history item to events. Assumes sent/received amounts exclude fees, with the
 * fee charged on top in `feesCurrency`; balance reconciliation flags it if that ever differs.
 */
export function mapBitvavoItem(it: HistoryItem): SyncEvent[] {
  const at = new Date(it.executedAt);
  const id = it.transactionId;
  const fee = amt(it.feesAmount);
  const feeCur = it.feesCurrency?.toUpperCase();
  const sentCur = it.sentCurrency?.toUpperCase();
  const recvCur = it.receivedCurrency?.toUpperCase();
  // Net balance changes per currency.
  const sent = sentCur ? amt(it.sentAmount).plus(feeCur === sentCur ? fee : 0) : D(0);
  const recv = recvCur ? amt(it.receivedAmount).minus(feeCur === recvCur ? fee : 0) : D(0);

  if ((it.type === "buy" || it.type === "sell") && sentCur && recvCur) {
    const buy = it.type === "buy";
    const asset = buy ? recvCur : sentCur;
    const quoteCur = buy ? sentCur : recvCur;
    // Bitvavo markets quote in EUR; if the asset itself is EUR something is off — skip.
    if (asset === "EUR") return [];
    return [
      {
        kind: "trade",
        id,
        at,
        side: buy ? "buy" : "sell",
        asset: assetRef(asset, "bitvavo"),
        quantity: (buy ? recv : sent).toFixed(),
        quote: { amount: (buy ? sent : recv).toFixed(), currency: quoteCur },
        feeQuote: feeCur === quoteCur ? fee.toFixed() : undefined,
      },
    ];
  }

  const events: SyncEvent[] = [];
  const note = it.type === "deposit" || it.type === "withdrawal" ? undefined : `Bitvavo ${it.type.replace(/_/g, " ")}`;
  if (recvCur && recv.gt(0)) {
    events.push(
      REWARD_TYPES.has(it.type)
        ? {
            kind: "reward",
            id: sentCur ? `${id}:in` : id,
            at,
            asset: assetRef(recvCur, "bitvavo"),
            quantity: recv.toFixed(),
            note,
          }
        : {
            kind: "deposit",
            id: sentCur ? `${id}:in` : id,
            at,
            asset: assetRef(recvCur, "bitvavo"),
            quantity: recv.toFixed(),
            note,
          },
    );
  }
  if (sentCur && sent.gt(0)) {
    events.push({
      kind: "withdrawal",
      id: recvCur ? `${id}:out` : id,
      at,
      asset: assetRef(sentCur, "bitvavo"),
      quantity: sent.toFixed(),
      note,
    });
  }
  // A fee in a third currency (rare) leaves the account as well.
  if (feeCur && fee.gt(0) && feeCur !== sentCur && feeCur !== recvCur) {
    events.push({
      kind: "withdrawal",
      id: `${id}:fee`,
      at,
      asset: assetRef(feeCur, "bitvavo"),
      quantity: fee.toFixed(),
      note: "Bitvavo fee",
    });
  }
  return events;
}

export interface OpenLock {
  currency: string;
  amount: string;
}

const oneSided = (it: HistoryItem) => {
  const sent = it.sentCurrency && !amt(it.sentAmount).isZero();
  const recv = it.receivedCurrency && !amt(it.receivedAmount).isZero();
  return sent && !recv
    ? { dir: "out" as const, currency: it.sentCurrency!.toUpperCase(), amount: amt(it.sentAmount) }
    : recv && !sent
      ? { dir: "in" as const, currency: it.receivedCurrency!.toUpperCase(), amount: amt(it.receivedAmount) }
      : null;
};

/**
 * Maps the history oldest first, pairing what belongs together: a cancelled withdrawal with the
 * withdrawal, moves between Bitvavo's own wallets, and fixed-staking or lending locks with their
 * release. Locks still open are carried to the next sync in the cursor.
 */
export function mapBitvavoHistory(
  items: HistoryItem[],
  openLocks: OpenLock[] = [],
): { events: SyncEvent[]; openLocks: OpenLock[] } {
  const sorted = [...items].sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt));
  const locks = openLocks.map((l) => ({ currency: l.currency, amount: D(l.amount) }));
  const skip = new Set<HistoryItem>();
  const replaced = new Map<HistoryItem, SyncEvent[]>();

  for (const it of sorted) {
    const side = oneSided(it);
    if (!side) continue;
    if (LOCK_TYPES.has(it.type)) {
      if (side.dir === "out") {
        locks.push({ currency: side.currency, amount: side.amount });
        skip.add(it);
        continue;
      }
      // A release: the locked amount comes back, anything above it is the reward. Rewards alone
      // are far smaller than a lock, so a release is at least the lock and at most 1.5× it.
      const fits = locks
        .map((l, i) => ({ l, i }))
        .filter(
          ({ l }) => l.currency === side.currency && l.amount.lte(side.amount) && side.amount.lte(l.amount.mul(1.5)),
        )
        .sort((a, b) => b.l.amount.cmp(a.l.amount));
      const i = fits[0]?.i ?? -1;
      if (i < 0) continue;
      const [lock] = locks.splice(i, 1);
      const reward = side.amount.minus(lock!.amount);
      if (reward.isZero()) skip.add(it);
      else replaced.set(it, mapBitvavoItem({ ...it, receivedAmount: reward.toFixed(), feesAmount: null }));
    } else if (it.type === "withdrawal_cancelled" && side.dir === "in") {
      // Undo the latest withdrawal of this currency that the refund covers.
      const w = sorted.findLast(
        (x) =>
          x.type === "withdrawal" &&
          !skip.has(x) &&
          !replaced.has(x) &&
          Date.parse(x.executedAt) <= Date.parse(it.executedAt) &&
          x.sentCurrency?.toUpperCase() === side.currency &&
          amt(x.sentAmount).lte(side.amount) &&
          side.amount.lte(
            amt(x.sentAmount).plus(x.feesCurrency?.toUpperCase() === side.currency ? amt(x.feesAmount) : 0),
          ),
      );
      if (!w) continue;
      skip.add(it);
      // A fee that wasn't refunded stays a cost.
      const kept = amt(w.sentAmount)
        .plus(w.feesCurrency?.toUpperCase() === side.currency ? amt(w.feesAmount) : 0)
        .minus(side.amount);
      if (kept.isZero()) skip.add(w);
      else
        replaced.set(w, [
          {
            kind: "withdrawal",
            id: w.transactionId,
            at: new Date(w.executedAt),
            asset: assetRef(side.currency, "bitvavo"),
            quantity: kept.toFixed(),
            note: "Bitvavo fee on a cancelled withdrawal",
          },
        ]);
    } else if (it.type === "internal_transfer" && side.dir === "out") {
      const back = sorted.find((x) => {
        const o = x !== it && x.type === "internal_transfer" && !skip.has(x) ? oneSided(x) : null;
        return o?.dir === "in" && o.currency === side.currency && o.amount.eq(side.amount);
      });
      if (back) {
        skip.add(it);
        skip.add(back);
      }
    }
  }

  const events: SyncEvent[] = [];
  for (const it of sorted) {
    if (skip.has(it)) continue;
    events.push(...(replaced.get(it) ?? mapBitvavoItem(it)));
  }
  return { events, openLocks: locks.map((l) => ({ currency: l.currency, amount: l.amount.toFixed() })) };
}

export const bitvavo: ExchangeProvider<Creds> = {
  id: "bitvavo",
  label: "Bitvavo",
  accountKind: "exchange",
  fields: [
    { name: "apiKey", label: msg("API key"), secret: false },
    { name: "apiSecret", label: msg("API secret"), secret: true },
  ],
  instructions: [
    msg("Log in to bitvavo.com → Settings → API → Create new API key."),
    msg("Give it only the “View” permission. Do not enable trading or withdrawals."),
    msg("Optionally restrict it to your server's public IP address."),
    msg("Copy the key and the secret (the secret is shown only once)."),
  ],
  credentials: creds,
  hint: (c) => `…${c.apiKey.slice(-4)}`,

  async test(c, ctx) {
    await call(c, ctx, "/balance");
  },

  async fetch(c, ctx) {
    const cursorMs = typeof ctx.cursor?.lastMs === "number" ? ctx.cursor.lastMs : null;
    // Re-read two days of overlap; duplicates are ignored on insert.
    const fromDate = cursorMs ? cursorMs - 2 * 86_400_000 : 0;
    const items: HistoryItem[] = [];
    let lastMs = cursorMs ?? 0;
    for (let page = 1; ; page++) {
      const res = await call<{ items: HistoryItem[]; currentPage: number; totalPages: number }>(
        c,
        ctx,
        "/account/history",
        {
          fromDate,
          page,
          maxItems: 100,
        },
      );
      for (const it of res.items ?? []) {
        items.push(it);
        lastMs = Math.max(lastMs, Date.parse(it.executedAt));
      }
      if (!res.totalPages || page >= res.totalPages) break;
    }

    // Items handled by the previous sync (re-read in the overlap) are skipped: their events are in,
    // and pairing them again could leave out what they were paired with.
    const seen = new Set((ctx.cursor?.seen as string[] | undefined) ?? []);
    const prevLocks = (ctx.cursor?.locks as OpenLock[] | undefined) ?? [];
    const { events, openLocks } = mapBitvavoHistory(
      items.filter((it) => !seen.has(it.transactionId)),
      prevLocks,
    );
    const nextFrom = lastMs - 2 * 86_400_000;
    const nextSeen = items.filter((it) => Date.parse(it.executedAt) >= nextFrom).map((it) => it.transactionId);

    const totals = new Map<string, Decimal>();
    const add = (symbol: string, q: Decimal) => totals.set(symbol, (totals.get(symbol) ?? D(0)).plus(q));
    const bal = await call<{ symbol: string; available: string; inOrder: string }[]>(c, ctx, "/balance");
    for (const b of bal) add(b.symbol, D(b.available).plus(D(b.inOrder || 0)));
    // Assets in fixed staking aren't in /balance.
    const warnings: string[] = [];
    try {
      const staked = await call<{ symbol: string; amount: string }[]>(c, ctx, "/stakingBalance");
      for (const s of staked) add(s.symbol, D(s.amount || 0));
    } catch (err) {
      warnings.push(
        tr("Couldn't read the fixed-staking balance ({error}); staked assets may show as a difference.", {
          error: (err as Error).message,
        }),
      );
    }
    const balances: Balance[] = [...totals]
      .filter(([, q]) => !q.isZero())
      .map(([symbol, q]) => ({ asset: assetRef(symbol, "bitvavo"), quantity: q.toFixed() }));

    return {
      events,
      balances,
      balanceScope: "all",
      cursor: { lastMs, locks: openLocks, seen: nextSeen },
      warnings,
    };
  },
};
