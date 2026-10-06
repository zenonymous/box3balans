import { afterEach, describe, expect, it } from "vitest";
import { createBackup, restoreBackup } from "../src/backup/backup.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

async function ok(method: string, url: string, body?: unknown) {
  const res = await t.api(method, url, body);
  expect(res.statusCode, res.body).toBe(200);
  return json(res);
}

type Year = { year: number; valueEur: string | null; incomeEur?: string; inEur?: string; details?: object };

/**
 * You, a fiscal partner (in 2024, not in 2025), a minor child (custody together) and an adult child,
 * with accounts kept as values per year:
 *
 * | account          | owner        | 1 Jan 2024            | 1 Jan 2025            | during 2024          |
 * | savings          | you          | 40,000                | 40,400                | 400 interest         |
 * | partner savings  | partner      | 30,000                | 30,500                |                      |
 * | joint            | joint 50/50  | 20,000                | 20,000                |                      |
 * | Kim's savings    | minor child  | 5,000                 | 5,100                 |                      |
 * | Lot's savings    | adult child  | 7,000                 | 7,000                 |                      |
 * | let home         | you          | WOZ 300,000, rent 6k  | WOZ 310,000, rent 6k  | 6,000 rent           |
 * | loan to brother  | you          | 10,000                | 10,000                | 300 interest         |
 * | study loan       | you          | 25,000 owed           | 24,000 owed           | 500 interest paid    |
 * | broker           | you          | 50,000                | 60,000                | 5,000 in, 1,000 div  |
 */
async function household() {
  t = await createTestApp();
  await ok("POST", "/api/household", { name: "box3balans", role: "self" });
  await ok("POST", "/api/household", { name: "Sam", role: "partner" });
  const kim = await ok("POST", "/api/household", { name: "Kim", role: "child", birthDate: "2015-05-01" });
  const lot = await ok("POST", "/api/household", { name: "Lot", role: "child", birthDate: "2005-06-01" });
  const account = async (name: string, kind: string, extra: object, years: Year[]) => {
    const a = await ok("POST", "/api/accounts", { name, kind, tracking: "yearly", ...extra });
    await ok("PUT", `/api/accounts/${a.id}/years`, { rows: years });
    return a;
  };
  await account("Savings", "bank", {}, [
    { year: 2024, valueEur: "40000", incomeEur: "400" },
    { year: 2025, valueEur: "40400" },
  ]);
  await account("Partner savings", "bank", { owner: "partner" }, [
    { year: 2024, valueEur: "30000" },
    { year: 2025, valueEur: "30500" },
  ]);
  await account("Joint", "bank", { owner: "joint", jointSelfPct: 50 }, [
    { year: 2024, valueEur: "20000" },
    { year: 2025, valueEur: "20000" },
  ]);
  await account("Kim's savings", "bank", { owner: "child", ownerChildId: kim.id }, [
    { year: 2024, valueEur: "5000" },
    { year: 2025, valueEur: "5100" },
  ]);
  await account("Lot's savings", "bank", { owner: "child", ownerChildId: lot.id }, [
    { year: 2024, valueEur: "7000" },
    { year: 2025, valueEur: "7000" },
  ]);
  await account("Let home", "property", {}, [
    { year: 2024, valueEur: "300000", incomeEur: "6000", details: { rented: true, rentEur: "6000" } },
    { year: 2025, valueEur: "310000", details: { rented: true, rentEur: "6000" } },
  ]);
  await account("Loan to brother", "receivable", {}, [
    { year: 2024, valueEur: "10000", incomeEur: "300" },
    { year: 2025, valueEur: "10000" },
  ]);
  await account("Study loan", "debt", {}, [
    { year: 2024, valueEur: "25000", incomeEur: "500" },
    { year: 2025, valueEur: "24000" },
  ]);
  await account("Broker", "broker", {}, [
    { year: 2024, valueEur: "50000", inEur: "5000", incomeEur: "1000" },
    { year: 2025, valueEur: "60000" },
  ]);
  const { config } = await ok("GET", "/api/box3");
  const situation = { debtsEur: "0", extraOtherEur: "0", extraBankEur: "0", debtInterestEur: "0", extraReturnEur: "0" };
  config.years["2024"] = { ...situation, partner: true, allocationSelfPct: "60" };
  config.years["2025"] = { ...situation, partner: false };
  await ok("PUT", "/api/box3/config", config);
  return { kim, lot };
}

describe("household and values per year in box 3", () => {
  it("counts each account for its owner, with a fiscal partner", async () => {
    await household();
    const y = await ok("GET", "/api/box3/2024");
    // Bank: 40,000 + 30,000 + 20,000 + 5,000 (Kim, 18 in 2033); Lot turned 18 in 2023, so not counted.
    // Other: the let home at 79% (rent 2% of WOZ) = 237,000, + 10,000 lent + 50,000 broker.
    expect(y.totals).toMatchObject({ bank: "95000.00", other: "297000.00" });
    expect(y.otherBreakdown).toMatchObject({ investments: "50000.00", other: "247000.00" });
    expect(y.debtsEur).toBe("25000.00");
    // Per person: the joint account and Kim's savings half each.
    expect(y.perPerson.self).toMatchObject({ bank: "52500.00", other: "297000.00", debts: "25000.00" });
    expect(y.perPerson.partner).toMatchObject({ bank: "42500.00", other: "0.00" });
    const row = (name: string) => y.rows.find((r: any) => r.accountName === name);
    expect(row("Lot's savings")).toMatchObject({ countedPct: "0", note: "child-adult", countedEur: "0.00" });
    expect(row("Let home")).toMatchObject({ source: "yearly", valueEur: "237000.00", category: "other" });
    expect(row("Study loan")).toMatchObject({ category: "debt", valueEur: "25000.00" });

    // 2024 rates, two people: debts above 2 × €3,700 count: 17,600. Rendementsgrondslag
    // 95,000 + 297,000 − 17,600 = 374,400; minus 2 × €57,000 = grondslag 260,400, 60% of it yours.
    expect(y.calculation).toMatchObject({
      deductibleDebtsEur: "17600.00",
      baseEur: "374400.00",
      taxableBaseEur: "260400.00",
    });
    expect(y.allocation.selfPct).toBe("60");
    expect(y.allocation.self.taxableBaseEur).toBe("156240.00");
    expect(y.allocation.partner.taxableBaseEur).toBe("104160.00");
    expect(Number(y.allocation.self.taxEur) + Number(y.allocation.partner.taxEur)).toBeCloseTo(
      Number(y.calculation.netTaxEur),
      1,
    );

    // Actual return 2024:
    // bank 400 (interest, already in the balance) + 500 + 0 + 100 = 1,000;
    // broker 60,000 − 50,000 − 5,000 in = 5,000, of which 1,000 dividend;
    // home 244,900 (79% of 310,000) − 237,000 + 6,000 rent, plus 300 interest on the loan = 14,200;
    // minus 500 interest on the study loan: 19,700.
    const a = y.actualReturn;
    expect(a.parts.bank).toMatchObject({ startEur: 95000, endEur: 96000, inEur: 400, directEur: 400, returnEur: 1000 });
    expect(a.parts.investments).toMatchObject({ valueChangeEur: 4000, directEur: 1000, returnEur: 5000 });
    expect(a.parts.other).toMatchObject({ valueChangeEur: 7900, directEur: 6300, returnEur: 14200 });
    expect(a.debtInterestEur).toBe(500);
    expect(a.totalEur).toBe(19700);
  });

  it("leaves out your partner's part when you aren't fiscal partners that year", async () => {
    await household();
    const y = await ok("GET", "/api/box3/2025");
    // 40,400 + half the joint account + half Kim's (the other half is your partner's).
    expect(y.totals.bank).toBe("52950.00");
    expect(y.perPerson.partner).toBeNull();
    expect(y.allocation).toBeNull();
    const row = (name: string) => y.rows.find((r: any) => r.accountName === name);
    expect(row("Partner savings")).toMatchObject({ countedPct: "0", note: "partner-not-fiscal" });
    expect(row("Joint")).toMatchObject({ countedPct: "50", note: "joint-partner-share", countedEur: "10000.00" });
    expect(row("Kim's savings")).toMatchObject({ countedPct: "50", note: "child-other-parent" });
  });

  it("guards the account rules", async () => {
    const { kim } = await household();
    // A home is always kept as values per year.
    const home = await ok("POST", "/api/accounts", { name: "Holiday home", kind: "property" });
    expect(home.tracking).toBe("yearly");
    // An account with history can't switch to values per year.
    const broker = await ok("POST", "/api/accounts", { name: "DEGIRO", kind: "broker" });
    const eur = (await ok("GET", "/api/assets")).find((x: any) => x.priceRef === "EUR");
    await ok("POST", "/api/transactions", {
      accountId: broker.id,
      assetId: eur.id,
      type: "deposit",
      occurredAt: "2024-01-05T12:00:00Z",
      quantity: "100",
      price: "1",
    });
    const res = await t.api("PUT", `/api/accounts/${broker.id}`, { tracking: "yearly" });
    expect(res.statusCode).toBe(409);
    // Values per year only on accounts kept that way.
    expect((await t.api("PUT", `/api/accounts/${broker.id}/years`, { rows: [] })).statusCode).toBe(400);
    // A child owner must be a child.
    expect((await t.api("POST", "/api/accounts", { name: "x", kind: "bank", owner: "child" })).statusCode).toBe(400);
    // Removing a child makes their accounts yours.
    await ok("DELETE", `/api/household/${kim.id}`);
    const accounts = await ok("GET", "/api/accounts");
    expect(accounts.find((x: any) => x.name === "Kim's savings")).toMatchObject({ owner: "self", ownerChildId: null });
    expect((await t.api("POST", "/api/household", { name: "Again", role: "partner" })).statusCode).toBe(409);
  });

  it("previews a bank export and keeps everything in backups", async () => {
    await household();
    const savings = (await ok("GET", "/api/accounts")).find((x: any) => x.name === "Savings");
    expect(savings).toMatchObject({ latestYear: 2025, latestValueEur: "40400.0000000000" });
    const preview = await ok("POST", `/api/accounts/${savings.id}/bank-import`, {
      fileName: "ing.csv",
      content: [
        '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie";"Tag"',
        '"20241231";"Rente";"NL11INGB0001234567";"";"DV";"Bij";"400,00";"Rente";"";"40.400,00";""',
        '"20231231";"Rente";"NL11INGB0001234567";"";"DV";"Bij";"380,00";"Rente";"";"40.000,00";""',
      ].join("\n"),
    });
    expect(preview.accounts[0].years.find((r: any) => r.year === 2025)).toMatchObject({ valueEur: "40400.00" });
    expect((await t.api("POST", `/api/accounts/${savings.id}/bank-import`, { content: "x" })).statusCode).toBe(400);

    const backup = await createBackup(t.database.db);
    expect(backup.tables.persons).toHaveLength(4);
    expect(backup.tables.account_years).toHaveLength(18);
    await restoreBackup(t.database.db, backup);
    // Restoring signs everyone out; the data is back.
    expect(backup.tables.accounts!.find((a) => a.name === "Joint")).toMatchObject({ owner: "joint" });
  });
});
