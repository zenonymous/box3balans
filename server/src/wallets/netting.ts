import { D, type Decimal } from "../lib/decimal.js";
import type { AssetRef, SyncEvent } from "../sync/types.js";
import type { Fee, Movement } from "./types.js";

const refKey = (r: AssetRef) =>
  r.kind === "crypto"
    ? r.contract
      ? `${r.chain}:${r.contract.toLowerCase()}`
      : `native:${r.symbol}`
    : JSON.stringify(r);

const shortKey = (r: AssetRef) =>
  r.kind === "crypto" ? (r.contract ?? r.symbol) : r.kind === "fiat" ? r.currency : r.symbol;

/**
 * Turns per-transaction movements across all of a wallet's addresses into events. Movements of
 * the same asset within one transaction are netted first, so moves between your own addresses
 * cancel out. Then:
 * - fee paid → a `fee` event in the native coin;
 * - one asset out and another in → a swap (trade, quoted in the asset given up);
 * - otherwise each remaining asset → a deposit or withdrawal.
 */
export function movementsToEvents(chain: string, movements: Movement[], fees: Fee[]): SyncEvent[] {
  const byTx = new Map<string, { at: Date; nets: Map<string, { ref: AssetRef; amount: Decimal }>; fee?: Fee }>();
  const entry = (tx: string, at: Date) => {
    let e = byTx.get(tx);
    if (!e) {
      e = { at, nets: new Map() };
      byTx.set(tx, e);
    }
    return e;
  };
  for (const m of movements) {
    const e = entry(m.tx, m.at);
    const k = refKey(m.asset);
    const cur = e.nets.get(k);
    e.nets.set(k, { ref: m.asset, amount: (cur?.amount ?? D(0)).plus(m.amount) });
  }
  for (const f of fees) {
    const e = entry(f.tx, f.at);
    e.fee = e.fee ? { ...e.fee, amount: e.fee.amount.plus(f.amount) } : f;
  }

  const events: SyncEvent[] = [];
  for (const [tx, e] of byTx) {
    const base = `${chain}:${tx}`;
    if (e.fee && e.fee.amount.gt(0)) {
      events.push({
        kind: "fee",
        id: `${base}:fee`,
        at: e.at,
        asset: e.fee.asset,
        quantity: e.fee.amount.toFixed(),
        note: "Network fee",
      });
    }
    const nets = [...e.nets.values()].filter((n) => !n.amount.isZero());
    const ins = nets.filter((n) => n.amount.gt(0));
    const outs = nets.filter((n) => n.amount.lt(0));
    if (ins.length === 1 && outs.length === 1) {
      const got = ins[0]!;
      const gave = outs[0]!;
      events.push({
        kind: "trade",
        id: base,
        at: e.at,
        side: "buy",
        asset: got.ref,
        quantity: got.amount.toFixed(),
        quote: { amount: gave.amount.abs().toFixed(), currency: shortKey(gave.ref) },
        quoteRef: gave.ref,
        note: "On-chain swap",
      });
      continue;
    }
    const multi = nets.length > 1;
    for (const n of nets) {
      events.push({
        kind: n.amount.gt(0) ? "deposit" : "withdrawal",
        id: multi ? `${base}:${shortKey(n.ref)}` : base,
        at: e.at,
        asset: n.ref,
        quantity: n.amount.abs().toFixed(),
        note: multi ? "Contract interaction" : undefined,
      });
    }
  }
  return events;
}
