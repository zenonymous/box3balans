import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, type Box3Year } from "../api";
import { Alert, Badge, Card, Field, Input, Select, Spinner, cx } from "../components/ui";
import { date, eur } from "../format";

type Kind = "bank" | "investments" | "crypto" | "metals" | "cash" | "other";

const KIND_LABEL: Record<Kind, { en: string; nl: string }> = {
  bank: { en: "Bank balances", nl: "banktegoeden" },
  investments: { en: "Shares and funds", nl: "overige bezittingen" },
  crypto: { en: "Crypto", nl: "overige bezittingen" },
  metals: { en: "Precious metals", nl: "overige bezittingen" },
  cash: { en: "Cash on exchanges and in wallets", nl: "overige bezittingen" },
  other: { en: "Other", nl: "overige bezittingen" },
};

const signed = (v: number) => eur(v, { sign: true });

/**
 * The tegenbewijsregeling: the year's actual return, laid out like the Opgaaf werkelijk rendement
 * asks for it, and whether being taxed on it would be cheaper than the deemed return.
 */
export function ActualReturnCard({ y }: { y: Box3Year }) {
  const a = y.actualReturn;
  const c = a.comparison;
  const kinds = (Object.keys(KIND_LABEL) as Kind[]).filter((k) => {
    const p = a.parts[k];
    return p.startEur || p.endEur || p.inEur || p.outEur || p.directEur;
  });
  const th = "px-3 py-2 text-right font-medium";
  return (
    <Card
      title={`Actual return ${y.year}${a.complete ? "" : " so far"} (tegenbewijsregeling)`}
      className="print:break-inside-avoid"
      padded={false}
    >
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-2">
              <th className="px-3 py-2 text-left font-medium">Category</th>
              <th className={th}>1 January</th>
              <th className={th} title="Purchases, deposits and transfers in">
                In
              </th>
              <th className={th} title="Sales, withdrawals, transfers out and units spent on fees">
                Out
              </th>
              <th className={th}>{a.complete ? "31 December" : date(a.endDay)}</th>
              <th className={th} title="Realised and unrealised: end − start − in + out">
                Value change
              </th>
              <th className={th} title="Interest, dividends (gross) and staking rewards">
                Income
              </th>
              <th className={th}>Return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {kinds.map((k) => {
              const p = a.parts[k];
              return (
                <tr key={k}>
                  <td className="px-3 py-2">
                    {KIND_LABEL[k].en} <span className="text-xs text-muted">{KIND_LABEL[k].nl}</span>
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
                  Return on assets not tracked here (entered below)
                </td>
                <td className="px-3 py-2 text-right font-medium">{signed(a.extraReturnEur)}</td>
              </tr>
            )}
            {a.debtInterestEur !== 0 && (
              <tr>
                <td className="px-3 py-2" colSpan={7}>
                  Interest paid on box 3 debts <span className="text-xs text-muted">schulden</span>
                </td>
                <td className="px-3 py-2 text-right font-medium">{signed(-a.debtInterestEur)}</td>
              </tr>
            )}
            <tr className="font-semibold">
              <td className="px-3 py-2" colSpan={7}>
                Actual return <span className="text-xs font-normal text-muted">werkelijk rendement</span>
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
              <dt className="text-ink-2">Box 3 tax on the deemed return</dt>
              <dd className="text-right">{eur(c.deemedTaxEur)}</dd>
              <dt className="text-ink-2">
                Tax on the actual return (
                {a.totalEur < 0 ? "a loss counts as €0" : `${eur(c.actualTaxableEur, { decimals: 0 })} × rate`})
              </dt>
              <dd className="text-right">{eur(c.actualTaxEur)}</dd>
            </dl>
            {!a.complete ? (
              <p className="text-ink-2">The year isn't over yet; check again after 31 December.</p>
            ) : c.worthFiling ? (
              <Alert>
                Your actual return was lower: filing an{" "}
                <a
                  className="underline"
                  href="https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/wat-is-mijn-werkelijk-rendement"
                  target="_blank"
                  rel="noreferrer"
                >
                  Opgaaf werkelijk rendement
                </a>{" "}
                for {y.year} would save about <strong>{eur(c.savingEur)}</strong>.
              </Alert>
            ) : (
              <p className="text-ink-2">
                The deemed return is lower (or equal): no reason to file an Opgaaf werkelijk rendement for {y.year}.
              </p>
            )}
          </>
        ) : (
          <p className="text-ink-2">Add the box 3 rates for {y.year} to compare with the deemed return.</p>
        )}
        <p className="text-xs text-muted">
          As the rules prescribe: costs aren't deducted ({eur(a.costsEur)} of fees are counted back in), dividends count
          before the {eur(a.dividendTaxEur)} tax withheld, there is no tax-free allowance, and a negative total is taxed
          as €0 without carrying over.
          {a.leftOut.length > 0 &&
            ` Left out: ${a.leftOut
              .map(
                (l) =>
                  `${l.category === "exempt" ? "green investments" : "accounts outside box 3"} (${signed(l.returnEur)})`,
              )
              .join(", ")}.`}{" "}
          An estimate to check against your statements, not tax advice.
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
          From 2028: tax on actual return (preview) <Badge tone="warn">not law yet</Badge>
        </span>
      }
      className="print:hidden"
    >
      <p className="mb-3 text-sm text-ink-2">
        The planned system taxes each year's actual result, including unrealised gains, after costs, with a tax-free
        amount and losses carried over. The bill passed the Tweede Kamer on 12 February 2026; the Eerste Kamer is
        waiting for an amendment (novelle) announced in September 2026. Here it is applied to your past years to show
        what it would mean for you.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Field label="Assumptions" className="col-span-2">
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
                  {x.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {field("ratePct", "Rate (%)")}
        {field("allowanceEur", "Tax-free result (€)", "per person")}
        {field("lossThresholdEur", "Loss threshold (€)", "smaller losses don't carry over")}
        <Field label="Carry losses back">
          {(id) => (
            <Select
              id={id}
              value={over.carryBackYears ?? String(p?.carryBackYears ?? 0)}
              onChange={(e) => setOver({ ...over, carryBackYears: e.target.value })}
            >
              <option value="0">No</option>
              <option value="1">One year</option>
            </Select>
          )}
        </Field>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <Alert tone="danger">{(q.error as Error).message}</Alert>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">Year</th>
                  <th className="px-3 py-2 text-right font-medium" title="Actual return minus costs">
                    Result
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Losses set off</th>
                  <th className="px-3 py-2 text-right font-medium">Taxable</th>
                  <th className="px-3 py-2 text-right font-medium">Tax (new)</th>
                  <th className="px-3 py-2 text-right font-medium">Tax (current system)</th>
                  <th className="px-3 py-2 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d!.rows.map((r) => (
                  <tr key={r.year}>
                    <td className="px-3 py-2 font-medium">
                      {r.year}
                      {!r.complete && <span className="ml-1 text-xs text-muted">so far</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{signed(r.resultEur)}</td>
                    <td className="px-3 py-2 text-right text-ink-2">
                      {r.lossUsedEur ? eur(r.lossUsedEur, { decimals: 0 }) : ""}
                      {r.carriedBackEur ? (
                        <span title="Loss of the next year carried back">
                          {eur(r.carriedBackEur, { decimals: 0 })} back
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
              Over {totals.length} finished year{totals.length === 1 ? "" : "s"}: <strong>{eur(sumNew)}</strong> under
              the new system against <strong>{eur(sumOld)}</strong> now (
              {sumNew <= sumOld ? `${eur(sumOld - sumNew)} less` : `${eur(sumNew - sumOld)} more`}).
              {d!.rows[0] &&
                d!.rows[0].lossBalanceEur > 0 &&
                ` Losses still to carry forward: ${eur(d!.rows[0].lossBalanceEur)}.`}
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            Uses your actual return per year (box 3 accounts, minus debt interest) minus fees. The current system's tax
            includes the deemed-return rules for that year. Details of the novelle (rate, tax-free result, carry-back)
            are not final; sources in docs/box3-sources.md. Not tax advice.
          </p>
        </>
      )}
    </Card>
  );
}
