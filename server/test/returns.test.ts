import { describe, expect, it } from "vitest";
import type { HistoryPoint } from "../src/domain/history.js";
import { periodReturn, twr, twrIndex, xirr } from "../src/domain/returns.js";

const pt = (day: string, totalEur: number, flowEur = 0): HistoryPoint => ({
  day,
  totalEur,
  flowEur,
  byClass: { stock: 0, etf: 0, crypto: 0, metal: 0, cash: 0, other: 0 },
  investedEur: 0,
  unrealizedEur: 0,
});

describe("XIRR", () => {
  it("matches simple and published examples", () => {
    expect(
      xirr([
        { day: "2021-01-01", amount: -1000 },
        { day: "2022-01-01", amount: 1100 },
      ]),
    ).toBeCloseTo(0.1, 9);
    // The example from Excel's XIRR documentation: 37.34%.
    expect(
      xirr([
        { day: "2008-01-01", amount: -10000 },
        { day: "2008-03-01", amount: 2750 },
        { day: "2008-10-30", amount: 4250 },
        { day: "2009-02-15", amount: 3250 },
        { day: "2009-04-01", amount: 2750 },
      ]),
    ).toBeCloseTo(0.373362535, 6);
    // A loss.
    expect(
      xirr([
        { day: "2021-01-01", amount: -1000 },
        { day: "2022-01-01", amount: 500 },
      ]),
    ).toBeCloseTo(-0.5, 9);
  });

  it("has no answer when money only goes one way", () => {
    expect(xirr([{ day: "2021-01-01", amount: -1000 }])).toBeNull();
    expect(xirr([])).toBeNull();
  });
});

describe("time-weighted return", () => {
  // €1000 in, +10%, another €1000 in (no gain that day), +10%.
  const points = [
    pt("2024-01-01", 1000, 1000),
    pt("2024-01-02", 1100),
    pt("2024-01-03", 2100, 1000),
    pt("2024-01-04", 2310),
  ];

  it("ignores when money came in", () => {
    expect(twr(points, 0, 3)).toBeCloseTo(0.21, 10);
    expect(twrIndex(points).map((x) => Math.round(x * 1000) / 1000)).toEqual([1, 1.1, 1.1, 1.21]);
  });

  it("splits a period into result, flows and both returns", () => {
    const all = periodReturn(points, null, "2024-01-04")!;
    expect(all).toMatchObject({ startEur: 0, endEur: 2310, flowsEur: 2000, resultEur: 310, twrPct: 21 });
    // Money-weighted: the second €1000 was in for a third of the time and earned 10% of it, so per
    // euro-day the money did better than the time-weighted 21% (Modified Dietz: 310 / 1333 ≈ 23.3%).
    expect(all.mwrPct!).toBeGreaterThan(23);
    expect(all.mwrPct!).toBeLessThan(24);
    const part = periodReturn(points, "2024-01-02", "2024-01-04")!;
    expect(part).toMatchObject({ startEur: 1100, endEur: 2310, flowsEur: 1000, resultEur: 210, twrPct: 10 });
  });

  it("stays sane when a big deposit meets a tiny balance", () => {
    const p = [pt("2024-01-01", 5, 5), pt("2024-01-02", 10010, 10000)];
    expect(twr(p, 0, 1)).toBeCloseTo(5 / 10005, 9);
  });
});
