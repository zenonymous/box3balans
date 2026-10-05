import { createHmac } from "node:crypto";
import { z } from "zod";
import { D } from "../../lib/decimal.js";
import { assetRef, isFiat } from "../assets.js";
import { type Balance, type ExchangeProvider, ProviderError, type ProviderContext, type SyncEvent } from "../types.js";

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
    if (res.ok && data && !(data as { errorCode?: number }).errorCode) return data as T;
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

const REWARD_TYPES = new Set(["staking", "fixed_staking", "affiliate", "distribution", "rebate"]);

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
    // Bitvavo markets quote in EUR; if the asset itself is fiat something is off — skip.
    if (isFiat(asset)) return [];
    return [
      {
        kind: "trade",
        id,
        at,
        side: buy ? "buy" : "sell",
        asset: assetRef(asset),
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
            asset: assetRef(recvCur),
            quantity: recv.toFixed(),
            note,
          }
        : {
            kind: "deposit",
            id: sentCur ? `${id}:in` : id,
            at,
            asset: assetRef(recvCur),
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
      asset: assetRef(sentCur),
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
      asset: assetRef(feeCur),
      quantity: fee.toFixed(),
      note: "Bitvavo fee",
    });
  }
  return events;
}

export const bitvavo: ExchangeProvider<Creds> = {
  id: "bitvavo",
  label: "Bitvavo",
  accountKind: "exchange",
  fields: [
    { name: "apiKey", label: "API key", secret: false },
    { name: "apiSecret", label: "API secret", secret: true },
  ],
  instructions: [
    "Log in to bitvavo.com → Settings → API → Create new API key.",
    "Give it only the “View” permission. Do not enable trading or withdrawals.",
    "Optionally restrict it to your server's public IP address.",
    "Copy the key and the secret (the secret is shown only once).",
  ],
  credentials: creds,
  hint: (c) => `…${c.apiKey.slice(-4)}`,

  async test(c, ctx) {
    await call(c, ctx, "/balance");
  },

  async fetch(c, ctx) {
    const cursorMs = typeof ctx.cursor?.lastMs === "number" ? (ctx.cursor.lastMs as number) : null;
    // Re-read two days of overlap; duplicates are ignored on insert.
    const fromDate = cursorMs ? cursorMs - 2 * 86_400_000 : 0;
    const events: SyncEvent[] = [];
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
        events.push(...mapBitvavoItem(it));
        lastMs = Math.max(lastMs, Date.parse(it.executedAt));
      }
      if (!res.totalPages || page >= res.totalPages) break;
    }

    const bal = await call<{ symbol: string; available: string; inOrder: string }[]>(c, ctx, "/balance");
    const balances: Balance[] = bal
      .map((b) => ({
        asset: assetRef(b.symbol),
        quantity: D(b.available)
          .plus(D(b.inOrder || 0))
          .toFixed(),
      }))
      .filter((b) => !D(b.quantity).isZero());

    return { events, balances, balanceScope: "all", cursor: { lastMs }, warnings: [] };
  },
};
