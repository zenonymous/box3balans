import { D } from "../lib/decimal.js";
import type { AssetRef } from "../sync/types.js";
import { ChainError, type ChainAdapter, type ChainContext, type Fee, type Movement } from "./types.js";
import { msg, tr } from "../i18n/index.js";

const DROPS = D(1_000_000);
// XRP Ledger timestamps count seconds from 2000-01-01.
const RIPPLE_EPOCH = 946_684_800;

interface XrpTx {
  TransactionType: string;
  Account: string;
  Destination?: string;
  Amount?: string | { currency: string; value: string };
  Fee: string;
  date: number;
  hash: string;
  ledger_index?: number;
}

interface AccountTxResult {
  transactions: {
    tx?: XrpTx;
    tx_json?: XrpTx;
    hash?: string;
    ledger_index?: number;
    meta: { TransactionResult: string; delivered_amount?: string | { currency: string } };
  }[];
  marker?: unknown;
}

export function xrpAdapter(rpcUrl = "https://xrplcluster.com"): ChainAdapter {
  const native: AssetRef = { kind: "crypto", symbol: "XRP", coingeckoId: "ripple", name: "XRP" };

  async function rpc<T>(ctx: ChainContext, method: string, params: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await ctx.fetchFn(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params: [params] }),
        signal: AbortSignal.timeout(30_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await ctx.sleep(2_000 * (attempt + 1));
        continue;
      }
      const data = (await res.json()) as { result: T & { status?: string; error?: string; error_message?: string } };
      if (data.result.status === "error")
        throw new ChainError(`XRP Ledger: ${data.result.error_message ?? data.result.error}`);
      return data.result;
    }
  }

  return {
    id: "xrp",
    label: "XRP Ledger",
    nativeSymbol: "XRP",
    addressHint: msg("r… classic address"),
    supportsXpub: false,

    normalise(input) {
      const s = input.trim();
      if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s))
        throw new ChainError(tr("Not a valid XRP address (starts with r)"));
      return s;
    },

    async fetch(inputs, ctx) {
      const lastLedger = (ctx.cursor?.lastLedger as Record<string, number> | undefined) ?? {};
      const next: Record<string, number> = {};
      const movements: Movement[] = [];
      const fees: Fee[] = [];
      let skippedTokens = 0;
      let balance = D(0);

      for (const { address } of inputs) {
        let max = lastLedger[address] ?? 0;
        let marker: unknown;
        do {
          const r: AccountTxResult = await rpc<AccountTxResult>(ctx, "account_tx", {
            account: address,
            ledger_index_min: lastLedger[address] ? lastLedger[address] + 1 : -1,
            ledger_index_max: -1,
            forward: true,
            limit: 200,
            ...(marker ? { marker } : {}),
          });
          for (const item of r.transactions) {
            const tx = item.tx ?? item.tx_json;
            if (!tx) continue;
            const hash = tx.hash ?? item.hash!;
            const at = new Date((tx.date + RIPPLE_EPOCH) * 1000);
            max = Math.max(max, tx.ledger_index ?? item.ledger_index ?? 0);
            const success = item.meta.TransactionResult === "tesSUCCESS";
            // The sender pays the fee even for failed (tec*) transactions.
            if (tx.Account === address) fees.push({ tx: hash, at, asset: native, amount: D(tx.Fee).div(DROPS) });
            if (tx.TransactionType !== "Payment" || !success) continue;
            const delivered = item.meta.delivered_amount ?? tx.Amount;
            if (typeof delivered !== "string") {
              skippedTokens++;
              continue;
            }
            const amount = D(delivered).div(DROPS);
            if (tx.Account === address) movements.push({ tx: hash, at, asset: native, amount: amount.neg() });
            if (tx.Destination === address) movements.push({ tx: hash, at, asset: native, amount });
          }
          marker = r.marker;
        } while (marker);
        next[address] = max;

        const info = await rpc<{ account_data: { Balance: string } }>(ctx, "account_info", {
          account: address,
          ledger_index: "validated",
        });
        balance = balance.plus(D(info.account_data.Balance).div(DROPS));
      }

      return {
        movements,
        fees,
        balances: [{ asset: native, quantity: balance.toFixed() }],
        cursor: { lastLedger: { ...lastLedger, ...next } },
        warnings: skippedTokens
          ? [`Skipped ${skippedTokens} XRP Ledger token (IOU) payment(s); only XRP itself is tracked.`]
          : [],
      };
    },
  };
}
