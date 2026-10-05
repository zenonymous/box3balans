import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, imports, syncIgnored, transactions } from "../db/schema.js";
import { D, type Decimal, ZERO, str } from "../lib/decimal.js";
import type { FetchFn } from "../lib/http.js";
import { localDay } from "../lib/time.js";
import type { FxService } from "../prices/fx.js";
import { HistoryService } from "../prices/history.js";
import { AssetResolver, isFiat } from "../sync/assets.js";
import type { AssetRef } from "../sync/types.js";
import { type CsvType, type Field, type Mapping, knownType } from "./mapping.js";
import {
  type DateOrder,
  type DecimalMark,
  type Delimiter,
  detectDateOrder,
  detectDecimal,
  detectDelimiter,
  parseCsv,
  parseDate,
  parseNumber,
} from "./parse.js";

type Asset = typeof assets.$inferSelect;
type TxInsert = typeof transactions.$inferInsert;

export type RowStatus = "new" | "duplicate" | "deleted" | "possible-duplicate" | "skipped" | "error";

/** One data line of the file, as it will be (or won't be) imported. */
export interface PlannedRow {
  line: number; // line number in the file, 1-based
  status: RowStatus;
  message?: string;
  duplicateOf?: number;
  date?: string;
  type?: CsvType;
  assetKey?: string;
  quantity?: string;
  price?: string;
  currency?: string;
  fee?: string;
  amount?: string;
  tax?: string;
  notes?: string;
}

export interface PlannedAsset {
  key: string;
  label: string;
  rows: number;
  // What the rows will be booked on: an existing asset (id > 0) or one to be created (id < 0).
  match: { id: number; symbol: string; name: string; assetClass: string; priceSource: string; priceRef: string | null };
  overridden: boolean;
}

export interface Plan {
  headers: string[];
  sample: string[][];
  detected: { delimiter: Delimiter; decimal: DecimalMark; dateOrder: DateOrder };
  // Distinct values of the type column and how often they occur.
  typeValues: { value: string; count: number }[];
  rows: PlannedRow[];
  assets: PlannedAsset[];
  summary: Record<RowStatus, number>;
  warnings: string[];
}

type Kind = "security" | "crypto" | "metal" | "fiat";

/** A data line parsed with the mapping, before assets are resolved. */
interface ParsedRow {
  line: number;
  at: Date;
  type: CsvType;
  kind: Kind;
  key: string;
  ref: AssetRef | { kind: "metal"; code: string };
  quantity: Decimal;
  price: Decimal | null;
  currency: string;
  fee: Decimal;
  amount: Decimal;
  tax: Decimal;
  notes: string | null;
  externalId: string;
}

class RowError extends Error {}

const METALS: Record<string, string> = {
  gold: "XAU",
  goud: "XAU",
  xau: "XAU",
  au: "XAU",
  silver: "XAG",
  zilver: "XAG",
  xag: "XAG",
  ag: "XAG",
  platinum: "XPT",
  platina: "XPT",
  xpt: "XPT",
  palladium: "XPD",
  xpd: "XPD",
};

const ASSET_TYPES: Record<string, Kind | "etf" | "stock"> = {
  stock: "stock",
  share: "stock",
  equity: "stock",
  aandeel: "stock",
  etf: "etf",
  fund: "etf",
  fonds: "etf",
  tracker: "etf",
  crypto: "crypto",
  cryptocurrency: "crypto",
  coin: "crypto",
  token: "crypto",
  metal: "metal",
  edelmetaal: "metal",
  "precious metal": "metal",
  cash: "fiat",
  fiat: "fiat",
  currency: "fiat",
  valuta: "fiat",
};

const KIND_BY_ACCOUNT: Record<string, Kind> = {
  broker: "security",
  exchange: "crypto",
  wallet: "crypto",
  vault: "metal",
  physical: "metal",
  bank: "fiat",
  other: "security",
};

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
// Types where a row without an asset (or with a currency code as asset) is about cash.
const CASH_TYPES = new Set<CsvType>(["deposit", "withdrawal", "reward", "fee"]);

/** The file split into header and data rows according to the mapping. */
export function readTable(content: string, mapping: Pick<Mapping, "delimiter" | "skipRows">) {
  const delimiter = mapping.delimiter ?? detectDelimiter(content);
  const table = parseCsv(content, delimiter).slice(mapping.skipRows);
  return { delimiter, headers: table[0] ?? [], data: table.slice(1) };
}

/** Parses every data line; lines that can't be read become errors or skips. */
function parseRows(
  data: string[][],
  m: Mapping,
  accountKind: string,
  decimal: DecimalMark,
  dateOrder: DateOrder,
): { parsed: ParsedRow[]; rejected: PlannedRow[] } {
  const parsed: ParsedRow[] = [];
  const rejected: PlannedRow[] = [];
  const seen = new Map<string, number>();
  data.forEach((r, i) => {
    // Header is line skipRows+1; data starts on the next line.
    const line = m.skipRows + 2 + i;
    const cell = (f: Field) => {
      const c = m.columns[f];
      return c == null ? "" : (r[c] ?? "").trim();
    };
    const num = (f: Field): Decimal | null => {
      const s = cell(f);
      if (!s) return null;
      const v = parseNumber(s, decimal);
      if (v == null) throw new RowError(`${f} "${s}" is not a number`);
      return D(v);
    };
    try {
      if (m.columns.date == null) throw new RowError("No date column chosen");
      const at = parseDate(cell("date"), dateOrder, cell("time") || undefined);
      if (!at) throw new RowError(`Date "${cell("date")}" can't be read`);

      const qtyRaw = num("quantity");
      let type: CsvType;
      if (m.typeMode === "fixed") type = m.fixedType;
      else if (m.typeMode === "sign") {
        if (!qtyRaw || qtyRaw.isZero()) throw new RowError("No quantity to tell buy from sell");
        type = qtyRaw.isNeg() ? "sell" : "buy";
      } else {
        const v = cell("type");
        const t = m.typeValues[v] ?? knownType(v);
        if (t === "skip") {
          rejected.push({ line, status: "skipped", message: `Type "${v}" is skipped` });
          return;
        }
        if (!t) throw new RowError(v ? `Unknown type "${v}": choose what it means` : "No type");
        type = t;
      }

      const currency = (cell("currency") || m.defaultCurrency).toUpperCase();
      if (!/^[A-Z]{3,5}$/.test(currency)) throw new RowError(`Currency "${currency}" isn't a currency code`);
      const abs = (v: Decimal | null) => (v ? v.abs() : null);
      const price = abs(num("price"));
      const total = abs(num("total"));
      const fee = abs(num("fee")) ?? ZERO;
      const amountCol = abs(num("amount"));
      const tax = abs(num("tax")) ?? ZERO;

      // Which asset the row is about.
      const symbol = cell("symbol");
      const isinCell = cell("isin").toUpperCase();
      const isin = ISIN_RE.test(isinCell) ? isinCell : undefined;
      const name = cell("name") || undefined;
      const hint = ASSET_TYPES[cell("assetType").toLowerCase()];
      let kind: Kind;
      if (hint === "stock" || hint === "etf") kind = "security";
      else if (hint) kind = hint;
      else if (isin) kind = "security";
      else if (CASH_TYPES.has(type) && (!symbol || isFiat(symbol)) && !name) kind = "fiat";
      else if (m.assetKind !== "auto") kind = m.assetKind;
      else kind = KIND_BY_ACCOUNT[accountKind] ?? "security";

      let ref: ParsedRow["ref"];
      let key: string;
      if (kind === "fiat") {
        const code = (symbol || currency).toUpperCase();
        if (!isFiat(code)) throw new RowError(`"${code}" isn't a currency`);
        ref = { kind: "fiat", currency: code };
        key = `fiat:${code}`;
      } else if (kind === "metal") {
        const code = METALS[(symbol || name || "").toLowerCase()];
        if (!code) throw new RowError(`"${symbol || name || ""}" isn't gold, silver, platinum or palladium`);
        ref = { kind: "metal", code };
        key = `metal:${code}`;
      } else if (kind === "crypto") {
        const sym = (symbol || name || "").toUpperCase();
        if (!sym) throw new RowError("No asset symbol");
        if (type === "buy" || type === "sell") {
          if (!isFiat(currency)) throw new RowError(`Price in ${currency}: only trades priced in a currency like EUR`);
        }
        ref = { kind: "crypto", symbol: sym, name };
        key = `crypto:${sym}`;
      } else {
        const sym = symbol || name || isin || "";
        if (!sym) throw new RowError("No asset symbol or ISIN");
        ref = { kind: "security", symbol: sym, isin, currency, name, etf: hint === "etf" };
        key = `security:${isin ?? sym.toUpperCase()}`;
      }
      const cash = kind === "fiat";

      // Quantities per type. Exports differ in which column carries the amount.
      let quantity = abs(qtyRaw);
      let amount = ZERO;
      let unit = price;
      if (type === "buy" || type === "sell") {
        if (!quantity || quantity.isZero()) throw new RowError("No quantity");
        if (!unit && total) unit = total.div(quantity);
        if (!unit) throw new RowError("Needs a price or a total");
        if (cash) throw new RowError("Buying or selling a currency isn't supported; use deposit/withdrawal");
      } else if (type === "dividend") {
        amount = amountCol ?? total ?? (quantity && price ? quantity.mul(price) : ZERO);
        if (amount.isZero()) throw new RowError("Dividend without an amount");
        if (cash) throw new RowError("A dividend needs the security it was paid on");
        quantity = ZERO;
      } else if (type === "split") {
        if (!quantity || quantity.isZero())
          throw new RowError("Split needs the ratio as quantity (e.g. 4 for 4-for-1)");
      } else {
        quantity = quantity && !quantity.isZero() ? quantity : cash ? (amountCol ?? total) : null;
        if (!quantity || quantity.isZero()) throw new RowError("No quantity");
        if (!unit && total && !cash) unit = total.div(quantity);
      }

      const date = at.toISOString();
      const base = cell("id")
        ? `id:${cell("id")}`
        : `h:${createHash("sha1")
            .update(
              JSON.stringify([
                date,
                type,
                key,
                str(quantity),
                unit && str(unit),
                str(amount),
                str(tax),
                str(fee),
                currency,
              ]),
            )
            .digest("hex")
            .slice(0, 20)}`;
      // Identical lines (e.g. two fills at the same price) each get their own id.
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);

      parsed.push({
        line,
        at,
        type,
        kind,
        key,
        ref,
        quantity,
        price: unit,
        currency,
        fee,
        amount,
        tax,
        notes: cell("notes") || null,
        externalId: `${base}:${n}`,
      });
    } catch (err) {
      if (!(err instanceof RowError)) throw err;
      rejected.push({ line, status: "error", message: err.message });
    }
  });
  return { parsed, rejected };
}

// Lookups of assets that don't exist yet, kept between previews so changing the mapping doesn't
// repeat searches on Yahoo or CoinGecko.
const lookupCache = new Map<string, { asset: Asset; at: number }>();
const LOOKUP_TTL_MS = 30 * 60_000;

async function resolveAssets(
  db: DB,
  rows: ParsedRow[],
  m: Mapping,
  resolver: AssetResolver,
  dryRun: boolean,
): Promise<Map<string, { asset: Asset; overridden: boolean }>> {
  const out = new Map<string, { asset: Asset; overridden: boolean }>();
  const overrideIds = [...new Set(Object.values(m.assetOverrides))];
  const overrides = overrideIds.length
    ? new Map((await db.select().from(assets).where(inArray(assets.id, overrideIds))).map((a) => [a.id, a]))
    : new Map<number, Asset>();
  for (const r of rows) {
    if (out.has(r.key)) continue;
    const chosen = overrides.get(m.assetOverrides[r.key] ?? -1);
    if (chosen) {
      out.set(r.key, { asset: chosen, overridden: true });
      continue;
    }
    if (r.ref.kind === "metal") {
      const code = r.ref.code;
      const [metal] = await db
        .select()
        .from(assets)
        .where(and(eq(assets.priceSource, "metal"), eq(assets.priceRef, code)));
      if (!metal) throw new Error(`Metal asset ${code} is missing`);
      out.set(r.key, { asset: metal, overridden: false });
      continue;
    }
    const cached = dryRun ? lookupCache.get(r.key) : undefined;
    if (cached && Date.now() - cached.at < LOOKUP_TTL_MS) {
      // The asset may have been created since (by an import, a sync or by hand).
      const [real] = cached.asset.priceRef
        ? await db
            .select()
            .from(assets)
            .where(and(eq(assets.priceSource, cached.asset.priceSource), eq(assets.priceRef, cached.asset.priceRef)))
        : [];
      if (real) lookupCache.delete(r.key);
      out.set(r.key, { asset: real ?? cached.asset, overridden: false });
      continue;
    }
    const asset = await resolver.resolve(r.ref);
    if (dryRun && asset.id < 0) lookupCache.set(r.key, { asset, at: Date.now() });
    out.set(r.key, { asset, overridden: false });
  }
  return out;
}

/** Status of each parsed row against what the account already has. */
async function classify(
  db: DB,
  accountId: number,
  rows: ParsedRow[],
  assetOf: Map<string, { asset: Asset }>,
): Promise<Map<number, { status: RowStatus; duplicateOf?: number; message?: string }>> {
  const ids = rows.map((r) => r.externalId);
  const stored = new Map<string, number>();
  const deleted = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    if (!chunk.length) continue;
    const [s, d] = await Promise.all([
      db
        .select({ id: transactions.id, ext: transactions.externalId })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            eq(transactions.source, "csv"),
            inArray(transactions.externalId, chunk),
          ),
        ),
      db
        .select({ ext: syncIgnored.externalId })
        .from(syncIgnored)
        .where(
          and(
            eq(syncIgnored.accountId, accountId),
            eq(syncIgnored.source, "csv"),
            inArray(syncIgnored.externalId, chunk),
          ),
        ),
    ]);
    for (const r of s) stored.set(r.ext!, r.id);
    for (const r of d) deleted.add(r.ext);
  }

  // Same asset, type and day with (almost) the same quantity, from another source or an earlier
  // import with a different mapping: probably the same transaction.
  const existing = await db
    .select({
      id: transactions.id,
      assetId: transactions.assetId,
      type: transactions.type,
      occurredAt: transactions.occurredAt,
      quantity: transactions.quantity,
      amount: transactions.amount,
      externalId: transactions.externalId,
      source: transactions.source,
    })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));
  const sameType = (a: string, b: string) =>
    a === b || (a === "deposit" && b === "transfer_in") || (a === "withdrawal" && b === "transfer_out");
  const close = (a: Decimal, b: Decimal) =>
    a
      .minus(b)
      .abs()
      .lte((a.gt(b) ? a : b).mul("0.005"));
  const byKey = new Map<string, typeof existing>();
  for (const e of existing) {
    const k = `${e.assetId}|${localDay(e.occurredAt)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }

  const out = new Map<number, { status: RowStatus; duplicateOf?: number; message?: string }>();
  const claimed = new Set<number>();
  for (const r of rows) {
    const storedId = stored.get(r.externalId);
    if (storedId) {
      out.set(r.line, { status: "duplicate", duplicateOf: storedId, message: "Already imported" });
      continue;
    }
    if (deleted.has(r.externalId)) {
      out.set(r.line, { status: "deleted", message: "Imported before and deleted since" });
      continue;
    }
    const asset = assetOf.get(r.key)?.asset;
    const twin =
      asset && asset.id > 0
        ? (byKey.get(`${asset.id}|${localDay(r.at)}`) ?? []).find(
            (e) =>
              !claimed.has(e.id) &&
              sameType(r.type, e.type) &&
              (r.type === "dividend" ? close(r.amount, D(e.amount)) : close(r.quantity, D(e.quantity))),
          )
        : undefined;
    if (twin) {
      claimed.add(twin.id);
      out.set(r.line, {
        status: "possible-duplicate",
        duplicateOf: twin.id,
        message: `Looks like transaction #${twin.id} (${twin.source === "csv" ? "an earlier import" : twin.source})`,
      });
      continue;
    }
    out.set(r.line, { status: "new" });
  }
  return out;
}

async function loadAccount(db: DB, accountId: number) {
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!acc) throw new Error("Unknown account");
  return acc;
}

function detect(data: string[][], m: Mapping) {
  const values = (f: Field) =>
    m.columns[f] == null
      ? []
      : data
          .slice(0, 500)
          .map((r) => r[m.columns[f]!] ?? "")
          .filter(Boolean);
  const decimal =
    m.decimal !== "auto"
      ? m.decimal
      : detectDecimal((["quantity", "price", "total", "fee", "amount", "tax"] as const).flatMap((f) => values(f)));
  const dateOrder = m.dateOrder !== "auto" ? m.dateOrder : detectDateOrder(values("date"));
  return { decimal, dateOrder };
}

export interface PlanDeps {
  db: DB;
  fetchFn?: FetchFn;
}

/** Dry run: what importing `content` with `m` into the account would do. Creates nothing. */
export async function planImport(deps: PlanDeps, content: string, accountId: number, m: Mapping): Promise<Plan> {
  const account = await loadAccount(deps.db, accountId);
  const { delimiter, headers, data } = readTable(content, m);
  const { decimal, dateOrder } = detect(data, m);
  const { parsed, rejected } = parseRows(data, m, account.kind, decimal, dateOrder);

  const resolver = new AssetResolver(deps.db, deps.fetchFn, 0, undefined, { dryRun: true });
  const assetOf = await resolveAssets(deps.db, parsed, m, resolver, true);
  const status = await classify(deps.db, accountId, parsed, assetOf);

  const rows: PlannedRow[] = [
    ...rejected,
    ...parsed.map((r) => ({
      line: r.line,
      ...status.get(r.line)!,
      date: r.at.toISOString(),
      type: r.type,
      assetKey: r.key,
      quantity: r.type === "dividend" ? undefined : str(r.quantity),
      price: r.price ? str(r.price) : undefined,
      currency: r.currency,
      fee: r.fee.isZero() ? undefined : str(r.fee),
      amount: r.amount.isZero() ? undefined : str(r.amount),
      tax: r.tax.isZero() ? undefined : str(r.tax),
      notes: r.notes ?? undefined,
    })),
  ].sort((a, b) => a.line - b.line);

  const counts = new Map<string, number>();
  for (const r of parsed) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  const plannedAssets: PlannedAsset[] = [...assetOf.entries()].map(([key, { asset, overridden }]) => ({
    key,
    label: key.split(":").slice(1).join(":"),
    rows: counts.get(key) ?? 0,
    match: {
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      priceSource: asset.priceSource,
      priceRef: asset.priceRef,
    },
    overridden,
  }));

  const typeCounts = new Map<string, number>();
  if (m.typeMode === "column" && m.columns.type != null) {
    for (const r of data) {
      const v = (r[m.columns.type] ?? "").trim();
      typeCounts.set(v, (typeCounts.get(v) ?? 0) + 1);
    }
  }

  const summary: Record<RowStatus, number> = {
    new: 0,
    duplicate: 0,
    deleted: 0,
    "possible-duplicate": 0,
    skipped: 0,
    error: 0,
  };
  for (const r of rows) summary[r.status]++;

  return {
    headers,
    sample: data.slice(0, 8),
    detected: { delimiter, decimal, dateOrder },
    typeValues: [...typeCounts.entries()].map(([value, count]) => ({ value, count })),
    rows,
    assets: plannedAssets,
    summary,
    warnings: resolver.warnings,
  };
}

export interface CommitDeps extends PlanDeps {
  fx: FxService;
}

export interface CommitResult {
  importId: number | null;
  inserted: number;
  skipped: number;
  newAssets: string[];
  createdAssetIds: number[];
  warnings: string[];
}

/**
 * Imports the file: rows planned as "new", plus possible duplicates listed in `include`, in one
 * database transaction. Missing assets are created first.
 */
export async function commitImport(
  deps: CommitDeps,
  content: string,
  fileName: string,
  accountId: number,
  m: Mapping,
  include: number[],
): Promise<CommitResult> {
  const { db } = deps;
  const account = await loadAccount(db, accountId);
  const { data } = readTable(content, m);
  const { decimal, dateOrder } = detect(data, m);
  const { parsed } = parseRows(data, m, account.kind, decimal, dateOrder);

  const resolver = new AssetResolver(db, deps.fetchFn);
  // Classify against existing assets first, so new assets can't hide a duplicate.
  const preview = new AssetResolver(db, deps.fetchFn, 0, undefined, { dryRun: true });
  const status = await classify(db, accountId, parsed, await resolveAssets(db, parsed, m, preview, true));
  const wanted = new Set(include);
  const todo = parsed.filter((r) => {
    const s = status.get(r.line)!.status;
    return s === "new" || (s === "possible-duplicate" && wanted.has(r.line));
  });
  const assetOf = await resolveAssets(db, todo, m, resolver, false);
  const warnings: string[] = [];

  // Exchange rates and market prices, fetched once per currency and asset.
  const history = new HistoryService(db, deps.fx, deps.fetchFn);
  const span = (rs: ParsedRow[]) => {
    const days = rs.map((r) => localDay(r.at)).sort();
    return [days[0]!, days[days.length - 1]!] as const;
  };
  for (const cur of new Set(todo.map((r) => r.currency).filter((c) => c !== "EUR" && isFiat(c)))) {
    try {
      await deps.fx.ensureRange([cur], ...span(todo.filter((r) => r.currency === cur)));
    } catch {
      // single-day lookups below report what's missing
    }
  }
  const needsMarket = todo.filter(
    (r) => !r.price && (r.type === "deposit" || r.type === "reward") && r.kind !== "fiat",
  );
  for (const key of new Set(needsMarket.map((r) => r.key))) {
    try {
      await history.ensureRange(assetOf.get(key)!.asset, ...span(needsMarket.filter((r) => r.key === key)));
    } catch {
      // valued at €0 with a warning below
    }
  }
  const fxOn = async (currency: string, at: Date) => {
    if (currency === "EUR") return D(1);
    try {
      return await deps.fx.eurPerUnit(currency, localDay(at));
    } catch {
      throw new Error(`No exchange rate for ${currency} on ${localDay(at)}`);
    }
  };

  const rows: TxInsert[] = [];
  for (const r of todo) {
    const asset = assetOf.get(r.key)!.asset;
    const base: TxInsert = {
      accountId,
      assetId: asset.id,
      type: r.type,
      occurredAt: r.at,
      source: "csv",
      externalId: r.externalId,
      notes: r.notes,
    };
    try {
      if (asset.assetClass === "cash") {
        const cur = asset.priceRef ?? asset.symbol;
        rows.push({
          ...base,
          quantity: str(r.quantity),
          price: "1",
          currency: cur,
          fxRate: str(await fxOn(cur, r.at)),
        });
        continue;
      }
      if (r.type === "fee" || r.type === "split") {
        rows.push({ ...base, quantity: str(r.quantity), currency: "EUR", fxRate: "1" });
        continue;
      }
      const fx = await fxOn(r.currency, r.at);
      const settle =
        m.settleCash && (r.type === "buy" || r.type === "sell" || r.type === "dividend")
          ? (await resolver.resolve({ kind: "fiat", currency: r.currency })).id
          : null;
      if (r.type === "dividend") {
        rows.push({
          ...base,
          currency: r.currency,
          fxRate: str(fx),
          amount: str(r.amount),
          taxWithheld: str(r.tax),
          settleAssetId: settle,
        });
        continue;
      }
      let price = r.price;
      let currency = r.currency;
      let fxRate = fx;
      if (!price && (r.type === "deposit" || r.type === "reward")) {
        // No price in the file: value at that day's market close.
        price = await history.eurOn(asset.id, localDay(r.at));
        if (!price)
          warnings.push(`Line ${r.line}: no market price for ${asset.symbol} on ${localDay(r.at)}; booked at €0.`);
        currency = "EUR";
        fxRate = D(1);
      }
      rows.push({
        ...base,
        quantity: str(r.quantity),
        price: str(price ?? ZERO),
        currency,
        fxRate: str(fxRate),
        feeEur: str(m.feeCurrency === "EUR" ? r.fee : r.fee.mul(fx)),
        settleAssetId: settle,
      });
    } catch (err) {
      warnings.push(`Line ${r.line} skipped: ${(err as Error).message}`);
    }
  }

  const result = await db.transaction(async (trx) => {
    if (!rows.length) return { importId: null, inserted: 0 };
    const [imp] = await trx
      .insert(imports)
      .values({ accountId, fileName: fileName.slice(0, 200), rows: data.length, inserted: 0 })
      .returning();
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const res = await trx
        .insert(transactions)
        .values(rows.slice(i, i + 200).map((r) => ({ ...r, importId: imp!.id })))
        .onConflictDoNothing()
        .returning({ id: transactions.id });
      inserted += res.length;
    }
    if (inserted === 0) {
      await trx.delete(imports).where(eq(imports.id, imp!.id));
      return { importId: null, inserted };
    }
    await trx.update(imports).set({ inserted }).where(eq(imports.id, imp!.id));
    return { importId: imp!.id, inserted };
  });

  return {
    ...result,
    skipped: data.length - result.inserted,
    newAssets: resolver.describeCreated(),
    createdAssetIds: resolver.created.map((a) => a.id),
    warnings: [...warnings, ...resolver.warnings],
  };
}
