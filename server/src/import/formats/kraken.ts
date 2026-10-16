import { msg, trn } from "../../i18n/index.js";
import { mapKrakenLedger } from "../../sync/providers/kraken.js";
import type { AssetRef, SyncEvent } from "../../sync/types.js";
import { type BrokerFormat, type TemplateRow, column, converted, hasColumns, isFiatCode, utc } from "./types.js";

/** A provider event as template rows (for formats read with a sync provider's own mapping). */
function eventRows(e: SyncEvent): TemplateRow[] | "crypto-quote" {
  const date = e.at.toISOString();
  const asset = (a: AssetRef): Pick<TemplateRow, "symbol" | "assetType" | "isin"> =>
    a.kind === "fiat"
      ? { symbol: a.currency, assetType: "cash" }
      : a.kind === "crypto"
        ? { symbol: a.symbol, assetType: "crypto" }
        : { symbol: a.symbol, isin: a.isin };
  switch (e.kind) {
    case "trade": {
      if (!e.quote) return [];
      if (!isFiatCode(e.quote.currency)) return "crypto-quote";
      const fee = Number(e.feeQuote ?? 0);
      // A buy's quote includes the fee; a sale's quote is after it.
      const gross = e.side === "buy" ? Number(e.quote.amount) - fee : Number(e.quote.amount) + fee;
      return [
        {
          date,
          type: e.side,
          ...asset(e.asset),
          quantity: e.quantity,
          total: gross.toFixed(8),
          currency: e.quote.currency,
          fee: fee ? fee.toFixed(8) : undefined,
          id: e.id,
        },
      ];
    }
    case "deposit":
    case "withdrawal":
      return [{ date, type: e.kind, ...asset(e.asset), quantity: e.quantity, notes: e.note, id: e.id }];
    case "reward":
      return [{ date, type: "reward", ...asset(e.asset), quantity: e.quantity, notes: e.note, id: e.id }];
    case "fee":
      return [{ date, type: "fee", ...asset(e.asset), quantity: e.quantity, notes: e.note, id: e.id }];
    case "dividend":
      return [
        { date, type: "dividend", ...asset(e.asset), currency: e.currency, amount: e.gross, tax: e.tax, id: e.id },
      ];
  }
}

/**
 * Kraken's ledger export (History → Export → Ledgers, "ledgers.csv"), read with the same mapping as
 * the API connection: trades are paired by reference id, staking moves fall away.
 */
export const krakenLedgers: BrokerFormat = {
  id: "kraken-ledgers",
  label: msg("Kraken ledgers"),
  detect: (h) => hasColumns(h, "txid", "refid", "time", "type", "asset", "amount", "fee", "balance"),
  convert(table) {
    const out = converted({ settleCash: true });
    const h = table[0]!;
    const c = {
      txid: column(h, "txid"),
      refid: column(h, "refid"),
      time: column(h, "time"),
      type: column(h, "type"),
      subtype: column(h, "subtype"),
      asset: column(h, "asset"),
      amount: column(h, "amount"),
      fee: column(h, "fee"),
    };
    const entries = table
      .slice(1)
      .filter((r) => (r[c.txid] ?? "").trim())
      .map((r) => {
        const iso = utc((r[c.time] ?? "").trim());
        return {
          refid: (r[c.refid] ?? "").trim(),
          time: iso ? Date.parse(iso) / 1000 : NaN,
          type: (r[c.type] ?? "").trim(),
          subtype: c.subtype >= 0 ? (r[c.subtype] ?? "").trim() : "",
          asset: (r[c.asset] ?? "").trim(),
          amount: (r[c.amount] ?? "0").trim() || "0",
          fee: (r[c.fee] ?? "0").trim() || "0",
        };
      })
      .filter((e) => Number.isFinite(e.time));
    // Nothing is held back as "still arriving": the file is complete.
    let cryptoQuote = 0;
    for (const e of mapKrakenLedger(entries, {}, Number.MAX_SAFE_INTEGER)) {
      const rows = eventRows(e);
      if (rows === "crypto-quote") cryptoQuote++;
      else out.rows.push(...rows);
    }
    out.rows.sort((a, b) => a.date.localeCompare(b.date));
    if (cryptoQuote)
      out.warnings.push(
        trn(
          cryptoQuote,
          "{n} trade between two coins (not against euros) was left out: connect Kraken with an API key to include it.",
          "{n} trades between two coins (not against euros) were left out: connect Kraken with an API key to include them.",
        ),
      );
    return out;
  },
};
