import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { checkForUpdate, getUpdateStatus, setUpdateCheck } from "../domain/updates.js";
import { notInDemo } from "../lib/errors.js";

/** The opt-in check for a new release (Settings → About). */
export async function updateRoutes(app: FastifyInstance) {
  const { db, config, prices } = app.deps;

  app.get("/", async () => getUpdateStatus(db));

  app.put("/", async (req) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    if (config.DEMO && enabled) throw notInDemo();
    await setUpdateCheck(db, enabled);
    return enabled ? checkForUpdate(db, config, prices.fetchFn) : getUpdateStatus(db);
  });

  app.post("/check", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async () =>
    checkForUpdate(db, config, prices.fetchFn),
  );
}
