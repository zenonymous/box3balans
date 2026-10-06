import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bitvavoSignature, mapBitvavoHistory, mapBitvavoItem } from "../src/sync/providers/bitvavo.js";
import { coinbaseJwt, mapCoinbaseTx, mapCoinbaseTxs } from "../src/sync/providers/coinbase.js";
import { parseFlexStatement, parseIbDate } from "../src/sync/providers/ibkr.js";
import { krakenEvents, krakenSignature, mapKrakenLedger, normaliseKrakenAsset } from "../src/sync/providers/kraken.js";
import type { SyncEvent } from "../src/sync/types.js";
import { FLEX_XML } from "./fixtures/flex.js";

const qty = (e: SyncEvent) => ("quantity" in e ? e.quantity : undefined);

describe("Kraken", () => {
  it("signs requests exactly like Kraken's documented example", () => {
    const sig = krakenSignature(
      "/0/private/AddOrder",
      "1616492376594",
      "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25",
      "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==",
    );
    expect(sig).toBe("4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==");
  });

  it("normalises legacy and staked asset codes", () => {
    expect(normaliseKrakenAsset("XXBT")).toBe("BTC");
    expect(normaliseKrakenAsset("ZEUR")).toBe("EUR");
    expect(normaliseKrakenAsset("XETH")).toBe("ETH");
    expect(normaliseKrakenAsset("XXDG")).toBe("DOGE");
    expect(normaliseKrakenAsset("DOT.S")).toBe("DOT");
    expect(normaliseKrakenAsset("DOT28.S")).toBe("DOT");
    expect(normaliseKrakenAsset("ETH2.S")).toBe("ETH");
    expect(normaliseKrakenAsset("XBT.M")).toBe("BTC");
    expect(normaliseKrakenAsset("SOL")).toBe("SOL");
    expect(normaliseKrakenAsset("XXBT", { XXBT: "XBT" })).toBe("BTC");
  });

  it("groups ledger entries into trades, rewards and transfers", () => {
    const events = mapKrakenLedger([
      // Buy 0.1 BTC for €3000 + €4.80 fee.
      { refid: "T1", time: 1704189600, type: "trade", asset: "XXBT", amount: "0.1", fee: "0" },
      { refid: "T1", time: 1704189600, type: "trade", asset: "ZEUR", amount: "-3000", fee: "4.8" },
      // Sell 1 ETH for €2000, fee in EUR.
      { refid: "T2", time: 1704276000, type: "trade", asset: "XETH", amount: "-1", fee: "0" },
      { refid: "T2", time: 1704276000, type: "trade", asset: "ZEUR", amount: "2000", fee: "3.2" },
      // Staking reward.
      { refid: "R1", time: 1704362400, type: "staking", asset: "DOT.S", amount: "0.5", fee: "0" },
      // Earn allocation: internal move, ignored.
      { refid: "A1", time: 1704362500, type: "earn", subtype: "allocation", asset: "DOT", amount: "-10", fee: "0" },
      { refid: "A1", time: 1704362500, type: "earn", subtype: "allocation", asset: "DOT.S", amount: "10", fee: "0" },
      // Crypto withdrawal with a network fee.
      { refid: "W1", time: 1704448800, type: "withdrawal", asset: "XXBT", amount: "-0.05", fee: "0.0001" },
    ]);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      kind: "trade",
      side: "buy",
      asset: { kind: "crypto", symbol: "BTC" },
      quantity: "0.1",
      quote: { amount: "3004.8", currency: "EUR" },
      feeQuote: "4.8",
    });
    expect(events[1]).toMatchObject({
      kind: "trade",
      side: "sell",
      quantity: "1",
      quote: { amount: "1996.8", currency: "EUR" },
    });
    expect(events[2]).toMatchObject({ kind: "reward", asset: { symbol: "DOT" }, quantity: "0.5" });
    expect(events[3]).toMatchObject({ kind: "withdrawal", asset: { symbol: "BTC" }, quantity: "0.0501" });
  });

  it("treats a crypto-to-crypto trade as buying the asset received with the asset given", () => {
    const [e] = mapKrakenLedger([
      { refid: "X", time: 1704189600, type: "trade", asset: "XXBT", amount: "-0.01", fee: "0" },
      { refid: "X", time: 1704189600, type: "trade", asset: "XETH", amount: "0.2", fee: "0.0002" },
    ]);
    expect(e).toMatchObject({
      kind: "trade",
      side: "buy",
      asset: { symbol: "ETH" },
      quantity: "0.1998",
      quote: { amount: "0.01", currency: "BTC" },
    });
  });

  it("books staking and earn income as rewards and skips moves between Kraken's wallets", () => {
    const t0 = 1704189600;
    const events = mapKrakenLedger([
      // Auto-earn allocation: a move.
      { refid: "A", time: t0, type: "earn", subtype: "autoallocate", asset: "SOL", amount: "-5", fee: "0" },
      { refid: "A", time: t0, type: "earn", subtype: "autoallocate", asset: "SOL.F", amount: "5", fee: "0" },
      // Earn reward, net of Kraken's fee.
      { refid: "B", time: t0 + 1, type: "earn", subtype: "reward", asset: "SOL.F", amount: "0.02", fee: "0.004" },
      // Old-style earn entries: with a fee a reward, without one a move.
      { refid: "C", time: t0 + 2, type: "earn", asset: "DOT.S", amount: "0.1", fee: "0.015" },
      { refid: "D", time: t0 + 3, type: "earn", asset: "DOT.S", amount: "10", fee: "0" },
      { refid: "E", time: t0 + 4, type: "earn", subtype: "airdrop", asset: "FLR", amount: "12", fee: "0" },
      { refid: "F", time: t0 + 5, type: "invite bonus", asset: "ZEUR", amount: "10", fee: "0" },
      // Fee credits are not an asset.
      { refid: "G", time: t0 + 6, type: "deposit", asset: "KFEE", amount: "1000", fee: "0" },
      // A trade whose fee was paid in fee credits.
      { refid: "H", time: t0 + 7, type: "trade", asset: "XXBT", amount: "0.01", fee: "0" },
      { refid: "H", time: t0 + 7, type: "trade", asset: "ZEUR", amount: "-400", fee: "0" },
      { refid: "H", time: t0 + 7, type: "trade", asset: "KFEE", amount: "0", fee: "64" },
      // A delisted asset converted into USDC.
      {
        refid: "I",
        time: t0 + 8,
        type: "earn",
        subtype: "delistingconversion",
        asset: "LUNA2",
        amount: "-50",
        fee: "0",
      },
      { refid: "I", time: t0 + 8, type: "earn", subtype: "delistingconversion", asset: "USDC", amount: "21", fee: "0" },
    ]);
    expect(events.map((e) => [e.kind, e.asset.kind === "crypto" ? e.asset.symbol : "EUR", qty(e)])).toEqual([
      ["reward", "SOL", "0.016"],
      ["reward", "DOT", "0.085"],
      ["reward", "FLR", "12"],
      ["reward", "EUR", "10"],
      ["trade", "BTC", "0.01"],
      ["trade", "USDC", "21"],
    ]);
    expect(events[4]).toMatchObject({ quote: { amount: "400", currency: "EUR" }, feeQuote: undefined });
    expect(events[5]).toMatchObject({
      side: "buy",
      quote: { amount: "50", currency: "LUNA2" },
      note: "Kraken delisting conversion",
    });
  });

  it("cancels out a move booked as two legs under different refids", () => {
    const t0 = 1704189600;
    const now = t0 + 30 * 86_400;
    const events = mapKrakenLedger(
      [
        // Staked ETH2 converted back to ETH: two refids, an hour apart.
        { refid: "P1", time: t0, type: "transfer", subtype: "", asset: "ETH2.S", amount: "-1.5", fee: "0" },
        { refid: "P2", time: t0 + 3600, type: "adjustment", asset: "XETH", amount: "1.5", fee: "0" },
        // A fork credit with no counterpart is income.
        { refid: "P3", time: t0 + 7200, type: "transfer", subtype: "", asset: "BCH", amount: "0.3", fee: "0" },
        // A real deposit of the same amount is never paired.
        { refid: "P4", time: t0 + 7300, type: "deposit", asset: "XETH", amount: "1.5", fee: "0" },
      ],
      {},
      now,
    );
    expect(events.map((e) => [e.id, e.kind, qty(e)])).toEqual([
      ["P3", "reward", "0.3"],
      ["P4", "deposit", "1.5"],
    ]);
  });

  it("holds back a recent leg whose counterpart may still come", () => {
    const t0 = 1704189600;
    const leg = { refid: "Q1", time: t0, type: "transfer", subtype: "", asset: "XETH", amount: "-2", fee: "0" };
    const early = krakenEvents([leg], {}, t0 + 3600);
    expect(early.events).toEqual([]);
    expect(early.held).toMatchObject([{ refid: "Q1", sym: "ETH" }]);
    // Once the window has passed it's a withdrawal after all.
    const late = krakenEvents([leg], {}, t0 + 3 * 86_400);
    expect(late.events).toMatchObject([{ kind: "withdrawal", quantity: "2" }]);
  });
});

describe("Bitvavo", () => {
  it("signs timestamp + method + /v2 + path + body with HMAC-SHA256 (hex)", () => {
    const sig = bitvavoSignature("secret", 1548172481125, "GET", "/balance");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).not.toBe(bitvavoSignature("secret", 1548172481125, "GET", "/balance?symbol=BTC"));
  });

  it("maps history items to net balance changes", () => {
    const buy = mapBitvavoItem({
      transactionId: "b1",
      executedAt: "2024-01-02T10:00:00.000Z",
      type: "buy",
      sentCurrency: "EUR",
      sentAmount: "500",
      receivedCurrency: "BTC",
      receivedAmount: "0.01",
      feesCurrency: "EUR",
      feesAmount: "1.25",
    });
    expect(buy[0]).toMatchObject({
      kind: "trade",
      side: "buy",
      quantity: "0.01",
      quote: { amount: "501.25", currency: "EUR" },
      feeQuote: "1.25",
    });

    const staking = mapBitvavoItem({
      transactionId: "s1",
      executedAt: "2024-02-01T00:00:00Z",
      type: "staking",
      receivedCurrency: "ETH",
      receivedAmount: "0.001",
    });
    expect(staking[0]).toMatchObject({ kind: "reward", quantity: "0.001" });

    const wd = mapBitvavoItem({
      transactionId: "w1",
      executedAt: "2024-03-01T00:00:00Z",
      type: "withdrawal",
      sentCurrency: "BTC",
      sentAmount: "0.005",
      feesCurrency: "BTC",
      feesAmount: "0.00001",
    });
    expect(wd[0]).toMatchObject({ kind: "withdrawal", quantity: "0.00501" });

    const eurIn = mapBitvavoItem({
      transactionId: "d1",
      executedAt: "2024-01-01T00:00:00Z",
      type: "deposit",
      receivedCurrency: "EUR",
      receivedAmount: "1000",
    });
    expect(eurIn[0]).toMatchObject({ kind: "deposit", asset: { kind: "fiat", currency: "EUR" }, quantity: "1000" });
  });

  const item = (id: string, at: string, type: string, extra: Record<string, string>) => ({
    transactionId: id,
    executedAt: at,
    type,
    ...extra,
  });

  it("keeps fixed staking: locking isn't selling, the release beyond the lock is the reward", () => {
    const first = mapBitvavoHistory([
      item("f1", "2024-01-01T00:00:00Z", "fixed_staking", { sentCurrency: "ETH", sentAmount: "2" }),
      item("f2", "2024-02-01T00:00:00Z", "fixed_staking", { receivedCurrency: "ETH", receivedAmount: "0.004" }),
    ]);
    expect(first.events).toMatchObject([{ id: "f2", kind: "reward", quantity: "0.004" }]);
    expect(first.openLocks).toEqual([{ currency: "ETH", amount: "2" }]);
    // The release comes in a later sync: the cursor carried the lock.
    const later = mapBitvavoHistory(
      [item("f3", "2024-07-01T00:00:00Z", "fixed_staking", { receivedCurrency: "ETH", receivedAmount: "2.03" })],
      first.openLocks,
    );
    expect(later.events).toMatchObject([{ id: "f3", kind: "reward", quantity: "0.03" }]);
    expect(later.openLocks).toEqual([]);
  });

  it("undoes a cancelled withdrawal and pairs moves between Bitvavo's wallets", () => {
    const { events } = mapBitvavoHistory([
      item("w1", "2024-03-01T00:00:00Z", "withdrawal", {
        sentCurrency: "BTC",
        sentAmount: "0.5",
        feesCurrency: "BTC",
        feesAmount: "0.0001",
      }),
      item("c1", "2024-03-01T01:00:00Z", "withdrawal_cancelled", { receivedCurrency: "BTC", receivedAmount: "0.5" }),
      item("i1", "2024-03-02T00:00:00Z", "internal_transfer", { sentCurrency: "SOL", sentAmount: "3" }),
      item("i2", "2024-03-02T00:00:01Z", "internal_transfer", { receivedCurrency: "SOL", receivedAmount: "3" }),
      item("i3", "2024-03-03T00:00:00Z", "internal_transfer", { sentCurrency: "ADA", sentAmount: "100" }),
    ]);
    expect(events.map((e) => [e.id, e.kind, qty(e), e.note])).toEqual([
      // Only the fee that wasn't refunded remains.
      ["w1", "withdrawal", "0.0001", "Bitvavo fee on a cancelled withdrawal"],
      ["i3", "withdrawal", "100", "Bitvavo internal transfer"],
    ]);
  });
});

describe("Coinbase", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "sec1", format: "pem" }).toString();
  const creds = { keyName: "organizations/org-1/apiKeys/key-1", privateKey: pem };

  it("builds an ES256 JWT bound to method, host and path", () => {
    const jwt = coinbaseJwt(creds, "GET", "/v2/accounts?limit=100", 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(header).toMatchObject({ alg: "ES256", kid: creds.keyName, typ: "JWT" });
    expect(header.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(payload).toEqual({
      iss: "cdp",
      sub: creds.keyName,
      nbf: 1_700_000_000,
      exp: 1_700_000_120,
      uri: "GET api.coinbase.com/v2/accounts",
    });
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(s!, "base64url"),
    );
    expect(ok).toBe(true);
  });

  it("maps transactions using their EUR native amount", () => {
    const base = { status: "completed", created_at: "2024-01-05T10:00:00Z" };
    expect(
      mapCoinbaseTx({ ...base, id: "1", type: "buy", amount: { amount: "0.01", currency: "BTC" } }, "400"),
    ).toMatchObject({
      kind: "trade",
      side: "buy",
      quantity: "0.01",
      valueEur: "400",
    });
    expect(
      mapCoinbaseTx({ ...base, id: "2", type: "buy", amount: { amount: "-400", currency: "EUR" } }, "-400"),
    ).toMatchObject({
      kind: "withdrawal",
      asset: { kind: "fiat", currency: "EUR" },
    });
    expect(
      mapCoinbaseTx({ ...base, id: "3", type: "earn_payout", amount: { amount: "0.1", currency: "SOL" } }, "9.5"),
    ).toMatchObject({
      kind: "reward",
      valueEur: "9.5",
    });
    expect(
      mapCoinbaseTx({ ...base, id: "4", type: "send", amount: { amount: "-0.002", currency: "BTC" } }, "-80"),
    ).toMatchObject({
      kind: "withdrawal",
      quantity: "0.002",
    });
    expect(
      mapCoinbaseTx({ ...base, id: "5", type: "staking_transfer", amount: { amount: "-1", currency: "ETH" } }, "-2000"),
    ).toBeNull();
    expect(
      mapCoinbaseTx(
        { ...base, status: "pending", id: "6", type: "buy", amount: { amount: "1", currency: "ETH" } },
        "1",
      ),
    ).toBeNull();
  });

  it("treats the ETH2 wallet as ether and drops moves between Coinbase wallets", () => {
    const base = { status: "completed" };
    const tx = (id: string, type: string, amount: string, currency: string, at: string) => ({
      tx: { ...base, id, type, amount: { amount, currency }, created_at: at },
      eur: undefined,
    });
    const { events, dropped } = mapCoinbaseTxs([
      tx("r1", "staking_reward", "0.001", "ETH2", "2023-01-01T00:00:00Z"),
      // ETH2 retired: out of the ETH2 wallet, into the ETH wallet.
      tx("m1", "retail_eth2_deprecation", "-1.2", "ETH2", "2023-06-01T00:00:00Z"),
      tx("m2", "retail_eth2_deprecation", "1.2", "ETH", "2023-06-01T00:00:05Z"),
      tx("s1", "staking_transfer", "-1", "ETH", "2022-01-01T00:00:00Z"),
      // To a portfolio this key can't see.
      tx("v1", "transfer", "-0.5", "BTC", "2023-07-01T00:00:00Z"),
    ]);
    expect(events.map((e) => [e.id, e.kind, e.asset.kind === "crypto" && e.asset.symbol, qty(e)])).toEqual([
      ["r1", "reward", "ETH", "0.001"],
      ["v1", "withdrawal", "BTC", "0.5"],
    ]);
    expect(dropped.sort()).toEqual(["m1", "m2", "s1"]);
  });
});

describe("IBKR Flex", () => {
  it("parses all Flex date formats", () => {
    expect(parseIbDate("20240115;093000")?.toISOString()).toBe("2024-01-15T09:30:00.000Z");
    expect(parseIbDate("2024-01-15;09:30:00")?.toISOString()).toBe("2024-01-15T09:30:00.000Z");
    expect(parseIbDate("2024-01-15, 09:30:00")?.toISOString()).toBe("2024-01-15T09:30:00.000Z");
    expect(parseIbDate("20240115")?.toISOString()).toBe("2024-01-15T12:00:00.000Z");
    expect(parseIbDate("")).toBeNull();
  });

  it("parses trades, FX conversions, dividends with tax, cash and positions", () => {
    const { events, balances, hasCashReport, warnings } = parseFlexStatement(FLEX_XML);
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(byId["1001"]).toMatchObject({
      kind: "trade",
      side: "buy",
      quantity: "10",
      quote: { amount: "803", currency: "EUR" },
      feeQuote: "3",
    });
    expect(byId["1003:base"]).toMatchObject({ kind: "withdrawal", asset: { currency: "EUR" }, quantity: "1000" });
    expect(byId["1003:quote"]).toMatchObject({ kind: "deposit", asset: { currency: "USD" }, quantity: "1100" });
    expect(byId["1003:comm"]).toMatchObject({ kind: "withdrawal", asset: { currency: "EUR" }, quantity: "2" });
    expect(byId["2002"]).toMatchObject({ kind: "dividend", gross: "1.2", tax: "0.18", currency: "USD" });
    expect(byId["2004"]).toMatchObject({ kind: "reward", asset: { kind: "fiat", currency: "EUR" }, quantity: "2.5" });
    expect(events.some((e) => e.id === "2003")).toBe(false);
    expect(balances).toHaveLength(4);
    expect(hasCashReport).toBe(true);
    expect(warnings[0]).toMatch(/Skipped 1 OPT/);
  });
});
