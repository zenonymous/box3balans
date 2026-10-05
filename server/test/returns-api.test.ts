import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const chart = (closes: [string, number][], live: number) => (url: string) =>
  url.includes("period1")
    ? {
        chart: {
          result: [
            {
              meta: { currency: "EUR" },
              timestamp: closes.map(([d]) => ts(d)),
              indicators: { quote: [{ close: closes.map(([, c]) => c) }] },
            },
          ],
          error: null,
        },
      }
    : { chart: { result: [{ meta: { currency: "EUR", regularMarketPrice: live } }], error: null } };

// The fund: 100 → 120 over 2024, flat since. The benchmark: 50 → 55 over 2024, flat since.
const ROUTES = {
  ...defaultRoutes,
  "chart/FUND.AS": chart(
    [
      ["2024-01-02", 100],
      ["2024-07-01", 110],
      ["2024-12-31", 120],
    ],
    120,
  ),
  "chart/IWDA.AS": chart(
    [
      ["2024-01-02", 50],
      ["2024-12-31", 55],
    ],
    55,
  ),
};

async function scenario() {
  t = await createTestApp(ROUTES);
  const broker = json(await t.api("POST", "/api/accounts", { name: "Broker", kind: "broker" }));
  const fund = json(
    await t.api("POST", "/api/assets", {
      assetClass: "etf",
      name: "Fund",
      symbol: "FUND",
      priceSource: "yahoo",
      priceRef: "FUND.AS",
      currency: "EUR",
    }),
  );
  const eur = json<any[]>(await t.api("GET", "/api/assets")).find((a) => a.priceRef === "EUR");
  const tx = (body: object) => t.api("POST", "/api/transactions", { accountId: broker.id, ...body });
  // €1000 in, all of it into the fund the same day (paid from the account's cash).
  await tx({ assetId: eur.id, type: "deposit", occurredAt: "2024-01-02T12:00:00Z", quantity: "1000", price: "1" });
  await tx({
    assetId: fund.id,
    type: "buy",
    occurredAt: "2024-01-02T12:00:00Z",
    quantity: "10",
    price: "100",
    settleCash: true,
  });
  await t.backfill.run();
  await t.prices.refreshAll();
  return { broker, fund };
}

describe("returns API", () => {
  it("computes time- and money-weighted returns per year and all time, with a benchmark", async () => {
    const { broker, fund } = await scenario();
    const r = json(await t.api("GET", "/api/returns"));
    expect(r.benchmark).toMatchObject({ id: "msci-world", label: "MSCI World (iShares IWDA)" });

    const y2024 = r.years.find((y: any) => y.year === 2024);
    expect(y2024).toMatchObject({ startEur: 0, endEur: 1200, flowsEur: 1000, resultEur: 200, twrPct: 20 });
    expect(y2024.mwrPct).toBeCloseTo(20, 1);
    // The same €1000 in the benchmark went from 50 to 55: +10%.
    expect(y2024.benchmark).toMatchObject({ endEur: 1100, twrPct: 10 });
    const y2025 = r.years.find((y: any) => y.year === 2025);
    expect(y2025).toMatchObject({ startEur: 1200, endEur: 1200, flowsEur: 0, twrPct: 0 });

    expect(r.allTime).toMatchObject({ endEur: 1200, flowsEur: 1000, resultEur: 200, twrPct: 20 });
    // Over more than a year the all-time figures are also annualised.
    const yrs = r.allTime.years;
    expect(yrs).toBeGreaterThan(1);
    expect(r.allTime.twrAnnualPct).toBeCloseTo((1.2 ** (1 / yrs) - 1) * 100, 1);
    expect(r.allTime.xirrPct).toBeCloseTo((1.2 ** (1 / yrs) - 1) * 100, 1);
    expect(r.benchmarkAllTime).toMatchObject({ endEur: 1100, twrPct: 10 });

    const last = r.series.at(-1);
    expect(last).toMatchObject({
      valueEur: 1200,
      netInvestedEur: 1000,
      benchmarkEur: 1100,
      twrIndex: 1.2,
      benchmarkIndex: 1.1,
    });

    // Per holding and per account: €1000 in, worth €1200 now.
    expect(r.byKey[`a${fund.id}`]).toMatchObject({ annualised: true });
    expect(r.byKey[`a${fund.id}`].pct).toBeCloseTo((1.2 ** (1 / yrs) - 1) * 100, 0);
    const acc = r.byAccount.find((a: any) => a.accountId === broker.id);
    expect(acc.return.pct).toBeCloseTo(r.byKey[`a${fund.id}`].pct, 1);
    // The benchmark's asset is hidden: it never shows up as a holding.
    const holdings = json(await t.api("GET", "/api/portfolio")).holdings;
    expect(holdings.map((h: any) => h.symbol)).not.toContain("IWDA");
  });

  it("switches or turns off the benchmark", async () => {
    await scenario();
    expect((await t.api("PUT", "/api/returns/benchmark", { id: "none" })).statusCode).toBe(200);
    const r = json(await t.api("GET", "/api/returns"));
    expect(r.benchmark.id).toBe("none");
    expect(r.benchmarkAllTime).toBeNull();
    expect(r.series[0].benchmarkEur).toBeNull();
    expect((await t.api("PUT", "/api/returns/benchmark", { id: "nonsense" })).statusCode).toBe(400);
  });
});
