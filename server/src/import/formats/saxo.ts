import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  type TemplateRow,
  cell,
  column,
  converted,
  dmy,
  hasColumns,
  looseNum,
  monthNameDate,
  pounds,
  skip,
} from "./types.js";

/**
 * Saxo (Profile → Transaction overview → Export to Excel, saved as CSV). Amounts are in the account's
 * currency; trades are read from "Buy 3 @ 134.85 USD", with the commission worked out from the total.
 */
export const saxo: BrokerFormat = {
  id: "saxo",
  label: msg("Saxo transaction overview"),
  detect: (h) => hasColumns(h, "trade date", "instrument isin", "event", "amount", "conversion rate"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      date: column(h, "trade date"),
      type: column(h, "type"),
      name: column(h, "instrument"),
      isin: column(h, "instrument isin"),
      currency: column(h, "instrument currency"),
      symbol: column(h, "instrument symbol"),
      event: column(h, "event"),
      amount: column(h, "amount"),
      order: column(h, "order id"),
      rate: column(h, "conversion rate"),
    };
    const taxes = new Map<string, number>();
    const dividends: { row: TemplateRow; net: number }[] = [];
    for (const r of table.slice(1).reverse()) {
      const date = monthNameDate(cell(r, c.date)) ?? dmy(cell(r, c.date));
      if (!date) continue;
      const event = cell(r, c.event);
      const amount = looseNum(cell(r, c.amount));
      const rate = Number(looseNum(cell(r, c.rate)) ?? 1) || 1;
      const isin = cell(r, c.isin) || undefined;
      const security = {
        isin,
        symbol: cell(r, c.symbol).split(":")[0] || undefined,
        name: cell(r, c.name) || undefined,
      };
      const trade = /^(buy|sell)\s+([\d.,]+)\s*@\s*([\d.,]+)\s*([A-Za-z]{3})/i.exec(event);
      if (trade) {
        const side = trade[1]!.toLowerCase() as "buy" | "sell";
        const quantity = looseNum(trade[2])!;
        const p = pounds(looseNum(trade[3]), trade[4]!);
        // The amount (account currency) includes the commission; in the trade's currency:
        const value = Math.abs(Number(amount ?? 0)) / rate;
        const gross = Number(quantity) * Number(p.price ?? 0);
        let fee = side === "buy" ? value - gross : gross - value;
        // Saxo doesn't say which way its conversion rate goes; a "commission" of more than 5% means
        // it went the other way: leave it out rather than book a wrong cost.
        if (fee > gross * 0.05) {
          out.warnings.push(tr("The commission on {date} couldn't be worked out and was left out.", { date }));
          fee = 0;
        }
        out.rows.push({
          date,
          type: side,
          ...security,
          quantity,
          price: p.price ?? undefined,
          currency: p.currency,
          fee: fee > 0.005 ? fee.toFixed(2) : undefined,
          id: cell(r, c.order) ? `saxo:${cell(r, c.order)}` : undefined,
        });
      } else if (isin && /withholding|bronbelasting|dividend tax/i.test(event)) {
        taxes.set(`${isin}|${date}`, (taxes.get(`${isin}|${date}`) ?? 0) + Math.abs(Number(amount ?? 0)) / rate);
      } else if (isin && /dividend/i.test(event)) {
        dividends.push({
          row: { date, type: "dividend", ...security, currency: cell(r, c.currency) || "EUR" },
          net: Number(amount ?? 0) / rate,
        });
      } else if (/deposit|withdrawal|transfer|fee|interest/i.test(`${event} ${cell(r, c.type)}`))
        skip(out.skipped, tr("Cash movements and account costs"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    for (const { row, net } of dividends) {
      // A net amount plus the tax withheld from it is the gross dividend.
      const tax = taxes.get(`${row.isin}|${row.date}`) ?? 0;
      out.rows.push({ ...row, amount: (net + tax).toFixed(4), tax: tax ? tax.toFixed(4) : undefined });
    }
    out.rows.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  },
};
