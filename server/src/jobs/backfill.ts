import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, fxRates, metalItems, priceHistory, settings, transactions } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { D, str } from "../lib/decimal.js";
import type { FetchFn } from "../lib/http.js";
import type { FxService } from "../prices/fx.js";
import { HistoryService } from "../prices/history.js";

const STATE_KEY = "history_backfill";
// Re-check each asset at most this often (the price refresh keeps today's close current).
const RECHECK_MS = 20 * 3_600_000;

// Raise this when history gets new sources: assets loaded before then get one full load again.
// 2: delisted and swapped coins. 3: CoinGecko's last year, Binance for older days.
const SOURCES = 3;

type State = Record<string, { from: string; at: string; v?: number }>;

export interface BackfillResult {
  at: string;
  checked: number;
  fetched: number;
  failed: { symbol: string; error: string }[];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Loads daily EUR closes for every asset from the day it was first held until today, so history
 * charts and P&L by year work. Runs at startup, daily, and (debounced) after transactions change.
 */
export class BackfillService {
  private history: HistoryService;
  private running: Promise<BackfillResult> | null = null;
  private timer: NodeJS.Timeout | null = null;
  lastResult: BackfillResult | null = null;

  constructor(
    private db: DB,
    private fx: FxService,
    fetchFn?: FetchFn,
    sleep?: (ms: number) => Promise<void>,
  ) {
    this.history = new HistoryService(db, fx, fetchFn, 2_500, sleep);
  }

  /** Schedules a run shortly (coalescing bursts of changes, e.g. a sync importing many rows). */
  request(delayMs = 5_000) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run().catch(() => {});
    }, delayMs);
    this.timer.unref?.();
  }

  async run(opts: { force?: boolean } = {}): Promise<BackfillResult> {
    if (this.running) return this.running;
    this.running = this.doRun(opts.force ?? false).finally(() => (this.running = null));
    return this.running;
  }

  private async firstDays(): Promise<Map<number, string>> {
    const first = new Map<number, string>();
    const note = (id: number | null, d: Date | string) => {
      if (id == null) return;
      const day = typeof d === "string" ? d : isoDay(d);
      const cur = first.get(id);
      if (!cur || day < cur) first.set(id, day);
    };
    const byAsset = await this.db
      .select({ id: transactions.assetId, first: sql<Date>`min(${transactions.occurredAt})` })
      .from(transactions)
      .groupBy(transactions.assetId);
    for (const r of byAsset) note(r.id, new Date(r.first));
    // Cash balances that only appear as the settling side of trades.
    const bySettle = await this.db
      .select({ id: transactions.settleAssetId, first: sql<Date>`min(${transactions.occurredAt})` })
      .from(transactions)
      .where(isNotNull(transactions.settleAssetId))
      .groupBy(transactions.settleAssetId);
    for (const r of bySettle) note(r.id, new Date(r.first));
    // Physical metal is valued at the metal's spot price.
    const metalAssets = await this.db.select().from(assets).where(eq(assets.priceSource, "metal"));
    const items = await this.db
      .select({ metal: metalItems.metal, first: sql<string>`min(${metalItems.purchaseDate})` })
      .from(metalItems)
      .groupBy(metalItems.metal);
    for (const it of items)
      note(metalAssets.find((a) => a.priceRef === METAL_CODES[it.metal])?.id ?? null, String(it.first));
    return first;
  }

  private async doRun(force: boolean): Promise<BackfillResult> {
    const result: BackfillResult = { at: new Date().toISOString(), checked: 0, fetched: 0, failed: [] };
    const today = isoDay(new Date());
    const [stateRow] = await this.db.select().from(settings).where(eq(settings.key, STATE_KEY));
    const state: State = (stateRow?.value as State | undefined) ?? {};
    const first = await this.firstDays();
    const rows = await this.db.select().from(assets);

    for (const asset of rows) {
      const from = first.get(asset.id);
      // Manual coins too: for one an exchange delisted, history may still be found (see history.ts).
      if (!from || (asset.priceSource === "manual" && asset.assetClass !== "crypto")) continue;
      if (asset.priceSource === "fx" && asset.priceRef === "EUR") continue; // always 1
      result.checked++;
      const prev = state[asset.id];
      const loaded = prev && prev.from <= from && (prev.v ?? 1) >= SOURCES;
      if (loaded && Date.now() - Date.parse(prev.at) < RECHECK_MS && !force) continue;
      // After the first full load only the recent days need filling.
      const start = loaded && !force ? isoDay(new Date(Date.parse(prev.at) - 5 * 86_400_000)) : from;
      try {
        if (asset.priceSource === "fx") await this.cashHistory(asset.id, asset.priceRef!, start, today);
        else await this.history.ensureRange(asset, start, today);
        state[asset.id] = {
          from: prev && prev.from < from ? prev.from : from,
          at: new Date().toISOString(),
          v: SOURCES,
        };
        result.fetched++;
      } catch (err) {
        result.failed.push({ symbol: asset.symbol, error: (err as Error).message });
      }
    }

    await this.db
      .insert(settings)
      .values({ key: STATE_KEY, value: state })
      .onConflictDoUpdate({ target: settings.key, set: { value: state } });
    this.lastResult = result;
    return result;
  }

  /** Foreign cash: 1 unit of the currency per day, in EUR from ECB rates. */
  private async cashHistory(assetId: number, currency: string, from: string, to: string) {
    await this.fx.ensureRange([currency], from, to);
    const rates = await this.db
      .select()
      .from(fxRates)
      .where(and(eq(fxRates.currency, currency), gte(fxRates.day, from), lte(fxRates.day, to)));
    const values = rates.map((r) => ({
      assetId,
      day: r.day,
      close: "1",
      currency,
      closeEur: str(D(1).div(D(r.perEur))),
    }));
    for (let i = 0; i < values.length; i += 500) {
      await this.db
        .insert(priceHistory)
        .values(values.slice(i, i + 500))
        .onConflictDoNothing();
    }
  }
}
