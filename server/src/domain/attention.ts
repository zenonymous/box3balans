import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Config } from "../config.js";
import type { DB } from "../db/client.js";
import { accounts, accountYears, assets, integrations, settings, transactions, walletAddresses } from "../db/schema.js";
import { isAutomatic, listBackups } from "../backup/backup.js";
import { getBackupStatus } from "../backup/status.js";
import { D } from "../lib/decimal.js";
import { localToday } from "../lib/time.js";
import { REFRESH_STATUS_KEY, type RefreshResult } from "../prices/service.js";
import type { BackfillResult } from "../jobs/backfill.js";
import { buildPortfolio } from "./portfolio.js";
import { loadLedger } from "./portfolio.js";
import { tr, trn } from "../i18n/index.js";

export type Severity = "problem" | "warning" | "info";

export interface Issue {
  // Stable per kind of issue (and account/asset), so a dismissal sticks.
  key: string;
  severity: Severity;
  title: string;
  detail?: string;
  link?: { to: string; label: string };
  // Changes when the issue does; a dismissed issue comes back when it changes.
  fingerprint: string;
  dismissible: boolean;
}

const DISMISSED_KEY = "attention_dismissed";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Withdrawals are matched to deposits up to 5 days later; after that, an unlinked one is worth a look.
const UNLINKED_AFTER_MS = 6 * DAY;

export async function getDismissed(db: DB): Promise<Record<string, string>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, DISMISSED_KEY));
  return (row?.value as Record<string, string> | undefined) ?? {};
}

export async function dismiss(db: DB, key: string, fingerprint: string) {
  const value = { ...(await getDismissed(db)), [key]: fingerprint };
  await db
    .insert(settings)
    .values({ key: DISMISSED_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

const list = (xs: string[], max = 5) =>
  xs.length > max
    ? tr("{list} and {n} more", { list: xs.slice(0, max).join(", "), n: xs.length - max })
    : xs.join(", ");
const ago = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / HOUR;
  return h < 48 ? tr("{n} h ago", { n: Math.max(1, Math.round(h)) }) : tr("{n} days ago", { n: Math.round(h / 24) });
};

interface SyncLike {
  lastStatus: string | null;
  lastSyncAt: Date | null;
  lastResult: Record<string, unknown> | null;
  enabled: boolean;
}

/** Everything that needs a look, most serious first. Dismissed issues are left out. */
export async function collectIssues(
  db: DB,
  config: Config,
  deps: { staleAfterMs: number; backfill: BackfillResult | null },
  opts: { includeDismissed?: boolean } = {},
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, "dismissible"> & { dismissible?: boolean }) =>
    issues.push({ dismissible: i.severity !== "problem", ...i });

  const [accountRows, conns, addrs, statusRow] = await Promise.all([
    db.select().from(accounts),
    db.select().from(integrations),
    db.select().from(walletAddresses),
    db.select().from(settings).where(eq(settings.key, REFRESH_STATUS_KEY)),
  ]);
  const accountName = new Map(accountRows.map((a) => [a.id, a.name]));

  // ---- Syncs: exchange connections and wallets ----
  const syncInterval = config.SYNC_INTERVAL_HOURS * HOUR;
  const checkSync = (kind: "connection" | "wallet", id: string, name: string, s: SyncLike, to: string) => {
    if (!s.enabled) return;
    const r = s.lastResult ?? {};
    if (s.lastStatus === "error") {
      add({
        key: `${kind}-error:${id}`,
        severity: "problem",
        title: tr("{name}: the last sync failed", { name }),
        detail: String(r.error ?? tr("Unknown error")),
        link: { to, label: kind === "wallet" ? tr("Wallets") : tr("Connections") },
        fingerprint: String(r.at ?? ""),
      });
    }
    const mismatches = (r.mismatches as { symbol: string; difference: string }[] | undefined) ?? [];
    if (mismatches.length) {
      add({
        key: `${kind}-mismatch:${id}`,
        severity: "warning",
        title: trn(mismatches.length, "{name}: {n} balance difference", "{name}: {n} balance differences", { name }),
        detail: (() => {
          const diffs = list(
            mismatches.map(
              (m) =>
                `${m.symbol} ${D(m.difference).gt(0) ? "+" : ""}${D(m.difference).toSignificantDigits(6).toFixed()}`,
            ),
          );
          return kind === "wallet"
            ? tr("{list} compared with what the chain reports. Usually missing history; fix it or adjust.", {
                list: diffs,
              })
            : tr("{list} compared with what the exchange reports. Usually missing history; fix it or adjust.", {
                list: diffs,
              });
        })(),
        link: { to, label: tr("Review") },
        fingerprint: mismatches.map((m) => `${m.symbol}:${m.difference}`).join(","),
      });
    }
    if (r.partial) {
      add({
        key: `${kind}-partial:${id}`,
        severity: "info",
        title: tr("{name}: history still importing", { name }),
        detail: tr("Rate-limited sources load older history over several syncs."),
        link: { to, label: tr("Wallets") },
        fingerprint: String(r.at ?? ""),
      });
    }
    if (
      syncInterval > 0 &&
      s.lastSyncAt &&
      Date.now() - s.lastSyncAt.getTime() > Math.max(2 * syncInterval, 12 * HOUR)
    ) {
      add({
        key: `${kind}-stale:${id}`,
        severity: "warning",
        title: tr("{name} hasn't synced for {ago}", { name, ago: ago(s.lastSyncAt.toISOString()) }),
        detail: tr("Syncs should run every {n} h.", { n: config.SYNC_INTERVAL_HOURS }),
        link: { to, label: kind === "wallet" ? tr("Wallets") : tr("Connections") },
        fingerprint: s.lastSyncAt.toISOString().slice(0, 10),
      });
    }
  };
  for (const c of conns) {
    checkSync("connection", String(c.id), accountName.get(c.accountId) ?? c.provider, c, "/connections");
  }
  // Wallet addresses sync per account and chain; report each pair once.
  const seenWallets = new Set<string>();
  for (const a of addrs) {
    const id = `${a.accountId}:${a.chain}`;
    if (seenWallets.has(id) || !a.lastResult) continue;
    seenWallets.add(id);
    checkSync("wallet", id, `${accountName.get(a.accountId) ?? tr("Wallet")} (${a.chain})`, a, "/wallets");
  }

  // ---- Prices ----
  const refresh = statusRow[0]?.value as RefreshResult | undefined;
  if (refresh?.failed.length) {
    add({
      key: "price-failed",
      severity: "warning",
      title: trn(
        refresh.failed.length,
        "Prices couldn't be updated for {n} asset",
        "Prices couldn't be updated for {n} assets",
      ),
      detail: list(refresh.failed.map((f) => f.symbol)),
      link: { to: "/settings", label: tr("Prices") },
      fingerprint: refresh.failed
        .map((f) => f.symbol)
        .sort()
        .join(","),
    });
  }
  const { summary, holdings } = await buildPortfolio(db, { staleAfterMs: deps.staleAfterMs });
  if (summary.missingPrices.length) {
    add({
      key: "price-missing",
      severity: "warning",
      title: trn(summary.missingPrices.length, "No price for {n} holding", "No price for {n} holdings"),
      detail: tr("{list}: valued at €0 until a price is found or entered.", { list: list(summary.missingPrices) }),
      link: { to: "/assets", label: tr("Assets") },
      fingerprint: [...summary.missingPrices].sort().join(","),
    });
  }
  const stale = holdings.filter((h) => h.priceStale && h.priceFetchedAt).map((h) => h.symbol);
  if (stale.length) {
    add({
      key: "price-stale",
      severity: "warning",
      title: trn(stale.length, "Stale price for {n} holding", "Stale price for {n} holdings"),
      detail: tr("{list}: not updated in the last refreshes.", { list: list(stale) }),
      link: { to: "/settings", label: tr("Prices") },
      fingerprint: [...stale].sort().join(","),
    });
  }
  if (deps.backfill?.failed.length) {
    add({
      key: "history-failed",
      severity: "info",
      title: trn(
        deps.backfill.failed.length,
        "Price history couldn't be loaded for {n} asset",
        "Price history couldn't be loaded for {n} assets",
      ),
      detail: tr("{list}. Charts value them at cost where history is missing.", {
        list: list(deps.backfill.failed.map((f) => f.symbol)),
      }),
      link: { to: "/settings", label: tr("Prices") },
      fingerprint: deps.backfill.failed
        .map((f) => f.symbol)
        .sort()
        .join(","),
    });
  }

  // ---- Data that looks wrong ----
  const ledger = await loadLedger(db);
  const assetRows = await db
    .select({ id: assets.id, symbol: assets.symbol, assetClass: assets.assetClass })
    .from(assets);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const negative = ledger.positions.filter((p) => p.quantity.lt("-0.00000001"));
  for (const p of negative) {
    const a = assetById.get(p.assetId);
    const acc = accountName.get(p.accountId) ?? `#${p.accountId}`;
    add({
      key: `negative:${p.accountId}:${p.assetId}`,
      severity: "problem",
      title: tr("Negative balance: {quantity} {symbol} in {account}", {
        quantity: p.quantity.toSignificantDigits(8).toFixed(),
        symbol: a?.symbol ?? "?",
        account: acc,
      }),
      detail:
        a?.assetClass === "cash"
          ? tr(
              "Buys are paid from cash that was never deposited. Add the deposits, or stop booking cash for these trades.",
            )
          : tr(
              "More was sold, sent or spent than was bought or received. Some history is missing (an earlier buy or deposit).",
            ),
      link: { to: `/transactions?accountId=${p.accountId}&assetId=${p.assetId}`, label: tr("Transactions") },
      fingerprint: p.quantity.toFixed(),
    });
  }

  const nonCash = assetRows.filter((a) => a.assetClass !== "cash").map((a) => a.id);
  if (nonCash.length) {
    const zero = await db
      .select({ id: transactions.id, assetId: transactions.assetId, type: transactions.type })
      .from(transactions)
      .where(
        and(
          inArray(transactions.type, ["deposit", "reward"]),
          eq(transactions.price, "0"),
          inArray(transactions.assetId, nonCash),
        ),
      );
    if (zero.length) {
      add({
        key: "zero-cost",
        severity: "info",
        title: trn(zero.length, "{n} deposit or reward without a value", "{n} deposits or rewards without a value"),
        detail: tr(
          "{list}: booked at €0 because no price was known for that day, which overstates gains when sold. Edit them to enter the value.",
          { list: list([...new Set(zero.map((z) => assetById.get(z.assetId)?.symbol ?? "?"))]) },
        ),
        link: { to: "/transactions?type=deposit", label: tr("Transactions") },
        fingerprint: String(zero.length),
      });
    }
  }

  // Accounts kept as values per year need their 1 January value each year (from the bank's year
  // statement or the WOZ assessment).
  const yearlyAccounts = accountRows.filter((a) => a.tracking === "yearly" && !a.archived);
  if (yearlyAccounts.length) {
    const thisYear = Number(localToday().slice(0, 4));
    const rows = await db
      .select({ accountId: accountYears.accountId, year: accountYears.year, valueEur: accountYears.valueEur })
      .from(accountYears);
    const missing = yearlyAccounts.filter((a) => {
      const own = rows.filter((r) => r.accountId === a.id);
      return own.length > 0 && !own.some((r) => r.year === thisYear && r.valueEur != null);
    });
    if (missing.length) {
      add({
        key: `yearly-missing:${thisYear}`,
        severity: "warning",
        title: trn(
          missing.length,
          "{n} account without a value on 1 January {year}",
          "{n} accounts without a value on 1 January {year}",
          { year: thisYear },
        ),
        detail: tr(
          "{list}. Box 3 counts what you had on 1 January: take it from the year statement (jaaroverzicht) or, for a home, the WOZ assessment.",
          { list: list(missing.map((a) => a.name)) },
        ),
        link: { to: "/accounts", label: tr("Accounts") },
        fingerprint: missing
          .map((a) => a.id)
          .sort()
          .join(","),
      });
    }
  }

  const exchangeIds = accountRows.filter((a) => a.kind === "exchange").map((a) => a.id);
  const crypto = assetRows.filter((a) => a.assetClass === "crypto").map((a) => a.id);
  if (exchangeIds.length && crypto.length) {
    const unlinked = await db
      .select({ id: transactions.id, assetId: transactions.assetId })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "withdrawal"),
          isNull(transactions.transferGroup),
          inArray(transactions.accountId, exchangeIds),
          inArray(transactions.assetId, crypto),
          lt(transactions.occurredAt, new Date(Date.now() - UNLINKED_AFTER_MS)),
        ),
      );
    if (unlinked.length) {
      add({
        key: "unlinked-withdrawals",
        severity: "info",
        title: trn(
          unlinked.length,
          "{n} crypto withdrawal from exchanges not linked to a deposit",
          "{n} crypto withdrawals from exchanges not linked to a deposit",
        ),
        detail: tr(
          "{list}. If they went to a wallet of yours, track that wallet so the purchase cost moves along; otherwise they count as disposals.",
          { list: list([...new Set(unlinked.map((u) => assetById.get(u.assetId)?.symbol ?? "?"))]) },
        ),
        link: { to: "/wallets", label: tr("Wallets") },
        fingerprint: String(unlinked.length),
      });
    }
  }

  // ---- Backups ----
  const backupInterval = config.BACKUP_INTERVAL_HOURS * HOUR;
  const status = await getBackupStatus(db);
  if (status.lastErrorAt && (!status.lastSuccessAt || status.lastErrorAt > status.lastSuccessAt)) {
    add({
      key: "backup-failed",
      severity: "problem",
      title: tr("The last automatic backup failed"),
      detail: status.lastError,
      link: { to: "/settings", label: tr("Backups") },
      fingerprint: status.lastErrorAt,
    });
  }
  let backups: ReturnType<typeof listBackups> = [];
  try {
    backups = listBackups(config.BACKUP_DIR);
  } catch {
    // reported through the failed-backup status
  }
  const latestAuto = backups.find((b) => isAutomatic(b.name));
  if (backupInterval > 0 && latestAuto && Date.now() - Date.parse(latestAuto.createdAt) > 2 * backupInterval + HOUR) {
    add({
      key: "backup-overdue",
      severity: "problem",
      title: tr("No automatic backup since {ago}", { ago: ago(latestAuto.createdAt) }),
      link: { to: "/settings", label: tr("Backups") },
      fingerprint: latestAuto.name,
    });
  }
  if (backupInterval === 0 && !backups.length && !config.DEMO) {
    add({
      key: "backup-none",
      severity: "warning",
      title: tr("No backups"),
      detail: tr("Automatic backups are off (BACKUP_INTERVAL_HOURS=0) and there are no manual ones."),
      link: { to: "/settings", label: tr("Backups") },
      fingerprint: "none",
    });
  }
  if (!config.BACKUP_PASSPHRASE && !config.DEMO) {
    add({
      key: "backup-unencrypted",
      severity: "warning",
      title: tr("Backups aren't encrypted"),
      detail: tr("Anyone with a copy can read all your data. Set BACKUP_PASSPHRASE in .env and restart."),
      link: { to: "/settings", label: tr("Backups") },
      fingerprint: "unencrypted",
    });
  }

  const rank: Record<Severity, number> = { problem: 0, warning: 1, info: 2 };
  const dismissed = opts.includeDismissed ? {} : await getDismissed(db);
  return issues
    .filter((i) => !(i.dismissible && dismissed[i.key] === i.fingerprint))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}
