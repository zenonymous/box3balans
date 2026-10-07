import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, pollUntil, post, put, type Integration, type ProviderInfo, type SyncResult } from "../api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "../components/ui";
import { relativeTime } from "../format";
import { Mismatches } from "../components/Mismatches";
import { useAccounts, useInvalidateAll } from "../queries";
import { t, tj, tn } from "../i18n";

const useIntegrations = () =>
  useQuery({
    queryKey: ["integrations"],
    queryFn: () => get<Integration[]>("/api/integrations"),
    // Poll while a sync is running so the status flips when it finishes.
    refetchInterval: (q) => (q.state.data?.some((i) => i.running) ? 3_000 : 60_000),
  });

const useProviders = () =>
  useQuery({
    queryKey: ["providers"],
    queryFn: () => get<ProviderInfo[]>("/api/integrations/providers"),
    staleTime: Infinity,
  });

export function ConnectionsPage() {
  const list = useIntegrations();
  const providers = useProviders();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Integration | null>(null);
  const interval = list.data?.[0]?.intervalHours;

  return (
    <>
      <PageHeader
        title={t("Connections")}
        subtitle={
          interval
            ? tn(
                interval,
                "Read-only API access to exchanges and brokers. Transactions are imported automatically every hour; you can still edit or delete them.",
                "Read-only API access to exchanges and brokers. Transactions are imported automatically every {n} hours; you can still edit or delete them.",
              )
            : t(
                "Read-only API access to exchanges and brokers. Transactions are imported automatically; you can still edit or delete them.",
              )
        }
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t("+ Connect")}
          </Button>
        }
      />
      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <Alert tone="danger">{(list.error as Error).message}</Alert>
      ) : !list.data?.length ? (
        <Card>
          <Empty title={t("No connections yet")}>
            {t(
              "Connect Bitvavo, Kraken, Coinbase or Interactive Brokers with a read-only key, and their history is imported for you.",
            )}
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {list.data.map((i) => (
            <ConnectionCard
              key={i.id}
              integration={i}
              provider={providers.data?.find((p) => p.id === i.provider)}
              onEdit={() => setEditing(i)}
            />
          ))}
        </div>
      )}
      {adding && providers.data && <ConnectModal providers={providers.data} onClose={() => setAdding(false)} />}
      {editing && providers.data && (
        <EditModal
          integration={editing}
          provider={providers.data.find((p) => p.id === editing.provider)!}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function StatusBadge({ i }: { i: Integration }) {
  if (i.running) return <Badge tone="accent">⟳ {t("syncing…")}</Badge>;
  if (!i.enabled) return <Badge>{t("paused")}</Badge>;
  if (i.lastStatus === "error") return <Badge tone="danger">⛔ {t("failed")}</Badge>;
  if (i.lastStatus === "warning") return <Badge tone="warn">⚠ {t("needs attention")}</Badge>;
  if (i.lastStatus === "ok") return <Badge>✓ {t("up to date")}</Badge>;
  return <Badge>{t("not synced yet")}</Badge>;
}

function ConnectionCard({
  integration: i,
  provider,
  onEdit,
}: {
  integration: Integration;
  provider?: ProviderInfo;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const r = i.lastResult;

  const syncNow = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // Starts in the background; the list polls while `running` is set.
      await post(`/api/integrations/${i.id}/sync`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      await invalidate();
      await qc.invalidateQueries({ queryKey: ["integrations"] });
    }
  };

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {provider?.label ?? i.provider} <span className="font-normal text-ink-2">· {i.accountName}</span>{" "}
          <StatusBadge i={i} />
        </span>
      }
      actions={
        <>
          <Button size="sm" onClick={onEdit}>
            {t("Edit")}
          </Button>
          <Button size="sm" variant="primary" onClick={syncNow} disabled={busy || i.running}>
            {busy || i.running ? t("Syncing…") : t("↻ Sync now")}
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-ink-2">{t("Key")}</dt>
        <dd className="font-mono text-xs leading-5">{i.keyHint ?? "—"}</dd>
        <dt className="text-ink-2">{t("Last sync")}</dt>
        <dd title={i.lastSyncAt ?? undefined}>{relativeTime(i.lastSyncAt)}</dd>
        {r && !r.error && (
          <>
            <dt className="text-ink-2">{t("Imported")}</dt>
            <dd>
              {t("{n} new", { n: r.inserted })}{" "}
              <span className="text-muted">{t("of {total}", { total: r.fetched })}</span>
            </dd>
            <dt className="text-ink-2">{t("Transfers linked")}</dt>
            <dd>{r.transfersMatched}</dd>
          </>
        )}
      </dl>

      <div className="mt-3 flex flex-col gap-2">
        {error && <Alert tone="danger">{error}</Alert>}
        {r?.error && <Alert tone="danger">{r.error}</Alert>}
        {r?.newAssets && r.newAssets.length > 0 && (
          <p className="text-xs text-ink-2">{t("New assets added: {list}", { list: r.newAssets.join(", ") })}</p>
        )}
        {r?.warnings?.map((w) => (
          <Alert key={w}>{w}</Alert>
        ))}
        {r?.mismatches && r.mismatches.length > 0 && (
          <Mismatches
            accountId={i.accountId}
            accountName={i.accountName}
            source="exchange"
            rows={r.mismatches}
            refreshKey="integrations"
          />
        )}
      </div>
    </Card>
  );
}

function CredentialFields({
  provider,
  values,
  onChange,
}: {
  provider: ProviderInfo;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <>
      {provider.fields.map((f) => (
        <Field key={f.name} label={f.label}>
          {(id) =>
            f.multiline ? (
              <Textarea
                id={id}
                rows={5}
                className="font-mono text-xs"
                value={values[f.name] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}
                spellCheck={false}
                autoComplete="off"
                required
              />
            ) : (
              <Input
                id={id}
                type={f.secret ? "password" : "text"}
                className="font-mono"
                value={values[f.name] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}
                spellCheck={false}
                autoComplete="off"
                required
              />
            )
          }
        </Field>
      ))}
    </>
  );
}

function ConnectModal({ providers, onClose }: { providers: ProviderInfo[]; onClose: () => void }) {
  const accounts = useAccounts();
  const list = useIntegrations();
  const invalidate = useInvalidateAll();
  const qc = useQueryClient();
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [accountChoice, setAccountChoice] = useState("new");
  const [accountName, setAccountName] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<"form" | "verifying" | "syncing" | "done">("form");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<SyncResult>();

  const taken = new Set(list.data?.map((i) => i.accountId));
  const candidates =
    accounts.data?.filter(
      (a) => !a.archived && !taken.has(a.id) && (a.kind === provider?.accountKind || a.provider === provider?.id),
    ) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!provider) return;
    setError(undefined);
    setStage("verifying");
    try {
      const created = await post<{ id: number }>("/api/integrations", {
        provider: provider.id,
        credentials: creds,
        ...(accountChoice === "new"
          ? { accountName: accountName.trim() || provider.label }
          : { accountId: Number(accountChoice) }),
      });
      setCreds({}); // don't keep secrets in memory longer than needed
      setStage("syncing");
      await qc.invalidateQueries({ queryKey: ["integrations"] });
      // The first import runs in the background; wait for it here so the dialog can show the outcome.
      const done = await pollUntil(
        () => get<Integration[]>("/api/integrations"),
        (list) =>
          !list.find((x) => x.id === created.id)?.running && !!list.find((x) => x.id === created.id)?.lastResult,
      );
      const r = done.find((x) => x.id === created.id)?.lastResult;
      if (!r) throw new Error(t("The first sync is still running; check back on this page shortly."));
      setResult(r);
      setStage("done");
      await invalidate();
    } catch (err) {
      setError((err as Error).message);
      setStage("form");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={provider ? t("Connect {name}", { name: provider.label }) : t("Connect an exchange or broker")}
      footer={
        stage === "done" ? (
          <Button variant="primary" onClick={onClose}>
            {t("Done")}
          </Button>
        ) : provider ? (
          <>
            <Button
              onClick={() => (stage === "form" ? setProvider(null) : undefined)}
              disabled={stage !== "form"}
              className="mr-auto"
            >
              {t("← Back")}
            </Button>
            <Button onClick={onClose}>{t("Cancel")}</Button>
            <Button variant="primary" type="submit" form="connect-form" disabled={stage !== "form"}>
              {stage === "verifying"
                ? t("Checking key…")
                : stage === "syncing"
                  ? t("Importing history…")
                  : t("Connect")}
            </Button>
          </>
        ) : undefined
      }
    >
      {!provider ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setProvider(p);
                setAccountName(p.label);
                setCreds({});
              }}
              className="rounded-lg border border-line px-4 py-3 text-left hover:bg-surface-2"
            >
              <div className="font-medium">{p.label}</div>
              <div className="text-xs text-muted">
                {p.accountKind === "broker" ? t("Broker") : t("Crypto exchange")}
              </div>
            </button>
          ))}
        </div>
      ) : stage === "done" && result ? (
        <div className="flex flex-col gap-3 text-sm">
          {result.error ? (
            <Alert tone="danger">{t("Connected, but the first sync failed: {error}", { error: result.error })}</Alert>
          ) : (
            <p>
              <span className="text-gain">✓</span>{" "}
              {result.inserted === 1
                ? tj("Connected. Imported <0>{n}</0> transaction", [<strong key="n" />], { n: 1 })
                : tj("Connected. Imported <0>{n}</0> transactions", [<strong key="n" />], { n: result.inserted })}
              {result.transfersMatched
                ? tn(
                    result.transfersMatched,
                    ", linked {n} transfer to your other accounts",
                    ", linked {n} transfers to your other accounts",
                  )
                : ""}
              .
            </p>
          )}
          {result.newAssets.length > 0 && (
            <p className="text-ink-2">{t("New assets added: {list}", { list: result.newAssets.join(", ") })}</p>
          )}
          {result.warnings.map((w) => (
            <Alert key={w}>{w}</Alert>
          ))}
          {result.mismatches.length > 0 && (
            <Alert>
              {tn(
                result.mismatches.length,
                "{n} balance doesn’t match the exchange yet. Review it on the Connections page.",
                "{n} balances don’t match the exchange yet. Review them on the Connections page.",
              )}
            </Alert>
          )}
        </div>
      ) : (
        <form id="connect-form" onSubmit={submit} className="flex flex-col gap-4">
          <ol className="list-decimal space-y-1 rounded-lg bg-surface-2 py-3 pl-8 pr-4 text-sm text-ink-2">
            {provider.instructions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="text-xs text-muted">
            🔒{" "}
            {t(
              "Keys are checked with a read-only call, stored encrypted, and never shown again. Use read-only keys only.",
            )}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Account")}>
              {(id) => (
                <Select id={id} value={accountChoice} onChange={(e) => setAccountChoice(e.target.value)}>
                  <option value="new">{t("Create a new account")}</option>
                  {candidates.map((a) => (
                    <option key={a.id} value={a.id}>
                      {t("{name} (existing)", { name: a.name })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {accountChoice === "new" ? (
              <Field label={t("Account name")}>
                {(id) => (
                  <Input id={id} value={accountName} onChange={(e) => setAccountName(e.target.value)} required />
                )}
              </Field>
            ) : (
              <p className="self-end text-xs text-muted">
                {t(
                  "Transactions you entered by hand for this account stay; imported ones are added next to them, so check for duplicates.",
                )}
              </p>
            )}
          </div>
          <CredentialFields provider={provider} values={creds} onChange={setCreds} />
          {stage === "syncing" && (
            <p className="text-sm text-ink-2">
              {t(
                "Key accepted. Importing your history; large accounts can take a few minutes. You can close this dialog, and the import continues in the background.",
              )}
            </p>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      )}
    </Modal>
  );
}

function EditModal({
  integration,
  provider,
  onClose,
}: {
  integration: Integration;
  provider: ProviderInfo;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const [enabled, setEnabled] = useState(integration.enabled);
  const [replace, setReplace] = useState(false);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [removeTx, setRemoveTx] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await put(`/api/integrations/${integration.id}`, { enabled, ...(replace ? { credentials: creds } : {}) });
      await qc.invalidateQueries({ queryKey: ["integrations"] });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const question = removeTx
      ? t("Remove the {name} connection and delete all transactions it imported?", { name: provider.label })
      : t("Remove the {name} connection? Imported transactions are kept.", { name: provider.label });
    if (!confirm(question)) return;
    try {
      await del(`/api/integrations/${integration.id}?deleteTransactions=${removeTx}`);
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${provider.label} · ${integration.accountName}`}
      footer={
        <>
          <Button variant="danger" onClick={remove} className="mr-auto">
            {t("Remove")}
          </Button>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="edit-conn" disabled={busy}>
            {busy ? t("Checking…") : t("Save")}
          </Button>
        </>
      }
    >
      <form id="edit-conn" onSubmit={save} className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{" "}
          {t("Sync automatically")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />{" "}
          {t("Replace API key")}
          <span className="text-muted">{t("(current {hint})", { hint: integration.keyHint ?? "—" })}</span>
        </label>
        {replace && <CredentialFields provider={provider} values={creds} onChange={setCreds} />}
        <hr className="border-line" />
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={removeTx} onChange={(e) => setRemoveTx(e.target.checked)} />{" "}
          {t("When removing, also delete the transactions it imported")}
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Modal>
  );
}
