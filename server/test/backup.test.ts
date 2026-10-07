import fs from "node:fs";
import path from "node:path";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBackup,
  decodeBackup,
  encodeBackup,
  listBackups,
  pruneBackups,
  readBackupFile,
  restoreBackup,
  schemaVersion,
  writeBackupFile,
} from "../src/backup/backup.js";
import { openDatabase } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { SecretBox } from "../src/lib/secrets.js";
import { WrongPassphraseError, decryptBackup, encryptBackup, isEncryptedBackup } from "../src/backup/crypto.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

/** A bit of everything: accounts, assets, trades, a transfer, metal, settings, a connection and a wallet. */
async function populate() {
  const a = json(await t!.api("POST", "/api/accounts", { name: "Broker", kind: "broker" }));
  const b = json(await t!.api("POST", "/api/accounts", { name: "Ledger", kind: "wallet" }));
  const btc = json(
    await t!.api("POST", "/api/assets", {
      assetClass: "crypto",
      name: "Bitcoin",
      symbol: "BTC",
      priceSource: "coingecko",
      priceRef: "bitcoin",
    }),
  );
  await t!.api("POST", "/api/transactions", {
    accountId: a.id,
    assetId: btc.id,
    type: "buy",
    occurredAt: "2024-01-02T10:00:00Z",
    quantity: "0.5",
    price: "40000",
    feeEur: "2.5",
  });
  await t!.api("POST", "/api/transactions/transfer", {
    fromAccountId: a.id,
    toAccountId: b.id,
    assetId: btc.id,
    occurredAt: "2024-02-01T10:00:00Z",
    quantity: "0.2",
  });
  await t!.api("POST", "/api/metals/items", {
    accountId: b.id,
    metal: "gold",
    product: "Krugerrand 1 oz",
    grossWeightG: "33.93",
    purity: "0.9167",
    quantity: 2,
    purchaseDate: "2023-05-01",
    purchasePriceEur: "3800",
  });
  await t!.api("PUT", "/api/settings", { costMethod: "fifo" });
  await t!.prices.refreshAll();
  const db = t!.database.db;
  await db.insert(s.integrations).values({
    accountId: a.id,
    provider: "kraken",
    credentials: new SecretBox("x".repeat(40)).seal({ apiKey: "k", apiSecret: "s" }),
    keyHint: "…k",
  });
  await db.insert(s.walletAddresses).values({
    accountId: b.id,
    chain: "bitcoin",
    address: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    cursor: { txCounts: { x: 1 } },
  });
  await db.insert(s.syncIgnored).values({ accountId: a.id, source: "api", externalId: "gone" });
  return { a, b, btc };
}

describe("backup and restore", () => {
  it("round-trips every table into a fresh database, and new rows continue after restored ids", async () => {
    t = await createTestApp();
    await populate();
    const backup = decodeBackup(encodeBackup(await createBackup(t!.database.db)));
    expect(backup.schemaVersion).toBe(schemaVersion());
    expect(backup.tables.sessions).toBeUndefined();

    const fresh = await openDatabase({});
    try {
      const counts = await restoreBackup(fresh.db, backup);
      expect(counts.transactions).toBe(3);
      const original = await createBackup(t!.database.db);
      const restored = await createBackup(fresh.db);
      for (const name of Object.keys(original.tables)) {
        expect(JSON.parse(JSON.stringify(restored.tables[name])), name).toEqual(
          JSON.parse(JSON.stringify(original.tables[name])),
        );
      }
      // Sequences continue after the highest restored id.
      const [acc] = await fresh.db.insert(s.accounts).values({ name: "New", kind: "bank" }).returning();
      expect(acc!.id).toBe(3);
    } finally {
      await fresh.close();
    }
  });

  it("backs up and restores through the API, with a safety backup, and signs everyone out", async () => {
    t = await createTestApp();
    const { a } = await populate();
    const made = json(await t!.api("POST", "/api/backups"));
    expect(made.name).toMatch(/^box3balans-\d{8}-\d{6}-manual\.json\.gz$/);
    expect(fs.statSync(path.join(t!.backupDir, made.name)).mode & 0o077).toBe(0); // owner-only

    // Download it.
    const dl = await t!.app.inject({ method: "GET", url: `/api/backups/${made.name}`, headers: { cookie: t!.cookie } });
    expect(dl.headers["content-type"]).toBe("application/gzip");
    expect(decodeBackup(dl.rawPayload).tables.accounts).toHaveLength(2);

    // Lose some data, then restore.
    await t!.api("PUT", `/api/accounts/${a.id}`, { name: "Renamed by mistake" });
    expect((await t!.api("POST", `/api/backups/${made.name}/restore`, { confirm: "nope" })).statusCode).toBe(400);
    const res = await t!.api("POST", `/api/backups/${made.name}/restore`, { confirm: "RESTORE" });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.safetyBackup).toMatch(/-prerestore\.json\.gz$/);
    expect(fs.existsSync(path.join(t!.backupDir, body.safetyBackup))).toBe(true);

    // Sessions aren't in backups: this browser is signed out, and the restored user can sign in again.
    expect((await t!.api("GET", "/api/accounts")).statusCode).toBe(401);
    const login = await t!.api("POST", "/api/auth/login", { username: "me", password: "correct horse battery" });
    expect(login.statusCode).toBe(200);
    t!.cookie = `pd_session=${login.cookies.find((c) => c.name === "pd_session")!.value}`;
    const names = json<any[]>(await t!.api("GET", "/api/accounts")).map((x) => x.name);
    expect(names).toContain("Broker");
    expect(names).not.toContain("Renamed by mistake");
    expect(json(await t!.api("GET", "/api/settings")).costMethod).toBe("fifo");
  });

  it("only serves files it created (no path traversal)", async () => {
    t = await createTestApp();
    for (const bad of ["..%2F..%2Fetc%2Fpasswd", "box3balans-20240101-000000.json.gz.tmp", "secrets.txt"]) {
      const res = await t!.api("GET", `/api/backups/${bad}`);
      expect([400, 404]).toContain(res.statusCode);
    }
    expect((await t!.api("POST", "/api/backups/..%2Fx/restore", { confirm: "RESTORE" })).statusCode).toBe(400);
  });

  it("refuses backups from a newer version and files that aren't backups", async () => {
    t = await createTestApp();
    const b = await createBackup(t!.database.db);
    await expect(restoreBackup(t!.database.db, { ...b, schemaVersion: schemaVersion() + 1 })).rejects.toThrow(
      /newer version/,
    );
    expect(() => decodeBackup(Buffer.from("hello"))).toThrow(/Not a readable backup/);
    expect(() => decodeBackup(Buffer.from(JSON.stringify({ format: "other" })))).toThrow(/Not a Box3balans backup/);
  });

  it("keeps only the newest automatic backups", async () => {
    t = await createTestApp();
    const touch = (n: string) => fs.writeFileSync(path.join(t!.backupDir, n), "x");
    for (let d = 1; d <= 5; d++) touch(`box3balans-2024010${d}-000000-auto.json.gz`);
    touch("box3balans-20230101-000000-manual.json.gz");
    const removed = pruneBackups(t!.backupDir, 3);
    expect(removed.sort()).toEqual([
      "box3balans-20240101-000000-auto.json.gz",
      "box3balans-20240102-000000-auto.json.gz",
    ]);
    expect(fs.existsSync(path.join(t!.backupDir, "box3balans-20230101-000000-manual.json.gz"))).toBe(true);
  });

  // Renames (portfolio → Kluishuis → Box3balans): backups made under the old names still list, sort
  // by time and restore.
  it("still handles backups made before the rename", async () => {
    t = await createTestApp();
    await populate();
    const b = await createBackup(t!.database.db);
    const legacy = { ...b, format: "portfolio-dashboard-backup" };
    expect(decodeBackup(encodeBackup({ ...b, format: "kluishuis-backup" })).format).toBe("kluishuis-backup");
    fs.writeFileSync(path.join(t!.backupDir, "portfolio-20250601-120000-manual.json.gz"), encodeBackup(legacy));
    const touch = (n: string) => fs.writeFileSync(path.join(t!.backupDir, n), "x");
    touch("kluishuis-20250101-000000-auto.json.gz");
    touch("kluishuis-20251001-000000-auto.json.gz");
    touch("portfolio-20250501-000000-auto.json.gz");
    touch("box3balans-20251101-000000-auto.json.gz");
    expect(listBackups(t!.backupDir).map((x) => x.name)).toEqual([
      "box3balans-20251101-000000-auto.json.gz",
      "kluishuis-20251001-000000-auto.json.gz",
      "portfolio-20250601-120000-manual.json.gz",
      "portfolio-20250501-000000-auto.json.gz",
      "kluishuis-20250101-000000-auto.json.gz",
    ]);
    // The oldest automatic backup goes, whatever its prefix.
    expect(pruneBackups(t!.backupDir, 3)).toEqual(["kluishuis-20250101-000000-auto.json.gz"]);
    const res = await t!.api("POST", "/api/backups/portfolio-20250601-120000-manual.json.gz/restore", {
      confirm: "RESTORE",
    });
    expect(res.statusCode).toBe(200);
  });

  it("covers every table except sessions", () => {
    const all = (Object.values(s) as unknown[])
      .filter((v): v is PgTable => is(v, PgTable))
      .map((v) => getTableName(v))
      .filter((n) => n !== "sessions")
      .sort();
    return createBackup({ select: () => ({ from: async () => [] }) } as never).then((b) =>
      expect(Object.keys(b.tables).sort()).toEqual(all),
    );
  });
});

describe("encrypted backups", () => {
  const PASS = "correct horse battery staple";

  it("round-trips, and refuses a wrong passphrase or a tampered file", async () => {
    const plain = Buffer.from("hello backup");
    const enc = await encryptBackup(plain, PASS);
    expect(isEncryptedBackup(enc)).toBe(true);
    expect(enc.includes(plain)).toBe(false);
    expect((await decryptBackup(enc, PASS)).equals(plain)).toBe(true);
    await expect(decryptBackup(enc, "wrong passphrase!!")).rejects.toBeInstanceOf(WrongPassphraseError);
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 1]! ^= 1;
    await expect(decryptBackup(tampered, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
    // The scrypt parameters are authenticated too.
    const weaker = Buffer.from(enc);
    weaker[8] = 14;
    await expect(decryptBackup(weaker, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
    // Two encryptions of the same data differ (random salt and IV).
    expect((await encryptBackup(plain, PASS)).equals(enc)).toBe(false);
  });

  it("writes .enc backups with BACKUP_PASSPHRASE and restores them through the API", async () => {
    t = await createTestApp(undefined, { env: { BACKUP_PASSPHRASE: PASS } });
    await populate();
    const list0 = json(await t!.api("GET", "/api/backups"));
    expect(list0.encrypted).toBe(true);
    const made = json(await t!.api("POST", "/api/backups"));
    expect(made).toMatchObject({ encrypted: true, name: expect.stringMatching(/-manual\.json\.gz\.enc$/) });
    const file = path.join(t!.backupDir, made.name);
    expect(isEncryptedBackup(fs.readFileSync(file))).toBe(true);
    await expect(readBackupFile(file)).rejects.toThrow(/encrypted/);
    expect((await readBackupFile(file, PASS)).tables.accounts).toHaveLength(2);

    const res = await t!.api("POST", `/api/backups/${made.name}/restore`, { confirm: "RESTORE" });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res).safetyBackup).toMatch(/-prerestore\.json\.gz\.enc$/);

    // A restore signs everyone out; sign in again.
    const login = await t!.api("POST", "/api/auth/login", { username: "me", password: "correct horse battery" });
    t!.cookie = `pd_session=${login.cookies.find((c) => c.name === "pd_session")!.value}`;

    // A backup made with an earlier passphrase: refused, unless that passphrase is entered.
    const old = await writeBackupFile(t!.database.db, t!.backupDir, "manual", "an older passphrase");
    const refused = await t!.api("POST", `/api/backups/${old.name}/restore`, { confirm: "RESTORE" });
    expect(refused.statusCode).toBe(400);
    expect(json(refused).error).toMatch(/Wrong backup passphrase/);
    const ok = await t!.api("POST", `/api/backups/${old.name}/restore`, {
      confirm: "RESTORE",
      passphrase: "an older passphrase",
    });
    expect(ok.statusCode).toBe(200);

    // Pruning counts encrypted automatic backups too.
    for (let d = 1; d <= 3; d++)
      fs.writeFileSync(path.join(t!.backupDir, `box3balans-2024010${d}-000000-auto.json.gz.enc`), "x");
    expect(pruneBackups(t!.backupDir, 2)).toEqual(["box3balans-20240101-000000-auto.json.gz.enc"]);
  });

  it("rejects a short passphrase at startup", async () => {
    await expect(createTestApp(undefined, { env: { BACKUP_PASSPHRASE: "short" } })).rejects.toThrow(/at least 12/);
  });
});

describe("CSV export", () => {
  it("exports every transaction with names", async () => {
    t = await createTestApp();
    await populate();
    const res = await t!.api("GET", "/api/export/transactions.csv");
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.body
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    expect(lines[0]).toMatch(/^Date,Type,Account,Asset,Symbol,ISIN,Quantity/);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("buy,Broker,Bitcoin,BTC");
  });
});
