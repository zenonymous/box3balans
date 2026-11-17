import { afterEach, describe, expect, it } from "vitest";
import { assets, priceHistory, transactions } from "../src/db/schema.js";
import { createTestApp, noon, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

/**
 * The preview from 2029 through the API, with a fund at a broker: taxed on its gain when sold (the
 * novelle), not on its yearly change in value. The preview starts in the first year shown (2024).
 * Worked by hand:
 * - 2024: 1,000 units bought at 100 with 5 costs: 100,005 together. Worth 120 at the end: the
 *   change in value (20,000) doesn't count, and the 5 costs are inside the acquisition price. Result 0.
 * - 2025: 400 sold at 140 with 4 costs: 56,000 − 4 − 40% of 100,005 (40,002) = 15,994 gain. A
 *   dividend of 3,000 with 450 withheld counts gross: 3,000. Result 18,994; 18,994 − 1,800 = 17,194
 *   taxable at 35.5% = 6,103.87. Under the bill without the novelle the result would be the value
 *   change (90,000 − 120,000 + 56,000 = 26,000) plus 3,000, minus the 4 costs: 28,996.
 */
async function fundAtBroker() {
  t = await createTestApp();
  const db = t.database.db;
  const broker = json(await t.api("POST", "/api/accounts", { name: "Broker", kind: "broker" }));
  const [fund] = await db
    .insert(assets)
    .values({ assetClass: "etf", name: "Fund", symbol: "FUND", priceSource: "manual", priceRef: "manual:FUND" })
    .returning();
  await db.insert(priceHistory).values([
    { assetId: fund!.id, day: "2024-03-01", close: "100", currency: "EUR", closeEur: "100" },
    { assetId: fund!.id, day: "2024-12-31", close: "120", currency: "EUR", closeEur: "120" },
    { assetId: fund!.id, day: "2025-12-31", close: "150", currency: "EUR", closeEur: "150" },
  ]);
  const tx = { accountId: broker.id, assetId: fund!.id };
  await db.insert(transactions).values([
    { ...tx, type: "buy", occurredAt: noon("2024-03-01"), quantity: "1000", price: "100", feeEur: "5" },
    { ...tx, type: "sell", occurredAt: noon("2025-06-02"), quantity: "400", price: "140", feeEur: "4" },
    { ...tx, type: "dividend", occurredAt: noon("2025-07-01"), amount: "3000", taxWithheld: "450" },
  ]);
}

describe("the preview from 2029 with tax on investments when sold", () => {
  it("taxes the fund on its gain when sold and its dividend, not its change in value", async () => {
    await fundAtBroker();
    const r = json(await t!.api("GET", "/api/box3/future?preset=bill"));
    const row = (year: number) => r.rows.find((x: { year: number }) => x.year === year);
    expect(row(2024)).toMatchObject({ resultEur: 0, capitalGainEur: 0, taxEur: 0 });
    expect(row(2025)).toMatchObject({ resultEur: 18_994, capitalGainEur: 15_994, taxableEur: 17_194, taxEur: 6103.87 });
    expect(r.warnings).toEqual([]);
  });

  // Coins on an exchange aren't financial instruments: they stay on their yearly change in value in
  // 2029. 1 BTC bought at 30,000, worth 40,000 at the end of 2024 and 50,000 at the end of 2025:
  // 10,000 each year on top of the fund's figures above. 2024: 10,000 − 1,800 = 8,200 at 35.5% =
  // 2,911. 2025: 28,994 − 1,800 = 27,194 at 35.5% = 9,653.87.
  it("keeps coins on an exchange on their yearly change in value", async () => {
    await fundAtBroker();
    const db = t!.database.db;
    const exchange = json(await t!.api("POST", "/api/accounts", { name: "Exchange", kind: "exchange" }));
    const [btc] = await db
      .insert(assets)
      .values({ assetClass: "crypto", name: "Bitcoin", symbol: "BTC", priceSource: "manual", priceRef: "manual:BTC" })
      .returning();
    await db.insert(priceHistory).values([
      { assetId: btc!.id, day: "2024-03-01", close: "30000", currency: "EUR", closeEur: "30000" },
      { assetId: btc!.id, day: "2024-12-31", close: "40000", currency: "EUR", closeEur: "40000" },
      { assetId: btc!.id, day: "2025-12-31", close: "50000", currency: "EUR", closeEur: "50000" },
    ]);
    await db.insert(transactions).values({
      accountId: exchange.id,
      assetId: btc!.id,
      type: "buy",
      occurredAt: noon("2024-03-01"),
      quantity: "1",
      price: "30000",
    });
    const r = json(await t!.api("GET", "/api/box3/future?preset=bill"));
    const row = (year: number) => r.rows.find((x: { year: number }) => x.year === year);
    expect(row(2024)).toMatchObject({ resultEur: 10_000, capitalGainEur: 0, taxEur: 2911 });
    expect(row(2025)).toMatchObject({ resultEur: 28_994, capitalGainEur: 15_994, taxEur: 9653.87 });
  });
});

// ADR 0013: a joint account is split by each partner's share into each partner's own average. You own
// 60% of a joint broker account and have one of your own. All bought in 2024, the first year shown:
//   own account: 4 at 100. Joint: 10 at 100 in March, 10 at 200 in September; 10 sold at 180 in 2025.
//   You: 4 + 6 at 100 and 6 at 200: 16 for 2,200 (137.50 each). 6 sold: 1,080 − 825 = 255.
//   Partner: 4 at 100 and 4 at 200: 8 for 1,200 (150 each). 4 sold: 720 − 600 = 120.
// Together 375. One average for the household would give 24 units for 4,400 and a loss on the sale.
// The fiscal partner is set for 2024 and 2025 only; the years after have no setting yet and follow 2025.
describe("a joint account in the preview's tax on investments", () => {
  it("gives each partner their own average", async () => {
    t = await createTestApp();
    const db = t.database.db;
    await t.api("POST", "/api/household", { name: "Me", role: "self" });
    await t.api("POST", "/api/household", { name: "Sam", role: "partner" });
    const own = json(await t.api("POST", "/api/accounts", { name: "Broker", kind: "broker" }));
    const joint = json(
      await t.api("POST", "/api/accounts", { name: "Joint", kind: "broker", owner: "joint", jointSelfPct: 60 }),
    );
    const [fund] = await db
      .insert(assets)
      .values({ assetClass: "etf", name: "Fund", symbol: "FUND", priceSource: "manual", priceRef: "manual:FUND" })
      .returning();
    await db.insert(priceHistory).values([
      { assetId: fund!.id, day: "2024-12-31", close: "200", currency: "EUR", closeEur: "200" },
      { assetId: fund!.id, day: "2025-12-31", close: "200", currency: "EUR", closeEur: "200" },
    ]);
    const tx = (accountId: number, type: "buy" | "sell", day: string, quantity: string, price: string) => ({
      accountId,
      assetId: fund!.id,
      type,
      occurredAt: noon(day),
      quantity,
      price,
    });
    await db
      .insert(transactions)
      .values([
        tx(own.id, "buy", "2024-03-01", "4", "100"),
        tx(joint.id, "buy", "2024-03-01", "10", "100"),
        tx(joint.id, "buy", "2024-09-02", "10", "200"),
        tx(joint.id, "sell", "2025-06-02", "10", "180"),
      ]);
    const { config } = json(await t.api("GET", "/api/box3"));
    const situation = {
      debtsEur: "0",
      extraOtherEur: "0",
      extraBankEur: "0",
      debtInterestEur: "0",
      extraReturnEur: "0",
    };
    config.years["2024"] = { ...situation, partner: true, allocationSelfPct: "50" };
    config.years["2025"] = { ...situation, partner: true, allocationSelfPct: "50" };
    expect((await t.api("PUT", "/api/box3/config", config)).statusCode).toBe(200);
    const r = json(await t.api("GET", "/api/box3/future?preset=bill"));
    expect(r.rows.find((x: { year: number }) => x.year === 2025)).toMatchObject({ capitalGainEur: 375 });
  });
});
