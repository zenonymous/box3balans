import { and, eq, inArray, lt, desc, ne } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, priceHistory, pricesLatest, settings } from "../db/schema.js";
import { D, type Decimal, str } from "../lib/decimal.js";
import type { FetchFn } from "../lib/http.js";
import { bitvavoProvider } from "./bitvavo.js";
import { coingeckoProvider } from "./coingecko.js";
import { FxService } from "./fx.js";
import { metalsProvider } from "./metals.js";
import { migrationOf, successorQuotes } from "./migrations.js";
import type { PriceProvider, Quote } from "./types.js";
import { bitvavoFallback, type Fallback, plausible, tradegateFallback, yahooCryptoFallback } from "./fallbacks.js";
import { yahooProvider } from "./yahoo.js";

export interface RefreshResult {
  at: string;
  updated: number;
  failed: { assetId: number; symbol: string; error: string }[];
  // Assets priced by a second source because the main one had no quote.
  fallbacks?: { symbol: string; source: string }[];
  fxDate?: string;
  fxError?: string;
}

export const REFRESH_STATUS_KEY = "price_refresh_status";

export const today = () => new Date().toISOString().slice(0, 10);

export class PriceService {
  readonly fx: FxService;
  private providers: Record<string, PriceProvider>;

  private fallbacks: Fallback[];

  constructor(
    private db: DB,
    // Shared with other lookups (asset matching for imports), so tests can stub the network.
    readonly fetchFn?: FetchFn,
    sleep?: (ms: number) => Promise<void>,
  ) {
    this.fx = new FxService(db, fetchFn);
    this.providers = {
      yahoo: yahooProvider(fetchFn),
      coingecko: coingeckoProvider(fetchFn),
      bitvavo: bitvavoProvider(fetchFn),
      metal: metalsProvider(fetchFn),
    };
    // Tried in this order for assets the main provider gave no quote for.
    this.fallbacks = [
      bitvavoFallback(fetchFn),
      yahooCryptoFallback(fetchFn),
      tradegateFallback(this.fx, fetchFn, sleep),
    ];
  }

  /** Refreshes FX rates and latest quotes for every visible asset; records today's close. */
  async refreshAll(assetIds?: number[]): Promise<RefreshResult> {
    const result: RefreshResult = { at: new Date().toISOString(), updated: 0, failed: [] };
    try {
      result.fxDate = await this.fx.refreshLatest();
    } catch (err) {
      result.fxError = (err as Error).message;
    }

    const conditions = [ne(assets.priceSource, "manual")];
    if (assetIds) conditions.push(inArray(assets.id, assetIds));
    const rows = await this.db
      .select()
      .from(assets)
      .where(and(...conditions));

    const bySource = new Map<string, typeof rows>();
    for (const a of rows) {
      if (a.priceSource === "fx") {
        await this.storeFxAsset(a, result);
        continue;
      }
      if (!a.priceRef) continue;
      const list = bySource.get(a.priceSource) ?? [];
      list.push(a);
      bySource.set(a.priceSource, list);
    }

    const missed: { asset: (typeof rows)[number]; error: string }[] = [];
    for (const [source, list] of bySource) {
      const provider = this.providers[source];
      if (!provider) continue;
      let quotes = new Map<string, Quote>();
      let providerError: string | undefined;
      try {
        quotes = await provider.quotes([...new Set(list.map((a) => a.priceRef!))]);
      } catch (err) {
        providerError = (err as Error).message;
      }
      for (const a of list) {
        const q = quotes.get(a.priceRef!);
        if (!q) {
          missed.push({ asset: a, error: providerError ?? `no quote from ${source}` });
          continue;
        }
        try {
          await this.store(a.id, q);
          result.updated++;
        } catch (err) {
          result.failed.push({ assetId: a.id, symbol: a.symbol, error: (err as Error).message });
        }
      }
    }

    // Second sources for what the main ones missed; a quote far from the last known price is ignored.
    for (const fb of this.fallbacks) {
      const todo = missed.filter((m) => fb.covers.includes(m.asset.priceSource) && fb.applies(m.asset));
      if (!todo.length) continue;
      let quotes: Map<number, Quote>;
      try {
        quotes = await fb.quotes(todo.map((m) => m.asset));
      } catch {
        continue;
      }
      for (const m of todo) {
        const q = quotes.get(m.asset.id);
        if (!q) continue;
        try {
          const eur = q.price.mul(await this.fx.eurPerUnit(q.currency));
          if (!plausible(m.asset, eur, await this.lastKnownEur(m.asset.id))) continue;
          await this.store(m.asset.id, q);
          result.updated++;
          (result.fallbacks ??= []).push({ symbol: m.asset.symbol, source: fb.name });
          missed.splice(missed.indexOf(m), 1);
        } catch {
          // try the next fallback
        }
      }
    }
    for (const m of missed) result.failed.push({ assetId: m.asset.id, symbol: m.asset.symbol, error: m.error });
    await this.refreshSwapped(assetIds, result);

    if (!assetIds) {
      await this.db
        .insert(settings)
        .values({ key: REFRESH_STATUS_KEY, value: result })
        .onConflictDoUpdate({ target: settings.key, set: { value: result } });
    }
    return result;
  }

  /**
   * Coins swapped for a successor (NU for T, see migrations.ts): the successor's price times the
   * rate. A price you entered yourself stays.
   */
  private async refreshSwapped(assetIds: number[] | undefined, result: RefreshResult) {
    const conditions = [eq(assets.assetClass, "crypto"), eq(assets.priceSource, "manual")];
    if (assetIds) conditions.push(inArray(assets.id, assetIds));
    const rows = await this.db
      .select({ asset: assets, source: pricesLatest.source })
      .from(assets)
      .leftJoin(pricesLatest, eq(pricesLatest.assetId, assets.id))
      .where(and(...conditions));
    const todo = rows.flatMap((r) => {
      const swap = r.source === "manual" ? undefined : migrationOf(r.asset);
      return swap ? [{ asset: r.asset, swap }] : [];
    });
    if (!todo.length) return;
    const quotes = await successorQuotes(
      todo.map((t) => t.swap),
      this.fetchFn,
    );
    for (const { asset, swap } of todo) {
      const q = quotes.get(swap.to.symbol);
      if (!q) {
        result.failed.push({ assetId: asset.id, symbol: asset.symbol, error: `no quote for ${swap.to.symbol}` });
        continue;
      }
      try {
        await this.store(asset.id, { ...q, price: q.price.mul(swap.ratio), source: "migration" });
        result.updated++;
      } catch (err) {
        result.failed.push({ assetId: asset.id, symbol: asset.symbol, error: (err as Error).message });
      }
    }
  }

  private async lastKnownEur(assetId: number): Promise<Decimal | null> {
    const [latest] = await this.db
      .select({ v: pricesLatest.priceEur })
      .from(pricesLatest)
      .where(eq(pricesLatest.assetId, assetId));
    if (latest) return D(latest.v);
    const [hist] = await this.db
      .select({ v: priceHistory.closeEur })
      .from(priceHistory)
      .where(eq(priceHistory.assetId, assetId))
      .orderBy(desc(priceHistory.day))
      .limit(1);
    return hist ? D(hist.v) : null;
  }

  /** Cash assets: price is 1 unit of the currency, in EUR. */
  private async storeFxAsset(a: typeof assets.$inferSelect, result: RefreshResult) {
    try {
      await this.store(a.id, { price: D(1), currency: a.priceRef ?? a.currency, source: "ecb" });
      result.updated++;
    } catch (err) {
      result.failed.push({ assetId: a.id, symbol: a.symbol, error: (err as Error).message });
    }
  }

  /** Stores a quote as the latest price and as today's close in price history. */
  async store(assetId: number, q: Quote, day = today()) {
    const priceEur = q.price.mul(await this.fx.eurPerUnit(q.currency));
    let change = q.changePct24h;
    if (change == null) {
      const [prev] = await this.db
        .select({ closeEur: priceHistory.closeEur })
        .from(priceHistory)
        .where(and(eq(priceHistory.assetId, assetId), lt(priceHistory.day, day)))
        .orderBy(desc(priceHistory.day))
        .limit(1);
      if (prev && !D(prev.closeEur).isZero()) change = priceEur.div(D(prev.closeEur)).minus(1).mul(100);
    }
    const latest = {
      price: str(q.price),
      currency: q.currency,
      priceEur: str(priceEur),
      changePct24h: change ? change.toFixed(6) : null,
      source: q.source,
      fetchedAt: new Date(),
    };
    await this.db
      .insert(pricesLatest)
      .values({ assetId, ...latest })
      .onConflictDoUpdate({ target: pricesLatest.assetId, set: latest });
    const hist = { close: str(q.price), currency: q.currency, closeEur: str(priceEur) };
    await this.db
      .insert(priceHistory)
      .values({ assetId, day, ...hist })
      .onConflictDoUpdate({ target: [priceHistory.assetId, priceHistory.day], set: hist });
  }

  /** Sets a manual price (for assets with no automatic source). */
  async setManual(assetId: number, price: string, currency: string) {
    await this.store(assetId, { price: D(price), currency, source: "manual" });
  }
}
