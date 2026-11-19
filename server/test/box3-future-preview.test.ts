import { afterEach, describe, expect, it } from "vitest";
import { accountYears, assets, priceHistory, transactions } from "../src/db/schema.js";
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

describe("what the preview can't count when sold", () => {
  // No shares, bonds or funds at all: there's nothing to sell, so the capital gain is left empty
  // rather than shown as €0 (a year with a fund and no sale shows 0, above).
  it("leaves the capital gain empty in a year with nothing that's taxed when sold", async () => {
    t = await createTestApp();
    const db = t.database.db;
    const exchange = json(await t.api("POST", "/api/accounts", { name: "Exchange", kind: "exchange" }));
    const [btc] = await db
      .insert(assets)
      .values({ assetClass: "crypto", name: "Bitcoin", symbol: "BTC", priceSource: "manual", priceRef: "manual:BTC" })
      .returning();
    await db.insert(priceHistory).values([
      { assetId: btc!.id, day: "2024-03-01", close: "30000", currency: "EUR", closeEur: "30000" },
      { assetId: btc!.id, day: "2024-12-31", close: "40000", currency: "EUR", closeEur: "40000" },
    ]);
    await db.insert(transactions).values({
      accountId: exchange.id,
      assetId: btc!.id,
      type: "buy",
      occurredAt: noon("2024-03-01"),
      quantity: "1",
      price: "30000",
    });
    const r = json(await t.api("GET", "/api/box3/future?preset=bill"));
    expect(r.rows.find((x: { year: number }) => x.year === 2024)).toMatchObject({
      resultEur: 10_000,
      capitalGainEur: null,
    });
  });

  // An investment account kept as values per year has no sales to work out a gain from: it stays
  // on its yearly change in value, and the preview says so.
  it("says an investment account kept as values per year stays on its yearly change", async () => {
    await fundAtBroker();
    const db = t!.database.db;
    const pension = json(
      await t!.api("POST", "/api/accounts", { name: "Lijfrente-beleggen", kind: "broker", tracking: "yearly" }),
    );
    await db.insert(accountYears).values([
      { accountId: pension.id, year: 2025, valueEur: "10000" },
      { accountId: pension.id, year: 2026, valueEur: "11000" },
    ]);
    // A bank account kept that way is no investment: no warning for it.
    const bank = json(await t!.api("POST", "/api/accounts", { name: "Sparen", kind: "bank", tracking: "yearly" }));
    await db.insert(accountYears).values({ accountId: bank.id, year: 2025, valueEur: "5000" });
    const r = json(await t!.api("GET", "/api/box3/future?preset=bill"));
    expect(r.warnings).toEqual([
      "Lijfrente-beleggen is kept as values per year, so its sales aren't known: it counts with its yearly change in value.",
    ]);
  });
});

// ADR 0013: a joint account is split by each partner's share into each partner's own average. You own
// 60% of a joint broker account and have one of your own. All bought in 2024, the first year shown:
//   own account: 4 at 100. Joint: 10 at 100 in March, 10 at 200 in September; 10 sold at 180 in 2025.
//   You: 4 + 6 at 100 and 6 at 200: 16 for 2,200 (137.50 each). 6 sold: 1,080 − 825 = 255.
//   Partner: 4 at 100 and 4 at 200: 8 for 1,200 (150 each). 4 sold: 720 − 600 = 120.
// Together 375. One average for the household would give 24 units for 4,400 and a loss on the sale.
// The fund is worth 200 at both year ends, so nothing else changes: the result is the gain.
async function household(partnerIn2024: boolean, partnerIn2025: boolean) {
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
    { assetId: fund!.id, day: "2024-06-03", close: "120", currency: "EUR", closeEur: "120" },
    { assetId: fund!.id, day: "2024-12-31", close: "200", currency: "EUR", closeEur: "200" },
    { assetId: fund!.id, day: "2025-12-31", close: "200", currency: "EUR", closeEur: "200" },
  ]);
  const { config } = json(await t.api("GET", "/api/box3"));
  const situation = { debtsEur: "0", extraOtherEur: "0", extraBankEur: "0", debtInterestEur: "0", extraReturnEur: "0" };
  config.years["2024"] = { ...situation, partner: partnerIn2024, allocationSelfPct: "50" };
  config.years["2025"] = { ...situation, partner: partnerIn2025, allocationSelfPct: "50" };
  expect((await t.api("PUT", "/api/box3/config", config)).statusCode).toBe(200);
  const tx = (accountId: number, type: "buy" | "sell", day: string, quantity: string, price: string) => ({
    accountId,
    assetId: fund!.id,
    type,
    occurredAt: noon(day),
    quantity,
    price,
  });
  return { db, own, joint, fund: fund!, tx };
}
const preview = async () => json(await t!.api("GET", "/api/box3/future?preset=bill"));
const rowOf = (r: { rows: { year: number }[] }, year: number) => r.rows.find((x) => x.year === year);

describe("a joint account in the preview's tax on investments", () => {
  it("gives each partner their own average", async () => {
    const { db, own, joint, tx } = await household(true, true);
    await db
      .insert(transactions)
      .values([
        tx(own.id, "buy", "2024-03-01", "4", "100"),
        tx(joint.id, "buy", "2024-03-01", "10", "100"),
        tx(joint.id, "buy", "2024-09-02", "10", "200"),
        tx(joint.id, "sell", "2025-06-02", "10", "180"),
      ]);
    expect(rowOf(await preview(), 2025)).toMatchObject({ capitalGainEur: 375, resultEur: 375 });
  });

  // No fiscal partner in 2024, one in 2025. In 2024 only your 60% of the joint account counts, in the
  // yearly return and in the gain alike. The joint account buys 10 at 100 and sells 5 at 150 in 2024:
  // yours are 6 at 100 = 600, and 3 of them sold: 450 − 300 = 150. Your partner's 2 sold don't count.
  it("counts only your share in a year without a fiscal partner", async () => {
    const { db, joint, tx } = await household(false, true);
    await db
      .insert(transactions)
      .values([tx(joint.id, "buy", "2024-03-01", "10", "100"), tx(joint.id, "sell", "2024-11-04", "5", "150")]);
    expect(rowOf(await preview(), 2024)).toMatchObject({ capitalGainEur: 150, resultEur: 150 });
  });

  // You move 10 units from your own account into the joint one on 3 June 2024, when they're worth
  // 120. Of those, 4 become your partner's: they leave your average (no gain) and come into theirs at
  // their value that day. In 2025 the joint account sells all 10 at 150:
  //   You: 10 at 100 = 1,000, 4 handed over leave 6 at 600; 6 sold: 900 − 600 = 300.
  //   Partner: 4 at 120 = 480; 4 sold: 600 − 480 = 120. Together 420.
  it("moves units between partners when they go into a joint account", async () => {
    const { db, own, joint, fund, tx } = await household(true, true);
    await db
      .insert(priceHistory)
      .values({ assetId: fund.id, day: "2025-06-02", close: "150", currency: "EUR", closeEur: "150" });
    const leg = { assetId: fund.id, occurredAt: noon("2024-06-03"), quantity: "10", transferGroup: "move-1" };
    await db
      .insert(transactions)
      .values([
        tx(own.id, "buy", "2024-03-01", "10", "100"),
        { ...leg, accountId: own.id, type: "transfer_out" as const },
        { ...leg, accountId: joint.id, type: "transfer_in" as const },
        tx(joint.id, "sell", "2025-06-02", "10", "150"),
      ]);
    const r = await preview();
    expect(rowOf(r, 2025)).toMatchObject({ capitalGainEur: 420 });
    expect(r.warnings).toEqual([]);
  });
});
