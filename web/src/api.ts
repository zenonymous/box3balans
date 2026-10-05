export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: { path: (string | number)[]; message: string }[],
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      "x-requested-with": "portfolio",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/api/auth/")) onUnauthorized();
    const issues = data?.issues as ApiError["issues"];
    const detail = issues?.length ? issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") : "";
    throw new ApiError(res.status, detail || data?.error || res.statusText, issues);
  }
  return data as T;
}

/** Polls `fn` until `done` holds (e.g. waiting for a background sync), with a generous timeout. */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  intervalMs = 2_000,
  timeoutMs = 20 * 60_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (done(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export const get = <T>(url: string) => api<T>("GET", url);
export const post = <T>(url: string, body?: unknown) => api<T>("POST", url, body ?? {});
export const put = <T>(url: string, body: unknown) => api<T>("PUT", url, body);
export const del = <T>(url: string) => api<T>("DELETE", url);

// ---- Types mirroring the server responses ----

export type AssetClass = "stock" | "etf" | "crypto" | "metal" | "cash" | "other";
export type AccountKind = "broker" | "exchange" | "vault" | "wallet" | "bank" | "physical" | "other";
export type TxType =
  "buy" | "sell" | "deposit" | "withdrawal" | "transfer_in" | "transfer_out" | "dividend" | "reward" | "fee" | "split";
export type MetalName = "gold" | "silver" | "platinum" | "palladium";

export interface User {
  id: number;
  username: string;
}

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  provider: string | null;
  notes: string | null;
  archived: boolean;
  txCount: number;
  itemCount: number;
}

export interface LatestPrice {
  price: string;
  currency: string;
  priceEur: string;
  changePct24h: string | null;
  source: string;
  fetchedAt: string;
}

export interface Asset {
  id: number;
  assetClass: AssetClass;
  name: string;
  symbol: string;
  isin: string | null;
  currency: string;
  priceSource: "yahoo" | "coingecko" | "metal" | "fx" | "manual";
  priceRef: string | null;
  unit: string;
  hidden: boolean;
  price: LatestPrice | null;
}

export interface AssetCandidate {
  assetClass: "stock" | "etf" | "crypto";
  name: string;
  symbol: string;
  priceSource: "yahoo" | "coingecko";
  priceRef: string;
  exchange?: string;
  isin?: string;
}

export interface Transaction {
  id: number;
  accountId: number;
  assetId: number;
  type: TxType;
  occurredAt: string;
  quantity: string;
  price: string;
  currency: string;
  fxRate: string;
  feeEur: string;
  amount: string;
  taxWithheld: string;
  transferGroup: string | null;
  settleAssetId: number | null;
  externalId: string | null;
  source: "manual" | "csv" | "api" | "chain";
  notes: string | null;
  assetName: string;
  assetSymbol: string;
  assetClass: AssetClass;
  accountName: string;
}

export interface Holding {
  key: string;
  assetId: number;
  name: string;
  symbol: string;
  assetClass: AssetClass;
  unit: string;
  physical: boolean;
  quantity: string;
  avgCostEur: string | null;
  costEur: string;
  priceEur: string | null;
  valueEur: string;
  unrealizedEur: string;
  unrealizedPct: string | null;
  realizedEur: string;
  incomeEur: string;
  feesEur: string;
  localCurrency: string | null;
  priceEffectEur: string | null;
  fxEffectEur: string | null;
  changePct24h: string | null;
  dayChangeEur: string;
  weightPct: string;
  priceFetchedAt: string | null;
  priceStale: boolean;
  accounts: { accountId: number; accountName: string; quantity: string; valueEur: string; costEur: string }[];
}

export interface Summary {
  totalEur: string;
  costEur: string;
  unrealizedEur: string;
  realizedEur: string;
  incomeEur: string;
  dayChangeEur: string;
  dayChangePct: string | null;
  byClass: Record<AssetClass, string>;
  byAccount: { accountId: number; name: string; kind: AccountKind; valueEur: string }[];
  periodChanges: { period: "1W" | "1M" | "YTD"; fromDay: string; changeEur: string; changePct: string | null }[];
  missingPrices: string[];
  warnings: string[];
}

export interface Snapshot {
  day: string;
  totalEur: string;
  byClass: Record<AssetClass, string>;
}

export interface RefreshStatus {
  at: string;
  updated: number;
  failed: { assetId: number; symbol: string; error: string }[];
  fxDate?: string;
  fxError?: string;
}

export interface MetalProduct {
  metal: MetalName;
  name: string;
  grossWeightG: string;
  purity: string;
}

export interface MetalItem {
  id: number;
  accountId: number;
  accountName: string;
  metal: MetalName;
  product: string;
  grossWeightG: string;
  purity: string;
  quantity: number;
  purchaseDate: string;
  purchasePriceEur: string;
  spotValueAtPurchaseEur: string | null;
  dealer: string | null;
  notes: string | null;
  soldDate: string | null;
  salePriceEur: string | null;
  fineWeightG: string;
  fineWeightOz: string;
  valueEur: string | null;
  premiumEur: string | null;
  premiumPct: string | null;
  pnlEur: string | null;
  pnlPct: string | null;
}

export interface MetalsOverview {
  spot: { metal: MetalName; eurPerGram: string | null; eurPerOz: string | null }[];
  totals: {
    metal: MetalName;
    physicalG: string;
    vaultedG: string;
    totalG: string;
    totalOz: string;
    valueEur: string;
    costEur: string;
    pnlEur: string;
    premiumPaidEur: string;
    premiumPaidPct: string | null;
  }[];
  items: MetalItem[];
  vaulted: {
    metal: MetalName;
    accountId: number;
    accountName: string;
    grams: string;
    oz: string;
    costEur: string;
    valueEur: string | null;
    pnlEur: string | null;
  }[];
}

export type ProviderId = "bitvavo" | "kraken" | "coinbase" | "ibkr";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  accountKind: AccountKind;
  fields: { name: string; label: string; secret: boolean; multiline?: boolean; placeholder?: string }[];
  instructions: string[];
}

export interface Mismatch {
  assetId: number;
  symbol: string;
  reported: string;
  computed: string;
  difference: string;
}

export interface SyncResult {
  at: string;
  status: "ok" | "warning" | "error";
  durationMs: number;
  fetched: number;
  inserted: number;
  duplicates: number;
  ignored: number;
  transfersMatched: number;
  newAssets: string[];
  mismatches: Mismatch[];
  warnings: string[];
  error?: string;
}

export interface Integration {
  id: number;
  accountId: number;
  accountName: string;
  provider: ProviderId;
  keyHint: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  lastStatus: "ok" | "warning" | "error" | null;
  lastResult: SyncResult | null;
  running: boolean;
  intervalHours: number;
}

export interface ChainInfo {
  id: string;
  label: string;
  nativeSymbol: string;
  addressHint: string;
  supportsXpub: boolean;
  scriptTypes: string[];
}

export interface WalletSyncResult {
  at: string;
  status: "ok" | "warning" | "error";
  durationMs: number;
  fetched: number;
  inserted: number;
  duplicates: number;
  ignored: number;
  transfersMatched: number;
  newAssets: string[];
  mismatches: Mismatch[];
  skippedTokens: { symbol: string; contract: string }[];
  pendingTokens: number;
  partial: boolean;
  info?: string;
  warnings: string[];
  error?: string;
}

export interface WalletAddress {
  id: number;
  accountId: number;
  accountName: string;
  chain: string;
  address: string;
  label: string | null;
  scriptType: string | null;
  includeUnlisted: boolean;
  enabled: boolean;
  lastSyncAt: string | null;
  lastStatus: "ok" | "warning" | "error" | null;
  lastResult: WalletSyncResult | null;
  running: boolean;
}

export interface HistoryPoint {
  day: string;
  totalEur: number;
  byClass: Record<AssetClass, number>;
  investedEur: number;
  unrealizedEur: number;
}

export interface HistoryResponse {
  points: HistoryPoint[];
  estimated: { symbol: string; until: string }[];
}

export interface YearResult {
  year: number;
  realizedEur: string;
  dividendsEur: string;
  rewardsEur: string;
  interestEur: string;
  incomeEur: string;
  unrealizedChangeEur: string;
  resultEur: string;
  feesEur: string;
  taxWithheldEur: string;
  netWorthStartEur: string | null;
  netWorthEndEur: string;
}

export interface RealizedRow {
  kind: "sale" | "fee";
  txId: number;
  date: string;
  assetId: number;
  symbol: string;
  name: string;
  accountName: string;
  quantity: string;
  proceedsEur: string;
  costEur: string;
  gainEur: string;
  physical: boolean;
}

export interface Performance {
  costMethod: "average" | "fifo";
  years: YearResult[];
  allTime: { realizedEur: string; incomeEur: string; unrealizedEur: string; resultEur: string; feesEur: string };
  byAsset: {
    key: string;
    assetId: number;
    name: string;
    symbol: string;
    assetClass: AssetClass;
    valueEur: string;
    costEur: string;
    unrealizedEur: string;
    realizedEur: string;
    incomeEur: string;
    feesEur: string;
    totalEur: string;
    localCurrency: string | null;
    priceEffectEur: string | null;
    fxEffectEur: string | null;
  }[];
  realized: RealizedRow[];
}

export interface IncomeEvent {
  txId: number;
  date: string;
  kind: "dividend" | "reward" | "interest";
  assetId: number;
  symbol: string;
  name: string;
  accountName: string;
  grossEur: string;
  taxEur: string;
  netEur: string;
}

export interface IncomeResponse {
  events: IncomeEvent[];
  byYear: {
    year: number;
    dividendsEur: string;
    rewardsEur: string;
    interestEur: string;
    totalEur: string;
    taxWithheldEur: string;
  }[];
  byMonth: { month: string; dividendsEur: string; rewardsEur: string; interestEur: string }[];
  byAsset: {
    assetId: number;
    symbol: string;
    name: string;
    count: number;
    grossEur: string;
    taxEur: string;
    netEur: string;
  }[];
}

export type Box3Category = "bank" | "other" | "exempt" | "excluded";

export interface Box3Rates {
  bankPct: string;
  otherPct: string;
  debtPct: string;
  allowanceEur: string;
  debtThresholdEur: string;
  taxRatePct: string;
  greenExemptEur: string;
  greenCreditPct: string;
  final: boolean;
}

export interface Box3Config {
  mapping: {
    cashByAccountKind: Record<string, Box3Category>;
    classCategory: Record<string, Box3Category>;
    accountOverrides: Record<string, Box3Category>;
  };
  rates: Record<string, Box3Rates>;
  years: Record<string, { partner: boolean; debtsEur: string; extraOtherEur: string; extraBankEur: string }>;
}

export interface Box3Overview {
  years: number[];
  config: Box3Config;
  defaultRates: Record<string, Box3Rates>;
  accounts: { id: number; name: string; kind: AccountKind; archived: boolean }[];
}

export interface Box3Row {
  accountId: number;
  accountName: string;
  accountKind: string;
  assetId: number;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  physical: boolean;
  quantity: string;
  unit: string;
  priceEur: string | null;
  priceDay: string | null;
  valueEur: string;
  category: Box3Category;
  missingPrice: boolean;
}

export interface Box3Year {
  year: number;
  peildatum: string;
  valuedAt: string;
  partner: boolean;
  rates: (Box3Rates & { source: "default" | "custom" }) | null;
  totals: Record<Box3Category, string>;
  otherBreakdown: { investments: string; crypto: string; metals: string; cash: string; other: string };
  extra: { bankEur: string; otherEur: string; debtsEur: string };
  calculation: {
    bankEur: string;
    otherEur: string;
    debtsEur: string;
    deductibleDebtsEur: string;
    deemedReturnEur: string;
    baseEur: string;
    allowanceEur: string;
    taxableBaseEur: string;
    sharePct: string;
    benefitEur: string;
    taxEur: string;
    greenEur: string;
    greenExemptEur: string;
    greenAboveLimitEur: string;
    greenCreditEur: string;
    netTaxEur: string;
  } | null;
  rows: Box3Row[];
  warnings: string[];
  actual: { resultEur: string; complete: boolean } | null;
}
