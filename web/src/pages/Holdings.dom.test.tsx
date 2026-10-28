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

describe("Assets page: cash and your own assets", () => {
  const open = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /Belegging toevoegen/ }));
    return screen.findByRole("dialog");
  };

  it("adds a currency as cash, valued at the ECB rate, without a purchase after", async () => {
    const api = showPage("/assets", "assets", <AssetsPage />, {
      "POST /api/assets": (b: unknown) => ({ id: 51, hidden: false, unit: "pcs", ...(b as object) }),
    });
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Contant" }));
    fireEvent.change(within(dialog).getByLabelText("Valuta"), { target: { value: "chf" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Valuta toevoegen" }));
    await waitFor(() => expect(sent(api, "POST", "/api/assets")).toHaveLength(1));
    expect(sent(api, "POST", "/api/assets")[0]).toEqual({
      assetClass: "cash",
      name: "Contant CHF",
      symbol: "CHF",
      priceSource: "fx",
      currency: "CHF",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("adds an asset with a price you set yourself, then offers to record the purchase", async () => {
    const api = showPage("/assets", "assets", <AssetsPage />, {
      "POST /api/assets": (b: unknown) => ({ id: 52, hidden: false, unit: "pcs", ...(b as object) }),
    });
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Handmatig" }));
    fireEvent.change(within(dialog).getByLabelText("Naam"), { target: { value: "Aandelen Familie BV" } });
    fireEvent.change(within(dialog).getByLabelText("Symbool"), { target: { value: "FAMBV" } });
    fireEvent.change(within(dialog).getByLabelText("Soort"), { target: { value: "stock" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Belegging toevoegen" }));
    await waitFor(() => expect(sent(api, "POST", "/api/assets")).toHaveLength(1));
    expect(sent(api, "POST", "/api/assets")[0]).toEqual({
      name: "Aandelen Familie BV",
      symbol: "FAMBV",
      assetClass: "stock",
      currency: "EUR",
      isin: null,
      priceSource: "manual",
    });
    // The purchase form for the new asset.
    expect(await screen.findByRole("dialog", { name: /Aandelen Familie BV/ })).toBeTruthy();
  });

  it("says why the server refused the asset, and keeps the form", async () => {
    showPage("/assets", "assets", <AssetsPage />, {
      "POST /api/assets": () => Response.json({ error: "Dat bestaat al" }, { status: 409 }),
    });
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Contant" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Valuta toevoegen" }));
    expect(await within(dialog).findByText("Dat bestaat al")).toBeTruthy();
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

  it("marks a coin as sold with the date and the proceeds", async () => {
    const api = showPage("/metals", "metals", <MetalsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Krugerrand 1 oz/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Verkocht" }));
    fireEvent.change(within(dialog).getByLabelText("Verkoopdatum"), { target: { value: "15-10-2026" } });
    fireEvent.change(within(dialog).getByLabelText("Verkoopopbrengst (EUR)"), { target: { value: "3.950,50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/metals/items/1")).toHaveLength(1));
    expect(sent(api, "PUT", "/api/metals/items/1")[0]).toMatchObject({
      product: "Krugerrand 1 oz",
      soldDate: "2026-10-15",
      salePriceEur: "3950.50",
    });
  });

  it("deletes a coin only after you confirm", async () => {
    vi.stubGlobal("confirm", () => false);
    const api = showPage("/metals", "metals", <MetalsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Maple Leaf 1 oz/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Verwijderen" }));
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);

    vi.stubGlobal("confirm", () => true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Verwijderen" }));
    await waitFor(() =>
      expect(api.requests.some((r) => r.method === "DELETE" && r.url === "/api/metals/items/3")).toBe(true),
    );
  });
});
