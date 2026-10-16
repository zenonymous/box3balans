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

  it("reads both peildata of a table: on one line, or as column headers", () => {
    const r = readYearStatement([
      page(
        [
          "Jaaroverzicht 2025",
          "Uitstaand per 1 januari 2025   € 4.000,00      per 31 december 2025   € 4.500,00",
          "",
          "                         1 januari 2025      31 december 2025",
          "Leningen                    € 3.000,00            € 3.200,00",
          "Wallet                        € 100,00              € 50,00",
          "Ontvangen rente                                      € 210,00",
          // A balance that mentions interest is still a balance.
          "Eindsaldo (incl. rente)                             € 3.250,00",
        ].join("\n"),
      ),
    ]);
    expect(short(r)).toEqual([
      [2025, "valueEur", "4000.00", false],
      [2026, "valueEur", "4500.00", false],
      [2025, "valueEur", "3000.00", false],
      [2026, "valueEur", "3200.00", false],
      [2025, "valueEur", "100.00", false],
      [2026, "valueEur", "50.00", false],
      [2025, "incomeEur", "210.00", false],
      [2026, "valueEur", "3250.00", false],
    ]);
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

  // Made up, in the layout of ING's Jaaroverzicht (as pdf.js and pdftotext give it).
  const ing = [
    page(
      [
        "ING",
        "Contact via ing.nl/klantenservice",
        "Jaaroverzicht 2025",
        "Beste heer Person,",
        "Hierbij ontvangt u het Jaaroverzicht van 2025.",
        "Betalen",
        "ING Betaalrekening: NL00 INGB 0000 0000 00 Hr A Person",
        "Saldo op 01-01-2025   1.234,56",
        "Saldo op 31-12-2025   2.345,67",
        "Creditcards",
        "ING Creditcardrekening: 000000000000 Hr A Person*",
        "Saldo op 01-01-2025   -12,34",
        "Saldo op 31-12-2025   -456,78",
        "Rente, betaald in 2025   1,23",
        "* Uw creditcardrekening staat vermeld in de omschrijving van de maandelijkse afschrijving van uw betaalrekening",
        "Sparen",
        "ING Oranje Spaarrekening: R 000-00000 Hr A Person",
        "Saldo op 01-01-2025   10.000,00",
        "Saldo op 31-12-2025   9.500,00",
        "Rente, ontvangen in 2025   150,25",
        "rekeningen tot een maximum van € 100.000. Kijk voor meer informatie op ing.nl/dgs.",
        "M-BUSAS01   ING Bank N.V., statutair gevestigd te Amsterdam, Handelsregister nr. 00000000",
      ].join("\n"),
    ),
  ];
  const byAccount = (r: ReturnType<typeof readYearStatement>) =>
    r.found.map((f) => [f.group?.split(":")[0], f.year, f.field, f.amount, f.sure]);

  it("recognises ING's jaaroverzicht: per account the balances and the interest, ticked", () => {
    const r = readYearStatement(ing);
    expect(r).toMatchObject({ template: "ING, jaaroverzicht", year: 2025 });
    expect(byAccount(r)).toEqual([
      ["ING Betaalrekening", 2025, "valueEur", "1234.56", true],
      // The balance at the end of 2025 is the value on 1 January 2026.
      ["ING Betaalrekening", 2026, "valueEur", "2345.67", true],
      ["ING Creditcardrekening", 2025, "valueEur", "-12.34", true],
      ["ING Creditcardrekening", 2026, "valueEur", "-456.78", true],
      // On a credit card, the interest paid.
      ["ING Creditcardrekening", 2025, "incomeEur", "1.23", true],
      ["ING Oranje Spaarrekening", 2025, "valueEur", "10000.00", true],
      ["ING Oranje Spaarrekening", 2026, "valueEur", "9500.00", true],
      ["ING Oranje Spaarrekening", 2025, "incomeEur", "150.25", true],
    ]);
  });

  it("doesn't take a counter-account for a new account", () => {
    const r = readYearStatement([
      page(
        [
          "Jaaroverzicht 2025",
          "Spaarrekening: NL00 BANK 0000 0000 00",
          "Saldo per 1 januari 2025   1.000,00",
          "Tegenrekening: NL11 BANK 1111 1111 11",
          "Saldo per 31 december 2025   1.100,00",
        ].join("\n"),
      ),
    ]);
    expect(r.found.map((f) => f.group)).toEqual([
      "Spaarrekening: NL00 BANK 0000 0000 00",
      "Spaarrekening: NL00 BANK 0000 0000 00",
    ]);
  });

  it("without a template, still keeps the accounts of a statement apart", () => {
    const r = readYearStatement(ing, []);
    expect(r.template).toBeNull();
    expect(byAccount(r).map(([group, year, field, amount]) => [group, year, field, amount])).toEqual(
      byAccount(readYearStatement(ing)).map(([group, year, field, amount]) => [group, year, field, amount]),
    );
    expect(r.found.every((f) => !f.sure)).toBe(true);
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
