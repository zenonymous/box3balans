import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put, post } from "../api";
import { RefreshButton } from "../components/RefreshButton";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Tabs } from "../components/ui";
import { NUMBER_LOCALES, date, getLocale, relativeTime, setLocale } from "../format";
import { usePriceStatus } from "../queries";

type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") return t;
  } catch {}
  return "system";
}

function applyTheme(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", t);
  } catch {}
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

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
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Manage">
          <div className="flex flex-col gap-2 text-sm">
            <Link to="/accounts" className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
              ▣ Accounts — brokers, exchanges, wallets, vaults, storage
            </Link>
            <Link to="/connections" className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
              ⇅ Connections — sync Bitvavo, Kraken, Coinbase and IBKR
            </Link>
            <Link to="/wallets" className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
              ◈ Wallets — track Bitcoin, Ethereum & L2s, Solana and more by address
            </Link>
            <Link to="/performance" className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
              ↗ Performance — results per year, realized gains
            </Link>
            <Link to="/income" className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
              ❖ Income — dividends, staking rewards, interest
            </Link>
            <Link to="/box3" className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
              § Box 3: wealth on 1 January and tax estimate
            </Link>
            <Link to="/assets" className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
              ◇ Assets — instruments and price sources
            </Link>
            <Link to="/activity" className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
              ↺ History — every change, and restoring deleted transactions
            </Link>
          </div>
        </Card>

        <CostMethodCard />

        <Card title="Appearance">
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-2">Theme</div>
              <Tabs
                value={theme}
                onChange={(t) => {
                  setTheme(t);
                  applyTheme(t);
                }}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </div>
            <Field label="Number format">
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

        <Card title="Prices" actions={<RefreshButton />}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-2">Automatic refresh</dt>
            <dd>every {status.data?.intervalMinutes ?? "—"} minutes</dd>
            <dt className="text-ink-2">Last refresh</dt>
            <dd>{s ? `${relativeTime(s.at)} — ${s.updated} prices updated` : "never"}</dd>
            <dt className="text-ink-2">ECB FX rates</dt>
            <dd>{s?.fxError ? <span className="text-loss">{s.fxError}</span> : (s?.fxDate ?? "—")}</dd>
          </dl>
          {s && s.failed.length > 0 && (
            <div className="mt-3">
              <Alert>
                Failed:{" "}
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
              Main source unavailable, priced by the second source:{" "}
              {s.fallbacks.map((f) => `${f.symbol} (${FALLBACK_LABEL[f.source] ?? f.source})`).join(", ")}.
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            Sources: Yahoo Finance (stocks/ETFs), CoinGecko (crypto), gold-api.com with Yahoo futures fallback (metals),
            ECB via Frankfurter (FX). When the main source has no price, crypto falls back to Bitvavo and Yahoo, stocks
            and ETFs to Tradegate (by ISIN). Free feeds can lag ~15 minutes.
          </p>
        </Card>

        <BackupsCard />

        <PasswordCard />

        <Card title="Session">
          <Button onClick={logout}>Sign out</Button>
        </Card>
      </div>
    </>
  );
}

function PasswordCard() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) return setMsg({ ok: false, text: "New passwords do not match" });
    try {
      await post("/api/auth/password", { current: f.current, next: f.next });
      setF({ current: "", next: "", confirm: "" });
      setMsg({ ok: true, text: "Password changed. Other sessions were signed out." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <Card title="Change password">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Current password">
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
        <Field label="New password" hint="At least 12 characters">
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
        <Field label="Confirm new password">
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
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CostMethodCard() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => get<{ costMethod: "average" | "fifo" }>("/api/settings"),
  });
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
    <Card title="Cost basis">
      <Field
        label="Method"
        hint="Average cost is common for Dutch investors (and what most brokers show). FIFO sells the oldest units first."
      >
        {(id) => (
          <Select
            id={id}
            value={settings.data?.costMethod ?? "average"}
            onChange={(e) => change(e.target.value as "average" | "fifo")}
            disabled={!settings.data}
          >
            <option value="average">Average cost</option>
            <option value="fifo">FIFO (first in, first out)</option>
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
      setMsg({ ok: true, text: `Backup written: ${b.name}` });
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
    <Card title="Backups & export" className="lg:col-span-2">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {d && d.intervalHours > 0
            ? `Automatic backups every ${d.intervalHours} h, keeping the latest ${d.keep}. `
            : "Automatic backups are off (BACKUP_INTERVAL_HOURS=0). "}
          Backups contain all data (exchange keys stay encrypted, so restoring them needs the same APP_SECRET) and are
          stored on the server in <code className="rounded bg-surface-2 px-1 text-xs">{d?.dir ?? "…"}</code>.
          {d?.encrypted && " New backups are encrypted with your BACKUP_PASSPHRASE."}
        </p>
        {d && !d.encrypted && (
          <Alert>
            Backups aren't encrypted: anyone with a copy can read all your data. Set BACKUP_PASSPHRASE in .env and
            restart to encrypt new backups.
          </Alert>
        )}
        {d?.status.lastErrorAt && (!d.status.lastSuccessAt || d.status.lastErrorAt > d.status.lastSuccessAt) && (
          <Alert tone="danger">
            The last automatic backup failed ({relativeTime(d.status.lastErrorAt)}): {d.status.lastError}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={backupNow} disabled={busy}>
            {busy && !restoring ? "Backing up…" : "Back up now"}
          </Button>
          <a
            className="inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-2"
            href="/api/export/transactions.csv"
          >
            ⤓ Transactions (CSV)
          </a>
          <a
            className="inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-2"
            href="/api/export/holdings.csv"
          >
            ⤓ Holdings (CSV)
          </a>
        </div>
        {msg && (msg.ok ? <p className="text-sm text-gain">✓ {msg.text}</p> : <Alert tone="danger">{msg.text}</Alert>)}

        {d && d.backups.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="tabular w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">Backup</th>
                  <th className="px-3 py-2 text-left font-medium">Made</th>
                  <th className="px-3 py-2 text-right font-medium">Size</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.backups.map((b) => (
                  <tr key={b.name}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {b.name}
                      {b.encrypted && (
                        <span className="ml-1.5 font-sans text-muted" title="Encrypted">
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
                        Download
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
                        Restore…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && d.backups.length === 0 && <p className="text-sm text-muted">No backups yet.</p>}

        {restoring && (
          <form onSubmit={restore} className="flex flex-col gap-3 rounded-lg border border-loss/40 bg-danger-bg p-3">
            <p className="text-sm text-loss">
              <span aria-hidden>⛔</span> Restoring <strong>{restoring}</strong> replaces <strong>all</strong> current
              data. A safety backup of the current data is made first. You will be signed out.
            </p>
            <Field label="Type RESTORE to confirm">
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
              <Field label="Passphrase" hint="Only needed if this backup was made with a different BACKUP_PASSPHRASE">
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
                {busy ? "Restoring…" : "Restore"}
              </Button>
              <Button onClick={() => setRestoring(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
