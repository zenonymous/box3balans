// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { Box3Page } from "./Box3";
import { HouseholdPage } from "./Household";

/** Who's in the household, and the parts of box 3 you fill in yourself. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

describe("Household page", () => {
  it("renames the partner, adds a child, and asks before removing the partner", async () => {
    const api = showPage("/household", "household", <HouseholdPage />);
    const partner = await screen.findByLabelText("Naam van je partner");
    await waitFor(() => expect((partner as HTMLInputElement).value).toBe("Daan"));
    const partnerForm = partner.closest("form")!;
    fireEvent.change(partner, { target: { value: "Daan de Vries" } });
    fireEvent.click(within(partnerForm).getByRole("button", { name: "Opslaan" }));
    await waitFor(() =>
      expect(api.requests.some((r) => r.method === "PUT" && r.url.startsWith("/api/household/"))).toBe(true),
    );
    expect(api.requests.find((r) => r.method === "PUT")!.body).toEqual({ name: "Daan de Vries" });

    fireEvent.click(screen.getByRole("button", { name: /Kind toevoegen/ }));
    const forms = screen.getAllByLabelText("Geboortedatum").map((i) => i.closest("form")!);
    const form = forms[forms.length - 1]!;
    fireEvent.change(within(form).getByLabelText("Naam"), { target: { value: "Mees" } });
    fireEvent.change(within(form).getByLabelText("Geboortedatum"), { target: { value: "01-03-2020" } });
    fireEvent.click(within(form).getByRole("button", { name: "Toevoegen" }));
    await waitFor(() => expect(sent(api, "POST", "/api/household")).toHaveLength(1));
    expect(sent(api, "POST", "/api/household")[0]).toMatchObject({
      name: "Mees",
      birthDate: "2020-03-01",
      role: "child",
    });

    // Emptying the partner's name removes the partner, but only after you confirm.
    vi.stubGlobal("confirm", () => false);
    fireEvent.change(partner, { target: { value: "" } });
    fireEvent.click(within(partnerForm).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect((partner as HTMLInputElement).value).toBe("Daan"));
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
  });
});

describe("Box 3 page", () => {
  it("saves your own situation for the year, in the notation you type", async () => {
    const api = showPage("/box3?year=2025", "box3", <Box3Page />);
    const debts = await screen.findByLabelText("Andere schulden");
    fireEvent.change(debts, { target: { value: "2.500" } });
    fireEvent.click(within(debts.closest("form")!).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "PUT", "/api/box3/config")).toHaveLength(1));
    const config = sent(api, "PUT", "/api/box3/config")[0] as {
      years: Record<string, { debtsEur: string; partner: boolean }>;
    };
    expect(config.years["2025"]).toMatchObject({ debtsEur: "2500", partner: true });
  });

  it("recalculates the 2028 preview with other assumptions", async () => {
    const api = showPage("/box3?year=2025", "box3", <Box3Page />);
    const assumptions = await screen.findByLabelText("Aannames");
    await within(assumptions).findAllByRole("option");
    fireEvent.change(assumptions, { target: { value: "letter" } });
    await waitFor(() =>
      expect(api.requests.some((r) => r.url.startsWith("/api/box3/future?preset=letter"))).toBe(true),
    );
    expect(api.missed).toEqual([]);
  });

  it("says how much of the homes' gain waits for their sale, and takes another vastgoedbijtelling", async () => {
    // The demo's holiday home rose from 298,000 to 310,000 since its second year.
    const api = showPage("/box3?year=2025", "box3", <Box3Page />);
    expect(await screen.findByText(/Winst op woningen tot nu toe, belast bij verkoop: €\s\+12\.000,00\./)).toBeTruthy();
    const pct = screen.getByLabelText(/Vastgoedbijtelling/);
    expect(pct.getAttribute("placeholder")).toBe("3.35");
    fireEvent.change(pct, { target: { value: "3,55" } });
    await waitFor(() =>
      expect(api.requests.some((r) => r.url === "/api/box3/future?preset=bill&propertyPct=3.55")).toBe(true),
    );
  });
});
