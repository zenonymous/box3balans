import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  del,
  get,
  post,
  put,
  type Account,
  type AccountKind,
  type AccountOwner,
  type AccountYear,
  type BankImport,
  type Person,
} from "../api";
import {
  Alert,
  AmountInput,
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
import { readText } from "../files";
import { eur, toApiNumber, toInputNumber } from "../format";
import { t, tj, tn } from "../i18n";
import { KIND_ORDER, kindHint, kindLabel, ownerLabel } from "../labels";
import { useAccounts, useHousehold, useInvalidateAll } from "../queries";

const PROVIDERS = ["degiro", "trade-republic", "ibkr", "bitvavo", "kraken", "coinbase", "goldrepublic"];
// Kinds that are always kept as values per year.
const YEARLY_ONLY = new Set<AccountKind>(["property", "receivable", "debt", "insurance"]);

export function AccountsPage() {
  const accounts = useAccounts();
  const people = useHousehold();
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
                      {a.provider && ` · ${a.provider}`}
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
                        {tn(a.txCount, "{n} transaction", "{n} transactions")}
                        {a.itemCount ? ` · ${tn(a.itemCount, "{n} item", "{n} items")}` : ""}
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

interface Draft {
  year: number;
  valueEur: string;
  inEur: string;
  outEur: string;
  incomeEur: string;
  costsEur: string;
  rented: boolean;
  rentEur: string;
  source?: string;
}

const toDraft = (r: AccountYear): Draft => ({
  year: r.year,
  valueEur: toInputNumber(r.valueEur == null ? "" : String(Number(r.valueEur))),
  inEur: zeroBlank(r.inEur),
  outEur: zeroBlank(r.outEur),
  incomeEur: zeroBlank(r.incomeEur),
  costsEur: zeroBlank(r.costsEur),
  rented: !!r.details?.rented,
  rentEur: toInputNumber(r.details?.rentEur ?? ""),
  source: r.details?.source,
});
const zeroBlank = (v: string) => (Number(v) === 0 ? "" : toInputNumber(String(Number(v))));

/** The leegwaarderatio (2023–2026): a let home counts at this share of its WOZ value. Same table as the server. */
function leegwaarde(rent: number, woz: number): number {
  if (woz <= 0) return 1;
  const pct = (rent / woz) * 100;
  const band = [
    [1, 73],
    [2, 79],
    [3, 84],
    [4, 90],
    [5, 95],
  ].find(([upTo]) => pct <= upTo!);
  return (band ? band[1]! : 100) / 100;
}

const parsed = (v: string) => {
  try {
    return Number(toApiNumber(v)) || 0;
  } catch {
    return 0;
  }
};

/** Labels that fit the kind of account: interest on savings, rent on a home, interest paid on a debt. */
function columns(kind: AccountKind) {
  const flows = kind !== "property" && kind !== "debt";
  return {
    value: kind === "debt" ? t("Owed on 1 January") : kind === "property" ? t("WOZ value") : t("Value on 1 January"),
    valueHint:
      kind === "property"
        ? t("The WOZ value for that year: the one with waardepeildatum 1 January of the year before.")
        : kind === "debt"
          ? undefined
          : t("From the year statement (jaaroverzicht) or the balance at the end of 31 December."),
    in: flows ? (kind === "receivable" ? t("Lent more") : t("Money in")) : null,
    out: flows ? (kind === "receivable" ? t("Paid back") : t("Money out")) : null,
    income:
      kind === "debt"
        ? t("Interest paid")
        : kind === "property"
          ? t("Rent received")
          : kind === "bank" || kind === "receivable"
            ? t("Interest received")
            : kind === "insurance" || kind === "vault" || kind === "physical"
              ? null
              : t("Dividends and interest"),
    costs: kind === "debt" ? null : t("Costs"),
  };
}

/** Values per year of an account, with a bank export reader; also used by the start wizard. */
export function YearsModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const years = useQuery({
    queryKey: ["account-years", account.id],
    queryFn: () => get<AccountYear[]>(`/api/accounts/${account.id}/years`),
  });
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const cols = columns(account.kind);
  const thisYear = new Date().getFullYear();

  const draft = rows ?? (years.data ?? []).map(toDraft).sort((a, b) => b.year - a.year);
  const set = (year: number, patch: Partial<Draft>) =>
    setRows(draft.map((r) => (r.year === year ? { ...r, ...patch } : r)));
  const addYear = () => {
    const have = new Set(draft.map((r) => r.year));
    let y = thisYear;
    while (have.has(y)) y--;
    const blank: Draft = {
      year: y,
      valueEur: "",
      inEur: "",
      outEur: "",
      incomeEur: "",
      costsEur: "",
      rented: false,
      rentEur: "",
    };
    const prev = draft.find((r) => r.year === y - 1 || r.year === y + 1);
    if (prev) Object.assign(blank, { rented: prev.rented, rentEur: prev.rentEur });
    setRows([...draft, blank].sort((a, b) => b.year - a.year));
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const num = (v: string, label: string) => (v.trim() ? toApiNumber(v, label) : "0");
      const body = draft.map((r) => ({
        year: r.year,
        valueEur: r.valueEur.trim() ? toApiNumber(r.valueEur, `${cols.value} ${r.year}`) : null,
        inEur: num(r.inEur, `${cols.in} ${r.year}`),
        outEur: num(r.outEur, `${cols.out} ${r.year}`),
        incomeEur: num(r.incomeEur, `${cols.income} ${r.year}`),
        costsEur: num(r.costsEur, `${cols.costs} ${r.year}`),
        details: {
          ...(account.kind === "property"
            ? { rented: r.rented, rentEur: r.rented ? num(r.rentEur, `${t("Yearly rent")} ${r.year}`) : undefined }
            : {}),
          ...(r.source ? { source: r.source } : {}),
        },
      }));
      await put(`/api/accounts/${account.id}/years`, { rows: body });
      await qc.invalidateQueries({ queryKey: ["account-years", account.id] });
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Puts the bank export's years into the table, for the user to check and save. */
  const applyImport = (
    picked: { year: number; valueEur: string | null; inEur?: string; outEur?: string; interestEur?: string }[],
    source: string,
  ) => {
    const byYear = new Map(draft.map((r) => [r.year, r]));
    for (const p of picked) {
      const existing = byYear.get(p.year);
      const r: Draft = existing
        ? { ...existing }
        : {
            year: p.year,
            valueEur: "",
            inEur: "",
            outEur: "",
            incomeEur: "",
            costsEur: "",
            rented: false,
            rentEur: "",
          };
      if (p.valueEur != null) r.valueEur = toInputNumber(String(Number(p.valueEur)));
      if (p.inEur != null) {
        r.inEur = zeroBlank(p.inEur);
        r.outEur = zeroBlank(p.outEur ?? "0");
        r.incomeEur = zeroBlank(p.interestEur ?? "0");
      }
      r.source = source;
      byYear.set(p.year, r);
    }
    setRows([...byYear.values()].sort((a, b) => b.year - a.year));
    setImporting(false);
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("Values per year: {name}", { name: account.name })}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={busy || years.isLoading}>
            {t("Save")}
          </Button>
        </>
      }
    >
      {years.isLoading ? (
        <Spinner />
      ) : importing ? (
        <BankImportPanel account={account} onApply={applyImport} onCancel={() => setImporting(false)} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            {account.kind === "debt"
              ? t("What you owed on 1 January of each year, and the interest you paid during that year.")
              : t(
                  "Per year: the value on 1 January (box 3 counts that) and, for the actual return, what came in, went out and was earned during that year. The value on 31 December is the next year's 1 January value.",
                )}
          </p>
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-xs text-ink-2">
                  <th className="py-1 pr-2 text-left font-medium">{t("Year")}</th>
                  <th className="px-1 py-1 text-left font-medium" title={cols.valueHint}>
                    {cols.value}
                  </th>
                  {account.kind === "property" && (
                    <th className="px-1 py-1 text-left font-medium">{t("Let, yearly rent")}</th>
                  )}
                  {cols.in && <th className="px-1 py-1 text-left font-medium">{cols.in}</th>}
                  {cols.out && <th className="px-1 py-1 text-left font-medium">{cols.out}</th>}
                  {cols.income && <th className="px-1 py-1 text-left font-medium">{cols.income}</th>}
                  {cols.costs && <th className="px-1 py-1 text-left font-medium">{cols.costs}</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.map((r) => (
                  <tr key={r.year} className="align-top">
                    <td className="py-1 pr-2 font-medium">
                      {r.year}
                      {r.source && <div className="text-[11px] font-normal text-muted">{r.source}</div>}
                    </td>
                    <td className="px-1 py-1">
                      <AmountInput
                        aria-label={`${cols.value} ${r.year}`}
                        className="w-32 py-1 text-xs"
                        value={r.valueEur}
                        placeholder="—"
                        onChange={(e) => set(r.year, { valueEur: e.target.value })}
                      />
                    </td>
                    {account.kind === "property" && (
                      <td className="px-1 py-1">
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={r.rented}
                            onChange={(e) => set(r.year, { rented: e.target.checked })}
                          />
                          {t("let")}
                        </label>
                        {r.rented && (
                          <>
                            <AmountInput
                              aria-label={`${t("Yearly rent")} ${r.year}`}
                              className="mt-1 w-28 py-1 text-xs"
                              value={r.rentEur}
                              placeholder={t("rent")}
                              onChange={(e) => set(r.year, { rentEur: e.target.value })}
                            />
                            {parsed(r.valueEur) > 0 && (
                              <div className="mt-1 text-[11px] text-muted">
                                {t("counts as {value} ({pct}%)", {
                                  value: eur(parsed(r.valueEur) * leegwaarde(parsed(r.rentEur), parsed(r.valueEur)), {
                                    decimals: 0,
                                  }),
                                  pct: Math.round(leegwaarde(parsed(r.rentEur), parsed(r.valueEur)) * 100),
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    )}
                    {(["inEur", "outEur", "incomeEur", "costsEur"] as const).map((k) => {
                      const label = { inEur: cols.in, outEur: cols.out, incomeEur: cols.income, costsEur: cols.costs }[
                        k
                      ];
                      if (!label) return null;
                      return (
                        <td key={k} className="px-1 py-1">
                          <AmountInput
                            aria-label={`${label} ${r.year}`}
                            className="w-28 py-1 text-xs"
                            value={r[k]}
                            placeholder="0"
                            onChange={(e) => set(r.year, { [k]: e.target.value })}
                          />
                        </td>
                      );
                    })}
                    <td className="px-1 py-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("Remove {year}", { year: r.year })}
                        onClick={() => setRows(draft.filter((x) => x.year !== r.year))}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {account.kind === "property" && (
            <p className="text-xs text-muted">
              {t(
                "A home let with rent protection counts at part of its WOZ value (the leegwaarderatio, 73% to 100% depending on the rent).",
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={addYear}>
              + {t("Add a year")}
            </Button>
            {account.kind === "bank" && (
              <Button size="sm" onClick={() => setImporting(true)}>
                ⤒ {t("Read a bank export")}
              </Button>
            )}
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

/** Reads a bank export (CSV, TAB or CAMT.053) into values per year, for the user to check. */
function BankImportPanel({
  account,
  onApply,
  onCancel,
}: {
  account: Account;
  onApply: (
    rows: { year: number; valueEur: string | null; inEur?: string; outEur?: string; interestEur?: string }[],
    source: string,
  ) => void;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [closing, setClosing] = useState("");
  const [result, setResult] = useState<BankImport | null>(null);
  const [which, setWhich] = useState(0);
  const [picked, setPicked] = useState<Record<number, { value: boolean; flows: boolean }>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const read = async (f: { name: string; content: string }, closingBalance: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await post<BankImport>(`/api/accounts/${account.id}/bank-import`, {
        fileName: f.name,
        content: f.content,
        closingBalance: closingBalance ? toApiNumber(closingBalance, t("Balance after the last line")) : undefined,
      });
      setResult(r);
      setWhich(0);
      // Take what the file shows for sure: 1 January balances, and totals of years it covers fully.
      const pick: Record<number, { value: boolean; flows: boolean }> = {};
      for (const y of r.accounts[0]?.years ?? [])
        pick[y.year] = { value: y.valueEur != null && !y.valueEstimated, flows: y.fullYear };
      setPicked(pick);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const acc = result?.accounts[which];
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-2">
        {t(
          "Download your transactions from your bank's website, as CSV or CAMT.053, over the years you want, and choose the file here. Box3balans takes the balance on each 1 January, the interest, and the money in and out per year. Nothing is saved until you press Save.",
        )}
      </p>
      <input
        type="file"
        accept=".csv,.txt,.tab,.xml,.053"
        onChange={async (e) => {
          const fl = e.target.files?.[0];
          if (!fl) return;
          const f = { name: fl.name, content: await readText(fl) };
          setFile(f);
          await read(f, closing);
        }}
      />
      {busy && <p className="text-muted">{t("Reading…")}</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      {result?.needsClosingBalance && file && (
        <div className="flex items-end gap-2">
          <Field
            label={t("Balance after the last line")}
            hint={t("This export has no balances; with one known balance the rest follows.")}
          >
            {(id) => (
              <AmountInput id={id} className="w-36" value={closing} onChange={(e) => setClosing(e.target.value)} />
            )}
          </Field>
          <Button onClick={() => read(file, closing)} disabled={!closing.trim()}>
            {t("Work out the balances")}
          </Button>
        </div>
      )}
      {result && result.accounts.length > 1 && (
        <Field label={t("Which account in the file?")}>
          {(id) => (
            <Select
              id={id}
              value={which}
              onChange={(e) => {
                const i = Number(e.target.value);
                setWhich(i);
                const pick: Record<number, { value: boolean; flows: boolean }> = {};
                for (const y of result.accounts[i]!.years)
                  pick[y.year] = { value: y.valueEur != null && !y.valueEstimated, flows: y.fullYear };
                setPicked(pick);
              }}
            >
              {result.accounts.map((a, i) => (
                <option key={a.account || i} value={i}>
                  {a.account || t("Account {n}", { n: i + 1 })} ({tn(a.lines, "{n} line", "{n} lines")})
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {result?.warnings.map((w) => (
        <Alert key={w}>{w}</Alert>
      ))}
      {acc && (
        <>
          <p className="text-xs text-muted">
            {t("{from} to {to}, {lines}.", {
              from: acc.from,
              to: acc.to,
              lines: tn(acc.lines, "{n} line", "{n} lines"),
            })}{" "}
            {t("Estimated values and totals of years the file only partly covers are unticked: check them first.")}
          </p>
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-xs text-ink-2">
                  <th className="py-1 text-left font-medium">{t("Year")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("Balance on 1 January")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("Interest")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("Money in")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("Money out")}</th>
                </tr>
              </thead>
              <tbody>
                {acc.years.map((y) => (
                  <tr key={y.year} className="border-t border-line/60">
                    <td className="py-1 font-medium">{y.year}</td>
                    <td className="px-2 py-1 text-right">
                      {y.valueEur == null ? (
                        "—"
                      ) : (
                        <label className="inline-flex items-center gap-1.5">
                          {eur(y.valueEur)}
                          {y.valueEstimated && <Badge tone="warn">{t("estimate")}</Badge>}
                          <input
                            type="checkbox"
                            aria-label={t("Use the balance of {year}", { year: y.year })}
                            checked={picked[y.year]?.value ?? false}
                            onChange={(e) =>
                              setPicked({ ...picked, [y.year]: { ...picked[y.year]!, value: e.target.checked } })
                            }
                          />
                        </label>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">{eur(y.interestEur)}</td>
                    <td className="px-2 py-1 text-right">{eur(y.inEur)}</td>
                    <td className="px-2 py-1 text-right">
                      <label className="inline-flex items-center gap-1.5">
                        {eur(y.outEur)}
                        {!y.fullYear && y.lines > 0 && <Badge tone="warn">{t("part of the year")}</Badge>}
                        {y.lines > 0 && (
                          <input
                            type="checkbox"
                            aria-label={t("Use the totals of {year}", { year: y.year })}
                            checked={picked[y.year]?.flows ?? false}
                            onChange={(e) =>
                              setPicked({ ...picked, [y.year]: { ...picked[y.year]!, flows: e.target.checked } })
                            }
                          />
                        )}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="flex gap-2">
        <Button onClick={onCancel}>{t("Back")}</Button>
        {acc && (
          <Button
            variant="primary"
            onClick={() =>
              onApply(
                acc.years
                  .filter((y) => picked[y.year]?.value || picked[y.year]?.flows)
                  .map((y) => ({
                    year: y.year,
                    valueEur: picked[y.year]?.value ? y.valueEur : null,
                    ...(picked[y.year]?.flows ? { inEur: y.inEur, outEur: y.outEur, interestEur: y.interestEur } : {}),
                  })),
                file?.name ?? t("bank export"),
              )
            }
          >
            {t("Put in the table")}
          </Button>
        )}
      </div>
    </div>
  );
}
