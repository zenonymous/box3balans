import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  abs,
  cell,
  column,
  converted,
  dmy,
  hasColumns,
  isNegative,
  looseNum,
  norm,
  skip,
} from "./types.js";

// XTB writes exchanges as country codes; Yahoo has its own suffixes (none for US listings).
const XTB_SUFFIX: Record<string, string> = {
  ".US": "",
  ".UK": ".L",
  ".DE": ".DE",
  ".PL": ".WA",
  ".FR": ".PA",
  ".NL": ".AS",
  ".BE": ".BR",
  ".ES": ".MC",
  ".IT": ".MI",
  ".PT": ".LS",
  ".DK": ".CO",
  ".SE": ".ST",
  ".FI": ".HE",
  ".NO": ".OL",
  ".CH": ".SW",
};

/**
 * XTB's cash operations (Account history → Cash operations → Export, CSV). The type is in the export's
 * language, so trades are read from the comment ("OPEN BUY 34/42.5658 @ 11.7480": 34 of an order of
 * 42.5658; "CLOSE BUY 1 @ 26.28": a sale). Amounts are in the account's currency, euros for a Dutch
 * account; withholding tax joins its dividend. Cash and CFDs are left out.
 */
export const xtb: BrokerFormat = {
  id: "xtb",
  label: msg("XTB cash operations"),
  detect: (h) => h.length <= 7 && hasColumns(h, "id", "type", "time", "symbol", "comment", "amount"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      id: column(h, "id"),
      type: column(h, "type"),
      time: column(h, "time"),
      symbol: column(h, "symbol"),
      comment: column(h, "comment"),
      amount: column(h, "amount"),
    };
    out.warnings.push(tr("XTB amounts are read as euros, the currency of a Dutch XTB account."));
    const rows = table.slice(1).filter((r) => r.some((x) => x.trim()));
    const yahoo = (raw: string) => {
      const sym = raw.trim().toUpperCase();
      const suffix = /\.[A-Z]+$/.exec(sym)?.[0];
      return suffix && suffix in XTB_SUFFIX ? sym.slice(0, -suffix.length) + XTB_SUFFIX[suffix] : sym;
    };
    // Withholding tax is its own line, right after its dividend (the next ID, same symbol and time).
    const taxes = new Map<string, string>();
    for (const r of rows)
      if (/withholding|wht/i.test(`${cell(r, c.type)} ${cell(r, c.comment)}`))
        taxes.set(
          `${cell(r, c.symbol)}|${cell(r, c.time)}|${Number(cell(r, c.id)) - 1}`,
          abs(looseNum(cell(r, c.amount)))!,
        );
    for (const r of rows) {
      const [day = "", time] = cell(r, c.time).split(/\s+/);
      const date = dmy(day);
      if (!date) {
        skip(out.skipped, tr("Lines without an amount"));
        continue;
      }
      const type = norm(cell(r, c.type));
      const comment = cell(r, c.comment);
      const amount = looseNum(cell(r, c.amount));
      const symbol = yahoo(cell(r, c.symbol));
      const id = cell(r, c.id) ? `xtb:${cell(r, c.id)}` : undefined;
      const trade = /^(OPEN|CLOSE) BUY ([\d.]+)(?:\/[\d.]+)? @ ([\d.]+)/i.exec(comment);
      if (trade && symbol && amount && Number(amount)) {
        out.rows.push({
          date,
          time,
          type: trade[1]!.toUpperCase() === "OPEN" ? "buy" : "sell",
          symbol,
          quantity: trade[2]!,
          total: abs(amount)!,
          currency: "EUR",
          notes: comment,
          id,
        });
      } else if (/dividend|dywidend|dividendo/.test(type) && symbol && amount) {
        if (isNegative(amount)) {
          skip(out.skipped, tr("CFDs (no ownership of the underlying)"));
          continue;
        }
        const tax = taxes.get(`${cell(r, c.symbol)}|${cell(r, c.time)}|${cell(r, c.id)}`);
        out.rows.push({ date, time, type: "dividend", symbol, amount, currency: "EUR", tax, notes: comment, id });
      } else if (/withholding|wht/i.test(`${type} ${comment}`)) {
        // Joined to its dividend above; one without a dividend is named.
        const previous = String(Number(cell(r, c.id)) - 1);
        if (!rows.some((d) => cell(d, c.id) === previous && /dividend|dywidend|dividendo/.test(norm(cell(d, c.type)))))
          skip(out.skipped, tr("Withholding tax without its dividend"));
      } else if (/deposit|withdrawal|transfer|interest|wplata|wyplata/.test(type))
        skip(out.skipped, tr("Cash: deposits, withdrawals, interest and their fees"));
      else if (/profit loss|swap|cfd/.test(type)) skip(out.skipped, tr("CFDs (no ownership of the underlying)"));
      else skip(out.skipped, tr("Other kinds: {kind}", { kind: cell(r, c.type) || "—" }));
    }
    return out;
  },
};
