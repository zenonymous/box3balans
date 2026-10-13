import { and, eq, gte, inArray, isNull, lt, min } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, assets, imports, integrations, transactions, walletAddresses } from "../db/schema.js";
import { storedChecks } from "../import/statement.js";
import { tr, trn } from "../i18n/index.js";
import { fromLocal } from "../lib/time.js";
import { RULES } from "../rules/index.js";
import { holdingsOn } from "./valuation.js";
import { loadYearly, yearlyValue } from "./yearly.js";

// ok: done; todo: to do now; later: to do after 31 December; info: worth a look, not required.
export type ChecklistStatus = "ok" | "todo" | "later" | "info";

export interface ChecklistItem {
  key: string;
  status: ChecklistStatus;
  account: string | null;
  text: string;
  link?: { to: string; label: string };
}

export interface PeildatumChecklist {
  year: number;
  // The last day of the year before: holdings at its end count on the peildatum.
  day: string;
  passed: boolean;
  open: number;
  items: ChecklistItem[];
}

/**
 * What box 3 of `year` needs for its peildatum, 1 January: per account its value on that day, or
 * its history up to the end of 31 December (synced, imported, or checked against a broker's
 * statement); prices on that day; and own wallets that exchange withdrawals point to. Before the
 * peildatum it lists what to do once it has passed.
 */
export async function peildatumChecklist(db: DB, year: number, now = new Date()): Promise<PeildatumChecklist> {
  const day = `${year - 1}-12-31`;
  const start = fromLocal(year, 1, 1, 0);
  const passed = now >= start;
  const after: ChecklistStatus = passed ? "todo" : "later";
  const items: ChecklistItem[] = [];

  const [accountRows, conns, addrs, importRows, statements, yearly, firsts] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.archived, false)),
    db.select().from(integrations).where(eq(integrations.enabled, true)),
    db.select().from(walletAddresses).where(eq(walletAddresses.enabled, true)),
    db.select({ accountId: imports.accountId, createdAt: imports.createdAt }).from(imports),
    storedChecks(db, undefined, day),
    loadYearly(db),
    db
      .select({ accountId: transactions.accountId, first: min(transactions.occurredAt) })
      .from(transactions)
      .groupBy(transactions.accountId),
  ]);
  const firstTx = new Map(firsts.map((f) => [f.accountId, f.first]));

  if (!accountRows.some((a) => a.kind === "bank"))
    items.push({
      key: "no-bank",
      status: "info",
      account: null,
      text: tr("No bank accounts yet: savings and current accounts count for box 3 with their balance on 1 January."),
      link: { to: "/accounts", label: tr("Accounts") },
    });

  for (const a of accountRows.sort((x, y) => x.name.localeCompare(y.name))) {
    const base = { account: a.name };
    if (a.tracking === "yearly") {
      const years = [...(yearly.get(a.id)?.keys() ?? [])];
      // Values only for later years: the account didn't exist yet.
      if (years.length && years.every((y) => y > year)) continue;
      const done = yearlyValue(a.kind, yearly.get(a.id)?.get(year)) != null;
      items.push({
        ...base,
        key: `value:${a.id}`,
        status: done ? "ok" : after,
        text: done
          ? tr("Value on 1 January {year} entered", { year })
          : tr("Enter the value on 1 January {year}", { year }),
        link: done ? undefined : { to: "/accounts", label: tr("Accounts") },
      });
      continue;
    }
    // History that only starts after the peildatum: nothing was held there yet.
    const first = firstTx.get(a.id);
    if (first && first >= start) continue;
    const conn = conns.filter((c) => c.accountId === a.id);
    const wallet = addrs.filter((w) => w.accountId === a.id);
    if (conn.length || wallet.length) {
      const done = [...conn, ...wallet].every((s) => s.lastSyncAt && s.lastSyncAt >= start && s.lastStatus !== "error");
      items.push({
        ...base,
        key: `sync:${a.id}`,
        status: done ? "ok" : after,
        text: done ? tr("Synced after 31 December") : tr("Sync after 31 December {year}", { year: year - 1 }),
        link: done
          ? undefined
          : wallet.length
            ? { to: "/wallets", label: tr("Wallets") }
            : { to: "/connections", label: tr("Connections") },
      });
      continue;
    }
    // DEGIRO has no API: its account statement up to 31 December, then its portfolio of that day.
    if (a.provider?.toLowerCase() === "degiro") {
      const st = statements.find((c) => c.accountId === a.id);
      items.push({
        ...base,
        key: `statement:${a.id}`,
        status: st && !st.differences ? "ok" : after,
        text: !st
          ? tr("Import the account statement up to 31 December {year}, then the portfolio (Portefeuille) of that day", {
              year: year - 1,
            })
          : st.differences
            ? trn(
                st.differences,
                "{n} difference with the portfolio of 31 December",
                "{n} differences with the portfolio of 31 December",
              )
            : tr("Checked against the portfolio of 31 December"),
        link:
          st && !st.differences
            ? undefined
            : {
                to: st ? `/transactions/import?statement=${a.id}&day=${day}` : "/transactions/import",
                label: tr("Import"),
              },
      });
      continue;
    }
    const imported = importRows.filter((i) => i.accountId === a.id);
    if (imported.length) {
      const done = imported.some((i) => i.createdAt >= start);
      items.push({
        ...base,
        key: `import:${a.id}`,
        status: done ? "ok" : after,
        text: done
          ? tr("Imported after 31 December")
          : tr("Import the transactions up to 31 December {year}", { year: year - 1 }),
        link: done ? undefined : { to: "/transactions/import", label: tr("Import") },
      });
      continue;
    }
    // Places for coins and bars hold items entered by hand; nothing to fetch.
    if (a.kind === "physical") continue;
    items.push({
      ...base,
      key: `manual:${a.id}`,
      status: "info",
      text: tr("Kept by hand: check that its transactions up to 31 December are complete"),
      link: { to: `/transactions?accountId=${a.id}`, label: tr("Transactions") },
    });
  }

  if (passed) {
    const yearlyIds = new Set(accountRows.filter((a) => a.tracking === "yearly").map((a) => a.id));
    const unpriced = (await holdingsOn(db, day)).filter(
      (h) => !yearlyIds.has(h.accountId) && h.priceEur == null && h.quantity.gt(0),
    );
    const symbols = [...new Set(unpriced.map((h) => h.symbol))];
    if (symbols.length)
      items.push({
        key: "prices",
        status: "info",
        account: null,
        text: tr("No price on 31 December for {list}; counted as €0.", { list: symbols.slice(0, 8).join(", ") }),
        link: { to: "/assets", label: tr("Assets") },
      });
  }

  // Crypto withdrawn from an exchange during the year that didn't arrive in an account here: usually
  // an own wallet that isn't in the app yet, and then missing from box 3.
  const exchangeIds = accountRows.filter((a) => a.kind === "exchange").map((a) => a.id);
  if (exchangeIds.length) {
    const unlinked = await db
      .select({ id: transactions.id })
      .from(transactions)
      .innerJoin(assets, eq(assets.id, transactions.assetId))
      .where(
        and(
          eq(transactions.type, "withdrawal"),
          isNull(transactions.transferGroup),
          eq(transactions.noAutoMatch, false),
          eq(assets.assetClass, "crypto"),
          inArray(transactions.accountId, exchangeIds),
          gte(transactions.occurredAt, fromLocal(year - 1, 1, 1, 0)),
          lt(transactions.occurredAt, start),
        ),
      );
    if (unlinked.length)
      items.push({
        key: "unlinked",
        status: "todo",
        account: null,
        text: trn(
          unlinked.length,
          "{n} crypto withdrawal from an exchange in {year} didn't arrive in an account here. Is each of your wallets in the app?",
          "{n} crypto withdrawals from exchanges in {year} didn't arrive in an account here. Is each of your wallets in the app?",
          { year: year - 1 },
        ),
        link: { to: "/wallets", label: tr("Wallets") },
      });
  }

  const rules = RULES.years[String(year)];
  if (!rules)
    items.push({
      key: "rules",
      status: "info",
      account: null,
      text: tr("No box 3 rules for {year} yet; a newer version of Box3balans brings them.", { year }),
    });
  else if (!rules.final)
    items.push({
      key: "rules",
      status: "info",
      account: null,
      text: tr("The box 3 rules for {year} are still provisional.", { year }),
    });

  return { year, day, passed, open: items.filter((i) => i.status === "todo").length, items };
}

/** The peildatum to prepare for: the coming one in December, the last one until the end of May. */
export function currentPeildatumYear(today: string): number | null {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  if (m === 12 && d >= 15) return y + 1;
  if (m <= 5) return y;
  return null;
}
