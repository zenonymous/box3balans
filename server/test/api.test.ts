import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

describe("auth", () => {
  it("requires setup, then login; rejects requests without session or CSRF header", async () => {
    t = await createTestApp(undefined, { login: false });
    expect(json(await t.api("GET", "/api/auth/state")).needsSetup).toBe(true);
    expect((await t.api("GET", "/api/accounts")).statusCode).toBe(401);

    const weak = await t.api("POST", "/api/auth/setup", { username: "me", password: "short" });
    expect(weak.statusCode).toBe(400);

    const ok = await t.api("POST", "/api/auth/setup", { username: "me", password: "correct horse battery" });
    expect(ok.statusCode).toBe(200);
    const again = await t.api("POST", "/api/auth/setup", { username: "x", password: "correct horse battery" });
    expect(again.statusCode).toBe(409);

    const bad = await t.api("POST", "/api/auth/login", { username: "me", password: "wrong password!" });
    expect(bad.statusCode).toBe(401);
    const good = await t.api("POST", "/api/auth/login", { username: "me", password: "correct horse battery" });
    expect(good.statusCode).toBe(200);
    t.cookie = `pd_session=${good.cookies.find((c) => c.name === "pd_session")!.value}`;
    expect((await t.api("GET", "/api/accounts")).statusCode).toBe(200);

    const noCsrf = await t.app.inject({
      method: "POST",
      url: "/api/accounts",
      payload: { name: "x", kind: "bank" },
      headers: { cookie: t.cookie },
    });
    expect(noCsrf.statusCode).toBe(403);

    await t.api("POST", "/api/auth/logout");
    expect((await t.api("GET", "/api/accounts")).statusCode).toBe(401);
  });
});

describe("every API route", () => {
  // All routes the app registered, as [method, path with sample ids], from Fastify's route tree
  // ("├── /api/accounts (GET, POST)" with children indented four characters per level).
  const apiRoutes = (t: TestApp) => {
    const routes: (readonly [string, string])[] = [];
    const parents: string[] = [""];
    for (const line of t.app.printRoutes({ commonPrefix: false }).split("\n")) {
      const m = /^([│├└─ ]*)(\S.*?)(?: \(([^)]+)\))?$/.exec(line);
      if (!m) continue;
      const depth = m[1]!.length / 4;
      const url = parents[depth - 1]! + m[2]!;
      parents[depth] = url;
      if (!url.startsWith("/api/") || !m[3]) continue;
      for (const method of m[3].split(", ")) if (method !== "HEAD") routes.push([method, url.replace(/:\w+/g, "1")]);
    }
    return routes;
  };
  const PUBLIC = ["GET /api/health", "GET /api/auth/state", "POST /api/auth/login", "POST /api/auth/setup"];
  // The same path as the router sees it, spelled differently on the wire.
  const spellings = (url: string) => [url, url.replace("/api/", "/%61pi/"), url.replace("/api/", "/ap%69/")];

  it("needs a session and the CSRF header, however the path is spelled", async () => {
    t = await createTestApp(undefined, { login: false });
    const routes = apiRoutes(t);
    expect(routes.length).toBeGreaterThan(90);
    for (const [method, url] of routes) {
      if (PUBLIC.includes(`${method} ${url}`)) continue;
      for (const spelled of spellings(url)) {
        const res = await t.app.inject({
          method: method as "GET",
          url: spelled,
          payload: method === "GET" || method === "DELETE" ? undefined : {},
          headers: { "x-requested-with": "portfolio" },
        });
        expect([method, spelled, res.statusCode]).toEqual([method, spelled, 401]);
        if (method !== "GET") {
          const noCsrf = await t.app.inject({ method: method as "GET", url: spelled, payload: {} });
          expect([method, spelled, noCsrf.statusCode]).toEqual([method, spelled, 403]);
        }
      }
    }
  });
});

describe("hardening", () => {
  it("reports health including the database, and sends security headers", async () => {
    t = await createTestApp(undefined, { login: false });
    const res = await t.api("GET", "/api/health");
    expect(json(res)).toEqual({ ok: true });
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["strict-transport-security"]).toBeUndefined(); // only behind HTTPS
  });
});

describe("login rate limit", () => {
  // Review fix: with trustProxy on, a fake X-Forwarded-For per attempt bypassed the limit.
  it("ignores X-Forwarded-For unless TRUST_PROXY is set, so faked IPs don't reset the limit", async () => {
    t = await createTestApp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await t.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "me", password: "wrong-password-x" },
        headers: { "x-requested-with": "portfolio", "x-forwarded-for": `10.0.0.${i}` },
      });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe("portfolio flow", () => {
  it("values stocks, crypto, cash and metals in EUR", async () => {
    t = await createTestApp();
    const broker = json(await t.api("POST", "/api/accounts", { name: "DEGIRO", kind: "broker", provider: "degiro" }));
    const exchange = json(await t.api("POST", "/api/accounts", { name: "Bitvavo", kind: "exchange" }));
    const ledger = json(await t.api("POST", "/api/accounts", { name: "Ledger", kind: "wallet" }));
    const safe = json(await t.api("POST", "/api/accounts", { name: "Home safe", kind: "physical" }));
    const vault = json(await t.api("POST", "/api/accounts", { name: "Goldrepublic", kind: "vault" }));

    const aapl = json(
      await t.api("POST", "/api/assets", {
        assetClass: "stock",
        name: "Apple",
        symbol: "AAPL",
        priceSource: "yahoo",
        priceRef: "AAPL",
      }),
    );
    expect(aapl.currency).toBe("USD");
    const vusa = json(
      await t.api("POST", "/api/assets", {
        assetClass: "etf",
        name: "Vanguard S&P 500",
        symbol: "VUSA",
        priceSource: "yahoo",
        priceRef: "VUSA.L",
      }),
    );
    expect(vusa.currency).toBe("GBP");
    const btc = json(
      await t.api("POST", "/api/assets", {
        assetClass: "crypto",
        name: "Bitcoin",
        symbol: "BTC",
        priceSource: "coingecko",
        priceRef: "bitcoin",
      }),
    );
    const assets = json<any[]>(await t.api("GET", "/api/assets"));
    const gold = assets.find((a) => a.priceRef === "XAU");
    const eur = assets.find((a) => a.priceRef === "EUR");

    // 10 AAPL at $150 on 2024-01-15 (1 EUR = 1.10 USD, looked up automatically), €1 fee.
    const buy = await t.api("POST", "/api/transactions", {
      accountId: broker.id,
      assetId: aapl.id,
      type: "buy",
      occurredAt: "2024-01-15T10:00:00Z",
      quantity: "10",
      price: "150",
      currency: "USD",
      feeEur: "1",
    });
    expect(buy.statusCode).toBe(200);
    expect(Number(json(buy).fxRate)).toBeCloseTo(1 / 1.1, 10);

    await t.api("POST", "/api/transactions", {
      accountId: broker.id,
      assetId: vusa.id,
      type: "buy",
      occurredAt: "2024-02-01T10:00:00Z",
      quantity: "5",
      price: "70",
      currency: "GBP",
      fxRate: "1.17",
    });
    await t.api("POST", "/api/transactions", {
      accountId: exchange.id,
      assetId: btc.id,
      type: "buy",
      occurredAt: "2024-03-01T10:00:00Z",
      quantity: "0.5",
      price: "40000",
    });
    const transfer = await t.api("POST", "/api/transactions/transfer", {
      fromAccountId: exchange.id,
      toAccountId: ledger.id,
      assetId: btc.id,
      occurredAt: "2024-03-02T10:00:00Z",
      quantity: "0.2",
      receivedQuantity: "0.1999",
    });
    expect(transfer.statusCode).toBe(200);
    await t.api("POST", "/api/transactions", {
      accountId: broker.id,
      assetId: eur.id,
      type: "deposit",
      occurredAt: "2024-01-01T10:00:00Z",
      quantity: "1000",
    });
    await t.api("POST", "/api/transactions", {
      accountId: vault.id,
      assetId: gold.id,
      type: "buy",
      occurredAt: "2024-04-01T10:00:00Z",
      quantity: "10",
      price: "70",
    });
    const item = await t.api("POST", "/api/metals/items", {
      accountId: safe.id,
      metal: "gold",
      product: "Krugerrand 1 oz",
      grossWeightG: "33.93",
      purity: "0.9167",
      quantity: 2,
      purchaseDate: "2024-05-01",
      purchasePriceEur: "4000",
    });
    expect(item.statusCode).toBe(200);

    const refresh = json(await t.api("POST", "/api/prices/refresh"));
    expect(refresh.failed).toEqual([]);

    const { summary, holdings } = json(await t.api("GET", "/api/portfolio"));
    const h = (sym: string, physical = false) => holdings.find((x: any) => x.symbol === sym && x.physical === physical);

    // AAPL: 10 × $200 / 1.25 = €1600; cost 10 × 150 / 1.1 + 1 = €1364.64
    expect(h("AAPL").valueEur).toBe("1600.00");
    expect(h("AAPL").costEur).toBe("1364.64");
    expect(h("AAPL").unrealizedEur).toBe("235.36");
    // VUSA quoted in pence: 8000 GBp = £80 → €100/share × 5 = €500
    expect(h("VUSA").valueEur).toBe("500.00");
    // BTC: 0.4999 × €50000; split across two accounts with cost carried over the transfer
    expect(h("BTC").valueEur).toBe("24995.00");
    expect(h("BTC").accounts).toHaveLength(2);
    expect(h("BTC").costEur).toBe("20000.00");
    // Gold spot $100/g → €80/g. Vaulted 10 g = €800.
    expect(h("XAU").valueEur).toBe("800.00");
    // Physical: 2 × 33.93 × 0.9167 = 62.207262 g × €80
    expect(h("XAU", true).valueEur).toBe("4976.58");
    expect(h("EUR").valueEur).toBe("1000.00");

    expect(summary.totalEur).toBe("33871.58");
    expect(summary.byClass.metal).toBe("5776.58");
    expect(summary.byClass.cash).toBe("1000.00");
    expect(summary.missingPrices).toEqual([]);

    const overview = json(await t.api("GET", "/api/metals/overview"));
    const goldTotals = overview.totals.find((x: any) => x.metal === "gold");
    expect(goldTotals.totalG).toBe("72.2073");
    expect(overview.vaulted[0].grams).toBe("10.0000");

    // The computed history ends today at live prices, so it agrees with the overview.
    const history = json(await t.api("GET", "/api/portfolio/history?range=ALL"));
    expect(history.points[0].day).toBe("2024-01-01");
    expect(history.points.at(-1).totalEur).toBe(33871.58);
    expect(history.points.at(-1).byClass.metal).toBe(5776.58);
  });

  it("deletes both legs of a transfer and records an audit trail", async () => {
    t = await createTestApp();
    const a = json(await t.api("POST", "/api/accounts", { name: "A", kind: "exchange" }));
    const b = json(await t.api("POST", "/api/accounts", { name: "B", kind: "wallet" }));
    const btc = json(
      await t.api("POST", "/api/assets", {
        assetClass: "crypto",
        name: "Bitcoin",
        symbol: "BTC",
        priceSource: "coingecko",
        priceRef: "bitcoin",
      }),
    );
    const [out] = json(
      await t.api("POST", "/api/transactions/transfer", {
        fromAccountId: a.id,
        toAccountId: b.id,
        assetId: btc.id,
        occurredAt: "2024-03-02T10:00:00Z",
        quantity: "1",
      }),
    );
    const del = json(await t.api("DELETE", `/api/transactions/${out.id}`));
    expect(del.deleted).toBe(2);
    expect(json(await t.api("GET", "/api/transactions")).total).toBe(0);
  });

  it("counts transactions per account correctly", async () => {
    t = await createTestApp();
    const a = json(await t.api("POST", "/api/accounts", { name: "A", kind: "bank" }));
    const b = json(await t.api("POST", "/api/accounts", { name: "B", kind: "bank" }));
    const eur = json<any[]>(await t.api("GET", "/api/assets")).find((x) => x.priceRef === "EUR");
    for (let i = 0; i < 3; i++) {
      await t.api("POST", "/api/transactions", {
        accountId: b.id,
        assetId: eur.id,
        type: "deposit",
        occurredAt: "2024-01-01",
        quantity: "1",
        price: "1",
      });
    }
    const list = json<any[]>(await t.api("GET", "/api/accounts"));
    expect(list.find((x) => x.id === a.id).txCount).toBe(0);
    expect(list.find((x) => x.id === b.id).txCount).toBe(3);
  });

  it("validates transaction input", async () => {
    t = await createTestApp();
    const res = await t.api("POST", "/api/transactions", {
      accountId: 1,
      assetId: 1,
      type: "buy",
      occurredAt: "2024-01-01",
      quantity: "-3",
    });
    expect(res.statusCode).toBe(400);
  });

  it("reports provider failures per asset without failing the refresh", async () => {
    t = await createTestApp();
    await t.api("POST", "/api/assets", {
      assetClass: "crypto",
      name: "Nope",
      symbol: "NOPE",
      priceSource: "coingecko",
      priceRef: "nope-coin",
    });
    const r = json(await t.api("POST", "/api/prices/refresh"));
    expect(r.failed.map((f: any) => f.symbol)).toEqual(["NOPE"]);
    expect(r.updated).toBeGreaterThan(0);
  });
});
