// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../test/demo.fixture.json";
import { showPage } from "../test/pages";
import { StartPage } from "./Start";

/** The start wizard, step by step, for tax year 2025 with the demo household. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

describe("Start wizard", () => {
  it("walks from the household to the accounts, their values on 1 January and the box 3 estimate", async () => {
    const api = showPage("/start?year=2025", "start", <StartPage />);

    // 1. Household: the partner of 2025 is a fiscal partner; unticking it is saved for that year.
    const partner = await screen.findByLabelText(/fiscale partners/);
    fireEvent.click(partner);
    await waitFor(() => expect(sent(api, "PUT", "/api/box3/config")).toHaveLength(1));
    const config = sent(api, "PUT", "/api/box3/config")[0] as { years: Record<string, { partner: boolean }> };
    expect(config.years["2025"]?.partner).toBe(false);

    // 2. Accounts: add one.
    fireEvent.click(screen.getByRole("button", { name: /Volgende: Rekeningen/ }));
    fireEvent.change(await screen.findByLabelText("Naam"), { target: { value: "Bunq sparen" } });
    fireEvent.click(screen.getByRole("button", { name: "Rekening toevoegen" }));
    await waitFor(() => expect(sent(api, "POST", "/api/accounts")).toHaveLength(1));
    expect(sent(api, "POST", "/api/accounts")[0]).toMatchObject({
      name: "Bunq sparen",
      kind: "bank",
      tracking: "yearly",
      owner: "self",
    });

    // 3. Values on 1 January: a value is saved when you leave the field.
    fireEvent.click(screen.getByRole("button", { name: /Volgende: Waarden op 1 januari/ }));
    const asn = (await screen.findByText("ASN Sparen")).closest("li")!;
    const field = await within(asn).findByLabelText("1 januari 2025");
    await waitFor(() => expect((field as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(field, { target: { value: "30.000" } });
    fireEvent.blur(field);
    await waitFor(() => expect(sent(api, "PUT", "/api/accounts/7/years")).toHaveLength(1));
    const { rows } = sent(api, "PUT", "/api/accounts/7/years")[0] as { rows: { year: number; valueEur: string }[] };
    expect(rows.find((r) => r.year === 2025)?.valueEur).toBe("30000");

    // 4. The estimate, as the server worked it out.
    fireEvent.click(screen.getByRole("button", { name: /Volgende: Jouw box 3/ }));
    expect(await screen.findByText("Geschatte box 3-belasting 2025")).toBeTruthy();
  });

  it("keeps both values when you leave two fields in quick succession", async () => {
    // Like the server: a PUT replaces the account's values per year.
    type Row = { year: number; valueEur: string | null };
    let stored = (demo["/api/accounts/7/years"] as Row[]).map((r) => ({ ...r }));
    showPage("/start?step=values&year=2025", "start", <StartPage />, {
      "GET /api/accounts/7/years": () => stored,
      "PUT /api/accounts/7/years": (body: unknown) => (stored = (body as { rows: Row[] }).rows),
    });
    const asn = (await screen.findByText("ASN Sparen")).closest("li")!;
    const first = await within(asn).findByLabelText("1 januari 2025");
    await waitFor(() => expect((first as HTMLInputElement).disabled).toBe(false));
    const second = within(asn).getByLabelText("1 januari 2026");
    fireEvent.change(first, { target: { value: "30.000" } });
    fireEvent.blur(first);
    fireEvent.change(second, { target: { value: "31.000" } });
    fireEvent.blur(second);
    await waitFor(() => expect(within(asn).getByText(/Opgeslagen/)).toBeTruthy());
    await waitFor(() =>
      expect(Object.fromEntries(stored.map((r) => [r.year, r.valueEur]))).toMatchObject({
        2025: "30000",
        2026: "31000",
      }),
    );
  });
});
