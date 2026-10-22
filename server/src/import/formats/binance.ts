import { msg, tr, trn } from "../../i18n/index.js";
import { type Decimal, ZERO } from "../../lib/decimal.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  coinAsset,
  column,
  converted,
  hasColumns,
  isFiatCode,
  looseNum,
  norm,
  skip,
  utc,
} from "./types.js";

// Binance stopped serving the Netherlands in July 2023: this is for the history before that.

// Operations that are part of a trade: the rows of one second together are one trade.
const TRADE_OPS = new Set([
  "buy",
  "sell",
  "fee",
  "transaction related",
  "transaction buy",
  "transaction spend",
  "transaction fee",
  "transaction sold",
  "transaction revenue",
  "binance convert",
  "large otc trading",
  "buy crypto with card",
  "stablecoins auto conversion",
]);
const FEE_OPS = new Set(["fee", "transaction fee", "bnb fee deduction"]);
// Income: interest, staking, airdrops, cashback, referral rewards.
const REWARD =
  /interest|reward|airdrop|distribution|cashback|referral|referrer|rebate|commission history|mining|launchpool earnings|cash voucher|campaign/;
// Moves between Binance's own wallets (Earn, staking, savings, funding): still yours.
const INTERNAL =
  /transfer|subscription|redemption|purchase|savings principal|launchpad subscribe|eth 2 0 staking|staking purchase/;
// Stablecoins counted as one dollar each, so trades against them have a value.
const DOLLAR_STABLECOINS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "DAI"]);

/**
 * Binance's Transaction History (Orders → Transaction History → Export, CSV): one row per balance
 * change, with UTC_Time, Account, Operation, Coin and Change. The rows of a trade share their second.
 * A trade against money is a purchase or sale; one against a dollar stablecoin is valued at a dollar
 * per coin (a sale of the stablecoin and a purchase of the coin); one between two other coins has no
 * value and is left out. Moves within Binance, futures and margin, and money moves are left out.
 * Built on the layout in BittyTax and rotki, not yet tested with a real export.
 */
export const binance: BrokerFormat = {
  id: "binance",
  label: msg("Binance transaction history"),
  detect: (h) => hasColumns(h, "utc_time", "account", "operation", "coin", "change"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      at: column(h, "utc_time"),
      account: column(h, "account"),
      op: column(h, "operation"),
      coin: column(h, "coin"),
      change: column(h, "change"),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const rows = table
      .slice(1)
      .filter((r) => r.some((x) => x.trim()))
      .map((r) => ({
        date: utc(get(r, c.at)),
        account: norm(get(r, c.account)),
        op: norm(get(r, c.op)),
        rawOp: get(r, c.op),
        coin: get(r, c.coin).toUpperCase(),
        change: looseNum(get(r, c.change)),
      }));
    // The seconds with a trade in them; a fee row in such a second belongs to the trade.
    const tradeSeconds = new Set(rows.filter((r) => r.date && TRADE_OPS.has(r.op)).map((r) => r.date!));
    const trades = new Map<string, typeof rows>();
    let swaps = 0;
    let unclear = 0;
    for (const r of rows) {
      if (!r.date || !r.coin || !r.change || !Number(r.change)) {
        skip(out.skipped, tr("Lines without an amount"));
        continue;
      }
      if (/futures|margin/.test(r.account)) skip(out.skipped, tr("Futures and margin (no ownership of the coins)"));
      else if (/small assets exchange bnb/.test(r.op)) skip(out.skipped, tr("Small balances converted to BNB"));
      else if (TRADE_OPS.has(r.op) || (FEE_OPS.has(r.op) && tradeSeconds.has(r.date))) {
        trades.set(r.date, [...(trades.get(r.date) ?? []), r]);
      } else if (isFiatCode(r.coin)) skip(out.skipped, tr("Euro deposits and withdrawals"));
      else if (r.op === "deposit")
        out.rows.push({ date: r.date, type: "deposit", ...coinAsset(r.coin), quantity: abs(r.change)! });
      else if (r.op === "withdraw" || r.op === "send")
        out.rows.push({ date: r.date, type: "withdrawal", ...coinAsset(r.coin), quantity: abs(r.change)! });
      else if (INTERNAL.test(r.op)) skip(out.skipped, tr("Moves within Binance (Earn, staking, savings)"));
      else if (REWARD.test(r.op) && !r.change.startsWith("-"))
        out.rows.push({ date: r.date, type: "reward", ...coinAsset(r.coin), quantity: r.change, notes: r.rawOp });
      else if (/card spending|crypto box|asset recovery/.test(r.op) && r.change.startsWith("-"))
        // Coins gone without a price: spent by card, given away.
        out.rows.push({ date: r.date, type: "fee", ...coinAsset(r.coin), quantity: abs(r.change)!, notes: r.rawOp });
      else skip(out.skipped, tr("Other kinds: {kind}", { kind: r.rawOp || "—" }));
    }

    for (const [date, group] of trades) {
      // Per coin, what came in and went out; fees apart.
      // In decimals: coin amounts can have more digits than a float keeps.
      const net = new Map<string, Decimal>();
      const fees = new Map<string, Decimal>();
      for (const r of group) {
        const target = FEE_OPS.has(r.op) ? fees : net;
        target.set(r.coin, (target.get(r.coin) ?? ZERO).plus(r.change ?? 0));
      }
      const got = [...net].filter(([, v]) => v.gt(0));
      const gave = [...net].filter(([, v]) => v.lt(0));
      if (got.length !== 1 || gave.length !== 1) {
        unclear++;
        continue;
      }
      const [inCoin, inQty] = got[0]!;
      const [outCoin, outQty] = gave[0]!;
      const fmt = (v: Decimal) => v.abs().toFixed();
      const feeIn = (coin: string) => {
        const f = fees.get(coin);
        return f ? fmt(f) : undefined;
      };
      const row = (
        type: "buy" | "sell",
        coin: string,
        qty: Decimal,
        total: Decimal,
        currency: string,
      ): TemplateRow => ({
        date,
        type,
        ...coinAsset(coin),
        quantity: fmt(qty),
        total: fmt(total),
        currency,
        fee: feeIn(currency),
        notes: group[0]!.rawOp,
      });
      if (isFiatCode(outCoin)) out.rows.push(row("buy", inCoin, inQty, outQty, outCoin));
      else if (isFiatCode(inCoin)) out.rows.push(row("sell", outCoin, outQty, inQty, inCoin));
      else if (DOLLAR_STABLECOINS.has(outCoin) || DOLLAR_STABLECOINS.has(inCoin)) {
        // At a dollar per stablecoin.
        const dollars = DOLLAR_STABLECOINS.has(outCoin) ? outQty.abs() : inQty;
        out.rows.push(
          { ...row("sell", outCoin, outQty, dollars, "USD"), fee: undefined },
          { ...row("buy", inCoin, inQty, dollars, "USD"), fee: undefined },
        );
      } else {
        // Coin for coin: a sale and a purchase, each valued at that day's close when imported.
        swaps++;
        out.rows.push(
          { date, type: "sell", ...coinAsset(outCoin), quantity: fmt(outQty), currency: "EUR", notes: group[0]!.rawOp },
          { date, type: "buy", ...coinAsset(inCoin), quantity: fmt(inQty), currency: "EUR", notes: group[0]!.rawOp },
        );
        out.mapping = { ...out.mapping, marketTrades: true };
      }
      // A fee in a coin of its own (BNB, or the coin itself) is its own line.
      for (const [coin, f] of fees)
        if (!isFiatCode(coin))
          out.rows.push({ date, type: "fee", ...coinAsset(coin), quantity: fmt(f), notes: "Binance fee" });
    }
    if (swaps)
      out.warnings.push(
        trn(
          swaps,
          "{n} trade between two coins is booked as a sale and a purchase, each at that day's market price (the export has no value in money for it).",
          "{n} trades between two coins are booked as a sale and a purchase, each at that day's market price (the export has no value in money for them).",
        ),
      );
    if (unclear)
      out.warnings.push(
        trn(
          unclear,
          "{n} moment with more than one trade at once was left out: it can't be split for sure.",
          "{n} moments with more than one trade at once were left out: they can't be split for sure.",
        ),
      );
    out.rows.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  },
};
