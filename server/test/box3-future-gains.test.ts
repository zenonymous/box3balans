import { describe, expect, it } from "vitest";
import { capitalGains } from "../src/domain/box3Future.js";
import type { LedgerTx, TxType } from "../src/domain/ledger.js";

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

describe("capital gain on financial instruments (preview from 2029)", () => {
  // The worked example in the explanatory memorandum to the novelle (Kamerstuk 37 053, nr. 3):
  // Henk has 1 share worth €1,000 on 1 January 2029 and buys 2 more at €1,600 each, an average of
  // €1,400; €50 dividend in 2029. In 2030 he sells 1 for €1,700 and gets €40 dividend. Taxable:
  // €50 in 2029 (no gain, €50 regular benefits) and €340 in 2030 (€300 gain, €40 regular benefits).
  // What he paid for the first share in 2025 doesn't matter: its value at the start counts.
  it("follows the memorandum's example: the value at the start, then the average price", () => {
    const rows = capitalGains(
      [
        tx("buy", { occurredAt: at("2025-03-10"), quantity: "1", price: "700" }),
        tx("buy", { occurredAt: at("2029-04-01"), quantity: "2", price: "1600" }),
        tx("dividend", { occurredAt: at("2029-06-01"), amount: "50" }),
        tx("sell", { occurredAt: at("2030-05-01"), quantity: "1", price: "1700" }),
        tx("dividend", { occurredAt: at("2030-06-01"), amount: "40" }),
      ],
      { from: 2029, to: 2030, startPrices: new Map([[1, "1000"]]) },
    );
    expect(rows).toEqual([
      {
        year: 2029,
        gainEur: 0,
        regularEur: 50,
        assets: [{ assetId: 1, quantity: 3, acquisitionPriceEur: 1400, gainEur: 0, regularEur: 50 }],
      },
      {
        year: 2030,
        gainEur: 300,
        regularEur: 40,
        assets: [{ assetId: 1, quantity: 2, acquisitionPriceEur: 1400, gainEur: 300, regularEur: 40 }],
      },
    ]);
  });

  // ADR 0013: one average per asset over all the owner's accounts, not per account as the cost
  // basis is. 10 held at the start at €100 in account 1, 10 bought at €200 in account 2: €150 for
  // all 20, so selling 5 from account 1 at €180 gains 5 × (180 − 150) = €150. Worked by hand.
  it("averages the acquisition price over all the owner's accounts", () => {
    const rows = capitalGains(
      [
        tx("buy", { accountId: 1, occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("buy", { accountId: 2, occurredAt: at("2029-03-01"), quantity: "10", price: "200" }),
        tx("sell", { accountId: 1, occurredAt: at("2030-03-01"), quantity: "5", price: "180" }),
      ],
      { from: 2029, to: 2030, startPrices: new Map([[1, "100"]]) },
    );
    expect(rows.map((r) => r.assets)).toEqual([
      [{ assetId: 1, quantity: 20, acquisitionPriceEur: 150, gainEur: 0, regularEur: 0 }],
      [{ assetId: 1, quantity: 15, acquisitionPriceEur: 150, gainEur: 150, regularEur: 0 }],
    ]);
  });

  // A transfer between the owner's own accounts is no sale and no purchase: the units keep the
  // average of €150, whatever price the receiving broker shows for them (€300 here).
  it("leaves the acquisition price alone when units move between the owner's accounts", () => {
    const rows = capitalGains(
      [
        tx("buy", { accountId: 1, occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("buy", { accountId: 1, occurredAt: at("2029-03-01"), quantity: "10", price: "200" }),
        tx("transfer_out", { accountId: 1, occurredAt: at("2029-09-01"), quantity: "5", transferGroup: "g1" }),
        tx("transfer_in", {
          accountId: 2,
          occurredAt: at("2029-09-01"),
          quantity: "5",
          price: "300",
          transferGroup: "g1",
        }),
        tx("sell", { accountId: 2, occurredAt: at("2030-03-01"), quantity: "5", price: "180" }),
      ],
      { from: 2029, to: 2030, startPrices: new Map([[1, "100"]]) },
    );
    expect(rows.map((r) => r.assets)).toEqual([
      [{ assetId: 1, quantity: 20, acquisitionPriceEur: 150, gainEur: 0, regularEur: 0 }],
      [{ assetId: 1, quantity: 15, acquisitionPriceEur: 150, gainEur: 150, regularEur: 0 }],
    ]);
  });

  // Art. 5.22 and 5.23: the costs of buying are part of the acquisition price, the costs of selling
  // come off the proceeds (as for homes). 10 at €100 at the start plus 10 bought for €2,000 + €10:
  // €3,010 for 20 = €150.50 each. Selling 5 at €180 with €5 costs: €895 − 5 × €150.50 = €142.50.
  // Worked by hand.
  it("counts the costs of buying and selling in the gain", () => {
    const rows = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80", feeEur: "3" }),
        tx("buy", { occurredAt: at("2029-03-01"), quantity: "10", price: "200", feeEur: "10" }),
        tx("sell", { occurredAt: at("2029-09-01"), quantity: "5", price: "180", feeEur: "5" }),
      ],
      { from: 2029, to: 2029, startPrices: new Map([[1, "100"]]) },
    );
    expect(rows[0]!.assets).toEqual([
      { assetId: 1, quantity: 15, acquisitionPriceEur: 150.5, gainEur: 142.5, regularEur: 0 },
    ]);
  });

  // A 1:4 split in 2029: the 10 units held at €100 become 40 at €25; selling 8 at €30 gains
  // 8 × (30 − 25) = €40. Worked by hand.
  it("spreads the acquisition price over the new units after a split", () => {
    const rows = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("split", { occurredAt: at("2029-06-01"), quantity: "4" }),
        tx("sell", { occurredAt: at("2029-09-01"), quantity: "8", price: "30" }),
      ],
      { from: 2029, to: 2029, startPrices: new Map([[1, "100"]]) },
    );
    expect(rows[0]!.assets).toEqual([
      { assetId: 1, quantity: 32, acquisitionPriceEur: 25, gainEur: 40, regularEur: 0 },
    ]);
  });
});
