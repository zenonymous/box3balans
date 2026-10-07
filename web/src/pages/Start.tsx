import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  get,
  post,
  put,
  type Account,
  type AccountKind,
  type AccountOwner,
  type AccountYear,
  type Box3Overview,
  type Box3Year,
  type Person,
} from "../api";
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Stat,
  cx,
} from "../components/ui";
import { date, eur, toApiNumber, toInputNumber } from "../format";
import { t, tj, tn } from "../i18n";
import { KIND_ORDER, kindHint, kindLabel, ownerLabel } from "../labels";
import { useAccounts, useHousehold, useInvalidateAll } from "../queries";
import { YearsModal } from "./Accounts";
import { HouseholdEditor } from "./Household";

const STEPS = ["household", "accounts", "values", "result"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABEL: Record<Step, string> = {
  household: t("Household"),
  accounts: t("Accounts"),
  values: t("Values on 1 January"),
  result: t("Your box 3"),
};

// Kinds that only exist as values per year, and kinds whose history usually comes from a sync.
const YEARLY_ONLY = new Set<AccountKind>(["property", "receivable", "debt", "insurance"]);
const USUALLY_SYNCED = new Set<AccountKind>(["exchange", "wallet", "vault"]);

/**
 * The start wizard: household → accounts → values on 1 January (or transactions) → your box 3.
 * Everything it saves is ordinary data, editable later on the regular pages.
 */
export function StartPage() {
  const [search, setSearch] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const step: Step = STEPS.find((s) => s === search.get("step")) ?? "household";
  const year = Number(search.get("year")) || thisYear - 1;
  const go = (s: Step, y = year) => {
    setSearch({ step: s, year: String(y) });
    window.scrollTo({ top: 0 });
  };
  const index = STEPS.indexOf(step);

  return (
    <>
      <PageHeader
        title={t("Get started")}
        subtitle={t(
          "Four steps to a first box 3 estimate: who is in your household, where you keep your money, what it was worth on 1 January, and the result.",
        )}
        actions={
          <Select
            value={year}
            onChange={(e) => go(step, Number(e.target.value))}
            aria-label={t("Tax year")}
            className="w-auto"
          >
            {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
              <option key={y} value={y}>
                {t("Tax year {year}", { year: y })}
              </option>
            ))}
          </Select>
        }
      />

      <ol className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t("Steps")}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => go(s)}
              aria-current={s === step ? "step" : undefined}
              className={cx(
                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                s === step
                  ? "border-accent bg-surface font-medium text-ink"
                  : "border-line text-ink-2 hover:bg-surface-2",
              )}
            >
              <span
                className={cx(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                  i < index ? "bg-accent text-accent-ink" : s === step ? "border border-accent" : "border border-line",
                )}
                aria-hidden
              >
                {i < index ? "✓" : i + 1}
              </span>
              {STEP_LABEL[s]}
            </button>
          </li>
        ))}
      </ol>

      {step === "household" && <HouseholdStep year={year} />}
      {step === "accounts" && <AccountsStep />}
      {step === "values" && <ValuesStep year={year} />}
      {step === "result" && <ResultStep year={year} />}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        {index > 0 ? <Button onClick={() => go(STEPS[index - 1]!)}>{t("← Back")}</Button> : <span />}
        {index < STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => go(STEPS[index + 1]!)}>
            {t("Next: {step} →", { step: STEP_LABEL[STEPS[index + 1]!] })}
          </Button>
        ) : (
          <Link
            to="/"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            {t("Done: to the overview")}
          </Link>
        )}
      </div>
    </>
  );
}

function HouseholdStep({ year }: { year: number }) {
  const people = useHousehold();
  const partner = people.data?.find((p) => p.role === "partner");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        {t(
          "Start with yourself. Add a partner and children if you have them: their savings and investments can count in your box 3.",
        )}
      </p>
      <HouseholdEditor />
      {partner && <FiscalPartnerCard partner={partner} year={year} />}
    </div>
  );
}

/** Whether you and your partner were fiscal partners in the tax year (stored per year, as on the Box 3 page). */
function FiscalPartnerCard({ partner, year }: { partner: Person; year: number }) {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["box3"], queryFn: () => get<Box3Overview>("/api/box3") });
  const [error, setError] = useState<string>();
  if (!overview.data) return null;
  const config = overview.data.config;
  const current = config.years[String(year)];

  const change = async (partnerYear: boolean) => {
    setError(undefined);
    try {
      const situation = current ?? { debtsEur: "0", extraOtherEur: "0", extraBankEur: "0" };
      await put("/api/box3/config", {
        ...config,
        years: { ...config.years, [String(year)]: { ...situation, partner: partnerYear } },
      });
      await qc.invalidateQueries({ queryKey: ["box3"] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card title={t("Fiscal partner in {year}", { year })}>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={current?.partner ?? false}
          onChange={(e) => void change(e.target.checked)}
        />
        <span>
          {t("{name} and I were fiscal partners in {year}", { name: partner.name, year })}
          <span className="block text-xs text-muted">
            {t(
              "Married or registered partners are; people living together sometimes are too, for example with a child together or a notarised cohabitation agreement. Fiscal partners add up their box 3.",
            )}
          </span>
        </span>
      </label>
      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Card>
  );
}

function AccountsStep() {
  const accounts = useAccounts();
  const people = useHousehold();
  const persons = people.data ?? [];
  const list = (accounts.data ?? []).filter((a) => !a.archived);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t("Add an account")}>
        <p className="mb-3 text-sm text-ink-2">
          {t(
            "Add every place you have money or assets: bank accounts, brokers, crypto, a second home, money lent, and debts. Details can follow later.",
          )}
        </p>
        <AddAccountForm persons={persons} />
      </Card>
      <Card title={tn(list.length, "{n} account", "{n} accounts")} padded={false}>
        {accounts.isLoading ? (
          <Spinner />
        ) : list.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t("No accounts yet. Add your first one on the left.")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{a.name}</div>
                  <div className="truncate text-xs text-muted">
                    {kindLabel(a.kind)} · {ownerLabel(a, persons)}
                  </div>
                </div>
                <Badge>{a.tracking === "yearly" ? t("values per year") : t("transactions")}</Badge>
              </li>
            ))}
          </ul>
        )}
        {list.length > 0 && (
          <p className="px-4 pb-3 text-xs text-muted">
            {tj("Change or remove accounts under <0>Accounts</0>.", [
              <Link key="a" to="/accounts" className="underline" />,
            ])}
          </p>
        )}
      </Card>
    </div>
  );
}

function AddAccountForm({ persons }: { persons: Person[] }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<AccountKind>("bank");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("self");
  const [tracking, setTracking] = useState<"yearly" | "transactions">("yearly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const partner = persons.find((p) => p.role === "partner");
  const children = persons.filter((p) => p.role === "child");
  const yearlyOnly = YEARLY_ONLY.has(kind);

  const pickKind = (k: AccountKind) => {
    setKind(k);
    setTracking(USUALLY_SYNCED.has(k) ? "transactions" : "yearly");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const child = owner.startsWith("child:") ? Number(owner.slice(6)) : null;
      await post("/api/accounts", {
        name: name.trim(),
        kind,
        tracking: yearlyOnly ? "yearly" : tracking,
        owner: (child ? "child" : owner) as AccountOwner,
        ownerChildId: child,
      });
      setName("");
      await qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label={t("Kind")} hint={kindHint(kind)}>
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => pickKind(e.target.value as AccountKind)}>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("Name")}>
        {(id) => (
          <Input
            id={id}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("e.g. ING savings")}
            required
          />
        )}
      </Field>
      {(partner || children.length > 0) && (
        <Field label={t("Whose is it?")}>
          {(id) => (
            <Select id={id} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="self">{t("Mine")}</option>
              {partner && <option value="partner">{partner.name}</option>}
              {partner && <option value="joint">{t("Joint (mine and my partner's)")}</option>}
              {children.map((c) => (
                <option key={c.id} value={`child:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {!yearlyOnly && (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 text-xs font-medium text-ink-2">{t("How do you keep it up to date?")}</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="tracking"
              className="mt-0.5"
              checked={tracking === "yearly"}
              onChange={() => setTracking("yearly")}
            />
            <span>
              {t("Just the value on 1 January")}
              <span className="block text-xs text-muted">{t("Quickest; enough for box 3.")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="tracking"
              className="mt-0.5"
              checked={tracking === "transactions"}
              onChange={() => setTracking("transactions")}
            />
            <span>
              {t("All transactions")}
              <span className="block text-xs text-muted">
                {t("Imported from a CSV, synced, or entered by hand. Adds returns, costs and income.")}
              </span>
            </span>
          </label>
        </fieldset>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <div>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {busy ? t("Adding…") : t("Add account")}
        </Button>
      </div>
    </form>
  );
}

function ValuesStep({ year }: { year: number }) {
  const accounts = useAccounts();
  const [details, setDetails] = useState<Account | null>(null);
  const list = (accounts.data ?? []).filter((a) => !a.archived);
  const yearly = list.filter((a) => a.tracking === "yearly");
  const withTransactions = list.filter((a) => a.tracking === "transactions");
  const next = year + 1 <= new Date().getFullYear() ? year + 1 : null;

  if (accounts.isLoading) return <Spinner />;
  if (list.length === 0) {
    return <Alert>{t("There are no accounts yet. Go back a step and add where you keep your money.")}</Alert>;
  }

  return (
    <div className="flex flex-col gap-4">
      {yearly.length > 0 && (
        <Card title={t("Values on 1 January")} padded={false}>
          <p className="px-4 pt-3 text-sm text-ink-2">
            {next
              ? t(
                  "Box 3 counts what you had on 1 January {year}. Take it from the year statement (jaaroverzicht) of your bank or broker. The value on 1 January {next} is optional: it shows your actual return.",
                  { year, next },
                )
              : t(
                  "Box 3 counts what you had on 1 January {year}. Take it from the year statement (jaaroverzicht) of your bank or broker.",
                  { year },
                )}
          </p>
          <ul className="divide-y divide-line">
            {yearly.map((a) => (
              <ValueRow key={a.id} account={a} year={year} next={next} onDetails={() => setDetails(a)} />
            ))}
          </ul>
          <p className="px-4 pb-3 text-xs text-muted">
            {t("Values save as you leave a field. “More” adds interest, deposits and rent, or reads a bank export.")}
          </p>
        </Card>
      )}
      {withTransactions.length > 0 && (
        <Card title={t("Accounts with transactions")}>
          <p className="mb-3 text-sm text-ink-2">
            {t(
              "Box 3 follows from their history: add it once and the values on every 1 January are known, with prices.",
            )}
          </p>
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {withTransactions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-muted">
                  {kindLabel(a.kind)} ·{" "}
                  {a.txCount > 0 ? tn(a.txCount, "{n} transaction", "{n} transactions") : t("no history yet")}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link to="/transactions/import" className="rounded-lg border border-line px-3 py-1.5 hover:bg-surface-2">
              ↑ {t("Import a CSV")}
            </Link>
            <Link to="/connections" className="rounded-lg border border-line px-3 py-1.5 hover:bg-surface-2">
              ⇅ {t("Connect an exchange or broker")}
            </Link>
            <Link to="/wallets" className="rounded-lg border border-line px-3 py-1.5 hover:bg-surface-2">
              ◈ {t("Track a wallet")}
            </Link>
            <Link to="/metals" className="rounded-lg border border-line px-3 py-1.5 hover:bg-surface-2">
              ◆ {t("Add coins and bars")}
            </Link>
          </div>
        </Card>
      )}
      {details && <YearsModal account={details} onClose={() => setDetails(null)} />}
    </div>
  );
}

/** The value on 1 January of the tax year (and of the next one) for one account, saved when a field is left. */
function ValueRow({
  account,
  year,
  next,
  onDetails,
}: {
  account: Account;
  year: number;
  next: number | null;
  onDetails: () => void;
}) {
  const invalidate = useInvalidateAll();
  const years = useQuery({
    queryKey: ["account-years", account.id],
    queryFn: () => get<AccountYear[]>(`/api/accounts/${account.id}/years`),
  });
  const stored = (y: number) => {
    const v = years.data?.find((r) => r.year === y)?.valueEur;
    return v == null ? "" : toInputNumber(v.includes(".") ? v.replace(/\.?0+$/, "") : v);
  };
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string>();
  const label =
    account.kind === "debt"
      ? (y: number) => t("Owed on 1 January {year}", { year: y })
      : account.kind === "property"
        ? (y: number) => t("WOZ value {year}", { year: y })
        : (y: number) => t("1 January {year}", { year: y });

  const save = async (y: number) => {
    const value = draft[y];
    if (value == null) return;
    if (value === stored(y)) {
      // Back to what's stored: nothing to save, and an earlier error no longer applies.
      setError(undefined);
      return;
    }
    setState("saving");
    setError(undefined);
    try {
      const current = await get<AccountYear[]>(`/api/accounts/${account.id}/years`);
      const rows = current.filter((r) => r.year !== y);
      const old = current.find((r) => r.year === y);
      const valueEur = value.trim() ? toApiNumber(value, label(y)) : null;
      if (valueEur != null || old) {
        const blank = {
          accountId: account.id,
          year: y,
          inEur: "0",
          outEur: "0",
          incomeEur: "0",
          costsEur: "0",
          details: {},
        };
        rows.push({ ...(old ?? blank), valueEur });
      }
      await put(`/api/accounts/${account.id}/years`, {
        rows: rows.map((r) => ({
          year: r.year,
          valueEur: r.valueEur,
          inEur: r.inEur,
          outEur: r.outEur,
          incomeEur: r.incomeEur,
          costsEur: r.costsEur,
          details: r.details,
        })),
      });
      await years.refetch();
      setDraft((d) => {
        const rest = { ...d };
        delete rest[y];
        return rest;
      });
      setState("saved");
      void invalidate();
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  };

  const input = (y: number) => (
    <Field label={label(y)}>
      {(id) => (
        <AmountInput
          id={id}
          value={draft[y] ?? stored(y)}
          onChange={(e) => setDraft({ ...draft, [y]: e.target.value })}
          onBlur={() => void save(y)}
          placeholder="0"
          disabled={years.isLoading}
        />
      )}
    </Field>
  );

  return (
    <li className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-ink">{account.name}</span>{" "}
          <span className="text-xs text-muted">{kindLabel(account.kind)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {state === "saving" && <span className="text-muted">{t("Saving…")}</span>}
          {state === "saved" && <span className="text-gain">✓ {t("Saved")}</span>}
          <Button size="sm" variant="ghost" onClick={onDetails}>
            {t("More")}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {input(year)}
        {next && input(next)}
      </div>
      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </li>
  );
}

function ResultStep({ year }: { year: number }) {
  const box3 = useQuery({ queryKey: ["box3", year], queryFn: () => get<Box3Year>(`/api/box3/${year}`) });
  if (box3.isLoading) return <Spinner />;
  if (box3.error) return <Alert tone="danger">{(box3.error as Error).message}</Alert>;
  const y = box3.data!;
  const c = y.calculation;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t("Bank balances")} value={eur(y.totals.bank, { decimals: 0 })} />
        <Stat label={t("Other assets")} value={eur(y.totals.other, { decimals: 0 })} />
        <Stat label={t("Debts")} value={eur(y.debtsEur, { decimals: 0 })} />
        <Stat label={t("Grondslag sparen en beleggen")} value={c ? eur(c.taxableBaseEur, { decimals: 0 }) : "—"} />
        <Stat
          label={t("Estimated box 3 tax {year}", { year })}
          value={c ? eur(c.netTaxEur, { decimals: 0 }) : "—"}
          sub={<span className="text-muted">{y.partner ? t("with fiscal partner") : t("on your own")}</span>}
        />
      </div>
      {y.warnings.map((w) => (
        <Alert key={w}>{w}</Alert>
      ))}
      <Card>
        <p className="text-sm text-ink-2">
          {t(
            "An estimate under the current system, with the values you entered and the prices on {date}. Check it against the year statements of your banks and brokers; it isn't tax advice.",
            { date: date(y.valuedAt) },
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link
            to={`/box3?year=${year}`}
            className="rounded-lg bg-accent px-3.5 py-2 font-medium text-accent-ink hover:opacity-90"
          >
            {t("See the full calculation")}
          </Link>
          <Link to="/accounts" className="rounded-lg border border-line px-3.5 py-2 hover:bg-surface-2">
            {t("Add more years")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
