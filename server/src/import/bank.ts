import { XMLParser } from "fast-xml-parser";
import { D, type Decimal, ZERO, money2 } from "../lib/decimal.js";
import { type DecimalMark, detectDateOrder, detectDecimal, detectDelimiter, parseCsv, parseNumber } from "./parse.js";
import { tr, trn } from "../i18n/index.js";

/**
 * Reads a bank's transaction export (CSV, ABN AMRO's TAB file, CAMT.053 or MT940) and turns it into what
 * box 3 needs per year: the balance on 1 January, interest received, and money in and out.
 */

export interface BankLine {
  day: string; // YYYY-MM-DD
  amount: Decimal; // + received, − paid
  balanceAfter: Decimal | null;
  description: string;
  account: string; // the own account the line belongs to ("" when the file doesn't say)
  // ISO code when the file names one (Revolut, Wise); otherwise euros.
  currency?: string;
}

export interface BankYear {
  year: number;
  // Balance on 1 January of `year` (the end of 31 December before); null when the file doesn't show it.
  valueEur: string | null;
  // The file starts in this year, so its first balance is taken as the 1 January balance.
  valueEstimated: boolean;
  interestEur: string;
  inEur: string;
  outEur: string;
  // The file covers the whole year, so its totals are the year's totals.
  fullYear: boolean;
  lines: number;
}

export interface BankAccountSummary {
  account: string;
  // The account's currency when the file names one.
  currency: string | null;
  // False when the amounts are in another currency and couldn't be converted.
  inEuros: boolean;
  from: string;
  to: string;
  lines: number;
  years: BankYear[];
}

export interface BankImport {
  format: "camt053" | "mt940" | "abn-tab" | "csv";
  accounts: BankAccountSummary[];
  // No balances in the file: the balance after its last line is needed to work out the others.
  needsClosingBalance: boolean;
  warnings: string[];
}

// Revolut's Flexible Cash Funds and similar: a fund, so overige bezittingen.
const FUND = /\b(flexible cash funds?|money market funds?|geldmarktfonds)\b/i;
// Interest, also on savings accounts ("Rente", "Creditrente", "Rentebijschrijving", "Interest").
const INTEREST = /\b(rente|creditrente|rentebijschrijving|spaarrente|interest)\b/i;

/** YYYYMMDD, YYYY-MM-DD, DD-MM-YYYY (or with / or .) → YYYY-MM-DD. */
function toDay(raw: string, dmy: boolean): string | null {
  const s = raw.trim().slice(0, 10);
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s) ?? /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (!m) return null;
  const [a, b] = dmy ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
  return `${m[3]}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
}

// ---- Formats ----

const HEADERS = {
  // Revolut has a "Started Date" and a "Completed Date"; the latter is when it hit the balance.
  date: /^(datum|date|transactiedatum|boekdatum|boekingsdatum|transaction ?date|booking ?date|completed ?date)$/i,
  amount: /^(bedrag( \(eur\))?|bedrag eur|amount|transactiebedrag|amount \(eur\))$/i,
  sign: /^(af ?\/? ?bij|debet ?\/? ?credit|credit ?\/? ?debet|d\/c)$/i,
  balance:
    /^(saldo na (mutatie|trn|boeking|transactie)|saldo|balance( after)?|running ?balance|saldo na mutatie \(eur\))$/i,
  account: /^(rekening|iban\/bban|rekeningnummer|account|iban)$/i,
  // Revolut: "Product" (Current, Savings …) and "State"; Revolut and Wise: "Currency".
  product: /^product$/i,
  currency: /^(currency|valuta|munt)$/i,
  state: /^(state|status)$/i,
  fee: /^fee$/i,
  description:
    /^(naam ?\/ ?omschrijving|omschrijving(-\d)?|mededelingen|description|naam tegenpartij|naam|name|counterparty|mutatiesoort|type)$/i,
};

function fromCsv(text: string): { lines: BankLine[]; warnings: string[] } {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter).filter((r) => r.some((c) => c.trim()));
  // The header is the first row that names a date and an amount column.
  const headerIdx = rows.findIndex(
    (r) => r.some((c) => HEADERS.date.test(c.trim())) && r.some((c) => HEADERS.amount.test(c.trim())),
  );
  if (headerIdx < 0)
    throw new Error(tr("No date and amount columns found. Is this a transaction export from your bank?"));
  const header = rows[headerIdx]!.map((c) => c.trim());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iDate = col(HEADERS.date);
  const iAmount = col(HEADERS.amount);
  const iSign = col(HEADERS.sign);
  const iBalance = col(HEADERS.balance);
  const iAccount = col(HEADERS.account);
  const iProduct = col(HEADERS.product);
  const iCurrency = col(HEADERS.currency);
  const iState = col(HEADERS.state);
  const iFee = col(HEADERS.fee);
  let unfinished = 0;
  let fund = false;
  const iDesc = header.map((h, i) => (HEADERS.description.test(h) ? i : -1)).filter((i) => i >= 0);
  const data = rows.slice(headerIdx + 1);
  const decimal: DecimalMark = detectDecimal([
    ...data.map((r) => r[iAmount] ?? ""),
    ...(iBalance >= 0 ? data.map((r) => r[iBalance] ?? "") : []),
  ]);
  const dmy = detectDateOrder(data.map((r) => r[iDate] ?? "")) !== "MDY";
  const warnings: string[] = [];
  const lines: BankLine[] = [];
  for (const r of data) {
    // Pending, reverted or declined lines never touched the balance.
    if (iState >= 0 && /^(pending|reverted|declined|failed|cancell?ed)$/i.test((r[iState] ?? "").trim())) {
      unfinished++;
      continue;
    }
    const day = toDay(r[iDate] ?? "", dmy);
    const raw = parseNumber(r[iAmount] ?? "", decimal);
    if (!day || raw == null) {
      warnings.push(tr("Skipped a line that couldn't be read: {line}", { line: r.join(" ").slice(0, 80) }));
      continue;
    }
    let amount = D(raw);
    // "Af"/"Debet"/"D": money out, when the amount column has no sign of its own.
    if (iSign >= 0 && /^(af|d|debet|debit)$/i.test((r[iSign] ?? "").trim())) amount = amount.abs().neg();
    // Revolut charges its fee next to the amount; the balance already has it off.
    const fee = iFee >= 0 ? parseNumber(r[iFee] ?? "", decimal) : null;
    if (fee) amount = amount.minus(D(fee).abs());
    const bal = iBalance >= 0 ? parseNumber(r[iBalance] ?? "", decimal) : null;
    const currency = iCurrency >= 0 ? (r[iCurrency] ?? "").trim().toUpperCase() : "";
    if (FUND.test(r.join(" "))) fund = true;
    // Without an account column, Revolut's product and the currency tell the accounts apart.
    const account =
      iAccount >= 0
        ? (r[iAccount] ?? "").trim()
        : [iProduct >= 0 ? (r[iProduct] ?? "").trim() : "", currency].filter(Boolean).join(" ");
    lines.push({
      day,
      amount,
      balanceAfter: bal == null ? null : D(bal),
      description: iDesc.map((i) => r[i] ?? "").join(" "),
      account,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    });
  }
  if (fund)
    warnings.push(
      tr(
        "This file mentions a money market fund (such as Revolut's Flexible Cash Funds). In box 3 that's not a bank balance but other assets: keep it in an account of its own.",
      ),
    );
  if (unfinished)
    warnings.push(
      trn(
        unfinished,
        "Skipped {n} line that was pending, reverted or declined.",
        "Skipped {n} lines that were pending, reverted or declined.",
      ),
    );
  return { lines, warnings };
}

/**
 * ABN AMRO's TAB/TXT export: no header; account, currency, date (YYYYMMDD), balance before, balance
 * after, value date, amount, description.
 */
function looksLikeAbnTab(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim());
  if (!first) return false;
  const c = first.split("\t");
  return c.length >= 8 && /^\d{6,}$/.test(c[0]!.trim()) && /^\d{8}$/.test(c[2]!.trim());
}

function fromAbnTab(text: string): { lines: BankLine[]; warnings: string[] } {
  const lines: BankLine[] = [];
  for (const l of text.split(/\r?\n/)) {
    const c = l.split("\t");
    if (c.length < 8) continue;
    const day = toDay(c[2]!, true);
    const after = parseNumber(c[4]!, ",");
    const amount = parseNumber(c[6]!, ",");
    if (!day || after == null || amount == null) continue;
    lines.push({
      day,
      amount: D(amount),
      balanceAfter: D(after),
      description: c.slice(7).join(" ").trim(),
      account: c[0]!.trim(),
    });
  }
  return { lines, warnings: [] };
}

const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
// An XML value: plain text, or the text of an element that also has attributes.
const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") return text((v as Record<string, unknown>)["#text"]);
  if (typeof v === "string") return v;
  return typeof v === "number" || typeof v === "boolean" ? String(v) : "";
};

/** CAMT.053 (ISO 20022 bank statement): balances and entries per statement. */
function fromCamt(xml: string): { lines: BankLine[]; warnings: string[] } {
  const doc = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => ["Stmt", "Bal", "Ntry", "TxDtls", "Ustrd"].includes(name),
  }).parse(xml) as Record<string, unknown>;
  const root = (doc.Document ?? doc) as Record<string, unknown>;
  const statements = arr((root.BkToCstmrStmt as Record<string, unknown> | undefined)?.Stmt) as Record<
    string,
    unknown
  >[];
  if (!statements.length) throw new Error(tr("No statements found in this CAMT.053 file"));
  const signed = (amt: unknown, ind: unknown) => {
    const v = D(text(amt) || 0);
    return text(ind) === "DBIT" ? v.neg() : v;
  };
  const dateOf = (d: unknown) => {
    const o = d as Record<string, unknown> | undefined;
    return (text(o?.Dt) || text(o?.DtTm)).slice(0, 10);
  };
  const lines: BankLine[] = [];
  const warnings: string[] = [];
  const stmts = statements.map((st) => {
    const acct = st.Acct as Record<string, unknown> | undefined;
    const id = acct?.Id as Record<string, unknown> | undefined;
    const account = text(id?.IBAN) || text((id?.Othr as Record<string, unknown> | undefined)?.Id);
    const bals = arr(st.Bal) as Record<string, unknown>[];
    const code = (b: Record<string, unknown>) =>
      text(((b.Tp as Record<string, unknown> | undefined)?.CdOrPrtry as Record<string, unknown> | undefined)?.Cd);
    const opening = bals.find((b) => code(b) === "OPBD" || code(b) === "PRCD");
    const closing = bals.find((b) => code(b) === "CLBD");
    const entries = (arr(st.Ntry) as Record<string, unknown>[])
      .filter((n) => !n.Sts || ["BOOK", ""].includes(text((n.Sts as Record<string, unknown>)?.Cd ?? n.Sts)))
      .map((n) => {
        const details = arr((n.NtryDtls as Record<string, unknown> | undefined)?.TxDtls) as Record<string, unknown>[];
        const ustrd = details.flatMap((t) => arr((t.RmtInf as Record<string, unknown> | undefined)?.Ustrd).map(text));
        return {
          day: dateOf(n.BookgDt) || dateOf(n.ValDt),
          amount: signed(n.Amt, n.CdtDbtInd),
          description: [text(n.AddtlNtryInf), ...ustrd].filter(Boolean).join(" "),
        };
      });
    return {
      account,
      opening: opening ? { day: dateOf(opening.Dt), amount: signed(opening.Amt, opening.CdtDbtInd) } : null,
      closing: closing ? { day: dateOf(closing.Dt), amount: signed(closing.Amt, closing.CdtDbtInd) } : null,
      entries,
    };
  });
  stmts.sort((a, b) =>
    (a.opening?.day ?? a.entries[0]?.day ?? "").localeCompare(b.opening?.day ?? b.entries[0]?.day ?? ""),
  );
  for (const st of stmts) {
    let bal = st.opening?.amount ?? null;
    if (bal == null && st.closing) {
      // Work back from the closing balance.
      bal = st.entries.reduce((b, e) => b.minus(e.amount), st.closing.amount);
    }
    for (const e of st.entries.sort((a, b) => a.day.localeCompare(b.day))) {
      bal = bal == null ? null : bal.plus(e.amount);
      lines.push({ day: e.day, amount: e.amount, balanceAfter: bal, description: e.description, account: st.account });
    }
    if (bal != null && st.closing && !bal.eq(st.closing.amount))
      warnings.push(
        st.account
          ? tr("Statement for {account} up to {day} doesn't add up to its closing balance.", {
              account: st.account,
              day: st.closing.day,
            })
          : tr("Statement for the account up to {day} doesn't add up to its closing balance.", { day: st.closing.day }),
      );
  }
  return { lines, warnings };
}

/**
 * MT940 (SWIFT customer statement, which most Dutch banks offer, Knab by default): per statement the
 * account (:25:), opening balance (:60F:/:60M:), entries (:61:, with their description in :86:) and
 * closing balance (:62F:/:62M:). Amounts use a decimal comma; C is credit, D debit, RC/RD reversals.
 */
function looksLikeMt940(text: string): boolean {
  return /^:20:/m.test(text) && /^:61:/m.test(text) && /^:6[02][FM]:/m.test(text);
}

function fromMt940(text: string): { lines: BankLine[]; warnings: string[] } {
  // Fields start with ":tag:" on a new line; other lines continue the field before.
  const fields: { tag: string; value: string }[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(raw);
    if (m) fields.push({ tag: m[1]!, value: m[2]! });
    else if (fields.length && raw.trim() && !/^-\}?$/.test(raw.trim())) fields.at(-1)!.value += ` ${raw.trim()}`;
  }
  const year = (yy: string) => 2000 + Number(yy);
  const balance = (v: string) => {
    const m = /^([CD])(\d{2})(\d{2})(\d{2})[A-Z]{3}([\d,.]+)/.exec(v.trim());
    if (!m) return null;
    const amount = D(m[5]!.replace(",", "."));
    return { day: `${year(m[2]!)}-${m[3]}-${m[4]}`, amount: m[1] === "D" ? amount.neg() : amount };
  };
  type Entry = { day: string; amount: Decimal; description: string };
  const statements: {
    account: string;
    opening: ReturnType<typeof balance>;
    closing: ReturnType<typeof balance>;
    entries: Entry[];
  }[] = [];
  const warnings: string[] = [];
  let st: (typeof statements)[number] | null = null;
  let previous = "";
  for (const f of fields) {
    const after = previous;
    previous = f.tag;
    if (f.tag === "20" || !st) {
      st = { account: "", opening: null, closing: null, entries: [] };
      statements.push(st);
      if (f.tag === "20") continue;
    }
    if (f.tag === "25") st.account = (f.value.trim().split(/\s+/)[0] ?? "").replace(/EUR$/, "");
    else if (f.tag === "60F" || f.tag === "60M") st.opening = balance(f.value);
    else if (f.tag === "62F" || f.tag === "62M") st.closing = balance(f.value);
    else if (f.tag === "61") {
      // Value date YYMMDD, booking date MMDD (optional), mark, funds code (optional), amount.
      const m = /^(\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?(RC|RD|EC|ED|C|D)[A-Z]?(\d+(?:,\d*)?)/.exec(f.value.trim());
      if (!m) {
        warnings.push(tr("Skipped a line that couldn't be read: {line}", { line: f.value.slice(0, 80) }));
        continue;
      }
      let y = year(m[1]!);
      const [vm, bm] = [Number(m[2]), m[4] ? Number(m[4]) : null];
      // A booking date across the turn of the year from its value date.
      if (bm != null && bm === 12 && vm === 1) y -= 1;
      else if (bm != null && bm === 1 && vm === 12) y += 1;
      const day = bm != null ? `${y}-${m[4]}-${m[5]}` : `${year(m[1]!)}-${m[2]}-${m[3]}`;
      const amount = D(m[7]!.replace(",", "."));
      // Credit and a reversed debit add to the balance; debit and a reversed credit take away.
      const out = m[6] === "D" || m[6] === "RC" || m[6] === "ED";
      st.entries.push({ day, amount: out ? amount.neg() : amount, description: "" });
      // Describes the entry right before it; an :86: elsewhere is about the whole statement.
    } else if (f.tag === "86" && after === "61" && st.entries.length) st.entries.at(-1)!.description = f.value.trim();
  }
  const lines: BankLine[] = [];
  const kept = statements.filter((s) => s.entries.length || s.opening || s.closing);
  kept.sort((a, b) =>
    (a.opening?.day ?? a.entries[0]?.day ?? "").localeCompare(b.opening?.day ?? b.entries[0]?.day ?? ""),
  );
  for (const s of kept) {
    let bal = s.opening?.amount ?? (s.closing ? s.entries.reduce((b, e) => b.minus(e.amount), s.closing.amount) : null);
    for (const e of s.entries) {
      bal = bal == null ? null : bal.plus(e.amount);
      lines.push({ ...e, balanceAfter: bal, account: s.account });
    }
    if (bal != null && s.closing && !bal.eq(s.closing.amount))
      warnings.push(
        s.account
          ? tr("Statement for {account} up to {day} doesn't add up to its closing balance.", {
              account: s.account,
              day: s.closing.day,
            })
          : tr("Statement for the account up to {day} doesn't add up to its closing balance.", { day: s.closing.day }),
      );
  }
  return { lines, warnings };
}

// ---- Balances and years ----

/**
 * Puts one account's lines in date order. Exports are often newest first; within a day, the
 * order that makes the balances add up wins.
 */
function chronological(lines: BankLine[]): BankLine[] {
  const fits = (ls: BankLine[]) => {
    let ok = 0;
    for (let i = 1; i < ls.length; i++) {
      const [p, c] = [ls[i - 1]!, ls[i]!];
      if (p.balanceAfter && c.balanceAfter && p.balanceAfter.plus(c.amount).eq(c.balanceAfter)) ok++;
    }
    return ok;
  };
  const forward = [...lines];
  const backward = [...lines].reverse();
  const pick = fits(backward) > fits(forward) ? backward : forward;
  // Stable sort by day keeps the chosen order within a day.
  return pick
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.day.localeCompare(b.l.day) || a.i - b.i)
    .map((x) => x.l);
}

// Euros per unit of the account's currency on a day; 1 for euros.
type Rate = (day: string) => Decimal;
const ONE: Rate = () => D(1);

function summarize(lines: BankLine[], today: string, rate: Rate = ONE): BankYear[] {
  if (!lines.length) return [];
  const first = lines[0]!;
  const last = lines.at(-1)!;
  const firstYear = Number(first.day.slice(0, 4));
  const lastYear = Number(last.day.slice(0, 4));
  const thisYear = Number(today.slice(0, 4));
  const out: BankYear[] = [];
  for (let y = firstYear; y <= Math.min(lastYear + 1, thisYear); y++) {
    let valueEur: string | null = null;
    let estimated = false;
    const before = lines.filter((l) => l.day <= `${y - 1}-12-31`).at(-1);
    // The balance on 1 January at the rate of 31 December (or the last business day before it).
    const peil = rate(`${y - 1}-12-31`);
    if (before?.balanceAfter) {
      valueEur = money2(before.balanceAfter.mul(peil));
      // The year after the file: only as good as the file reaching the end of December.
      estimated = y === lastYear + 1 && last.day < `${lastYear}-12-01`;
    } else if (y === firstYear && first.balanceAfter) {
      valueEur = money2(first.balanceAfter.minus(first.amount).mul(peil));
      estimated = first.day > `${y}-01-31`;
    }
    const inYear = lines.filter((l) => l.day.startsWith(`${y}-`));
    let interest = ZERO;
    let inEur = ZERO;
    let outEur = ZERO;
    for (const l of inYear) {
      const eur = l.amount.mul(rate(l.day));
      if (INTEREST.test(l.description)) interest = interest.plus(eur);
      else if (eur.gt(0)) inEur = inEur.plus(eur);
      else outEur = outEur.plus(eur.neg());
    }
    const fullYear =
      (lines.some((l) => l.day < `${y}-01-01`) || first.day <= `${y}-01-31`) &&
      (lines.some((l) => l.day > `${y}-12-31`) || last.day >= `${y}-12-01`);
    if (valueEur == null && !inYear.length) continue;
    out.push({
      year: y,
      valueEur,
      valueEstimated: estimated,
      interestEur: money2(interest),
      inEur: money2(inEur),
      outEur: money2(outEur),
      fullYear,
      lines: inYear.length,
    });
  }
  return out;
}

export interface ParsedBankExport {
  format: BankImport["format"];
  lines: BankLine[];
  warnings: string[];
}

/** Reads the file's lines; `summarizeExport` turns them into values per year. */
export function parseBankExport(content: string): ParsedBankExport {
  const trimmed = content.replace(/^\uFEFF/, "").trimStart();
  let format: BankImport["format"];
  let parsed: { lines: BankLine[]; warnings: string[] };
  if (trimmed.startsWith("<") && /BkToCstmrStmt/.test(trimmed)) {
    format = "camt053";
    parsed = fromCamt(trimmed);
  } else if (looksLikeMt940(trimmed)) {
    format = "mt940";
    parsed = fromMt940(trimmed);
  } else if (looksLikeAbnTab(trimmed)) {
    format = "abn-tab";
    parsed = fromAbnTab(trimmed);
  } else {
    format = "csv";
    parsed = fromCsv(trimmed);
  }
  if (!parsed.lines.length) throw new Error(tr("No transactions found in this file"));
  return { format, ...parsed };
}

/** The other currencies in a parsed export, with the days a rate is needed for each. */
export function foreignDays(parsed: ParsedBankExport, today: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of parsed.lines) {
    if (!l.currency || l.currency === "EUR") continue;
    const days = out.get(l.currency) ?? new Set<string>();
    days.add(l.day);
    out.set(l.currency, days);
  }
  // Every peildatum from the one before the first line up to the last one that has passed.
  const thisYear = Number(today.slice(0, 4));
  for (const days of out.values()) {
    const first = Math.min(...[...days].map((d) => Number(d.slice(0, 4))));
    for (let y = first - 1; y < thisYear; y++) days.add(`${y}-12-31`);
  }
  return out;
}

/**
 * Values per year per account. An account in another currency needs `eurRate` (euros per unit on a
 * day); without it its amounts stay in that currency, with a warning.
 */
export function summarizeExport(
  parsed: ParsedBankExport,
  opts: { closingBalance?: string; today: string },
  eurRate?: (currency: string, day: string) => Decimal | undefined,
): BankImport {
  const byAccount = new Map<string, BankLine[]>();
  for (const l of parsed.lines) byAccount.set(l.account, [...(byAccount.get(l.account) ?? []), l]);
  const hasBalances = parsed.lines.some((l) => l.balanceAfter);
  const closing = opts.closingBalance?.trim() ? D(opts.closingBalance.replace(",", ".")) : null;
  const warnings = [...parsed.warnings];

  const accounts: BankAccountSummary[] = [];
  for (const [account, ls] of byAccount) {
    let lines = chronological(ls);
    if (!hasBalances && closing && byAccount.size === 1) {
      // Work back from the balance after the last line.
      let bal = closing;
      const withBal: BankLine[] = [];
      for (let i = lines.length - 1; i >= 0; i--) {
        withBal.unshift({ ...lines[i]!, balanceAfter: bal });
        bal = bal.minus(lines[i]!.amount);
      }
      lines = withBal;
    }
    const currency = lines[0]!.currency ?? null;
    let years = summarize(lines, opts.today);
    let inEuros = true;
    if (currency && currency !== "EUR") {
      const name = account || currency;
      try {
        if (!eurRate) throw new Error("no rates");
        years = summarize(lines, opts.today, (day) => {
          const r = eurRate(currency, day);
          if (!r) throw new Error(`no rate for ${day}`);
          return r;
        });
        warnings.push(
          tr("{account}: converted from {currency} at the ECB rate (of 31 December for the balance).", {
            account: name,
            currency,
          }),
        );
      } catch {
        inEuros = false;
        warnings.push(
          tr("{account}: the amounts are in {currency}; no exchange rates were found to convert them.", {
            account: name,
            currency,
          }),
        );
      }
    }
    accounts.push({
      account,
      currency,
      inEuros,
      from: lines[0]!.day,
      to: lines.at(-1)!.day,
      lines: lines.length,
      years,
    });
  }
  return {
    format: parsed.format,
    accounts: accounts.sort((a, b) => b.lines - a.lines),
    needsClosingBalance: !hasBalances && !closing,
    warnings: [...new Set(warnings)].slice(0, 20),
  };
}

/**
 * Reads a bank export, leaving other currencies unconverted. `closingBalance`: the balance after the
 * file's last line, for files without balances.
 */
export function readBankExport(content: string, opts: { closingBalance?: string; today: string }): BankImport {
  return summarizeExport(parseBankExport(content), opts);
}
