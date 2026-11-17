// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { NetworkPage } from "./Network";

/** Where Box3balans may connect (#87): turning sources off and on, and a refused change. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const destination = (id: string, purpose: string) => ({
  id,
  purpose,
  sends: "Een tickersymbool",
  when: "Bij het ophalen van koersen",
  hosts: [`${id}.example`],
});

/** A server with three switchable sources and one that isn't; PUT /api/network/off changes what GET returns. */
function showNetwork(off: string[] = [], put?: (body: { off: string[] }) => unknown) {
  let current = off;
  const api = showPage("/network", "network", <NetworkPage />, {
    "GET /api/network": () => ({
      destinations: [
        destination("prices", "Koersen"),
        destination("rates", "Wisselkoersen"),
        destination("chain", "Wallets"),
        destination("updates", "Updatecheck"),
      ],
      off: current,
      switchable: ["prices", "rates", "chain"],
      since: "2026-11-17T08:00:00Z",
      daily: [],
      recent: [],
      blocked: [],
    }),
    "PUT /api/network/off": (body: { off: string[] }) => {
      if (put) return put(body);
      current = body.off;
      return { off: current };
    },
  });
  const sent = () => api.requests.filter((r) => r.method === "PUT" && r.url === "/api/network/off").map((r) => r.body);
  return { api, sent };
}

describe("Network page", () => {
  it("turns a source off with its switch, and on again", async () => {
    const { sent } = showNetwork(["rates"]);
    const prices = await screen.findByRole("checkbox", { name: "Koersen" });
    expect((prices as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Wisselkoersen" }).checked).toBe(false);
    // A source that can't be switched here has no checkbox.
    expect(screen.queryByRole("checkbox", { name: "Updatecheck" })).toBeNull();

    fireEvent.click(prices);
    await waitFor(() => expect(sent()).toEqual([{ off: ["rates", "prices"] }]));
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Koersen" }).checked).toBe(false),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Wisselkoersen" }));
    await waitFor(() => expect(sent()).toEqual([{ off: ["rates", "prices"] }, { off: ["prices"] }]));
  });

  it("turns everything off or on at once, and each button is off when it would change nothing", async () => {
    const { sent } = showNetwork([]);
    const allOff = await screen.findByRole("button", { name: "Offline: alles uit" });
    const allOn = screen.getByRole("button", { name: "Alles aan" });
    expect((allOn as HTMLButtonElement).disabled).toBe(true);
    expect((allOff as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(allOff);
    await waitFor(() => expect(sent()).toEqual([{ off: ["prices", "rates", "chain"] }]));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Offline: alles uit" }).disabled).toBe(true),
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Alles aan" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Alles aan" }));
    await waitFor(() => expect(sent()).toEqual([{ off: ["prices", "rates", "chain"] }, { off: [] }]));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Alles aan" }).disabled).toBe(true),
    );
  });

  it("shows the server's error when a change is refused, and keeps the switch as it was", async () => {
    showNetwork([], () => Response.json({ error: "Unknown source: prices" }, { status: 400 }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Koersen" }));
    expect(await screen.findByText("Unknown source: prices")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Koersen" }).checked).toBe(true);
  });
});
