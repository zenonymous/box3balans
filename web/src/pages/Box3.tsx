import { Fragment, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put, type Box3Category, type Box3Config, type Box3Overview, type Box3Rates, type Box3Year } from "../api";
import { downloadCsv } from "../csv";
import { ActualReturnCard, FuturePreviewCard } from "./Box3Actual";
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  PageHeader,
  Select,
  Spinner,
  Stat,
} from "../components/ui";
import { date, eur, eurPrice, num, toApiNumber, toInputNumber } from "../format";

const CATEGORY_LABEL: Record<Box3Category, string> = {
  bank: "Bank balances",
  other: "Other assets",
  exempt: "Green investments",
  excluded: "Not in box 3",
};
const CATEGORY_NL: Record<Box3Category, string> = {
  bank: "banktegoeden",
  other: "overige bezittingen",
  exempt: "groene beleggingen",
  excluded: "niet in box 3",
};
const KIND_LABEL: Record<string, string> = {
  bank: "Bank account",
  broker: "Broker",
  exchange: "Crypto exchange",
  wallet: "Crypto wallet",
  vault: "Metal vault",
  physical: "Physical storage",
  other: "Other",
};
const CLASS_LABEL_SHORT: Record<string, string> = {
  stock: "Stocks",
  etf: "ETFs & funds",
  crypto: "Crypto",
  metal: "Precious metals",
  other: "Other",
};

const pctFmt = (v: string) => `${num(v, 2)}%`;

export function Box3Page() {
  const overview = useQuery({ queryKey: ["box3"], queryFn: () => get<Box3Overview>("/api/box3") });
  const [selected, setSelected] = useState<number | null>(null);
  const year = selected ?? overview.data?.years[0] ?? null;
  const detail = useQuery({
    queryKey: ["box3", year],
    queryFn: () => get<Box3Year>(`/api/box3/${year}`),
    enabled: year != null,
  });

  if (overview.isLoading) return <Spinner />;
  if (overview.error) return <Alert tone="danger">{(overview.error as Error).message}</Alert>;
  const o = overview.data!;
  if (o.years.length === 0) {
    return (
      <>
        <PageHeader title="Box 3" />
        <Card>
          <Empty title="Nothing to report yet">
            Box 3 uses your wealth on 1 January, so it starts the year after your first transaction.
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Box 3 (sparen en beleggen)"
        subtitle="Your wealth on 1 January per box 3 category, and an estimate of the tax under the current forfaitaire system (2023 onwards). An estimate, not tax advice: check against your banks' and brokers' year statements."
        actions={
          <>
            <Select
              value={year ?? ""}
              onChange={(e) => setSelected(Number(e.target.value))}
              aria-label="Tax year"
              className="max-w-40 print:hidden"
            >
              {o.years.map((y) => (
                <option key={y} value={y}>
                  Tax year {y}
                </option>
              ))}
            </Select>
            {detail.data && <ExportButtons y={detail.data} />}
          </>
        }
      />
      {detail.isLoading || !year ? (
        <Spinner />
      ) : detail.error ? (
        <Alert tone="danger">{(detail.error as Error).message}</Alert>
      ) : (
        <YearView y={detail.data!} overview={o} />
      )}
      <div className="mt-4">
        <FuturePreviewCard />
      </div>
      <RulesCard overview={o} />
    </>
  );
}

function ExportButtons({ y }: { y: Box3Year }) {
  return (
    <div className="flex gap-2 print:hidden">
      <Button
        size="sm"
        onClick={() =>
          downloadCsv(`box3-${y.year}-peildatum-${y.peildatum}.csv`, y.rows, [
            { header: "Account", value: (r) => r.accountName },
            { header: "Account type", value: (r) => KIND_LABEL[r.accountKind] ?? r.accountKind },
            { header: "Box 3 category", value: (r) => CATEGORY_NL[r.category] },
            { header: "Asset", value: (r) => r.name },
            { header: "Symbol", value: (r) => r.symbol },
            { header: "Quantity", value: (r) => r.quantity },
            { header: "Unit", value: (r) => r.unit },
            { header: "Price EUR", value: (r) => r.priceEur },
            { header: "Price date", value: (r) => r.priceDay },
            { header: `Value EUR on ${y.peildatum}`, value: (r) => r.valueEur },
          ])
        }
      >
        ⤓ CSV
      </Button>
      <Button size="sm" onClick={() => window.print()} title="Use “Save as PDF” in the print dialog">
        ⎙ Print / PDF
      </Button>
    </div>
  );
}

function YearView({ y, overview }: { y: Box3Year; overview: Box3Overview }) {
  const c = y.calculation;
  const r = y.rates;
  const byAccount = new Map<
    number,
    { name: string; kind: string; rows: Box3Year["rows"]; total: number; categories: Set<Box3Category> }
  >();
  for (const row of y.rows) {
    const a = byAccount.get(row.accountId) ?? {
      name: row.accountName,
      kind: row.accountKind,
      rows: [],
      total: 0,
      categories: new Set(),
    };
    a.rows.push(row);
    a.total += Number(row.valueEur);
    a.categories.add(row.category);
    byAccount.set(row.accountId, a);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        Peildatum <strong className="text-ink">{date(y.peildatum)}</strong>: holdings at the end of {date(y.valuedAt)},
        valued at that day’s close (or the last one before it).
      </p>
      {y.warnings.length > 0 && (
        <div className="flex flex-col gap-2">
          {y.warnings.map((w) => (
            <Alert key={w}>{w}</Alert>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Bank balances"
          value={eur(y.totals.bank, { decimals: 0 })}
          sub={<span className="text-muted">banktegoeden</span>}
        />
        <Stat
          label="Other assets"
          value={eur(c?.otherEur ?? y.totals.other, { decimals: 0 })}
          sub={<span className="text-muted">overige bezittingen</span>}
        />
        <Stat
          label="Debts"
          value={eur(y.extra.debtsEur, { decimals: 0 })}
          sub={<span className="text-muted">schulden (entered below)</span>}
        />
        <Stat
          label={`Estimated box 3 tax ${y.year}`}
          value={c ? eur(c.netTaxEur, { decimals: 0 }) : "—"}
          sub={
            r && !r.final ? (
              <Badge tone="warn">provisional rates</Badge>
            ) : (
              <span className="text-muted">{y.partner ? "with fiscal partner" : "single"}</span>
            )
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Other assets, by kind">
          <dl className="tabular grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-2">Investments (stocks, ETFs, funds)</dt>
            <dd className="text-right">{eur(y.otherBreakdown.investments)}</dd>
            <dt className="text-ink-2">Crypto</dt>
            <dd className="text-right">{eur(y.otherBreakdown.crypto)}</dd>
            <dt className="text-ink-2">Precious metals</dt>
            <dd className="text-right">{eur(y.otherBreakdown.metals)}</dd>
            <dt className="text-ink-2">Cash outside banks (e.g. on exchanges)</dt>
            <dd className="text-right">{eur(y.otherBreakdown.cash)}</dd>
            <dt className="text-ink-2">Other (entered below)</dt>
            <dd className="text-right">{eur(y.otherBreakdown.other)}</dd>
            {Number(y.totals.exempt) > 0 && (
              <>
                <dt className="text-ink-2">Green investments (exempt up to the limit)</dt>
                <dd className="text-right">{eur(y.totals.exempt)}</dd>
              </>
            )}
            {Number(y.totals.excluded) > 0 && (
              <>
                <dt className="text-ink-2">Not in box 3 (excluded accounts)</dt>
                <dd className="text-right">{eur(y.totals.excluded)}</dd>
              </>
            )}
          </dl>
        </Card>
        <SituationCard key={y.year} y={y} overview={overview} />
      </div>

      {c && r && (
        <Card
          title={
            <span className="flex items-center gap-2">
              Calculation {y.year} {!r.final && <Badge tone="warn">provisional rates</Badge>}
              {r.source === "custom" && <Badge>custom rates</Badge>}
            </span>
          }
          padded={false}
        >
          <table className="tabular w-full text-sm">
            <tbody className="divide-y divide-line">
              <CalcRow
                label={`Bank balances × ${pctFmt(r.bankPct)}`}
                value={(Number(c.bankEur) * Number(r.bankPct)) / 100}
                hint={eur(c.bankEur)}
              />
              <CalcRow
                label={`Other assets × ${pctFmt(r.otherPct)}`}
                value={(Number(c.otherEur) * Number(r.otherPct)) / 100}
                hint={
                  Number(c.greenAboveLimitEur) > 0
                    ? `${eur(c.otherEur)}, incl. ${eur(c.greenAboveLimitEur)} of green investments above the limit`
                    : eur(c.otherEur)
                }
              />
              <CalcRow
                label={`Debts above ${eur(Number(r.debtThresholdEur) * (y.partner ? 2 : 1), { decimals: 0 })} × ${pctFmt(r.debtPct)}`}
                value={-(Number(c.deductibleDebtsEur) * Number(r.debtPct)) / 100}
                hint={eur(c.deductibleDebtsEur)}
              />
              <CalcRow label="Deemed return (forfaitair rendement)" value={c.deemedReturnEur} strong />
              <CalcRow label="Rendementsgrondslag (assets − deductible debts)" value={c.baseEur} />
              <CalcRow
                label={`Heffingsvrij vermogen${y.partner ? " (2 persons)" : ""}`}
                value={-Number(c.allowanceEur)}
              />
              <CalcRow label="Grondslag sparen en beleggen" value={c.taxableBaseEur} />
              <CalcRow label="Share of the grondslag that is taxed" text={`${num(c.sharePct, 2)}%`} />
              <CalcRow label="Voordeel uit sparen en beleggen (deemed return × share)" value={c.benefitEur} strong />
              <CalcRow label={`Box 3 tax at ${pctFmt(r.taxRatePct)}`} value={c.taxEur} strong />
              {Number(c.greenCreditEur) > 0 && (
                <>
                  <CalcRow
                    label={`Green investments tax credit (${pctFmt(r.greenCreditPct)} of ${eur(c.greenExemptEur, { decimals: 0 })})`}
                    value={-Number(c.greenCreditEur)}
                  />
                  <CalcRow label="Box 3 tax after the credit" value={c.netTaxEur} strong />
                </>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <ActualReturnCard y={y} />

      <Card title={`Per account on ${date(y.peildatum)}`} padded={false}>
        {y.rows.length === 0 ? (
          <Empty title="Nothing held on that date" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">Account / asset</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Quantity</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {[...byAccount].map(([id, a]) => (
                  <Fragment key={id}>
                    <tr className="border-t border-line bg-surface-2/60">
                      <td className="px-3 py-2 font-medium">
                        {a.name} <span className="text-xs font-normal text-muted">{KIND_LABEL[a.kind] ?? a.kind}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-2">
                        {[...a.categories].map((cat) => CATEGORY_LABEL[cat]).join(", ")}
                      </td>
                      <td />
                      <td />
                      <td className="px-3 py-2 text-right font-medium">{eur(a.total)}</td>
                    </tr>
                    {a.rows.map((row) => (
                      <tr key={`${row.accountId}-${row.assetId}-${row.physical}`} className="border-t border-line/50">
                        <td className="py-1.5 pl-7 pr-3 text-ink-2">
                          {row.name} <span className="text-xs text-muted">{row.symbol}</span>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted">{CATEGORY_NL[row.category]}</td>
                        <td className="px-3 py-1.5 text-right text-ink-2">
                          {num(row.quantity, row.unit === "g" ? 3 : 8)}
                          {row.unit === "g" ? " g" : ""}
                        </td>
                        <td
                          className="px-3 py-1.5 text-right text-xs text-ink-2"
                          title={row.priceDay ? `Close of ${row.priceDay}` : "No price"}
                        >
                          {row.missingPrice ? (
                            <Badge tone="warn">no price</Badge>
                          ) : (
                            `${eurPrice(row.priceEur)}${row.unit === "g" ? "/g" : ""}`
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">{eur(row.valueEur)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function CalcRow({
  label,
  value,
  text,
  hint,
  strong,
}: {
  label: string;
  value?: number | string;
  text?: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <tr>
      <td className={`px-4 py-2 ${strong ? "font-medium text-ink" : "text-ink-2"}`}>
        {label}
        {hint && <span className="ml-2 text-xs text-muted">({hint})</span>}
      </td>
      {/* Avoid "−€0,00" when a subtracted amount is zero. */}
      <td className={`px-4 py-2 text-right ${strong ? "font-medium" : ""}`}>
        {text ?? eur(Math.abs(Number(value)) < 0.005 ? 0 : value)}
      </td>
    </tr>
  );
}

function SituationCard({ y, overview }: { y: Box3Year; overview: Box3Overview }) {
  const qc = useQueryClient();
  const current = overview.config.years[String(y.year)];
  const [f, setF] = useState({
    partner: current?.partner ?? false,
    debtsEur: toInputNumber(current?.debtsEur ?? "0"),
    extraOtherEur: toInputNumber(current?.extraOtherEur ?? "0"),
    extraBankEur: toInputNumber(current?.extraBankEur ?? "0"),
    debtInterestEur: toInputNumber(current?.debtInterestEur ?? "0"),
    extraReturnEur: toInputNumber(current?.extraReturnEur ?? "0"),
  });
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      const year = {
        partner: f.partner,
        debtsEur: toApiNumber(f.debtsEur, "Debts") || "0",
        extraOtherEur: toApiNumber(f.extraOtherEur, "Other assets") || "0",
        extraBankEur: toApiNumber(f.extraBankEur, "Bank balances") || "0",
        debtInterestEur: toApiNumber(f.debtInterestEur, "Interest paid") || "0",
        extraReturnEur: toApiNumber(f.extraReturnEur, "Return on other assets") || "0",
      };
      await put("/api/box3/config", {
        ...overview.config,
        years: { ...overview.config.years, [String(y.year)]: year },
      });
      await qc.invalidateQueries({ queryKey: ["box3"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card title={`Your situation on ${date(y.peildatum)}`} className="print:hidden">
      <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.partner} onChange={(e) => setF({ ...f, partner: e.target.checked })} />{" "}
          Filing with a fiscal partner (amounts below are your combined amounts)
        </label>
        <Field label="Debts (schulden)" hint="e.g. a consumer loan; not your main home's mortgage (box 1)">
          {(id) => (
            <AmountInput
              id={id}

              value={f.debtsEur}
              onChange={(e) => setF({ ...f, debtsEur: e.target.value })}
            />
          )}
        </Field>
        <Field label="Other box 3 assets not tracked here" hint="e.g. a second home, money lent out">
          {(id) => (
            <AmountInput
              id={id}

              value={f.extraOtherEur}
              onChange={(e) => setF({ ...f, extraOtherEur: e.target.value })}
            />
          )}
        </Field>
        <Field label="Bank balances not tracked here" hint="other savings or current accounts">
          {(id) => (
            <AmountInput
              id={id}

              value={f.extraBankEur}
              onChange={(e) => setF({ ...f, extraBankEur: e.target.value })}
            />
          )}
        </Field>
        <p className="pt-2 text-xs font-medium text-ink-2 sm:col-span-2">During {y.year}, for the actual return</p>
        <Field label="Interest paid on these debts" hint="deducted from the actual return">
          {(id) => (
            <AmountInput
              id={id}
              value={f.debtInterestEur}
              onChange={(e) => setF({ ...f, debtInterestEur: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Return on assets not tracked here"
          hint="income plus value change, e.g. interest on money lent out; negative for a loss"
        >
          {(id) => (
            <AmountInput
              id={id}
              value={f.extraReturnEur}
              onChange={(e) => setF({ ...f, extraReturnEur: e.target.value })}
            />
          )}
        </Field>
        <div className="flex items-end gap-3">
          <Button type="submit" variant="primary">
            Save
          </Button>
          {saved && <span className="text-sm text-gain">✓ Saved</span>}
        </div>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
      </form>
    </Card>
  );
}

const CATS: Box3Category[] = ["bank", "other", "exempt", "excluded"];

function CategorySelect({
  value,
  onChange,
  allowDefault,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  allowDefault?: boolean;
  id?: string;
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="py-1 text-xs">
      {allowDefault && <option value="">Default rules</option>}
      {CATS.map((c) => (
        <option key={c} value={c}>
          {CATEGORY_LABEL[c]}
        </option>
      ))}
    </Select>
  );
}

const RATE_FIELDS: { key: keyof Box3Rates; label: string }[] = [
  { key: "bankPct", label: "Bank %" },
  { key: "otherPct", label: "Other %" },
  { key: "debtPct", label: "Debts %" },
  { key: "allowanceEur", label: "Allowance €" },
  { key: "debtThresholdEur", label: "Debt threshold €" },
  { key: "taxRatePct", label: "Tax rate %" },
  { key: "greenExemptEur", label: "Green limit €" },
  { key: "greenCreditPct", label: "Green credit %" },
];

const RATE_NUMBER_KEYS = [
  "bankPct",
  "otherPct",
  "debtPct",
  "allowanceEur",
  "debtThresholdEur",
  "taxRatePct",
  "greenExemptEur",
  "greenCreditPct",
] as const;

/** Applies `fn` to every numeric field of a year's rates. */
function mapRate(r: Box3Rates, fn: (v: string, key: string) => string): Box3Rates {
  const out = { ...r };
  for (const k of RATE_NUMBER_KEYS) out[k] = fn(String(r[k] ?? "0"), k);
  return out;
}

function mapRates(rates: Record<string, Box3Rates>, fn: (v: string, key: string) => string): Record<string, Box3Rates> {
  return Object.fromEntries(Object.entries(rates).map(([y, r]) => [y, mapRate(r, fn)]));
}

/** Editable category mapping and rates, since box 3 rules change every year. */
function RulesCard({ overview }: { overview: Box3Overview }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Rates are edited in the user's number format and converted back exactly on save.
  const [cfg, setCfg] = useState<Box3Config>(() => ({
    ...overview.config,
    rates: mapRates(overview.config.rates, toInputNumber),
  }));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const years = [
    ...new Set([...Object.keys(overview.defaultRates), ...Object.keys(cfg.rates), ...overview.years.map(String)]),
  ]
    .sort()
    .reverse();
  const rateOf = (y: string): Box3Rates | null =>
    cfg.rates[y] ?? (overview.defaultRates[y] ? mapRate(overview.defaultRates[y], toInputNumber) : null);

  const setRate = (y: string, key: keyof Box3Rates, value: string | boolean) => {
    const base = rateOf(y) ?? {
      bankPct: "0",
      otherPct: "0",
      debtPct: "0",
      allowanceEur: "0",
      debtThresholdEur: "0",
      taxRatePct: "0",
      greenExemptEur: "0",
      greenCreditPct: "0",
      final: false,
    };
    setCfg({ ...cfg, rates: { ...cfg.rates, [y]: { ...base, [key]: value } } });
  };
  const resetRate = (y: string) => {
    const rest = { ...cfg.rates };
    delete rest[y];
    setCfg({ ...cfg, rates: rest });
  };

  const save = async () => {
    setError(undefined);
    try {
      // Per-year inputs are edited elsewhere on the page; keep the latest saved ones.
      const rates = mapRates(cfg.rates, (v, key) => toApiNumber(v, `${key} rate`) || "0");
      const fresh = await put<Box3Config>("/api/box3/config", { ...cfg, rates, years: overview.config.years });
      setCfg({ ...fresh, rates: mapRates(fresh.rates, toInputNumber) });
      await qc.invalidateQueries({ queryKey: ["box3"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card
      title="Rules & rates"
      className="mt-4 print:hidden"
      actions={
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"}
        </Button>
      }
    >
      {!open ? (
        <p className="text-sm text-ink-2">
          Which holdings count as bank balances, other assets, green investments or not in box 3, and the rates per
          year. The official 2023–2026 figures are built in; edit them when the rules change.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium">Cash, by account type</h3>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
                {Object.keys(cfg.mapping.cashByAccountKind).map((k) => (
                  <Fragment key={k}>
                    <span className="text-ink-2">{KIND_LABEL[k] ?? k}</span>
                    <CategorySelect
                      value={cfg.mapping.cashByAccountKind[k]!}
                      onChange={(v) =>
                        setCfg({
                          ...cfg,
                          mapping: {
                            ...cfg.mapping,
                            cashByAccountKind: { ...cfg.mapping.cashByAccountKind, [k]: v as Box3Category },
                          },
                        })
                      }
                    />
                  </Fragment>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                Broker cash usually sits at a bank (e.g. flatex for DEGIRO). Euros on a crypto exchange usually don’t,
                so they count as other assets.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Everything else, by asset class</h3>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
                {Object.keys(cfg.mapping.classCategory).map((k) => (
                  <Fragment key={k}>
                    <span className="text-ink-2">{CLASS_LABEL_SHORT[k] ?? k}</span>
                    <CategorySelect
                      value={cfg.mapping.classCategory[k]!}
                      onChange={(v) =>
                        setCfg({
                          ...cfg,
                          mapping: {
                            ...cfg.mapping,
                            classCategory: { ...cfg.mapping.classCategory, [k]: v as Box3Category },
                          },
                        })
                      }
                    />
                  </Fragment>
                ))}
              </div>
              <h3 className="mb-2 mt-5 text-sm font-medium">Whole-account overrides</h3>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
                {overview.accounts
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <Fragment key={a.id}>
                      <span className="text-ink-2">{a.name}</span>
                      <CategorySelect
                        allowDefault
                        value={cfg.mapping.accountOverrides[String(a.id)] ?? ""}
                        onChange={(v) => {
                          const next = { ...cfg.mapping.accountOverrides };
                          if (v) next[String(a.id)] = v as Box3Category;
                          else delete next[String(a.id)];
                          setCfg({ ...cfg, mapping: { ...cfg.mapping, accountOverrides: next } });
                        }}
                      />
                    </Fragment>
                  ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                E.g. “Green investments” for a fund with a groenverklaring (exempt up to the yearly limit), “Not in box
                3” for a pension or lijfrente account.
              </p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Rates per year</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-xs text-ink-2">
                    <th className="py-1 text-left font-medium">Year</th>
                    {RATE_FIELDS.map((f) => (
                      <th key={f.key} className="px-1 py-1 text-left font-medium">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-1 py-1 text-left font-medium">Final</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => {
                    const r = rateOf(y);
                    return (
                      <tr key={y}>
                        <td className="py-1 pr-2 font-medium">
                          {y} {cfg.rates[y] && <Badge>custom</Badge>}
                        </td>
                        {RATE_FIELDS.map((f) => (
                          <td key={f.key} className="px-1 py-1">
                            <AmountInput
                              aria-label={`${f.label} ${y}`}

                              className="w-24 py-1 text-xs"
                              value={(r?.[f.key] as string | undefined) ?? ""}
                              placeholder="—"
                              onChange={(e) => setRate(y, f.key, e.target.value)}
                            />
                          </td>
                        ))}
                        <td className="px-1 py-1">
                          <input
                            type="checkbox"
                            aria-label={`Final ${y}`}
                            checked={r?.final ?? false}
                            onChange={(e) => setRate(y, "final", e.target.checked)}
                          />
                        </td>
                        <td className="px-1 py-1">
                          {cfg.rates[y] && overview.defaultRates[y] && (
                            <Button size="sm" variant="ghost" onClick={() => resetRate(y)}>
                              Reset
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              Source: belastingdienst.nl, “Hoe wordt mijn box 3-inkomen berekend?” per year. Years before 2023 used a
              different system.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={save}>
              Save rules & rates
            </Button>
            {saved && <span className="text-sm text-gain">✓ Saved</span>}
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        </div>
      )}
    </Card>
  );
}
