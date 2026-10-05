import { fromLocal } from "../lib/time.js";

export type Delimiter = "," | ";" | "\t" | "|";
export type DecimalMark = "." | ",";
export type DateOrder = "YMD" | "DMY" | "MDY";

const DELIMITERS: Delimiter[] = [",", ";", "\t", "|"];

/** RFC 4180 CSV: quoted fields may contain delimiters, quotes ("") and line breaks. */
export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // byte order mark
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines; trim cells.
  return rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some((v) => v !== ""));
}

/** The delimiter that splits the first lines into the most, and most consistent, columns. */
export function detectDelimiter(text: string): Delimiter {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 20);
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = parseCsv(lines.join("\n"), d).map((r) => r.length);
    if (!counts.length) continue;
    const mode = mostCommon(counts);
    if (mode < 2) continue;
    const consistency = counts.filter((n) => n === mode).length / counts.length;
    const score = consistency * 100 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function mostCommon(xs: number[]): number {
  const n = new Map<number, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
}

/**
 * Parses a number as written in an export: "1.234,56" or "1,234.56" (per `decimal`), with
 * optional currency symbols, spaces, a leading or trailing minus or parentheses for negatives.
 * Returns an exact decimal string (no float rounding, so 18-decimal token amounts survive), or
 * null for an empty or unreadable cell.
 */
export function parseNumber(raw: string, decimal: DecimalMark): string | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s\u00a0\u202f']/g, "").replace(/[€$£¥]|EUR|USD|GBP|CHF/gi, "");
  if (s.startsWith("-") || s.startsWith("\u2212")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  const thousands = decimal === "," ? "." : ",";
  s = s.split(thousands).join("");
  if (decimal === ",") s = s.replace(",", ".");
  if (/^\d*\.?\d+e[-+]?\d+$/i.test(s)) {
    // Scientific notation ("1E-8") from spreadsheet exports.
    const v = Number(s);
    if (!Number.isFinite(v)) return null;
    s = v.toFixed(20).replace(/\.?0+$/, "");
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  if (s.startsWith(".")) s = `0${s}`;
  return negative && /[1-9]/.test(s) ? `-${s}` : s;
}

/**
 * Guesses the decimal mark from sample values. "1.234,56" and "0,5" mean comma; "1,234.56" and
 * "0.5" mean dot. Values like "1.234" or "1,234" are ambiguous and don't count.
 */
export function detectDecimal(values: string[]): DecimalMark {
  let comma = 0;
  let dot = 0;
  for (const raw of values) {
    const v = raw.replace(/[^\d.,-]/g, "");
    if (/\d,\d{1,2}$|\d,\d{4,}$|^-?0,\d/.test(v) || /\.\d{3},\d/.test(v)) comma++;
    else if (/\d\.\d{1,2}$|\d\.\d{4,}$|^-?0\.\d/.test(v) || /,\d{3}\.\d/.test(v)) dot++;
  }
  return comma > dot ? "," : ".";
}

const DATE_RE = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const ISO_ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** Day order of numeric dates in sample values; DMY when nothing says otherwise. */
export function detectDateOrder(values: string[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = DATE_RE.exec(v.trim());
    if (!m) continue;
    if (m[1]!.length === 4) return "YMD";
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) dmy++;
    else if (b > 12) mdy++;
  }
  return mdy > dmy ? "MDY" : "DMY";
}

/**
 * Parses a date (and optional time, from the same cell or `timeRaw`). Times without a zone are
 * local time in the configured time zone; a date without time becomes 12:00 local, so it stays
 * on the same calendar day in any zone. ISO timestamps with a zone (…Z, +02:00) are taken as is.
 */
export function parseDate(raw: string, order: DateOrder, timeRaw?: string): Date | null {
  const s = raw.trim();
  if (ISO_ZONED.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [a, b, c] = [m[1]!, m[2]!, m[3]!];
  let y: number, mo: number, d: number;
  if (a.length === 4) [y, mo, d] = [+a, +b, +c];
  else if (c.length === 4 || c.length === 2) {
    const year = c.length === 2 ? 2000 + Number(c) : Number(c);
    [y, mo, d] = order === "MDY" ? [year, +a, +b] : [year, +b, +a];
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  let h = 12;
  let mi = 0;
  let sec = 0;
  const t = m[4] ? [m[4], m[5], m[6]] : timeRaw ? TIME_RE.exec(timeRaw.trim())?.slice(1) : undefined;
  if (t) {
    h = Number(t[0]);
    mi = Number(t[1]);
    sec = Number(t[2] ?? 0);
  }
  const date = fromLocal(y, mo, d, h, mi, sec);
  // Reject overflowed dates such as 31-02.
  return Number.isNaN(date.getTime()) || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d ? null : date;
}
