import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  accountYears,
  assets,
  imports,
  integrations,
  priceHistory,
  transactions,
  walletAddresses,
} from "../db/schema.js";
import { APP_VERSION } from "../lib/version.js";
import type { Box3Year } from "./box3.js";

/**
 * Where the amounts in a year's box 3 come from, for the yearly dossier: per account how its data
 * got in (a connection, a wallet, CSV imports, entries by hand, a value per year), and per price the
 * source it came from.
 */
export interface Dossier {
  year: number;
  generatedAt: string;
  version: string;
  accounts: {
    id: number;
    sync: { provider: string; lastSyncAt: string | null } | null;
    wallets: { chain: string; address: string }[];
    imports: { fileName: string; at: string; inserted: number }[];
    // Transactions up to the peildatum, by how they got in.
    entries: { api: number; chain: number; csv: number; manual: number };
    // An account kept as values per year: where this year's value came from.
    yearly: { source: string | null; updatedAt: string } | null;
  }[];
  // Per holding's close: where it came from, and else the holding's price feed.
  prices: { assetId: number; day: string; source: string | null; feed: string | null }[];
}

export async function buildDossier(db: DB, y: Box3Year): Promise<Dossier> {
  const accountIds = [...new Set(y.rows.map((r) => r.accountId))];
  const priced = y.rows.filter((r) => r.source === "transactions" && r.priceDay);
  const assetIds = [...new Set(priced.map((r) => r.assetId))];
  const peildatum = new Date(`${y.peildatum}T00:00:00Z`);
  const none = accountIds.length === 0;

  const [syncs, wallets, files, counts, yearly, assetRows, closes] = await Promise.all([
    none ? [] : db.select().from(integrations).where(inArray(integrations.accountId, accountIds)),
    none ? [] : db.select().from(walletAddresses).where(inArray(walletAddresses.accountId, accountIds)),
    none ? [] : db.select().from(imports).where(inArray(imports.accountId, accountIds)),
    none
      ? []
      : db
          .select({ accountId: transactions.accountId, source: transactions.source, n: sql<number>`count(*)::int` })
          .from(transactions)
          .where(and(inArray(transactions.accountId, accountIds), lt(transactions.occurredAt, peildatum)))
          .groupBy(transactions.accountId, transactions.source),
    none
      ? []
      : db
          .select()
          .from(accountYears)
          .where(and(inArray(accountYears.accountId, accountIds), eq(accountYears.year, y.year))),
    assetIds.length ? db.select().from(assets).where(inArray(assets.id, assetIds)) : [],
    assetIds.length
      ? db
          .select({ assetId: priceHistory.assetId, day: priceHistory.day, source: priceHistory.source })
          .from(priceHistory)
          .where(inArray(priceHistory.assetId, assetIds))
      : [],
  ]);

  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const sourceOf = new Map(closes.map((c) => [`${c.assetId}:${String(c.day)}`, c.source]));
  const seen = new Set<string>();
  const prices: Dossier["prices"] = [];
  for (const r of priced) {
    const key = `${r.assetId}:${r.priceDay}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = assetById.get(r.assetId);
    prices.push({
      assetId: r.assetId,
      day: r.priceDay!,
      source: sourceOf.get(key) ?? null,
      feed: a ? (a.priceRef && a.priceSource !== "manual" ? `${a.priceSource}:${a.priceRef}` : a.priceSource) : null,
    });
  }

  return {
    year: y.year,
    generatedAt: new Date().toISOString(),
    version: APP_VERSION,
    accounts: accountIds.map((id) => {
      const s = syncs.find((x) => x.accountId === id);
      const yr = yearly.find((x) => x.accountId === id);
      const entries = { api: 0, chain: 0, csv: 0, manual: 0 };
      for (const c of counts) if (c.accountId === id) entries[c.source] += c.n;
      return {
        id,
        sync: s ? { provider: s.provider, lastSyncAt: s.lastSyncAt?.toISOString() ?? null } : null,
        wallets: wallets.filter((w) => w.accountId === id).map((w) => ({ chain: w.chain, address: w.address })),
        imports: files
          .filter((f) => f.accountId === id)
          .sort((a, b) => +a.createdAt - +b.createdAt)
          .map((f) => ({ fileName: f.fileName, at: f.createdAt.toISOString(), inserted: f.inserted })),
        entries,
        yearly: yr ? { source: yr.details.source ?? null, updatedAt: yr.updatedAt.toISOString() } : null,
      };
    }),
    prices,
  };
}
