import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { get, type Performance } from "../api";
import { downloadCsv } from "../csv";
import { Alert, Badge, Button, Card, Delta, Empty, PageHeader, Select, Spinner, Stat, Tabs } from "../components/ui";
import { CostsView } from "./Costs";
import { ReturnPct, ReturnsView, useReturns } from "./Returns";
import { CLASS_COLOR, date, eur, getLocale, num } from "../format";
import { t, tj } from "../i18n";

const compact = (v: number) =>
  new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

type Tab = "results" | "returns" | "costs";
const TABS: { value: Tab; label: string }[] = [
  { value: "results", label: t("Results in euros") },
  { value: "returns", label: t("Returns %") },
  { value: "costs", label: t("Costs") },
];

export function PerformancePage() {
  const perf = useQuery({ queryKey: ["performance"], queryFn: () => get<Performance>("/api/performance") });
  const returns = useReturns();
  // The tab is in the URL (?tab=returns), so it can be linked to and survives a reload.
  const [search, setSearch] = useSearchParams();
  const tab: Tab = TABS.find((x) => x.value === search.get("tab"))?.value ?? "results";
  const setTab = (x: Tab) => setSearch(x === "results" ? {} : { tab: x }, { replace: true });
  const [year, setYear] = useState("all");

  const realized = useMemo(
    () => (perf.data?.realized ?? []).filter((r) => year === "all" || r.date.startsWith(year)),
    [perf.data, year],
  );

  if (perf.isLoading) return <Spinner />;
  if (perf.error) return <Alert tone="danger">{perf.error.message}</Alert>;
  const p = perf.data!;
  if (p.years.length === 0) {
    return (
      <>
        <PageHeader title={t("Performance")} />
        <Card>
          <Empty title={t("No history yet")}>{t("Add transactions to see results per year.")}</Empty>
        </Card>
      </>
    );
  }

  const chart = [...p.years].reverse().map((y) => ({ year: String(y.year), result: Number(y.resultEur) }));

  return (
    <>
      <PageHeader
        title={t("Performance")}
        subtitle={tj(
          "Investment result = realized gains + income + change in open gains. Deposits and withdrawals are not results. Cost basis: <0>{method}</0>.",
          [<Link key="m" to="/settings" className="text-accent underline" />],
          { method: p.costMethod === "fifo" ? "FIFO" : t("average cost") },
        )}
      />

      <div className="mb-4">
        <Tabs value={tab} onChange={setTab} options={TABS} />
      </div>
      {tab === "returns" ? (
        <ReturnsView />
      ) : tab === "costs" ? (
        <CostsView />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("Total result (all time)")} value={<Delta value={p.allTime.resultEur} />} />
            <Stat label={t("Realized gains")} value={<Delta value={p.allTime.realizedEur} />} />
            <Stat
              label={t("Income")}
              value={eur(p.allTime.incomeEur)}
              sub={<span className="text-muted">{t("dividends, rewards, interest")}</span>}
            />
            <Stat
              label={t("Open gains now")}
              value={<Delta value={p.allTime.unrealizedEur} />}
              sub={
                <span className="text-muted">
                  {t("fees paid: {amount} (included)", { amount: eur(p.allTime.feesEur) })}
                </span>
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Card title={t("Result per year")} className="xl:col-span-2">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis
                      dataKey="year"
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      axisLine={{ stroke: "var(--axis)" }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={compact}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                    />
                    <ReferenceLine y={0} stroke="var(--axis)" />
                    <Tooltip
                      cursor={{ fill: "var(--surface-2)" }}
                      content={({ active, payload }) => {
                        const d = payload?.[0]?.payload as (typeof chart)[number] | undefined;
                        if (!active || !d) return null;
                        return (
                          <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                            <div className="text-ink-2">{d.year}</div>
                            <div className="tabular mt-0.5 font-medium text-ink">{eur(d.result, { sign: true })}</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="result" maxBarSize={48} radius={[4, 4, 4, 4]} isAnimationActive={false}>
                      {/* Polarity: gains in the series blue, losses in the diverging red; values are signed in the tooltip and table. */}
                      {chart.map((d) => (
                        <Cell key={d.year} fill={d.result >= 0 ? "var(--series-1)" : "var(--loss)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title={t("Per year")} className="xl:col-span-3" padded={false}>
              <div className="overflow-x-auto">
                <table className="tabular w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-2">
                      <th className="px-3 py-2 text-left font-medium">{t("Year")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Realized")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Income")}</th>
                      <th
                        className="px-3 py-2 text-right font-medium"
                        title={t("Change in unrealized gains over the year")}
                      >
                        {t("Δ Open gains")}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">{t("Result")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Net worth 31 Dec")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {p.years.map((y) => (
                      <tr key={y.year}>
                        <td className="px-3 py-2 font-medium">{y.year}</td>
                        <td className="px-3 py-2 text-right">
                          <Delta value={y.realizedEur} />
                        </td>
                        <td
                          className="px-3 py-2 text-right"
                          title={t(
                            "Dividends {dividends} · rewards {rewards} · interest {interest} · tax withheld {tax}",
                            {
                              dividends: eur(y.dividendsEur),
                              rewards: eur(y.rewardsEur),
                              interest: eur(y.interestEur),
                              tax: eur(y.taxWithheldEur),
                            },
                          )}
                        >
                          {eur(y.incomeEur)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Delta value={y.unrealizedChangeEur} />
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          <Delta value={y.resultEur} />
                        </td>
                        <td className="px-3 py-2 text-right text-ink-2">{eur(y.netWorthEndEur, { decimals: 0 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title={t("Per asset")} padded={false} className="mt-4">
            <div className="overflow-x-auto">
              <table className="tabular w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-2">
                    <th className="px-3 py-2 text-left font-medium">{t("Asset")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Value")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Open gain")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Realized")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Income")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Total")}</th>
                    <th
                      className="px-3 py-2 text-right font-medium"
                      title={t(
                        "Money-weighted return: annualised (p.a.) when held a year or longer, else over the holding period",
                      )}
                    >
                      {t("Return")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {p.byAsset.map((a) => (
                    <tr key={a.key}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-sm"
                            style={{ background: CLASS_COLOR[a.assetClass] }}
                          />
                          <span className="font-medium">{a.name}</span>
                          <span className="text-xs text-muted">{a.symbol}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">{eur(a.valueEur)}</td>
                      <td className="px-3 py-2 text-right">
                        <Delta value={a.unrealizedEur} />
                        {a.fxEffectEur && (
                          <div
                            className="text-xs text-muted"
                            title={t(
                              "Bought in {currency}: split of the open gain into price movement and currency movement",
                              { currency: a.localCurrency ?? "" },
                            )}
                          >
                            {t("price {amount}", { amount: eur(a.priceEffectEur, { sign: true }) })} · {a.localCurrency}{" "}
                            {eur(a.fxEffectEur, { sign: true })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Delta value={a.realizedEur} />
                      </td>
                      <td className="px-3 py-2 text-right">{eur(a.incomeEur)}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        <Delta value={a.totalEur} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <ReturnPct
                          value={returns.data?.byKey[a.key]?.pct ?? null}
                          annualised={returns.data?.byKey[a.key]?.annualised}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title={t("Realized gains")}
            padded={false}
            className="mt-4"
            actions={
              <>
                <Select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="py-1 text-xs"
                  aria-label={t("Year")}
                >
                  <option value="all">{t("All years")}</option>
                  {p.years.map((y) => (
                    <option key={y.year} value={String(y.year)}>
                      {y.year}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  disabled={realized.length === 0}
                  onClick={() =>
                    downloadCsv(`realized-gains-${year}.csv`, realized, [
                      { header: t("Date"), value: (r) => r.date },
                      { header: t("Asset"), value: (r) => r.name },
                      { header: t("Symbol"), value: (r) => r.symbol },
                      { header: t("Type"), value: (r) => (r.kind === "fee" ? t("network fee") : t("sale")) },
                      { header: t("Account"), value: (r) => r.accountName },
                      { header: t("Quantity"), value: (r) => r.quantity },
                      { header: t("Proceeds EUR"), value: (r) => r.proceedsEur },
                      { header: t("Cost EUR"), value: (r) => r.costEur },
                      { header: t("Gain EUR"), value: (r) => r.gainEur },
                    ])
                  }
                >
                  ⤓ CSV
                </Button>
              </>
            }
          >
            {realized.length === 0 ? (
              <Empty title={t("No sales in this period")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="tabular w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-2">
                      <th className="px-3 py-2 text-left font-medium">{t("Date")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("Asset")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Quantity")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Proceeds")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Cost")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Gain")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {realized.map((r) => (
                      <tr key={r.txId}>
                        <td className="px-3 py-2 text-ink-2">{date(r.date)}</td>
                        <td className="px-3 py-2">
                          {r.name} <span className="text-xs text-muted">· {r.accountName}</span>{" "}
                          {r.physical && <Badge>{t("physical")}</Badge>}{" "}
                          {r.kind === "fee" && <Badge>{t("network fee")}</Badge>}
                        </td>
                        <td className="px-3 py-2 text-right">{num(r.quantity)}</td>
                        <td className="px-3 py-2 text-right">{eur(r.proceedsEur)}</td>
                        <td className="px-3 py-2 text-right text-ink-2">{eur(r.costEur)}</td>
                        <td className="px-3 py-2 text-right">
                          <Delta value={r.gainEur} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
