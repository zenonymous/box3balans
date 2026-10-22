import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { assets, priceHistory } from "../src/db/schema.js";
import { D } from "../src/lib/decimal.js";
import { HistoryService, unsplit } from "../src/prices/history.js";
import { createTestApp, defaultRoutes, fakeFetch, raw, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
// Two days within the last year: CoinGecko's free tier serves no further back.
const DAY = 86_400_000;
const D1 = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
const D2 = new Date(Date.now() - 29 * DAY).toISOString().slice(0, 10);
const yahoo = (closes: number[], current?: number) => ({
  chart: {
    result: [
      {
        meta: { currency: "EUR", ...(current != null ? { regularMarketPrice: current } : {}) },
        timestamp: [day(D1) / 1000, day(D2) / 1000],
        indicators: { quote: [{ close: closes }] },
      },
    ],
    error: null,
  },
});
const coingeckoChart = {
  prices: [
    [day(D1), 2.5],
    [day(D2), 2.6],
  ],
};

/** A BEP-20 token identified by contract, whose symbol Yahoo may know as another coin. */
async function cake(routes: Record<string, unknown>) {
  t = await createTestApp({
    ...defaultRoutes,
    "api.coingecko.com/api/v3/simple/price?ids=pancakeswap-token": { "pancakeswap-token": { eur: 2.4 } },
    "coins/pancakeswap-token/market_chart/range": coingeckoChart,
    ...routes,
  });
  const db = t.database.db;
  const [asset] = await db
    .insert(assets)
    .values({
      assetClass: "crypto",
      name: "PancakeSwap",
      symbol: "CAKE",
      priceSource: "coingecko",
      priceRef: "pancakeswap-token",
      chain: "bsc",
      contract: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
    })
    .returning();
  await new HistoryService(db, t.prices.fx, t.fetch).ensureRange(asset!, D1, D2);
  const rows = await db
    .select({ day: priceHistory.day, closeEur: priceHistory.closeEur })
    .from(priceHistory)
    .where(eq(priceHistory.assetId, asset!.id))
    .orderBy(asc(priceHistory.day));
  return rows.map((r) => Number(r.closeEur));
}

describe("price history for coins identified by id or contract", () => {
  it("ignores Yahoo's SYM-EUR pair when it prices another coin", async () => {
    // Yahoo's CAKE-EUR is a coin worth about €2,000 today: not this token.
    expect(await cake({ "chart/CAKE-EUR": yahoo([1900, 2000], 2100) })).toEqual([2.5, 2.6]);
  });

  it("uses Yahoo's longer history when its current price matches", async () => {
    expect(await cake({ "chart/CAKE-EUR": yahoo([2.3, 2.35], 2.45) })).toEqual([2.3, 2.35]);
  });

  it("doesn't trust a token's Yahoo pair it can't check", async () => {
    // No current price on Yahoo and an old series: nothing to compare with.
    expect(await cake({ "chart/CAKE-EUR": yahoo([1900, 2000]) })).toEqual([2.5, 2.6]);
  });
});

describe("stock splits in Yahoo's history", () => {
  // NVIDIA split 10:1 on 10 June 2024. Asked today, Yahoo gives the close of 7 June as 120.89
  // (the real price was about 1,208.88) and lists the split only for the whole history.
  const ts = (d: string) => day(d) / 1000 + 13.5 * 3600;
  const chart = {
    chart: {
      result: [
        {
          meta: { currency: "USD", regularMarketPrice: 130 },
          timestamp: [ts("2024-06-06"), ts("2024-06-07"), ts("2024-06-10")],
          indicators: { quote: [{ close: [120.1, 120.89, 121.79] }] },
        },
      ],
      error: null,
    },
  };
  const events = {
    chart: {
      result: [
        {
          meta: { currency: "USD" },
          events: {
            splits: {
              a: { date: ts("2021-07-20"), numerator: 4, denominator: 1 },
              b: { date: ts("2024-06-10"), numerator: 10, denominator: 1 },
            },
          },
        },
      ],
      error: null,
    },
  };
  const routes = {
    ...defaultRoutes,
    "query1.finance.yahoo.com/v8/finance/chart/NVDA?period1": chart,
    "query1.finance.yahoo.com/v8/finance/chart/NVDA?range=max": events,
  };

  it("undoes the adjustment: a close is the price of one share on that day", () => {
    const p = (d: string, c: number) => ({ day: d, close: D(c), currency: "USD" });
    const splits = [
      { day: "2021-07-20", ratio: D(4) },
      { day: "2024-06-10", ratio: D(10) },
    ];
    const out = unsplit([p("2021-07-19", 10), p("2024-06-07", 120.89), p("2024-06-10", 121.79)], splits);
    expect(out.map((x) => x.close.toNumber())).toEqual([400, 1208.9, 121.79]);
    // A reverse split (1:10) the other way round.
    expect(unsplit([p("2024-01-02", 5)], [{ day: "2024-02-01", ratio: D(0.1) }])[0]!.close.toNumber()).toBe(0.5);
  });

  async function nvidia() {
    t = await createTestApp(routes);
    const db = t.database.db;
    const [asset] = await db
      .insert(assets)
      .values({ assetClass: "stock", name: "NVIDIA", symbol: "NVDA", priceSource: "yahoo", priceRef: "NVDA" })
      .returning();
    const closes = async () =>
      (
        await db
          .select({ day: priceHistory.day, close: priceHistory.close, source: priceHistory.source })
          .from(priceHistory)
          .where(eq(priceHistory.assetId, asset!.id))
          .orderBy(asc(priceHistory.day))
      ).map((r) => [r.day, Number(r.close)]);
    return { db, asset: asset!, closes };
  }

  it("stores history before a split at the price of that day", async () => {
    const { asset, closes } = await nvidia();
    await new HistoryService(t!.database.db, t!.prices.fx, t!.fetch).ensureRange(asset, "2024-06-06", "2024-06-10");
    expect(await closes()).toEqual([
      ["2024-06-06", 1201],
      ["2024-06-07", 1208.9],
      ["2024-06-10", 121.79],
    ]);
  });

  it("stores nothing when the splits can't be looked up", async () => {
    const { asset, closes } = await nvidia();
    const fetch = fakeFetch({
      ...routes,
      "query1.finance.yahoo.com/v8/finance/chart/NVDA?range=max": raw("down", 500),
    });
    await new HistoryService(t!.database.db, t!.prices.fx, fetch).ensureRange(asset, "2024-06-06", "2024-06-10");
    expect(await closes()).toEqual([]);
  });

  it("repairs closes stored adjusted by an earlier version, once", async () => {
    const { db, asset, closes } = await nvidia();
    const broker = (await t!.api("POST", "/api/accounts", { name: "Broker", kind: "broker" })).json();
    expect(
      (
        await t!.api("POST", "/api/transactions", {
          accountId: broker.id,
          assetId: asset.id,
          type: "buy",
          occurredAt: "2024-06-06T12:00:00Z",
          quantity: "1",
          price: "1200",
        })
      ).body,
    ).toContain('"id"');
    // As 0.1.34 stored them: a tenth of the price before the split.
    await db.delete(priceHistory).where(eq(priceHistory.assetId, asset.id));
    await db.insert(priceHistory).values([
      { assetId: asset.id, day: "2024-06-06", close: "120.1", currency: "USD", closeEur: "110", source: "yahoo:NVDA" },
      { assetId: asset.id, day: "2024-06-07", close: "120.89", currency: "USD", closeEur: "111", source: "yahoo:NVDA" },
      { assetId: asset.id, day: "2024-06-10", close: "121.79", currency: "USD", closeEur: "112", source: "yahoo:NVDA" },
    ]);
    await t!.backfill.run({ force: true });
    expect((await closes()).slice(0, 3)).toEqual([
      ["2024-06-06", 1201],
      ["2024-06-07", 1208.9],
      ["2024-06-10", 121.79],
    ]);
    // Done once: a close stored afterwards isn't touched again.
    await db.update(priceHistory).set({ close: "999" }).where(eq(priceHistory.day, "2024-06-06"));
    await t!.backfill.run({ force: true });
    expect((await closes())[0]).toEqual(["2024-06-06", 999]);
  });
});
