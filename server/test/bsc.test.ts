import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, defaultRoutes, raw, type TestApp } from "./helpers.js";

let t: TestApp;
const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

const W = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const X = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ROUTER = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const SPAM = "0x5555555555555555555555555555555555555555";
const ts = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;
const hex = (n: bigint | number) => `0x${n.toString(16)}`;
const GWEI = 1_000_000_000n;
const BNB = 10n ** 18n;

const TXS = [
  // 1 BNB in.
  {
    hash: "0xt1",
    blockNumber: hex(100),
    timestamp: hex(ts("2024-01-10")),
    from: X,
    to: W,
    value: hex(BNB),
    status: "0x1",
  },
  // 0.2 BNB swapped for 50 CAKE; 200,000 gas at 5 gwei = 0.001 BNB.
  {
    hash: "0xt2",
    blockNumber: hex(200),
    timestamp: hex(ts("2024-01-20")),
    from: W,
    to: ROUTER,
    value: hex(BNB / 5n),
    gasUsed: hex(200_000),
    gasPrice: hex(5n * GWEI),
    status: "0x1",
  },
  // A failed transaction still costs gas: 21,000 × 5 gwei.
  {
    hash: "0xt3",
    blockNumber: hex(300),
    timestamp: hex(ts("2024-01-30")),
    from: W,
    to: X,
    value: hex(BNB),
    gasUsed: hex(21_000),
    gasPrice: hex(5n * GWEI),
    status: "0x0",
  },
];
const TRANSFERS = [
  {
    transactionHash: "0xt2",
    blockHeight: 200,
    timestamp: ts("2024-01-20"),
    fromAddress: ROUTER,
    toAddress: W,
    contractAddress: CAKE,
    value: "50",
    tokenSymbol: "Cake",
    tokenName: "PancakeSwap Token",
    tokenDecimals: 18,
  },
  {
    transactionHash: "0xt4",
    blockHeight: 250,
    timestamp: ts("2024-01-25"),
    fromAddress: X,
    toAddress: W,
    contractAddress: SPAM,
    value: "1000",
    tokenSymbol: "FREE",
    tokenName: "Visit scam.example",
    tokenDecimals: 18,
  },
];
const ASSETS = [
  { tokenType: "NATIVE", tokenSymbol: "BNB", tokenName: "BNB", balance: "0.798895" },
  { tokenType: "ERC20", tokenSymbol: "Cake", tokenName: "PancakeSwap Token", contractAddress: CAKE, balance: "50" },
  { tokenType: "ERC20", tokenSymbol: "FREE", tokenName: "Visit scam.example", contractAddress: SPAM, balance: "1000" },
];

const chart = (closes: number[]) => ({
  chart: {
    result: [
      {
        meta: { currency: "EUR" },
        timestamp: [ts("2024-01-10"), ts("2024-01-20"), ts("2024-01-30")],
        indicators: { quote: [{ close: closes }] },
      },
    ],
    error: null,
  },
});

/** Ankr stub: one URL, the method in the JSON-RPC body; pages of one item to exercise paging. */
function ankrRoutes(calls: { method: string; params: any }[]) {
  return {
    ...defaultRoutes,
    "rpc.ankr.com/multichain/test-key": (_url: string, init?: RequestInit) => {
      const { method, params } = JSON.parse(String(init!.body));
      calls.push({ method, params });
      const page = (items: unknown[], key: string) => {
        const live = items.filter((i: any) => Number(i.blockHeight ?? i.blockNumber) >= params.fromBlock);
        const at = Number(params.pageToken ?? 0);
        return {
          jsonrpc: "2.0",
          id: 1,
          result: { [key]: live.slice(at, at + 2), nextPageToken: at + 2 < live.length ? String(at + 2) : "" },
        };
      };
      if (method === "ankr_getTransactionsByAddress") return page(TXS, "transactions");
      if (method === "ankr_getTokenTransfers") return page(TRANSFERS, "transfers");
      if (method === "ankr_getAccountBalance") return { jsonrpc: "2.0", id: 1, result: { assets: ASSETS } };
      return { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } };
    },
    [`coins/binance-smart-chain/contract/${CAKE}`]: { id: "pancakeswap-token", symbol: "cake", name: "PancakeSwap" },
    [`coins/binance-smart-chain/contract/${SPAM}`]: raw("not found", 404),
    "chart/BNB-EUR": chart([280, 300, 290]),
    "chart/CAKE-EUR": chart([2.5, 2.6, 2.4]),
  };
}

describe("BNB Chain (Ankr)", () => {
  beforeEach(() => {
    process.env.ANKR_API_KEY = "test-key";
  });
  afterEach(async () => {
    delete process.env.ANKR_API_KEY;
    await t?.close();
  });

  it("imports BNB, gas, swaps and tokens, skips spam and reconciles", async () => {
    const calls: { method: string; params: any }[] = [];
    t = await createTestApp(ankrRoutes(calls));
    const res = json(await t.api("POST", "/api/wallets", { chain: "bsc", address: W, accountName: "Trust Wallet" }));
    await t.wallets.whenIdle(res.accountId, "bsc");
    const r = json<any[]>(await t.api("GET", "/api/wallets")).find((w) => w.chain === "bsc").lastResult;
    expect(r.error).toBeUndefined();
    expect(r.mismatches).toEqual([]);
    expect(r.skippedTokens.map((s: any) => s.symbol)).toEqual(["FREE"]);

    const txs = json(await t.api("GET", `/api/transactions?accountId=${res.accountId}`)).items;
    expect(txs.map((x: any) => `${x.type} ${Number(x.quantity)} ${x.assetSymbol}`).sort()).toEqual([
      "buy 50 CAKE",
      "deposit 1 BNB",
      "fee 0.000105 BNB",
      "fee 0.001 BNB",
      "sell 0.2 BNB",
    ]);
    const assets = json<any[]>(await t.api("GET", "/api/assets"));
    expect(assets.find((a) => a.symbol === "BNB")?.priceRef).toBe("binancecoin");

    // Requests as Ankr documents them; tokens for all addresses in one query.
    expect(calls[0]).toMatchObject({
      method: "ankr_getTransactionsByAddress",
      params: { address: W, blockchain: ["bsc"], fromBlock: 0, descOrder: false },
    });
    expect(calls.find((c) => c.method === "ankr_getTokenTransfers")?.params).toMatchObject({ address: [W] });
    expect(calls.find((c) => c.method === "ankr_getAccountBalance")?.params).toMatchObject({
      walletAddress: W,
      blockchain: ["bsc"],
      onlyWhitelisted: false,
    });

    // The next sync starts just before the last block seen; nothing new is added.
    calls.length = 0;
    await t.api("POST", `/api/wallets/sync`, { accountId: res.accountId, chain: "bsc" });
    await t.wallets.whenIdle(res.accountId, "bsc");
    const again = json<any[]>(await t.api("GET", "/api/wallets")).find((w) => w.chain === "bsc").lastResult;
    expect(again.inserted).toBe(0);
    expect(calls[0]!.params.fromBlock).toBe(250);
  });

  it("explains that BNB Chain needs an Ankr key when none is set", async () => {
    delete process.env.ANKR_API_KEY;
    t = await createTestApp();
    const chain = json<any[]>(await t.api("GET", "/api/wallets/chains")).find((c) => c.id === "bsc");
    expect(chain).toMatchObject({ label: "BNB Chain", evm: true, unavailable: expect.stringMatching(/ANKR_API_KEY/) });
    const res = await t.api("POST", "/api/wallets", { chain: "bsc", address: W, accountName: "x" });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toMatch(/free Ankr API key/);
  });
});
