import type { CsvType } from "../mapping.js";
import { TEMPLATE_HEADERS } from "../mapping.js";
import { parseNumber, type DecimalMark } from "../parse.js";

/**
 * One transaction in Box3balans's own CSV template (see TEMPLATE_HEADERS). A broker format turns its
 * export into these rows, so the rest of the import (preview, duplicates, assets, undo) is shared.
 */
export interface TemplateRow {
  /** YYYY-MM-DD in local time (with `time`), or an ISO timestamp with a zone. */
  date: string;
  time?: string;
  type: CsvType;
  symbol?: string;
  isin?: string;
  name?: string;
  assetType?: "stock" | "etf" | "crypto" | "metal" | "cash";
  quantity?: string;
  price?: string;
  total?: string;
  currency?: string;
  fee?: string;
  amount?: string;
  tax?: string;
  notes?: string;
  /** The export's own id, so importing the file again finds the same rows. */
  id?: string;
}

export interface Converted {
  rows: TemplateRow[];
  /** Lines left out on purpose, counted per reason (shown with the preview). */
  skipped: Map<string, number>;
  warnings: string[];
  /** Mapping settings that differ from the template's. */
  mapping?: { feeCurrency?: "trade" | "EUR"; settleCash?: boolean };
}

export interface BrokerFormat {
  id: string;
  /** Shown as "Recognised as …"; marked with msg() and translated when shown. */
  label: string;
  /** True when `headers` is this format's header row. */
  detect(headers: string[]): boolean;
  /** `table[0]` is the header row. */
  convert(table: string[][]): Converted;
}

/** Lower case, accents and punctuation folded: "Transactiekosten en/of" → "transactiekosten en of". */
export const norm = (h: string) =>
  h
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Index of the first header matching one of `names` (normalised), or -1. */
export function column(headers: string[], ...names: string[]): number {
  const n = headers.map(norm);
  for (const name of names) {
    const i = n.indexOf(norm(name));
    if (i >= 0) return i;
  }
  return -1;
}

/** Index of the first header starting with one of `prefixes` (normalised), or -1. */
export function columnStarting(headers: string[], ...prefixes: string[]): number {
  const n = headers.map(norm);
  return n.findIndex((h) => prefixes.some((p) => h.startsWith(norm(p))));
}

/** True when every name is among the headers. */
export const hasColumns = (headers: string[], ...names: string[]) => names.every((n) => column(headers, n) >= 0);

/** A number from the export as a plain decimal string ("1.234,5" → "1234.5" with a decimal comma). */
export function num(raw: string | undefined, decimal: DecimalMark): string | null {
  return raw == null ? null : parseNumber(raw, decimal);
}

/**
 * A number whose decimal mark isn't known up front: with both marks the last one is the decimal,
 * with only a comma it's the decimal ("10,799"), with only dots they're decimals ("0.2989").
 */
export function looseNum(raw: string | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  return parseNumber(s, comma > dot ? "," : ".");
}

/** Absolute value of a decimal string. */
export const abs = (v: string | null) => (v == null ? null : v.replace(/^-/, ""));
export const isNegative = (v: string | null) => v != null && v.startsWith("-") && /[1-9]/.test(v);

/** Prices in pence (GBX, GBp) become pounds: the asset is priced in GBP. */
export function pounds(price: string | null, currency: string): { price: string | null; currency: string } {
  if (currency === "GBX" || currency === "GBp") {
    return { price: price == null ? null : (Number(price) / 100).toString(), currency: "GBP" };
  }
  return { price, currency: currency.toUpperCase() };
}

/** Counts a skipped line under `reason`. */
export function skip(skipped: Map<string, number>, reason: string) {
  skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
}

const FIAT = new Set(["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF"]);
export const isFiatCode = (c: string) => FIAT.has(c.toUpperCase());

/** "02-Apr-2025" / "2 Apr 2025" → "2025-04-02". */
export function monthNameDate(raw: string): string | null {
  const m = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const dutch: Record<string, number> = { mei: 4, okt: 9, mrt: 2, maa: 2 };
  const key = m[2]!.toLowerCase();
  const i = months.indexOf(key) >= 0 ? months.indexOf(key) : (dutch[key] ?? -1);
  if (i < 0) return null;
  return `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

/** "19-12-2022" → "2022-12-19"; ISO dates stay as they are. */
export function dmy(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
}

/** A UTC timestamp ("2025-01-17 16:57:02 UTC", "2024-01-02 10:11:12") as ISO with a zone. */
export function utc(raw: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)/.exec(raw.trim());
  if (!m) return null;
  const time = m[2]!.length === 5 ? `${m[2]}:00` : m[2]!.padStart(8, "0");
  return `${m[1]}T${time}Z`;
}

const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The rows as a Box3balans template CSV. */
export function templateCsv(rows: TemplateRow[]): string {
  const lines = [TEMPLATE_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.time ?? "",
        r.type,
        r.symbol ?? "",
        r.isin ?? "",
        r.name ?? "",
        r.assetType ?? "",
        r.quantity ?? "",
        r.price ?? "",
        r.total ?? "",
        r.currency ?? "",
        r.fee ?? "",
        r.amount ?? "",
        r.tax ?? "",
        r.notes ?? "",
        r.id ?? "",
      ]
        .map(quote)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** A new result to fill. */
export const converted = (mapping?: Converted["mapping"]): Converted => ({
  rows: [],
  skipped: new Map(),
  warnings: [],
  mapping,
});
