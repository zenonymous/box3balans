import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  abs,
  coinAsset,
  column,
  converted,
  hasColumns,
  isFiatCode,
  norm,
  num,
  skip,
  utc,
} from "./types.js";

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
          ...coinAsset(symbol),
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
          ...coinAsset(symbol),
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
          ...coinAsset(to),
          quantity: abs(num(m[3], "."))!,
          total: subtotal ?? undefined,
          currency,
          notes,
          id: id && `${id}:buy`,
        });
      } else if (type === "send" || type === "receive") {
        out.rows.push({
          date,
          type: type === "send" ? "withdrawal" : "deposit",
          ...coinAsset(symbol),
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
          ...coinAsset(symbol),
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
