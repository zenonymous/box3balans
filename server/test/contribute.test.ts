import { afterEach, describe, expect, it } from "vitest";
import { csvContribution, namesPattern, pdfContribution, personalData } from "../src/import/contribute.js";
import { recognise } from "../src/import/formats/index.js";
import { matchShared, readExpected, sharedFormatSchema } from "../src/import/formats/shared.js";
import { mappingSchema } from "../src/import/mapping.js";
import { createTestApp, type TestApp } from "./helpers.js";

// An export Box3balans has no reader for, full of what must not be shared.
const EXPORT = [
  "Rekeningoverzicht;Jan Pietersen;NL91ABNA0417164300",
  "Klantnummer;88812345;jan.pietersen@example.nl",
  "Datum;Tijd;Soort;ISIN;Product;Aantal;Koers;Totaal;Valuta;Kosten;Omschrijving;Order-ID",
  "05-01-2024;09:31:12;Koop;IE00B4L5Y983;iShares Core MSCI World;12;85,40;-1.024,80;EUR;2,00;Aankoop via app Jan;ORD-77812",
  "06-01-2024;10:01:00;Koop;US0378331005;Apple Inc;3;180,10;-540,30;USD;1,00;Aankoop;ORD-77813",
  "06-01-2024;11:15:00;Koop;IE00B4L5Y983;iShares Core MSCI World;2;86,00;-172,00;EUR;2,00;Herbelegging;ORD-77814",
  "07-01-2024;12:00:00;Koop;NL0010273215;ASML Holding;1;640,00;-640,00;EUR;2,00;Wens van Marieke;ORD-77815",
  "08-01-2024;12:00:00;Koop;NL0010273215;ASML Holding;1;650,00;-650,00;EUR;2,00;Kerstbonus;ORD-77816",
  "15-03-2024;;Dividend;IE00B4L5Y983;iShares Core MSCI World;;;12,34;EUR;;Uitkering kw1;DIV-1",
  "20-05-2024;14:22:09;Verkoop;US0378331005;Apple Inc;-1;190,00;190,00;USD;1,00;Verkoop tel 0612345678;ORD-79001",
  "01-06-2024;;Storting;;;;;5.000,00;EUR;;Van NL20INGB0001234567 J. Pietersen;DEP-5",
  "02-06-2024;;Rente;;;;;0,42;EUR;;Rente juni;INT-6",
  "03-06-2024;;Overboeking;;;;;-100,00;EUR;;Naar spaarrekening;TR-7",
].join("\r\n");

const MAPPING = mappingSchema.parse({
  skipRows: 2,
  columns: {
    date: 0,
    time: 1,
    type: 2,
    isin: 3,
    name: 4,
    quantity: 5,
    price: 6,
    total: 7,
    currency: 8,
    fee: 9,
    notes: 10,
    id: 11,
  },
  typeMode: "column",
  typeValues: {
    Koop: "buy",
    Verkoop: "sell",
    Dividend: "dividend",
    Storting: "deposit",
    Rente: "reward",
    Overboeking: "skip",
  },
});

const share = (extra: Partial<Parameters<typeof csvContribution>[0]> = {}) =>
  csvContribution({
    content: EXPORT,
    mapping: MAPPING,
    account: "broker",
    provider: "Voorbeeldbank",
    export: "Mijn overzicht → Exporteren",
    avoid: ["Jan Pietersen"],
    seed: 42,
    version: "0.1.33",
    ...extra,
  });

describe("sharing a CSV format", () => {
  it("leaves out names, numbers, addresses, notes and IDs", () => {
    const { file } = share();
    const text = JSON.stringify(file);
    for (const secret of [
      "Pietersen",
      "Marieke",
      "NL91ABNA0417164300",
      "NL20INGB0001234567",
      "jan.pietersen",
      "example.nl",
      "88812345",
      "0612345678",
      "77812",
      "ORD-",
      "Kerstbonus",
      "Herbelegging",
      "Uitkering",
      "spaarrekening",
      "Rekeningoverzicht",
      "Klantnummer",
      "Apple Inc",
    ])
      expect(text, secret).not.toContain(secret);
    // Not one amount of the file, nor its dates.
    for (const amount of [
      "1.024,80",
      "540,30",
      "172,00",
      "640,00",
      "650,00",
      "12,34",
      "190,00",
      "5.000,00",
      "0,42",
      "85,40",
      "180,10",
    ])
      expect(file.sample, amount).not.toContain(amount);
    for (const day of ["05-01-2024", "06-01-2024", "15-03-2024", "20-05-2024", "01-06-2024"])
      expect(file.sample, day).not.toContain(day);
  });

  it("keeps the layout: header row, type words, currencies, notation", () => {
    const { file, kept } = share();
    const lines = file.sample.split("\r\n");
    expect(lines[2]).toBe("Datum;Tijd;Soort;ISIN;Product;Aantal;Koers;Totaal;Valuta;Kosten;Omschrijving;Order-ID");
    expect(file.headers).toEqual(lines[2]!.split(";"));
    const cells = lines.slice(3, -1).map((l) => l.split(";"));
    // Dates as DD-MM-YYYY, in the same order, equal days still equal; times as HH:MM:SS.
    expect(cells.every((c) => /^\d{2}-\d{2}-\d{4}$/.test(c[0]!))).toBe(true);
    const days = cells.map((c) => c[0]!.split("-").reverse().join(""));
    expect([...days].sort()).toEqual(days);
    expect(cells[1]![0]).toBe(cells[2]![0]); // 06-01 twice
    expect(cells.filter((c) => c[1]).every((c) => /^\d{2}:\d{2}:\d{2}$/.test(c[1]!))).toBe(true);
    // Amounts with a decimal comma (and a thousands point where the column has one); signs stay.
    expect(cells.every((c) => !c[7] || /^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(c[7]))).toBe(true);
    expect(cells.find((c) => c[2] === "Verkoop")![5]).toMatch(/^-\d+$/);
    expect(cells.find((c) => c[2] === "Overboeking")![7]).toMatch(/^-/);
    expect(cells.map((c) => c[2])).toEqual(
      expect.arrayContaining(["Koop", "Dividend", "Verkoop", "Storting", "Rente"]),
    );
    expect(cells.map((c) => c[8])).toEqual(expect.arrayContaining(["EUR", "USD"]));
    expect(file.mapping).toMatchObject({ delimiter: ";", decimal: ",", dateOrder: "DMY", skipRows: 2 });
    expect(kept.filter((k) => k.kind === "type").map((k) => k.value)).toEqual(
      expect.arrayContaining(["Koop", "Verkoop", "Dividend", "Storting", "Rente", "Overboeking"]),
    );
  });

  it("puts in at most three lines of each type, and the same stand-in for the same asset", () => {
    const { file, lines } = share();
    const cells = file.sample
      .split("\r\n")
      .slice(3, -1)
      .map((l) => l.split(";"));
    expect(cells.filter((c) => c[2] === "Koop")).toHaveLength(3);
    expect(lines).toEqual({ file: 10, sample: 8 });
    // Lines 1 and 3 are the same fund in the export; line 2 another.
    expect(cells[0]![3]).toBe(cells[2]![3]);
    expect(cells[0]![3]).not.toBe(cells[1]![3]);
    expect(cells[0]![4]).toBe(cells[2]![4]);
    // A trade's total is its made-up quantity times its made-up price.
    const n = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
    for (const c of cells.filter((c) => c[2] === "Koop"))
      expect(Math.abs(n(c[7]!))).toBeCloseTo(Math.abs(n(c[5]!)) * n(c[6]!), 2);
  });

  it("makes a valid shared format that reads its sample, and the original file, as the user set up", () => {
    const { file } = share();
    expect(() => sharedFormatSchema.parse(file)).not.toThrow();
    expect(readExpected(file.sample, mappingSchema.parse(file.mapping), file.account)).toEqual(file.expected);
    expect(file.expected.map((e) => e.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok", "skipped"]);
    expect(file.expected.map((e) => e.type)).toEqual([
      "buy",
      "buy",
      "buy",
      "dividend",
      "sell",
      "deposit",
      "reward",
      undefined,
    ]);
    expect(recognise(file.sample)).toBeNull();

    // The real file is matched by the shared format, title lines and all.
    const match = matchShared(EXPORT, [file]);
    expect(match?.format.id).toBe("voorbeeldbank");
    expect(match?.mapping.skipRows).toBe(2);
    const fromShared = readExpected(EXPORT, match!.mapping, "broker");
    expect(fromShared).toEqual(readExpected(EXPORT, MAPPING, "broker"));
    // A file with other columns isn't.
    expect(matchShared("Date,Amount,Note\n2024-01-01,1,x\n", [file])).toBeNull();
  });

  it("replaces what the user unticks, and names of the household and IBANs by itself", () => {
    const replaced = share({ replace: ["header:Omschrijving", "type:Rente"] });
    expect(replaced.file.headers[10]).toBe("column-11");
    expect(replaced.file.sample).not.toContain("Omschrijving");
    expect(replaced.file.sample).not.toContain("Rente");
    expect(Object.keys(replaced.file.mapping.typeValues)).toContain("type-1");
    expect(replaced.kept.find((k) => k.value === "Rente")).toMatchObject({ kind: "type", replaced: true });
    expect(replaced.file.expected.filter((e) => e.type === "reward")).toHaveLength(1);

    const odd = EXPORT.replace("Omschrijving", "Notitie Pietersen").replace("Order-ID", "NL91ABNA0417164300");
    const { file, kept } = share({ content: odd });
    expect(kept.find((k) => k.value === "Notitie Pietersen")).toMatchObject({ replaced: true, flag: "name" });
    expect(kept.find((k) => k.value === "NL91ABNA0417164300")).toMatchObject({ replaced: true, flag: "iban" });
    expect(file.headers.slice(10)).toEqual(["column-11", "column-12"]);
  });

  it("makes the same file from the same seed, and another from another", () => {
    expect(share().file).toEqual(share().file);
    expect(share({ seed: 7 }).file.sample).not.toBe(share().file.sample);
  });

  it("needs a header row of three columns and lines below it", () => {
    expect(() => share({ content: "a;b\n1;2\n", mapping: mappingSchema.parse({}) })).toThrow(/three columns/);
    expect(() => share({ content: "a;b;c\n", mapping: mappingSchema.parse({}) })).toThrow(/no lines/);
  });
});

describe("spotting personal data", () => {
  it("finds IBANs, e-mail addresses, phone numbers, BSNs and the household's names", () => {
    const names = namesPattern(["Jan Pietersen", "me"]);
    expect(personalData("Saldo NL91 ABNA 0417 1643 00", null)).toBe("iban");
    expect(personalData("DE89370400440532013000", null)).toBe("iban");
    expect(personalData("DE89370400440532013001", null)).toBeUndefined(); // wrong check digits
    expect(personalData("jan@example.nl", null)).toBe("email");
    expect(personalData("Bel 06-12345678", null)).toBe("phone");
    expect(personalData("+31 20 1234567", null)).toBe("phone");
    expect(personalData("111222333", null)).toBe("bsn");
    expect(personalData("111222334", null)).toBeUndefined();
    expect(personalData("Rekening van Pietersen", names)).toBe("name");
    expect(personalData("Pietersenstraat", names)).toBeUndefined();
    expect(personalData("Koop", names)).toBeUndefined();
    expect(personalData("Totaal", null)).toBeUndefined();
  });
});

describe("sharing a year statement", () => {
  const pages = [
    {
      page: 1,
      text: "Voorbeeld Spaarbank N.V.\nDhr. J. Pietersen\nKerkstraat 12\n1234 AB Amsterdam\nFinancieel jaaroverzicht 2025\nKlantnummer 88812345   Geboortedatum 12-05-1980\nRekening NL91ABNA0417164300",
    },
    {
      page: 2,
      text: "Spaarrekening Plus\nSaldo per 1 januari 2025      12.345,67\nOntvangen rente over 2025         234,56\nSaldo per 31-12-2025          15.000,00\nVragen? Bel 020-1234567 of mail info@spaarbank.nl",
    },
    { page: 3, text: "Algemene voorwaarden van Pietersen" },
  ];
  const picked = [
    { page: 2, line: "Saldo per 1 januari 2025      12.345,67", field: "valueEur" as const, year: 2025 },
    { page: 2, line: "Ontvangen rente over 2025         234,56", field: "incomeEur" as const, year: 2025 },
  ];
  const make = () =>
    pdfContribution({
      pages,
      picked,
      provider: "Voorbeeld Spaarbank",
      document: "Financieel jaaroverzicht",
      avoid: ["Jan Pietersen"],
      seed: 3,
    });

  it("keeps the layout and the labels, and nothing personal", () => {
    const { file, kept } = make();
    expect(file.pages.map((p) => p.page)).toEqual([1, 2]);
    const text = file.pages.map((p) => p.text).join("\n");
    for (const secret of [
      "Pietersen",
      "Kerkstraat",
      "Amsterdam",
      "1234 AB",
      "88812345",
      "NL91",
      "0417164300",
      "12.345,67",
      "234,56",
      "15.000,00",
      "1234567",
      "info@",
    ])
      expect(text, secret).not.toContain(secret);
    expect(text).toContain("Financieel jaaroverzicht 2025");
    expect(text).toContain("Saldo per 31-12-2025");
    expect(text).toMatch(/Saldo per 1 januari 2025 {6}\d{1,2}\.\d{3},\d{2}/);
    expect(text).toContain("Xxx. X. Xxxxxxxxx");
    expect(text.split("\n").length).toBe(pages[0]!.text.split("\n").length + pages[1]!.text.split("\n").length);
    expect(file.values).toEqual([
      expect.objectContaining({
        page: 2,
        field: "valueEur",
        year: 2025,
        line: expect.stringMatching(/^Saldo per 1 januari 2025 /),
      }),
      expect.objectContaining({
        page: 2,
        field: "incomeEur",
        line: expect.stringMatching(/^Ontvangen rente over 2025 /),
      }),
    ]);
    expect(kept.filter((k) => !k.common).map((k) => k.value)).toEqual(
      expect.arrayContaining(["voorbeeld", "spaarbank"]),
    );
    expect(kept.find((k) => k.value === "saldo")).toMatchObject({ common: true, replaced: false });
  });

  it("crosses out a word the user unticks", () => {
    const { file } = pdfContribution({
      pages,
      picked,
      provider: "Voorbeeld Spaarbank",
      replace: ["word:spaarrekening"],
      seed: 3,
    });
    expect(file.pages[1]!.text.split("\n")[0]).toBe("Xxxxxxxxxxxxx Xxxx");
  });
});

describe("the API", () => {
  let t: TestApp;
  afterEach(() => t?.close());

  it("makes a file from an uploaded export, and only from one Box3balans doesn't read itself", async () => {
    t = await createTestApp();
    const account = JSON.parse((await t.api("POST", "/api/accounts", { name: "Broker", kind: "broker" })).body).id;
    expect((await t.api("POST", "/api/household", { name: "Marieke Pietersen", role: "self" })).statusCode).toBe(200);
    const up = JSON.parse(
      (await t.api("POST", "/api/import/upload", { fileName: "export.csv", content: EXPORT })).body,
    );
    expect(up.format).toBeNull();
    const res = await t.api("POST", "/api/import/contribution", {
      uploadId: up.uploadId,
      accountId: account,
      mapping: MAPPING,
      provider: "Voorbeeldbank",
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.fileName).toBe("box3balans-formaat-voorbeeldbank.json");
    expect(res.body).not.toContain("Pietersen");
    expect(res.body).not.toContain("Marieke");

    const bitvavo = [
      "Timezone,Date,Time,Type,Currency,Amount,Quote Currency,Quote Price,Received / Paid Currency,Received / Paid Amount,Fee currency,Fee amount,Status,Transaction ID,Address",
      "Europe/Amsterdam,2024-02-01,10:29:03,deposit,EUR,1000,,,,,EUR,0,Completed,t-1,",
    ].join("\n");
    const known = JSON.parse((await t.api("POST", "/api/import/upload", { fileName: "b.csv", content: bitvavo })).body);
    expect(known.format?.id).toBe("bitvavo");
    const refused = await t.api("POST", "/api/import/contribution", {
      uploadId: known.uploadId,
      accountId: account,
      mapping: MAPPING,
      provider: "x",
    });
    expect(refused.statusCode).toBe(400);
  });

  it("makes a file from a year statement's text", async () => {
    t = await createTestApp();
    const account = JSON.parse((await t.api("POST", "/api/accounts", { name: "Sparen", kind: "bank" })).body).id;
    const res = await t.api("POST", `/api/accounts/${account}/year-statement/contribution`, {
      pages: [{ page: 1, text: "Jaaroverzicht 2025\nDhr. Pietersen\nSaldo per 1 januari 2025   1.234,56" }],
      picked: [{ page: 1, line: "Saldo per 1 januari 2025   1.234,56", field: "valueEur", year: 2025 }],
      provider: "Spaarbank",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain("Pietersen");
    expect(res.body).not.toContain("1.234,56");
  });
});
