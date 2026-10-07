import { msg, tr } from "../../i18n/index.js";
import { detectDecimal, type DecimalMark } from "../parse.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  column,
  columnStarting,
  converted,
  dmy,
  isNegative,
  norm,
  num,
  pounds,
  skip,
} from "./types.js";

// "Koop 10 @ 71,2 EUR", "Sell 3 @ 139.74 USD", "Kauf 5 zu je 12,3 EUR".
const TRADE_RE =
  /^(koop|verkoop|buy|sell|kauf|verkauf|achat|vente|compra|venta|acquisto|vendita)\s+([\d.,]+)\s*(?:@|zu je|à|a)\s*([\d.,]+)\s*([A-Za-z]{3})\b/i;
const SELL_WORDS = new Set(["verkoop", "sell", "verkauf", "vente", "venta", "vendita"]);
const FEE_RE = /kosten|costs|fee|gebuhr|gebühr|frais|commission|comision|en\/of|and\/or|und\/oder/i;
const TAX_RE =
  /dividendbelasting|dividend tax|dividendensteuer|quellensteuer|withholding|retenue|ritenuta|retencion|retención/i;
const DIVIDEND_RE = /^(dividend|dividende|dividendo|kapitaalsuitkering|capital return)\b/i;
const CASH_RE =
  /ideal|flatex|sweep|overboeking|storting|deposit|withdrawal|terugstorting|valuta|currency|reservation|reservering|einzahlung|auszahlung|geldmarkt|money market|fonds monetaires/i;
const INTEREST_RE = /rente|interest|zinsen|courtesy/i;
const PLATFORM_RE = /aansluitingskosten|connection fee|verbindungskosten|frais de connexion|servicekosten/i;

/** "1.234,5" in a file with decimal commas, "1,234.5" with decimal points. */
const inFile = (raw: string, decimal: DecimalMark) => num(raw, decimal);

/**
 * DEGIRO's account statement (Inbox → Account overview, "Account.csv"): every cash movement, from
 * which trades (with their costs) and dividends (with dividend tax) are read. Deposits, currency
 * exchanges and the cash sweep are left out: Box3balans follows the securities, not DEGIRO's cash.
 */
export const degiroAccount: BrokerFormat = {
  id: "degiro-account",
  label: msg("DEGIRO account statement"),
  detect(h) {
    return (
      h.length >= 11 &&
      ["datum", "date"].includes(norm(h[0] ?? "")) &&
      norm(h[4] ?? "") === "isin" &&
      ["omschrijving", "description", "beschreibung"].includes(norm(h[5] ?? "")) &&
      ["mutatie", "change", "anderung"].includes(norm(h[7] ?? ""))
    );
  },
  convert(table) {
    const out = converted({ feeCurrency: "EUR" });
    // Long descriptions and order ids continue on a line without a date: glue them back on.
    const rows: string[][] = [];
    for (const r of table.slice(1)) {
      const prev = rows.at(-1);
      if (prev && !r[0]?.trim() && !r[1]?.trim()) {
        r.forEach((c, i) => {
          if (c.trim()) prev[i] = (prev[i] ?? "") + c.trim();
        });
      } else if (r.some((c) => c.trim())) rows.push([...r]);
    }
    const decimal = detectDecimal(rows.map((r) => r[8] ?? ""));
    // The statement is newest first; work oldest first so fills keep their order.
    rows.reverse();

    interface Trade {
      row: TemplateRow;
      order: string;
    }
    const trades: Trade[] = [];
    const fees = new Map<string, number>();
    const dividends = new Map<string, { row: TemplateRow; gross: number; tax: number }>();
    const taxes: { key: string; isin: string; date: string; currency: string; tax: number }[] = [];

    for (const r of rows) {
      const [dateRaw, time, , product, isin, desc = "", , currency = "", amountRaw = "", , , order = ""] = r.map((c) =>
        c.trim(),
      );
      const date = dmy(dateRaw ?? "");
      if (!date) {
        skip(out.skipped, tr("Lines without a date"));
        continue;
      }
      const amount = inFile(amountRaw, decimal);
      const trade = TRADE_RE.exec(desc);
      if (trade) {
        const side = SELL_WORDS.has(trade[1]!.toLowerCase()) ? "sell" : "buy";
        const quantity = inFile(trade[2]!, decimal);
        const p = pounds(inFile(trade[3]!, decimal), trade[4]!.toUpperCase());
        trades.push({
          order,
          row: {
            date,
            time,
            type: side,
            isin: isin || undefined,
            name: product || undefined,
            quantity: quantity ?? undefined,
            price: p.price ?? undefined,
            currency: p.currency,
            id: order ? `degiro:${order}` : undefined,
          },
        });
        continue;
      }
      if (order && FEE_RE.test(desc) && isNegative(amount)) {
        if (currency !== "EUR") out.warnings.push(tr("A DEGIRO cost in {currency} was counted as EUR.", { currency }));
        fees.set(order, (fees.get(order) ?? 0) + Number(abs(amount)));
        continue;
      }
      if (isin && TAX_RE.test(desc) && amount) {
        taxes.push({ key: `${isin}|${date}|${currency}`, isin, date, currency, tax: -Number(amount) });
        continue;
      }
      if (isin && DIVIDEND_RE.test(desc) && amount) {
        const key = `${isin}|${date}|${currency}`;
        const d = dividends.get(key) ?? {
          gross: 0,
          tax: 0,
          row: {
            date,
            time,
            type: "dividend" as const,
            isin,
            name: product || undefined,
            currency,
            notes: /kapitaal|capital/i.test(desc) ? desc : undefined,
          },
        };
        d.gross += Number(amount);
        dividends.set(key, d);
        continue;
      }
      if (PLATFORM_RE.test(desc)) skip(out.skipped, tr("Platform costs (connection fees)"));
      else if (INTEREST_RE.test(desc)) skip(out.skipped, tr("Interest on cash"));
      else if (CASH_RE.test(desc) || !isin)
        skip(out.skipped, tr("Cash movements (deposits, withdrawals, currency exchange)"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }

    // Dividend tax belongs to the dividend of the same security and day; a correction a few days
    // later goes to the nearest dividend before it.
    for (const t of taxes) {
      const d =
        dividends.get(t.key) ??
        [...dividends.entries()]
          .filter(([k, v]) => k.startsWith(`${t.isin}|`) && k.endsWith(`|${t.currency}`) && v.row.date <= t.date)
          .map(([, v]) => v)
          .at(-1);
      if (d) d.tax += t.tax;
      else out.warnings.push(tr("Dividend tax on {date} without a dividend was left out.", { date: t.date }));
    }

    // Costs go on the first fill of their order.
    const charged = new Set<string>();
    for (const t of trades) {
      const fee = t.order ? fees.get(t.order) : undefined;
      if (fee && !charged.has(t.order)) {
        t.row.fee = fee.toFixed(2);
        charged.add(t.order);
      }
      out.rows.push(t.row);
    }
    for (const d of dividends.values()) {
      if (d.gross <= 0) continue;
      out.rows.push({ ...d.row, amount: d.gross.toFixed(4), tax: d.tax ? d.tax.toFixed(4) : undefined });
    }
    out.rows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    return out;
  },
};

/**
 * DEGIRO's transactions export (Inbox → Transactions, "Transactions.csv"): the trades with their
 * costs. Dividends are only in the account statement.
 */
export const degiroTransactions: BrokerFormat = {
  id: "degiro-transactions",
  label: msg("DEGIRO transactions"),
  detect(h) {
    return (
      column(h, "isin") >= 0 &&
      column(h, "aantal", "quantity", "anzahl") >= 0 &&
      column(h, "koers", "price", "kurs") >= 0 &&
      column(h, "order id", "order-id", "orderid") >= 0 &&
      column(h, "beurs", "reference exchange", "referenzborse", "börse", "borse") >= 0
    );
  },
  convert(table) {
    const out = converted({ feeCurrency: "EUR" });
    const h = table[0]!;
    const c = {
      date: 0,
      time: 1,
      product: column(h, "product", "produkt"),
      isin: column(h, "isin"),
      quantity: column(h, "aantal", "quantity", "anzahl"),
      price: column(h, "koers", "price", "kurs"),
      fee: columnStarting(h, "transactiekosten", "transaction", "transaktions", "kosten"),
      autoFx: columnStarting(h, "autofx"),
      order: column(h, "order id", "order-id", "orderid"),
    };
    const rows = table.slice(1).filter((r) => r.some((x) => x.trim()));
    const decimal = detectDecimal(rows.map((r) => r[c.price] ?? ""));
    for (const r of [...rows].reverse()) {
      const date = dmy(r[c.date] ?? "");
      const quantity = num(r[c.quantity], decimal);
      if (!date || !quantity) {
        skip(out.skipped, tr("Lines without a date or quantity"));
        continue;
      }
      // The column after a value holds its currency.
      const p = pounds(num(r[c.price], decimal), (r[c.price + 1] ?? "").trim() || "EUR");
      const fee =
        Number(abs(num(r[c.fee], decimal)) ?? 0) + (c.autoFx >= 0 ? Number(abs(num(r[c.autoFx], decimal)) ?? 0) : 0);
      const order = (r[c.order] ?? "").trim();
      out.rows.push({
        date,
        time: (r[c.time] ?? "").trim() || undefined,
        type: isNegative(quantity) ? "sell" : "buy",
        isin: (r[c.isin] ?? "").trim() || undefined,
        name: (r[c.product] ?? "").trim() || undefined,
        quantity: abs(quantity)!,
        price: p.price ?? undefined,
        currency: p.currency,
        fee: fee ? fee.toFixed(2) : undefined,
        id: order ? `degiro:${order}` : undefined,
      });
    }
    return out;
  },
};
