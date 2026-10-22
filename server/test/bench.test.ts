import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, assets, priceHistory, transactions } from "../src/db/schema.js";
import { Ledger, sortTransactions } from "../src/domain/ledger.js";
import { holdingsOn } from "../src/domain/valuation.js";
import { localDay } from "../src/lib/time.js";
import { createTestApp, type TestApp } from "./helpers.js";

/**
 * How long box 3 takes with years of history (issue #84): 50,000 transactions over five years (daily
 * staking rewards on 20 coins, plus buys), with a close per asset per day. Skipped in `npm test`;
 * run it with BENCH=1 npx vitest run test/bench.test.ts (in server/). BENCH_TX sets the number.
 */
const RUN = !!process.env.BENCH;
const TX = Number(process.env.BENCH_TX) || 50_000;
const COINS = 20;
const STOCKS = 10;
const START = Date.UTC(2021, 0, 1);
const DAYS = 5 * 365;

let t: TestApp;
const timings: Record<string, number> = {};

async function time(label: string, f: () => Promise<{ statusCode: number }>) {
  const at = performance.now();
  const res = await f();
  timings[label] = Math.round(performance.now() - at);
  expect(res.statusCode).toBe(200);
}

describe.skipIf(!RUN)("box 3 with years of history", () => {
  beforeAll(async () => {
    t = await createTestApp();
    const db = t.database.db;
    const [account] = await db.insert(accounts).values({ name: "Exchange", kind: "exchange" }).returning();
    const made = await db
      .insert(assets)
      .values([
        ...Array.from({ length: COINS }, (_, i) => ({
          assetClass: "crypto" as const,
          name: `Coin ${i}`,
          symbol: `C${i}`,
          priceSource: "manual" as const,
        })),
        ...Array.from({ length: STOCKS }, (_, i) => ({
          assetClass: "stock" as const,
          name: `Stock ${i}`,
          symbol: `S${i}`,
          priceSource: "manual" as const,
        })),
      ])
      .returning();
    const day = (d: number) => new Date(START + d * 86_400_000).toISOString().slice(0, 10);
    const closes = made.flatMap((a, i) =>
      Array.from({ length: DAYS }, (_, d) => {
        const close = String(10 + i + (d % 50));
        return { assetId: a.id, day: day(d), close, currency: "EUR", closeEur: close };
      }),
    );
    for (let i = 0; i < closes.length; i += 5000) await db.insert(priceHistory).values(closes.slice(i, i + 5000));
    const txs = Array.from({ length: TX }, (_, n) => {
      const a = made[n % made.length]!;
      const reward = a.assetClass === "crypto" && n % 3 !== 0;
      return {
        accountId: account!.id,
        assetId: a.id,
        type: reward ? ("reward" as const) : ("buy" as const),
        occurredAt: new Date(START + Math.floor((n / TX) * DAYS) * 86_400_000 + 12 * 3_600_000),
        quantity: reward ? "0.01" : "1",
        price: "10",
      };
    });
    for (let i = 0; i < txs.length; i += 5000) await db.insert(transactions).values(txs.slice(i, i + 5000));
  }, 600_000);

  afterAll(async () => {
    console.log(`box 3 with ${TX} transactions (ms):`, timings);
    await t?.close();
  });

  it("computes a year, its actual return and the 2028 preview", async () => {
    await time("GET /api/box3/2025 (cold)", () => t.api("GET", "/api/box3/2025"));
    await time("GET /api/box3/2025", () => t.api("GET", "/api/box3/2025"));
    await time("GET /api/box3/2025/return", () => t.api("GET", "/api/box3/2025/return"));
    await time("GET /api/box3/future", () => t.api("GET", "/api/box3/future"));
    await time("GET /api/box3", () => t.api("GET", "/api/box3"));
    if (process.env.BENCH_PARTS) {
      const db = t.database.db;
      let at = performance.now();
      const rows = await db.select().from(transactions);
      timings["select transactions"] = Math.round(performance.now() - at);
      at = performance.now();
      const sorted = sortTransactions(rows);
      timings["sort"] = Math.round(performance.now() - at);
      at = performance.now();
      for (const tx of sorted) localDay(tx.occurredAt);
      timings["localDay per transaction"] = Math.round(performance.now() - at);
      at = performance.now();
      const ledger = new Ledger("average");
      for (const tx of sorted) ledger.apply(tx);
      timings["ledger replay"] = Math.round(performance.now() - at);
      at = performance.now();
      await holdingsOn(db, "2024-12-31");
      timings["holdingsOn"] = Math.round(performance.now() - at);
    }
  }, 600_000);
});
