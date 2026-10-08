import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.js";
import { accounts, assets, metalItems, metalPhotos, priceHistory, pricesLatest } from "../db/schema.js";
import { METAL_CODES } from "../db/seed.js";
import { METAL_PRODUCTS } from "../domain/metal-products.js";
import { loadLedger } from "../domain/portfolio.js";
import { audit } from "../lib/audit.js";
import { D, Decimal, TROY_OUNCE_G, ZERO, money2, str } from "../lib/decimal.js";
import { HttpError, notFound } from "../lib/errors.js";
import { decimalString, idParam, isoDay } from "../lib/validation.js";
import { tr } from "../i18n/index.js";

const METALS = ["gold", "silver", "platinum", "palladium"] as const;
type MetalName = (typeof METALS)[number];

const itemBody = z.object({
  accountId: z.number().int().positive(),
  metal: z.enum(METALS),
  product: z.string().trim().min(1).max(200),
  grossWeightG: decimalString.refine((v) => D(v).gt(0), { error: () => tr("Weight must be > 0") }),
  purity: decimalString.refine((v) => D(v).gt(0) && D(v).lte(1), {
    error: () => tr("Purity must be between 0 and 1 (e.g. 0.9999)"),
  }),
  quantity: z.number().int().positive().default(1),
  purchaseDate: isoDay,
  purchasePriceEur: decimalString,
  spotValueAtPurchaseEur: decimalString.nullish(),
  dealer: z.string().trim().max(200).nullish(),
  notes: z.string().max(2000).nullish(),
  soldDate: isoDay.nullish(),
  salePriceEur: decimalString.nullish(),
});

const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const photoBody = z.object({
  mime: z.enum(PHOTO_TYPES),
  data: z
    .string()
    .max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Not base64"),
});

/** The image type by its first bytes, whatever the upload claims. */
function sniffImage(b: Buffer): (typeof PHOTO_TYPES)[number] | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

async function metalAssetIds(db: DB): Promise<Map<MetalName, number>> {
  const rows = await db
    .select({ id: assets.id, ref: assets.priceRef })
    .from(assets)
    .where(eq(assets.priceSource, "metal"));
  const out = new Map<MetalName, number>();
  for (const m of METALS) {
    const row = rows.find((r) => r.ref === METAL_CODES[m]);
    if (row) out.set(m, row.id);
  }
  return out;
}

/** Spot EUR/g on `day` (or up to 5 days before, for weekends), from stored price history. */
async function spotOn(db: DB, assetId: number, day: string): Promise<Decimal | null> {
  const from = new Date(Date.parse(day) - 5 * 86_400_000).toISOString().slice(0, 10);
  const [row] = await db
    .select({ closeEur: priceHistory.closeEur })
    .from(priceHistory)
    .where(and(eq(priceHistory.assetId, assetId), lte(priceHistory.day, day), gte(priceHistory.day, from)))
    .orderBy(desc(priceHistory.day))
    .limit(1);
  return row ? D(row.closeEur) : null;
}

const fineGrams = (i: { grossWeightG: string; purity: string; quantity: number }) =>
  D(i.grossWeightG).mul(D(i.purity)).mul(i.quantity);

export async function metalRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get("/products", async () => METAL_PRODUCTS);

  app.get("/spot", async () => {
    const ids = await metalAssetIds(db);
    const prices = await db.select().from(pricesLatest);
    return METALS.map((m) => {
      const p = prices.find((x) => x.assetId === ids.get(m));
      return {
        metal: m,
        eurPerGram: p ? D(p.priceEur).toFixed(4) : null,
        eurPerOz: p ? D(p.priceEur).mul(TROY_OUNCE_G).toFixed(2) : null,
        changePct24h: p?.changePct24h ? D(p.changePct24h).toFixed(2) : null,
        fetchedAt: p?.fetchedAt ?? null,
      };
    });
  });

  // Everything the metals page needs: per-metal totals, physical items valued at spot, vaulted holdings.
  app.get("/overview", async () => {
    const ids = await metalAssetIds(db);
    const [items, prices, accountRows, ledger, photos] = await Promise.all([
      db.select().from(metalItems).orderBy(asc(metalItems.purchaseDate), asc(metalItems.id)),
      db.select().from(pricesLatest),
      db.select().from(accounts),
      loadLedger(db),
      db.select({ id: metalPhotos.id, itemId: metalPhotos.itemId }).from(metalPhotos).orderBy(asc(metalPhotos.id)),
    ]);
    const spot = new Map<MetalName, Decimal | null>(
      METALS.map((m) => {
        const p = prices.find((x) => x.assetId === ids.get(m));
        return [m, p ? D(p.priceEur) : null];
      }),
    );
    const accName = (id: number) => accountRows.find((a) => a.id === id)?.name ?? `#${id}`;

    const totals = new Map<
      MetalName,
      {
        physicalG: Decimal;
        vaultedG: Decimal;
        valueEur: Decimal;
        costEur: Decimal;
        premiumEur: Decimal;
        premiumKnownCostEur: Decimal;
      }
    >();
    const t = (m: MetalName) => {
      let x = totals.get(m);
      if (!x) {
        x = {
          physicalG: ZERO,
          vaultedG: ZERO,
          valueEur: ZERO,
          costEur: ZERO,
          premiumEur: ZERO,
          premiumKnownCostEur: ZERO,
        };
        totals.set(m, x);
      }
      return x;
    };

    const itemRows = items.map((i) => {
      const fine = fineGrams(i);
      const s = spot.get(i.metal);
      const value = s ? fine.mul(s) : null;
      const sold = i.soldDate != null;
      const premium =
        i.spotValueAtPurchaseEur != null ? D(i.purchasePriceEur).minus(D(i.spotValueAtPurchaseEur)) : null;
      if (!sold) {
        const tot = t(i.metal);
        tot.physicalG = tot.physicalG.plus(fine);
        tot.valueEur = tot.valueEur.plus(value ?? ZERO);
        tot.costEur = tot.costEur.plus(D(i.purchasePriceEur));
        if (premium) {
          tot.premiumEur = tot.premiumEur.plus(premium);
          tot.premiumKnownCostEur = tot.premiumKnownCostEur.plus(D(i.spotValueAtPurchaseEur));
        }
      }
      const pnl = sold
        ? D(i.salePriceEur ?? 0).minus(D(i.purchasePriceEur))
        : value
          ? value.minus(D(i.purchasePriceEur))
          : null;
      return {
        ...i,
        accountName: accName(i.accountId),
        photoIds: photos.filter((p) => p.itemId === i.id).map((p) => p.id),
        fineWeightG: fine.toFixed(4),
        fineWeightOz: fine.div(TROY_OUNCE_G).toFixed(4),
        valueEur: sold ? null : value ? money2(value) : null,
        premiumEur: premium ? money2(premium) : null,
        premiumPct:
          premium && !D(i.spotValueAtPurchaseEur).isZero()
            ? premium.div(D(i.spotValueAtPurchaseEur)).mul(100).toFixed(2)
            : null,
        pnlEur: pnl ? money2(pnl) : null,
        pnlPct: pnl && !D(i.purchasePriceEur).isZero() ? pnl.div(D(i.purchasePriceEur)).mul(100).toFixed(2) : null,
      };
    });

    const vaulted = [];
    for (const p of ledger.positions) {
      const metal = METALS.find((m) => ids.get(m) === p.assetId);
      if (!metal || p.quantity.isZero()) continue;
      const s = spot.get(metal);
      const value = s ? p.quantity.mul(s) : null;
      const tot = t(metal);
      tot.vaultedG = tot.vaultedG.plus(p.quantity);
      tot.valueEur = tot.valueEur.plus(value ?? ZERO);
      tot.costEur = tot.costEur.plus(p.costEur);
      vaulted.push({
        metal,
        accountId: p.accountId,
        accountName: accName(p.accountId),
        grams: p.quantity.toFixed(4),
        oz: p.quantity.div(TROY_OUNCE_G).toFixed(4),
        costEur: money2(p.costEur),
        valueEur: value ? money2(value) : null,
        pnlEur: value ? money2(value.minus(p.costEur)) : null,
      });
    }

    return {
      spot: METALS.map((m) => ({
        metal: m,
        eurPerGram: spot.get(m)?.toFixed(4) ?? null,
        eurPerOz: spot.get(m)?.mul(TROY_OUNCE_G).toFixed(2) ?? null,
      })),
      totals: [...totals.entries()].map(([metal, x]) => {
        const grams = x.physicalG.plus(x.vaultedG);
        return {
          metal,
          physicalG: x.physicalG.toFixed(4),
          vaultedG: x.vaultedG.toFixed(4),
          totalG: grams.toFixed(4),
          totalOz: grams.div(TROY_OUNCE_G).toFixed(4),
          valueEur: money2(x.valueEur),
          costEur: money2(x.costEur),
          pnlEur: money2(x.valueEur.minus(x.costEur)),
          premiumPaidEur: money2(x.premiumEur),
          premiumPaidPct: x.premiumKnownCostEur.isZero()
            ? null
            : x.premiumEur.div(x.premiumKnownCostEur).mul(100).toFixed(2),
        };
      }),
      items: itemRows,
      vaulted,
    };
  });

  const withSpotAtPurchase = async (data: z.infer<typeof itemBody>) => {
    if (data.spotValueAtPurchaseEur != null) return data.spotValueAtPurchaseEur;
    const assetId = (await metalAssetIds(db)).get(data.metal);
    const s = assetId ? await spotOn(db, assetId, data.purchaseDate) : null;
    return s
      ? str(
          fineGrams({ ...data, quantity: data.quantity })
            .mul(s)
            .toDecimalPlaces(2),
        )
      : null;
  };

  const assertAccount = async (id: number) => {
    const [acc] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id));
    if (!acc) throw new HttpError(400, tr("Unknown storage location"));
  };

  app.post("/items", async (req) => {
    const data = itemBody.parse(req.body);
    await assertAccount(data.accountId);
    const [row] = await db
      .insert(metalItems)
      .values({ ...data, spotValueAtPurchaseEur: await withSpotAtPurchase(data) })
      .returning();
    await audit(db, "metal_item", row!.id, "create", null, row);
    return row;
  });

  app.put("/items/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select().from(metalItems).where(eq(metalItems.id, id));
    if (!before) throw notFound(tr("Item"));
    const data = itemBody.parse({ ...before, ...(req.body as object) });
    if ((data.soldDate == null) !== (data.salePriceEur == null)) {
      throw new HttpError(400, tr("Sale date and sale price must be given together"));
    }
    await assertAccount(data.accountId);
    const purchaseChanged =
      data.purchaseDate !== before.purchaseDate ||
      !D(data.grossWeightG).eq(D(before.grossWeightG)) ||
      data.quantity !== before.quantity ||
      !D(data.purity).eq(D(before.purity));
    const explicitSpot = (req.body as { spotValueAtPurchaseEur?: string }).spotValueAtPurchaseEur;
    const spotValue =
      explicitSpot !== undefined
        ? data.spotValueAtPurchaseEur
        : purchaseChanged
          ? await withSpotAtPurchase({ ...data, spotValueAtPurchaseEur: null })
          : before.spotValueAtPurchaseEur;
    const [row] = await db
      .update(metalItems)
      .set({ ...data, spotValueAtPurchaseEur: spotValue ?? null, updatedAt: new Date() })
      .where(eq(metalItems.id, id))
      .returning();
    await audit(db, "metal_item", id, "update", before, row);
    return row;
  });

  // ---- Photos ----

  app.post("/items/:id/photos", { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { mime, data } = photoBody.parse(req.body);
    const [item] = await db.select().from(metalItems).where(eq(metalItems.id, id));
    if (!item) throw notFound(tr("Item"));
    const buf = Buffer.from(data, "base64");
    if (buf.length > MAX_PHOTO_BYTES) throw new HttpError(413, tr("Photo is too large (max 4 MB)"));
    if (sniffImage(buf) !== mime) throw new HttpError(400, tr("That isn't a JPEG, PNG or WebP image"));
    const existing = await db.select({ id: metalPhotos.id }).from(metalPhotos).where(eq(metalPhotos.itemId, id));
    if (existing.length >= MAX_PHOTOS) throw new HttpError(400, tr("At most {n} photos per item", { n: MAX_PHOTOS }));
    const [row] = await db
      .insert(metalPhotos)
      .values({ itemId: id, mime, data: buf.toString("base64"), bytes: buf.length })
      .returning({ id: metalPhotos.id });
    await audit(db, "metal_photo", row!.id, "create", null, { itemId: id, product: item.product });
    return { id: row!.id };
  });

  app.get("/photos/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [p] = await db.select().from(metalPhotos).where(eq(metalPhotos.id, id));
    if (!p) throw notFound(tr("Photo"));
    // A photo never changes under its id.
    reply.header("content-type", p.mime).header("cache-control", "private, max-age=31536000, immutable");
    return Buffer.from(p.data, "base64");
  });

  app.delete("/photos/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [p] = await db
      .select({ id: metalPhotos.id, itemId: metalPhotos.itemId, product: metalItems.product })
      .from(metalPhotos)
      .innerJoin(metalItems, eq(metalItems.id, metalPhotos.itemId))
      .where(eq(metalPhotos.id, id));
    if (!p) throw notFound(tr("Photo"));
    await db.delete(metalPhotos).where(eq(metalPhotos.id, id));
    await audit(db, "metal_photo", id, "delete", { itemId: p.itemId, product: p.product }, null);
    return { ok: true };
  });

  app.delete("/items/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select().from(metalItems).where(eq(metalItems.id, id));
    if (!before) throw notFound(tr("Item"));
    await db.delete(metalItems).where(eq(metalItems.id, id));
    await audit(db, "metal_item", id, "delete", before, null);
    return { ok: true };
  });
}
