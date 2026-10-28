import type { FastifyInstance } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, accountYears, metalItems, persons, transactions } from "../db/schema.js";
import { YEARLY_ONLY_KINDS } from "../domain/yearly.js";
import { foreignDays, parseBankExport, summarizeExport } from "../import/bank.js";
import { readYearStatement } from "../import/yearStatement.js";
import { pdfContribution, personalNames } from "../import/contribute.js";
import { APP_VERSION } from "../lib/version.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";
import { D, type Decimal } from "../lib/decimal.js";
import { localToday } from "../lib/time.js";
import { tr } from "../i18n/index.js";

const KINDS = [
  "broker",
  "exchange",
  "vault",
  "wallet",
  "bank",
  "physical",
  "other",
  "property",
  "receivable",
  "debt",
  "insurance",
] as const;

const body = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(KINDS),
  provider: z.string().trim().max(50).nullish(),
  notes: z.string().max(2000).nullish(),
  archived: z.boolean().optional(),
  tracking: z.enum(["transactions", "yearly"]).optional(),
  owner: z.enum(["self", "partner", "joint", "child"]).optional(),
  ownerChildId: z.number().int().positive().nullish(),
  jointSelfPct: z.coerce.number().min(0).max(100).optional(),
  foreign: z.boolean().optional(),
});

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(",", "."))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { error: () => tr("Must be a number") });

/** A checked money string as a decimal; null when it's missing or not a number. */
const decimal = (v: string | undefined) => (v != null && /^-?\d+(\.\d+)?$/.test(v) ? D(v) : null);

const yearRow = z
  .object({
    year: z.number().int().min(1990).max(2100),
    valueEur: money.nullable(),
    inEur: money.default("0"),
    outEur: money.default("0"),
    incomeEur: money.default("0"),
    costsEur: money.default("0"),
    details: z
      .object({
        rented: z.boolean().optional(),
        rentEur: money.optional(),
        relatedBelowMarket: z.boolean().optional(),
        taxWithheldEur: money.optional(),
        taxCountry: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional(),
        source: z.string().max(200).optional(),
      })
      .default({}),
  })
  // An amount that isn't a number already failed its own check above: these skip it.
  .refine((r) => !decimal(r.details.taxWithheldEur)?.gt(0) || !!r.details.taxCountry, {
    path: ["details", "taxCountry"],
    error: () => tr("Choose the country that withheld the tax"),
  })
  .refine((r) => !decimal(r.details.taxWithheldEur)?.lt(0), {
    path: ["details", "taxWithheldEur"],
    error: () => tr("The tax withheld can't be negative"),
  })
  .refine(
    (r) => {
      const tax = decimal(r.details.taxWithheldEur);
      const income = decimal(r.incomeEur);
      return !tax?.gt(0) || !income || tax.lte(income);
    },
    { path: ["details", "taxWithheldEur"], error: () => tr("The tax withheld can't be more than the income") },
  );

const idParam = z.object({ id: z.coerce.number().int().positive() });

// The text of a PDF's pages, read in the browser.
const statementPages = z
  .array(z.object({ page: z.number().int().positive(), text: z.string().max(200_000) }))
  .min(1)
  .max(100);

export async function accountRoutes(app: FastifyInstance) {
  const { db, prices } = app.deps;

  app.get("/", async () => {
    const rows = await db
      .select({
        account: accounts,
        // Qualified explicitly: interpolated columns render unqualified and would bind to the subquery table.
        txCount: sql<number>`(select count(*)::int from transactions t where t.account_id = "accounts"."id")`,
        itemCount: sql<number>`(select count(*)::int from metal_items m where m.account_id = "accounts"."id")`,
        // Latest value per year (for accounts kept that way).
        latestYear: sql<
          number | null
        >`(select max(y.year) from account_years y where y.account_id = "accounts"."id" and y.value_eur is not null)`,
        latestValueEur: sql<
          string | null
        >`(select y.value_eur from account_years y where y.account_id = "accounts"."id" and y.value_eur is not null order by y.year desc limit 1)`,
      })
      .from(accounts)
      .orderBy(asc(accounts.name));
    return rows.map((r) => ({
      ...r.account,
      txCount: r.txCount,
      itemCount: r.itemCount,
      latestYear: r.latestYear,
      latestValueEur: r.latestValueEur,
    }));
  });

  /**
   * Homes, money lent, debts and insurance policies are kept as values per year. An account with
   * history can't switch to values per year (its holdings would count twice). A child owner must be
   * a child in the household.
   */
  const checked = async (
    data: Partial<z.infer<typeof body>>,
    before?: typeof accounts.$inferSelect,
  ): Promise<Partial<typeof accounts.$inferInsert>> => {
    const kind = data.kind ?? before?.kind ?? "other";
    let tracking = data.tracking ?? before?.tracking ?? "transactions";
    if (YEARLY_ONLY_KINDS.has(kind)) tracking = "yearly";
    if (tracking === "yearly" && before && before.tracking !== "yearly") {
      const [used] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.accountId, before.id))
        .limit(1);
      const [usedItem] = await db
        .select({ id: metalItems.id })
        .from(metalItems)
        .where(eq(metalItems.accountId, before.id))
        .limit(1);
      if (used || usedItem)
        throw new HttpError(409, tr("This account has transactions; add a new account for values per year instead"));
    }
    const owner = data.owner ?? before?.owner ?? "self";
    let ownerChildId = data.ownerChildId !== undefined ? data.ownerChildId : (before?.ownerChildId ?? null);
    if (owner === "child") {
      const [child] = ownerChildId
        ? await db
            .select({ id: persons.id })
            .from(persons)
            .where(and(eq(persons.id, ownerChildId), eq(persons.role, "child")))
        : [];
      if (!child) throw new HttpError(400, tr("Choose which child the account belongs to"));
    } else ownerChildId = null;
    const { jointSelfPct, ...rest } = data;
    return {
      ...rest,
      tracking,
      owner,
      ownerChildId,
      ...(jointSelfPct !== undefined ? { jointSelfPct: String(jointSelfPct) } : {}),
    };
  };

  app.post("/", async (req) => {
    const data = await checked(body.parse(req.body));
    const [row] = await db
      .insert(accounts)
      .values(data as typeof accounts.$inferInsert)
      .returning();
    await audit(db, "account", row!.id, "create", null, row);
    return row;
  });

  app.put("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!before) throw notFound(tr("Account"));
    const data = await checked(body.partial().parse(req.body), before);
    const [row] = await db.update(accounts).set(data).where(eq(accounts.id, id)).returning();
    await audit(db, "account", id, "update", before, row);
    return row;
  });

  // ---- Values per year ----

  app.get("/:id/years", async (req) => {
    const { id } = idParam.parse(req.params);
    return db.select().from(accountYears).where(eq(accountYears.accountId, id)).orderBy(asc(accountYears.year));
  });

  /** Replaces all values per year of an account. */
  app.put("/:id/years", async (req) => {
    const { id } = idParam.parse(req.params);
    const { rows } = z.object({ rows: z.array(yearRow).max(200) }).parse(req.body);
    const [acc] = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!acc) throw notFound(tr("Account"));
    if (acc.tracking !== "yearly")
      throw new HttpError(400, tr("This account is kept with transactions, not values per year"));
    if (new Set(rows.map((r) => r.year)).size !== rows.length)
      throw new HttpError(400, tr("Each year can appear only once"));
    // Tax withheld abroad is offset on interest received: not on rent, nor on a debt's interest paid.
    if ((acc.kind === "debt" || acc.kind === "property") && rows.some((r) => decimal(r.details.taxWithheldEur)?.gt(0)))
      throw new HttpError(400, tr("Only interest received can have tax withheld abroad"));
    const before = await db.select().from(accountYears).where(eq(accountYears.accountId, id));
    await db.transaction(async (trx) => {
      await trx.delete(accountYears).where(eq(accountYears.accountId, id));
      if (rows.length)
        await trx.insert(accountYears).values(rows.map((r) => ({ ...r, accountId: id, updatedAt: new Date() })));
    });
    const after = await db
      .select()
      .from(accountYears)
      .where(eq(accountYears.accountId, id))
      .orderBy(asc(accountYears.year));
    await audit(db, "account_years", id, "update", { rows: before }, { rows: after });
    return after;
  });

  /** Reads a bank export into values per year, for the user to check before saving. */
  app.post("/:id/bank-import", { bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    idParam.parse(req.params);
    const { content, closingBalance } = z
      .object({
        fileName: z.string().max(200).optional(),
        content: z
          .string()
          .min(1)
          .max(15 * 1024 * 1024),
        closingBalance: z.string().max(40).optional(),
      })
      .parse(req.body);
    const today = localToday();
    let parsed;
    try {
      parsed = parseBankExport(content);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    // Accounts in another currency (Revolut, Wise): look up the ECB rates for the days needed.
    // A currency without rates (offline, or one the ECB doesn't publish) stays unconverted, with a warning.
    const rates = new Map<string, Decimal>();
    for (const [currency, days] of foreignDays(parsed, today)) {
      const sorted = [...days].sort();
      try {
        await prices.fx.ensureRange([currency], sorted[0]!, sorted.at(-1)!);
        for (const day of sorted) rates.set(`${currency}|${day}`, await prices.fx.eurPerUnit(currency, day));
      } catch {
        // Left out of `rates`.
      }
    }
    try {
      return summarizeExport(parsed, { closingBalance, today }, (currency, day) => rates.get(`${currency}|${day}`));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  /**
   * Finds values per year in the text of a year statement (a PDF read in the browser), for the user to
   * pick from. Nothing is kept.
   */
  app.post("/:id/year-statement", { bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    idParam.parse(req.params);
    const { pages } = z.object({ pages: statementPages }).parse(req.body);
    return readYearStatement(pages);
  });

  /**
   * A year statement without a template, to share (ADR 0012): its text with every number made up and
   * every uncommon word turned into x's, plus which lines the user picked for which value. For the user
   * to check and share themselves; nothing is sent anywhere and nothing is kept.
   */
  app.post("/:id/year-statement/contribution", { bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    idParam.parse(req.params);
    const b = z
      .object({
        pages: statementPages,
        picked: z
          .array(
            z.object({
              page: z.number().int().positive(),
              line: z.string().max(2000),
              field: z.enum(["valueEur", "inEur", "outEur", "incomeEur", "costsEur"]),
              year: z.number().int().min(1900).max(2100),
            }),
          )
          .min(1)
          .max(50),
        provider: z.string().trim().min(1).max(60),
        document: z.string().trim().max(300).default(""),
        replace: z.array(z.string().max(500)).max(1000).default([]),
      })
      .parse(req.body);
    return pdfContribution({ ...b, avoid: await personalNames(db), version: APP_VERSION });
  });

  app.delete("/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!before) throw notFound(tr("Account"));
    const [used] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.accountId, id))
      .limit(1);
    const [usedItem] = await db
      .select({ id: metalItems.id })
      .from(metalItems)
      .where(eq(metalItems.accountId, id))
      .limit(1);
    if (used || usedItem) throw new HttpError(409, tr("Account has transactions or items; archive it instead"));
    await db.delete(accounts).where(eq(accounts.id, id));
    await audit(db, "account", id, "delete", before, null);
    return { ok: true };
  });
}
