/**
 * Loads a small demo portfolio through the HTTP API (for local development only).
 * Usage: SESSION=<pd_session cookie value> npx tsx scripts/sample-data.ts [baseUrl]
 */
const base = process.argv[2] ?? "http://localhost:8080";
const session = process.env.SESSION;
if (!session) throw new Error("Set SESSION to a pd_session cookie value");

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    headers: { "x-requested-with": "portfolio", "content-type": "application/json", cookie: `pd_session=${session}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

const acc = async (name: string, kind: string, provider?: string) =>
  (await call("POST", "/api/accounts", { name, kind, provider })).id as number;
const asset = async (body: object) => (await call("POST", "/api/assets", body)).id as number;
const tx = (body: object) => call("POST", "/api/transactions", body);
const at = (d: string) => `${d}T12:00:00Z`;

const degiro = await acc("DEGIRO", "broker", "degiro");
const tr = await acc("Trade Republic", "broker", "trade-republic");
const bitvavo = await acc("Bitvavo", "exchange", "bitvavo");
const ledger = await acc("Ledger Nano", "wallet");
const goldrepublic = await acc("Goldrepublic", "vault", "goldrepublic");
const safe = await acc("Home safe", "physical");

const iwda = await asset({
  assetClass: "etf",
  name: "iShares Core MSCI World UCITS ETF",
  symbol: "IWDA",
  isin: "IE00B4L5Y983",
  priceSource: "yahoo",
  priceRef: "IWDA.AS",
});
const asml = await asset({
  assetClass: "stock",
  name: "ASML Holding",
  symbol: "ASML",
  isin: "NL0010273215",
  priceSource: "yahoo",
  priceRef: "ASML.AS",
});
const aapl = await asset({
  assetClass: "stock",
  name: "Apple Inc.",
  symbol: "AAPL",
  isin: "US0378331005",
  priceSource: "yahoo",
  priceRef: "AAPL",
});
const btc = await asset({
  assetClass: "crypto",
  name: "Bitcoin",
  symbol: "BTC",
  priceSource: "coingecko",
  priceRef: "bitcoin",
});
const eth = await asset({
  assetClass: "crypto",
  name: "Ethereum",
  symbol: "ETH",
  priceSource: "coingecko",
  priceRef: "ethereum",
});
const assets = await call<any[]>("GET", "/api/assets");
const gold = assets.find((a) => a.priceRef === "XAU").id;
const silver = assets.find((a) => a.priceRef === "XAG").id;
const eur = assets.find((a) => a.priceRef === "EUR").id;

await tx({ accountId: degiro, assetId: eur, type: "deposit", occurredAt: at("2023-01-02"), quantity: "1250" });
await tx({
  accountId: degiro,
  assetId: iwda,
  type: "buy",
  occurredAt: at("2023-01-10"),
  quantity: "120",
  price: "71.20",
  feeEur: "1",
});
await tx({
  accountId: degiro,
  assetId: iwda,
  type: "buy",
  occurredAt: at("2024-03-05"),
  quantity: "60",
  price: "88.40",
  feeEur: "1",
});
await tx({
  accountId: degiro,
  assetId: asml,
  type: "buy",
  occurredAt: at("2023-06-15"),
  quantity: "8",
  price: "650",
  feeEur: "2",
});
await tx({
  accountId: degiro,
  assetId: asml,
  type: "sell",
  occurredAt: at("2024-07-11"),
  quantity: "3",
  price: "980",
  feeEur: "2",
});
await tx({
  accountId: degiro,
  assetId: asml,
  type: "dividend",
  occurredAt: at("2024-05-02"),
  amount: "8.80",
  taxWithheld: "1.32",
});
await tx({
  accountId: tr,
  assetId: aapl,
  type: "buy",
  occurredAt: at("2024-01-15"),
  quantity: "15",
  price: "185.50",
  currency: "USD",
  feeEur: "1",
});
await tx({
  accountId: tr,
  assetId: aapl,
  type: "dividend",
  occurredAt: at("2024-08-15"),
  amount: "3.75",
  taxWithheld: "0.56",
  currency: "USD",
});
await tx({
  accountId: bitvavo,
  assetId: btc,
  type: "buy",
  occurredAt: at("2022-11-20"),
  quantity: "0.35",
  price: "16200",
  feeEur: "14",
});
await tx({
  accountId: bitvavo,
  assetId: btc,
  type: "buy",
  occurredAt: at("2024-02-01"),
  quantity: "0.1",
  price: "39500",
  feeEur: "10",
});
await call("POST", "/api/transactions/transfer", {
  fromAccountId: bitvavo,
  toAccountId: ledger,
  assetId: btc,
  occurredAt: at("2024-02-03"),
  quantity: "0.3",
  receivedQuantity: "0.2999",
});
await tx({
  accountId: bitvavo,
  assetId: eth,
  type: "buy",
  occurredAt: at("2023-04-04"),
  quantity: "2.5",
  price: "1650",
  feeEur: "8",
});
await tx({
  accountId: bitvavo,
  assetId: eth,
  type: "reward",
  occurredAt: at("2024-06-30"),
  quantity: "0.042",
  price: "3150",
});
await tx({
  accountId: goldrepublic,
  assetId: gold,
  type: "buy",
  occurredAt: at("2023-09-01"),
  quantity: "50",
  price: "58.10",
});
await tx({
  accountId: goldrepublic,
  assetId: silver,
  type: "buy",
  occurredAt: at("2024-04-10"),
  quantity: "1000",
  price: "0.82",
});

await call("POST", "/api/metals/items", {
  accountId: safe,
  metal: "gold",
  product: "Krugerrand 1 oz",
  grossWeightG: "33.93",
  purity: "0.9167",
  quantity: 2,
  purchaseDate: "2023-03-14",
  purchasePriceEur: "3720",
  spotValueAtPurchaseEur: "3560",
  dealer: "Holland Gold",
});
await call("POST", "/api/metals/items", {
  accountId: safe,
  metal: "gold",
  product: "Gouden Tientje (10 gulden)",
  grossWeightG: "6.729",
  purity: "0.900",
  quantity: 5,
  purchaseDate: "2022-10-08",
  purchasePriceEur: "1620",
});
await call("POST", "/api/metals/items", {
  accountId: safe,
  metal: "silver",
  product: "Maple Leaf 1 oz",
  grossWeightG: "31.11",
  purity: "0.9999",
  quantity: 25,
  purchaseDate: "2023-11-20",
  purchasePriceEur: "720",
  spotValueAtPurchaseEur: "560",
});

const refresh = await call("POST", "/api/prices/refresh", {});
console.log("sample data loaded; refresh:", JSON.stringify(refresh));
