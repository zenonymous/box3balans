import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.js";
import { accounts, imports, settings, transactions } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import {
  FIELDS,
  type Mapping,
  TEMPLATE_CSV,
  guessColumns,
  headerSignature,
  isTemplate,
  knownType,
  mappingSchema,
} from "../import/mapping.js";
import { detectDelimiter, parseCsv } from "../import/parse.js";
import { commitImport, planImport, readTable } from "../import/plan.js";
import { matchTransfers } from "../sync/transfers.js";
import { recognise } from "../import/formats/index.js";
import { tr } from "../i18n/index.js";

const PRESETS_KEY = "csv_import_presets";
// CSV exports of a few years are well under this; the limit keeps a wrong file from eating memory.
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const UPLOAD_TTL_MS = 2 * 3_600_000;

interface Preset {
  name: string;
  signature: string;
  mapping: Mapping;
}

async function getPresets(db: DB): Promise<Preset[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, PRESETS_KEY));
  return Array.isArray(row?.value) ? (row.value as Preset[]) : [];
}

async function savePresets(db: DB, presets: Preset[]) {
  await db
    .insert(settings)
    .values({ key: PRESETS_KEY, value: presets })
    .onConflictDoUpdate({ target: settings.key, set: { value: presets } });
}

/** Rows before the real header: title lines with fewer cells than the table itself. */
function guessSkipRows(content: string): number {
  const rows = parseCsv(content.slice(0, 200_000), detectDelimiter(content)).slice(0, 60);
  const widths = rows.map((r) => r.filter((c) => c !== "").length);
  const widest = Math.max(0, ...widths);
  const i = widths.findIndex((w) => w >= Math.max(2, widest * 0.6));
  return Math.max(0, Math.min(i, 50));
}

/** The mapping for a file in the Kluishuis template. */
function templateMapping(skipRows = 0, extra: Partial<Mapping> = {}): Mapping {
  const columns = Object.fromEntries(FIELDS.map((f, i) => [f, i])) as Mapping["columns"];
  return mappingSchema.parse({ skipRows, columns, typeMode: "column", decimal: ".", dateOrder: "YMD", ...extra });
}

/** A starting mapping for a new file: a saved preset, the template, or a guess from the headers. */
async function initialMapping(db: DB, content: string): Promise<{ mapping: Mapping; preset: string | null }> {
  const skipRows = guessSkipRows(content);
  const base = mappingSchema.parse({ skipRows });
  const { headers, data } = readTable(content, base);
  const preset = (await getPresets(db)).find((p) => p.signature === headerSignature(headers));
  if (preset) return { mapping: mappingSchema.parse(preset.mapping), preset: preset.name };
  if (isTemplate(headers)) return { mapping: templateMapping(skipRows), preset: tr("Kluishuis template") };
  const columns = guessColumns(headers);
  const negatives = columns.quantity != null && data.some((r) => /^\s*[-(\u2212]/.test(r[columns.quantity!] ?? ""));
  const typeMode = columns.type != null ? "column" : negatives ? "sign" : "fixed";
  const typeValues: Record<string, string> = {};
  if (columns.type != null) {
    for (const r of data) {
      const v = (r[columns.type] ?? "").trim();
      const t = knownType(v);
      if (t) typeValues[v] = t;
    }
  }
  return { mapping: mappingSchema.parse({ skipRows, columns, typeMode, typeValues }), preset: null };
}

const uploadBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(MAX_FILE_BYTES),
  // Read the file as it is, even when it's a known export.
  raw: z.boolean().optional(),
});
const planBody = z.object({
  uploadId: z.string().uuid(),
  accountId: z.number().int().positive(),
  mapping: mappingSchema,
});
const commitBody = planBody.extend({ include: z.array(z.number().int().positive()).max(100_000).default([]) });
const presetBody = z.object({
  name: z.string().trim().min(1).max(60),
  headers: z.array(z.string().max(500)).max(500),
  mapping: mappingSchema,
});

export async function importRoutes(app: FastifyInstance) {
  const { db, prices, backfill } = app.deps;
  const deps = { db, fetchFn: prices.fetchFn, fx: prices.fx };

  // Uploaded files wait here between preview and import (single user, so a small map will do).
  // A recognised export is kept converted to the template, with notes on what was left out.
  const uploads = new Map<string, { fileName: string; content: string; notes: string[]; at: number }>();
  const upload = (id: string) => {
    for (const [k, v] of uploads) if (Date.now() - v.at > UPLOAD_TTL_MS) uploads.delete(k);
    const u = uploads.get(id);
    if (!u) throw new HttpError(410, tr("The uploaded file has expired; choose it again"));
    u.at = Date.now();
    return u;
  };

  app.get("/import/template.csv", async (_req, reply) => {
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="kluishuis-import-template.csv"');
    return TEMPLATE_CSV + "\r\n";
  });

  app.post("/import/upload", { bodyLimit: MAX_FILE_BYTES * 2 }, async (req) => {
    const { fileName, content, raw } = uploadBody.parse(req.body);
    if (content.includes("\u0000")) throw new HttpError(400, tr("That isn't a CSV text file"));
    const id = randomUUID();
    const known = raw ? null : recognise(content);
    const keep = (c: string, notes: string[]) => {
      uploads.set(id, { fileName, content: c, notes, at: Date.now() });
      while (uploads.size > 5) uploads.delete(uploads.keys().next().value!);
    };
    if (known) {
      keep(known.content, known.notes);
      return {
        uploadId: id,
        fileName,
        mapping: templateMapping(0, known.result.mapping),
        preset: tr(known.format.label),
        format: { id: known.format.id, label: tr(known.format.label), rows: known.result.rows.length },
      };
    }
    keep(content, []);
    return { uploadId: id, fileName, format: null, ...(await initialMapping(db, content)) };
  });

  app.post("/import/preview", async (req) => {
    const b = planBody.parse(req.body);
    const u = upload(b.uploadId);
    try {
      const plan = await planImport(deps, u.content, b.accountId, b.mapping);
      return { ...plan, warnings: [...u.notes, ...plan.warnings] };
    } catch (err) {
      if ((err as Error).message === "Unknown account") throw new HttpError(400, tr("Unknown account"));
      throw err;
    }
  });

  app.post("/import/commit", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const b = commitBody.parse(req.body);
    const u = upload(b.uploadId);
    const result = await commitImport(deps, u.content, u.fileName, b.accountId, b.mapping, b.include);
    if (result.importId) {
      await audit(db, "import", result.importId, "create", null, {
        accountId: b.accountId,
        fileName: u.fileName,
        inserted: result.inserted,
      });
    }
    const transfersMatched = result.inserted ? await matchTransfers(db) : 0;
    if (result.createdAssetIds.length) await prices.refreshAll(result.createdAssetIds).catch(() => undefined);
    backfill.request();
    uploads.delete(b.uploadId);
    return { ...result, transfersMatched };
  });

  app.get("/import/presets", async () => (await getPresets(db)).map(({ name, signature }) => ({ name, signature })));

  app.post("/import/presets", async (req) => {
    const p = presetBody.parse(req.body);
    const presets = (await getPresets(db)).filter((x) => x.name !== p.name);
    presets.push({ name: p.name, signature: headerSignature(p.headers), mapping: p.mapping });
    await savePresets(db, presets.slice(-50));
    return { ok: true };
  });

  app.delete("/import/presets/:name", async (req) => {
    const { name } = z.object({ name: z.string().min(1).max(60) }).parse(req.params);
    await savePresets(
      db,
      (await getPresets(db)).filter((x) => x.name !== name),
    );
    return { ok: true };
  });

  app.get("/imports", async () => {
    const rows = await db
      .select({
        id: imports.id,
        accountId: imports.accountId,
        accountName: accounts.name,
        fileName: imports.fileName,
        rows: imports.rows,
        inserted: imports.inserted,
        createdAt: imports.createdAt,
        // Transactions still there (some may have been deleted one by one since).
        remaining: sql<number>`(select count(*)::int from ${transactions} where ${transactions.importId} = ${imports.id})`,
      })
      .from(imports)
      .innerJoin(accounts, eq(accounts.id, imports.accountId))
      .orderBy(desc(imports.createdAt));
    return rows;
  });

  // Undo: deletes the import's transactions. Exchange or wallet rows that were linked to them as a
  // transfer become a plain deposit or withdrawal again (and can be linked anew later).
  app.delete("/imports/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [imp] = await db.select().from(imports).where(eq(imports.id, id));
    if (!imp) throw notFound(tr("Import"));
    const rows = await db.select().from(transactions).where(eq(transactions.importId, id));
    const groups = [...new Set(rows.map((r) => r.transferGroup).filter((g): g is string => !!g))];
    const partners = groups.length
      ? (await db.select().from(transactions).where(inArray(transactions.transferGroup, groups))).filter(
          (t) => t.importId !== id,
        )
      : [];
    await db.transaction(async (trx) => {
      for (const p of partners) {
        await trx
          .update(transactions)
          .set({
            type: p.type === "transfer_in" ? "deposit" : "withdrawal",
            transferGroup: null,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, p.id));
      }
      await trx.delete(transactions).where(eq(transactions.importId, id));
      await trx.delete(imports).where(eq(imports.id, id));
    });
    for (const p of partners) await audit(db, "transaction", p.id, "update", p, { transferUndoneByImport: id });
    await audit(db, "import", id, "delete", { ...imp, transactions: rows.length }, null);
    if (partners.length) await matchTransfers(db);
    backfill.request();
    return { ok: true, deleted: rows.length, unlinked: partners.length };
  });
}
