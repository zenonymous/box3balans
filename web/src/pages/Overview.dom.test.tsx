// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { OverviewPage } from "./Overview";

/** The overview's history range and its allocation by class, asset and account. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Overview", () => {
  // "Vermogen" is what's tracked with transactions and prices; the demo's accounts kept as values per
  // year (a holiday home, savings, a loan to Eva, a student loan) aren't in it, so the page says so:
  // 310,000 + 38,730 + 12,450 + 6,900 + 4,015 + 3,000 − 15,500 = 359,595. Worked by hand.
  it("says how much is on accounts kept as values per year, which Vermogen leaves out", async () => {
    showPage("/", "/", <OverviewPage />);
    const line = await screen.findByText(/Rekeningen met waarden per jaar/);
    expect(line.textContent).toMatch(/netto €\s359\.595/);
    expect(within(line).getByRole("link", { name: "Box 3 →" }).getAttribute("href")).toBe("/box3");
  });

  it("loads another history range when you pick it", async () => {
    const api = showPage("/", "/", <OverviewPage />);
    const card = (await screen.findByRole("heading", { name: "Vermogen in de tijd" })).closest("section")!;
    expect(within(card).getByRole("tab", { name: "1J" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(card).getByRole("tab", { name: "5J" }));
    await waitFor(() => expect(api.requests.some((r) => r.url === "/api/portfolio/history?range=5Y")).toBe(true));
    expect(within(card).getByRole("tab", { name: "5J" }).getAttribute("aria-selected")).toBe("true");
    // The cost line can be switched off.
    const invested = within(card).getByLabelText<HTMLInputElement>("Belegd");
    expect(invested.checked).toBe(true);
    fireEvent.click(invested);
    expect(invested.checked).toBe(false);
  });

  it("shows the allocation per account as ranked bars, split by class, with a tooltip per part", async () => {
    showPage("/", "/", <OverviewPage />);
    const card = (await screen.findByRole("heading", { name: "Verdeling" })).closest("section")!;
    fireEvent.click(within(card).getByRole("tab", { name: "Rekening" }));
    // Bitcoin is held at Bitvavo and on the Ledger; each account gets its own bar.
    expect(within(card).getByText("Ledger")).toBeTruthy();
    expect(within(card).getByText("Bitvavo")).toBeTruthy();
    expect(within(card).getByRole("list", { name: "Legenda" })).toBeTruthy();
    const ledger = within(card).getByText("Ledger").closest("li")!;
    const segment = ledger.querySelector<HTMLElement>("[style*='background']")!;
    fireEvent.mouseEnter(segment);
    expect(within(ledger).getByText(/van Ledger/)).toBeTruthy();
    fireEvent.mouseLeave(segment);
    expect(within(ledger).queryByText(/van Ledger/)).toBeNull();

    fireEvent.click(within(card).getByRole("tab", { name: "Belegging" }));
    expect(within(card).getByText("iShares Core MSCI World UCITS ETF")).toBeTruthy();
  });
});
