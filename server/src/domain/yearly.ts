import type { DB } from "../db/client.js";
import { accountYears, type accounts } from "../db/schema.js";
import { D, type Decimal } from "../lib/decimal.js";
import { RULES } from "../rules/index.js";

type Account = typeof accounts.$inferSelect;
export type AccountYear = typeof accountYears.$inferSelect;

/**
 * Leegwaarderatio: a home let with rent protection counts in box 3 at a percentage of its WOZ value,
 * depending on the yearly rent as a percentage of that WOZ value. Let to a related party (your child,
 * your own BV) at a rent well below the usual, it counts at 100%. Belastingdienst, "Bezittingen en
 * schulden box 3" (fisin2023–fisin2026); the tables are in src/rules/box3.json, per first year.
 */
export const leegwaardeTable = (year: number) =>
  ([...RULES.leegwaarderatio].reverse().find((t) => t.fromYear <= year) ?? RULES.leegwaarderatio[0]!).bands;

/** The fraction of the WOZ value a let home counts at. */
export function leegwaarderatio(rentEur: Decimal, wozEur: Decimal, year: number, relatedBelowMarket = false): Decimal {
  if (wozEur.lte(0) || relatedBelowMarket) return D(1);
  const rentPct = rentEur.div(wozEur).mul(100);
  // "0–1%" includes 1%, "1–2%" includes 2% and so on: the upper bound belongs to the band.
  const band = leegwaardeTable(year).find((b) => rentPct.lte(b.upToRentPct));
  return D(band ? band.valuePct : 100).div(100);
}

/** What a value per year counts for in box 3: a home let with rent protection at its leegwaarde. */
export function yearlyValue(
  kind: Account["kind"],
  row: Pick<AccountYear, "year" | "valueEur" | "details"> | undefined,
) {
  if (!row || row.valueEur == null) return null;
  const v = D(row.valueEur);
  const details = row.details ?? {};
  if (kind === "property" && details.rented)
    return v.mul(leegwaarderatio(D(details.rentEur || 0), v, row.year, !!details.relatedBelowMarket));
  return v;
}

/** Tax withheld abroad on a year's income (interest at a foreign bank); zero when none was entered. */
export const taxWithheldAbroad = (row: Pick<AccountYear, "details"> | undefined) =>
  D(row?.details?.taxWithheldEur || 0);

/**
 * The kind of holding a yearly account stands for, so it lands in the same box 3 category and
 * breakdown as tracked holdings would: a bank account is cash, a broker account investments, an
 * exchange or wallet crypto, a vault metals; homes, money lent and insurance policies are other
 * assets, and a debt is a debt.
 */
export function yearlyClass(kind: Account["kind"]): "cash" | "stock" | "crypto" | "metal" | "other" | "debt" {
  switch (kind) {
    case "bank":
      return "cash";
    case "broker":
      return "stock";
    case "exchange":
    case "wallet":
      return "crypto";
    case "vault":
    case "physical":
      return "metal";
    case "debt":
      return "debt";
    default:
      return "other";
  }
}

/**
 * Whether income lands in the account itself (interest on savings, dividends in a broker account),
 * so the next 1 January value already includes it. Rent from a home and interest on money lent arrive
 * elsewhere; a debt's "income" is the interest paid.
 */
export const incomeStaysInAccount = (kind: Account["kind"]) =>
  kind !== "property" && kind !== "receivable" && kind !== "debt";

/** Kinds that only make sense as values per year. */
export const YEARLY_ONLY_KINDS = new Set<Account["kind"]>(["property", "receivable", "debt", "insurance"]);

/** All values per year, by account and year. */
export async function loadYearly(db: DB): Promise<Map<number, Map<number, AccountYear>>> {
  const rows = await db.select().from(accountYears);
  const out = new Map<number, Map<number, AccountYear>>();
  for (const r of rows) {
    const m = out.get(r.accountId) ?? new Map<number, AccountYear>();
    m.set(r.year, r);
    out.set(r.accountId, m);
  }
  return out;
}
