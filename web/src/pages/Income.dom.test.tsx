// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { IncomePage } from "./Income";

/**
 * The Income page (#89): choosing a year, and the CSV of the payments. The demo household has three:
 * an ASML dividend in May 2025 (9.20 gross, 1.38 withheld) and in May 2024 (8.80, 1.32), and an
 * Ethereum staking reward in June 2024 (132.30).
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const show = () => showPage("/income", "income", <IncomePage />);

/** The "Uitkeringen" card. */
async function payments() {
  const heading = await screen.findByRole("heading", { name: "Uitkeringen" });
  return heading.closest("section")!;
}

/** The page's year, next to its title (the withheld-tax card has a year of its own). */
const yearSelect = () =>
  within(
    screen.getByRole("heading", { level: 1, name: "Inkomsten" }).parentElement!.parentElement!,
  ).getByRole<HTMLSelectElement>("combobox", { name: "Jaar" });

const rows = (card: HTMLElement) => within(card).getAllByRole("row").slice(1);

/** Clicks the card's CSV button and returns the file name and its lines (without the BOM). */
async function downloadCsv(card: HTMLElement) {
  let blob: Blob | undefined;
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => ((blob = b as Blob), "blob:test"));
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  let name = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    name = this.download;
  });
  fireEvent.click(within(card).getByRole("button", { name: /CSV/ }));
  await waitFor(() => expect(blob).toBeTruthy());
  return { name, lines: (await blob!.text()).replace(/^\uFEFF/, "").split("\r\n") };
}

describe("Income page", () => {
  it("opens on the latest year, and choosing a year shows that year's payments", async () => {
    show();
    const card = await payments();
    expect(yearSelect().value).toBe("2025");
    expect(rows(card)).toHaveLength(1);
    expect(rows(card)[0]!.textContent).toMatch(/ASML Holding/);

    fireEvent.change(yearSelect(), { target: { value: "2024" } });
    await waitFor(() => expect(rows(card)).toHaveLength(2));
    expect(rows(card).map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Ethereum.*Beloning/),
      expect.stringMatching(/ASML Holding.*Dividend/),
    ]);
    expect(await screen.findByText("Inkomsten per maand, 2024")).toBeTruthy();

    fireEvent.change(yearSelect(), { target: { value: "all" } });
    await waitFor(() => expect(rows(card)).toHaveLength(3));
  });

  it("the CSV has per payment the date, kind, asset, account and the gross, withheld and net amounts", async () => {
    show();
    const card = await payments();
    fireEvent.change(yearSelect(), { target: { value: "2024" } });
    await waitFor(() => expect(rows(card)).toHaveLength(2));
    const { name, lines } = await downloadCsv(card);
    expect(name).toBe("income-2024.csv");
    expect(lines).toEqual([
      "Datum,Soort,Belegging,Symbool,Rekening,Bruto EUR,Ingehouden belasting EUR,Netto EUR",
      "2024-06-30,Beloning,Ethereum,ETH,Bitvavo,132.30,0.00,132.30",
      "2024-05-02,Dividend,ASML Holding,ASML,DEGIRO,8.80,1.32,7.48",
    ]);
  });
});
