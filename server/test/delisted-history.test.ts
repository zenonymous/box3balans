import { afterEach, describe, expect, it } from "vitest";
import { accounts, assets, transactions } from "../src/db/schema.js";
import { HistoryService } from "../src/prices/history.js";
import { createTestApp, defaultRoutes, raw, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const DAY = 86_400_000;
const ts = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
/** A Yahoo chart answer for a pair, with the coin's name as Yahoo gives it. */
const yahoo = (name: string, points: [string, number][]) => ({
  chart: {
    result: [
      {
        meta: { currency: "EUR", longName: name },
        timestamp: points.map(([d]) => ts(d)),
        indicators: { quote: [{ close: points.map(([, c]) => c) }] },
      },
    ],
  },
});
const binance = (points: [string, number][]) =>
  points.map(([d, c]) => [Date.parse(d), `${c}`, `${c}`, `${c}`, `${c}`, "1", Date.parse(d) + DAY - 1]);

/** A delisted coin you hold, priced manually, with optional trades in it (EUR per unit). */
async function setup(
  routes: Record<string, unknown>,
  coin: { symbol: string; name?: string },
  trades: [string, string][],
) {
  t = await createTestApp({ ...defaultRoutes, ...routes }, { login: false });
  const db = t.database.db;
  const [acc] = await db.insert(accounts).values({ name: "Bitvavo", kind: "exchange" }).returning();
  const [asset] = await db
    .insert(assets)
    .values({
      assetClass: "crypto",
      name: coin.name ?? coin.symbol,
      symbol: coin.symbol,
      priceSource: "manual",
      priceRef: `manual:${coin.symbol}`,
      currency: "EUR",
    })
    .returning();
  for (const [day, price] of trades) {
    await db.insert(transactions).values({
      accountId: acc!.id,
      assetId: asset!.id,
      type: "buy",
      quantity: "100",
      price,
      currency: "EUR",
      fxRate: "1",
      occurredAt: new Date(`${day}T12:00:00Z`),
      source: "api",
    });
  }
  const history = new HistoryService(db, t.prices.fx, t.fetch);
  await history.ensureRange(asset!, "2024-12-20", "2024-12-31");
  return (day: string) => history.eurOn(asset!.id, day).then((v) => (v == null ? null : Number(v)));
}

describe("price history for a coin its exchange delisted", () => {
  it("takes Yahoo's EUR pair when its closes match your own trades", async () => {
    const eurOn = await setup(
      {
        "chart/FLOW-EUR": yahoo("Flow EUR", [
          ["2024-12-20", 0.74],
          ["2024-12-31", 0.72],
        ]),
      },
      { symbol: "FLOW" },
      [["2024-12-20", "0.75"]],
    );
    expect(await eurOn("2024-12-31")).toBe(0.72);
  });

  it("refuses a pair whose prices are far from what you paid: another coin with that symbol", async () => {
    const eurOn = await setup(
      {
        "chart/FLOW-EUR": yahoo("Flow EUR", [
          ["2024-12-20", 0.74],
          ["2024-12-31", 0.72],
        ]),
        "api/v3/klines?symbol=FLOWUSDT": binance([
          ["2024-12-20", 0.8],
          ["2024-12-31", 0.79],
        ]),
      },
      { symbol: "FLOW", name: "Flow" },
      [["2024-12-20", "50"]],
    );
    expect(await eurOn("2024-12-31")).toBeNull();
  });

  it("without trades, goes by Yahoo's name, but not for a coin still named after its symbol", async () => {
    const named = await setup(
      { "chart/THETA-EUR": yahoo("Theta Network EUR", [["2024-12-31", 2.35]]) },
      { symbol: "THETA", name: "Theta Network" },
      [],
    );
    expect(await named("2024-12-31")).toBe(2.35);
    await t!.close();
    const unnamed = await setup(
      { "chart/THETA-EUR": yahoo("Theta Network EUR", [["2024-12-31", 2.35]]) },
      { symbol: "THETA" },
      [],
    );
    expect(await unnamed("2024-12-31")).toBeNull();
  });

  it("falls back to Binance's USDT pair, in euros at the ECB dollar rate, checked against your trades", async () => {
    // defaultRoutes: 1 EUR = 1.10 USD in 2024, so 0.77 USDT is EUR 0.70.
    const eurOn = await setup(
      {
        "api/v3/klines?symbol=TONUSDT": binance([
          ["2024-12-20", 0.77],
          ["2024-12-31", 0.77],
        ]),
      },
      { symbol: "TON" },
      [["2024-12-20", "0.70"]],
    );
    expect(await eurOn("2024-12-31")).toBeCloseTo(0.7, 6);
  });
});

describe("price history further back than CoinGecko's free year", () => {
  async function coingeckoCoin(paid: string) {
    const yearAgo = Date.now() - 365 * DAY;
    t = await createTestApp(
      {
        ...defaultRoutes,
        "coins/the-open-network/market_chart/range": (url: string) => {
          // The free tier refuses a range starting more than 365 days back.
          if (Number(new URL(url).searchParams.get("from")) * 1000 < yearAgo)
            return raw("exceeds the allowed time range", 401);
          return { prices: [[Date.now() - 10 * DAY, 5]] };
        },
        "api/v3/klines?symbol=TONUSDT": binance([
          ["2024-11-28", 6.8],
          ["2024-12-31", 6.0],
        ]),
      },
      { login: false },
    );
    const db = t.database.db;
    const [acc] = await db.insert(accounts).values({ name: "Bitvavo", kind: "exchange" }).returning();
    const [asset] = await db
      .insert(assets)
      .values({
        assetClass: "crypto",
        name: "Toncoin",
        symbol: "TON",
        priceSource: "coingecko",
        priceRef: "the-open-network",
        currency: "EUR",
      })
      .returning();
    await db.insert(transactions).values({
      accountId: acc!.id,
      assetId: asset!.id,
      type: "buy",
      quantity: "1",
      price: paid,
      currency: "EUR",
      fxRate: "1",
      occurredAt: new Date("2024-11-28T12:00:00Z"),
      source: "api",
    });
    const history = new HistoryService(db, t.prices.fx, t.fetch);
    await history.ensureRange(asset!, "2024-11-28", new Date().toISOString().slice(0, 10));
    return (day: string) => history.eurOn(asset!.id, day).then((v) => (v == null ? null : Number(v)));
  }

  it("takes CoinGecko's last year, and Binance's pair before it when your buy confirms the coin", async () => {
    const eurOn = await coingeckoCoin("6.15");
    expect(await eurOn(new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10))).toBe(5);
    // 6.00 USDT at the ECB rate of 1.10.
    expect(await eurOn("2024-12-31")).toBeCloseTo(6.0 / 1.1, 8);
  });

  it("leaves the older days out when your buy says it's another coin", async () => {
    const eurOn = await coingeckoCoin("50");
    expect(await eurOn("2024-12-31")).toBeNull();
  });
});
