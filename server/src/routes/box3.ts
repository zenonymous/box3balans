import type { FastifyInstance } from "fastify";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { accounts } from "../db/schema.js";
import {
  DEFAULT_RATES,
  availableYears,
  computeBox3Year,
  configSchema,
  loadConfig,
  saveConfig,
} from "../domain/box3.js";
import { actualReturn } from "../domain/box3Actual.js";
import { taxReturnOverview } from "../domain/taxReturn.js";
import { RULES } from "../rules/index.js";
import { FUTURE_PRESETS, compareWithDeemed, simulateFuture } from "../domain/box3Future.js";
import { HttpError } from "../lib/errors.js";
import { localToday } from "../lib/time.js";
import { tr } from "../i18n/index.js";

export async function box3Routes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get("/", async () => {
    const [years, config, accountRows] = await Promise.all([
      availableYears(db),
      loadConfig(db),
      db
        .select({ id: accounts.id, name: accounts.name, kind: accounts.kind, archived: accounts.archived })
        .from(accounts)
        .orderBy(asc(accounts.name)),
    ]);
    return {
      years,
      config,
      defaultRates: DEFAULT_RATES,
      // When the built-in rules were last checked, and where each year's figures come from.
      rules: {
        checkedAt: RULES.checkedAt,
        sources: Object.fromEntries(Object.entries(RULES.years).map(([y, r]) => [y, r.source])),
      },
      accounts: accountRows,
    };
  });

  app.get("/:year", async (req) => {
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.params);
    if (year > new Date().getUTCFullYear())
      throw new HttpError(400, tr("The peildatum of that year hasn't happened yet"));
    const config = await loadConfig(db);
    const [result, actual] = await Promise.all([computeBox3Year(db, year, config), actualReturn(db, year, config)]);
    // Tegenbewijsregeling: the actual return of the calendar year against the deemed-return tax.
    const deemed = result.calculation
      ? { taxEur: Number(result.calculation.netTaxEur), benefitEur: Number(result.calculation.benefitEur) }
      : null;
    return {
      ...result,
      actualReturn: {
        ...actual,
        comparison: compareWithDeemed(actual, deemed, result.rates ? Number(result.rates.taxRatePct) : null),
      },
    };
  });

  // Box 3 of a year arranged as the income tax return asks for it.
  app.get("/:year/return", async (req) => {
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.params);
    if (year > new Date().getUTCFullYear())
      throw new HttpError(400, tr("The peildatum of that year hasn't happened yet"));
    return taxReturnOverview(db, year, await loadConfig(db));
  });

  // The planned actual-return system (from 2028) applied to your past years. Not law yet: the
  // parameters come from a preset and can each be overridden.
  app.get("/future", async (req) => {
    const q = z
      .object({
        preset: z.enum(Object.keys(FUTURE_PRESETS) as [string, ...string[]]).default("bill"),
        ratePct: z.coerce.number().min(0).max(100).optional(),
        allowanceEur: z.coerce.number().min(0).max(1_000_000).optional(),
        lossThresholdEur: z.coerce.number().min(0).max(1_000_000).optional(),
        carryBackYears: z.coerce.number().int().min(0).max(1).optional(),
      })
      .parse(req.query);
    const base = FUTURE_PRESETS[q.preset]!;
    const params = {
      ratePct: q.ratePct ?? base.ratePct,
      allowanceEur: q.allowanceEur ?? base.allowanceEur,
      lossThresholdEur: q.lossThresholdEur ?? base.lossThresholdEur,
      carryBackYears: (q.carryBackYears ?? base.carryBackYears) as 0 | 1,
    };
    const config = await loadConfig(db);
    const taxYears = await availableYears(db);
    // The first year with activity has a return too (it has no peildatum of its own).
    const years = taxYears.length ? [...taxYears, taxYears.at(-1)! - 1].sort((a, b) => a - b) : [];
    const inputs = [];
    for (const year of years) {
      const [actual, box3] = await Promise.all([
        actualReturn(db, year, config),
        taxYears.includes(year) ? computeBox3Year(db, year, config) : Promise.resolve(null),
      ]);
      inputs.push({
        year,
        complete: actual.complete,
        actualReturnEur: actual.totalEur,
        costsEur: actual.costsEur,
        partner: config.years[String(year)]?.partner ?? false,
        deemedTaxEur: box3?.calculation ? Number(box3.calculation.netTaxEur) : null,
      });
    }
    return {
      presets: Object.entries(FUTURE_PRESETS).map(([id, p]) => ({ id, ...p })),
      preset: q.preset,
      params,
      today: localToday(),
      rows: simulateFuture(inputs, params).reverse(),
    };
  });

  app.put("/config", async (req) => {
    const config = configSchema.parse(req.body);
    await saveConfig(db, config);
    return loadConfig(db);
  });
}
