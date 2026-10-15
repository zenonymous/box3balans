/**
 * Reads the text of a year statement (the jaaroverzicht of a bank, broker or platform, a PDF read in
 * the browser) into values per year. A template per provider and document says where each value is;
 * without one, amounts next to "1 januari", "31 december", "beginwaarde" and the like are offered to
 * choose from. Nothing here is saved: the user picks what goes into the table.
 */

/** The values per year a statement can fill (as in account_years; incomeEur is interest or dividend). */
export type YearField = "valueEur" | "inEur" | "outEur" | "incomeEur" | "costsEur";

export interface StatementPage {
  page: number;
  text: string;
}

export interface FoundValue {
  year: number;
  field: YearField;
  amount: string; // euros, "1234.56"
  page: number;
  line: string; // the line it came from
  sure: boolean; // from a template: ticked to begin with
}

export interface YearStatement {
  template: string | null; // what was recognised, e.g. "Brand New Day, financieel jaaroverzicht"
  year: number | null; // the year the statement is about
  found: FoundValue[];
}

export interface StatementTemplate {
  id: string;
  label: string;
  /** Texts that must all be in the statement. */
  detect: RegExp[];
  /** The year the statement is about, in the first group. */
  year: RegExp;
  /**
   * A value: the first amount after `label` on its line (or the `column`-th, from 0). `nextYear`: a
   * value at the end of the year, so the value on 1 January of the next.
   */
  fields: { field: YearField; label: RegExp; column?: number; nextYear?: boolean }[];
}

/**
 * Known statements. Each needs a text sample (`pdftotext -layout`, with names and amounts changed)
 * and a test; see docs/aanbieders.md.
 */
export const TEMPLATES: StatementTemplate[] = [];

// ---- Amounts ----

// An amount with cents: "€ 1.234,56", "1,234.56", "-12,50", "€ -0,99". Not part of a date (01.01.2025),
// a longer number or a percentage.
const AMOUNT =
  /(?<![\d.,])([-−]\s?)?(?:€\s?)?([-−]\s?)?(\d{1,3}(?:([.,])\d{3})*|\d+)([.,])(\d{2})(?![\d%]|[.,]\d|\s%)/g;

export interface Amount {
  value: string;
  index: number;
}

/** The amounts on a line, in euros with a point for the decimals. */
export function amounts(line: string): Amount[] {
  const out: Amount[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const [, sign1, sign2, int, thousands, decimal, cents] = m;
    // "1.234.56" or "1,234,56": the thousands separator can't also be the decimal one.
    if (thousands && thousands === decimal) continue;
    const negative = !!(sign1 || sign2);
    const value = `${negative ? "-" : ""}${int!.replace(/[.,]/g, "")}.${cents}`;
    out.push({ value: value.replace(/^(-?)0+(?=\d)/, "$1"), index: m.index });
  }
  return out;
}

// ---- Years ----

const MONTH_JAN = "(?:januari|january|jan\\.?)";
const MONTH_DEC = "(?:december|dec\\.?)";
// "1 januari 2025", "01-01-2025", "1 jan. 2025": a value of that year.
const FIRST_JANUARY = new RegExp(`\\b0?1[\\s-]*${MONTH_JAN}[\\s-]*(20\\d\\d)\\b|\\b01[-./]01[-./](20\\d\\d)\\b`, "i");
// "31 december 2024", "31-12-2024": the value of the year after.
const LAST_DECEMBER = new RegExp(`\\b31[\\s-]*${MONTH_DEC}[\\s-]*(20\\d\\d)\\b|\\b31[-./]12[-./](20\\d\\d)\\b`, "i");
// "1 januari t/m 31 december 2025": a year, not a day.
const JAN_DAY = new RegExp(`\\b0?1[\\s-]*${MONTH_JAN}(?![a-z])|\\b01[-./]01\\b`, "i");
const DEC_DAY = new RegExp(`\\b31[\\s-]*${MONTH_DEC}(?![a-z])|\\b31[-./]12\\b`, "i");
const STATEMENT_YEAR =
  /\b(?:jaaroverzicht|jaaropga(?:af|ve)|jaarafrekening|fiscaal overzicht|tax report|annual statement)\b[^\n\d]{0,20}(20\d\d)\b/i;

/** The year a statement is about: from its title, else the year it names most. */
export function statementYear(text: string): number | null {
  const titled = STATEMENT_YEAR.exec(text);
  if (titled) return Number(titled[1]);
  const counts = new Map<number, number>();
  for (const m of text.matchAll(/\b(20\d\d)\b/g)) counts.set(Number(m[1]), (counts.get(Number(m[1])) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  return ranked[0]?.[0] ?? null;
}

// ---- Without a template ----

// What a line is about, when it doesn't name a peildatum. Tax lines (withheld dividend tax) aren't income.
const BEGIN = /\b(begin(waarde|saldo|vermogen|stand)|openingssaldo|opening balance|starting balance)\b/i;
const END = /\b(eind(waarde|saldo|vermogen|stand)|slotsaldo|closing balance|ending balance)\b/i;
const INCOME = /\b(dividend(en|uitkering)?|rente|coupon(rente)?|interest)\b/i;
const TAX = /belasting|\btax\b|withholding/i;
// Crowdfunding: "geïnvesteerd" is money lent.
const IN = /\b(inleg|ingelegd|storting(en)?|gestort|ge[ïi]nvesteerd|deposits?|invested)\b/i;
const OUT = /\b(onttrekking(en)?|opname(n|s)?|opgenomen|withdrawals?)\b/i;
const COSTS = /\b(kosten|costs|fees?)\b/i;

const MAX_PER_LINE = 3;
const MAX_FOUND = 60;

const janYear = (m: RegExpExecArray) => Number(m[1] ?? m[2]);
const decYear = (m: RegExpExecArray) => Number(m[1] ?? m[2]) + 1;

function guess(pages: StatementPage[], year: number | null): FoundValue[] {
  const found: FoundValue[] = [];
  for (const { page, text } of pages) {
    // A table header naming both peildata ("1 januari 2025   31 december 2025"): the years of the
    // amount columns in the lines below it.
    let columns: number[] | null = null;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const values = amounts(line).slice(0, MAX_PER_LINE);
      const jan = FIRST_JANUARY.exec(line);
      const dec = LAST_DECEMBER.exec(line);
      if (!values.length) {
        if (jan && dec) columns = jan.index < dec.index ? [janYear(jan), decYear(dec)] : [decYear(dec), janYear(jan)];
        continue;
      }
      const push = (field: YearField, y: number | null, v: Amount) => {
        if (y != null) found.push({ year: y, field, amount: v.value, page, line, sure: false });
      };
      const add = (field: YearField, y: number | null) => values.forEach((v) => push(field, y, v));
      // The latest year a line names: "rente over 2025", "1 januari t/m 31 december 2025".
      const named = [...line.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]));
      const lineYear = named.length ? Math.max(...named) : year;
      const flow = (INCOME.test(line) && !TAX.test(line)) || IN.test(line) || OUT.test(line) || COSTS.test(line);
      const period = JAN_DAY.test(line) && DEC_DAY.test(line);

      if (jan && dec && values.length >= 2) {
        // "1 januari 2025  € 100   31 december 2025  € 120": each date with the amount after it.
        for (const [m, y] of [
          [jan, janYear(jan)],
          [dec, decYear(dec)],
        ] as const) {
          const v = values.find((x) => x.index > m.index);
          if (v) push("valueEur", y, v);
        }
      } else if (!period && jan) add("valueEur", janYear(jan));
      else if (!period && dec) add("valueEur", decYear(dec));
      // A value at the start or end of the statement's year, also "eindsaldo (incl. rente)".
      else if (BEGIN.test(line)) add("valueEur", year);
      else if (END.test(line)) add("valueEur", year == null ? null : year + 1);
      // Money earned, in or out, by what the line says, over its year.
      else if (INCOME.test(line) && !TAX.test(line)) add("incomeEur", lineYear);
      else if (IN.test(line)) add("inEur", lineYear);
      else if (OUT.test(line)) add("outEur", lineYear);
      else if (COSTS.test(line)) add("costsEur", lineYear);
      // A row under a header with both peildata: one amount per column.
      else if (columns && !flow && values.length === columns.length)
        values.forEach((v, i) => push("valueEur", columns![i]!, v));
      if (found.length >= MAX_FOUND) return found.slice(0, MAX_FOUND);
    }
  }
  return found;
}

// ---- With a template ----

function fill(t: StatementTemplate, pages: StatementPage[], year: number): FoundValue[] {
  const found: FoundValue[] = [];
  for (const f of t.fields) {
    for (const { page, text } of pages) {
      const line = text.split("\n").find((l) => f.label.test(l));
      if (!line) continue;
      const m = f.label.exec(line)!;
      const after = amounts(line).filter((a) => a.index >= m.index + m[0].length);
      const v = after[f.column ?? 0];
      if (v)
        found.push({
          year: f.nextYear ? year + 1 : year,
          field: f.field,
          amount: v.value,
          page,
          line: line.trim(),
          sure: true,
        });
      break;
    }
  }
  return found;
}

export function readYearStatement(pages: StatementPage[], templates: StatementTemplate[] = TEMPLATES): YearStatement {
  const all = pages.map((p) => p.text).join("\n");
  const template = templates.find((t) => t.detect.every((re) => re.test(all)));
  if (template) {
    const y = template.year.exec(all);
    const year = y ? Number(y[1]) : statementYear(all);
    if (year != null) {
      const found = fill(template, pages, year);
      // A template that finds nothing doesn't fit this version of the document: fall back.
      if (found.length) return { template: template.label, year, found };
    }
  }
  const year = statementYear(all);
  return { template: null, year, found: guess(pages, year) };
}
