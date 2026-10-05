import { and, eq } from "drizzle-orm";
import type { DB } from "./client.js";
import { assets } from "./schema.js";

// Reference assets every installation needs. Metals are tracked per gram and priced from spot.
const builtins = [
  { assetClass: "metal", name: "Gold", symbol: "XAU", priceSource: "metal", priceRef: "XAU", unit: "g" },
  { assetClass: "metal", name: "Silver", symbol: "XAG", priceSource: "metal", priceRef: "XAG", unit: "g" },
  { assetClass: "metal", name: "Platinum", symbol: "XPT", priceSource: "metal", priceRef: "XPT", unit: "g" },
  { assetClass: "metal", name: "Palladium", symbol: "XPD", priceSource: "metal", priceRef: "XPD", unit: "g" },
  { assetClass: "cash", name: "Euro", symbol: "EUR", priceSource: "fx", priceRef: "EUR", unit: "EUR" },
] as const;

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
