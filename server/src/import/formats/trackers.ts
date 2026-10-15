import { msg, tr, trn } from "../../i18n/index.js";
import {
  type BrokerFormat,
  type Converted,
  type TemplateRow,
  abs,
  column,
  columnStarting,
  converted,
  dmy,
  hasColumns,
  isFiatCode,
  looseNum,
  norm,
  skip,
} from "./types.js";

// Exports of other portfolio trackers, for moving a whole history over at once. They cover all of
// someone's exchanges, so the import puts everything in the account chosen and says which places
// the lines came from.

const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

const asCrypto = (symbol: string): Pick<TemplateRow, "symbol" | "assetType"> => ({
  symbol: symbol.toUpperCase(),
  assetType: "crypto",
});

/** "18.01.2025 15:18:55", "2025-01-01 10:12:27", "2023-06-02 16:06:47-04:00". */
function when(raw: string): Pick<TemplateRow, "date" | "time"> | null {
  const s = raw.trim();
  const zoned = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:?\d{2})$/.exec(s);
  if (zoned) return { date: `${zoned[1]}T${zoned[2]}${zoned[3]}` };
  const [day = "", time] = s.split(/\s+/);
  const date = dmy(day);
  return date ? { date, time } : null;
}

/** Notes shared by both: coin-for-coin trades without a value, and lines from several places. */
function finish(out: Converted, swaps: number, places: Set<string>) {
  if (swaps)
    out.warnings.push(
      trn(
        swaps,
        "{n} trade between two coins was left out: the export has no value in euros for it. Correct those balances afterwards, or import that exchange's own export.",
        "{n} trades between two coins were left out: the export has no value in euros for them. Correct those balances afterwards, or import that exchange's own export.",
      ),
    );
  if (places.size > 1)
    out.warnings.push(
      tr(
        "This file has lines from {n} places ({names}). They all go into the account you chose; to keep them apart, export one place at a time.",
        { n: places.size, names: [...places].sort().join(", ") },
      ),
    );
  return out;
}

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
      const at = when(cell(r, c.date));
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
          out.rows.push({ ...at, type: "fee", ...asCrypto(paid.currency), quantity: paid.quantity!, notes });
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
            ...asCrypto(got.currency),
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
            ...asCrypto(gave.currency),
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
              ...asCrypto(gave.currency),
              quantity: gave.quantity,
              total: (sold ?? bought)!,
              currency: valueCurrency,
              notes,
            },
            {
              ...at,
              type: "buy",
              ...asCrypto(got.currency),
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
          out.rows.push({ ...at, type, ...asCrypto(side.currency), quantity: side.quantity, notes });
          coinFee();
        }
      } else if (INCOME.test(type)) {
        if (!got.quantity || !got.currency) skip(out.skipped, tr("Lines without an amount"));
        else if (isFiatCode(got.currency)) skip(out.skipped, tr("Euro deposits and withdrawals"));
        else
          out.rows.push({
            ...at,
            type: "reward",
            ...asCrypto(got.currency),
            quantity: got.quantity,
            notes: cell(r, c.type),
          });
      } else if (EXPENSE.test(type)) {
        // Coins gone without anything back: spent, given away, lost, or a fee on its own.
        if (gave.quantity && gave.currency && !isFiatCode(gave.currency))
          out.rows.push({
            ...at,
            type: "fee",
            ...asCrypto(gave.currency),
            quantity: gave.quantity,
            notes: cell(r, c.type),
          });
        else skip(out.skipped, tr("Euro deposits and withdrawals"));
      } else skip(out.skipped, tr("Other kinds: {kind}", { kind: cell(r, c.type) || "—" }));
    }
    return finish(out, swaps, places);
  },
};

/** "SOL (Solana)" → the symbol and the name. */
function named(raw: string): { symbol: string; name?: string } {
  const m = /^(.+?)\s*\((.+)\)$/.exec(raw.trim());
  return m ? { symbol: m[1]!.toUpperCase(), name: m[2] } : { symbol: raw.trim().toUpperCase() };
}

const DELTA_KIND: Record<string, TemplateRow["assetType"]> = { crypto: "crypto", stock: "stock", etf: "etf" };

/**
 * Delta's export (Settings → Export, CSV): one line per BUY, SELL, DEPOSIT, WITHDRAW or DIVIDEND, with
 * the base asset, the quote paid or received, and the fee. Money moves are left out; a deposit "from"
 * dividends, staking or mining is a reward.
 */
export const delta: BrokerFormat = {
  id: "delta",
  label: msg("Delta export"),
  detect: (h) => hasColumns(h, "date", "way", "base amount", "base currency (name)", "quote amount", "quote currency"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      date: column(h, "date"),
      way: column(h, "way"),
      amount: column(h, "base amount"),
      base: column(h, "base currency (name)"),
      kind: column(h, "base type"),
      quote: column(h, "quote amount"),
      quoteCurrency: column(h, "quote currency"),
      exchange: column(h, "exchange"),
      from: column(h, "sent received from"),
      fee: column(h, "fee amount"),
      feeCurrency: column(h, "fee currency (name)"),
      broker: column(h, "broker"),
      notes: column(h, "notes"),
    };
    let swaps = 0;
    const places = new Set<string>();
    for (const r of table.slice(1)) {
      if (!r.some((x) => x.trim())) continue;
      const at = when(cell(r, c.date));
      if (!at) continue;
      const way = norm(cell(r, c.way));
      const place = cell(r, c.broker) || cell(r, c.exchange);
      if (place) places.add(place);
      const base = named(cell(r, c.base));
      const kind = norm(cell(r, c.kind));
      const asset: Pick<TemplateRow, "symbol" | "name" | "assetType"> = {
        symbol: base.symbol,
        name: base.name,
        assetType: DELTA_KIND[kind] ?? "stock",
      };
      const quantity = abs(looseNum(cell(r, c.amount)));
      const quote = abs(looseNum(cell(r, c.quote)));
      const quoteCurrency = named(cell(r, c.quoteCurrency)).symbol;
      const fee = abs(looseNum(cell(r, c.fee)));
      const feeCurrency = named(cell(r, c.feeCurrency)).symbol;
      const hasFee = !!fee && Number(fee) > 0 && !!feeCurrency;
      const notes = cell(r, c.notes) || place || undefined;
      const coinFee = () => {
        if (hasFee && !isFiatCode(feeCurrency))
          out.rows.push({ ...at, type: "fee", ...asCrypto(feeCurrency), quantity: fee, notes });
      };

      if (kind === "fiat" && way !== "dividend") skip(out.skipped, tr("Euro deposits and withdrawals"));
      else if (way === "buy" || way === "sell") {
        if (!quantity || !quote || !quoteCurrency) {
          skip(out.skipped, tr("Lines without an amount"));
          continue;
        }
        if (!isFiatCode(quoteCurrency)) {
          swaps++;
          continue;
        }
        out.rows.push({
          ...at,
          type: way,
          ...asset,
          quantity,
          total: quote,
          currency: quoteCurrency,
          fee: hasFee && feeCurrency === quoteCurrency ? fee : undefined,
          notes,
        });
        coinFee();
      } else if (way === "deposit" || way === "withdraw") {
        if (!quantity) {
          skip(out.skipped, tr("Lines without an amount"));
          continue;
        }
        const reward =
          way === "deposit" && /dividend|staking|mining|airdrop|reward|interest|income/i.test(cell(r, c.from));
        out.rows.push({
          ...at,
          type: reward ? "reward" : way === "deposit" ? "deposit" : "withdrawal",
          ...asset,
          quantity,
          ...(quote && isFiatCode(quoteCurrency) ? { total: quote, currency: quoteCurrency } : {}),
          notes,
        });
        coinFee();
      } else if (way === "dividend") {
        if (!quote || !quoteCurrency) skip(out.skipped, tr("Lines without an amount"));
        else out.rows.push({ ...at, type: "dividend", ...asset, amount: quote, currency: quoteCurrency, notes });
      } else skip(out.skipped, tr("Other kinds: {kind}", { kind: cell(r, c.way) || "—" }));
    }
    return finish(out, swaps, places);
  },
};
