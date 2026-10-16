import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  cell,
  coinAsset,
  column,
  converted,
  dateAndTime,
  hasColumns,
  isFiatCode,
  looseNum,
  norm,
  skip,
  trackerNotes,
} from "./types.js";

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
      const at = dateAndTime(cell(r, c.date));
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
          out.rows.push({ ...at, type: "fee", ...coinAsset(feeCurrency), quantity: fee, notes });
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
    return trackerNotes(out, swaps, places);
  },
};
