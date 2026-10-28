// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatementCheck } from "../api";
import { showPage } from "../test/pages";
import { StatementCheckCard } from "./StatementCheck";

/** A broker's statement of positions next to what the transactions add up to, with a fix per difference. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

const row = (name: string) => screen.getByText(name).closest("tr")!;

// DEGIRO's portfolio on 31 December next to the account: one fund matches, one is short, one has
// no transactions at all yet, and there's more cash than the statement says.
const check: StatementCheck = {
  accountId: 1,
  source: "Portfolio.csv",
  day: "2025-12-31",
  differences: 3,
  rows: [
    {
      assetId: 5,
      name: "iShares Core MSCI World",
      isin: "IE00B4L5Y983",
      reported: "40",
      computed: "40",
      difference: "0",
      price: "100",
      currency: "EUR",
    },
    {
      assetId: 6,
      name: "ASML Holding",
      isin: "NL0010273215",
      reported: "3",
      computed: "1",
      difference: "2",
      price: "650",
      currency: "EUR",
    },
    {
      assetId: null,
      name: "Vanguard FTSE All-World",
      isin: "IE00BK5BQT80",
      reported: "10",
      computed: "0",
      difference: "10",
      price: "120",
      currency: "EUR",
    },
    {
      assetId: 7,
      name: "Euro",
      isin: null,
      reported: "120.5",
      computed: "150.5",
      difference: "-30",
      price: null,
      currency: "EUR",
    },
  ],
};

const show = (answer: StatementCheck | null) =>
  showPage("/accounts", "accounts", <StatementCheckCard accountId={1} accountName="DEGIRO" />, {
    "GET /api/import/statement/1": answer,
  });

describe("StatementCheckCard", () => {
  it("lists the differences, and records a deposit on the statement's day for a position that's short", async () => {
    const confirm = vi.fn((_message: string) => true);
    vi.stubGlobal("confirm", confirm);
    const api = show(check);
    expect(await screen.findByText(/DEGIRO: 3 verschillen met het overzicht van/)).toBeTruthy();
    expect(within(row("iShares Core MSCI World")).getByText("✓")).toBeTruthy();
    expect(within(row("Vanguard FTSE All-World")).getByText("Nog geen transacties: importeer die eerst")).toBeTruthy();

    fireEvent.click(within(row("ASML Holding")).getByRole("button", { name: "Corrigeren" }));
    await waitFor(() => expect(sent(api, "POST", "/api/transactions")).toHaveLength(1));
    expect(confirm.mock.calls[0]![0]).toMatch(/^Een storting van 2 ASML Holding vastleggen in DEGIRO op /);
    const body = sent(api, "POST", "/api/transactions")[0] as { occurredAt: string };
    expect(body).toMatchObject({ accountId: 1, assetId: 6, type: "deposit", quantity: "2", price: "650" });
    expect(new Date(body.occurredAt).getDate()).toBe(31);
  });

  it("records a withdrawal of cash that the statement doesn't have, only after you confirm", async () => {
    vi.stubGlobal("confirm", () => false);
    const api = show(check);
    fireEvent.click(within(await waitFor(() => row("Euro"))).getByRole("button", { name: "Corrigeren" }));
    expect(sent(api, "POST", "/api/transactions")).toHaveLength(0);

    vi.stubGlobal("confirm", () => true);
    fireEvent.click(within(row("Euro")).getByRole("button", { name: "Corrigeren" }));
    await waitFor(() => expect(sent(api, "POST", "/api/transactions")).toHaveLength(1));
    expect(sent(api, "POST", "/api/transactions")[0]).toMatchObject({
      assetId: 7,
      type: "withdrawal",
      quantity: "30",
      price: "0",
    });
  });

  it("says when everything matches, and shows nothing without a statement", async () => {
    show({ ...check, differences: 0, rows: [check.rows[0]!] });
    expect(await screen.findByText(/DEGIRO: alles klopt met het overzicht van/)).toBeTruthy();
    cleanup();

    show(null);
    const main = await screen.findByRole("main");
    // The card shows "Loading…" while it asks, then nothing.
    await waitFor(() => expect(within(main).queryByText("Laden…")).toBeNull());
    expect(screen.queryByText(/het overzicht van/)).toBeNull();
  });
});
