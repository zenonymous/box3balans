import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  abs,
  cell,
  coinAsset,
  column,
  converted,
  hasColumns,
  looseNum,
  norm,
  skip,
  usDateTime,
  utc,
} from "./types.js";

/** Revolut stocks (Documents → Brokerage account statement → Excel/CSV). Cash is left out. */
export const revolut: BrokerFormat = {
  id: "revolut",
  label: msg("Revolut stocks statement"),
  detect: (h) => hasColumns(h, "date", "ticker", "type", "quantity", "price per share", "total amount", "currency"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      date: column(h, "date"),
      ticker: column(h, "ticker"),
      type: column(h, "type"),
      quantity: column(h, "quantity"),
      price: column(h, "price per share"),
      total: column(h, "total amount"),
      currency: column(h, "currency"),
    };
    for (const r of table.slice(1)) {
      const raw = cell(r, c.date);
      const date = /Z$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : utc(raw);
      if (!date) continue;
      const type = norm(cell(r, c.type));
      const symbol = cell(r, c.ticker) || undefined;
      const currency = cell(r, c.currency).toUpperCase() || "USD";
      const quantity = abs(looseNum(cell(r, c.quantity)));
      const price = abs(looseNum(cell(r, c.price)));
      const total = Number(abs(looseNum(cell(r, c.total))) ?? 0);
      if (/^(buy|sell)/.test(type) && symbol && quantity && price) {
        const gross = Number(quantity) * Number(price);
        const fee = type.startsWith("buy") ? total - gross : gross - total;
        out.rows.push({
          date,
          type: type.startsWith("buy") ? "buy" : "sell",
          symbol,
          quantity,
          price,
          currency,
          fee: fee > 0.005 ? fee.toFixed(2) : undefined,
        });
      } else if (type.startsWith("dividend") && symbol && total) {
        out.rows.push({ date, type: "dividend", symbol, currency, amount: total.toFixed(4) });
      } else if (/cash|fee|transfer/.test(type)) skip(out.skipped, tr("Cash movements and account costs"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};

const MONEY_SIGNS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };

/** "€35,761.54", "89,162.28 SEK", "-$10.00": the amount and its currency. */
function money(raw: string): { value: string; currency: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const code = /\b([A-Z]{3})\b/.exec(s)?.[1] ?? MONEY_SIGNS[/[€$£]/.exec(s)?.[0] ?? ""];
  const value = looseNum(s.replace(/[^\d.,]/g, ""));
  if (!value || !code) return null;
  return { value: /^[-−(]/.test(s) || /^[€$£][-−]/.test(s) ? `-${value}` : value, currency: code };
}

/**
 * Revolut's crypto statement (Crypto → … → Statement, CSV). Prices and values carry their currency
 * ("€35,761.54", "89,162.28 SEK"); the fee comes on top of the value. Times are local.
 */
export const revolutCrypto: BrokerFormat = {
  id: "revolut-crypto",
  label: msg("Revolut crypto statement"),
  detect: (h) => h.length <= 8 && hasColumns(h, "symbol", "type", "quantity", "price", "value", "fees", "date"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      symbol: column(h, "symbol"),
      type: column(h, "type"),
      quantity: column(h, "quantity"),
      price: column(h, "price"),
      value: column(h, "value"),
      fees: column(h, "fees"),
      date: column(h, "date"),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    for (const r of table.slice(1)) {
      if (!r.some((x) => x.trim())) continue;
      const when = usDateTime(get(r, c.date));
      const symbol = get(r, c.symbol).toUpperCase();
      const quantity = abs(looseNum(get(r, c.quantity)));
      if (!when || !symbol || !quantity || !Number(quantity)) {
        skip(out.skipped, tr("Lines without an amount"));
        continue;
      }
      const type = norm(get(r, c.type));
      const price = money(get(r, c.price));
      const value = money(get(r, c.value));
      const fee = money(get(r, c.fees));
      const priced = price ? { price: abs(price.value)!, currency: price.currency } : {};
      if (type === "buy" || type === "sell") {
        if (!price && !value) {
          skip(out.skipped, tr("Lines without an amount"));
          continue;
        }
        out.rows.push({
          ...when,
          type,
          ...coinAsset(symbol),
          quantity,
          ...(price ? priced : { total: abs(value!.value)!, currency: value!.currency }),
          fee: fee && Number(fee.value) ? abs(fee.value)! : undefined,
        });
      } else if (type === "send") out.rows.push({ ...when, type: "withdrawal", ...coinAsset(symbol), quantity });
      // What it was worth when it came in: the cost basis of a coin from elsewhere.
      else if (type === "receive")
        out.rows.push({ ...when, type: "deposit", ...coinAsset(symbol), quantity, ...priced });
      else if (type === "stake" || type === "unstake")
        skip(out.skipped, tr("Staking and unstaking (the coins stay yours)"));
      else if (/reward|cashback|airdrop|bonus/.test(type))
        out.rows.push({ ...when, type: "reward", ...coinAsset(symbol), quantity, ...priced, notes: get(r, c.type) });
      else skip(out.skipped, tr("Other kinds: {kind}", { kind: get(r, c.type) || "—" }));
    }
    return out;
  },
};
