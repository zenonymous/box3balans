// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { AssetsPage } from "./Assets";
import { MetalsPage } from "./Metals";

/** Adding an asset from a price source, and a gold coin to the safe at home. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

describe("Assets page", () => {
  it("finds a fund at the price source, adds it, and offers to record the purchase", async () => {
    const candidate = {
      assetClass: "etf",
      name: "Vanguard FTSE All-World UCITS ETF",
      symbol: "VWCE",
      priceSource: "yahoo",
      priceRef: "VWCE.DE",
      exchange: "XETRA",
      isin: "IE00BK5BQT80",
    };
    const api = showPage("/assets", "assets", <AssetsPage />, {
      "GET /api/assets/search": [candidate],
      "POST /api/assets": (b: unknown) => ({ id: 50, currency: "EUR", hidden: false, unit: "pcs", ...(b as object) }),
    });
    fireEvent.click(await screen.findByRole("button", { name: /Belegging toevoegen/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Zoeken"), { target: { value: "VWCE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zoeken" }));
    expect(await within(dialog).findByText("Vanguard FTSE All-World UCITS ETF")).toBeTruthy();
    expect(api.requests.some((r) => r.url === "/api/assets/search?kind=securities&q=VWCE")).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Toevoegen" }));
    await waitFor(() => expect(sent(api, "POST", "/api/assets")).toHaveLength(1));
    expect(sent(api, "POST", "/api/assets")[0]).toMatchObject({
      symbol: "VWCE",
      priceRef: "VWCE.DE",
      isin: "IE00BK5BQT80",
    });
    // Then the purchase form opens for the new asset.
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});

describe("Metals page", () => {
  it("adds coins with weight, purity and what you paid", async () => {
    const api = showPage("/metals", "metals", <MetalsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Munt \/ baar toevoegen/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Product"), { target: { value: "Eigen munt" } });
    fireEvent.change(within(dialog).getByLabelText("Brutogewicht per stuk (g)"), { target: { value: "31,1" } });
    fireEvent.change(within(dialog).getByLabelText("Zuiverheid / gehalte"), { target: { value: "0,9999" } });
    fireEvent.change(within(dialog).getByLabelText("Aantal (stuks)"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Totaal betaald (EUR)"), { target: { value: "5.400" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "POST", "/api/metals/items")).toHaveLength(1));
    expect(sent(api, "POST", "/api/metals/items")[0]).toMatchObject({
      metal: "gold",
      product: "Eigen munt",
      grossWeightG: "31.1",
      purity: "0.9999",
      quantity: 2,
      purchasePriceEur: "5400",
    });
  });
});
