import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get, put } from "../api";
import { Alert, Card, Empty, Spinner, Stat, Swatch, Tabs, cx } from "../components/ui";
import { date, eur, getLocale, pct } from "../format";

interface PeriodReturn {
  from: string;
  to: string;
  startEur: number;
  endEur: number;
  flowsEur: number;
  resultEur: number;
  twrPct: number | null;
  mwrPct: number | null;
}

interface AllTime extends PeriodReturn {
  years: number;
  twrAnnualPct: number | null;
  xirrPct: number | null;
}

export interface MoneyWeighted {
  pct: number | null;
  annualised: boolean;
}

export interface Returns {
  benchmark: { id: string; label: string | null; options: { id: string; label: string }[] };
  allTime: AllTime | null;
  ytd: PeriodReturn | null;
  benchmarkAllTime: AllTime | null;
  years: (PeriodReturn & { year: number; benchmark: PeriodReturn | null })[];
  series: {
    day: string;
    valueEur: number;
    netInvestedEur: number;
    benchmarkEur: number | null;
    twrIndex: number;
    benchmarkIndex: number | null;
  }[];
  byKey: Record<string, MoneyWeighted>;
  byAccount: { accountId: number; name: string; kind: string; valueEur: string; return: MoneyWeighted }[];
}

export const useReturns = () => useQuery({ queryKey: ["returns"], queryFn: () => get<Returns>("/api/returns") });

/** "+12,34 %" with "p.a." when annualised; "—" when unknown. */
export function ReturnPct({
  value,
  annualised,
  className,
}: {
  value: number | null;
  annualised?: boolean;
  className?: string;
}) {
  if (value == null) return <span className="text-muted">—</span>;
  return (
    <span
      className={cx(
        "tabular whitespace-nowrap",
        value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-ink-2",
        className,
      )}
    >
      {pct(value)}
      {annualised && <span className="ml-0.5 text-[0.85em] text-muted"> p.a.</span>}
    </span>
  );
}

const PORTFOLIO = "var(--series-1)";
const BENCHMARK = "var(--series-2)";

const tickDate = (spanDays: number) => (d: string) =>
  new Intl.DateTimeFormat(
    getLocale(),
    spanDays > 400 ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" },
  ).format(new Date(d));

function GrowthChart({ r, view }: { r: Returns; view: "index" | "euros" }) {
  const data = r.series.map((s) => ({
    day: s.day,
    you: view === "index" ? s.twrIndex * 100 : s.valueEur,
    bench:
      s.benchmarkIndex == null && s.benchmarkEur == null
        ? null
        : view === "index"
          ? s.benchmarkIndex! * 100
          : s.benchmarkEur,
    invested: s.netInvestedEur,
  }));
  if (data.length < 2) return <p className="py-8 text-center text-sm text-muted">Not enough history yet.</p>;
  const span = (Date.parse(data.at(-1)!.day) - Date.parse(data[0]!.day)) / 86_400_000;
  const fmt = (v: number) =>
    view === "index"
      ? new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(v)
      : new Intl.NumberFormat(getLocale(), {
          style: "currency",
          currency: "EUR",
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(v);
  const hasBench = data.some((d) => d.bench != null);
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <Swatch color={PORTFOLIO} /> Your portfolio
        </li>
        {hasBench && (
          <li className="flex items-center gap-1.5">
            <Swatch color={BENCHMARK} /> {r.benchmark.label}
            {view === "euros" && " (same money in and out)"}
          </li>
        )}
        {view === "euros" && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-ink-2" /> Money put in (net)
          </li>
        )}
      </ul>
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis
              dataKey="day"
              tickFormatter={tickDate(span)}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={fmt}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={56}
              domain={["auto", "auto"]}
            />
            <Tooltip
              cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                    <div className="mb-1 font-medium text-ink">{date(String(label))}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="flex items-center gap-1.5 text-ink-2">
                        <Swatch color={String(p.color)} />
                        {p.dataKey === "you" ? "You" : p.dataKey === "bench" ? r.benchmark.label : "Money put in"}:{" "}
                        <span className="tabular text-ink">
                          {view === "index"
                            ? new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(Number(p.value))
                            : eur(Number(p.value))}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />
            {view === "euros" && (
              <Line
                type="monotone"
                dataKey="invested"
                stroke="var(--ink-2)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
            {hasBench && (
              <Line
                type="monotone"
                dataKey="bench"
                stroke={BENCHMARK}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}
            <Line
              type="monotone"
              dataKey="you"
              stroke={PORTFOLIO}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted">
        {view === "index"
          ? "Growth of €100 at the time-weighted return: what your investment choices did, whatever the timing of your deposits."
          : `Your net worth, and what the same deposits and withdrawals would be worth in ${r.benchmark.label ?? "the benchmark"}.`}
      </p>
    </div>
  );
}

export function ReturnsView() {
  const qc = useQueryClient();
  const returns = useReturns();
  const [view, setView] = useState<"index" | "euros">("index");
  const [saving, setSaving] = useState(false);
  if (returns.isLoading) return <Spinner />;
  if (returns.error) return <Alert tone="danger">{(returns.error as Error).message}</Alert>;
  const r = returns.data!;
  if (!r.allTime) {
    return (
      <Card>
        <Empty title="No history yet">Add transactions to see your returns.</Empty>
      </Card>
    );
  }
  const a = r.allTime;
  const b = r.benchmarkAllTime;

  const choose = async (id: string) => {
    setSaving(true);
    try {
      await put("/api/returns/benchmark", { id });
      await qc.invalidateQueries({ queryKey: ["returns"] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={`Time-weighted, since ${date(a.from)}`}
          value={<ReturnPct value={a.twrPct} />}
          sub={a.twrAnnualPct != null ? <ReturnPct value={a.twrAnnualPct} annualised /> : undefined}
        />
        <Stat
          label="Your return (money-weighted)"
          value={<ReturnPct value={a.xirrPct ?? a.mwrPct} annualised={a.xirrPct != null} />}
          sub={<span className="text-muted">includes the timing of your deposits</span>}
        />
        <Stat
          label="This year (time-weighted)"
          value={<ReturnPct value={r.ytd?.twrPct ?? null} />}
          sub={
            r.ytd ? (
              <span className="text-muted">
                money-weighted <ReturnPct value={r.ytd.mwrPct} />
              </span>
            ) : undefined
          }
        />
        <Stat
          label={b ? `${r.benchmark.label}, same period` : "Benchmark"}
          value={b ? <ReturnPct value={b.twrPct} /> : <span className="text-muted">off</span>}
          sub={b?.twrAnnualPct != null ? <ReturnPct value={b.twrAnnualPct} annualised /> : undefined}
        />
      </div>

      <Card
        title="Growth"
        actions={
          <Tabs
            value={view}
            onChange={setView}
            options={[
              { value: "index", label: "€100 invested" },
              { value: "euros", label: "In euros" },
            ]}
          />
        }
      >
        <label className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-2">
          Compare with
          <select
            aria-label="Benchmark"
            value={r.benchmark.id}
            disabled={saving}
            onChange={(e) => void choose(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink"
          >
            {r.benchmark.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            <option value="none">nothing</option>
          </select>
        </label>
        {saving ? <Spinner /> : <GrowthChart r={r} view={view} />}
      </Card>

      <Card title="Per year" padded={false}>
        <div className="overflow-x-auto">
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-2">
                <th className="px-3 py-2 text-left font-medium">Year</th>
                <th className="px-3 py-2 text-right font-medium">Start</th>
                <th className="px-3 py-2 text-right font-medium" title="Deposits minus withdrawals">
                  Money in/out
                </th>
                <th className="px-3 py-2 text-right font-medium">Result</th>
                <th className="px-3 py-2 text-right font-medium">Time-weighted</th>
                <th className="px-3 py-2 text-right font-medium">Money-weighted</th>
                {b && <th className="px-3 py-2 text-right font-medium">{r.benchmark.label}</th>}
                {b && (
                  <th
                    className="px-3 py-2 text-right font-medium"
                    title="Your time-weighted return minus the benchmark's"
                  >
                    Difference
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.years.map((y) => {
                const diff = y.twrPct != null && y.benchmark?.twrPct != null ? y.twrPct - y.benchmark.twrPct : null;
                return (
                  <tr key={y.year}>
                    <td className="px-3 py-2 font-medium">
                      {y.year}
                      {y.from > `${y.year - 1}-12-31` && (
                        <span className="ml-1 text-xs text-muted">from {date(y.from)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-2">{eur(y.startEur, { decimals: 0 })}</td>
                    <td className="px-3 py-2 text-right text-ink-2">{eur(y.flowsEur, { decimals: 0, sign: true })}</td>
                    <td className="px-3 py-2 text-right">{eur(y.resultEur, { decimals: 0, sign: true })}</td>
                    <td className="px-3 py-2 text-right">
                      <ReturnPct value={y.twrPct} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ReturnPct value={y.mwrPct} />
                    </td>
                    {b && (
                      <td className="px-3 py-2 text-right">
                        <ReturnPct value={y.benchmark?.twrPct ?? null} />
                      </td>
                    )}
                    {b && (
                      <td className="px-3 py-2 text-right">
                        {diff == null ? "—" : <ReturnPct value={Math.round(diff * 100) / 100} />}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-xs text-muted">
          Time-weighted: how the investments did, as funds report it. Money-weighted: your own return, which also
          depends on when you added or took out money. Benchmarks are accumulating funds (or gold, bitcoin), so their
          price return is their whole return.
        </p>
      </Card>

      <Card title="Per account" padded={false}>
        <ul className="divide-y divide-line">
          {r.byAccount
            .filter((x) => Number(x.valueEur) > 0 || x.return.pct != null)
            .map((x) => (
              <li key={x.accountId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div>
                  <div className="text-ink">{x.name}</div>
                  <div className="text-xs capitalize text-muted">{x.kind}</div>
                </div>
                <div className="text-right">
                  <ReturnPct value={x.return.pct} annualised={x.return.annualised} />
                  <div className="tabular text-xs text-ink-2">{eur(x.valueEur)}</div>
                </div>
              </li>
            ))}
        </ul>
        <p className="px-4 pb-3 text-xs text-muted">
          Money-weighted per account, counting money and assets moved in and out (including transfers between your
          accounts). Under a year: over the period, not annualised.
        </p>
      </Card>
    </div>
  );
}
