import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  cell,
  column,
  converted,
  dmy,
  fixed,
  hasColumns,
  norm,
  num,
  skip,
} from "./types.js";

/**
 * Scalable Capital (Transactions → select → Export CSV; PRIME+ Broker only). Everything is in euros,
 * so cash is followed: deposits, withdrawals, interest and fees are booked with the trades. Built
 * on Portfolio Performance's template and user samples, not yet tested with a real export (see
 * docs/exportformaten.md).
 */
export const scalableCapital: BrokerFormat = {
  id: "scalable-capital",
  label: msg("Scalable Capital transactions"),
  detect: (h) =>
    hasColumns(h, "date", "time", "status", "reference", "assettype", "type", "isin", "shares", "price", "amount") &&
    hasColumns(h, "fee", "tax", "currency"),
  convert(table) {
    const out = converted({ settleCash: true, feeCurrency: "EUR" });
    const h = table[0]!;
    const c = {
      date: column(h, "date"),
      time: column(h, "time"),
      status: column(h, "status"),
      ref: column(h, "reference"),
      description: column(h, "description"),
      type: column(h, "type"),
      isin: column(h, "isin"),
      shares: column(h, "shares"),
      price: column(h, "price"),
      amount: column(h, "amount"),
      fee: column(h, "fee"),
      tax: column(h, "tax"),
      currency: column(h, "currency"),
    };
    // German notation: "1.526,72". (looseNum would read "1.000" as 1.)
    const n = (r: string[], i: number) => num(cell(r, i), ",");
    for (const r of table.slice(1)) {
      const date = dmy(cell(r, c.date));
      if (!date) continue;
      if (norm(cell(r, c.status)) !== "executed") {
        skip(out.skipped, tr("Orders that weren't executed"));
        continue;
      }
      const time = cell(r, c.time) || undefined;
      const type = norm(cell(r, c.type));
      const ref = cell(r, c.ref);
      const currency = cell(r, c.currency).toUpperCase() || "EUR";
      const amount = Number(n(r, c.amount) ?? 0);
      const fee = Number(abs(n(r, c.fee)) ?? 0);
      const tax = Number(abs(n(r, c.tax)) ?? 0);
      const security = { isin: cell(r, c.isin) || undefined, name: cell(r, c.description) || undefined };
      const shares = abs(n(r, c.shares));
      const cash = (t: TemplateRow["type"], q: number) =>
        out.rows.push({
          date,
          time,
          type: t,
          symbol: currency,
          assetType: "cash",
          quantity: fixed(q)!,
          notes: cell(r, c.type),
        });
      if ((type === "buy" || type === "savings plan" || type === "sell") && shares && Number(shares)) {
        if (type === "sell" && tax)
          out.warnings.push(tr("Tax withheld on a sale was left out (line {line}).", { line: table.indexOf(r) + 1 }));
        out.rows.push({
          date,
          time,
          type: type === "sell" ? "sell" : "buy",
          ...security,
          quantity: shares,
          price: abs(n(r, c.price)) ?? undefined,
          currency,
          fee: fixed(fee, 2),
          id: ref ? `scalable:${ref}` : undefined,
        });
      } else if (type === "distribution" && security.isin && amount > 0) {
        // The amount is what was paid out; with the tax withheld it's the gross distribution.
        out.rows.push({
          date,
          time,
          type: "dividend",
          ...security,
          currency,
          amount: fixed(amount + tax, 4),
          tax: fixed(tax, 4),
          id: ref ? `scalable:${ref}` : undefined,
        });
      } else if ((type === "deposit" || type === "cash transfer in") && amount) cash("deposit", Math.abs(amount));
      else if ((type === "withdrawal" || type === "cash transfer out") && amount) cash("withdrawal", Math.abs(amount));
      else if (type === "interest" && amount > 0) cash("reward", amount);
      // Fees outside orders, and taxes (German tax on gains), both reduce the cash.
      else if ((type === "fee" || type === "taxes") && amount < 0) cash("fee", -amount);
      else if (type === "taxes" && amount > 0) cash("reward", amount);
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};
