import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { renderSVG } from "uqr";
import type { DB } from "../db/client.js";
import { users } from "../db/schema.js";
import type { SecretBox } from "../lib/secrets.js";
import { base32Encode, matchTotp, newTotpSecret, otpauthUri } from "../lib/totp.js";

/**
 * Signing in with a second factor: a code from an authenticator app (TOTP) or, when the phone is
 * gone, one of ten one-time recovery codes. The secret is sealed with APP_SECRET like exchange keys.
 */
// Recovery codes are read and typed by people: lower case, without dashes or spaces.
const normalise = (code: string) => code.toLowerCase().replace(/[\s-]/g, "");

/** The stored key can't be opened: APP_SECRET differs from the one it was set up with. */
export class TwoFactorUnreadable extends Error {}

function openSecret(secrets: SecretBox, sealed: string): string {
  try {
    return secrets.open<string>(sealed);
  } catch {
    throw new TwoFactorUnreadable("The two-step verification key can't be decrypted");
  }
}

export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
}

async function user(db: DB, userId: number) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new Error("No such user");
  return u;
}

export async function twoFactorStatus(db: DB, userId: number): Promise<TwoFactorStatus> {
  const u = await user(db, userId);
  return { enabled: !!u.totpSecret, recoveryCodesLeft: u.recoveryCodes.length };
}

export const isTwoFactorEnabled = async (db: DB, userId: number) => !!(await user(db, userId)).totpSecret;

/** A new secret to scan: kept as pending until a code from the app confirms it. */
export async function startTwoFactor(db: DB, secrets: SecretBox, userId: number) {
  const u = await user(db, userId);
  const secret = newTotpSecret();
  await db
    .update(users)
    .set({ totpPending: secrets.seal(secret) })
    .where(eq(users.id, userId));
  const uri = otpauthUri(secret, u.username);
  return { secret, uri, qrSvg: renderSVG(uri, { border: 1 }) };
}

/** Ten codes of 50 random bits ("abcde-fghij"), stored as keyed hashes. */
function newRecoveryCodes(secrets: SecretBox): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 10 }, () => {
    const raw = base32Encode(randomBytes(7)).toLowerCase().slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
  return { codes, hashes: codes.map((c) => secrets.mac(normalise(c))) };
}

/** Turns the second factor on when `code` matches the pending secret; returns the recovery codes. */
export async function enableTwoFactor(db: DB, secrets: SecretBox, userId: number, code: string) {
  const u = await user(db, userId);
  if (!u.totpPending) return null;
  const secret = openSecret(secrets, u.totpPending);
  const step = matchTotp(secret, code);
  if (step == null) return null;
  const { codes, hashes } = newRecoveryCodes(secrets);
  await db
    .update(users)
    .set({ totpSecret: u.totpPending, totpPending: null, totpLastStep: step, recoveryCodes: hashes })
    .where(eq(users.id, userId));
  return codes;
}

/**
 * Checks a code at sign-in (or before changing 2FA): an app code not used before, or an unused
 * recovery code, which is then spent.
 */
export async function verifySecondFactor(
  db: DB,
  secrets: SecretBox,
  userId: number,
  code: string,
): Promise<"app" | "recovery" | null> {
  const u = await user(db, userId);
  if (!u.totpSecret) return null;
  const step = matchTotp(openSecret(secrets, u.totpSecret), code);
  if (step != null) {
    if (u.totpLastStep != null && step <= u.totpLastStep) return null;
    await db.update(users).set({ totpLastStep: step }).where(eq(users.id, userId));
    return "app";
  }
  const hash = secrets.mac(normalise(code));
  if (u.recoveryCodes.includes(hash)) {
    await db
      .update(users)
      .set({ recoveryCodes: u.recoveryCodes.filter((h) => h !== hash) })
      .where(eq(users.id, userId));
    return "recovery";
  }
  return null;
}

/** Ten fresh recovery codes, replacing the old ones. */
export async function renewRecoveryCodes(db: DB, secrets: SecretBox, userId: number): Promise<string[]> {
  const { codes, hashes } = newRecoveryCodes(secrets);
  await db.update(users).set({ recoveryCodes: hashes }).where(eq(users.id, userId));
  return codes;
}

export async function disableTwoFactor(db: DB, userId?: number): Promise<void> {
  const off = { totpSecret: null, totpPending: null, totpLastStep: null, recoveryCodes: [] };
  if (userId == null) await db.update(users).set(off);
  else await db.update(users).set(off).where(eq(users.id, userId));
}
