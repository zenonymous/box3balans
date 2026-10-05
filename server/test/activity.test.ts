import { afterEach, describe, expect, it } from "vitest";
import { syncIgnored, transactions } from "../src/db/schema.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(async () => t?.close());

const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

async function setup() {
  t = await createTestApp();
  const broker = json(await t.api("POST", "/api/accounts", { name: "Broker", kind: "broker" }));
  const wallet = json(await t.api("POST", "/api/accounts", { name: "Ledger", kind: "wallet" }));
  const all = json<any[]>(await t.api("GET", "/api/assets"));
  const gold = all.find((a) => a.priceRef === "XAU");
  return { broker, wallet, gold };
}

const history = async (query = "") => json(await t.api("GET", `/api/activity${query}`));

describe("activity history", () => {
  it("lists changes with readable titles and the fields that changed", async () => {
    const { broker, gold } = await setup();
    const tx = json(
      await t.api("POST", "/api/transactions", {
        accountId: broker.id,
        assetId: gold.id,
        type: "buy",
        occurredAt: "2024-04-01T10:00:00Z",
        quantity: "10",
        price: "70",
      }),
    );
    await t.api("PUT", `/api/transactions/${tx.id}`, { quantity: "12", notes: "corrected" });

    const h = await history(`?entity=transaction&entityId=${tx.id}`);
    expect(h.total).toBe(2);
    const [update, create] = h.items;
    expect(create).toMatchObject({ action: "create", title: "Buy 10 XAU · Broker", restorable: false });
    expect(update).toMatchObject({ action: "update", title: "Buy 12 XAU · Broker" });
    expect(update.changes.fields).toHaveLength(2);
    expect(update.changes.fields).toEqual(
      expect.arrayContaining([
        { field: "quantity", from: "10", to: "12" },
        { field: "notes", from: null, to: "corrected" },
      ]),
    );

    // The unfiltered list also has the accounts.
    const everything = await history();
    expect(everything.items.map((i: any) => i.entity)).toEqual(expect.arrayContaining(["transaction", "account"]));
  });

  it("restores a deleted transaction with its id, once", async () => {
    const { broker, gold } = await setup();
    const tx = json(
      await t.api("POST", "/api/transactions", {
        accountId: broker.id,
        assetId: gold.id,
        type: "buy",
        occurredAt: "2024-04-01T10:00:00Z",
        quantity: "10",
        price: "70",
      }),
    );
    await t.api("DELETE", `/api/transactions/${tx.id}`);
    const [deleted] = (await history("?entity=transaction")).items;
    expect(deleted).toMatchObject({ action: "delete", restorable: true });

    const res = await t.api("POST", `/api/activity/${deleted.id}/restore`);
    expect(json(res)).toMatchObject({ ok: true, restored: 1 });
    const list = json(await t.api("GET", "/api/transactions"));
    expect(list.items.map((i: any) => i.id)).toEqual([tx.id]);
    expect(list.items[0].occurredAt).toBe("2024-04-01T10:00:00.000Z");

    const after = (await history("?entity=transaction")).items;
    expect(after[0]).toMatchObject({ action: "create", via: "restore" });
    expect(after.find((i: any) => i.id === deleted.id).restorable).toBe(false);
    expect((await t.api("POST", `/api/activity/${deleted.id}/restore`)).statusCode).toBe(409);
  });

  it("brings both legs of a transfer back together", async () => {
    const { broker, wallet, gold } = await setup();
    await t.api("POST", "/api/transactions", {
      accountId: broker.id,
      assetId: gold.id,
      type: "buy",
      occurredAt: "2024-04-01T10:00:00Z",
      quantity: "10",
      price: "70",
    });
    const legs = json<any[]>(
      await t.api("POST", "/api/transactions/transfer", {
        fromAccountId: broker.id,
        toAccountId: wallet.id,
        assetId: gold.id,
        occurredAt: "2024-04-02T10:00:00Z",
        quantity: "4",
      }),
    );
    await t.api("DELETE", `/api/transactions/${legs[0].id}`);
    const deletes = (await history("?entity=transaction")).items.filter((i: any) => i.action === "delete");
    expect(deletes).toHaveLength(2);
    expect(json(await t.api("POST", `/api/activity/${deletes[0].id}/restore`)).restored).toBe(2);
    const rows = await t.database.db.select().from(transactions);
    expect(rows.filter((r) => r.transferGroup === legs[0].transferGroup)).toHaveLength(2);
  });

  it("lets a restored synced row be kept by later syncs", async () => {
    const { wallet, gold } = await setup();
    const [row] = await t.database.db
      .insert(transactions)
      .values({
        accountId: wallet.id,
        assetId: gold.id,
        type: "deposit",
        occurredAt: new Date("2024-04-01T10:00:00Z"),
        quantity: "1",
        source: "chain",
        externalId: "abc",
      })
      .returning();
    await t.api("DELETE", `/api/transactions/${row!.id}`);
    expect(await t.database.db.select().from(syncIgnored)).toHaveLength(1);
    const [deleted] = (await history("?entity=transaction")).items;
    await t.api("POST", `/api/activity/${deleted.id}/restore`);
    expect(await t.database.db.select().from(syncIgnored)).toHaveLength(0);
  });

  it("restores metal items, but not when their account is gone, and nothing else", async () => {
    const { gold } = await setup();
    void gold;
    const safe = json(await t.api("POST", "/api/accounts", { name: "Home safe", kind: "physical" }));
    const item = json(
      await t.api("POST", "/api/metals/items", {
        accountId: safe.id,
        metal: "gold",
        product: "Krugerrand 1 oz",
        grossWeightG: "33.93",
        purity: "0.9167",
        quantity: 2,
        purchaseDate: "2024-05-01",
        purchasePriceEur: "4000",
      }),
    );
    await t.api("DELETE", `/api/metals/items/${item.id}`);
    const [deleted] = (await history("?entity=metal_item")).items;
    expect(deleted).toMatchObject({ title: "2× Krugerrand 1 oz", restorable: true });
    expect(json(await t.api("POST", `/api/activity/${deleted.id}/restore`)).restored).toBe(1);
    expect(json(await t.api("GET", "/api/metals/overview")).items).toHaveLength(1);

    // Delete it again, then the account: restoring now has nowhere to go.
    await t.api("DELETE", `/api/metals/items/${item.id}`);
    expect((await t.api("DELETE", `/api/accounts/${safe.id}`)).statusCode).toBe(200);
    const [again] = (await history("?entity=metal_item")).items;
    const refused = await t.api("POST", `/api/activity/${again.id}/restore`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error).toBe("Its account no longer exists");

    const [accountEntry] = (await history("?entity=account")).items;
    expect((await t.api("POST", `/api/activity/${accountEntry.id}/restore`)).statusCode).toBe(400);
  });
});
