import { and, eq, inArray, like, or } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, settings } from "../db/schema.js";
import { tr } from "../i18n/index.js";
import { D, Decimal } from "../lib/decimal.js";
import { fromLocal } from "../lib/time.js";
import type { AssetResolver } from "../sync/assets.js";
import { compareHoldings } from "../sync/reconcile.js";
import { type OpeningBalance, norm, num } from "./formats/types.js";
import { detectDecimal, detectDelimiter, parseCsv } from "./parse.js";

/**
 * A statement of what a broker says an account held on a day:
 * - DEGIRO's portfolio export ("Portfolio.csv": Product, Symbool/ISIN, Aantal, Slotkoers, Lokale
 *   waarde, …, Waarde in EUR). The file doesn't say which day it is for; the user chooses it.
 * - ING's "Historisch portefeuilleoverzicht" (Eenvoudig Beleggen, Zelf op de Beurs): a title block,
 *   then Naam;ISIN;Type;Aantal(d-m-y);Koers(d-m-y);Waarde EUR(d-m-y). It says its own day.
 */
export interface Statement {
  source: "degiro-portfolio" | "ing-portfolio";
  positions: { isin: string; name: string; quantity: string; price: string | null; currency: string }[];
  // Cash per currency ("CASH & CASH FUND & FTX CASH (EUR)", "Cash-gedeelte (EUR)").
  cash: { currency: string; amount: string }[];
  // The day it's for, when the file says (YYYY-MM-DD), and the product ("Eenvoudig Beleggen").
  day?: string;
  product?: string;
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export function readStatement(content: string): Statement | null {
  const text = content.replace(/^\uFEFF/, "");
  const ing = readIngStatement(text);
  if (ing) return ing;
  const table = parseCsv(text, detectDelimiter(text)).filter((r) => r.some((c) => c.trim()));
  const h = (table[0] ?? []).map((c) => norm(c));
  const isPortfolio =
    h.length >= 7 &&
    ["product", "produkt", "produit", "producto", "prodotto"].includes(h[0]!) &&
    h[1]!.includes("isin") &&
    h.at(-1)!.endsWith("eur");
  if (!isPortfolio) return null;
  const rows = table.slice(1);
  const decimal = detectDecimal(rows.flatMap((r) => [r[3] ?? "", r[5] ?? "", r[6] ?? ""]));
  const out: Statement = { source: "degiro-portfolio", positions: [], cash: [] };
  for (const r of rows) {
    const [name = "", ref = "", quantity = "", close = "", currency = "", local = ""] = r.map((c) => c.trim());
    if (!ref && /^cash\b/i.test(name)) {
      const cur = (/\(([A-Z]{3})\)/.exec(name)?.[1] ?? currency).toUpperCase();
      const amount = num(local, decimal);
      if (amount != null && /^[A-Z]{3}$/.test(cur)) out.cash.push({ currency: cur, amount });
      continue;
    }
    const isin = ref.toUpperCase();
    const q = num(quantity, decimal);
    if (!ISIN_RE.test(isin) || q == null) continue;
    out.positions.push({ isin, name, quantity: q, price: num(close, decimal), currency: currency.toUpperCase() });
  }
  return out;
}

const dmyToIso = (s: string) => {
  const m = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : undefined;
};

/** ING's "Historisch portefeuilleoverzicht"; null for anything else. Numbers in Dutch notation. */
function readIngStatement(text: string): Statement | null {
  const table = parseCsv(text, ";");
  const at = table.findIndex(
    (r) => norm(r[0] ?? "") === "naam" && norm(r[1] ?? "") === "isin" && norm(r[3] ?? "").startsWith("aantal"),
  );
  if (at < 0) return null;
  const head = table.slice(0, at);
  const cell = (label: RegExp) => head.find((r) => label.test(r[0] ?? ""))?.[1];
  const day = dmyToIso(cell(/^datum$/i) ?? table[at]![3] ?? "");
  const product = head.find((r) => r.length === 1 && /beleggen|beurs/i.test(r[0] ?? ""))?.[0];
  const out: Statement = { source: "ing-portfolio", positions: [], cash: [], day, product };
  for (const r of table.slice(at + 1)) {
    const [name = "", isinCell = "", , quantity = "", close = "", value = ""] = r;
    const isin = isinCell.toUpperCase();
    if (!ISIN_RE.test(isin)) break;
    const q = num(quantity, ",");
    const v = num(value, ",");
    if (q == null || D(q).isZero()) continue;
    // The price in euros: the close when it gives the value in euros, else value / quantity (a fund
    // priced in another currency).
    const c = num(close, ",");
    const fromValue = v == null ? null : D(v).div(q);
    const price =
      c != null && fromValue && D(c).minus(fromValue).abs().lte(D(c).mul("0.01")) ? c : fromValue?.toFixed();
    out.positions.push({ isin, name: name.trim(), quantity: q, price: price ?? null, currency: "EUR" });
  }
  const cash = num(cell(/^cash-gedeelte \(eur\)$/i) ?? "", ",");
  if (cash != null && !D(cash).isZero()) out.cash.push({ currency: "EUR", amount: cash });
  return out;
}

export interface StatementRow {
  // Null when no asset has this ISIN yet: import the transactions first.
  assetId: number | null;
  name: string;
  isin: string | null;
  reported: string;
  computed: string;
  difference: string;
  // For a correction: the statement's closing price, in its currency.
  price: string | null;
  currency: string;
}

export interface StatementCheck {
  accountId: number;
  source: Statement["source"];
  day: string;
  rows: StatementRow[];
  differences: number;
}

/**
 * Makes sure each position and currency on the statement has its asset, so a difference can be
 * corrected with one click, also for an account kept with statements only (ING's overview without
 * its transactions): a fund is looked up by its ISIN, as an import does.
 */
export async function ensureCashAssets(resolver: AssetResolver, st: Statement) {
  for (const c of st.cash) await resolver.resolve({ kind: "fiat", currency: c.currency });
  for (const p of st.positions)
    await resolver.resolve({ kind: "security", isin: p.isin, symbol: p.isin, name: p.name, currency: p.currency });
}

/** The statement against the account's transactions up to the end of `day`. Only reads. */
export async function checkStatement(db: DB, accountId: number, day: string, st: Statement): Promise<StatementCheck> {
  const isins = [...new Set(st.positions.map((p) => p.isin))];
  const known = isins.length
    ? await db
        .select({ id: assets.id, isin: assets.isin, name: assets.name })
        .from(assets)
        .where(inArray(assets.isin, isins))
    : [];
  const byIsin = new Map(known.map((a) => [a.isin!, a]));
  const reported = new Map<number, Decimal>();
  const rows = new Map<number, StatementRow>();
  const unknown: StatementRow[] = [];
  for (const p of st.positions) {
    const a = byIsin.get(p.isin);
    const row = {
      assetId: a?.id ?? null,
      name: p.name,
      isin: p.isin,
      reported: p.quantity,
      computed: "0",
      difference: p.quantity,
      price: p.price,
      currency: p.currency,
    };
    if (!a) unknown.push(row);
    else {
      reported.set(a.id, (reported.get(a.id) ?? D(0)).plus(D(p.quantity)));
      rows.set(a.id, row);
    }
  }
  const currencies = st.cash.map((c) => c.currency);
  const cashAssets = currencies.length
    ? await db
        .select({ id: assets.id, name: assets.name, ref: assets.priceRef })
        .from(assets)
        .where(and(eq(assets.priceSource, "fx"), inArray(assets.priceRef, currencies)))
    : [];
  for (const c of st.cash) {
    const a = cashAssets.find((x) => x.ref === c.currency);
    if (!a) continue;
    reported.set(a.id, (reported.get(a.id) ?? D(0)).plus(D(c.amount)));
    rows.set(a.id, {
      assetId: a.id,
      name: a.name,
      isin: null,
      reported: c.amount,
      computed: "0",
      difference: c.amount,
      price: "1",
      currency: c.currency,
    });
  }
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const mismatches = await compareHoldings(db, accountId, reported, { asOf: fromLocal(y, m, d + 1, 0) });
  const differing = new Map(mismatches.map((x) => [x.assetId, x]));
  const out: StatementRow[] = [];
  for (const [id, row] of rows) {
    const x = differing.get(id);
    out.push(
      x
        ? { ...row, computed: x.computed, difference: x.difference }
        : { ...row, computed: row.reported, difference: "0" },
    );
  }
  // Held according to the transactions, but not on the statement.
  const missing = mismatches.filter((x) => !rows.has(x.assetId));
  const names = missing.length
    ? await db
        .select({ id: assets.id, name: assets.name, isin: assets.isin, currency: assets.currency })
        .from(assets)
        .where(
          inArray(
            assets.id,
            missing.map((x) => x.assetId),
          ),
        )
    : [];
  for (const x of missing) {
    const a = names.find((n) => n.id === x.assetId);
    out.push({ ...x, name: a?.name ?? x.symbol, isin: a?.isin ?? null, price: null, currency: a?.currency ?? "EUR" });
  }
  out.push(...unknown);
  out.sort((a, b) => Number(a.isin == null) - Number(b.isin == null) || a.name.localeCompare(b.name));
  return {
    accountId,
    source: st.source,
    day,
    rows: out,
    differences: out.filter((r) => !D(r.difference).isZero()).length,
  };
}

// Statements per account and day ("statement:<account>:<day>"), kept so the check can be redone as
// transactions change. A key without a day is from 0.1.16, which kept one per account.
const KEY = "statement:";
interface Stored {
  day: string;
  statement: Statement;
  at: string;
}

export async function saveStatement(db: DB, accountId: number, day: string, statement: Statement) {
  const value: Stored = { day, statement, at: new Date().toISOString() };
  // A statement of the same day replaces the one before it, also when kept the old way.
  const old = await db
    .select()
    .from(settings)
    .where(eq(settings.key, `${KEY}${accountId}`));
  if (old[0] && (old[0].value as Stored).day === day) await db.delete(settings).where(eq(settings.key, old[0].key));
  await db
    .insert(settings)
    .values({ key: `${KEY}${accountId}:${day}`, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** The stored statements' checks, newest day first; for one account and/or one day if given. */
export async function storedChecks(db: DB, accountId?: number, day?: string): Promise<StatementCheck[]> {
  const stored = await db
    .select()
    .from(settings)
    .where(like(settings.key, accountId ? `${KEY}${accountId}%` : `${KEY}%`));
  const live = new Set(
    (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.archived, false))).map((a) => a.id),
  );
  const out: StatementCheck[] = [];
  for (const s of stored) {
    const id = Number(s.key.slice(KEY.length).split(":")[0]);
    const v = s.value as Stored;
    // "statement:1" must not pick up "statement:12…".
    if (!live.has(id) || (accountId && id !== accountId) || (day && v.day !== day)) continue;
    out.push(await checkStatement(db, id, v.day, v.statement));
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

const METAL_NAMES: Record<string, () => string> = {
  XAU: () => tr("Gold"),
  XAG: () => tr("Silver"),
  XPT: () => tr("Platinum"),
  XPD: () => tr("Palladium"),
};

/**
 * Whether what a statement says an account held at its start (Goldrepublic's opening balance) is what
 * the account holds in Box3balans at the start of that day: so the statements of earlier years are
 * in, or still missing. Null when both are empty (the first statement, into a new account).
 */
export async function checkOpening(
  db: DB,
  accountId: number,
  o: OpeningBalance,
): Promise<{ matches: boolean; message: string } | null> {
  const codes = o.metals.map((m) => m.code);
  const currencies = o.cash.map((c) => c.currency);
  const known = await db
    .select({ id: assets.id, source: assets.priceSource, ref: assets.priceRef })
    .from(assets)
    .where(
      or(
        and(eq(assets.priceSource, "metal"), inArray(assets.priceRef, codes.length ? codes : ["-"])),
        and(eq(assets.priceSource, "fx"), inArray(assets.priceRef, currencies.length ? currencies : ["-"])),
      ),
    );
  const reported = new Map<number, Decimal>();
  const label = new Map<number, { name: string; unit: (v: string) => string }>();
  for (const m of o.metals) {
    const a = known.find((k) => k.source === "metal" && k.ref === m.code);
    if (!a) continue;
    reported.set(a.id, D(m.grams));
    label.set(a.id, { name: (METAL_NAMES[m.code]?.() ?? m.code).toLowerCase(), unit: (v) => `${D(v).toFixed()} g` });
  }
  for (const c of o.cash) {
    const a = known.find((k) => k.source === "fx" && k.ref === c.currency);
    if (!a) continue;
    reported.set(a.id, D(c.amount));
    label.set(a.id, {
      name: c.currency,
      unit: (v) => (c.currency === "EUR" ? `€${D(v).toFixed(2)}` : `${D(v).toFixed(2)} ${c.currency}`),
    });
  }
  const [y, m, d] = o.date.split("-").map(Number) as [number, number, number];
  const mismatches = await compareHoldings(db, accountId, reported, { asOf: fromLocal(y, m, d, 0) });
  if (!mismatches.length)
    return [...reported.values()].some((v) => !v.isZero())
      ? {
          matches: true,
          message: tr("The opening balance on {date} matches what this account already holds in Box3balans.", {
            date: o.date,
          }),
        }
      : null;
  // In the statement's order: the metals, then the money, then anything else the account holds.
  const order = [...label.keys()];
  const rank = (id: number) => (order.includes(id) ? order.indexOf(id) : order.length);
  const differences = [...mismatches]
    .sort((a, b) => rank(a.assetId) - rank(b.assetId))
    .map((x) => {
      const l = label.get(x.assetId) ?? { name: x.symbol, unit: (v: string) => D(v).toFixed() };
      return tr("{asset}: {reported} on the statement, {computed} in Box3balans", {
        asset: l.name,
        reported: l.unit(x.reported),
        computed: l.unit(x.computed),
      });
    });
  return {
    matches: false,
    message: tr(
      "The statement starts on {date} with other amounts than this account holds in Box3balans: {differences}. Import the statements of the years before first, or check the account.",
      { date: o.date, differences: differences.join("; ") },
    ),
  };
}
