import { useState, type FormEvent } from "react";
import { del, post, put, type Account, type AccountKind } from "../api";
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
import { useAccounts, useInvalidateAll } from "../queries";

const KINDS: { value: AccountKind; label: string; hint: string }[] = [
  { value: "broker", label: "Broker", hint: "DEGIRO, Trade Republic, Interactive Brokers" },
  { value: "exchange", label: "Crypto exchange", hint: "Bitvavo, Kraken, Coinbase" },
  { value: "wallet", label: "Crypto wallet", hint: "Hardware or software wallet" },
  { value: "vault", label: "Metal vault", hint: "Goldrepublic, BullionVault" },
  { value: "physical", label: "Physical storage", hint: "Home safe, safe deposit box" },
  { value: "bank", label: "Bank account", hint: "Savings / current account" },
  { value: "other", label: "Other", hint: "" },
];

const PROVIDERS = ["degiro", "trade-republic", "ibkr", "bitvavo", "kraken", "coinbase", "goldrepublic"];

export function AccountsPage() {
  const accounts = useAccounts();
  const [editing, setEditing] = useState<Account | "new" | null>(null);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Where your assets are held: brokers, exchanges, wallets, vaults and physical storage"
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            + Add account
          </Button>
        }
      />
      <Card padded={false}>
        {accounts.isLoading ? (
          <Spinner />
        ) : !accounts.data?.length ? (
          <Empty title="No accounts yet">
            Add one for each place you hold investments, e.g. “DEGIRO”, “Bitvavo”, “Ledger”, “Goldrepublic” and “Home
            safe”.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {accounts.data.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setEditing(a)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">
                      {a.name} {a.archived && <Badge>archived</Badge>}
                    </div>
                    <div className="text-xs text-muted">
                      {KINDS.find((k) => k.value === a.kind)?.label}
                      {a.provider && ` · ${a.provider}`}
                    </div>
                  </div>
                  <div className="text-right text-xs text-ink-2">
                    {a.txCount} transactions{a.itemCount ? ` · ${a.itemCount} items` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <AccountModal account={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AccountModal({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const invalidate = useInvalidateAll();
  const [f, setF] = useState({
    name: account?.name ?? "",
    kind: account?.kind ?? ("broker" as AccountKind),
    provider: account?.provider ?? "",
    notes: account?.notes ?? "",
    archived: account?.archived ?? false,
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const body = { ...f, provider: f.provider || null, notes: f.notes || null };
    try {
      if (account) await put(`/api/accounts/${account.id}`, body);
      else await post("/api/accounts", body);
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete account “${account!.name}”?`)) return;
    try {
      await del(`/api/accounts/${account!.id}`);
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const used = account && (account.txCount > 0 || account.itemCount > 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={account ? "Edit account" : "Add account"}
      footer={
        <>
          {account && !used && (
            <Button variant="danger" onClick={remove} className="mr-auto">
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="account-form" disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name">
          {(id) => (
            <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
          )}
        </Field>
        <Field label="Type" hint={KINDS.find((k) => k.value === f.kind)?.hint}>
          {(id) => (
            <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AccountKind })}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Provider (optional)" hint="Used later to match CSV imports and API sync">
          {(id) => (
            <>
              <Input
                id={id}
                list="providers"
                value={f.provider}
                onChange={(e) => setF({ ...f, provider: e.target.value })}
              />
              <datalist id="providers">
                {PROVIDERS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Notes">
          {(id) => <Textarea id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}
        </Field>
        {account && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />{" "}
            Archived (hidden from forms)
          </label>
        )}
        {used && <p className="text-xs text-muted">This account has history, so it can be archived but not deleted.</p>}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Modal>
  );
}
