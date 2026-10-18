import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NetworkLog, loadTurnedOff } from "../src/domain/networkLog.js";
import {
  BlockedRequestError,
  DESTINATIONS,
  describe as describeUrl,
  guardFetch,
  isAllowedHost,
  setTurnedOff,
} from "../src/lib/net.js";
import type { RequestRecord } from "../src/lib/net.js";
import { newSetupCode } from "../src/auth/service.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  setTurnedOff([]);
});

const ROOT = path.resolve(__dirname, "../..");
// Named in the code only to link to, never contacted.
const LINK_ONLY = new Set(["github.com"]);

/** A fake network: answers per URL; a redirect is { status, location }. */
function fakeNet(answers: Record<string, { status: number; location?: string }>) {
  const calls: { url: string; method: string; redirect?: string }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    calls.push({ url, method: init?.method ?? "GET", redirect: init?.redirect });
    const a = answers[url] ?? { status: 200 };
    return new Response(a.status >= 300 && a.status < 400 ? null : "{}", {
      status: a.status,
      headers: a.location ? { location: a.location } : {},
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe("the list of destinations", () => {
  it("lets listed hosts through over HTTPS, and nothing else", async () => {
    const records: RequestRecord[] = [];
    const net = fakeNet({});
    const f = guardFetch(net.fetchFn, (r) => records.push(r));
    expect((await f("https://api.gold-api.com/price/XAU")).status).toBe(200);
    expect((await f("https://ndcdyn.interactivebrokers.com/x")).status).toBe(200);
    await expect(f("https://evil.example/collect?amount=1000")).rejects.toBeInstanceOf(BlockedRequestError);
    await expect(f("http://api.gold-api.com/price/XAU")).rejects.toBeInstanceOf(BlockedRequestError);
    // A look-alike isn't on the list.
    await expect(f("https://api.gold-api.com.evil.example/")).rejects.toBeInstanceOf(BlockedRequestError);
    expect(net.calls.map((c) => c.url)).toEqual([
      "https://api.gold-api.com/price/XAU",
      "https://ndcdyn.interactivebrokers.com/x",
    ]);
    expect(records.map((r) => [r.host, r.blocked ?? false])).toEqual([
      ["api.gold-api.com", false],
      ["ndcdyn.interactivebrokers.com", false],
      ["evil.example", true],
      ["api.gold-api.com", true],
      ["api.gold-api.com.evil.example", true],
    ]);
  });

  it("checks every redirect", async () => {
    const net = fakeNet({
      "https://api.github.com/a": { status: 302, location: "https://api.github.com/b" },
      "https://api.github.com/out": { status: 302, location: "https://evil.example/" },
      "https://api.kraken.com/post": { status: 303, location: "/done" },
    });
    const f = guardFetch(net.fetchFn);
    expect((await f("https://api.github.com/a")).status).toBe(200);
    await expect(f("https://api.github.com/out")).rejects.toBeInstanceOf(BlockedRequestError);
    await f("https://api.kraken.com/post", { method: "POST", body: "x" });
    expect(net.calls.map((c) => `${c.method} ${c.url} ${c.redirect}`)).toEqual([
      "GET https://api.github.com/a manual",
      "GET https://api.github.com/b manual",
      "GET https://api.github.com/out manual",
      "POST https://api.kraken.com/post manual",
      "GET https://api.kraken.com/done manual",
    ]);
  });

  it("records what was sent without keys", () => {
    expect(describeUrl(new URL("https://x.test/v1/chart/ASML.AS?period1=1&t=secret-token&q=ASML"))).toBe(
      "/v1/chart/ASML.AS?period1=1&t=…&q=ASML",
    );
    expect(describeUrl(new URL(`https://rpc.ankr.com/multichain/${"a".repeat(64)}`))).toBe("/multichain/aaaaaa…");
  });

  it("names every host the code contacts", () => {
    const files = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return e.name === "i18n" ? [] : files(p);
        return e.name.endsWith(".ts") ? [p] : [];
      });
    const unlisted = new Set<string>();
    for (const f of files(path.join(ROOT, "server/src")))
      for (const m of fs.readFileSync(f, "utf8").matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const host = m[1]!.toLowerCase();
        if (!isAllowedHost(host) && !LINK_ONLY.has(host)) unlisted.add(`${host} (${path.relative(ROOT, f)})`);
      }
    expect([...unlisted]).toEqual([]);
  });

  it("is the same list as in docs/privacy.md and the egress proxy's", () => {
    const hosts = [...new Set(DESTINATIONS.flatMap((d) => d.hosts))];
    const doc = fs.readFileSync(path.join(ROOT, "docs/privacy.md"), "utf8");
    expect(hosts.filter((h) => !doc.includes(h))).toEqual([]);
    const proxy = fs
      .readFileSync(path.join(ROOT, "deploy/egress/allowed-hosts.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    // Squid writes "*.example.com" as ".example.com" (the domain and its subdomains).
    expect(proxy.sort()).toEqual(hosts.map((h) => h.replace(/^\*\./, ".")).sort());
  });
});

describe("the network log", () => {
  it("counts per day, keeps refusals, and survives a restart", async () => {
    t = await createTestApp();
    const log = new NetworkLog(t.database.db);
    const at = new Date("2026-10-18T10:00:00Z");
    log.record({ at, method: "GET", host: "api.gold-api.com", what: "/price/XAU", status: 200 });
    log.record({ at, method: "GET", host: "api.gold-api.com", what: "/price/XAG", status: 200 });
    log.record({ at, method: "GET", host: "evil.example", what: "/", blocked: true });
    await log.flush();
    const again = new NetworkLog(t.database.db);
    await again.load();
    const snap = again.snapshot();
    expect(snap.daily).toEqual([{ day: "2026-10-18", hosts: { "api.gold-api.com": 2 } }]);
    expect(snap.blocked.map((b) => b.host)).toEqual(["evil.example"]);
    // The latest requests are kept in memory only.
    expect(log.snapshot().recent.map((r) => r.what)).toEqual(["/", "/price/XAG", "/price/XAU"]);
  });

  it("shows where Box3balans may go and what it sent", async () => {
    t = await createTestApp();
    t.app.deps.network.record({
      at: new Date(),
      method: "GET",
      host: "api.bitvavo.com",
      what: "/v2/ticker/price",
      status: 200,
    });
    const res = (await t.api("GET", "/api/network")).json();
    expect(res.destinations.map((d: { id: string }) => d.id)).toEqual(DESTINATIONS.map((d) => d.id));
    expect(res.destinations[0]).toMatchObject({ purpose: expect.any(String), sends: expect.any(String) });
    // Bitvavo is both a price source and an exchange.
    expect(res.recent[0]).toMatchObject({ host: "api.bitvavo.com", purposes: ["crypto", "exchanges"] });
    expect(res.blocked).toEqual([]);
  });
});

describe("switches", () => {
  it("refuse what's turned off, but keep a host that serves something still on", async () => {
    const records: RequestRecord[] = [];
    const f = guardFetch(fakeNet({}).fetchFn, (r) => records.push(r));
    setTurnedOff(["metals", "crypto"]);
    await expect(f("https://api.gold-api.com/price/XAU")).rejects.toMatchObject({ reason: "off" });
    // Bitvavo is also an exchange, which is still on.
    expect((await f("https://api.bitvavo.com/v2/balance")).status).toBe(200);
    setTurnedOff(["crypto", "exchanges"]);
    await expect(f("https://api.bitvavo.com/v2/balance")).rejects.toBeInstanceOf(BlockedRequestError);
    expect(records.filter((r) => r.blocked).map((r) => r.reason)).toEqual(["off", "off"]);
    // Turned off by you isn't counted among the refusals that matter.
    const log = new NetworkLog();
    records.forEach(log.record);
    expect(log.snapshot().blocked).toEqual([]);
  });

  it("are saved, and a price refresh skips what's off", async () => {
    t = await createTestApp();
    expect((await t.api("PUT", "/api/network/off", { off: ["nonsense"] })).statusCode).toBe(400);
    const off = ["metals", "fx", "securities", "crypto", "wallets", "exchanges"];
    expect((await t.api("PUT", "/api/network/off", { off })).json()).toEqual({ off });
    expect(await loadTurnedOff(t.database.db)).toEqual(off);
    expect((await t.api("GET", "/api/network")).json()).toMatchObject({ off, switchable: off });
    // Offline: the refresh asks nothing and reports nothing as failed.
    const before = t.fetch.calls.length;
    const r = await t.prices.refreshAll();
    // (Only the euro, which is 1 and needs no network.)
    expect(r.failed).toEqual([]);
    expect(t.fetch.calls.length).toBe(before);
    expect(await t.sync.runAll()).toEqual([]);
    expect(await t.wallets.runAll()).toEqual([]);
  });
});

describe("the setup code", () => {
  it("looks like K7QX2-MPF9R, from characters that are easy to read", () => {
    for (let i = 0; i < 50; i++) expect(newSetupCode()).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  });

  it("is needed for the first account when the app made one", async () => {
    t = await createTestApp(undefined, { login: false, setupCode: "K7QX2-MPF9R" });
    const state = (await t.api("GET", "/api/auth/state")).json();
    expect(state).toMatchObject({ needsSetup: true, needsSetupCode: true });
    const body = { username: "me", password: "correct horse battery" };
    expect((await t.api("POST", "/api/auth/setup", body)).statusCode).toBe(403);
    expect((await t.api("POST", "/api/auth/setup", { ...body, setupCode: "AAAAA-BBBBB" })).statusCode).toBe(403);
    // Case, spaces and the dash don't matter.
    expect((await t.api("POST", "/api/auth/setup", { ...body, setupCode: "k7qx2 mpf9r" })).statusCode).toBe(200);
    expect(t.app.deps.setup.code).toBeNull();
    expect((await t.api("GET", "/api/auth/state")).json()).toMatchObject({ needsSetup: false, needsSetupCode: false });
  });
});
