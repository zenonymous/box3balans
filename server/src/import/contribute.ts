import { randomInt } from "node:crypto";
import type { DB } from "../db/client.js";
import { persons, users } from "../db/schema.js";
import { tr } from "../i18n/index.js";
import { D, type Decimal } from "../lib/decimal.js";
import { HttpError } from "../lib/errors.js";
import { isFiat } from "../sync/assets.js";
import { type SharedFormat, readExpected, sharedFormatSchema } from "./formats/shared.js";
import { norm } from "./formats/types.js";
import { FIELDS, type Field, type Mapping, knownType, mappingSchema } from "./mapping.js";
import { type DateOrder, type DecimalMark, detectDelimiter, parseCsv, parseDate, parseNumber } from "./parse.js";
import { ASSET_TYPES, KIND_BY_ACCOUNT, METALS, detectNotation } from "./plan.js";
import type { StatementPage, YearField } from "./yearStatement.js";

/**
 * Sharing a format without sharing your data (ADR 0012). From a file the user has set up an import
 * for, this makes a file anyone may see: the format (the column mapping, or for a PDF the lines the
 * user picked) with a made-up sample in the same layout. Nothing is sent anywhere: the user downloads
 * the file and shares it themselves.
 *
 * Only an allowlist of the original stays: the header row, the words in the type column, currency
 * codes, asset-type and metal words, month names (and for a PDF: common statement words and the words
 * of the lines the user picked). Each is listed for the user, who can replace any of them. Everything
 * else is made up in the same shape: dates (in the same order), amounts (other values, same notation),
 * ISINs and symbols (well-known funds and coins), IDs, and text. A kept value that looks like a name
 * of the household, an IBAN, an e-mail address, a phone number or a BSN is replaced as well. A last
 * check looks for any word or number of the original outside the allowlist, and starts again with
 * other made-up values if one turns up by chance.
 */

// ---- Made-up values ----

/** A small seeded generator (mulberry32): the same seed makes the same file, for tests. */
function generator(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** A whole number from lo to hi, both included. */
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return { int, pick: <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)]! };
}
type Rng = ReturnType<typeof generator>;

// Public funds, shares and coins for the assets of a sample.
const SECURITIES = [
  { isin: "IE00B4L5Y983", symbol: "IWDA", name: "iShares Core MSCI World UCITS ETF" },
  { isin: "IE00B3RBWM25", symbol: "VWRL", name: "Vanguard FTSE All-World UCITS ETF" },
  { isin: "NL0010273215", symbol: "ASML", name: "ASML Holding" },
  { isin: "US0378331005", symbol: "AAPL", name: "Apple" },
  { isin: "IE00BK5BQT80", symbol: "VWCE", name: "Vanguard FTSE All-World UCITS ETF Acc" },
  { isin: "NL0000009165", symbol: "HEIA", name: "Heineken" },
  { isin: "US5949181045", symbol: "MSFT", name: "Microsoft" },
  { isin: "NL0011794037", symbol: "AD", name: "Ahold Delhaize" },
];
const COINS = [
  { isin: "", symbol: "BTC", name: "Bitcoin" },
  { isin: "", symbol: "ETH", name: "Ethereum" },
  { isin: "", symbol: "ADA", name: "Cardano" },
  { isin: "", symbol: "SOL", name: "Solana" },
  { isin: "", symbol: "DOT", name: "Polkadot" },
  { isin: "", symbol: "XRP", name: "XRP" },
  { isin: "", symbol: "LTC", name: "Litecoin" },
  { isin: "", symbol: "LINK", name: "Chainlink" },
];
type PoolAsset = (typeof SECURITIES)[number];

const MONTHS = new Set(
  (
    "januari februari maart april mei juni juli augustus september oktober november december " +
    "january february march may june july october " +
    "jan feb mrt mar apr jun jul aug sep sept okt oct nov dec"
  ).split(" "),
);

/** Words the made-up values use; they're never a leak. */
const MADE_UP_WORDS = new Set(
  [
    "text",
    "column",
    "type",
    // The kinds in what a sample reads as ("security:IE00B4L5Y983").
    "security",
    "crypto",
    "metal",
    "fiat",
    ...[...SECURITIES, ...COINS].flatMap((a) => [a.isin, a.symbol, ...a.name.split(" ")]),
  ].map((w) => w.toLowerCase()),
);

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** How a number is written: what's around it, its decimals and its thousands separator. */
interface NumberShape {
  prefix: string;
  suffix: string;
  decimals: number;
  group: string | null;
  // "0,0012": made-up values keep a zero before the decimal mark.
  belowOne: boolean;
  zero: boolean;
}

function numberShape(raw: string, decimal: DecimalMark): NumberShape | null {
  const value = parseNumber(raw, decimal);
  if (value == null || /e/i.test(raw)) return null;
  const first = raw.search(/\d/);
  let last = raw.length - 1;
  while (last >= 0 && !/\d/.test(raw[last]!)) last--;
  const core = raw.slice(first, last + 1);
  const at = core.lastIndexOf(decimal);
  const whole = at >= 0 ? core.slice(0, at) : core;
  return {
    prefix: raw.slice(0, first),
    suffix: raw.slice(last + 1),
    decimals: at >= 0 ? core.length - at - 1 : 0,
    group: /\D/.exec(whole)?.[0] ?? null,
    belowOne: !/[1-9]/.test(whole),
    zero: !/[1-9]/.test(value),
  };
}

function writeNumber(shape: NumberShape, value: Decimal, decimal: DecimalMark): string {
  const [whole = "0", fraction] = value.abs().toFixed(shape.decimals).split(".");
  const grouped = shape.group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, shape.group) : whole;
  return shape.prefix + grouped + (fraction != null ? decimal + fraction : "") + shape.suffix;
}

/** Another value of the same shape: up to 999 (or `max`), with as many decimals. */
function madeUpNumber(shape: NumberShape, rng: Rng, max = 999): Decimal {
  const places = Math.min(shape.decimals, 15);
  const whole = shape.belowOne ? 0 : rng.int(1, max);
  const fraction = places ? rng.int(shape.belowOne ? 1 : 0, 10 ** places - 1) : 0;
  return D(whole).plus(D(fraction).div(D(10).pow(places)));
}

// ---- What may stay ----

export type KeptKind = "header" | "type" | "currency" | "assetType" | "metal" | "word";
export type Flag = "name" | "iban" | "email" | "phone" | "bsn";

/** A value of the original that the shared file keeps as it is, unless the user replaces it. */
export interface Kept {
  kind: KeptKind;
  value: string;
  /** How often it's in the shared file. */
  count: number;
  /** Made up instead: the user chose so, or it looks like personal data (`flag`). */
  replaced: boolean;
  flag?: Flag;
  /** A common word of statements, rather than one of this file's own. */
  common?: boolean;
}

/** An IBAN with a valid check number (mod 97). */
function isIban(s: string): boolean {
  const moved = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** Nine digits passing the elfproef, as a BSN does. */
function isBsn(s: string): boolean {
  const sum = [...s].reduce((acc, d, i) => acc + Number(d) * (i === 8 ? -1 : 9 - i), 0);
  return sum % 11 === 0 && /[1-9]/.test(s);
}

/** Why a value looks like personal data, if it does. */
export function personalData(text: string, names: RegExp | null): Flag | undefined {
  if (names?.test(text)) return "name";
  if (/[^\s@]+@[^\s@]+\.\p{L}{2,}/u.test(text)) return "email";
  const compact = text.toUpperCase().replace(/[\s.-]/g, "");
  for (const m of compact.matchAll(/[A-Z]{2}\d{2}(?=[A-Z0-9]{11})/g))
    for (let len = 15; len <= 34 && m.index + len <= compact.length; len++)
      if (/^[A-Z0-9]+$/.test(compact.slice(m.index, m.index + len)) && isIban(compact.slice(m.index, m.index + len)))
        return "iban";
  for (const m of text.matchAll(/\+?\d[\d\s-]{8,16}\d/g)) {
    const digits = m[0].replace(/[\s-]/g, "");
    if (/^0[1-9]\d{8}$/.test(digits) || /^(?:\+|00)[1-9]\d{9,12}$/.test(digits)) return "phone";
  }
  for (const m of text.matchAll(/(?<!\d)\d{9}(?!\d)/g)) if (isBsn(m[0])) return "bsn";
  return undefined;
}

/** A pattern for the household's names and the user name (words of three letters or more). */
export function namesPattern(names: string[]): RegExp | null {
  const words = [...new Set(names.flatMap((n) => n.toLowerCase().match(/\p{L}{3,}/gu) ?? []))];
  if (!words.length) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<!\\p{L})(?:${escaped.join("|")})(?!\\p{L})`, "iu");
}

/** The names a shared file must never contain: the household's and the user's. */
export async function personalNames(db: DB): Promise<string[]> {
  const [people, accounts] = await Promise.all([
    db.select({ name: persons.name }).from(persons),
    db.select({ name: users.username }).from(users),
  ]);
  return [...people, ...accounts].map((p) => p.name);
}

class Allowlist {
  readonly items = new Map<string, Kept>();
  constructor(
    private readonly replace: Set<string>,
    private readonly names: RegExp | null,
  ) {}

  /** `value` when it may stay; null when the caller should make something up instead. */
  keep(kind: KeptKind, value: string, common?: boolean): string | null {
    const key = `${kind}:${value}`;
    let item = this.items.get(key);
    if (!item) {
      const flag = personalData(value, this.names);
      item = { kind, value, count: 0, replaced: !!flag || this.replace.has(key) };
      if (flag) item.flag = flag;
      if (common) item.common = true;
      this.items.set(key, item);
    }
    item.count++;
    return item.replaced ? null : value;
  }

  get list(): Kept[] {
    return [...this.items.values()];
  }

  /** Words of what stays, which the leak check allows. */
  words(): Set<string> {
    return new Set(this.list.filter((k) => !k.replaced).flatMap((k) => words(k.value)));
  }
}

// ---- The last check ----

/** Lower-case words of 3+ letters, numbers of 5+ digits (not all zeros) and mixed codes of 5+. */
function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) =>
    /^\p{L}+$/u.test(w) ? w.length >= 3 : /^\p{N}+$/u.test(w) ? w.length >= 5 && /[1-9]/.test(w) : w.length >= 5,
  );
}

/** Words of the original that ended up in `output` although nothing allows them. */
function leaks(original: Iterable<string>, allowed: Set<string>, output: string): string[] {
  const secret = new Set<string>();
  for (const text of original) for (const w of words(text)) if (!allowed.has(w) && !MADE_UP_WORDS.has(w)) secret.add(w);
  return [...new Set(words(output))].filter((w) => secret.has(w));
}

const slug = (s: string) => norm(s).replace(/\s+/g, "-").slice(0, 40).replace(/-+$/, "") || "format";

// ---- A CSV export ----

const PER_TYPE = 3; // sample lines per value of the type column
const MAX_LINES = 40;
const MAX_SAMPLE = 90_000; // characters; the schema allows 100,000

interface Day {
  y: number;
  m: number;
  d: number;
}

const TIME_CELL = /^\d{1,2}:\d{2}(?::\d{2})?$/;

/** The day as written in a date cell (by the date order), or null when it isn't a date. */
function writtenDay(raw: string, order: DateOrder): Day | null {
  if (!parseDate(raw, order)) return null;
  const runs = raw.match(/\d+/g) ?? [];
  if (runs.length < 3) return null;
  const [a, b, c] = runs.slice(0, 3).map(Number) as [number, number, number];
  if (runs[0]!.length === 4) return { y: a, m: b, d: c };
  const y = runs[2]!.length === 2 ? 2000 + c : c;
  return order === "MDY" ? { y, m: a, d: b } : { y, m: b, d: a };
}

const dayKey = (d: Day) => d.y * 10_000 + d.m * 100 + d.d;

/** The lines to share: a few of each kind (value of the type column, or sign of the quantity). */
function pickLines(data: string[][], m: Mapping, max: number): number[] {
  const kindOf = (r: string[]) => {
    if (m.typeMode === "column" && m.columns.type != null) return (r[m.columns.type] ?? "").trim();
    if (m.typeMode === "sign" && m.columns.quantity != null)
      return /^\s*[-(−]/.test(r[m.columns.quantity] ?? "") ? "-" : "+";
    return "";
  };
  const per = new Map<string, number>();
  const out: number[] = [];
  data.forEach((r, i) => {
    const kind = kindOf(r);
    const n = per.get(kind) ?? 0;
    if (n < PER_TYPE && out.length < max) {
      per.set(kind, n + 1);
      out.push(i);
    }
  });
  return out;
}

/** Makes up the cells of a CSV export, consistently: the same original value gets the same stand-in. */
class CsvFaker {
  private readonly roles = new Map<number, Field>();
  private readonly texts = new Map<string, string>();
  private readonly typeNames = new Map<string, string>();
  private readonly assets = new Map<string, PoolAsset>();
  private readonly used = { security: 0, crypto: 0 };
  private readonly times = new Map<string, number[]>();
  // The thousands separator a column uses (where any of its numbers has one).
  private readonly groups = new Map<number, string>();
  readonly ids: Set<string>;

  constructor(
    private readonly rng: Rng,
    private readonly allow: Allowlist,
    private readonly m: Mapping,
    private readonly decimal: DecimalMark,
    private readonly order: DateOrder,
    private readonly days: Map<number, Day>,
    private readonly account: string,
    data: string[][],
  ) {
    for (const f of FIELDS) {
      const c = m.columns[f];
      if (c == null || this.roles.has(c) || (f === "type" && m.typeMode !== "column")) continue;
      this.roles.set(c, f);
    }
    // Made-up IDs never equal one of the file's own.
    const idColumn = m.columns.id;
    this.ids = new Set(idColumn == null ? [] : data.map((r) => (r[idColumn] ?? "").trim().toLowerCase()));
    for (const r of data.slice(0, 5000))
      r.forEach((c, i) => {
        const group = this.groups.has(i) ? null : numberShape(c.trim(), decimal)?.group;
        if (group) this.groups.set(i, group);
      });
  }

  /** A value of the type column, or its stand-in when it may not stay. */
  typeName(v: string): string {
    const known = this.m.typeValues[v] !== undefined || knownType(v) !== undefined;
    const kept = known ? this.allow.keep("type", v) : null;
    if (kept != null) return kept;
    if (!this.typeNames.has(v)) this.typeNames.set(v, `type-${this.typeNames.size + 1}`);
    return this.typeNames.get(v)!;
  }

  /** A data line. */
  line(r: string[]): string[] {
    const out = r.map((raw, i) => this.cell(raw.trim(), i, r));
    // The total of a trade follows from the made-up quantity and price.
    const { quantity: q, price: p, total: t } = this.m.columns;
    if (q != null && p != null && t != null && new Set([q, p, t]).size === 3) {
      const qv = parseNumber(out[q] ?? "", this.decimal);
      const pv = parseNumber(out[p] ?? "", this.decimal);
      const shape = this.shape((r[t] ?? "").trim(), t);
      if (qv && pv && /[1-9]/.test(qv) && /[1-9]/.test(pv) && shape && !shape.zero)
        out[t] = writeNumber(shape, D(qv).abs().mul(D(pv).abs()), this.decimal);
    }
    return out;
  }

  private cell(v: string, col: number, r: string[]): string {
    if (!v) return "";
    switch (this.roles.get(col)) {
      case "date":
        return this.date(v) ?? this.other(v, col);
      case "time":
        return this.time(v) ?? this.other(v, col);
      case "quantity":
        return this.number(v, col, 99) ?? this.other(v, col);
      case "price":
      case "total":
      case "amount":
      case "tax":
        return this.number(v, col) ?? this.other(v, col);
      case "fee":
        return this.number(v, col, 9) ?? this.other(v, col);
      case "type":
        return this.typeName(v);
      case "currency":
        return /^[A-Za-z]{3,5}$/.test(v) ? (this.allow.keep("currency", v) ?? "EUR") : this.other(v, col);
      case "assetType":
        return ASSET_TYPES[v.toLowerCase()] ? (this.allow.keep("assetType", v) ?? "") : this.placeholder(col, v);
      case "symbol":
        return this.symbol(v, r);
      case "isin":
        return ISIN_RE.test(v.toUpperCase()) ? this.asset(r).isin || SECURITIES[0]!.isin : this.other(v, col);
      case "name":
        return METALS[v.toLowerCase()] ? (this.allow.keep("metal", v) ?? "XAU") : this.asset(r).name;
      case "id":
        return this.id(v);
      default:
        return this.other(v, col);
    }
  }

  /** A cell without a role of its own (notes, unmapped columns, title lines): by its shape. */
  other(v: string, col: number): string {
    v = v.trim();
    if (!v) return "";
    const date = this.date(v);
    if (date) return date;
    if (TIME_CELL.test(v)) return this.time(v) ?? this.placeholder(col, v);
    // A long run of digits is a number of some kind (an account, an order), not an amount.
    if (/^\d{6,}$/.test(v)) return this.id(v);
    const n = this.number(v, col);
    if (n != null) return n;
    const upper = v.toUpperCase();
    if (ISIN_RE.test(upper)) return this.poolAsset(upper, "security").isin;
    if (/^[A-Z]{3}$/.test(v) && isFiat(v)) return this.allow.keep("currency", v) ?? "EUR";
    const lower = v.toLowerCase();
    if (METALS[lower]) return this.allow.keep("metal", v) ?? this.placeholder(col, v);
    if (ASSET_TYPES[lower]) return this.allow.keep("assetType", v) ?? this.placeholder(col, v);
    if (knownType(v) || this.m.typeValues[v] !== undefined)
      return this.allow.keep("type", v) ?? this.placeholder(col, v);
    if (MONTHS.has(lower)) return this.allow.keep("word", v) ?? this.placeholder(col, v);
    return this.placeholder(col, v);
  }

  private placeholder(col: number, v: string): string {
    const key = `${col}\u0000${v}`;
    if (!this.texts.has(key)) this.texts.set(key, `text-${this.texts.size + 1}`);
    return this.texts.get(key)!;
  }

  private shape(v: string, col: number): NumberShape | null {
    const shape = numberShape(v, this.decimal);
    return shape && { ...shape, group: shape.group ?? this.groups.get(col) ?? null };
  }

  private number(v: string, col: number, max?: number): string | null {
    const shape = this.shape(v, col);
    if (!shape) return null;
    return shape.zero ? v : writeNumber(shape, madeUpNumber(shape, this.rng, max), this.decimal);
  }

  /** The date in the same format, on its made-up day; a time in it is made up too. */
  private date(v: string): string | null {
    const day = writtenDay(v, this.order);
    const to = day && this.days.get(dayKey(day));
    if (!to) return null;
    const runs = [...v.matchAll(/\d+/g)];
    const roles = runs[0]![0].length === 4 ? "ymd" : this.order === "MDY" ? "mdy" : "dmy";
    const clock =
      runs.length > 3
        ? this.clock(
            runs
              .slice(3, 6)
              .map((r) => r[0])
              .join(":"),
          )
        : [];
    let out = "";
    let pos = 0;
    runs.forEach((r, i) => {
      const width = r[0].length;
      let value: string;
      if (i < 3) {
        const role = roles[i]!;
        const n = role === "y" ? (width === 2 ? to.y % 100 : to.y) : role === "m" ? to.m : to.d;
        value = String(n).padStart(width, "0");
      } else if (i < 6) value = String(clock[i - 3]).padStart(width, "0");
      // Fractions of a second and a time zone stay as they are.
      else value = r[0];
      out += v.slice(pos, r.index) + value;
      pos = r.index + width;
    });
    return out + v.slice(pos);
  }

  private time(v: string): string | null {
    const runs = [...v.matchAll(/\d+/g)];
    if (runs.length < 2 || runs.length > 3) return null;
    const clock = this.clock(runs.map((r) => r[0]).join(":"));
    let out = "";
    let pos = 0;
    runs.forEach((r, i) => {
      out += v.slice(pos, r.index) + String(clock[i]).padStart(r[0].length, "0");
      pos = r.index + r[0].length;
    });
    return out + v.slice(pos);
  }

  // Office hours, clear of the hour a summer-time change skips.
  private clock(original: string): number[] {
    if (!this.times.has(original))
      this.times.set(original, [this.rng.int(8, 20), this.rng.int(0, 59), this.rng.int(0, 59)]);
    return this.times.get(original)!;
  }

  /** An ID of the same shape: random digits and letters (hexadecimal stays hexadecimal). */
  id(v: string): string {
    const hex = /^[\da-f-]{8,}$/i.test(v) && /[a-f]/i.test(v);
    for (let attempt = 0; attempt < 50; attempt++) {
      const made = [...v]
        .map((ch, i) => {
          if (/\d/.test(ch)) return String(this.rng.int(i === 0 && ch !== "0" ? 1 : 0, 9));
          if (hex && /[a-f]/i.test(ch)) {
            const h = "abcdef"[this.rng.int(0, 5)]!;
            return ch === ch.toUpperCase() ? h.toUpperCase() : h;
          }
          if (/\p{Lu}/u.test(ch)) return this.rng.pick([...LETTERS]);
          if (/\p{L}/u.test(ch)) return this.rng.pick([...LETTERS]).toLowerCase();
          return ch;
        })
        .join("");
      if (!this.ids.has(made.toLowerCase())) {
        this.ids.add(made.toLowerCase());
        return made;
      }
    }
    return `id-${this.ids.size}`;
  }

  private symbol(v: string, r: string[]): string {
    if (/^[A-Z]{3}$/i.test(v) && isFiat(v)) return this.allow.keep("currency", v) ?? "EUR";
    if (METALS[v.toLowerCase()]) return this.allow.keep("metal", v) ?? "XAU";
    const asset = this.asset(r);
    const lower = v === v.toLowerCase();
    // "BTC-EUR", "ASML.AS": the first part is the asset; a currency code after it stays.
    const [, first = "", rest = ""] = /^([\p{L}\p{N}]*)(.*)$/su.exec(v) ?? [];
    const symbol = first ? (lower ? asset.symbol.toLowerCase() : asset.symbol) : "";
    const tail = rest.replace(/[\p{L}\p{N}]+/gu, (part) =>
      /^[A-Z]{3}$/i.test(part) && isFiat(part)
        ? (this.allow.keep("currency", part) ?? "EUR")
        : /^\p{Lu}{1,2}$/u.test(part)
          ? (this.allow.keep("word", part) ?? "XX")
          : "X".repeat(part.length),
    );
    return symbol + tail;
  }

  /** The stand-in for the asset of a line: the same original asset always gets the same one. */
  private asset(r: string[]): PoolAsset {
    const cell = (f: Field) => {
      const c = this.m.columns[f];
      return c == null ? "" : (r[c] ?? "").trim();
    };
    const isin = cell("isin").toUpperCase();
    if (ISIN_RE.test(isin)) return this.poolAsset(isin, "security");
    const key = (cell("symbol") || cell("name")).toUpperCase();
    const hint = ASSET_TYPES[cell("assetType").toLowerCase()];
    const kind =
      hint === "crypto" || (!hint && this.m.assetKind === "crypto")
        ? "crypto"
        : hint || this.m.assetKind !== "auto"
          ? "security"
          : KIND_BY_ACCOUNT[this.account] === "crypto"
            ? "crypto"
            : "security";
    return this.poolAsset(key, kind);
  }

  private poolAsset(key: string, kind: "security" | "crypto"): PoolAsset {
    const id = `${kind}:${key}`;
    if (!this.assets.has(id)) {
      const pool = kind === "crypto" ? COINS : SECURITIES;
      this.assets.set(id, pool[this.used[kind]++ % pool.length]!);
    }
    return this.assets.get(id)!;
  }
}

export interface CsvContributionInput {
  content: string;
  mapping: Mapping;
  /** The kind of account the file is imported into (how symbols are read). */
  account: string;
  provider: string;
  export?: string;
  /** Names that must not be in the file: the household's, the user's. */
  avoid?: string[];
  /** Kept values the user wants made up as well, as "kind:value". */
  replace?: string[];
  seed?: number;
  version?: string;
}

export interface CsvContribution {
  file: SharedFormat;
  fileName: string;
  kept: Kept[];
  lines: { file: number; sample: number };
}

function csvLayout(text: string, skipRows: number) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(skipRows, skipRows + 6);
  return {
    quoteAll: lines.length > 0 && lines.every((l) => l.startsWith('"')),
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    bom: text.startsWith("\uFEFF"),
  };
}

function writeCsv(rows: string[][], delimiter: string, layout: ReturnType<typeof csvLayout>): string {
  const quote = (v: string) =>
    layout.quoteAll || v.includes(delimiter) || /["\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
  return (layout.bom ? "\uFEFF" : "") + rows.map((r) => r.map(quote).join(delimiter)).join(layout.eol) + layout.eol;
}

/**
 * The shareable file for a CSV export the user has set up an import for: the format with a made-up
 * sample. Throws a message for the user when the file can't be shared this way.
 */
export function csvContribution(input: CsvContributionInput): CsvContribution {
  const seed = input.seed ?? randomInt(2 ** 31);
  for (let attempt = 0; attempt < 5; attempt++) {
    const made = makeCsv(input, seed + attempt * 7919);
    if (made) return made;
  }
  throw new HttpError(
    422,
    tr("Box3balans couldn't make a sample without parts of your file in it. Please report this."),
  );
}

function makeCsv(input: CsvContributionInput, seed: number): CsvContribution | null {
  const text = input.content.replace(/^\uFEFF/, "");
  const delimiter = input.mapping.delimiter ?? detectDelimiter(text);
  const table = parseCsv(text, delimiter);
  const skipRows = Math.min(input.mapping.skipRows, table.length);
  const titles = table.slice(0, skipRows);
  const headers = table[skipRows] ?? [];
  const data = table.slice(skipRows + 1);
  if (headers.filter((h) => norm(h)).length < 3)
    throw new HttpError(400, tr("A format can be shared when the file has a header row with at least three columns"));
  if (!data.length) throw new HttpError(400, tr("The file has no lines below the header row"));

  const columns = Object.fromEntries(
    FIELDS.map((f) => [f, (input.mapping.columns[f] ?? -1) < headers.length ? input.mapping.columns[f] : null]),
  ) as Mapping["columns"];
  const m: Mapping = {
    ...input.mapping,
    delimiter,
    columns,
    typeValues: input.mapping.typeMode === "column" ? input.mapping.typeValues : {},
  };
  const { decimal, dateOrder } = detectNotation(data, m);

  for (let max = MAX_LINES; max >= 1; max = Math.floor(max / 2)) {
    const rng = generator(seed);
    const allow = new Allowlist(new Set(input.replace ?? []), namesPattern(input.avoid ?? []));
    const lines = pickLines(data, m, max).map((i) => data[i]!);

    // Every date of what's shared gets a made-up day, in the same order (and equal days stay equal).
    const written = new Set<number>();
    for (const row of [...titles, ...lines])
      for (const c of row) {
        const day = writtenDay(c.trim(), dateOrder);
        if (day) written.add(dayKey(day));
      }
    const days = new Map<number, Day>();
    let at = Date.UTC(2025, 0, 6);
    for (const key of [...written].sort((a, b) => a - b)) {
      const d = new Date(at);
      days.set(key, { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
      at += rng.int(1, 9) * 86_400_000;
    }

    const faker = new CsvFaker(rng, allow, m, decimal, dateOrder, days, input.account, data);
    const sharedHeaders = headers.map((h, i) =>
      h.trim() ? (allow.keep("header", h.trim()) ?? `column-${i + 1}`) : "",
    );
    const sharedTitles = titles.map((r) => r.map((c, i) => faker.other(c, -1 - i)));
    const sharedLines = lines.map((r) => faker.line(r));
    const typeValues = Object.fromEntries(Object.entries(m.typeValues).map(([k, v]) => [faker.typeName(k), v]));
    const mapping = {
      skipRows,
      delimiter,
      decimal,
      dateOrder,
      columns,
      typeMode: m.typeMode,
      fixedType: m.fixedType,
      typeValues,
      assetKind: m.assetKind,
      defaultCurrency: m.defaultCurrency,
      feeCurrency: m.feeCurrency,
      settleCash: m.settleCash,
    };
    const sample = writeCsv(
      [...sharedTitles, sharedHeaders, ...sharedLines],
      delimiter,
      csvLayout(input.content, skipRows),
    );
    if (sample.length > MAX_SAMPLE && max > 1) continue;

    const file = sharedFormatSchema.parse({
      box3balans: "csv-format",
      version: 1,
      id: slug(input.provider),
      provider: input.provider,
      export: input.export ?? "",
      account: input.account,
      headers: sharedHeaders,
      mapping,
      sample,
      expected: readExpected(sample, mappingSchema.parse(mapping), input.account),
      app: input.version,
    });

    // Numbers, dates and times are always made up, so only words and codes of the original count.
    const original = table.flat().filter((c) => {
      const v = c.trim();
      return v && !writtenDay(v, dateOrder) && !TIME_CELL.test(v) && numberShape(v, decimal) == null;
    });
    const allowed = new Set([...allow.words(), ...words(input.provider), ...words(input.export ?? "")]);
    const shared = [sample, ...file.expected.map((e) => e.asset ?? "")].join("\n");
    if (leaks(original, allowed, shared).length) return null;
    const names = namesPattern(input.avoid ?? []);
    if (names && names.test(sample)) return null;

    return {
      file,
      fileName: `box3balans-formaat-${file.id}.json`,
      kept: allow.list,
      lines: { file: data.length, sample: lines.length },
    };
  }
  return null;
}

// ---- A year statement (PDF text) ----

/** Words that are in most statements: they may stay (the user sees them listed and can replace them). */
const STATEMENT_WORDS = new Set(
  [
    ...MONTHS,
    // Dutch
    "jaaroverzicht jaaropgave overzicht financieel financiële fiscaal fiscale rekening rekeningen rekeningnummer",
    "spaarrekening betaalrekening beleggingsrekening effectenrekening depot saldo beginsaldo eindsaldo stand",
    "beginstand eindstand beginwaarde eindwaarde waarde marktwaarde totaal totale subtotaal rente rentevergoeding",
    "ontvangen betaald uitbetaald kosten provisie servicekosten beheerkosten transactiekosten dividend",
    "dividendbelasting bronbelasting belasting belastingdienst inleg ingelegd storting stortingen gestort opname",
    "opnames opgenomen onttrekking onttrekkingen aankoop aankopen verkoop verkopen positie posities aantal koers",
    "koersen valuta euro datum peildatum vermogen box rendement resultaat ongerealiseerd gerealiseerd fonds",
    "fondsen aandelen aandeel obligaties obligatie etf beleggingen belegging goud zilver platina palladium gram",
    "edelmetaal lening leningen krediet creditcard schuld schulden hypotheek uitstaand uitstaande hoofdsom",
    "aflossing aflossingen bedrag bedragen omschrijving transacties transactie mutaties mutatie credit debet",
    "tegoed periode jaar maand kwartaal pagina blad begin eind klant klantnummer relatienummer naam adres",
    "postcode woonplaats geboortedatum rekeninghouder tenaamstelling iban bic rentepercentage percentage",
    "vragen bel mail contact algemene voorwaarden",
    "van tot en met de het een in uw is bij naar voor aan om op per of als dit deze die dat zijn wordt worden",
    "heeft hebben ook niet geen over onder na door uit nog al wel ten ter tegen zonder te",
    // English
    "statement annual account accounts balance opening closing value total interest fees fee costs charges",
    "deposits deposit withdrawals withdrawal date page the and on at to from year month portfolio holdings",
    "position positions quantity price currency amount amounts tax withholding dividends income received paid",
    "start end period summary overview gold silver loan your for with",
  ]
    .join(" ")
    .split(" "),
);

const MAX_PAGES = 6;
const MAX_PAGE_TEXT = 20_000;

export interface PdfPick {
  page: number;
  line: string;
  field: YearField;
  year: number;
}

export interface PdfStatementFile {
  box3balans: "pdf-statement";
  version: 1;
  provider: string;
  document: string;
  pages: StatementPage[];
  values: PdfPick[];
  app?: string;
}

export interface PdfContributionInput {
  pages: StatementPage[];
  picked: PdfPick[];
  provider: string;
  document?: string;
  avoid?: string[];
  replace?: string[];
  seed?: number;
  version?: string;
}

export interface PdfContribution {
  file: PdfStatementFile;
  fileName: string;
  kept: Kept[];
}

const PDF_TOKEN = /(\d{1,2})([-./])(\d{1,2})\2(\d{4}|\d{2})(?!\d)|\d+(?:[.,']\d+)*|\p{N}+|\p{L}+|[^\p{L}\p{N}]+/gu;

/**
 * The shareable file for a year statement without a template: the text of its first page and of the
 * pages with the values the user picked, with every number made up (years, and 1 January and
 * 31 December, stay) and every word that isn't common or in a picked line turned into x's.
 */
export function pdfContribution(input: PdfContributionInput): PdfContribution {
  const seed = input.seed ?? randomInt(2 ** 31);
  for (let attempt = 0; attempt < 5; attempt++) {
    const made = makePdf(input, seed + attempt * 7919);
    if (made) return made;
  }
  throw new HttpError(
    422,
    tr("Box3balans couldn't make a sample without parts of your file in it. Please report this."),
  );
}

function makePdf(input: PdfContributionInput, seed: number): PdfContribution | null {
  const rng = generator(seed);
  const allow = new Allowlist(new Set(input.replace ?? []), namesPattern(input.avoid ?? []));
  const wanted = new Set([Math.min(...input.pages.map((p) => p.page)), ...input.picked.map((p) => p.page)]);
  const pages = input.pages
    .filter((p) => wanted.has(p.page))
    .sort((a, b) => a.page - b.page)
    .slice(0, MAX_PAGES)
    .map((p) => ({ page: p.page, text: p.text.slice(0, MAX_PAGE_TEXT) }));

  // Amounts with a thousands separator: the made-up ones get it too.
  const all = pages.map((p) => p.text).join("\n");
  const groups = {
    ",": /\d\.\d{3},\d{2}(?!\d)/.test(all) ? "." : null,
    ".": /\d,\d{3}\.\d{2}(?!\d)/.test(all) ? "," : null,
  };

  // The words of the picked lines and of the provider's name may stay.
  const own = new Set(
    [...input.picked.map((p) => p.line), input.provider].flatMap((l) => l.toLowerCase().match(/\p{L}+/gu) ?? []),
  );

  const shareLine = (line: string): string => {
    const tokens = [...line.matchAll(PDF_TOKEN)];
    return tokens
      .map((t, i) => {
        const tok = t[0];
        if (t[1]) {
          // A date: 1 January and 31 December stay, as does the year.
          const [d, sep, mo, y] = [Number(t[1]), t[2]!, Number(t[3]), t[4]!];
          if ((d === 1 && mo === 1) || (d === 31 && mo === 12)) return tok;
          const pad = (n: number, w: number) => String(n).padStart(w, "0");
          return `${pad(rng.int(1, 28), t[1].length)}${sep}${pad(rng.int(1, 12), t[3]!.length)}${sep}${y}`;
        }
        if (/^\d/.test(tok)) {
          const n = Number(tok);
          if (/^\d{4}$/.test(tok) && n >= 1990 && n <= 2039) return tok;
          const next = tokens
            .slice(i + 1)
            .find((x) => /\p{L}/u.test(x[0]))?.[0]
            .toLowerCase();
          if (/^\d{1,2}$/.test(tok) && next && MONTHS.has(next) && /^\s*$/.test(tokens[i + 1]?.[0] ?? ""))
            return n === 1 || n === 31 ? tok : String(rng.int(1, 28));
          const decimal = /,\d{2}$/.test(tok) ? "," : /\.\d{2}$/.test(tok) ? "." : null;
          const found = decimal ? numberShape(tok, decimal) : null;
          const shape = found && { ...found, group: found.group ?? groups[decimal!] };
          if (decimal && shape) return shape.zero ? tok : writeNumber(shape, madeUpNumber(shape, rng, 99_999), decimal);
          return tok.replace(/\d/g, (ch, at: number) => String(rng.int(at === 0 && ch !== "0" ? 1 : 0, 9)));
        }
        // Digits of another script.
        if (/^\p{N}/u.test(tok)) return tok.replace(/\p{N}/gu, () => String(rng.int(0, 9)));
        if (/^\p{L}/u.test(tok)) {
          const lower = tok.toLowerCase();
          const common = STATEMENT_WORDS.has(lower);
          if ((common || own.has(lower)) && allow.keep("word", lower, common) != null) return tok;
          return tok.replace(/\p{L}/gu, (c) => (/\p{Lu}/u.test(c) ? "X" : "x"));
        }
        return tok;
      })
      .join("");
  };

  const sharedPages = pages.map((p) => ({ page: p.page, lines: p.text.split("\n").map(shareLine) }));
  const values: PdfPick[] = [];
  for (const pick of input.picked) {
    const page = pages.find((p) => p.page === pick.page);
    const at = page?.text.split("\n").findIndex((l) => l.trim() === pick.line.trim()) ?? -1;
    const line = sharedPages.find((p) => p.page === pick.page)?.lines[at];
    if (line != null) values.push({ page: pick.page, line: line.trim(), field: pick.field, year: pick.year });
  }
  const file: PdfStatementFile = {
    box3balans: "pdf-statement",
    version: 1,
    provider: input.provider,
    document: input.document ?? "",
    pages: sharedPages.map((p) => ({ page: p.page, text: p.lines.join("\n") })),
    values,
    ...(input.version ? { app: input.version } : {}),
  };

  const allowed = new Set([...allow.words(), ...words(input.provider), ...words(input.document ?? "")]);
  const shared = file.pages.map((p) => p.text).join("\n");
  const original = pages.map((p) => p.text);
  if (leaks(original, allowed, shared).filter((w) => !/^x+$/.test(w)).length) return null;
  return { file, fileName: `box3balans-jaaroverzicht-${slug(input.provider)}.json`, kept: allow.list };
}
