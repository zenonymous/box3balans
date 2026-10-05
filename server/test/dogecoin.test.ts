import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { afterEach, describe, expect, it } from "vitest";
import { addressFor, parseExtendedKey } from "../src/wallets/bitcoin.js";
import { DOGECOIN, dogecoinAdapter } from "../src/wallets/dogecoin.js";
import { createTestApp, defaultRoutes, raw, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const b58c = createBase58check(sha256);

// The well-known BIP39 test mnemonic, Dogecoin account m/44'/3'/0'.
const root = HDKey.fromMasterSeed(
  mnemonicToSeedSync("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"),
);
const XPUB = root.derive("m/44'/3'/0'").publicExtendedKey;
const DGUB = b58c.encode(concatBytes(hexToBytes("02facafd"), b58c.decode(XPUB).slice(4)));
const hd = parseExtendedKey(DOGECOIN, XPUB).hd;
const addr = (branch: number, i: number) =>
  addressFor(DOGECOIN, hd.deriveChild(branch).deriveChild(i).publicKey!, "p2pkh");
const R0 = addr(0, 0);
const R1 = addr(0, 1);
const C0 = addr(1, 0);
const EXT = "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L";

const K = 100_000_000;
const tx = (
  hash: string,
  height: number,
  day: string,
  fees: number,
  inputs: [string, number][],
  outputs: [string, number][],
) => ({
  hash,
  block_height: height,
  confirmed: `${day}T12:00:00Z`,
  fees: fees * K,
  inputs: inputs.map(([a, v]) => ({ addresses: [a], output_value: v * K })),
  outputs: outputs.map(([a, v]) => ({ addresses: [a], value: v * K })),
});
// 100 DOGE in; 40 out with 59 change (fee 1); then 10 more in.
const D1 = tx(
  "d1",
  100,
  "2024-02-01",
  1,
  [[EXT, 500]],
  [
    [R0, 100],
    [EXT, 399],
  ],
);
const D2 = tx(
  "d2",
  110,
  "2024-02-10",
  1,
  [[R0, 100]],
  [
    [EXT, 40],
    [C0, 59],
  ],
);
const D3 = tx(
  "d3",
  120,
  "2024-03-01",
  1,
  [[EXT, 20]],
  [
    [R1, 10],
    [EXT, 9],
  ],
);
const HISTORY: Record<string, { balance: number; txs: ReturnType<typeof tx>[] }> = {
  [R0]: { balance: 0, txs: [D2, D1] },
  [R1]: { balance: 10 * K, txs: [D3] },
  [C0]: { balance: 59 * K, txs: [D2] },
};

const routes = (opts: { limitFull?: boolean } = {}) => ({
  ...defaultRoutes,
  "api.blockcypher.com/v1/doge/main/addrs/": (url: string) => {
    const [, a, rest] = url.match(/addrs\/([^/?]+)\/?([^?]*)/)!;
    const h = HISTORY[a!];
    if (rest === "balance") return { balance: h?.balance ?? 0, n_tx: h?.txs.length ?? 0 };
    if (opts.limitFull) return raw("rate limited", 429);
    const after = Number(new URL(url).searchParams.get("after") ?? 0);
    const txs = (h?.txs ?? []).filter((x) => x.block_height > after);
    return { balance: h?.balance ?? 0, n_tx: h?.txs.length ?? 0, hasMore: false, txs };
  },
  "chart/DOGE-EUR": {
    chart: {
      result: [
        {
          meta: { currency: "EUR", regularMarketPrice: 0.08 },
          timestamp: [Date.parse("2024-01-31") / 1000, Date.parse("2024-02-28") / 1000],
          indicators: { quote: [{ close: [0.07, 0.08] }] },
        },
      ],
      error: null,
    },
  },
});

describe("Dogecoin", () => {
  it("derives BIP44 addresses and accepts dgub and xpub keys", () => {
    // Published vector for this mnemonic (m/44'/3'/0'/0/0).
    expect(R0).toBe("DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC");
    const c = dogecoinAdapter();
    expect(c.normalise(DGUB)).toBe(DGUB);
    expect(DGUB.startsWith("dgub")).toBe(true);
    expect(c.normalise(` ${EXT} `)).toBe(EXT);
    expect(() => c.normalise("DH5yaieqoZN36fDVciNyRueRGvGLR3mr7X")).toThrow(/valid Dogecoin/);
    expect(() => c.normalise("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toThrow(/valid Dogecoin/);
  });

  it("imports an xpub wallet, nets change, and reconciles", async () => {
    t = await createTestApp(routes());
    const res = json(await t.api("POST", "/api/wallets", { chain: "dogecoin", address: DGUB, accountName: "Doge" }));
    await t.wallets.whenIdle(res.accountId, "dogecoin");
    const r = json<any[]>(await t.api("GET", "/api/wallets")).find((w) => w.chain === "dogecoin").lastResult;
    expect(r.error).toBeUndefined();
    expect(r.mismatches).toEqual([]);
    expect(r.info).toBe("3 used addresses found from the extended key");
    const txs = json(await t.api("GET", `/api/transactions?accountId=${res.accountId}`)).items;
    expect(txs.map((x: any) => `${x.type} ${Number(x.quantity)}`).sort()).toEqual([
      "deposit 10",
      "deposit 100",
      "fee 1",
      "withdrawal 40",
    ]);

    // Next sync: known addresses aren't checked again, only the gap after them, and only newer blocks.
    const before = t.fetch.calls.length;
    await t.api("POST", "/api/wallets/sync", { accountId: res.accountId, chain: "dogecoin" });
    await t.wallets.whenIdle(res.accountId, "dogecoin");
    const calls = t.fetch.calls.slice(before).filter((u) => u.includes("blockcypher"));
    expect(calls.filter((u) => u.includes(`/addrs/${R0}/balance`))).toHaveLength(0);
    expect(calls.find((u) => u.includes(`/addrs/${R0}/full`))).toContain("after=110");
  });

  it("stops at BlockCypher's hourly limit and catches up in the next sync", async () => {
    t = await createTestApp(routes({ limitFull: true }));
    const res = json(await t.api("POST", "/api/wallets", { chain: "dogecoin", address: R1 }));
    await t.wallets.whenIdle(res.accountId, "dogecoin");
    const r = json<any[]>(await t.api("GET", "/api/wallets")).find((w) => w.chain === "dogecoin").lastResult;
    expect(r).toMatchObject({ status: "warning", partial: true, mismatches: [] });
    expect(r.warnings[0]).toMatch(/100 requests an hour/);
  });
});
