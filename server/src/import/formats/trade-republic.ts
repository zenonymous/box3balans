import { msg, tr } from "../../i18n/index.js";
import { type BrokerFormat, abs, cell, converted, fixed, looseNum, norm, skip } from "./types.js";

/**
 * Trade Republic's transaction export with eight columns (date; type; net value; note; ISIN;
 * shares; costs; tax), as made by the app or pytr. All in euros, with deposits and withdrawals.
 */
export const tradeRepublic: BrokerFormat = {
  id: "trade-republic",
  label: msg("Trade Republic transactions"),
  detect: (h) =>
    h.length >= 8 &&
    ["datum", "date"].includes(norm(h[0] ?? "")) &&
    ["transactietype", "type", "typ"].includes(norm(h[1] ?? "")) &&
    norm(h[4] ?? "") === "isin" &&
    ["aantal", "shares", "anteile"].includes(norm(h[5] ?? "")),
  convert(table) {
    const out = converted({ settleCash: true });
    for (const r of table.slice(1).reverse()) {
      const raw = cell(r, 0);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : raw.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const time = raw.length > 10 ? raw.slice(11, 19) : undefined;
      const type = norm(cell(r, 1));
      const value = looseNum(cell(r, 2));
      const shares = abs(looseNum(cell(r, 5)));
      const costs = Number(abs(looseNum(cell(r, 6))) ?? 0);
      const tax = Number(abs(looseNum(cell(r, 7))) ?? 0);
      const note = cell(r, 3);
      const isin = cell(r, 4) || undefined;
      const when = { date, time };
      const v = Math.abs(Number(value ?? 0));
      if (/aankoop|buy|kauf|spaarplan|savings plan|sparplan/.test(type) && shares && Number(shares)) {
        out.rows.push({
          ...when,
          type: "buy",
          isin,
          name: note || undefined,
          quantity: shares,
          total: fixed(v - costs),
          currency: "EUR",
          fee: fixed(costs, 2),
        });
      } else if (/verkoop|sell|verkauf/.test(type) && shares && Number(shares)) {
        out.rows.push({
          ...when,
          type: "sell",
          isin,
          name: note || undefined,
          quantity: shares,
          total: fixed(v + costs + tax),
          currency: "EUR",
          fee: fixed(costs, 2),
        });
      } else if (/dividend|uitkering|distribution|ausschuttung/.test(type) && isin) {
        out.rows.push({
          ...when,
          type: "dividend",
          isin,
          name: note || undefined,
          currency: "EUR",
          amount: fixed(v + tax, 4),
          tax: fixed(tax, 4),
        });
      } else if (/storting|deposit|einzahlung/.test(type) && v) {
        out.rows.push({ ...when, type: "deposit", symbol: "EUR", assetType: "cash", quantity: fixed(v)! });
      } else if (/onttrekking|removal|withdrawal|auszahlung|opname/.test(type) && v) {
        out.rows.push({ ...when, type: "withdrawal", symbol: "EUR", assetType: "cash", quantity: fixed(v)! });
      } else if (/rente|interest|zinsen/.test(type) && v) {
        out.rows.push({
          ...when,
          type: "reward",
          symbol: "EUR",
          assetType: "cash",
          quantity: fixed(v)!,
          notes: cell(r, 1),
        });
      } else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};
