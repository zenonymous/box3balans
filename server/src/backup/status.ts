import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { settings } from "../db/schema.js";

const KEY = "backup_status";

/** Outcome of the latest automatic backups, for the "needs attention" overview. */
export interface BackupStatus {
  lastSuccessAt?: string;
  lastName?: string;
  lastErrorAt?: string;
  lastError?: string;
}

export async function getBackupStatus(db: DB): Promise<BackupStatus> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return (row?.value as BackupStatus | undefined) ?? {};
}

export async function recordBackupStatus(db: DB, patch: BackupStatus): Promise<void> {
  const value = { ...(await getBackupStatus(db)), ...patch };
  await db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}
