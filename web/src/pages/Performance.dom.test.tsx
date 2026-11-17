// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import demo from "../test/demo.fixture.json";
import { PerformancePage } from "./Performance";

/** The Performance page (#88): tabs in the URL, the year filter on realized gains, and its CSV. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sale = (
  txId: number,
  date: string,
  name: string,
  symbol: string,
  account: string,
  q: string,
  p: string,
  c: string,
  g: string,
  kind = "sale",
) => ({
  kind,
  txId,
  date,
  assetId: txId,
  symbol,
  name,
  accountName: account,
  quantity: q,
  proceedsEur: p,
  costEur: c,
  gainEur: g,
  physical: false,
});

// The demo household's performance, with three realized rows over two years instead of its one.
const performance = {
  ...demo["/api/performance"],
  realized: [
    sale(31, "2025-03-04", "ASML Holding", "ASML", "DEGIRO", "2", "1400.00", "1300.50", "99.50"),
    sale(22, "2024-11-20", "Bitcoin", "BTC", "Ledger", "0.0001", "6.10", "2.00", "4.10", "fee"),
    sale(8, "2024-07-11", "ASML Holding", "ASML", "DEGIRO", "3", "2938.00", "1950.75", "987.25"),
  ],
};

function show(path = "/performance") {
  return showPage(path, "performance", <PerformancePage />, { "GET /api/performance": performance });
}

/** The realized-gains card, which holds the year filter. */
async function realizedCard() {
  const select = await screen.findByRole("combobox", { name: "Jaar" });
  return select.closest("section")!;
}

/** Clicks the CSV button and returns the file name and its lines (without the BOM). */
async function downloadCsv() {
  let blob: Blob | undefined;
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => ((blob = b as Blob), "blob:test"));
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  let name = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    name = this.download;
  });
  fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
  await waitFor(() => expect(blob).toBeTruthy());
  return { name, lines: (await blob!.text()).replace(/^\uFEFF/, "").split("\r\n") };
}

describe("Performance page", () => {
  it("opens on the tab in ?tab=, and choosing another tab shows that tab", async () => {
    show("/performance?tab=costs");
    expect((await screen.findByRole("tab", { name: "Kosten" })).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Kosten per jaar")).toBeTruthy();
    expect(screen.queryByText("Per belegging")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Resultaat in euro's" }));
    expect(await screen.findByText("Per belegging")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Resultaat in euro's" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("Kosten per jaar")).toBeNull();
  });

  it("an unknown ?tab= falls back to the results", async () => {
    show("/performance?tab=nonsense");
    expect((await screen.findByRole("tab", { name: "Resultaat in euro's" })).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("the year filter shows only that year's sales", async () => {
    show();
    const card = await realizedCard();
    expect(within(card).getAllByText(/ASML Holding|Bitcoin/)).toHaveLength(3);

    fireEvent.change(screen.getByRole("combobox", { name: "Jaar" }), { target: { value: "2024" } });
    await waitFor(() => expect(within(card).getAllByText(/ASML Holding|Bitcoin/)).toHaveLength(2));
    expect(within(card).getByText("netwerkkosten")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Jaar" }), { target: { value: "2025" } });
    await waitFor(() => expect(within(card).getAllByText(/ASML Holding|Bitcoin/)).toHaveLength(1));
  });

  it("the CSV has exactly the rows shown, and the button is off when there are none", async () => {
    show();
    fireEvent.change(await screen.findByRole("combobox", { name: "Jaar" }), { target: { value: "2024" } });
    const { name, lines } = await downloadCsv();
    expect(name).toBe("realized-gains-2024.csv");
    expect(lines).toEqual([
      "Datum,Belegging,Symbool,Soort,Rekening,Aantal,Opbrengst EUR,Aankoopwaarde EUR,Winst EUR",
      "2024-11-20,Bitcoin,BTC,netwerkkosten,Ledger,0.0001,6.10,2.00,4.10",
      "2024-07-11,ASML Holding,ASML,verkoop,DEGIRO,3,2938.00,1950.75,987.25",
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Jaar" }), { target: { value: "2022" } });
    expect(await screen.findByText("Geen verkopen in deze periode")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /CSV/ }).disabled).toBe(true);
  });
});
