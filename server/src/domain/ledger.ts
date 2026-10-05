import { D, Decimal, ZERO } from "../lib/decimal.js";

export type TxType =
  "buy" | "sell" | "deposit" | "withdrawal" | "transfer_in" | "transfer_out" | "dividend" | "reward" | "fee" | "split";

export type CostMethod = "average" | "fifo";

export interface LedgerTx {
  id: number;
  accountId: number;
  assetId: number;
  type: TxType;
  occurredAt: Date;
  quantity: string;
  price: string;
  // Currency of `price`; used to track cost in the trade currency (FX effect). Defaults to EUR.
  currency?: string;
  fxRate: string;
  feeEur: string;
  amount: string;
  taxWithheld: string;
  transferGroup: string | null;
  // Cash asset in `currency` that pays for buys / receives proceeds and dividends.
  settleAssetId?: number | null;
}

/** A tranche of a holding with its cost; FIFO keeps one per acquisition, average cost one merged lot. */
interface Lot {
  qty: Decimal;
  costEur: Decimal;
  costLocal: Decimal;
}

export interface Position {
  accountId: number;
  assetId: number;
  quantity: Decimal;
  // EUR cost basis of the current quantity under the chosen method.
  costEur: Decimal;
  // Cost basis in the trade currency, when every acquisition used the same one (else null).
  costLocal: Decimal | null;
  localCurrency: string | null;
  realizedEur: Decimal;
  // Dividends (net of withholding tax) and rewards, in EUR.
  incomeEur: Decimal;
  feesEur: Decimal;
  lots: Lot[];
  mixedCurrency: boolean;
}

export interface IncomeEvent {
  txId: number;
  accountId: number;
  assetId: number;
  occurredAt: Date;
  kind: "dividend" | "reward";
  grossEur: Decimal;
  taxEur: Decimal;
  netEur: Decimal;
}

export interface RealizedEvent {
  // "sale": sold for proceeds; "fee": units consumed as a network fee (a loss of their cost).
  kind: "sale" | "fee";
  txId: number;
  accountId: number;
  assetId: number;
  occurredAt: Date;
  quantity: Decimal;
  proceedsEur: Decimal;
  costEur: Decimal;
  gainEur: Decimal;
}

export interface LedgerResult {
  positions: Position[];
  income: IncomeEvent[];
  realized: RealizedEvent[];
  warnings: string[];
}

// Within the same timestamp, outflows of a transfer must be applied before the matching inflow
// so the cost basis is known when it arrives.
const ORDER: Record<TxType, number> = {
  split: 0,
  buy: 1,
  deposit: 1,
  reward: 1,
  transfer_out: 2,
  transfer_in: 3,
  sell: 4,
  withdrawal: 4,
  fee: 4,
  dividend: 5,
};

/**
 * Chronological order, with one exception: the receiving leg of a transfer never goes before its
 * sending leg. Auto-matched transfers may have a deposit timestamped slightly before the
 * withdrawal (clocks differ between exchanges and chains); the cost basis must leave first.
 */
export function sortTransactions<T extends LedgerTx>(txs: T[]): T[] {
  const outTime = new Map<string, number>();
  for (const t of txs)
    if (t.type === "transfer_out" && t.transferGroup) outTime.set(t.transferGroup, t.occurredAt.getTime());
  const time = (t: T) => {
    const own = t.occurredAt.getTime();
    const out = t.type === "transfer_in" && t.transferGroup ? outTime.get(t.transferGroup) : undefined;
    return out !== undefined && out > own ? out : own;
  };
  return [...txs].sort((a, b) => time(a) - time(b) || ORDER[a.type] - ORDER[b.type] || a.id - b.id);
}

/**
 * Replays transactions into per-(account, asset) positions. Feed transactions in order (see
 * sortTransactions) through `apply`; state can be inspected between calls, e.g. per day.
 *
 * - buy: adds quantity; cost += qty × price × fx + fee.
 * - sell: removes quantity at cost (average or FIFO); realized = qty × price × fx − fee − cost removed.
 * - deposit: external inflow; cost basis is qty × price × fx (price may be 0 if unknown).
 * - withdrawal: external outflow; removes quantity at cost without realizing a gain.
 * - transfer_out / transfer_in: moves quantity and its cost basis between accounts. Legs are
 *   linked by transferGroup; an unlinked transfer_in is treated like a deposit.
 * - reward: staking/interest; quantity arrives with cost = market value, counted as income.
 * - dividend: cash income (amount × fx − withholding); position quantity unchanged.
 * - fee: quantity of the asset consumed as a fee (e.g. gas); its cost is a realized loss.
 * - split: quantity × ratio, cost unchanged.
 *
 * When `settleAssetId` is set, the cash side is booked too, in the transaction currency:
 * buy −(qty × price + fee), sell +(qty × price − fee), dividend +(gross − tax − fee).
 * Cash may go negative (e.g. when deposits are missing); balance reconciliation surfaces that.
 */
export class Ledger {
  readonly positions = new Map<string, Position>();
  readonly income: IncomeEvent[] = [];
  readonly realized: RealizedEvent[] = [];
  readonly warnings: string[] = [];
  private transferCost = new Map<string, { costEur: Decimal; costLocal: Decimal; currency: string | null }>();

  constructor(readonly method: CostMethod = "average") {}

  position(accountId: number, assetId: number): Position {
    const key = `${accountId}:${assetId}`;
    let p = this.positions.get(key);
    if (!p) {
      p = {
        accountId,
        assetId,
        quantity: ZERO,
        costEur: ZERO,
        costLocal: ZERO,
        localCurrency: null,
        realizedEur: ZERO,
        incomeEur: ZERO,
        feesEur: ZERO,
        lots: [],
        mixedCurrency: false,
      };
      this.positions.set(key, p);
    }
    return p;
  }

  private acquire(p: Position, qty: Decimal, costEur: Decimal, costLocal: Decimal, currency: string | null) {
    p.quantity = p.quantity.plus(qty);
    if (currency) {
      if (p.localCurrency === null && !p.mixedCurrency) p.localCurrency = currency;
      else if (p.localCurrency !== currency) p.mixedCurrency = true;
    }
    if (this.method === "average" && p.lots.length > 0) {
      const l = p.lots[0]!;
      l.qty = l.qty.plus(qty);
      l.costEur = l.costEur.plus(costEur);
      l.costLocal = l.costLocal.plus(costLocal);
    } else {
      p.lots.push({ qty, costEur, costLocal });
    }
    this.sync(p);
  }

  /** Removes `q` units from the front lots; returns the cost removed (EUR and trade currency). */
  private take(p: Position, q: Decimal, tx: LedgerTx): { costEur: Decimal; costLocal: Decimal } {
    if (q.gt(p.quantity)) {
      this.warnings.push(
        `Transaction ${tx.id}: ${tx.type} of ${q.toFixed()} exceeds holding of ${p.quantity.toFixed()} (asset ${tx.assetId}, account ${tx.accountId})`,
      );
    }
    let left = q;
    let costEur = ZERO;
    let costLocal = ZERO;
    while (left.gt(0) && p.lots.length > 0) {
      const l = p.lots[0]!;
      if (l.qty.lte(left)) {
        costEur = costEur.plus(l.costEur);
        costLocal = costLocal.plus(l.costLocal);
        left = left.minus(l.qty);
        p.lots.shift();
      } else {
        const f = left.div(l.qty);
        const ce = l.costEur.mul(f);
        const cl = l.costLocal.mul(f);
        l.qty = l.qty.minus(left);
        l.costEur = l.costEur.minus(ce);
        l.costLocal = l.costLocal.minus(cl);
        costEur = costEur.plus(ce);
        costLocal = costLocal.plus(cl);
        left = ZERO;
      }
    }
    p.quantity = p.quantity.minus(q);
    if (p.quantity.lte(0)) {
      p.lots = [];
      p.localCurrency = null;
      p.mixedCurrency = false;
    }
    this.sync(p);
    return { costEur, costLocal };
  }

  private sync(p: Position) {
    let ce = ZERO;
    let cl = ZERO;
    for (const l of p.lots) {
      ce = ce.plus(l.costEur);
      cl = cl.plus(l.costLocal);
    }
    p.costEur = ce;
    p.costLocal = p.mixedCurrency ? null : cl;
  }

  apply(tx: LedgerTx) {
    const p = this.position(tx.accountId, tx.assetId);
    const q = D(tx.quantity);
    const fx = D(tx.fxRate);
    const fee = D(tx.feeEur);
    const cur = (tx.currency ?? "EUR").toUpperCase();
    const local = q.mul(D(tx.price));
    const valueEur = local.mul(fx);
    const feeLocal = fx.isZero() ? ZERO : fee.div(fx);
    p.feesEur = p.feesEur.plus(fee);

    switch (tx.type) {
      case "buy":
      case "deposit":
        this.acquire(p, q, valueEur.plus(fee), local.plus(feeLocal), cur);
        break;
      case "sell": {
        const { costEur } = this.take(p, q, tx);
        const proceeds = valueEur.minus(fee);
        const gain = proceeds.minus(costEur);
        p.realizedEur = p.realizedEur.plus(gain);
        this.realized.push({
          kind: "sale",
          txId: tx.id,
          accountId: tx.accountId,
          assetId: tx.assetId,
          occurredAt: tx.occurredAt,
          quantity: q,
          proceedsEur: proceeds,
          costEur,
          gainEur: gain,
        });
        break;
      }
      case "withdrawal":
        // Leaves the portfolio (e.g. sent to someone else): no gain or loss.
        this.take(p, q, tx);
        break;
      case "fee": {
        // Units consumed as a network fee (gas) are gone: their cost is a realized loss.
        const { costEur } = this.take(p, q, tx);
        p.realizedEur = p.realizedEur.minus(costEur);
        p.feesEur = p.feesEur.plus(costEur);
        this.realized.push({
          kind: "fee",
          txId: tx.id,
          accountId: tx.accountId,
          assetId: tx.assetId,
          occurredAt: tx.occurredAt,
          quantity: q,
          proceedsEur: ZERO,
          costEur,
          gainEur: costEur.neg(),
        });
        break;
      }
      case "transfer_out": {
        const removed = this.take(p, q, tx);
        // Fee on a transfer stays with the sending position as part of its cost removed.
        if (tx.transferGroup) {
          this.transferCost.set(tx.transferGroup, {
            costEur: removed.costEur.plus(fee),
            costLocal: removed.costLocal.plus(feeLocal),
            currency: p.mixedCurrency ? null : (p.localCurrency ?? cur),
          });
        }
        break;
      }
      case "transfer_in": {
        const carried = tx.transferGroup ? this.transferCost.get(tx.transferGroup) : undefined;
        if (carried) this.acquire(p, q, carried.costEur, carried.costLocal, carried.currency);
        else this.acquire(p, q, valueEur.plus(fee), local.plus(feeLocal), cur);
        break;
      }
      case "reward": {
        this.acquire(p, q, valueEur, local, cur);
        p.incomeEur = p.incomeEur.plus(valueEur);
        this.income.push({
          txId: tx.id,
          accountId: tx.accountId,
          assetId: tx.assetId,
          occurredAt: tx.occurredAt,
          kind: "reward",
          grossEur: valueEur,
          taxEur: ZERO,
          netEur: valueEur,
        });
        break;
      }
      case "dividend": {
        const gross = D(tx.amount).mul(fx);
        const tax = D(tx.taxWithheld).mul(fx);
        const net = gross.minus(tax).minus(fee);
        p.incomeEur = p.incomeEur.plus(net);
        this.income.push({
          txId: tx.id,
          accountId: tx.accountId,
          assetId: tx.assetId,
          occurredAt: tx.occurredAt,
          kind: "dividend",
          grossEur: gross,
          taxEur: tax,
          netEur: net,
        });
        break;
      }
      case "split":
        if (q.lte(0)) {
          this.warnings.push(`Transaction ${tx.id}: split ratio must be positive`);
          break;
        }
        p.quantity = p.quantity.mul(q);
        for (const l of p.lots) l.qty = l.qty.mul(q);
        break;
    }

    if (tx.settleAssetId) this.settle(tx, cur);
  }

  private settle(tx: LedgerTx, currency: string) {
    const delta = cashDelta(tx);
    if (!delta || delta.isZero()) return;
    const cash = this.position(tx.accountId, tx.settleAssetId!);
    const fx = D(tx.fxRate);
    if (delta.gt(0)) {
      this.acquire(cash, delta, delta.mul(fx), delta, currency);
    } else {
      // Cash may be overdrawn; that's surfaced by reconciliation, not as a ledger warning.
      const out = delta.neg();
      const before = this.warnings.length;
      this.take(cash, out, tx);
      this.warnings.length = before;
    }
  }

  result(): LedgerResult {
    return {
      positions: [...this.positions.values()],
      income: this.income,
      realized: this.realized,
      warnings: this.warnings,
    };
  }
}

/** Replays all transactions (in order) and returns the final state. */
export function replayLedger(txs: LedgerTx[], method: CostMethod = "average"): LedgerResult {
  const ledger = new Ledger(method);
  for (const tx of sortTransactions(txs)) ledger.apply(tx);
  return ledger.result();
}

/** Change of the settling cash balance, in units of the transaction currency. */
export function cashDelta(tx: LedgerTx): Decimal | null {
  const fx = D(tx.fxRate);
  const feeCur = fx.isZero() ? ZERO : D(tx.feeEur).div(fx);
  const gross = D(tx.quantity).mul(D(tx.price));
  switch (tx.type) {
    case "buy":
      return gross.plus(feeCur).neg();
    case "sell":
      return gross.minus(feeCur);
    case "dividend":
      return D(tx.amount).minus(D(tx.taxWithheld)).minus(feeCur);
    default:
      return null;
  }
}
