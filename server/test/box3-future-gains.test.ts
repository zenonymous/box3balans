import { describe, expect, it } from "vitest";
import type { accountKind, assetClass } from "../src/db/schema.js";
import { capitalGains, isFinancialInstrument, ownerShare } from "../src/domain/futureGains.js";
import { ledgerTx as tx, noon as at } from "./helpers.js";

const START = { start: 2029, to: 2030 };
const at100 = new Map([[1, "100"]]);
/** One asset's rows per year, or all of a year's. */
const asset = (assetId: number, quantity: number, acquisitionEur: number, gainEur = 0, regularBenefitsEur = 0) => ({
  assetId,
  quantity,
  acquisitionEur,
  gainEur,
  regularBenefitsEur,
});

describe("capital gain on financial instruments (preview from 2029)", () => {
  // The worked example in the explanatory memorandum to the novelle (Kamerstuk 37 053, nr. 3):
  // Henk has 1 share worth €1,000 on 1 January 2029 and buys 2 more at €1,600 each: €4,200 for 3,
  // an average of €1,400; €50 dividend in 2029. In 2030 he sells 1 for €1,700 and gets €40
  // dividend. Taxable: €50 in 2029 (no gain, €50 regular benefits) and €340 in 2030 (€300 gain,
  // €40 regular benefits). What he paid for the first share in 2025 doesn't matter.
  it("follows the memorandum's example: the value at the start, then the average price", () => {
    const result = capitalGains(
      [
        tx("buy", { occurredAt: at("2025-03-10"), quantity: "1", price: "700" }),
        tx("buy", { occurredAt: at("2029-04-01"), quantity: "2", price: "1600" }),
        tx("dividend", { occurredAt: at("2029-06-01"), amount: "50" }),
        tx("sell", { occurredAt: at("2030-05-01"), quantity: "1", price: "1700" }),
        tx("dividend", { occurredAt: at("2030-06-01"), amount: "40" }),
      ],
      { ...START, startPrices: new Map([[1, "1000"]]) },
    );
    expect(result).toEqual({
      years: [
        { year: 2029, gainEur: 0, regularBenefitsEur: 50, assets: [asset(1, 3, 4200, 0, 50)] },
        { year: 2030, gainEur: 300, regularBenefitsEur: 40, assets: [asset(1, 2, 2800, 300, 40)] },
      ],
      missingStartValue: [],
      warnings: [],
    });
  });

  // ADR 0013: one average per asset over all the owner's accounts, not per account as the cost
  // basis is. 10 held at the start at €100 in account 1, 10 bought at €200 in account 2: €3,000
  // for all 20, €150 each, so selling 5 from account 1 at €180 gains 5 × (180 − 150) = €150 and
  // leaves 15 at €2,250. Worked by hand.
  it("averages the acquisition price over all the owner's accounts", () => {
    const { years } = capitalGains(
      [
        tx("buy", { accountId: 1, occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("buy", { accountId: 2, occurredAt: at("2029-03-01"), quantity: "10", price: "200" }),
        tx("sell", { accountId: 1, occurredAt: at("2030-03-01"), quantity: "5", price: "180" }),
      ],
      { ...START, startPrices: at100 },
    );
    expect(years.map((r) => r.assets)).toEqual([[asset(1, 20, 3000)], [asset(1, 15, 2250, 150)]]);
  });

  // A transfer between the owner's own accounts is no sale and no purchase: the units keep the
  // average of €150, whatever price the receiving broker shows for them (€300 here).
  it("leaves the acquisition price alone when units move between the owner's accounts", () => {
    const { years, warnings } = capitalGains(
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
      { ...START, startPrices: at100 },
    );
    expect(years.map((r) => r.assets)).toEqual([[asset(1, 20, 3000)], [asset(1, 15, 2250, 150)]]);
    expect(warnings).toEqual([]);
  });

  // Art. 5.22 and 5.23: the costs of buying are part of the acquisition price, the costs of selling
  // come off the proceeds (as for homes). 10 at €100 at the start plus 10 bought for €2,000 + €10:
  // €3,010 for 20. Selling 5 at €180 with €5 costs: €895 − a quarter of €3,010 (€752.50) = €142.50,
  // leaving €2,257.50. The €3 paid in 2027 was before the start: the value then replaces all of it.
  it("counts the costs of buying and selling in the gain, but no costs from before the start", () => {
    const { years } = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80", feeEur: "3" }),
        tx("buy", { occurredAt: at("2029-03-01"), quantity: "10", price: "200", feeEur: "10" }),
        tx("sell", { occurredAt: at("2029-09-01"), quantity: "5", price: "180", feeEur: "5" }),
      ],
      { start: 2029, to: 2029, startPrices: at100 },
    );
    expect(years[0]!.assets).toEqual([asset(1, 15, 2257.5, 142.5)]);
  });

  // A 1:4 split in 2029: the 10 units held at €1,000 become 40; selling 8 (a fifth) at €30 gains
  // 240 − 200 = €40 and leaves 32 at €800. A split before the start only changes how many there are:
  // 10 bought in 2027, split 1:2 in 2028, so 20 at the start at €100 each.
  it("spreads the acquisition price over the new units after a split", () => {
    const { years } = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("split", { occurredAt: at("2029-06-01"), quantity: "4" }),
        tx("sell", { occurredAt: at("2029-09-01"), quantity: "8", price: "30" }),
        tx("buy", { assetId: 2, occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("split", { assetId: 2, occurredAt: at("2028-06-01"), quantity: "2" }),
      ],
      { start: 2029, to: 2029, startPrices: new Map([...at100, [2, "100"]]) },
    );
    expect(years[0]!.assets).toEqual([asset(1, 32, 800, 40), asset(2, 20, 2000)]);
  });

  // A unit price below a cent: 100,000 units at €0.004 are €400 together. A per-unit price in
  // cents would say €0.00; the total doesn't lose it. Selling half at €0.006: 300 − 200 = €100.
  it("keeps the acquisition price of very cheap units", () => {
    const { years } = capitalGains(
      [
        tx("buy", { occurredAt: at("2029-02-01"), quantity: "100000", price: "0.004" }),
        tx("sell", { occurredAt: at("2030-02-01"), quantity: "50000", price: "0.006" }),
      ],
      { ...START, startPrices: new Map() },
    );
    expect(years.map((r) => r.assets)).toEqual([[asset(1, 100000, 400)], [asset(1, 50000, 200, 100)]]);
  });
});

describe("regular benefits in the preview", () => {
  // A dividend of $100 with $15 withheld in the US, at €0.80 per dollar: €80 counts, not the €68
  // received. The tax withheld is settled elsewhere in the return, not here.
  it("counts a foreign dividend gross, in euros", () => {
    const { years } = capitalGains(
      [
        tx("buy", { occurredAt: at("2029-02-01"), quantity: "10", price: "100" }),
        tx("dividend", {
          occurredAt: at("2029-06-01"),
          amount: "100",
          taxWithheld: "15",
          currency: "USD",
          fxRate: "0.8",
        }),
      ],
      { start: 2029, to: 2029, startPrices: new Map() },
    );
    expect(years[0]).toMatchObject({ gainEur: 0, regularBenefitsEur: 80, assets: [asset(1, 10, 1000, 0, 80)] });
  });

  // Interest on a bond fund arrives as a reward, here €25 in money (no units). A reward in units,
  // 2 worth €50 each, is €100 of regular benefits, and those 2 come in at that €100: with the 10
  // bought at €100, 12 units for €1,100. Selling 6 at €110: 660 − 550 = €110.
  it("counts interest and other rewards, and takes reward units in at their value", () => {
    const { years } = capitalGains(
      [
        tx("buy", { occurredAt: at("2029-02-01"), quantity: "10", price: "100" }),
        tx("reward", { occurredAt: at("2029-05-01"), quantity: "25", price: "1", assetId: 2 }),
        tx("reward", { occurredAt: at("2029-06-01"), quantity: "2", price: "50" }),
        tx("sell", { occurredAt: at("2030-03-01"), quantity: "6", price: "110" }),
      ],
      { ...START, startPrices: new Map() },
    );
    expect(years[0]).toMatchObject({ gainEur: 0, regularBenefitsEur: 125 });
    expect(years[0]!.assets).toEqual([asset(1, 12, 1100, 0, 100), asset(2, 25, 25, 0, 25)]);
    expect(years[1]!.assets[0]).toEqual(asset(1, 6, 550, 110));
  });

  // Income from before the start belongs to the old system.
  it("leaves out a dividend from before the start", () => {
    const { years } = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("dividend", { occurredAt: at("2028-06-01"), amount: "30" }),
      ],
      { start: 2029, to: 2029, startPrices: at100 },
    );
    expect(years[0]).toMatchObject({ regularBenefitsEur: 0, assets: [asset(1, 10, 1000)] });
  });
});

describe("the edges of the preview's capital gain", () => {
  // 00:30 on 1 January 2029 in the Netherlands is still 31 December in UTC: it belongs to 2029, so
  // the sale is taxed (10 held at €100, 4 sold at €120: €80) and isn't part of the start.
  it("puts a trade just after midnight on 1 January, Dutch time, in the new year", () => {
    const { years } = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("sell", { occurredAt: new Date("2028-12-31T23:30:00Z"), quantity: "4", price: "120" }),
      ],
      { start: 2029, to: 2029, startPrices: at100 },
    );
    expect(years[0]!.assets).toEqual([asset(1, 6, 600, 80)]);
  });

  // Sold to the last unit, then bought again: the new units start a new average. 10 at €100 sold
  // at €130 (gain €300), then 5 bought at €140: €700, with nothing left of the old €100.
  it("starts a new average after everything was sold", () => {
    const { years } = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("sell", { occurredAt: at("2029-03-01"), quantity: "10", price: "130" }),
        tx("buy", { occurredAt: at("2029-09-01"), quantity: "5", price: "140" }),
      ],
      { start: 2029, to: 2029, startPrices: at100 },
    );
    expect(years[0]!.assets).toEqual([asset(1, 5, 700, 300)]);
  });

  // 10 held at €100, 15 sold at €120: a purchase is missing somewhere. Only the 10 held count
  // (1,200 − 1,000 = €200), with a warning; the 5 bought later at €90 aren't dragged below zero.
  it("counts only what's held when more is sold, and says so", () => {
    const oversold = tx("sell", { occurredAt: at("2029-03-01"), quantity: "15", price: "120" });
    const { years, warnings } = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        oversold,
        tx("buy", { occurredAt: at("2029-09-01"), quantity: "5", price: "90" }),
      ],
      { start: 2029, to: 2029, startPrices: at100 },
    );
    expect(years[0]!.assets).toEqual([asset(1, 5, 450, 200)]);
    expect(warnings).toEqual([
      `Transaction ${oversold.id}: sell of 15 exceeds holding of 10 (asset 1); only the part held is counted`,
    ]);
  });

  // No value on 1 January 2029 for asset 2: counting it as bought for €0 would tax its whole value
  // as gain when sold. It's left out and named instead.
  it("leaves out an asset held at the start without a value then, and names it", () => {
    const result = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("buy", { assetId: 2, occurredAt: at("2027-02-01"), quantity: "3", price: "50" }),
        tx("sell", { assetId: 2, occurredAt: at("2029-03-01"), quantity: "3", price: "70" }),
      ],
      { start: 2029, to: 2029, startPrices: at100 },
    );
    expect(result.missingStartValue).toEqual([2]);
    expect(result.years[0]).toMatchObject({ gainEur: 0, assets: [asset(1, 10, 1000)] });
  });

  // The cash side of a trade (paid from the account's euros) is no financial instrument: asset 9
  // never shows up as a holding.
  it("leaves the cash that pays for a trade out", () => {
    const { years, warnings } = capitalGains(
      [tx("buy", { occurredAt: at("2029-02-01"), quantity: "10", price: "100", settleAssetId: 9 })],
      { start: 2029, to: 2029, startPrices: new Map() },
    );
    expect(years[0]!.assets).toEqual([asset(1, 10, 1000)]);
    expect(warnings).toEqual([]);
  });

  // Units sent away without a sale take their share of the acquisition price along, with no gain:
  // 10 at €100, 4 withdrawn, 6 left at €600. Rows start at `from`, with the years before still
  // counted in the average.
  it("has no gain on units that leave without a sale, and reports from the year asked", () => {
    const { years } = capitalGains(
      [
        tx("buy", { occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
        tx("withdrawal", { occurredAt: at("2029-03-01"), quantity: "4" }),
        tx("sell", { occurredAt: at("2030-03-01"), quantity: "3", price: "150" }),
      ],
      { start: 2029, from: 2030, to: 2030, startPrices: at100 },
    );
    expect(years).toEqual([{ year: 2030, gainEur: 150, regularBenefitsEur: 0, assets: [asset(1, 3, 300, 150)] }]);
  });
});

// Decided on 9 November 2026 (ADR 0013): a joint account is split by each partner's share into each
// partner's own average. You own 60% of the joint account (account 2) and have 4 units of your own
// (account 1); your partner owns the other 40%.
//   You: 4 + 60% of 10 = 10 units at €100 = €1,000 at the start. Of the 10 bought jointly at €200,
//   6 are yours: 16 units for €2,200, €137.50 each. Of the 10 sold jointly at €180, 6 are yours:
//   1,080 − 6 × 137.50 = €255, leaving 10 at €1,375.
//   Partner: 4 units at €100 = €400, plus 4 at €200: 8 for €1,200, €150 each. 4 sold at €180:
//   720 − 600 = €120, leaving 4 at €600.
describe("a joint account in the preview's capital gain", () => {
  const own = [tx("buy", { accountId: 1, occurredAt: at("2027-02-01"), quantity: "4", price: "80" })];
  const joint = [
    tx("buy", { accountId: 2, occurredAt: at("2027-02-01"), quantity: "10", price: "80" }),
    tx("buy", { accountId: 2, occurredAt: at("2029-03-01"), quantity: "10", price: "200" }),
    tx("sell", { accountId: 2, occurredAt: at("2030-03-01"), quantity: "10", price: "180" }),
  ];
  const lastYear = (txs: typeof joint) => capitalGains(txs, { ...START, startPrices: at100 }).years[1]!;

  it("gives each partner their share of the units, the acquisition price and the gain", () => {
    const you = lastYear([...own, ...joint.map((t) => ownerShare(t, "0.6"))]);
    expect(you.assets).toEqual([asset(1, 10, 1375, 255)]);
    const partner = lastYear(joint.map((t) => ownerShare(t, "0.4")));
    expect(partner.assets).toEqual([asset(1, 4, 600, 120)]);
  });

  it("shares costs and dividends the same way, and keeps a split's ratio whole", () => {
    const fee = ownerShare(tx("buy", { quantity: "10", price: "200", feeEur: "5" }), "0.6");
    expect(fee).toMatchObject({ quantity: "6", price: "200", feeEur: "3" });
    const dividend = ownerShare(tx("dividend", { amount: "50", taxWithheld: "7.5" }), "0.6");
    expect(dividend).toMatchObject({ amount: "30", taxWithheld: "4.5" });
    expect(ownerShare(tx("split", { quantity: "4" }), "0.6").quantity).toBe("4");
  });
});

// ADR 0013: whether an asset is a financial instrument depends on where it's held. An ETP or ETC
// at a broker is one; coins in a wallet or on an exchange and metal in a vault or at home stay on
// capital accrual in 2029.
describe("financial instruments in the preview", () => {
  type Kind = (typeof accountKind.enumValues)[number];
  type Class = (typeof assetClass.enumValues)[number];
  const held: [Kind, Class, boolean][] = [
    ["broker", "crypto", true],
    ["broker", "metal", true],
    ["exchange", "crypto", false],
    ["wallet", "crypto", false],
    ["vault", "metal", false],
    ["physical", "metal", false],
  ];
  it.each(held)("%s holding %s: %s", (accountKind, assetClass, expected) => {
    expect(isFinancialInstrument({ accountKind, assetClass })).toBe(expected);
  });

  // Cash at a broker is a bank balance or foreign currency: capital accrual in 2029.
  const cashAt: Kind[] = ["broker", "exchange", "bank"];
  it.each(cashAt)("cash at a %s isn't one", (accountKind) => {
    expect(isFinancialInstrument({ accountKind, assetClass: "cash" })).toBe(false);
  });

  // Shares and funds are financial instruments wherever they're held; "other" only at a broker
  // (bonds, structured products), elsewhere it's things like loans to others.
  const elsewhere: [Kind, Class, boolean][] = [
    ["broker", "stock", true],
    ["broker", "etf", true],
    ["broker", "other", true],
    ["bank", "stock", true],
    ["exchange", "etf", true],
    ["other", "stock", true],
    ["bank", "other", false],
    ["other", "other", false],
  ];
  it.each(elsewhere)("%s holding %s: %s", (accountKind, assetClass, expected) => {
    expect(isFinancialInstrument({ accountKind, assetClass })).toBe(expected);
  });
});
