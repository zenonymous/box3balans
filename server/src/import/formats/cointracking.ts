import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  abs,
  cell,
  coinAsset,
  column,
  columnStarting,
  converted,
  dateAndTime,
  hasColumns,
  isFiatCode,
  looseNum,
  norm,
  skip,
  trackerNotes,
} from "./types.js";

const INCOME = /income|mining|staking|airdrop|reward|bonus|gift tip|minting|masternode|interest/;

const EXPENSE = /^(spend|donation|gift|stolen|lost|other expense|.*fee)$/;

/**
 * CoinTracking's trade table (Trade List → Export → CSV): Type, Buy, Cur., Sell, Cur., Fee, Cur.,
 * Exchange, Group, Comment, Date. Without value columns, a trade between two coins has no value in
 * euros and is left out; with them ("Buy Value in EUR") it's a sale and a purchase.
 */
export const coinTracking: BrokerFormat = {
  id: "cointracking",
  label: msg("CoinTracking trade table"),
  detect: (h) =>
    hasColumns(h, "type", "exchange", "group", "comment", "date") &&
    column(h, "buy", "buy amount") >= 0 &&
    column(h, "sell", "sell amount") >= 0,
  convert(table) {
    const out = converted();
    const h = table[0]!;
    // The currency is the column after each amount ("Cur.", three times), or named in newer exports.
    const pair = (amount: string[], currency: string) => {
      const a = column(h, ...amount);
      let c = column(h, currency);
      if (c < 0 && a >= 0 && norm(h[a + 1] ?? "").startsWith("cur")) c = a + 1;
      return { a, c };
    };
    const buy = pair(["buy", "buy amount"], "buy currency");
    const sell = pair(["sell", "sell amount"], "sell currency");
    const fee = pair(["fee", "fee amount"], "fee currency");
    const c = { type: column(h, "type"), exchange: column(h, "exchange"), date: column(h, "date") };
    const buyValue = columnStarting(h, "buy value");
    const sellValue = columnStarting(h, "sell value");
    const valueCurrency = /\b([A-Z]{3})\b/.exec(h[buyValue >= 0 ? buyValue : sellValue] ?? "")?.[1] ?? "EUR";
    let swaps = 0;
    const places = new Set<string>();
    for (const r of table.slice(1)) {
      if (!r.some((x) => x.trim())) continue;
      const at = dateAndTime(cell(r, c.date));
      if (!at) continue;
      const type = norm(cell(r, c.type));
      const place = cell(r, c.exchange);
      if (place) places.add(place);
      const got = { quantity: abs(looseNum(cell(r, buy.a))), currency: cell(r, buy.c).toUpperCase() };
      const gave = { quantity: abs(looseNum(cell(r, sell.a))), currency: cell(r, sell.c).toUpperCase() };
      const paid = { quantity: abs(looseNum(cell(r, fee.a))), currency: cell(r, fee.c).toUpperCase() };
      const notes = place || undefined;
      const hasFee = !!paid.quantity && Number(paid.quantity) > 0 && !!paid.currency;
      // A fee in a coin is its own line; one in money joins the trade it's in the currency of.
      const coinFee = () => {
        if (hasFee && !isFiatCode(paid.currency))
          out.rows.push({ ...at, type: "fee", ...coinAsset(paid.currency), quantity: paid.quantity!, notes });
      };
      const moneyFee = (currency: string) => (hasFee && paid.currency === currency ? paid.quantity! : undefined);

      if (type === "trade") {
        if (!got.quantity || !gave.quantity || !got.currency || !gave.currency) {
          skip(out.skipped, tr("Lines without an amount"));
          continue;
        }
        const gotMoney = isFiatCode(got.currency);
        const gaveMoney = isFiatCode(gave.currency);
        if (gotMoney && gaveMoney) skip(out.skipped, tr("Currency exchanges"));
        else if (gaveMoney) {
          out.rows.push({
            ...at,
            type: "buy",
            ...coinAsset(got.currency),
            quantity: got.quantity,
            total: gave.quantity,
            currency: gave.currency,
            fee: moneyFee(gave.currency),
            notes,
          });
          coinFee();
        } else if (gotMoney) {
          out.rows.push({
            ...at,
            type: "sell",
            ...coinAsset(gave.currency),
            quantity: gave.quantity,
            total: got.quantity,
            currency: got.currency,
            fee: moneyFee(got.currency),
            notes,
          });
          coinFee();
        } else {
          const sold = abs(looseNum(cell(r, sellValue)));
          const bought = abs(looseNum(cell(r, buyValue)));
          if (!sold && !bought) {
            swaps++;
            continue;
          }
          out.rows.push(
            {
              ...at,
              type: "sell",
              ...coinAsset(gave.currency),
              quantity: gave.quantity,
              total: (sold ?? bought)!,
              currency: valueCurrency,
              notes,
            },
            {
              ...at,
              type: "buy",
              ...coinAsset(got.currency),
              quantity: got.quantity,
              total: (bought ?? sold)!,
              currency: valueCurrency,
              notes,
            },
          );
          coinFee();
        }
      } else if (type === "deposit" || type === "withdrawal") {
        const side = type === "deposit" ? got : gave;
        if (!side.quantity || !side.currency) skip(out.skipped, tr("Lines without an amount"));
        else if (isFiatCode(side.currency)) skip(out.skipped, tr("Euro deposits and withdrawals"));
        else {
          out.rows.push({ ...at, type, ...coinAsset(side.currency), quantity: side.quantity, notes });
          coinFee();
        }
      } else if (INCOME.test(type)) {
        if (!got.quantity || !got.currency) skip(out.skipped, tr("Lines without an amount"));
        else if (isFiatCode(got.currency)) skip(out.skipped, tr("Euro deposits and withdrawals"));
        else
          out.rows.push({
            ...at,
            type: "reward",
            ...coinAsset(got.currency),
            quantity: got.quantity,
            notes: cell(r, c.type),
          });
      } else if (EXPENSE.test(type)) {
        // Coins gone without anything back: spent, given away, lost, or a fee on its own.
        if (gave.quantity && gave.currency && !isFiatCode(gave.currency))
          out.rows.push({
            ...at,
            type: "fee",
            ...coinAsset(gave.currency),
            quantity: gave.quantity,
            notes: cell(r, c.type),
          });
        else skip(out.skipped, tr("Euro deposits and withdrawals"));
      } else skip(out.skipped, tr("Other kinds: {kind}", { kind: cell(r, c.type) || "—" }));
    }
    return trackerNotes(out, swaps, places);
  },
};
