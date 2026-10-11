import { afterEach, describe, expect, it } from "vitest";
import { readStatement } from "../src/import/statement.js";
import { createTestApp, type TestApp } from "./helpers.js";

// Made-up files in the layout of DEGIRO's exports, not real accounts.
const lines = (...l: string[]) => l.join("\n") + "\n";

const ACCOUNT = lines(
  "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id",
  // After the statement's day: must not count.
  '06-01-2025,09:00,06-01-2025,ASML HOLDING,NL0010273215,"Koop 1 @ 700 EUR",,EUR,"-700,00",EUR,"100,00",o-3',
  '15-11-2024,09:00,15-11-2024,,,Flatex Interest Income,,EUR,"0,35",EUR,"800,35",',
  '10-06-2024,09:00,10-06-2024,ASML HOLDING,NL0010273215,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"800,00",o-2',
  '10-06-2024,09:00,10-06-2024,ASML HOLDING,NL0010273215,"Koop 2 @ 600 EUR",,EUR,"-1200,00",EUR,"802,00",o-2',
  '05-03-2024,09:10,05-03-2024,ISHARES CORE MSCI WORLD,IE00B4L5Y983,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-1,00",EUR,"2002,00",o-1',
  '05-03-2024,09:10,05-03-2024,ISHARES CORE MSCI WORLD,IE00B4L5Y983,"Koop 10 @ 88,14 EUR",,EUR,"-881,40",EUR,"2003,00",o-1',
);

const PORTFOLIO = lines(
  "Product,Symbool/ISIN,Aantal,Slotkoers,Lokale waarde,,Waarde in EUR",
  'CASH & CASH FUND & FTX CASH (EUR),,,,EUR,"12,34","12,34"',
  'ASML HOLDING,NL0010273215,2,"677,40",EUR,"1354,80","1354,80"',
  'ISHARES CORE MSCI WORLD,IE00B4L5Y983,9,"100,00",EUR,"900,00","900,00"',
  'MICROSOFT CORP,US5949181045,3,"420,00",USD,"1260,00","1150,00"',
);

describe("reading a portfolio statement", () => {
  it("reads positions by ISIN and cash per currency, in Dutch or English", () => {
    expect(readStatement(PORTFOLIO)).toEqual({
      source: "degiro-portfolio",
      positions: [
        { isin: "NL0010273215", name: "ASML HOLDING", quantity: "2", price: "677.40", currency: "EUR" },
        { isin: "IE00B4L5Y983", name: "ISHARES CORE MSCI WORLD", quantity: "9", price: "100.00", currency: "EUR" },
        { isin: "US5949181045", name: "MICROSOFT CORP", quantity: "3", price: "420.00", currency: "USD" },
      ],
      cash: [{ currency: "EUR", amount: "12.34" }],
    });
    const en = readStatement(
      lines(
        "Product,Symbol/ISIN,Amount,Closing,Local value,,Value in EUR",
        "CASH & CASH FUND & FTX CASH (USD),,,,USD,5.10,4.70",
        "ASML HOLDING,NL0010273215,0.5,677.4,EUR,338.70,338.70",
      ),
    );
    expect(en?.positions[0]?.quantity).toBe("0.5");
    expect(en?.cash).toEqual([{ currency: "USD", amount: "5.10" }]);
    expect(readStatement("Datum,Tijd,Product\n01-01-2024,10:00,X\n")).toBeNull();
  });
});

describe("importing a portfolio statement", () => {
  let t: TestApp | undefined;
  afterEach(async () => t?.close());

  it("compares it with the transactions up to that day, flags differences, and clears once adjusted", async () => {
    t = await createTestApp();
    const api = async (method: string, url: string, body?: object) => {
      const res = await t!.api(method, url, body);
      if (res.statusCode >= 400) throw new Error(`${url}: ${res.body}`);
      return res.json();
    };
    const acc = await api("POST", "/api/accounts", { name: "DEGIRO", kind: "broker", provider: "degiro" });

    const up = await api("POST", "/api/import/upload", { fileName: "Account.csv", content: ACCOUNT });
    await api("POST", "/api/import/commit", { uploadId: up.uploadId, accountId: acc.id, mapping: up.mapping });

    const st = await api("POST", "/api/import/upload", { fileName: "Portfolio.csv", content: PORTFOLIO });
    expect(st.statement).toEqual({ label: "DEGIRO portfolio", positions: 3, currencies: ["EUR"] });

    const check = await api("POST", "/api/import/statement", {
      uploadId: st.uploadId,
      accountId: acc.id,
      day: "2024-12-31",
    });
    const row = (name: string) => check.rows.find((r: { name: string }) => r.name === name);
    // The purchase of 6 January 2025 doesn't count for 31 December.
    expect(row("ASML HOLDING")).toMatchObject({ reported: "2", computed: "2", difference: "0" });
    expect(row("ISHARES CORE MSCI WORLD")).toMatchObject({ reported: "9", computed: "10", difference: "-1" });
    // No transactions yet, so no asset: import the history first.
    expect(row("MICROSOFT CORP")).toMatchObject({ assetId: null, reported: "3", difference: "3" });
    // Cash: 12.34 reported, 0.35 of interest booked.
    const cash = check.rows.find((r: { isin: string | null; currency: string }) => !r.isin && r.currency === "EUR");
    expect(cash).toMatchObject({ reported: "12.34", computed: "0.35", difference: "11.99", price: "1" });
    expect(check.differences).toBe(3);

    const issue = async () =>
      (await api("GET", "/api/attention")).find((i: { key: string }) => i.key === `statement-mismatch:${acc.id}`);
    expect((await issue())?.title).toBe("DEGIRO: 3 differences with the statement of 2024-12-31");

    // Adjust the cash on that day, as the page does: the difference is gone.
    await api("POST", "/api/transactions", {
      accountId: acc.id,
      assetId: cash.assetId,
      type: "deposit",
      occurredAt: "2024-12-31T11:00:00.000Z",
      quantity: "11.99",
      price: "1",
      currency: "EUR",
    });
    const again = await api("GET", `/api/import/statement/${acc.id}`);
    expect(again.differences).toBe(2);
    expect((await issue())?.title).toBe("DEGIRO: 2 differences with the statement of 2024-12-31");

    // Only accounts kept with transactions take a statement.
    const house = await api("POST", "/api/accounts", { name: "Huis", kind: "property" });
    const st2 = await api("POST", "/api/import/upload", { fileName: "Portfolio.csv", content: PORTFOLIO });
    const refused = await t.api("POST", "/api/import/statement", {
      uploadId: st2.uploadId,
      accountId: house.id,
      day: "2024-12-31",
    });
    expect(refused.statusCode).toBe(400);
  });
});
