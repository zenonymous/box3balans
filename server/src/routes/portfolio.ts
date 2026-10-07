import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { settings } from "../db/schema.js";
import { buildPortfolio } from "../domain/portfolio.js";
import { str } from "../lib/decimal.js";
import { HttpError, notInDemo } from "../lib/errors.js";
import { currencyCode, isoDay } from "../lib/validation.js";
import { REFRESH_STATUS_KEY } from "../prices/service.js";
import { refreshAndSnapshot, staleAfterMs } from "../jobs/scheduler.js";

export async function portfolioRoutes(app: FastifyInstance) {
  const { db, config, prices } = app.deps;

  app.get("/portfolio", async () => {
    const { holdings, summary } = await buildPortfolio(db, { staleAfterMs: staleAfterMs(config) });
    return { summary, holdings };
  });

  app.get("/prices/status", async () => {
    const [row] = await db.select().from(settings).where(eq(settings.key, REFRESH_STATUS_KEY));
    return { status: row?.value ?? null, intervalMinutes: config.PRICE_REFRESH_MINUTES };
  });

  app.post("/prices/refresh", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async () => {
    // The demo's prices are made up; real ones would clash with their history.
    if (config.DEMO) throw notInDemo();
    return refreshAndSnapshot(db, prices, config);
  });

  // EUR per unit of a currency on a date, for pre-filling transaction forms.
  app.get("/fx", async (req) => {
    const { currency, date } = z.object({ currency: currencyCode, date: isoDay.optional() }).parse(req.query);
    try {
      return { currency, date: date ?? null, eurPerUnit: str(await prices.fx.eurPerUnit(currency, date)) };
    } catch (err) {
      throw new HttpError(502, (err as Error).message);
    }
  });
}
