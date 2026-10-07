import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Encrypted backup file layout (all integers single bytes):
 *   "KHBAK1\n\0" | log2(N) | r | p | salt (16) | iv (12) | GCM tag (16) | ciphertext
 * The key is scrypt(passphrase, salt) and the cipher AES-256-GCM, so a wrong passphrase or a
 * tampered file fails to decrypt instead of producing garbage.
 */
const MAGIC = Buffer.from("KHBAK1\n\0", "latin1");
// 128 MiB of memory per derivation (OWASP's recommendation for scrypt): slow to brute-force, quick
// enough for a backup. Files keep their own parameters, so backups made with 2^15 still open.
const LOG_N = 17;
const R = 8;
const P = 1;

export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong backup passphrase (or the file is damaged)");
  }
}

export const isEncryptedBackup = (buf: Buffer) =>
  buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);

const deriveKey = (passphrase: string, salt: Buffer, logN: number, r: number, p: number) =>
  scrypt(passphrase.normalize("NFC"), salt, 32, { N: 2 ** logN, r, p, maxmem: 256 * 2 ** logN * r + 1024 * 1024 });

export async function encryptBackup(plain: Buffer, passphrase: string, logN = LOG_N): Promise<Buffer> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt, logN, R, P);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const header = Buffer.concat([MAGIC, Buffer.from([logN, R, P]), salt, iv]);
  // The header is authenticated too, so its parameters can't be swapped.
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), body]);
}

export async function decryptBackup(buf: Buffer, passphrase: string): Promise<Buffer> {
  if (!isEncryptedBackup(buf)) throw new Error("Not an encrypted Box3balans backup");
  let o = MAGIC.length;
  const [logN, r, p] = [buf[o]!, buf[o + 1]!, buf[o + 2]!];
  o += 3;
  if (logN < 10 || logN > 20 || r < 1 || r > 16 || p < 1 || p > 4) throw new Error("Damaged backup file");
  const salt = buf.subarray(o, (o += 16));
  const iv = buf.subarray(o, (o += 12));
  const header = buf.subarray(0, o);
  const tag = buf.subarray(o, (o += 16));
  const key = await deriveKey(passphrase, salt, logN, r, p);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(buf.subarray(o)), decipher.final()]);
  } catch {
    throw new WrongPassphraseError();
  }
}
