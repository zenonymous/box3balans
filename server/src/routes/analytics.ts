import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { downsample, computeHistory } from "../domain/history.js";
import { computeYears, loadEvents } from "../domain/performance.js";
import { buildPortfolio } from "../domain/portfolio.js";
import { getCostMethod, setCostMethod } from "../domain/settings.js";
import { D, type Decimal, ZERO, money2 } from "../lib/decimal.js";
import { staleAfterMs } from "../jobs/scheduler.js";

const RANGE_DAYS: Record<string, number | null> = { "1M": 31, "3M": 92, "1Y": 366, "5Y": 1827, ALL: null };

export async function analyticsRoutes(app: FastifyInstance) {
  const { db, config, backfill } = app.deps;

  app.get("/settings", async () => ({ costMethod: await getCostMethod(db) }));

  app.put("/settings", async (req) => {
    const body = z.object({ costMethod: z.enum(["average", "fifo"]) }).parse(req.body);
    await setCostMethod(db, body.costMethod);
    return { costMethod: body.costMethod };
  });

  // Daily net worth by asset class, computed from transactions and stored daily prices.
  app.get("/portfolio/history", async (req) => {
    const { range, maxPoints } = z
      .object({
        range: z.enum(["1M", "3M", "1Y", "5Y", "ALL"]).default("1Y"),
        // Long ranges are thinned out for charts; raise this to get every day.
        maxPoints: z.coerce.number().int().min(10).max(10_000).default(420),
      })
      .parse(req.query);
    const { points, estimated } = await computeHistory(db, await getCostMethod(db));
    const days = RANGE_DAYS[range];
    const from = days ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : "";
    return {
      points: downsample(
        points.filter((p) => p.day >= from),
        maxPoints,
      ),
      estimated,
      backfill: backfill.lastResult,
    };
  });

  app.get("/performance", async () => {
    const method = await getCostMethod(db);
    const [years, { realized }, portfolio] = await Promise.all([
      computeYears(db, method),
      loadEvents(db, method),
      buildPortfolio(db, { staleAfterMs: staleAfterMs(config) }),
    ]);
    const sum = (f: (y: (typeof years)[number]) => string) =>
      money2(years.reduce<Decimal>((a, y) => a.plus(D(f(y))), ZERO));
    const byAsset = portfolio.holdings
      .filter((h) => h.assetClass !== "cash")
      .map((h) => ({
        key: h.key,
        assetId: h.assetId,
        name: h.name,
        symbol: h.symbol,
        assetClass: h.assetClass,
        valueEur: h.valueEur,
        costEur: h.costEur,
        unrealizedEur: h.unrealizedEur,
        realizedEur: h.realizedEur,
        incomeEur: h.incomeEur,
        feesEur: h.feesEur,
        totalEur: money2(D(h.unrealizedEur).plus(D(h.realizedEur)).plus(D(h.incomeEur))),
        localCurrency: h.localCurrency,
        priceEffectEur: h.priceEffectEur,
        fxEffectEur: h.fxEffectEur,
      }))
      .sort((a, b) => D(b.totalEur).cmp(D(a.totalEur)));
    return {
      costMethod: method,
      years,
      allTime: {
        realizedEur: sum((y) => y.realizedEur),
        incomeEur: sum((y) => y.incomeEur),
        unrealizedEur: portfolio.summary.unrealizedEur,
        resultEur: sum((y) => y.resultEur),
        feesEur: sum((y) => y.feesEur),
      },
      byAsset,
      realized,
    };
  });

  app.get("/income", async () => {
    const { income } = await loadEvents(db, await getCostMethod(db));
    const byYear = new Map<number, { dividends: Decimal; rewards: Decimal; interest: Decimal; tax: Decimal }>();
    const byMonth = new Map<string, { dividends: Decimal; rewards: Decimal; interest: Decimal }>();
    const byAsset = new Map<
      number,
      { symbol: string; name: string; gross: Decimal; tax: Decimal; net: Decimal; count: number }
    >();
    const key = (k: string) =>
      (k === "dividend" ? "dividends" : k === "interest" ? "interest" : "rewards") as
        "dividends" | "rewards" | "interest";
    for (const e of income) {
      const y = Number(e.date.slice(0, 4));
      const yr = byYear.get(y) ?? { dividends: ZERO, rewards: ZERO, interest: ZERO, tax: ZERO };
      yr[key(e.kind)] = yr[key(e.kind)].plus(D(e.netEur));
      yr.tax = yr.tax.plus(D(e.taxEur));
      byYear.set(y, yr);
      const m = e.date.slice(0, 7);
      const mo = byMonth.get(m) ?? { dividends: ZERO, rewards: ZERO, interest: ZERO };
      mo[key(e.kind)] = mo[key(e.kind)].plus(D(e.netEur));
      byMonth.set(m, mo);
      const a = byAsset.get(e.assetId) ?? {
        symbol: e.symbol,
        name: e.name,
        gross: ZERO,
        tax: ZERO,
        net: ZERO,
        count: 0,
      };
      a.gross = a.gross.plus(D(e.grossEur));
      a.tax = a.tax.plus(D(e.taxEur));
      a.net = a.net.plus(D(e.netEur));
      a.count++;
      byAsset.set(e.assetId, a);
    }
    return {
      events: income,
      byYear: [...byYear]
        .sort(([a], [b]) => b - a)
        .map(([y, v]) => ({
          year: y,
          dividendsEur: money2(v.dividends),
          rewardsEur: money2(v.rewards),
          interestEur: money2(v.interest),
          totalEur: money2(v.dividends.plus(v.rewards).plus(v.interest)),
          taxWithheldEur: money2(v.tax),
        })),
      byMonth: [...byMonth]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({
          month,
          dividendsEur: money2(v.dividends),
          rewardsEur: money2(v.rewards),
          interestEur: money2(v.interest),
        })),
      byAsset: [...byAsset]
        .map(([assetId, v]) => ({
          assetId,
          symbol: v.symbol,
          name: v.name,
          count: v.count,
          grossEur: money2(v.gross),
          taxEur: money2(v.tax),
          netEur: money2(v.net),
        }))
        .sort((a, b) => D(b.netEur).cmp(D(a.netEur))),
    };
  });

  // Manually (re)load price history, e.g. after fixing a ticker.
  app.post("/prices/backfill", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async () =>
    backfill.run({ force: true }),
  );
}
