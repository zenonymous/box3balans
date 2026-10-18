import { t } from "./i18n";

/**
 * The app's pages, once, for every menu: the sidebar, the bottom bar on phones and the "More pages"
 * list on Settings. A page left out of one of them must still be reachable from another.
 */
export interface Page {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  // Its line in "More pages".
  more?: string;
}

export const PAGES = {
  overview: { to: "/", label: t("Overview"), icon: "◎", end: true },
  holdings: { to: "/holdings", label: t("Holdings"), icon: "▤" },
  performance: {
    to: "/performance",
    label: t("Performance"),
    icon: "↗",
    more: t("↗ Performance — results per year, realized gains"),
  },
  income: { to: "/income", label: t("Income"), icon: "❖", more: t("❖ Income — dividends, staking rewards, interest") },
  box3: { to: "/box3", label: t("Box 3"), icon: "§" },
  transactions: { to: "/transactions", label: t("Transactions"), icon: "⇄" },
  accounts: {
    to: "/accounts",
    label: t("Accounts"),
    icon: "▣",
    more: t("▣ Accounts — brokers, exchanges, wallets, vaults, storage"),
  },
  connections: {
    to: "/connections",
    label: t("Connections"),
    icon: "⇅",
    more: t("⇅ Connections — sync Bitvavo, Kraken, Coinbase, Bitpanda and IBKR"),
  },
  wallets: {
    to: "/wallets",
    label: t("Wallets"),
    icon: "◈",
    more: t("◈ Wallets — track Bitcoin, Ethereum & L2s, Solana and more by address"),
  },
  metals: { to: "/metals", label: t("Metals"), icon: "◆", more: t("◆ Metals — coins and bars at home and in vaults") },
  assets: { to: "/assets", label: t("Assets"), icon: "◇", more: t("◇ Assets — instruments and price sources") },
  household: {
    to: "/household",
    label: t("Household"),
    icon: "⌂",
    more: t("⌂ Household — you, your partner and children, for box 3"),
  },
  activity: {
    to: "/activity",
    label: t("History"),
    icon: "↺",
    more: t("↺ History — every change, and restoring deleted transactions"),
  },
  start: {
    to: "/start",
    label: t("Start wizard"),
    icon: "✦",
    more: t("✦ Start wizard — set up your household, accounts and values step by step"),
  },
  network: {
    to: "/network",
    label: t("Network"),
    icon: "⇢",
    more: t("⇢ Network — where Box3balans may connect, and what it sent"),
  },
  settings: { to: "/settings", label: t("Settings"), icon: "⚙" },
} satisfies Record<string, Page>;

const P: Record<keyof typeof PAGES, Page> = PAGES;

// The sidebar in two groups: what you look at, and what you keep up to date. Settings sits apart.
export const NAV_GROUPS: { label: string; pages: Page[] }[] = [
  { label: t("Insight"), pages: [P.overview, P.holdings, P.performance, P.income, P.box3] },
  {
    label: t("Data"),
    pages: [P.transactions, P.accounts, P.connections, P.wallets, P.metals, P.assets, P.household],
  },
];

// The bottom bar on phones: the most used pages, then "More" (Settings, which lists the rest).
export const MOBILE_BAR: Page[] = [P.overview, P.holdings, P.box3, P.transactions];

const inSidebar = new Set(NAV_GROUPS.flatMap((g) => g.pages));

/** "More pages" on Settings: on phones everything the bottom bar leaves out, on larger screens what the sidebar does. */
export const MORE_PAGES = Object.values(P)
  .filter((p) => p.more && !MOBILE_BAR.includes(p))
  .map((p) => ({ ...p, more: p.more!, inSidebar: inSidebar.has(p) }));

export const isCurrent = (p: Page, pathname: string) =>
  p.end ? pathname === p.to : pathname === p.to || pathname.startsWith(`${p.to}/`);
