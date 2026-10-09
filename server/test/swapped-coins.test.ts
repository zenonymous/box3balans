import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { accounts, assets, pricesLatest, settings, transactions } from "../src/db/schema.js";
import { HistoryService } from "../src/prices/history.js";
import { AssetResolver } from "../src/sync/assets.js";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const ts = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const yahoo = (name: string, currency: string, points: [string, number][]) => ({
  chart: {
    result: [
      {
        meta: { currency, longName: name },
        timestamp: points.map(([d]) => ts(d)),
        indicators: { quote: [{ close: points.map(([, c]) => c) }] },
      },
    ],
  },
});
const kline = (day: string, close: number) => [Date.parse(day), `${close}`, `${close}`, `${close}`, `${close}`, "1"];

/** A coin under its old symbol, priced manually, held in an account since `day`. */
async function holding(symbol: string, day: string) {
  const db = t!.database.db;
  const [acc] = await db
    .insert(accounts)
    .values({ name: `Exchange ${symbol}`, kind: "exchange" })
    .returning();
  const [asset] = await db
    .insert(assets)
    .values({
      assetClass: "crypto",
      name: symbol,
      symbol,
      priceSource: "manual",
      priceRef: `manual:${symbol}`,
      currency: "EUR",
    })
    .returning();
  await db.insert(transactions).values({
    accountId: acc!.id,
    assetId: asset!.id,
    type: "deposit",
    quantity: "5",
    price: "0.5",
    currency: "EUR",
    fxRate: "1",
    occurredAt: new Date(`${day}T09:00:00Z`),
    source: "api",
  });
  return { accountId: acc!.id, asset: asset! };
}

describe("coins swapped for a successor", () => {
  it("values NU by its own pairs until the swap, then as 3.259242 T, once more after an update", async () => {
    t = await createTestApp(
      {
        ...defaultRoutes,
        // Yahoo still has NuCypher's own pair; the coin's old name tells it's the same coin.
        "chart/NU-EUR": yahoo("NuCypher EUR", "EUR", [
          ["2022-01-10", 0.5],
          ["2022-02-15", 0.4],
          ["2022-02-16", 0.39],
        ]),
        "api.bitvavo.com/v2/T-EUR/candles": [], // Bitvavo listed T only in 2023
        "api/v3/klines?symbol=TUSDT": [kline("2022-02-25", 0.055)],
        "chart/T-USD": yahoo("Threshold USD", "USD", [
          ["2022-02-16", 0.06],
          ["2022-02-25", 0.9],
        ]),
        "frankfurter.dev/v1/2022-": { date: "2022-02-14", rates: { USD: 1.1 } },
      },
      { login: false },
    );
    const { asset } = await holding("NU", "2022-01-10");
    // Loaded before swapped coins were known: marked as done, with nothing found.
    await t.database.db
      .insert(settings)
      .values({ key: "history_backfill", value: { [asset.id]: { from: "2022-01-10", at: new Date().toISOString() } } });

    expect((await t.backfill.run()).fetched).toBe(1);
    const history = new HistoryService(t.database.db, t.prices.fx, t.fetch);
    const eurOn = async (day: string) => Number(await history.eurOn(asset.id, day));
    expect(await eurOn("2022-02-15")).toBe(0.4);
    // T in dollars, at the ECB rate (1.10), times the rate; Binance before Yahoo.
    expect(await eurOn("2022-02-16")).toBeCloseTo((0.06 / 1.1) * 3.259242, 8);
    expect(await eurOn("2022-02-25")).toBeCloseTo((0.055 / 1.1) * 3.259242, 8);
    // Loaded now: the next run leaves it alone.
    expect((await t.backfill.run()).fetched).toBe(0);
  });

  it("takes an old coin's own Binance pair from the list, without trades to check it against", async () => {
    t = await createTestApp(
      {
        ...defaultRoutes,
        "api/v3/klines?symbol=LITUSDT": [kline("2024-12-31", 0.77)],
        "api.bitvavo.com/v2/HEI-EUR/candles": [kline("2025-02-14", 0.52)],
        "api/v3/klines?symbol=HEIUSDT": [kline("2025-02-13", 0.55)],
        "frankfurter.dev/v1/2025-": { date: "2025-02-12", rates: { USD: 1.1 } },
      },
      { login: false },
    );
    const { asset } = await holding("LIT", "2024-12-01");
    const history = new HistoryService(t.database.db, t.prices.fx, t.fetch);
    await history.ensureRange(asset, "2024-12-01", "2025-02-14");
    const eurOn = async (day: string) => Number(await history.eurOn(asset.id, day));
    expect(await eurOn("2024-12-31")).toBeCloseTo(0.7, 8);
    // From the swap on, Heima: Binance for the first day, Bitvavo's market after.
    expect(await eurOn("2025-02-13")).toBeCloseTo(0.5, 8);
    expect(await eurOn("2025-02-14")).toBe(0.52);
  });

  it("prices an old coin as its successor today, but keeps a price you entered", async () => {
    t = await createTestApp({
      ...defaultRoutes,
      "api.bitvavo.com/v2/ticker/24h": [{ market: "S-EUR", open: "0.40", last: "0.50" }],
      "api/v3/ticker/24hr?symbol=TUSDT": { lastPrice: "0.02", priceChangePercent: "-1.5" },
    });
    const ftm = (await holding("FTM", "2024-05-01")).asset;
    const nu = (await holding("NU", "2021-03-16")).asset;
    const keep = (await holding("KEEP", "2021-06-17")).asset;
    await t.prices.setManual(keep.id, "0.10", "EUR");

    await t.prices.refreshAll();
    const latest = async (id: number) =>
      (await t!.database.db.select().from(pricesLatest).where(eq(pricesLatest.assetId, id)))[0]!;
    expect(await latest(ftm.id)).toMatchObject({ source: "migration", currency: "EUR" });
    expect(Number((await latest(ftm.id)).price)).toBe(0.5);
    expect(Number((await latest(ftm.id)).changePct24h)).toBe(25);
    // T isn't on this Bitvavo: Binance's dollar price, at today's ECB rate (1.25).
    expect(Number((await latest(nu.id)).priceEur)).toBeCloseTo((0.02 * 3.259242) / 1.25, 8);
    expect(await latest(keep.id)).toMatchObject({ source: "manual" });
    expect(Number((await latest(keep.id)).price)).toBe(0.1);

    const listed = json<any[]>(await t.api("GET", "/api/assets")).find((a) => a.id === ftm.id);
    expect(listed.swappedFor).toEqual({ symbol: "S", name: "Sonic", ratio: "1", since: "2025-01-13" });
  });

  it("creates and names a swapped coin from a sync without looking it up", async () => {
    t = await createTestApp({ ...defaultRoutes, "api.bitvavo.com/v2/markets": [] }, { login: false });
    const { accountId, asset: ftm } = await holding("FTM", "2024-05-01");
    const resolver = new AssetResolver(t.database.db, t.fetch);

    expect(await resolver.resolve({ kind: "crypto", symbol: "NU" })).toMatchObject({
      name: "NuCypher",
      priceSource: "manual",
    });
    await resolver.upgradeManualIn(accountId);
    expect(t.fetch.calls.some((u) => u.includes("coingecko"))).toBe(false);
    expect(resolver.warnings).toEqual([]);
    expect(resolver.describeCreated()).toEqual(["NU → 3.259242 T (swapped)"]);
    const [renamed] = await t.database.db.select().from(assets).where(eq(assets.id, ftm.id));
    expect(renamed).toMatchObject({ name: "Fantom", priceSource: "manual" });
  });
});
