import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { assets, transactions } from "../src/db/schema.js";
import { TEMPLATE_CSV, guessColumns } from "../src/import/mapping.js";
import {
  detectDateOrder,
  detectDecimal,
  detectDelimiter,
  parseCsv,
  parseDate,
  parseNumber,
} from "../src/import/parse.js";
import { fromLocal } from "../src/lib/time.js";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

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
const yahooHit = (symbol: string, quoteType: string, longname: string) => ({
  quotes: [{ symbol, quoteType, longname, exchDisp: "Amsterdam" }],
});

const ROUTES = {
  ...defaultRoutes,
  "v1/finance/search?q=IE00B4L5Y983": yahooHit("IWDA.AS", "ETF", "iShares Core MSCI World"),
  "v1/finance/search?q=IE00B3RBWM25": yahooHit("VWRL.AS", "ETF", "Vanguard FTSE All-World"),
  "v1/finance/search?q=US0378331005": yahooHit("AAPL", "EQUITY", "Apple Inc."),
  "chart/IWDA.AS": chart("EUR", [["2024-06-03", 90]]),
  "chart/VWRL.AS": chart("EUR", [["2024-06-03", 110]]),
  "api.coingecko.com/api/v3/search?query=BTC": { coins: [{ id: "bitcoin", name: "Bitcoin", symbol: "btc" }] },
  "api.coingecko.com/api/v3/search?query=ETH": { coins: [{ id: "ethereum", name: "Ethereum", symbol: "eth" }] },
  "chart/ETH-EUR": chart("EUR", [
    ["2024-05-31", 1900],
    ["2024-06-01", 2000],
  ]),
};

async function account(name: string, kind: string): Promise<number> {
  return json(await t.api("POST", "/api/accounts", { name, kind })).id;
}

async function upload(content: string, fileName = "export.csv") {
  const res = await t.api("POST", "/api/import/upload", { fileName, content });
  expect(res.statusCode, res.body).toBe(200);
  return json(res);
}

async function preview(uploadId: string, accountId: number, mapping: unknown) {
  const res = await t.api("POST", "/api/import/preview", { uploadId, accountId, mapping });
  expect(res.statusCode, res.body).toBe(200);
  return json(res);
}

async function commit(uploadId: string, accountId: number, mapping: unknown, include: number[] = []) {
  const res = await t.api("POST", "/api/import/commit", { uploadId, accountId, mapping, include });
  expect(res.statusCode, res.body).toBe(200);
  return json(res);
}

const csvRows = async (accountId: number) =>
  t.database.db.select().from(transactions).where(eq(transactions.accountId, accountId));

describe("reading CSV exports", () => {
  it("handles quotes, semicolons, BOMs and blank lines", () => {
    const text = '﻿a;b;c\r\n1;"x;y";"say ""hi"""\r\n\r\n2;"multi\nline";\n';
    expect(detectDelimiter(text)).toBe(";");
    expect(parseCsv(text, ";")).toEqual([
      ["a", "b", "c"],
      ["1", "x;y", 'say "hi"'],
      ["2", "multi\nline", ""],
    ]);
  });

  it("reads numbers the way exports write them, exactly", () => {
    expect(parseNumber("1.234,56", ",")).toBe("1234.56");
    expect(parseNumber("-0,5", ",")).toBe("-0.5");
    expect(parseNumber("€ 1.000", ",")).toBe("1000");
    expect(parseNumber("1,234.56", ".")).toBe("1234.56");
    expect(parseNumber("(12.50)", ".")).toBe("-12.50");
    expect(parseNumber("12.5-", ".")).toBe("-12.5");
    expect(parseNumber("0.123456789012345678", ".")).toBe("0.123456789012345678");
    expect(parseNumber("1E-8", ".")).toBe("0.00000001");
    expect(parseNumber(".5", ".")).toBe("0.5");
    expect(parseNumber("abc", ".")).toBeNull();
    expect(parseNumber("", ".")).toBeNull();
  });

  it("detects decimal commas and the day order", () => {
    expect(detectDecimal(["1.234,56", "10", "0,5"])).toBe(",");
    expect(detectDecimal(["1,234.56", "0.00012"])).toBe(".");
    // "1.234" alone is ambiguous and doesn't decide.
    expect(detectDecimal(["1.234", "2,5"])).toBe(",");
    expect(detectDateOrder(["01-02-2024", "25-12-2024"])).toBe("DMY");
    expect(detectDateOrder(["12/25/2024"])).toBe("MDY");
    expect(detectDateOrder(["2024-03-01 10:00"])).toBe("YMD");
  });

  it("reads dates as local time in the configured zone", () => {
    // 10:30 in Amsterdam in winter is 09:30 UTC; in summer 08:30 UTC.
    expect(parseDate("15-01-2024", "DMY", "10:30")!.toISOString()).toBe("2024-01-15T09:30:00.000Z");
    expect(parseDate("15-07-2024 10:30", "DMY")!.toISOString()).toBe("2024-07-15T08:30:00.000Z");
    // A date alone is noon local, so it stays on that day.
    expect(parseDate("2024-01-01", "YMD")!.toISOString()).toBe("2024-01-01T11:00:00.000Z");
    expect(parseDate("2024-01-01T23:30:00Z", "YMD")!.toISOString()).toBe("2024-01-01T23:30:00.000Z");
    expect(parseDate("03/04/2024", "MDY")!.toISOString().slice(0, 10)).toBe("2024-03-04");
    expect(parseDate("31-02-2024", "DMY")).toBeNull();
    expect(parseDate("yesterday", "DMY")).toBeNull();
  });

  it("converts wall-clock time around DST changes", () => {
    // 02:30 on 31 March 2024 doesn't exist in Amsterdam (clocks jump 02:00 → 03:00).
    expect(fromLocal(2024, 3, 31, 2, 30).toISOString()).toBe("2024-03-31T01:30:00.000Z");
    expect(fromLocal(2024, 3, 31, 3, 30).toISOString()).toBe("2024-03-31T01:30:00.000Z");
    expect(fromLocal(2024, 10, 27, 12, 0).toISOString()).toBe("2024-10-27T11:00:00.000Z");
  });

  it("guesses columns from English and Dutch headers", () => {
    const c = guessColumns(["Datum", "Tijd", "Product", "ISIN", "Aantal", "Koers", "Valuta", "Transactiekosten"]);
    expect(c).toMatchObject({ date: 0, time: 1, name: 2, isin: 3, quantity: 4, price: 5, currency: 6, fee: 7 });
    expect(guessColumns(["timestamp", "type", "asset", "amount"]).quantity).toBeNull();
  });
});

describe("CSV import", () => {
  it("previews the template without creating anything, then imports it", async () => {
    t = await createTestApp(ROUTES);
    const acc = await account("DEGIRO", "broker");
    const assetsBefore = (await t.database.db.select().from(assets)).length;

    const up = await upload(TEMPLATE_CSV, "template.csv");
    expect(up.preset).toBe("Kluishuis template");
    const plan = await preview(up.uploadId, acc, up.mapping);
    expect(plan.summary).toMatchObject({ new: 7, error: 0 });
    expect(plan.assets.map((a: any) => [a.key, a.match.priceRef])).toEqual(
      expect.arrayContaining([
        ["fiat:EUR", "EUR"],
        ["security:IE00B4L5Y983", "IWDA.AS"],
        ["crypto:BTC", "bitcoin"],
        ["security:IE00B3RBWM25", "VWRL.AS"],
        ["crypto:ETH", "ethereum"],
        ["security:US0378331005", "AAPL"],
      ]),
    );
    // A dry run: nothing created yet.
    expect((await t.database.db.select().from(assets)).length).toBe(assetsBefore);
    expect(await csvRows(acc)).toHaveLength(0);

    const res = await commit(up.uploadId, acc, up.mapping);
    expect(res).toMatchObject({ inserted: 7, warnings: [] });
    expect(res.newAssets).toEqual(expect.arrayContaining(["IWDA → Yahoo IWDA.AS", "BTC → CoinGecko bitcoin"]));
    const rows = await csvRows(acc);
    expect(rows.every((r) => r.source === "csv" && r.importId === res.importId)).toBe(true);
    const by = (type: string) => rows.find((r) => r.type === type)!;
    expect(by("buy")).toMatchObject({ quantity: "10.000000000000000000", currency: "EUR" });
    expect(Number(by("buy").price)).toBe(85.2);
    expect(Number(by("buy").feeEur)).toBe(2);
    expect(by("buy").occurredAt.toISOString()).toBe("2024-01-15T09:30:00.000Z");
    expect(by("dividend")).toMatchObject({ currency: "USD" });
    expect([Number(by("dividend").amount), Number(by("dividend").taxWithheld)]).toEqual([12.5, 1.88]);
    expect(Number(by("dividend").fxRate)).toBeCloseTo(1 / 1.1, 6);
    // No price in the file: the reward is valued at that day's close.
    expect(Number(by("reward").price)).toBe(2000);
    expect(Number(by("split").quantity)).toBe(4);
    expect(Number(by("deposit").quantity)).toBe(2000);

    // The same file again: everything is already there.
    const again = await upload(TEMPLATE_CSV, "template.csv");
    expect((await preview(again.uploadId, acc, again.mapping)).summary).toMatchObject({ new: 0, duplicate: 7 });
    expect((await commit(again.uploadId, acc, again.mapping)).inserted).toBe(0);

    const list = json<any[]>(await t.api("GET", "/api/imports"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ fileName: "template.csv", inserted: 7, remaining: 7, accountName: "DEGIRO" });
  });

  it("reads a Dutch semicolon export with decimal commas and sells as negative quantities", async () => {
    t = await createTestApp(ROUTES);
    const acc = await account("DEGIRO", "broker");
    const csv = [
      "Transacties",
      "Gegenereerd op 01-03-2024",
      "Datum;Tijd;Product;ISIN;Aantal;Koers;Valuta;Kosten",
      "15-01-2024;10:30;ISHARES CORE MSCI WORLD;IE00B4L5Y983;10;85,20;EUR;2,00",
      "20-02-2024;14:05;ISHARES CORE MSCI WORLD;IE00B4L5Y983;-3;1.090,50;EUR;1,00",
    ].join("\n");
    const up = await upload(csv);
    expect(up.mapping).toMatchObject({ skipRows: 2, typeMode: "sign" });
    const plan = await preview(up.uploadId, acc, up.mapping);
    expect(plan.detected).toMatchObject({ delimiter: ";", decimal: ",", dateOrder: "DMY" });
    expect(plan.rows.map((r: any) => [r.line, r.type, r.quantity, r.price, r.fee])).toEqual([
      [4, "buy", "10", "85.2", "2"],
      [5, "sell", "3", "1090.5", "1"],
    ]);
    expect(plan.assets[0].match).toMatchObject({ priceRef: "IWDA.AS", id: expect.any(Number) });
    expect(plan.assets[0].match.id).toBeLessThan(0); // to be created

    const res = await commit(up.uploadId, acc, up.mapping);
    expect(res.inserted).toBe(2);
  });

  it("asks what unknown type values mean, and can skip them", async () => {
    t = await createTestApp(ROUTES);
    const acc = await account("Exchange", "exchange");
    const csv = "Date,Type,Asset,Quantity,Price\n2024-02-01,Koop,BTC,0.1,40000\n2024-02-02,Airdrop,BTC,0.001,40000\n";
    const up = await upload(csv);
    expect(up.mapping.typeValues).toEqual({ Koop: "buy" });
    const plan = await preview(up.uploadId, acc, up.mapping);
    expect(plan.typeValues).toEqual([
      { value: "Koop", count: 1 },
      { value: "Airdrop", count: 1 },
    ]);
    expect(plan.rows[1]).toMatchObject({ status: "error", message: "Unknown type “Airdrop”: choose what it means" });
    const skip = { ...up.mapping, typeValues: { Koop: "buy", Airdrop: "skip" } };
    expect((await preview(up.uploadId, acc, skip)).summary).toMatchObject({ new: 1, skipped: 1, error: 0 });
    const reward = { ...up.mapping, typeValues: { Koop: "buy", Airdrop: "reward" } };
    expect((await preview(up.uploadId, acc, reward)).summary).toMatchObject({ new: 2 });
  });

  it("flags rows that look like transactions from another source, and imports them only when asked", async () => {
    t = await createTestApp(ROUTES);
    const acc = await account("DEGIRO", "broker");
    const first = await upload(TEMPLATE_CSV);
    await commit(first.uploadId, acc, first.mapping);

    // The same buy in another layout (so another import id): a likely duplicate, not a sure one.
    const other = "Datum;Product;ISIN;Aantal;Koers\n15-01-2024;IWDA;IE00B4L5Y983;10;85,20\n";
    const up = await upload(other);
    const mapping = { ...up.mapping, typeMode: "fixed", fixedType: "buy" };
    const plan = await preview(up.uploadId, acc, mapping);
    expect(plan.rows[0]).toMatchObject({ status: "possible-duplicate", line: 2 });
    expect(plan.rows[0].message).toMatch(/earlier import/);
    expect((await commit(up.uploadId, acc, mapping)).inserted).toBe(0);
    const up2 = await upload(other);
    expect((await commit(up2.uploadId, acc, mapping, [2])).inserted).toBe(1);
  });

  it("undoes an import, remembers single deletions, and unlinks transfers it created", async () => {
    t = await createTestApp(ROUTES);
    const exchange = await account("Bitvavo", "exchange");
    const wallet = await account("Ledger", "wallet");
    const btc = json(
      await t.api("POST", "/api/assets", {
        assetClass: "crypto",
        name: "Bitcoin",
        symbol: "BTC",
        priceSource: "coingecko",
        priceRef: "bitcoin",
      }),
    );
    // The wallet already saw the coins arrive (from a chain sync).
    const [arrival] = await t.database.db
      .insert(transactions)
      .values({
        accountId: wallet,
        assetId: btc.id,
        type: "deposit",
        occurredAt: new Date("2024-03-01T13:00:00Z"),
        quantity: "0.4995",
        price: "50000",
        source: "chain",
        externalId: "tx1",
      })
      .returning();

    const csv = "date,type,symbol,quantity,price\n2024-03-01,buy,BTC,1,40000\n2024-03-01,withdrawal,BTC,0.5,\n";
    const up = await upload(csv);
    const res = await commit(up.uploadId, exchange, up.mapping);
    expect(res).toMatchObject({ inserted: 2, transfersMatched: 1 });
    const [linked] = await t.database.db.select().from(transactions).where(eq(transactions.id, arrival!.id));
    expect(linked!.type).toBe("transfer_in");

    // Deleting one imported row is remembered: importing the file again won't bring it back.
    const buy = (await csvRows(exchange)).find((r) => r.type === "buy")!;
    await t.api("DELETE", `/api/transactions/${buy.id}`);
    const again = await upload(csv);
    const plan = await preview(again.uploadId, exchange, again.mapping);
    expect(plan.rows.map((r: any) => r.status)).toEqual(["deleted", "duplicate"]);

    const undo = json(await t.api("DELETE", `/api/imports/${res.importId}`));
    expect(undo).toMatchObject({ deleted: 1, unlinked: 1 });
    expect(await csvRows(exchange)).toHaveLength(0);
    const [back] = await t.database.db.select().from(transactions).where(eq(transactions.id, arrival!.id));
    expect(back).toMatchObject({ type: "deposit", transferGroup: null });
    expect(json<any[]>(await t.api("GET", "/api/imports"))).toHaveLength(0);
  });

  it("saves a mapping as a preset and applies it to the next file with the same columns", async () => {
    t = await createTestApp(ROUTES);
    const csv = "When;What;Coin;Units\n01-02-2024;in;ETH;1\n";
    const up = await upload(csv);
    expect(up.preset).toBeNull();
    const mapping = {
      ...up.mapping,
      columns: { ...up.mapping.columns, date: 0, type: 1, symbol: 2, quantity: 3 },
      typeValues: { in: "deposit" },
    };
    const saved = await t.api("POST", "/api/import/presets", {
      name: "My wallet app",
      headers: ["When", "What", "Coin", "Units"],
      mapping,
    });
    expect(saved.statusCode).toBe(200);
    const next = await upload("When;What;Coin;Units\n05-02-2024;in;ETH;2\n");
    expect(next.preset).toBe("My wallet app");
    expect(next.mapping.typeValues).toEqual({ in: "deposit" });
    expect(json<any[]>(await t.api("GET", "/api/import/presets")).map((p) => p.name)).toEqual(["My wallet app"]);
  });

  it("picks a sensible listing when the file has only an ISIN and a product name", async () => {
    // What Yahoo returns for IE00BK5BQT80: a London USD line and an odd quote named after the ISIN.
    t = await createTestApp({
      ...ROUTES,
      "v1/finance/search?q=IE00BK5BQT80": {
        quotes: [
          { symbol: "IE00BK5BQT80.SG", quoteType: "MUTUALFUND", longname: "Vanguard FTSE All-World UCITS E" },
          { symbol: "VWRA.L", quoteType: "ETF", longname: "Vanguard FTSE All-World UCITS ETF USD Acc" },
        ],
      },
      "chart/VWRA.L": chart("USD", [["2024-06-03", 130]]),
      "chart/IE00BK5BQT80.SG": chart("EUR", [["2024-06-03", 120]]),
      // A ticker-only file: IWDA has several listings; the euro one wins.
      "v1/finance/search?q=IWDA": {
        quotes: [
          { symbol: "IWDA.L", quoteType: "ETF", longname: "iShares Core MSCI World" },
          { symbol: "IWDA.AS", quoteType: "ETF", longname: "iShares Core MSCI World" },
        ],
      },
    });
    const acc = await account("Broker", "broker");
    const up = await upload(
      "Datum;Product;ISIN;Aantal;Koers\n20-02-2024;VANGUARD FTSE ALL-WORLD;IE00BK5BQT80;5;110,10\n",
    );
    const plan = await preview(up.uploadId, acc, { ...up.mapping, typeMode: "fixed" });
    expect(plan.assets[0].match).toMatchObject({ priceRef: "VWRA.L", symbol: "VWRA" });

    const up2 = await upload("date,symbol,quantity,price\n2024-02-20,IWDA,1,80\n");
    const plan2 = await preview(up2.uploadId, acc, { ...up2.mapping, typeMode: "fixed" });
    expect(plan2.assets[0].match).toMatchObject({ priceRef: "IWDA.AS", symbol: "IWDA" });
  });

  it("serves the template and rejects bad input", async () => {
    t = await createTestApp(ROUTES);
    const tpl = await t.api("GET", "/api/import/template.csv");
    expect(tpl.headers["content-type"]).toContain("text/csv");
    expect(tpl.body.split("\r\n")[0]).toBe(
      "date,time,type,symbol,isin,name,asset_type,quantity,price,total,currency,fee,amount,tax_withheld,notes,id",
    );
    const acc = await account("X", "broker");
    const gone = await t.api("POST", "/api/import/preview", {
      uploadId: "00000000-0000-4000-8000-000000000000",
      accountId: acc,
      mapping: {},
    });
    expect(gone.statusCode).toBe(410);
    const up = await upload("date,type,symbol,quantity,price\nnot a date,buy,BTC,1,1\n2024-01-01,buy,BTC,x,1\n");
    const plan = await preview(up.uploadId, acc, up.mapping);
    expect(plan.rows.map((r: any) => r.message)).toEqual([
      "Date “not a date” can't be read",
      "Quantity “x” is not a number",
    ]);
  });
});
