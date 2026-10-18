import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { settings } from "../db/schema.js";
import type { RequestRecord } from "../lib/net.js";
import { localDay } from "../lib/time.js";

/**
 * What Box3balans sent, for Settings → Network: the latest requests (in memory), how often each host
 * was contacted per day (kept 90 days) and every refused request (the last 50); the last two are
 * saved every few minutes and at shutdown, so they survive a restart.
 */
const KEY = "network:log";
const RECENT = 500;
const BLOCKED = 50;
const DAYS = 90;

type Saved = { daily: Record<string, Record<string, number>>; blocked: (Omit<RequestRecord, "at"> & { at: string })[] };

export class NetworkLog {
  readonly since = new Date();
  private recent: RequestRecord[] = [];
  private blocked: RequestRecord[] = [];
  private daily: Record<string, Record<string, number>> = {};
  private dirty = false;

  constructor(private db?: DB) {}

  async load(): Promise<void> {
    if (!this.db) return;
    const [row] = await this.db.select().from(settings).where(eq(settings.key, KEY));
    const saved = row?.value as Saved | undefined;
    if (!saved) return;
    this.daily = { ...saved.daily, ...this.daily };
    this.blocked = [...saved.blocked.map((b) => ({ ...b, at: new Date(b.at) })), ...this.blocked].slice(-BLOCKED);
  }

  record = (r: RequestRecord): void => {
    this.recent.push(r);
    if (this.recent.length > RECENT) this.recent.shift();
    if (r.blocked) {
      // Turned off by you isn't an alarm; an address that isn't on the list is.
      if (r.reason === "off") return;
      this.blocked.push(r);
      if (this.blocked.length > BLOCKED) this.blocked.shift();
    } else {
      const day = (this.daily[localDay(r.at)] ??= {});
      day[r.host] = (day[r.host] ?? 0) + 1;
    }
    this.dirty = true;
  };

  async flush(): Promise<void> {
    if (!this.db || !this.dirty) return;
    const days = Object.keys(this.daily).sort().slice(-DAYS);
    this.daily = Object.fromEntries(days.map((d) => [d, this.daily[d]!]));
    const value: Saved = { daily: this.daily, blocked: this.blocked.map((b) => ({ ...b, at: b.at.toISOString() })) };
    await this.db
      .insert(settings)
      .values({ key: KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
    this.dirty = false;
  }

  /** The newest first; per day for the last `days` days with requests. */
  snapshot(days = 30) {
    const daily = Object.entries(this.daily)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, days)
      .map(([day, hosts]) => ({ day, hosts }));
    return {
      since: this.since,
      recent: [...this.recent].reverse(),
      blocked: [...this.blocked].reverse(),
      daily,
    };
  }
}

// ---- Switches (Settings → Network) ----

const OFF_KEY = "network:off";

/** The destinations turned off (lib/net.ts SWITCHABLE ids). */
export async function loadTurnedOff(db: DB): Promise<string[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, OFF_KEY));
  return Array.isArray(row?.value) ? (row.value as string[]) : [];
}

export async function saveTurnedOff(db: DB, ids: string[]): Promise<void> {
  await db
    .insert(settings)
    .values({ key: OFF_KEY, value: ids })
    .onConflictDoUpdate({ target: settings.key, set: { value: ids } });
}
