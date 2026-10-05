/**
 * Times the main pages against a large synthetic history, to see how the app scales before real
 * data does. Uses the in-memory test database (PGlite, slower than real PostgreSQL) and stubbed
 * price APIs, so nothing leaves this machine.
 *
 *   npx tsx scripts/bench.ts [scale]     # scale 1 ≈ 15,000 transactions over 5 years
 */
import { assets, accounts, priceHistory, transactions } from "../src/db/schema.js";
import { createTestApp } from "../test/helpers.js";

const scale = Number(process.argv[2] ?? 1);
const t = await createTestApp();
const db = t.database.db;

// Deterministic pseudo-random numbers, so runs are comparable.
let seedState = 42;
const rand = () => (seedState = (seedState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

const START = Date.UTC(2021, 0, 1);
const DAYS = Math.floor((Date.now() - START) / 86_400_000);
const dayStr = (d: number) => new Date(START + d * 86_400_000).toISOString().slice(0, 10);
const at = (d: number) => new Date(START + d * 86_400_000 + 12 * 3_600_000);

const accs = await db
  .insert(accounts)
  .values([
    { name: "DEGIRO", kind: "broker" as const },
    { name: "IBKR", kind: "broker" as const },
    { name: "Bitvavo", kind: "exchange" as const },
    { name: "Kraken", kind: "exchange" as const },
    { name: "Ledger", kind: "wallet" as const },
  ])
  .returning();
const eur = (await db.select().from(assets)).find((a) => a.priceRef === "EUR")!;
const securities = await db
  .insert(assets)
  .values(
    Array.from({ length: 15 }, (_, i) => ({
      assetClass: "etf" as const,
      name: `ETF ${i}`,
      symbol: `ETF${i}`,
      priceSource: "yahoo" as const,
      priceRef: `ETF${i}.AS`,
      currency: "EUR",
    })),
  )
  .returning();
const coins = await db
  .insert(assets)
  .values(
    Array.from({ length: 25 }, (_, i) => ({
      assetClass: "crypto" as const,
      name: `Coin ${i}`,
      symbol: `C${i}`,
      priceSource: "coingecko" as const,
      priceRef: `coin-${i}`,
    })),
  )
  .returning();

// Daily closes for every asset: a random walk.
const history: (typeof priceHistory.$inferInsert)[] = [];
for (const a of [...securities, ...coins]) {
  let p = 20 + rand() * 100;
  for (let d = 0; d <= DAYS; d++) {
    p *= 1 + (rand() - 0.495) * 0.04;
    history.push({ assetId: a.id, day: dayStr(d), close: p.toFixed(6), currency: "EUR", closeEur: p.toFixed(6) });
  }
}
for (let i = 0; i < history.length; i += 5_000) await db.insert(priceHistory).values(history.slice(i, i + 5_000));

type Tx = typeof transactions.$inferInsert;
const txs: Tx[] = [];
const base = (accountId: number, assetId: number, d: number): Tx => ({
  accountId,
  assetId,
  type: "buy",
  occurredAt: at(d),
  source: "manual",
});
const [degiro, ibkr, bitvavo, kraken, ledger] = accs.map((a) => a.id) as [number, number, number, number, number];
for (let s = 0; s < scale; s++) {
  for (let d = 0; d <= DAYS; d++) {
    // Brokers: a monthly deposit and buys, quarterly dividends, a few sales.
    if (d % 30 === 0)
      for (const acc of [degiro, ibkr]) {
        txs.push({ ...base(acc, eur.id, d), type: "deposit", quantity: "2000", price: "1" });
        for (const sec of securities.slice(acc === degiro ? 0 : 8, acc === degiro ? 8 : 15).slice(0, 3))
          txs.push({ ...base(acc, sec.id, d), quantity: "5", price: "60", feeEur: "1", settleAssetId: eur.id });
      }
    if (d % 91 === 45)
      for (const sec of securities)
        txs.push({ ...base(degiro, sec.id, d), type: "dividend", amount: "12.5", taxWithheld: "1.88" });
    if (d % 200 === 150)
      txs.push({
        ...base(degiro, securities[0]!.id, d),
        type: "sell",
        quantity: "3",
        price: "80",
        settleAssetId: eur.id,
      });
    // Exchanges: frequent small trades and daily staking rewards on a few coins.
    for (const acc of [bitvavo, kraken]) {
      if (rand() < 0.8) {
        const coin = coins[Math.floor(rand() * coins.length)]!;
        txs.push({ ...base(acc, coin.id, d), quantity: (1 + rand()).toFixed(6), price: "50" });
        if (rand() < 0.3) txs.push({ ...base(acc, coin.id, d), type: "sell", quantity: "0.5", price: "55" });
      }
      for (const coin of coins.slice(0, 3))
        txs.push({ ...base(acc, coin.id, d), type: "reward", quantity: "0.001", price: "50" });
    }
    // Wallet: receives and network fees.
    if (rand() < 0.5) {
      txs.push({ ...base(ledger, coins[0]!.id, d), type: "deposit", quantity: "0.1", price: "50" });
      txs.push({ ...base(ledger, coins[0]!.id, d), type: "fee", quantity: "0.0001", price: "0" });
    }
  }
}
for (let i = 0; i < txs.length; i += 2_000) await db.insert(transactions).values(txs.slice(i, i + 2_000));
console.log(`${txs.length} transactions, ${history.length} daily closes, ${DAYS} days\n`);

const pages = [
  "/api/portfolio",
  "/api/portfolio/history?range=1Y",
  "/api/portfolio/history?range=ALL",
  "/api/performance",
  "/api/income",
  `/api/box3/${new Date().getFullYear() - 1}`,
  "/api/returns",
  "/api/costs",
  "/api/transactions?limit=100",
  "/api/export/transactions.csv",
];
for (const run of ["first", "again"]) {
  for (const url of pages) {
    const t0 = performance.now();
    const res = await t.api("GET", url);
    const ms = performance.now() - t0;
    if (res.statusCode !== 200) throw new Error(`${url}: ${res.statusCode} ${res.body.slice(0, 200)}`);
    console.log(`${run.padEnd(6)} ${url.padEnd(36)} ${ms.toFixed(0).padStart(6)} ms`);
  }
  console.log();
}
await t.close();
