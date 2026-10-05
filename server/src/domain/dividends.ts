import { and, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { assets, transactions } from "../db/schema.js";
import { D, type Decimal, ZERO } from "../lib/decimal.js";
import type { FetchFn } from "../lib/http.js";
import { localToday } from "../lib/time.js";
import type { FxService } from "../prices/fx.js";
import { type DividendEvent, yahooDividends } from "../prices/yahoo.js";
import type { CostMethod } from "./ledger.js";
import { loadEvents } from "./performance.js";
import { buildPortfolio } from "./portfolio.js";

// Withholding when you have no dividend history for a holding yet, by the ISIN's country, for a
// Dutch resident: US with a W-8BEN form on file; Irish and Luxembourg funds don't withhold.
const DEFAULT_WITHHOLDING_PCT: Record<string, number> = { NL: 15, US: 15, IE: 0, LU: 0, GB: 0 };

const CACHE_MS = 12 * 3_600_000;
const cache = new Map<string, { at: number; events: DividendEvent[] }>();

async function eventsFor(ticker: string, fetchFn?: FetchFn): Promise<DividendEvent[]> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.events;
  const events = await yahooDividends(ticker, fetchFn);
  cache.set(ticker, { at: Date.now(), events });
  return events;
}

const plusYear = (day: string) => `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;
const money = (d: Decimal) => Math.round(d.toNumber() * 100) / 100;

export interface ForecastAsset {
  assetId: number;
  symbol: string;
  name: string;
  quantity: string;
  payments: number;
  nextExDate: string | null;
  grossEur: number;
  netEur: number;
  taxPct: number | null;
  // Where the tax rate comes from: what you were actually charged, a country default, or unknown.
  taxSource: "yours" | "default" | "unknown";
}

/**
 * Dividends to expect over the next 12 months: each holding's dividends of the last 12 months,
 * moved a year ahead, for what you hold now, in EUR at today's rate. Dates are ex-dividend dates;
 * the money usually arrives a few weeks later.
 */
export async function dividendForecast(db: DB, fx: FxService, fetchFn: FetchFn | undefined, staleAfterMs: number) {
  const today = localToday();
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const { holdings } = await buildPortfolio(db, { staleAfterMs });
  const held = holdings.filter(
    (h) => !h.physical && (h.assetClass === "stock" || h.assetClass === "etf") && Number(h.quantity) > 0,
  );
  const ids = held.map((h) => h.assetId);
  const assetRows = ids.length ? await db.select().from(assets).where(inArray(assets.id, ids)) : [];
  const assetById = new Map(assetRows.map((a) => [a.id, a]));

  // Your own withholding rate per holding over the last two years.
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86_400_000);
  const past = ids.length
    ? await db
        .select({ assetId: transactions.assetId, amount: transactions.amount, tax: transactions.taxWithheld })
        .from(transactions)
        .where(
          and(
            eq(transactions.type, "dividend"),
            inArray(transactions.assetId, ids),
            gte(transactions.occurredAt, twoYearsAgo),
          ),
        )
    : [];
  const ownRate = new Map<number, { gross: Decimal; tax: Decimal }>();
  for (const p of past) {
    const r = ownRate.get(p.assetId) ?? { gross: ZERO, tax: ZERO };
    ownRate.set(p.assetId, { gross: r.gross.plus(p.amount), tax: r.tax.plus(p.tax) });
  }

  const months = new Map<string, { gross: Decimal; net: Decimal }>();
  const byAsset: ForecastAsset[] = [];
  const failed: string[] = [];
  const none: string[] = [];
  for (const h of held) {
    const a = assetById.get(h.assetId);
    if (!a || a.priceSource !== "yahoo" || !a.priceRef) continue;
    let events: DividendEvent[];
    try {
      events = await eventsFor(a.priceRef, fetchFn);
    } catch {
      failed.push(a.symbol);
      continue;
    }
    const trailing = events.filter((e) => e.exDate > yearAgo && e.exDate <= today);
    if (!trailing.length) {
      none.push(a.symbol);
      continue;
    }
    const own = ownRate.get(a.id);
    const country = a.isin?.slice(0, 2);
    const taxPct =
      own && own.gross.gt(0)
        ? own.tax.div(own.gross).mul(100).toDecimalPlaces(2).toNumber()
        : country && country in DEFAULT_WITHHOLDING_PCT
          ? DEFAULT_WITHHOLDING_PCT[country]!
          : null;
    let gross = ZERO;
    for (const e of trailing) {
      let rate: Decimal;
      try {
        rate = await fx.eurPerUnit(e.currency);
      } catch {
        continue;
      }
      const eur = e.amount.mul(D(h.quantity)).mul(rate);
      gross = gross.plus(eur);
      const month = plusYear(e.exDate).slice(0, 7);
      const m = months.get(month) ?? { gross: ZERO, net: ZERO };
      months.set(month, {
        gross: m.gross.plus(eur),
        net: m.net.plus(taxPct == null ? eur : eur.mul(1 - taxPct / 100)),
      });
    }
    byAsset.push({
      assetId: a.id,
      symbol: a.symbol,
      name: h.name,
      quantity: h.quantity,
      payments: trailing.length,
      nextExDate: plusYear(trailing[0]!.exDate),
      grossEur: money(gross),
      netEur: money(taxPct == null ? gross : gross.mul(1 - taxPct / 100)),
      taxPct,
      taxSource: own && own.gross.gt(0) ? "yours" : taxPct != null ? "default" : "unknown",
    });
  }

  // The next 12 calendar months, including empty ones.
  const out = [];
  const start = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    const m = months.get(key);
    out.push({ month: key, grossEur: m ? money(m.gross) : 0, netEur: m ? money(m.net) : 0 });
  }
  return {
    months: out,
    byAsset: byAsset.sort((x, y) => y.grossEur - x.grossEur),
    totalGrossEur: money(byAsset.reduce((s, x) => s.plus(x.grossEur), ZERO)),
    totalNetEur: money(byAsset.reduce((s, x) => s.plus(x.netEur), ZERO)),
    noDividends: none,
    failed,
  };
}

/**
 * Dividends and tax withheld per year and country (from the ISIN), as the tax return asks for them:
 * Dutch dividend tax is offset in full; foreign tax up to the treaty rate.
 */
export async function withholdingByCountry(db: DB, method: CostMethod) {
  const [{ income }, assetRows] = await Promise.all([loadEvents(db, method), db.select().from(assets)]);
  const isin = new Map(assetRows.map((a) => [a.id, a.isin]));
  const rows = new Map<string, { year: number; country: string; gross: Decimal; tax: Decimal; payments: number }>();
  for (const e of income) {
    if (e.kind !== "dividend") continue;
    const year = Number(e.date.slice(0, 4));
    const country = isin.get(e.assetId)?.slice(0, 2) ?? "??";
    const key = `${year}|${country}`;
    const r = rows.get(key) ?? { year, country, gross: ZERO, tax: ZERO, payments: 0 };
    rows.set(key, { ...r, gross: r.gross.plus(e.grossEur), tax: r.tax.plus(e.taxEur), payments: r.payments + 1 });
  }
  return [...rows.values()]
    .map((r) => ({
      year: r.year,
      country: r.country,
      payments: r.payments,
      grossEur: money(r.gross),
      taxEur: money(r.tax),
      ratePct: r.gross.gt(0) ? r.tax.div(r.gross).mul(100).toDecimalPlaces(2).toNumber() : null,
    }))
    .sort((a, b) => b.year - a.year || b.grossEur - a.grossEur);
}
