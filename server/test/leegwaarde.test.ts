import { afterEach, describe, expect, it } from "vitest";
import { D } from "../src/lib/decimal.js";
import { leegwaarderatio, leegwaardeTable, yearlyValue } from "../src/domain/yearly.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe("leegwaarderatio", () => {
  it("counts a let home at its band, the upper bound included", () => {
    // Rent 6,000 on a WOZ of 300,000 is 2 %: the 1–2 % band, 79 %.
    expect(leegwaarderatio(D(6000), D(300000), 2025).toNumber()).toBe(0.79);
    expect(leegwaarderatio(D(6001), D(300000), 2025).toNumber()).toBe(0.84);
    expect(leegwaarderatio(D(20000), D(300000), 2026).toNumber()).toBe(1);
  });

  it("counts a home let to a related party well below the usual rent at 100 %", () => {
    expect(leegwaarderatio(D(1200), D(300000), 2026, true).toNumber()).toBe(1);
    const row = {
      year: 2025,
      valueEur: "300000",
      details: { rented: true, rentEur: "1200", relatedBelowMarket: true },
    };
    expect(yearlyValue("property", row)?.toNumber()).toBe(300000);
    expect(yearlyValue("property", { ...row, details: { rented: true, rentEur: "1200" } })?.toNumber()).toBe(219000);
  });

  it("takes the table of the year, and the first one for years before it", () => {
    expect(leegwaardeTable(2026)).toEqual(leegwaardeTable(2023));
    expect(leegwaardeTable(2019)).toEqual(leegwaardeTable(2023));
  });

  it("is served to the web app, which has no copy of its own", async () => {
    t = await createTestApp();
    const res = await t.api("GET", "/api/box3/leegwaarderatio");
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({
      fromYear: 2023,
      bands: expect.arrayContaining([{ upToRentPct: 1, valuePct: 73 }]),
    });
  });
});
