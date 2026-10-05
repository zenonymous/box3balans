import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { assets, pricesLatest } from "../src/db/schema.js";
import { createTestApp, defaultRoutes, raw, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const latest = async (assetId: number) =>
  (await t.database.db.select().from(pricesLatest).where(eq(pricesLatest.assetId, assetId)))[0];

const bitvavo = (last: string) => [
  { market: "BTC-EUR", open: "50000", last },
  { market: "HOSKY-EUR", open: "1", last: "1" },
];

async function addAsset(body: object) {
  return json(await t.api("POST", "/api/assets", body));
}

describe("second price sources", () => {
  it("prices crypto from Bitvavo when CoinGecko is down", async () => {
    t = await createTestApp({
      ...defaultRoutes,
      "api.coingecko.com/api/v3/simple/price": raw("rate limited", 429),
      "api.bitvavo.com/v2/ticker/24h": bitvavo("51000"),
    });
    const btc = await addAsset({
      assetClass: "crypto",
      name: "Bitcoin",
      symbol: "BTC",
      priceSource: "coingecko",
      priceRef: "bitcoin",
    });
    const r = await t.prices.refreshAll();
    expect(r.fallbacks).toEqual([{ symbol: "BTC", source: "bitvavo" }]);
    expect(r.failed.map((f) => f.symbol)).not.toContain("BTC");
    expect(await latest(btc.id)).toMatchObject({ source: "bitvavo", currency: "EUR" });
    expect(Number((await latest(btc.id))!.priceEur)).toBe(51000);
    expect(Number((await latest(btc.id))!.changePct24h)).toBeCloseTo(2, 6);
  });

  it("ignores a fallback price far from the last known one, and unknown tokens", async () => {
    t = await createTestApp({
      ...defaultRoutes,
      "api.coingecko.com/api/v3/simple/price": raw("down", 503),
      "api.bitvavo.com/v2/ticker/24h": bitvavo("5000"),
    });
    const btc = await addAsset({
      assetClass: "crypto",
      name: "Bitcoin",
      symbol: "BTC",
      priceSource: "coingecko",
      priceRef: "bitcoin",
    });
    await t.prices.store(btc.id, {
      price: (await import("../src/lib/decimal.js")).D(50000),
      currency: "EUR",
      source: "coingecko",
    });
    // A token never priced before: its symbol on an exchange may be another coin.
    await t.database.db.insert(assets).values({
      assetClass: "crypto",
      name: "Hosky",
      symbol: "HOSKY",
      priceSource: "coingecko",
      priceRef: "hosky",
      chain: "cardano",
      contract: "a0028f",
    });
    const r = await t.prices.refreshAll();
    expect(r.fallbacks ?? []).toEqual([]);
    expect(r.failed.map((f) => f.symbol).sort()).toEqual(["BTC", "HOSKY"]);
    expect((await latest(btc.id))!.source).toBe("coingecko");
  });

  it("prices a stock from Tradegate by ISIN when Yahoo fails, in the stock's own currency", async () => {
    t = await createTestApp({
      ...defaultRoutes,
      "query1.finance.yahoo.com/v8/finance/chart/AAPL": raw("gone", 500),
      "tradegatebsx.com/refresh.php?isin=US0378331005": {
        bid: "296,60",
        ask: 296.8,
        last: "296,70",
        delta: 0.08,
        close: 296.45,
      },
    });
    // Inserted directly: adding it through the API would check the (failing) Yahoo quote.
    const [aapl] = await t.database.db
      .insert(assets)
      .values({
        assetClass: "stock",
        name: "Apple",
        symbol: "AAPL",
        isin: "US0378331005",
        priceSource: "yahoo",
        priceRef: "AAPL",
        currency: "USD",
      })
      .returning();
    const r = await t.prices.refreshAll();
    expect(r.fallbacks).toEqual([{ symbol: "AAPL", source: "tradegate" }]);
    const p = (await latest(aapl!.id))!;
    // €296.70 at 1.25 USD per EUR = $370.875; valued back in EUR it's €296.70.
    expect(p).toMatchObject({ source: "tradegate", currency: "USD" });
    expect(Number(p.price)).toBeCloseTo(370.875, 6);
    expect(Number(p.priceEur)).toBeCloseTo(296.7, 6);
    expect(Number(p.changePct24h)).toBeCloseTo(0.08, 6);
  });

  it("reads Tradegate's mixed number formats", async () => {
    t = await createTestApp({
      ...defaultRoutes,
      "query1.finance.yahoo.com/v8/finance/chart/ASML.AS": raw("gone", 500),
      // No last trade yet: the middle of bid and ask, written German-style with a thousands space.
      "tradegatebsx.com/refresh.php?isin=NL0010273215": { bid: "1 659,20", ask: "1 660,60", delta: "0,19" },
    });
    const [asml] = await t.database.db
      .insert(assets)
      .values({
        assetClass: "stock",
        name: "ASML",
        symbol: "ASML",
        isin: "NL0010273215",
        priceSource: "yahoo",
        priceRef: "ASML.AS",
        currency: "EUR",
      })
      .returning();
    await t.prices.refreshAll();
    const p = (await latest(asml!.id))!;
    expect(Number(p.price)).toBeCloseTo(1659.9, 6);
    expect(Number(p.changePct24h)).toBeCloseTo(0.19, 6);
  });
});
