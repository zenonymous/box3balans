import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { assets, pricesLatest, transactions } from "../src/db/schema.js";
import { bitvavoCandles, bitvavoProvider } from "../src/prices/bitvavo.js";
import { AssetResolver } from "../src/sync/assets.js";
import { createTestApp, defaultRoutes, fakeFetch, raw, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const DAY = 86_400_000;
const candle = (day: string, close: number) => [Date.parse(day), `${close}`, `${close}`, `${close}`, `${close}`, "1"];

const HISTORY = [
  {
    transactionId: "d1",
    executedAt: "2024-01-01T09:00:00Z",
    type: "deposit",
    receivedCurrency: "EUR",
    receivedAmount: "1000",
  },
  {
    transactionId: "b1",
    executedAt: "2024-01-02T10:00:00Z",
    type: "buy",
    sentCurrency: "EUR",
    sentAmount: "500",
    receivedCurrency: "BTC",
    receivedAmount: "0.01",
    feesCurrency: "EUR",
    feesAmount: "1.25",
  },
  {
    transactionId: "s1",
    executedAt: "2024-02-01T06:00:00Z",
    type: "staking",
    receivedCurrency: "ETH",
    receivedAmount: "0.001",
  },
  {
    transactionId: "s2",
    executedAt: "2024-02-02T06:00:00Z",
    type: "staking",
    receivedCurrency: "ETH",
    receivedAmount: "0.002",
  },
];

const routes = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...defaultRoutes,
  "api.bitvavo.com/v2/balance": [
    { symbol: "EUR", available: "498.75", inOrder: "0" },
    { symbol: "BTC", available: "0.01", inOrder: "0" },
    { symbol: "ETH", available: "0.003", inOrder: "0" },
  ],
  "api.bitvavo.com/v2/stakingBalance": [],
  "api.bitvavo.com/v2/account/history": { items: HISTORY, currentPage: 1, totalPages: 1, maxItems: 100 },
  "api.bitvavo.com/v2/markets": [
    { market: "BTC-EUR", base: "BTC", quote: "EUR", status: "trading" },
    { market: "ETH-EUR", base: "ETH", quote: "EUR", status: "trading" },
  ],
  "api.bitvavo.com/v2/assets": [
    { symbol: "BTC", name: "Bitcoin" },
    { symbol: "ETH", name: "Ethereum" },
  ],
  "api.bitvavo.com/v2/ticker/24h": [
    { market: "BTC-EUR", open: "50000", last: "51000" },
    { market: "ETH-EUR", open: "2000", last: "2100" },
  ],
  "api.bitvavo.com/v2/ETH-EUR/candles": [candle("2024-02-02", 2100), candle("2024-02-01", 2000)],
  ...extra,
});

async function syncBitvavo() {
  const res = await t!.api("POST", "/api/integrations", {
    provider: "bitvavo",
    credentials: { apiKey: "bv-key-1234567890", apiSecret: "bv-secret-abcdefghij" },
  });
  expect(res.statusCode).toBe(200);
  const { id } = json<{ id: number }>(res);
  await t!.sync.whenIdle(id);
  return { id, result: json<any[]>(await t!.api("GET", "/api/integrations")).find((i) => i.id === id).lastResult };
}

const assetBySymbol = async (symbol: string) =>
  (await t!.database.db.select().from(assets).where(eq(assets.symbol, symbol)))[0]!;
const rewardPrices = async () =>
  (await t!.database.db.select().from(transactions).where(eq(transactions.type, "reward")))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((r) => Number(r.price));

describe("Bitvavo as a price source", () => {
  it("prices coins from a Bitvavo account on Bitvavo itself, without asking CoinGecko", async () => {
    t = await createTestApp(routes());
    const { result } = await syncBitvavo();
    expect(result.status).toBe("ok");
    expect(result.newAssets).toEqual(expect.arrayContaining(["BTC → Bitvavo BTC-EUR", "ETH → Bitvavo ETH-EUR"]));
    expect(t.fetch.calls.some((u) => u.includes("api/v3/search"))).toBe(false);

    expect(await assetBySymbol("BTC")).toMatchObject({ priceSource: "bitvavo", priceRef: "BTC-EUR", name: "Bitcoin" });
    // Staking rewards valued at Bitvavo's daily close; the current price from its ticker.
    expect(await rewardPrices()).toEqual([2000, 2100]);
    const btc = await assetBySymbol("BTC");
    const [price] = await t.database.db.select().from(pricesLatest).where(eq(pricesLatest.assetId, btc.id));
    expect(price).toMatchObject({ source: "bitvavo", currency: "EUR" });
    expect(Number(price!.price)).toBe(51000);
  });

  it("upgrades a coin made manual when no feed answered, but keeps a price you entered", async () => {
    t = await createTestApp(routes());
    const db = t.database.db;
    const manual = (symbol: string) => ({
      assetClass: "crypto" as const,
      name: symbol,
      symbol,
      priceSource: "manual" as const,
      priceRef: `manual:${symbol}`,
      currency: "EUR",
    });
    const [btc] = await db.insert(assets).values(manual("BTC")).returning();
    const [eth] = await db.insert(assets).values(manual("ETH")).returning();
    await t.prices.setManual(eth!.id, "1999", "EUR");

    const { result } = await syncBitvavo();
    expect(result.newAssets).toContain("BTC → Bitvavo BTC-EUR (was manual)");
    expect(await assetBySymbol("BTC")).toMatchObject({ id: btc!.id, priceSource: "bitvavo", name: "Bitcoin" });
    expect(await assetBySymbol("ETH")).toMatchObject({ id: eth!.id, priceSource: "manual" });
  });

  it("falls back to Bitvavo's market when CoinGecko is rate limited, and to manual when neither knows it", async () => {
    t = await createTestApp(
      {
        ...defaultRoutes,
        "api/v3/search?query=SOL": raw("rate limited", 429),
        "api.bitvavo.com/v2/markets": [{ market: "SOL-EUR", base: "SOL", quote: "EUR", status: "trading" }],
        "api.bitvavo.com/v2/assets": [{ symbol: "SOL", name: "Solana" }],
      },
      { login: false },
    );
    const resolver = new AssetResolver(t.database.db, t.fetch);
    expect(await resolver.resolve({ kind: "crypto", symbol: "SOL" })).toMatchObject({
      priceSource: "bitvavo",
      priceRef: "SOL-EUR",
      name: "Solana",
    });
    expect(await resolver.resolve({ kind: "crypto", symbol: "XYZ" })).toMatchObject({ priceSource: "manual" });
    expect(resolver.warnings).toEqual(["No price feed found for XYZ; created it as a manually priced asset."]);
  });

  it("values rewards booked at €0 once a price is known, except one you edited", async () => {
    const r = routes({ "api.bitvavo.com/v2/ETH-EUR/candles": [] });
    t = await createTestApp(r);
    const { id } = await syncBitvavo();
    expect(await rewardPrices()).toEqual([0, 0]);

    const [first] = (await t.database.db.select().from(transactions).where(eq(transactions.type, "reward"))).sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    expect((await t.api("PUT", `/api/transactions/${first!.id}`, { notes: "worthless to me" })).statusCode).toBe(200);

    r["api.bitvavo.com/v2/ETH-EUR/candles"] = [candle("2024-02-02", 2100), candle("2024-02-01", 2000)];
    expect((await t.api("POST", `/api/integrations/${id}/sync`)).statusCode).toBe(202);
    await t.sync.whenIdle(id);
    const result = json<any[]>(await t.api("GET", "/api/integrations")).find((i) => i.id === id).lastResult;
    expect(result.revalued).toBe(1);
    expect(await rewardPrices()).toEqual([0, 2100]);
  });
});

describe("Bitvavo market data", () => {
  it("reads quotes with the 24h change", async () => {
    const quotes = await bitvavoProvider(fakeFetch(routes())).quotes(["BTC-EUR", "NOPE-EUR"]);
    expect([...quotes.keys()]).toEqual(["BTC-EUR"]);
    expect(Number(quotes.get("BTC-EUR")!.price)).toBe(51000);
    expect(Number(quotes.get("BTC-EUR")!.changePct24h)).toBe(2);
  });

  it("pages through more than 1,440 daily candles, oldest first", async () => {
    const first = Date.UTC(2020, 0, 1);
    const all = Array.from({ length: 1450 }, (_, i) => first + i * DAY);
    const fetchFn = fakeFetch({
      "BTC-EUR/candles": (url: string) => {
        const q = new URL(url).searchParams;
        const [start, end] = [Number(q.get("start")), Number(q.get("end"))];
        return all
          .filter((ts) => ts >= start && ts < end)
          .reverse()
          .slice(0, 1440)
          .map((ts) => [ts, "1", "1", "1", "1", "1"]);
      },
    });
    const days = await bitvavoCandles(
      "BTC-EUR",
      "2020-01-01",
      new Date(all.at(-1)!).toISOString().slice(0, 10),
      fetchFn,
    );
    expect(days).toHaveLength(1450);
    expect(days[0]!.day).toBe("2020-01-01");
    expect(fetchFn.calls).toHaveLength(2);
  });
});
