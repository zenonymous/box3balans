import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, fxRates, metalItems, priceHistory, settings, transactions } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { D, str } from "../lib/decimal.js";
import type { FetchFn } from "../lib/http.js";
import type { FxService } from "../prices/fx.js";
import { HistoryService } from "../prices/history.js";
import { availableYears } from "../domain/box3.js";
import { holdingsOn } from "../domain/valuation.js";

const STATE_KEY = "history_backfill";
// 31 December closes of holdings already looked up for their source ("assetId:day"). A new key
// when the lookup learns more sources, so earlier misses are tried again.
const LABELS_KEY = "history_labels_2";
// Re-check each asset at most this often (the price refresh keeps today's close current).
const RECHECK_MS = 20 * 3_600_000;

// Raise this when history gets new sources: assets loaded before then get one full load again.
// 2: delisted and swapped coins. 3: CoinGecko's last year, Binance for older days.
const SOURCES = 3;

// History that starts well after an asset was first held (a source answered only partly, or not at
// all) gets a full load again this often: a source may have it by then (a new listing, a coin
// matched to its price feed later). Days of slack for weekends and holidays.
const GAP_RETRY_MS = 7 * 86_400_000;
const GAP_SLACK_DAYS = { crypto: 3, other: 7 };

// `full`: when the asset last had a full load.
type State = Record<string, { from: string; at: string; v?: number; full?: string }>;

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
  private labelledAt = 0;

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
    const firstClose = new Map(
      (
        await this.db
          .select({ id: priceHistory.assetId, day: sql<string>`min(${priceHistory.day})` })
          .from(priceHistory)
          .groupBy(priceHistory.assetId)
      ).map((r) => [r.id, String(r.day)]),
    );
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
      const closes = firstClose.get(asset.id);
      const slack = asset.assetClass === "crypto" ? GAP_SLACK_DAYS.crypto : GAP_SLACK_DAYS.other;
      const gap = !closes || Date.parse(closes) - Date.parse(from) > slack * 86_400_000;
      const retry = loaded && gap && Date.now() - Date.parse(prev.full ?? prev.at) >= GAP_RETRY_MS;
      // After the first full load only the recent days need filling.
      const start = loaded && !force ? isoDay(new Date(Date.parse(prev.at) - 5 * 86_400_000)) : from;
      try {
        if (asset.priceSource === "fx") await this.cashHistory(asset.id, asset.priceRef!, retry ? from : start, today);
        else {
          // Only the missing start: the range as a whole may look loaded enough to be skipped.
          if (retry)
            await this.history.ensureRange(
              asset,
              from,
              closes ? isoDay(new Date(Date.parse(closes) - 86_400_000)) : today,
            );
          await this.history.ensureRange(asset, start, today);
        }
        const now = new Date().toISOString();
        state[asset.id] = {
          from: prev && prev.from < from ? prev.from : from,
          at: now,
          v: SOURCES,
          full: start === from || retry ? now : (prev?.full ?? prev?.at),
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
    try {
      await this.labelYearEnds();
    } catch {
      // labels are a nicety; the next run tries again
    }
    this.lastResult = result;
    return result;
  }

  /**
   * Where each 31 December close of a holding came from: box 3 values them, and the dossier shows
   * the source. Closes stored before sources were recorded (0.1.9) are looked up, each once.
   */
  private async labelYearEnds(): Promise<void> {
    // Mostly a one-off for closes stored before 0.1.9 (new ones carry their source): it replays
    // each year's holdings, so not on every run after a sync.
    if (this.labelledAt && Date.now() - this.labelledAt < RECHECK_MS) return;
    this.labelledAt = Date.now();
    const [row] = await this.db.select().from(settings).where(eq(settings.key, LABELS_KEY));
    const tried = new Set((row?.value as string[] | undefined) ?? []);
    const before = tried.size;
    const byId = new Map((await this.db.select().from(assets)).map((a) => [a.id, a]));
    for (const year of await availableYears(this.db)) {
      for (const h of await holdingsOn(this.db, `${year - 1}-12-31`)) {
        const asset = byId.get(h.assetId);
        const key = `${h.assetId}:${h.priceDay}`;
        // Cash is valued at the ECB rate, which says so itself.
        if (!h.priceDay || !asset || asset.priceSource === "fx" || tried.has(key)) continue;
        tried.add(key);
        await this.history.labelClose(asset, h.priceDay);
      }
    }
    if (tried.size === before) return;
    await this.db
      .insert(settings)
      .values({ key: LABELS_KEY, value: [...tried] })
      .onConflictDoUpdate({ target: settings.key, set: { value: [...tried] } });
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
      source: `ecb:${currency}`,
    }));
    for (let i = 0; i < values.length; i += 500) {
      await this.db
        .insert(priceHistory)
        .values(values.slice(i, i + 500))
        .onConflictDoNothing();
    }
  }
}
