import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get } from "../api";
import { Alert, Card, Empty, Select, Spinner, Stat, Swatch } from "../components/ui";
import { eur, getLocale, pct } from "../format";
import { t, tj } from "../i18n";

type Category = "trading" | "network" | "storage" | "account" | "withholding" | "funds" | "premiums";

interface CostYear extends Record<Category, number> {
  year: number;
  total: number;
  avgValueEur: number;
  pctOfValue: number | null;
}

interface Costs {
  years: CostYear[];
  lines: {
    year: number;
    category: Category;
    accountName: string | null;
    symbol: string | null;
    eur: number;
  }[];
  fundsWithoutTer: { assetId: number; symbol: string; name: string }[];
}

// Six groups (trading and account fees are both what the broker charges), each with a fixed colour.
const GROUPS = [
  { key: "broker", label: t("Broker fees"), of: ["trading", "account"], color: "var(--series-1)" },
  { key: "funds", label: t("Fund running costs"), of: ["funds"], color: "var(--series-2)" },
  { key: "withholding", label: t("Dividend tax withheld"), of: ["withholding"], color: "var(--series-3)" },
  { key: "network", label: t("Network fees"), of: ["network"], color: "var(--series-4)" },
  { key: "storage", label: t("Storage fees"), of: ["storage"], color: "var(--series-5)" },
  { key: "premiums", label: t("Dealer premiums"), of: ["premiums"], color: "var(--series-6)" },
] as const satisfies readonly { key: string; label: string; of: readonly Category[]; color: string }[];

const CATEGORY_LABEL: Record<Category, string> = {
  trading: t("Trading fees"),
  account: t("Account fees"),
  funds: t("Fund running costs (estimate)"),
  withholding: t("Dividend tax withheld"),
  network: t("Network fees"),
  storage: t("Storage fees"),
  premiums: t("Premium above spot"),
};

const group = (y: CostYear, g: (typeof GROUPS)[number]) => g.of.reduce((a, c) => a + y[c], 0);

const compact = (v: number) =>
  new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

export function CostsView() {
  const costs = useQuery({ queryKey: ["costs"], queryFn: () => get<Costs>("/api/costs") });
  const [year, setYear] = useState<string>("");
  if (costs.isLoading) return <Spinner />;
  if (costs.error) return <Alert tone="danger">{costs.error.message}</Alert>;
  const c = costs.data!;
  if (!c.years.length) {
    return (
      <Card>
        <Empty title={t("No costs yet")}>
          {t("Fees, withheld tax and premiums appear here once you have transactions.")}
        </Empty>
      </Card>
    );
  }
  const thisYear = c.years[0]!;
  const lastFull = c.years[1];
  const allTime = c.years.reduce((a, y) => a + y.total, 0);
  // Start with the most recent year that had costs.
  const selected = year || String((c.years.find((y) => y.total > 0) ?? thisYear).year);
  const shown = GROUPS.filter((g) => c.years.some((y) => group(y, g) > 0));
  const chart = [...c.years].reverse().map((y) => ({
    year: String(y.year),
    ...Object.fromEntries(GROUPS.map((g) => [g.key, Math.round(group(y, g) * 100) / 100])),
  }));
  const lines = c.lines.filter((l) => String(l.year) === selected);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("Costs {year} so far", { year: thisYear.year })}
          value={eur(thisYear.total)}
          sub={
            thisYear.pctOfValue != null ? (
              <span className="text-muted">
                {t("{pct} of the average value", { pct: pct(thisYear.pctOfValue, { sign: false }) })}
              </span>
            ) : undefined
          }
        />
        {lastFull && (
          <Stat
            label={t("Costs {year}", { year: lastFull.year })}
            value={eur(lastFull.total)}
            sub={
              lastFull.pctOfValue != null ? (
                <span className="text-muted">
                  {t("{pct} of the average value", { pct: pct(lastFull.pctOfValue, { sign: false }) })}
                </span>
              ) : undefined
            }
          />
        )}
        <Stat
          label={t("All costs so far")}
          value={eur(allTime)}
          sub={<span className="text-muted">{t("since you started")}</span>}
        />
        <Stat
          label={t("Biggest cost (all time)")}
          value={(() => {
            const totals = GROUPS.map((g) => ({ g, v: c.years.reduce((a, y) => a + group(y, g), 0) })).sort(
              (a, b) => b.v - a.v,
            );
            return totals[0] && totals[0].v > 0 ? totals[0].g.label : "—";
          })()}
        />
      </div>

      {c.fundsWithoutTer.length > 0 && (
        <Alert>
          {tj(
            "Fund running costs are missing for {list}: enter their yearly cost (TER) under <0>Assets</0>.",
            [<Link key="a" to="/assets" className="underline" />],
            { list: c.fundsWithoutTer.map((f) => f.symbol).join(", ") },
          )}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card title={t("Costs per year")} className="xl:col-span-2">
          <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2" aria-label={t("Legend")}>
            {shown.map((g) => (
              <li key={g.key} className="flex items-center gap-1.5">
                <Swatch color={g.color} /> {g.label}
              </li>
            ))}
          </ul>
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
                  width={56}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                        <div className="mb-1 font-medium text-ink">{label}</div>
                        {[...payload].reverse().map((p) =>
                          Number(p.value) > 0 ? (
                            <div key={String(p.dataKey)} className="flex items-center gap-1.5 text-ink-2">
                              <Swatch color={String(p.color)} />
                              {GROUPS.find((g) => g.key === p.dataKey)?.label}:{" "}
                              <span className="tabular text-ink">{eur(Number(p.value))}</span>
                            </div>
                          ) : null,
                        )}
                      </div>
                    ) : null
                  }
                />
                {shown.map((g, i) => (
                  <Bar
                    key={g.key}
                    dataKey={g.key}
                    stackId="costs"
                    fill={g.color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                    maxBarSize={48}
                    radius={i === shown.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title={t("Per year")} className="xl:col-span-3" padded={false}>
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">{t("Year")}</th>
                  {shown.map((g) => (
                    <th key={g.key} className="px-3 py-2 text-right font-medium">
                      {g.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">{t("Total")}</th>
                  <th
                    className="px-3 py-2 text-right font-medium"
                    title={t("Of the average portfolio value that year")}
                  >
                    {t("% of value")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {c.years.map((y) => (
                  <tr key={y.year}>
                    <td className="px-3 py-2 font-medium">{y.year}</td>
                    {shown.map((g) => (
                      <td key={g.key} className="px-3 py-2 text-right text-ink-2">
                        {group(y, g) ? eur(group(y, g)) : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-medium">{eur(y.total)}</td>
                    <td className="px-3 py-2 text-right text-ink-2">
                      {y.pctOfValue != null ? pct(y.pctOfValue, { sign: false }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card
        title={t("Where the costs went")}
        padded={false}
        actions={
          <Select
            aria-label={t("Year")}
            value={selected}
            onChange={(e) => setYear(e.target.value)}
            className="w-auto py-1 text-xs"
          >
            {c.years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}
              </option>
            ))}
          </Select>
        }
      >
        {lines.length === 0 ? (
          <Empty title={t("No costs that year")} />
        ) : (
          <table className="tabular w-full text-sm">
            <tbody className="divide-y divide-line">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{CATEGORY_LABEL[l.category]}</td>
                  <td className="px-4 py-2 text-ink-2">{[l.accountName, l.symbol].filter(Boolean).join(" · ")}</td>
                  <td className="px-4 py-2 text-right">{eur(l.eur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-4 py-2 text-xs text-muted">
          {t(
            "Fees paid in a coin or in grams count at what those units cost you. Fund running costs are estimated from the TER and the fund's daily value; they're taken from the fund's price, so they're already inside your results. Dividend tax withheld can often be reclaimed or offset in your tax return.",
          )}
        </p>
      </Card>
    </div>
  );
}
