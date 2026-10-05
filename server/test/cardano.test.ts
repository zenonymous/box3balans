import { afterEach, describe, expect, it } from "vitest";
import { cardanoAdapter, stakeAddressOf } from "../src/wallets/cardano.js";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

// A receive address and its stake address (checked against Koios), plus someone else's address.
const ADDR = "addr1qy2jt0qpqz2z2z9zx5w4xemekkce7yderz53kjue53lpqv90lkfa9sgrfjuz6uvt4uqtrqhl2kj0a9lnr9ndzutx32gqleeckv";
const STAKE = "stake1uxhlmy7jcyp5ewpdwx967q93stl4tf87jle3jek3w9ng4yq3pea8k";
const OTHER = "addr1other";
const HOSKY = { policy_id: "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235", asset_name: "484f534b59" };

const out = (address: string, ada: number, assets: unknown[] | null = null) => ({
  payment_addr: { bech32: address },
  stake_addr: address === ADDR ? STAKE : null,
  value: String(ada * 1_000_000),
  asset_list: assets,
});
const tx = (
  hash: string,
  day: string,
  fee: number,
  inputs: unknown[],
  outputs: unknown[],
  withdrawals = null as unknown,
) => ({
  tx_hash: hash,
  tx_timestamp: Date.parse(`${day}T12:00:00Z`) / 1000,
  block_height: Number(hash.slice(1)) + 10,
  fee: String(fee * 1_000_000),
  inputs,
  outputs,
  withdrawals,
});

const TXS: Record<string, unknown> = {
  // Received 100 ADA.
  t1: tx("t1", "2023-03-01", 0.17, [out(OTHER, 200)], [out(ADDR, 100), out(OTHER, 99.83)]),
  // Sent 30 ADA (fee 0.2), change back to the wallet.
  t2: tx("t2", "2023-03-10", 0.2, [out(ADDR, 100)], [out(OTHER, 30), out(ADDR, 69.8)]),
  // Withdrew 5 ADA of rewards into the wallet: only the fee is a cost.
  t3: tx("t3", "2023-04-05", 0.2, [out(ADDR, 69.8)], [out(ADDR, 74.6)], [{ amount: "5000000", stake_addr: STAKE }]),
  // Received 1.5 ADA with 100 HOSKY tokens.
  t4: tx(
    "t4",
    "2023-04-10",
    0.2,
    [out(OTHER, 10)],
    [
      out(ADDR, 1.5, [
        { ...HOSKY, fingerprint: "asset17q7r59zlc3dgw0venc80pdv566q6yguw03f0d9", decimals: 0, quantity: "100" },
      ]),
      out(OTHER, 8.3),
    ],
  ),
};

const dayTs = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const ROUTES = {
  ...defaultRoutes,
  "api.koios.rest/api/v1/account_txs": (url: string) =>
    url.includes("_after_block_height=0")
      ? ["t1", "t2", "t3", "t4"].map((h) => ({ tx_hash: h, block_height: Number(h.slice(1)) + 10 }))
      : [],
  "api.koios.rest/api/v1/tx_info": (_url: string, init?: RequestInit) =>
    (JSON.parse(String(init!.body))._tx_hashes as string[]).map((h) => TXS[h]),
  "api.koios.rest/api/v1/tip": [{ epoch_no: 403 }],
  "api.koios.rest/api/v1/account_reward_history": [
    { earned_epoch: 400, spendable_epoch: 402, amount: "3000000", type: "member" },
    { earned_epoch: 401, spendable_epoch: 403, amount: "2000000", type: "member" },
    // Not spendable yet: not in the balance either.
    { earned_epoch: 402, spendable_epoch: 404, amount: "1000000", type: "member" },
  ],
  "api.koios.rest/api/v1/account_info": [{ total_balance: "76100000" }],
  "api.koios.rest/api/v1/account_assets": [{ ...HOSKY, fingerprint: "asset17q7r", decimals: 0, quantity: "100" }],
  [`coins/cardano/contract/${HOSKY.policy_id}${HOSKY.asset_name}`]: { id: "hosky", symbol: "hosky", name: "Hosky" },
  "chart/ADA-EUR": {
    chart: {
      result: [
        {
          meta: { currency: "EUR", regularMarketPrice: 0.38 },
          timestamp: ["2023-02-28", "2023-03-09", "2023-03-25", "2023-03-30", "2023-04-04", "2023-04-09"].map(dayTs),
          indicators: { quote: [{ close: [0.35, 0.33, 0.34, 0.36, 0.37, 0.38] }] },
        },
      ],
      error: null,
    },
  },
};

describe("Cardano", () => {
  it("validates addresses and tracks a receive address through its stake key", () => {
    const c = cardanoAdapter();
    expect(stakeAddressOf(ADDR)).toBe(STAKE);
    expect(c.normalise(ADDR)).toBe(STAKE);
    expect(c.normalise(STAKE.toUpperCase())).toBe(STAKE);
    expect(() => c.normalise("DdzFFzCqrhs")).toThrow(/Byron/);
    expect(() => c.normalise("addr_test1qz")).toThrow(/Testnet/);
    expect(() => c.normalise(`${STAKE.slice(0, -1)}x`)).toThrow(/stake address/);
  });

  it("imports transfers, fees, tokens and staking rewards, and reconciles", async () => {
    t = await createTestApp(ROUTES);
    const res = json(await t.api("POST", "/api/wallets", { chain: "cardano", address: ADDR, accountName: "Eternl" }));
    expect(res.address).toBe(STAKE);
    await t.wallets.whenIdle(res.accountId, "cardano");
    const wallet = json<any[]>(await t.api("GET", "/api/wallets")).find((w) => w.chain === "cardano");
    const r = wallet.lastResult;
    expect(r.error).toBeUndefined();
    expect(r.mismatches).toEqual([]);

    const txs = json(await t.api("GET", `/api/transactions?accountId=${res.accountId}`)).items;
    expect(txs.map((x: any) => `${x.type} ${Number(x.quantity)} ${x.assetSymbol}`).sort()).toEqual([
      "deposit 1.5 ADA",
      "deposit 100 ADA",
      "deposit 100 HOSKY",
      "fee 0.2 ADA",
      "fee 0.2 ADA",
      "reward 2 ADA",
      "reward 3 ADA",
      "withdrawal 30 ADA",
    ]);
    // Rewards are dated when they became spendable (start of the epoch) and valued at that day's close.
    const rewards = txs
      .filter((x: any) => x.type === "reward")
      .sort((a: any, b: any) => a.occurredAt.localeCompare(b.occurredAt));
    expect(rewards.map((x: any) => [x.occurredAt, Number(x.price)])).toEqual([
      ["2023-03-26T21:44:51.000Z", 0.34],
      ["2023-03-31T21:44:51.000Z", 0.36],
    ]);

    // A second sync only asks for blocks after the last one and adds nothing.
    await t.api("POST", "/api/wallets/sync", { accountId: res.accountId, chain: "cardano" });
    await t.wallets.whenIdle(res.accountId, "cardano");
    const again = json<any[]>(await t.api("GET", "/api/wallets")).find((w) => w.chain === "cardano").lastResult;
    expect(again.inserted).toBe(0);
    expect(t.fetch.calls.some((u) => u.includes("_after_block_height=14"))).toBe(true);
  });
});
