import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// All quantities and money amounts are NUMERIC and surface as strings in JS;
// arithmetic is done with decimal.js (see src/lib/decimal.ts). Never floats.
const qty = (name: string) => numeric(name, { precision: 38, scale: 18 });
const money = (name: string) => numeric(name, { precision: 38, scale: 10 });

export const accountKind = pgEnum("account_kind", [
  "broker",
  "exchange",
  "vault",
  "wallet",
  "bank",
  "physical",
  "other",
]);

export const assetClass = pgEnum("asset_class", ["stock", "etf", "crypto", "metal", "cash", "other"]);

export const priceSource = pgEnum("price_source", ["yahoo", "coingecko", "metal", "fx", "manual"]);

export const txType = pgEnum("tx_type", [
  "buy",
  "sell",
  "deposit",
  "withdrawal",
  "transfer_in",
  "transfer_out",
  "dividend",
  "reward",
  "fee",
  "split",
]);

export const txSource = pgEnum("tx_source", ["manual", "csv", "api", "chain"]);

export const integrationProvider = pgEnum("integration_provider", ["bitvavo", "kraken", "coinbase", "ibkr"]);

export const metal = pgEnum("metal", ["gold", "silver", "platinum", "palladium"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  // SHA-256 of the session token; the raw token only lives in the cookie.
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: accountKind("kind").notNull(),
  provider: text("provider"),
  notes: text("notes"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assets = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    assetClass: assetClass("asset_class").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    isin: text("isin"),
    // Currency the provider quotes the price in (after normalisation, e.g. GBp -> GBP).
    currency: text("currency").notNull().default("EUR"),
    priceSource: priceSource("price_source").notNull(),
    // Provider-specific id: Yahoo ticker, CoinGecko id, metal code (XAU), currency code.
    priceRef: text("price_ref"),
    // Unit a quantity of this asset is counted in; metals are tracked in grams.
    unit: text("unit").notNull().default("unit"),
    chain: text("chain"),
    contract: text("contract"),
    hidden: boolean("hidden").notNull().default(false),
    // Yearly running costs of a fund (TER / OCF) in %, entered by the user; for the cost overview.
    terPct: numeric("ter_pct", { precision: 6, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assets_price_ref_uq")
      .on(t.priceSource, t.priceRef)
      .where(sql`${t.priceRef} is not null`),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    type: txType("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // For splits: the split ratio (new shares per old share).
    quantity: qty("quantity").notNull().default("0"),
    // Price per unit in `currency`.
    price: money("price").notNull().default("0"),
    currency: text("currency").notNull().default("EUR"),
    // EUR per 1 unit of `currency` at the time of the transaction.
    fxRate: money("fx_rate").notNull().default("1"),
    // Fees are always recorded in EUR.
    feeEur: money("fee_eur").notNull().default("0"),
    // Dividends: gross cash amount and tax withheld, in `currency`.
    amount: money("amount").notNull().default("0"),
    taxWithheld: money("tax_withheld").notNull().default("0"),
    // Links the two legs of a transfer between accounts.
    transferGroup: text("transfer_group"),
    // Set when the user unlinked an auto-matched transfer: never auto-match this row again.
    noAutoMatch: boolean("no_auto_match").notNull().default(false),
    // Cash asset (same account, same currency as `currency`) that pays for buys and receives
    // sale proceeds and dividends. Null means cash is not tracked for this transaction.
    settleAssetId: integer("settle_asset_id").references(() => assets.id, { onDelete: "restrict" }),
    source: txSource("source").notNull().default("manual"),
    externalId: text("external_id"),
    // CSV import that created the row, so a whole import can be undone.
    importId: integer("import_id").references(() => imports.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_asset_idx").on(t.assetId),
    index("transactions_account_idx").on(t.accountId),
    index("transactions_import_idx").on(t.importId),
    uniqueIndex("transactions_external_uq")
      .on(t.accountId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);

// One CSV import into an account; undoing it deletes the transactions it created.
export const imports = pgTable("imports", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  // Rows in the file, and transactions it created.
  rows: integer("rows").notNull(),
  inserted: integer("inserted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const metalItems = pgTable("metal_items", {
  id: serial("id").primaryKey(),
  // Where the item is stored (a "physical" account such as "Home safe").
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "restrict" }),
  metal: metal("metal").notNull(),
  product: text("product").notNull(),
  // Per piece.
  grossWeightG: qty("gross_weight_g").notNull(),
  purity: numeric("purity", { precision: 10, scale: 6 }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  purchaseDate: date("purchase_date").notNull(),
  // Total paid for all pieces, including dealer premium and costs.
  purchasePriceEur: money("purchase_price_eur").notNull(),
  // Spot value of the fine metal at purchase (EUR, all pieces), used to derive the premium paid.
  spotValueAtPurchaseEur: money("spot_value_at_purchase_eur"),
  dealer: text("dealer"),
  notes: text("notes"),
  soldDate: date("sold_date"),
  salePriceEur: money("sale_price_eur"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Photos of physical metal items (e.g. for insurance), resized in the browser before upload.
export const metalPhotos = pgTable(
  "metal_photos",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => metalItems.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    // Base64, so JSON backups carry photos as they are.
    data: text("data").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("metal_photos_item_idx").on(t.itemId)],
);

export const pricesLatest = pgTable("prices_latest", {
  assetId: integer("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  price: money("price").notNull(),
  currency: text("currency").notNull(),
  priceEur: money("price_eur").notNull(),
  changePct24h: numeric("change_pct_24h", { precision: 20, scale: 8 }),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export const priceHistory = pgTable(
  "price_history",
  {
    assetId: integer("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    close: money("close").notNull(),
    currency: text("currency").notNull(),
    closeEur: money("close_eur").notNull(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.day] })],
);

// ECB reference rates: units of `currency` per 1 EUR.
export const fxRates = pgTable(
  "fx_rates",
  {
    currency: text("currency").notNull(),
    day: date("day").notNull(),
    perEur: money("per_eur").notNull(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.day] })],
);

export const netWorthSnapshots = pgTable("net_worth_snapshots", {
  day: date("day").primaryKey(),
  totalEur: money("total_eur").notNull(),
  byClass: jsonb("by_class").$type<Record<string, string>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

// Read-only API connections that sync an account's history from an exchange or broker.
export const integrations = pgTable("integrations", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  provider: integrationProvider("provider").notNull(),
  // AES-256-GCM encrypted JSON credentials (see src/lib/secrets.ts). Never returned by the API.
  credentials: text("credentials").notNull(),
  // Non-secret hint so the user can tell keys apart, e.g. "…a1b2".
  keyHint: text("key_hint"),
  enabled: boolean("enabled").notNull().default(true),
  // Provider-specific incremental sync state.
  cursor: jsonb("cursor").$type<Record<string, unknown>>(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastResult: jsonb("last_result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// External ids of synced transactions the user deleted, so a later sync doesn't re-create them.
export const syncIgnored = pgTable(
  "sync_ignored",
  {
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    source: txSource("source").notNull(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.source, t.externalId] })],
);

// Public addresses (or extended public keys) watched on-chain. Several can belong to one account;
// a sync covers all addresses of an account on one chain together so internal moves net out.
export const walletAddresses = pgTable(
  "wallet_addresses",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    chain: text("chain").notNull(),
    // Address, or xpub/ypub/zpub for Bitcoin-like chains.
    address: text("address").notNull(),
    label: text("label"),
    // Bitcoin script type override for extended keys: p2pkh | p2sh-p2wpkh | p2wpkh | p2tr.
    scriptType: text("script_type"),
    // Import tokens CoinGecko doesn't know (normally skipped as likely spam).
    includeUnlisted: boolean("include_unlisted").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastStatus: text("last_status"),
    lastResult: jsonb("last_result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wallet_addresses_uq").on(t.accountId, t.chain, t.address)],
);

// Cache of token contract → asset lookups (CoinGecko), including "not listed" results.
export const tokenContracts = pgTable(
  "token_contracts",
  {
    chain: text("chain").notNull(),
    contract: text("contract").notNull(), // lower-case for EVM
    assetId: integer("asset_id").references(() => assets.id, { onDelete: "set null" }),
    symbol: text("symbol"),
    name: text("name"),
    listed: boolean("listed").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chain, t.contract] })],
);
