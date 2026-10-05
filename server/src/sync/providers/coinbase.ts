import { createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import { D } from "../../lib/decimal.js";
import { assetRef, isFiat } from "../assets.js";
import { type Balance, type ExchangeProvider, ProviderError, type ProviderContext, type SyncEvent } from "../types.js";

const HOST = "api.coinbase.com";

// Users often paste the key from Coinbase's JSON download, where newlines are escaped.
const normalisePem = (s: string) => s.trim().replace(/\\n/g, "\n");

const creds = z.object({
  keyName: z
    .string()
    .trim()
    .regex(/^organizations\/[^/]+\/apiKeys\/[^/]+$/, "Expected organizations/{org_id}/apiKeys/{key_id}"),
  privateKey: z
    .string()
    .transform(normalisePem)
    .refine(
      (s) => s.includes("BEGIN EC PRIVATE KEY") || s.includes("BEGIN PRIVATE KEY"),
      "Expected an ECDSA private key (PEM)",
    ),
});
type Creds = z.infer<typeof creds>;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** ES256 JWT for one Coinbase request (valid 2 minutes, bound to method + path). */
export function coinbaseJwt(
  c: Creds,
  method: string,
  path: string,
  now = Math.floor(Date.now() / 1000),
  key?: KeyObject,
): string {
  const header = { alg: "ES256", typ: "JWT", kid: c.keyName, nonce: randomBytes(16).toString("hex") };
  const payload = {
    iss: "cdp",
    sub: c.keyName,
    nbf: now,
    exp: now + 120,
    uri: `${method} ${HOST}${path.split("?")[0]}`,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = sign("sha256", Buffer.from(input), {
    key: key ?? createPrivateKey(c.privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${b64url(sig)}`;
}

async function call<T>(c: Creds, ctx: ProviderContext, path: string): Promise<T> {
  let key: KeyObject;
  try {
    key = createPrivateKey(c.privateKey);
  } catch {
    throw new ProviderError(
      "Coinbase: the private key could not be read. Paste the full PEM including the BEGIN/END lines.",
    );
  }
  for (let attempt = 0; ; attempt++) {
    const res = await ctx.fetchFn(`https://${HOST}${path}`, {
      headers: {
        Authorization: `Bearer ${coinbaseJwt(c, "GET", path, undefined, key)}`,
        Accept: "application/json",
        "CB-VERSION": "2024-01-01",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as (T & { errors?: { message: string }[] }) | null;
    if (res.ok && data) return data as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await ctx.sleep(2_000 * (attempt + 1));
      continue;
    }
    throw new ProviderError(`Coinbase: ${data?.errors?.map((e) => e.message).join(", ") || `HTTP ${res.status}`}`);
  }
}

interface CbAccount {
  id: string;
  currency: { code: string; type?: string } | string;
  balance: { amount: string; currency: string };
}

interface CbTx {
  id: string;
  type: string;
  status: string;
  amount: { amount: string; currency: string };
  native_amount?: { amount: string; currency: string };
  created_at: string;
}

interface Page<T> {
  data: T[];
  pagination?: { next_uri?: string | null };
}

const TRADE_TYPES = new Set([
  "buy",
  "sell",
  "advanced_trade_fill",
  "trade",
  "retail_simple_dust",
  "wrap_asset",
  "unwrap_asset",
]);
const REWARD_TYPES = new Set([
  "earn_payout",
  "incentives_rewards_payout",
  "subscription_rebate",
  "staking_reward",
  "inflation_reward",
  "interest",
]);
// Moves between Coinbase's own wallets (e.g. into staking): not portfolio changes.
const SKIP_TYPES = new Set(["staking_transfer", "unstaking_transfer"]);

const currencyCode = (a: CbAccount) => (typeof a.currency === "string" ? a.currency : a.currency.code).toUpperCase();

/**
 * Maps a Coinbase v2 transaction. Every transaction is a single-asset movement with its EUR value
 * in `native_amount` (when the profile's native currency is EUR). Trades in crypto wallets are booked
 * at that value; the matching fiat-wallet movement is booked separately as a cash change.
 */
export function mapCoinbaseTx(tx: CbTx, eurValue: string | undefined): SyncEvent | null {
  if (tx.status !== "completed" || SKIP_TYPES.has(tx.type)) return null;
  const cur = tx.amount.currency.toUpperCase();
  const amount = D(tx.amount.amount);
  if (amount.isZero()) return null;
  const at = new Date(tx.created_at);
  const quantity = amount.abs().toFixed();
  const asset = assetRef(cur);
  const fiat = isFiat(cur);
  const note = `Coinbase ${tx.type.replace(/_/g, " ")}`;

  if (TRADE_TYPES.has(tx.type)) {
    if (fiat)
      return {
        kind: amount.gt(0) ? "deposit" : "withdrawal",
        id: tx.id,
        at,
        asset,
        quantity,
        note: `${note} (settlement)`,
      };
    if (eurValue == null) return null;
    return {
      kind: "trade",
      id: tx.id,
      at,
      side: amount.gt(0) ? "buy" : "sell",
      asset,
      quantity,
      valueEur: D(eurValue).abs().toFixed(),
      note,
    };
  }
  if (REWARD_TYPES.has(tx.type) && amount.gt(0)) {
    return {
      kind: "reward",
      id: tx.id,
      at,
      asset,
      quantity,
      valueEur: eurValue != null ? D(eurValue).abs().toFixed() : undefined,
      note,
    };
  }
  const plain =
    tx.type === "send" || tx.type === "receive" || tx.type === "fiat_deposit" || tx.type === "fiat_withdrawal";
  return {
    kind: amount.gt(0) ? "deposit" : "withdrawal",
    id: tx.id,
    at,
    asset,
    quantity,
    valueEur: amount.gt(0) && eurValue != null ? D(eurValue).abs().toFixed() : undefined,
    note: plain ? undefined : note,
  };
}

export const coinbase: ExchangeProvider<Creds> = {
  id: "coinbase",
  label: "Coinbase",
  accountKind: "exchange",
  fields: [
    { name: "keyName", label: "API key name", secret: false, placeholder: "organizations/…/apiKeys/…" },
    {
      name: "privateKey",
      label: "Private key",
      secret: true,
      multiline: true,
      placeholder: "-----BEGIN EC PRIVATE KEY-----",
    },
  ],
  instructions: [
    "Open the Coinbase Developer Platform (portal.cdp.coinbase.com) → API Keys → Create API key, signed in with your Coinbase account.",
    "Under advanced settings choose the ECDSA signature algorithm (Ed25519 keys are not accepted by the Coinbase App API).",
    "Grant only “View” permissions on your Coinbase App portfolio. No trade or transfer permissions.",
    "Paste the key name (organizations/…/apiKeys/…) and the full private key including the BEGIN/END lines.",
  ],
  credentials: creds,
  hint: (c) => `…${c.keyName.slice(-6)}`,

  async test(c, ctx) {
    await call(c, ctx, "/v2/accounts?limit=1");
  },

  async fetch(c, ctx) {
    const accounts: CbAccount[] = [];
    for (let path: string | null | undefined = "/v2/accounts?limit=100"; path;) {
      const page: Page<CbAccount> = await call<Page<CbAccount>>(c, ctx, path);
      accounts.push(...page.data);
      path = page.pagination?.next_uri;
    }

    const incremental = ctx.cursor?.synced === true;
    const events: SyncEvent[] = [];
    const warnings: string[] = [];
    let nonEurNative = false;
    for (const acc of accounts) {
      for (let path: string | null | undefined = `/v2/accounts/${acc.id}/transactions?limit=100`; path;) {
        const page: Page<CbTx> = await call<Page<CbTx>>(c, ctx, path);
        for (const tx of page.data) {
          const native = tx.native_amount;
          const eur = native && native.currency.toUpperCase() === "EUR" ? native.amount : undefined;
          if (native && native.currency.toUpperCase() !== "EUR") nonEurNative = true;
          const e = mapCoinbaseTx(tx, eur);
          if (e) events.push(e);
        }
        // Newest first: once a whole page is already stored, older pages are too.
        if (incremental && page.data.length > 0) {
          const known = await ctx.isKnown(page.data.map((t) => t.id));
          if (page.data.every((t) => known.has(t.id))) break;
        }
        path = page.pagination?.next_uri;
      }
    }
    if (nonEurNative) {
      warnings.push(
        "Your Coinbase native currency is not EUR; set it to EUR in Coinbase settings so trades can be valued exactly.",
      );
    }

    const balances: Balance[] = accounts
      .filter((a) => !D(a.balance.amount).isZero())
      .map((a) => ({ asset: assetRef(currencyCode(a)), quantity: a.balance.amount }));

    return { events, balances, balanceScope: "all", cursor: { synced: true }, warnings };
  },
};
