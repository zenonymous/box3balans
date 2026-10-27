// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { showPage } from "../test/pages";
import { AttentionPage } from "./Attention";

afterEach(cleanup);

describe("Needs attention", () => {
  const issues = [
    {
      key: "sync:5",
      severity: "problem",
      title: "Bitvavo synchroniseert niet",
      detail: "Ongeldige sleutel",
      link: { to: "/connections", label: "Koppelingen" },
      fingerprint: "a",
      dismissible: false,
      dismissed: false,
    },
    {
      key: "price:9",
      severity: "warning",
      title: "Geen koers voor XYZ",
      fingerprint: "b",
      dismissible: true,
      dismissed: false,
    },
    { key: "old", severity: "info", title: "Al bekeken", fingerprint: "c", dismissible: true, dismissed: true },
  ];

  it("groups issues by severity, hides one until it changes, and can show the hidden ones", async () => {
    let list = issues;
    const api = showPage("/attention", "attention", <AttentionPage />, {
      "GET /api/attention": () => list,
      "POST /api/attention/dismiss": (b: { key: string }) => {
        list = list.map((i) => (i.key === b.key ? { ...i, dismissed: true } : i));
        return {};
      },
    });
    expect(await screen.findByRole("heading", { name: "Problemen (1)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Koppelingen →/ }).getAttribute("href")).toBe("/connections");
    expect(screen.queryByText("Al bekeken")).toBeNull();
    // The badge (sidebar and phone header) counts open problems and warnings, not what's merely worth a look.
    expect(screen.getAllByRole("link", { name: /2 punten vragen aandacht/ }).length).toBeGreaterThan(0);

    const warning = screen.getByText("Geen koers voor XYZ").closest("li")!;
    fireEvent.click(within(warning).getByRole("button", { name: "Verbergen" }));
    await waitFor(() =>
      expect(
        api.requests.some((r) => r.url === "/api/attention/dismiss" && (r.body as { key: string }).key === "price:9"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("Geen koers voor XYZ")).toBeNull());
    fireEvent.click(screen.getByLabelText("Verborgen tonen (2)"));
    expect(screen.getByText("Geen koers voor XYZ")).toBeTruthy();
    expect(screen.getByText("Al bekeken")).toBeTruthy();
  });

  it("says all is well when nothing is open", async () => {
    showPage("/attention", "attention", <AttentionPage />, { "GET /api/attention": [] });
    expect(await screen.findByText("Alles in orde ✓")).toBeTruthy();
  });
});
