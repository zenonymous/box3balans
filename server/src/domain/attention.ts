import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Config } from "../config.js";
import type { DB } from "../db/client.js";
import { accounts, assets, integrations, settings, transactions, walletAddresses } from "../db/schema.js";
import { isAutomatic, listBackups } from "../backup/backup.js";
import { getBackupStatus } from "../backup/status.js";
import { D } from "../lib/decimal.js";
import { REFRESH_STATUS_KEY, type RefreshResult } from "../prices/service.js";
import type { BackfillResult } from "../jobs/backfill.js";
import { buildPortfolio } from "./portfolio.js";
import { loadLedger } from "./portfolio.js";

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
  xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", ");
const ago = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / HOUR;
  return h < 48 ? `${Math.max(1, Math.round(h))} h ago` : `${Math.round(h / 24)} days ago`;
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
        title: `${name}: the last sync failed`,
        detail: String(r.error ?? "Unknown error"),
        link: { to, label: kind === "wallet" ? "Wallets" : "Connections" },
        fingerprint: String(r.at ?? ""),
      });
    }
    const mismatches = (r.mismatches as { symbol: string; difference: string }[] | undefined) ?? [];
    if (mismatches.length) {
      add({
        key: `${kind}-mismatch:${id}`,
        severity: "warning",
        title: `${name}: ${mismatches.length} balance difference${mismatches.length === 1 ? "" : "s"}`,
        detail: `${list(mismatches.map((m) => `${m.symbol} ${D(m.difference).gt(0) ? "+" : ""}${D(m.difference).toSignificantDigits(6).toFixed()}`))} compared with what the ${kind === "wallet" ? "chain" : "exchange"} reports. Usually missing history; fix it or adjust.`,
        link: { to, label: "Review" },
        fingerprint: mismatches.map((m) => `${m.symbol}:${m.difference}`).join(","),
      });
    }
    if (r.partial) {
      add({
        key: `${kind}-partial:${id}`,
        severity: "info",
        title: `${name}: history still importing`,
        detail: "Rate-limited sources load older history over several syncs.",
        link: { to, label: "Wallets" },
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
        title: `${name} hasn't synced for ${ago(s.lastSyncAt.toISOString())}`,
        detail: `Syncs should run every ${config.SYNC_INTERVAL_HOURS} h.`,
        link: { to, label: kind === "wallet" ? "Wallets" : "Connections" },
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
    checkSync("wallet", id, `${accountName.get(a.accountId) ?? "Wallet"} (${a.chain})`, a, "/wallets");
  }

  // ---- Prices ----
  const refresh = statusRow[0]?.value as RefreshResult | undefined;
  if (refresh?.failed.length) {
    add({
      key: "price-failed",
      severity: "warning",
      title: `Prices couldn't be updated for ${refresh.failed.length} asset${refresh.failed.length === 1 ? "" : "s"}`,
      detail: list(refresh.failed.map((f) => f.symbol)),
      link: { to: "/settings", label: "Prices" },
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
      title: `No price for ${summary.missingPrices.length} holding${summary.missingPrices.length === 1 ? "" : "s"}`,
      detail: `${list(summary.missingPrices)}: valued at €0 until a price is found or entered.`,
      link: { to: "/assets", label: "Assets" },
      fingerprint: [...summary.missingPrices].sort().join(","),
    });
  }
  const stale = holdings.filter((h) => h.priceStale && h.priceFetchedAt).map((h) => h.symbol);
  if (stale.length) {
    add({
      key: "price-stale",
      severity: "warning",
      title: `Stale price for ${stale.length} holding${stale.length === 1 ? "" : "s"}`,
      detail: `${list(stale)}: not updated in the last refreshes.`,
      link: { to: "/settings", label: "Prices" },
      fingerprint: [...stale].sort().join(","),
    });
  }
  if (deps.backfill?.failed.length) {
    add({
      key: "history-failed",
      severity: "info",
      title: `Price history couldn't be loaded for ${deps.backfill.failed.length} asset${deps.backfill.failed.length === 1 ? "" : "s"}`,
      detail: `${list(deps.backfill.failed.map((f) => f.symbol))}. Charts value them at cost where history is missing.`,
      link: { to: "/settings", label: "Prices" },
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
      title: `Negative balance: ${p.quantity.toSignificantDigits(8).toFixed()} ${a?.symbol ?? "?"} in ${acc}`,
      detail:
        a?.assetClass === "cash"
          ? "Buys are paid from cash that was never deposited. Add the deposits, or stop booking cash for these trades."
          : "More was sold, sent or spent than was bought or received. Some history is missing (an earlier buy or deposit).",
      link: { to: `/transactions?accountId=${p.accountId}&assetId=${p.assetId}`, label: "Transactions" },
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
        title: `${zero.length} deposit${zero.length === 1 ? "" : "s"} or reward${zero.length === 1 ? "" : "s"} without a value`,
        detail: `${list([...new Set(zero.map((z) => assetById.get(z.assetId)?.symbol ?? "?"))])}: booked at €0 because no price was known for that day, which overstates gains when sold. Edit them to enter the value.`,
        link: { to: "/transactions?type=deposit", label: "Transactions" },
        fingerprint: String(zero.length),
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
        title: `${unlinked.length} crypto withdrawal${unlinked.length === 1 ? "" : "s"} from exchanges not linked to a deposit`,
        detail: `${list([...new Set(unlinked.map((u) => assetById.get(u.assetId)?.symbol ?? "?"))])}. If they went to a wallet of yours, track that wallet so the purchase cost moves along; otherwise they count as disposals.`,
        link: { to: "/wallets", label: "Wallets" },
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
      title: "The last automatic backup failed",
      detail: status.lastError,
      link: { to: "/settings", label: "Backups" },
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
      title: `No automatic backup since ${ago(latestAuto.createdAt)}`,
      link: { to: "/settings", label: "Backups" },
      fingerprint: latestAuto.name,
    });
  }
  if (backupInterval === 0 && !backups.length) {
    add({
      key: "backup-none",
      severity: "warning",
      title: "No backups",
      detail: "Automatic backups are off (BACKUP_INTERVAL_HOURS=0) and there are no manual ones.",
      link: { to: "/settings", label: "Backups" },
      fingerprint: "none",
    });
  }
  if (!config.BACKUP_PASSPHRASE) {
    add({
      key: "backup-unencrypted",
      severity: "warning",
      title: "Backups aren't encrypted",
      detail: "Anyone with a copy can read all your data. Set BACKUP_PASSPHRASE in .env and restart.",
      link: { to: "/settings", label: "Backups" },
      fingerprint: "unencrypted",
    });
  }

  const rank: Record<Severity, number> = { problem: 0, warning: 1, info: 2 };
  const dismissed = opts.includeDismissed ? {} : await getDismissed(db);
  return issues
    .filter((i) => !(i.dismissible && dismissed[i.key] === i.fingerprint))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}
