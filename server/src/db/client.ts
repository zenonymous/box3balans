import fs from "node:fs";
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
 */
export async function openDatabase(opts: { url?: string; pgEnv?: boolean; pgliteDir?: string }): Promise<Database> {
  if (opts.url || opts.pgEnv) {
    const pool = new pg.Pool({ ...(opts.url ? { connectionString: opts.url } : {}), max: 10 });
    await waitForPostgres(pool);
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }
  // In-memory when no directory is given (tests).
  if (opts.pgliteDir) fs.mkdirSync(path.dirname(path.resolve(opts.pgliteDir)), { recursive: true });
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db: db as unknown as DB, close: () => client.close() };
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
