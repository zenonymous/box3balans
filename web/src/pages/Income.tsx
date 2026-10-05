import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get, type IncomeResponse } from "../api";
import { downloadCsv } from "../csv";
import { Alert, Button, Card, Empty, PageHeader, Select, Spinner, Stat, Swatch } from "../components/ui";
import { date, eur, getLocale } from "../format";
import { DividendForecastCard, WithholdingCard } from "./DividendOutlook";

// Categorical slots in fixed order: colour follows the income kind.
const KINDS = [
  { key: "dividendsEur", label: "Dividends", color: "var(--series-1)" },
  { key: "rewardsEur", label: "Staking & rewards", color: "var(--series-2)" },
  { key: "interestEur", label: "Interest", color: "var(--series-3)" },
] as const;

const KIND_LABEL: Record<string, string> = { dividend: "Dividend", reward: "Reward", interest: "Interest" };

const compact = (v: number) =>
  new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

export function IncomePage() {
  const income = useQuery({ queryKey: ["income"], queryFn: () => get<IncomeResponse>("/api/income") });
  const years = income.data?.byYear.map((y) => String(y.year)) ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const year = selected ?? years[0] ?? "all";

  const events = (income.data?.events ?? []).filter((e) => year === "all" || e.date.startsWith(year));

  // A year shows its 12 months; "all" shows one bar per year.
  const chart = (() => {
    const d = income.data;
    if (!d) return [];
    if (year === "all") {
      return [...d.byYear].reverse().map((y) => ({
        label: String(y.year),
        dividendsEur: +y.dividendsEur,
        rewardsEur: +y.rewardsEur,
        interestEur: +y.interestEur,
      }));
    }
    return Array.from({ length: 12 }, (_, i) => {
      const m = `${year}-${String(i + 1).padStart(2, "0")}`;
      const row = d.byMonth.find((x) => x.month === m);
      return {
        label: new Intl.DateTimeFormat(getLocale(), { month: "short" }).format(new Date(`${m}-01T00:00:00`)),
        dividendsEur: row ? +row.dividendsEur : 0,
        rewardsEur: row ? +row.rewardsEur : 0,
        interestEur: row ? +row.interestEur : 0,
      };
    });
  })();

  if (income.isLoading) return <Spinner />;
  if (income.error) return <Alert tone="danger">{(income.error as Error).message}</Alert>;
  const d = income.data!;
  if (d.events.length === 0) {
    return (
      <>
        <PageHeader title="Income" />
        <Card>
          <Empty title="No income yet">
            Dividends, staking rewards and interest show up here once recorded or synced.
          </Empty>
        </Card>
        <div className="mt-4">
          <DividendForecastCard />
        </div>
      </>
    );
  }

  const totals =
    year === "all"
      ? d.byYear.reduce(
          (a, y) => ({
            total: a.total + +y.totalEur,
            dividends: a.dividends + +y.dividendsEur,
            rewards: a.rewards + +y.rewardsEur,
            interest: a.interest + +y.interestEur,
            tax: a.tax + +y.taxWithheldEur,
          }),
          { total: 0, dividends: 0, rewards: 0, interest: 0, tax: 0 },
        )
      : (() => {
          const y = d.byYear.find((x) => String(x.year) === year)!;
          return {
            total: +y.totalEur,
            dividends: +y.dividendsEur,
            rewards: +y.rewardsEur,
            interest: +y.interestEur,
            tax: +y.taxWithheldEur,
          };
        })();
  const kinds = KINDS.filter((k) => chart.some((c) => c[k.key] !== 0));

  const byAsset = new Map<
    number,
    { symbol: string; name: string; gross: number; tax: number; net: number; count: number }
  >();
  for (const e of events) {
    const a = byAsset.get(e.assetId) ?? { symbol: e.symbol, name: e.name, gross: 0, tax: 0, net: 0, count: 0 };
    a.gross += +e.grossEur;
    a.tax += +e.taxEur;
    a.net += +e.netEur;
    a.count++;
    byAsset.set(e.assetId, a);
  }
  const assetRows = [...byAsset.values()].sort((a, b) => b.net - a.net);

  return (
    <>
      <PageHeader
        title="Income"
        subtitle="Dividends (after withholding tax), staking rewards and interest, valued in EUR when received."
        actions={
          <Select value={year} onChange={(e) => setSelected(e.target.value)} aria-label="Year" className="max-w-36">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            <option value="all">All years</option>
          </Select>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Net income" value={eur(totals.total)} />
        <Stat label="Dividends" value={eur(totals.dividends)} />
        <Stat label="Staking & rewards" value={eur(totals.rewards)} />
        <Stat label="Interest" value={eur(totals.interest)} />
        <Stat
          label="Tax withheld"
          value={eur(totals.tax)}
          sub={<span className="text-muted">may be reclaimable</span>}
        />
      </div>

      <Card title={year === "all" ? "Income per year" : `Income per month, ${year}`}>
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
          {kinds.map((k) => (
            <li key={k.key} className="flex items-center gap-1.5">
              <Swatch color={k.color} /> {k.label}
            </li>
          ))}
        </ul>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                axisLine={{ stroke: "var(--axis)" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={compact}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as (typeof chart)[number] | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                      <div className="mb-1 text-ink-2">{p.label}</div>
                      {kinds.map((k) => (
                        <div key={k.key} className="flex items-center gap-1.5">
                          <Swatch color={k.color} /> <span className="text-ink-2">{k.label}</span>
                          <span className="tabular ml-auto pl-3 text-ink">{eur(p[k.key])}</span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              {kinds.map((k, i) => (
                <Bar
                  key={k.key}
                  dataKey={k.key}
                  stackId="inc"
                  fill={k.color}
                  stroke="var(--surface)"
                  strokeWidth={1}
                  maxBarSize={40}
                  radius={i === kinds.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DividendForecastCard />
        <WithholdingCard />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card title="By asset" padded={false} className="xl:col-span-2">
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-2">
                <th className="px-3 py-2 text-left font-medium">Asset</th>
                <th className="px-3 py-2 text-right font-medium">Payments</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {assetRows.map((a) => (
                <tr key={a.symbol + a.name}>
                  <td className="px-3 py-2">
                    {a.name} <span className="text-xs text-muted">{a.symbol}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-ink-2">{a.count}</td>
                  <td className="px-3 py-2 text-right" title={`Gross ${eur(a.gross)} · tax ${eur(a.tax)}`}>
                    {eur(a.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card
          title="Payments"
          padded={false}
          className="xl:col-span-3"
          actions={
            <Button
              size="sm"
              onClick={() =>
                downloadCsv(`income-${year}.csv`, events, [
                  { header: "Date", value: (e) => e.date },
                  { header: "Type", value: (e) => KIND_LABEL[e.kind] ?? e.kind },
                  { header: "Asset", value: (e) => e.name },
                  { header: "Symbol", value: (e) => e.symbol },
                  { header: "Account", value: (e) => e.accountName },
                  { header: "Gross EUR", value: (e) => e.grossEur },
                  { header: "Tax withheld EUR", value: (e) => e.taxEur },
                  { header: "Net EUR", value: (e) => e.netEur },
                ])
              }
            >
              ⤓ CSV
            </Button>
          }
        >
          <div className="max-h-[28rem] overflow-auto">
            <table className="tabular w-full min-w-[520px] text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Asset</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">Tax</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((e) => (
                  <tr key={e.txId}>
                    <td className="px-3 py-2 text-ink-2">{date(e.date)}</td>
                    <td className="px-3 py-2">
                      {e.name}{" "}
                      <span className="text-xs text-muted">
                        · {KIND_LABEL[e.kind]} · {e.accountName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{eur(e.grossEur)}</td>
                    <td className="px-3 py-2 text-right text-ink-2">{Number(e.taxEur) ? eur(e.taxEur) : "—"}</td>
                    <td className="px-3 py-2 text-right">{eur(e.netEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
