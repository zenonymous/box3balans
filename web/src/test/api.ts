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
