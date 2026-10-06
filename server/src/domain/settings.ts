import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { settings } from "../db/schema.js";
import type { CostMethod } from "./ledger.js";

export const COST_METHOD_KEY = "cost_basis_method";

/** Cost-basis method for realized/unrealized P&L. Average cost unless the user picked FIFO. */
export async function getCostMethod(db: DB): Promise<CostMethod> {
  const [row] = await db.select().from(settings).where(eq(settings.key, COST_METHOD_KEY));
  return row?.value === "fifo" ? "fifo" : "average";
}

export async function setCostMethod(db: DB, method: CostMethod): Promise<void> {
  await db
    .insert(settings)
    .values({ key: COST_METHOD_KEY, value: method })
    .onConflictDoUpdate({ target: settings.key, set: { value: method } });
}

export type Language = "nl" | "en";
export const LANGUAGE_KEY = "language";
let cachedLanguage: Language | null = null;

/** The app's language (Dutch unless set to English); server messages use it too. */
export async function getLanguage(db: DB): Promise<Language> {
  if (cachedLanguage) return cachedLanguage;
  const [row] = await db.select().from(settings).where(eq(settings.key, LANGUAGE_KEY));
  cachedLanguage = row?.value === "en" ? "en" : "nl";
  return cachedLanguage;
}

export async function setLanguage(db: DB, language: Language): Promise<void> {
  await db
    .insert(settings)
    .values({ key: LANGUAGE_KEY, value: language })
    .onConflictDoUpdate({ target: settings.key, set: { value: language } });
  cachedLanguage = language;
}

/** After a restore the stored language may differ. */
export const forgetLanguage = () => {
  cachedLanguage = null;
};
