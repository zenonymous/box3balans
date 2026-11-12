import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import type { DB } from "../src/db/client.js";
import type { BackfillService } from "../src/jobs/backfill.js";
import { oneAtATime, startScheduler } from "../src/jobs/scheduler.js";
import type { PriceService } from "../src/prices/service.js";
import type { SyncService } from "../src/sync/service.js";
import type { WalletService } from "../src/wallets/service.js";

/** The scheduler's timing, with a fake clock and stand-ins for the services it calls. */
afterEach(() => vi.useRealTimers());

describe("oneAtATime", () => {
  it("skips a call while a run is still going, and runs again after it", async () => {
    let finish = () => {};
    let runs = 0;
    const job = oneAtATime(
      () =>
        new Promise<void>((resolve) => {
          runs++;
          finish = resolve;
        }),
      () => {},
    );
    const first = job();
    await job();
    expect(runs).toBe(1);
    finish();
    await first;
    void job();
    expect(runs).toBe(2);
  });

  it("reports a crash and still runs the next time", async () => {
    const crashes: unknown[] = [];
    let runs = 0;
    const job = oneAtATime(
      async () => {
        if (++runs === 1) throw new Error("boom");
      },
      (err) => crashes.push(err),
    );
    await job();
    await job();
    expect(runs).toBe(2);
    expect(crashes).toEqual([new Error("boom")]);
  });
});

describe("startScheduler", () => {
  const log = { info: () => {}, warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
  // Never finishes, so the price job stays busy and nothing here touches the database.
  const refreshAll = vi.fn(() => new Promise(() => {}));
  const prices = { refreshAll, fetchFn: fetch } as unknown as PriceService;
  const history = vi.fn(async () => ({ checked: 0, fetched: 0, failed: [] }));
  const backfill = { run: history } as unknown as BackfillService;
  const config = (over: Partial<Config>) =>
    ({ PRICE_REFRESH_MINUTES: 15, SYNC_INTERVAL_HOURS: 6, BACKUP_INTERVAL_HOURS: 0, ...over }) as Config;
  const services = () => {
    const exchanges = vi.fn(async () => []);
    const chains = vi.fn(async () => []);
    return {
      exchanges,
      chains,
      sync: { runAll: exchanges } as unknown as SyncService,
      wallets: { runAll: chains } as unknown as WalletService,
    };
  };

  it("refreshes prices after 2 seconds, loads history after 30, and syncs after a minute and then every interval", async () => {
    vi.useFakeTimers();
    const { sync, wallets, exchanges, chains } = services();
    const stop = startScheduler({} as DB, prices, sync, wallets, backfill, config({}), log);
    refreshAll.mockClear();
    history.mockClear();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(refreshAll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshAll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(28_000);
    expect(history).toHaveBeenCalledTimes(1);
    expect(exchanges).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(exchanges).toHaveBeenCalledTimes(1);
    expect(chains).toHaveBeenCalledTimes(1);
    // Six hours after the start the interval fires: a second sync. The price job is still busy
    // with its first run, so the 24 refresh moments since didn't start another.
    await vi.advanceTimersByTimeAsync(6 * 3_600_000 - 60_000);
    expect(exchanges).toHaveBeenCalledTimes(2);
    expect(refreshAll).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(exchanges).toHaveBeenCalledTimes(2);
  });

  it("doesn't sync at all with SYNC_INTERVAL_HOURS=0", async () => {
    vi.useFakeTimers();
    const { sync, wallets, exchanges, chains } = services();
    const stop = startScheduler({} as DB, prices, sync, wallets, backfill, config({ SYNC_INTERVAL_HOURS: 0 }), log);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(exchanges).not.toHaveBeenCalled();
    expect(chains).not.toHaveBeenCalled();
    stop();
  });
});
