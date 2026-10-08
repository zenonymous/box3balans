import { afterEach, describe, expect, it } from "vitest";
import { priceHistory } from "../src/db/schema.js";
import { DEFAULT_RATES, calculateBox3 } from "../src/domain/box3.js";
import { D } from "../src/lib/decimal.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

describe("box 3 calculation (official steps)", () => {
  // Rounded as the Belastingdienst does: deemed returns, benefit and tax down to whole euros, the
  // share down to two decimals of a percent.
  it("matches a worked 2024 example for a single person", () => {
    const c = calculateBox3(
      { bank: D(50_000), other: D(100_000), debts: D(10_000), partner: false },
      DEFAULT_RATES["2024"]!,
    );
    expect(c).toMatchObject({
      deductibleDebtsEur: "6300.00", // 10,000 − 3,700 threshold
      deemedReturnEur: "6596.00", // 720 + 6,040 − 164 (164.43 to the nearest euro)
      baseEur: "143700.00",
      allowanceEur: "57000.00",
      taxableBaseEur: "86700.00",
      sharePct: "60.33", // 86,700 / 143,700 = 60.334 %
      benefitEur: "3979.00", // 6,596 × 60.33 % = 3,979.37
      taxEur: "1432.00", // 36 % = 1,432.44
    });
  });

  it("doubles the allowance and debt threshold for fiscal partners", () => {
    const c = calculateBox3(
      { bank: D(50_000), other: D(100_000), debts: D(10_000), partner: true },
      DEFAULT_RATES["2024"]!,
    );
    expect(c).toMatchObject({
      deductibleDebtsEur: "2600.00",
      deemedReturnEur: "6692.00", // 720 + 6,040 − 68 (67.86 to the nearest euro)
      allowanceEur: "114000.00",
      taxableBaseEur: "33400.00",
      // Each partner: 16,700 / 147,400 = 11.32 %; 6,692 × 11.32 % = 757.53 → 757; tax 272.
      benefitEur: "1514.00",
      taxEur: "544.00",
    });
  });

  // The worked examples on belastingdienst.nl, "Hoe wordt mijn box 3-inkomen over 2025 berekend?"
  // (checked 2026-10-07). Each line is the outcome the Belastingdienst gives.
  describe("Belastingdienst examples 2025", () => {
    const r = DEFAULT_RATES["2025"]!;
    it("1: savings only, no fiscal partner", () => {
      const c = calculateBox3({ bank: D(150_000), other: D(0), debts: D(0), partner: false }, r);
      expect(c).toMatchObject({ deemedReturnEur: "2055.00", baseEur: "150000.00", taxableBaseEur: "92316.00" });
      expect(c).toMatchObject({ sharePct: "61.54", benefitEur: "1264.00", taxEur: "455.00" });
    });
    it("2: savings, with a fiscal partner (half each)", () => {
      const c = calculateBox3({ bank: D(150_000), other: D(0), debts: D(0), partner: true }, r);
      expect(c.taxableBaseEur).toBe("34632.00");
      expect(c.persons).toEqual([
        { taxableBaseEur: "17316.00", sharePct: "11.54", benefitEur: "237.00", taxEur: "85.00" },
        { taxableBaseEur: "17316.00", sharePct: "11.54", benefitEur: "237.00", taxEur: "85.00" },
      ]);
    });
    it("3: savings, investments, a second home and a debt, no fiscal partner", () => {
      const c = calculateBox3({ bank: D(150_000), other: D(275_000), debts: D(100_000), partner: false }, r);
      expect(c).toMatchObject({ deductibleDebtsEur: "96200.00", deemedReturnEur: "15628.00", baseEur: "328800.00" });
      expect(c).toMatchObject({
        taxableBaseEur: "271116.00",
        sharePct: "82.45",
        benefitEur: "12885.00",
        taxEur: "4638.00",
      });
    });
    it("4: the same, with a fiscal partner", () => {
      const c = calculateBox3({ bank: D(150_000), other: D(275_000), debts: D(100_000), partner: true }, r);
      expect(c).toMatchObject({ deductibleDebtsEur: "92400.00", deemedReturnEur: "15730.00", baseEur: "332600.00" });
      expect(c.taxableBaseEur).toBe("217232.00");
      expect(c.persons[0]).toEqual({
        taxableBaseEur: "108616.00",
        sharePct: "32.65",
        benefitEur: "5135.00",
        taxEur: "1848.00",
      });
    });
    it("5: green investments with a fiscal partner, one partner taking all of the grondslag", () => {
      const c = calculateBox3(
        { bank: D(5_000), other: D(250_000), green: D(150_000), debts: D(0), partner: true },
        r,
        D(100),
      );
      expect(c).toMatchObject({
        greenExemptEur: "52624.00",
        greenAboveLimitEur: "97376.00",
        deemedReturnEur: "20493.00",
      });
      expect(c).toMatchObject({ baseEur: "352376.00", taxableBaseEur: "237008.00" });
      expect(c.persons[0]).toEqual({
        taxableBaseEur: "237008.00",
        sharePct: "67.25",
        benefitEur: "13781.00",
        taxEur: "4961.00",
      });
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
      benefitEur: "1313.00", // 4,756 × 27.61 %
      taxEur: "472.00",
      greenCreditEur: "498.00", // 0.7% of the exempt part, down
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
  it("flags a negative balance on the peildatum, but not rounding dust", async () => {
    t = await createTestApp();
    const mk = async (name: string) => json(await t.api("POST", "/api/accounts", { name, kind: "exchange" }));
    const [bitvavo, kraken] = [await mk("Bitvavo"), await mk("Kraken")];
    const eur = json<any[]>(await t.api("GET", "/api/assets")).find((a) => a.priceRef === "EUR");
    const tx = (accountId: number, body: object) =>
      t.api("POST", "/api/transactions", { accountId, assetId: eur.id, price: "1", ...body });
    await tx(bitvavo.id, { type: "deposit", occurredAt: "2024-06-01T12:00:00Z", quantity: "100" });
    await tx(bitvavo.id, { type: "withdrawal", occurredAt: "2024-07-01T12:00:00Z", quantity: "100.00000000001" });
    await tx(kraken.id, { type: "withdrawal", occurredAt: "2024-07-01T12:00:00Z", quantity: "5" });
    const warnings: string[] = json(await t.api("GET", "/api/box3/2025")).warnings;
    expect(warnings.filter((w) => w.includes("negative"))).toEqual([
      "Kraken has a negative EUR balance on 2024-12-31; check its history.",
    ]);
  });

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
    // 2025 rates: 835 (61,000 × 1.37 %) + 3,350 (56,988 × 5.88 %) − 32 (1,200 × 2.70 %) = 4,153;
    // grondslag 116,788 − 57,684 = 59,104; share 50.60 %; benefit 2,101; tax 756.
    expect(y.calculation).toMatchObject({
      deductibleDebtsEur: "1200.00",
      deemedReturnEur: "4153.00",
      taxableBaseEur: "59104.00",
      sharePct: "50.60",
      benefitEur: "2101.00",
      taxEur: "756.00",
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
