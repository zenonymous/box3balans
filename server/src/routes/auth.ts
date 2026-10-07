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
import { tr } from "../i18n/index.js";

const credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

const newPassword = z
  .string()
  .min(12, { error: () => tr("Password must be at least 12 characters") })
  .max(256);

export async function authRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

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
    const body = credentials.parse(req.body);
    const user = await checkCredentials(db, body.username, body.password);
    if (!user) throw new HttpError(401, tr("Invalid username or password"));
    await startSession(reply, user.id);
    return { user };
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
