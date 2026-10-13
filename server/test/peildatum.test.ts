import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { accountYears, imports, integrations, settings, walletAddresses } from "../src/db/schema.js";
import { currentPeildatumYear, peildatumChecklist } from "../src/domain/peildatum.js";
import { saveStatement, storedChecks } from "../src/import/statement.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const empty = { source: "degiro-portfolio" as const, positions: [], cash: [] };

async function household() {
  t = await createTestApp();
  const db = t.database.db;
  const api = async (method: string, url: string, body?: object) => {
    const res = await t!.api(method, url, body);
    if (res.statusCode >= 400) throw new Error(`${url}: ${res.body}`);
    return res.json();
  };
  const acc = (name: string, kind: string, extra: object = {}) =>
    api("POST", "/api/accounts", { name, kind, ...extra });
  const savings = await acc("Spaarrekening", "bank", { tracking: "yearly" });
  const home = await acc("Tweede huis", "property");
  await db.insert(accountYears).values({ accountId: home.id, year: 2026, valueEur: "300000" });
  const exchange = await acc("Bitvavo", "exchange", { provider: "bitvavo" });
  await db.insert(integrations).values({
    accountId: exchange.id,
    provider: "bitvavo",
    credentials: "x",
    lastStatus: "ok",
    lastSyncAt: new Date("2026-01-05T10:00:00Z"),
  });
  const ledger = await acc("Ledger", "wallet");
  await db.insert(walletAddresses).values({
    accountId: ledger.id,
    chain: "bitcoin",
    address: "bc1qexample",
    lastStatus: "ok",
    lastSyncAt: new Date("2025-12-20T10:00:00Z"),
  });
  const degiro = await acc("DEGIRO", "broker", { provider: "degiro" });
  const broker = await acc("Andere broker", "broker");
  await db.insert(imports).values({
    accountId: broker.id,
    fileName: "export.csv",
    rows: 3,
    inserted: 3,
    createdAt: new Date("2025-11-01T10:00:00Z"),
  });
  await acc("Kluis thuis", "physical");
  await acc("Oude wallet", "wallet");
  // Crypto that left the exchange in 2025 and didn't arrive anywhere here.
  const btc = await api("POST", "/api/assets", {
    assetClass: "crypto",
    name: "Bitcoin",
    symbol: "BTC",
    priceSource: "manual",
  });
  await api("POST", "/api/transactions", {
    accountId: exchange.id,
    assetId: btc.id,
    type: "deposit",
    occurredAt: "2025-03-01T10:00:00Z",
    quantity: "0.1",
    price: "50000",
  });
  await api("POST", "/api/transactions", {
    accountId: exchange.id,
    assetId: btc.id,
    type: "withdrawal",
    occurredAt: "2025-06-01T10:00:00Z",
    quantity: "0.1",
    price: "0",
  });
  return { db, savings, degiro };
}

const byKey = (c: Awaited<ReturnType<typeof peildatumChecklist>>) =>
  Object.fromEntries(c.items.map((i) => [i.key.replace(/:\d+$/, ""), i]));

describe("peildatum checklist", () => {
  it("lists per account what the peildatum still needs, once it has passed", async () => {
    const { db, degiro } = await household();
    const c = await peildatumChecklist(db, 2026, new Date("2026-02-01T10:00:00Z"));
    expect(c).toMatchObject({ year: 2026, day: "2025-12-31", passed: true });
    const text = Object.fromEntries(c.items.map((i) => [`${i.account ?? "-"}|${i.status}`, i.text]));
    expect(text).toMatchObject({
      "Spaarrekening|todo": "Enter the value on 1 January 2026",
      "Tweede huis|ok": "Value on 1 January 2026 entered",
      "Bitvavo|ok": "Synced after 31 December",
      "Ledger|todo": "Sync after 31 December 2025",
      "DEGIRO|todo":
        "Import the account statement up to 31 December 2025, then the portfolio (Portefeuille) of that day",
      "Andere broker|todo": "Import the transactions up to 31 December 2025",
      "Oude wallet|info": "Kept by hand: check that its transactions up to 31 December are complete",
    });
    // A place for coins and bars has nothing to fetch.
    expect(c.items.some((i) => i.account === "Kluis thuis")).toBe(false);
    expect(byKey(c).unlinked).toMatchObject({
      status: "todo",
      text: "1 crypto withdrawal from an exchange in 2025 didn't arrive in an account here. Is each of your wallets in the app?",
    });
    expect(byKey(c).rules).toMatchObject({ status: "info", text: "The box 3 rules for 2026 are still provisional." });
    expect(c.open).toBe(5);

    // DEGIRO's portfolio of that day, matching the transactions: done.
    await saveStatement(db, degiro.id, "2025-12-31", empty);
    const after = await peildatumChecklist(db, 2026, new Date("2026-02-01T10:00:00Z"));
    expect(after.items.find((i) => i.account === "DEGIRO")).toMatchObject({
      status: "ok",
      text: "Checked against the portfolio of 31 December",
    });
    expect(after.open).toBe(4);
  });

  it("before the peildatum, says what to do once it has passed", async () => {
    const { db } = await household();
    const c = await peildatumChecklist(db, 2026, new Date("2025-12-20T10:00:00Z"));
    expect(c.passed).toBe(false);
    const status = Object.fromEntries(c.items.filter((i) => i.account).map((i) => [i.account, i.status]));
    expect(status).toMatchObject({
      Spaarrekening: "later",
      Ledger: "later",
      DEGIRO: "later",
      "Andere broker": "later",
      Bitvavo: "ok",
    });
    // The missing wallet is worth fixing now already.
    expect(c.open).toBe(1);
  });

  it("leaves out accounts that didn't exist on the peildatum", async () => {
    const { db } = await household();
    const api = async (method: string, url: string, body?: object) => (await t!.api(method, url, body)).json();
    const later = await api("POST", "/api/accounts", {
      name: "Nieuwe spaarrekening",
      kind: "bank",
      tracking: "yearly",
    });
    await db.insert(accountYears).values({ accountId: later.id, year: 2027, valueEur: "1000" });
    const exchange = await api("POST", "/api/accounts", { name: "Nieuwe exchange", kind: "exchange" });
    const eth = await api("POST", "/api/assets", {
      assetClass: "crypto",
      name: "Ether",
      symbol: "ETH",
      priceSource: "manual",
    });
    await api("POST", "/api/transactions", {
      accountId: exchange.id,
      assetId: eth.id,
      type: "deposit",
      occurredAt: "2026-03-01T10:00:00Z",
      quantity: "1",
      price: "2000",
    });
    const names = (await peildatumChecklist(db, 2026, new Date("2026-06-01T10:00:00Z"))).items.map((i) => i.account);
    expect(names).not.toContain("Nieuwe spaarrekening");
    expect(names).not.toContain("Nieuwe exchange");
  });

  it("is served for this year and the next, not later", async () => {
    await household();
    const year = new Date().getFullYear();
    const res = await t!.api("GET", `/api/box3/${year + 1}/checklist`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ year: year + 1, day: `${year}-12-31` });
    expect((await t!.api("GET", `/api/box3/${year + 2}/checklist`)).statusCode).toBe(400);
  });

  it("puts what's left under Needs attention in January", async () => {
    await household();
    vi.useFakeTimers({ now: new Date("2026-01-10T10:00:00Z"), toFake: ["Date"], shouldAdvanceTime: true });
    try {
      const issues = (await t!.api("GET", "/api/attention")).json();
      expect(issues.find((i: { key: string }) => i.key === "peildatum:2026")).toMatchObject({
        severity: "info",
        title: "1 January 2026: 5 things left for box 3",
        link: { to: "/box3?checklist=2026" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the reminder from mid-December to the end of May", () => {
    expect(currentPeildatumYear("2026-12-14")).toBeNull();
    expect(currentPeildatumYear("2026-12-15")).toBe(2027);
    expect(currentPeildatumYear("2027-01-02")).toBe(2027);
    expect(currentPeildatumYear("2027-05-31")).toBe(2027);
    expect(currentPeildatumYear("2027-06-01")).toBeNull();
  });
});

describe("portfolio statements per day", () => {
  it("keeps one per account and day, replacing one kept the old way", async () => {
    const { db, degiro } = await household();
    // 0.1.16 kept one per account, under "statement:<account>".
    await db.insert(settings).values({
      key: `statement:${degiro.id}`,
      value: { day: "2024-12-31", statement: empty, at: "2026-10-11T10:00:00Z" },
    });
    await saveStatement(db, degiro.id, "2025-12-31", empty);
    expect((await storedChecks(db, degiro.id)).map((c) => c.day)).toEqual(["2025-12-31", "2024-12-31"]);
    await saveStatement(db, degiro.id, "2024-12-31", empty);
    expect(
      await db
        .select()
        .from(settings)
        .where(eq(settings.key, `statement:${degiro.id}`)),
    ).toEqual([]);
    expect((await storedChecks(db, degiro.id)).map((c) => c.day)).toEqual(["2025-12-31", "2024-12-31"]);
    expect((await storedChecks(db, degiro.id, "2024-12-31")).map((c) => c.day)).toEqual(["2024-12-31"]);
  });
});
