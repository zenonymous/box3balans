// @vitest-environment happy-dom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../test/demo.fixture.json";
import { showPage } from "../test/pages";
import { TaxReturnPage } from "./TaxReturn";

/** The tax return overview with the demo household, plus a savings account abroad. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The demo's 2025 answer, with a deposit at a Portuguese bank: 500 interest, 50 withheld there.
const answer = demo["/api/box3/2025/return"];
const abroad = {
  ...answer,
  sections: answer.sections.map((s) =>
    s.key === "bank"
      ? {
          ...s,
          lines: [
            ...s.lines,
            {
              ...s.lines[0]!,
              accountId: 99,
              name: "Deposito Portugal",
              foreign: true,
              incomeEur: 500,
              taxWithheldEur: 50,
              taxCountry: "PT",
            },
          ],
        }
      : s,
  ),
  interestTax: [{ country: "PT", grossEur: 500, taxEur: 50 }],
};

describe("For the tax return", () => {
  it("shows the tax withheld abroad on interest, on the account and per country", async () => {
    showPage("/box3/aangifte?year=2025", "box3/aangifte", <TaxReturnPage />, { "GET /api/box3/2025/return": abroad });
    const row = (await screen.findByText(/^Deposito Portugal/)).closest("tr")!;
    expect(within(row).getByText("€ 50,00")).toBeTruthy();
    expect(within(row).getByText("Portugal")).toBeTruthy();
    // Only the bank section has a line abroad with tax withheld.
    expect(screen.getAllByRole("columnheader", { name: "Ingehouden in het buitenland" })).toHaveLength(1);

    const card = screen.getByRole("heading", { name: "Ingehouden belasting in 2025" }).closest("section")!;
    expect(
      within(card).getByText(/In het buitenland ingehouden belasting op rente, per land van de bank/),
    ).toBeTruthy();
    expect(within(card).getByText("over € 500,00")).toBeTruthy();
  });

  it("leaves the column out when nothing was withheld abroad", async () => {
    showPage("/box3/aangifte?year=2025", "box3/aangifte", <TaxReturnPage />);
    expect(await screen.findByText("Bankrekeningen en andere banktegoeden")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Ingehouden in het buitenland" })).toBeNull();
    expect(screen.queryByText(/belasting op rente, per land/)).toBeNull();
  });
});
