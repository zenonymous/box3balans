import { and, eq, inArray, like } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, settings } from "../db/schema.js";
import { D, Decimal } from "../lib/decimal.js";
import { fromLocal } from "../lib/time.js";
import type { AssetResolver } from "../sync/assets.js";
import { compareHoldings } from "../sync/reconcile.js";
import { norm, num } from "./formats/types.js";
import { detectDecimal, detectDelimiter, parseCsv } from "./parse.js";

/**
 * A statement of what a broker says an account held on a day: DEGIRO's portfolio export
 * ("Portfolio.csv": Product, Symbool/ISIN, Aantal, Slotkoers, Lokale waarde, …, Waarde in EUR).
 * The file doesn't say which day it is for; the user chooses it when importing.
 */
export interface Statement {
  source: "degiro-portfolio";
  positions: { isin: string; name: string; quantity: string; price: string | null; currency: string }[];
  // Cash per currency ("CASH & CASH FUND & FTX CASH (EUR)").
  cash: { currency: string; amount: string }[];
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export function readStatement(content: string): Statement | null {
  const text = content.replace(/^\uFEFF/, "");
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

/** Makes sure each currency on the statement has its cash asset, so a difference can be corrected. */
export async function ensureCashAssets(resolver: AssetResolver, st: Statement) {
  for (const c of st.cash) await resolver.resolve({ kind: "fiat", currency: c.currency });
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

// The latest statement per account, kept so the check can be redone as transactions change.
const KEY = "statement:";
interface Stored {
  day: string;
  statement: Statement;
  at: string;
}

export async function saveStatement(db: DB, accountId: number, day: string, statement: Statement) {
  const value: Stored = { day, statement, at: new Date().toISOString() };
  await db
    .insert(settings)
    .values({ key: `${KEY}${accountId}`, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function storedChecks(db: DB, accountId?: number): Promise<StatementCheck[]> {
  const stored = await db
    .select()
    .from(settings)
    .where(accountId ? eq(settings.key, `${KEY}${accountId}`) : like(settings.key, `${KEY}%`));
  const live = new Set(
    (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.archived, false))).map((a) => a.id),
  );
  const out: StatementCheck[] = [];
  for (const s of stored) {
    const id = Number(s.key.slice(KEY.length));
    if (!live.has(id)) continue;
    const v = s.value as Stored;
    out.push(await checkStatement(db, id, v.day, v.statement));
  }
  return out;
}
