import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  column,
  columnStarting,
  converted,
  dmy,
  hasColumns,
  isNegative,
  looseNum,
  monthNameDate,
  norm,
  num,
  pounds,
  skip,
  utc,
} from "./types.js";

const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
const fixed = (v: number, digits = 8) => (v ? v.toFixed(digits).replace(/\.?0+$/, "") : undefined);

/**
 * Rabobank Beleggen (Mutaties & nota's → Exporteer als .csv). All in euros: deposits, costs and
 * interest are booked with the trades, so the cash balance stays right.
 */
export const rabobank: BrokerFormat = {
  id: "rabobank",
  label: msg("Rabobank Beleggen transactions"),
  detect: (h) => hasColumns(h, "portefeuille", "type mutatie", "volume", "koers", "bedrag", "isin code"),
  convert(table) {
    const out = converted({ feeCurrency: "EUR", settleCash: true });
    const h = table[0]!;
    const c = {
      name: column(h, "naam"),
      date: column(h, "datum"),
      type: column(h, "type mutatie"),
      currency: column(h, "valuta mutatie"),
      volume: column(h, "volume"),
      price: column(h, "koers"),
      priceCurrency: column(h, "valuta koers"),
      costs: columnStarting(h, "valuta kosten", "kosten"),
      value: column(h, "waarde"),
      amount: column(h, "bedrag"),
      isin: column(h, "isin code"),
      time: column(h, "tijd"),
    };
    for (const r of table.slice(1).reverse()) {
      const date = dmy(cell(r, c.date));
      if (!date) continue;
      const type = norm(cell(r, c.type));
      const when = { date, time: cell(r, c.time).slice(0, 8) || undefined };
      const amount = num(cell(r, c.amount), ",");
      const security = { isin: cell(r, c.isin) || undefined, name: cell(r, c.name) || undefined };
      if (type.startsWith("koop") || type.startsWith("verkoop")) {
        out.rows.push({
          ...when,
          type: type.startsWith("koop") ? "buy" : "sell",
          ...security,
          quantity: abs(num(cell(r, c.volume), ","))!,
          price: num(cell(r, c.price), ",") ?? undefined,
          currency: cell(r, c.priceCurrency) || "EUR",
          fee: fixed(Number(abs(num(cell(r, c.costs), ",")) ?? 0), 2),
        });
      } else if (type.includes("dividend")) {
        // Waarde is gross, Bedrag what was paid out: the difference is dividend tax.
        const gross = Number(num(cell(r, c.value), ",") ?? 0);
        const net = Number(amount ?? 0);
        out.rows.push({
          ...when,
          type: "dividend",
          ...security,
          currency: cell(r, c.currency) || "EUR",
          amount: fixed(gross, 4),
          tax: fixed(gross - net, 4),
        });
      } else if (type.startsWith("storting") || type.includes("opname")) {
        if (!amount || !Number(amount)) continue;
        out.rows.push({
          ...when,
          type: isNegative(amount) ? "withdrawal" : "deposit",
          symbol: "EUR",
          assetType: "cash",
          quantity: abs(amount)!,
        });
      } else if (type.includes("rente") && amount && Number(amount)) {
        out.rows.push({
          ...when,
          type: isNegative(amount) ? "fee" : "reward",
          symbol: "EUR",
          assetType: "cash",
          quantity: abs(amount)!,
          notes: cell(r, c.type),
        });
      } else if ((type.includes("tarieven") || type.includes("kosten")) && amount && Number(amount)) {
        out.rows.push({
          ...when,
          type: "fee",
          symbol: "EUR",
          assetType: "cash",
          quantity: abs(amount)!,
          notes: cell(r, c.type),
        });
      } else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};

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

/**
 * Trading 212 (History → Export). Trades in other currencies settle in euros at Trading 212, so
 * cash (deposits, interest) is left out.
 */
export const trading212: BrokerFormat = {
  id: "trading212",
  label: msg("Trading 212 history"),
  detect: (h) => hasColumns(h, "action", "time", "isin", "no of shares", "price share"),
  convert(table) {
    const out = converted({ feeCurrency: "EUR" });
    const h = table[0]!;
    const c = {
      action: column(h, "action"),
      time: column(h, "time"),
      isin: column(h, "isin"),
      ticker: column(h, "ticker"),
      name: column(h, "name"),
      shares: column(h, "no of shares"),
      price: column(h, "price share"),
      priceCurrency: column(h, "currency price share"),
      total: column(h, "total"),
      tax: column(h, "withholding tax"),
      taxCurrency: column(h, "currency withholding tax"),
      id: column(h, "id"),
    };
    // Every cost column (conversion fee, stamp duty, transaction fee, French tax …) except dividend tax.
    const feeColumns = h
      .map((name, i) => ({ raw: name, name: norm(name), i }))
      .filter((x) => /fee|stamp duty|transaction tax|finra/.test(x.name) && !/^currency\s*\(/i.test(x.raw.trim()))
      .map((x) => x.i);
    for (const r of table.slice(1)) {
      const action = norm(cell(r, c.action));
      const date = utc(cell(r, c.time));
      if (!date) continue;
      const security = {
        isin: cell(r, c.isin) || undefined,
        symbol: cell(r, c.ticker) || undefined,
        name: cell(r, c.name) || undefined,
      };
      const shares = abs(num(cell(r, c.shares), "."));
      const p = pounds(num(cell(r, c.price), "."), cell(r, c.priceCurrency) || "EUR");
      if (/ buy$| sell$/.test(` ${action}`) && shares) {
        const fee = feeColumns.reduce((s, i) => s + Number(abs(num(cell(r, i), ".")) ?? 0), 0);
        out.rows.push({
          date,
          type: action.endsWith("sell") ? "sell" : "buy",
          ...security,
          quantity: shares,
          price: p.price ?? undefined,
          currency: p.currency,
          fee: fixed(fee, 2),
          id: cell(r, c.id) || undefined,
        });
      } else if (action.startsWith("dividend") && shares && p.price) {
        // Gross per share × shares, in the security's currency; tax when it's in that currency too.
        const taxCurrency = cell(r, c.taxCurrency).toUpperCase();
        const tax = taxCurrency === p.currency || !taxCurrency ? abs(num(cell(r, c.tax), ".")) : null;
        if (!tax && cell(r, c.tax))
          out.warnings.push(
            tr("Dividend tax in another currency was left out (line {line}).", { line: table.indexOf(r) + 1 }),
          );
        out.rows.push({
          date,
          type: "dividend",
          ...security,
          currency: p.currency,
          amount: fixed(Number(shares) * Number(p.price), 6),
          tax: tax ?? undefined,
          id: cell(r, c.id) || undefined,
        });
      } else if (/deposit|withdrawal|interest|card|conversion/.test(action))
        skip(out.skipped, tr("Cash movements (deposits, withdrawals, currency exchange)"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};

/** BUX (Account value → History → download). Cash, subscription fees and interest are left out. */
export const bux: BrokerFormat = {
  id: "bux",
  label: msg("BUX history"),
  detect: (h) => hasColumns(h, "transaction category", "transaction type", "asset id", "asset quantity"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      time: columnStarting(h, "transaction time"),
      category: column(h, "transaction category"),
      type: column(h, "transaction type"),
      amount: column(h, "transaction amount"),
      currency: column(h, "transaction currency"),
      isin: column(h, "asset id"),
      name: column(h, "asset name"),
      quantity: column(h, "asset quantity"),
      price: column(h, "asset price"),
      assetCurrency: column(h, "asset currency"),
      divCurrency: column(h, "dividend currency"),
      divGross: column(h, "dividend gross amount"),
      divTax: column(h, "dividend tax amount"),
    };
    const rows = table.slice(1).filter((r) => cell(r, c.time));
    rows.sort((a, b) => cell(a, c.time).localeCompare(cell(b, c.time)));
    const trades: { row: TemplateRow; at: string; isin: string }[] = [];
    for (const r of rows) {
      const at = cell(r, c.time);
      const date = at.slice(0, 10);
      const time = at.slice(11, 19) || undefined;
      const category = norm(cell(r, c.category));
      const type = norm(cell(r, c.type));
      const isin = cell(r, c.isin);
      if (category === "trades" && /buy|sell/.test(type)) {
        const p = pounds(num(cell(r, c.price), "."), cell(r, c.assetCurrency) || "EUR");
        const row: TemplateRow = {
          date,
          time,
          type: type.includes("sell") ? "sell" : "buy",
          isin: isin || undefined,
          name: cell(r, c.name) || undefined,
          quantity: abs(num(cell(r, c.quantity), "."))!,
          price: p.price ?? undefined,
          currency: p.currency,
        };
        trades.push({ row, at: at.slice(0, 19), isin });
        out.rows.push(row);
      } else if (category === "fees" && /trading fee|trade fee|order fee/.test(type)) {
        // The fee comes with its trade: same security, same moment.
        const t = [...trades].reverse().find((x) => x.isin === isin && x.at === at.slice(0, 19));
        if (t) t.row.fee = (Number(t.row.fee ?? 0) + Number(abs(num(cell(r, c.amount), ".")) ?? 0)).toFixed(2);
        else skip(out.skipped, tr("Costs without a trade (subscription, service fees)"));
      } else if (category === "dividends") {
        const gross = abs(num(cell(r, c.divGross), "."));
        out.rows.push({
          date,
          time,
          type: "dividend",
          isin: isin || undefined,
          name: cell(r, c.name) || undefined,
          currency: (gross ? cell(r, c.divCurrency) : cell(r, c.currency)) || "EUR",
          amount: gross ?? abs(num(cell(r, c.amount), "."))!,
          tax: gross ? (abs(num(cell(r, c.divTax), ".")) ?? undefined) : undefined,
        });
      } else if (category === "fees") skip(out.skipped, tr("Costs without a trade (subscription, service fees)"));
      else if (["deposits", "withdrawals", "interest"].includes(category))
        skip(out.skipped, tr("Cash movements (deposits, withdrawals, currency exchange)"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};

/**
 * Saxo (Profile → Transaction overview → Export to Excel, saved as CSV). Amounts are in the account's
 * currency; trades are read from "Buy 3 @ 134.85 USD", with the commission worked out from the total.
 */
export const saxo: BrokerFormat = {
  id: "saxo",
  label: msg("Saxo transaction overview"),
  detect: (h) => hasColumns(h, "trade date", "instrument isin", "event", "amount", "conversion rate"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      date: column(h, "trade date"),
      type: column(h, "type"),
      name: column(h, "instrument"),
      isin: column(h, "instrument isin"),
      currency: column(h, "instrument currency"),
      symbol: column(h, "instrument symbol"),
      event: column(h, "event"),
      amount: column(h, "amount"),
      order: column(h, "order id"),
      rate: column(h, "conversion rate"),
    };
    const taxes = new Map<string, number>();
    const dividends: { row: TemplateRow; net: number }[] = [];
    for (const r of table.slice(1).reverse()) {
      const date = monthNameDate(cell(r, c.date)) ?? dmy(cell(r, c.date));
      if (!date) continue;
      const event = cell(r, c.event);
      const amount = looseNum(cell(r, c.amount));
      const rate = Number(looseNum(cell(r, c.rate)) ?? 1) || 1;
      const isin = cell(r, c.isin) || undefined;
      const security = {
        isin,
        symbol: cell(r, c.symbol).split(":")[0] || undefined,
        name: cell(r, c.name) || undefined,
      };
      const trade = /^(buy|sell)\s+([\d.,]+)\s*@\s*([\d.,]+)\s*([A-Za-z]{3})/i.exec(event);
      if (trade) {
        const side = trade[1]!.toLowerCase() as "buy" | "sell";
        const quantity = looseNum(trade[2])!;
        const p = pounds(looseNum(trade[3]), trade[4]!);
        // The amount (account currency) includes the commission; in the trade's currency:
        const value = Math.abs(Number(amount ?? 0)) / rate;
        const gross = Number(quantity) * Number(p.price ?? 0);
        let fee = side === "buy" ? value - gross : gross - value;
        // Saxo doesn't say which way its conversion rate goes; a "commission" of more than 5% means
        // it went the other way: leave it out rather than book a wrong cost.
        if (fee > gross * 0.05) {
          out.warnings.push(tr("The commission on {date} couldn't be worked out and was left out.", { date }));
          fee = 0;
        }
        out.rows.push({
          date,
          type: side,
          ...security,
          quantity,
          price: p.price ?? undefined,
          currency: p.currency,
          fee: fee > 0.005 ? fee.toFixed(2) : undefined,
          id: cell(r, c.order) ? `saxo:${cell(r, c.order)}` : undefined,
        });
      } else if (isin && /withholding|bronbelasting|dividend tax/i.test(event)) {
        taxes.set(`${isin}|${date}`, (taxes.get(`${isin}|${date}`) ?? 0) + Math.abs(Number(amount ?? 0)) / rate);
      } else if (isin && /dividend/i.test(event)) {
        dividends.push({
          row: { date, type: "dividend", ...security, currency: cell(r, c.currency) || "EUR" },
          net: Number(amount ?? 0) / rate,
        });
      } else if (/deposit|withdrawal|transfer|fee|interest/i.test(`${event} ${cell(r, c.type)}`))
        skip(out.skipped, tr("Cash movements and account costs"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    for (const { row, net } of dividends) {
      // A net amount plus the tax withheld from it is the gross dividend.
      const tax = taxes.get(`${row.isin}|${row.date}`) ?? 0;
      out.rows.push({ ...row, amount: (net + tax).toFixed(4), tax: tax ? tax.toFixed(4) : undefined });
    }
    out.rows.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  },
};

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
