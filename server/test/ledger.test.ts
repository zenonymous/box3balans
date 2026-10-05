import { describe, expect, it } from "vitest";
import { Ledger, replayLedger, sortTransactions, type LedgerTx, type TxType } from "../src/domain/ledger.js";

let nextId = 1;
const tx = (type: TxType, fields: Partial<LedgerTx> = {}): LedgerTx => ({
  id: nextId++,
  accountId: 1,
  assetId: 1,
  type,
  occurredAt: new Date("2024-01-01T00:00:00Z"),
  quantity: "0",
  price: "0",
  fxRate: "1",
  feeEur: "0",
  amount: "0",
  taxWithheld: "0",
  transferGroup: null,
  ...fields,
});

const at = (d: string) => new Date(`${d}T12:00:00Z`);

describe("replayLedger", () => {
  it("averages cost across buys and includes fees", () => {
    const { positions } = replayLedger([
      tx("buy", { occurredAt: at("2024-01-01"), quantity: "10", price: "100", feeEur: "2" }),
      tx("buy", { occurredAt: at("2024-02-01"), quantity: "10", price: "120", feeEur: "2" }),
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.quantity.toFixed()).toBe("20");
    expect(positions[0]!.costEur.toFixed()).toBe("2204");
    expect(positions[0]!.feesEur.toFixed()).toBe("4");
  });

  it("realizes gains at average cost on sell, net of fees", () => {
    const { positions, realized } = replayLedger([
      tx("buy", { occurredAt: at("2024-01-01"), quantity: "10", price: "100" }),
      tx("buy", { occurredAt: at("2024-02-01"), quantity: "10", price: "200" }),
      tx("sell", { occurredAt: at("2024-03-01"), quantity: "5", price: "300", feeEur: "5" }),
    ]);
    // avg cost 150; proceeds 1500 - 5 = 1495; cost removed 750
    expect(realized[0]!.gainEur.toFixed()).toBe("745");
    expect(positions[0]!.quantity.toFixed()).toBe("15");
    expect(positions[0]!.costEur.toFixed()).toBe("2250");
    expect(positions[0]!.realizedEur.toFixed()).toBe("745");
  });

  it("converts foreign currency trades with the transaction FX rate", () => {
    const { positions, realized } = replayLedger([
      tx("buy", { occurredAt: at("2024-01-01"), quantity: "10", price: "100", fxRate: "0.9" }),
      tx("sell", { occurredAt: at("2024-06-01"), quantity: "10", price: "100", fxRate: "0.95" }),
    ]);
    // Same USD price, but the dollar strengthened: currency gain of 50 EUR.
    expect(realized[0]!.gainEur.toFixed()).toBe("50");
    expect(positions[0]!.quantity.isZero()).toBe(true);
    expect(positions[0]!.costEur.isZero()).toBe(true);
  });

  it("carries cost basis across a linked transfer", () => {
    const { positions } = replayLedger([
      tx("buy", { accountId: 1, occurredAt: at("2024-01-01"), quantity: "2", price: "30000" }),
      tx("transfer_in", { accountId: 2, occurredAt: at("2024-02-01"), quantity: "1", transferGroup: "g1" }),
      tx("transfer_out", { accountId: 1, occurredAt: at("2024-02-01"), quantity: "1", transferGroup: "g1" }),
    ]);
    const a1 = positions.find((p) => p.accountId === 1)!;
    const a2 = positions.find((p) => p.accountId === 2)!;
    expect(a1.quantity.toFixed()).toBe("1");
    expect(a1.costEur.toFixed()).toBe("30000");
    expect(a2.quantity.toFixed()).toBe("1");
    expect(a2.costEur.toFixed()).toBe("30000");
  });

  it("records dividends net of withholding tax as income", () => {
    const { positions, income } = replayLedger([
      tx("buy", { occurredAt: at("2024-01-01"), quantity: "10", price: "50" }),
      tx("dividend", { occurredAt: at("2024-04-01"), amount: "20", taxWithheld: "3", fxRate: "0.9" }),
    ]);
    expect(income[0]!.grossEur.toFixed()).toBe("18");
    expect(income[0]!.taxEur.toFixed()).toBe("2.7");
    expect(income[0]!.netEur.toFixed()).toBe("15.3");
    expect(positions[0]!.quantity.toFixed()).toBe("10");
    expect(positions[0]!.incomeEur.toFixed()).toBe("15.3");
  });

  it("books staking rewards at market value as both income and cost", () => {
    const { positions, income } = replayLedger([
      tx("reward", { occurredAt: at("2024-01-01"), quantity: "0.5", price: "100" }),
    ]);
    expect(income[0]!.netEur.toFixed()).toBe("50");
    expect(positions[0]!.costEur.toFixed()).toBe("50");
  });

  it("applies splits without changing cost", () => {
    const { positions } = replayLedger([
      tx("buy", { occurredAt: at("2024-01-01"), quantity: "5", price: "400" }),
      tx("split", { occurredAt: at("2024-06-10"), quantity: "10" }),
    ]);
    expect(positions[0]!.quantity.toFixed()).toBe("50");
    expect(positions[0]!.costEur.toFixed()).toBe("2000");
  });

  it("removes withdrawals at cost without a gain or loss", () => {
    const { positions, realized } = replayLedger([
      tx("buy", { occurredAt: at("2024-01-01"), quantity: "4", price: "100" }),
      tx("withdrawal", { occurredAt: at("2024-01-03"), quantity: "1" }),
    ]);
    expect(realized).toHaveLength(0);
    expect(positions[0]!.quantity.toFixed()).toBe("3");
    expect(positions[0]!.costEur.toFixed()).toBe("300");
  });

  // Review fix: gas paid in the asset used to vanish from P&L (cost removed, no loss recorded).
  it("books a fee paid in the asset (gas) as a realized loss of its cost", () => {
    const { positions, realized } = replayLedger([
      tx("buy", { occurredAt: at("2024-01-01"), quantity: "1", price: "2000" }),
      tx("fee", { occurredAt: at("2024-01-02"), quantity: "0.01" }),
    ]);
    const p = positions[0]!;
    expect(p.realizedEur.toFixed()).toBe("-20");
    expect(p.feesEur.toFixed()).toBe("20");
    expect(realized).toEqual([expect.objectContaining({ kind: "fee", gainEur: expect.anything() })]);
    expect(realized[0]!.gainEur.toFixed()).toBe("-20");
    // Total result at an unchanged price: value 1980 − cost 1980 + realized −20 = −20.
    expect(p.quantity.mul(2000).minus(p.costEur).plus(p.realizedEur).toFixed()).toBe("-20");
  });

  // Review fix: a matched deposit timestamped before its withdrawal used to start at market value.
  it("applies the sending leg of a transfer first even if the receiving leg is timestamped earlier", () => {
    const { positions } = replayLedger([
      tx("buy", { accountId: 1, occurredAt: at("2024-01-01"), quantity: "1", price: "10000" }),
      tx("transfer_in", {
        accountId: 2,
        occurredAt: new Date("2024-06-01T11:00:00Z"),
        quantity: "1",
        price: "60000",
        transferGroup: "g",
      }),
      tx("transfer_out", {
        accountId: 1,
        occurredAt: new Date("2024-06-01T12:00:00Z"),
        quantity: "1",
        transferGroup: "g",
      }),
    ]);
    expect(positions.find((p) => p.accountId === 2)!.costEur.toFixed()).toBe("10000");
    expect(positions.find((p) => p.accountId === 1)!.quantity.isZero()).toBe(true);
  });

  it("warns when selling more than held", () => {
    const { warnings } = replayLedger([tx("sell", { quantity: "1", price: "10" })]);
    expect(warnings[0]).toMatch(/exceeds holding/);
  });
});

describe("cash settlement", () => {
  it("books buys, sells and dividends against the settling cash balance", () => {
    const cash = 99;
    const { positions } = replayLedger([
      tx("deposit", { assetId: cash, occurredAt: at("2024-01-01"), quantity: "1000", price: "1" }),
      tx("buy", { occurredAt: at("2024-01-02"), quantity: "2", price: "300", feeEur: "2", settleAssetId: cash }),
      tx("sell", { occurredAt: at("2024-01-03"), quantity: "1", price: "350", feeEur: "1", settleAssetId: cash }),
      tx("dividend", { occurredAt: at("2024-01-04"), amount: "10", taxWithheld: "1.5", settleAssetId: cash }),
    ]);
    const c = positions.find((p) => p.assetId === cash)!;
    // 1000 − 602 + 349 + 8.5
    expect(c.quantity.toFixed()).toBe("755.5");
  });

  it("converts the EUR fee into the trade currency", () => {
    const usd = 98;
    const { positions } = replayLedger([
      tx("buy", { quantity: "1", price: "100", fxRate: "0.8", feeEur: "4", settleAssetId: usd }),
    ]);
    // 100 USD + €4 / 0.8 = 105 USD spent
    expect(positions.find((p) => p.assetId === usd)!.quantity.toFixed()).toBe("-105");
  });
});

describe("cost basis methods", () => {
  const trades = () => [
    tx("buy", { occurredAt: at("2024-01-01"), quantity: "10", price: "100" }),
    tx("buy", { occurredAt: at("2024-02-01"), quantity: "10", price: "200" }),
    tx("sell", { occurredAt: at("2024-03-01"), quantity: "15", price: "300" }),
  ];

  it("average cost: every unit costs the running average", () => {
    const { realized, positions } = replayLedger(trades(), "average");
    expect(realized[0]!.costEur.toFixed()).toBe("2250"); // 15 × 150
    expect(positions[0]!.costEur.toFixed()).toBe("750");
  });

  it("FIFO: the oldest units are sold first", () => {
    const { realized, positions } = replayLedger(trades(), "fifo");
    expect(realized[0]!.costEur.toFixed()).toBe("2000"); // 10 × 100 + 5 × 200
    expect(realized[0]!.gainEur.toFixed()).toBe("2500");
    expect(positions[0]!.costEur.toFixed()).toBe("1000"); // 5 × 200 left
  });

  it("FIFO lots survive splits and transfers", () => {
    const { positions, realized } = replayLedger(
      [
        tx("buy", { accountId: 1, occurredAt: at("2024-01-01"), quantity: "1", price: "1000" }),
        tx("buy", { accountId: 1, occurredAt: at("2024-01-02"), quantity: "1", price: "3000" }),
        tx("split", { accountId: 1, occurredAt: at("2024-02-01"), quantity: "10" }),
        tx("transfer_out", { accountId: 1, occurredAt: at("2024-03-01"), quantity: "10", transferGroup: "g" }),
        tx("transfer_in", { accountId: 2, occurredAt: at("2024-03-01"), quantity: "10", transferGroup: "g" }),
        tx("sell", { accountId: 1, occurredAt: at("2024-04-01"), quantity: "5", price: "500" }),
      ],
      "fifo",
    );
    // The first (cheaper) lot moved to account 2; account 1 sells from the €3000 lot.
    expect(positions.find((p) => p.accountId === 2)!.costEur.toFixed()).toBe("1000");
    expect(realized[0]!.costEur.toFixed()).toBe("1500");
  });
});

describe("trade-currency cost", () => {
  it("tracks cost in the trade currency next to EUR", () => {
    const { positions } = replayLedger([
      tx("buy", { quantity: "10", price: "100", currency: "USD", fxRate: "0.9", feeEur: "1.8" }),
      tx("buy", { occurredAt: at("2024-02-01"), quantity: "10", price: "110", currency: "USD", fxRate: "0.95" }),
    ]);
    const p = positions[0]!;
    expect(p.localCurrency).toBe("USD");
    expect(p.costLocal!.toFixed()).toBe("2102"); // 1000 + 2 (fee) + 1100
    expect(p.costEur.toFixed()).toBe("1946.8"); // 900 + 1.8 + 1045
  });

  it("gives up on trade-currency cost when currencies are mixed", () => {
    const { positions } = replayLedger([
      tx("buy", { quantity: "1", price: "100", currency: "USD", fxRate: "0.9" }),
      tx("buy", { occurredAt: at("2024-02-01"), quantity: "1", price: "90" }),
    ]);
    expect(positions[0]!.costLocal).toBeNull();
  });
});

describe("Ledger stepping", () => {
  it("settles cash in order, so a balance is right at every point in time", () => {
    const ledger = new Ledger();
    const cash = 99;
    const steps = sortTransactions([
      tx("deposit", { assetId: cash, occurredAt: at("2024-01-01"), quantity: "1000", price: "1" }),
      tx("buy", { occurredAt: at("2024-01-02"), quantity: "2", price: "300", settleAssetId: cash }),
      tx("sell", { occurredAt: at("2024-01-03"), quantity: "1", price: "400", settleAssetId: cash }),
    ]);
    const seen: string[] = [];
    for (const s of steps) {
      ledger.apply(s);
      seen.push(ledger.position(1, cash).quantity.toFixed());
    }
    expect(seen).toEqual(["1000", "400", "800"]);
  });
});
