import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

// Yahoo: a quote, or the dividend events when asked for them.
const yahoo = (currency: string, price: number, dividends: { daysAgo: number; amount: number }[]) => (url: string) => ({
  chart: {
    result: [
      {
        meta: { currency, regularMarketPrice: price },
        ...(url.includes("events=div")
          ? {
              events: {
                dividends: Object.fromEntries(
                  dividends.map((d) => {
                    const ts = Math.floor(daysAgo(d.daysAgo).getTime() / 1000);
                    return [String(ts), { amount: d.amount, date: ts }];
                  }),
                ),
              },
            }
          : {}),
      },
    ],
    error: null,
  },
});

async function scenario() {
  t = await createTestApp({
    ...defaultRoutes,
    // Two dividends of $0.25 in the last year (plus an older one that doesn't count).
    // The full URL prefix, to override the shared AAPL quote fixture.
    "query1.finance.yahoo.com/v8/finance/chart/AAPL": yahoo("USD", 200, [
      { daysAgo: 400, amount: 0.24 },
      { daysAgo: 100, amount: 0.25 },
      { daysAgo: 10, amount: 0.25 },
    ]),
    "chart/ASML.AS": yahoo("EUR", 600, [{ daysAgo: 50, amount: 1.6 }]),
    "chart/IWDA.AS": yahoo("EUR", 90, []),
  });
  const broker = json(await t.api("POST", "/api/accounts", { name: "Broker", kind: "broker" }));
  const add = async (symbol: string, priceRef: string, isin: string, assetClass = "stock") =>
    json(
      await t.api("POST", "/api/assets", { assetClass, name: symbol, symbol, isin, priceSource: "yahoo", priceRef }),
    );
  const aapl = await add("AAPL", "AAPL", "US0378331005");
  const asml = await add("ASML", "ASML.AS", "NL0010273215");
  const iwda = await add("IWDA", "IWDA.AS", "IE00B4L5Y983", "etf");
  const tx = (body: object) => t.api("POST", "/api/transactions", { accountId: broker.id, ...body });
  const at = (n: number) => daysAgo(n).toISOString();
  await tx({
    assetId: aapl.id,
    type: "buy",
    occurredAt: at(300),
    quantity: "10",
    price: "180",
    currency: "USD",
    fxRate: "0.8",
  });
  await tx({ assetId: asml.id, type: "buy", occurredAt: at(300), quantity: "2", price: "500" });
  await tx({ assetId: iwda.id, type: "buy", occurredAt: at(300), quantity: "5", price: "80" });
  // You were charged 15% on Apple before.
  await tx({
    assetId: aapl.id,
    type: "dividend",
    occurredAt: at(100),
    amount: "2.5",
    taxWithheld: "0.375",
    currency: "USD",
    fxRate: "0.8",
  });
  return { aapl, asml };
}

describe("dividends", () => {
  it("forecasts the next 12 months from the last year's dividends and your holdings", async () => {
    await scenario();
    const f = json(await t.api("GET", "/api/dividends/forecast"));
    const aapl = f.byAsset.find((a: any) => a.symbol === "AAPL");
    // 2 × $0.25 × 10 shares × €0.80 = €4; your own 15% → €3.40.
    expect(aapl).toMatchObject({ payments: 2, grossEur: 4, netEur: 3.4, taxPct: 15, taxSource: "yours" });
    // No history for ASML yet: the Dutch default of 15%.
    expect(f.byAsset.find((a: any) => a.symbol === "ASML")).toMatchObject({
      grossEur: 3.2,
      netEur: 2.72,
      taxSource: "default",
    });
    expect(f.noDividends).toEqual(["IWDA"]);
    expect(f.months).toHaveLength(12);
    expect(f.months.reduce((s: number, m: any) => s + m.grossEur, 0)).toBeCloseTo(7.2, 6);
    expect(f).toMatchObject({ totalGrossEur: 7.2, totalNetEur: 6.12, failed: [] });
  });

  it("totals dividends and tax withheld per year and country", async () => {
    const { aapl, asml } = await scenario();
    const broker = json<any[]>(await t.api("GET", "/api/accounts"))[0];
    const year = new Date().getUTCFullYear();
    // A US dividend withheld at 30% (no W-8BEN) and a Dutch one at 15%.
    for (const body of [
      { assetId: aapl.id, amount: "10", taxWithheld: "3", currency: "USD", fxRate: "0.8" },
      { assetId: asml.id, amount: "3.2", taxWithheld: "0.48" },
    ]) {
      await t.api("POST", "/api/transactions", {
        accountId: broker.id,
        type: "dividend",
        occurredAt: `${year}-01-15T12:00:00Z`,
        ...body,
      });
    }
    const rows = json<any[]>(await t.api("GET", "/api/dividends/withholding")).filter((r) => r.year === year);
    const us = rows.find((r) => r.country === "US");
    const nl = rows.find((r) => r.country === "NL");
    expect(nl).toMatchObject({ grossEur: 3.2, taxEur: 0.48, ratePct: 15, payments: 1 });
    expect(us.payments).toBeGreaterThanOrEqual(1);
    expect(us.ratePct).toBeGreaterThan(15);
  });
});
