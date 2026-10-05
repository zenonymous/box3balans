import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { moneyWeightedReturns } from "../domain/assetReturns.js";
import { BENCHMARKS, type BenchmarkId, benchmarkHistory, getBenchmarkId, setBenchmarkId } from "../domain/benchmark.js";
import { computeHistory, type HistoryPoint } from "../domain/history.js";
import { buildPortfolio } from "../domain/portfolio.js";
import {
  type PeriodReturn,
  annualise,
  pct,
  periodCashFlows,
  periodReturn,
  twr,
  twrIndex,
  xirr,
} from "../domain/returns.js";
import { getCostMethod } from "../domain/settings.js";
import { staleAfterMs } from "../jobs/scheduler.js";
import { localToday } from "../lib/time.js";
import { HistoryService } from "../prices/history.js";

const SERIES_POINTS = 420;

/** All-time figures plus annualised versions, or null without history. */
function allTime(points: HistoryPoint[]) {
  const today = points.at(-1)?.day;
  const base = today ? periodReturn(points, null, today) : null;
  if (!base) return null;
  const years = (Date.parse(base.to) - Date.parse(base.from)) / (365 * 86_400_000);
  const rate = xirr(periodCashFlows(points, -1, points.length - 1));
  return {
    ...base,
    years: Math.round(years * 100) / 100,
    twrAnnualPct: years >= 1 ? pct(annualise(twr(points, 0, points.length - 1), years)) : null,
    xirrPct: years >= 1 ? pct(rate) : null,
  };
}

export async function returnRoutes(app: FastifyInstance) {
  const { db, config, prices } = app.deps;

  app.get("/", async () => {
    const method = await getCostMethod(db);
    const [{ points }, benchmarkId, portfolio] = await Promise.all([
      computeHistory(db, method),
      getBenchmarkId(db),
      buildPortfolio(db, { staleAfterMs: staleAfterMs(config) }),
    ]);
    const bench =
      benchmarkId === "none"
        ? null
        : await benchmarkHistory(db, new HistoryService(db, prices.fx, prices.fetchFn), benchmarkId, points);

    const today = localToday();
    const thisYear = Number(today.slice(0, 4));
    const firstYear = points.length ? Number(points[0]!.day.slice(0, 4)) : thisYear;
    const years: (PeriodReturn & { year: number; benchmark: PeriodReturn | null })[] = [];
    for (let y = thisYear; y >= firstYear && points.length; y--) {
      const r = periodReturn(points, `${y - 1}-12-31`, `${y}-12-31`);
      if (!r) continue;
      years.push({
        year: y,
        ...r,
        benchmark: bench ? periodReturn(bench.points, `${y - 1}-12-31`, `${y}-12-31`) : null,
      });
    }

    // Chart series, thinned out evenly over long histories.
    const index = twrIndex(points);
    const benchIndex = bench ? twrIndex(bench.points) : null;
    const step = Math.max(1, Math.ceil(points.length / SERIES_POINTS));
    let invested = 0;
    const series = [];
    for (let i = 0; i < points.length; i++) {
      invested += points[i]!.flowEur;
      if (i % step !== 0 && i !== points.length - 1) continue;
      series.push({
        day: points[i]!.day,
        valueEur: points[i]!.totalEur,
        netInvestedEur: Math.round(invested * 100) / 100,
        benchmarkEur: bench ? bench.points[i]!.totalEur : null,
        twrIndex: Math.round(index[i]! * 1e6) / 1e6,
        benchmarkIndex: benchIndex ? Math.round(benchIndex[i]! * 1e6) / 1e6 : null,
      });
    }

    const mw = await moneyWeightedReturns(db, {
      byKey: new Map(portfolio.holdings.map((h) => [h.key, Number(h.valueEur)])),
      byAccount: new Map(portfolio.summary.byAccount.map((a) => [a.accountId, Number(a.valueEur)])),
    });

    return {
      benchmark: {
        id: benchmarkId,
        label: bench?.label ?? null,
        options: BENCHMARKS.map((b) => ({ id: b.id, label: b.label })),
      },
      allTime: allTime(points),
      ytd: points.length ? periodReturn(points, `${thisYear - 1}-12-31`, today) : null,
      benchmarkAllTime: bench ? allTime(bench.points) : null,
      years,
      series,
      byKey: Object.fromEntries(mw.byKey),
      byAccount: portfolio.summary.byAccount.map((a) => ({
        accountId: a.accountId,
        name: a.name,
        kind: a.kind,
        valueEur: a.valueEur,
        return: mw.byAccount.get(a.accountId) ?? { pct: null, annualised: false },
      })),
    };
  });

  app.put("/benchmark", async (req) => {
    const { id } = z
      .object({ id: z.enum(["none", ...BENCHMARKS.map((b) => b.id)] as [string, ...string[]]) })
      .parse(req.body);
    await setBenchmarkId(db, id as BenchmarkId);
    return { ok: true };
  });
}
