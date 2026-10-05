import { afterEach, describe, expect, it } from "vitest";
import { assets, priceHistory, transactions } from "../src/db/schema.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

describe("cost overview", () => {
  it("adds up every kind of cost per year and per account", async () => {
    t = await createTestApp();
    const db = t.database.db;
    const mk = async (name: string, kind: string) => json(await t.api("POST", "/api/accounts", { name, kind }));
    const broker = await mk("Broker", "broker");
    const wallet = await mk("Ledger", "wallet");
    const vault = await mk("Goldrepublic", "vault");
    const safe = await mk("Home safe", "physical");
    const list = json<any[]>(await t.api("GET", "/api/assets"));
    const eur = list.find((a) => a.priceRef === "EUR");
    const gold = list.find((a) => a.priceRef === "XAU");
    const [fund, eth] = await db
      .insert(assets)
      .values([
        {
          assetClass: "etf",
          name: "World fund",
          symbol: "WRLD",
          priceSource: "manual",
          priceRef: "manual:WRLD",
          terPct: "0.2",
        },
        { assetClass: "crypto", name: "Ether", symbol: "ETH", priceSource: "manual", priceRef: "manual:ETH" },
      ])
      .returning();
    // A full year at €1000 (closes for every day), so the fund's running costs are €2.
    const days: { assetId: number; day: string; close: string; currency: string; closeEur: string }[] = [];
    for (let d = Date.parse("2024-01-01"); d <= Date.parse("2024-12-31"); d += 86_400_000) {
      const day = new Date(d).toISOString().slice(0, 10);
      days.push({ assetId: fund!.id, day, close: "100", currency: "EUR", closeEur: "100" });
    }
    await db.insert(priceHistory).values(days);
    const at = (d: string) => new Date(`${d}T12:00:00Z`);
    await db.insert(transactions).values([
      // Fund bought (€1 fee), sold out on 31 Dec so it's held exactly the year.
      {
        accountId: broker.id,
        assetId: fund!.id,
        type: "buy",
        occurredAt: at("2024-01-01"),
        quantity: "10",
        price: "100",
        feeEur: "1",
      },
      {
        accountId: broker.id,
        assetId: fund!.id,
        type: "sell",
        occurredAt: at("2025-01-01"),
        quantity: "10",
        price: "100",
        feeEur: "1.5",
      },
      // €2.50 connection fee paid from cash.
      {
        accountId: broker.id,
        assetId: eur.id,
        type: "deposit",
        occurredAt: at("2024-01-01"),
        quantity: "100",
        price: "1",
      },
      { accountId: broker.id, assetId: eur.id, type: "fee", occurredAt: at("2024-06-01"), quantity: "2.5" },
      // Dividend with €3 withheld.
      {
        accountId: broker.id,
        assetId: fund!.id,
        type: "dividend",
        occurredAt: at("2024-07-01"),
        amount: "20",
        taxWithheld: "3",
      },
      // Gas: 0.01 ETH that cost €20.
      {
        accountId: wallet.id,
        assetId: eth!.id,
        type: "buy",
        occurredAt: at("2024-02-01"),
        quantity: "1",
        price: "2000",
      },
      { accountId: wallet.id, assetId: eth!.id, type: "fee", occurredAt: at("2024-03-01"), quantity: "0.01" },
      // Vault storage: 0.1 g of gold that cost €6.
      { accountId: vault.id, assetId: gold.id, type: "buy", occurredAt: at("2024-01-15"), quantity: "10", price: "60" },
      { accountId: vault.id, assetId: gold.id, type: "fee", occurredAt: at("2024-12-01"), quantity: "0.1" },
    ]);
    // A coin bought for €2000 that held €1900 of gold at spot: €100 premium.
    await t.api("POST", "/api/metals/items", {
      accountId: safe.id,
      metal: "gold",
      product: "Krugerrand 1 oz",
      grossWeightG: "33.93",
      purity: "0.9167",
      quantity: 1,
      purchaseDate: "2024-05-01",
      purchasePriceEur: "2000",
      spotValueAtPurchaseEur: "1900",
    });

    const c = json(await t.api("GET", "/api/costs"));
    const y2024 = c.years.find((y: any) => y.year === 2024);
    expect(y2024).toMatchObject({
      trading: 1,
      account: 2.5,
      withholding: 3,
      network: 20,
      storage: 6,
      premiums: 100,
    });
    expect(y2024.funds).toBeCloseTo(2, 1);
    expect(y2024.total).toBeCloseTo(134.5, 1);
    expect(y2024.pctOfValue).toBeGreaterThan(0);
    expect(c.years.find((y: any) => y.year === 2025)).toMatchObject({ trading: 1.5 });

    const lines = c.lines.filter((l: any) => l.year === 2024);
    expect(lines.find((l: any) => l.category === "network")).toMatchObject({
      accountName: "Ledger",
      symbol: "ETH",
      eur: 20,
    });
    expect(lines.find((l: any) => l.category === "storage")).toMatchObject({
      accountName: "Goldrepublic",
      symbol: "XAU",
    });
    expect(lines.find((l: any) => l.category === "funds")).toMatchObject({ symbol: "WRLD" });
    expect(c.fundsWithoutTer).toEqual([]);
  });

  it("lists funds without running costs, and lets you enter them", async () => {
    t = await createTestApp();
    const broker = json(await t.api("POST", "/api/accounts", { name: "Broker", kind: "broker" }));
    const [fund] = await t.database.db
      .insert(assets)
      .values({ assetClass: "etf", name: "World fund", symbol: "WRLD", priceSource: "manual", priceRef: "manual:WRLD" })
      .returning();
    await t.api("POST", "/api/transactions", {
      accountId: broker.id,
      assetId: fund!.id,
      type: "buy",
      occurredAt: "2024-01-02T12:00:00Z",
      quantity: "1",
      price: "100",
    });
    expect(json(await t.api("GET", "/api/costs")).fundsWithoutTer).toEqual([
      { assetId: fund!.id, symbol: "WRLD", name: "World fund" },
    ]);
    expect((await t.api("PUT", `/api/assets/${fund!.id}`, { terPct: "0,22" })).statusCode).toBe(200);
    expect(json<any[]>(await t.api("GET", "/api/assets")).find((a) => a.id === fund!.id).terPct).toBe("0.2200");
    expect(json(await t.api("GET", "/api/costs")).fundsWithoutTer).toEqual([]);
    expect((await t.api("PUT", `/api/assets/${fund!.id}`, { terPct: "12" })).statusCode).toBe(400);
    expect((await t.api("PUT", `/api/assets/${fund!.id}`, { terPct: "" })).statusCode).toBe(200);
  });
});
