import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase, type Database } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";
import type { FetchFn } from "../src/lib/http.js";
import { PriceService } from "../src/prices/service.js";
import { SecretBox } from "../src/lib/secrets.js";
import { SyncService } from "../src/sync/service.js";
import { WalletService } from "../src/wallets/service.js";
import { BackfillService } from "../src/jobs/backfill.js";

export type RouteHandler = (url: string, init?: RequestInit) => unknown;

/** A raw response a route handler can return to control status or send text (e.g. XML). */
export const raw = (body: string, status = 200) => ({ __raw: true as const, body, status });

/**
 * A fetch stub answering by URL substring (longest match wins); unmatched URLs return 404.
 * Handlers may return JSON-able data or `raw(...)`.
 */
export function fakeFetch(
  routes: Record<string, unknown | RouteHandler>,
): FetchFn & { calls: string[]; requests: { url: string; init?: RequestInit }[] } {
  const calls: string[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    requests.push({ url, init });
    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.includes(k));
    if (!match) return new Response("not found", { status: 404 });
    const body = routes[match];
    const data = typeof body === "function" ? (body as RouteHandler)(url, init) : body;
    if (data && typeof data === "object" && "__raw" in data) {
      const r = data as ReturnType<typeof raw>;
      return new Response(r.body, { status: r.status, headers: { "content-type": "text/plain" } });
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  }) as FetchFn & { calls: string[]; requests: { url: string; init?: RequestInit }[] };
  fn.calls = calls;
  fn.requests = requests;
  return fn;
}

export const defaultRoutes = {
  "frankfurter.dev/v1/latest": { date: "2024-06-03", rates: { USD: 1.25, GBP: 0.8 } },
  "frankfurter.dev/v1/2024-": { date: "2024-01-15", rates: { USD: 1.1, GBP: 0.85 } },
  "api.coingecko.com/api/v3/simple/price": { bitcoin: { eur: 50000, eur_24h_change: 2 } },
  "api.gold-api.com/price/XAU": { price: 3110.34768, currency: "USD" }, // 100 USD/g
  "api.gold-api.com/price/XAG": { price: 31.1034768, currency: "USD" }, // 1 USD/g
  "api.gold-api.com/price/XPT": { price: 1000, currency: "USD" },
  "api.gold-api.com/price/XPD": { price: 1000, currency: "USD" },
  "query1.finance.yahoo.com/v8/finance/chart/AAPL": {
    chart: {
      result: [{ meta: { currency: "USD", regularMarketPrice: 200, regularMarketChangePercent: 1 } }],
      error: null,
    },
  },
  "query1.finance.yahoo.com/v8/finance/chart/VUSA.L": {
    chart: { result: [{ meta: { currency: "GBp", regularMarketPrice: 8000 } }], error: null },
  },
};

export interface TestApp {
  app: FastifyInstance;
  database: Database;
  prices: PriceService;
  sync: SyncService;
  wallets: WalletService;
  backfill: BackfillService;
  fetch: ReturnType<typeof fakeFetch>;
  cookie: string;
  backupDir: string;
  api: (method: string, url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  close: () => Promise<void>;
}

export async function createTestApp(
  routes: Record<string, unknown> = defaultRoutes,
  opts: { login?: boolean } = {},
): Promise<TestApp> {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "pd-backups-"));
  const config = loadConfig({
    BACKUP_DIR: backupDir,
    APP_SECRET: "x".repeat(40),
    SCHEDULER: "false",
    LOG_LEVEL: "silent",
    WEB_DIST: "/nonexistent",
  });
  const database = await openDatabase({});
  await seed(database.db);
  const fetch = fakeFetch(routes);
  const prices = new PriceService(database.db, fetch);
  const secrets = new SecretBox(config.APP_SECRET);
  const sync = new SyncService(database.db, secrets, prices, fetch, async () => {});
  const wallets = new WalletService(database.db, prices, { fetchFn: fetch, sleep: async () => {}, tokenThrottleMs: 0 });
  const backfill = new BackfillService(database.db, prices.fx, fetch);
  // Tests run backfills explicitly; don't let request() fire timers in the background.
  backfill.request = () => {};
  const app = await buildApp({ db: database.db, config, prices, secrets, sync, wallets, backfill });

  const t: TestApp = {
    app,
    database,
    prices,
    sync,
    wallets,
    backfill,
    fetch,
    cookie: "",
    backupDir,
    api: (method, url, body) =>
      app.inject({
        method: method as "GET",
        url,
        payload: body as object,
        headers: { "x-requested-with": "portfolio", ...(t.cookie ? { cookie: t.cookie } : {}) },
      }),
    close: async () => {
      await app.close();
      await database.close();
      fs.rmSync(backupDir, { recursive: true, force: true });
    },
  };

  if (opts.login !== false) {
    const res = await t.api("POST", "/api/auth/setup", { username: "me", password: "correct horse battery" });
    if (res.statusCode !== 200) throw new Error(`setup failed: ${res.body}`);
    const c = res.cookies.find((x) => x.name === "pd_session")!;
    t.cookie = `pd_session=${c.value}`;
  }
  return t;
}
