import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { waitForPostgres } from "../src/db/client.js";

const fail = (code: string) => Object.assign(new Error(code), { code });
const poolFrom = (...results: (Error | null)[]) => {
  const query = vi.fn(async () => {
    const r = results.shift();
    if (r) throw r;
    return { rows: [] };
  });
  return { pool: { query } as unknown as pg.Pool, query };
};

describe("waiting for Postgres at startup", () => {
  it("retries while the database is still starting", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pool, query } = poolFrom(fail("ECONNREFUSED"), fail("57P03"), null);
    await waitForPostgres(pool, 1_000, 1);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("fails fast on configuration errors such as a wrong password", async () => {
    const { pool, query } = poolFrom(fail("28P01"));
    await expect(waitForPostgres(pool, 1_000, 1)).rejects.toThrow("28P01");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("gives up after the timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pool } = poolFrom(...Array.from({ length: 100 }, () => fail("ECONNREFUSED")));
    await expect(waitForPostgres(pool, 30, 10)).rejects.toThrow("ECONNREFUSED");
  });
});
