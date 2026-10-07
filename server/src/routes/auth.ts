import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  SESSION_COOKIE,
  changePassword,
  checkCredentials,
  createSession,
  createFirstUser,
  destroySession,
  userCount,
} from "../auth/service.js";
import { getLanguage } from "../domain/settings.js";
import { HttpError, notInDemo } from "../lib/errors.js";
import { tr, trn } from "../i18n/index.js";
import {
  disableTwoFactor,
  enableTwoFactor,
  isTwoFactorEnabled,
  renewRecoveryCodes,
  startTwoFactor,
  twoFactorStatus,
  TwoFactorUnreadable,
  verifySecondFactor,
} from "../auth/twoFactor.js";

const credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

const newPassword = z
  .string()
  .min(12, { error: () => tr("Password must be at least 12 characters") })
  .max(256);

export async function authRoutes(app: FastifyInstance) {
  const { db, config, secrets } = app.deps;
  const codeBody = z.object({ code: z.string().trim().min(1).max(20) });
  // Wrong codes per account: after five in a row, codes aren't checked for 15 minutes, doubling with
  // each lockout up to a day. The login rate limit counts per IP address; this holds however many
  // addresses someone uses. Kept in memory, like the rate limits.
  const wrongCodes = new Map<number, { count: number; lockouts: number; until: number }>();
  const checkCode = async (userId: number, code: string) => {
    const w = wrongCodes.get(userId) ?? { count: 0, lockouts: 0, until: 0 };
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
    const result = await verifyCode(userId, code);
    if (result) wrongCodes.delete(userId);
    else if (++w.count >= 5) {
      w.until = Date.now() + Math.min(15 * 60_000 * 2 ** w.lockouts++, 86_400_000);
      w.count = 0;
      wrongCodes.set(userId, w);
    } else wrongCodes.set(userId, w);
    return result;
  };
  // A key that can't be opened means APP_SECRET changed: say how to get back in instead of failing.
  const verifyCode = async (userId: number, code: string) => {
    try {
      return await verifySecondFactor(db, secrets, userId, code);
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
  };

  const startSession = async (reply: FastifyReply, userId: number) => {
    const { token, expiresAt } = await createSession(db, userId, config.SESSION_DAYS);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: config.COOKIE_SECURE,
      expires: expiresAt,
    });
  };

  app.get("/state", async (req) => ({
    needsSetup: (await userCount(db)) === 0,
    user: req.user,
    // Public, so the sign-in screen is in the right language too.
    language: await getLanguage(db),
    demo: config.DEMO,
  }));

  // First-run: creates the single user. Refused once a user exists.
  app.post("/setup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = credentials.extend({ password: newPassword }).parse(req.body);
    const user = await createFirstUser(db, body.username, body.password);
    if (!user) throw new HttpError(409, tr("Already set up"));
    await startSession(reply, user.id);
    return { user };
  });

  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const body = credentials.extend({ code: z.string().trim().max(20).optional() }).parse(req.body);
    const user = await checkCredentials(db, body.username, body.password);
    if (!user) throw new HttpError(401, tr("Invalid username or password"));
    // With a second factor, the password alone isn't enough: ask for the code.
    if (await isTwoFactorEnabled(db, user.id)) {
      if (!body.code)
        return reply.code(401).send({ error: tr("Enter the code from your authenticator app"), needsCode: true });
      if (!(await checkCode(user.id, body.code)))
        return reply.code(401).send({ error: tr("That code isn't right, or was already used"), needsCode: true });
    }
    await startSession(reply, user.id);
    return { user };
  });

  // ---- Second factor (TOTP) ----
  app.get("/2fa", async (req) => twoFactorStatus(db, req.user!.id));

  app.post("/2fa/setup", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req) => {
    if (config.DEMO) throw notInDemo();
    if (await isTwoFactorEnabled(db, req.user!.id)) throw new HttpError(409, tr("Two-step verification is already on"));
    return startTwoFactor(db, secrets, req.user!.id);
  });

  app.post("/2fa/enable", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req) => {
    if (config.DEMO) throw notInDemo();
    const { code } = codeBody.parse(req.body);
    const recoveryCodes = await enableTwoFactor(db, secrets, req.user!.id, code);
    if (!recoveryCodes)
      throw new HttpError(400, tr("That code isn't right; check the time on your phone and try again"));
    return { recoveryCodes };
  });

  // Turning it off or renewing the recovery codes takes a code too, so a left-open session isn't enough.
  app.post("/2fa/disable", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req) => {
    const { password, code } = codeBody.extend({ password: z.string() }).parse(req.body);
    const ok = await checkCredentials(db, req.user!.username, password);
    if (!ok) throw new HttpError(400, tr("Current password is incorrect"));
    if (!(await checkCode(req.user!.id, code)))
      throw new HttpError(400, tr("That code isn't right, or was already used"));
    await disableTwoFactor(db, req.user!.id);
    return twoFactorStatus(db, req.user!.id);
  });

  app.post("/2fa/recovery-codes", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req) => {
    const { code } = codeBody.parse(req.body);
    if (!(await checkCode(req.user!.id, code)))
      throw new HttpError(400, tr("That code isn't right, or was already used"));
    return { recoveryCodes: await renewRecoveryCodes(db, secrets, req.user!.id) };
  });

  app.post("/logout", async (req, reply) => {
    await destroySession(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post("/password", { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } }, async (req, reply) => {
    if (config.DEMO) throw notInDemo();
    const body = z.object({ current: z.string(), next: newPassword }).parse(req.body);
    const ok = await changePassword(db, req.user!.id, body.current, body.next);
    if (!ok) throw new HttpError(400, tr("Current password is incorrect"));
    await startSession(reply, req.user!.id);
    return { ok: true };
  });
}
