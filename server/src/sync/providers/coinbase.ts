import { createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import { D, type Decimal } from "../../lib/decimal.js";
import { assetRef, isFiat } from "../assets.js";
import { type Balance, type ExchangeProvider, ProviderError, type ProviderContext, type SyncEvent } from "../types.js";
import { msg, tr } from "../../i18n/index.js";

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
      tr("Coinbase: the private key could not be read. Paste the full PEM including the BEGIN/END lines."),
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
    if (res.ok && data) return data;
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
  "asset_migration",
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
// Moves that leave one Coinbase wallet for another one (a vault, another portfolio, the ETH2
// wallet being retired). Both legs visible: nothing changed. One leg: it left or entered the
// wallets this key can see.
const MOVE_TYPES = new Set([
  "transfer",
  "vault_withdrawal",
  "retail_eth2_deprecation",
  "intx_deposit",
  "intx_withdrawal",
  "exchange_deposit",
  "exchange_withdrawal",
  "pro_deposit",
  "pro_withdrawal",
]);
const PAIR_WINDOW_MS = 86_400_000;

// Coinbase kept staked ether in a separate ETH2 wallet; it's ether all the same.
const ALIASES: Record<string, string> = { ETH2: "ETH" };
export const coinbaseSymbol = (code: string) => ALIASES[code.toUpperCase()] ?? code.toUpperCase();

const currencyCode = (a: CbAccount) => coinbaseSymbol(typeof a.currency === "string" ? a.currency : a.currency.code);

/**
 * Maps a Coinbase v2 transaction. Every transaction is a single-asset movement with its EUR value
 * in `native_amount` (when the profile's native currency is EUR). Trades in crypto wallets are booked
 * at that value; the matching fiat-wallet movement is booked separately as a cash change.
 */
export function mapCoinbaseTx(tx: CbTx, eurValue: string | undefined): SyncEvent | null {
  if (tx.status !== "completed" || SKIP_TYPES.has(tx.type)) return null;
  const cur = coinbaseSymbol(tx.amount.currency);
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

/**
 * Maps a batch of new transactions, dropping moves whose two legs (equal and opposite, same
 * currency, within a day) are both in it. Returns the ids deliberately left out.
 */
export function mapCoinbaseTxs(list: { tx: CbTx; eur: string | undefined }[]): {
  events: SyncEvent[];
  dropped: string[];
} {
  const moves = list
    .filter(({ tx }) => tx.status === "completed" && MOVE_TYPES.has(tx.type))
    .sort((a, b) => Date.parse(a.tx.created_at) - Date.parse(b.tx.created_at));
  const paired = new Set<string>();
  for (const { tx: out } of moves) {
    const amount = D(out.amount.amount);
    if (!amount.lt(0) || paired.has(out.id)) continue;
    const back = moves.find(
      ({ tx }) =>
        !paired.has(tx.id) &&
        coinbaseSymbol(tx.amount.currency) === coinbaseSymbol(out.amount.currency) &&
        D(tx.amount.amount).eq(amount.neg()) &&
        Math.abs(Date.parse(tx.created_at) - Date.parse(out.created_at)) <= PAIR_WINDOW_MS,
    );
    if (back) {
      paired.add(out.id);
      paired.add(back.tx.id);
    }
  }
  const events: SyncEvent[] = [];
  const dropped: string[] = [];
  for (const { tx, eur } of list) {
    const e = paired.has(tx.id) ? null : mapCoinbaseTx(tx, eur);
    if (e) events.push(e);
    // Not pending ones (they come back completed) or trades without a EUR value (they can be
    // imported once the native currency is EUR).
    else if (
      tx.status === "completed" &&
      (paired.has(tx.id) || SKIP_TYPES.has(tx.type) || D(tx.amount.amount).isZero())
    )
      dropped.push(tx.id);
  }
  return { events, dropped };
}

export const coinbase: ExchangeProvider<Creds> = {
  id: "coinbase",
  label: "Coinbase",
  accountKind: "exchange",
  fields: [
    { name: "keyName", label: msg("API key name"), secret: false, placeholder: "organizations/…/apiKeys/…" },
    {
      name: "privateKey",
      label: msg("Private key"),
      secret: true,
      multiline: true,
      placeholder: "-----BEGIN EC PRIVATE KEY-----",
    },
  ],
  instructions: [
    msg(
      "Open the Coinbase Developer Platform (portal.cdp.coinbase.com) → API Keys → Create API key, signed in with your Coinbase account.",
    ),
    msg(
      "Under advanced settings choose the ECDSA signature algorithm (Ed25519 keys are not accepted by the Coinbase App API).",
    ),
    msg("Grant only “View” permissions on your Coinbase App portfolio. No trade or transfer permissions."),
    msg("Paste the key name (organizations/…/apiKeys/…) and the full private key including the BEGIN/END lines."),
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
    // Transactions deliberately not imported (moves, zero amounts): known as well.
    const skipped = new Set((ctx.cursor?.skipped as string[] | undefined) ?? []);
    const list: { tx: CbTx; eur: string | undefined }[] = [];
    const warnings: string[] = [];
    let nonEurNative = false;
    for (const acc of accounts) {
      for (let path: string | null | undefined = `/v2/accounts/${acc.id}/transactions?limit=100`; path;) {
        const page: Page<CbTx> = await call<Page<CbTx>>(c, ctx, path);
        for (const tx of page.data) {
          const native = tx.native_amount;
          const eur = native && native.currency.toUpperCase() === "EUR" ? native.amount : undefined;
          if (native && native.currency.toUpperCase() !== "EUR") nonEurNative = true;
          list.push({ tx, eur });
        }
        // Newest first: once a whole page is already handled, older pages are too.
        if (incremental && page.data.length > 0) {
          const known = await ctx.isKnown(page.data.map((t) => t.id));
          if (page.data.every((t) => known.has(t.id) || skipped.has(t.id))) break;
        }
        path = page.pagination?.next_uri;
      }
    }
    // Only new transactions are mapped: one already imported can't be paired away any more.
    const known = await ctx.isKnown(list.map(({ tx }) => tx.id));
    const { events, dropped } = mapCoinbaseTxs(list.filter(({ tx }) => !known.has(tx.id) && !skipped.has(tx.id)));
    if (nonEurNative) {
      warnings.push(
        tr(
          "Your Coinbase native currency is not EUR; set it to EUR in Coinbase settings so trades can be valued exactly.",
        ),
      );
    }

    // ETH and the old ETH2 wallet add up to one balance.
    const totals = new Map<string, Decimal>();
    for (const a of accounts) {
      const sym = currencyCode(a);
      totals.set(sym, (totals.get(sym) ?? D(0)).plus(D(a.balance.amount)));
    }
    const balances: Balance[] = [...totals]
      .filter(([, q]) => !q.isZero())
      .map(([sym, q]) => ({ asset: assetRef(sym), quantity: q.toFixed() }));
    // A key for an empty portfolio looks like an empty account: say so instead of a silent "0 new".
    if (list.length === 0 && balances.length === 0)
      warnings.push(
        tr(
          "Coinbase shows no transactions and no balances for this API key. A Coinbase key belongs to one portfolio: check that you made it for the portfolio that holds your crypto.",
        ),
      );

    return {
      events,
      balances,
      balanceScope: "all",
      cursor: { synced: true, skipped: [...skipped, ...dropped] },
      warnings,
    };
  },
};
