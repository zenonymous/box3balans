import { afterEach, describe, expect, it } from "vitest";
import { D } from "../src/lib/decimal.js";
import { movementsToEvents } from "../src/wallets/netting.js";
import { solanaAdapter } from "../src/wallets/solana.js";
import { tronHexToBase58 } from "../src/wallets/tron.js";
import type { AssetRef } from "../src/sync/types.js";
import type { ChainContext } from "../src/wallets/types.js";
import { xrpAdapter } from "../src/wallets/xrp.js";
import { createTestApp, defaultRoutes, fakeFetch, raw, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const ETH: AssetRef = { kind: "crypto", symbol: "ETH", coingeckoId: "ethereum" };
const USDC: AssetRef = { kind: "crypto", symbol: "USDC", chain: "ethereum", contract: "0xa0b8" };
const at = new Date("2024-01-01T00:00:00Z");
const ctx = (fetchFn: any, cursor: Record<string, unknown> | null = null): ChainContext => ({
  fetchFn,
  sleep: async () => {},
  cursor,
});

describe("netting", () => {
  it("nets moves between own addresses down to the fee", () => {
    const events = movementsToEvents(
      "bitcoin",
      [
        { tx: "t", at, asset: ETH, amount: D("-1") },
        { tx: "t", at, asset: ETH, amount: D("1") },
      ],
      [{ tx: "t", at, asset: ETH, amount: D("0.001") }],
    );
    expect(events).toEqual([expect.objectContaining({ kind: "fee", id: "bitcoin:t:fee", quantity: "0.001" })]);
  });

  it("recognises a swap and keeps the fee separate", () => {
    const events = movementsToEvents(
      "ethereum",
      [
        { tx: "s", at, asset: USDC, amount: D("-50") },
        { tx: "s", at, asset: ETH, amount: D("0.02") },
      ],
      [{ tx: "s", at, asset: ETH, amount: D("0.001") }],
    );
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      kind: "trade",
      side: "buy",
      asset: ETH,
      quantity: "0.02",
      quote: { amount: "50" },
      quoteRef: USDC,
    });
  });
});

describe("chain parsers", () => {
  it("converts Tron hex addresses", () => {
    expect(tronHexToBase58("41a614f803b6fd780986a42c78ec9c7f77e6ded13c")).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
  });

  it("reads Solana SOL and token changes, oldest first, with a resumable cursor", async () => {
    const S = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const order: string[] = [];
    const fetchFn = fakeFetch({
      "solana.test": (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string);
        const result = (() => {
          switch (body.method) {
            case "getSignaturesForAddress":
              return [{ signature: "sig2" }, { signature: "sig1" }];
            case "getTransaction":
              order.push(body.params[0]);
              return body.params[0] === "sig1"
                ? {
                    blockTime: 1704067200,
                    meta: { fee: 5000, err: null, preBalances: [10e9, 0], postBalances: [7_999_995_000, 2e9] },
                    transaction: { message: { accountKeys: [{ pubkey: "ext" }, { pubkey: S }] } },
                  }
                : {
                    blockTime: 1704153600,
                    meta: {
                      fee: 5000,
                      err: null,
                      preBalances: [2e9],
                      postBalances: [2e9 - 5000],
                      preTokenBalances: [
                        { accountIndex: 1, mint: MINT, owner: S, uiTokenAmount: { amount: "10000000", decimals: 6 } },
                      ],
                      postTokenBalances: [
                        { accountIndex: 1, mint: MINT, owner: S, uiTokenAmount: { amount: "0", decimals: 6 } },
                      ],
                    },
                    transaction: { message: { accountKeys: [{ pubkey: S }, { pubkey: "tokacc" }] } },
                  };
            case "getBalance":
              return { value: 2e9 - 5000 };
            case "getTokenAccountsByOwner":
              return { value: [] };
          }
        })();
        return { jsonrpc: "2.0", id: body.id, result };
      },
    });
    const r = await solanaAdapter("https://solana.test").fetch([{ address: S }], ctx(fetchFn));
    expect(order).toEqual(["sig1", "sig2"]);
    expect(r.cursor).toEqual({ addresses: { [S]: { newest: "sig2" } } });
    const events = movementsToEvents("solana", r.movements, r.fees);
    expect(events.map((e) => [e.kind, "quantity" in e ? e.quantity : null])).toEqual([
      ["deposit", "2"],
      ["fee", "0.000005"],
      ["withdrawal", "10"],
    ]);
    expect(r.balances).toEqual([{ asset: expect.objectContaining({ symbol: "SOL" }), quantity: "1.999995" }]);
  });

  it("reads XRP payments and fees, skipping issued tokens", async () => {
    const A = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
    const fetchFn = fakeFetch({
      "xrpl.test": (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string);
        if (body.method === "account_info") return { result: { account_data: { Balance: "79999988" } } };
        const tx = (h: string, fields: object, delivered: unknown) => ({
          tx: { hash: h, Fee: "12", date: 700_000_000, ledger_index: 10, ...fields },
          meta: { TransactionResult: "tesSUCCESS", delivered_amount: delivered },
        });
        return {
          result: {
            transactions: [
              tx(
                "IN",
                { TransactionType: "Payment", Account: "rOther", Destination: A, Amount: "100000000" },
                "100000000",
              ),
              tx(
                "OUT",
                { TransactionType: "Payment", Account: A, Destination: "rOther", Amount: "20000000" },
                "20000000",
              ),
              tx(
                "IOU",
                {
                  TransactionType: "Payment",
                  Account: "rOther",
                  Destination: A,
                  Amount: { currency: "USD", value: "5" },
                },
                { currency: "USD", value: "5" },
              ),
            ],
          },
        };
      },
    });
    const r = await xrpAdapter("https://xrpl.test").fetch([{ address: A }], ctx(fetchFn));
    const events = movementsToEvents("xrp", r.movements, r.fees);
    expect(events.map((e) => [e.kind, "quantity" in e ? e.quantity : null])).toEqual([
      ["deposit", "100"],
      ["fee", "0.000012"],
      ["withdrawal", "20"],
    ]);
    expect(r.balances[0]!.quantity).toBe("79.999988");
    expect(r.warnings[0]).toMatch(/Skipped 1 XRP Ledger token/);
    expect(r.cursor).toEqual({ lastLedger: { [A]: 10 } });
  });
});

// ---- End to end through the API ----

/** Waits for the wallet's background sync and returns its stored result. */
async function walletResult(accountId: number, chain: string) {
  await t.wallets.whenIdle(accountId, chain);
  const rows = json<any[]>(await t.api("GET", "/api/wallets"));
  return rows.find((w) => w.accountId === accountId && w.chain === chain).lastResult;
}

const A = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"; // zpub 0/0
const B = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"; // zpub 0/1
const EXT = "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA";
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const BTC_TXS = {
  t1: {
    txid: "t1",
    fee: 10000,
    status: { confirmed: true, block_time: 1709254800 }, // 2024-03-01T01:00Z
    vin: [{ prevout: { scriptpubkey_address: EXT, value: 60_000_000 } }],
    vout: [
      { scriptpubkey_address: A, value: 50_000_000 },
      { scriptpubkey_address: EXT, value: 9_990_000 },
    ],
  },
  t2: {
    txid: "t2",
    fee: 10000,
    status: { confirmed: true, block_time: 1712000000 },
    vin: [{ prevout: { scriptpubkey_address: A, value: 50_000_000 } }],
    vout: [
      { scriptpubkey_address: B, value: 30_000_000 },
      { scriptpubkey_address: EXT, value: 19_990_000 },
    ],
  },
};
const stats = (funded: number, spent: number, n: number) => ({
  chain_stats: { funded_txo_sum: funded, spent_txo_sum: spent, tx_count: n },
  mempool_stats: { tx_count: 0 },
});
const btcRoutes = {
  ...defaultRoutes,
  "mempool.space/api/address/": (url: string) => {
    const [, addr, rest] = url.match(/address\/([^/]+)(\/.*)?$/)!;
    if (rest?.startsWith("/txs")) return addr === A ? [BTC_TXS.t2, BTC_TXS.t1] : addr === B ? [BTC_TXS.t2] : [];
    return addr === A ? stats(50_000_000, 50_000_000, 2) : addr === B ? stats(30_000_000, 0, 1) : stats(0, 0, 0);
  },
};

describe("wallet tracking (Bitcoin)", () => {
  it("imports an address, then re-imports when a second address joins the wallet", async () => {
    t = await createTestApp(btcRoutes);
    const first = json(
      await t.api("POST", "/api/wallets", { chain: "bitcoin", address: A, accountName: "Cold storage" }),
    );
    const r1 = await walletResult(first.accountId, "bitcoin");
    expect(r1.error).toBeUndefined();
    expect(r1.mismatches).toEqual([]);
    let txs = json(await t.api("GET", `/api/transactions?accountId=${first.accountId}`)).items;
    expect(txs.map((x: any) => [x.type, Number(x.quantity)]).sort()).toEqual([
      ["deposit", 0.5],
      ["fee", 0.0001],
      ["withdrawal", 0.4999],
    ]);

    // Adding B makes t2 partly internal: only 0.1999 BTC actually left the wallet.
    const second = json(
      await t.api("POST", "/api/wallets", { chain: "bitcoin", address: B, accountId: first.accountId }),
    );
    expect((await walletResult(second.accountId, "bitcoin")).mismatches).toEqual([]);
    txs = json(await t.api("GET", `/api/transactions?accountId=${first.accountId}`)).items;
    expect(txs.find((x: any) => x.type === "withdrawal").quantity).toMatch(/^0\.1999/);
    expect(txs).toHaveLength(3);
  });

  it("scans an xpub with the gap limit and links the deposit to an exchange withdrawal", async () => {
    t = await createTestApp(btcRoutes);
    const exchange = json(await t.api("POST", "/api/accounts", { name: "Exchange", kind: "exchange" }));
    const btc = json(
      await t.api("POST", "/api/assets", {
        assetClass: "crypto",
        name: "Bitcoin",
        symbol: "BTC",
        priceSource: "coingecko",
        priceRef: "bitcoin",
      }),
    );
    await t.api("POST", "/api/transactions", {
      accountId: exchange.id,
      assetId: btc.id,
      type: "buy",
      occurredAt: "2024-02-01T10:00:00Z",
      quantity: "1",
      price: "40000",
    });
    await t.api("POST", "/api/transactions", {
      accountId: exchange.id,
      assetId: btc.id,
      type: "withdrawal",
      occurredAt: "2024-03-01T00:00:00Z",
      quantity: "0.5001",
    });

    const res = json(await t.api("POST", "/api/wallets", { chain: "bitcoin", address: ZPUB, accountName: "Ledger" }));
    const r = await walletResult(res.accountId, "bitcoin");
    expect(r.info).toBe("2 used addresses found from the extended key");
    expect(r.transfersMatched).toBe(1);
    expect(r.mismatches).toEqual([]);
    const { holdings } = json(await t.api("GET", "/api/portfolio"));
    const ledger = holdings
      .find((h: any) => h.symbol === "BTC")
      .accounts.find((a: any) => a.accountId === res.accountId);
    // 0.5 BTC arrived carrying its original cost (0.5001 × €40,000); 0.1999 left again.
    expect(ledger.quantity).toBe("0.3");
  });

  it("rejects invalid addresses and duplicates", async () => {
    t = await createTestApp(btcRoutes);
    const bad = await t.api("POST", "/api/wallets", { chain: "bitcoin", address: "bc1qnotreal" });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error).toBe("Not a valid Bitcoin address");
    const ok = json(await t.api("POST", "/api/wallets", { chain: "bitcoin", address: A, sync: false }));
    const dupe = await t.api("POST", "/api/wallets", {
      chain: "bitcoin",
      address: A.toUpperCase(),
      accountId: ok.accountId,
      sync: false,
    });
    expect(dupe.statusCode).toBe(409);
  });
});

const W = "0x1111111111111111111111111111111111111111";
const X = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x3333333333333333333333333333333333333333";
const USDC_ADDR = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const tok = (address: string, symbol: string, reputation = "ok", decimals = "18") => ({
  address_hash: address,
  symbol,
  name: symbol,
  decimals,
  type: "ERC-20",
  reputation,
});
const usdc = tok(USDC_ADDR, "USDC", "ok", "6");
const BS = `eth.blockscout.com/api/v2/addresses/${W}`;
const evmRoutes = {
  ...defaultRoutes,
  [BS]: { coin_balance: "518500000000000000" },
  [`${BS}/transactions`]: {
    items: [
      {
        hash: "tx6",
        timestamp: "2024-03-01T00:00:00Z",
        block_number: 120,
        value: "500000000000000000",
        status: "ok",
        result: "success",
        from: { hash: W },
        to: { hash: X },
        fee: { value: "500000000000000" },
      },
      {
        hash: "tx5",
        timestamp: "2024-02-01T00:00:00Z",
        block_number: 110,
        value: "0",
        status: "ok",
        result: "success",
        from: { hash: W },
        to: { hash: ROUTER },
        fee: { value: "1000000000000000" },
      },
      {
        hash: "tx1",
        timestamp: "2024-01-10T00:00:00Z",
        block_number: 100,
        value: "1000000000000000000",
        status: "ok",
        result: "success",
        from: { hash: X },
        to: { hash: W },
        fee: { value: "21000" },
      },
    ],
    next_page_params: null,
  },
  [`${BS}/internal-transactions`]: {
    items: [
      {
        transaction_hash: "tx5",
        timestamp: "2024-02-01T00:00:00Z",
        block_number: 110,
        index: 3,
        value: "20000000000000000",
        success: true,
        from: { hash: ROUTER },
        to: { hash: W },
      },
    ],
    next_page_params: null,
  },
  [`${BS}/token-transfers`]: {
    items: [
      {
        transaction_hash: "tx5",
        timestamp: "2024-02-01T00:00:00Z",
        block_number: 110,
        log_index: 1,
        from: { hash: W },
        to: { hash: ROUTER },
        token: usdc,
        total: { value: "50000000", decimals: "6" },
      },
      {
        transaction_hash: "tx4",
        timestamp: "2024-01-13T00:00:00Z",
        block_number: 103,
        log_index: 0,
        from: { hash: X },
        to: { hash: W },
        token: tok("0x4444444444444444444444444444444444444444", "JUNK"),
        total: { value: "5000000000000000000", decimals: "18" },
      },
      {
        transaction_hash: "tx3",
        timestamp: "2024-01-12T00:00:00Z",
        block_number: 102,
        log_index: 0,
        from: { hash: X },
        to: { hash: W },
        token: tok("0x5555555555555555555555555555555555555555", "SCAM", "scam"),
        total: { value: "1", decimals: "18" },
      },
      {
        transaction_hash: "tx2",
        timestamp: "2024-01-11T00:00:00Z",
        block_number: 101,
        log_index: 0,
        from: { hash: X },
        to: { hash: W },
        token: usdc,
        total: { value: "100000000", decimals: "6" },
      },
    ],
    next_page_params: null,
  },
  [`${BS}/token-balances`]: [
    { token: usdc, value: "50000000" },
    { token: tok("0x4444444444444444444444444444444444444444", "JUNK"), value: "5000000000000000000" },
  ],
  [`coins/ethereum/contract/${USDC_ADDR}`]: { id: "usd-coin", symbol: "usdc", name: "USDC" },
  "chart/USDC-EUR": {
    chart: {
      result: [
        {
          meta: { currency: "EUR" },
          timestamp: [1704844800, 1706745600],
          indicators: { quote: [{ close: [0.9, 0.92] }] },
        },
      ],
      error: null,
    },
  },
  "chart/ETH-EUR": {
    chart: {
      result: [
        {
          meta: { currency: "EUR" },
          timestamp: [1704844800, 1706745600],
          indicators: { quote: [{ close: [2000, 2300] }] },
        },
      ],
      error: null,
    },
  },
};

describe("wallet tracking (EVM)", () => {
  it("imports ETH, maps tokens via CoinGecko, skips spam and reconciles", async () => {
    t = await createTestApp(evmRoutes);
    const res = json(
      await t.api("POST", "/api/wallets", {
        chain: "ethereum",
        address: W.toUpperCase().replace("0X", "0x"),
        accountName: "MetaMask",
      }),
    );
    const r = await walletResult(res.accountId, "ethereum");
    expect(r.error).toBeUndefined();
    expect(r.mismatches).toEqual([]);
    expect(r.skippedTokens.map((s: any) => s.symbol).sort()).toEqual(["JUNK", "SCAM"]);
    // Flagged spam is never looked up.
    expect(t.fetch.calls.some((u) => u.includes("contract/0x5555"))).toBe(false);

    const txs = json(await t.api("GET", `/api/transactions?accountId=${res.accountId}`)).items;
    const summary = txs.map((x: any) => `${x.type} ${Number(x.quantity)} ${x.assetSymbol}`).sort();
    expect(summary).toEqual([
      "buy 0.02 ETH",
      "deposit 1 ETH",
      "deposit 100 USDC",
      "fee 0.0005 ETH",
      "fee 0.001 ETH",
      "sell 50 USDC",
      "withdrawal 0.5 ETH",
    ]);
    // The swap is valued at what was given up: 50 USDC × €0.92.
    const buy = txs.find((x: any) => x.type === "buy");
    expect(Number(buy.price) * 0.02).toBeCloseTo(46, 6);
    const asset = json<any[]>(await t.api("GET", "/api/assets")).find((a) => a.symbol === "USDC");
    expect(asset.priceRef).toBe("usd-coin");

    // Re-sync: nothing new, unlisted tokens come from the cache (no second lookup).
    const lookups = t.fetch.calls.filter((u) => u.includes("/contract/0x4444")).length;
    expect((await t.api("POST", "/api/wallets/sync", { accountId: res.accountId, chain: "ethereum" })).statusCode).toBe(
      202,
    );
    const again = await walletResult(res.accountId, "ethereum");
    expect(again.inserted).toBe(0);
    expect(t.fetch.calls.filter((u) => u.includes("/contract/0x4444")).length).toBe(lookups);
  });

  it("can include unlisted tokens as manually priced assets", async () => {
    t = await createTestApp(evmRoutes);
    const res = json(await t.api("POST", "/api/wallets", { chain: "ethereum", address: W, includeUnlisted: true }));
    expect((await walletResult(res.accountId, "ethereum")).skippedTokens).toEqual([]);
    const assets = json<any[]>(await t.api("GET", "/api/assets"));
    expect(assets.find((a) => a.symbol === "JUNK")).toMatchObject({
      priceSource: "manual",
      contract: "0x4444444444444444444444444444444444444444",
    });
  });

  it("defers token identification when CoinGecko rate-limits, without stalling", async () => {
    const limited = () => raw('{"status":{"error_code":429}}', 429);
    t = await createTestApp({
      ...evmRoutes,
      "coins/ethereum/contract/": limited,
      [`coins/ethereum/contract/${USDC_ADDR}`]: limited,
    });
    const res = json(await t.api("POST", "/api/wallets", { chain: "ethereum", address: W }));
    const r = await walletResult(res.accountId, "ethereum");
    expect(r.status).toBe("warning");
    expect(r.pendingTokens).toBe(2); // USDC and JUNK; SCAM is flagged spam and never looked up
    expect(r.mismatches).toEqual([]); // not reconciled while tokens are pending
    // Stopped after the first 429 instead of retrying every token.
    expect(t.fetch.calls.filter((u) => u.includes("/contract/")).length).toBe(1);
    const txs = json(await t.api("GET", `/api/transactions?accountId=${res.accountId}`)).items;
    expect(txs.some((x: any) => x.assetSymbol === "USDC")).toBe(false);
  });

  it("reports explorer failures as a sync error without crashing", async () => {
    t = await createTestApp({ ...evmRoutes, [`${BS}/transactions`]: () => raw("upstream down", 503) });
    const res = json(await t.api("POST", "/api/wallets", { chain: "ethereum", address: W }));
    const r = await walletResult(res.accountId, "ethereum");
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/503/);
  });
});
