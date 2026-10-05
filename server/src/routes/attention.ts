import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { collectIssues, dismiss, getDismissed } from "../domain/attention.js";
import { staleAfterMs } from "../jobs/scheduler.js";

export async function attentionRoutes(app: FastifyInstance) {
  const { db, config, backfill } = app.deps;

  app.get("/", async () => {
    const [issues, dismissed] = await Promise.all([
      collectIssues(
        db,
        config,
        { staleAfterMs: staleAfterMs(config), backfill: backfill.lastResult },
        { includeDismissed: true },
      ),
      getDismissed(db),
    ]);
    return issues.map((i) => ({ ...i, dismissed: i.dismissible && dismissed[i.key] === i.fingerprint }));
  });

  // Hides an issue until it changes (its fingerprint differs). Problems can't be dismissed.
  app.post("/dismiss", async (req) => {
    const { key, fingerprint } = z
      .object({ key: z.string().min(1).max(200), fingerprint: z.string().max(2000) })
      .parse(req.body);
    await dismiss(db, key, fingerprint);
    return { ok: true };
  });
}
