import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, pricesLatest, tokenContracts } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { getJson, HttpRequestError, type FetchFn } from "../lib/http.js";
import { bitvavoAssetNames, bitvavoEurMarkets } from "../prices/bitvavo.js";
import { coingeckoSearch } from "../prices/coingecko.js";
import { yahooQuote, yahooSearch } from "../prices/yahoo.js";
import type { AssetRef } from "./types.js";
import { tr } from "../i18n/index.js";

type Asset = typeof assets.$inferSelect;

// Currencies with ECB reference rates (plus EUR) are treated as cash, everything else as crypto.
export const FIAT = new Set(
  "EUR USD JPY BGN CZK DKK GBP HUF PLN RON SEK CHF ISK NOK TRY AUD BRL CAD CNY HKD IDR ILS INR KRW MXN MYR NZD PHP SGD THB ZAR".split(
    " ",
  ),
);

// Chain id (ours) -> CoinGecko asset platform id, for token contract lookups.
export const COINGECKO_PLATFORM: Record<string, string> = {
  ethereum: "ethereum",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  base: "base",
  polygon: "polygon-pos",
  unichain: "unichain",
  ink: "ink",
  soneium: "soneium",
  bsc: "binance-smart-chain",
  solana: "solana",
  tron: "tron",
  cardano: "cardano",
};

// Unlisted tokens are re-checked after this long (new listings happen).
const UNLISTED_RECHECK_MS = 30 * 86_400_000;

export const isFiat = (code: string) => FIAT.has(code.toUpperCase());

export const assetRef = (code: string, venue?: "bitvavo"): AssetRef =>
  isFiat(code)
    ? { kind: "fiat", currency: code.toUpperCase() }
    : { kind: "crypto", symbol: code.toUpperCase(), ...(venue ? { venue } : {}) };

// IBKR listing exchange -> Yahoo ticker suffix.
const YAHOO_SUFFIX: Record<string, string> = {
  AEB: ".AS",
  IBIS: ".DE",
  IBIS2: ".DE",
  FWB: ".F",
  FWB2: ".F",
  SWB: ".SG",
  GETTEX: ".MU",
  GETTEX2: ".MU",
  LSE: ".L",
  LSEETF: ".L",
  SBF: ".PA",
  ENEXT_BE: ".BR",
  "ENEXT.BE": ".BR",
  EBS: ".SW",
  BVME: ".MI",
  "BVME.ETF": ".MI",
  BM: ".MC",
  SFB: ".ST",
  CPH: ".CO",
  OSE: ".OL",
  HEX: ".HE",
  VSE: ".VI",
  TSE: ".TO",
  ASX: ".AX",
  SEHK: ".HK",
  NASDAQ: "",
  NYSE: "",
  ARCA: "",
  AMEX: "",
  BATS: "",
  ISLAND: "",
};

/**
 * Maps provider asset references to `assets` rows, creating them when needed:
 * crypto via CoinGecko search, securities via Yahoo (by ISIN), fiat as cash assets.
 * Falls back to a manually priced asset (and a warning) when no feed is found.
 */
export class AssetResolver {
  private cache = new Map<string, Asset>();
  readonly created: Asset[] = [];
  /** Manually priced assets this resolver found a price feed for after all. */
  readonly upgraded: Asset[] = [];
  readonly warnings: string[] = [];
  private triedUpgrade = new Set<number>();
  private bitvavoMarkets?: Promise<Map<string, string>>;
  private bitvavoNames?: Promise<Map<string, string>>;

  private lastLookup = 0;
  /** CoinGecko contract lookups made by this resolver (callers cap them per sync). */
  networkLookups = 0;

  constructor(
    private db: DB,
    private fetchFn?: FetchFn,
    // Minimum spacing between CoinGecko lookups (free tier is ~10–30 calls/min).
    private throttleMs = 0,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    // Look everything up but create nothing: new assets get negative ids (for import previews).
    private opts: { dryRun?: boolean; via?: "sync" | "import" } = {},
  ) {}

  private fakeId = 0;

  /**
   * Assets created during this sync, with the price feed each was matched to, e.g.
   * "BTC → CoinGecko bitcoin". Symbol matches can pick the wrong coin (e.g. an exchange's old
   * "LUNA"), so the user sees exactly what was chosen and can fix it under Assets.
   */
  describeCreated(): string[] {
    const src: Record<string, string> = { coingecko: "CoinGecko", yahoo: "Yahoo", bitvavo: "Bitvavo" };
    const feed = (a: Asset) => `${a.symbol} → ${src[a.priceSource] ?? a.priceSource} ${a.priceRef}`;
    return [
      ...this.created.map((a) =>
        a.priceSource === "fx" ? a.symbol : a.priceSource === "manual" ? `${a.symbol} (manual price)` : feed(a),
      ),
      ...this.upgraded.map((a) => `${feed(a)} (was manual)`),
    ];
  }

  async resolve(ref: AssetRef): Promise<Asset> {
    const key = JSON.stringify(ref.kind === "security" ? [ref.kind, ref.isin ?? ref.symbol, ref.currency] : ref);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const asset =
      ref.kind === "fiat"
        ? await this.fiat(ref.currency)
        : ref.kind === "security"
          ? await this.security(ref)
          : ref.contract && ref.chain
            ? await this.token(ref)
            : ref.coingeckoId
              ? await this.byCoingeckoId(ref.coingeckoId, ref.symbol, ref.name)
              : await this.crypto(ref.symbol, ref.venue);
    this.cache.set(key, asset);
    return asset;
  }

  private async create(values: typeof assets.$inferInsert): Promise<Asset> {
    if (this.opts.dryRun) {
      const fake = {
        id: --this.fakeId,
        isin: null,
        currency: "EUR",
        priceRef: null,
        unit: "unit",
        chain: null,
        contract: null,
        hidden: false,
        createdAt: new Date(),
        ...values,
      } as Asset;
      this.created.push(fake);
      return fake;
    }
    const [row] = await this.db.insert(assets).values(values).onConflictDoNothing().returning();
    if (row) {
      await audit(this.db, "asset", row.id, "create", null, { ...row, via: this.opts.via ?? "sync" });
      this.created.push(row);
      return row;
    }
    // Lost a race with an identical asset: use the existing one.
    const [existing] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.priceSource, values.priceSource), eq(assets.priceRef, values.priceRef!)));
    return existing!;
  }

  private async byCoingeckoId(id: string, symbol: string, name?: string): Promise<Asset> {
    const [row] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.priceSource, "coingecko"), eq(assets.priceRef, id)));
    if (row) return row;
    return this.create({
      assetClass: "crypto",
      name: name ?? symbol,
      symbol: symbol.toUpperCase(),
      priceSource: "coingecko",
      priceRef: id,
      currency: "EUR",
    });
  }

  /**
   * Whether a token contract is listed on CoinGecko (and its asset if so). Results are cached in
   * token_contracts; unlisted ones are re-checked after 30 days.
   */
  async classifyToken(
    chain: string,
    contract: string,
    hint: { symbol: string; name?: string },
    opts: { cacheOnly?: boolean } = {},
  ): Promise<{ listed: boolean; asset?: Asset } | null> {
    const key = chain === "solana" || chain === "tron" ? contract : contract.toLowerCase();
    const [cached] = await this.db
      .select()
      .from(tokenContracts)
      .where(and(eq(tokenContracts.chain, chain), eq(tokenContracts.contract, key)));
    if (cached && (cached.listed || Date.now() - cached.checkedAt.getTime() < UNLISTED_RECHECK_MS)) {
      if (!cached.listed) return { listed: false };
      const [asset] = cached.assetId ? await this.db.select().from(assets).where(eq(assets.id, cached.assetId)) : [];
      if (asset) return { listed: true, asset };
    }
    const platform = COINGECKO_PLATFORM[chain];
    if (!platform) return { listed: false };
    if (opts.cacheOnly) return null;

    const wait = this.lastLookup + this.throttleMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastLookup = Date.now();
    this.networkLookups++;
    let coin: { id: string; symbol: string; name: string } | null = null;
    try {
      coin = await getJson<{ id: string; symbol: string; name: string }>(
        `https://api.coingecko.com/api/v3/coins/${platform}/contract/${encodeURIComponent(key)}`,
        { fetchFn: this.fetchFn, retries: 0, timeoutMs: 15_000 },
      );
    } catch (err) {
      // 404 = not listed (cache it); anything else (rate limit, outage) = unknown, try next sync.
      if (!(err instanceof HttpRequestError && err.status === 404)) throw err;
    }
    const asset = coin?.id ? await this.byCoingeckoId(coin.id, coin.symbol, coin.name) : undefined;
    const row = {
      assetId: asset?.id ?? null,
      symbol: hint.symbol,
      name: hint.name ?? null,
      listed: !!asset,
      checkedAt: new Date(),
    };
    await this.db
      .insert(tokenContracts)
      .values({ chain, contract: key, ...row })
      .onConflictDoUpdate({ target: [tokenContracts.chain, tokenContracts.contract], set: row });
    return asset ? { listed: true, asset } : { listed: false };
  }

  private async token(ref: Extract<AssetRef, { kind: "crypto" }>): Promise<Asset> {
    const c = await this.classifyToken(ref.chain!, ref.contract!, ref);
    if (c?.listed && c.asset) return c.asset;
    // Unlisted token the user chose to include: track it with a manual price.
    const priceRef = `manual:${ref.chain}:${ref.contract}`;
    const [existing] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.priceSource, "manual"), eq(assets.priceRef, priceRef)));
    if (existing) return existing;
    return this.create({
      assetClass: "crypto",
      name: ref.name ?? ref.symbol,
      symbol: ref.symbol,
      priceSource: "manual",
      priceRef,
      currency: "EUR",
      chain: ref.chain,
      contract: ref.contract,
    });
  }

  private async fiat(currency: string): Promise<Asset> {
    const [row] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.priceSource, "fx"), eq(assets.priceRef, currency)));
    if (row) return row;
    return this.create({
      assetClass: "cash",
      name: `Cash ${currency}`,
      symbol: currency,
      priceSource: "fx",
      priceRef: currency,
      currency,
      unit: currency,
    });
  }

  private async crypto(symbol: string, venue?: "bitvavo"): Promise<Asset> {
    const rows = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.assetClass, "crypto"), sql`upper(${assets.symbol}) = ${symbol}`));
    const best =
      rows.find((r) => r.priceSource === "coingecko" && !r.hidden) ??
      rows.find((r) => r.priceSource === "bitvavo" && !r.hidden) ??
      rows[0];
    if (best) return (await this.upgradeManual(best, venue)) ?? best;

    // From Bitvavo: priced on Bitvavo itself, in euros and without CoinGecko's rate limits. It is
    // the very coin traded there, so no symbol guessing either.
    if (venue === "bitvavo") {
      const market = await this.bitvavoMarket(symbol);
      if (market) return this.bitvavoAsset(symbol, market);
    }
    const match = await this.coingeckoMatch(symbol);
    if (match) {
      const [byRef] = await this.db
        .select()
        .from(assets)
        .where(and(eq(assets.priceSource, "coingecko"), eq(assets.priceRef, match.priceRef)));
      if (byRef) return byRef;
      return this.create({ ...match, currency: "EUR" });
    }
    // CoinGecko doesn't know it, or didn't answer (a rate limit): Bitvavo's EUR market, if any.
    const market = await this.bitvavoMarket(symbol);
    if (market) return this.bitvavoAsset(symbol, market);

    this.warnings.push(tr("No price feed found for {symbol}; created it as a manually priced asset.", { symbol }));
    return this.create({
      assetClass: "crypto",
      name: symbol,
      symbol,
      priceSource: "manual",
      priceRef: `manual:${symbol}`,
      currency: "EUR",
    });
  }

  /**
   * CoinGecko's best match for a symbol: it ranks search results by market cap, so the first exact
   * symbol match is the well-known coin rather than a copycat token. Null when there's none,
   * undefined when the lookup failed (try again next sync, don't conclude anything).
   */
  private async coingeckoMatch(symbol: string) {
    const wait = this.lastLookup + this.throttleMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastLookup = Date.now();
    try {
      return (await coingeckoSearch(symbol, this.fetchFn)).find((c) => c.symbol.toUpperCase() === symbol) ?? null;
    } catch {
      return undefined;
    }
  }

  /** Bitvavo's EUR market for a symbol ("BTC-EUR"), or null; the market list is loaded once. */
  private async bitvavoMarket(symbol: string): Promise<string | null> {
    this.bitvavoMarkets ??= bitvavoEurMarkets(this.fetchFn).catch(() => new Map<string, string>());
    return (await this.bitvavoMarkets).get(symbol) ?? null;
  }

  private async bitvavoAsset(symbol: string, market: string): Promise<Asset> {
    const [existing] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.priceSource, "bitvavo"), eq(assets.priceRef, market)));
    if (existing) return existing;
    this.bitvavoNames ??= bitvavoAssetNames(this.fetchFn).catch(() => new Map<string, string>());
    return this.create({
      assetClass: "crypto",
      name: (await this.bitvavoNames).get(symbol) ?? symbol,
      symbol,
      priceSource: "bitvavo",
      priceRef: market,
      currency: "EUR",
    });
  }

  /**
   * An asset made "manual" automatically because no price feed answered at the time (e.g. CoinGecko's
   * rate limit) gets one now if there is one. A price you entered yourself keeps it manual.
   */
  private async upgradeManual(a: Asset, venue?: "bitvavo"): Promise<Asset | null> {
    if (a.assetClass !== "crypto" || a.priceSource !== "manual" || a.priceRef !== `manual:${a.symbol}`) return null;
    if (this.opts.dryRun || this.triedUpgrade.has(a.id)) return null;
    this.triedUpgrade.add(a.id);
    const [price] = await this.db
      .select({ source: pricesLatest.source })
      .from(pricesLatest)
      .where(eq(pricesLatest.assetId, a.id));
    if (price?.source === "manual") return null;

    const symbol = a.symbol.toUpperCase();
    let feed: { priceSource: "bitvavo" | "coingecko"; priceRef: string; name?: string } | null = null;
    const viaBitvavo = async () => {
      const market = await this.bitvavoMarket(symbol);
      if (!market) return null;
      this.bitvavoNames ??= bitvavoAssetNames(this.fetchFn).catch(() => new Map<string, string>());
      return { priceSource: "bitvavo" as const, priceRef: market, name: (await this.bitvavoNames).get(symbol) };
    };
    if (venue === "bitvavo") feed = await viaBitvavo();
    if (!feed) {
      const match = await this.coingeckoMatch(symbol);
      feed = match ? { priceSource: "coingecko", priceRef: match.priceRef, name: match.name } : await viaBitvavo();
    }
    if (!feed) return null;
    const set = {
      priceSource: feed.priceSource,
      priceRef: feed.priceRef,
      // The automatic manual asset was named after its symbol; a real name is better.
      ...(feed.name && a.name === a.symbol ? { name: feed.name } : {}),
    };
    let row: Asset | undefined;
    try {
      [row] = await this.db.update(assets).set(set).where(eq(assets.id, a.id)).returning();
    } catch {
      return null; // another asset already uses that feed
    }
    if (!row) return null;
    await audit(
      this.db,
      "asset",
      a.id,
      "update",
      { priceSource: a.priceSource, priceRef: a.priceRef },
      { ...set, via: "sync" },
    );
    this.upgraded.push(row);
    return row;
  }

  private async security(ref: Extract<AssetRef, { kind: "security" }>): Promise<Asset> {
    if (ref.isin) {
      const [byIsin] = await this.db.select().from(assets).where(eq(assets.isin, ref.isin));
      if (byIsin) return byIsin;
    }
    const assetClass = ref.etf ? "etf" : "stock";
    const suffix = ref.exchange ? YAHOO_SUFFIX[ref.exchange.toUpperCase()] : undefined;
    const symbol = ref.symbol.toUpperCase();
    if (!ref.isin) {
      // Only a ticker (e.g. a CSV without ISINs): an asset you already have with that symbol or
      // Yahoo ticker comes first.
      const rows = await this.db
        .select()
        .from(assets)
        .where(
          and(
            sql`${assets.assetClass} in ('stock', 'etf', 'other')`,
            sql`(upper(${assets.symbol}) = ${symbol} or upper(${assets.priceRef}) = ${symbol})`,
          ),
        );
      const held = rows.find((r) => !r.hidden) ?? rows[0];
      if (held) return held;
    }
    try {
      let candidates = await yahooSearch(ref.isin ?? ref.symbol, this.fetchFn);
      const euroRank = (t: string) => {
        const i = EURO_SUFFIXES.indexOf(tickerSuffix(t));
        return i >= 0 ? i : EURO_SUFFIXES.length;
      };
      if (!ref.isin) {
        // Without an ISIN, only listings of exactly this ticker count: "IWDA" → IWDA.AS, IWDA.L…,
        // the ticker itself first, then euro exchanges.
        const base = (t: string) => t.toUpperCase().replace(/\.[A-Z]+$/, "");
        const rank = (t: string) => (t.toUpperCase() === symbol ? -1 : euroRank(t));
        candidates = candidates
          .filter((c) => c.priceRef.toUpperCase() === symbol || base(c.priceRef) === symbol)
          .sort((a, b) => rank(a.priceRef) - rank(b.priceRef));
      } else {
        // Yahoo also lists odd quotes named after the ISIN itself ("IE00….SG", sparse prices): last.
        // A euro trade without an exchange (e.g. a CSV) prefers a euro listing over Yahoo's first
        // hit, which is often London or New York.
        const isinQuote = (t: string) => (t.toUpperCase().startsWith(ref.isin!) ? 100 : 0);
        const preferEuro = suffix === undefined && ref.currency === "EUR";
        const pref = (t: string) => isinQuote(t) + (preferEuro ? euroRank(t) : 0);
        candidates = [...candidates].sort((a, b) => pref(a.priceRef) - pref(b.priceRef));
      }
      // Prefer the listing on the exchange the provider reports, then the plain symbol guess.
      const tickers = [
        ...candidates.filter((c) => suffix !== undefined && tickerSuffix(c.priceRef) === suffix).map((c) => c.priceRef),
        ...(suffix !== undefined ? [`${ref.symbol.replace(/ /g, "-")}${suffix}`] : []),
        ...candidates.map((c) => c.priceRef),
      ];
      for (const ticker of [...new Set(tickers)]) {
        const [existing] = await this.db
          .select()
          .from(assets)
          .where(and(eq(assets.priceSource, "yahoo"), eq(assets.priceRef, ticker)));
        if (existing) {
          if (!existing.isin && ref.isin && !this.opts.dryRun)
            await this.db.update(assets).set({ isin: ref.isin }).where(eq(assets.id, existing.id));
          return existing;
        }
        try {
          const q = await yahooQuote(ticker, this.fetchFn);
          const c = candidates.find((x) => x.priceRef === ticker);
          // A product name or ISIN standing in for the symbol (CSV without tickers): use the listing's.
          const tickerLike = /^[A-Z0-9][A-Z0-9.-]{0,11}$/i.test(ref.symbol) && ref.symbol !== ref.isin;
          return this.create({
            assetClass: c?.assetClass ?? assetClass,
            name: c?.name ?? ref.name ?? ref.symbol,
            symbol: tickerLike ? ref.symbol : (c?.symbol ?? ref.symbol),
            isin: ref.isin ?? null,
            priceSource: "yahoo",
            priceRef: ticker,
            currency: q.currency,
          });
        } catch {
          // not priceable on Yahoo; try the next ticker
        }
      }
    } catch {
      // search failed; fall through
    }
    this.warnings.push(
      tr("No price feed found for {symbol}; created it as a manually priced asset.", {
        symbol: ref.isin ? `${ref.symbol} (${ref.isin})` : ref.symbol,
      }),
    );
    return this.create({
      assetClass,
      name: ref.name ?? ref.symbol,
      symbol: ref.symbol,
      isin: ref.isin ?? null,
      priceSource: "manual",
      priceRef: `manual:${ref.isin ?? ref.symbol}`,
      currency: ref.currency,
    });
  }
}

// Yahoo suffixes of exchanges quoting in euros, in order of preference for ambiguous tickers.
const EURO_SUFFIXES = [".AS", ".DE", ".F", ".PA", ".MI", ".BR", ".MC", ".VI", ".HE", ".MU", ".SG"];

function tickerSuffix(ticker: string): string {
  const i = ticker.lastIndexOf(".");
  return i > 0 ? ticker.slice(i) : "";
}
