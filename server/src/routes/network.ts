import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { saveTurnedOff } from "../domain/networkLog.js";
import { tr } from "../i18n/index.js";
import { notInDemo } from "../lib/errors.js";
import { DESTINATIONS, SWITCHABLE, destinationsOf, setTurnedOff, turnedOff } from "../lib/net.js";

/** Settings → Network: where Box3balans may go, and what it sent (lib/net.ts, domain/networkLog.ts). */
export async function networkRoutes(app: FastifyInstance) {
  const { db, network, config } = app.deps;

  app.get("/network", async () => {
    const log = network.snapshot();
    const purposes = (host: string) => destinationsOf(host.replace(/:\d+$/, "")).map((d) => d.id);
    return {
      destinations: DESTINATIONS.map((d) => ({
        id: d.id,
        purpose: tr(d.purpose),
        sends: tr(d.sends),
        when: tr(d.when),
        hosts: d.hosts,
      })),
      // Destinations you turned off, and which ones can be (the update check has its own switch).
      off: turnedOff(),
      switchable: SWITCHABLE,
      since: log.since,
      daily: log.daily,
      recent: log.recent.slice(0, 200).map((r) => ({ ...r, purposes: purposes(r.host) })),
      blocked: log.blocked,
    };
  });

  // Turn destinations off (all of them: offline) or on again; takes effect at once.
  app.put("/network/off", async (req) => {
    if (config.DEMO) throw notInDemo();
    const { off } = z.object({ off: z.array(z.enum(SWITCHABLE as [string, ...string[]])).max(20) }).parse(req.body);
    const ids = [...new Set(off)];
    await saveTurnedOff(db, ids);
    setTurnedOff(ids);
    return { off: turnedOff() };
  });
}
