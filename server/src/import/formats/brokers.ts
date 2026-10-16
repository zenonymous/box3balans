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

/**
 * Lightyear (Transactions → Download report, CSV). Lightyear holds cash in several currencies and
 * exchanges it in separate conversion lines, so cash (deposits, withdrawals, interest, rewards,
 * conversions) is left out and only the securities are followed, as with Trading 212. Built on the
 * layout in open-source parsers, not yet tested with a real export (see docs/exportformaten.md).
 */
export const lightyear: BrokerFormat = {
  id: "lightyear",
  label: msg("Lightyear transactions"),
  detect: (h) => hasColumns(h, "reference", "ticker", "isin", "type", "ccy", "gross amount", "net amt", "tax amt"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      date: column(h, "date"),
      ref: column(h, "reference"),
      ticker: column(h, "ticker"),
      isin: column(h, "isin"),
      type: column(h, "type"),
      quantity: column(h, "quantity"),
      currency: column(h, "ccy"),
      price: column(h, "price share"),
      gross: column(h, "gross amount"),
      fee: column(h, "fee"),
      tax: column(h, "tax amt"),
    };
    const n = (r: string[], i: number) => num(cell(r, i), ".");
    for (const r of table.slice(1)) {
      // "14/01/2026 15:31:07"
      const [day = "", time] = cell(r, c.date).split(/\s+/);
      const date = dmy(day);
      if (!date) continue;
      const type = norm(cell(r, c.type));
      const ref = cell(r, c.ref);
      const security = { isin: cell(r, c.isin) || undefined, symbol: cell(r, c.ticker) || undefined };
      const currency = cell(r, c.currency).toUpperCase() || "EUR";
      const fee = Number(abs(n(r, c.fee)) ?? 0);
      const quantity = abs(n(r, c.quantity));
      if ((type === "buy" || type === "sell") && quantity && Number(quantity)) {
        out.rows.push({
          date,
          time,
          type,
          ...security,
          quantity,
          price: abs(n(r, c.price)) ?? undefined,
          currency,
          fee: fixed(fee, 2),
          id: ref ? `lightyear:${ref}` : undefined,
        });
      } else if ((type === "dividend" || type === "distribution") && security.isin) {
        // Gross is net + tax + fee; a fee on a money market fund's distribution comes off the income.
        const gross = Number(abs(n(r, c.gross)) ?? 0) - fee;
        if (gross <= 0) continue;
        out.rows.push({
          date,
          time,
          type: "dividend",
          ...security,
          currency,
          amount: fixed(gross, 4),
          tax: fixed(Number(abs(n(r, c.tax)) ?? 0), 4),
          id: ref ? `lightyear:${ref}` : undefined,
        });
      } else if (/deposit|withdrawal|interest|reward|conversion/.test(type))
        skip(out.skipped, tr("Cash movements (deposits, withdrawals, currency exchange)"));
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};

/**
 * Scalable Capital (Transactions → select → Export CSV; PRIME+ Broker only). Everything is in euros,
 * so cash is followed: deposits, withdrawals, interest and fees are booked with the trades. Built
 * on Portfolio Performance's template and user samples, not yet tested with a real export (see
 * docs/exportformaten.md).
 */
export const scalableCapital: BrokerFormat = {
  id: "scalable-capital",
  label: msg("Scalable Capital transactions"),
  detect: (h) =>
    hasColumns(h, "date", "time", "status", "reference", "assettype", "type", "isin", "shares", "price", "amount") &&
    hasColumns(h, "fee", "tax", "currency"),
  convert(table) {
    const out = converted({ settleCash: true, feeCurrency: "EUR" });
    const h = table[0]!;
    const c = {
      date: column(h, "date"),
      time: column(h, "time"),
      status: column(h, "status"),
      ref: column(h, "reference"),
      description: column(h, "description"),
      type: column(h, "type"),
      isin: column(h, "isin"),
      shares: column(h, "shares"),
      price: column(h, "price"),
      amount: column(h, "amount"),
      fee: column(h, "fee"),
      tax: column(h, "tax"),
      currency: column(h, "currency"),
    };
    // German notation: "1.526,72". (looseNum would read "1.000" as 1.)
    const n = (r: string[], i: number) => num(cell(r, i), ",");
    for (const r of table.slice(1)) {
      const date = dmy(cell(r, c.date));
      if (!date) continue;
      if (norm(cell(r, c.status)) !== "executed") {
        skip(out.skipped, tr("Orders that weren't executed"));
        continue;
      }
      const time = cell(r, c.time) || undefined;
      const type = norm(cell(r, c.type));
      const ref = cell(r, c.ref);
      const currency = cell(r, c.currency).toUpperCase() || "EUR";
      const amount = Number(n(r, c.amount) ?? 0);
      const fee = Number(abs(n(r, c.fee)) ?? 0);
      const tax = Number(abs(n(r, c.tax)) ?? 0);
      const security = { isin: cell(r, c.isin) || undefined, name: cell(r, c.description) || undefined };
      const shares = abs(n(r, c.shares));
      const cash = (t: TemplateRow["type"], q: number) =>
        out.rows.push({
          date,
          time,
          type: t,
          symbol: currency,
          assetType: "cash",
          quantity: fixed(q)!,
          notes: cell(r, c.type),
        });
      if ((type === "buy" || type === "savings plan" || type === "sell") && shares && Number(shares)) {
        if (type === "sell" && tax)
          out.warnings.push(tr("Tax withheld on a sale was left out (line {line}).", { line: table.indexOf(r) + 1 }));
        out.rows.push({
          date,
          time,
          type: type === "sell" ? "sell" : "buy",
          ...security,
          quantity: shares,
          price: abs(n(r, c.price)) ?? undefined,
          currency,
          fee: fixed(fee, 2),
          id: ref ? `scalable:${ref}` : undefined,
        });
      } else if (type === "distribution" && security.isin && amount > 0) {
        // The amount is what was paid out; with the tax withheld it's the gross distribution.
        out.rows.push({
          date,
          time,
          type: "dividend",
          ...security,
          currency,
          amount: fixed(amount + tax, 4),
          tax: fixed(tax, 4),
          id: ref ? `scalable:${ref}` : undefined,
        });
      } else if ((type === "deposit" || type === "cash transfer in") && amount) cash("deposit", Math.abs(amount));
      else if ((type === "withdrawal" || type === "cash transfer out") && amount) cash("withdrawal", Math.abs(amount));
      else if (type === "interest" && amount > 0) cash("reward", amount);
      // Fees outside orders, and taxes (German tax on gains), both reduce the cash.
      else if ((type === "fee" || type === "taxes") && amount < 0) cash("fee", -amount);
      else if (type === "taxes" && amount > 0) cash("reward", amount);
      else skip(out.skipped, tr("Other lines (corporate actions, product changes)"));
    }
    return out;
  },
};

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
