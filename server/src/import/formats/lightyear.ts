import { msg, tr } from "../../i18n/index.js";
import { type BrokerFormat, abs, cell, column, converted, dmy, fixed, hasColumns, norm, num, skip } from "./types.js";

/**
 * Lightyear (Transactions → Download report, CSV). Lightyear holds cash in several currencies and
 * exchanges it in separate conversion lines, so cash (deposits, withdrawals, interest, rewards,
 * conversions) is left out and only the securities are followed, as with Trading 212. Built on the
 * layout in open-source parsers, not yet tested with a real export (see docs/exportformaten.md).
 */
export const lightyear: BrokerFormat = {
  id: "lightyear",
  label: msg("Lightyear transactions"),
  detect: (h) => hasColumns(h, "reference", "ticker", "isin", "type", "ccy", "gross amount", "net amt", "tax amt"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      date: column(h, "date"),
      ref: column(h, "reference"),
      ticker: column(h, "ticker"),
      isin: column(h, "isin"),
      type: column(h, "type"),
      quantity: column(h, "quantity"),
      currency: column(h, "ccy"),
      price: column(h, "price share"),
      gross: column(h, "gross amount"),
      fee: column(h, "fee"),
      tax: column(h, "tax amt"),
    };
    const n = (r: string[], i: number) => num(cell(r, i), ".");
    for (const r of table.slice(1)) {
      // "14/01/2026 15:31:07"
      const [day = "", time] = cell(r, c.date).split(/\s+/);
      const date = dmy(day);
      if (!date) continue;
      const type = norm(cell(r, c.type));
      const ref = cell(r, c.ref);
      const security = { isin: cell(r, c.isin) || undefined, symbol: cell(r, c.ticker) || undefined };
      const currency = cell(r, c.currency).toUpperCase() || "EUR";
      const fee = Number(abs(n(r, c.fee)) ?? 0);
      const quantity = abs(n(r, c.quantity));
      if ((type === "buy" || type === "sell") && quantity && Number(quantity)) {
        out.rows.push({
          date,
          time,
          type,
          ...security,
          quantity,
          price: abs(n(r, c.price)) ?? undefined,
          currency,
          fee: fixed(fee, 2),
          id: ref ? `lightyear:${ref}` : undefined,
        });
      } else if ((type === "dividend" || type === "distribution") && security.isin) {
        // Gross is net + tax + fee; a fee on a money market fund's distribution comes off the income.
        const gross = Number(abs(n(r, c.gross)) ?? 0) - fee;
        if (gross <= 0) continue;
        out.rows.push({
          date,
          time,
          type: "dividend",
          ...security,
          currency,
          amount: fixed(gross, 4),
          tax: fixed(Number(abs(n(r, c.tax)) ?? 0), 4),
          id: ref ? `lightyear:${ref}` : undefined,
        });
      } else if (/deposit|withdrawal|interest|reward|conversion/.test(type))
        skip(out.skipped, tr("Cash movements (deposits, withdrawals, currency exchange)"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};
