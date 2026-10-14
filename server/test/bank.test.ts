import { afterEach, describe, expect, it } from "vitest";
import { foreignDays, parseBankExport, readBankExport, summarizeExport } from "../src/import/bank.js";
import { D } from "../src/lib/decimal.js";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

const today = "2026-10-06";
const pick = (y: { year: number; valueEur: string | null; valueEstimated: boolean }[]) =>
  y.map((r) => [r.year, r.valueEur, r.valueEstimated]);

describe("bank exports → values per year", () => {
  it("reads ING's CSV: newest first, Af/Bij, balance after each line", () => {
    const csv = [
      '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie";"Tag"',
      '"20250102";"Overboeking";"NL11INGB0001234567";"NL22RABO0001234567";"OV";"Af";"500,00";"Overschrijving";"Naar betaalrekening";"10.645,67";""',
      '"20241231";"Rente";"NL11INGB0001234567";"";"DV";"Bij";"45,67";"Rente";"Rente over 2024";"11.145,67";""',
      '"20240601";"Storting";"NL11INGB0001234567";"NL22RABO0001234567";"OV";"Bij";"1.100,00";"Overschrijving";"";"11.100,00";""',
      '"20240115";"Opname";"NL11INGB0001234567";"NL22RABO0001234567";"OV";"Af";"1.000,00";"Overschrijving";"";"10.000,00";""',
      '"20231229";"Rente";"NL11INGB0001234567";"";"DV";"Bij";"30,00";"Rente";"Rente over 2023";"11.000,00";""',
    ].join("\n");
    const r = readBankExport(csv, { today });
    expect(r).toMatchObject({ format: "csv", needsClosingBalance: false });
    const [acc] = r.accounts;
    expect(acc).toMatchObject({ account: "NL11INGB0001234567", from: "2023-12-29", to: "2025-01-02", lines: 5 });
    // 2023: only its last days are in the file, so the 1 January balance (11,000 − 30) is a guess.
    // 2024: balance after the last 2023 line; the file runs from before to after 2024, so its totals hold.
    // 2026: the file stops in January 2025, so that balance may have changed since.
    expect(pick(acc!.years)).toEqual([
      [2023, "10970.00", true],
      [2024, "11000.00", false],
      [2025, "11145.67", false],
      [2026, "10645.67", true],
    ]);
    expect(acc!.years[1]).toMatchObject({ interestEur: "45.67", inEur: "1100.00", outEur: "1000.00", fullYear: true });
    expect(acc!.years[2]).toMatchObject({ outEur: "500.00", fullYear: false });
  });

  it("reads Rabobank's CSV: oldest first, signed amounts, 'Saldo na trn'", () => {
    const csv = [
      '"IBAN/BBAN","Munt","BIC","Volgnr","Datum","Rentedatum","Bedrag","Saldo na trn","Tegenrekening IBAN/BBAN","Naam tegenpartij","Naam uiteindelijke partij","Naam initiërende partij","BIC tegenpartij","Code","Batch ID","Transactiereferentie","Machtigingskenmerk","Incassant ID","Betalingskenmerk","Omschrijving-1","Omschrijving-2","Omschrijving-3","Reden retour","Oorspr bedrag","Oorspr munt","Koers"',
      '"NL33RABO0123456789","EUR","RABONL2U","000000000000000101","2024-03-01","2024-03-01","+2500,00","2500,00","NL44INGB0009876543","J. Jansen","","","INGBNL2A","cb","","","","","","Inleg spaarrekening","","","","","",""',
      '"NL33RABO0123456789","EUR","RABONL2U","000000000000000102","2024-12-31","2024-12-31","+18,75","2518,75","","","","","","ck","","","","","","Rente","","","","","",""',
    ].join("\n");
    const [acc] = readBankExport(csv, { today }).accounts;
    expect(pick(acc!.years)).toEqual([
      [2024, "0.00", true],
      [2025, "2518.75", false],
    ]);
    expect(acc!.years[0]).toMatchObject({ interestEur: "18.75", inEur: "2500.00", fullYear: false });
  });

  it("reads ABN AMRO's TAB file (no header)", () => {
    const tab = [
      "123456789\tEUR\t20240101\t1000,00\t1005,00\t20240101\t5,00\tRENTE",
      "123456789\tEUR\t20241231\t1005,00\t1012,50\t20241231\t7,50\tCREDITRENTE 2024",
    ].join("\n");
    const r = readBankExport(tab, { today });
    expect(r.format).toBe("abn-tab");
    expect(pick(r.accounts[0]!.years)).toEqual([
      [2024, "1000.00", false],
      [2025, "1012.50", false],
    ]);
    expect(r.accounts[0]!.years[0]).toMatchObject({ interestEur: "12.50", fullYear: true });
  });

  it("works back from the closing balance when the export has no balances (bunq)", () => {
    const csv = [
      '"Date","Interest Date","Amount","Account","Counterparty","Name","Description"',
      '"2025-03-01","2025-03-01","-20.00","NL55BUNQ2025123456","NL66INGB0001111111","Shop","Payment"',
      '"2025-01-10","2025-01-10","100.00","NL55BUNQ2025123456","NL66INGB0001111111","Me","Top up"',
      '"2024-12-31","2024-12-31","3.21","NL55BUNQ2025123456","","bunq","Interest payment"',
    ].join("\n");
    const without = readBankExport(csv, { today });
    expect(without.needsClosingBalance).toBe(true);
    expect(without.accounts[0]!.years.map((y) => y.valueEur)).toEqual([null, null]);
    // 583.21 after the last line: 603.21 before the payment, 503.21 before the top-up, 500 at the start.
    const r = readBankExport(csv, { today, closingBalance: "583,21" });
    expect(pick(r.accounts[0]!.years)).toEqual([
      [2024, "500.00", true],
      [2025, "503.21", false],
      [2026, "583.21", true],
    ]);
    expect(r.accounts[0]!.years[1]).toMatchObject({ inEur: "100.00", outEur: "20.00", interestEur: "0.00" });
  });

  it("reads CAMT.053 statements with their opening and closing balances", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>1</MsgId><CreDtTm>2025-01-06T08:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>2025-01</Id>
      <Acct><Id><IBAN>NL77ABNA0123456789</IBAN></Id></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1925.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2025-01-01</Dt></Dt></Bal>
      <Ntry><Amt Ccy="EUR">50.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2025-01-05</Dt></BookgDt><AddtlNtryInf>Storting</AddtlNtryInf></Ntry>
    </Stmt>
    <Stmt>
      <Id>2024-12</Id>
      <Acct><Id><IBAN>NL77ABNA0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">2000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2024-12-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1925.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2024-12-31</Dt></Dt></Bal>
      <Ntry><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2024-12-10</Dt></BookgDt><AddtlNtryInf>Overboeking</AddtlNtryInf></Ntry>
      <Ntry><Amt Ccy="EUR">25.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2024-12-31</Dt></BookgDt><NtryDtls><TxDtls><RmtInf><Ustrd>Rente 2024</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
      <Ntry><Amt Ccy="EUR">999.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2024-12-31</Dt></BookgDt></Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
    const r = readBankExport(xml, { today });
    expect(r.format).toBe("camt053");
    expect(r.warnings).toEqual([]);
    const [acc] = r.accounts;
    expect(acc!.account).toBe("NL77ABNA0123456789");
    expect(pick(acc!.years)).toEqual([
      [2024, "2000.00", true],
      [2025, "1925.00", false],
      [2026, "1975.00", true],
    ]);
    // The pending entry isn't booked yet, so it doesn't count.
    expect(acc!.years[0]).toMatchObject({ interestEur: "25.00", outEur: "100.00" });
  });

  const MT940 = [
    "{1:F01KNABNL2HAXXX0000000000}{2:I940KNABNL2HXXXXN3020}{4:",
    ":20:STMT1",
    ":25:NL12KNAB0123456789 EUR",
    ":28C:00001",
    ":60F:C241201EUR1000,00",
    ":61:2412101210C250,00NTRFNONREF//X1",
    ":86:/TRTP/SEPA OVERBOEKING/NAME/Ik",
    "/REMI/Sparen",
    // Valued 1 January, booked 31 December: the booking date counts, in the year before.
    ":61:2501011231C12,34NINTNONREF",
    ":86:Creditrente 2024",
    ":62F:C241231EUR1262,34",
    "-",
    ":20:STMT2",
    ":25:NL12KNAB0123456789 EUR",
    ":60F:C241231EUR1262,34",
    ":61:250115D100,00NTRFNONREF",
    ":86:/TRTP/SEPA OVERBOEKING/NAME/Verhuurder",
    // A debit reversed, and a credit with a funds code.
    ":61:250120RD100,00NTRFNONREF",
    ":86:Storno",
    ":61:250201CR50,00NTRFNONREF",
    ":86:Gift",
    ":62F:C250201EUR1312,34",
    "-}",
  ].join("\r\n");

  it("reads MT940 statements, in their SWIFT envelope, with balances and interest", () => {
    const r = readBankExport(MT940, { today });
    expect(r).toMatchObject({ format: "mt940", needsClosingBalance: false, warnings: [] });
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0]).toMatchObject({
      account: "NL12KNAB0123456789",
      from: "2024-12-10",
      to: "2025-02-01",
      lines: 5,
    });
    expect(pick(r.accounts[0]!.years)).toEqual([
      [2024, "1000.00", true],
      [2025, "1262.34", false],
      [2026, "1312.34", true],
    ]);
    expect(r.accounts[0]!.years[0]).toMatchObject({ interestEur: "12.34", inEur: "250.00" });
    expect(r.accounts[0]!.years[1]).toMatchObject({ inEur: "150.00", outEur: "100.00", interestEur: "0.00" });
  });

  it("keeps an MT940 :86: about the whole statement off its last entry", () => {
    // Some banks close a statement with an :86: of their own, after the balance.
    const r = readBankExport(MT940.replace(":62F:C241231EUR1262,34", ":62F:C241231EUR1262,34\r\n:86:Saldo per 31-12"), {
      today,
    });
    expect(r.accounts[0]!.years[0]).toMatchObject({ interestEur: "12.34" });
  });

  it("says when an MT940 statement doesn't add up to its closing balance", () => {
    const r = readBankExport(MT940.replace(":62F:C250201EUR1312,34", ":62F:C250201EUR1300,00"), { today });
    expect(r.warnings).toEqual([
      "Statement for NL12KNAB0123456789 up to 2025-02-01 doesn't add up to its closing balance.",
    ]);
  });

  it("reads a CreditDebet column as the sign of unsigned amounts", () => {
    const csv = [
      '"Rekeningnummer";"Transactiedatum";"Valutacode";"CreditDebet";"Bedrag";"Tegenrekeninghouder";"Omschrijving"',
      '"NL12KNAB0123456789";"10-01-2025";"EUR";"D";"20,00";"Winkel";"Boodschappen"',
      '"NL12KNAB0123456789";"05-01-2025";"EUR";"C";"100,00";"Ik";"Storting"',
    ].join("\n");
    const r = readBankExport(csv, { today, closingBalance: "580,00" });
    expect(r.accounts[0]!.years[0]).toMatchObject({ year: 2025, valueEur: "500.00", inEur: "100.00", outEur: "20.00" });
  });

  it("keeps the accounts in a combined export apart", () => {
    const head =
      '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie";"Tag"';
    const line = (d: string, acc: string, sign: string, amt: string, bal: string, desc = "Overboeking") =>
      `"${d}";"${desc}";"${acc}";"";"OV";"${sign}";"${amt}";"Overschrijving";"";"${bal}";""`;
    const r = readBankExport(
      [
        head,
        line("20241231", "NL01INGB0000000001", "Bij", "10,00", "110,00", "Rente"),
        line("20240601", "NL01INGB0000000001", "Bij", "50,00", "100,00"),
        line("20240301", "NL02INGB0000000002", "Af", "5,00", "95,00"),
      ].join("\n"),
      { today },
    );
    expect(r.accounts.map((a) => [a.account, a.lines])).toEqual([
      ["NL01INGB0000000001", 2],
      ["NL02INGB0000000002", 1],
    ]);
  });

  // Made up, after Revolut's statement export (all products, all currencies).
  const revolut = [
    "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
    "TOPUP,Current,2024-01-10 09:00:00,2024-01-10 09:00:05,Top-up by *1234,1000.00,0.00,EUR,COMPLETED,1000.00",
    "CARD_PAYMENT,Current,2024-03-01 12:00:00,2024-03-02 08:00:00,Supermarket,-50.00,0.00,EUR,COMPLETED,950.00",
    "TRANSFER,Current,2024-06-01 10:00:00,,To EUR Savings,-500.00,0.00,EUR,REVERTED,",
    "TRANSFER,Current,2024-06-02 10:00:00,2024-06-02 10:00:01,To EUR Savings,-400.00,0.00,EUR,COMPLETED,550.00",
    "EXCHANGE,Current,2024-07-01 10:00:00,2024-07-01 10:00:00,Exchanged to USD,-100.00,1.00,EUR,COMPLETED,449.00",
    "TRANSFER,Savings,2024-06-02 10:00:00,2024-06-02 10:00:01,From EUR Current,400.00,0.00,EUR,COMPLETED,400.00",
    "INTEREST,Savings,2024-12-31 05:00:00,2024-12-31 05:00:00,Interest earned,1.25,0.00,EUR,COMPLETED,401.25",
    "EXCHANGE,Current,2024-07-01 10:00:00,2024-07-01 10:00:00,Exchanged from EUR,110.00,0.00,USD,COMPLETED,110.00",
    "CARD_PAYMENT,Current,2025-01-15 12:00:00,2025-01-15 12:00:00,Bookshop,-10.00,0.00,USD,COMPLETED,100.00",
    "CARD_PAYMENT,Current,2025-02-01 12:00:00,,Shop,-49.00,0.00,EUR,PENDING,",
  ].join("\n");

  it("reads Revolut's statement: an account per product and currency, finished lines only, fees off", () => {
    const r = readBankExport(revolut, { today });
    expect(r.accounts.map((a) => [a.account, a.currency, a.lines])).toEqual([
      ["Current EUR", "EUR", 4],
      ["Savings EUR", "EUR", 2],
      ["Current USD", "USD", 2],
    ]);
    const [current, savings, usd] = r.accounts;
    // Out in 2024: 50 + 400 + 100 exchanged + 1 fee = 551.
    expect(current!.years.find((y) => y.year === 2024)).toMatchObject({ inEur: "1000.00", outEur: "551.00" });
    expect(current!.years.find((y) => y.year === 2025)).toMatchObject({ valueEur: "449.00" });
    // "INTEREST" lines are interest.
    expect(savings!.years.find((y) => y.year === 2024)).toMatchObject({ interestEur: "1.25", inEur: "400.00" });
    expect(savings!.years.find((y) => y.year === 2025)).toMatchObject({ valueEur: "401.25" });
    // Without exchange rates the dollars stay dollars, and say so.
    expect(usd).toMatchObject({ inEuros: false });
    expect(r.warnings).toContain("Skipped 2 lines that were pending, reverted or declined.");
    expect(r.warnings).toContain("Current USD: the amounts are in USD; no exchange rates were found to convert them.");
  });

  it("converts another currency at the ECB rate: the balance at that of 31 December, the rest by day", () => {
    const parsed = parseBankExport(revolut);
    // Euros per dollar, made up.
    const usd: Record<string, string> = {
      "2023-12-31": "0.90",
      "2024-07-01": "0.92",
      "2024-12-31": "0.96",
      "2025-01-15": "0.97",
      "2025-12-31": "0.85",
    };
    expect([...foreignDays(parsed, today).get("USD")!].sort()).toEqual(Object.keys(usd));
    const r = summarizeExport(parsed, { today }, (cur, day) => (cur === "USD" && usd[day] ? D(usd[day]) : undefined));
    const acc = r.accounts.find((a) => a.currency === "USD")!;
    expect(acc.inEuros).toBe(true);
    expect(acc.years.map((y) => [y.year, y.valueEur, y.inEur, y.outEur])).toEqual([
      // 110 dollars in on 1 July at 0.92.
      [2024, "0.00", "101.20", "0.00"],
      // The 110 dollars of 31 December at 0.96; 10 out on 15 January at 0.97.
      [2025, "105.60", "0.00", "9.70"],
      [2026, "85.00", "0.00", "0.00"],
    ]);
    expect(r.warnings).toContain("Current USD: converted from USD at the ECB rate (of 31 December for the balance).");
    // The euro accounts aren't touched.
    expect(r.accounts[0]!.years.find((y) => y.year === 2025)).toMatchObject({ valueEur: "449.00" });
  });

  it("reads Wise's statement of one currency, newest first", () => {
    // Made up, after Wise's CSV statement.
    const csv = [
      '"TransferWise ID",Date,Amount,Currency,Description,"Payment Reference","Running Balance","Exchange From","Exchange To","Exchange Rate","Payer Name","Payee Name","Payee Account Number",Merchant,"Card Last Four Digits","Card Holder Full Name",Attachment,Note,"Total fees"',
      'BALANCE-1003,05-02-2025,-100.00,GBP,"Converted 100.00 GBP to 117.00 EUR",,279.50,GBP,EUR,1.17,,,,,,,,,0.45',
      'CARD-1002,20-11-2024,-120.50,GBP,"Card transaction of 120.50 GBP issued by Bookshop",,379.50,,,,,,,Bookshop,1234,"A Person",,,0.00',
      'TRANSFER-1001,15-03-2024,500.00,GBP,"Received money from A Person",,500.00,,,,"A Person",,,,,,,,0.00',
    ].join("\n");
    const gbp: Record<string, string> = {
      "2023-12-31": "1.15",
      "2024-03-15": "1.17",
      "2024-11-20": "1.18",
      "2024-12-31": "1.20",
      "2025-02-05": "1.19",
      "2025-12-31": "1.14",
    };
    const r = summarizeExport(parseBankExport(csv), { today }, (_, day) => (gbp[day] ? D(gbp[day]) : undefined));
    expect(r.accounts).toHaveLength(1);
    const [acc] = r.accounts;
    expect(acc).toMatchObject({ account: "GBP", currency: "GBP", inEuros: true, from: "2024-03-15", lines: 3 });
    expect(acc!.years.map((y) => [y.year, y.valueEur, y.inEur, y.outEur])).toEqual([
      // 500 × 1.17 in; 120.50 × 1.18 out.
      [2024, "0.00", "585.00", "142.19"],
      // 379.50 × 1.20 on 31 December; 100 × 1.19 out.
      [2025, "455.40", "0.00", "119.00"],
      // 279.50 × 1.14.
      [2026, "318.63", "0.00", "0.00"],
    ]);
  });

  it("warns that a money market fund isn't a bank balance", () => {
    const r = readBankExport(
      [
        "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
        "TRANSFER,Savings,2025-03-01 10:00:00,2025-03-01 10:00:00,To Flexible Cash Funds,200.00,0.00,EUR,COMPLETED,200.00",
      ].join("\n"),
      { today },
    );
    expect(r.warnings.join(" ")).toMatch(/money market fund/);
  });

  it("explains a file it can't read", () => {
    expect(() => readBankExport("hello;world\n1;2", { today })).toThrow(/No date and amount columns/);
  });
});

describe("bank import route", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.close();
    t = undefined;
  });

  it("looks up the ECB rates for an account in another currency", async () => {
    // 1.25 dollars per euro on any day: 0.80 euros per dollar.
    t = await createTestApp({
      ...defaultRoutes,
      "frankfurter.dev/v1/": (url: string) => {
        const day = /v1\/(\d{4}-\d{2}-\d{2})(\.\.)?/.exec(url);
        return day?.[2] ? { rates: {} } : { date: day?.[1], rates: { USD: 1.25 } };
      },
    });
    const acc = (await t.api("POST", "/api/accounts", { name: "Revolut", kind: "bank", tracking: "yearly" })).json();
    const res = await t.api("POST", `/api/accounts/${acc.id}/bank-import`, {
      content: [
        "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
        "EXCHANGE,Current,2025-07-01 10:00:00,2025-07-01 10:00:00,Exchanged from EUR,110.00,0.00,USD,COMPLETED,110.00",
        "CARD_PAYMENT,Current,2025-08-01 12:00:00,2025-08-01 12:00:00,Bookshop,-10.00,0.00,USD,COMPLETED,100.00",
      ].join("\n"),
    });
    expect(res.statusCode).toBe(200);
    const [usd] = res.json().accounts;
    expect(usd).toMatchObject({ account: "Current USD", currency: "USD", inEuros: true });
    // 110 × 0.80 in, 10 × 0.80 out; the 100 dollars left × 0.80 on 1 January.
    expect(usd.years[0]).toMatchObject({ year: 2025, inEur: "88.00", outEur: "8.00" });
    expect(usd.years[1]).toMatchObject({ year: 2026, valueEur: "80.00" });
  });
});
