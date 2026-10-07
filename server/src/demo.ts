import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { DB } from "./db/client.js";
import { assets, priceHistory, pricesLatest } from "./db/schema.js";
import { localToday } from "./lib/time.js";

/**
 * Demo mode (DEMO=true): an in-memory database with an example household, signed in automatically.
 * The example goes in through the API like real input, so everything is consistent; prices are made
 * up from a few anchor values, so the demo needs no network and looks the same every time.
 */
export const DEMO_USER = "demo";

type Anchors = [day: string, eur: number][];

/** Daily closes through the anchors (log-linear), with a small deterministic wobble. */
function series(anchors: Anchors, seed: number): { day: string; eur: number }[] {
  const out: { day: string; eur: number }[] = [];
  const start = Date.parse(anchors[0]![0]);
  const end = Date.parse(anchors.at(-1)![0]);
  let k = 0;
  for (let ms = start, i = 0; ms <= end; ms += 86_400_000, i++) {
    while (k < anchors.length - 2 && ms > Date.parse(anchors[k + 1]![0])) k++;
    const [d0, v0] = anchors[k]!;
    const [d1, v1] = anchors[k + 1]!;
    const f = (ms - Date.parse(d0)) / (Date.parse(d1) - Date.parse(d0));
    const base = Math.exp(Math.log(v0) + f * (Math.log(v1) - Math.log(v0)));
    const wobble = 0.025 * Math.sin(i / 7 + seed) + 0.035 * Math.sin(i / 37 + seed * 3);
    out.push({ day: new Date(ms).toISOString().slice(0, 10), eur: base * (1 + wobble) });
  }
  return out;
}

const round = (v: number, digits: number) => v.toFixed(digits);

export async function seedDemo(app: FastifyInstance, db: DB): Promise<void> {
  const headers = { "x-requested-with": "portfolio" };
  const setup = await app.inject({
    method: "POST",
    url: "/api/auth/setup",
    headers,
    payload: { username: DEMO_USER, password: randomBytes(24).toString("base64url") },
  });
  if (setup.statusCode !== 200) throw new Error(`demo setup failed: ${setup.body}`);
  const cookie = `${setup.cookies[0]!.name}=${setup.cookies[0]!.value}`;

  const call = async <T = any>(method: string, url: string, payload?: unknown): Promise<T> => {
    const res = await app.inject({
      method: method as "GET",
      url,
      payload: payload as object,
      headers: { ...headers, cookie },
    });
    if (res.statusCode !== 200) throw new Error(`demo ${method} ${url}: ${res.body}`);
    return res.json() as T;
  };
  const at = (d: string) => `${d}T12:00:00Z`;

  // ---- Household: you, a fiscal partner and a child ----
  await call("POST", "/api/household", { name: "Sanne", role: "self" });
  await call("POST", "/api/household", { name: "Daan", role: "partner" });
  const noor = await call("POST", "/api/household", {
    name: "Noor",
    role: "child",
    birthDate: "2016-04-12",
    custody: "together",
  });

  // ---- Assets, with made-up price history (EUR) ----
  const today = localToday();
  const add = async (row: typeof assets.$inferInsert) => (await db.insert(assets).values(row).returning())[0]!.id;
  const iwda = await add({
    assetClass: "etf",
    name: "iShares Core MSCI World UCITS ETF",
    symbol: "IWDA",
    isin: "IE00B4L5Y983",
    priceSource: "yahoo",
    priceRef: "IWDA.AS",
    terPct: "0.2",
  });
  const asml = await add({
    assetClass: "stock",
    name: "ASML Holding",
    symbol: "ASML",
    isin: "NL0010273215",
    priceSource: "yahoo",
    priceRef: "ASML.AS",
  });
  const btc = await add({
    assetClass: "crypto",
    name: "Bitcoin",
    symbol: "BTC",
    priceSource: "coingecko",
    priceRef: "bitcoin",
  });
  const eth = await add({
    assetClass: "crypto",
    name: "Ethereum",
    symbol: "ETH",
    priceSource: "coingecko",
    priceRef: "ethereum",
  });
  const byRef = async (ref: string) =>
    (await db.select({ id: assets.id }).from(assets).where(eq(assets.priceRef, ref)))[0]!.id;
  const gold = await byRef("XAU");
  const silver = await byRef("XAG");
  const eur = await byRef("EUR");

  const history: [number, Anchors][] = [
    [
      iwda,
      [
        ["2022-10-01", 64],
        ["2023-12-29", 80],
        ["2024-12-31", 101],
        ["2025-12-31", 108],
        [today, 112],
      ],
    ],
    [
      asml,
      [
        ["2022-10-01", 480],
        ["2023-12-29", 680],
        ["2024-12-31", 678],
        ["2025-12-31", 870],
        [today, 905],
      ],
    ],
    [
      btc,
      [
        ["2022-10-01", 19500],
        ["2022-12-30", 15500],
        ["2023-12-29", 38000],
        ["2024-12-31", 90000],
        ["2025-12-31", 80000],
        [today, 95000],
      ],
    ],
    [
      eth,
      [
        ["2022-10-01", 1350],
        ["2022-12-30", 1120],
        ["2023-12-29", 2050],
        ["2024-12-31", 3200],
        ["2025-12-31", 2500],
        [today, 3800],
      ],
    ],
    // Metals per gram.
    [
      gold,
      [
        ["2022-10-01", 54],
        ["2023-12-29", 59.5],
        ["2024-12-31", 81.5],
        ["2025-12-31", 110],
        [today, 115],
      ],
    ],
    [
      silver,
      [
        ["2022-10-01", 0.65],
        ["2023-12-29", 0.7],
        ["2024-12-31", 0.88],
        ["2025-12-31", 1.4],
        [today, 1.5],
      ],
    ],
  ];
  for (const [assetId, anchors] of history) {
    const days = series(anchors, assetId);
    for (let i = 0; i < days.length; i += 500) {
      await db.insert(priceHistory).values(
        days.slice(i, i + 500).map((d) => {
          const v = round(d.eur, d.eur < 10 ? 4 : 2);
          return { assetId, day: d.day, close: v, currency: "EUR", closeEur: v };
        }),
      );
    }
    const last = days.at(-1)!;
    const prev = days.at(-2) ?? last;
    const v = round(last.eur, last.eur < 10 ? 4 : 2);
    await db.insert(pricesLatest).values({
      assetId,
      price: v,
      currency: "EUR",
      priceEur: v,
      changePct24h: round(((last.eur - prev.eur) / prev.eur) * 100, 4),
      source: "demo",
      fetchedAt: new Date(),
    });
  }

  // Cash is worth its face value (normally set by the price refresh).
  await db.insert(pricesLatest).values({
    assetId: eur,
    price: "1",
    currency: "EUR",
    priceEur: "1",
    source: "fx",
    fetchedAt: new Date(),
  });

  // ---- Accounts with transactions ----
  const account = async (body: object) => (await call("POST", "/api/accounts", body)).id as number;
  const tx = (body: object) => call("POST", "/api/transactions", body);

  const degiro = await account({ name: "DEGIRO", kind: "broker", provider: "degiro" });
  const deposit = (accountId: number, day: string, amount: string) =>
    tx({ accountId, assetId: eur, type: "deposit", occurredAt: at(day), quantity: amount, price: "1" });
  const trade = (
    accountId: number,
    assetId: number,
    type: string,
    day: string,
    quantity: string,
    price: string,
    feeEur = "0",
  ) => tx({ accountId, assetId, type, occurredAt: at(day), quantity, price, feeEur, settleCash: true });
  await deposit(degiro, "2023-01-02", "10000");
  await trade(degiro, iwda, "buy", "2023-01-10", "120", "71.20", "1");
  await deposit(degiro, "2023-06-14", "5000");
  await trade(degiro, asml, "buy", "2023-06-15", "8", "650", "2");
  await deposit(degiro, "2024-03-01", "6000");
  await trade(degiro, iwda, "buy", "2024-03-05", "60", "88.40", "1");
  await tx({
    accountId: degiro,
    assetId: asml,
    type: "dividend",
    occurredAt: at("2024-05-02"),
    amount: "8.80",
    taxWithheld: "1.32",
    settleCash: true,
  });
  await trade(degiro, asml, "sell", "2024-07-11", "3", "980", "2");
  await trade(degiro, iwda, "buy", "2025-02-10", "40", "104", "1");
  await tx({
    accountId: degiro,
    assetId: asml,
    type: "dividend",
    occurredAt: at("2025-05-02"),
    amount: "9.20",
    taxWithheld: "1.38",
    settleCash: true,
  });

  const bitvavo = await account({ name: "Bitvavo", kind: "exchange", provider: "bitvavo", owner: "partner" });
  const ledger = await account({ name: "Ledger", kind: "wallet", owner: "partner" });
  await deposit(bitvavo, "2022-11-20", "6000");
  await trade(bitvavo, btc, "buy", "2022-11-20", "0.35", "16200", "14");
  await deposit(bitvavo, "2023-04-04", "4200");
  await trade(bitvavo, eth, "buy", "2023-04-04", "2.5", "1650", "8");
  await deposit(bitvavo, "2024-02-01", "4000");
  await trade(bitvavo, btc, "buy", "2024-02-01", "0.1", "39500", "10");
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
    type: "reward",
    occurredAt: at("2024-06-30"),
    quantity: "0.042",
    price: "3150",
  });

  const vault = await account({ name: "Goldrepublic", kind: "vault", provider: "goldrepublic" });
  await tx({
    accountId: vault,
    assetId: gold,
    type: "buy",
    occurredAt: at("2023-09-01"),
    quantity: "50",
    price: "58.10",
  });

  const safe = await account({ name: "Kluis thuis", kind: "physical", owner: "joint" });
  const item = (body: object) => call("POST", "/api/metals/items", { accountId: safe, ...body });
  await item({
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
  await item({
    metal: "gold",
    product: "Gouden Tientje (10 gulden)",
    grossWeightG: "6.729",
    purity: "0.900",
    quantity: 5,
    purchaseDate: "2022-10-08",
    purchasePriceEur: "1620",
  });
  await item({
    metal: "silver",
    product: "Maple Leaf 1 oz",
    grossWeightG: "31.11",
    purity: "0.9999",
    quantity: 25,
    purchaseDate: "2023-11-20",
    purchasePriceEur: "720",
    spotValueAtPurchaseEur: "560",
  });

  // ---- Accounts kept as values per year ----
  type Year = { year: number; valueEur: string; inEur?: string; outEur?: string; incomeEur?: string; details?: object };
  const yearly = async (body: object, rows: Year[]) => {
    const id = await account({ ...body, tracking: "yearly" });
    await call("PUT", `/api/accounts/${id}/years`, { rows });
  };
  await yearly({ name: "ING Betalen", kind: "bank", owner: "joint" }, [
    { year: 2023, valueEur: "5800" },
    { year: 2024, valueEur: "6500" },
    { year: 2025, valueEur: "7200" },
    { year: 2026, valueEur: "6900" },
  ]);
  await yearly({ name: "ASN Sparen", kind: "bank" }, [
    { year: 2023, valueEur: "28000", incomeEur: "390" },
    { year: 2024, valueEur: "32000", inEur: "3000", incomeEur: "640" },
    { year: 2025, valueEur: "35640", inEur: "2500", incomeEur: "590" },
    { year: 2026, valueEur: "38730" },
  ]);
  await yearly({ name: "Spaarrekening Noor", kind: "bank", owner: "child", ownerChildId: noor.id }, [
    { year: 2024, valueEur: "3200", inEur: "300", incomeEur: "60" },
    { year: 2025, valueEur: "3560", inEur: "400", incomeEur: "55" },
    { year: 2026, valueEur: "4015" },
  ]);
  await yearly({ name: "Spaarrekening Daan", kind: "bank", owner: "partner" }, [
    { year: 2024, valueEur: "12000", incomeEur: "240" },
    { year: 2025, valueEur: "12240", incomeEur: "210" },
    { year: 2026, valueEur: "12450" },
  ]);
  await yearly({ name: "Vakantiehuis Zeeland", kind: "property", owner: "joint", jointSelfPct: 50 }, [
    { year: 2024, valueEur: "285000" },
    { year: 2025, valueEur: "298000" },
    { year: 2026, valueEur: "310000" },
  ]);
  await yearly({ name: "Lening aan Eva", kind: "receivable" }, [
    { year: 2024, valueEur: "5000", outEur: "1000", incomeEur: "150" },
    { year: 2025, valueEur: "4000", outEur: "1000", incomeEur: "120" },
    { year: 2026, valueEur: "3000" },
  ]);
  await yearly({ name: "Studieschuld", kind: "debt" }, [
    { year: 2024, valueEur: "18000", incomeEur: "450" },
    { year: 2025, valueEur: "16800", incomeEur: "400" },
    { year: 2026, valueEur: "15500" },
  ]);

  // ---- Box 3: fiscal partners every year ----
  const { config } = await call("GET", "/api/box3");
  const situation = { debtsEur: "0", extraOtherEur: "0", extraBankEur: "0", partner: true, allocationSelfPct: "50" };
  for (const y of [2023, 2024, 2025, 2026]) config.years[String(y)] = { ...situation };
  await call("PUT", "/api/box3/config", config);

  // The setup session isn't needed: visitors get their own (see app.ts).
  await call("POST", "/api/auth/logout");
}
