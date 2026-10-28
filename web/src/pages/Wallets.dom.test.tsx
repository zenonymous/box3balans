// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChainInfo, WalletAddress, WalletSyncResult } from "../api";
import { showPage } from "../test/pages";
import { WalletsPage } from "./Wallets";

/** Wallets tracked by public address: a synced group, removing addresses, and adding one on two chains. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

const chain = (id: string, label: string, symbol: string, evm: boolean): ChainInfo => ({
  id,
  label,
  nativeSymbol: symbol,
  addressHint: "",
  supportsXpub: id === "bitcoin",
  scriptTypes: [],
  evm,
  unavailable: null,
});
const CHAINS = [
  chain("bitcoin", "Bitcoin", "BTC", false),
  chain("ethereum", "Ethereum", "ETH", true),
  chain("base", "Base", "ETH", true),
];

const result = (patch: Partial<WalletSyncResult> = {}): WalletSyncResult => ({
  at: "2026-10-28T08:00:00Z",
  status: "ok",
  durationMs: 1200,
  fetched: 12,
  inserted: 3,
  duplicates: 9,
  ignored: 0,
  transfersMatched: 1,
  newAssets: [],
  mismatches: [],
  skippedTokens: [],
  pendingTokens: 0,
  partial: false,
  warnings: [],
  ...patch,
});

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const wallet = (patch: Partial<WalletAddress> = {}): WalletAddress => ({
  id: 1,
  accountId: 20,
  accountName: "Ledger",
  chain: "ethereum",
  address: ADDRESS,
  label: "Ledger sparen",
  scriptType: null,
  includeUnlisted: false,
  enabled: true,
  lastSyncAt: "2026-10-28T08:00:00Z",
  lastStatus: "ok",
  lastResult: result(),
  running: false,
  ...patch,
});

const show = (wallets: WalletAddress[] | (() => WalletAddress[]), routes: Record<string, unknown> = {}) =>
  showPage("/wallets", "wallets", <WalletsPage />, {
    "GET /api/wallets/chains": CHAINS,
    "GET /api/wallets": wallets,
    ...routes,
  });

describe("Wallets page", () => {
  it("shows a synced wallet with what needs attention, and includes unrecognised tokens on request", async () => {
    const api = show([
      wallet({
        lastStatus: "warning",
        lastResult: result({
          status: "warning",
          newAssets: ["LINK"],
          skippedTokens: [
            { symbol: "SCAM", contract: "0xdead" },
            { symbol: "FREE", contract: "0xbeef" },
          ],
        }),
      }),
    ]);
    expect(await screen.findByText("⚠ aandacht nodig")).toBeTruthy();
    expect(screen.getByText("Ledger sparen")).toBeTruthy();
    expect(screen.getByText("Nieuwe beleggingen toegevoegd: LINK")).toBeTruthy();
    expect(screen.getByText("Geïmporteerd").nextElementSibling!.textContent).toBe("3 nieuw van 12");

    fireEvent.click(screen.getByRole("button", { name: "2 onbekende tokens overgeslagen" }));
    expect(screen.getByText("SCAM · 0xdead")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toch meenemen" }));
    await waitFor(() => expect(sent(api, "POST", "/api/wallets/sync")).toHaveLength(1));
    expect(sent(api, "PUT", "/api/wallets/1")).toEqual([{ includeUnlisted: true }]);
    expect(sent(api, "POST", "/api/wallets/sync")[0]).toEqual({ accountId: 20, chain: "ethereum" });
  });

  it("asks whether to delete the imported transactions when you remove a wallet's last address", async () => {
    const confirm = vi.fn((_message: string) => true);
    vi.stubGlobal("confirm", confirm);
    const api = show([wallet()]);
    fireEvent.click(await screen.findByRole("button", { name: `${ADDRESS} verwijderen` }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "DELETE")).toBe(true));
    expect(confirm.mock.calls[0]![0]).toMatch(/Ook de transacties verwijderen die van Ethereum/);
    expect(api.requests.filter((r) => r.method === "DELETE").map((r) => r.url)).toEqual([
      "/api/wallets/1?deleteTransactions=true",
    ]);
    // The last address: nothing left to sync.
    expect(sent(api, "POST", "/api/wallets/sync")).toHaveLength(0);
  });

  it("removes one of several addresses only after you confirm, then syncs the rest again", async () => {
    vi.stubGlobal("confirm", () => false);
    const second = wallet({ id: 2, address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", label: null });
    const api = show([wallet(), second]);
    const remove = await screen.findByRole("button", { name: `${second.address} verwijderen` });
    fireEvent.click(remove);
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);

    vi.stubGlobal("confirm", () => true);
    fireEvent.click(remove);
    await waitFor(() => expect(sent(api, "POST", "/api/wallets/sync")).toHaveLength(1));
    expect(api.requests.filter((r) => r.method === "DELETE").map((r) => r.url)).toEqual([
      "/api/wallets/2?deleteTransactions=false",
    ]);
  });

  it("adds an address on two EVM chains into one new account, and shows what each import did", async () => {
    let added: WalletAddress[] = [];
    let nextId = 10;
    const api = show(() => added, {
      "POST /api/wallets": (body: unknown) => {
        const b = body as { chain: string; accountId?: number };
        added = [...added, wallet({ id: nextId++, accountId: 30, accountName: "Ethereum-wallet", chain: b.chain })];
        return { accountId: 30 };
      },
    });
    expect(await screen.findByText("Nog geen wallets")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Adres toevoegen" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Blockchain"), { target: { value: "ethereum" } });
    fireEvent.change(within(dialog).getByLabelText(/Openbaar adres/), { target: { value: ADDRESS } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Base" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Toevoegen en importeren" }));

    await waitFor(() => expect(within(dialog).getAllByText(/3 transacties geïmporteerd/)).toHaveLength(2));
    expect(sent(api, "POST", "/api/wallets")).toEqual([
      expect.objectContaining({ chain: "ethereum", address: ADDRESS, accountName: "Ethereum-wallet", label: null }),
      // The second chain goes into the account the first one made.
      expect.objectContaining({ chain: "base", address: ADDRESS, accountId: 30 }),
    ]);
    expect(within(dialog).getByText("Base")).toBeTruthy();
  });
});
