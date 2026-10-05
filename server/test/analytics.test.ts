import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

// USD is worth €0.80 throughout (1 EUR = 1.25 USD) to keep the arithmetic readable.
const ecb = (url: string) => {
  const range = url.match(/v1\/(\d{4}-\d{2}-\d{2})\.\./);
  if (range) return { rates: { [range[1]!]: { USD: 1.25 } } };
  const day = url.match(/v1\/(\d{4}-\d{2}-\d{2})\?/)?.[1] ?? new Date().toISOString().slice(0, 10);
  return { date: day, rates: { USD: 1.25 } };
};

// AAPL closes in USD; the live quote is $200.
const closes: [string, number][] = [
  ["2024-01-15", 100],
  ["2024-06-28", 150],
  ["2024-12-31", 120],
  ["2025-06-30", 200],
];
const aapl = (url: string) =>
  url.includes("period1")
    ? {
        chart: {
          result: [
            {
              meta: { currency: "USD" },
              timestamp: closes.map(([d]) => ts(d)),
              indicators: { quote: [{ close: closes.map(([, c]) => c) }] },
            },
          ],
          error: null,
        },
      }
    : { chart: { result: [{ meta: { currency: "USD", regularMarketPrice: 200 } }], error: null } };

// The shared fixtures' ECB routes use a different USD rate; replace them.
const baseRoutes: Record<string, unknown> = { ...defaultRoutes };
delete baseRoutes["frankfurter.dev/v1/latest"];
delete baseRoutes["frankfurter.dev/v1/2024-"];

async function scenario() {
  t = await createTestApp({
    ...baseRoutes,
    "frankfurter.dev/v1/": ecb,
    "query1.finance.yahoo.com/v8/finance/chart/AAPL": aapl,
  });
  const broker = json(await t.api("POST", "/api/accounts", { name: "Broker", kind: "broker" }));
  const stock = json(
    await t.api("POST", "/api/assets", {
      assetClass: "stock",
      name: "Apple",
      symbol: "AAPL",
      priceSource: "yahoo",
      priceRef: "AAPL",
    }),
  );
  const eur = json<any[]>(await t.api("GET", "/api/assets")).find((a) => a.priceRef === "EUR");
  const tx = (body: object) => t.api("POST", "/api/transactions", { accountId: broker.id, ...body });
  await tx({ assetId: eur.id, type: "deposit", occurredAt: "2023-12-01T12:00:00Z", quantity: "1000", price: "1" });
  await tx({
    assetId: stock.id,
    type: "buy",
    occurredAt: "2024-01-15T12:00:00Z",
    quantity: "10",
    price: "100",
    currency: "USD",
    fxRate: "0.9",
    settleCash: false,
  });
  await tx({
    assetId: stock.id,
    type: "dividend",
    occurredAt: "2024-08-15T12:00:00Z",
    amount: "2.5",
    taxWithheld: "0.375",
    currency: "USD",
    fxRate: "0.8",
  });
  await tx({
    assetId: stock.id,
    type: "sell",
    occurredAt: "2025-03-01T12:00:00Z",
    quantity: "5",
    price: "180",
    currency: "USD",
    fxRate: "0.8",
  });
  await t.prices.refreshAll();
  await t.backfill.run();
  return { broker, stock };
}

describe("price history backfill", () => {
  it("loads daily closes from the first transaction and doesn't re-fetch on the next run", async () => {
    await scenario();
    const before = t.fetch.calls.filter((u) => u.includes("chart/AAPL") && u.includes("period1")).length;
    expect(before).toBe(1);
    const again = await t.backfill.run();
    expect(again.fetched).toBe(0);
    expect(t.fetch.calls.filter((u) => u.includes("chart/AAPL") && u.includes("period1")).length).toBe(1);
  });
});

describe("history and performance", () => {
  it("values every past day at that day's close", async () => {
    await scenario();
    const { points, estimated } = json(await t.api("GET", "/api/portfolio/history?range=ALL&maxPoints=10000"));
    expect(estimated).toEqual([]);
    const on = (d: string) => points.find((p: any) => p.day === d);
    // Before buying: just the €1000 deposit.
    expect(on("2023-12-01").totalEur).toBe(1000);
    // Weekend 2024-12-29 carries Friday's close... here the last close before it is 2024-06-28: $150 × 0.8.
    expect(on("2024-12-29").byClass.stock).toBe(1200);
    // 31 Dec 2024: 10 × $120 × 0.8 = €960 of stock, €1000 cash (the buy didn't settle in cash).
    expect(on("2024-12-31")).toMatchObject({
      byClass: expect.objectContaining({ stock: 960, cash: 1000 }),
      investedEur: 900,
      unrealizedEur: 60,
    });
  });

  it("splits results by year and they add up to the all-time result", async () => {
    await scenario();
    const perf = json(await t.api("GET", "/api/performance"));
    const y = (n: number) => perf.years.find((r: any) => r.year === n);
    // 2024: dividend (2.5 − 0.375) × 0.8 = 1.70; open gain 0 → 60.
    expect(y(2024)).toMatchObject({
      realizedEur: "0.00",
      dividendsEur: "1.70",
      unrealizedChangeEur: "60.00",
      resultEur: "61.70",
      taxWithheldEur: "0.30",
    });
    // 2025: sold 5 at $180 (€720) costing €450 → 270; open gain 60 → 5 × €160 − 450 = 350.
    expect(y(2025)).toMatchObject({ realizedEur: "270.00", unrealizedChangeEur: "290.00", resultEur: "560.00" });
    expect(perf.allTime).toMatchObject({
      realizedEur: "270.00",
      incomeEur: "1.70",
      unrealizedEur: "350.00",
      resultEur: "621.70",
    });

    // Unrealized €350 = €450 from the price (at the 0.90 rate paid) − €100 from the dollar weakening.
    const row = perf.byAsset.find((a: any) => a.symbol === "AAPL");
    expect(row).toMatchObject({
      localCurrency: "USD",
      priceEffectEur: "450.00",
      fxEffectEur: "-100.00",
      totalEur: "621.70",
    });
    expect(perf.realized).toEqual([expect.objectContaining({ symbol: "AAPL", gainEur: "270.00", date: "2025-03-01" })]);
  });

  it("switches to FIFO when asked", async () => {
    await scenario();
    expect(json(await t.api("GET", "/api/settings")).costMethod).toBe("average");
    const res = await t.api("PUT", "/api/settings", { costMethod: "fifo" });
    expect(res.statusCode).toBe(200);
    expect(json(await t.api("GET", "/api/performance")).costMethod).toBe("fifo");
    expect((await t.api("PUT", "/api/settings", { costMethod: "lifo" })).statusCode).toBe(400);
  });

  it("summarises income by year, month and asset", async () => {
    await scenario();
    const inc = json(await t.api("GET", "/api/income"));
    expect(inc.byYear).toEqual([
      {
        year: 2024,
        dividendsEur: "1.70",
        rewardsEur: "0.00",
        interestEur: "0.00",
        totalEur: "1.70",
        taxWithheldEur: "0.30",
      },
    ]);
    expect(inc.byMonth).toEqual([{ month: "2024-08", dividendsEur: "1.70", rewardsEur: "0.00", interestEur: "0.00" }]);
    expect(inc.byAsset[0]).toMatchObject({
      symbol: "AAPL",
      grossEur: "2.00",
      taxEur: "0.30",
      netEur: "1.70",
      count: 1,
    });
    expect(inc.events[0]).toMatchObject({ kind: "dividend", accountName: "Broker" });
  });
});
