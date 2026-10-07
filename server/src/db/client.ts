import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import * as schema from "./schema.js";

// Both drivers expose the same query builder API; we type everything against node-postgres.
export type DB = NodePgDatabase<typeof schema>;

export interface Database {
  db: DB;
  close(): Promise<void>;
}

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/**
 * Postgres when DATABASE_URL or the standard PGHOST/PGUSER/PGPASSWORD/PGDATABASE variables are
 * set (the latter avoid URL-escaping problems with passwords containing @, / or #); otherwise an
 * embedded PGlite database.
 *
 * `lock` applies to PGlite in a folder: the server takes it ("take"); the CLI refuses to open the
 * folder while the server holds it ("check"), as two processes would corrupt the database.
 */
export async function openDatabase(opts: {
  url?: string;
  pgEnv?: boolean;
  password?: string;
  pgliteDir?: string;
  lock?: "take" | "check";
}): Promise<Database> {
  if (opts.url || opts.pgEnv) {
    const pool = new pg.Pool({
      ...(opts.url ? { connectionString: opts.url } : {}),
      ...(opts.password ? { password: opts.password } : {}),
      max: 10,
    });
    await waitForPostgres(pool);
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }
  // In-memory when no directory is given (tests).
  if (!opts.pgliteDir) {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder });
    return { db: db as unknown as DB, close: () => client.close() };
  }
  const dir = path.resolve(opts.pgliteDir);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const unlock = lockPglite(dir, opts.lock ?? "check");
  try {
    const client = new PGlite(dir);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder });
    return {
      db: db as unknown as DB,
      close: async () => {
        await client.close();
        unlock();
      },
    };
  } catch (err) {
    unlock();
    throw err;
  }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, it's just someone else's process.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Lock file next to (not inside) the PGlite folder: PGlite expects to create that folder itself. */
export function lockPglite(dir: string, mode: "take" | "check"): () => void {
  const file = `${dir}.lock`;
  const me = { host: os.hostname(), pid: process.pid };
  if (mode === "check" && fs.existsSync(file)) {
    let held: { host?: string; pid?: number } = {};
    try {
      held = JSON.parse(fs.readFileSync(file, "utf8")) as typeof held;
    } catch {
      // unreadable: treat as held elsewhere
    }
    const sameHost = held.host === me.host;
    // A dead process, or our own pid reused after a restart, left a stale lock.
    const stale = sameHost && (!held.pid || held.pid === me.pid || !isAlive(held.pid));
    if (!stale)
      throw new Error(
        `The database in ${dir} is in use by the running Box3balans. Stop it first, or use Settings → Backups & export in the app. If it really isn't running, delete ${file}.`,
      );
  }
  fs.writeFileSync(file, JSON.stringify({ ...me, since: new Date().toISOString() }));
  return () => {
    try {
      const held = JSON.parse(fs.readFileSync(file, "utf8")) as { host?: string; pid?: number };
      if (held.host === me.host && held.pid === me.pid) fs.rmSync(file);
    } catch {
      // already gone
    }
  };
}

// Errors that mean "Postgres isn't up yet" rather than a configuration mistake.
const NOT_READY = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "57P03"]);

/**
 * After a host reboot Docker starts the app and the database together (restart policies ignore
 * `depends_on`), so wait up to `timeoutMs` for Postgres instead of crash-looping.
 */
export async function waitForPostgres(pool: pg.Pool, timeoutMs = 90_000, stepMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("select 1");
      return;
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (!NOT_READY.has(code) || Date.now() + stepMs > deadline) throw err;
      if (attempt === 1) console.warn(`Database not reachable yet (${code}), waiting for it…`);
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }
}
