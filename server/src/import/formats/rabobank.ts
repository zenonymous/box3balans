import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  abs,
  cell,
  column,
  columnStarting,
  converted,
  dmy,
  fixed,
  hasColumns,
  isNegative,
  norm,
  num,
  skip,
} from "./types.js";

/**
 * Rabobank Beleggen (Mutaties & nota's → Exporteer als .csv). All in euros: deposits, costs and
 * interest are booked with the trades, so the cash balance stays right.
 */
export const rabobank: BrokerFormat = {
  id: "rabobank",
  label: msg("Rabobank Beleggen transactions"),
  detect: (h) => hasColumns(h, "portefeuille", "type mutatie", "volume", "koers", "bedrag", "isin code"),
  convert(table) {
    const out = converted({ feeCurrency: "EUR", settleCash: true });
    const h = table[0]!;
    const c = {
      name: column(h, "naam"),
      date: column(h, "datum"),
      type: column(h, "type mutatie"),
      currency: column(h, "valuta mutatie"),
      volume: column(h, "volume"),
      price: column(h, "koers"),
      priceCurrency: column(h, "valuta koers"),
      costs: columnStarting(h, "valuta kosten", "kosten"),
      value: column(h, "waarde"),
      amount: column(h, "bedrag"),
      isin: column(h, "isin code"),
      time: column(h, "tijd"),
    };
    for (const r of table.slice(1).reverse()) {
      const date = dmy(cell(r, c.date));
      if (!date) continue;
      const type = norm(cell(r, c.type));
      const when = { date, time: cell(r, c.time).slice(0, 8) || undefined };
      const amount = num(cell(r, c.amount), ",");
      const security = { isin: cell(r, c.isin) || undefined, name: cell(r, c.name) || undefined };
      if (type.startsWith("koop") || type.startsWith("verkoop")) {
        out.rows.push({
          ...when,
          type: type.startsWith("koop") ? "buy" : "sell",
          ...security,
          quantity: abs(num(cell(r, c.volume), ","))!,
          price: num(cell(r, c.price), ",") ?? undefined,
          currency: cell(r, c.priceCurrency) || "EUR",
          fee: fixed(Number(abs(num(cell(r, c.costs), ",")) ?? 0), 2),
        });
      } else if (type.includes("dividend")) {
        // Waarde is gross, Bedrag what was paid out: the difference is dividend tax.
        const gross = Number(num(cell(r, c.value), ",") ?? 0);
        const net = Number(amount ?? 0);
        out.rows.push({
          ...when,
          type: "dividend",
          ...security,
          currency: cell(r, c.currency) || "EUR",
          amount: fixed(gross, 4),
          tax: fixed(gross - net, 4),
        });
      } else if (type.startsWith("storting") || type.includes("opname")) {
        if (!amount || !Number(amount)) continue;
        out.rows.push({
          ...when,
          type: isNegative(amount) ? "withdrawal" : "deposit",
          symbol: "EUR",
          assetType: "cash",
          quantity: abs(amount)!,
        });
      } else if (type.includes("rente") && amount && Number(amount)) {
        out.rows.push({
          ...when,
          type: isNegative(amount) ? "fee" : "reward",
          symbol: "EUR",
          assetType: "cash",
          quantity: abs(amount)!,
          notes: cell(r, c.type),
        });
      } else if ((type.includes("tarieven") || type.includes("kosten")) && amount && Number(amount)) {
        out.rows.push({
          ...when,
          type: "fee",
          symbol: "EUR",
          assetType: "cash",
          quantity: abs(amount)!,
          notes: cell(r, c.type),
        });
      } else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};
