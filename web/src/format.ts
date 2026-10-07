import { dateLocale, t } from "./i18n";

const LOCALE_KEY = "numberLocale";

export const NUMBER_LOCALES = {
  "nl-NL": "€ 1.234,56",
  "en-IE": "€1,234.56",
  "de-DE": "1.234,56 €",
} as const;

export function getLocale(): keyof typeof NUMBER_LOCALES {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    if (v && v in NUMBER_LOCALES) return v as keyof typeof NUMBER_LOCALES;
  } catch {}
  return "nl-NL";
}

export function setLocale(v: keyof typeof NUMBER_LOCALES) {
  try {
    localStorage.setItem(LOCALE_KEY, v);
  } catch {}
}

const n = (v: string | number | null | undefined) => (v == null || v === "" ? NaN : Number(v));

export function eur(v: string | number | null | undefined, opts: { decimals?: number; sign?: boolean } = {}): string {
  const x = n(v);
  if (Number.isNaN(x)) return "—";
  const d = opts.decimals ?? 2;
  const s = new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
    signDisplay: opts.sign ? "exceptZero" : "auto",
  }).format(x);
  return s;
}

/** EUR with precision scaled to magnitude (for unit prices like €0.000123 or €76,888). */
export function eurPrice(v: string | number | null | undefined, currency = "EUR"): string {
  const x = n(v);
  if (Number.isNaN(x)) return "—";
  const abs = Math.abs(x);
  const d = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency,
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(x);
}

export function num(v: string | number | null | undefined, maxDecimals = 8): string {
  const x = n(v);
  if (Number.isNaN(x)) return "—";
  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: maxDecimals }).format(x);
}

export function pct(v: string | number | null | undefined, opts: { sign?: boolean } = {}): string {
  const x = n(v);
  if (Number.isNaN(x)) return "—";
  return (
    new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: opts.sign === false ? "auto" : "exceptZero",
    }).format(x) + "%"
  );
}

export function date(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v.length === 10 ? `${v}T00:00:00` : v) : v;
  return new Intl.DateTimeFormat(dateLocale(), { year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function relativeTime(v: string | null | undefined): string {
  if (!v) return t("never");
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return t("just now");
  if (s < 3600) return t("{n} min ago", { n: Math.round(s / 60) });
  if (s < 86400) return t("{n} h ago", { n: Math.round(s / 3600) });
  return t("{n} d ago", { n: Math.round(s / 86400) });
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const CLASS_LABEL: Record<string, string> = {
  stock: t("Stocks"),
  etf: t("ETFs and funds"),
  crypto: t("Crypto"),
  metal: t("Precious metals"),
  cash: t("Cash"),
  other: t("Other"),
};

// Fixed categorical slot per asset class: colour follows the entity, never its rank.
export const CLASS_COLOR: Record<string, string> = {
  stock: "var(--series-1)",
  etf: "var(--series-2)",
  crypto: "var(--series-3)",
  metal: "var(--series-4)",
  cash: "var(--series-5)",
  other: "var(--series-6)",
};

export const CLASS_ORDER = ["stock", "etf", "crypto", "metal", "cash", "other"] as const;

export const TX_LABEL: Record<string, string> = {
  buy: t("Buy"),
  sell: t("Sell"),
  deposit: t("Deposit"),
  withdrawal: t("Withdrawal"),
  transfer_in: t("Transfer in"),
  transfer_out: t("Transfer out"),
  dividend: t("Dividend"),
  reward: t("Reward / staking"),
  fee: t("Fee (in asset)"),
  split: t("Split"),
};

export const METAL_LABEL: Record<string, string> = {
  gold: t("Gold"),
  silver: t("Silver"),
  platinum: t("Platinum"),
  palladium: t("Palladium"),
};

// ---- Number input ----

export interface ParsedNumber {
  /** Canonical decimal string ("5000", "1.5"), "" for empty input, null when not a number. */
  value: string | null;
  /** True when the input could also have meant something else (e.g. "5.000": 5000 or 5). */
  ambiguous: boolean;
}

/**
 * Reads a number typed by the user. With a Dutch/German number format, "." groups thousands and ","
 * is the decimal mark ("1.234,56", "1,5", "5.000" = five thousand); with English it's the other way
 * round. A separator that can't be a thousands group (e.g. "0.0015", "1.5") is read as a decimal mark,
 * so numbers copied from English-language sites still work.
 */
export function parseNumberInput(raw: string, locale: string = getLocale()): ParsedNumber {
  const s = raw.trim().replace(/[\s\u00a0\u202f']/g, "");
  if (s === "") return { value: "", ambiguous: false };
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  if (!/^[0-9.,]+$/.test(body) || !/[0-9]/.test(body)) return { value: null, ambiguous: false };
  const decimalMark = locale.startsWith("en") ? "." : ",";
  const groupMark = decimalMark === "," ? "." : ",";
  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;
  let intPart: string;
  let frac = "";
  let ambiguous = false;

  const split = (sep: string) => {
    const i = body.lastIndexOf(sep);
    return [body.slice(0, i), body.slice(i + 1)] as const;
  };

  if (dots && commas) {
    // Both used: the last one is the decimal mark, the other groups thousands.
    const dec = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    const grp = dec === "." ? "," : ".";
    const [a, b] = split(dec);
    if (b.includes(grp) || !validGroups(a, grp)) return { value: null, ambiguous: false };
    intPart = a.split(grp).join("");
    frac = b;
  } else if (dots + commas === 0) {
    intPart = body;
  } else {
    const sep = dots ? "." : ",";
    const count = dots || commas;
    if (count > 1) {
      // Repeated: can only be thousands separators ("1.234.567").
      if (!validGroups(body, sep)) return { value: null, ambiguous: false };
      intPart = body.split(sep).join("");
    } else {
      const [a, b] = split(sep);
      const looksLikeGroup = b.length === 3 && /^[1-9]\d{0,2}$/.test(a);
      if (sep === groupMark && looksLikeGroup) {
        // "5.000" in Dutch: thousands, but someone might have meant 5 — flag it.
        intPart = a + b;
        ambiguous = true;
      } else {
        intPart = a;
        frac = b;
      }
    }
  }
  if (intPart === "" && frac === "") return { value: null, ambiguous: false };
  const int = (intPart || "0").replace(/^0+(?=\d)/, "");
  const value = `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
  return /^-?\d+(\.\d+)?$/.test(value) ? { value, ambiguous } : { value: null, ambiguous: false };
}

function validGroups(s: string, sep: string): boolean {
  const parts = s.split(sep);
  return /^\d{1,3}$/.test(parts[0]!) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
}

/** Canonical number for the API, or throws a readable error. Empty input gives "" (optional fields). */
export function toApiNumber(raw: string, label = t("Amount")): string {
  const p = parseNumberInput(raw);
  if (p.value === null) throw new Error(t("{label}: “{raw}” is not a number", { label, raw }));
  return p.value;
}

/** Shows a parsed number without any ambiguity: spaces group thousands, the locale's mark for decimals. */
export function unambiguous(value: string, locale: string = getLocale()): string {
  const neg = value.startsWith("-");
  const [i, f] = (neg ? value.slice(1) : value).split(".");
  const grouped = i!.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  return `${neg ? "−" : ""}${grouped}${f ? `${locale.startsWith("en") ? "." : ","}${f}` : ""}`;
}

/** A canonical number ("6.729") written for an input in the user's format ("6,729"), so it reads back unchanged. */
export function toInputNumber(canonical: string | null | undefined, locale: string = getLocale()): string {
  if (canonical == null || canonical === "") return "";
  return locale.startsWith("en") ? canonical : canonical.replace(".", ",");
}
