import { z } from "zod";
import { accountKind } from "../../db/schema.js";
import { str } from "../../lib/decimal.js";
import { localDateTime } from "../../lib/time.js";
import { CSV_TYPES, type Mapping, mappingSchema } from "../mapping.js";
import { detectDelimiter, parseCsv } from "../parse.js";
import { readWithMapping } from "../plan.js";
import { norm } from "./types.js";

/**
 * Formats shared by users (ADR 0012): an export Box3balans has no reader of its own for, described as
 * data instead of code. A shared format is the column mapping someone set up for their file, with a
 * made-up sample in the same layout and what Box3balans reads from it (see contribute.ts). The app
 * uses it like a saved preset, after its own formats and the user's presets, for files whose header
 * row starts with the format's. Being data, a format from a stranger can't run anything; the test
 * (test/shared-formats.test.ts) checks that each one reads its own sample as it says.
 */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

/** What one data line of the sample becomes. */
const expectedRow = z
  .object({
    line: z.number().int().positive(),
    status: z.enum(["ok", "skipped", "error"]),
    // Local wall-clock time ("2025-01-06 12:00:00"), or an ISO instant when the file gives a zone.
    date: z.string().max(40).optional(),
    type: z.enum(CSV_TYPES).optional(),
    asset: z.string().max(200).optional(),
    quantity: decimalString.optional(),
    price: decimalString.optional(),
    currency: z.string().max(5).optional(),
    fee: decimalString.optional(),
    amount: decimalString.optional(),
    tax: decimalString.optional(),
  })
  .strict();
export type ExpectedRow = z.infer<typeof expectedRow>;

// The mapping without what only makes sense in one database (the assets a user picked).
const sharedMapping = mappingSchema
  .omit({ assetOverrides: true })
  .extend({ typeValues: z.record(z.string().max(200), z.enum([...CSV_TYPES, "skip"])).default({}) })
  .strict();

export const sharedFormatSchema = z
  .object({
    box3balans: z.literal("csv-format"),
    version: z.literal(1),
    id: z
      .string()
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    provider: z.string().trim().min(1).max(60),
    // Where in the provider's app or website the export is made.
    export: z.string().trim().max(300).default(""),
    // The kind of account the sample was read for.
    account: z.enum(accountKind.enumValues),
    // The header row, in order. A file matches when its header row starts with these.
    headers: z.array(z.string().max(200)).min(1).max(200),
    mapping: sharedMapping,
    sample: z.string().max(100_000),
    expected: z.array(expectedRow).max(500),
    // The Box3balans version that made the file.
    app: z.string().max(40).optional(),
  })
  .strict()
  .refine((f) => f.headers.filter((h) => norm(h)).length >= 3, "A shared format needs at least three named columns")
  .refine(
    (f) => Object.values(f.mapping.columns).every((c) => c == null || c < f.headers.length),
    "A column of the mapping is beyond the header row",
  );
export type SharedFormat = z.infer<typeof sharedFormatSchema>;

// One entry per file in shared/, in the order they're tried:
//   import example from "./shared/example.json" with { type: "json" };
//   …and `"example.json": example,` below. The test checks that every file is listed.
const FILES: Record<string, unknown> = {};

export const SHARED_FILES = Object.keys(FILES);
export const SHARED_FORMATS: SharedFormat[] = Object.values(FILES).map((f) => sharedFormatSchema.parse(f));

/** True when the file's header row starts with the format's: same names, same order. */
const startsWith = (row: string[], headers: string[]) =>
  row.length >= headers.length && headers.every((h, i) => norm(row[i] ?? "") === norm(h));

/**
 * The shared format for a file, with its mapping set to where the file's header row is (title lines
 * before it may differ in number). Null when none fits.
 */
export function matchShared(
  content: string,
  formats: SharedFormat[] = SHARED_FORMATS,
): { format: SharedFormat; mapping: Mapping } | null {
  if (!formats.length) return null;
  // The header row is near the top; the rest of the file doesn't matter here.
  const text = content.replace(/^\uFEFF/, "").slice(0, 256 * 1024);
  const tables = new Map<string, string[][]>();
  for (const format of formats) {
    const delimiter = format.mapping.delimiter ?? detectDelimiter(text);
    if (!tables.has(delimiter)) tables.set(delimiter, parseCsv(text, delimiter).slice(0, 16));
    const at = tables.get(delimiter)!.findIndex((row) => startsWith(row, format.headers));
    if (at >= 0) return { format, mapping: mappingSchema.parse({ ...format.mapping, skipRows: at }) };
  }
  return null;
}

// A date with its own zone ("2025-01-06T10:00:00Z") reads the same in any time zone; one without is
// compared on the wall clock, so a format's sample reads the same wherever the test runs.
const ZONED = /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/;

/** What Box3balans reads from `content` with the mapping: one entry per data line, in order. */
export function readExpected(content: string, mapping: Mapping, account: string): ExpectedRow[] {
  const r = readWithMapping(content, mapping, account);
  const dateCell = (line: number) => {
    const c = mapping.columns.date;
    return c == null ? "" : (r.data[line - mapping.skipRows - 2]?.[c] ?? "").trim();
  };
  const rows: ExpectedRow[] = [
    ...r.rejected.map((x) => ({
      line: x.line,
      status: x.status === "skipped" ? ("skipped" as const) : ("error" as const),
    })),
    ...r.parsed.map((p) => ({
      line: p.line,
      status: "ok" as const,
      date: ZONED.test(dateCell(p.line)) ? p.at.toISOString() : localDateTime(p.at),
      type: p.type,
      asset: p.key,
      ...(p.type === "dividend" ? {} : { quantity: str(p.quantity) }),
      ...(p.price ? { price: str(p.price) } : {}),
      currency: p.currency,
      ...(p.fee.isZero() ? {} : { fee: str(p.fee) }),
      ...(p.amount.isZero() ? {} : { amount: str(p.amount) }),
      ...(p.tax.isZero() ? {} : { tax: str(p.tax) }),
    })),
  ];
  return rows.sort((a, b) => a.line - b.line);
}
