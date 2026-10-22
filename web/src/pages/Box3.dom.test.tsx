// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../test/box3.fixture.json";
import { fakeApi } from "../test/api";
import { Box3Page } from "./Box3";

/**
 * The box 3 page from the answers of the demo's made-up household (recorded by
 * scripts/build-online-demo.js; to refresh, copy them from web/dist-demo/data/nl/ into
 * src/test/box3.fixture.json). It checks what the page says, not how it looks.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(routes: Record<string, unknown>, at = "/box3?year=2025") {
  const api = fakeApi(routes);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <Box3Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}

describe("Box 3 page", () => {
  it("shows the year's categories, the calculation and the tax per person, as the server worked them out", async () => {
    const api = show(fixture);
    // The headline: the estimated tax for 2025 (6,180 in the fixture).
    const headline = (await screen.findByText("Geschatte box 3-belasting 2025")).parentElement!;
    expect(within(headline).getByText("€ 6.180")).toBeTruthy();
    expect(screen.getAllByText("€ 63.533").length).toBeGreaterThan(0); // bank balances
    // The calculation, step by step, with the rates of the year.
    const calc = (await screen.findByText("Berekening 2025")).closest("section")!;
    for (const text of [
      "Banktegoeden × 1,37%",
      "€ 870,40",
      "Forfaitair rendement",
      "€ 23.280,00",
      "Heffingsvrij vermogen (2 personen)",
      "€ -115.368,00",
      "73,76%",
      "Box 3-belasting tegen 36%",
    ])
      expect(within(calc).getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
    // Each partner's share and tax.
    expect(screen.getAllByText("€ 3.090")).toHaveLength(2);
    expect(api.missed).toEqual([]);
  });

  it("shows the warnings the server gives for a year", async () => {
    const year = {
      ...fixture["/api/box3/2025"],
      warnings: ["Er is € 12,50 rente bijgeschreven in de eerste week van januari 2025."],
    };
    show({ ...fixture, "/api/box3/2025": year });
    expect(await screen.findByText(/rente bijgeschreven in de eerste week van januari 2025/)).toBeTruthy();
  });
});
