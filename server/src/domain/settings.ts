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
