// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { AccountsPage } from "./Accounts";
import { ConnectionsPage } from "./Connections";
import { TransactionsPage } from "./Transactions";

/** Changing and removing what's there: accounts, transactions, a connection; and reading a year statement. */
vi.mock("../pdfText", () => ({
  // The PDF itself is read by pdf.js in the browser; here its text is given.
  readPdf: async () => [{ page: 1, text: "Jaaroverzicht 2025\nSaldo op 31 december 2025   € 41.250,00" }],
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

describe("editing accounts", () => {
  it("renames an account, and deletes one without transactions after you confirm", async () => {
    vi.stubGlobal("confirm", () => true);
    const api = showPage("/accounts", "accounts", <AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /ASN Sparen/ }));
    let dialog = await screen.findByRole("dialog", { name: "Rekening bewerken" });
    fireEvent.change(within(dialog).getByLabelText("Naam"), { target: { value: "ASN Spaarrekening" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/accounts/7")).toHaveLength(1));
    expect(sent(api, "PUT", "/api/accounts/7")[0]).toMatchObject({ name: "ASN Spaarrekening", kind: "bank" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: /ASN Sparen/ }));
    dialog = await screen.findByRole("dialog", { name: "Rekening bewerken" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Verwijderen" }));
    await waitFor(() =>
      expect(api.requests.some((r) => r.method === "DELETE" && r.url === "/api/accounts/7")).toBe(true),
    );
  });

  it("reads a year statement's text and puts the ticked value in the table", async () => {
    const api = showPage("/accounts", "accounts", <AccountsPage />, {
      "POST /api/accounts/7/year-statement": {
        template: null,
        year: 2025,
        found: [
          {
            year: 2026,
            field: "valueEur",
            amount: "41250.00",
            page: 1,
            line: "Saldo op 31 december 2025   € 41.250,00",
            sure: true,
          },
        ],
      },
    });
    const row = (await screen.findByText("ASN Sparen")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: /Waarden per jaar/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: /Jaaroverzicht \(pdf\) inlezen/ }));
    const input = dialog.querySelector('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(["%PDF"], "jaaroverzicht-2025.pdf", { type: "application/pdf" })] },
    });
    expect(await within(dialog).findByText(/Saldo op 31 december 2025/)).toBeTruthy();
    expect(sent(api, "POST", "/api/accounts/7/year-statement")[0]).toEqual({
      pages: [{ page: 1, text: "Jaaroverzicht 2025\nSaldo op 31 december 2025   € 41.250,00" }],
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "In de tabel zetten" }));
    expect((await within(dialog).findByLabelText<HTMLInputElement>("Waarde op 1 januari 2026")).value).toBe("41250");
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/accounts/7/years")).toHaveLength(1));
    const { rows } = sent(api, "PUT", "/api/accounts/7/years")[0] as {
      rows: { year: number; valueEur: string; details: { source?: string } }[];
    };
    const y2026 = rows.find((r) => r.year === 2026)!;
    expect(y2026.valueEur).toBe("41250");
    expect(y2026.details.source).toMatch(/jaaroverzicht-2025\.pdf/);
  });
});

describe("editing transactions", () => {
  it("changes a dividend, and deletes it after you confirm", async () => {
    vi.stubGlobal("confirm", () => true);
    const api = showPage("/transactions", "transactions", <TransactionsPage />);
    const first = (await screen.findAllByRole("listitem")).find((li) => within(li).queryByText(/ASML/))!;
    fireEvent.click(within(first).getByRole("button"));
    let dialog = await screen.findByRole("dialog", { name: "Transactie bewerken" });
    const gross = within(dialog).getByLabelText<HTMLInputElement>("Brutobedrag");
    expect(gross.value).toBe("9,2");
    fireEvent.change(gross, { target: { value: "10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/transactions/10")).toHaveLength(1));
    expect(sent(api, "PUT", "/api/transactions/10")[0]).toMatchObject({
      type: "dividend",
      amount: "10",
      taxWithheld: "1.38",
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(within(first).getByRole("button"));
    dialog = await screen.findByRole("dialog", { name: "Transactie bewerken" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Verwijderen" }));
    await waitFor(() =>
      expect(api.requests.some((r) => r.method === "DELETE" && r.url === "/api/transactions/10")).toBe(true),
    );
  });
});

describe("a connection", () => {
  const integration = {
    id: 5,
    accountId: 2,
    accountName: "Bitvavo",
    provider: "bitvavo",
    keyHint: "…1234",
    enabled: true,
    lastSyncAt: "2026-10-27T10:00:00.000Z",
    lastStatus: "ok",
    lastResult: {
      at: "2026-10-27T10:00:00.000Z",
      status: "ok",
      durationMs: 900,
      fetched: 30,
      inserted: 4,
      duplicates: 26,
      ignored: 0,
      transfersMatched: 0,
      newAssets: [],
      mismatches: [],
      warnings: [],
    },
    running: false,
    intervalHours: 6,
  };

  it("syncs on request, can be paused, and is removed keeping its transactions", async () => {
    vi.stubGlobal("confirm", () => true);
    const api = showPage("/connections", "connections", <ConnectionsPage />, {
      "GET /api/integrations": [integration],
      "POST /api/integrations/5/sync": integration.lastResult,
    });
    fireEvent.click(await screen.findByRole("button", { name: "↻ Nu synchroniseren" }));
    await waitFor(() => expect(sent(api, "POST", "/api/integrations/5/sync")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText(/Automatisch synchroniseren/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/integrations/5")).toEqual([{ enabled: false }]));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Verwijderen" }));
    await waitFor(() =>
      expect(
        api.requests.some((r) => r.method === "DELETE" && r.url === "/api/integrations/5?deleteTransactions=false"),
      ).toBe(true),
    );
  });

  it("records an adjustment for a balance that differs from the exchange, after you confirm", async () => {
    const questions: string[] = [];
    vi.stubGlobal("confirm", (q: string) => questions.push(q) > 0);
    const mismatches = [{ assetId: 8, symbol: "BTC", reported: "0.5", computed: "0.6", difference: "-0.1" }];
    const api = showPage("/connections", "connections", <ConnectionsPage />, {
      "GET /api/integrations": [{ ...integration, lastResult: { ...integration.lastResult, mismatches } }],
    });
    const adjust = await screen.findByRole("button", { name: "Corrigeren" });
    // It needs the asset list before it can ask; until then a click does nothing.
    await waitFor(() => {
      fireEvent.click(adjust);
      expect(questions).toHaveLength(1);
    });
    expect(questions[0]).toMatch(/0,1 BTC/);
    await waitFor(() => expect(sent(api, "POST", "/api/transactions")).toHaveLength(1));
    expect(sent(api, "POST", "/api/transactions")[0]).toMatchObject({
      accountId: 2,
      assetId: 8,
      type: "withdrawal",
      quantity: "0.1",
      price: "0",
      currency: "EUR",
    });
    expect(await screen.findByText(/gecorrigeerd/)).toBeTruthy();
  });
});
