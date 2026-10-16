import { msg, tr } from "../../i18n/index.js";
import {
  type BrokerFormat,
  type TemplateRow,
  abs,
  coinAsset,
  column,
  converted,
  hasColumns,
  isFiatCode,
  isNegative,
  num,
  skip,
  utc,
} from "./types.js";

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
          out.rows.push({
            ...at,
            type: "buy",
            ...coinAsset(to),
            quantity: toQuantity,
            total: quantity,
            currency: symbol,
          });
        } else if (isFiatCode(to)) {
          out.rows.push({ ...at, type: "sell", ...coinAsset(symbol), quantity, total: toQuantity, currency: to });
        } else {
          // One coin for another: a sale at the value, and a purchase for the same.
          out.rows.push({ ...at, type: "sell", ...coinAsset(symbol), quantity, total: value, currency });
          out.rows.push({ ...at, type: "buy", ...coinAsset(to), quantity: toQuantity, total: value, currency });
        }
      } else if (isFiatCode(symbol)) skip(out.skipped, tr("Euro deposits and withdrawals"));
      else if (/^(crypto_wallet_swap|dynamic_coin_swap)_(debited|credited)$/.test(kind)) {
        const side = kind.endsWith("debited") ? "debited" : "credited";
        const key = `${date}|${kind.replace(/_(debited|credited)$/, "")}`;
        const pair = halves.get(key) ?? { debited: [], credited: [] };
        pair[side].push({
          ...at,
          type: side === "debited" ? "sell" : "buy",
          ...coinAsset(symbol),
          quantity,
          total: value,
          currency,
        });
        halves.set(key, pair);
      } else if (CDC_REWARDS.has(kind) || /^finance\..*interest|^reward\./.test(kind)) {
        if (isNegative(amount))
          out.rows.push({ ...at, type: "fee", ...coinAsset(symbol), quantity, notes: notes ?? kind });
        else out.rows.push({ ...at, type: "reward", ...coinAsset(symbol), quantity, total: value, currency });
      } else if (kind === "card_cashback_reverted" || kind === "reimbursement_reverted") {
        // A reward taken back.
        out.rows.push({ ...at, type: "fee", ...coinAsset(symbol), quantity, notes: notes ?? kind });
      } else if (kind === "crypto_purchase" || kind === "crypto_payment" || kind === "card_top_up") {
        // Bought by card; or sold to pay, or to top up the card.
        const type = isNegative(amount) ? "sell" : "buy";
        out.rows.push({ ...at, type, ...coinAsset(symbol), quantity, total: value, currency });
      } else if (kind === "dust_conversion_debited" || kind === "dust_conversion_credited") {
        out.rows.push({
          ...at,
          type: kind.endsWith("debited") ? "sell" : "buy",
          ...coinAsset(symbol),
          quantity,
          total: value,
          currency,
        });
      } else if (kind === "crypto_withdrawal" || kind === "crypto_to_exchange_transfer") {
        out.rows.push({ ...at, type: "withdrawal", ...coinAsset(symbol), quantity });
      } else if (kind === "crypto_deposit" || kind === "exchange_to_crypto_transfer") {
        // What it was worth when it came in: the cost basis of a coin from elsewhere.
        out.rows.push({ ...at, type: "deposit", ...coinAsset(symbol), quantity, total: value, currency });
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
