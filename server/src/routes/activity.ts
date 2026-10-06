import type { FastifyInstance } from "fastify";
import { and, desc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { DB } from "../db/client.js";
import { accounts, assets, auditLog, imports, metalItems, syncIgnored, transactions } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";

type Snapshot = Record<string, unknown>;

const ENTITIES = [
  "transaction",
  "asset",
  "account",
  "account_years",
  "person",
  "metal_item",
  "import",
  "integration",
  "wallet_address",
] as const;
// Entities whose deletion can be undone from the history.
const RESTORABLE: Record<string, PgTable> = { transaction: transactions, metal_item: metalItems };

const listQuery = z.object({
  entity: z.enum(ENTITIES).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Bookkeeping fields that change with every edit and say nothing to the user.
const IGNORED = new Set(["updatedAt", "createdAt", "cursor", "lastResult", "lastSyncAt", "lastStatus", "id"]);

const TX_LABEL: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  dividend: "Dividend",
  reward: "Reward",
  fee: "Fee",
  split: "Split",
};

/** "10.000000000000000000" → "10"; other values as they are. */
function tidy(v: unknown): unknown {
  if (typeof v === "string" && /^-?\d+\.\d+$/.test(v)) return v.replace(/\.?0+$/, "");
  return v;
}

interface Names {
  account: Map<number, string>;
  asset: Map<number, string>;
}

function title(entity: string, s: Snapshot | null, names: Names, entityId: number): string {
  if (!s) return entity;
  const n = (v: unknown) => Number(v);
  switch (entity) {
    case "account_years":
      return `Values per year · ${names.account.get(entityId) ?? `account #${entityId}`}`;
    case "person":
      return `${s.name ?? "Person"} (${s.role === "self" ? "you" : (s.role ?? "")})`;
    case "transaction": {
      const asset = names.asset.get(n(s.assetId)) ?? `asset #${s.assetId}`;
      const account = names.account.get(n(s.accountId)) ?? `account #${s.accountId}`;
      const type = TX_LABEL[String(s.type)] ?? String(s.type ?? "Transaction");
      const qty = s.type === "dividend" ? "" : ` ${tidy(s.quantity) ?? ""}`;
      return `${type}${qty} ${asset} · ${account}`.replace(/\s+/g, " ");
    }
    case "asset":
      return [s.symbol, s.name].filter(Boolean).join(" · ") || "Asset";
    case "account":
      return String(s.name ?? "Account");
    case "metal_item":
      return `${s.quantity ?? 1}× ${s.product ?? "item"}`;
    case "metal_photo":
      return `Photo of ${s.product ?? "an item"}`;
    case "import":
      return String(s.fileName ?? "CSV import");
    case "integration":
      return `Connection ${s.provider ?? ""}`.trim();
    case "wallet_address": {
      const a = String(s.address ?? "");
      return `${s.chain ?? "Wallet"} ${a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a}`;
    }
    default:
      return entity;
  }
}

/** Values per year: which years and fields changed. */
function yearChanges(before: Snapshot, after: Snapshot) {
  const byYear = (s: Snapshot) => new Map(((s.rows as Snapshot[] | undefined) ?? []).map((r) => [Number(r.year), r]));
  const [b, a] = [byYear(before), byYear(after)];
  const out: { field: string; from: unknown; to: unknown }[] = [];
  for (const year of [...new Set([...b.keys(), ...a.keys()])].sort()) {
    const [from, to] = [b.get(year), a.get(year)];
    for (const field of ["valueEur", "inEur", "outEur", "incomeEur", "costsEur"]) {
      const [f, t] = [tidy(from?.[field]), tidy(to?.[field])];
      if (JSON.stringify(f) !== JSON.stringify(t))
        out.push({ field: `${year} ${field}`, from: f ?? null, to: t ?? null });
    }
  }
  return { fields: out, flags: [] };
}

/** Fields an update changed. `after` can be a partial patch (e.g. a transfer link). */
function changes(entity: string, before: Snapshot | null, after: Snapshot | null, names: Names) {
  if (!before || !after) return null;
  if (entity === "account_years") return yearChanges(before, after);
  const show = (field: string, v: unknown) => {
    if (v == null) return null;
    if (field === "assetId" || field === "settleAssetId") return names.asset.get(Number(v)) ?? `#${v}`;
    if (field === "accountId") return names.account.get(Number(v)) ?? `#${v}`;
    return tidy(v);
  };
  const out: { field: string; from: unknown; to: unknown }[] = [];
  for (const [field, to] of Object.entries(after)) {
    if (IGNORED.has(field) || !(field in before)) continue;
    const from = before[field];
    if (JSON.stringify(tidy(from)) === JSON.stringify(tidy(to))) continue;
    out.push({ field, from: show(field, from), to: show(field, to) });
  }
  // Notes about the change itself (e.g. { unlinked: true }) rather than field values.
  const flags = Object.keys(after).filter((k) => !(k in before) && !IGNORED.has(k));
  return { fields: out, flags };
}

async function loadNames(db: DB): Promise<Names> {
  const [accs, as] = await Promise.all([
    db.select({ id: accounts.id, name: accounts.name }).from(accounts),
    db.select({ id: assets.id, symbol: assets.symbol }).from(assets),
  ]);
  return { account: new Map(accs.map((a) => [a.id, a.name])), asset: new Map(as.map((a) => [a.id, a.symbol])) };
}

/** JSON snapshot → insertable row: ISO strings back to Dates, unknown columns dropped. */
function toRow(table: PgTable, s: Snapshot): Snapshot {
  const cols = getTableColumns(table);
  const out: Snapshot = {};
  for (const [k, col] of Object.entries(cols)) {
    if (!(k in s)) continue;
    const v = s[k];
    out[k] = col.columnType === "PgTimestamp" && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

export async function activityRoutes(app: FastifyInstance) {
  const { db, backfill } = app.deps;

  app.get("/", async (req) => {
    const q = listQuery.parse(req.query);
    const conds: SQL[] = [];
    if (q.entity) conds.push(eq(auditLog.entity, q.entity));
    if (q.entityId) conds.push(eq(auditLog.entityId, q.entityId));
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [count], names] = await Promise.all([
      db
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(where),
      loadNames(db),
    ]);

    // Deleted rows that are still gone can be restored.
    const gone = new Map<string, Set<number>>();
    for (const [entity, table] of Object.entries(RESTORABLE)) {
      const ids = rows.filter((r) => r.entity === entity && r.action === "delete").map((r) => r.entityId);
      if (!ids.length) continue;
      const idCol = getTableColumns(table).id!;
      const present = await db.select({ id: idCol }).from(table).where(inArray(idCol, ids));
      const have = new Set(present.map((p) => p.id as number));
      gone.set(entity, new Set(ids.filter((id) => !have.has(id))));
    }

    return {
      total: count?.n ?? 0,
      items: rows.map((r) => {
        const before = r.before as Snapshot | null;
        const after = r.after as Snapshot | null;
        // Name what it was when deleted, else what it became (a patch fills in from "before").
        const subject = r.action === "delete" ? before : { ...(before ?? {}), ...(after ?? {}) };
        return {
          id: r.id,
          at: r.at,
          entity: r.entity,
          entityId: r.entityId,
          action: r.action,
          title: title(r.entity, subject, names, r.entityId),
          via: (after?.via as string | undefined) ?? (after?.restoredFrom ? "restore" : undefined),
          changes: r.action === "update" ? changes(r.entity, before, after, names) : null,
          restorable: r.action === "delete" && (gone.get(r.entity)?.has(r.entityId) ?? false),
        };
      }),
    };
  });

  // Undo a deletion: puts the row back with its old id. Both legs of a transfer come back together.
  app.post("/:id/restore", async (req) => {
    const { id } = idParam.parse(req.params);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.id, id));
    if (!entry) throw notFound("History entry");
    const table = RESTORABLE[entry.entity];
    if (entry.action !== "delete" || !table || !entry.before) {
      throw new HttpError(400, "Only deleted transactions and metal items can be restored");
    }
    const snapshots = [entry.before as Snapshot];
    const group = (entry.before as Snapshot).transferGroup;
    if (entry.entity === "transaction" && typeof group === "string") {
      const legs = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entity, "transaction"),
            eq(auditLog.action, "delete"),
            sql`${auditLog.before}->>'transferGroup' = ${group}`,
          ),
        );
      for (const l of legs) if (l.id !== entry.id) snapshots.push(l.before as Snapshot);
    }

    const idCol = getTableColumns(table).id!;
    const ids = snapshots.map((s) => Number(s.id));
    const existing = await db.select({ id: idCol }).from(table).where(inArray(idCol, ids));
    if (existing.length === ids.length) throw new HttpError(409, "It's already there");
    const todo = snapshots.filter((s) => !existing.some((e) => e.id === Number(s.id)));

    // The account and asset must still exist; a vanished cash settlement or import is dropped.
    const accountIds = [...new Set(todo.map((s) => Number(s.accountId)))];
    const liveAccounts = await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, accountIds));
    if (liveAccounts.length !== accountIds.length) throw new HttpError(409, "Its account no longer exists");
    const assetIds = [
      ...new Set(todo.flatMap((s) => [s.assetId, s.settleAssetId].filter((v) => v != null).map(Number))),
    ];
    const liveAssets = new Set(
      assetIds.length
        ? (await db.select({ id: assets.id }).from(assets).where(inArray(assets.id, assetIds))).map((a) => a.id)
        : [],
    );
    if (todo.some((s) => s.assetId != null && !liveAssets.has(Number(s.assetId)))) {
      throw new HttpError(409, "Its asset no longer exists");
    }
    const importIds = todo.map((s) => s.importId).filter((v): v is number => typeof v === "number");
    const liveImports = new Set(
      importIds.length
        ? (await db.select({ id: imports.id }).from(imports).where(inArray(imports.id, importIds))).map((i) => i.id)
        : [],
    );

    const restored = await db.transaction(async (trx) => {
      const out = [];
      for (const s of todo) {
        const row = toRow(table, s);
        if (entry.entity === "transaction") {
          if (row.settleAssetId != null && !liveAssets.has(Number(row.settleAssetId))) row.settleAssetId = null;
          if (row.importId != null && !liveImports.has(Number(row.importId))) row.importId = null;
          row.updatedAt = new Date();
        }
        const [ins] = await trx
          .insert(table)
          .values(row as never)
          .returning();
        out.push(ins as Snapshot);
        // A synced row was remembered as deleted; forget that so syncs keep it.
        if (entry.entity === "transaction" && s.source !== "manual" && typeof s.externalId === "string") {
          await trx
            .delete(syncIgnored)
            .where(
              and(
                eq(syncIgnored.accountId, Number(s.accountId)),
                eq(syncIgnored.source, s.source as "csv"),
                eq(syncIgnored.externalId, s.externalId),
              ),
            );
        }
      }
      return out;
    });
    for (const r of restored)
      await audit(db, entry.entity, Number(r.id), "create", null, { ...r, restoredFrom: entry.id });
    backfill.request();
    return { ok: true, restored: restored.length };
  });
}
