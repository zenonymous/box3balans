import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  cell,
  column,
  converted,
  dmy,
  fixed,
  hasColumns,
  isNegative,
  looseNum,
  norm,
  skip,
} from "./types.js";

// eToro writes some exchanges differently from Yahoo.
const ETORO_SUFFIX: Record<string, string> = { ".NV": ".AS", ".ZU": ".SW" };

/** "1 757,95", "4,581.91", "(0,10)": eToro's statement mixes notations; brackets are negative. */
function etoroNumber(raw: string): string | null {
  const s = raw.replace(/\s/g, "");
  if (!s || s === "-") return null;
  const negative = /^\(.*\)$/.test(s);
  const v = looseNum(s.replace(/[()]/g, ""));
  return v && negative ? `-${v.replace(/^-/, "")}` : v;
}

/**
 * eToro's account statement, the Account Activity sheet saved as CSV. Its amounts are in the
 * account's currency, US dollars; deposits, withdrawals, interest and CFDs (no ownership of the
 * underlying) are left out.
 */
export const etoro: BrokerFormat = {
  id: "etoro",
  label: msg("eToro account activity"),
  detect: (h) => hasColumns(h, "date", "type", "details", "amount", "units", "realized equity change", "position id"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      date: column(h, "date"),
      type: column(h, "type"),
      details: column(h, "details"),
      amount: column(h, "amount"),
      units: column(h, "units"),
      position: column(h, "position id"),
      assetType: column(h, "asset type"),
    };
    const rows = table.slice(1).filter((r) => r.some((x) => x.trim()));
    // UK stamp duty (SDRT) is its own line: added to the purchase with the same position.
    const stampDuty = new Map<string, number>();
    for (const r of rows)
      if (norm(cell(r, c.type)) === "sdrt") {
        const id = cell(r, c.position);
        stampDuty.set(id, (stampDuty.get(id) ?? 0) + Math.abs(Number(etoroNumber(cell(r, c.amount)) ?? 0)));
      }
    const used = new Set<string>();
    out.warnings.push(tr("eToro amounts are read as US dollars, the currency of an eToro account."));
    if (c.assetType < 0)
      out.warnings.push(
        tr("This statement has no Asset type column: crypto is read as shares. Check the assets before importing."),
      );
    for (const r of rows) {
      // "09/01/2024 15:37:16"
      const [day = "", time] = cell(r, c.date).split(/\s+/);
      const date = dmy(day);
      const type = norm(cell(r, c.type));
      if (!date || !type) continue;
      const assetType = norm(cell(r, c.assetType));
      const amount = etoroNumber(cell(r, c.amount));
      const position = cell(r, c.position);
      // "NKE/USD", "BARC.L/GBX", "BTC/USD": the ticker before the slash.
      let symbol = cell(r, c.details).split("/")[0]!.trim().toUpperCase();
      const suffix = /\.[A-Z]+$/.exec(symbol)?.[0];
      if (suffix && ETORO_SUFFIX[suffix]) symbol = symbol.slice(0, -suffix.length) + ETORO_SUFFIX[suffix];
      const asset: Pick<TemplateRow, "symbol" | "assetType"> = {
        symbol,
        assetType: assetType === "crypto" ? "crypto" : assetType === "etf" ? "etf" : "stock",
      };
      const notes = position && position !== "-" ? `eToro ${position}` : undefined;

      if (assetType === "cfd") skip(out.skipped, tr("CFDs (no ownership of the underlying)"));
      else if (type === "open position" || type === "position closed") {
        const units = abs(etoroNumber(cell(r, c.units)));
        if (!symbol || !units || !Number(units) || !amount) {
          skip(out.skipped, tr("Lines without an amount"));
          continue;
        }
        const buy = type === "open position";
        const duty = buy ? stampDuty.get(position) : undefined;
        if (duty) used.add(position);
        out.rows.push({
          date,
          time,
          type: buy ? "buy" : "sell",
          ...asset,
          quantity: units,
          total: abs(amount)!,
          currency: "USD",
          fee: duty ? fixed(duty, 2) : undefined,
          notes,
        });
      } else if (type === "dividend") {
        if (!symbol || !amount || isNegative(amount)) {
          skip(out.skipped, tr("Lines without an amount"));
          continue;
        }
        out.rows.push({ date, time, type: "dividend", ...asset, amount, currency: "USD", notes });
      } else if (type === "sdrt") {
        if (!used.has(position)) skip(out.skipped, tr("Stamp duty (SDRT) without its purchase"));
      } else if (/deposit|withdraw|interest|conversion fee/.test(type))
        skip(out.skipped, tr("Cash: deposits, withdrawals, interest and their fees"));
      else if (/overnight/.test(type)) skip(out.skipped, tr("CFDs (no ownership of the underlying)"));
      else skip(out.skipped, tr("Other kinds: {kind}", { kind: cell(r, c.type) }));
    }
    return out;
  },
};
