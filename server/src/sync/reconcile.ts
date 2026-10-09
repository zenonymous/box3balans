import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, transactions } from "../db/schema.js";
import { replayLedger } from "../domain/ledger.js";
import { D, Decimal } from "../lib/decimal.js";
import type { AssetResolver } from "./assets.js";
import type { Balance } from "./types.js";

export interface Mismatch {
  assetId: number;
  symbol: string;
  reported: string;
  computed: string;
  difference: string; // reported − computed
}

/**
 * Compares balances reported by the provider with what the account's transactions add up to.
 * Differences usually mean history the API doesn't expose (very old trades, internal moves).
 */
export async function reconcile(
  db: DB,
  resolver: AssetResolver,
  accountId: number,
  balances: Balance[],
  scope: "all" | "securities",
  // Only compare these assets plus whatever the provider reports (e.g. one chain of a wallet).
  onlyAssetIds?: Set<number>,
): Promise<Mismatch[]> {
  const txs = await db.select().from(transactions).where(eq(transactions.accountId, accountId));
  const computed = new Map<number, Decimal>();
  for (const p of replayLedger(txs).positions) if (p.accountId === accountId) computed.set(p.assetId, p.quantity);

  const reported = new Map<number, Decimal>();
  for (const b of balances) {
    if (scope === "securities" && b.asset.kind === "fiat") continue;
    const asset = await resolver.resolve(b.asset);
    reported.set(asset.id, (reported.get(asset.id) ?? D(0)).plus(D(b.quantity)));
  }

  const assetRows = await db
    .select({ id: assets.id, symbol: assets.symbol, assetClass: assets.assetClass })
    .from(assets);
  const byId = new Map(assetRows.map((a) => [a.id, a]));
  const ids = new Set([...reported.keys(), ...computed.keys()]);
  const out: Mismatch[] = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a || (scope === "securities" && a.assetClass === "cash")) continue;
    if (onlyAssetIds && !onlyAssetIds.has(id) && !reported.has(id)) continue;
    const r = reported.get(id) ?? D(0);
    const c = computed.get(id) ?? D(0);
    const diff = r.minus(c);
    // Ignore dust: below 1e-8 or 0.0001% of the balance. Money is reported in cents, while sums of
    // many trades in tiny unit prices leave fractions of a cent: below half a cent is no difference.
    const floor = a.assetClass === "cash" ? D("0.005") : D("0.00000001");
    const tolerance = Decimal.max(floor, Decimal.max(r.abs(), c.abs()).mul("0.000001"));
    if (diff.abs().gt(tolerance)) {
      out.push({
        assetId: id,
        symbol: a.symbol,
        reported: r.toFixed(),
        computed: c.toFixed(),
        difference: diff.toFixed(),
      });
    }
  }
  return out.sort((x, y) => x.symbol.localeCompare(y.symbol));
}
