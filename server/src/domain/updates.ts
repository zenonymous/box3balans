import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import type { DB } from "../db/client.js";
import { settings } from "../db/schema.js";
import { tr } from "../i18n/index.js";
import type { FetchFn } from "../lib/http.js";
import { APP_VERSION } from "../lib/version.js";

/**
 * The update check: off unless you turn it on, because it asks GitHub (and so tells GitHub your IP
 * address). When on, it looks up the latest release of the repository the app was built from.
 */
export const UPDATE_KEY = "update_check";

export interface UpdateStatus {
  enabled: boolean;
  current: string;
  checkedAt?: string;
  latest?: { version: string; name: string; url: string; publishedAt: string };
  /** True when the latest release is newer than this build; null when this build has no version number. */
  newer?: boolean | null;
  error?: string;
}

type Stored = Omit<UpdateStatus, "current">;

async function readStored(db: DB): Promise<Stored> {
  const [row] = await db.select().from(settings).where(eq(settings.key, UPDATE_KEY));
  const stored = (row?.value as Stored | undefined) ?? { enabled: false };
  return { ...stored, enabled: !!stored.enabled };
}

export async function getUpdateStatus(db: DB): Promise<UpdateStatus> {
  return { ...(await readStored(db)), current: APP_VERSION };
}

async function save(db: DB, value: Stored) {
  await db
    .insert(settings)
    .values({ key: UPDATE_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function setUpdateCheck(db: DB, enabled: boolean): Promise<void> {
  const stored = await readStored(db);
  // Turning it off forgets what GitHub said.
  await save(db, enabled ? { ...stored, enabled } : { enabled: false });
}

/** "1.3.0 (abc1234)" → [1, 3, 0, ""]; anything without a version number → null. */
export function parseVersion(v: string): [number, number, number, string] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ""] : null;
}

/** True when `a` is a later version than `b`; a pre-release comes before its release. */
export function isNewer(a: string, b: string): boolean | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) > (y[i] as number);
  if (x[3] === y[3]) return false;
  if (!x[3]) return true; // 1.3.0 after 1.3.0-rc.1
  if (!y[3]) return false;
  return x[3] > y[3];
}

/** owner/repo from a GitHub URL ("https://github.com/OWNER/box3balans"), or null. */
export function githubRepo(url: string): string | null {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Asks GitHub for the latest release, when the check is on. */
export async function checkForUpdate(db: DB, config: Config, fetchFn: FetchFn = fetch): Promise<UpdateStatus> {
  const stored = await readStored(db);
  if (!stored.enabled) return getUpdateStatus(db);
  const repo = githubRepo(config.SOURCE_URL);
  const checkedAt = new Date().toISOString();
  if (!repo) {
    await save(db, { ...stored, checkedAt, error: tr("The source address isn't a GitHub repository.") });
    return getUpdateStatus(db);
  }
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Box3balans" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) throw new Error(tr("No releases found yet"));
    if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
    const r = (await res.json()) as { tag_name?: string; name?: string; html_url?: string; published_at?: string };
    if (!r.tag_name) throw new Error(tr("No releases found yet"));
    const version = r.tag_name.replace(/^v/, "");
    await save(db, {
      enabled: true,
      checkedAt,
      latest: {
        version,
        name: r.name || r.tag_name,
        url: r.html_url ?? config.SOURCE_URL,
        publishedAt: r.published_at ?? "",
      },
      newer: isNewer(version, APP_VERSION),
    });
  } catch (err) {
    await save(db, { ...stored, checkedAt, error: (err as Error).message });
  }
  return getUpdateStatus(db);
}
