import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { staticApi } from "./staticDemo";
import demo from "./test/demo.fixture.json";

/**
 * The online demo answers from the recorded files (data/<lang>/index.json plus one file per answer).
 * Here those files are served from the demo fixture, so this checks the lookups and the filtering
 * the server would do, without a server.
 */
const recorded = demo as Record<string, unknown>;
const index = Object.fromEntries(Object.keys(recorded).map((url, i) => [url, { status: 200, file: `${i}.json` }]));
const files = Object.fromEntries(Object.keys(recorded).map((url, i) => [`${i}.json`, recorded[url]]));
const fetched: string[] = [];

vi.stubGlobal("fetch", async (input: string) => {
  const file = String(input).split("/").pop()!;
  fetched.push(file);
  if (file === "index.json") return Response.json(index);
  return file in files ? Response.json(files[file]) : new Response("not found", { status: 404 });
});
afterEach(() => vi.spyOn(console, "error").mockRestore());

type List = { total: number; items: { accountId: number; type: string }[] };

describe("the online demo's answers", () => {
  it("answers a recorded question with its recorded answer", async () => {
    const accounts = await staticApi<{ name: string }[]>("GET", "/api/accounts");
    expect(accounts.map((a) => a.name)).toContain("ASN Sparen");
  });

  it("filters and pages the transactions the way the server does", async () => {
    const all = await staticApi<List>("GET", "/api/transactions?limit=1000");
    const bitvavo = await staticApi<List>("GET", "/api/transactions?accountId=2&limit=1000");
    expect(bitvavo.total).toBeGreaterThan(0);
    expect(bitvavo.total).toBeLessThan(all.total);
    expect(bitvavo.items.every((tx) => tx.accountId === 2)).toBe(true);
    const page = await staticApi<List>("GET", "/api/transactions?limit=2&offset=1");
    expect(page.items).toEqual(all.items.slice(1, 3));
    expect(page.total).toBe(all.total);
  });

  it("says plainly that nothing can be saved, except switching the language", async () => {
    await expect(staticApi("PUT", "/api/settings", { language: "en" })).resolves.toEqual({});
    await expect(staticApi("POST", "/api/accounts", { name: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(staticApi("PUT", "/api/settings", { costMethod: "fifo" })).rejects.toBeInstanceOf(ApiError);
  });

  it("gives a 404 for a question that wasn't recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(staticApi("GET", "/api/nothing-like-this")).rejects.toMatchObject({ status: 404 });
  });

  it("loads the index once", async () => {
    await staticApi("GET", "/api/household");
    await staticApi("GET", "/api/assets");
    expect(fetched.filter((f) => f === "index.json")).toHaveLength(1);
  });
});
