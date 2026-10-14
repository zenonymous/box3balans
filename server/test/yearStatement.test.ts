import { afterEach, describe, expect, it } from "vitest";
import { amounts, readYearStatement, statementYear, type StatementTemplate } from "../src/import/yearStatement.js";
import { createTestApp, type TestApp } from "./helpers.js";

// The text as `pdftotext -layout` (or the browser) gives it. All made up.
const page = (text: string, n = 1) => ({ page: n, text });
const short = (r: ReturnType<typeof readYearStatement>) => r.found.map((f) => [f.year, f.field, f.amount, f.sure]);

describe("year statements", () => {
  it("reads amounts the way Dutch and English statements write them", () => {
    const values = (s: string) => amounts(s).map((a) => a.value);
    expect(values("Beginwaarde   € 1.234,56")).toEqual(["1234.56"]);
    expect(values("Opening balance  1,234,567.89")).toEqual(["1234567.89"]);
    expect(values("Kosten -12,50 en € -0,99 en −5,00")).toEqual(["-12.50", "-0.99", "-5.00"]);
    expect(values("Saldo 12345,67 en 0,50")).toEqual(["12345.67", "0.50"]);
    // Dates, percentages, and numbers that can't be an amount.
    expect(values("Op 01.01.2025 was het rendement 6,25% (1.234.56)")).toEqual([]);
  });

  it("finds the year it's about", () => {
    expect(statementYear("Financieel jaaroverzicht 2025\nAangemaakt op 3 februari 2026")).toBe(2025);
    expect(statementYear("Overzicht\n2024 2025 2025")).toBe(2025);
    expect(statementYear("Overzicht")).toBeNull();
  });

  it("without a template, offers amounts next to a peildatum, or that say what they are", () => {
    const r = readYearStatement([
      page(
        [
          "                        Jaaropgaaf 2025",
          "Investeerder: A. Person                       Datum: 15 februari 2026",
          "",
          "Uitstaand vermogen per 1 januari 2025                € 12.345,67",
          "Uitstaand vermogen per 31 december 2025              € 13.000,00",
          "Totaal geïnvesteerd in 2025                          €  2.500,00",
          "Ontvangen rente 1 januari t/m 31 december 2025       €    812,40",
          "Kosten                                               €     25,00",
          "Ingehouden bronbelasting                             €     15,00",
          "Rendement                                                  6,25%",
        ].join("\n"),
      ),
    ]);
    expect(r.template).toBeNull();
    expect(r.year).toBe(2025);
    expect(short(r)).toEqual([
      [2025, "valueEur", "12345.67", false],
      // The end of 2025 is the start of 2026.
      [2026, "valueEur", "13000.00", false],
      [2025, "inEur", "2500.00", false],
      // A period, not a peildatum.
      [2025, "incomeEur", "812.40", false],
      [2025, "costsEur", "25.00", false],
    ]);
    expect(r.found[0]).toMatchObject({
      page: 1,
      line: "Uitstaand vermogen per 1 januari 2025                € 12.345,67",
    });
  });

  it("without dates, takes begin and end values as those of the statement's year", () => {
    const r = readYearStatement([
      page("Financieel jaaroverzicht 2025\nBeleggingsrekening 12345678"),
      page(
        [
          "Beginwaarde                         € 20.150,00",
          "Eindwaarde                          € 23.410,55",
          "Uitgekeerd dividend                 €    143,20",
          "Ingehouden dividendbelasting        €     21,48",
        ].join("\n"),
        2,
      ),
    ]);
    expect(short(r)).toEqual([
      [2025, "valueEur", "20150.00", false],
      [2026, "valueEur", "23410.55", false],
      [2025, "incomeEur", "143.20", false],
    ]);
    expect(r.found.map((f) => f.page)).toEqual([2, 2, 2]);
  });

  const template: StatementTemplate = {
    id: "voorbeeldbank",
    label: "Voorbeeldbank, jaaroverzicht",
    detect: [/Voorbeeldbank/, /Jaaroverzicht/i],
    year: /Jaaroverzicht (\d{4})/i,
    fields: [
      { field: "valueEur", label: /Saldo begin/i },
      { field: "valueEur", label: /Saldo eind/i, nextYear: true },
      // The second amount on the line: this year's, after last year's.
      { field: "incomeEur", label: /Rente/i, column: 1 },
    ],
  };

  it("with a template, takes each value from its place and ticks it", () => {
    const r = readYearStatement(
      [
        page(
          [
            "Voorbeeldbank N.V.            Jaaroverzicht 2025",
            "Saldo begin       € 1.000,00",
            "Saldo eind        € 1.100,00",
            "Rente             2024: € 8,00     2025: € 12,34",
          ].join("\n"),
        ),
      ],
      [template],
    );
    expect(r).toMatchObject({ template: "Voorbeeldbank, jaaroverzicht", year: 2025 });
    expect(short(r)).toEqual([
      [2025, "valueEur", "1000.00", true],
      [2026, "valueEur", "1100.00", true],
      [2025, "incomeEur", "12.34", true],
    ]);
  });

  it("falls back when a template's places are empty (another version of the document)", () => {
    const r = readYearStatement(
      [page("Voorbeeldbank N.V.   Jaaroverzicht 2025\nWaarde op 1 januari 2025   € 900,00")],
      [template],
    );
    expect(r.template).toBeNull();
    expect(short(r)).toEqual([[2025, "valueEur", "900.00", false]]);
  });

  describe("route", () => {
    let t: TestApp | undefined;
    afterEach(async () => {
      await t?.close();
      t = undefined;
    });

    it("answers with what it found and keeps nothing", async () => {
      t = await createTestApp();
      const acc = (await t.api("POST", "/api/accounts", { name: "Crowdfunding", kind: "receivable" })).json();
      const res = await t.api("POST", `/api/accounts/${acc.id}/year-statement`, {
        pages: [page("Jaaropgaaf 2025\nUitstaand per 1 januari 2025   € 5.000,00")],
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ found: [{ year: 2025, field: "valueEur", amount: "5000.00" }] });
      expect((await t.api("GET", `/api/accounts/${acc.id}/years`)).json()).toEqual([]);
      expect((await t.api("POST", `/api/accounts/${acc.id}/year-statement`, { pages: [] })).statusCode).toBe(400);
    });
  });
});
