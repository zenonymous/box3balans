import { afterEach, describe, expect, it } from "vitest";
import { assets, priceHistory, transactions } from "../src/db/schema.js";
import { FUTURE_PRESETS, simulateFuture } from "../src/domain/box3Future.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => {
  await t?.close();
  t = undefined as unknown as TestApp; // pure tests below don't open an app
});

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const at = (d: string) => new Date(`${d}T12:00:00Z`);

/**
 * 2024 by hand:
 * - Bank: €10,000 from 2023, €200 interest → return €200.
 * - Broker: 40 fund units bought in 2023 (worth €110 at the end of 2023). In 2024 10 sold at €115
 *   (€3 fee), a €30 dividend (€4.50 tax withheld), the rest worth €120 at the end of 2024:
 *   3,600 − 4,400 + 1,150 + 30 gross = €380. Its cash just receives proceeds: no return.
 * - Exchange: 0.1 BTC bought for €4,000 from outside; 0.001 BTC paid as a network fee when BTC was
 *   €60,000 (not deductible: an outflow of €60); 0.099 BTC left at `btcEnd`.
 * - Pension account (outside box 3): 10 units, +€100. Left out.
 */
async function scenario(btcEnd: number) {
  t = await createTestApp();
  const db = t.database.db;
  const mk = async (name: string, kind: string) => json(await t.api("POST", "/api/accounts", { name, kind }));
  const bank = await mk("Savings", "bank");
  const broker = await mk("Broker", "broker");
  const exchange = await mk("Exchange", "exchange");
  const pension = await mk("Pension", "broker");
  const eur = json<any[]>(await t.api("GET", "/api/assets")).find((a) => a.priceRef === "EUR");
  const [fund, btc] = await db
    .insert(assets)
    .values([
      { assetClass: "etf", name: "Fund", symbol: "FUND", priceSource: "manual", priceRef: "manual:FUND" },
      { assetClass: "crypto", name: "Bitcoin", symbol: "BTC", priceSource: "manual", priceRef: "manual:BTC" },
    ])
    .returning();
  await db.insert(priceHistory).values([
    { assetId: fund!.id, day: "2023-12-31", close: "110", currency: "EUR", closeEur: "110" },
    { assetId: fund!.id, day: "2024-12-31", close: "120", currency: "EUR", closeEur: "120" },
    { assetId: btc!.id, day: "2024-06-01", close: "60000", currency: "EUR", closeEur: "60000" },
    { assetId: btc!.id, day: "2024-12-31", close: String(btcEnd), currency: "EUR", closeEur: String(btcEnd) },
  ]);
  await db.insert(transactions).values([
    {
      accountId: bank.id,
      assetId: eur.id,
      type: "deposit",
      occurredAt: at("2023-03-01"),
      quantity: "10000",
      price: "1",
    },
    {
      accountId: broker.id,
      assetId: eur.id,
      type: "deposit",
      occurredAt: at("2023-03-01"),
      quantity: "5000",
      price: "1",
    },
    {
      accountId: broker.id,
      assetId: fund!.id,
      type: "buy",
      occurredAt: at("2023-03-02"),
      quantity: "40",
      price: "100",
      feeEur: "2",
      settleAssetId: eur.id,
    },
    {
      accountId: pension.id,
      assetId: fund!.id,
      type: "buy",
      occurredAt: at("2023-03-02"),
      quantity: "10",
      price: "100",
    },
    // 2024
    { accountId: bank.id, assetId: eur.id, type: "reward", occurredAt: at("2024-12-31"), quantity: "200", price: "1" },
    {
      accountId: broker.id,
      assetId: fund!.id,
      type: "sell",
      occurredAt: at("2024-05-01"),
      quantity: "10",
      price: "115",
      feeEur: "3",
      settleAssetId: eur.id,
    },
    {
      accountId: broker.id,
      assetId: fund!.id,
      type: "dividend",
      occurredAt: at("2024-07-01"),
      amount: "30",
      taxWithheld: "4.5",
      settleAssetId: eur.id,
    },
    {
      accountId: exchange.id,
      assetId: btc!.id,
      type: "buy",
      occurredAt: at("2024-03-01"),
      quantity: "0.1",
      price: "40000",
    },
    { accountId: exchange.id, assetId: btc!.id, type: "fee", occurredAt: at("2024-06-01"), quantity: "0.001" },
  ]);
  // Pension is outside box 3; €50 interest paid on box 3 debts.
  const { config } = json(await t.api("GET", "/api/box3"));
  config.mapping.accountOverrides[String(pension.id)] = "excluded";
  config.years["2024"] = {
    partner: false,
    debtsEur: "0",
    extraOtherEur: "0",
    extraBankEur: "0",
    debtInterestEur: "50",
  };
  expect((await t.api("PUT", "/api/box3/config", config)).statusCode).toBe(200);
  return config;
}

describe("actual box 3 return (tegenbewijsregeling)", () => {
  it("adds direct and indirect return per category, without deducting costs", async () => {
    await scenario(90_000);
    const y = json(await t.api("GET", "/api/box3/2024")).actualReturn;
    expect(y).toMatchObject({ year: 2024, complete: true, debtInterestEur: 50, dividendTaxEur: 4.5, costsEur: 63 });
    expect(y.parts.bank).toMatchObject({
      startEur: 10998,
      endEur: 12370.5,
      valueChangeEur: 0,
      directEur: 200,
      returnEur: 200,
    });
    expect(y.parts.investments).toMatchObject({
      startEur: 4400,
      endEur: 3600,
      outEur: 1150,
      valueChangeEur: 350,
      directEur: 30,
      returnEur: 380,
    });
    // 8,910 − 0 − 4,000 + 60 (fee units, not deductible).
    expect(y.parts.crypto).toMatchObject({ startEur: 0, endEur: 8910, inEur: 4000, outEur: 60, returnEur: 4970 });
    expect(y.leftOut).toEqual([{ category: "excluded", returnEur: 100 }]);
    // 200 + 380 + 4,970 − 50 interest.
    expect(y.totalEur).toBe(5500);
    // Under the €57,000 allowance the deemed tax is nil: filing makes no sense.
    expect(y.comparison).toMatchObject({ deemedTaxEur: 0, actualTaxEur: 1980, savingEur: 0, worthFiling: false });
  });

  it("says when filing the actual return pays off", async () => {
    const config = await scenario(20_000);
    // An untracked €100,000 of other assets makes the deemed tax bite.
    config.years["2024"].extraOtherEur = "100000";
    await t.api("PUT", "/api/box3/config", config);
    const y = json(await t.api("GET", "/api/box3/2024"));
    const a = y.actualReturn;
    // BTC fell: 1,980 − 4,000 + 60 = −1,960; total 200 + 380 − 1,960 − 50 = −1,430 → taxed as €0.
    expect(a.parts.crypto.returnEur).toBe(-1960);
    expect(a.totalEur).toBe(-1430);
    expect(a.comparison.actualTaxEur).toBe(0);
    expect(a.comparison.deemedTaxEur).toBe(Number(y.calculation.netTaxEur));
    expect(a.comparison.deemedTaxEur).toBeGreaterThan(0);
    expect(a.comparison).toMatchObject({ worthFiling: true, savingEur: a.comparison.deemedTaxEur });
  });
});

describe("2028 system preview", () => {
  const year = (
    y: number,
    actualReturnEur: number,
    extra: Partial<Parameters<typeof simulateFuture>[0][number]> = {},
  ) => ({
    year: y,
    complete: true,
    actualReturnEur,
    costsEur: 0,
    partner: false,
    deemedTaxEur: null,
    ...extra,
  });

  it("carries losses forward under the bill as passed", () => {
    const rows = simulateFuture([year(2024, 10_000), year(2025, -3_000), year(2026, 5_000)], FUTURE_PRESETS.bill!);
    expect(rows.map((r) => [r.year, r.taxableEur, r.taxEur, r.lossBalanceEur])).toEqual([
      [2024, 8200, 2952, 0],
      [2025, 0, 0, 3000],
      // 5,000 − 1,800 = 3,200, of which 3,000 is set off.
      [2026, 200, 72, 0],
    ]);
  });

  it("carries a loss back one year with the novelle preset", () => {
    const rows = simulateFuture([year(2024, 10_000), year(2025, -3_000), year(2026, 5_000)], FUTURE_PRESETS.novelle!);
    expect(rows.map((r) => [r.year, r.taxableEur, r.taxEur, r.carriedBackEur, r.lossBalanceEur])).toEqual([
      [2024, 5100, 1836, 3000, 0],
      [2025, 0, 0, 0, 0],
      [2026, 3100, 1116, 0, 0],
    ]);
  });

  it("ignores small losses, deducts costs, doubles the allowance for partners and compares", () => {
    const rows = simulateFuture(
      [year(2024, -400), year(2025, 5_000, { costsEur: 200, partner: true, deemedTaxEur: 1000 })],
      FUTURE_PRESETS.bill!,
    );
    expect(rows[0]).toMatchObject({ resultEur: -400, lossBalanceEur: 0 });
    // 5,000 − 200 costs − 3,600 allowance = 1,200 → €432, €568 less than the deemed €1,000.
    expect(rows[1]).toMatchObject({
      resultEur: 4800,
      allowanceEur: 3600,
      taxableEur: 1200,
      taxEur: 432,
      differenceEur: -568,
    });
  });

  it("serves the preview with overridable parameters", async () => {
    await scenario(90_000);
    const r = json(await t.api("GET", "/api/box3/future?preset=novelle&ratePct=35"));
    expect(r.params).toEqual({ ratePct: 35, allowanceEur: 1900, lossThresholdEur: 500, carryBackYears: 1 });
    expect(r.presets.map((p: any) => p.id)).toEqual(["bill", "novelle"]);
    const y2024 = r.rows.find((x: any) => x.year === 2024);
    // 5,500 actual − 63 deductible costs − 1,900 = 3,537 at 35%.
    expect(y2024).toMatchObject({ resultEur: 5437, taxableEur: 3537, taxEur: 1237.95 });
    expect((await t.api("GET", "/api/box3/future?preset=nonsense")).statusCode).toBe(400);
  });
});
