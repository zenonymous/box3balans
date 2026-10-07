import { msg, tr, trn } from "../../i18n/index.js";
import { mapKrakenLedger } from "../../sync/providers/kraken.js";
import type { AssetRef, SyncEvent } from "../../sync/types.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  column,
  converted,
  hasColumns,
  isFiatCode,
  isNegative,
  norm,
  num,
  skip,
  utc,
} from "./types.js";

const crypto = (symbol: string): Pick<TemplateRow, "symbol" | "assetType"> => ({
  symbol: symbol.toUpperCase(),
  assetType: isFiatCode(symbol) ? "cash" : "crypto",
});

/**
 * Bitvavo's transaction history (Transaction history → Export, CSV). All in euros, so deposits,
 * withdrawals and the euros paid for trades are booked and the cash balance stays right.
 */
export const bitvavo: BrokerFormat = {
  id: "bitvavo",
  label: msg("Bitvavo transaction history"),
  detect: (h) => hasColumns(h, "type", "currency", "amount", "quote price", "fee currency", "transaction id"),
  convert(table) {
    const out = converted({ settleCash: true });
    const h = table[0]!;
    const c = Object.fromEntries(
      (
        [
          ["date", "date"],
          ["time", "time"],
          ["type", "type"],
          ["currency", "currency"],
          ["amount", "amount"],
          ["quote", "quote currency"],
          ["price", "quote price"],
          ["feeCurrency", "fee currency"],
          ["fee", "fee amount"],
          ["status", "status"],
          ["id", "transaction id"],
        ] as const
      ).map(([k, name]) => [k, column(h, name)]),
    ) as Record<string, number>;
    const get = (r: string[], k: string) => (c[k]! >= 0 ? (r[c[k]!] ?? "").trim() : "");
    for (const r of table.slice(1).reverse()) {
      if (!r.some((x) => x.trim())) continue;
      const status = get(r, "status").toLowerCase();
      if (status && status !== "completed") {
        skip(out.skipped, tr("Cancelled or pending"));
        continue;
      }
      const type = get(r, "type").toLowerCase();
      const symbol = get(r, "currency");
      const amount = num(get(r, "amount"), ".");
      const fee = abs(num(get(r, "fee"), "."));
      const feeCurrency = get(r, "feeCurrency").toUpperCase();
      const id = get(r, "id") || undefined;
      const when = { date: get(r, "date"), time: get(r, "time").slice(0, 8) || undefined };
      if (!amount || !symbol) {
        skip(out.skipped, tr("Lines without an amount"));
        continue;
      }
      // A fee in the coin itself (e.g. on a withdrawal) is its own line.
      const coinFee = (note: string) => {
        if (fee && Number(fee) && feeCurrency && feeCurrency !== get(r, "quote").toUpperCase())
          out.rows.push({
            ...when,
            type: "fee",
            ...crypto(feeCurrency),
            quantity: fee,
            notes: note,
            id: id && `${id}:fee`,
          });
      };
      if (type === "buy" || type === "sell") {
        const quote = get(r, "quote").toUpperCase() || "EUR";
        out.rows.push({
          ...when,
          type,
          ...crypto(symbol),
          quantity: abs(amount)!,
          price: num(get(r, "price"), ".") ?? undefined,
          currency: quote,
          fee: fee && feeCurrency === quote ? fee : undefined,
          id,
        });
        coinFee(tr("Trading fee"));
      } else if (type === "deposit" || type === "withdrawal") {
        out.rows.push({ ...when, type, ...crypto(symbol), quantity: abs(amount)!, id });
        if (type === "withdrawal") coinFee(tr("Network fee"));
      } else if (/staking|reward|rebate|airdrop|affiliate|bonus/.test(type) && !isNegative(amount)) {
        out.rows.push({ ...when, type: "reward", ...crypto(symbol), quantity: amount, notes: type, id });
      } else skip(out.skipped, tr("Staking moves and other lines"));
    }
    return out;
  },
};

/**
 * Coinbase's transaction report (Profile → Statements → CSV). Fiat deposits and withdrawals are
 * left out: purchases are often paid by card or bank, so a euro balance wouldn't add up.
 */
export const coinbase: BrokerFormat = {
  id: "coinbase",
  label: msg("Coinbase transaction report"),
  detect: (h) => hasColumns(h, "timestamp", "transaction type", "asset", "quantity transacted"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      id: column(h, "id"),
      at: column(h, "timestamp"),
      type: column(h, "transaction type"),
      asset: column(h, "asset"),
      quantity: column(h, "quantity transacted"),
      currency: column(h, "price currency", "spot price currency"),
      price: column(h, "price at transaction", "spot price at transaction"),
      subtotal: column(h, "subtotal"),
      total: column(h, "total inclusive of fees and or spread", "total inclusive of fees"),
      fee: column(h, "fees and or spread", "fees"),
      notes: column(h, "notes"),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const symbolOf = (s: string) => (s.toUpperCase() === "ETH2" ? "ETH" : s.toUpperCase());
    for (const r of table.slice(1).reverse()) {
      const date = utc(get(r, c.at));
      if (!date) continue;
      const type = norm(get(r, c.type));
      const symbol = symbolOf(get(r, c.asset));
      const quantity = abs(num(get(r, c.quantity), "."));
      const currency = get(r, c.currency).toUpperCase() || "EUR";
      const price = abs(num(get(r, c.price), "."));
      const subtotal = abs(num(get(r, c.subtotal), "."));
      const total = abs(num(get(r, c.total), "."));
      const fee = abs(num(get(r, c.fee), "."));
      const id = get(r, c.id) || undefined;
      const notes = get(r, c.notes);
      if (!quantity || !symbol) continue;
      if (/^(advanced trade |advance trade )?(buy|sell)$/.test(type)) {
        out.rows.push({
          date,
          type: type.endsWith("sell") ? "sell" : "buy",
          ...crypto(symbol),
          quantity,
          price: price ?? undefined,
          total: subtotal ?? undefined,
          currency,
          fee: fee && Number(fee) ? fee : undefined,
          id,
        });
      } else if (type === "convert") {
        // "Converted 0.0036 BTC to 156.14 XRP": a sale at the spot value, and a purchase for what came out.
        const m = /converted\s+([\d.,]+)\s+(\S+)\s+to\s+([\d.,]+)\s+(\S+)/i.exec(notes);
        if (!m) {
          skip(out.skipped, tr("Conversions without details"));
          continue;
        }
        const to = symbolOf(m[4]!);
        if (to === symbol) {
          skip(out.skipped, tr("Conversions to the same coin (e.g. ETH to ETH2)"));
          continue;
        }
        const spread = total && subtotal ? (Number(total) - Number(subtotal)).toFixed(8) : undefined;
        out.rows.push({
          date,
          type: "sell",
          ...crypto(symbol),
          quantity,
          price: price ?? undefined,
          currency,
          fee: spread && Number(spread) > 0 ? spread : undefined,
          notes,
          id: id && `${id}:sell`,
        });
        out.rows.push({
          date,
          type: "buy",
          ...crypto(to),
          quantity: abs(num(m[3]!, "."))!,
          total: subtotal ?? undefined,
          currency,
          notes,
          id: id && `${id}:buy`,
        });
      } else if (type === "send" || type === "receive") {
        out.rows.push({
          date,
          type: type === "send" ? "withdrawal" : "deposit",
          ...crypto(symbol),
          quantity,
          // What it was worth when it came in: the cost basis of a coin from elsewhere.
          price: type === "receive" ? (price ?? undefined) : undefined,
          currency,
          notes: notes || undefined,
          id,
        });
      } else if (/income|reward|earn/.test(type)) {
        out.rows.push({
          date,
          type: "reward",
          ...crypto(symbol),
          quantity,
          price: price ?? undefined,
          currency,
          notes: type,
          id,
        });
      } else if (isFiatCode(symbol)) skip(out.skipped, tr("Euro deposits and withdrawals"));
      else skip(out.skipped, tr("Moves within Coinbase (staking, Coinbase Pro)"));
    }
    return out;
  },
};

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
