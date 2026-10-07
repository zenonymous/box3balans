import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => t?.close());

type Year = { year: number; valueEur: string; inEur?: string; outEur?: string; incomeEur?: string };

async function setup(accounts: { kind: string; rows: Year[] }[]) {
  t = await createTestApp();
  for (const [i, a] of accounts.entries()) {
    const acc = (
      await t.api("POST", "/api/accounts", { name: `${a.kind} ${i}`, kind: a.kind, tracking: "yearly" })
    ).json();
    expect((await t.api("PUT", `/api/accounts/${acc.id}/years`, { rows: a.rows })).statusCode).toBe(200);
  }
  return (await t.api("GET", "/api/box3/2025")).json();
}

// The actual-return examples on belastingdienst.nl, "Rekenvoorbeelden berekening werkelijk rendement"
// (checked 2026-10-07), entered as values per year.
describe("Belastingdienst actual-return examples 2025", () => {
  it("3: savings and investments (dividend paid out of the account)", async () => {
    const y = await setup([
      {
        kind: "bank",
        rows: [
          { year: 2025, valueEur: "100000", incomeEur: "1200" },
          { year: 2026, valueEur: "101200" },
        ],
      },
      {
        kind: "broker",
        // Bought 1,200, sold 3,000; the 500 dividend left the account too.
        rows: [
          { year: 2025, valueEur: "150000", inEur: "1200", outEur: "3500", incomeEur: "500" },
          { year: 2026, valueEur: "160000" },
        ],
      },
    ]);
    expect(y.actualReturn.parts.bank.returnEur).toBe(1200);
    // 500 + 160,000 − 150,000 − 1,200 + 3,000
    expect(y.actualReturn.parts.investments.returnEur).toBe(12300);
    expect(y.actualReturn.totalEur).toBe(13500);
    // The deemed benefit the Belastingdienst compares it with: 7,838.
    expect(y.calculation.benefitEur).toBe("7838.00");
  });

  it("4: crypto only", async () => {
    const y = await setup([
      {
        kind: "wallet",
        rows: [
          { year: 2025, valueEur: "80000", inEur: "5000", outEur: "17000" },
          { year: 2026, valueEur: "90000" },
        ],
      },
    ]);
    // 90,000 − 80,000 − 5,000 + 17,000
    expect(y.actualReturn.totalEur).toBe(22000);
  });

  it("8: savings, investments and a debt", async () => {
    const y = await setup([
      {
        kind: "bank",
        rows: [
          { year: 2025, valueEur: "100000", incomeEur: "2000" },
          { year: 2026, valueEur: "102000" },
        ],
      },
      {
        kind: "broker",
        rows: [
          { year: 2025, valueEur: "150000", inEur: "1200", outEur: "3700", incomeEur: "700" },
          { year: 2026, valueEur: "160000" },
        ],
      },
      {
        kind: "debt",
        rows: [
          { year: 2025, valueEur: "50000", incomeEur: "1500" },
          { year: 2026, valueEur: "50000" },
        ],
      },
    ]);
    // 2,000 + 12,500 − 1,500 interest paid
    expect(y.actualReturn.parts.investments.returnEur).toBe(12500);
    expect(y.actualReturn.debtInterestEur).toBe(1500);
    expect(y.actualReturn.totalEur).toBe(13000);
  });
});
