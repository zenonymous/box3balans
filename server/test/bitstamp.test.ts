import { describe, expect, it } from "vitest";
import { type BsTx, bitstamp, bitstampSignature, mapBitstampTransactions } from "../src/sync/providers/bitstamp.js";
import type { SyncEvent } from "../src/sync/types.js";

// Made-up rows in the shape of Bitstamp's OpenAPI description of /api/v2/user_transactions/: each
// currency's amount under its own code, a pair's rate under "base_quote", the fee in the quote.
const row = (id: number, type: string, fields: Record<string, unknown>): BsTx => ({
  id,
  datetime: "2024-03-01 10:00:00.000000",
  type,
  fee: "0.00",
  order_id: 1463489000206336,
  usd: "0.00",
  ...fields,
});

const brief = (e: SyncEvent) => {
  const asset = "symbol" in e.asset ? e.asset.symbol : e.asset.currency;
  return e.kind === "trade"
    ? `${e.side} ${e.quantity} ${asset} for ${e.quote?.amount} ${e.quote?.currency}${e.feeQuote ? ` (fee ${e.feeQuote})` : ""}`
    : `${e.kind} ${"quantity" in e ? e.quantity : ""} ${asset}`;
};

describe("Bitstamp", () => {
  // Reference values from Python's hmac over the message as Bitstamp documents it (and rotki
  // builds it): no content type in the message when there's no body.
  it("signs requests as Bitstamp's v2 authentication describes", () => {
    const parts = {
      apiKey: "abcdefghijklmnopqrstuvwxyz123456",
      method: "POST",
      nonce: "f93c979d-b00d-43a9-9b9c-fd4cd9547fa6",
      timestamp: "1643640186807",
    };
    const secret = "SECRETsecretSECRETsecret12345678";
    expect(
      bitstampSignature(secret, {
        ...parts,
        path: "/api/v2/user_transactions/",
        body: "limit=1000&offset=0&since_id=1&sort=asc",
      }),
    ).toBe("c777107c158d281be59003f22de8a497bad5f5becb2367348bdc807a5a0a3ad3");
    expect(bitstampSignature(secret, { ...parts, path: "/api/v2/account_balances/", body: "" })).toBe(
      "6efc1c7a878c86e5577f2628ef808ce51495642457d205c399e867b0f869557c",
    );
  });

  // Worked by hand: a purchase costs the amount plus the fee, a sale brings in the amount minus it,
  // a withdrawal takes the amount plus the network fee.
  it("turns user transactions into trades, transfers and rewards", () => {
    const { events, skipped } = mapBitstampTransactions([
      row(1, "0", { eur: "1000.00" }),
      row(2, "2", { eur: "-600.00", btc: "0.01000000", btc_eur: 60000, fee: "1.50" }),
      row(3, "2", { eur: "300.00", btc: "-0.00500000", btc_eur: 60000, fee: "0.75" }),
      // Between two coins: the coin given up is the quote, the fee in it.
      row(4, "2", { eth: "0.50000000", btc: "-0.02500000", eth_btc: 0.05, fee: "0.00001" }),
      row(5, "1", { btc: "-0.00400000", fee: "0.0001" }),
      row(6, "27", { eth2r: "0.00100000" }),
      // Sent to staking and back: still at Bitstamp, nothing changes.
      row(7, "26", { eth: "-0.25" }),
      row(8, "25", { eth: "0.25" }),
      row(9, "35", { btc: "-0.001" }),
      // Derivatives aren't followed.
      row(10, "58", { eur: "-5.00" }),
    ]);
    expect(events.map(brief)).toEqual([
      "deposit 1000 EUR",
      "buy 0.01 BTC for 601.5 EUR (fee 1.5)",
      "sell 0.005 BTC for 299.25 EUR (fee 0.75)",
      "buy 0.5 ETH for 0.02501 BTC (fee 0.00001)",
      "withdrawal 0.0041 BTC",
      "reward 0.001 ETH",
      "withdrawal 0.001 BTC",
    ]);
    expect(events.map((e) => e.id)).toEqual([
      "bitstamp:1",
      "bitstamp:2",
      "bitstamp:3",
      "bitstamp:4",
      "bitstamp:5",
      "bitstamp:6",
      "bitstamp:9",
    ]);
    expect(events[0]!.at.toISOString()).toBe("2024-03-01T10:00:00.000Z");
    expect(skipped).toBe(1);
  });

  // rotki matches a deposit to the coins that arrived on chain as amount + fee: the amount is what
  // Bitstamp credited, after its fee.
  it("books a deposit at the amount credited", () => {
    const { events } = mapBitstampTransactions([row(11, "0", { btc: "0.01000000", fee: "0.0005" })]);
    expect(events.map(brief)).toEqual(["deposit 0.01 BTC"]);
  });

  // The pair names the coin that's bought or sold ("eth_btc": ETH, paid in BTC), as rotki reads it:
  // giving up ETH is a sale of ETH for BTC, the fee off what comes in.
  it("books a swap by the pair's first coin, either way", () => {
    const { events } = mapBitstampTransactions([
      row(12, "2", { eth: "-0.50000000", btc: "0.02499000", eth_btc: 0.05, fee: "0.00001" }),
    ]);
    expect(events.map(brief)).toEqual(["sell 0.5 ETH for 0.02498 BTC (fee 0.00001)"]);
  });

  it("reads new transactions after the last one seen, and the balances", async () => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const ctx = (cursor: Record<string, unknown> | null) => ({
      fetchFn: (async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          body: typeof init?.body === "string" ? init.body : "",
          headers: init?.headers as Record<string, string>,
        });
        if (url.endsWith("/account_balances/"))
          return Response.json([
            { currency: "eur", total: "400.00", available: "400.00", reserved: "0.00" },
            { currency: "btc", total: "0.01", available: "0.01", reserved: "0.00" },
            { currency: "usd", total: "0.00", available: "0.00", reserved: "0.00" },
          ]);
        return Response.json([
          row(41, "0", { eur: "1000.00" }),
          row(42, "2", { eur: "-600.00", btc: "0.01", btc_eur: 60000 }),
        ]);
      }) as typeof fetch,
      cursor,
      isKnown: async () => new Set<string>(),
      sleep: async () => {},
    });
    const creds = { apiKey: "abcdefghijklmnop", apiSecret: "qrstuvwxyz123456" };

    const first = await bitstamp.fetch(creds, ctx(null));
    expect(first.events).toHaveLength(2);
    expect(first.cursor).toEqual({ lastId: 42 });
    expect(
      first.balances?.map((b) => `${b.quantity} ${"symbol" in b.asset ? b.asset.symbol : b.asset.currency}`),
    ).toEqual(["400 EUR", "0.01 BTC"]);
    expect(new URLSearchParams(calls[0]!.body).get("since_id")).toBe("1");
    expect(calls[0]!.headers["X-Auth"]).toBe("BITSTAMP abcdefghijklmnop");
    expect(calls[0]!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    // The balances call has no body, so no content type either.
    expect(calls[1]!.headers["Content-Type"]).toBeUndefined();

    calls.length = 0;
    const next = await bitstamp.fetch(creds, ctx({ lastId: 41 }));
    expect(new URLSearchParams(calls[0]!.body).get("since_id")).toBe("42");
    expect(next.events.map((e) => e.id)).toEqual(["bitstamp:42"]);
  });

  it("reads a long history page by page without running out of stack", async () => {
    const total = 150_000;
    const ctx = {
      fetchFn: (async (url: string, init?: RequestInit) => {
        if (url.endsWith("/account_balances/")) return Response.json([]);
        const since = Number(new URLSearchParams(typeof init?.body === "string" ? init.body : "").get("since_id"));
        const ids = Array.from({ length: Math.max(0, Math.min(1000, total - since + 1)) }, (_, i) => since + i);
        return Response.json(ids.map((id) => row(id, "27", { btc: "0.00000001" })));
      }) as typeof fetch,
      cursor: null,
      isKnown: async () => new Set<string>(),
      sleep: async () => {},
    };
    const result = await bitstamp.fetch({ apiKey: "abcdefghijklmnop", apiSecret: "qrstuvwxyz123456" }, ctx);
    expect(result.events).toHaveLength(total);
    expect(result.cursor).toEqual({ lastId: total });
  });

  it("stops with Bitstamp's own reason when it refuses the key", async () => {
    const ctx = {
      fetchFn: (async () =>
        Response.json(
          { status: "error", code: "API0005", reason: "Invalid signature" },
          { status: 403 },
        )) as typeof fetch,
      cursor: null,
      isKnown: async () => new Set<string>(),
      sleep: async () => {},
    };
    await expect(bitstamp.test({ apiKey: "abcdefghijklmnop", apiSecret: "qrstuvwxyz123456" }, ctx)).rejects.toThrow(
      "Bitstamp: API0005 Invalid signature",
    );
  });
});
