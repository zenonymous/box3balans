import { afterEach, describe, expect, it } from "vitest";
import { metalPhotos } from "../src/db/schema.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

async function item() {
  t = await createTestApp();
  const safe = json(await t.api("POST", "/api/accounts", { name: "Home safe", kind: "physical" }));
  return json(
    await t.api("POST", "/api/metals/items", {
      accountId: safe.id,
      metal: "gold",
      product: "Krugerrand 1 oz",
      grossWeightG: "33.93",
      purity: "0.9167",
      quantity: 1,
      purchaseDate: "2024-05-01",
      purchasePriceEur: "2000",
    }),
  );
}

const upload = (itemId: number, mime: string, data: Buffer | string) =>
  t.api("POST", `/api/metals/items/${itemId}/photos`, {
    mime,
    data: typeof data === "string" ? data : data.toString("base64"),
  });

describe("metal item photos", () => {
  it("stores, lists, serves and deletes photos", async () => {
    const it1 = await item();
    const res = await upload(it1.id, "image/jpeg", JPEG);
    expect(res.statusCode).toBe(200);
    const { id } = json(res);

    const overview = json(await t.api("GET", "/api/metals/overview"));
    expect(overview.items[0].photoIds).toEqual([id]);

    const img = await t.app.inject({ method: "GET", url: `/api/metals/photos/${id}`, headers: { cookie: t.cookie } });
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect(img.headers["cache-control"]).toContain("immutable");
    expect(img.rawPayload.equals(JPEG)).toBe(true);
    // Photos need a session like everything else.
    expect((await t.app.inject({ method: "GET", url: `/api/metals/photos/${id}` })).statusCode).toBe(401);

    const history = json(await t.api("GET", "/api/activity"));
    expect(history.items[0]).toMatchObject({ entity: "metal_photo", title: "Photo of Krugerrand 1 oz" });

    expect((await t.api("DELETE", `/api/metals/photos/${id}`)).statusCode).toBe(200);
    expect(json(await t.api("GET", "/api/metals/overview")).items[0].photoIds).toEqual([]);
  });

  it("only accepts real JPEG, PNG or WebP images, a few per item", async () => {
    const it1 = await item();
    expect((await upload(it1.id, "image/png", PNG)).statusCode).toBe(200);
    // Claimed type must match the bytes; other files and bad base64 are refused.
    expect((await upload(it1.id, "image/jpeg", PNG)).statusCode).toBe(400);
    expect((await upload(it1.id, "image/jpeg", Buffer.from("<svg onload=alert(1)>"))).statusCode).toBe(400);
    expect((await upload(it1.id, "image/svg+xml", JPEG)).statusCode).toBe(400);
    expect((await upload(it1.id, "image/jpeg", "not base64!")).statusCode).toBe(400);
    for (let i = 0; i < 7; i++) expect((await upload(it1.id, "image/jpeg", JPEG)).statusCode).toBe(200);
    const ninth = await upload(it1.id, "image/jpeg", JPEG);
    expect(ninth.statusCode).toBe(400);
    expect(json(ninth).error).toBe("At most 8 photos per item");
    expect((await upload(999, "image/jpeg", JPEG)).statusCode).toBe(404);
  });

  it("deletes an item's photos with the item", async () => {
    const it1 = await item();
    await upload(it1.id, "image/jpeg", JPEG);
    await t.api("DELETE", `/api/metals/items/${it1.id}`);
    expect(await t.database.db.select().from(metalPhotos)).toHaveLength(0);
  });
});
