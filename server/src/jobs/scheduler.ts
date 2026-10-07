import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.js";
import type { DB } from "../db/client.js";
import { buildPortfolio, recordSnapshot } from "../domain/portfolio.js";
import { type PriceService, type RefreshResult, today } from "../prices/service.js";
import type { SyncService } from "../sync/service.js";
import type { WalletService } from "../wallets/service.js";
import type { BackfillService } from "./backfill.js";
import { isAutomatic, listBackups, pruneBackups, writeBackupFile } from "../backup/backup.js";
import { recordBackupStatus } from "../backup/status.js";
import { checkForUpdate } from "../domain/updates.js";

// A price counts as stale once it missed two refresh cycles plus some slack.
export const staleAfterMs = (config: Config) => (config.PRICE_REFRESH_MINUTES * 2 + 10) * 60_000;

/** Refreshes all prices, then records today's net-worth snapshot. */
export async function refreshAndSnapshot(db: DB, prices: PriceService, config: Config): Promise<RefreshResult> {
  const result = await prices.refreshAll();
  const { summary } = await buildPortfolio(db, { staleAfterMs: staleAfterMs(config) });
  await recordSnapshot(db, summary, today());
  return result;
}

/**
 * Runs `refreshAndSnapshot` now and every PRICE_REFRESH_MINUTES, and syncs exchange connections
 * every SYNC_INTERVAL_HOURS (first run a minute after startup). Runs of the same job never overlap.
 */
export function startScheduler(
  db: DB,
  prices: PriceService,
  sync: SyncService,
  wallets: WalletService,
  backfill: BackfillService,
  config: Config,
  log: FastifyBaseLogger,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await refreshAndSnapshot(db, prices, config);
      log.info({ updated: r.updated, failed: r.failed.length, fxError: r.fxError }, "price refresh done");
      for (const f of r.failed) log.warn({ asset: f.symbol, error: f.error }, "price refresh failed for asset");
    } catch (err) {
      log.error({ err }, "price refresh crashed");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 2_000);
  const timer = setInterval(tick, config.PRICE_REFRESH_MINUTES * 60_000);

  let syncing = false;
  const syncTick = async () => {
    if (syncing) return;
    syncing = true;
    try {
      for (const r of await sync.runAll()) {
        const { status, inserted, error } = r.result;
        if (status === "error") log.warn({ account: r.account, error }, "exchange sync failed");
        else log.info({ account: r.account, inserted, status }, "exchange sync done");
      }
      for (const r of await wallets.runAll()) {
        const { status, inserted, error } = r.result;
        if (status === "error") log.warn({ account: r.account, chain: r.chain, error }, "wallet sync failed");
        else log.info({ account: r.account, chain: r.chain, inserted, status }, "wallet sync done");
      }
    } catch (err) {
      log.error({ err }, "exchange sync crashed");
    } finally {
      syncing = false;
    }
  };
  const syncMs = config.SYNC_INTERVAL_HOURS * 3_600_000;
  const firstSync = syncMs > 0 ? setTimeout(syncTick, 60_000) : undefined;
  const syncTimer = syncMs > 0 ? setInterval(syncTick, syncMs) : undefined;

  // Price history: shortly after startup, then daily.
  const runBackfill = () =>
    void backfill
      .run()
      .then((r) => {
        log.info({ checked: r.checked, fetched: r.fetched, failed: r.failed.length }, "price history backfill done");
        for (const f of r.failed)
          log.warn({ asset: f.symbol, error: f.error }, "price history backfill failed for asset");
      })
      .catch((err) => log.error({ err }, "price history backfill crashed"));
  const firstBackfill = setTimeout(runBackfill, 30_000);
  const backfillTimer = setInterval(runBackfill, 24 * 3_600_000);

  // Automatic backups: checked hourly, written when the newest automatic one is older than the interval.
  const backupMs = config.BACKUP_INTERVAL_HOURS * 3_600_000;
  const backupTick = async () => {
    try {
      const latest = listBackups(config.BACKUP_DIR).find((b) => isAutomatic(b.name));
      if (latest && Date.now() - Date.parse(latest.createdAt) < backupMs) return;
      const b = await writeBackupFile(db, config.BACKUP_DIR, "auto", config.BACKUP_PASSPHRASE);
      const removed = pruneBackups(config.BACKUP_DIR, config.BACKUP_KEEP);
      await recordBackupStatus(db, { lastSuccessAt: new Date().toISOString(), lastName: b.name });
      log.info({ backup: b.name, sizeBytes: b.sizeBytes, pruned: removed.length }, "automatic backup written");
    } catch (err) {
      log.error({ err }, "automatic backup failed");
      await recordBackupStatus(db, { lastErrorAt: new Date().toISOString(), lastError: (err as Error).message }).catch(
        () => undefined,
      );
    }
  };
  const firstBackup = backupMs > 0 ? setTimeout(backupTick, 5 * 60_000) : undefined;
  const backupTimer = backupMs > 0 ? setInterval(backupTick, 3_600_000) : undefined;

  // New version: daily, only when the check is turned on (it asks GitHub).
  const updateTick = () =>
    void checkForUpdate(db, config, prices.fetchFn)
      .then((s) => s.enabled && s.newer && log.info({ latest: s.latest?.version }, "a newer version is available"))
      .catch((err) => log.warn({ err }, "update check failed"));
  const firstUpdate = setTimeout(updateTick, 2 * 60_000);
  const updateTimer = setInterval(updateTick, 24 * 3_600_000);

  return () => {
    clearTimeout(firstBackup);
    clearInterval(backupTimer);
    clearTimeout(firstBackfill);
    clearInterval(backfillTimer);
    clearTimeout(first);
    clearInterval(timer);
    clearTimeout(firstSync);
    clearInterval(syncTimer);
    clearTimeout(firstUpdate);
    clearInterval(updateTimer);
  };
}
