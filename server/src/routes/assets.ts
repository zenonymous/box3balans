import type { FastifyInstance } from "fastify";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { assets, pricesLatest, transactions } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";
import { currencyCode, decimalString, idParam } from "../lib/validation.js";
import { coingeckoSearch } from "../prices/coingecko.js";
import { yahooQuote, yahooSearch } from "../prices/yahoo.js";

const createBody = z.object({
  assetClass: z.enum(["stock", "etf", "crypto", "metal", "cash", "other"]),
  name: z.string().trim().min(1).max(200),
  symbol: z.string().trim().min(1).max(40),
  isin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, "Invalid ISIN")
    .nullish(),
  priceSource: z.enum(["yahoo", "coingecko", "fx", "manual"]),
  priceRef: z.string().trim().max(100).nullish(),
  currency: currencyCode.optional(),
  unit: z.string().trim().max(20).optional(),
  chain: z.string().trim().max(40).nullish(),
  contract: z.string().trim().max(200).nullish(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  symbol: z.string().trim().min(1).max(40).optional(),
  isin: z.string().trim().toUpperCase().nullish(),
  priceRef: z.string().trim().max(100).nullish(),
  hidden: z.boolean().optional(),
});

export async function assetRoutes(app: FastifyInstance) {
  const { db, prices } = app.deps;

  app.get("/", async () => {
    const rows = await db
      .select({ asset: assets, price: pricesLatest })
      .from(assets)
      .leftJoin(pricesLatest, eq(pricesLatest.assetId, assets.id))
      .orderBy(asc(assets.assetClass), asc(assets.name));
    return rows.map((r) => ({ ...r.asset, price: r.price }));
  });

  // Look up instruments by name, ticker or ISIN (Yahoo) or coin name/symbol (CoinGecko).
  app.get("/search", async (req) => {
    const { q, kind } = z
      .object({ q: z.string().trim().min(1).max(100), kind: z.enum(["securities", "crypto"]) })
      .parse(req.query);
    try {
      return kind === "crypto" ? await coingeckoSearch(q, prices.fetchFn) : await yahooSearch(q, prices.fetchFn);
    } catch (err) {
      throw new HttpError(502, `Search failed: ${(err as Error).message}`);
    }
  });

  app.post("/", async (req) => {
    const data = createBody.parse(req.body);
    let currency = data.currency ?? "EUR";
    let priceRef = data.priceRef ?? null;
    let unit = data.unit ?? "unit";

    if (data.priceSource === "yahoo") {
      if (!priceRef) throw new HttpError(400, "A Yahoo ticker is required");
      try {
        currency = (await yahooQuote(priceRef, prices.fetchFn)).currency;
      } catch (err) {
        throw new HttpError(400, `Could not price ${priceRef} on Yahoo: ${(err as Error).message}`);
      }
    } else if (data.priceSource === "coingecko") {
      if (!priceRef) throw new HttpError(400, "A CoinGecko id is required");
      currency = "EUR";
    } else if (data.priceSource === "fx") {
      // Cash in a currency: priced at its EUR exchange rate.
      priceRef = currency;
      unit = currency;
    }

    if (priceRef) {
      const [dupe] = await db.select({ id: assets.id }).from(assets).where(eq(assets.priceRef, priceRef));
      if (dupe) throw new HttpError(409, "This asset already exists");
    }

    const [row] = await db
      .insert(assets)
      .values({ ...data, priceRef, currency, unit, isin: data.isin ?? null })
      .returning();
    await audit(db, "asset", row!.id, "create", null, row);
    if (row!.priceSource !== "manual") await prices.refreshAll([row!.id]);
    return row;
  });

  app.put("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const data = updateBody.parse(req.body);
    const [before] = await db.select().from(assets).where(eq(assets.id, id));
    if (!before) throw notFound("Asset");
    if (data.priceRef && data.priceRef !== before.priceRef) {
      const [taken] = await db
        .select({ id: assets.id, name: assets.name })
        .from(assets)
        .where(and(eq(assets.priceSource, before.priceSource), eq(assets.priceRef, data.priceRef), ne(assets.id, id)));
      if (taken) throw new HttpError(409, `${data.priceRef} is already used by “${taken.name}”`);
    }
    const [row] = await db.update(assets).set(data).where(eq(assets.id, id)).returning();
    await audit(db, "asset", id, "update", before, row);
    return row;
  });

  app.post("/:id/price", async (req) => {
    const { id } = idParam.parse(req.params);
    const { price, currency } = z.object({ price: decimalString, currency: currencyCode }).parse(req.body);
    const [asset] = await db.select().from(assets).where(eq(assets.id, id));
    if (!asset) throw notFound("Asset");
    if (asset.priceSource !== "manual") throw new HttpError(400, "Only manually priced assets accept a price");
    await prices.setManual(id, price, currency);
    return { ok: true };
  });

  app.delete("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select().from(assets).where(eq(assets.id, id));
    if (!before) throw notFound("Asset");
    if (before.priceSource === "metal") throw new HttpError(400, "Built-in metal assets cannot be deleted");
    const [used] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.assetId, id))
      .limit(1);
    if (used) throw new HttpError(409, "Asset has transactions; hide it instead");
    // A cash asset may only be referenced as the cash side of trades (settlement).
    const [settles] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.settleAssetId, id))
      .limit(1);
    if (settles) throw new HttpError(409, "This cash balance is used to settle trades; hide it instead");
    await db.delete(assets).where(eq(assets.id, id));
    await audit(db, "asset", id, "delete", before, null);
    return { ok: true };
  });
}
