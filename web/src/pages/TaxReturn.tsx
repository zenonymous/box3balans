import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { get, type AttributionNote, type Box3Overview, type Box3Year } from "../api";
import { Alert, Badge, Button, Card, PageHeader, Select, Spinner } from "../components/ui";
import { eur } from "../format";
import { t, tj } from "../i18n";
import { kindLabel, noteLabel, ownerLabel } from "../labels";
import { useHousehold } from "../queries";
import { ActualReturnCard } from "./Box3Actual";

type Section = "bank" | "investments" | "crypto" | "property" | "receivables" | "other" | "green" | "debts";

interface ReturnLine {
  accountId: number;
  name: string;
  kind: string;
  owner: "self" | "partner" | "joint" | "child";
  ownerChildId: number | null;
  foreign: boolean;
  valueEur: number;
  countedEur: number;
  countedPct: string;
  note?: AttributionNote;
  details: { name: string; symbol: string; valueEur: number }[];
  incomeEur?: number;
  dividendEur?: number;
  dividendTaxEur?: number;
}

interface TaxReturn {
  year: number;
  peildatum: string;
  partner: boolean;
  sections: { key: Section; lines: ReturnLine[]; totalEur: number }[];
  extra: { bankEur: number; otherEur: number; debtsEur: number };
  dividendTax: {
    dutchEur: number;
    dutchGrossEur: number;
    foreign: { country: string; grossEur: number; taxEur: number }[];
  };
  actualReturnIn: "return" | "form";
  warnings: string[];
}

const TITLE: Record<Section, string> = {
  bank: t("Bank accounts and other bank balances"),
  investments: t("Shares, bonds and funds"),
  crypto: t("Cryptocurrency"),
  property: t("Property"),
  receivables: t("Money lent and other claims"),
  other: t("Other assets"),
  green: t("Green investments"),
  debts: t("Debts"),
};

const HINT: Record<Section, string> = {
  bank: t("Savings and current accounts, also abroad, and cash a broker keeps at a bank: the balance on 1 January."),
  investments: t("Per broker or investment account, the value of what you held on 1 January."),
  crypto: t("The value on 1 January at the price of the platform you use, per exchange or wallet."),
  property: t(
    "A second home, a home you let, or land: the WOZ value, for a home let with rent protection the leegwaarde.",
  ),
  receivables: t("Money you lent to others, at what is still owed to you on 1 January."),
  other: t("Precious metals, euros on an exchange, capital insurance and anything else in box 3."),
  green: t("Exempt up to the yearly limit; the return asks for them separately."),
  debts: t("Debts in box 3, not the mortgage on the home you live in: what you owed on 1 January."),
};

const INCOME: Partial<Record<Section, string>> = {
  bank: t("Interest received"),
  property: t("Rent received"),
  receivables: t("Interest received"),
  debts: t("Interest paid"),
};

const whole = (v: number) => eur(v, { decimals: 0 });

/**
 * Box 3 of one year as the income tax return asks for it, section by section, per account and
 * owner, in whole euros. Next to it the dividend tax withheld and the actual return.
 */
export function TaxReturnPage() {
  const [search, setSearch] = useSearchParams();
  const overview = useQuery({ queryKey: ["box3"], queryFn: () => get<Box3Overview>("/api/box3") });
  const year = Number(search.get("year")) || overview.data?.years.find((y) => y < new Date().getFullYear()) || null;
  const data = useQuery({
    queryKey: ["box3-return", year],
    queryFn: () => get<TaxReturn>(`/api/box3/${year}/return`),
    enabled: year != null,
  });
  const box3 = useQuery({
    queryKey: ["box3", year],
    queryFn: () => get<Box3Year>(`/api/box3/${year}`),
    enabled: year != null,
  });
  const people = useHousehold();

  if (overview.isLoading || data.isLoading) return <Spinner />;
  if (data.error) return <Alert tone="danger">{(data.error as Error).message}</Alert>;
  const r = data.data;

  return (
    <>
      <PageHeader
        title={year ? t("For the tax return {year}", { year }) : t("For the tax return")}
        subtitle={t(
          "What you fill in under box 3, in the order of the return: per part, per account and per owner, in whole euros (assets rounded down, debts up). Check it against the year statements of your banks and brokers.",
        )}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <Select
              value={year ?? ""}
              onChange={(e) => setSearch({ year: e.target.value }, { replace: true })}
              aria-label={t("Tax year")}
              className="w-auto"
            >
              {overview.data?.years.map((y) => (
                <option key={y} value={y}>
                  {t("Tax year {year}", { year: y })}
                </option>
              ))}
            </Select>
            <Button onClick={() => window.print()} title={t("Use “Save as PDF” in the print dialog")}>
              {t("Print / PDF")}
            </Button>
          </div>
        }
      />
      {!r ? null : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-2">
            {tj("Peildatum <0>1 January {year}</0>; {partner}.", [<strong key="p" />], {
              year: r.year,
              partner: r.partner ? t("with fiscal partner") : t("on your own"),
            })}{" "}
            {r.partner && t("Fiscal partners give their assets together; who owns what is shown per line.")}
          </p>
          {r.warnings.map((w) => (
            <Alert key={w}>{w}</Alert>
          ))}

          {r.sections
            .filter((s) => s.lines.length > 0)
            .map((s) => (
              <Card
                key={s.key}
                title={
                  <span className="flex w-full items-center justify-between gap-3">
                    <span>{TITLE[s.key]}</span>
                    <span className="tabular text-sm font-normal text-ink-2">{whole(s.totalEur)}</span>
                  </span>
                }
                padded={false}
              >
                <p className="px-4 pt-3 text-xs text-muted">{HINT[s.key]}</p>
                <div className="overflow-x-auto">
                  <table className="tabular w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs text-ink-2">
                        <th className="px-4 py-2 text-left font-medium">{t("Account")}</th>
                        <th className="px-4 py-2 text-left font-medium">{t("Owner")}</th>
                        <th className="px-4 py-2 text-right font-medium">{t("On 1 January")}</th>
                        <th className="px-4 py-2 text-right font-medium">{t("Counts")}</th>
                        {INCOME[s.key] && <th className="px-4 py-2 text-right font-medium">{INCOME[s.key]}</th>}
                        {s.key === "investments" && (
                          <>
                            <th className="px-4 py-2 text-right font-medium">{t("Dividend (gross)")}</th>
                            <th className="px-4 py-2 text-right font-medium">{t("Tax withheld")}</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {s.lines.map((l) => (
                        <tr key={l.accountId} className="align-top">
                          <td className="px-4 py-2">
                            <div className="font-medium text-ink">
                              {l.name} {l.foreign && <Badge>{t("abroad")}</Badge>}
                            </div>
                            <div className="text-xs text-muted">{kindLabel(l.kind)}</div>
                            {l.details.length > 1 && (
                              <div className="mt-1 text-xs text-ink-2">
                                {l.details.map((d) => `${d.symbol} ${whole(d.valueEur)}`).join(" · ")}
                              </div>
                            )}
                            {l.note && <div className="mt-1 text-xs text-muted">{noteLabel(l.note)}</div>}
                          </td>
                          <td className="px-4 py-2 text-ink-2">{ownerLabel(l, people.data ?? [])}</td>
                          <td className="px-4 py-2 text-right">{whole(l.valueEur)}</td>
                          <td className="px-4 py-2 text-right">
                            {whole(l.countedEur)}
                            {Number(l.countedPct) !== 100 && (
                              <div className="text-xs text-muted">{Number(l.countedPct)}%</div>
                            )}
                          </td>
                          {INCOME[s.key] && (
                            <td className="px-4 py-2 text-right text-ink-2">
                              {l.incomeEur != null ? whole(l.incomeEur) : "—"}
                            </td>
                          )}
                          {s.key === "investments" && (
                            <>
                              <td className="px-4 py-2 text-right text-ink-2">
                                {l.dividendEur != null ? eur(l.dividendEur) : "—"}
                              </td>
                              <td className="px-4 py-2 text-right text-ink-2">
                                {l.dividendTaxEur != null ? eur(l.dividendTaxEur) : "—"}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}

          {(r.extra.bankEur > 0 || r.extra.otherEur > 0 || r.extra.debtsEur > 0) && (
            <Card title={t("Entered on the Box 3 page")}>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                {r.extra.bankEur > 0 && (
                  <>
                    <dt className="text-ink-2">{t("Other bank balances")}</dt>
                    <dd className="tabular text-right">{whole(r.extra.bankEur)}</dd>
                  </>
                )}
                {r.extra.otherEur > 0 && (
                  <>
                    <dt className="text-ink-2">{t("Other box 3 assets")}</dt>
                    <dd className="tabular text-right">{whole(r.extra.otherEur)}</dd>
                  </>
                )}
                {r.extra.debtsEur > 0 && (
                  <>
                    <dt className="text-ink-2">{t("Other debts")}</dt>
                    <dd className="tabular text-right">{whole(r.extra.debtsEur)}</dd>
                  </>
                )}
              </dl>
            </Card>
          )}

          <Card title={t("Dividend tax withheld in {year}", { year: r.year })}>
            {r.dividendTax.dutchEur === 0 && r.dividendTax.foreign.length === 0 ? (
              <p className="text-sm text-ink-2">{t("No dividend tax was withheld that year.")}</p>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                {r.dividendTax.dutchEur > 0 && (
                  <p>
                    {tj(
                      "Dutch dividend tax: <0>{tax}</0> on {gross} of dividends. The return asks for it under taxes already paid; it is offset in full.",
                      [<strong key="t" />],
                      { tax: eur(r.dividendTax.dutchEur), gross: eur(r.dividendTax.dutchGrossEur) },
                    )}
                  </p>
                )}
                {r.dividendTax.foreign.length > 0 && (
                  <>
                    <p className="text-ink-2">
                      {t(
                        "Foreign tax withheld, per country of the security. The return offsets it up to the treaty rate (usually 15%) to avoid double taxation; more must be reclaimed from that country.",
                      )}
                    </p>
                    <ul className="tabular divide-y divide-line rounded-lg border border-line">
                      {r.dividendTax.foreign.map((f) => (
                        <li key={f.country} className="flex justify-between gap-3 px-3 py-1.5">
                          <span>
                            {regionName(f.country)}{" "}
                            <span className="text-xs text-muted">{t("on {gross}", { gross: eur(f.grossEur) })}</span>
                          </span>
                          <span>{eur(f.taxEur)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </Card>

          <Card title={t("Actual return")}>
            <p className="text-sm text-ink-2">
              {r.actualReturnIn === "return"
                ? t(
                    "From {year}, the return itself asks whether you want to give your actual return; the Belastingdienst then uses whichever is lower. The figures below are what it asks for per part.",
                    { year: r.year },
                  )
                : tj(
                    "For {year} you give your actual return on the separate form <0>Opgaaf werkelijk rendement</0> in Mijn Belastingdienst, after your assessment.",
                    [
                      <a
                        key="f"
                        className="underline"
                        href="https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/formulier-opgaaf-werkelijk-rendement"
                        target="_blank"
                        rel="noreferrer"
                      />,
                    ],
                    { year: r.year },
                  )}
            </p>
          </Card>
          {box3.data && <ActualReturnCard y={box3.data} />}

          <p className="text-xs text-muted print:hidden">
            {tj(
              "The full calculation and the rules per year are on the <0>Box 3</0> page. An estimate, not tax advice.",
              [<Link key="b" to={`/box3?year=${r.year}`} className="underline" />],
            )}
          </p>
        </div>
      )}
    </>
  );
}

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames([document.documentElement.lang || "nl"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
