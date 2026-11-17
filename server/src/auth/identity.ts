import type { DB } from "../db/client.js";
import { tr, trn } from "../i18n/index.js";
import { HttpError } from "../lib/errors.js";
import type { SecretBox } from "../lib/secrets.js";
import { isUserPassword } from "./service.js";
import { isTwoFactorEnabled, TwoFactorUnreadable, verifySecondFactor } from "./twoFactor.js";

/**
 * Checks who's there: a code from the authenticator app (or a recovery code) at sign-in, and the
 * password plus, with two-step verification on, a code before changes a left-open session shouldn't
 * be enough for (turning two-step verification off, restoring a backup).
 *
 * Wrong codes count per user, whichever route they come in through: after five in a row, codes
 * aren't checked for 15 minutes, doubling with each lockout up to a day. The rate limits count per
 * IP address; this holds however many addresses someone uses. Kept in memory, like the rate limits.
 */
export class IdentityCheck {
  private wrongCodes = new Map<number, { count: number; lockouts: number; until: number }>();

  constructor(
    private db: DB,
    private secrets: SecretBox,
  ) {}

  /** Checks a code from the app or a recovery code, which is then spent; null when it isn't right. */
  async verifyCode(userId: number, code: string): Promise<"app" | "recovery" | null> {
    const w = this.wrongCodes.get(userId) ?? { count: 0, lockouts: 0, until: 0 };
    if (w.until > Date.now()) {
      const minutes = Math.ceil((w.until - Date.now()) / 60_000);
      throw new HttpError(
        429,
        trn(
          minutes,
          "Too many wrong codes. Try again in {n} minute.",
          "Too many wrong codes. Try again in {n} minutes.",
        ),
      );
    }
    const result = await this.match(userId, code);
    if (result) this.wrongCodes.delete(userId);
    else if (++w.count >= 5) {
      w.until = Date.now() + Math.min(15 * 60_000 * 2 ** w.lockouts++, 86_400_000);
      w.count = 0;
      this.wrongCodes.set(userId, w);
    } else this.wrongCodes.set(userId, w);
    return result;
  }

  /** The password, and with two-step verification on a code too; throws a 400 saying which is wrong. */
  async confirm(userId: number, password: string, code?: string): Promise<void> {
    await this.checkPassword(userId, password);
    await this.checkSecondFactor(userId, code);
  }

  /** The first half of confirm(): throws a 400 when the password isn't the user's. */
  async checkPassword(userId: number, password: string): Promise<void> {
    if (!(await isUserPassword(this.db, userId, password))) throw new HttpError(400, tr("That password isn't right"));
  }

  /**
   * The second half: with two-step verification on, a code, which is then spent. Callers that can
   * still refuse or fail for other reasons do those first, so that doesn't use up a recovery code.
   */
  async checkSecondFactor(userId: number, code: string | undefined): Promise<void> {
    if (!(await isTwoFactorEnabled(this.db, userId))) return;
    if (!code) throw new HttpError(400, tr("Enter the code from your authenticator app"));
    if (!(await this.verifyCode(userId, code)))
      throw new HttpError(400, tr("That code isn't right, or was already used"));
  }

  // A key that can't be opened means APP_SECRET changed: say how to get back in instead of failing.
  private async match(userId: number, code: string) {
    try {
      return await verifySecondFactor(this.db, this.secrets, userId, code);
    } catch (err) {
      if (err instanceof TwoFactorUnreadable)
        throw new HttpError(
          500,
          tr(
            "Two-step verification can't be checked: its key can't be read (was APP_SECRET changed?). Turn it off on the server with node dist/cli.js disable-2fa, then set it up again.",
          ),
        );
      throw err;
    }
  }
}
