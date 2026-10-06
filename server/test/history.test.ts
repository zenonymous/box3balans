import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { assets, priceHistory } from "../src/db/schema.js";
import { HistoryService } from "../src/prices/history.js";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const yahoo = (closes: number[], current?: number) => ({
  chart: {
    result: [
      {
        meta: { currency: "EUR", ...(current != null ? { regularMarketPrice: current } : {}) },
        timestamp: [day("2024-01-01") / 1000, day("2024-01-02") / 1000],
        indicators: { quote: [{ close: closes }] },
      },
    ],
    error: null,
  },
});
const coingeckoChart = {
  prices: [
    [day("2024-01-01"), 2.5],
    [day("2024-01-02"), 2.6],
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
  await new HistoryService(db, t.prices.fx, t.fetch).ensureRange(asset!, "2024-01-01", "2024-01-02");
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
