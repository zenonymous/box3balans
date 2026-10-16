import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  cell,
  column,
  columnStarting,
  converted,
  hasColumns,
  norm,
  num,
  pounds,
  skip,
} from "./types.js";

/** BUX (Account value → History → download). Cash, subscription fees and interest are left out. */
export const bux: BrokerFormat = {
  id: "bux",
  label: msg("BUX history"),
  detect: (h) => hasColumns(h, "transaction category", "transaction type", "asset id", "asset quantity"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      time: columnStarting(h, "transaction time"),
      category: column(h, "transaction category"),
      type: column(h, "transaction type"),
      amount: column(h, "transaction amount"),
      currency: column(h, "transaction currency"),
      isin: column(h, "asset id"),
      name: column(h, "asset name"),
      quantity: column(h, "asset quantity"),
      price: column(h, "asset price"),
      assetCurrency: column(h, "asset currency"),
      divCurrency: column(h, "dividend currency"),
      divGross: column(h, "dividend gross amount"),
      divTax: column(h, "dividend tax amount"),
    };
    const rows = table.slice(1).filter((r) => cell(r, c.time));
    rows.sort((a, b) => cell(a, c.time).localeCompare(cell(b, c.time)));
    const trades: { row: TemplateRow; at: string; isin: string }[] = [];
    for (const r of rows) {
      const at = cell(r, c.time);
      const date = at.slice(0, 10);
      const time = at.slice(11, 19) || undefined;
      const category = norm(cell(r, c.category));
      const type = norm(cell(r, c.type));
      const isin = cell(r, c.isin);
      if (category === "trades" && /buy|sell/.test(type)) {
        const p = pounds(num(cell(r, c.price), "."), cell(r, c.assetCurrency) || "EUR");
        const row: TemplateRow = {
          date,
          time,
          type: type.includes("sell") ? "sell" : "buy",
          isin: isin || undefined,
          name: cell(r, c.name) || undefined,
          quantity: abs(num(cell(r, c.quantity), "."))!,
          price: p.price ?? undefined,
          currency: p.currency,
        };
        trades.push({ row, at: at.slice(0, 19), isin });
        out.rows.push(row);
      } else if (category === "fees" && /trading fee|trade fee|order fee/.test(type)) {
        // The fee comes with its trade: same security, same moment.
        const t = [...trades].reverse().find((x) => x.isin === isin && x.at === at.slice(0, 19));
        if (t) t.row.fee = (Number(t.row.fee ?? 0) + Number(abs(num(cell(r, c.amount), ".")) ?? 0)).toFixed(2);
        else skip(out.skipped, tr("Costs without a trade (subscription, service fees)"));
      } else if (category === "dividends") {
        const gross = abs(num(cell(r, c.divGross), "."));
        out.rows.push({
          date,
          time,
          type: "dividend",
          isin: isin || undefined,
          name: cell(r, c.name) || undefined,
          currency: (gross ? cell(r, c.divCurrency) : cell(r, c.currency)) || "EUR",
          amount: gross ?? abs(num(cell(r, c.amount), "."))!,
          tax: gross ? (abs(num(cell(r, c.divTax), ".")) ?? undefined) : undefined,
        });
      } else if (category === "fees") skip(out.skipped, tr("Costs without a trade (subscription, service fees)"));
      else if (["deposits", "withdrawals", "interest"].includes(category))
        skip(out.skipped, tr("Cash movements (deposits, withdrawals, currency exchange)"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};
