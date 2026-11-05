import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  SESSION_COOKIE,
  changePassword,
  checkCredentials,
  createSession,
  createFirstUser,
  destroySession,
  endOtherSessions,
  isSetupCode,
  newSetupCode,
  setupCodeMessage,
  userCount,
} from "../auth/service.js";
import { getLanguage } from "../domain/settings.js";
import { HttpError, notInDemo } from "../lib/errors.js";
import { tr } from "../i18n/index.js";
import {
  disableTwoFactor,
  enableTwoFactor,
  isTwoFactorEnabled,
  renewRecoveryCodes,
  startTwoFactor,
  twoFactorStatus,
} from "../auth/twoFactor.js";

const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(1, { error: () => tr("Fill in a username") })
    .max(64, { error: () => tr("A username can have at most 64 characters") }),
  password: z.string().min(1).max(256),
});

const newPassword = z
  .string()
  .min(12, { error: () => tr("Password must be at least 12 characters") })
  .max(256);

export async function authRoutes(app: FastifyInstance) {
  const { db, config, secrets, setup } = app.deps;
  const codeBody = z.object({ code: z.string().trim().min(1).max(20) });
  const identity = app.identity;
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

  // No account and no code waiting, while one is required: the account is gone again after the first
  // one was set up (a user table emptied some other way). Make a new code and log it, as at the
  // first start, rather than letting anyone take the account (security audit, 5 Nov 2026).
  const pendingCode = async () => {
    if (!setup.required || setup.code || (await userCount(db)) > 0) return;
    setup.code = config.SETUP_CODE ?? newSetupCode();
    app.log.warn(setupCodeMessage(setup.code));
  };

  app.get("/state", async (req) => {
    await pendingCode();
    const needsSetup = (await userCount(db)) === 0;
    return {
      needsSetup,
      // The first account needs the one-time code from the app's log (index.ts).
      needsSetupCode: needsSetup && !!setup.code,
      user: req.user,
      // Public, so the sign-in screen is in the right language too.
      language: await getLanguage(db),
      demo: config.DEMO,
    };
  });

  // First-run: creates the single user. Refused once a user exists.
  app.post("/setup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = credentials
      .extend({ password: newPassword, setupCode: z.string().trim().max(64).optional() })
      .parse(req.body);
    await pendingCode();
    // Without the code from the log, someone else on the network can't claim a fresh install.
    if (setup.code && !isSetupCode(setup.code, body.setupCode))
      throw new HttpError(
        403,
        tr("That setup code isn't right. Box3balans prints it in its log when it starts (docker compose logs app)."),
      );
    const user = await createFirstUser(db, body.username, body.password);
    if (!user) throw new HttpError(409, tr("Already set up"));
    setup.code = null;
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
      if (!(await identity.code(user.id, body.code)))
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

  // Turning it on takes the password, so a left-open session can't put it on someone else's phone and
  // lock the owner out. Turning it on or off signs out every other session: one of them may be why.
  app.post("/2fa/enable", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req) => {
    if (config.DEMO) throw notInDemo();
    const { code, password } = codeBody.extend({ password: z.string().max(256).default("") }).parse(req.body);
    await identity.confirm(req.user!.id, password, undefined);
    const recoveryCodes = await enableTwoFactor(db, secrets, req.user!.id, code);
    if (!recoveryCodes)
      throw new HttpError(400, tr("That code isn't right; check the time on your phone and try again"));
    await endOtherSessions(db, req.user!.id, req.cookies[SESSION_COOKIE]);
    return { recoveryCodes };
  });

  // Turning it off or renewing the recovery codes takes a code too, so a left-open session isn't enough.
  app.post("/2fa/disable", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req) => {
    const { password, code } = codeBody.extend({ password: z.string().max(256) }).parse(req.body);
    await identity.confirm(req.user!.id, password, code);
    await disableTwoFactor(db, req.user!.id);
    await endOtherSessions(db, req.user!.id, req.cookies[SESSION_COOKIE]);
    return twoFactorStatus(db, req.user!.id);
  });

  app.post("/2fa/recovery-codes", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req) => {
    const { code } = codeBody.parse(req.body);
    if (!(await identity.code(req.user!.id, code)))
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
