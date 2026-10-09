import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { assets, imports, integrations, priceHistory, transactions, walletAddresses } from "../src/db/schema.js";
import { HistoryService } from "../src/prices/history.js";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const candle = (day: string, close: number) => [Date.parse(day), `${close}`, `${close}`, `${close}`, `${close}`, "1"];

async function coin(symbol: string, market: string) {
  const [a] = await t!.database.db
    .insert(assets)
    .values({ assetClass: "crypto", name: symbol, symbol, priceSource: "bitvavo", priceRef: market, currency: "EUR" })
    .returning();
  return a!;
}
const sourceOn = async (assetId: number, day: string) =>
  (
    await t!.database.db
      .select({ source: priceHistory.source })
      .from(priceHistory)
      .where(and(eq(priceHistory.assetId, assetId), eq(priceHistory.day, day)))
  )[0]?.source;

describe("where prices come from", () => {
  it("records the source of each close, from history and from the price refresh", async () => {
    t = await createTestApp({ ...defaultRoutes, "api.bitvavo.com/v2/SOL-EUR/candles": [candle("2024-12-31", 180)] });
    const sol = await coin("SOL", "SOL-EUR");
    await new HistoryService(t.database.db, t.prices.fx, t.fetch).ensureRange(sol, "2024-12-31", "2024-12-31");
    expect(await sourceOn(sol.id, "2024-12-31")).toBe("bitvavo:SOL-EUR");

    const btc = (await t.database.db.select().from(assets).where(eq(assets.priceRef, "bitcoin")))[0];
    const [bitcoin] = btc
      ? [btc]
      : await t.database.db
          .insert(assets)
          .values({
            assetClass: "crypto",
            name: "Bitcoin",
            symbol: "BTC",
            priceSource: "coingecko",
            priceRef: "bitcoin",
          })
          .returning();
    await t.prices.refreshAll([bitcoin!.id]);
    expect(await sourceOn(bitcoin!.id, new Date().toISOString().slice(0, 10))).toBe("coingecko:bitcoin");
  });

  it("labels a close stored before sources only when the source gives the very same close", async () => {
    t = await createTestApp({
      ...defaultRoutes,
      "api.bitvavo.com/v2/SOL-EUR/candles": [candle("2024-12-31", 180)],
      "api.bitvavo.com/v2/ADA-EUR/candles": [candle("2024-12-31", 0.85)],
    });
    const db = t.database.db;
    const sol = await coin("SOL", "SOL-EUR");
    const ada = await coin("ADA", "ADA-EUR");
    const old = (assetId: number, close: string) => ({
      assetId,
      day: "2024-12-31",
      close,
      currency: "EUR",
      closeEur: close,
    });
    await db.insert(priceHistory).values([old(sol.id, "180"), old(ada.id, "0.81")]);
    const history = new HistoryService(db, t.prices.fx, t.fetch);
    expect(await history.labelClose(sol, "2024-12-31")).toBe(true);
    expect(await sourceOn(sol.id, "2024-12-31")).toBe("bitvavo:SOL-EUR");
    // ADA's stored close (0.81) isn't what Bitvavo gives now (0.85): its source stays unknown.
    expect(await history.labelClose(ada, "2024-12-31")).toBe(false);
    expect(await sourceOn(ada.id, "2024-12-31")).toBeNull();
  });
});

describe("sources of closes stored by earlier versions", () => {
  it("are found among the pairs an earlier version may have used", async () => {
    const kline = (day: string, close: number) => [
      Date.parse(day),
      `${close}`,
      `${close}`,
      `${close}`,
      `${close}`,
      "1",
    ];
    t = await createTestApp({ ...defaultRoutes, "api/v3/klines?symbol=ADAUSDT": [kline("2024-12-31", 0.77)] });
    const db = t.database.db;
    const [ada] = await db
      .insert(assets)
      .values({ assetClass: "crypto", name: "Cardano", symbol: "ADA", priceSource: "coingecko", priceRef: "cardano" })
      .returning();
    // Binance's 0.77 USDT at the ECB rate of 1.10, as stored without a source.
    await db
      .insert(priceHistory)
      .values({ assetId: ada!.id, day: "2024-12-31", close: "0.7", currency: "EUR", closeEur: "0.7" });
    expect(await new HistoryService(db, t.prices.fx, t.fetch).labelClose(ada!, "2024-12-31")).toBe(true);
    expect(await sourceOn(ada!.id, "2024-12-31")).toBe("binance:ADAUSDT");
  });
});

describe("sources of earlier year-end closes", () => {
  it("are looked up by the backfill, for what you held on 31 December", async () => {
    t = await createTestApp({ ...defaultRoutes, "api.bitvavo.com/v2/SOL-EUR/candles": [candle("2024-12-31", 180)] });
    const db = t.database.db;
    const sol = await coin("SOL", "SOL-EUR");
    const acc = json<{ id: number }>(await t.api("POST", "/api/accounts", { name: "Bitvavo", kind: "exchange" })).id;
    await db.insert(transactions).values({
      accountId: acc,
      assetId: sol.id,
      type: "deposit",
      quantity: "2",
      price: "150",
      occurredAt: new Date("2024-06-01T12:00:00Z"),
      source: "api",
    });
    await db
      .insert(priceHistory)
      .values({ assetId: sol.id, day: "2024-12-31", close: "180", currency: "EUR", closeEur: "180" });
    await t.backfill.run();
    expect(await sourceOn(sol.id, "2024-12-31")).toBe("bitvavo:SOL-EUR");
  });
});

describe("the dossier", () => {
  it("says per account how its data got in, and per price where it came from", async () => {
    t = await createTestApp(defaultRoutes);
    const db = t.database.db;
    const account = async (body: object) => json<{ id: number }>(await t!.api("POST", "/api/accounts", body)).id;
    const exchange = await account({ name: "Bitvavo", kind: "exchange" });
    const wallet = await account({ name: "Ledger", kind: "wallet" });
    const bank = await account({ name: "Spaarrekening", kind: "bank", tracking: "yearly" });

    await db.insert(integrations).values({ accountId: exchange, provider: "bitvavo", credentials: "sealed" });
    await db.insert(walletAddresses).values({ accountId: wallet, chain: "cardano", address: "addr1qxyz" });
    const [file] = await db
      .insert(imports)
      .values({ accountId: wallet, fileName: "ledger-2024.csv", rows: 1, inserted: 1 })
      .returning();
    const sol = await coin("SOL", "SOL-EUR");
    const ada = await coin("ADA", "ADA-EUR");
    const tx = (accountId: number, assetId: number, source: "api" | "csv" | "manual", importId?: number) => ({
      accountId,
      assetId,
      type: "deposit" as const,
      quantity: "10",
      price: "1",
      occurredAt: new Date("2024-06-01T12:00:00Z"),
      source,
      importId,
    });
    await db
      .insert(transactions)
      .values([tx(exchange, sol.id, "api"), tx(wallet, ada.id, "csv", file!.id), tx(wallet, ada.id, "manual")]);
    await db.insert(priceHistory).values([
      { assetId: sol.id, day: "2024-12-31", close: "180", currency: "EUR", closeEur: "180", source: "bitvavo:SOL-EUR" },
      { assetId: ada.id, day: "2024-12-30", close: "0.81", currency: "EUR", closeEur: "0.81" },
    ]);
    expect(
      (
        await t.api("PUT", `/api/accounts/${bank}/years`, {
          rows: [{ year: 2025, valueEur: "1000", details: { source: "bank export spaar-2024.csv" } }],
        })
      ).statusCode,
    ).toBe(200);

    const d = json<any>(await t.api("GET", "/api/box3/2025/dossier"));
    const byId = (id: number) => d.accounts.find((a: any) => a.id === id);
    expect(byId(exchange)).toMatchObject({ sync: { provider: "bitvavo" }, entries: { api: 1, csv: 0, manual: 0 } });
    expect(byId(wallet)).toMatchObject({
      wallets: [{ chain: "cardano", address: "addr1qxyz" }],
      imports: [{ fileName: "ledger-2024.csv", inserted: 1 }],
      entries: { csv: 1, manual: 1 },
    });
    expect(byId(bank).yearly).toMatchObject({ source: "bank export spaar-2024.csv" });
    // SOL's close carries its source; ADA's (the last close before 31 December) doesn't, so the
    // dossier names the asset's price feed instead.
    expect(d.prices).toEqual(
      expect.arrayContaining([
        { assetId: sol.id, day: "2024-12-31", source: "bitvavo:SOL-EUR", feed: "bitvavo:SOL-EUR" },
        { assetId: ada.id, day: "2024-12-30", source: null, feed: "bitvavo:ADA-EUR" },
      ]),
    );
    expect(d).toMatchObject({ year: 2025, version: expect.any(String) });
  });
});
