import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { del, post, put, type Account, type AccountKind, type AccountOwner, type Person } from "../api";
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
import { eur } from "../format";
import { t, tj, tn } from "../i18n";
import { KIND_ORDER, kindHint, kindLabel, ownerLabel, providerName } from "../labels";
import { useAccounts, useHousehold, useInvalidateAll, usePortfolio } from "../queries";
import { YearsModal } from "./AccountYears";

const PROVIDERS = ["degiro", "trade-republic", "ibkr", "bitvavo", "kraken", "coinbase", "bitpanda", "goldrepublic"];
// Kinds that are always kept as values per year.
const YEARLY_ONLY = new Set<AccountKind>(["property", "receivable", "debt", "insurance"]);

export function AccountsPage() {
  const accounts = useAccounts();
  const people = useHousehold();
  const portfolio = usePortfolio();
  // What an account kept with transactions holds now.
  const valueNow = new Map(portfolio.data?.summary.byAccount.map((b) => [b.accountId, b.valueEur]) ?? []);
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [years, setYears] = useState<Account | null>(null);
  const persons = people.data ?? [];

  return (
    <>
      <PageHeader
        title={t("Accounts")}
        subtitle={t(
          "Every place you keep something: banks, brokers, exchanges, wallets, vaults, your home safe, and also a second home, money lent or a debt.",
        )}
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            + {t("Add account")}
          </Button>
        }
      />
      <Card padded={false}>
        {accounts.isLoading ? (
          <Spinner />
        ) : !accounts.data?.length ? (
          <Empty title={t("No accounts yet")}>
            {t(
              "Add one for each place you keep something, e.g. “ING savings”, “DEGIRO”, “Bitvavo”, “Ledger” and “Home safe”.",
            )}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {accounts.data.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-4 py-3 text-sm hover:bg-surface-2">
                <button
                  type="button"
                  onClick={() => setEditing(a)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">
                      {a.name} {a.archived && <Badge>{t("archived")}</Badge>}{" "}
                      {a.foreign && <Badge>{t("abroad")}</Badge>}
                    </div>
                    <div className="text-xs text-muted">
                      {kindLabel(a.kind)}
                      {a.provider && ` · ${providerName(a.provider)}`}
                      {(a.owner !== "self" || persons.length > 0) && ` · ${ownerLabel(a, persons)}`}
                    </div>
                  </div>
                  <div className="text-right text-xs text-ink-2">
                    {a.tracking === "yearly" ? (
                      a.latestYear != null ? (
                        <>
                          <div className="tabular text-sm text-ink">{eur(a.latestValueEur, { decimals: 0 })}</div>
                          <div>{t("on 1 January {year}", { year: a.latestYear })}</div>
                        </>
                      ) : (
                        <Badge tone="warn">{t("no values yet")}</Badge>
                      )
                    ) : (
                      <>
                        {valueNow.has(a.id) && (
                          <div className="tabular text-sm text-ink">{eur(valueNow.get(a.id), { decimals: 0 })}</div>
                        )}
                        <div>
                          {tn(a.txCount, "{n} transaction", "{n} transactions")}
                          {a.itemCount ? ` · ${tn(a.itemCount, "{n} item", "{n} items")}` : ""}
                        </div>
                      </>
                    )}
                  </div>
                </button>
                {a.tracking === "yearly" && (
                  <Button size="sm" onClick={() => setYears(a)}>
                    {t("Values per year")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <AccountModal
          account={editing === "new" ? null : editing}
          persons={persons}
          onClose={() => setEditing(null)}
          onCreated={(a) => a.tracking === "yearly" && setYears(a)}
        />
      )}
      {years && <YearsModal account={years} onClose={() => setYears(null)} />}
    </>
  );
}

function AccountModal({
  account,
  persons,
  onClose,
  onCreated,
}: {
  account: Account | null;
  persons: Person[];
  onClose: () => void;
  onCreated: (a: Account) => void;
}) {
  const invalidate = useInvalidateAll();
  const [f, setF] = useState({
    name: account?.name ?? "",
    kind: account?.kind ?? "bank",
    tracking: account?.tracking ?? "transactions",
    owner: account?.owner ?? "self",
    ownerChildId: account?.ownerChildId ?? null,
    jointSelfPct: account?.jointSelfPct ? String(Number(account.jointSelfPct)) : "50",
    foreign: account?.foreign ?? false,
    provider: account?.provider ?? "",
    notes: account?.notes ?? "",
    archived: account?.archived ?? false,
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const partner = persons.find((p) => p.role === "partner");
  const children = persons.filter((p) => p.role === "child");
  const used = !!account && (account.txCount > 0 || account.itemCount > 0);
  const yearlyOnly = YEARLY_ONLY.has(f.kind);
  const tracking = yearlyOnly ? "yearly" : f.tracking;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const body = {
      ...f,
      tracking,
      provider: f.provider || null,
      notes: f.notes || null,
      ownerChildId: f.owner === "child" ? f.ownerChildId : null,
      jointSelfPct: Number(f.jointSelfPct.replace(",", ".")) || 0,
    };
    try {
      if (account) await put(`/api/accounts/${account.id}`, body);
      else onCreated(await post<Account>("/api/accounts", body));
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(t("Delete account “{name}”?", { name: account!.name }))) return;
    try {
      await del(`/api/accounts/${account!.id}`);
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
      title={account ? t("Edit account") : t("Add account")}
      footer={
        <>
          {account && !used && (
            <Button variant="danger" onClick={remove} className="mr-auto">
              {t("Delete")}
            </Button>
          )}
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="account-form" disabled={busy}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} className="flex flex-col gap-3">
        <Field label={t("Name")}>
          {(id) => (
            <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
          )}
        </Field>
        <Field label={t("Type")} hint={kindHint(f.kind)}>
          {(id) => (
            <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AccountKind })}>
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium text-ink-2">{t("How do you keep it up to date?")}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="tracking"
              className="mt-1"
              checked={tracking === "transactions"}
              disabled={yearlyOnly || account?.tracking === "yearly"}
              onChange={() => setF({ ...f, tracking: "transactions" })}
            />
            <span>
              {t("Transactions")}
              <span className="block text-xs text-muted">
                {t("Buys, sells, dividends: by hand, from a CSV, or synced. Gives prices, returns and history.")}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="tracking"
              className="mt-1"
              checked={tracking === "yearly"}
              disabled={used}
              onChange={() => setF({ ...f, tracking: "yearly" })}
            />
            <span>
              {t("Values per year")}
              <span className="block text-xs text-muted">
                {t(
                  "Just the value on 1 January and what came in, went out and was earned in the year: enough for box 3. A bank export can fill it in.",
                )}
              </span>
            </span>
          </label>
          {used && account?.tracking !== "yearly" && (
            <p className="text-xs text-muted">{t("This account has transactions, so it stays with transactions.")}</p>
          )}
        </fieldset>

        <Field
          label={t("Whose is it?")}
          hint={
            persons.length === 0
              ? tj("Add your partner and children under <0>Household</0>.", [
                  <Link key="h" to="/household" className="underline" />,
                ])
              : undefined
          }
        >
          {(id) => (
            <Select
              id={id}
              value={f.owner === "child" ? `child:${f.ownerChildId ?? ""}` : f.owner}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("child:")) setF({ ...f, owner: "child", ownerChildId: Number(v.slice(6)) || null });
                else setF({ ...f, owner: v as AccountOwner, ownerChildId: null });
              }}
            >
              <option value="self">{t("Mine")}</option>
              {(partner || f.owner === "partner") && <option value="partner">{partner?.name ?? t("Partner")}</option>}
              {(partner || f.owner === "joint") && <option value="joint">{t("Joint (mine and my partner's)")}</option>}
              {children.map((c) => (
                <option key={c.id} value={`child:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {f.owner === "joint" && (
          <Field label={t("Your share (%)")} hint={t("The rest is your partner's. Usually 50.")}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className="w-28"
                value={f.jointSelfPct}
                onChange={(e) => setF({ ...f, jointSelfPct: e.target.value })}
              />
            )}
          </Field>
        )}

        {tracking === "transactions" && (
          <Field label={t("Provider (optional)")} hint={t("Used to recognise CSV imports and API connections")}>
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
        )}
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={f.foreign} onChange={(e) => setF({ ...f, foreign: e.target.checked })} />{" "}
          {t("Held abroad (the tax return asks for these separately)")}
        </label>
        <Field label={t("Notes")}>
          {(id) => <Textarea id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}
        </Field>
        {account && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />{" "}
            {t("Archived (hidden from forms)")}
          </label>
        )}
        {used && (
          <p className="text-xs text-muted">{t("This account has history, so it can be archived but not deleted.")}</p>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Modal>
  );
}

// ---- Values per year ----
