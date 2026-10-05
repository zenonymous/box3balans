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
