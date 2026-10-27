// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { AccountsPage } from "./Accounts";

/** Adding an account and filling in its values per year, with the demo household around it. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rowOf = async (name: string) => (await screen.findByText(name)).closest("tr, li") as HTMLElement;

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

describe("Accounts page", () => {
  it("adds an account with what you filled in", async () => {
    const api = showPage("/accounts", "accounts", <AccountsPage />, {
      "POST /api/accounts": (b: unknown) => ({ id: 99, txCount: 0, itemCount: 0, ...(b as object) }),
    });
    fireEvent.click(await screen.findByRole("button", { name: /Rekening toevoegen/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Naam"), { target: { value: "Triodos sparen" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "POST", "/api/accounts")).toHaveLength(1));
    expect(sent(api, "POST", "/api/accounts")[0]).toMatchObject({
      name: "Triodos sparen",
      kind: "bank",
      owner: "self",
      provider: null,
      ownerChildId: null,
    });
  });

  it("saves the values per year you change, as numbers the server reads", async () => {
    const api = showPage("/accounts", "accounts", <AccountsPage />);
    fireEvent.click(within(await rowOf("ASN Sparen")).getByRole("button", { name: /Waarden per jaar/ }));
    const dialog = await screen.findByRole("dialog");
    const value2026 = await within(dialog).findByLabelText("Waarde op 1 januari 2026");
    fireEvent.change(value2026, { target: { value: "40.123,45" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/accounts/7/years")).toHaveLength(1));
    const { rows } = sent(api, "PUT", "/api/accounts/7/years")[0] as { rows: { year: number; valueEur: string }[] };
    expect(rows.find((r) => r.year === 2026)?.valueEur).toBe("40123.45");
    expect(rows.length).toBeGreaterThan(1); // the other years go along unchanged
  });

  it("puts what a bank export found in the table, only the years you keep ticked", async () => {
    const bankImport = {
      format: "csv",
      needsClosingBalance: false,
      warnings: [],
      accounts: [
        {
          account: "NL00TEST0123456789",
          currency: null,
          inEuros: true,
          from: "2024-01-02",
          to: "2025-12-30",
          lines: 40,
          years: [
            {
              year: 2025,
              valueEur: "1500.00",
              valueEstimated: false,
              interestEur: "12.50",
              inEur: "300",
              outEur: "100",
              fullYear: true,
              lines: 20,
            },
            {
              year: 2024,
              valueEur: "1300.00",
              valueEstimated: true,
              interestEur: "8",
              inEur: "0",
              outEur: "0",
              fullYear: false,
              lines: 20,
            },
          ],
        },
      ],
    };
    const api = showPage("/accounts", "accounts", <AccountsPage />, {
      "POST /api/accounts/7/bank-import": bankImport,
    });
    fireEvent.click(within(await rowOf("ASN Sparen")).getByRole("button", { name: /Waarden per jaar/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: /Bankexport inlezen/ }));
    const input = dialog.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["datum;bedrag"], "ing.csv", { type: "text/csv" })] } });
    fireEvent.click(await within(dialog).findByRole("button", { name: "In de tabel zetten" }));
    // 2025 was sure (full year, real balance); 2024 was an estimate and stays out.
    expect((await within(dialog).findByLabelText<HTMLInputElement>("Waarde op 1 januari 2025")).value).toBe("1500");
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/accounts/7/years")).toHaveLength(1));
    const { rows } = sent(api, "PUT", "/api/accounts/7/years")[0] as {
      rows: { year: number; valueEur: string; incomeEur: string; details: { source?: string } }[];
    };
    const y2025 = rows.find((r) => r.year === 2025)!;
    expect(y2025).toMatchObject({ valueEur: "1500", incomeEur: "12.5" });
    expect(y2025.details.source).toMatch(/ing\.csv/);
    expect(sent(api, "POST", "/api/accounts/7/bank-import")[0]).toMatchObject({ fileName: "ing.csv" });
  });
});
