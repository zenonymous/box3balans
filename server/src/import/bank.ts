import { XMLParser } from "fast-xml-parser";
import { D, type Decimal, ZERO, money2 } from "../lib/decimal.js";
import { type DecimalMark, detectDateOrder, detectDecimal, detectDelimiter, parseCsv, parseNumber } from "./parse.js";
import { tr } from "../i18n/index.js";

/**
 * Reads a bank's transaction export (CSV, ABN AMRO's TAB file or CAMT.053) and turns it into what
 * box 3 needs per year: the balance on 1 January, interest received, and money in and out.
 */

export interface BankLine {
  day: string; // YYYY-MM-DD
  amount: Decimal; // + received, − paid
  balanceAfter: Decimal | null;
  description: string;
  account: string; // the own account the line belongs to ("" when the file doesn't say)
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
  from: string;
  to: string;
  lines: number;
  years: BankYear[];
}

export interface BankImport {
  format: "camt053" | "abn-tab" | "csv";
  accounts: BankAccountSummary[];
  // No balances in the file: the balance after its last line is needed to work out the others.
  needsClosingBalance: boolean;
  warnings: string[];
}

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
  date: /^(datum|date|transactiedatum|boekdatum|boekingsdatum|transaction ?date|booking ?date)$/i,
  amount: /^(bedrag( \(eur\))?|bedrag eur|amount|transactiebedrag|amount \(eur\))$/i,
  sign: /^(af ?\/? ?bij|debet ?\/ ?credit|credit ?\/ ?debet|d\/c|af\/bij)$/i,
  balance: /^(saldo na (mutatie|trn|boeking|transactie)|saldo|balance( after)?|saldo na mutatie \(eur\))$/i,
  account: /^(rekening|iban\/bban|rekeningnummer|account|iban)$/i,
  description:
    /^(naam ?\/ ?omschrijving|omschrijving(-\d)?|mededelingen|description|naam tegenpartij|naam|name|counterparty|mutatiesoort)$/i,
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
    const day = toDay(r[iDate] ?? "", dmy);
    const raw = parseNumber(r[iAmount] ?? "", decimal);
    if (!day || raw == null) {
      warnings.push(tr("Skipped a line that couldn't be read: {line}", { line: r.join(" ").slice(0, 80) }));
      continue;
    }
    let amount = D(raw);
    // "Af"/"Debet"/"D": money out, when the amount column has no sign of its own.
    if (iSign >= 0 && /^(af|d|debet|debit)$/i.test((r[iSign] ?? "").trim())) amount = amount.abs().neg();
    const bal = iBalance >= 0 ? parseNumber(r[iBalance] ?? "", decimal) : null;
    lines.push({
      day,
      amount,
      balanceAfter: bal == null ? null : D(bal),
      description: iDesc.map((i) => r[i] ?? "").join(" "),
      account: iAccount >= 0 ? (r[iAccount] ?? "").trim() : "",
    });
  }
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
const text = (v: unknown): string =>
  v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v);

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

function summarize(lines: BankLine[], today: string): BankYear[] {
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
    if (before?.balanceAfter) {
      valueEur = money2(before.balanceAfter);
      // The year after the file: only as good as the file reaching the end of December.
      estimated = y === lastYear + 1 && last.day < `${lastYear}-12-01`;
    } else if (y === firstYear && first.balanceAfter) {
      valueEur = money2(first.balanceAfter.minus(first.amount));
      estimated = first.day > `${y}-01-31`;
    }
    const inYear = lines.filter((l) => l.day.startsWith(`${y}-`));
    let interest = ZERO;
    let inEur = ZERO;
    let outEur = ZERO;
    for (const l of inYear) {
      if (INTEREST.test(l.description)) interest = interest.plus(l.amount);
      else if (l.amount.gt(0)) inEur = inEur.plus(l.amount);
      else outEur = outEur.plus(l.amount.neg());
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

/** Reads a bank export. `closingBalance`: the balance after the file's last line, for files without balances. */
export function readBankExport(content: string, opts: { closingBalance?: string; today: string }): BankImport {
  const trimmed = content.replace(/^\uFEFF/, "").trimStart();
  let format: BankImport["format"];
  let parsed: { lines: BankLine[]; warnings: string[] };
  if (trimmed.startsWith("<") && /BkToCstmrStmt/.test(trimmed)) {
    format = "camt053";
    parsed = fromCamt(trimmed);
  } else if (looksLikeAbnTab(trimmed)) {
    format = "abn-tab";
    parsed = fromAbnTab(trimmed);
  } else {
    format = "csv";
    parsed = fromCsv(trimmed);
  }
  if (!parsed.lines.length) throw new Error(tr("No transactions found in this file"));

  const byAccount = new Map<string, BankLine[]>();
  for (const l of parsed.lines) byAccount.set(l.account, [...(byAccount.get(l.account) ?? []), l]);
  const hasBalances = parsed.lines.some((l) => l.balanceAfter);
  const closing = opts.closingBalance?.trim() ? D(opts.closingBalance.replace(",", ".")) : null;

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
    accounts.push({
      account,
      from: lines[0]!.day,
      to: lines.at(-1)!.day,
      lines: lines.length,
      years: summarize(lines, opts.today),
    });
  }
  return {
    format,
    accounts: accounts.sort((a, b) => b.lines - a.lines),
    needsClosingBalance: !hasBalances && !closing,
    warnings: [...new Set(parsed.warnings)].slice(0, 20),
  };
}
