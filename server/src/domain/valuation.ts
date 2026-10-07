import { and, desc, eq, lte } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, metalItems, priceHistory, transactions } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { D, type Decimal } from "../lib/decimal.js";
import { Ledger, sortTransactions } from "./ledger.js";
import type { AssetClassKey } from "./portfolio.js";
import { localDay } from "../lib/time.js";
import { tr } from "../i18n/index.js";
import { displayName } from "../db/seed.js";

export interface HoldingOn {
  accountId: number;
  accountName: string;
  accountKind: string;
  assetId: number;
  symbol: string;
  name: string;
  assetClass: AssetClassKey;
  physical: boolean;
  quantity: Decimal;
  unit: string;
  priceEur: Decimal | null;
  // Day of the close used (the last one on or before the requested day).
  priceDay: string | null;
  valueEur: Decimal;
}

/**
 * Everything held at the end of `day`, per account and asset, valued at the close of `day` (or the
 * last close before it, e.g. the last trading day of the year). Holdings without any known price
 * have `priceEur` null and value 0, so callers can flag them.
 */
export async function holdingsOn(db: DB, day: string): Promise<HoldingOn[]> {
  const [txRows, assetRows, accountRows, items] = await Promise.all([
    db.select().from(transactions),
    db.select().from(assets),
    db.select().from(accounts),
    db.select().from(metalItems),
  ]);
  // Cost basis doesn't affect quantities, so the method doesn't matter here.
  const ledger = new Ledger("average");
  for (const tx of sortTransactions(txRows)) {
    if (localDay(tx.occurredAt) > day) break;
    ledger.apply(tx);
  }
  const asset = new Map(assetRows.map((a) => [a.id, a]));
  const account = new Map(accountRows.map((a) => [a.id, a]));

  const closes = new Map<number, { price: Decimal; day: string } | null>();
  const closeOn = async (assetId: number) => {
    if (closes.has(assetId)) return closes.get(assetId)!;
    const a = asset.get(assetId);
    let v: { price: Decimal; day: string } | null = null;
    if (a?.priceSource === "fx" && a.priceRef === "EUR") v = { price: D(1), day };
    else {
      const [row] = await db
        .select({ day: priceHistory.day, closeEur: priceHistory.closeEur })
        .from(priceHistory)
        .where(and(eq(priceHistory.assetId, assetId), lte(priceHistory.day, day)))
        .orderBy(desc(priceHistory.day))
        .limit(1);
      if (row) v = { price: D(row.closeEur), day: row.day };
    }
    closes.set(assetId, v);
    return v;
  };

  const out: HoldingOn[] = [];
  for (const p of ledger.positions.values()) {
    if (p.quantity.isZero()) continue;
    const a = asset.get(p.assetId);
    if (!a || a.hidden) continue;
    const acc = account.get(p.accountId);
    const close = await closeOn(p.assetId);
    out.push({
      accountId: p.accountId,
      accountName: acc?.name ?? `#${p.accountId}`,
      accountKind: acc?.kind ?? "other",
      assetId: a.id,
      symbol: a.symbol,
      name: a.assetClass === "metal" ? tr("{name} (vaulted)", { name: displayName(a) }) : displayName(a),
      assetClass: a.assetClass as AssetClassKey,
      physical: false,
      quantity: p.quantity,
      unit: a.unit,
      priceEur: close?.price ?? null,
      priceDay: close?.day ?? null,
      valueEur: close ? p.quantity.mul(close.price) : D(0),
    });
  }

  // Physical metal, one row per storage location and metal.
  const physical = new Map<string, HoldingOn>();
  for (const it of items) {
    if (it.purchaseDate > day || (it.soldDate && it.soldDate <= day)) continue;
    const a = assetRows.find((x) => x.priceSource === "metal" && x.priceRef === METAL_CODES[it.metal]);
    if (!a) continue;
    const key = `${it.accountId}:${a.id}`;
    const acc = account.get(it.accountId);
    const fine = D(it.grossWeightG).mul(D(it.purity)).mul(it.quantity);
    const close = await closeOn(a.id);
    const row = physical.get(key) ?? {
      accountId: it.accountId,
      accountName: acc?.name ?? `#${it.accountId}`,
      accountKind: acc?.kind ?? "physical",
      assetId: a.id,
      symbol: a.symbol,
      name: tr("{name} (physical)", { name: displayName(a) }),
      assetClass: "metal" as const,
      physical: true,
      quantity: D(0),
      unit: "g",
      priceEur: close?.price ?? null,
      priceDay: close?.day ?? null,
      valueEur: D(0),
    };
    row.quantity = row.quantity.plus(fine);
    row.valueEur = close ? row.quantity.mul(close.price) : D(0);
    physical.set(key, row);
  }
  out.push(...physical.values());
  return out.sort((x, y) => x.accountName.localeCompare(y.accountName) || y.valueEur.cmp(x.valueEur));
}
