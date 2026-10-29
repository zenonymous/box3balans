// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { SettingsPage } from "./Settings";

/** Two-step verification, the backup passphrase and the update check, under Settings. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

describe("Settings: security", () => {
  it("turns on two-step verification with a code, and shows the recovery codes once", async () => {
    let enabled = false;
    const api = showPage("/settings", "settings", <SettingsPage />, {
      "GET /api/auth/2fa": () => ({ enabled, recoveryCodesLeft: enabled ? 10 : 0 }),
      "POST /api/auth/2fa/setup": { secret: "ABCDEFGHIJKLMNOP", qrSvg: "<svg/>" },
      "POST /api/auth/2fa/enable": () => {
        enabled = true;
        return { recoveryCodes: ["aaaa-bbbb", "cccc-dddd"] };
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Instellen" }));
    // The key, in groups of four, for entering by hand.
    expect(await screen.findByText("ABCD EFGH IJKL MNOP")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Code uit je authenticator-app"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Aanzetten" }));
    await waitFor(() => expect(sent(api, "POST", "/api/auth/2fa/enable")).toEqual([{ code: "123456" }]));
    expect(await screen.findByText("aaaa-bbbb")).toBeTruthy();
    expect(screen.getByText("cccc-dddd")).toBeTruthy();
  });

  it("lets you copy or download the recovery codes before they're gone", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal("isSecureContext", true);
    const saved: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => (saved.push(b as Blob), "blob:codes"));
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    showPage("/settings", "settings", <SettingsPage />, {
      "GET /api/auth/2fa": { enabled: false, recoveryCodesLeft: 0 },
      "POST /api/auth/2fa/setup": { secret: "ABCDEFGHIJKLMNOP", qrSvg: "<svg/>" },
      "POST /api/auth/2fa/enable": { recoveryCodes: ["aaaa-bbbb", "cccc-dddd"] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Instellen" }));
    fireEvent.change(await screen.findByLabelText("Code uit je authenticator-app"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Aanzetten" }));
    fireEvent.click(await screen.findByRole("button", { name: "Kopiëren" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("aaaa-bbbb\ncccc-dddd"));
    expect(await screen.findByRole("button", { name: "Gekopieerd" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Downloaden/ }));
    expect(await saved[0]!.text()).toBe("aaaa-bbbb\ncccc-dddd\n");
  });

  it("shows the backup passphrase only after your password", async () => {
    const api = showPage("/settings", "settings", <SettingsPage />, {
      "GET /api/backups": {
        dir: "/backups",
        intervalHours: 24,
        keep: 14,
        encrypted: true,
        passphrase: "file",
        status: {},
        backups: [],
      },
      "POST /api/backups/passphrase": { passphrase: "K7QX2-MPF9R-ABCDE-FGHJK-LMNPQ-RSTUV" },
    });
    const password = await screen.findByLabelText("Je wachtwoord");
    const form = password.closest("form")!;
    expect(within(form).getByRole<HTMLButtonElement>("button", { name: "Wachtzin tonen" }).disabled).toBe(true);
    fireEvent.change(password, { target: { value: "correct horse battery" } });
    fireEvent.click(within(form).getByRole("button", { name: "Wachtzin tonen" }));
    expect(await screen.findByText("K7QX2-MPF9R-ABCDE-FGHJK-LMNPQ-RSTUV")).toBeTruthy();
    expect(sent(api, "POST", "/api/backups/passphrase")).toEqual([{ password: "correct horse battery" }]);
  });

  it("turns on the update check and checks now", async () => {
    let on = false;
    const api = showPage("/settings", "settings", <SettingsPage />, {
      "GET /api/updates": () => ({ enabled: on, current: "0.1.42" }),
      "PUT /api/updates": (b: { enabled: boolean }) => {
        on = b.enabled;
        return { enabled: on, current: "0.1.42" };
      },
      "POST /api/updates/check": {
        enabled: true,
        current: "0.1.42",
        checkedAt: "2026-10-27T12:00:00.000Z",
        latest: {
          version: "0.1.42",
          name: "v0.1.42",
          url: "https://github.com/zenonymous/box3balans/releases/tag/v0.1.42",
          publishedAt: "2026-10-26T20:00:00.000Z",
        },
        newer: false,
      },
    });
    fireEvent.click(await screen.findByLabelText(/Controleren op nieuwe versies/));
    await waitFor(() => expect(sent(api, "PUT", "/api/updates")).toEqual([{ enabled: true }]));
    fireEvent.click(await screen.findByRole("button", { name: "Nu controleren" }));
    await waitFor(() => expect(sent(api, "POST", "/api/updates/check")).toHaveLength(1));
    expect(await screen.findByText(/Je hebt de nieuwste versie \(0\.1\.42\)/)).toBeTruthy();
  });
});
