// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../test/demo.fixture.json";
import { showPage } from "../test/pages";
import { AssetsPage } from "./Assets";
import { Box3Page } from "./Box3";

/** Editing the box 3 rates of a year, and an asset's details and price. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

describe("box 3 rules and rates", () => {
  it("saves a changed rate for a year, starting from the built-in figures, and can reset it", async () => {
    const api = showPage("/box3?year=2025", "box3", <Box3Page />, {
      "PUT /api/box3/config": (b: unknown) => b,
    });
    const card = (await screen.findByRole("heading", { name: "Regels en tarieven" })).closest("section")!;
    fireEvent.click(within(card).getByRole("button", { name: "Tonen" }));
    // 2027's percentage, in Dutch notation; the other fields keep the built-in figures.
    fireEvent.change(await within(card).findByLabelText("Bank % 2027"), { target: { value: "1,5" } });
    fireEvent.click(within(card).getByLabelText("Definitief 2027"));
    expect(within(card).getByRole("button", { name: "Herstellen" })).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Regels en tarieven opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/box3/config")).toHaveLength(1));
    const { rates } = sent(api, "PUT", "/api/box3/config")[0] as { rates: Record<string, Record<string, unknown>> };
    expect(rates["2027"]).toMatchObject({ bankPct: "1.5", otherPct: "7.87", allowanceEur: "30846", final: true });
    expect(await within(card).findByText(/Opgeslagen/)).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: "Herstellen" }));
    expect(within(card).queryByRole("button", { name: "Herstellen" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Regels en tarieven opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/box3/config")).toHaveLength(2));
    expect((sent(api, "PUT", "/api/box3/config")[1] as { rates: object }).rates).not.toHaveProperty("2027");
  });
});

describe("editing an asset", () => {
  it("changes a fund's running costs", async () => {
    const api = showPage("/assets", "assets", <AssetsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^iShares Core MSCI World/ }));
    const dialog = await screen.findByRole("dialog", { name: "IWDA bewerken" });
    const ter = within(dialog).getByLabelText<HTMLInputElement>(/Lopende kosten per jaar/);
    fireEvent.change(ter, { target: { value: "0,12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/assets/6")).toHaveLength(1));
    expect(sent(api, "PUT", "/api/assets/6")[0]).toMatchObject({
      symbol: "IWDA",
      isin: "IE00B4L5Y983",
      priceRef: "IWDA.AS",
      terPct: "0.12",
    });
    expect(sent(api, "POST", "/api/assets/6/price")).toEqual([]);
  });

  it("sets the price of an asset without a price feed, and deletes it after you confirm", async () => {
    vi.stubGlobal("confirm", () => true);
    const manual = {
      ...demo["/api/assets"].find((a) => a.id === 7)!,
      id: 90,
      name: "Wijnkist",
      symbol: "WIJN",
      isin: null,
      assetClass: "other",
      priceSource: "manual",
      priceRef: "",
      price: null,
    };
    const api = showPage("/assets", "assets", <AssetsPage />, {
      "GET /api/assets": [...demo["/api/assets"], manual],
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Wijnkist/ }));
    let dialog = await screen.findByRole("dialog", { name: "WIJN bewerken" });
    fireEvent.change(within(dialog).getByLabelText("Huidige koers (EUR)"), { target: { value: "1.250,00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() =>
      expect(sent(api, "POST", "/api/assets/90/price")).toEqual([{ price: "1250.00", currency: "EUR" }]),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /^Wijnkist/ }));
    dialog = await screen.findByRole("dialog", { name: "WIJN bewerken" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Verwijderen" }));
    await waitFor(() =>
      expect(api.requests.some((r) => r.method === "DELETE" && r.url === "/api/assets/90")).toBe(true),
    );
  });
});
