import { useMemo, useState } from "react";
import { Link } from "react-router";
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
import { Alert, Badge, Button, Card, Delta, Empty, PageHeader, Select, Spinner, Stat } from "../components/ui";
import { CLASS_COLOR, date, eur, getLocale, num } from "../format";

const compact = (v: number) =>
  new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

export function PerformancePage() {
  const perf = useQuery({ queryKey: ["performance"], queryFn: () => get<Performance>("/api/performance") });
  const [year, setYear] = useState("all");

  const realized = useMemo(
    () => (perf.data?.realized ?? []).filter((r) => year === "all" || r.date.startsWith(year)),
    [perf.data, year],
  );

  if (perf.isLoading) return <Spinner />;
  if (perf.error) return <Alert tone="danger">{(perf.error as Error).message}</Alert>;
  const p = perf.data!;
  if (p.years.length === 0) {
    return (
      <>
        <PageHeader title="Performance" />
        <Card>
          <Empty title="No history yet">Add transactions to see results per year.</Empty>
        </Card>
      </>
    );
  }

  const chart = [...p.years].reverse().map((y) => ({ year: String(y.year), result: Number(y.resultEur) }));

  return (
    <>
      <PageHeader
        title="Performance"
        subtitle={
          <>
            Investment result = realized gains + income + change in open gains. Deposits and withdrawals are not
            results. Cost basis:{" "}
            <Link to="/settings" className="text-accent underline">
              {p.costMethod === "fifo" ? "FIFO" : "average cost"}
            </Link>
            .
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total result (all time)" value={<Delta value={p.allTime.resultEur} />} />
        <Stat label="Realized gains" value={<Delta value={p.allTime.realizedEur} />} />
        <Stat
          label="Income"
          value={eur(p.allTime.incomeEur)}
          sub={<span className="text-muted">dividends, rewards, interest</span>}
        />
        <Stat
          label="Open gains now"
          value={<Delta value={p.allTime.unrealizedEur} />}
          sub={<span className="text-muted">fees paid: {eur(p.allTime.feesEur)} (included)</span>}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card title="Result per year" className="xl:col-span-2">
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

        <Card title="Per year" className="xl:col-span-3" padded={false}>
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">Year</th>
                  <th className="px-3 py-2 text-right font-medium">Realized</th>
                  <th className="px-3 py-2 text-right font-medium">Income</th>
                  <th className="px-3 py-2 text-right font-medium" title="Change in unrealized gains over the year">
                    Δ Open gains
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Result</th>
                  <th className="px-3 py-2 text-right font-medium">Net worth 31 Dec</th>
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
                      title={`Dividends ${eur(y.dividendsEur)} · rewards ${eur(y.rewardsEur)} · interest ${eur(y.interestEur)} · tax withheld ${eur(y.taxWithheldEur)}`}
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

      <Card title="Per asset" padded={false} className="mt-4">
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-2">
                <th className="px-3 py-2 text-left font-medium">Asset</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-right font-medium">Open gain</th>
                <th className="px-3 py-2 text-right font-medium">Realized</th>
                <th className="px-3 py-2 text-right font-medium">Income</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
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
                        title={`Bought in ${a.localCurrency}: split of the open gain into price movement and currency movement`}
                      >
                        price {eur(a.priceEffectEur, { sign: true })} · {a.localCurrency}{" "}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Realized gains"
        padded={false}
        className="mt-4"
        actions={
          <>
            <Select value={year} onChange={(e) => setYear(e.target.value)} className="py-1 text-xs" aria-label="Year">
              <option value="all">All years</option>
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
                  { header: "Date", value: (r) => r.date },
                  { header: "Asset", value: (r) => r.name },
                  { header: "Symbol", value: (r) => r.symbol },
                  { header: "Type", value: (r) => (r.kind === "fee" ? "network fee" : "sale") },
                  { header: "Account", value: (r) => r.accountName },
                  { header: "Quantity", value: (r) => r.quantity },
                  { header: "Proceeds EUR", value: (r) => r.proceedsEur },
                  { header: "Cost EUR", value: (r) => r.costEur },
                  { header: "Gain EUR", value: (r) => r.gainEur },
                ])
              }
            >
              ⤓ CSV
            </Button>
          </>
        }
      >
        {realized.length === 0 ? (
          <Empty title="No sales in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Asset</th>
                  <th className="px-3 py-2 text-right font-medium">Quantity</th>
                  <th className="px-3 py-2 text-right font-medium">Proceeds</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Gain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {realized.map((r) => (
                  <tr key={r.txId}>
                    <td className="px-3 py-2 text-ink-2">{date(r.date)}</td>
                    <td className="px-3 py-2">
                      {r.name} <span className="text-xs text-muted">· {r.accountName}</span>{" "}
                      {r.physical && <Badge>physical</Badge>} {r.kind === "fee" && <Badge>network fee</Badge>}
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
  );
}
