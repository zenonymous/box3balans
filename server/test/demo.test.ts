import { afterEach, describe, expect, it } from "vitest";
import { seedDemo } from "../src/demo.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => t?.close());

describe("demo mode", () => {
  it("fills an example household, signs visitors in and keeps outside services out", async () => {
    t = await createTestApp(undefined, { login: false, env: { DEMO: "true" } });
    await seedDemo(t.app, t.database.db);
    // No cookie: the demo signs the visitor in.
    const state = await t.app.inject({ method: "GET", url: "/api/auth/state" });
    expect(state.json()).toMatchObject({ demo: true, needsSetup: false, user: { username: "demo" } });
    t.cookie = `pd_session=${state.cookies.find((c) => c.name === "pd_session")!.value}`;

    expect((await t.api("GET", "/api/household")).json()).toHaveLength(3);
    const accounts = (await t.api("GET", "/api/accounts")).json();
    expect(accounts.length).toBeGreaterThanOrEqual(10);

    // Box 3 for 2025 with the yearly accounts and the made-up closes of 31 December 2024.
    const y = (await t.api("GET", "/api/box3/2025")).json();
    expect(y.partner).toBe(true);
    expect(Number(y.totals.bank)).toBeGreaterThan(50_000);
    expect(Number(y.totals.other)).toBeGreaterThan(300_000);
    expect(y.debtsEur).toBe("16800.00");
    expect(y.warnings.filter((w: string) => w.startsWith("No price"))).toEqual([]);

    // The overview has values from the made-up latest prices, without any network.
    const p = (await t.api("GET", "/api/portfolio")).json();
    expect(Number(p.summary.totalEur)).toBeGreaterThan(30_000);
    expect(p.summary.missingPrices).toEqual([]);
    expect(t.fetch.calls).toEqual([]);

    for (const [url, body] of [
      ["/api/integrations", { provider: "bitvavo", credentials: {} }],
      ["/api/wallets", { chain: "bitcoin", address: "x" }],
      ["/api/prices/refresh", {}],
      ["/api/auth/password", { current: "x", next: "y".repeat(12) }],
    ] as const) {
      expect((await t.api("POST", url, body)).statusCode, url).toBe(403);
    }
  });
});
