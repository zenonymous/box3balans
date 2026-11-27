import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BybitConvert,
  type BybitDeposit,
  type BybitExecution,
  type BybitFunding,
  type BybitWithdrawal,
  bybit,
  bybitSignature,
  mapBybitConverts,
  mapBybitExecutions,
  mapBybitTransfers,
} from "../src/sync/providers/bybit.js";
import type { SyncEvent } from "../src/sync/types.js";

const brief = (e: SyncEvent) => {
  const asset = "symbol" in e.asset ? e.asset.symbol : e.asset.currency;
  return e.kind === "trade"
    ? `${e.side} ${e.quantity} ${asset} for ${e.quote?.amount} ${e.quote?.currency}${e.feeQuote ? ` (fee ${e.feeQuote})` : ""}`
    : `${e.kind} ${"quantity" in e ? e.quantity : ""} ${asset}`;
};

// Made-up fills in the shape of /v5/execution/list for spot: execValue is quantity × price, execFee
// is what was paid (positive), in feeCurrency.
const fill = (execId: string, fields: Partial<BybitExecution>): BybitExecution => ({
  symbol: "BTCEUR",
  execId,
  orderId: "1",
  side: "Buy",
  execQty: "0",
  execValue: "0",
  execFee: "0",
  feeCurrency: "",
  execTime: "1709287200000",
  execType: "Trade",
  ...fields,
});
const PAIRS = new Map([
  ["BTCEUR", { base: "BTC", quote: "EUR" }],
  ["ETHBTC", { base: "ETH", quote: "BTC" }],
]);

describe("Bybit", () => {
  // Reference values from Python's hmac over timestamp + key + recv window + query string, as
  // Bybit's v5 guide describes it for a GET.
  it("signs requests as Bybit's v5 authentication describes", () => {
    const parts = { timestamp: "1700000000000", apiKey: "abcdefghijklmnop", recvWindow: "10000" };
    const secret = "SECRETsecretSECRETsecret12345678";
    expect(bybitSignature(secret, { ...parts, query: "accountType=UNIFIED" })).toBe(
      "96ffe1c0b247f20fb9837b0ce3a8d6a2267f34f221746c502b0028f6ac18b071",
    );
    expect(
      bybitSignature(secret, {
        ...parts,
        query: "category=spot&startTime=1700000000000&endTime=1700604800000&limit=100",
      }),
    ).toBe("f4816135f2115f6ab56f20e78f88c247b5c26eb2594780d8e62088b7a5c06ec0");
  });

  // Worked by hand: a fee in the coin bought comes off what arrives, a fee in the money paid comes
  // on top of it (or off what a sale brings in).
  it("turns spot fills into trades, the fee off the coin it's charged in", () => {
    const { events, skipped } = mapBybitExecutions(
      [
        fill("a", { execQty: "0.01", execValue: "600", execFee: "0.00001", feeCurrency: "BTC" }),
        fill("b", { side: "Sell", execQty: "0.005", execValue: "300", execFee: "0.3", feeCurrency: "EUR" }),
        fill("c", { side: "Buy", execQty: "0.01", execValue: "600", execFee: "0.6", feeCurrency: "EUR" }),
        fill("d", { side: "Sell", execQty: "0.002", execValue: "120", execFee: "0.000002", feeCurrency: "BTC" }),
        fill("e", { symbol: "ETHBTC", execQty: "0.5", execValue: "0.025", execFee: "0.0005", feeCurrency: "ETH" }),
        // Charged in a third coin: the trade as is, and the fee as its own line.
        fill("f", { execQty: "0.01", execValue: "600", execFee: "1.2", feeCurrency: "MNT" }),
        // Not a trade, and a market this list doesn't know.
        fill("g", { execType: "Funding", execQty: "1", execValue: "1" }),
        fill("h", { symbol: "XYZABC", execQty: "1", execValue: "1" }),
      ],
      PAIRS,
    );
    expect(events.map(brief)).toEqual([
      "buy 0.00999 BTC for 600 EUR",
      "sell 0.005 BTC for 299.7 EUR (fee 0.3)",
      "buy 0.01 BTC for 600.6 EUR (fee 0.6)",
      "sell 0.002002 BTC for 120 EUR",
      "buy 0.4995 ETH for 0.025 BTC",
      "buy 0.01 BTC for 600 EUR",
      "fee 1.2 MNT",
    ]);
    expect(events.map((e) => e.id)).toEqual([
      "bybit:exec:a",
      "bybit:exec:b",
      "bybit:exec:c",
      "bybit:exec:d",
      "bybit:exec:e",
      "bybit:exec:f",
      "bybit:exec:f:fee",
    ]);
    expect(events[0]!.at.toISOString()).toBe("2024-03-01T10:00:00.000Z");
    expect(skipped).toBe(2);
  });

  // Convert has no pair: against money the coin is bought or sold, between two coins the one given
  // up pays for the other (as a Bitstamp swap without a pair). Only finished conversions count.
  it("turns conversions into trades", () => {
    const convert = (exchangeTxId: string, fields: Partial<BybitConvert>): BybitConvert => ({
      exchangeTxId,
      accountType: "funding",
      fromCoin: "EUR",
      toCoin: "BTC",
      fromAmount: "100",
      toAmount: "0.0016",
      exchangeStatus: "success",
      createdAt: "1709287200000",
      ...fields,
    });
    const { events } = mapBybitConverts([
      convert("1", {}),
      convert("2", { fromCoin: "BTC", toCoin: "EUR", fromAmount: "0.001", toAmount: "61.5" }),
      convert("3", { fromCoin: "USDT", toCoin: "ETH", fromAmount: "300", toAmount: "0.1" }),
      convert("4", { exchangeStatus: "failure" }),
    ]);
    expect(events.map(brief)).toEqual([
      "buy 0.0016 BTC for 100 EUR",
      "sell 0.001 BTC for 61.5 EUR",
      "buy 0.1 ETH for 300 USDT",
    ]);
    expect(events.map((e) => e.id)).toEqual(["bybit:convert:1", "bybit:convert:2", "bybit:convert:3"]);
    expect(events[0]!.at.toISOString()).toBe("2024-03-01T10:00:00.000Z");
  });

  // Coins from the deposit and withdrawal records (a withdrawal takes the amount plus Bybit's fee),
  // euros from the Funding account's history; only what went through counts.
  it("turns deposits and withdrawals into transfers, coins and euros", () => {
    const deposit = (id: string, fields: Partial<BybitDeposit>): BybitDeposit => ({
      id,
      coin: "BTC",
      amount: "0.05",
      txID: `tx${id}`,
      status: 3,
      successAt: "1709287200000",
      depositFee: "",
      ...fields,
    });
    const withdrawal = (withdrawId: string, fields: Partial<BybitWithdrawal>): BybitWithdrawal => ({
      withdrawId,
      coin: "BTC",
      amount: "0.02",
      withdrawFee: "0.0002",
      status: "success",
      updateTime: "1709287200000",
      ...fields,
    });
    const funding = (currcCursor: string, fields: Partial<BybitFunding>): BybitFunding => ({
      currcCursor,
      currency: "EUR",
      ioDirection: "I",
      txnAmt: "500",
      createTime: "1709287200",
      showBusiTypeEn: "Fiat Deposit",
      descriptionEn: "Deposit",
      ...fields,
    });
    const { events } = mapBybitTransfers({
      deposits: [deposit("1", {}), deposit("2", { status: 2 })],
      withdrawals: [withdrawal("7", {}), withdrawal("8", { status: "Pending" })],
      funding: [
        funding("f1", {}),
        funding("f2", {
          ioDirection: "O",
          txnAmt: "200",
          showBusiTypeEn: "Fiat Withdrawal",
          descriptionEn: "Withdraw",
        }),
        // Converts are read from Convert's own history, coins from the records above.
        funding("f3", { ioDirection: "O", txnAmt: "100", showBusiTypeEn: "Convert", descriptionEn: "Convert" }),
        funding("f4", { currency: "BTC", txnAmt: "0.05", showBusiTypeEn: "Deposit", descriptionEn: "Deposit" }),
      ],
    });
    expect(events.map(brief)).toEqual([
      "deposit 0.05 BTC",
      "withdrawal 0.0202 BTC",
      "deposit 500 EUR",
      "withdrawal 200 EUR",
    ]);
    expect(events.map((e) => e.id)).toEqual([
      "bybit:deposit:1",
      "bybit:withdrawal:7",
      "bybit:fund:f1",
      "bybit:fund:f2",
    ]);
    expect(events.map((e) => e.at.toISOString())).toEqual(Array(4).fill("2024-03-01T10:00:00.000Z"));
  });

  describe("syncing", () => {
    const NOW = Date.parse("2026-11-27T12:00:00Z");
    const DAY = 86_400_000;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    const creds = { apiKey: "abcdefghijklmnop", apiSecret: "qrstuvwxyz123456" };
    type Call = { path: string; q: URLSearchParams; headers: Record<string, string>; query: string };
    const ok = (result: unknown) => Response.json({ retCode: 0, retMsg: "OK", result, time: NOW });
    // A made-up Bybit EU: answers each endpoint from `data`, records what was asked.
    const fake = (data: {
      fills?: BybitExecution[];
      converts?: BybitConvert[];
      deposits?: BybitDeposit[];
      withdrawals?: BybitWithdrawal[];
      funding?: BybitFunding[];
      key?: Record<string, unknown>;
      error?: { retCode: number; retMsg: string };
      borrowed?: string;
    }) => {
      const calls: Call[] = [];
      const inWindow = (t: number, q: URLSearchParams, from = "startTime", to = "endTime", unit = 1) =>
        t >= Number(q.get(from)) * unit && t <= Number(q.get(to)) * unit;
      const fetchFn = (async (url: string, init?: RequestInit) => {
        const u = new URL(url);
        const q = u.searchParams;
        calls.push({ path: u.pathname, q, headers: init?.headers as Record<string, string>, query: u.search.slice(1) });
        if (data.error && u.pathname !== "/v5/market/instruments-info")
          return Response.json({ ...data.error, result: {}, time: NOW });
        switch (u.pathname) {
          case "/v5/market/instruments-info":
            return ok({ category: "spot", list: [{ symbol: "BTCEUR", baseCoin: "BTC", quoteCoin: "EUR" }] });
          case "/v5/user/query-api":
            return ok({ readOnly: 1, expiredAt: "2027-02-20T12:00:00Z", ...data.key });
          case "/v5/execution/list": {
            const rows = (data.fills ?? []).filter((f) => inWindow(Number(f.execTime), q));
            // Two pages when there are two fills in a window.
            const page = q.get("cursor") ? rows.slice(1) : rows.slice(0, 1);
            return ok({ list: page, nextPageCursor: !q.get("cursor") && rows.length > 1 ? "next=1" : "" });
          }
          case "/v5/asset/exchange/query-convert-history":
            return ok({ list: Number(q.get("index")) === 1 ? (data.converts ?? []) : [] });
          case "/v5/asset/deposit/query-record":
            return ok({
              rows: (data.deposits ?? []).filter((d) => inWindow(Number(d.successAt), q)),
              nextPageCursor: "",
            });
          case "/v5/asset/withdraw/query-record":
            return ok({
              rows: (data.withdrawals ?? []).filter((w) => inWindow(Number(w.updateTime), q)),
              nextPageCursor: "",
            });
          case "/v5/asset/fundinghistory":
            return ok({
              list: (data.funding ?? []).filter((f) =>
                inWindow(Number(f.createTime) * 1000, q, "createTimeFrom", "createTimeTo", 1000),
              ),
              nextPageCursor: "",
            });
          case "/v5/account/wallet-balance":
            return ok({
              list: [
                {
                  accountType: "UNIFIED",
                  coin: [
                    { coin: "BTC", walletBalance: "0.015", spotBorrow: data.borrowed ?? "0" },
                    { coin: "EUR", walletBalance: "100", spotBorrow: "0" },
                  ],
                },
              ],
            });
          case "/v5/asset/transfer/query-account-coins-balance":
            return ok({
              accountType: "FUND",
              balance: [
                { coin: "EUR", walletBalance: "50" },
                { coin: "USDT", walletBalance: "0" },
              ],
            });
          default:
            return Response.json({ retCode: 10001, retMsg: `unknown ${u.pathname}` });
        }
      }) as typeof fetch;
      return { calls, fetchFn };
    };
    const ctx = (fetchFn: typeof fetch, cursor: Record<string, unknown> | null = null) => ({
      fetchFn,
      cursor,
      isKnown: async () => new Set<string>(),
      sleep: async () => {},
    });
    const spans = (calls: Call[], path: string, from = "startTime", to = "endTime", unit = 1) =>
      calls
        .filter((c) => c.path === path && !c.q.get("cursor"))
        .map((c) => [Number(c.q.get(from)) * unit, Number(c.q.get(to)) * unit] as const);

    it("reads Bybit EU's history in windows it allows, from the start or where the last sync stopped", async () => {
      const at = (d: string) => String(Date.parse(d));
      const { calls, fetchFn } = fake({
        borrowed: "0.005",
        fills: [
          fill("a", { execQty: "0.01", execValue: "600", execTime: at("2025-06-01T10:00:00Z") }),
          fill("b", { side: "Sell", execQty: "0.005", execValue: "300", execTime: at("2025-06-02T10:00:00Z") }),
        ],
        converts: [
          {
            exchangeTxId: "c1",
            accountType: "funding",
            fromCoin: "EUR",
            toCoin: "BTC",
            fromAmount: "100",
            toAmount: "0.0016",
            exchangeStatus: "success",
            createdAt: at("2025-07-01T10:00:00Z"),
          },
        ],
        deposits: [
          {
            id: "d1",
            coin: "BTC",
            amount: "0.01",
            txID: "x",
            status: 3,
            successAt: at("2025-03-01T10:00:00Z"),
            depositFee: "",
          },
        ],
        funding: [
          {
            currcCursor: "f1",
            currency: "EUR",
            ioDirection: "I",
            txnAmt: "1000",
            createTime: String(Date.parse("2025-02-01T10:00:00Z") / 1000),
            showBusiTypeEn: "Fiat Deposit",
            descriptionEn: "Deposit",
          },
        ],
      });
      const first = await bybit.fetch(creds, ctx(fetchFn));
      expect(first.events.map((e) => e.id).sort()).toEqual(
        ["bybit:convert:c1", "bybit:deposit:d1", "bybit:exec:a", "bybit:exec:b", "bybit:fund:f1"].sort(),
      );
      expect(first.cursor).toMatchObject({ syncedTo: NOW });
      expect(
        first.balances?.map((b) => `${b.quantity} ${"symbol" in b.asset ? b.asset.symbol : b.asset.currency}`),
      ).toEqual(["0.01 BTC", "150 EUR"]);
      expect(first.balanceScope).toBe("all");

      // Back to the start of Bybit EU, without gaps, each window as long as Bybit allows at most.
      const start = Date.parse("2025-01-01T00:00:00Z");
      for (const [path, max, from, to, unit] of [
        ["/v5/execution/list", 7 * DAY, "startTime", "endTime", 1],
        ["/v5/asset/fundinghistory", 7 * DAY, "createTimeFrom", "createTimeTo", 1000],
        ["/v5/asset/deposit/query-record", 30 * DAY, "startTime", "endTime", 1],
        ["/v5/asset/withdraw/query-record", 30 * DAY, "startTime", "endTime", 1],
      ] as const) {
        const w = spans(calls, path, from, to, unit);
        expect(w[0]![0], path).toBe(start);
        expect(w.at(-1)![1], path).toBe(NOW);
        for (const [a, b] of w) expect(b - a, path).toBeLessThan(max);
        for (let i = 1; i < w.length; i++) expect(w[i]![0], path).toBe(w[i - 1]![1] + unit);
      }
      // The page cursor is passed on as Bybit gave it, and signed the way it's sent.
      const paged = calls.find((c) => c.q.get("cursor"))!;
      expect(paged.query).toContain("cursor=next%3D1");
      for (const c of calls.filter((c) => c.path !== "/v5/market/instruments-info")) {
        expect(c.headers["X-BAPI-API-KEY"]).toBe(creds.apiKey);
        expect(c.headers["X-BAPI-SIGN"]).toBe(
          bybitSignature(creds.apiSecret, {
            timestamp: c.headers["X-BAPI-TIMESTAMP"]!,
            apiKey: creds.apiKey,
            recvWindow: c.headers["X-BAPI-RECV-WINDOW"]!,
            query: c.query,
          }),
        );
      }

      // The next sync goes back two days from where this one stopped, for what came in late.
      vi.setSystemTime(NOW + 10 * DAY);
      const again = fake({});
      await bybit.fetch(creds, ctx(again.fetchFn, first.cursor));
      expect(spans(again.calls, "/v5/execution/list")[0]![0]).toBe(NOW - 2 * DAY);
      expect(spans(again.calls, "/v5/asset/deposit/query-record")[0]![0]).toBe(NOW - 2 * DAY);
    });

    // Bybit says what a key may do (user/query-api): one that can also trade or withdraw is worth
    // more to whoever gets hold of it, so it isn't taken, and an existing one is warned about.
    it("takes only a read-only key, and warns before it expires", async () => {
      const writable = fake({ key: { readOnly: 0 } });
      await expect(bybit.test(creds, ctx(writable.fetchFn))).rejects.toThrow(/“Read-Only”/);
      expect((await bybit.fetch(creds, ctx(writable.fetchFn))).warnings.join(" ")).toMatch(/“Read-Only”/);

      await expect(bybit.test(creds, ctx(fake({}).fetchFn))).resolves.toBeUndefined();
      expect((await bybit.fetch(creds, ctx(fake({}).fetchFn))).warnings).toEqual([]);

      const soon = fake({ key: { expiredAt: "2026-12-05T08:00:00Z" } });
      expect((await bybit.fetch(creds, ctx(soon.fetchFn))).warnings).toEqual([
        "This Bybit API key expires on 5 December 2026. Extend it under API management at bybit.eu, or tie it to your server's IP address so it doesn't expire.",
      ]);
    });

    it("says what to do when Bybit refuses the key", async () => {
      const expired = fake({ error: { retCode: 33004, retMsg: "Your api key has expired." } });
      await expect(bybit.test(creds, ctx(expired.fetchFn))).rejects.toThrow(
        "Bybit: This Bybit API key has expired. Extend it, or make a new one, under API management at bybit.eu. (33004 Your api key has expired.)",
      );
      const other = fake({ error: { retCode: 10001, retMsg: "params error" } });
      await expect(bybit.fetch(creds, ctx(other.fetchFn))).rejects.toThrow("Bybit: 10001 params error");
    });

    // Like Bitstamp's: what isn't followed stays in view at every sync, so a balance that differs
    // keeps its likely cause next to it.
    it("keeps saying which fills it left out, and that borrowed coins aren't counted", async () => {
      const at = String(Date.parse("2026-11-20T10:00:00Z"));
      const { fetchFn } = fake({
        borrowed: "0.005",
        fills: [
          fill("x", { symbol: "XYZABC", execTime: at }),
          fill("y", { execQty: "0.01", execValue: "600", execTime: at }),
        ],
      });
      const first = await bybit.fetch(creds, ctx(fetchFn));
      const left =
        "1 Bybit spot trade on a market Box3balans doesn't know was left out. If a balance differs from Bybit's, it's the likely cause.";
      const borrowed =
        "0.005 BTC at Bybit is borrowed (spot margin) and isn't counted as yours. Enter the loan as a debt if it was still open on 1 January.";
      expect(first.warnings).toEqual([left, borrowed]);
      const next = await bybit.fetch(creds, ctx(fake({ borrowed: "0.005" }).fetchFn, first.cursor));
      expect(next.warnings).toEqual([left, borrowed]);
    });

    // Bybit keeps spot fills for two years: a connection not synced for longer misses the ones
    // in between, and says from when it could read them again.
    it("says so when spot trades are older than Bybit keeps them", async () => {
      vi.setSystemTime(Date.parse("2029-06-01T12:00:00Z"));
      const old = { syncedTo: Date.parse("2026-06-01T12:00:00Z") };
      const later = () => fake({ key: { expiredAt: "2030-01-01T00:00:00Z" } }).fetchFn;
      const r = await bybit.fetch(creds, ctx(later(), old));
      expect(r.warnings).toContain(
        "Bybit gives spot trades for the last two years only. Trades between 30 May 2026 and 2 June 2027 couldn't be read; import them from Bybit's Data Export (CSV).",
      );
      // Said once: the next sync starts after the gap.
      expect((await bybit.fetch(creds, ctx(later(), r.cursor))).warnings).toEqual([]);
    });

    // Convert history comes newest first, by page: once a whole page is imported, the older ones are too.
    it("stops reading Convert history at a page that's all imported", async () => {
      const page = (n: number) =>
        Array.from({ length: 100 }, (_, i) => ({
          exchangeTxId: `p${n}-${i}`,
          accountType: "funding",
          fromCoin: "EUR",
          toCoin: "BTC",
          fromAmount: "1",
          toAmount: "0.00001",
          exchangeStatus: "success",
          createdAt: String(NOW),
        }));
      const asked: number[] = [];
      const base = fake({}).fetchFn;
      const fetchFn = (async (url: string, init?: RequestInit) => {
        const u = new URL(url);
        if (u.pathname !== "/v5/asset/exchange/query-convert-history") return base(url, init);
        const index = Number(u.searchParams.get("index"));
        asked.push(index);
        return ok({ list: index <= 5 ? page(index) : [] });
      }) as typeof fetch;
      const known = new Set(page(2).map((r) => `bybit:convert:${r.exchangeTxId}`));
      const r = await bybit.fetch(creds, {
        ...ctx(fetchFn, { syncedTo: NOW - DAY }),
        isKnown: async (ids: string[]) => new Set(ids.filter((id) => known.has(id))),
      });
      expect(asked).toEqual([1, 2]);
      expect(r.events.filter((e) => e.id.startsWith("bybit:convert:"))).toHaveLength(200);
    });
  });
});
