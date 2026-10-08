import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, type Box3Year } from "../api";
import { Alert, Badge, Card, Field, Input, Select, Spinner, cx } from "../components/ui";
import { date, eur } from "../format";
import { getLang, t, tj, tn } from "../i18n";

type Kind = "bank" | "investments" | "crypto" | "metals" | "cash" | "other";
const KINDS: Kind[] = ["bank", "investments", "crypto", "metals", "cash", "other"];

const kindLabel = (k: Kind) =>
  ({
    bank: t("Bank balances"),
    investments: t("Shares and funds"),
    crypto: t("Crypto"),
    metals: t("Precious metals"),
    cash: t("Cash on exchanges and in wallets"),
    other: t("Other (homes, money lent, insurance)"),
  })[k];
// The Dutch term next to an English label.
const kindTerm = (k: Kind) => (getLang() === "en" ? (k === "bank" ? "banktegoeden" : "overige bezittingen") : "");

const signed = (v: number) => eur(v, { sign: true });

/**
 * The tegenbewijsregeling: the year's actual return, laid out like the Opgaaf werkelijk rendement
 * asks for it, and whether being taxed on it would be cheaper than the deemed return.
 */
export function ActualReturnCard({ y }: { y: Box3Year }) {
  const a = y.actualReturn;
  const c = a.comparison;
  const kinds = KINDS.filter((k) => {
    const p = a.parts[k];
    return p.startEur || p.endEur || p.inEur || p.outEur || p.directEur;
  });
  const th = "px-3 py-2 text-right font-medium";
  return (
    <Card
      title={
        a.complete
          ? t("Actual return {year} (tegenbewijsregeling)", { year: y.year })
          : t("Actual return {year} so far (tegenbewijsregeling)", { year: y.year })
      }
      className="print:break-inside-avoid"
      padded={false}
    >
      {a.warnings.length > 0 && (
        <div className="flex flex-col gap-2 px-4 pt-3">
          {a.warnings.map((w) => (
            <Alert key={w}>{w}</Alert>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-2">
              <th className="px-3 py-2 text-left font-medium">{t("Category")}</th>
              <th className={th}>{t("1 January")}</th>
              <th className={th} title={t("Purchases, deposits and transfers in")}>
                {t("In")}
              </th>
              <th className={th} title={t("Sales, withdrawals, transfers out and units spent on fees")}>
                {t("Out")}
              </th>
              <th className={th}>{a.complete ? t("31 December") : date(a.endDay)}</th>
              <th className={th} title={t("Realised and unrealised: end − start − in + out")}>
                {t("Value change")}
              </th>
              <th className={th} title={t("Interest, dividends (gross), rent and staking rewards")}>
                {t("Income")}
              </th>
              <th className={th}>{t("Return")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {kinds.map((k) => {
              const p = a.parts[k];
              return (
                <tr key={k}>
                  <td className="px-3 py-2">
                    {kindLabel(k)} <span className="text-xs text-muted">{kindTerm(k)}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-ink-2">{eur(p.startEur, { decimals: 0 })}</td>
                  <td className="px-3 py-2 text-right text-ink-2">{p.inEur ? eur(p.inEur, { decimals: 0 }) : "—"}</td>
                  <td className="px-3 py-2 text-right text-ink-2">{p.outEur ? eur(p.outEur, { decimals: 0 }) : "—"}</td>
                  <td className="px-3 py-2 text-right text-ink-2">{eur(p.endEur, { decimals: 0 })}</td>
                  <td className="px-3 py-2 text-right">{signed(p.valueChangeEur)}</td>
                  <td className="px-3 py-2 text-right">{p.directEur ? eur(p.directEur) : "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{signed(p.returnEur)}</td>
                </tr>
              );
            })}
            {a.extraReturnEur !== 0 && (
              <tr>
                <td className="px-3 py-2" colSpan={7}>
                  {t("Return on assets not tracked here (entered above)")}
                </td>
                <td className="px-3 py-2 text-right font-medium">{signed(a.extraReturnEur)}</td>
              </tr>
            )}
            {a.debtInterestEur !== 0 && (
              <tr>
                <td className="px-3 py-2" colSpan={7}>
                  {t("Interest paid on box 3 debts")}
                </td>
                <td className="px-3 py-2 text-right font-medium">{signed(-a.debtInterestEur)}</td>
              </tr>
            )}
            <tr className="font-semibold">
              <td className="px-3 py-2" colSpan={7}>
                {t("Actual return")}{" "}
                {getLang() === "en" && <span className="text-xs font-normal text-muted">werkelijk rendement</span>}
              </td>
              <td className="px-3 py-2 text-right">{signed(a.totalEur)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 text-sm">
        {c ? (
          <>
            <dl className="tabular grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              <dt className="text-ink-2">{t("Box 3 tax on the deemed return")}</dt>
              <dd className="text-right">{eur(c.deemedTaxEur)}</dd>
              <dt className="text-ink-2">
                {a.totalEur < 0
                  ? t("Tax on the actual return (a loss counts as €0)")
                  : t("Tax on the actual return ({amount} × rate)", {
                      amount: eur(c.actualTaxableEur, { decimals: 0 }),
                    })}
              </dt>
              <dd className="text-right">{eur(c.actualTaxEur)}</dd>
            </dl>
            {!a.complete ? (
              <p className="text-ink-2">{t("The year isn't over yet; check again after 31 December.")}</p>
            ) : c.worthFiling ? (
              <Alert>
                {y.year >= 2025
                  ? tj(
                      "Your actual return was lower: give it in your tax return for {year} (the return asks whether you want to). That would save about <0>{saving}</0>.",
                      [<strong key="s" />],
                      { year: y.year, saving: eur(c.savingEur) },
                    )
                  : tj(
                      "Your actual return was lower: filing an <0>Opgaaf werkelijk rendement</0> for {year} would save about <1>{saving}</1>.",
                      [
                        <a
                          key="owr"
                          className="underline"
                          href="https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/formulier-opgaaf-werkelijk-rendement"
                          target="_blank"
                          rel="noreferrer"
                        />,
                        <strong key="s" />,
                      ],
                      { year: y.year, saving: eur(c.savingEur) },
                    )}
              </Alert>
            ) : (
              <p className="text-ink-2">
                {y.year >= 2025
                  ? t("The deemed return is lower (or equal): no reason to give your actual return for {year}.", {
                      year: y.year,
                    })
                  : t(
                      "The deemed return is lower (or equal): no reason to file an Opgaaf werkelijk rendement for {year}.",
                      {
                        year: y.year,
                      },
                    )}
              </p>
            )}
          </>
        ) : (
          <p className="text-ink-2">
            {t("Add the box 3 rates for {year} to compare with the deemed return.", { year: y.year })}
          </p>
        )}
        <p className="text-xs text-muted">
          {t(
            "As the rules prescribe: costs aren't deducted ({costs} of fees are counted back in), dividends count before the {tax} tax withheld, there is no tax-free allowance, and a negative total is taxed as €0 without carrying over.",
            { costs: eur(a.costsEur), tax: eur(a.dividendTaxEur) },
          )}
          {a.leftOut.length > 0 &&
            ` ${t("Left out: {list}.", {
              list: a.leftOut
                .map(
                  (l) =>
                    `${l.category === "exempt" ? t("green investments") : t("accounts outside box 3")} (${signed(l.returnEur)})`,
                )
                .join(", "),
            })}`}{" "}
          {t("An estimate to check against your statements, not tax advice.")}
        </p>
      </div>
    </Card>
  );
}

interface FutureRow {
  year: number;
  complete: boolean;
  resultEur: number;
  allowanceEur: number;
  lossUsedEur: number;
  carriedBackEur: number;
  taxableEur: number;
  taxEur: number;
  lossBalanceEur: number;
  deemedTaxEur: number | null;
  differenceEur: number | null;
}

interface FutureResponse {
  presets: {
    id: string;
    label: string;
    ratePct: number;
    allowanceEur: number;
    lossThresholdEur: number;
    carryBackYears: number;
  }[];
  preset: string;
  params: { ratePct: number; allowanceEur: number; lossThresholdEur: number; carryBackYears: number };
  rows: FutureRow[];
}

const presetLabel = (id: string, fallback: string) =>
  ({
    bill: t("Bill as passed by the Tweede Kamer (12 Feb 2026)"),
    letter: t("Cabinet letter of 29 Sep 2026: €1,000 tax-free (tax on sale not modelled)"),
  })[id] ?? fallback;

/** The planned actual-return system (2028) applied to your past years, with editable assumptions. */
export function FuturePreviewCard() {
  const [preset, setPreset] = useState("bill");
  const [over, setOver] = useState<Record<string, string>>({});
  const params = new URLSearchParams({ preset });
  for (const [k, v] of Object.entries(over)) if (v.trim() !== "") params.set(k, v.replace(",", "."));
  const q = useQuery({
    queryKey: ["box3-future", params.toString()],
    queryFn: () => get<FutureResponse>(`/api/box3/future?${params}`),
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  const p = d?.params;
  const field = (key: keyof FutureResponse["params"], label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id) => (
        <Input
          id={id}
          inputMode="decimal"
          placeholder={p ? String(p[key]) : ""}
          value={over[key] ?? ""}
          onChange={(e) => setOver({ ...over, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  const totals = d?.rows.filter((r) => r.complete && r.deemedTaxEur != null) ?? [];
  const sumNew = totals.reduce((s, r) => s + r.taxEur, 0);
  const sumOld = totals.reduce((s, r) => s + (r.deemedTaxEur ?? 0), 0);

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t("From 2028: tax on the actual return (preview)")} <Badge tone="warn">{t("not law yet")}</Badge>
        </span>
      }
      className="print:hidden"
    >
      <p className="mb-3 text-sm text-ink-2">
        {t(
          "The bill the Tweede Kamer passed on 12 February 2026 taxes each year's actual result, including unrealised gains, after costs, with a tax-free amount and losses carried over. In a letter of 29 September 2026 the cabinet announced an amendment (novelle): from 2028 shares, bonds and options would be taxed only when sold, other assets from 2030, with a tax-free result of €1,000. Here the yearly rules are applied to your past years. Tax on sale isn't modelled yet, so for investments you didn't sell, this shows more tax than the novelle would charge.",
        )}
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Field label={t("Assumptions")} className="col-span-2">
          {(id) => (
            <Select
              id={id}
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                setOver({});
              }}
            >
              {d?.presets.map((x) => (
                <option key={x.id} value={x.id}>
                  {presetLabel(x.id, x.label)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {field("ratePct", t("Rate (%)"))}
        {field("allowanceEur", t("Tax-free result (€)"), t("per person"))}
        {field("lossThresholdEur", t("Loss threshold (€)"), t("smaller losses don't carry over"))}
        <Field label={t("Carry losses back")}>
          {(id) => (
            <Select
              id={id}
              value={over.carryBackYears ?? String(p?.carryBackYears ?? 0)}
              onChange={(e) => setOver({ ...over, carryBackYears: e.target.value })}
            >
              <option value="0">{t("No")}</option>
              <option value="1">{t("One year")}</option>
            </Select>
          )}
        </Field>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <Alert tone="danger">{q.error.message}</Alert>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">{t("Year")}</th>
                  <th className="px-3 py-2 text-right font-medium" title={t("Actual return minus costs")}>
                    {t("Result")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">{t("Losses set off")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Taxable")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Tax (new)")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Tax (current system)")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Difference")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d!.rows.map((r) => (
                  <tr key={r.year}>
                    <td className="px-3 py-2 font-medium">
                      {r.year}
                      {!r.complete && <span className="ml-1 text-xs text-muted">{t("so far")}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{signed(r.resultEur)}</td>
                    <td className="px-3 py-2 text-right text-ink-2">
                      {r.lossUsedEur ? eur(r.lossUsedEur, { decimals: 0 }) : ""}
                      {r.carriedBackEur ? (
                        <span title={t("Loss of the next year carried back")}>
                          {t("{amount} back", { amount: eur(r.carriedBackEur, { decimals: 0 }) })}
                        </span>
                      ) : (
                        ""
                      )}
                      {!r.lossUsedEur && !r.carriedBackEur && "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-2">{eur(r.taxableEur, { decimals: 0 })}</td>
                    <td className="px-3 py-2 text-right">{eur(r.taxEur)}</td>
                    <td className="px-3 py-2 text-right text-ink-2">
                      {r.deemedTaxEur != null ? eur(r.deemedTaxEur) : "—"}
                    </td>
                    <td
                      className={cx(
                        "px-3 py-2 text-right",
                        r.differenceEur != null && r.differenceEur > 0 && "text-loss",
                        r.differenceEur != null && r.differenceEur < 0 && "text-gain",
                      )}
                    >
                      {r.differenceEur != null ? signed(r.differenceEur) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totals.length > 0 && (
            <p className="mt-3 text-sm">
              {tj(
                tn(
                  totals.length,
                  "Over {n} finished year: <0>{new}</0> under the new system against <1>{old}</1> now ({diff}).",
                  "Over {n} finished years: <0>{new}</0> under the new system against <1>{old}</1> now ({diff}).",
                ),
                [<strong key="n" />, <strong key="o" />],
                {
                  new: eur(sumNew),
                  old: eur(sumOld),
                  diff:
                    sumNew <= sumOld
                      ? t("{amount} less", { amount: eur(sumOld - sumNew) })
                      : t("{amount} more", { amount: eur(sumNew - sumOld) }),
                },
              )}
              {d!.rows[0] &&
                d!.rows[0].lossBalanceEur > 0 &&
                ` ${t("Losses still to carry forward: {amount}.", { amount: eur(d!.rows[0].lossBalanceEur) })}`}
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            {t(
              "Uses your actual return per year (box 3 accounts, minus debt interest) minus costs. The current system's tax follows the deemed-return rules for that year. The novelle's details aren't final; sources in docs/box3-sources.md. Not tax advice.",
            )}
          </p>
        </>
      )}
    </Card>
  );
}
