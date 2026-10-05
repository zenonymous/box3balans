// Regression tests for issues found in the project review.
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { transactions } from "../src/db/schema.js";
import { matchTransfers } from "../src/sync/transfers.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

async function exchangeAndWallet() {
  const ex = json(await t!.api("POST", "/api/accounts", { name: "Exchange", kind: "exchange" }));
  const wallet = json(await t!.api("POST", "/api/accounts", { name: "Wallet", kind: "wallet" }));
  const btc = json(
    await t!.api("POST", "/api/assets", {
      assetClass: "crypto",
      name: "Bitcoin",
      symbol: "BTC",
      priceSource: "coingecko",
      priceRef: "bitcoin",
    }),
  );
  const db = t!.database.db;
  await db.insert(transactions).values([
    {
      accountId: ex.id,
      assetId: btc.id,
      type: "buy",
      occurredAt: new Date("2024-01-01T12:00:00Z"),
      quantity: "1",
      price: "30000",
      source: "api",
      externalId: "b1",
    },
    {
      accountId: ex.id,
      assetId: btc.id,
      type: "withdrawal",
      occurredAt: new Date("2024-02-01T12:00:00Z"),
      quantity: "0.5",
      source: "api",
      externalId: "w1",
    },
    {
      accountId: wallet.id,
      assetId: btc.id,
      type: "deposit",
      occurredAt: new Date("2024-02-01T13:00:00Z"),
      quantity: "0.4999",
      price: "40000",
      source: "chain",
      externalId: "bitcoin:d1",
    },
  ]);
  return { ex, wallet, btc };
}

describe("review fixes", () => {
  it("#5 editing a foreign-currency transaction accepts a comma-decimal FX rate", async () => {
    t = await createTestApp();
    const acc = json(await t.api("POST", "/api/accounts", { name: "B", kind: "broker" }));
    const a = json(
      await t.api("POST", "/api/assets", {
        assetClass: "stock",
        name: "Apple",
        symbol: "AAPL",
        priceSource: "yahoo",
        priceRef: "AAPL",
      }),
    );
    const created = json(
      await t.api("POST", "/api/transactions", {
        accountId: acc.id,
        assetId: a.id,
        type: "buy",
        occurredAt: "2024-01-15",
        quantity: "1",
        price: "100",
        currency: "USD",
        fxRate: "0,9",
      }),
    );
    const upd = await t.api("PUT", `/api/transactions/${created.id}`, { fxRate: "0,91" });
    expect(upd.statusCode).toBe(200);
    expect(Number(json(upd).fxRate)).toBe(0.91);
    // And a transaction can't be turned into half a transfer.
    expect((await t.api("PUT", `/api/transactions/${created.id}`, { type: "transfer_in" })).statusCode).toBe(400);
  });

  it("#8 an auto-matched transfer can be unlinked and is not matched again", async () => {
    t = await createTestApp();
    const { wallet } = await exchangeAndWallet();
    expect(await matchTransfers(t.database.db)).toBe(1);
    const leg = json(await t.api("GET", `/api/transactions?accountId=${wallet.id}`)).items[0];
    expect(leg.type).toBe("transfer_in");

    const res = await t.api("POST", `/api/transactions/${leg.id}/unlink`);
    expect(json(res)).toEqual({ ok: true, unlinked: 2 });
    const rows = await t.database.db.select().from(transactions).where(eq(transactions.noAutoMatch, true));
    expect(rows.map((r) => r.type).sort()).toEqual(["deposit", "withdrawal"]);
    expect(rows.every((r) => r.transferGroup === null)).toBe(true);
    expect(await matchTransfers(t.database.db)).toBe(0);
    expect((await t.api("POST", `/api/transactions/${leg.id}/unlink`)).statusCode).toBe(400);
  });

  it("#13 concurrent matching links each withdrawal once", async () => {
    t = await createTestApp();
    const { btc } = await exchangeAndWallet();
    const counts = await Promise.all([
      matchTransfers(t.database.db),
      matchTransfers(t.database.db),
      matchTransfers(t.database.db),
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    const legs = await t.database.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.assetId, btc.id), eq(transactions.type, "transfer_in")));
    expect(legs).toHaveLength(1);
  });
});

describe("review fixes: sync", () => {
  it("#6 deleting one leg of an imported swap stays deleted on the next sync", async () => {
    const { AssetResolver } = await import("../src/sync/assets.js");
    const { Importer } = await import("../src/sync/importer.js");
    const { HistoryService } = await import("../src/prices/history.js");
    t = await createTestApp();
    const acc = json(await t.api("POST", "/api/accounts", { name: "W", kind: "wallet" }));
    const db = t.database.db;
    const run = () =>
      new Importer(
        db,
        new AssetResolver(db, t!.fetch),
        t!.prices.fx,
        new HistoryService(db, t!.prices.fx, t!.fetch),
      ).import(acc.id, "chain", [
        {
          kind: "trade",
          id: "ethereum:0xswap",
          at: new Date("2024-02-01T00:00:00Z"),
          side: "buy",
          asset: { kind: "crypto", symbol: "ETH", coingeckoId: "ethereum" },
          quantity: "1",
          quote: { amount: "2000", currency: "USDC" },
          quoteRef: { kind: "crypto", symbol: "USDC", coingeckoId: "usd-coin" },
          valueEur: "1800",
        },
      ]);
    expect((await run()).inserted).toBe(2);
    const out = json(await t.api("GET", `/api/transactions?accountId=${acc.id}`)).items.find((x: any) =>
      x.externalId.endsWith(":out"),
    );
    await t.api("DELETE", `/api/transactions/${out.id}`);
    const again = await run();
    expect(again).toMatchObject({ inserted: 0, ignored: 1 });
    expect(json(await t.api("GET", `/api/transactions?accountId=${acc.id}`)).total).toBe(1);
  });
});

describe("review fixes: auth", () => {
  it("#9 concurrent first-run setups create exactly one user", async () => {
    t = await createTestApp(undefined, { login: false });
    const results = await Promise.all(
      ["alice", "mallory", "eve"].map((u) =>
        t!.api("POST", "/api/auth/setup", { username: u, password: "correct horse battery" }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
  });
});

describe("review fixes: clear errors", () => {
  it("#10 deleting a settlement cash asset or reusing a ticker gives a clear 409", async () => {
    t = await createTestApp();
    const acc = json(await t.api("POST", "/api/accounts", { name: "B", kind: "broker" }));
    const usd = json(
      await t.api("POST", "/api/assets", {
        assetClass: "cash",
        name: "Cash USD",
        symbol: "USD",
        priceSource: "fx",
        currency: "USD",
      }),
    );
    const a = json(
      await t.api("POST", "/api/assets", {
        assetClass: "stock",
        name: "Apple",
        symbol: "AAPL",
        priceSource: "yahoo",
        priceRef: "AAPL",
      }),
    );
    await t.api("POST", "/api/transactions", {
      accountId: acc.id,
      assetId: a.id,
      type: "buy",
      occurredAt: "2024-01-15",
      quantity: "1",
      price: "100",
      currency: "USD",
      fxRate: "0.9",
      settleCash: true,
    });
    const del = await t.api("DELETE", `/api/assets/${usd.id}`);
    expect(del.statusCode).toBe(409);
    expect(json(del).error).toMatch(/settle trades/);

    const v = json(
      await t.api("POST", "/api/assets", {
        assetClass: "etf",
        name: "V",
        symbol: "VUSA",
        priceSource: "yahoo",
        priceRef: "VUSA.L",
      }),
    );
    const put = await t.api("PUT", `/api/assets/${v.id}`, { priceRef: "AAPL" });
    expect(put.statusCode).toBe(409);
    expect(json(put).error).toBe("AAPL is already used by “Apple”");
  });
});

describe("review fixes: CSV", () => {
  it("#11 neutralises spreadsheet formulas but keeps negative numbers numeric", async () => {
    const { toCsv } = await import("../src/lib/csv.js");
    const csv = toCsv(
      [{ name: '=HYPERLINK("http://x","claim")', v: "-12.5", at: "@SUM(A1)", plus: "+31 6" }],
      [
        { header: "Name", value: (r) => r.name },
        { header: "Value", value: (r) => r.v },
        { header: "At", value: (r) => r.at },
        { header: "Plus", value: (r) => r.plus },
      ],
    );
    const line = csv.replace(/^\uFEFF/, "").split("\r\n")[1]!;
    expect(line).toBe(`"'=HYPERLINK(""http://x"",""claim"")",-12.5,'@SUM(A1),'+31 6`);
  });

  it("#10 safety net: finds the Postgres error code through wrappers", async () => {
    const { pgErrorCode } = await import("../src/lib/errors.js");
    expect(pgErrorCode(new Error("x", { cause: Object.assign(new Error("db"), { code: "23505" }) }))).toBe("23505");
    expect(pgErrorCode(Object.assign(new Error("fs"), { code: "ENOENT" }))).toBeUndefined();
  });
});

describe("review fixes: wallets", () => {
  it("#17 refuses to follow a TronGrid next-page link to another host", async () => {
    const { tronAdapter } = await import("../src/wallets/tron.js");
    const { fakeFetch } = await import("./helpers.js");
    const fetchFn = fakeFetch({
      "api.trongrid.io/v1/accounts/": { data: [], meta: { links: { next: "https://evil.example/steal" } } },
    });
    await expect(
      tronAdapter().fetch([{ address: "TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm" }], {
        fetchFn,
        sleep: async () => {},
        cursor: null,
      }),
    ).rejects.toThrow(/unexpected next-page link/);
    expect(fetchFn.calls.some((u) => u.includes("evil.example"))).toBe(false);
  });
});
