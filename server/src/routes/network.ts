import type { FastifyInstance } from "fastify";
import { tr } from "../i18n/index.js";
import { DESTINATIONS, destinationsOf } from "../lib/net.js";

/** Settings → Network: where Box3balans may go, and what it sent (lib/net.ts, domain/networkLog.ts). */
export async function networkRoutes(app: FastifyInstance) {
  const { network } = app.deps;

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
      since: log.since,
      daily: log.daily,
      recent: log.recent.slice(0, 200).map((r) => ({ ...r, purposes: purposes(r.host) })),
      blocked: log.blocked,
    };
  });
}
