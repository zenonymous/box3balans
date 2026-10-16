import { msg, tr } from "../../i18n/index.js";
import { type BrokerFormat, abs, cell, column, converted, hasColumns, norm, num, skip } from "./types.js";

/** "01/05/2026" (month first, as Schwab writes it) → "2026-01-05". */
function mdy(raw: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
}

/** A US number: a comma is always a thousands separator ("1,000" shares is a thousand, not one). */
const usNum = (raw: string) => num(raw.replace(/,/g, ""), ".");

/** "$4,255.31", "-$0.49" → "4255.31", "-0.49". */
function dollars(raw: string): string | null {
  const s = raw.replace(/[$\s]/g, "");
  const v = usNum(s.replace(/^-/, ""));
  return v && s.startsWith("-") ? `-${v}` : v;
}

/**
 * Schwab Equity Awards: the award account's complete transaction history as CSV (RSUs and ESPP). Each
 * transaction has detail rows under it with empty first columns: a vest's date and fair market value,
 * an ESPP purchase's prices, a sale's lots. A vest (Deposit, RS) is a purchase at its fair market value
 * and an ESPP purchase one at the market value on the purchase day: what was taxed as wages (box 1)
 * is the cost for box 3. Amounts are in dollars. Cash moves (Journal, Wire Transfer) are left out.
 * Built on the layout cgt-calc documents and tests (MIT), not yet on a real export.
 */
export const schwabEquityAwards: BrokerFormat = {
  id: "schwab-equity-awards",
  label: msg("Schwab Equity Awards transactions"),
  detect: (h) =>
    hasColumns(h, "date", "action", "symbol", "quantity", "feesandcommissions", "amount", "vestfairmarketvalue"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      date: column(h, "date"),
      action: column(h, "action"),
      symbol: column(h, "symbol"),
      description: column(h, "description"),
      quantity: column(h, "quantity"),
      fees: column(h, "feesandcommissions"),
      amount: column(h, "amount"),
      salePrice: column(h, "saleprice"),
      purchasePrice: column(h, "purchaseprice"),
      purchaseValue: column(h, "purchasefairmarketvalue"),
      vestValue: column(h, "vestfairmarketvalue"),
    };
    // Each transaction with the detail rows below it.
    const txs: { top: string[]; details: string[][] }[] = [];
    for (const r of table.slice(1)) {
      if (!r.some((x) => x.trim())) continue;
      if (cell(r, c.date) || cell(r, c.action)) txs.push({ top: r, details: [] });
      else txs.at(-1)?.details.push(r);
    }
    const detail = (tx: { details: string[][] }, i: number) => tx.details.map((d) => cell(d, i)).find(Boolean) ?? "";
    // Tax withheld on a dividend is its own transaction on the same day.
    const taxes = new Map<string, number>();
    for (const tx of txs)
      if (norm(cell(tx.top, c.action)) === "tax withholding") {
        const key = `${cell(tx.top, c.date)}|${cell(tx.top, c.symbol)}`;
        taxes.set(key, (taxes.get(key) ?? 0) + Math.abs(Number(dollars(cell(tx.top, c.amount)) ?? 0)));
      }
    const dividends = new Set(
      txs
        .filter((tx) => norm(cell(tx.top, c.action)) === "dividend")
        .map((tx) => `${cell(tx.top, c.date)}|${cell(tx.top, c.symbol)}`),
    );
    for (const tx of txs) {
      const date = mdy(cell(tx.top, c.date));
      const action = norm(cell(tx.top, c.action));
      const symbol = cell(tx.top, c.symbol).toUpperCase();
      const quantity = abs(usNum(cell(tx.top, c.quantity)));
      const description = cell(tx.top, c.description);
      const key = `${cell(tx.top, c.date)}|${cell(tx.top, c.symbol)}`;
      if (!date) continue;
      if (action === "deposit") {
        const espp = /espp/i.test(description);
        const price = abs(dollars(detail(tx, espp ? c.purchaseValue : c.vestValue)));
        if (!symbol || !quantity || !price) {
          skip(out.skipped, tr("Lines without an amount"));
          continue;
        }
        const paid = espp ? abs(dollars(detail(tx, c.purchasePrice))) : null;
        out.rows.push({
          date,
          type: "buy",
          symbol,
          quantity,
          price,
          currency: "USD",
          notes: espp ? `ESPP${paid ? `, paid $${paid}` : ""}` : `${description || "RS"} vest`,
        });
      } else if (action === "sale" || action === "forced quick sell") {
        const price = abs(dollars(detail(tx, c.salePrice)));
        const fee = abs(dollars(cell(tx.top, c.fees)));
        const net = abs(dollars(cell(tx.top, c.amount)));
        if (!symbol || !quantity || (!price && !net)) {
          skip(out.skipped, tr("Lines without an amount"));
          continue;
        }
        out.rows.push({
          date,
          type: "sell",
          symbol,
          quantity,
          ...(price ? { price } : { total: (Number(net) + Number(fee ?? 0)).toFixed(2) }),
          fee: fee && Number(fee) ? fee : undefined,
          currency: "USD",
        });
      } else if (action === "dividend") {
        const amount = abs(dollars(cell(tx.top, c.amount)));
        if (!symbol || !amount) {
          skip(out.skipped, tr("Lines without an amount"));
          continue;
        }
        const tax = taxes.get(key);
        out.rows.push({
          date,
          type: "dividend",
          symbol,
          amount,
          currency: "USD",
          tax: tax ? tax.toFixed(2) : undefined,
        });
      } else if (action === "tax withholding") {
        if (!dividends.has(key)) skip(out.skipped, tr("Withholding tax without its dividend"));
      } else if (action === "lapse") skip(out.skipped, tr("Vests as lapses: the shares come in as a deposit"));
      else if (/journal|wire|transfer|cash/.test(action))
        skip(out.skipped, tr("Cash: deposits, withdrawals, interest and their fees"));
      else skip(out.skipped, tr("Other kinds: {kind}", { kind: cell(tx.top, c.action) }));
    }
    // Exports come newest first or oldest first.
    out.rows.sort((x, y) => x.date.localeCompare(y.date));
    return out;
  },
};
