import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export const SESSION_COOKIE = "pd_session";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, ARGON);

export async function userCount(db: DB): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length;
}

/**
 * Creates the single user, unless one exists. Atomic: concurrent first-run requests are
 * serialised by an advisory lock, so only one of them can succeed.
 */
export async function createFirstUser(db: DB, username: string, password: string) {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (trx) => {
    await trx.execute(sql`select pg_advisory_xact_lock(7311001)`);
    const existing = await trx.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) return null;
    const [user] = await trx
      .insert(users)
      .values({ username, passwordHash })
      .returning({ id: users.id, username: users.username });
    return user!;
  });
}

// Verifying against a dummy hash for unknown users keeps response timing uniform.
let dummyHash: string | undefined;

export async function checkCredentials(db: DB, username: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  dummyHash ??= await hashPassword(randomBytes(16).toString("hex"));
  const ok = await verify(user?.passwordHash ?? dummyHash, password);
  return ok && user ? { id: user.id, username: user.username } : null;
}

export async function changePassword(db: DB, userId: number, current: string, next: string): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await verify(user.passwordHash, current))) return false;
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, userId));
  // Invalidate all sessions; the caller issues a fresh one.
  await db.delete(sessions).where(eq(sessions.userId, userId));
  return true;
}

export async function createSession(db: DB, userId: number, days: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function sessionUser(db: DB, token: string | undefined) {
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, username: users.username })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function destroySession(db: DB, token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}
