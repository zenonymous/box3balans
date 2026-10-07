import { and, eq } from "drizzle-orm";
import type { DB } from "./client.js";
import { assets } from "./schema.js";
import { msg, tr } from "../i18n/index.js";

// Reference assets every installation needs. Metals are tracked per gram and priced from spot.
const builtins = [
  { assetClass: "metal", name: msg("Gold"), symbol: "XAU", priceSource: "metal", priceRef: "XAU", unit: "g" },
  { assetClass: "metal", name: msg("Silver"), symbol: "XAG", priceSource: "metal", priceRef: "XAG", unit: "g" },
  { assetClass: "metal", name: msg("Platinum"), symbol: "XPT", priceSource: "metal", priceRef: "XPT", unit: "g" },
  { assetClass: "metal", name: msg("Palladium"), symbol: "XPD", priceSource: "metal", priceRef: "XPD", unit: "g" },
  { assetClass: "cash", name: msg("Euro"), symbol: "EUR", priceSource: "fx", priceRef: "EUR", unit: "EUR" },
] as const;

/** The name to show for an asset: built-in ones (stored in English) in the app's language. */
export function displayName(a: { name: string; priceSource: string; priceRef: string | null }): string {
  const builtin = builtins.some(
    (b) => b.priceSource === a.priceSource && b.priceRef === a.priceRef && b.name === a.name,
  );
  return builtin ? tr(a.name) : a.name;
}

export async function seed(db: DB): Promise<void> {
  for (const a of builtins) {
    const existing = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.priceSource, a.priceSource), eq(assets.priceRef, a.priceRef)));
    if (existing.length === 0) {
      await db.insert(assets).values({ ...a, currency: "EUR" });
    }
  }
}

export const METAL_CODES = { gold: "XAU", silver: "XAG", platinum: "XPT", palladium: "XPD" } as const;

/** One of the reference assets every installation has (metals, the euro). */
export const isBuiltin = (a: { priceSource: string; priceRef: string | null }) =>
  builtins.some((b) => b.priceSource === a.priceSource && b.priceRef === a.priceRef);
