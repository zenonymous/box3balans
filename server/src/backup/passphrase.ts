import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import type { Config } from "../config.js";

// Letters and digits that can't be mistaken for one another when copied by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A passphrase like "K7QX2-MPF9R-…": six groups of five, about 148 bits. */
export function newBackupPassphrase(): string {
  const chars = Array.from({ length: 30 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return chars.match(/.{5}/g)!.join("-");
}

/**
 * Backups are encrypted by default (issue #83). Without BACKUP_PASSPHRASE, and unless
 * BACKUP_ENCRYPT=false, Box3balans makes a passphrase once and keeps it in BACKUP_PASSPHRASE_FILE
 * (only readable by the app), next to the app's other secrets. The user can see it under Settings →
 * Backups, to keep it in a password manager: without it, a backup can't be restored once /data is
 * gone. Returns the file when it was just made.
 */
export function ensureBackupPassphrase(config: Config): string | null {
  if (config.BACKUP_PASSPHRASE || !config.BACKUP_ENCRYPT || !config.BACKUP_PASSPHRASE_FILE || config.DEMO) return null;
  const file = config.BACKUP_PASSPHRASE_FILE;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const passphrase = newBackupPassphrase();
  // Written whole, then renamed, so a half-written passphrase can never be read.
  fs.writeFileSync(`${file}.tmp`, passphrase, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  config.BACKUP_PASSPHRASE = passphrase;
  config.BACKUP_PASSPHRASE_SOURCE = "file";
  return file;
}
