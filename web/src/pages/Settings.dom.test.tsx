// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { SettingsPage } from "./Settings";

/** The settings that change how Box3balans calculates and keeps your data. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

const card = async (title: string) =>
  (await screen.findByRole("heading", { name: title })).closest("section") as HTMLElement;

describe("Settings page", () => {
  it("switches the cost basis to FIFO", async () => {
    const api = showPage("/settings", "settings", <SettingsPage />);
    const select = await screen.findByLabelText("Methode");
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(select, { target: { value: "fifo" } });
    await waitFor(() => expect(sent(api, "PUT", "/api/settings")).toEqual([{ costMethod: "fifo" }]));
  });

  it("keeps the theme and number format you choose in this browser, and signs out", async () => {
    const api = showPage("/settings", "settings", <SettingsPage />);
    const appearance = await card("Weergave");
    fireEvent.click(within(appearance).getByRole("tab", { name: "Donker" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    fireEvent.click(within(appearance).getByRole("tab", { name: "Systeem" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("theme")).toBeNull();

    fireEvent.change(within(appearance).getByLabelText("Getalnotatie"), { target: { value: "en-IE" } });
    expect(localStorage.getItem("numberLocale")).toBe("en-IE");
    localStorage.removeItem("numberLocale");

    fireEvent.click(screen.getByRole("button", { name: "Uitloggen" }));
    await waitFor(() => expect(sent(api, "POST", "/api/auth/logout")).toHaveLength(1));
  });

  it("only sends a new password when both entries match", async () => {
    const api = showPage("/settings", "settings", <SettingsPage />);
    const form = await card("Wachtwoord wijzigen");
    const fill = (label: string, value: string) =>
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    fill("Huidig wachtwoord", "old password here");
    fill("Nieuw wachtwoord", "a new long password");
    fill("Herhaal nieuw wachtwoord", "a new long passwort");
    fireEvent.click(within(form).getByRole("button", { name: "Wachtwoord wijzigen" }));
    expect(await within(form).findByText("De nieuwe wachtwoorden zijn niet gelijk")).toBeTruthy();
    expect(sent(api, "POST", "/api/auth/password")).toEqual([]);
    fill("Herhaal nieuw wachtwoord", "a new long password");
    fireEvent.click(within(form).getByRole("button", { name: "Wachtwoord wijzigen" }));
    await waitFor(() =>
      expect(sent(api, "POST", "/api/auth/password")).toEqual([
        { current: "old password here", next: "a new long password" },
      ]),
    );
  });

  it("makes a backup now, and restores one only after typing RESTORE", async () => {
    const backup = {
      name: "box3balans-20261027-030000-auto.json.gz.enc",
      sizeBytes: 20480,
      createdAt: "2026-10-27T03:00:00.000Z",
      encrypted: true,
    };
    const api = showPage("/settings", "settings", <SettingsPage />, {
      "GET /api/backups": {
        dir: "/backups",
        intervalHours: 24,
        keep: 14,
        encrypted: true,
        passphrase: "file",
        status: {},
        backups: [backup],
      },
      "POST /api/backups": { ...backup, name: "box3balans-20261027-120000-manual.json.gz.enc" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Nu back-up maken" }));
    expect(await screen.findByText(/Back-up gemaakt: box3balans-20261027-120000-manual\.json\.gz\.enc/)).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Terugzetten…" }));
    const confirm = await screen.findByLabelText("Typ RESTORE om te bevestigen");
    const restore = screen.getByRole<HTMLButtonElement>("button", { name: "Terugzetten" });
    expect(restore.disabled).toBe(true);
    fireEvent.change(confirm, { target: { value: "RESTORE" } });
    expect(restore.disabled).toBe(false);
    fireEvent.click(restore);
    await waitFor(() =>
      expect(sent(api, "POST", `/api/backups/${encodeURIComponent(backup.name)}/restore`)).toEqual([
        { confirm: "RESTORE" },
      ]),
    );
  });
});
