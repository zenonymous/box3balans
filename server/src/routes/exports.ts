import type { FastifyInstance, FastifyReply } from "fastify";
import { asc, eq } from "drizzle-orm";
import { accounts, assets, transactions } from "../db/schema.js";
import { buildPortfolio } from "../domain/portfolio.js";
import { staleAfterMs } from "../jobs/scheduler.js";
import { toCsv } from "../lib/csv.js";

const sendCsv = (reply: FastifyReply, name: string, body: string) =>
  reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`)
    .send(body);

export async function exportRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

  app.get("/transactions.csv", async (_req, reply) => {
    const rows = await db
      .select({ t: transactions, asset: assets.name, symbol: assets.symbol, isin: assets.isin, account: accounts.name })
      .from(transactions)
      .innerJoin(assets, eq(assets.id, transactions.assetId))
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .orderBy(asc(transactions.occurredAt), asc(transactions.id));
    return sendCsv(
      reply,
      "transactions",
      toCsv(rows, [
        { header: "Date", value: (r) => r.t.occurredAt.toISOString() },
        { header: "Type", value: (r) => r.t.type },
        { header: "Account", value: (r) => r.account },
        { header: "Asset", value: (r) => r.asset },
        { header: "Symbol", value: (r) => r.symbol },
        { header: "ISIN", value: (r) => r.isin },
        { header: "Quantity", value: (r) => r.t.quantity },
        { header: "Price", value: (r) => r.t.price },
        { header: "Currency", value: (r) => r.t.currency },
        { header: "FX rate (EUR per unit)", value: (r) => r.t.fxRate },
        { header: "Fee EUR", value: (r) => r.t.feeEur },
        { header: "Dividend gross", value: (r) => r.t.amount },
        { header: "Tax withheld", value: (r) => r.t.taxWithheld },
        { header: "Transfer group", value: (r) => r.t.transferGroup },
        { header: "Source", value: (r) => r.t.source },
        { header: "External id", value: (r) => r.t.externalId },
        { header: "Notes", value: (r) => r.t.notes },
      ]),
    );
  });

  app.get("/holdings.csv", async (_req, reply) => {
    const { holdings } = await buildPortfolio(db, { staleAfterMs: staleAfterMs(config) });
    const rows = holdings.flatMap((h) => h.accounts.map((a) => ({ h, a })));
    return sendCsv(
      reply,
      "holdings",
      toCsv(rows, [
        { header: "Asset", value: (r) => r.h.name },
        { header: "Symbol", value: (r) => r.h.symbol },
        { header: "Class", value: (r) => r.h.assetClass },
        { header: "Account", value: (r) => r.a.accountName },
        { header: "Quantity", value: (r) => r.a.quantity },
        { header: "Unit", value: (r) => r.h.unit },
        { header: "Price EUR", value: (r) => r.h.priceEur },
        { header: "Value EUR", value: (r) => r.a.valueEur },
        { header: "Cost EUR", value: (r) => r.a.costEur },
      ]),
    );
  });
}
