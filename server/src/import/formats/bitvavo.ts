import { msg, tr } from "../../i18n/index.js";
import { type BrokerFormat, abs, coinAsset, column, converted, hasColumns, isNegative, num, skip } from "./types.js";

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
            ...coinAsset(feeCurrency),
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
          ...coinAsset(symbol),
          quantity: abs(amount)!,
          price: num(get(r, "price"), ".") ?? undefined,
          currency: quote,
          fee: fee && feeCurrency === quote ? fee : undefined,
          id,
        });
        coinFee(tr("Trading fee"));
      } else if (type === "deposit") {
        out.rows.push({ ...when, type, ...coinAsset(symbol), quantity: abs(amount)!, id });
      } else if (type === "withdrawal") {
        // The amount includes the network fee: what arrives elsewhere is the amount minus the fee.
        const inCoin = fee && feeCurrency === symbol.toUpperCase() ? Number(fee) : 0;
        const sent = Number(abs(amount)) - inCoin;
        out.rows.push({ ...when, type, ...coinAsset(symbol), quantity: String(Number(sent.toFixed(12))), id });
        coinFee(tr("Network fee"));
      } else if (/staking|reward|rebate|airdrop|affiliate|bonus/.test(type) && !isNegative(amount)) {
        out.rows.push({ ...when, type: "reward", ...coinAsset(symbol), quantity: amount, notes: type, id });
      } else skip(out.skipped, tr("Staking moves and other lines"));
    }
    return out;
  },
};
