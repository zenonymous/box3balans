import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
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
  Input,
  PageHeader,
  Select,
  Spinner,
  Stat,
} from "../components/ui";
import { date, eur, eurPrice, num, toApiNumber, toInputNumber } from "../format";
import { getLang, t, tj } from "../i18n";
import { categoryLabel, kindLabel, noteLabel, ownerLabel } from "../labels";
import { useHousehold } from "../queries";

/** The Dutch tax term next to an English label (in Dutch, the label is the term). */
const term = (nl: string): ReactNode => (getLang() === "en" ? <span className="text-xs text-muted">{nl}</span> : null);

const CATEGORY_NL: Record<Box3Category | "debt", string> = {
  bank: "banktegoeden",
  other: "overige bezittingen",
  exempt: "groene beleggingen",
  excluded: "niet in box 3",
  debt: "schulden",
};

const classLabel = (k: string) =>
  ({
    stock: t("Stocks"),
    etf: t("ETFs and funds"),
    crypto: t("Crypto"),
    metal: t("Precious metals"),
    other: t("Other"),
  })[k] ?? k;

const pctFmt = (v: string) => `${num(v, 2)}%`;

export function Box3Page() {
  const overview = useQuery({ queryKey: ["box3"], queryFn: () => get<Box3Overview>("/api/box3") });
  // Links (e.g. from the start wizard) can open a year.
  const [search] = useSearchParams();
  const [selected, setSelected] = useState<number | null>(() => Number(search.get("year")) || null);
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
        <PageHeader title={t("Box 3")} />
        <Card>
          <Empty title={t("Nothing to report yet")}>
            {tj(
              "Box 3 counts what you had on 1 January. Add your accounts under <0>Accounts</0>: with values per year, or with transactions (box 3 then starts the year after the first one).",
              [<Link key="a" to="/accounts" className="underline" />],
            )}
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("Box 3 (savings and investments)")}
        subtitle={t(
          "What you had on 1 January per box 3 category, and an estimate of the tax under the current system (2023 onwards). An estimate, not tax advice: check it against the year statements of your banks and brokers.",
        )}
        actions={
          <>
            <Select
              value={year ?? ""}
              onChange={(e) => setSelected(Number(e.target.value))}
              aria-label={t("Tax year")}
              className="max-w-40 print:hidden"
            >
              {o.years.map((y) => (
                <option key={y} value={y}>
                  {t("Tax year {year}", { year: y })}
                </option>
              ))}
            </Select>
            {year != null && (
              <Link
                to={`/box3/aangifte?year=${year}`}
                className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2 print:hidden"
              >
                {t("For the tax return")}
              </Link>
            )}
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
  const people = useHousehold();
  return (
    <div className="flex gap-2 print:hidden">
      <Button
        size="sm"
        onClick={() =>
          downloadCsv(`box3-${y.year}-peildatum-${y.peildatum}.csv`, y.rows, [
            { header: t("Account"), value: (r) => r.accountName },
            { header: t("Account type"), value: (r) => kindLabel(r.accountKind) },
            { header: t("Owner"), value: (r) => ownerLabel(r, people.data ?? []) },
            { header: t("Box 3 category"), value: (r) => CATEGORY_NL[r.category] },
            { header: t("Asset"), value: (r) => r.name },
            { header: t("Symbol"), value: (r) => r.symbol },
            { header: t("Quantity"), value: (r) => (r.source === "yearly" ? "" : r.quantity) },
            { header: t("Unit"), value: (r) => r.unit },
            { header: t("Price EUR"), value: (r) => r.priceEur },
            { header: t("Price date"), value: (r) => r.priceDay },
            { header: t("Value EUR on {date}", { date: y.peildatum }), value: (r) => r.valueEur },
            { header: t("Counted %"), value: (r) => r.countedPct },
            { header: t("Counted EUR"), value: (r) => r.countedEur },
          ])
        }
      >
        ⤓ CSV
      </Button>
      <Button size="sm" onClick={() => window.print()} title={t("Use “Save as PDF” in the print dialog")}>
        ⎙ {t("Print / PDF")}
      </Button>
    </div>
  );
}

function YearView({ y, overview }: { y: Box3Year; overview: Box3Overview }) {
  const people = useHousehold();
  const persons = people.data ?? [];
  const c = y.calculation;
  const r = y.rates;
  const byAccount = new Map<
    number,
    { name: string; kind: string; rows: Box3Year["rows"]; total: number; categories: Set<Box3Category | "debt"> }
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
  const partnerName = persons.find((p) => p.role === "partner")?.name ?? t("Partner");
  const selfName = persons.find((p) => p.role === "self")?.name ?? t("You");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        {tj(
          "Peildatum <0>{peildatum}</0>: holdings at the end of {day}, valued at that day's close (or the last one before it).",
          [<strong key="p" className="text-ink" />],
          { peildatum: date(y.peildatum), day: date(y.valuedAt) },
        )}
      </p>
      {y.warnings.length > 0 && (
        <div className="flex flex-col gap-2">
          {y.warnings.map((w) => (
            <Alert key={w}>{w}</Alert>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Bank balances")} value={eur(y.totals.bank, { decimals: 0 })} sub={term("banktegoeden")} />
        <Stat
          label={t("Other assets")}
          value={eur(c?.otherEur ?? y.totals.other, { decimals: 0 })}
          sub={term("overige bezittingen")}
        />
        <Stat label={t("Debts")} value={eur(y.debtsEur, { decimals: 0 })} sub={term("schulden")} />
        <Stat
          label={t("Estimated box 3 tax {year}", { year: y.year })}
          value={c ? eur(c.netTaxEur, { decimals: 0 }) : "—"}
          sub={
            r && !r.final ? (
              <Badge tone="warn">{t("provisional rates")}</Badge>
            ) : (
              <span className="text-muted">{y.partner ? t("with fiscal partner") : t("on your own")}</span>
            )
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t("Other assets, by kind")}>
          <dl className="tabular grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-2">{t("Investments (shares, ETFs, funds)")}</dt>
            <dd className="text-right">{eur(y.otherBreakdown.investments)}</dd>
            <dt className="text-ink-2">{t("Crypto")}</dt>
            <dd className="text-right">{eur(y.otherBreakdown.crypto)}</dd>
            <dt className="text-ink-2">{t("Precious metals")}</dt>
            <dd className="text-right">{eur(y.otherBreakdown.metals)}</dd>
            <dt className="text-ink-2">{t("Cash outside banks (e.g. on exchanges)")}</dt>
            <dd className="text-right">{eur(y.otherBreakdown.cash)}</dd>
            <dt className="text-ink-2">{t("Other (homes, money lent, insurance, entered amounts)")}</dt>
            <dd className="text-right">{eur(y.otherBreakdown.other)}</dd>
            {Number(y.totals.exempt) > 0 && (
              <>
                <dt className="text-ink-2">{t("Green investments (exempt up to the limit)")}</dt>
                <dd className="text-right">{eur(y.totals.exempt)}</dd>
              </>
            )}
            {Number(y.totals.excluded) > 0 && (
              <>
                <dt className="text-ink-2">{t("Not in box 3 (excluded accounts)")}</dt>
                <dd className="text-right">{eur(y.totals.excluded)}</dd>
              </>
            )}
          </dl>
        </Card>
        <SituationCard key={y.year} y={y} overview={overview} />
      </div>

      {y.perPerson.partner && (
        <Card title={t("Per person")} padded={false}>
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium" />
                  <th className="px-3 py-2 text-right font-medium">{t("Bank balances")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Other assets")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Debts")}</th>
                  {y.allocation && (
                    <>
                      <th className="px-3 py-2 text-right font-medium">{t("Share of the grondslag")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Box 3 tax")}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(
                  [
                    [
                      selfName,
                      y.perPerson.self,
                      y.allocation?.self,
                      y.allocation ? Number(y.allocation.selfPct) : null,
                    ],
                    [
                      partnerName,
                      y.perPerson.partner,
                      y.allocation?.partner,
                      y.allocation ? 100 - Number(y.allocation.selfPct) : null,
                    ],
                  ] as const
                ).map(([name, p, alloc, pctShare]) => (
                  <tr key={name}>
                    <td className="px-3 py-2 font-medium">{name}</td>
                    <td className="px-3 py-2 text-right">{eur(p.bank, { decimals: 0 })}</td>
                    <td className="px-3 py-2 text-right">{eur(Number(p.other) + Number(p.green), { decimals: 0 })}</td>
                    <td className="px-3 py-2 text-right">{eur(p.debts, { decimals: 0 })}</td>
                    {alloc && (
                      <>
                        <td className="px-3 py-2 text-right">
                          {eur(alloc.taxableBaseEur, { decimals: 0 })}{" "}
                          <span className="text-xs text-muted">({num(pctShare ?? 0, 2)}%)</span>
                        </td>
                        <td className="px-3 py-2 text-right">{eur(alloc.taxEur, { decimals: 0 })}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted">
            {t(
              "What each of you owns, with children's assets split by custody. Fiscal partners add everything up and may divide the grondslag as they like (set your share under Your situation); the tax together stays the same. A split can matter elsewhere in the return, for example for the general tax credit.",
            )}
          </p>
        </Card>
      )}

      {c && r && (
        <Card
          title={
            <span className="flex items-center gap-2">
              {t("Calculation {year}", { year: y.year })}{" "}
              {!r.final && <Badge tone="warn">{t("provisional rates")}</Badge>}
              {r.source === "custom" && <Badge>{t("custom rates")}</Badge>}
            </span>
          }
          padded={false}
        >
          <table className="tabular w-full text-sm">
            <tbody className="divide-y divide-line">
              <CalcRow
                label={t("Bank balances × {pct}", { pct: pctFmt(r.bankPct) })}
                value={(Number(c.bankEur) * Number(r.bankPct)) / 100}
                hint={eur(c.bankEur)}
              />
              <CalcRow
                label={t("Other assets × {pct}", { pct: pctFmt(r.otherPct) })}
                value={(Number(c.otherEur) * Number(r.otherPct)) / 100}
                hint={
                  Number(c.greenAboveLimitEur) > 0
                    ? t("{total}, incl. {green} of green investments above the limit", {
                        total: eur(c.otherEur),
                        green: eur(c.greenAboveLimitEur),
                      })
                    : eur(c.otherEur)
                }
              />
              <CalcRow
                label={t("Debts above {threshold} × {pct}", {
                  threshold: eur(Number(r.debtThresholdEur) * (y.partner ? 2 : 1), { decimals: 0 }),
                  pct: pctFmt(r.debtPct),
                })}
                value={-(Number(c.deductibleDebtsEur) * Number(r.debtPct)) / 100}
                hint={eur(c.deductibleDebtsEur)}
              />
              <CalcRow label={t("Deemed return (forfaitair rendement)")} value={c.deemedReturnEur} strong />
              <CalcRow label={t("Rendementsgrondslag (assets − deductible debts)")} value={c.baseEur} />
              <CalcRow
                label={y.partner ? t("Heffingsvrij vermogen (2 persons)") : t("Heffingsvrij vermogen")}
                value={-Number(c.allowanceEur)}
              />
              <CalcRow label={t("Grondslag sparen en beleggen")} value={c.taxableBaseEur} />
              <CalcRow label={t("Share of the rendementsgrondslag that is taxed")} text={`${num(c.sharePct, 2)}%`} />
              <CalcRow
                label={t("Voordeel uit sparen en beleggen (deemed return × share)")}
                value={c.benefitEur}
                strong
              />
              <CalcRow label={t("Box 3 tax at {pct}", { pct: pctFmt(r.taxRatePct) })} value={c.taxEur} strong />
              {Number(c.greenCreditEur) > 0 && (
                <>
                  <CalcRow
                    label={t("Tax credit for green investments ({pct} of {amount})", {
                      pct: pctFmt(r.greenCreditPct),
                      amount: eur(c.greenExemptEur, { decimals: 0 }),
                    })}
                    value={-Number(c.greenCreditEur)}
                  />
                  <CalcRow label={t("Box 3 tax after the credit")} value={c.netTaxEur} strong />
                </>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <ActualReturnCard y={y} />

      <Card title={t("Per account on {date}", { date: date(y.peildatum) })} padded={false}>
        {y.rows.length === 0 ? (
          <Empty title={t("Nothing held on that date")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">{t("Account / asset")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Category")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Quantity")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Price")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Value")}</th>
                </tr>
              </thead>
              <tbody>
                {[...byAccount].map(([id, a]) => {
                  const first = a.rows[0]!;
                  const partial = Number(first.countedPct) !== 100;
                  return (
                    <Fragment key={id}>
                      <tr className="border-t border-line bg-surface-2/60">
                        <td className="px-3 py-2 font-medium">
                          {a.name} <span className="text-xs font-normal text-muted">{kindLabel(a.kind)}</span>
                          {(first.owner !== "self" || persons.length > 0) && (
                            <span className="ml-1 text-xs font-normal text-muted">· {ownerLabel(first, persons)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-2">
                          {[...a.categories].map((cat) => categoryLabel(cat)).join(", ")}
                        </td>
                        <td
                          colSpan={2}
                          className="px-3 py-2 text-right text-xs text-muted"
                          title={first.note && noteLabel(first.note)}
                        >
                          {partial && t("{pct}% counts", { pct: num(first.countedPct, 2) })}
                          {first.note && <span className="ml-1 cursor-help">ⓘ</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{eur(a.total)}</td>
                      </tr>
                      {a.rows.map((row) =>
                        row.source === "yearly" ? (
                          <tr key={`${row.accountId}-yearly`} className="border-t border-line/50">
                            <td className="py-1.5 pl-7 pr-3 text-ink-2">
                              {t("Value on 1 January (entered per year)")}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-muted">{CATEGORY_NL[row.category]}</td>
                            <td />
                            <td />
                            <td className="px-3 py-1.5 text-right">{eur(row.valueEur)}</td>
                          </tr>
                        ) : (
                          <tr
                            key={`${row.accountId}-${row.assetId}-${row.physical}`}
                            className="border-t border-line/50"
                          >
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
                              title={row.priceDay ? t("Close of {day}", { day: row.priceDay }) : t("No price")}
                            >
                              {row.missingPrice ? (
                                <Badge tone="warn">{t("no price")}</Badge>
                              ) : (
                                `${eurPrice(row.priceEur)}${row.unit === "g" ? "/g" : ""}`
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right">{eur(row.valueEur)}</td>
                          </tr>
                        ),
                      )}
                    </Fragment>
                  );
                })}
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
    allocationSelfPct: toInputNumber(current?.allocationSelfPct ?? "50"),
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
      const share = toApiNumber(f.allocationSelfPct, t("Your share")) || "50";
      if (Number(share) < 0 || Number(share) > 100) throw new Error(t("Your share must be between 0 and 100%"));
      const year = {
        partner: f.partner,
        allocationSelfPct: share,
        debtsEur: toApiNumber(f.debtsEur, t("Debts")) || "0",
        extraOtherEur: toApiNumber(f.extraOtherEur, t("Other assets")) || "0",
        extraBankEur: toApiNumber(f.extraBankEur, t("Bank balances")) || "0",
        debtInterestEur: toApiNumber(f.debtInterestEur, t("Interest paid")) || "0",
        extraReturnEur: toApiNumber(f.extraReturnEur, t("Return on other assets")) || "0",
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
    <Card title={t("Your situation on {date}", { date: date(y.peildatum) })} className="print:hidden">
      <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.partner} onChange={(e) => setF({ ...f, partner: e.target.checked })} />{" "}
          {t("I have a fiscal partner this year")}
        </label>
        {f.partner && (
          <Field
            label={t("Your share of the grondslag (%)")}
            hint={t("Fiscal partners divide it as they like; the rest goes to your partner.")}
            className="sm:col-span-2"
          >
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className="w-28"
                value={f.allocationSelfPct}
                onChange={(e) => setF({ ...f, allocationSelfPct: e.target.value })}
              />
            )}
          </Field>
        )}
        <p className="text-xs text-muted sm:col-span-2">
          {tj(
            "Savings, homes, money lent and debts are best added as accounts with values per year under <0>Accounts</0>, with their owner. Use the fields below for anything else.",
            [<Link key="a" to="/accounts" className="underline" />],
          )}
        </p>
        <Field label={t("Other debts")} hint={t("Not your main home's mortgage (that's box 1)")}>
          {(id) => (
            <AmountInput id={id} value={f.debtsEur} onChange={(e) => setF({ ...f, debtsEur: e.target.value })} />
          )}
        </Field>
        <Field label={t("Other box 3 assets")} hint={t("e.g. cash at home above the exemption")}>
          {(id) => (
            <AmountInput
              id={id}
              value={f.extraOtherEur}
              onChange={(e) => setF({ ...f, extraOtherEur: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("Other bank balances")}>
          {(id) => (
            <AmountInput
              id={id}
              value={f.extraBankEur}
              onChange={(e) => setF({ ...f, extraBankEur: e.target.value })}
            />
          )}
        </Field>
        <p className="pt-2 text-xs font-medium text-ink-2 sm:col-span-2">
          {t("During {year}, for the actual return", { year: y.year })}
        </p>
        <Field label={t("Interest paid on these debts")} hint={t("deducted from the actual return")}>
          {(id) => (
            <AmountInput
              id={id}
              value={f.debtInterestEur}
              onChange={(e) => setF({ ...f, debtInterestEur: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("Return on these other assets")} hint={t("income plus value change; negative for a loss")}>
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
            {t("Save")}
          </Button>
          {saved && <span className="text-sm text-gain">✓ {t("Saved")}</span>}
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
      {allowDefault && <option value="">{t("Default rules")}</option>}
      {CATS.map((c) => (
        <option key={c} value={c}>
          {categoryLabel(c)}
        </option>
      ))}
    </Select>
  );
}

const rateFields = (): { key: keyof Box3Rates; label: string }[] => [
  { key: "bankPct", label: t("Bank %") },
  { key: "otherPct", label: t("Other %") },
  { key: "debtPct", label: t("Debts %") },
  { key: "allowanceEur", label: t("Allowance €") },
  { key: "debtThresholdEur", label: t("Debt threshold €") },
  { key: "taxRatePct", label: t("Tax rate %") },
  { key: "greenExemptEur", label: t("Green limit €") },
  { key: "greenCreditPct", label: t("Green credit %") },
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
      title={t("Rules & rates")}
      className="mt-4 print:hidden"
      actions={
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? t("Hide") : t("Show")}
        </Button>
      }
    >
      {!open ? (
        <p className="text-sm text-ink-2">
          {t(
            "Which holdings count as bank balances, other assets, green investments or not in box 3, and the rates per year. The official figures are built in (checked {date}); edit them when the rules change.",
            { date: date(overview.rules.checkedAt) },
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("Cash, by account type")}</h3>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
                {Object.keys(cfg.mapping.cashByAccountKind).map((k) => (
                  <Fragment key={k}>
                    <span className="text-ink-2">{kindLabel(k)}</span>
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
                {t(
                  "Broker cash usually sits at a bank (e.g. flatex for DEGIRO). Euros on a crypto exchange usually don't, so they count as other assets.",
                )}
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("Everything else, by asset class")}</h3>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
                {Object.keys(cfg.mapping.classCategory).map((k) => (
                  <Fragment key={k}>
                    <span className="text-ink-2">{classLabel(k)}</span>
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
              <h3 className="mb-2 mt-5 text-sm font-medium">{t("Whole-account overrides")}</h3>
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
                {t(
                  "E.g. “Green investments” for a fund with a groenverklaring (exempt up to the yearly limit), “Not in box 3” for a pension or lijfrente account.",
                )}
              </p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">{t("Rates per year")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-xs text-ink-2">
                    <th className="py-1 text-left font-medium">{t("Year")}</th>
                    {rateFields().map((f) => (
                      <th key={f.key} className="px-1 py-1 text-left font-medium">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-1 py-1 text-left font-medium">{t("Final")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => {
                    const r = rateOf(y);
                    return (
                      <tr key={y}>
                        <td className="py-1 pr-2 font-medium">
                          {overview.rules.sources[y] ? (
                            <a
                              className="underline decoration-line underline-offset-2"
                              href={overview.rules.sources[y]}
                              target="_blank"
                              rel="noreferrer"
                              title={t("Source")}
                            >
                              {y}
                            </a>
                          ) : (
                            y
                          )}{" "}
                          {cfg.rates[y] && <Badge>{t("custom")}</Badge>}
                        </td>
                        {rateFields().map((f) => (
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
                            aria-label={`${t("Final")} ${y}`}
                            checked={r?.final ?? false}
                            onChange={(e) => setRate(y, "final", e.target.checked)}
                          />
                        </td>
                        <td className="px-1 py-1">
                          {cfg.rates[y] && overview.defaultRates[y] && (
                            <Button size="sm" variant="ghost" onClick={() => resetRate(y)}>
                              {t("Reset")}
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
              {t(
                "Source: belastingdienst.nl, “Hoe wordt mijn box 3-inkomen berekend?” per year (click a year). Built-in rules checked {date}; a newer version of Box3balans brings newer figures. Years before 2023 used a different system.",
                { date: date(overview.rules.checkedAt) },
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={save}>
              {t("Save rules & rates")}
            </Button>
            {saved && <span className="text-sm text-gain">✓ {t("Saved")}</span>}
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        </div>
      )}
    </Card>
  );
}
