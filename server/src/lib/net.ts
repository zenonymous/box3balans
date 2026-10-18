import { msg } from "../i18n/index.js";
import type { FetchFn } from "./http.js";

/**
 * Every place on the internet Box3balans may contact, and why (docs/privacy.md lists the same). The
 * server refuses any other address, only speaks HTTPS, and follows a redirect only to a listed host.
 * Amounts, balances and transactions are never sent: what goes out is listed under `sends`.
 *
 * A new data source needs a line here; test/net.test.ts fails for an address in the code that isn't
 * listed, and checks the list against docs/privacy.md and deploy/egress/allowed-hosts.txt.
 */
export interface Destination {
  id: string;
  purpose: string; // msg(): what it's for
  sends: string; // msg(): what goes out
  when: string; // msg(): when it's contacted
  hosts: string[]; // exact, or "*.example.com" for example.com and its subdomains
}

export const DESTINATIONS: Destination[] = [
  {
    id: "metals",
    purpose: msg("Prices of gold, silver, platinum and palladium"),
    sends: msg("Only which metal"),
    when: msg("At every price refresh"),
    hosts: ["api.gold-api.com"],
  },
  {
    id: "fx",
    purpose: msg("Exchange rates of the ECB"),
    sends: msg("Only the currency and the day"),
    when: msg("Daily, and for the dates of transactions in another currency"),
    hosts: ["api.frankfurter.dev"],
  },
  {
    id: "securities",
    purpose: msg("Prices of stocks and ETFs"),
    sends: msg("The symbols and ISINs of the stocks and ETFs you hold, and what you search for"),
    when: msg("At every price refresh, for price history, and when you add an asset"),
    hosts: ["query1.finance.yahoo.com", "www.tradegatebsx.com"],
  },
  {
    id: "crypto",
    purpose: msg("Crypto prices"),
    sends: msg("The symbols (or contract addresses) of the coins you hold, and what you search for"),
    when: msg("At every price refresh, for price history, and when you add an asset"),
    hosts: ["api.bitvavo.com", "api.coingecko.com", "api.binance.com"],
  },
  {
    id: "wallets",
    purpose: msg("Balances and transactions of your wallets"),
    sends: msg("The addresses or public keys (xpub) you add; never a private key"),
    when: msg("Only for wallets you add, at every sync"),
    hosts: [
      "mempool.space",
      "litecoinspace.org",
      "api.blockcypher.com",
      "api.koios.rest",
      "eth.blockscout.com",
      "arbitrum.blockscout.com",
      "base.blockscout.com",
      "polygon.blockscout.com",
      "unichain.blockscout.com",
      "soneium.blockscout.com",
      "explorer.optimism.io",
      "explorer.inkonchain.com",
      "rpc.ankr.com",
      "api.mainnet-beta.solana.com",
      "api.trongrid.io",
      "xrplcluster.com",
    ],
  },
  {
    id: "exchanges",
    purpose: msg("Connections with exchanges and brokers"),
    sends: msg("Requests signed with your read-only key; they answer with your balances and transactions"),
    when: msg("Only for connections you set up, at every sync"),
    hosts: [
      "api.bitvavo.com",
      "api.kraken.com",
      "api.coinbase.com",
      "api.public.bitpanda.com",
      "*.interactivebrokers.com",
    ],
  },
  {
    id: "updates",
    purpose: msg("Check for new versions"),
    sends: msg("Nothing about you: only which project"),
    when: msg("Only when you turn it on (Settings → About)"),
    hosts: ["api.github.com"],
  },
];

/**
 * An address you set up yourself (SOLANA_RPC_URL): its host joins that destination, so it's allowed
 * and shows in Settings → Network like the others.
 */
export function allowConfiguredUrl(id: string, url: string | undefined): void {
  if (!url) return;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return;
  }
  const d = DESTINATIONS.find((x) => x.id === id);
  if (d && !d.hosts.includes(host)) d.hosts.push(host);
}

const matches = (pattern: string, host: string) =>
  pattern.startsWith("*.") ? host === pattern.slice(2) || host.endsWith(pattern.slice(1)) : host === pattern;

/** The destinations a host belongs to (Bitvavo is both a price source and an exchange). */
export const destinationsOf = (host: string) => DESTINATIONS.filter((d) => d.hosts.some((p) => matches(p, host)));

export const isAllowedHost = (host: string) => destinationsOf(host.toLowerCase()).length > 0;

// ---- Switches (Settings → Network): destinations turned off are refused like unlisted ones ----

/** The destinations that can be turned off; the update check has its own switch (Settings → About). */
export const SWITCHABLE = DESTINATIONS.filter((d) => d.id !== "updates").map((d) => d.id);

const off = new Set<string>();

export function setTurnedOff(ids: string[]): void {
  off.clear();
  for (const id of ids) if (SWITCHABLE.includes(id)) off.add(id);
}
export const turnedOff = () => [...off];
export const isOn = (id: string) => !off.has(id);

/** Whether a host may be contacted now: listed, and at least one of its destinations on. */
export const isReachable = (host: string) => destinationsOf(host.toLowerCase()).some((d) => isOn(d.id));

/** Where an asset's prices come from, so a refresh can skip what's turned off. */
export function priceSourceOn(priceSource: string, assetClass?: string): boolean {
  if (priceSource === "manual") return assetClass !== "crypto" || isOn("crypto");
  const id = { fx: "fx", metal: "metals", yahoo: "securities" }[priceSource] ?? "crypto";
  return isOn(id);
}

/** A request that was refused: an address not on the list, not HTTPS, or turned off. */
export class BlockedRequestError extends Error {
  constructor(
    public url: string,
    public reason: "unlisted" | "off" = "unlisted",
  ) {
    super(
      reason === "off"
        ? `Box3balans doesn't contact ${url}: turned off in Settings → Network`
        : `Box3balans doesn't contact ${url}: not on its list of destinations (docs/privacy.md)`,
    );
  }
}

export interface RequestRecord {
  at: Date;
  method: string;
  host: string;
  what: string; // path and query, with keys and long values shortened
  status?: number;
  error?: string;
  blocked?: boolean;
  // Why it was refused: not on the list, or its destination is turned off.
  reason?: "unlisted" | "off";
}

// Query parameters that carry a key or token: their value is never recorded.
const SECRET_PARAMS = /^(t|token|key|apikey|api_key|access_key|signature|sig|secret|nonce)$/i;

/** What a request sent, fit to show: long path parts (keys, addresses) and secrets shortened. */
export function describe(url: URL): string {
  const short = (s: string) => (s.length >= 32 ? `${s.slice(0, 6)}…` : s);
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const path = url.pathname
    .split("/")
    .map((p) => short(decode(p)))
    .join("/");
  const query = [...url.searchParams].map(([k, v]) => `${k}=${SECRET_PARAMS.test(k) ? "…" : short(v)}`).join("&");
  return query ? `${path}?${query}` : path;
}

const MAX_REDIRECTS = 5;

/**
 * fetch that only reaches listed hosts over HTTPS, follows redirects itself so each hop is checked,
 * and tells `record` about every request (and every refusal).
 */
export function guardFetch(realFetch: FetchFn, record: (r: RequestRecord) => void = () => {}): FetchFn {
  return async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    let url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
    let method = (init.method ?? request?.method ?? "GET").toUpperCase();
    let body = init.body;
    for (let hop = 0; ; hop++) {
      if (url.protocol !== "https:" || !isAllowedHost(url.hostname)) {
        record({ at: new Date(), method, host: url.host, what: describe(url), blocked: true, reason: "unlisted" });
        throw new BlockedRequestError(`${url.protocol}//${url.host}`);
      }
      if (!isReachable(url.hostname)) {
        record({ at: new Date(), method, host: url.host, what: describe(url), blocked: true, reason: "off" });
        throw new BlockedRequestError(`${url.protocol}//${url.host}`, "off");
      }
      let res: Response;
      try {
        res = await realFetch(url, { ...init, method, body, redirect: "manual" });
      } catch (err) {
        record({ at: new Date(), method, host: url.host, what: describe(url), error: (err as Error).message });
        throw err;
      }
      record({ at: new Date(), method, host: url.host, what: describe(url), status: res.status });
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) return res;
      if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects from ${url.host}`);
      // 303, and 301/302 after a POST, continue as GET without a body (as browsers do).
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      url = new URL(location, url);
    }
  };
}

/** Puts the guard in front of every fetch in this process, including those of libraries. */
export function installNetworkGuard(record: (r: RequestRecord) => void): void {
  globalThis.fetch = guardFetch(globalThis.fetch.bind(globalThis), record);
}
