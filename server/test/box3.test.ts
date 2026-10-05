import { afterEach, describe, expect, it } from "vitest";
import { priceHistory } from "../src/db/schema.js";
import { DEFAULT_RATES, calculateBox3 } from "../src/domain/box3.js";
import { D } from "../src/lib/decimal.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

describe("box 3 calculation (official steps)", () => {
  // Expected figures computed independently (Python, Decimal) from the Belastingdienst steps.
  it("matches a worked 2024 example for a single person", () => {
    const c = calculateBox3(
      { bank: D(50_000), other: D(100_000), debts: D(10_000), partner: false },
      DEFAULT_RATES["2024"]!,
    );
    expect(c).toMatchObject({
      deductibleDebtsEur: "6300.00", // 10,000 − 3,700 threshold
      deemedReturnEur: "6595.57", // 720 + 6,040 − 164.43
      baseEur: "143700.00",
      allowanceEur: "57000.00",
      taxableBaseEur: "86700.00",
      sharePct: "60.33",
      benefitEur: "3979.37",
      taxEur: "1432.57",
    });
  });

  it("doubles the allowance and debt threshold for fiscal partners", () => {
    const c = calculateBox3(
      { bank: D(50_000), other: D(100_000), debts: D(10_000), partner: true },
      DEFAULT_RATES["2024"]!,
    );
    expect(c).toMatchObject({
      deductibleDebtsEur: "2600.00",
      allowanceEur: "114000.00",
      taxableBaseEur: "33400.00",
      benefitEur: "1516.40",
      taxEur: "545.90",
    });
  });

  it("owes nothing below the tax-free allowance", () => {
    const c = calculateBox3({ bank: D(20_000), other: D(30_000), debts: D(0), partner: false }, DEFAULT_RATES["2025"]!);
    expect(c.taxableBaseEur).toBe("0.00");
    expect(c.taxEur).toBe("0.00");
  });

  // Review fix: green investments used to be fully exempt without the yearly cap.
  it("caps the green investment exemption and applies the green tax credit", () => {
    const c = calculateBox3(
      { bank: D(0), other: D(50_000), green: D(100_000), debts: D(0), partner: false },
      DEFAULT_RATES["2024"]!,
    );
    expect(c).toMatchObject({
      greenExemptEur: "71251.00",
      greenAboveLimitEur: "28749.00", // taxed as other assets
      otherEur: "78749.00",
      taxableBaseEur: "21749.00",
      benefitEur: "1313.64",
      taxEur: "472.91",
      greenCreditEur: "498.76", // 0.7% of the exempt part
      netTaxEur: "0.00", // the credit can't make box 3 negative here
    });
    // Partners get twice the limit.
    expect(
      calculateBox3({ bank: D(0), other: D(0), green: D(100_000), debts: D(0), partner: true }, DEFAULT_RATES["2024"]!)
        .greenAboveLimitEur,
    ).toBe("0.00");
  });

  it("ships the official 2023–2026 figures", () => {
    expect(DEFAULT_RATES["2023"]).toMatchObject({
      bankPct: "0.92",
      otherPct: "6.17",
      debtPct: "2.46",
      allowanceEur: "57000",
      debtThresholdEur: "3400",
      taxRatePct: "32",
    });
    expect(DEFAULT_RATES["2026"]).toMatchObject({
      allowanceEur: "59357",
      greenExemptEur: "26715",
      greenCreditPct: "0.1",
      final: false,
    });
    expect(DEFAULT_RATES["2025"]).toMatchObject({ greenExemptEur: "26312" });
  });
});

describe("box 3 overview", () => {
  async function scenario() {
    t = await createTestApp();
    const mk = async (name: string, kind: string) => json(await t.api("POST", "/api/accounts", { name, kind }));
    const bank = await mk("ING savings", "bank");
    const broker = await mk("DEGIRO", "broker");
    const exchange = await mk("Bitvavo", "exchange");
    const safe = await mk("Home safe", "physical");
    const pension = await mk("Pension (box 1)", "broker");
    const assets = json<any[]>(await t.api("GET", "/api/assets"));
    const eur = assets.find((a) => a.priceRef === "EUR");
    const gold = assets.find((a) => a.priceRef === "XAU");
    const etf = json(
      await t.api("POST", "/api/assets", {
        assetClass: "etf",
        name: "World ETF",
        symbol: "WRLD",
        priceSource: "manual",
        currency: "EUR",
      }),
    );
    const btc = json(
      await t.api("POST", "/api/assets", {
        assetClass: "crypto",
        name: "Bitcoin",
        symbol: "BTC",
        priceSource: "coingecko",
        priceRef: "bitcoin",
      }),
    );
    const tx = (accountId: number, body: object) => t.api("POST", "/api/transactions", { accountId, ...body });
    await tx(bank.id, {
      assetId: eur.id,
      type: "deposit",
      occurredAt: "2024-06-01T12:00:00Z",
      quantity: "60000",
      price: "1",
    });
    await tx(broker.id, {
      assetId: eur.id,
      type: "deposit",
      occurredAt: "2024-06-01T12:00:00Z",
      quantity: "1000",
      price: "1",
    });
    await tx(exchange.id, {
      assetId: eur.id,
      type: "deposit",
      occurredAt: "2024-06-01T12:00:00Z",
      quantity: "500",
      price: "1",
    });
    await tx(broker.id, {
      assetId: etf.id,
      type: "buy",
      occurredAt: "2024-07-01T12:00:00Z",
      quantity: "100",
      price: "80",
    });
    await tx(pension.id, {
      assetId: etf.id,
      type: "buy",
      occurredAt: "2024-07-01T12:00:00Z",
      quantity: "50",
      price: "80",
    });
    await tx(exchange.id, {
      assetId: btc.id,
      type: "buy",
      occurredAt: "2024-08-01T12:00:00Z",
      quantity: "0.5",
      price: "50000",
    });
    // Bought in 2025: not part of the 1 January 2025 position.
    await tx(exchange.id, {
      assetId: btc.id,
      type: "buy",
      occurredAt: "2025-01-01T12:00:00Z",
      quantity: "1",
      price: "90000",
    });
    // Review fix: 00:30 on 1 January in Amsterdam is 23:30 UTC on 31 December; it's still 2025,
    // so it must not count toward the 1 January 2025 position either.
    await tx(exchange.id, {
      assetId: btc.id,
      type: "buy",
      occurredAt: "2024-12-31T23:30:00Z",
      quantity: "2",
      price: "90000",
    });
    await t.api("POST", "/api/metals/items", {
      accountId: safe.id,
      metal: "gold",
      product: "1 oz bar",
      grossWeightG: "31.1",
      purity: "1",
      quantity: 1,
      purchaseDate: "2024-03-01",
      purchasePriceEur: "2000",
    });
    // Closes around the peildatum; BTC has no close on 31 Dec, so 30 Dec is used.
    await t.database.db.insert(priceHistory).values([
      { assetId: etf.id, day: "2024-12-31", close: "90", currency: "EUR", closeEur: "90" },
      { assetId: btc.id, day: "2024-12-30", close: "90000", currency: "EUR", closeEur: "90000" },
      { assetId: btc.id, day: "2025-01-02", close: "95000", currency: "EUR", closeEur: "95000" },
      { assetId: gold.id, day: "2024-12-31", close: "80", currency: "USD", closeEur: "80" },
    ]);
    return { pension };
  }

  it("values holdings on 1 January, maps categories and estimates the tax", async () => {
    const { pension } = await scenario();
    const overview = json(await t.api("GET", "/api/box3"));
    expect(overview.years[0]).toBe(new Date().getUTCFullYear());
    expect(overview.years.at(-1)).toBe(2025);

    // Pension account is box 1: exclude it; add €5,000 of debts the app doesn't track.
    const config = overview.config;
    config.mapping.accountOverrides[String(pension.id)] = "excluded";
    config.years["2025"] = { partner: false, debtsEur: "5000", extraOtherEur: "0", extraBankEur: "0" };
    const saved = await t.api("PUT", "/api/box3/config", config);
    expect(saved.statusCode).toBe(200);

    const y = json(await t.api("GET", "/api/box3/2025"));
    expect(y.valuedAt).toBe("2024-12-31");
    // Bank: savings €60,000 + broker cash €1,000. Exchange cash counts as "other".
    expect(y.totals).toEqual({ bank: "61000.00", other: "56988.00", exempt: "0.00", excluded: "4500.00" });
    expect(y.otherBreakdown).toEqual({
      investments: "9000.00",
      crypto: "45000.00",
      metals: "2488.00",
      cash: "500.00",
      other: "0.00",
    });
    expect(y.rows.find((r: any) => r.symbol === "BTC")).toMatchObject({
      quantity: "0.5",
      priceDay: "2024-12-30",
      valueEur: "45000.00",
    });
    expect(y.rows.find((r: any) => r.physical)).toMatchObject({
      accountName: "Home safe",
      valueEur: "2488.00",
      category: "other",
    });
    // Independently computed with the 2025 rates.
    expect(y.calculation).toMatchObject({
      deductibleDebtsEur: "1200.00",
      deemedReturnEur: "4154.19",
      taxableBaseEur: "59104.00",
      benefitEur: "2102.35",
      taxEur: "756.85",
    });
    expect(y.rates).toMatchObject({ source: "default", final: true });
  });

  it("uses custom rates when set, and rejects invalid config", async () => {
    await scenario();
    const { config } = json(await t.api("GET", "/api/box3"));
    config.rates["2025"] = { ...DEFAULT_RATES["2025"], taxRatePct: "0" };
    await t.api("PUT", "/api/box3/config", config);
    const y = json(await t.api("GET", "/api/box3/2025"));
    expect(y.rates.source).toBe("custom");
    expect(y.calculation.taxEur).toBe("0.00");

    config.mapping.classCategory.crypto = "nonsense";
    expect((await t.api("PUT", "/api/box3/config", config)).statusCode).toBe(400);
    expect((await t.api("GET", `/api/box3/${new Date().getUTCFullYear() + 1}`)).statusCode).toBe(400);
  });
});
