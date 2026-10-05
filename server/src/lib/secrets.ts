import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

/**
 * Encrypts small secrets (exchange API credentials) with AES-256-GCM. The key is derived from
 * APP_SECRET with HKDF, so changing APP_SECRET makes stored credentials unreadable.
 */
export class SecretBox {
  private key: Buffer;

  constructor(appSecret: string) {
    // The salt keeps the app's original name on purpose: changing it would make every stored
    // exchange key undecryptable.
    this.key = Buffer.from(hkdfSync("sha256", appSecret, "portfolio-dashboard", "credentials-v1", 32));
  }

  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
  }

  open<T = unknown>(sealed: string): T {
    const [version, payload] = sealed.split(":");
    if (version !== VERSION || !payload) throw new Error("Unsupported credential format");
    const buf = Buffer.from(payload, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    try {
      const pt = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
      return JSON.parse(pt.toString("utf8")) as T;
    } catch {
      throw new Error("Stored credentials cannot be decrypted (was APP_SECRET changed?). Re-enter the API key.");
    }
  }
}
