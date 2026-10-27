// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { ConnectionsPage } from "./Connections";
import { WalletsPage } from "./Wallets";

/** Adding a wallet address and connecting an exchange: what the page sends, and what it reports back. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

const result = (inserted: number) => ({
  at: "2026-10-27T10:00:00.000Z",
  status: "ok",
  durationMs: 1200,
  fetched: inserted,
  inserted,
  duplicates: 0,
  ignored: 0,
  transfersMatched: 1,
  newAssets: ["BTC"],
  mismatches: [],
  warnings: [],
  skippedTokens: [],
  partial: false,
});

describe("Wallets page", () => {
  it("adds an address in a new wallet account and shows what the first import brought in", async () => {
    let added = false;
    const wallet = {
      id: 1,
      accountId: 20,
      accountName: "Koude opslag",
      chain: "bitcoin",
      address: "bc1qexampleaddress000000000000000000000000",
      label: null,
      scriptType: null,
      includeUnlisted: false,
      enabled: true,
      lastSyncAt: "2026-10-27T10:00:00.000Z",
      lastStatus: "ok",
      lastResult: result(3),
      running: false,
    };
    const api = showPage("/wallets", "wallets", <WalletsPage />, {
      "GET /api/wallets": () => (added ? [wallet] : []),
      "POST /api/wallets": () => {
        added = true;
        return { accountId: 20 };
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Adres toevoegen/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Openbaar adres"), { target: { value: wallet.address } });
    fireEvent.change(within(dialog).getByLabelText("Naam van de rekening"), { target: { value: "Koude opslag" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Toevoegen en importeren" }));
    expect(await within(dialog).findByText(/3 transacties geïmporteerd/)).toBeTruthy();
    expect(sent(api, "POST", "/api/wallets")[0]).toMatchObject({
      chain: "bitcoin",
      address: wallet.address,
      accountName: "Koude opslag",
      label: null,
    });
  });
});

describe("Connections page", () => {
  it("connects an exchange with a read-only key and shows the first sync", async () => {
    let created = false;
    const integration = {
      id: 5,
      accountId: 21,
      accountName: "Bitvavo",
      provider: "bitvavo",
      keyHint: "…1234",
      enabled: true,
      lastSyncAt: "2026-10-27T10:00:00.000Z",
      lastStatus: "ok",
      lastResult: result(12),
      running: false,
      intervalHours: 6,
    };
    const api = showPage("/connections", "connections", <ConnectionsPage />, {
      "GET /api/integrations": () => (created ? [integration] : []),
      "POST /api/integrations": () => {
        created = true;
        return { id: 5 };
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Koppelen/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: /Bitvavo/ }));
    fireEvent.change(await within(dialog).findByLabelText("API-sleutel"), { target: { value: "test-key" } });
    fireEvent.change(within(dialog).getByLabelText("API-geheim"), { target: { value: "test-secret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Koppelen" }));
    expect(await within(dialog).findByText("Nieuwe beleggingen toegevoegd: BTC")).toBeTruthy();
    expect(within(dialog).getByText("12").tagName).toBe("STRONG");
    expect(sent(api, "POST", "/api/integrations")[0]).toEqual({
      provider: "bitvavo",
      credentials: { apiKey: "test-key", apiSecret: "test-secret" },
      accountName: "Bitvavo",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Klaar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
