import { and, eq, inArray, like, type SQL } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { transactions } from "../db/schema.js";

/**
 * Deletes an account's synced transactions (optionally only those whose external id starts with
 * `idPrefix`) and turns the other leg of any auto-matched transfer back into a plain
 * deposit/withdrawal, so nothing dangles. Returns the number of rows deleted.
 */
export async function purgeSynced(
  db: DB,
  accountId: number,
  source: "api" | "chain" | "csv",
  idPrefix?: string,
): Promise<number> {
  const conds: SQL[] = [eq(transactions.accountId, accountId), eq(transactions.source, source)];
  if (idPrefix) conds.push(like(transactions.externalId, `${idPrefix.replace(/[%_\\]/g, "\\$&")}%`));
  return db.transaction(async (trx) => {
    const synced = await trx
      .select({ id: transactions.id, group: transactions.transferGroup })
      .from(transactions)
      .where(and(...conds));
    const ids = new Set(synced.map((s) => s.id));
    const groups = synced.map((s) => s.group).filter((g): g is string => !!g);
    if (groups.length) {
      const legs = await trx.select().from(transactions).where(inArray(transactions.transferGroup, groups));
      for (const o of legs) {
        if (ids.has(o.id)) continue;
        await trx
          .update(transactions)
          .set({
            type: o.type === "transfer_in" ? "deposit" : "withdrawal",
            transferGroup: null,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, o.id));
      }
    }
    const list = [...ids];
    for (let i = 0; i < list.length; i += 500) {
      await trx.delete(transactions).where(inArray(transactions.id, list.slice(i, i + 500)));
    }
    return list.length;
  });
}
