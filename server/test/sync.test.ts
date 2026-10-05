import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { integrations } from "../src/db/schema.js";
import { bitvavoSignature } from "../src/sync/providers/bitvavo.js";
import { createTestApp, defaultRoutes, raw, type TestApp } from "./helpers.js";
import { FLEX_XML } from "./fixtures/flex.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const dayTs = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const chart = (currency: string, points: [string, number][]) => ({
  chart: {
    result: [
      {
        meta: { currency, regularMarketPrice: points.at(-1)?.[1] ?? 1 },
        timestamp: points.map(([d]) => dayTs(d)),
        indicators: { quote: [{ close: points.map(([, c]) => c) }] },
      },
    ],
    error: null,
  },
});

const BITVAVO_HISTORY = [
  {
    transactionId: "d1",
    executedAt: "2024-01-01T10:00:00Z",
    type: "deposit",
    receivedCurrency: "EUR",
    receivedAmount: "1000",
  },
  {
    transactionId: "b1",
    executedAt: "2024-01-02T10:00:00Z",
    type: "buy",
    sentCurrency: "EUR",
    sentAmount: "500",
    receivedCurrency: "BTC",
    receivedAmount: "0.01",
    feesCurrency: "EUR",
    feesAmount: "1.25",
  },
  {
    transactionId: "b2",
    executedAt: "2024-01-03T10:00:00Z",
    type: "buy",
    sentCurrency: "EUR",
    sentAmount: "200",
    receivedCurrency: "ETH",
    receivedAmount: "0.1",
    feesCurrency: "EUR",
    feesAmount: "0.5",
  },
  {
    transactionId: "s1",
    executedAt: "2024-02-01T06:00:00Z",
    type: "staking",
    receivedCurrency: "ETH",
    receivedAmount: "0.001",
  },
  {
    transactionId: "x1",
    executedAt: "2024-02-10T10:00:00Z",
    type: "sell",
    sentCurrency: "BTC",
    sentAmount: "0.004",
    receivedCurrency: "EUR",
    receivedAmount: "240",
    feesCurrency: "EUR",
    feesAmount: "0.6",
  },
  {
    transactionId: "w1",
    executedAt: "2024-03-01T00:00:00Z",
    type: "withdrawal",
    sentCurrency: "BTC",
    sentAmount: "0.005",
    feesCurrency: "BTC",
    feesAmount: "0.00001",
  },
];

const bitvavoRoutes = (history = BITVAVO_HISTORY) => ({
  ...defaultRoutes,
  "api.bitvavo.com/v2/balance": [
    { symbol: "EUR", available: "537.65", inOrder: "0" },
    { symbol: "BTC", available: "0.00099", inOrder: "0" },
    { symbol: "ETH", available: "0.101", inOrder: "0" },
  ],
  "api.bitvavo.com/v2/account/history": { items: history, currentPage: 1, totalPages: 1, maxItems: 100 },
  "api/v3/search?query=BTC": { coins: [{ id: "bitcoin", name: "Bitcoin", symbol: "btc" }] },
  "api/v3/search?query=ETH": {
    coins: [
      { id: "ethereum", name: "Ethereum", symbol: "eth" },
      { id: "eth-copycat", name: "Fake", symbol: "eth" },
    ],
  },
  "chart/ETH-EUR": chart("EUR", [
    ["2024-01-31", 1900],
    ["2024-02-01", 2000],
  ]),
});

/** Waits for the connection's background sync and returns its stored result. */
async function connResult(id: number) {
  await t.sync.whenIdle(id);
  return json<any[]>(await t.api("GET", "/api/integrations")).find((i) => i.id === id).lastResult;
}

/** Triggers a sync (202) and returns its result once finished. */
async function resync(id: number) {
  const res = await t.api("POST", `/api/integrations/${id}/sync`);
  expect(res.statusCode).toBe(202);
  return connResult(id);
}

const BITVAVO_CREDS = { apiKey: "bv-key-1234567890", apiSecret: "bv-secret-abcdefghij" };

async function connectBitvavo() {
  const res = await t.api("POST", "/api/integrations", { provider: "bitvavo", credentials: BITVAVO_CREDS });
  expect(res.statusCode).toBe(200);
  return json<{ id: number; accountId: number }>(res);
}

describe("exchange connections", () => {
  it("verifies credentials, stores them encrypted and never returns them", async () => {
    t = await createTestApp(bitvavoRoutes());
    const { id } = await connectBitvavo();

    const [row] = await t.database.db.select().from(integrations).where(eq(integrations.id, id));
    expect(row!.credentials).toMatch(/^v1:/);
    expect(row!.credentials).not.toContain(BITVAVO_CREDS.apiSecret);

    const list = await t.api("GET", "/api/integrations");
    expect(list.body).not.toContain(BITVAVO_CREDS.apiSecret);
    expect(list.body).not.toContain("v1:");
    expect(json(list)[0]).toMatchObject({ provider: "bitvavo", keyHint: "…7890", accountName: "Bitvavo" });

    // The request was signed with the secret over the exact path.
    const req = t.fetch.requests.find((r) => r.url.endsWith("/v2/balance"))!;
    const h = req.init!.headers as Record<string, string>;
    expect(h["Bitvavo-Access-Signature"]).toBe(
      bitvavoSignature(BITVAVO_CREDS.apiSecret, Number(h["Bitvavo-Access-Timestamp"]), "GET", "/balance"),
    );
  });

  it("rejects credentials the exchange refuses, without echoing them", async () => {
    t = await createTestApp({
      ...bitvavoRoutes(),
      "api.bitvavo.com/v2/balance": () =>
        raw(JSON.stringify({ errorCode: 305, error: "No active API key found." }), 403),
    });
    const res = await t.api("POST", "/api/integrations", { provider: "bitvavo", credentials: BITVAVO_CREDS });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toBe("Bitvavo: No active API key found.");
    expect(res.body).not.toContain(BITVAVO_CREDS.apiSecret);
  });

  it("imports Bitvavo history, books cash, values rewards and reconciles with balances", async () => {
    t = await createTestApp(bitvavoRoutes());
    const { id, accountId } = await connectBitvavo();
    const result = await connResult(id);
    expect(result.error).toBeUndefined();
    expect(result.inserted).toBe(6);
    expect(result.mismatches).toEqual([]);
    // The chosen price feed is shown, so a wrong symbol match is easy to spot.
    expect(result.newAssets.sort()).toEqual(["BTC → CoinGecko bitcoin", "ETH → CoinGecko ethereum"]);

    const txs = json(await t.api("GET", `/api/transactions?accountId=${accountId}`)).items;
    const reward = txs.find((x: any) => x.externalId === "s1");
    expect(Number(reward.price)).toBe(2000); // valued from the daily ETH-EUR close
    const eth = json(await t.api("GET", "/api/assets")).find((a: any) => a.symbol === "ETH");
    expect(eth.priceRef).toBe("ethereum"); // highest market-cap match, not the copycat

    // Second sync: nothing new.
    const again = await resync(id);
    expect(again.inserted).toBe(0);
    expect(again.duplicates).toBe(6);

    // Deleting a synced transaction sticks across syncs.
    await t.api("DELETE", `/api/transactions/${reward.id}`);
    const third = await resync(id);
    expect(third.inserted).toBe(0);
    expect(third.ignored).toBe(1);
    // ...and now the ETH balance no longer adds up, which reconciliation reports.
    expect(third.mismatches).toEqual([
      expect.objectContaining({ symbol: "ETH", reported: "0.101", computed: "0.1", difference: "0.001" }),
    ]);
    expect(third.status).toBe("warning");
  });

  it("links a withdrawal on one exchange to the deposit on another as a transfer", async () => {
    t = await createTestApp({
      ...bitvavoRoutes(),
      "api.kraken.com/0/public/Assets": { error: [], result: { XXBT: { altname: "XBT" }, ZEUR: { altname: "EUR" } } },
      "api.kraken.com/0/private/Balance": { error: [], result: { XXBT: "0.005" } },
      "api.kraken.com/0/private/Ledgers": {
        error: [],
        result: {
          count: 1,
          ledger: {
            L1: {
              refid: "K1",
              time: dayTs("2024-03-01") + 7200,
              type: "deposit",
              asset: "XXBT",
              amount: "0.005",
              fee: "0",
            },
          },
        },
      },
    });
    const bv = await connectBitvavo();
    await connResult(bv.id);
    const kr = json(
      await t.api("POST", "/api/integrations", {
        provider: "kraken",
        credentials: { apiKey: "kraken-key-123456", apiSecret: Buffer.from("x".repeat(64)).toString("base64") },
      }),
    );
    const res = await connResult(kr.id);
    expect(res.transfersMatched).toBe(1);
    expect(res.mismatches).toEqual([]);

    const { holdings } = json(await t.api("GET", "/api/portfolio"));
    const btc = holdings.find((h: any) => h.symbol === "BTC");
    const atKraken = btc.accounts.find((a: any) => a.accountId === kr.accountId);
    // Cost basis carried over: 0.00501 of 0.006 BTC costing €300.75 left Bitvavo.
    expect(atKraken.costEur).toBe("251.13");
    expect(atKraken.quantity).toBe("0.005");
  });

  it("removing a connection can also remove its transactions", async () => {
    t = await createTestApp(bitvavoRoutes());
    const { id } = await connectBitvavo();
    await connResult(id);
    const del = json(await t.api("DELETE", `/api/integrations/${id}?deleteTransactions=true`));
    expect(del.removedTransactions).toBe(6);
    expect(json(await t.api("GET", "/api/transactions")).total).toBe(0);
  });

  it("syncs IBKR via Flex: waits for the statement, resolves listings by ISIN and exchange", async () => {
    let polls = 0;
    t = await createTestApp({
      ...defaultRoutes,
      "FlexWebService/SendRequest": raw(
        `<FlexStatementResponse timestamp="x"><Status>Success</Status><ReferenceCode>9988776655</ReferenceCode><Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url></FlexStatementResponse>`,
      ),
      "FlexWebService/GetStatement": () =>
        ++polls === 1
          ? raw(
              `<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage></FlexStatementResponse>`,
            )
          : raw(FLEX_XML),
      "finance/search?q=IE00B4L5Y983": {
        quotes: [
          { symbol: "IWDA.L", quoteType: "ETF", longname: "iShares Core MSCI World (LSE)", exchDisp: "London" },
          { symbol: "IWDA.AS", quoteType: "ETF", longname: "iShares Core MSCI World", exchDisp: "Amsterdam" },
        ],
      },
      "finance/search?q=US0378331005": {
        quotes: [{ symbol: "AAPL", quoteType: "EQUITY", longname: "Apple Inc.", exchDisp: "NASDAQ" }],
      },
      "chart/IWDA.AS": { chart: { result: [{ meta: { currency: "EUR", regularMarketPrice: 90 } }], error: null } },
    });
    const conn = json(
      await t.api("POST", "/api/integrations", {
        provider: "ibkr",
        credentials: { token: "123456789012345678901234", queryId: "987654" },
      }),
    );
    const res = await connResult(conn.id);
    expect(res.error).toBeUndefined();
    expect(polls).toBe(2);
    expect(res.mismatches).toEqual([]);
    expect(res.warnings).toEqual(["Skipped 1 OPT trade(s): only stocks and ETFs are tracked."]);

    const assets = json<any[]>(await t.api("GET", "/api/assets"));
    expect(assets.find((a) => a.isin === "IE00B4L5Y983")).toMatchObject({
      priceRef: "IWDA.AS",
      assetClass: "etf",
      currency: "EUR",
    });
    expect(assets.find((a) => a.isin === "US0378331005")).toMatchObject({ priceRef: "AAPL", assetClass: "stock" });

    const { summary } = json(await t.api("GET", "/api/portfolio"));
    // Dividend 1.20 − 0.18 USD at 1/1.1 plus €2.50 interest.
    expect(Number(summary.incomeEur)).toBeCloseTo(1.02 / 1.1 + 2.5, 2);
  });

  it("syncing manual edits: a re-sync never overwrites an edited transaction", async () => {
    t = await createTestApp(bitvavoRoutes());
    const { id, accountId } = await connectBitvavo();
    await connResult(id);
    const txs = json(await t.api("GET", `/api/transactions?accountId=${accountId}`)).items;
    const buy = txs.find((x: any) => x.externalId === "b1");
    await t.api("PUT", `/api/transactions/${buy.id}`, { notes: "checked" });
    await resync(id);
    const after = json(await t.api("GET", `/api/transactions?accountId=${accountId}`)).items.find(
      (x: any) => x.externalId === "b1",
    );
    expect(after.notes).toBe("checked");
    expect(after.settleAssetId).not.toBeNull();
  });
});
