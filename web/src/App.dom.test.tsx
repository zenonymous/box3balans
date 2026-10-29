// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./App";
import { fakeDemoApi } from "./test/api";
import demo from "./test/demo.fixture.json";

/** Creating the first account (with the setup code from the log) and signing in, with two-step verification. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(routes: Record<string, unknown>) {
  const api = fakeDemoApi(demo, routes);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthGate />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}

const sent = (api: ReturnType<typeof show>, url: string) =>
  api.requests.filter((r) => r.method === "POST" && r.url === url).map((r) => r.body);
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const signedIn = { user: { id: 1, username: "sanne" } };

describe("first start and signing in", () => {
  it("creates the first account only with matching passwords and the setup code", async () => {
    const api = show({
      "GET /api/auth/state": { needsSetup: true, needsSetupCode: true, user: null, language: "nl" },
      "POST /api/auth/setup": signedIn,
    });
    expect(await screen.findByRole("heading", { name: "Welkom: maak je account aan" })).toBeTruthy();
    // Where to find the setup code is read out with the field.
    const described = screen.getByLabelText("Setupcode").getAttribute("aria-describedby");
    expect(document.getElementById(described ?? "")?.textContent).toMatch(/^Box3balans zette hem bij het starten/);
    fill("Gebruikersnaam", "sanne");
    fill("Wachtwoord", "correct horse battery");
    fill("Herhaal wachtwoord", "correct horse batery");
    fill("Setupcode", "K7QX2-MPF9R");
    fireEvent.click(screen.getByRole("button", { name: "Account aanmaken" }));
    expect(await screen.findByText("De wachtwoorden zijn niet gelijk")).toBeTruthy();
    expect(sent(api, "/api/auth/setup")).toEqual([]);

    fill("Herhaal wachtwoord", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Account aanmaken" }));
    await waitFor(() =>
      expect(sent(api, "/api/auth/setup")).toEqual([
        { username: "sanne", password: "correct horse battery", setupCode: "K7QX2-MPF9R" },
      ]),
    );
    // Signed in: the app opens on the overview.
    expect(await screen.findByRole("heading", { level: 1, name: "Overzicht" })).toBeTruthy();
  });

  it("says what the server found wrong, without its field names, and announces it", async () => {
    let answer!: (r: Response) => void;
    show({
      "GET /api/auth/state": { needsSetup: true, needsSetupCode: true, user: null, language: "nl" },
      "POST /api/auth/setup": () => new Promise<Response>((r) => (answer = r)),
    });
    await screen.findByLabelText("Gebruikersnaam");
    fill("Gebruikersnaam", "sanne");
    fill("Wachtwoord", "correct horse battery");
    fill("Herhaal wachtwoord", "correct horse battery");
    fill("Setupcode", "K7QX2-MPF9R");
    fireEvent.click(screen.getByRole("button", { name: "Account aanmaken" }));
    // While it waits, the button still says what it does.
    expect(await screen.findByRole("button", { name: "Account aanmaken…" })).toBeTruthy();
    answer(
      Response.json(
        {
          error: "Ongeldige invoer",
          issues: [{ path: ["username"], message: "De gebruikersnaam mag hoogstens 64 tekens hebben" }],
        },
        { status: 400 },
      ),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/^\W*De gebruikersnaam mag hoogstens 64 tekens hebben$/);
  });

  it("asks for the authenticator code when the account has two-step verification", async () => {
    let attempts = 0;
    const api = show({
      "GET /api/auth/state": { needsSetup: false, user: null, language: "nl" },
      "POST /api/auth/login": (body: { code?: string }) => {
        attempts++;
        return body.code ? signedIn : Response.json({ error: "Code nodig", needsCode: true }, { status: 401 });
      },
    });
    await screen.findByLabelText("Gebruikersnaam");
    fill("Gebruikersnaam", "sanne");
    fill("Wachtwoord", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Inloggen" }));
    const code = await screen.findByLabelText("Code uit je authenticator-app");
    // A recovery code has letters too: no number keypad on a phone.
    expect(code.getAttribute("inputmode")).not.toBe("numeric");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Inloggen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Overzicht" })).toBeTruthy();
    expect(attempts).toBe(2);
    expect(sent(api, "/api/auth/login")[1]).toEqual({
      username: "sanne",
      password: "correct horse battery",
      code: "123456",
    });
  });
});
