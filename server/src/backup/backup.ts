import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { getTableColumns, getTableName, sql, type Table } from "drizzle-orm";
import type { DB } from "../db/client.js";
import * as s from "../db/schema.js";
import { reloadLanguage } from "../domain/settings.js";
import { decryptBackup, encryptBackup, isEncryptedBackup } from "./crypto.js";

export const BACKUP_FORMAT = "box3balans-backup";
// Backups made under the app's earlier names (portfolio dashboard, then Kluishuis).
const LEGACY_FORMATS = new Set(["portfolio-dashboard-backup", "kluishuis-backup"]);

/**
 * Tables in dependency order (parents first). Sessions are left out: a restore signs everyone out.
 * Exchange API keys stay encrypted, so a restore needs the same APP_SECRET to use them.
 */
const TABLES: Table[] = [
  s.users,
  // Before accounts: an account can belong to a child.
  s.persons,
  s.accounts,
  s.accountYears,
  s.assets,
  s.imports,
  s.transactions,
  s.metalItems,
  s.metalPhotos,
  s.pricesLatest,
  s.priceHistory,
  s.fxRates,
  s.netWorthSnapshots,
  s.auditLog,
  s.settings,
  s.integrations,
  s.syncIgnored,
  s.walletAddresses,
  s.tokenContracts,
];

// Tables with a serial id whose sequence must continue after the restored rows.
const SERIAL_TABLES = [
  "users",
  "persons",
  "accounts",
  "assets",
  "imports",
  "transactions",
  "metal_items",
  "metal_photos",
  "audit_log",
  "integrations",
  "wallet_addresses",
];

const journal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle/meta/_journal.json");

/** Number of schema migrations this build knows; a backup records it so newer backups are refused. */
export function schemaVersion(): number {
  const j = JSON.parse(fs.readFileSync(journal, "utf8")) as { entries: unknown[] };
  return j.entries.length;
}

export interface BackupFile {
  format: string;
  schemaVersion: number;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function createBackup(db: DB): Promise<BackupFile> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) tables[getTableName(t)] = (await db.select().from(t as never)) as Record<string, unknown>[];
  return { format: BACKUP_FORMAT, schemaVersion: schemaVersion(), createdAt: new Date().toISOString(), tables };
}

export const encodeBackup = (b: BackupFile): Buffer => gzipSync(Buffer.from(JSON.stringify(b)));

export function decodeBackup(buf: Buffer): BackupFile {
  let parsed: unknown;
  try {
    // A cap, so a crafted file can't unpack into all the memory there is.
    const json = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf, { maxOutputLength: 1024 ** 3 }) : buf;
    parsed = JSON.parse(json.toString("utf8"));
  } catch {
    throw new Error("Not a readable backup file");
  }
  const b = parsed as Partial<BackupFile>;
  const knownFormat = b.format === BACKUP_FORMAT || LEGACY_FORMATS.has(String(b.format));
  if (!knownFormat || typeof b.schemaVersion !== "number" || typeof b.tables !== "object" || !b.tables) {
    throw new Error("Not a Box3balans backup");
  }
  return b as BackupFile;
}

/**
 * Replaces all data with the backup's, in one database transaction (all or nothing). Backups from
 * older versions restore fine (new columns take their defaults); newer ones are refused.
 */
export async function restoreBackup(db: DB, b: BackupFile): Promise<Record<string, number>> {
  if (b.schemaVersion > schemaVersion()) {
    throw new Error("This backup comes from a newer version of the app; update the app first.");
  }
  const counts: Record<string, number> = {};
  await db.transaction(async (trx) => {
    const names = TABLES.map((t) => `"${getTableName(t)}"`).join(", ");
    await trx.execute(sql.raw(`TRUNCATE ${names}, "sessions" RESTART IDENTITY CASCADE`));
    for (const t of TABLES) {
      const name = getTableName(t);
      const rows = b.tables[name] ?? [];
      counts[name] = rows.length;
      if (rows.length === 0) continue;
      const cols = getTableColumns(t);
      // JSON turned Date columns into strings; turn them back.
      const dateKeys = Object.entries(cols)
        .filter(([, c]) => c.columnType === "PgTimestamp")
        .map(([k]) => k);
      const known = new Set(Object.keys(cols));
      const values = rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (!known.has(k)) continue; // column dropped since the backup
          out[k] = dateKeys.includes(k) && typeof v === "string" ? new Date(v) : v;
        }
        return out;
      });
      for (let i = 0; i < values.length; i += 500) {
        await trx.insert(t as never).values(values.slice(i, i + 500) as never);
      }
    }
    for (const name of SERIAL_TABLES) {
      await trx.execute(
        sql.raw(
          `SELECT setval(pg_get_serial_sequence('"${name}"', 'id'), COALESCE((SELECT MAX(id) FROM "${name}"), 0) + 1, false)`,
        ),
      );
    }
  });
  await reloadLanguage(db);
  return counts;
}

// ---- Backup files on disk ----

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
  encrypted: boolean;
}

// "box3balans-…", or "kluishuis-…" / "portfolio-…" for backups made under the earlier names; ".enc"
// when encrypted.
const NAME_RE = /^(?:box3balans|kluishuis|portfolio)-(\d{8}-\d{6})(-[a-z]+)?\.json\.gz(\.enc)?$/;
const stampOf = (name: string) => NAME_RE.exec(name)?.[1] ?? "";

/** Only names this app generates are accepted, so a request can never reach outside the folder. */
export function backupPath(dir: string, name: string): string {
  if (!NAME_RE.test(name)) throw new Error("Invalid backup name");
  return path.join(dir, name);
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/** Writes a backup; encrypted with `passphrase` when given (see crypto.ts). */
export async function writeBackupFile(
  db: DB,
  dir: string,
  label?: "auto" | "manual" | "prerestore",
  passphrase?: string,
): Promise<BackupInfo> {
  fs.mkdirSync(dir, { recursive: true });
  const plain = encodeBackup(await createBackup(db));
  const data = passphrase ? await encryptBackup(plain, passphrase) : plain;
  const name = `box3balans-${stamp(new Date())}${label ? `-${label}` : ""}.json.gz${passphrase ? ".enc" : ""}`;
  const file = backupPath(dir, name);
  // Write then rename, so a crash never leaves a half-written file that looks valid.
  fs.writeFileSync(`${file}.tmp`, data, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  // Run as root (e.g. `docker compose exec app …`): give the file to whoever owns the folder, so the
  // app can still prune it and the NAS backup tool sees the usual owner.
  if (process.getuid?.() === 0) {
    const owner = fs.statSync(dir);
    fs.chownSync(file, owner.uid, owner.gid);
  }
  return { name, sizeBytes: data.length, createdAt: new Date().toISOString(), encrypted: !!passphrase };
}

/** Reads and decodes a backup file, decrypting it when needed. */
export async function readBackupFile(file: string, passphrase?: string): Promise<BackupFile> {
  let buf: Buffer = fs.readFileSync(file);
  if (isEncryptedBackup(buf)) {
    if (!passphrase) throw new Error("This backup is encrypted: set BACKUP_PASSPHRASE or enter its passphrase");
    buf = await decryptBackup(buf, passphrase);
  }
  return decodeBackup(buf);
}

export function listBackups(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return (
    fs
      .readdirSync(dir)
      .filter((f) => NAME_RE.test(f))
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString(), encrypted: name.endsWith(".enc") };
      })
      // Newest first by the time in the name (not the prefix, which changed with the rename).
      .sort((a, b) => stampOf(b.name).localeCompare(stampOf(a.name)) || b.name.localeCompare(a.name))
  );
}

export const isAutomatic = (name: string) => /-auto\.json\.gz(\.enc)?$/.test(name);

/** Keeps the newest `keep` automatic backups; manual and pre-restore backups are never pruned. */
export function pruneBackups(dir: string, keep: number): string[] {
  const auto = listBackups(dir).filter((b) => isAutomatic(b.name));
  const removed = auto.slice(keep).map((b) => b.name);
  for (const name of removed) fs.rmSync(path.join(dir, name));
  return removed;
}
