import { afterEach, describe, expect, it } from "vitest";
import { goldrepublicTransactions, readGoldrepublic } from "../src/import/formats/goldrepublic.js";
import { recognisePdf } from "../src/import/formats/index.js";
import { readYearStatement } from "../src/import/yearStatement.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

// A Goldrepublic account statement as the app's PDF reader gives it (columns three spaces apart),
// in the layout of a real one over 2025; the name, numbers and amounts are made up. An order runs
// over the page break, as in the real one.
const FOOTER = "GOLDREPUBLIC BV | BROUWERSGRACHT 00 | 1000 AA AMSTERDAM | THE NETHERLANDS";
const PAGES = [
  `T: +31 20 – 000 00 00
INFO@GOLDREPUBLIC.COM
WWW.GOLDREPUBLIC.COM
Account Statement
Account Number   12345
Account Holder   Sanne de Vries
Opening balance   Jan 1 2025
Cash   €0.50
Gold   10.000 gr   €80,000.00/ kg   €800.00
Silver   1,000.000 gr   €900.00/ kg   €900.00
Platinum   0.000 gr   €30,000.00/ kg   €0.00
Total   €1,700.50
Transactions
Transaction Type   Date   Description   Bullion   Amount   Balance
Direct Debit   03-01-2025   Deposit for savingsplan goud   -   €100.00   €100.50
Savings Order   07-01-2025   Processing order 1000001   Gold   €-100.00   €0.50
Product   Gold, Zurich
Date Submitted   01-01-2025 09:00:00
Execution Date   02-01-2025 13:05:02
Action   Buy
Transaction Value   €99.50
Fee   €0.50
Volume   1.200
Total   €100.00
Direct Debit   03-01-2025   Deposit for savingsplan Zilver   -   €50.00   €50.50
Savings Order   07-01-2025   Processing order 1000002   Silver   €-50.00   €0.50
Product   Silver, Zurich
Date Submitted   01-01-2025 09:00:00
Execution Date   02-01-2025 13:05:10
${FOOTER}`,
  `Action   Buy
Transaction Value   €49.25
Fee   €0.25
Handling Costs   €0.50
Volume   50.000
Total   €50.00
Direct Debit   05-02-2025   Storting voor opslagkosten januari 2025   -   €1.20   €1.70
Cost Order   05-02-2025   Opslagkosten januari 2025   -   €-1.20   €0.50
Market Order   20-06-2025   Processing order 1000003   Gold   €990.00   €990.50
Product   Gold, Zurich
Date Submitted   19-06-2025 09:58:00
Execution Date   19-06-2025 10:00:00
Action   Sell
Transaction Value   €1,000.00
Fee   €10.00
Volume   5.000
Total   €990.00
Withdrawal   25-06-2025   Client withdrawal of €990.00   -   €-990.00   €0.50
Closing balance
Dec 31 2025
Cash   €0.50
Gold   6.200 gr   €100,000.00/ kg   €620.00
Silver   1,050.000 gr   €1,000.00/ kg   €1,050.00
Platinum   0.000 gr   €30,000.00/ kg   €0.00
Total   €1,670.50
${FOOTER}`,
];
const pages = (texts = PAGES) => texts.map((text, i) => ({ page: i + 1, text }));

describe("Goldrepublic account statement", () => {
  it("reads the balances, the transactions and each order", () => {
    const s = readGoldrepublic(pages())!;
    expect(s.opening).toMatchObject({
      date: "2025-01-01",
      cash: "0.50",
      total: "1700.50",
      metals: { Gold: { grams: "10.000", value: "800.00" }, Silver: { grams: "1000.000", value: "900.00" } },
    });
    expect(s.closing).toMatchObject({ date: "2025-12-31", cash: "0.50", total: "1670.50" });
    expect(s.entries.map((e) => [e.type, e.date, e.amount])).toEqual([
      ["Direct Debit", "2025-01-03", "100.00"],
      ["Savings Order", "2025-01-07", "-100.00"],
      ["Direct Debit", "2025-01-03", "50.00"],
      ["Savings Order", "2025-01-07", "-50.00"],
      ["Direct Debit", "2025-02-05", "1.20"],
      ["Cost Order", "2025-02-05", "-1.20"],
      ["Market Order", "2025-06-20", "990.00"],
      ["Withdrawal", "2025-06-25", "-990.00"],
    ]);
    // The silver order's details continue on the next page; handling costs count as a fee.
    expect(s.entries[3]!.order).toEqual({
      number: "1000002",
      metal: "Silver",
      vault: "Zurich",
      action: "buy",
      executed: { date: "2025-01-02", time: "13:05:10" },
      value: "49.25",
      fee: "0.75",
      grams: "50.000",
      total: "50.00",
    });
    expect(s.gaps).toEqual([]);
  });

  it("also reads pdftotext's wider columns, and a closing date on the same line", () => {
    const wide = PAGES.map((p) =>
      p.replace(/ {3}/g, "      ").replace("Closing balance\nDec 31 2025", "Closing balance      Dec 31 2025"),
    );
    const s = readGoldrepublic(pages(wide))!;
    expect(s.closing?.date).toBe("2025-12-31");
    expect(s.entries).toHaveLength(8);
    expect(s.gaps).toEqual([]);
  });

  it("turns it into transactions: orders in grams at the moment they ran, money in and out, storage costs", () => {
    const c = goldrepublicTransactions(readGoldrepublic(pages())!);
    expect(c.mapping).toEqual({ settleCash: true });
    expect(c.rows).toEqual([
      {
        date: "2025-01-02",
        time: "13:05:02",
        type: "buy",
        symbol: "XAU",
        assetType: "metal",
        quantity: "1.200",
        total: "99.50",
        currency: "EUR",
        fee: "0.5",
        notes: "Savings Order 1000001, Zurich",
        id: "goldrepublic:1000001",
      },
      expect.objectContaining({ time: "13:05:10", type: "buy", symbol: "XAG", quantity: "50.000", fee: "0.75" }),
      {
        date: "2025-01-03",
        type: "deposit",
        symbol: "EUR",
        assetType: "cash",
        quantity: "100.00",
        notes: "Deposit for savingsplan goud",
      },
      expect.objectContaining({ date: "2025-01-03", type: "deposit", quantity: "50.00" }),
      expect.objectContaining({ date: "2025-02-05", type: "deposit", quantity: "1.20" }),
      expect.objectContaining({
        date: "2025-02-05",
        type: "fee",
        symbol: "EUR",
        quantity: "1.20",
        notes: "Opslagkosten januari 2025",
      }),
      expect.objectContaining({
        date: "2025-06-19",
        time: "10:00:00",
        type: "sell",
        symbol: "XAU",
        quantity: "5.000",
        total: "1000.00",
        fee: "10",
      }),
      expect.objectContaining({ date: "2025-06-25", type: "withdrawal", quantity: "990.00" }),
    ]);
    // What was already there on 1 January isn't a transaction: it goes along for the preview to check.
    expect(c.warnings).toEqual([]);
    expect(c.opening).toEqual({
      date: "2025-01-01",
      metals: [
        { code: "XAU", grams: "10.000" },
        { code: "XAG", grams: "1000.000" },
        { code: "XPT", grams: "0.000" },
      ],
      cash: [{ currency: "EUR", amount: "0.50" }],
    });
  });

  it("says so when it doesn't add up", () => {
    const missing = [PAGES[0]!, PAGES[1]!.replace(/^Cost Order .*\n/m, "")];
    const c = goldrepublicTransactions(readGoldrepublic(pages(missing))!);
    expect(c.warnings[0]).toMatch(/1\.2/);
    expect(c.rows.filter((r) => r.type === "fee")).toEqual([]);
  });

  it("is a year statement for an account with values per year", () => {
    const r = readYearStatement(pages());
    expect(r.template).toBe("Goldrepublic, rekeningoverzicht");
    expect(r.year).toBe(2025);
    expect(r.found.map((f) => [f.year, f.field, f.amount, f.sure])).toEqual([
      [2025, "valueEur", "1700.50", true],
      [2026, "valueEur", "1670.50", true],
      [2025, "inEur", "151.2", true],
      [2025, "outEur", "990", true],
      // Storage, and the fees and handling costs of the orders.
      [2025, "costsEur", "12.45", true],
    ]);
  });

  it("ticks nothing but what is sure for part of a year", () => {
    const part = PAGES.map((p) => p.replace("Jan 1 2025", "Mar 1 2025"));
    const r = readYearStatement(pages(part));
    expect(r.found.map((f) => [f.year, f.field, f.sure])).toEqual([
      [2026, "valueEur", true],
      [2025, "inEur", false],
      [2025, "outEur", false],
      [2025, "costsEur", false],
    ]);
  });

  it("isn't anything else", () => {
    expect(readGoldrepublic(pages(["Account Statement\nOpening balance   Jan 1 2025"]))).toBeNull();
    expect(recognisePdf(pages(["Jaaroverzicht 2025\nING Bank N.V."]))).toBeNull();
  });

  it("imports into a vault account and ends at the statement's closing balance", async () => {
    t = await createTestApp();
    const vault = (await t.api("POST", "/api/accounts", { name: "Goldrepublic", kind: "vault" })).json();
    // What was there before 2025, by hand.
    for (const [symbol, quantity, price] of [
      ["XAU", "10", "60"],
      ["XAG", "1000", "0.7"],
    ] as const) {
      const assets = (await t.api("GET", "/api/assets")).json();
      const asset = assets.find((a: any) => a.priceRef === symbol);
      const res = await t.api("POST", "/api/transactions", {
        accountId: vault.id,
        assetId: asset.id,
        type: "buy",
        occurredAt: "2024-06-01T12:00:00Z",
        quantity,
        price,
      });
      expect(res.statusCode).toBe(200);
    }
    const eur = (await t.api("GET", "/api/assets")).json().find((a: any) => a.priceRef === "EUR");
    await t.api("POST", "/api/transactions", {
      accountId: vault.id,
      assetId: eur.id,
      type: "deposit",
      occurredAt: "2024-06-01T12:00:00Z",
      quantity: "0.50",
    });

    const content = PAGES.join("\f");
    // Into an empty vault, the preview says the years before are missing.
    const empty = (await t.api("POST", "/api/accounts", { name: "Empty vault", kind: "vault" })).json();
    const upload = async () =>
      (
        await t!.api("POST", "/api/import/upload", { fileName: "goldrepublic-statement.pdf", content, pdf: true })
      ).json();
    const up = await upload();
    expect(up.format).toMatchObject({ id: "goldrepublic", rows: 8 });
    const preview = async (u: any) =>
      (
        await t!.api("POST", "/api/import/preview", { uploadId: u.uploadId, accountId: vault.id, mapping: u.mapping })
      ).json();
    const plan = await preview(up);
    expect(plan.summary).toMatchObject({ new: 8, error: 0 });
    // What the account held before 2025 is in: the opening balance matches.
    expect(plan.checks).toEqual([expect.stringMatching(/2025-01-01/)]);
    expect(plan.warnings.join(" ")).not.toMatch(/2025-01-01/);
    const elsewhere = (
      await t.api("POST", "/api/import/preview", { uploadId: up.uploadId, accountId: empty.id, mapping: up.mapping })
    ).json();
    expect(elsewhere.checks).toEqual([]);
    expect(elsewhere.warnings).toEqual([
      expect.stringMatching(
        /2025-01-01.*(gold|goud): 10 g .*, 0 g .*(silver|zilver): 1000 g .*, 0 g .*EUR: €0\.50 .*, €0\.00/,
      ),
    ]);
    const done = await t.api("POST", "/api/import/commit", {
      uploadId: up.uploadId,
      accountId: vault.id,
      mapping: up.mapping,
    });
    expect(done.statusCode).toBe(200);

    const { holdings } = (await t.api("GET", "/api/portfolio")).json();
    const qty = (sym: string) => holdings.find((h: any) => h.symbol === sym)?.quantity;
    expect(Number(qty("XAU"))).toBe(6.2);
    expect(Number(qty("XAG"))).toBe(1050);
    // The price per gram is total ÷ grams, so the cash can be off by rounding dust.
    expect(Number(qty("EUR"))).toBeCloseTo(0.5, 6);
    // The storage costs count as storage.
    const costs = (await t.api("GET", "/api/costs")).json();
    expect(JSON.stringify(costs)).toContain('"storage"');
    // Importing it again finds the same transactions.
    expect((await preview(await upload())).summary).toMatchObject({ new: 0, duplicate: 8 });
  });

  it("refuses a PDF it can't read as transactions", async () => {
    t = await createTestApp();
    const res = await t.api("POST", "/api/import/upload", {
      fileName: "jaaroverzicht.pdf",
      content: "Jaaroverzicht 2025",
      pdf: true,
    });
    expect(res.statusCode).toBe(400);
  });
});
