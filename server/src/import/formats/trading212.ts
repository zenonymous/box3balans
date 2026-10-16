import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  abs,
  cell,
  column,
  converted,
  fixed,
  hasColumns,
  norm,
  num,
  pounds,
  skip,
  utc,
} from "./types.js";

/**
 * Trading 212 (History → Export). Trades in other currencies settle in euros at Trading 212, so
 * cash (deposits, interest) is left out.
 */
export const trading212: BrokerFormat = {
  id: "trading212",
  label: msg("Trading 212 history"),
  detect: (h) => hasColumns(h, "action", "time", "isin", "no of shares", "price share"),
  convert(table) {
    const out = converted({ feeCurrency: "EUR" });
    const h = table[0]!;
    const c = {
      action: column(h, "action"),
      time: column(h, "time"),
      isin: column(h, "isin"),
      ticker: column(h, "ticker"),
      name: column(h, "name"),
      shares: column(h, "no of shares"),
      price: column(h, "price share"),
      priceCurrency: column(h, "currency price share"),
      total: column(h, "total"),
      tax: column(h, "withholding tax"),
      taxCurrency: column(h, "currency withholding tax"),
      id: column(h, "id"),
    };
    // Every cost column (conversion fee, stamp duty, transaction fee, French tax …) except dividend tax.
    const feeColumns = h
      .map((name, i) => ({ raw: name, name: norm(name), i }))
      .filter((x) => /fee|stamp duty|transaction tax|finra/.test(x.name) && !/^currency\s*\(/i.test(x.raw.trim()))
      .map((x) => x.i);
    for (const r of table.slice(1)) {
      const action = norm(cell(r, c.action));
      const date = utc(cell(r, c.time));
      if (!date) continue;
      const security = {
        isin: cell(r, c.isin) || undefined,
        symbol: cell(r, c.ticker) || undefined,
        name: cell(r, c.name) || undefined,
      };
      const shares = abs(num(cell(r, c.shares), "."));
      const p = pounds(num(cell(r, c.price), "."), cell(r, c.priceCurrency) || "EUR");
      if (/ buy$| sell$/.test(` ${action}`) && shares) {
        const fee = feeColumns.reduce((s, i) => s + Number(abs(num(cell(r, i), ".")) ?? 0), 0);
        out.rows.push({
          date,
          type: action.endsWith("sell") ? "sell" : "buy",
          ...security,
          quantity: shares,
          price: p.price ?? undefined,
          currency: p.currency,
          fee: fixed(fee, 2),
          id: cell(r, c.id) || undefined,
        });
      } else if (action.startsWith("dividend") && shares && p.price) {
        // Gross per share × shares, in the security's currency; tax when it's in that currency too.
        const taxCurrency = cell(r, c.taxCurrency).toUpperCase();
        const tax = taxCurrency === p.currency || !taxCurrency ? abs(num(cell(r, c.tax), ".")) : null;
        if (!tax && cell(r, c.tax))
          out.warnings.push(
            tr("Dividend tax in another currency was left out (line {line}).", { line: table.indexOf(r) + 1 }),
          );
        out.rows.push({
          date,
          type: "dividend",
          ...security,
          currency: p.currency,
          amount: fixed(Number(shares) * Number(p.price), 6),
          tax: tax ?? undefined,
          id: cell(r, c.id) || undefined,
        });
      } else if (/deposit|withdrawal|interest|card|conversion/.test(action))
        skip(out.skipped, tr("Cash movements (deposits, withdrawals, currency exchange)"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};
