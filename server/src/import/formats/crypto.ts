import { msg, tr, trn } from "../../i18n/index.js";
import { mapKrakenLedger } from "../../sync/providers/kraken.js";
import type { AssetRef, SyncEvent } from "../../sync/types.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  column,
  converted,
  hasColumns,
  isFiatCode,
  isNegative,
  looseNum,
  norm,
  num,
  skip,
  utc,
} from "./types.js";

const crypto = (symbol: string): Pick<TemplateRow, "symbol" | "assetType"> => ({
  symbol: symbol.toUpperCase(),
  assetType: isFiatCode(symbol) ? "cash" : "crypto",
});

/**
 * Bitvavo's transaction history (Transaction history → Export, CSV). All in euros, so deposits,
 * withdrawals and the euros paid for trades are booked and the cash balance stays right.
 */
export const bitvavo: BrokerFormat = {
  id: "bitvavo",
  label: msg("Bitvavo transaction history"),
  detect: (h) => hasColumns(h, "type", "currency", "amount", "quote price", "fee currency", "transaction id"),
  convert(table) {
    const out = converted({ settleCash: true });
    const h = table[0]!;
    const c = Object.fromEntries(
      (
        [
          ["date", "date"],
          ["time", "time"],
          ["type", "type"],
          ["currency", "currency"],
          ["amount", "amount"],
          ["quote", "quote currency"],
          ["price", "quote price"],
          ["feeCurrency", "fee currency"],
          ["fee", "fee amount"],
          ["status", "status"],
          ["id", "transaction id"],
        ] as const
      ).map(([k, name]) => [k, column(h, name)]),
    ) as Record<string, number>;
    const get = (r: string[], k: string) => (c[k]! >= 0 ? (r[c[k]!] ?? "").trim() : "");
    for (const r of table.slice(1).reverse()) {
      if (!r.some((x) => x.trim())) continue;
      const status = get(r, "status").toLowerCase();
      if (status && status !== "completed") {
        skip(out.skipped, tr("Cancelled or pending"));
        continue;
      }
      const type = get(r, "type").toLowerCase();
      const symbol = get(r, "currency");
      const amount = num(get(r, "amount"), ".");
      const fee = abs(num(get(r, "fee"), "."));
      const feeCurrency = get(r, "feeCurrency").toUpperCase();
      const id = get(r, "id") || undefined;
      const when = { date: get(r, "date"), time: get(r, "time").slice(0, 8) || undefined };
      if (!amount || !symbol) {
        skip(out.skipped, tr("Lines without an amount"));
        continue;
      }
      // A fee in the coin itself (e.g. on a withdrawal) is its own line.
      const coinFee = (note: string) => {
        if (fee && Number(fee) && feeCurrency && feeCurrency !== get(r, "quote").toUpperCase())
          out.rows.push({
            ...when,
            type: "fee",
            ...crypto(feeCurrency),
            quantity: fee,
            notes: note,
            id: id && `${id}:fee`,
          });
      };
      if (type === "buy" || type === "sell") {
        const quote = get(r, "quote").toUpperCase() || "EUR";
        out.rows.push({
          ...when,
          type,
          ...crypto(symbol),
          quantity: abs(amount)!,
          price: num(get(r, "price"), ".") ?? undefined,
          currency: quote,
          fee: fee && feeCurrency === quote ? fee : undefined,
          id,
        });
        coinFee(tr("Trading fee"));
      } else if (type === "deposit") {
        out.rows.push({ ...when, type, ...crypto(symbol), quantity: abs(amount)!, id });
      } else if (type === "withdrawal") {
        // The amount includes the network fee: what arrives elsewhere is the amount minus the fee.
        const inCoin = fee && feeCurrency === symbol.toUpperCase() ? Number(fee) : 0;
        const sent = Number(abs(amount)) - inCoin;
        out.rows.push({ ...when, type, ...crypto(symbol), quantity: String(Number(sent.toFixed(12))), id });
        coinFee(tr("Network fee"));
      } else if (/staking|reward|rebate|airdrop|affiliate|bonus/.test(type) && !isNegative(amount)) {
        out.rows.push({ ...when, type: "reward", ...crypto(symbol), quantity: amount, notes: type, id });
      } else skip(out.skipped, tr("Staking moves and other lines"));
    }
    return out;
  },
};

/**
 * Coinbase's transaction report (Profile → Statements → CSV). Fiat deposits and withdrawals are
 * left out: purchases are often paid by card or bank, so a euro balance wouldn't add up.
 */
export const coinbase: BrokerFormat = {
  id: "coinbase",
  label: msg("Coinbase transaction report"),
  detect: (h) => hasColumns(h, "timestamp", "transaction type", "asset", "quantity transacted"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      id: column(h, "id"),
      at: column(h, "timestamp"),
      type: column(h, "transaction type"),
      asset: column(h, "asset"),
      quantity: column(h, "quantity transacted"),
      currency: column(h, "price currency", "spot price currency"),
      price: column(h, "price at transaction", "spot price at transaction"),
      subtotal: column(h, "subtotal"),
      total: column(h, "total inclusive of fees and or spread", "total inclusive of fees"),
      fee: column(h, "fees and or spread", "fees"),
      notes: column(h, "notes"),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const symbolOf = (s: string) => (s.toUpperCase() === "ETH2" ? "ETH" : s.toUpperCase());
    for (const r of table.slice(1).reverse()) {
      const date = utc(get(r, c.at));
      if (!date) continue;
      const type = norm(get(r, c.type));
      const symbol = symbolOf(get(r, c.asset));
      const quantity = abs(num(get(r, c.quantity), "."));
      const currency = get(r, c.currency).toUpperCase() || "EUR";
      const price = abs(num(get(r, c.price), "."));
      const subtotal = abs(num(get(r, c.subtotal), "."));
      const total = abs(num(get(r, c.total), "."));
      const fee = abs(num(get(r, c.fee), "."));
      const id = get(r, c.id) || undefined;
      const notes = get(r, c.notes);
      if (!quantity || !symbol) continue;
      if (/^(advanced trade |advance trade )?(buy|sell)$/.test(type)) {
        out.rows.push({
          date,
          type: type.endsWith("sell") ? "sell" : "buy",
          ...crypto(symbol),
          quantity,
          price: price ?? undefined,
          total: subtotal ?? undefined,
          currency,
          fee: fee && Number(fee) ? fee : undefined,
          id,
        });
      } else if (type === "convert") {
        // "Converted 0.0036 BTC to 156.14 XRP": a sale at the spot value, and a purchase for what came out.
        const m = /converted\s+([\d.,]+)\s+(\S+)\s+to\s+([\d.,]+)\s+(\S+)/i.exec(notes);
        if (!m) {
          skip(out.skipped, tr("Conversions without details"));
          continue;
        }
        const to = symbolOf(m[4]!);
        if (to === symbol) {
          skip(out.skipped, tr("Conversions to the same coin (e.g. ETH to ETH2)"));
          continue;
        }
        const spread = total && subtotal ? (Number(total) - Number(subtotal)).toFixed(8) : undefined;
        out.rows.push({
          date,
          type: "sell",
          ...crypto(symbol),
          quantity,
          price: price ?? undefined,
          currency,
          fee: spread && Number(spread) > 0 ? spread : undefined,
          notes,
          id: id && `${id}:sell`,
        });
        out.rows.push({
          date,
          type: "buy",
          ...crypto(to),
          quantity: abs(num(m[3], "."))!,
          total: subtotal ?? undefined,
          currency,
          notes,
          id: id && `${id}:buy`,
        });
      } else if (type === "send" || type === "receive") {
        out.rows.push({
          date,
          type: type === "send" ? "withdrawal" : "deposit",
          ...crypto(symbol),
          quantity,
          // What it was worth when it came in: the cost basis of a coin from elsewhere.
          price: type === "receive" ? (price ?? undefined) : undefined,
          currency,
          notes: notes || undefined,
          id,
        });
      } else if (/income|reward|earn/.test(type)) {
        out.rows.push({
          date,
          type: "reward",
          ...crypto(symbol),
          quantity,
          price: price ?? undefined,
          currency,
          notes: type,
          id,
        });
      } else if (isFiatCode(symbol)) skip(out.skipped, tr("Euro deposits and withdrawals"));
      else skip(out.skipped, tr("Moves within Coinbase (staking, Coinbase Pro)"));
    }
    return out;
  },
};

// Crypto.com App transaction kinds (from the app's export; the list follows public parsers' test files).
const CDC_TRADES = new Set([
  "crypto_exchange",
  "viban_purchase",
  "van_purchase",
  "crypto_viban_exchange",
  "crypto_to_van_sell_order",
  "recurring_buy_order",
]);
const CDC_REWARDS = new Set([
  "crypto_earn_interest_paid",
  "crypto_earn_extra_interest_paid",
  "mco_stake_reward",
  "supercharger_reward_to_app_credited",
  "rewards_platform_deposit_credited",
  "referral_bonus",
  "referral_gift",
  "referral_card_cashback",
  "transfer_cashback",
  "reimbursement",
  "gift_card_reward",
  "admin_wallet_credited",
  "campaign_reward",
  "pay_checkout_reward",
  "lockup_swap_rebate",
]);
// Coins moving within the app (Earn, staking, lockups, the Supercharger): still yours, so left out.
const CDC_INTERNAL =
  /^(crypto_earn_program_(created|withdrawn)|lockup_(lock|unlock|upgrade)|lockup_swap_(credited|debited)|interest_swap_(credited|debited)|supercharger_(deposit|withdrawal)|council_node_deposit_created|viban_deposit_precredit(_repayment)?|dynamic_coin_swap_bonus_exchange_deposit|finance\.(lockup\.dpos_(lock|unlock)|dpos\.staking)\..*|trading\.limit_order\..*_(lock|unlock))$/;

/**
 * The Crypto.com App's crypto transactions (Accounts → History → Export, CSV). Euro deposits are left
 * out, as with Coinbase: purchases are often paid by card, so a euro balance wouldn't add up. Values
 * come from the export's own "Native Amount".
 */
export const cryptoCom: BrokerFormat = {
  id: "crypto-com",
  label: msg("Crypto.com App transactions"),
  detect: (h) =>
    hasColumns(h, "timestamp (utc)", "transaction description", "currency", "amount", "to currency", "native amount") &&
    hasColumns(h, "transaction kind"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      at: column(h, "timestamp (utc)"),
      description: column(h, "transaction description"),
      currency: column(h, "currency"),
      amount: column(h, "amount"),
      to: column(h, "to currency"),
      toAmount: column(h, "to amount"),
      native: column(h, "native currency"),
      value: column(h, "native amount"),
      kind: column(h, "transaction kind"),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    // A balance conversion (USDT to USDC, say) is two lines at the same moment: a sale and a purchase.
    // Several can happen at once: each side is kept in a list.
    const halves = new Map<string, { debited: TemplateRow[]; credited: TemplateRow[] }>();
    for (const r of table.slice(1).reverse()) {
      if (!r.some((x) => x.trim())) continue;
      const kind = get(r, c.kind).toLowerCase();
      const date = utc(get(r, c.at));
      const symbol = get(r, c.currency).toUpperCase();
      const amount = num(get(r, c.amount), ".");
      const quantity = abs(amount);
      // The value in your own currency; its sign isn't reliable, the amount's is.
      const value = abs(num(get(r, c.value), ".")) ?? undefined;
      const currency = get(r, c.native).toUpperCase() || "EUR";
      const notes = get(r, c.description) || undefined;
      if (!date || !symbol || !quantity || !Number(quantity)) {
        skip(out.skipped, tr("Lines without an amount"));
        continue;
      }
      const to = get(r, c.to).toUpperCase();
      const toQuantity = abs(num(get(r, c.toAmount), "."));
      const at = { date, notes };

      if (CDC_INTERNAL.test(kind)) skip(out.skipped, tr("Moves within Crypto.com (Earn, staking, lockups)"));
      else if (CDC_TRADES.has(kind) || (/^trading\.limit_order\..*commit$/.test(kind) && to)) {
        if (!to || !toQuantity || !Number(toQuantity)) {
          skip(out.skipped, tr("Conversions without details"));
          continue;
        }
        if (isFiatCode(symbol)) {
          // Bought with euros (or another currency) from the app's fiat wallet.
          out.rows.push({ ...at, type: "buy", ...crypto(to), quantity: toQuantity, total: quantity, currency: symbol });
        } else if (isFiatCode(to)) {
          out.rows.push({ ...at, type: "sell", ...crypto(symbol), quantity, total: toQuantity, currency: to });
        } else {
          // One coin for another: a sale at the value, and a purchase for the same.
          out.rows.push({ ...at, type: "sell", ...crypto(symbol), quantity, total: value, currency });
          out.rows.push({ ...at, type: "buy", ...crypto(to), quantity: toQuantity, total: value, currency });
        }
      } else if (isFiatCode(symbol)) skip(out.skipped, tr("Euro deposits and withdrawals"));
      else if (/^(crypto_wallet_swap|dynamic_coin_swap)_(debited|credited)$/.test(kind)) {
        const side = kind.endsWith("debited") ? "debited" : "credited";
        const key = `${date}|${kind.replace(/_(debited|credited)$/, "")}`;
        const pair = halves.get(key) ?? { debited: [], credited: [] };
        pair[side].push({
          ...at,
          type: side === "debited" ? "sell" : "buy",
          ...crypto(symbol),
          quantity,
          total: value,
          currency,
        });
        halves.set(key, pair);
      } else if (CDC_REWARDS.has(kind) || /^finance\..*interest|^reward\./.test(kind)) {
        if (isNegative(amount))
          out.rows.push({ ...at, type: "fee", ...crypto(symbol), quantity, notes: notes ?? kind });
        else out.rows.push({ ...at, type: "reward", ...crypto(symbol), quantity, total: value, currency });
      } else if (kind === "card_cashback_reverted" || kind === "reimbursement_reverted") {
        // A reward taken back.
        out.rows.push({ ...at, type: "fee", ...crypto(symbol), quantity, notes: notes ?? kind });
      } else if (kind === "crypto_purchase" || kind === "crypto_payment" || kind === "card_top_up") {
        // Bought by card; or sold to pay, or to top up the card.
        const type = isNegative(amount) ? "sell" : "buy";
        out.rows.push({ ...at, type, ...crypto(symbol), quantity, total: value, currency });
      } else if (kind === "dust_conversion_debited" || kind === "dust_conversion_credited") {
        out.rows.push({
          ...at,
          type: kind.endsWith("debited") ? "sell" : "buy",
          ...crypto(symbol),
          quantity,
          total: value,
          currency,
        });
      } else if (kind === "crypto_withdrawal" || kind === "crypto_to_exchange_transfer") {
        out.rows.push({ ...at, type: "withdrawal", ...crypto(symbol), quantity });
      } else if (kind === "crypto_deposit" || kind === "exchange_to_crypto_transfer") {
        // What it was worth when it came in: the cost basis of a coin from elsewhere.
        out.rows.push({ ...at, type: "deposit", ...crypto(symbol), quantity, total: value, currency });
      } else skip(out.skipped, tr("Other kinds: {kind}", { kind: kind || "—" }));
    }
    for (const { debited, credited } of halves.values()) {
      if (debited.length !== credited.length) {
        for (let i = 0; i < debited.length + credited.length; i++)
          skip(out.skipped, tr("Balance conversions without their other half"));
        continue;
      }
      // At the same moment, the halves with the closest value belong together.
      const byValue = (a: TemplateRow, b: TemplateRow) => Number(a.total ?? 0) - Number(b.total ?? 0);
      credited.sort(byValue);
      debited.sort(byValue).forEach((sold, i) => {
        const bought = credited[i]!;
        if (sold.symbol === bought.symbol) skip(out.skipped, tr("Moves within Crypto.com (Earn, staking, lockups)"));
        else out.rows.push(sold, bought);
      });
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

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "May 5, 2020, 10:10:57 PM" → local date and 24-hour time. */
function usDateTime(raw: string): { date: string; time: string } | null {
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AP]M)?$/i.exec(raw.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase());
  if (month < 0) return null;
  let hour = Number(m[4]);
  if (m[7]) hour = (hour % 12) + (m[7].toUpperCase() === "PM" ? 12 : 0);
  const pad = (n: number | string) => String(n).padStart(2, "0");
  return { date: `${m[3]}-${pad(month + 1)}-${pad(m[2]!)}`, time: `${pad(hour)}:${m[5]}:${m[6] ?? "00"}` };
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
          ...crypto(symbol),
          quantity,
          ...(price ? priced : { total: abs(value!.value)!, currency: value!.currency }),
          fee: fee && Number(fee.value) ? abs(fee.value)! : undefined,
        });
      } else if (type === "send") out.rows.push({ ...when, type: "withdrawal", ...crypto(symbol), quantity });
      // What it was worth when it came in: the cost basis of a coin from elsewhere.
      else if (type === "receive") out.rows.push({ ...when, type: "deposit", ...crypto(symbol), quantity, ...priced });
      else if (type === "stake" || type === "unstake")
        skip(out.skipped, tr("Staking and unstaking (the coins stay yours)"));
      else if (/reward|cashback|airdrop|bonus/.test(type))
        out.rows.push({ ...when, type: "reward", ...crypto(symbol), quantity, ...priced, notes: get(r, c.type) });
      else skip(out.skipped, tr("Other kinds: {kind}", { kind: get(r, c.type) || "—" }));
    }
    return out;
  },
};

/** A provider event as template rows (for formats read with a sync provider's own mapping). */
function eventRows(e: SyncEvent): TemplateRow[] | "crypto-quote" {
  const date = e.at.toISOString();
  const asset = (a: AssetRef): Pick<TemplateRow, "symbol" | "assetType" | "isin"> =>
    a.kind === "fiat"
      ? { symbol: a.currency, assetType: "cash" }
      : a.kind === "crypto"
        ? { symbol: a.symbol, assetType: "crypto" }
        : { symbol: a.symbol, isin: a.isin };
  switch (e.kind) {
    case "trade": {
      if (!e.quote) return [];
      if (!isFiatCode(e.quote.currency)) return "crypto-quote";
      const fee = Number(e.feeQuote ?? 0);
      // A buy's quote includes the fee; a sale's quote is after it.
      const gross = e.side === "buy" ? Number(e.quote.amount) - fee : Number(e.quote.amount) + fee;
      return [
        {
          date,
          type: e.side,
          ...asset(e.asset),
          quantity: e.quantity,
          total: gross.toFixed(8),
          currency: e.quote.currency,
          fee: fee ? fee.toFixed(8) : undefined,
          id: e.id,
        },
      ];
    }
    case "deposit":
    case "withdrawal":
      return [{ date, type: e.kind, ...asset(e.asset), quantity: e.quantity, notes: e.note, id: e.id }];
    case "reward":
      return [{ date, type: "reward", ...asset(e.asset), quantity: e.quantity, notes: e.note, id: e.id }];
    case "fee":
      return [{ date, type: "fee", ...asset(e.asset), quantity: e.quantity, notes: e.note, id: e.id }];
    case "dividend":
      return [
        { date, type: "dividend", ...asset(e.asset), currency: e.currency, amount: e.gross, tax: e.tax, id: e.id },
      ];
  }
}

/**
 * Kraken's ledger export (History → Export → Ledgers, "ledgers.csv"), read with the same mapping as
 * the API connection: trades are paired by reference id, staking moves fall away.
 */
export const krakenLedgers: BrokerFormat = {
  id: "kraken-ledgers",
  label: msg("Kraken ledgers"),
  detect: (h) => hasColumns(h, "txid", "refid", "time", "type", "asset", "amount", "fee", "balance"),
  convert(table) {
    const out = converted({ settleCash: true });
    const h = table[0]!;
    const c = {
      txid: column(h, "txid"),
      refid: column(h, "refid"),
      time: column(h, "time"),
      type: column(h, "type"),
      subtype: column(h, "subtype"),
      asset: column(h, "asset"),
      amount: column(h, "amount"),
      fee: column(h, "fee"),
    };
    const entries = table
      .slice(1)
      .filter((r) => (r[c.txid] ?? "").trim())
      .map((r) => {
        const iso = utc((r[c.time] ?? "").trim());
        return {
          refid: (r[c.refid] ?? "").trim(),
          time: iso ? Date.parse(iso) / 1000 : NaN,
          type: (r[c.type] ?? "").trim(),
          subtype: c.subtype >= 0 ? (r[c.subtype] ?? "").trim() : "",
          asset: (r[c.asset] ?? "").trim(),
          amount: (r[c.amount] ?? "0").trim() || "0",
          fee: (r[c.fee] ?? "0").trim() || "0",
        };
      })
      .filter((e) => Number.isFinite(e.time));
    // Nothing is held back as "still arriving": the file is complete.
    let cryptoQuote = 0;
    for (const e of mapKrakenLedger(entries, {}, Number.MAX_SAFE_INTEGER)) {
      const rows = eventRows(e);
      if (rows === "crypto-quote") cryptoQuote++;
      else out.rows.push(...rows);
    }
    out.rows.sort((a, b) => a.date.localeCompare(b.date));
    if (cryptoQuote)
      out.warnings.push(
        trn(
          cryptoQuote,
          "{n} trade between two coins (not against euros) was left out: connect Kraken with an API key to include it.",
          "{n} trades between two coins (not against euros) were left out: connect Kraken with an API key to include them.",
        ),
      );
    return out;
  },
};
