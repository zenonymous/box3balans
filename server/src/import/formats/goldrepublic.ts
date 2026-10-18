import { msg, tr, trn } from "../../i18n/index.js";
import { D, type Decimal, str } from "../../lib/decimal.js";
import type { FoundValue, StatementPage } from "../yearStatement.js";
import { type Converted, type TemplateRow, converted, skip } from "./types.js";

/**
 * Goldrepublic's account statement (website → Afschriften, or the app → Transacties; a PDF read in the
 * browser): the balance at the start, every transaction with the details of each order, and the
 * balance at the end. Built on a real statement over 2025, in English with partly Dutch descriptions.
 *
 *   Opening balance   Jan 1 2025
 *   Gold   12.345 gr   €80,000.00/ kg   €987.60
 *   Total   €1,234.56
 *   Savings Order   07-01-2025   Processing order 123456   Gold   €-100.50   €0.00
 *   Execution Date   02-01-2025 13:05:02
 *   Action   Buy / Transaction Value €100.00 / Fee €0.50 / Handling Costs €0.10 / Volume 1.234
 *   Cost Order   03-02-2025   Opslagkosten januari 2025   -   €-1.23   €0.00
 *   Closing balance   Dec 31 2025 …
 *
 * Columns are apart by two or more spaces (pdftotext -layout) or three (the app's PDF reader).
 */

type Metal = "Gold" | "Silver" | "Platinum" | "Palladium";
const SYMBOL: Record<Metal, string> = { Gold: "XAU", Silver: "XAG", Platinum: "XPT", Palladium: "XPD" };

export interface Balance {
  date: string | null; // YYYY-MM-DD
  cash: string;
  metals: Partial<Record<Metal, { grams: string; value: string }>>;
  total: string;
  page: number;
  line: string; // the Total line
}

export interface Order {
  number: string;
  metal: Metal;
  vault: string;
  action: "buy" | "sell";
  executed: { date: string; time: string } | null;
  value: string;
  fee: string; // fee plus handling costs
  grams: string;
  total: string;
}

export interface Entry {
  type: string; // "Direct Debit", "Savings Order", "Cost Order" …
  date: string; // booking date, YYYY-MM-DD
  description: string;
  amount: string; // euros, negative when it leaves the money deposit
  page: number;
  line: string;
  order?: Order;
}

export interface GoldrepublicStatement {
  opening: Balance | null;
  closing: Balance | null;
  entries: Entry[];
  /** Cash and grams that don't add up from the opening to the closing balance (empty when they do). */
  gaps: string[];
}

const COLS = /\s{2,}/;
const EURO = /^€\s?(-?)([\d,]+\.\d{2})$/;
const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  mrt: "03",
  apr: "04",
  may: "05",
  mei: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  okt: "10",
  nov: "11",
  dec: "12",
};
const LONG_DATE = /\b([A-Z][a-z]{2})\w* (\d{1,2}),? (\d{4})\b/;
const HEADER = /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*)\s{2,}(\d{2})-(\d{2})-(\d{4})\s{2,}(.+)$/;
const DETAIL =
  /^(Product|Date Submitted|Execution Date|Action|Transaction Value|Fee|Handling Costs|Volume|Total)\s{2,}(.+)$/;
const BALANCE = /^(Cash|Gold|Silver|Platinum|Palladium)\s{2,}(.+)$/;

/** "€-1,234.56" → "-1234.56". */
function euros(raw: string | undefined): string | null {
  const m = EURO.exec((raw ?? "").trim());
  return m ? `${m[1]}${m[2]!.replace(/,/g, "")}` : null;
}

function longDate(line: string): string | null {
  const m = LONG_DATE.exec(line);
  const month = m && MONTHS[m[1]!.toLowerCase()];
  return m && month ? `${m[3]}-${month}-${m[2]!.padStart(2, "0")}` : null;
}

const isMetal = (s: string): s is Metal => s in SYMBOL;
const sum = (...xs: (string | null | undefined)[]) => xs.reduce((a, x) => a.plus(x ?? 0), D(0));

/** The statement, or null when the text isn't a Goldrepublic account statement. */
export function readGoldrepublic(pages: StatementPage[]): GoldrepublicStatement | null {
  const all = pages.map((p) => p.text).join("\n");
  if (!/goldrepublic/i.test(all) || !/^\s*Account Statement\s*$/m.test(all) || !/^\s*Opening balance\b/m.test(all))
    return null;

  let opening: Balance | null = null;
  let closing: Balance | null = null;
  const entries: Entry[] = [];
  // Where the lines below belong: a balance being read, or the order whose details follow.
  let balance: Balance | null = null;
  let waitingForDate = false;
  let details: Record<string, string> | null = null;

  const finishOrder = () => {
    const e = entries.at(-1);
    if (!details || !e) return;
    const [product = "", vault = ""] = (details.Product ?? "").split(",").map((s) => s.trim());
    const metal = isMetal(product) ? product : null;
    const action = details.Action?.toLowerCase();
    const value = euros(details["Transaction Value"]);
    const total = euros(details.Total);
    const grams = (details.Volume ?? "").replace(/,/g, "");
    const exec = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}:\d{2}:\d{2}))?/.exec(details["Execution Date"] ?? "");
    if (metal && (action === "buy" || action === "sell") && value && total && /^\d+(\.\d+)?$/.test(grams))
      e.order = {
        number: /\b(\d+)\b/.exec(e.description)?.[1] ?? "",
        metal,
        vault,
        action,
        executed: exec ? { date: `${exec[3]}-${exec[2]}-${exec[1]}`, time: exec[4] ?? "12:00:00" } : null,
        value,
        fee: str(sum(euros(details.Fee), euros(details["Handling Costs"]))),
        grams,
        total,
      };
    details = null;
  };

  for (const { page, text } of pages)
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (/^Opening balance\b/.test(line) || /^Closing balance\b/.test(line)) {
        finishOrder();
        balance = { date: longDate(line), cash: "0", metals: {}, total: "0", page, line };
        if (/^Opening/.test(line)) opening = balance;
        else closing = balance;
        waitingForDate = !balance.date;
        continue;
      }
      if (balance) {
        if (waitingForDate && longDate(line) && !COLS.test(line)) {
          balance.date = longDate(line);
          waitingForDate = false;
          continue;
        }
        const b = BALANCE.exec(line);
        if (b) {
          const cols = b[2]!.split(COLS);
          const value = euros(cols.at(-1));
          const grams = /^([\d,]+\.\d+) gr$/.exec(cols[0] ?? "")?.[1]?.replace(/,/g, "");
          if (value && b[1] === "Cash") balance.cash = value;
          else if (value && grams && isMetal(b[1]!)) balance.metals[b[1]] = { grams, value };
          continue;
        }
        const total = /^Total\s{2,}(\S+)$/.exec(line);
        if (total && euros(total[1])) {
          balance.total = euros(total[1])!;
          balance.line = line;
          balance.page = page;
          balance = null;
        }
        continue;
      }
      const h = HEADER.exec(line);
      if (h) {
        finishOrder();
        // Description, bullion ("-" or a metal), amount and running balance.
        const cols = h[5]!.split(COLS);
        const amount = euros(cols.at(-2));
        if (cols.length >= 3 && amount && euros(cols.at(-1))) {
          entries.push({
            type: h[1]!,
            date: `${h[4]}-${h[3]}-${h[2]}`,
            description: cols.slice(0, -3).join(" ") || cols[0]!,
            amount,
            page,
            line,
          });
          if (/order$/i.test(h[1]!) && h[1] !== "Cost Order") details = {};
          continue;
        }
      }
      const d = DETAIL.exec(line);
      if (d && details) details[d[1]!] = d[2]!.trim();
    }
  finishOrder();

  // Does it add up? Cash from every entry, grams from every order.
  const gaps: string[] = [];
  if (opening && closing) {
    const cash = sum(opening.cash, ...entries.map((e) => e.amount)).minus(closing.cash);
    if (!cash.isZero()) gaps.push(tr("cash differs by €{amount}", { amount: str(cash) }));
    for (const metal of Object.keys(SYMBOL) as Metal[]) {
      let grams = sum(opening.metals[metal]?.grams);
      for (const e of entries)
        if (e.order?.metal === metal) grams = grams[e.order.action === "buy" ? "plus" : "minus"](e.order.grams);
      grams = grams.minus(closing.metals[metal]?.grams ?? 0);
      if (!grams.isZero()) gaps.push(tr("{metal} differs by {grams} g", { metal: tr(metal), grams: str(grams) }));
    }
  }
  return { opening, closing, entries, gaps };
}

const DEPOSITS = new Set(["Direct Debit", "Deposit"]);

/**
 * The statement as transactions on a vault account: purchases and sales in grams (at the moment the
 * order was carried out, with the fee and handling costs), money in and out, and the monthly storage
 * costs as costs in euros. The money deposit is kept too, so it ends at the statement's cash. What
 * the account held at the start is passed on, for the preview to check against Box3balans.
 */
export function goldrepublicTransactions(s: GoldrepublicStatement): Converted {
  const out = converted({ settleCash: true });
  const cash = (date: string, type: TemplateRow["type"], amount: string, notes: string): TemplateRow => ({
    date,
    type,
    symbol: "EUR",
    assetType: "cash",
    quantity: amount.replace(/^-/, ""),
    notes,
  });
  let unread = 0;
  for (const e of s.entries) {
    if (e.order) {
      const o = e.order;
      out.rows.push({
        date: o.executed?.date ?? e.date,
        time: o.executed?.time,
        type: o.action,
        symbol: SYMBOL[o.metal],
        assetType: "metal",
        quantity: o.grams,
        total: o.value,
        currency: "EUR",
        fee: Number(o.fee) ? o.fee : undefined,
        notes: [`${e.type} ${o.number}`, o.vault].filter(Boolean).join(", "),
        id: o.number ? `goldrepublic:${o.number}` : undefined,
      });
    } else if (/order$/i.test(e.type) && e.type !== "Cost Order") unread++;
    else if (DEPOSITS.has(e.type) && !e.amount.startsWith("-"))
      out.rows.push(cash(e.date, "deposit", e.amount, e.description));
    else if (e.type === "Withdrawal" && e.amount.startsWith("-"))
      out.rows.push(cash(e.date, "withdrawal", e.amount, e.description));
    else if (e.type === "Cost Order" && e.amount.startsWith("-"))
      out.rows.push(cash(e.date, "fee", e.amount, e.description));
    else skip(out.skipped, tr("Other kinds: {kind}", { kind: e.type }));
  }
  if (unread)
    out.warnings.push(
      trn(
        unread,
        "{n} order couldn't be read (no product, quantity or amount): add it by hand.",
        "{n} orders couldn't be read (no product, quantity or amount): add them by hand.",
      ),
    );
  if (s.gaps.length)
    out.warnings.push(
      tr("After reading, the statement doesn't add up ({gaps}): check the balances after importing.", {
        gaps: s.gaps.join(", "),
      }),
    );
  if (s.opening?.date)
    out.opening = {
      date: s.opening.date,
      metals: Object.entries(s.opening.metals).map(([metal, m]) => ({ code: SYMBOL[metal as Metal], grams: m.grams })),
      cash: [{ currency: "EUR", amount: s.opening.cash }],
    };
  out.rows.sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));
  return out;
}

/** Recognised PDF statements that hold transactions (the CSV import reads them like an export). */
export const goldrepublicStatement = {
  id: "goldrepublic",
  label: msg("Goldrepublic account statement"),
  read: readGoldrepublic,
  convert: goldrepublicTransactions,
};

/**
 * For an account kept with values per year: the total on 1 January (the opening balance) and on
 * 31 December (the closing balance, the value on 1 January of the next year), and per calendar year
 * the money in, the money out and the costs (storage, fees and handling). Ticked when the statement
 * covers the whole year and adds up.
 */
export function goldrepublicYearValues(s: GoldrepublicStatement): { year: number | null; found: FoundValue[] } {
  const found: FoundValue[] = [];
  const sure = !s.gaps.length;
  const jan1 = s.opening?.date?.endsWith("-01-01") ? Number(s.opening.date.slice(0, 4)) : null;
  const dec31 = s.closing?.date?.endsWith("-12-31") ? Number(s.closing.date.slice(0, 4)) : null;
  if (s.opening && jan1 != null)
    found.push({
      year: jan1,
      field: "valueEur",
      amount: s.opening.total,
      page: s.opening.page,
      line: s.opening.line,
      sure,
    });
  if (s.closing && dec31 != null)
    found.push({
      year: dec31 + 1,
      field: "valueEur",
      amount: s.closing.total,
      page: s.closing.page,
      line: s.closing.line,
      sure,
    });
  const years = [...new Set(s.entries.map((e) => Number(e.date.slice(0, 4))))].sort();
  for (const year of years) {
    const whole = jan1 === year && dec31 === year;
    const of = s.entries.filter((e) => Number(e.date.slice(0, 4)) === year);
    const flows: [FoundValue["field"], Entry[], (e: Entry) => Decimal][] = [
      ["inEur", of.filter((e) => DEPOSITS.has(e.type) && !e.amount.startsWith("-")), (e) => D(e.amount)],
      ["outEur", of.filter((e) => e.type === "Withdrawal"), (e) => D(e.amount).abs()],
      [
        "costsEur",
        of.filter((e) => e.type === "Cost Order" || (e.order && Number(e.order.fee))),
        (e) => (e.order ? D(e.order.fee) : D(e.amount).abs()),
      ],
    ];
    for (const [field, list, value] of flows) {
      if (!list.length && !whole) continue;
      found.push({
        year,
        field,
        amount: str(list.reduce((a, e) => a.plus(value(e)), D(0))),
        page: list[0]?.page ?? s.opening?.page ?? 1,
        line: list.length
          ? trn(list.length, "{n} line, like: {line}", "{n} lines, like: {line}", { line: list[0]!.line })
          : tr("none in {year}", { year }),
        sure: sure && whole,
      });
    }
  }
  return { year: jan1 ?? dec31, found };
}
