import { LedgerData } from "./valuation.js";
import type { DB } from "../db/client.js";
import { accounts, assets } from "../db/schema.js";
import { D, type Decimal } from "../lib/decimal.js";
import { type Box3Config, type Box3Year, computeBox3Year } from "./box3.js";
import { type ActualReturn, actualReturn } from "./box3Actual.js";
import type { AttributionNote } from "./household.js";
import { loadEvents } from "./performance.js";
import { getCostMethod } from "./settings.js";
import { loadYearly, taxWithheldAbroad } from "./yearly.js";

/** The parts of box 3 in the order the income tax return asks for them. */
export const RETURN_SECTIONS = [
  "bank",
  "investments",
  "crypto",
  "property",
  "receivables",
  "other",
  "green",
  "debts",
] as const;
export type ReturnSection = (typeof RETURN_SECTIONS)[number];

export interface ReturnLine {
  accountId: number;
  name: string;
  kind: string;
  owner: string;
  ownerChildId: number | null;
  foreign: boolean;
  /** On 1 January, whole euros as the return asks: assets rounded down, debts up. */
  valueEur: number;
  /** The part that counts in your (and your fiscal partner's) return. */
  countedEur: number;
  countedPct: string;
  note?: AttributionNote;
  /** What it holds, for accounts with transactions (coins, funds). */
  details: { name: string; symbol: string; valueEur: number }[];
  /** During the year: interest or rent received; for a debt, the interest paid. */
  incomeEur?: number;
  /** Dividends during the year (gross) and the tax withheld on them. */
  dividendEur?: number;
  dividendTaxEur?: number;
  /** Kept as values per year: tax withheld abroad on its interest, and the country that withheld it. */
  interestTaxEur?: number;
  interestTaxCountry?: string;
}

/** Tax withheld in one country, with the gross amount it was withheld on. */
export interface TaxByCountry {
  country: string;
  grossEur: number;
  taxEur: number;
}

export interface TaxReturnOverview {
  year: number;
  peildatum: string;
  partner: boolean;
  sections: { key: ReturnSection; lines: ReturnLine[]; totalEur: number }[];
  /** Entered on the Box 3 page for the year, not in an account. */
  extra: { bankEur: number; otherEur: number; debtsEur: number };
  /** Dividend tax withheld during the year: Dutch (offset in full) and foreign, per country. */
  dividendTax: {
    dutchEur: number;
    dutchGrossEur: number;
    foreign: TaxByCountry[];
  };
  /** Tax withheld abroad on interest (accounts kept as values per year), per country. */
  interestTax: TaxByCountry[];
  /** From 2025 the actual return goes in the return itself; before, on a separate form. */
  actualReturnIn: "return" | "form";
  actualReturn: ActualReturn;
  calculation: Box3Year["calculation"];
  allocation: Box3Year["allocation"];
  warnings: string[];
}

const euros = (d: Decimal | string, up = false) => (up ? D(d).ceil() : D(d).floor()).toNumber();
const cents = (d: Decimal) => d.toDecimalPlaces(2).toNumber();

type Sums = Map<string, { gross: Decimal; tax: Decimal }>;
const addTax = (sums: Sums, country: string, gross: Decimal.Value, tax: Decimal.Value) => {
  const c = sums.get(country) ?? { gross: D(0), tax: D(0) };
  sums.set(country, { gross: c.gross.plus(gross), tax: c.tax.plus(tax) });
};
/** The countries that withheld tax, most tax first. */
const perCountry = (sums: Sums): TaxByCountry[] =>
  [...sums]
    .filter(([, v]) => v.tax.gt(0))
    .map(([country, v]) => ({ country, grossEur: cents(v.gross), taxEur: cents(v.tax) }))
    .sort((a, b) => b.taxEur - a.taxEur);

/** Which part of the return a box 3 row goes in. */
function sectionOf(row: Box3Year["rows"][number]): ReturnSection | null {
  if (row.category === "debt") return "debts";
  if (row.category === "exempt") return "green";
  if (row.category === "excluded") return null;
  if (row.category === "bank") return "bank";
  if (row.accountKind === "property") return "property";
  if (row.accountKind === "receivable") return "receivables";
  if (row.accountKind === "insurance") return "other";
  if (row.assetClass === "crypto") return "crypto";
  // Securities, bonds and funds included: one bought by ISIN is a stock or an ETF.
  if (row.assetClass === "stock" || row.assetClass === "etf") return "investments";
  // Precious metals, euros on an exchange, and anything else.
  return "other";
}

/**
 * Box 3 for one tax year, arranged the way the income tax return asks for it: bank balances,
 * investments, crypto, property, money lent, other assets, green investments and debts, each per
 * account with its owner; plus the dividend tax withheld during the year and the actual return.
 */
export async function taxReturnOverview(db: DB, year: number, config: Box3Config): Promise<TaxReturnOverview> {
  const data = new LedgerData(db);
  const [box3, actual, accountRows, yearly, method, assetRows] = await Promise.all([
    computeBox3Year(db, year, config, data),
    actualReturn(db, year, config, data),
    db.select().from(accounts),
    loadYearly(db),
    getCostMethod(db),
    db.select({ id: assets.id, isin: assets.isin }).from(assets),
  ]);
  const account = new Map(accountRows.map((a) => [a.id, a]));
  const isin = new Map(assetRows.map((a) => [a.id, a.isin]));

  // Dividends during the year, per account and per country of the security.
  const { income } = await loadEvents(db, method);
  const dividends = new Map<number, { gross: Decimal; tax: Decimal }>();
  const byCountry: Sums = new Map();
  for (const e of income) {
    if (e.kind !== "dividend" || e.date.slice(0, 4) !== String(year)) continue;
    const d = dividends.get(e.accountId) ?? { gross: D(0), tax: D(0) };
    dividends.set(e.accountId, { gross: d.gross.plus(e.grossEur), tax: d.tax.plus(e.taxEur) });
    addTax(byCountry, isin.get(e.assetId)?.slice(0, 2) ?? "??", e.grossEur, e.taxEur);
  }

  const lines = new Map<string, ReturnLine & { section: ReturnSection; value: Decimal; counted: Decimal }>();
  for (const row of box3.rows) {
    const section = sectionOf(row);
    if (!section) continue;
    const key = `${section}|${row.accountId}`;
    const a = account.get(row.accountId);
    const line = lines.get(key) ?? {
      section,
      accountId: row.accountId,
      name: row.accountName,
      kind: row.accountKind,
      owner: row.owner,
      ownerChildId: row.ownerChildId,
      foreign: a?.foreign ?? false,
      valueEur: 0,
      countedEur: 0,
      countedPct: row.countedPct,
      note: row.note,
      details: [],
      value: D(0),
      counted: D(0),
    };
    // A debt is listed as what is owed (cash below zero at a broker is a negative balance).
    line.value = line.value.plus(section === "debts" ? D(row.valueEur).abs() : row.valueEur);
    line.counted = line.counted.plus(row.countedEur);
    if (row.source === "transactions" && Number(row.valueEur) !== 0)
      line.details.push({ name: row.name, symbol: row.symbol, valueEur: euros(row.valueEur) });
    lines.set(key, line);
  }

  // Interest taxed abroad, per country, as the return offsets it (not on green investments or debts).
  const interestByCountry: Sums = new Map();
  const sections = RETURN_SECTIONS.map((key) => {
    const list = [...lines.values()]
      .filter((l) => l.section === key)
      .map(({ section: _s, value, counted, ...l }): ReturnLine => {
        const up = key === "debts";
        const y = yearly.get(l.accountId)?.get(year);
        const div = dividends.get(l.accountId);
        const tax = taxWithheldAbroad(y);
        const interestTax = y && tax.gt(0) && key !== "debts" && key !== "green";
        if (interestTax) addTax(interestByCountry, y.details.taxCountry ?? "??", y.incomeEur, tax);
        return {
          ...l,
          valueEur: euros(value, up),
          countedEur: euros(counted, up),
          incomeEur: y && Number(y.incomeEur) ? euros(y.incomeEur) : undefined,
          // From transactions; for an investment account kept as values per year, its income.
          dividendEur: div
            ? cents(div.gross)
            : key === "investments" && y && Number(y.incomeEur)
              ? cents(D(y.incomeEur))
              : undefined,
          dividendTaxEur: div && div.tax.gt(0) ? cents(div.tax) : undefined,
          interestTaxEur: interestTax ? cents(tax) : undefined,
          interestTaxCountry: interestTax ? y.details.taxCountry : undefined,
        };
      })
      .sort((a, b) => b.countedEur - a.countedEur);
    return { key, lines: list, totalEur: list.reduce((s, l) => s + l.countedEur, 0) };
  });

  const dutch = byCountry.get("NL");
  return {
    year,
    peildatum: box3.peildatum,
    partner: box3.partner,
    sections,
    extra: {
      bankEur: euros(box3.extra.bankEur),
      otherEur: euros(box3.extra.otherEur),
      debtsEur: euros(box3.extra.debtsEur, true),
    },
    dividendTax: {
      dutchEur: dutch ? cents(dutch.tax) : 0,
      dutchGrossEur: dutch ? cents(dutch.gross) : 0,
      foreign: perCountry(new Map([...byCountry].filter(([c]) => c !== "NL"))),
    },
    interestTax: perCountry(interestByCountry),
    actualReturnIn: year >= 2025 ? "return" : "form",
    actualReturn: actual,
    calculation: box3.calculation,
    allocation: box3.allocation,
    warnings: [...box3.warnings, ...actual.warnings],
  };
}
