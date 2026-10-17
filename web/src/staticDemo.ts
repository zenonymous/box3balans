import { ApiError } from "./api";
import { getLang, t } from "./i18n";

/**
 * The online demo (box3balans.nl/demo/) has no server: scripts/build-online-demo.js asked the demo
 * every question the pages ask, in Dutch and in English, and saved the answers next to the app.
 * This answers from those. Nothing can be saved, except the language, which picks the other set.
 * The lists the server filters and pages (transactions, activity) were saved whole and are
 * filtered here the way the server does it.
 */

interface Saved {
  status: number;
  file: string;
}
type List<T> = { total: number; items: T[] };

const dir = `${import.meta.env.BASE_URL}data/${getLang()}/`;
let index: Promise<Record<string, Saved>> | undefined;

async function load<T>(file: string): Promise<T> {
  const res = await fetch(dir + file);
  if (!res.ok) throw new ApiError(res.status, t("The online demo could not load its data."));
  return (await res.json()) as T;
}

const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");

// Per list, which item a query keeps: the same conditions as the server's routes.
const FILTERS: Record<string, (item: Record<string, unknown>, q: URLSearchParams) => boolean> = {
  "/api/transactions": (tx, q) => {
    const at = String(tx.occurredAt);
    const text = q.get("q")?.trim().toLowerCase();
    return (
      (!q.get("accountId") || tx.accountId === Number(q.get("accountId"))) &&
      (!q.get("assetId") || tx.assetId === Number(q.get("assetId"))) &&
      (!q.get("type") || tx.type === q.get("type")) &&
      (!q.get("from") || at >= `${q.get("from")}T00:00:00.000Z`) &&
      (!q.get("to") || at <= `${q.get("to")}T23:59:59.999Z`) &&
      (!text || [tx.assetName, tx.assetSymbol, tx.accountName, tx.notes].some((v) => lower(v).includes(text)))
    );
  },
  "/api/activity": (e, q) =>
    (!q.get("entity") || e.entity === q.get("entity")) &&
    (!q.get("entityId") || e.entityId === Number(q.get("entityId"))),
};

export async function staticApi<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (method !== "GET") {
    // Switching the language works: the page reloads with the other set of answers.
    const keys = body && typeof body === "object" ? Object.keys(body) : [];
    if (method === "PUT" && url === "/api/settings" && keys.length === 1 && keys[0] === "language") return {} as T;
    throw new ApiError(
      403,
      t("Nothing can be saved in the online demo. To try this, run the demo yourself (see Install in the README)."),
    );
  }
  index ??= load<Record<string, Saved>>("index.json");
  const saved = await index;
  const [path, query = ""] = url.split("?");
  const filter = FILTERS[path!];
  if (filter && saved[path!]) {
    const q = new URLSearchParams(query);
    const all = await load<List<Record<string, unknown>>>(saved[path!]!.file);
    const items = all.items.filter((item) => filter(item, q));
    const offset = Number(q.get("offset") ?? 0);
    const limit = Number(q.get("limit") ?? 100);
    return { total: items.length, items: items.slice(offset, offset + limit) } as T;
  }
  const hit = saved[url];
  if (!hit) {
    // Shows up in the page check (scripts/check-pages.js), so a page that needs it is noticed.
    console.error(`Online demo: no saved answer for ${url}`);
    throw new ApiError(404, t("This isn't part of the online demo."));
  }
  const data = await load<Record<string, unknown>>(hit.file);
  if (hit.status >= 400)
    throw new ApiError(hit.status, typeof data?.error === "string" ? data.error : "", undefined, data);
  return data as T;
}
