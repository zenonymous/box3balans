import type { FastifyInstance } from "fastify";
import { dividendForecast, withholdingByCountry } from "../domain/dividends.js";
import { getCostMethod } from "../domain/settings.js";
import { staleAfterMs } from "../jobs/scheduler.js";

export async function dividendRoutes(app: FastifyInstance) {
  const { db, config, prices } = app.deps;
  app.get("/forecast", async () => dividendForecast(db, prices.fx, prices.fetchFn, staleAfterMs(config)));
  app.get("/withholding", async () => withholdingByCountry(db, await getCostMethod(db)));
}
