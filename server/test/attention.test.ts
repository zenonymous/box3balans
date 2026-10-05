import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordBackupStatus } from "../src/backup/status.js";
import { integrations, settings, transactions, walletAddresses } from "../src/db/schema.js";
import { REFRESH_STATUS_KEY } from "../src/prices/service.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const issues = async () => json<any[]>(await t.api("GET", "/api/attention"));
const byKey = async (prefix: string) => (await issues()).filter((i) => i.key.startsWith(prefix));

async function setup(env: Record<string, string> = {}) {
  t = await createTestApp(undefined, { env });
  const mk = async (name: string, kind: string) => json(await t.api("POST", "/api/accounts", { name, kind }));
  const exchange = await mk("Bitvavo", "exchange");
  const wallet = await mk("Ledger", "wallet");
  const btc = json(
    await t.api("POST", "/api/assets", {
      assetClass: "crypto",
      name: "Bitcoin",
      symbol: "BTC",
      priceSource: "coingecko",
      priceRef: "bitcoin",
    }),
  );
  return { exchange, wallet, btc };
}

describe("needs attention", () => {
  it("flags unencrypted backups, and a dismissal holds until the issue changes", async () => {
    await setup();
    const [unencrypted] = await byKey("backup-unencrypted");
    expect(unencrypted).toMatchObject({ severity: "warning", dismissible: true, dismissed: false });
    await t.api("POST", "/api/attention/dismiss", { key: unencrypted.key, fingerprint: unencrypted.fingerprint });
    expect((await byKey("backup-unencrypted"))[0].dismissed).toBe(true);
  });

  it("is quiet about backups once they're encrypted", async () => {
    await setup({ BACKUP_PASSPHRASE: "a long enough passphrase" });
    expect(await byKey("backup")).toEqual([]);
  });

  it("reports negative balances as problems that can't be dismissed", async () => {
    const { exchange, btc } = await setup();
    await t.api("POST", "/api/transactions", {
      accountId: exchange.id,
      assetId: btc.id,
      type: "sell",
      occurredAt: "2024-03-01T10:00:00Z",
      quantity: "0.5",
      price: "40000",
    });
    const [neg] = await byKey("negative:");
    expect(neg).toMatchObject({
      severity: "problem",
      dismissible: false,
      title: "Negative balance: -0.5 BTC in Bitvavo",
    });
    await t.api("POST", "/api/attention/dismiss", { key: neg.key, fingerprint: neg.fingerprint });
    expect((await byKey("negative:"))[0].dismissed).toBe(false);
    // Problems come first.
    expect((await issues())[0].severity).toBe("problem");
  });

  it("reports failed syncs, balance differences and unfinished imports", async () => {
    const { exchange, wallet } = await setup();
    await t.database.db.insert(integrations).values({
      accountId: exchange.id,
      provider: "bitvavo",
      credentials: "x",
      lastStatus: "error",
      lastSyncAt: new Date(),
      lastResult: { at: "2026-10-05T10:00:00Z", error: "Invalid API key" },
    });
    await t.database.db.insert(walletAddresses).values({
      accountId: wallet.id,
      chain: "bitcoin",
      address: "bc1qexample",
      lastStatus: "warning",
      lastSyncAt: new Date(),
      lastResult: {
        at: "x",
        partial: true,
        mismatches: [{ symbol: "BTC", difference: "0.001", reported: "1", computed: "0.999" }],
      },
    });
    const list = await issues();
    expect(list.find((i) => i.key.startsWith("connection-error"))).toMatchObject({
      severity: "problem",
      title: "Bitvavo: the last sync failed",
      detail: "Invalid API key",
    });
    expect(list.find((i) => i.key.startsWith("wallet-mismatch"))).toMatchObject({
      severity: "warning",
      title: "Ledger (bitcoin): 1 balance difference",
    });
    expect(list.find((i) => i.key.startsWith("wallet-partial"))?.severity).toBe("info");
  });

  it("points out zero-value deposits, unlinked exchange withdrawals and failed prices", async () => {
    const { exchange, wallet, btc } = await setup();
    const db = t.database.db;
    await db.insert(transactions).values([
      {
        accountId: wallet.id,
        assetId: btc.id,
        type: "deposit",
        occurredAt: new Date("2024-01-01"),
        quantity: "1",
        price: "0",
      },
      {
        accountId: exchange.id,
        assetId: btc.id,
        type: "buy",
        occurredAt: new Date("2024-01-01"),
        quantity: "2",
        price: "40000",
      },
      {
        accountId: exchange.id,
        assetId: btc.id,
        type: "withdrawal",
        occurredAt: new Date("2024-02-01"),
        quantity: "1",
      },
    ]);
    await db.insert(settings).values({
      key: REFRESH_STATUS_KEY,
      value: { at: "x", updated: 0, failed: [{ assetId: btc.id, symbol: "BTC", error: "429" }] },
    });
    const list = await issues();
    expect(list.find((i) => i.key === "zero-cost")).toMatchObject({
      severity: "info",
      title: "1 deposit or reward without a value",
    });
    expect(list.find((i) => i.key === "unlinked-withdrawals")).toMatchObject({
      severity: "info",
      title: "1 crypto withdrawal from exchanges not linked to a deposit",
    });
    expect(list.find((i) => i.key === "price-failed")).toMatchObject({ detail: "BTC" });
  });

  it("reports failed and overdue automatic backups", async () => {
    await setup({ BACKUP_PASSPHRASE: "a long enough passphrase" });
    await recordBackupStatus(t.database.db, {
      lastErrorAt: new Date().toISOString(),
      lastError: "EACCES: permission denied",
    });
    const file = path.join(t.backupDir, "kluishuis-20240101-000000-auto.json.gz.enc");
    fs.writeFileSync(file, "x");
    const old = new Date(Date.now() - 5 * 86_400_000);
    fs.utimesSync(file, old, old);
    const list = await byKey("backup");
    expect(list.map((i) => [i.key, i.severity])).toEqual([
      ["backup-failed", "problem"],
      ["backup-overdue", "problem"],
    ]);
    expect(list[0].detail).toBe("EACCES: permission denied");
    expect(list[1].title).toBe("No automatic backup since 5 days ago");
  });
});
