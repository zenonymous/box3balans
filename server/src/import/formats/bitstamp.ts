import { msg, tr, trn } from "../../i18n/index.js";
import {
  type BrokerFormat,
  abs,
  coinAsset,
  column,
  converted,
  hasColumns,
  isFiatCode,
  looseNum,
  norm,
  skip,
  usDateTime,
  utc,
} from "./types.js";

/**
 * Bitstamp's transaction history (CSV). Version 2 has the currencies in their own columns; version 1
 * writes them with the amount ("0.5 BTC") and dates as "Mar. 15, 2024, 10:00 AM". Times are UTC.
 * Everything against euros (or dollars) is booked, cash included, so the cash balance adds up; a
 * trade between two coins has no value in money and is left out. Built on the layouts in BittyTax
 * and rotki, not yet on a real export.
 */
export const bitstamp: BrokerFormat = {
  id: "bitstamp",
  label: msg("Bitstamp transactions"),
  detect: (h) =>
    hasColumns(h, "type", "datetime", "account", "amount", "value", "rate", "fee") &&
    column(h, "subtype", "sub type") >= 0,
  convert(table) {
    const out = converted({ settleCash: true });
    const h = table[0]!;
    const c = {
      id: column(h, "id"),
      type: column(h, "type"),
      subtype: column(h, "subtype", "sub type"),
      at: column(h, "datetime"),
      amount: column(h, "amount"),
      amountCurrency: column(h, "amount currency"),
      value: column(h, "value"),
      valueCurrency: column(h, "value currency"),
      fee: column(h, "fee"),
      feeCurrency: column(h, "fee currency"),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    // "0.5 BTC" in version 1; the currency in a column of its own in version 2.
    const money = (r: string[], amount: number, currency: number) => {
      const raw = get(r, amount);
      const [n = "", code = ""] = currency >= 0 ? [raw, get(r, currency)] : raw.split(/\s+/);
      const value = abs(looseNum(n));
      const cur = code.toUpperCase();
      return value && cur ? { value, currency: cur === "ETH2R" ? "ETH" : cur } : null;
    };
    let swaps = 0;
    for (const r of table.slice(1).reverse()) {
      if (!r.some((x) => x.trim())) continue;
      const raw = get(r, c.at);
      const us = usDateTime(raw);
      const date = us ? `${us.date}T${us.time}Z` : utc(raw);
      if (!date) continue;
      const type = norm(get(r, c.type));
      const subtype = norm(get(r, c.subtype));
      const amount = money(r, c.amount, c.amountCurrency);
      const value = money(r, c.value, c.valueCurrency);
      const fee = money(r, c.fee, c.feeCurrency);
      const id = get(r, c.id) ? `bitstamp:${get(r, c.id)}` : undefined;
      if (!amount) {
        skip(out.skipped, tr("Lines without an amount"));
        continue;
      }
      const coinFee = () => {
        if (fee && Number(fee.value) && !isFiatCode(fee.currency))
          out.rows.push({ date, type: "fee", ...coinAsset(fee.currency), quantity: fee.value, id: id && `${id}:fee` });
      };
      if (type === "market" && (subtype === "buy" || subtype === "sell")) {
        if (!value || !isFiatCode(value.currency)) {
          swaps++;
          continue;
        }
        out.rows.push({
          date,
          type: subtype,
          ...coinAsset(amount.currency),
          quantity: amount.value,
          total: value.value,
          currency: value.currency,
          fee: fee && fee.currency === value.currency && Number(fee.value) ? fee.value : undefined,
          id,
        });
        coinFee();
      } else if (type === "deposit" || type === "ripple deposit") {
        out.rows.push({ date, type: "deposit", ...coinAsset(amount.currency), quantity: amount.value, id });
        coinFee();
      } else if (type === "withdrawal" || type === "ripple payment") {
        out.rows.push({ date, type: "withdrawal", ...coinAsset(amount.currency), quantity: amount.value, id });
        coinFee();
      } else if (/staking reward|reward|bonus/.test(type))
        out.rows.push({
          date,
          type: "reward",
          ...coinAsset(amount.currency),
          quantity: amount.value,
          notes: get(r, c.type),
          id,
        });
      else skip(out.skipped, tr("Other kinds: {kind}", { kind: get(r, c.type) || "—" }));
    }
    if (swaps)
      out.warnings.push(
        trn(
          swaps,
          "{n} trade between two coins was left out: it has no value in money. Correct that balance afterwards.",
          "{n} trades between two coins were left out: they have no value in money. Correct those balances afterwards.",
        ),
      );
    return out;
  },
};
