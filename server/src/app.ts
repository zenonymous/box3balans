import fs from "node:fs";
import path from "node:path";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { DB } from "./db/client.js";
import { HttpError, pgErrorCode } from "./lib/errors.js";
import { APP_VERSION } from "./lib/version.js";
import type { PriceService } from "./prices/service.js";
import type { SecretBox } from "./lib/secrets.js";
import type { SyncService } from "./sync/service.js";
import type { WalletService } from "./wallets/service.js";
import type { BackfillService } from "./jobs/backfill.js";
import { SESSION_COOKIE, sessionUser } from "./auth/service.js";
import { authRoutes } from "./routes/auth.js";
import { accountRoutes } from "./routes/accounts.js";
import { assetRoutes } from "./routes/assets.js";
import { transactionRoutes } from "./routes/transactions.js";
import { metalRoutes } from "./routes/metals.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { integrationRoutes } from "./routes/integrations.js";
import { walletRoutes } from "./routes/wallets.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { box3Routes } from "./routes/box3.js";
import { backupRoutes } from "./routes/backups.js";
import { exportRoutes } from "./routes/exports.js";
import { importRoutes } from "./routes/imports.js";
import { activityRoutes } from "./routes/activity.js";
import { attentionRoutes } from "./routes/attention.js";
import { returnRoutes } from "./routes/returns.js";
import { dividendRoutes } from "./routes/dividends.js";
import { householdRoutes } from "./routes/household.js";

export interface AppDeps {
  db: DB;
  config: Config;
  prices: PriceService;
  secrets: SecretBox;
  sync: SyncService;
  wallets: WalletService;
  backfill: BackfillService;
}

declare module "fastify" {
  interface FastifyRequest {
    user: { id: number; username: string } | null;
  }
  interface FastifyInstance {
    deps: AppDeps;
  }
}

// Mutating API requests must carry this header. Browsers can't send custom headers cross-site
// without a CORS preflight (which we never grant), so this blocks CSRF alongside SameSite=Strict.
export const CSRF_HEADER = "x-requested-with";

const PUBLIC_ROUTES = new Set(["/api/health", "/api/auth/state", "/api/auth/login", "/api/auth/setup"]);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.LOG_LEVEL,
      // Never log credentials or session cookies.
      redact: ["req.headers.cookie", "req.headers.authorization", "req.body.password", "req.body.credentials"],
    },
    // Per-request logs (including healthchecks) only when debugging.
    logController: new LogController({
      disableRequestLogging: deps.config.LOG_LEVEL !== "debug" && deps.config.LOG_LEVEL !== "trace",
    }),
    // Trusting X-Forwarded-For without a proxy would let anyone fake their IP and dodge the
    // login rate limit, so it's opt-in.
    trustProxy:
      typeof deps.config.TRUST_PROXY === "number"
        ? (
            (hops: number) => (_addr: string, i: number) =>
              i < hops
          )(deps.config.TRUST_PROXY)
        : deps.config.TRUST_PROXY,
  });
  app.decorate("deps", deps);
  app.decorateRequest("user", null);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const pathOnly = req.url.split("?")[0]!;
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers[CSRF_HEADER] !== "portfolio") {
      return reply.code(403).send({ error: "Missing CSRF header" });
    }
    req.user = await sessionUser(deps.db, req.cookies[SESSION_COOKIE]);
    if (!req.user && !PUBLIC_ROUTES.has(pathOnly)) {
      return reply.code(401).send({ error: "Not logged in" });
    }
  });

  // Defence-in-depth headers. Styles allow 'unsafe-inline' because charts set inline style attributes;
  // scripts are same-origin files only.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  app.addHook("onSend", async (_req, reply) => {
    reply.header("content-security-policy", csp);
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (deps.config.COOKIE_SECURE) reply.header("strict-transport-security", "max-age=31536000");
  });

  // Data changes can introduce assets or dates without price history; load it shortly after.
  app.addHook("onResponse", async (req, reply) => {
    if (req.method === "GET" || reply.statusCode >= 300) return;
    if (/^\/api\/(transactions|assets|metals)/.test(req.url)) deps.backfill.request();
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid input", issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    // Safety net for constraint violations not caught by explicit checks.
    const code = pgErrorCode(err);
    if (code === "23505") return reply.code(409).send({ error: "That already exists" });
    if (code === "23503") return reply.code(409).send({ error: "It is still used by other records" });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: "Internal error" });
  });

  // Liveness for Docker: the app answers and the database is reachable.
  app.get("/api/health", async (_req, reply) => {
    try {
      await deps.db.execute(sql`select 1`);
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false, error: "Database unavailable" });
    }
  });

  // Signed-in only: which build is running and where its source is (sidebar, Settings → About).
  app.get("/api/version", async () => ({ version: APP_VERSION, source: deps.config.SOURCE_URL }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(accountRoutes, { prefix: "/api/accounts" });
  await app.register(assetRoutes, { prefix: "/api/assets" });
  await app.register(transactionRoutes, { prefix: "/api/transactions" });
  await app.register(metalRoutes, { prefix: "/api/metals" });
  await app.register(integrationRoutes, { prefix: "/api/integrations" });
  await app.register(walletRoutes, { prefix: "/api/wallets" });
  await app.register(portfolioRoutes, { prefix: "/api" });
  await app.register(analyticsRoutes, { prefix: "/api" });
  await app.register(box3Routes, { prefix: "/api/box3" });
  await app.register(backupRoutes, { prefix: "/api/backups" });
  await app.register(exportRoutes, { prefix: "/api/export" });
  await app.register(importRoutes, { prefix: "/api" });
  await app.register(activityRoutes, { prefix: "/api/activity" });
  await app.register(attentionRoutes, { prefix: "/api/attention" });
  await app.register(returnRoutes, { prefix: "/api/returns" });
  await app.register(dividendRoutes, { prefix: "/api/dividends" });
  await app.register(householdRoutes, { prefix: "/api/household" });

  // Serve the built frontend (single-page app) when present.
  const webDist = path.resolve(deps.config.WEB_DIST);
  if (fs.existsSync(path.join(webDist, "index.html"))) {
    await app.register(fastifyStatic, {
      root: webDist,
      setHeaders: (reply, filePath) => {
        // Vite emits content-hashed file names under assets/, so those can be cached forever.
        reply.header(
          "cache-control",
          filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const pathOnly = req.url.split("?")[0]!;
      // Missing API routes and missing files (anything with an extension) are real 404s;
      // everything else is a client-side route of the single-page app.
      if (pathOnly.startsWith("/api/") || path.extname(pathOnly)) return reply.code(404).send({ error: "Not found" });
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    });
  }

  return app;
}
