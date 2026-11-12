import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../src/db/schema.js";
import { moneyWeightedReturns } from "../src/domain/assetReturns.js";
import { createTestApp, type TestApp } from "./helpers.js";

/**
 * The money-weighted return per holding and per account, each case worked by hand. "Today" is
 * 1 January 2026, so money that went in on 1 January 2025 has been in exactly 365 days: one year.
 * In = €1,000 and out or worth €1,100 a year later is 10% a year, whatever the route.
 */
let t: TestApp;
let account: number;
const START = new Date("2025-01-01T12:00:00Z");
const TODAY = new Date("2026-01-01T09:00:00Z");

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date("2026-01-01T12:00:00Z"), toFake: ["Date"], shouldAdvanceTime: true });
  t = await createTestApp();
  account = await newAccount("Broker");
});
afterEach(async () => {
  vi.useRealTimers();
  await t?.close();
});

const db = () => t.database.db;
async function newAccount(name: string) {
  const [a] = await db().insert(s.accounts).values({ name, kind: "broker" }).returning();
  return a!.id;
}
async function newAsset(symbol: string, extra: Partial<typeof s.assets.$inferInsert> = {}) {
  const [a] = await db()
    .insert(s.assets)
    .values({ assetClass: "stock", name: symbol, symbol, priceSource: "manual", ...extra })
    .returning();
  return a!.id;
}
const euro = async () => (await db().select().from(s.assets).where(eq(s.assets.priceRef, "EUR")))[0]!.id;
const tx = (
  row: Partial<typeof s.transactions.$inferInsert> & {
    assetId: number;
    type: (typeof s.transactions.$inferInsert)["type"];
  },
) =>
  db()
    .insert(s.transactions)
    .values({ accountId: account, occurredAt: START, ...row });
const returns = async (byKey: [string, number][], byAccount: [number, number][] = []) => {
  const r = await moneyWeightedReturns(db(), { byKey: new Map(byKey), byAccount: new Map(byAccount) });
  return { key: (k: string) => r.byKey.get(k), account: (id: number) => r.byAccount.get(id) };
};
const TEN = { pct: 10, annualised: true };

describe("money-weighted return per holding", () => {
  it("counts a buy with its costs as money in: 1,000 + 10 in, worth 1,111 a year later is 10%", async () => {
    const a = await newAsset("AAA");
    await tx({ assetId: a, type: "buy", quantity: "10", price: "100", feeEur: "10" });
    const r = await returns([[`a${a}`, 1111]], [[account, 1111]]);
    expect(r.key(`a${a}`)).toEqual(TEN);
    // Not paid from the account's cash, so the money came into the account too.
    expect(r.account(account)).toEqual(TEN);
  });

  it("counts a sale after costs and a dividend after tax as money out", async () => {
    // 2 × 500 in. A year later one is sold for 600 − 5 costs; the other is worth 505: 1,100 out.
    const sold = await newAsset("SOLD");
    await tx({ assetId: sold, type: "buy", quantity: "2", price: "500" });
    await tx({ assetId: sold, type: "sell", quantity: "1", price: "600", feeEur: "5", occurredAt: TODAY });
    // 1,000 in. A dividend of $100 with $15 withheld at 0.8 €/$ is 68; worth 1,032: 1,100 out.
    const paid = await newAsset("PAID");
    await tx({ assetId: paid, type: "buy", quantity: "10", price: "100" });
    await tx({
      assetId: paid,
      type: "dividend",
      amount: "100",
      taxWithheld: "15",
      currency: "USD",
      fxRate: "0.8",
      occurredAt: TODAY,
    });
    const r = await returns([
      [`a${sold}`, 505],
      [`a${paid}`, 1032],
    ]);
    expect(r.key(`a${sold}`)).toEqual(TEN);
    expect(r.key(`a${paid}`)).toEqual(TEN);
  });

  it("converts a price in another currency: 10 × $125 at 0.8 is 1,000 in", async () => {
    const a = await newAsset("USD1", { currency: "USD" });
    await tx({ assetId: a, type: "buy", quantity: "10", price: "125", currency: "USD", fxRate: "0.8" });
    expect((await returns([[`a${a}`, 1100]])).key(`a${a}`)).toEqual(TEN);
  });

  it("gives the return over the period, not per year, for money in less than a year", async () => {
    // 1,000 in on 2 December, worth 1,020 thirty days later: 2%, not the 27% a year that would be.
    const a = await newAsset("NEW");
    await tx({ assetId: a, type: "buy", quantity: "10", price: "100", occurredAt: new Date("2025-12-02T12:00:00Z") });
    const r = (await returns([[`a${a}`, 1020]])).key(`a${a}`)!;
    expect(r.annualised).toBe(false);
    expect(r.pct).toBeCloseTo(2, 3);
  });

  it("values an asset brought in or taken out at that day's price, else at the price entered", async () => {
    // 2 coins brought in when the last close before was 400: 800 in; worth 880.
    const priced = await newAsset("COIN", { assetClass: "crypto" });
    await db()
      .insert(s.priceHistory)
      .values([
        { assetId: priced, day: "2024-12-30", close: "390", currency: "EUR", closeEur: "390" },
        { assetId: priced, day: "2024-12-31", close: "400", currency: "EUR", closeEur: "400" },
        { assetId: priced, day: "2025-01-02", close: "999", currency: "EUR", closeEur: "999" },
      ]);
    await tx({ assetId: priced, type: "deposit", quantity: "2", price: "1" });
    // No price history: 2 × the 300 entered = 600 in. A year later 1 is taken out at 330 (entered),
    // and the one left is worth 330: 660 out.
    const unpriced = await newAsset("RARE", { assetClass: "crypto" });
    await tx({ assetId: unpriced, type: "deposit", quantity: "2", price: "300" });
    await tx({ assetId: unpriced, type: "withdrawal", quantity: "1", price: "330", occurredAt: TODAY });
    const r = await returns([
      [`a${priced}`, 880],
      [`a${unpriced}`, 330],
    ]);
    expect(r.key(`a${priced}`)).toEqual(TEN);
    expect(r.key(`a${unpriced}`)).toEqual(TEN);
  });

  it("has no return when money only went one way, and leaves a hidden asset out", async () => {
    const worthless = await newAsset("ZERO");
    await tx({ assetId: worthless, type: "buy", quantity: "1", price: "100" });
    const hidden = await newAsset("BENCH", { hidden: true });
    await tx({ assetId: hidden, type: "buy", quantity: "1", price: "100" });
    const r = await returns([[`a${worthless}`, 0]]);
    expect(r.key(`a${worthless}`)).toEqual({ pct: null, annualised: true });
    expect(r.key(`a${hidden}`)).toBeUndefined();
  });

  it("counts physical metal from what was paid and what a sale brought in", async () => {
    const [gold] = await db().select().from(s.assets).where(eq(s.assets.priceRef, "XAU"));
    const [silver] = await db().select().from(s.assets).where(eq(s.assets.priceRef, "XAG"));
    const item = { accountId: account, product: "Bar", grossWeightG: "100", purity: "0.9999" };
    // Gold: 2,000 paid, worth 2,200. Silver: 1,000 paid, sold a year later for 1,100, nothing left.
    await db()
      .insert(s.metalItems)
      .values([
        { ...item, metal: "gold", purchaseDate: "2025-01-01", purchasePriceEur: "2000" },
        {
          ...item,
          metal: "silver",
          purchaseDate: "2025-01-01",
          purchasePriceEur: "1000",
          soldDate: "2026-01-01",
          salePriceEur: "1100",
        },
      ]);
    const r = await returns([[`p${gold!.id}`, 2200]], [[account, 2200]]);
    expect(r.key(`p${gold!.id}`)).toEqual(TEN);
    expect(r.key(`p${silver!.id}`)).toEqual(TEN);
    // The place they're kept: 3,000 in, 1,100 out and 2,200 left a year later.
    expect(r.account(account)).toEqual(TEN);
  });
});

describe("money-weighted return per account", () => {
  it("counts only money crossing the account's edge: a buy paid from its cash isn't", async () => {
    const eur = await euro();
    const a = await newAsset("AAA");
    await tx({ assetId: eur, type: "deposit", quantity: "1000", price: "1" });
    await tx({ assetId: a, type: "buy", quantity: "5", price: "100", settleAssetId: eur });
    await tx({ assetId: a, type: "dividend", amount: "20", settleAssetId: eur, occurredAt: TODAY });
    // 1,000 came in; a year later the account holds 1,100 in cash and shares together.
    const r = await returns([[`a${a}`, 530]], [[account, 1100]]);
    expect(r.account(account)).toEqual(TEN);
    // Cash is no holding with a return of its own.
    expect(r.key(`a${eur}`)).toBeUndefined();
    // The shares: 500 in, 20 dividend and 530 left is 550 out.
    expect(r.key(`a${a}`)).toEqual(TEN);
  });

  it("counts a move between your own accounts for each account, not for the holding", async () => {
    const other = await newAccount("Wallet");
    const coin = await newAsset("COIN", { assetClass: "crypto" });
    await db()
      .insert(s.priceHistory)
      .values([
        { assetId: coin, day: "2025-01-01", close: "400", currency: "EUR", closeEur: "400" },
        { assetId: coin, day: "2026-01-01", close: "440", currency: "EUR", closeEur: "440" },
      ]);
    // 2 coins arrive in the wallet at 400 each: 800 in. A year later 1 leaves at 440; 1 is left at 440.
    await tx({ accountId: other, assetId: coin, type: "transfer_in", quantity: "2" });
    await tx({ accountId: other, assetId: coin, type: "transfer_out", quantity: "1", occurredAt: TODAY });
    const r = await returns([], [[other, 440]]);
    expect(r.account(other)).toEqual(TEN);
    expect(r.key(`a${coin}`)).toBeUndefined();
  });
});
