import { createHmac, randomBytes } from "node:crypto";

/** Time-based one-time passwords (RFC 6238, as authenticator apps use them): SHA-1, 30 s, 6 digits. */
const STEP_S = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, in base32 as apps expect it. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** RFC 4226: the code for one counter value. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, "0");
}

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_S);

/**
 * The time step a code belongs to, allowing one step of clock drift either way; null when it
 * matches none. The caller refuses steps already used, so a code works once.
 */
export function matchTotp(secretB32: string, code: string, now = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const secret = base32Decode(secretB32);
  const step = totpStep(now);
  for (const s of [step, step - 1, step + 1]) if (hotp(secret, s) === c) return s;
  return null;
}

/** What an authenticator app scans: otpauth://totp/Kluishuis:me?secret=…&issuer=Kluishuis */
export function otpauthUri(secretB32: string, account: string, issuer = "Kluishuis"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;
}
