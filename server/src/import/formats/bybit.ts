import { msg, tr, trn } from "../../i18n/index.js";
import { D, type Decimal, ZERO } from "../../lib/decimal.js";
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

/*
 * Bybit's Data Export (Account → Data Export → Transaction Log, "Asset Change Details") gives one CSV
 * per account: the Unified Trading Account (spot trades) and the Funding account (deposits,
 * withdrawals, Convert, Earn). Import both into one Box3balans account: moves between them cancel out
 * and are left out. Each file starts with a line about the account; the header row comes second.
 * Built on the layouts in GiacenzeCrypto and everytrade (both read Bybit EU's exports), not yet
 * tested with a real export.
 */

const MOVES = () => tr("Moves within Bybit (between its accounts, Earn)");

/**
 * The Unified Trading Account's asset changes: per coin a row with Change, the balance change. The
 * two legs of a spot trade share the second and the contract (BTCEUR); the fee comes off the coin
 * received, so what was traded is Change plus Fee Paid. Perpetuals and futures are left out.
 */
export const bybitUta: BrokerFormat = {
  id: "bybit-uta",
  label: msg("Bybit Unified Trading Account (asset changes)"),
  detect: (h) => hasColumns(h, "currency", "contract", "type", "fee paid", "change", "action", "time utc"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      coin: column(h, "currency"),
      contract: column(h, "contract"),
      type: column(h, "type"),
      fee: column(h, "fee paid"),
      change: column(h, "change"),
      action: column(h, "action"),
      at: column(h, "time utc"),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    // Spot trades per second and contract; Bybit's own conversions ("--") per second.
    type Group = {
      date: string;
      own: boolean; // Bybit's own conversion ("--"), not a trade
      notes: string;
      lines: number;
      net: Map<string, Decimal>;
      fees: Map<string, Decimal>;
    };
    const groups = new Map<string, Group>();
    let futures = 0;
    for (const r of table.slice(1)) {
      if (!r.some((x) => x.trim())) continue;
      const date = utc(get(r, c.at));
      const coin = get(r, c.coin).toUpperCase();
      const change = looseNum(get(r, c.change));
      const type = norm(get(r, c.type));
      const action = norm(get(r, c.action));
      if (!date || !coin || !change || !Number(change)) {
        skip(out.skipped, tr("Lines without an amount"));
        continue;
      }
      if (type === "transfer in" || type === "transfer out") skip(out.skipped, MOVES());
      else if ((type === "trade" && action) || type === "settlement" || type === "liquidation" || type === "delivery") {
        futures++;
        skip(out.skipped, tr("Futures and margin (no ownership of the coins)"));
      } else if (type === "trade" || type === "") {
        const contract = get(r, c.contract);
        const key = `${date}|${type}|${contract}`;
        const g = groups.get(key) ?? {
          date,
          own: type === "",
          notes: contract || "Bybit",
          lines: 0,
          net: new Map(),
          fees: new Map(),
        };
        // What was traded is what arrived plus the fee taken from it.
        const fee = D(looseNum(get(r, c.fee)) ?? 0).abs();
        g.net.set(coin, (g.net.get(coin) ?? ZERO).plus(change).plus(fee));
        if (fee.gt(0)) g.fees.set(coin, (g.fees.get(coin) ?? ZERO).minus(fee));
        g.lines++;
        groups.set(key, g);
      } else skip(out.skipped, tr("Other kinds: {kind}", { kind: get(r, c.type) }));
    }
    let swaps = 0;
    let unclear = 0;
    for (const g of groups.values()) {
      // A "--" line without another coin in its second: into or out of Easy Earn, still yours.
      if (g.own && g.net.size === 1) {
        for (let i = 0; i < g.lines; i++) skip(out.skipped, MOVES());
        continue;
      }
      const trade = coinTrade(g.date, g.net, g.fees, g.notes, "Bybit fee");
      if (!trade) unclear++;
      else {
        out.rows.push(...trade.rows);
        if (trade.swap) swaps++;
      }
    }
    tradeWarnings(out, swaps, unclear);
    if (futures)
      out.warnings.push(
        trn(
          futures,
          "{n} line of futures was left out: its profit, loss and fees change the balance of the coin it settles in (often USDT), so check that balance against Bybit.",
          "{n} lines of futures were left out: their profit, loss and fees change the balance of the coin they settle in (often USDT), so check that balance against Bybit.",
        ),
      );
    out.rows.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  },
};

// Moves between Bybit's accounts and into or out of Earn and Launchpad: still yours.
const INTERNAL = /transfer|subscription|redemption|freeze/;
// Income: Earn interest, Launchpool yield, promotions.
const REWARD = /interest|yield|airdrop|bonus|reward|cashback|distribution|commission/;

/**
 * The Funding account's asset changes: a row per balance change with QTY (signed), Type and
 * Description; the Description says what happened. Convert and a card payment from a coin are two
 * rows up to a second apart (coin out, coin or euros in): a trade. Euros in and out are left out.
 */
export const bybitFunding: BrokerFormat = {
  id: "bybit-funding",
  label: msg("Bybit Funding account (asset changes)"),
  detect: (h) => hasColumns(h, "date time utc", "coin", "qty", "type", "account balance", "description"),
  convert(table) {
    const out = converted();
    const h = table[0]!;
    const c = {
      at: column(h, "date time utc"),
      coin: column(h, "coin"),
      qty: column(h, "qty"),
      type: column(h, "type"),
      what: column(h, "description"),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const legs: { date: string; coin: string; qty: string; what: string }[] = [];
    let byCard = 0;
    for (const r of table.slice(1)) {
      if (!r.some((x) => x.trim())) continue;
      const date = utc(get(r, c.at));
      const coin = get(r, c.coin).toUpperCase();
      const qty = looseNum(get(r, c.qty));
      const type = norm(get(r, c.type));
      const what = norm(get(r, c.what));
      const rawWhat = get(r, c.what);
      if (!date || !coin || !qty || !Number(qty)) {
        skip(out.skipped, tr("Lines without an amount"));
        continue;
      }
      const fiat = isFiatCode(coin);
      const card = type === "bybit card" && (what === "coin purchase" || (what === "purchase" && !fiat));
      if (what === "convert" || card) legs.push({ date, coin, qty, what: rawWhat });
      else if (what === "buy crypto with card" && !fiat) {
        // Paid by card: the export has no price, so it's bought at the day's market price.
        byCard++;
        out.rows.push({ date, type: "buy", ...coinAsset(coin), quantity: abs(qty)!, currency: "EUR", notes: rawWhat });
      } else if (/^withdrawal cancel/.test(what) && !fiat)
        out.rows.push({ date, type: "deposit", ...coinAsset(coin), quantity: abs(qty)!, notes: rawWhat });
      else if (type === "transfer in" || type === "transfer out" || INTERNAL.test(what)) skip(out.skipped, MOVES());
      else if (fiat) skip(out.skipped, tr("Euro deposits and withdrawals"));
      else if (what === "deposit") out.rows.push({ date, type: "deposit", ...coinAsset(coin), quantity: abs(qty)! });
      else if (what === "withdrawal")
        out.rows.push({ date, type: "withdrawal", ...coinAsset(coin), quantity: abs(qty)! });
      else if (REWARD.test(what) && !qty.startsWith("-"))
        out.rows.push({ date, type: "reward", ...coinAsset(coin), quantity: qty, notes: rawWhat });
      else skip(out.skipped, tr("Other kinds: {kind}", { kind: rawWhat || "—" }));
    }

    // The two halves of a conversion: one coin out and one in, up to a second apart. Legs closer
    // than that to each other are one moment; with more than two in it, they can't be paired for sure.
    legs.sort((a, b) => a.date.localeCompare(b.date));
    const moments: (typeof legs)[] = [];
    for (const l of legs) {
      const last = moments.at(-1);
      if (last && Date.parse(l.date) - Date.parse(last.at(-1)!.date) <= 1000) last.push(l);
      else moments.push([l]);
    }
    let swaps = 0;
    let unclear = 0;
    for (const m of moments) {
      if (m.length > 2) {
        unclear++;
        continue;
      }
      const net = new Map<string, Decimal>();
      for (const l of m) net.set(l.coin, (net.get(l.coin) ?? ZERO).plus(l.qty));
      const trade = m.length === 2 ? coinTrade(m[0]!.date, net, new Map(), m[0]!.what, "Bybit fee") : null;
      if (!trade) {
        for (let k = 0; k < m.length; k++) skip(out.skipped, tr("Balance conversions without their other half"));
        continue;
      }
      out.rows.push(...trade.rows);
      if (trade.swap) swaps++;
    }
    tradeWarnings(out, swaps, unclear);
    if (byCard) {
      out.mapping = { ...out.mapping, marketTrades: true };
      out.warnings.push(
        trn(
          byCard,
          "{n} purchase by card is booked at that day's market price (the export has no price for it).",
          "{n} purchases by card are booked at that day's market price (the export has no price for them).",
        ),
      );
    }
    out.rows.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  },
};
