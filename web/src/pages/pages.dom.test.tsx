// @vitest-environment happy-dom
import { cleanup, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { AccountsPage } from "./Accounts";
import { ActivityPage } from "./Activity";
import { AssetsPage } from "./Assets";
import { AttentionPage } from "./Attention";
import { Box3Page } from "./Box3";
import { ConnectionsPage } from "./Connections";
import { DossierPage } from "./Dossier";
import { HoldingsPage } from "./Holdings";
import { HouseholdPage } from "./Household";
import { ImportPage } from "./Import";
import { IncomePage } from "./Income";
import { InventoryPage } from "./Inventory";
import { MetalsPage } from "./Metals";
import { NetworkPage } from "./Network";
import { OverviewPage } from "./Overview";
import { PerformancePage } from "./Performance";
import { SettingsPage } from "./Settings";
import { StartPage } from "./Start";
import { TaxReturnPage } from "./TaxReturn";
import { TransactionsPage } from "./Transactions";
import { WalletsPage } from "./Wallets";

/**
 * Every page, inside the app's layout, with the demo household's answers (demo.fixture.json). Each
 * shows its title and something only the data can give, and asks for nothing the demo can't answer.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAGES: [string, string, ReactElement, string, string][] = [
  // path, route, page, title, something from the data
  ["/", "/", <OverviewPage />, "Overzicht", "Grootste posities"],
  ["/holdings", "holdings", <HoldingsPage />, "Posities", "Bitcoin"],
  ["/performance", "performance", <PerformancePage />, "Resultaat", "Gerealiseerd"],
  ["/performance?tab=returns", "performance", <PerformancePage />, "Resultaat", "Tijdgewogen"],
  ["/performance?tab=costs", "performance", <PerformancePage />, "Resultaat", "Lopende fondskosten"],
  ["/income", "income", <IncomePage />, "Inkomsten", "ASML Holding"],
  ["/box3?year=2025", "box3", <Box3Page />, "Box 3 (sparen en beleggen)", "Berekening 2025"],
  [
    "/box3/aangifte?year=2025",
    "box3/aangifte",
    <TaxReturnPage />,
    "Voor de aangifte 2025",
    "Bankrekeningen en andere banktegoeden",
  ],
  ["/box3/2025/dossier", "box3/:year/dossier", <DossierPage />, "Box 3-dossier 2025", "Sanne & Daan"],
  ["/transactions", "transactions", <TransactionsPage />, "Transacties", "Bitcoin"],
  ["/transactions/import", "transactions/import", <ImportPage />, "CSV importeren", "Sjabloon"],
  ["/metals", "metals", <MetalsPage />, "Edelmetalen", "Fysieke stukken"],
  ["/metals/inventory", "metals/inventory", <InventoryPage />, "Inventaris edelmetalen", "Krugerrand"],
  ["/accounts", "accounts", <AccountsPage />, "Rekeningen", "Studieschuld"],
  ["/household", "household", <HouseholdPage />, "Huishouden", "Wordt 18 op 12 apr 2034"],
  ["/start", "start", <StartPage />, "Aan de slag", "Daan"],
  ["/connections", "connections", <ConnectionsPage />, "Koppelingen", "Bitvavo"],
  ["/wallets", "wallets", <WalletsPage />, "Wallets", "Nog geen wallets"],
  ["/assets", "assets", <AssetsPage />, "Beleggingen", "iShares Core MSCI World UCITS ETF"],
  ["/settings", "settings", <SettingsPage />, "Instellingen", "Gemiddelde aankoopprijs"],
  ["/activity", "activity", <ActivityPage />, "Geschiedenis", "Studieschuld"],
  ["/attention", "attention", <AttentionPage />, "Aandacht nodig", "Mislukte syncs"],
  ["/network", "network", <NetworkPage />, "Netwerk", "api.gold-api.com"],
];

describe("every page with the demo household", () => {
  it.each(PAGES)("%s shows its title and its data", async (path, route, page, title, data) => {
    const api = showPage(path, route, page);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect((await screen.findAllByText(data, { exact: false })).length).toBeGreaterThan(0);
    expect(api.missed).toEqual([]);
  });
});
