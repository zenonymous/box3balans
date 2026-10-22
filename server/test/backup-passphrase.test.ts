import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureBackupPassphrase } from "../src/backup/passphrase.js";
import { loadConfig } from "../src/config.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const env = (extra: Record<string, string> = {}) => ({ APP_SECRET: "x".repeat(40), ...extra });
const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pd-pass-")), "backup-passphrase");

describe("backups encrypted by default", () => {
  it("makes a passphrase once, keeps it in its file, and reads it from there afterwards", () => {
    const file = tempFile();
    const first = loadConfig(env({ BACKUP_PASSPHRASE_FILE: file }));
    expect(first.BACKUP_ENCRYPT).toBe(true);
    expect(first.BACKUP_PASSPHRASE).toBeUndefined();
    expect(ensureBackupPassphrase(first)).toBe(file);
    expect(first.BACKUP_PASSPHRASE).toMatch(/^([A-HJKMNP-Z2-9]{5}-){5}[A-HJKMNP-Z2-9]{5}$/);
    expect(first.BACKUP_PASSPHRASE_SOURCE).toBe("file");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    // The next start reads it and makes no new one.
    const again = loadConfig(env({ BACKUP_PASSPHRASE_FILE: file }));
    expect(again).toMatchObject({ BACKUP_PASSPHRASE: first.BACKUP_PASSPHRASE, BACKUP_PASSPHRASE_SOURCE: "file" });
    expect(ensureBackupPassphrase(again)).toBeNull();
  });

  it("uses your own BACKUP_PASSPHRASE, and stays unencrypted with BACKUP_ENCRYPT=false", () => {
    const file = tempFile();
    const own = loadConfig(env({ BACKUP_PASSPHRASE_FILE: file, BACKUP_PASSPHRASE: "my own long passphrase" }));
    expect(ensureBackupPassphrase(own)).toBeNull();
    expect(own).toMatchObject({ BACKUP_PASSPHRASE: "my own long passphrase", BACKUP_PASSPHRASE_SOURCE: "env" });
    expect(fs.existsSync(file)).toBe(false);

    const plain = loadConfig(env({ BACKUP_PASSPHRASE_FILE: file, BACKUP_ENCRYPT: "false" }));
    expect(ensureBackupPassphrase(plain)).toBeNull();
    expect(plain.BACKUP_PASSPHRASE).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("shows the passphrase in Settings only with the password, and reminds to keep it", async () => {
    const file = tempFile();
    ensureBackupPassphrase(loadConfig(env({ BACKUP_PASSPHRASE_FILE: file })));
    t = await createTestApp(undefined, { env: { BACKUP_PASSPHRASE_FILE: file } });
    const list = (await t.api("GET", "/api/backups")).json();
    expect(list).toMatchObject({ encrypted: true, passphrase: "file" });
    expect((await t.api("POST", "/api/backups/passphrase", { password: "wrong" })).statusCode).toBe(400);
    const shown = await t.api("POST", "/api/backups/passphrase", { password: "correct horse battery" });
    expect(shown.json().passphrase).toBe(fs.readFileSync(file, "utf8"));
    const made = (await t.api("POST", "/api/backups")).json();
    expect(made.name).toMatch(/\.json\.gz\.enc$/);
    const attention = (await t.api("GET", "/api/attention")).json();
    const keys = (Array.isArray(attention) ? attention : attention.items).map((i: { key: string }) => i.key);
    expect(keys).toContain("backup-passphrase");
    expect(keys).not.toContain("backup-unencrypted");
  });
});
