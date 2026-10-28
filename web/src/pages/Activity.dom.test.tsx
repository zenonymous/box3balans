// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { ActivityList, ActivityPage } from "./Activity";

/** The history of changes: what changed in words, restoring, the filters and older pages. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

const entry = (id: number, patch: object = {}) => ({
  id,
  at: "2026-10-27T10:00:00Z",
  entity: "transaction",
  entityId: 100 + id,
  action: "update",
  title: `Change ${id}`,
  changes: null,
  restorable: false,
  ...patch,
});

const itemOf = (title: string) => screen.getByText(title).closest("li")!;

describe("History", () => {
  it("shows what changed in words: amounts, kinds, yes or no, and links", async () => {
    showPage("/activity", "activity", <ActivityPage />, {
      "GET /api/activity": {
        total: 2,
        items: [
          entry(1, {
            title: "Bitcoin 0,5",
            via: "sync",
            changes: {
              fields: [
                { field: "type", from: "buy", to: "sell" },
                { field: "quantity", from: "1", to: "1.5" },
                // Filled in as zero when nothing was there: says nothing new.
                { field: "feeEur", from: null, to: "0" },
                { field: "transferGroup", from: null, to: "abc" },
              ],
              flags: ["unlinked"],
            },
          }),
          entry(2, {
            entity: "account_years",
            title: "ASN Sparen",
            changes: {
              fields: [
                { field: "2024 valueEur", from: "18000", to: "18500" },
                { field: "foreign", from: false, to: true },
              ],
              flags: [],
            },
          }),
        ],
      },
    });
    const sync = within(await waitFor(() => itemOf("Bitcoin 0,5")));
    expect(sync.getByText("door een sync")).toBeTruthy();
    expect(sync.getByText("Soort:", { exact: false }).textContent).toBe("Soort: Aankoop → Verkoop");
    expect(sync.getByText("Aantal:", { exact: false }).textContent).toBe("Aantal: 1 → 1,5");
    expect(sync.queryByText(/Kosten \(EUR\)/)).toBeNull();
    expect(sync.getByText("Koppeling overboeking:", { exact: false }).textContent).toBe(
      "Koppeling overboeking: — → gekoppeld",
    );
    expect(sync.getByText("Overboeking ontkoppeld")).toBeTruthy();

    const years = within(itemOf("ASN Sparen"));
    expect(years.getByText("Waarden per jaar")).toBeTruthy();
    // Amounts come with a non-breaking space after the euro sign.
    expect(years.getByText(/^2024 · Waarde op 1 januari:/).textContent.replace(/\s/g, " ")).toBe(
      "2024 · Waarde op 1 januari: € 18.000,00 → € 18.500,00",
    );
    expect(years.getByText(/^Buitenland:/).textContent).toBe("Buitenland: nee → ja");
  });

  it("restores a deleted transaction", async () => {
    const api = showPage("/activity", "activity", <ActivityPage />, {
      "GET /api/activity": { total: 1, items: [entry(5, { action: "delete", title: "ASML 3", restorable: true })] },
    });
    const item = within(await waitFor(() => itemOf("ASML 3")));
    expect(item.getByText("Verwijderd")).toBeTruthy();
    fireEvent.click(item.getByRole("button", { name: "Terugzetten" }));
    await waitFor(() => expect(sent(api, "POST", "/api/activity/5/restore")).toHaveLength(1));
  });

  it("asks for one kind of change when you pick a filter, and for older ones on request", async () => {
    let calls = 0;
    const api = showPage("/activity", "activity", <ActivityPage />, {
      // 51 changes: a first page of 50, then the last one.
      "GET /api/activity": () =>
        calls++ === 0
          ? { total: 51, items: Array.from({ length: 50 }, (_, i) => entry(i + 1)) }
          : { total: 51, items: [entry(51, { title: "The oldest" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Oudere tonen" }));
    expect(await screen.findByText("The oldest")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Oudere tonen" })).toBeNull();
    const asked = () => api.requests.filter((r) => r.url.startsWith("/api/activity?")).map((r) => r.url);
    expect(asked()).toEqual(["/api/activity?limit=50&offset=0", "/api/activity?limit=50&offset=50"]);

    fireEvent.click(screen.getByRole("tab", { name: "Waarden per jaar" }));
    await waitFor(() => expect(asked()).toContain("/api/activity?limit=50&entity=account_years&offset=0"));
  });

  it("says when nothing was recorded, in full or as part of a record's page", async () => {
    showPage("/activity", "activity", <ActivityPage />, { "GET /api/activity": { total: 0, items: [] } });
    expect(await screen.findByText("Nog niets vastgelegd")).toBeTruthy();
    cleanup();
    showPage("/accounts", "accounts", <ActivityList entity="account" entityId={7} compact />, {
      "GET /api/activity": { total: 0, items: [] },
    });
    expect(await screen.findByText("Geen wijzigingen vastgelegd.")).toBeTruthy();
  });
});
