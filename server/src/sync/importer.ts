import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { syncIgnored, transactions } from "../db/schema.js";
import { D, type Decimal, ZERO, str } from "../lib/decimal.js";
import type { FxService } from "../prices/fx.js";
import type { HistoryService } from "../prices/history.js";
import { type AssetResolver, isFiat } from "./assets.js";
import type { AssetRef, SyncEvent } from "./types.js";

type TxInsert = typeof transactions.$inferInsert;
type Source = "api" | "csv" | "chain";

const day = (d: Date) => d.toISOString().slice(0, 10);

export interface ImportResult {
  inserted: number;
  duplicates: number;
  ignored: number;
  warnings: string[];
}

/**
 * Turns provider events into transactions for one account. Idempotent: rows are keyed by
 * (account, source, externalId); ids the user deleted (sync_ignored) are skipped.
 */
export class Importer {
  readonly warnings: string[] = [];

  constructor(
    private db: DB,
    private resolver: AssetResolver,
    private fx: FxService,
    private history: HistoryService,
  ) {}

  async import(accountId: number, source: Source, events: SyncEvent[]): Promise<ImportResult> {
    // Deletions are remembered per stored row; a swap becomes two rows (id:out / id:in), so an event
    // is only skipped when all of its rows were deleted.
    const ignoredEvents = await this.ignoredIds(
      accountId,
      source,
      events.flatMap((e) => [e.id, `${e.id}:out`, `${e.id}:in`]),
    );
    const todo = events.filter((e) => !ignoredEvents.has(e.id));
    await this.preloadHistory(todo);

    const built: TxInsert[] = [];
    for (const e of todo) {
      try {
        built.push(...(await this.toRows(accountId, e)));
      } catch (err) {
        this.warnings.push(`Skipped ${e.kind} ${e.id}: ${(err as Error).message}`);
      }
    }
    const rows = built.filter((r) => !ignoredEvents.has(r.externalId!));
    const ignoredRows = built.length - rows.length;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200).map((r) => ({ ...r, source }));
      const res = await this.db
        .insert(transactions)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: transactions.id });
      inserted += res.length;
    }
    return {
      inserted,
      duplicates: rows.length - inserted,
      ignored: events.length - todo.length + ignoredRows,
      warnings: this.warnings,
    };
  }

  /** Fetches daily EUR prices once per asset for every event that needs valuing. */
  private async preloadHistory(events: SyncEvent[]) {
    const ranges = new Map<string, { ref: AssetRef; from: string; to: string }>();
    const need = (ref: AssetRef, at: Date) => {
      if (ref.kind !== "crypto") return;
      const key = JSON.stringify(ref);
      const d = day(at);
      const r = ranges.get(key);
      if (!r) ranges.set(key, { ref, from: d, to: d });
      else {
        if (d < r.from) r.from = d;
        if (d > r.to) r.to = d;
      }
    };
    const fiatDays = new Map<string, { from: string; to: string }>();
    const needFx = (currency: string, at: Date) => {
      if (currency === "EUR") return;
      const d = day(at);
      const r = fiatDays.get(currency);
      if (!r) fiatDays.set(currency, { from: d, to: d });
      else {
        if (d < r.from) r.from = d;
        if (d > r.to) r.to = d;
      }
    };
    for (const e of events) {
      if (e.kind === "dividend") needFx(e.currency, e.at);
      else if (e.kind === "trade") {
        if (e.quote && e.valueEur == null) {
          const qr = quoteRefOf(e);
          if (qr.kind === "fiat") needFx(qr.currency, e.at);
          else {
            need(qr, e.at);
            need(e.asset, e.at);
          }
        }
        if (!e.quote && e.valueEur == null) need(e.asset, e.at);
      } else if ((e.kind === "reward" || e.kind === "deposit") && e.valueEur == null) need(e.asset, e.at);
      if (e.kind !== "trade" && e.kind !== "dividend" && e.asset.kind === "fiat") needFx(e.asset.currency, e.at);
    }
    for (const [currency, r] of fiatDays) {
      try {
        await this.fx.ensureRange([currency], r.from, r.to);
      } catch {
        // single-day lookups will be tried per transaction
      }
    }
    for (const r of ranges.values()) {
      try {
        const asset = await this.resolver.resolve(r.ref);
        await this.history.ensureRange(asset, r.from, r.to);
      } catch {
        // valuation falls back to "unknown" with a warning
      }
    }
  }

  private async eurPriceOf(ref: AssetRef, at: Date): Promise<Decimal | null> {
    if (ref.kind === "fiat") return this.fx.eurPerUnit(ref.currency, day(at));
    const asset = await this.resolver.resolve(ref);
    return this.history.eurOn(asset.id, day(at));
  }

  private async toRows(accountId: number, e: SyncEvent): Promise<TxInsert[]> {
    const base = { accountId, occurredAt: e.at, externalId: e.id, notes: e.note ?? null };

    if (e.kind === "dividend") {
      const asset = await this.resolver.resolve(e.asset);
      const cash = await this.resolver.resolve({ kind: "fiat", currency: e.currency });
      return [
        {
          ...base,
          assetId: asset.id,
          type: "dividend",
          currency: e.currency,
          fxRate: str(await this.fx.eurPerUnit(e.currency, day(e.at))),
          amount: e.gross,
          taxWithheld: e.tax,
          settleAssetId: cash.id,
        },
      ];
    }

    const asset = await this.resolver.resolve(e.asset);
    const q = D(e.quantity);
    if (q.lte(0)) throw new Error("quantity must be positive");

    if (e.kind === "deposit" || e.kind === "withdrawal") {
      if (asset.assetClass === "cash") {
        return [
          {
            ...base,
            assetId: asset.id,
            type: e.kind,
            quantity: e.quantity,
            price: "1",
            currency: asset.priceRef!,
            fxRate: str(await this.fx.eurPerUnit(asset.priceRef!, day(e.at))),
          },
        ];
      }
      // Incoming crypto starts with its market value as cost basis, unless it is later matched to
      // a withdrawal from another account (then the original cost basis carries over).
      let price = ZERO;
      if (e.kind === "deposit") {
        const unit = e.valueEur != null ? D(e.valueEur).div(q) : await this.eurPriceOf(e.asset, e.at);
        if (unit) price = unit;
      }
      return [
        {
          ...base,
          assetId: asset.id,
          type: e.kind,
          quantity: e.quantity,
          price: str(price),
          currency: "EUR",
          fxRate: "1",
        },
      ];
    }

    if (e.kind === "reward") {
      const unit = e.valueEur != null ? D(e.valueEur).div(q) : await this.eurPriceOf(e.asset, e.at);
      if (!unit) this.warnings.push(`No EUR price for ${asset.symbol} on ${day(e.at)}; reward ${e.id} booked at €0.`);
      if (asset.assetClass === "cash") {
        // Interest on cash: quantity is the currency amount itself.
        return [
          {
            ...base,
            assetId: asset.id,
            type: "reward",
            quantity: e.quantity,
            price: "1",
            currency: asset.priceRef!,
            fxRate: str(await this.fx.eurPerUnit(asset.priceRef!, day(e.at))),
          },
        ];
      }
      return [
        {
          ...base,
          assetId: asset.id,
          type: "reward",
          quantity: e.quantity,
          price: str(unit ?? ZERO),
          currency: "EUR",
          fxRate: "1",
        },
      ];
    }

    if (e.kind === "fee") {
      return [{ ...base, assetId: asset.id, type: "fee", quantity: e.quantity, currency: "EUR", fxRate: "1" }];
    }

    if (e.kind !== "trade") throw new Error(`unsupported event kind`);
    if (!e.quote) {
      if (e.valueEur == null) throw new Error("trade without quote or EUR value");
      return [
        {
          ...base,
          assetId: asset.id,
          type: e.side,
          quantity: e.quantity,
          price: str(D(e.valueEur).div(q)),
          currency: "EUR",
          fxRate: "1",
        },
      ];
    }

    const quoteRef = quoteRefOf(e);
    const quoteAmt = D(e.quote.amount);

    if (quoteRef.kind === "fiat") {
      const fee = D(e.feeQuote ?? 0);
      // Net quote change → gross price: buy debits qty×price + fee; sell credits qty×price − fee.
      const gross = e.side === "buy" ? quoteAmt.minus(fee) : quoteAmt.plus(fee);
      const fx = await this.fx.eurPerUnit(quoteRef.currency, day(e.at));
      const cash = await this.resolver.resolve(quoteRef);
      return [
        {
          ...base,
          assetId: asset.id,
          type: e.side,
          quantity: e.quantity,
          price: str(gross.div(q)),
          currency: quoteRef.currency,
          fxRate: str(fx),
          feeEur: str(fee.mul(fx)),
          settleAssetId: cash.id,
        },
      ];
    }

    // Crypto-to-crypto: book as a sale of one and a purchase of the other at the same EUR value.
    const quoteAsset = await this.resolver.resolve(quoteRef);
    let valueEur = e.valueEur != null ? D(e.valueEur) : null;
    if (valueEur == null) {
      // Value at what was given up if known, else at what was received.
      const quoteUnit = await this.eurPriceOf(quoteRef, e.at);
      const assetUnit = quoteUnit ? null : await this.eurPriceOf(e.asset, e.at);
      valueEur = quoteUnit ? quoteAmt.mul(quoteUnit) : assetUnit ? q.mul(assetUnit) : null;
    }
    if (!valueEur) {
      this.warnings.push(`No EUR price to value trade ${e.id} (${asset.symbol}/${quoteAsset.symbol}); booked at €0.`);
      valueEur = ZERO;
    }
    const [got, gotQty, gave, gaveQty] =
      e.side === "buy" ? [asset, q, quoteAsset, quoteAmt] : [quoteAsset, quoteAmt, asset, q];
    return [
      {
        ...base,
        externalId: `${e.id}:out`,
        assetId: gave.id,
        type: "sell",
        quantity: str(gaveQty),
        price: str(valueEur.div(gaveQty)),
        currency: "EUR",
        fxRate: "1",
      },
      {
        ...base,
        externalId: `${e.id}:in`,
        assetId: got.id,
        type: "buy",
        quantity: str(gotQty),
        price: str(valueEur.div(gotQty)),
        currency: "EUR",
        fxRate: "1",
      },
    ];
  }

  private async ignoredIds(accountId: number, source: Source, ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      if (!chunk.length) continue;
      const rows = await this.db
        .select({ id: syncIgnored.externalId })
        .from(syncIgnored)
        .where(
          and(
            eq(syncIgnored.accountId, accountId),
            eq(syncIgnored.source, source),
            inArray(syncIgnored.externalId, chunk),
          ),
        );
      for (const r of rows) out.add(r.id);
    }
    return out;
  }
}

/** External ids already stored or deliberately deleted for the account. */
export async function knownIds(db: DB, accountId: number, source: Source, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    if (!chunk.length) continue;
    const [stored, ignored] = await Promise.all([
      db
        .select({ id: transactions.externalId })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            eq(transactions.source, source),
            inArray(transactions.externalId, chunk),
          ),
        ),
      db
        .select({ id: syncIgnored.externalId })
        .from(syncIgnored)
        .where(
          and(
            eq(syncIgnored.accountId, accountId),
            eq(syncIgnored.source, source),
            inArray(syncIgnored.externalId, chunk),
          ),
        ),
    ]);
    for (const r of [...stored, ...ignored]) if (r.id) out.add(r.id);
  }
  return out;
}

function quoteRefOf(e: Extract<SyncEvent, { kind: "trade" }>): AssetRef {
  if (e.quoteRef) return e.quoteRef;
  const code = e.quote!.currency.toUpperCase();
  return isFiat(code) ? { kind: "fiat", currency: code } : { kind: "crypto", symbol: code };
}
