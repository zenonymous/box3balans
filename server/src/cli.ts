/**
 * Maintenance commands (run with the app's environment, e.g. inside the container):
 *   node dist/cli.js backup             write a backup to BACKUP_DIR
 *   node dist/cli.js restore <file>     replace ALL data with a backup (a safety backup is written first)
 *   node dist/cli.js list               list backups in BACKUP_DIR
 *   node dist/cli.js decrypt <file>     decrypt an encrypted backup to <file without .enc> (.json.gz)
 *   node dist/cli.js disable-2fa        turn off two-step verification (when the phone is lost)
 * Encrypted backups use BACKUP_PASSPHRASE from the environment.
 */
import fs from "node:fs";
import { listBackups, readBackupFile, restoreBackup, writeBackupFile } from "./backup/backup.js";
import { decryptBackup } from "./backup/crypto.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { disableTwoFactor } from "./auth/twoFactor.js";

const [cmd, arg] = process.argv.slice(2);
const config = loadConfig();

async function main() {
  if (cmd === "list") {
    for (const b of listBackups(config.BACKUP_DIR))
      console.log(`${b.name}\t${Math.max(1, Math.round(b.sizeBytes / 1024))} KB\t${b.createdAt}`);
    return;
  }
  if (cmd === "decrypt") {
    if (!arg || !arg.endsWith(".enc") || !fs.existsSync(arg)) throw new Error("Give an existing .enc backup file");
    if (!config.BACKUP_PASSPHRASE) throw new Error("Set BACKUP_PASSPHRASE to the passphrase the backup was made with");
    const out = arg.slice(0, -".enc".length);
    fs.writeFileSync(out, await decryptBackup(fs.readFileSync(arg), config.BACKUP_PASSPHRASE), { mode: 0o600 });
    // Run as root via `docker compose exec`: same owner as the encrypted file.
    if (process.getuid?.() === 0) {
      const owner = fs.statSync(arg);
      fs.chownSync(out, owner.uid, owner.gid);
    }
    console.log(`Decrypted to ${out}`);
    return;
  }
  if (cmd === "disable-2fa") {
    const database = await openDatabase({
      url: config.DATABASE_URL,
      pgEnv: !!config.PGHOST,
      password: config.PGPASSWORD,
      pgliteDir: config.PGLITE_DIR,
      lock: "check",
    });
    try {
      await disableTwoFactor(database.db);
      console.log("Two-step verification is off. Sign in with your password and turn it on again under Settings.");
    } finally {
      await database.close();
    }
    return;
  }
  if (cmd !== "backup" && cmd !== "restore") {
    console.error("Usage: cli.js backup | restore <file> | list | decrypt <file.enc> | disable-2fa");
    process.exitCode = 2;
    return;
  }
  const database = await openDatabase({
    url: config.DATABASE_URL,
    pgEnv: !!config.PGHOST,
    password: config.PGPASSWORD,
    pgliteDir: config.PGLITE_DIR,
    lock: "check",
  });
  try {
    if (cmd === "backup") {
      const b = await writeBackupFile(database.db, config.BACKUP_DIR, "manual", config.BACKUP_PASSPHRASE);
      console.log(`Backup written: ${config.BACKUP_DIR}/${b.name} (${Math.max(1, Math.round(b.sizeBytes / 1024))} KB)`);
    } else {
      if (!arg || !fs.existsSync(arg)) throw new Error(`Backup file not found: ${arg ?? "(none given)"}`);
      const backup = await readBackupFile(arg, config.BACKUP_PASSPHRASE);
      const safety = await writeBackupFile(database.db, config.BACKUP_DIR, "prerestore", config.BACKUP_PASSPHRASE);
      console.log(`Safety backup of the current data: ${config.BACKUP_DIR}/${safety.name}`);
      const counts = await restoreBackup(database.db, backup);
      console.log(`Restored backup from ${backup.createdAt}:`);
      for (const [t, n] of Object.entries(counts)) if (n) console.log(`  ${t}: ${n} rows`);
      console.log("Restart the app so caches start fresh. Everyone has to sign in again.");
    }
  } finally {
    await database.close();
  }
}

main().catch((err) => {
  // Database errors arrive wrapped ("Failed query: …"); the reason is in the cause.
  const cause = (err as Error).cause;
  console.error(`Error: ${(err as Error).message}${cause instanceof Error ? `\nCause: ${cause.message}` : ""}`);
  process.exitCode = 1;
});
