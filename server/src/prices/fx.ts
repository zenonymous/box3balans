import { and, desc, eq, lte } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { fxRates } from "../db/schema.js";
import { D, Decimal, str } from "../lib/decimal.js";
import { getJson, type FetchFn } from "../lib/http.js";

const BASE = "https://api.frankfurter.dev/v1";

interface FrankfurterResponse {
  date: string;
  rates: Record<string, number>;
}

/** ECB reference rates (via Frankfurter), cached in fx_rates as units of currency per EUR. */
export class FxService {
  constructor(
    private db: DB,
    private fetchFn?: FetchFn,
  ) {}

  /** Fetches the latest ECB rates for all currencies and stores them. */
  async refreshLatest(): Promise<string> {
    const data = await getJson<FrankfurterResponse>(`${BASE}/latest?base=EUR`, { fetchFn: this.fetchFn });
    await this.store(data);
    return data.date;
  }

  /** Bulk-loads daily ECB rates for a date range (one request), for valuing historical data. */
  async ensureRange(currencies: string[], from: string, to: string): Promise<void> {
    const wanted = [...new Set(currencies.map((c) => c.toUpperCase()).filter((c) => c !== "EUR"))];
    if (wanted.length === 0) return;
    // Start a few days early so the first day can fall back to the previous business day.
    const start = new Date(Date.parse(from) - 5 * 86_400_000).toISOString().slice(0, 10);
    const data = await getJson<{ rates: Record<string, Record<string, number>> }>(
      `${BASE}/${start}..${to}?base=EUR&symbols=${wanted.join(",")}`,
      { fetchFn: this.fetchFn },
    );
    const rows = Object.entries(data.rates).flatMap(([day, rates]) =>
      Object.entries(rates).map(([currency, rate]) => ({ currency, day, perEur: str(D(rate)) })),
    );
    for (let i = 0; i < rows.length; i += 500) {
      await this.db
        .insert(fxRates)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing();
    }
  }

  /** EUR value of one unit of `currency` on (or the last business day before) `day`. */
  async eurPerUnit(currency: string, day?: string): Promise<Decimal> {
    const cur = currency.toUpperCase();
    if (cur === "EUR") return D(1);
    const perEur = await this.perEur(cur, day);
    return D(1).div(perEur);
  }

  private async perEur(currency: string, day?: string): Promise<Decimal> {
    const cached = await this.lookup(currency, day);
    // ECB publishes on business days only; a cached rate up to 4 days old covers weekends/holidays.
    if (cached && (!day || daysBetween(cached.day, day) <= 4)) return D(cached.perEur);

    const path = day ? day : "latest";
    const data = await getJson<FrankfurterResponse>(`${BASE}/${path}?base=EUR`, { fetchFn: this.fetchFn });
    await this.store(data);
    const rate = data.rates[currency];
    if (rate == null) {
      if (cached) return D(cached.perEur);
      throw new Error(`No ECB exchange rate for ${currency}`);
    }
    return D(rate);
  }

  private async lookup(currency: string, day?: string) {
    const where = day ? and(eq(fxRates.currency, currency), lte(fxRates.day, day)) : eq(fxRates.currency, currency);
    const [row] = await this.db.select().from(fxRates).where(where).orderBy(desc(fxRates.day)).limit(1);
    return row;
  }

  private async store(data: FrankfurterResponse) {
    const rows = Object.entries(data.rates).map(([currency, rate]) => ({
      currency,
      day: data.date,
      perEur: str(D(rate)),
    }));
    if (rows.length === 0) return;
    await this.db.insert(fxRates).values(rows).onConflictDoNothing();
  }
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000;
}
