import { vi } from "vitest";

/**
 * Answers the app's /api requests in a test from a table (URL without query → JSON body, or a
 * function of the request). Unknown URLs get a 404, and are listed in `missed` so a test can see
 * what a page asked for.
 */
export function fakeApi(routes: Record<string, unknown>) {
  const missed: string[] = [];
  const requests: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input).split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ method, url, body });
    const key = Object.hasOwn(routes, `${method} ${url}`) ? `${method} ${url}` : url;
    if (!Object.hasOwn(routes, key)) {
      missed.push(`${method} ${url}`);
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const answer = routes[key];
    return Response.json(typeof answer === "function" ? (answer as (b: unknown) => unknown)(body) : answer);
  });
  return { missed, requests };
}

/**
 * Answers like the demo server: from demo.fixture.json, the answers the online demo recorded for the
 * made-up household (refresh with `npm run build:online-demo && npm run fixtures:demo`). A request
 * gets the answer recorded for its exact URL, else the one for its path without the query. `routes`
 * adds or replaces answers, for example "POST /api/…" for what a page sends (a function gets the request
 * body; returning a Response gives an error status); other writes get `{}`.
 */
export function fakeDemoApi(demo: Record<string, unknown>, routes: Record<string, unknown> = {}) {
  const missed: string[] = [];
  const requests: { method: string; url: string; body: unknown }[] = [];
  const byPath = new Map<string, unknown>();
  for (const [key, answer] of Object.entries(demo)) {
    const p = key.split("?")[0]!;
    if (!byPath.has(p) || p === key) byPath.set(p, answer);
  }
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const full = String(input);
    const url = full.split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ method, url: full, body });
    const own = Object.hasOwn(routes, `${method} ${url}`) ? routes[`${method} ${url}`] : undefined;
    let answer: unknown = own;
    if (answer === undefined && method === "GET")
      answer = Object.hasOwn(demo, full) ? demo[full] : (routes[url] ?? byPath.get(url));
    if (answer === undefined && method !== "GET") answer = {};
    if (answer === undefined) {
      missed.push(`${method} ${full}`);
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const out = typeof answer === "function" ? (answer as (b: unknown) => unknown)(body) : answer;
    // A test can answer with a Response of its own, for example an error status.
    return out instanceof Response ? out : Response.json(out);
  });
  return { missed, requests };
}
