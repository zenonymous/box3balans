import { describe, expect, it } from "vitest";
import { readBankExport } from "../src/import/bank.js";

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

  it("explains a file it can't read", () => {
    expect(() => readBankExport("hello;world\n1;2", { today })).toThrow(/No date and amount columns/);
  });
});
