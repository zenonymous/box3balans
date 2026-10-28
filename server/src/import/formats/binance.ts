import { msg, tr } from "../../i18n/index.js";
import { type Decimal, ZERO } from "../../lib/decimal.js";
import { coinTrade, tradeWarnings } from "./coin-trades.js";
import {
  type BrokerFormat,
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
      const trade = coinTrade(date, net, fees, group[0]!.rawOp, "Binance fee");
      if (!trade) unclear++;
      else {
        out.rows.push(...trade.rows);
        if (trade.swap) swaps++;
      }
    }
    tradeWarnings(out, swaps, unclear);
    out.rows.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  },
};
