import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put, post } from "../api";
import { RefreshButton } from "../components/RefreshButton";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Tabs } from "../components/ui";
import { NUMBER_LOCALES, date, getLocale, relativeTime, setLocale } from "../format";
import { usePriceStatus } from "../queries";
import { followLanguage, getLang, t, tj, tn, type Lang } from "../i18n";

type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    const v = localStorage.getItem("theme");
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "system";
}

function applyTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {}
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

interface AppSettings {
  costMethod: "average" | "fifo";
  language: Lang;
}

const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => get<AppSettings>("/api/settings") });

export function SettingsPage() {
  const qc = useQueryClient();
  const status = usePriceStatus();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [locale, setLoc] = useState(getLocale());
  const s = status.data?.status;

  const logout = async () => {
    await post("/api/auth/logout");
    qc.clear();
    qc.setQueryData(["auth"], { needsSetup: false, user: null });
  };

  return (
    <>
      <PageHeader title={t("Settings")} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("Manage")}>
          <div className="flex flex-col gap-2 text-sm">
            {MANAGE.map(([to, text]) => (
              <Link key={to} to={to} className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
                {text}
              </Link>
            ))}
          </div>
        </Card>

        <CostMethodCard />

        <Card title={t("Appearance")}>
          <div className="flex flex-col gap-4">
            <LanguageField />
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-2">{t("Theme")}</div>
              <Tabs
                value={theme}
                onChange={(v) => {
                  setTheme(v);
                  applyTheme(v);
                }}
                options={[
                  { value: "system", label: t("System") },
                  { value: "light", label: t("Light") },
                  { value: "dark", label: t("Dark") },
                ]}
              />
            </div>
            <Field label={t("Number format")}>
              {(id) => (
                <Select
                  id={id}
                  value={locale}
                  onChange={(e) => {
                    const v = e.target.value as keyof typeof NUMBER_LOCALES;
                    setLoc(v);
                    setLocale(v);
                    void qc.invalidateQueries();
                  }}
                >
                  {Object.entries(NUMBER_LOCALES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Card>

        <Card title={t("Prices")} actions={<RefreshButton />}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-2">{t("Automatic refresh")}</dt>
            <dd>{status.data ? tn(status.data.intervalMinutes, "every minute", "every {n} minutes") : "—"}</dd>
            <dt className="text-ink-2">{t("Last refresh")}</dt>
            <dd>
              {s ? `${relativeTime(s.at)} — ${tn(s.updated, "{n} price updated", "{n} prices updated")}` : t("never")}
            </dd>
            <dt className="text-ink-2">{t("ECB FX rates")}</dt>
            <dd>{s?.fxError ? <span className="text-loss">{s.fxError}</span> : (s?.fxDate ?? "—")}</dd>
          </dl>
          {s && s.failed.length > 0 && (
            <div className="mt-3">
              <Alert>
                {t("Failed:")}{" "}
                {s.failed.map((f) => (
                  <span key={f.assetId} className="block text-xs">
                    {f.symbol}: {f.error}
                  </span>
                ))}
              </Alert>
            </div>
          )}
          {s?.fallbacks && s.fallbacks.length > 0 && (
            <p className="mt-3 text-xs text-ink-2">
              {t("Main source unavailable, priced by the second source: {list}.", {
                list: s.fallbacks.map((f) => `${f.symbol} (${FALLBACK_LABEL[f.source] ?? f.source})`).join(", "),
              })}
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            {t(
              "Sources: Yahoo Finance (stocks/ETFs), CoinGecko (crypto), gold-api.com with Yahoo futures fallback (metals), ECB via Frankfurter (FX). When the main source has no price, crypto falls back to Bitvavo and Yahoo, stocks and ETFs to Tradegate (by ISIN). Free feeds can lag ~15 minutes.",
            )}
          </p>
        </Card>

        <BackupsCard />

        <PasswordCard />

        <Card title={t("Session")}>
          <Button onClick={logout}>{t("Sign out")}</Button>
        </Card>

        <AboutCard />
      </div>
    </>
  );
}

/** Version, license and where the source is (the AGPL asks a network service to offer it). */
function AboutCard() {
  const version = useQuery({
    queryKey: ["version"],
    queryFn: () => get<{ version: string; source: string }>("/api/version"),
    staleTime: Infinity,
  });
  return (
    <Card title={t("About")}>
      <div className="flex flex-col gap-2 text-sm text-ink-2">
        <p>
          {tj(
            "Kluishuis {version} is free software under the <0>GNU AGPL-3.0</0>, without any warranty. It estimates; it doesn't give tax advice.",
            [
              <a
                key="l"
                className="underline"
                href="https://www.gnu.org/licenses/agpl-3.0.html"
                target="_blank"
                rel="noreferrer"
              />,
            ],
            { version: version.data?.version ?? "" },
          )}
        </p>
        {version.data?.source && (
          <p>
            {tj("<0>Source code</0> · report problems and suggest improvements there.", [
              <a key="s" className="underline" href={version.data.source} target="_blank" rel="noreferrer" />,
            ])}
          </p>
        )}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) return setMsg({ ok: false, text: t("New passwords do not match") });
    try {
      await post("/api/auth/password", { current: f.current, next: f.next });
      setF({ current: "", next: "", confirm: "" });
      setMsg({ ok: true, text: t("Password changed. Other sessions were signed out.") });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <Card title={t("Change password")}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label={t("Current password")}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={f.current}
              onChange={(e) => setF({ ...f, current: e.target.value })}
              required
            />
          )}
        </Field>
        <Field label={t("New password")} hint={t("At least 12 characters")}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={f.next}
              onChange={(e) => setF({ ...f, next: e.target.value })}
              required
            />
          )}
        </Field>
        <Field label={t("Confirm new password")}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={f.confirm}
              onChange={(e) => setF({ ...f, confirm: e.target.value })}
              required
            />
          )}
        </Field>
        {msg && (msg.ok ? <p className="text-sm text-gain">✓ {msg.text}</p> : <Alert tone="danger">{msg.text}</Alert>)}
        <div>
          <Button type="submit" variant="primary">
            {t("Change password")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CostMethodCard() {
  const qc = useQueryClient();
  const settings = useSettings();
  const [error, setError] = useState<string>();

  const change = async (costMethod: "average" | "fifo") => {
    setError(undefined);
    try {
      await put("/api/settings", { costMethod });
      // Every P&L figure depends on it.
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card title={t("Cost basis")}>
      <Field
        label={t("Method")}
        hint={t(
          "Average cost is common for Dutch investors (and what most brokers show). FIFO sells the oldest units first.",
        )}
      >
        {(id) => (
          <Select
            id={id}
            value={settings.data?.costMethod ?? "average"}
            onChange={(e) => change(e.target.value as "average" | "fifo")}
            disabled={!settings.data}
          >
            <option value="average">{t("Average cost")}</option>
            <option value="fifo">{t("FIFO (first in, first out)")}</option>
          </Select>
        )}
      </Field>
      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Card>
  );
}

interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
  encrypted: boolean;
}

interface BackupList {
  dir: string;
  intervalHours: number;
  keep: number;
  encrypted: boolean;
  status: { lastSuccessAt?: string; lastErrorAt?: string; lastError?: string };
  backups: BackupInfo[];
}

const FALLBACK_LABEL: Record<string, string> = { bitvavo: "Bitvavo", yahoo: "Yahoo", tradegate: "Tradegate" };

const MANAGE: [string, string][] = [
  ["/accounts", t("▣ Accounts — brokers, exchanges, wallets, vaults, storage")],
  ["/household", t("⌂ Household — you, your partner and children, for box 3")],
  ["/connections", t("⇅ Connections — sync Bitvavo, Kraken, Coinbase and IBKR")],
  ["/wallets", t("◈ Wallets — track Bitcoin, Ethereum & L2s, Solana and more by address")],
  ["/performance", t("↗ Performance — results per year, realized gains")],
  ["/income", t("❖ Income — dividends, staking rewards, interest")],
  ["/box3", t("§ Box 3: wealth on 1 January and tax estimate")],
  ["/assets", t("◇ Assets — instruments and price sources")],
  ["/activity", t("↺ History — every change, and restoring deleted transactions")],
  ["/start", t("✦ Start wizard — set up your household, accounts and values step by step")],
];

/** The app's language; stored on the server, so server messages follow it too. */
function LanguageField() {
  const settings = useSettings();
  const [error, setError] = useState<string>();
  const change = async (language: Lang) => {
    setError(undefined);
    try {
      await put("/api/settings", { language });
      followLanguage(language);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Field label={t("Language")}>
      {(id) => (
        <>
          <Select
            id={id}
            value={settings.data?.language ?? getLang()}
            onChange={(e) => void change(e.target.value as Lang)}
            disabled={!settings.data}
          >
            <option value="nl">Nederlands</option>
            <option value="en">English</option>
          </Select>
          {error && <Alert tone="danger">{error}</Alert>}
        </>
      )}
    </Field>
  );
}

/** Backups (gzipped JSON of all data) in the server's backup folder, plus CSV exports. */
function BackupsCard() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["backups"],
    queryFn: () => get<BackupList>("/api/backups"),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const backupNow = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const b = await post<BackupInfo>("/api/backups");
      setMsg({ ok: true, text: t("Backup written: {name}", { name: b.name }) });
      await qc.invalidateQueries({ queryKey: ["backups"] });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (e: FormEvent) => {
    e.preventDefault();
    if (!restoring) return;
    setBusy(true);
    setMsg(undefined);
    try {
      await post(`/api/backups/${encodeURIComponent(restoring)}/restore`, {
        confirm,
        ...(passphrase ? { passphrase } : {}),
      });
      // Sessions aren't in backups: sign in again with the restored account.
      qc.clear();
      qc.setQueryData(["auth"], { needsSetup: false, user: null });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
      setBusy(false);
    }
  };

  const d = list.data;
  const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
  return (
    <Card title={t("Backups & export")} className="lg:col-span-2">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {d && d.intervalHours > 0
            ? t("Automatic backups every {hours} h, keeping the latest {keep}.", {
                hours: d.intervalHours,
                keep: d.keep,
              })
            : t("Automatic backups are off (BACKUP_INTERVAL_HOURS=0).")}{" "}
          {tj(
            "Backups contain all data (exchange keys stay encrypted, so restoring them needs the same APP_SECRET) and are stored on the server in <0>{dir}</0>.",
            [<code key="d" className="rounded bg-surface-2 px-1 text-xs" />],
            { dir: d?.dir ?? "…" },
          )}
          {d?.encrypted && ` ${t("New backups are encrypted with your BACKUP_PASSPHRASE.")}`}
        </p>
        {d && !d.encrypted && (
          <Alert>
            {t(
              "Backups aren't encrypted: anyone with a copy can read all your data. Set BACKUP_PASSPHRASE in .env and restart to encrypt new backups.",
            )}
          </Alert>
        )}
        {d?.status.lastErrorAt && (!d.status.lastSuccessAt || d.status.lastErrorAt > d.status.lastSuccessAt) && (
          <Alert tone="danger">
            {t("The last automatic backup failed ({when}): {error}", {
              when: relativeTime(d.status.lastErrorAt),
              error: d.status.lastError ?? "",
            })}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={backupNow} disabled={busy}>
            {busy && !restoring ? t("Backing up…") : t("Back up now")}
          </Button>
          <a
            className="inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-2"
            href="/api/export/transactions.csv"
          >
            ⤓ {t("Transactions (CSV)")}
          </a>
          <a
            className="inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-2"
            href="/api/export/holdings.csv"
          >
            ⤓ {t("Holdings (CSV)")}
          </a>
        </div>
        {msg && (msg.ok ? <p className="text-sm text-gain">✓ {msg.text}</p> : <Alert tone="danger">{msg.text}</Alert>)}

        {d && d.backups.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="tabular w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">{t("Backup")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Made")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Size")}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.backups.map((b) => (
                  <tr key={b.name}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {b.name}
                      {b.encrypted && (
                        <span className="ml-1.5 font-sans text-muted" title={t("Encrypted")}>
                          🔒
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-2" title={b.createdAt}>
                      {date(b.createdAt)} · {relativeTime(b.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-2">{kb(b.sizeBytes)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <a className="text-xs text-accent underline" href={`/api/backups/${encodeURIComponent(b.name)}`}>
                        {t("Download")}
                      </a>{" "}
                      <button
                        type="button"
                        className="ml-2 text-xs text-loss underline"
                        onClick={() => {
                          setRestoring(b.name);
                          setConfirm("");
                          setPassphrase("");
                        }}
                      >
                        {t("Restore…")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && d.backups.length === 0 && <p className="text-sm text-muted">{t("No backups yet.")}</p>}

        {restoring && (
          <form onSubmit={restore} className="flex flex-col gap-3 rounded-lg border border-loss/40 bg-danger-bg p-3">
            <p className="text-sm text-loss">
              <span aria-hidden>⛔</span>{" "}
              {tj(
                "Restoring <0>{name}</0> replaces <1>all</1> current data. A safety backup of the current data is made first. You will be signed out.",
                [<strong key="n" />, <strong key="a" />],
                { name: restoring },
              )}
            </p>
            <Field label={t("Type RESTORE to confirm")}>
              {(id) => (
                <Input
                  id={id}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                  className="max-w-48"
                />
              )}
            </Field>
            {restoring.endsWith(".enc") && (
              <Field
                label={t("Passphrase")}
                hint={t("Only needed if this backup was made with a different BACKUP_PASSPHRASE")}
              >
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    autoComplete="off"
                    className="max-w-72"
                  />
                )}
              </Field>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="danger" disabled={busy || confirm !== "RESTORE"}>
                {busy ? t("Restoring…") : t("Restore")}
              </Button>
              <Button onClick={() => setRestoring(null)}>{t("Cancel")}</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
