import { trn } from "../../i18n/index.js";
import type { Decimal } from "../../lib/decimal.js";
import { type Converted, type TemplateRow, coinAsset, isFiatCode } from "./types.js";

// Stablecoins counted as one dollar each, so trades against them have a value.
const DOLLAR_STABLECOINS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "DAI"]);

/**
 * One trade on a crypto exchange, from what it did to each coin's balance: `net` per coin without
 * fees (one coin in, one out), `fees` per coin (negative, as balance changes). A trade against money
 * is a purchase or sale; one against a dollar stablecoin is valued at a dollar per coin (a sale of the
 * stablecoin and a purchase of the coin); one between two other coins becomes a sale and a purchase
 * at that day's close (`swap`). A fee in money joins the trade; one in a coin is its own line. Null
 * when the balances don't show one coin in and one out.
 */
export function coinTrade(
  date: string,
  net: Map<string, Decimal>,
  fees: Map<string, Decimal>,
  notes: string,
  feeNotes: string,
): { rows: TemplateRow[]; swap: boolean } | null {
  const got = [...net].filter(([, v]) => v.gt(0));
  const gave = [...net].filter(([, v]) => v.lt(0));
  if (got.length !== 1 || gave.length !== 1) return null;
  const [inCoin, inQty] = got[0]!;
  const [outCoin, outQty] = gave[0]!;
  const fmt = (v: Decimal) => v.abs().toFixed();
  const feeIn = (coin: string) => {
    const f = fees.get(coin);
    return f ? fmt(f) : undefined;
  };
  const row = (type: "buy" | "sell", coin: string, qty: Decimal, total: Decimal, currency: string): TemplateRow => ({
    date,
    type,
    ...coinAsset(coin),
    quantity: fmt(qty),
    total: fmt(total),
    currency,
    fee: feeIn(currency),
    notes,
  });
  const rows: TemplateRow[] = [];
  let swap = false;
  if (isFiatCode(outCoin)) rows.push(row("buy", inCoin, inQty, outQty, outCoin));
  else if (isFiatCode(inCoin)) rows.push(row("sell", outCoin, outQty, inQty, inCoin));
  else if (DOLLAR_STABLECOINS.has(outCoin) || DOLLAR_STABLECOINS.has(inCoin)) {
    // At a dollar per stablecoin.
    const dollars = DOLLAR_STABLECOINS.has(outCoin) ? outQty.abs() : inQty;
    rows.push(
      { ...row("sell", outCoin, outQty, dollars, "USD"), fee: undefined },
      { ...row("buy", inCoin, inQty, dollars, "USD"), fee: undefined },
    );
  } else {
    // Coin for coin: a sale and a purchase, each valued at that day's close when imported.
    swap = true;
    rows.push(
      { date, type: "sell", ...coinAsset(outCoin), quantity: fmt(outQty), currency: "EUR", notes },
      { date, type: "buy", ...coinAsset(inCoin), quantity: fmt(inQty), currency: "EUR", notes },
    );
  }
  // A fee in a coin of its own (BNB, or the coin itself) is its own line.
  for (const [coin, f] of fees)
    if (!isFiatCode(coin)) rows.push({ date, type: "fee", ...coinAsset(coin), quantity: fmt(f), notes: feeNotes });
  return { rows, swap };
}

/** Says how many coin-for-coin trades were valued at the day's close, and how many were left out. */
export function tradeWarnings(out: Converted, swaps: number, unclear: number) {
  if (swaps) {
    out.mapping = { ...out.mapping, marketTrades: true };
    out.warnings.push(
      trn(
        swaps,
        "{n} trade between two coins is booked as a sale and a purchase, each at that day's market price (the export has no value in money for it).",
        "{n} trades between two coins are booked as a sale and a purchase, each at that day's market price (the export has no value in money for them).",
      ),
    );
  }
  if (unclear)
    out.warnings.push(
      trn(
        unclear,
        "{n} moment with more than one trade at once was left out: it can't be split for sure.",
        "{n} moments with more than one trade at once were left out: they can't be split for sure.",
      ),
    );
}
