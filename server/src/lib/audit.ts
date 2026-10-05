import type { DB } from "../db/client.js";
import { auditLog } from "../db/schema.js";

export async function audit(
  db: DB,
  entity: string,
  entityId: number,
  action: "create" | "update" | "delete",
  before: unknown,
  after: unknown,
) {
  await db.insert(auditLog).values({ entity, entityId, action, before: before ?? null, after: after ?? null });
}
