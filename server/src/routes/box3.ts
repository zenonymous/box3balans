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
import { computeYears } from "../domain/performance.js";
import { getCostMethod } from "../domain/settings.js";
import { HttpError } from "../lib/errors.js";

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
    return { years, config, defaultRates: DEFAULT_RATES, accounts: accountRows };
  });

  app.get("/:year", async (req) => {
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.params);
    if (year > new Date().getUTCFullYear()) throw new HttpError(400, "The peildatum of that year hasn't happened yet");
    const config = await loadConfig(db);
    const [result, perf] = await Promise.all([
      computeBox3Year(db, year, config),
      computeYears(db, await getCostMethod(db)),
    ]);
    // Indication for the tegenbewijsregeling: the actual result over the calendar year (realized +
    // income + change in open gains). Only meaningful once the year is over.
    const py = perf.find((y) => y.year === year);
    const complete = year < new Date().getUTCFullYear();
    return { ...result, actual: py ? { resultEur: py.resultEur, complete } : null };
  });

  app.put("/config", async (req) => {
    const config = configSchema.parse(req.body);
    await saveConfig(db, config);
    return loadConfig(db);
  });
}
