import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryPoint } from "../api";
import { CLASS_COLOR, CLASS_LABEL, CLASS_ORDER, date, eur, getLocale } from "../format";
import { Swatch } from "../components/ui";
import { t } from "../i18n";

const compact = (v: number) =>
  new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

const tickDate = (spanDays: number) => (d: string) =>
  new Intl.DateTimeFormat(
    getLocale(),
    spanDays > 400 ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" },
  ).format(new Date(d));

/**
 * Net worth over time as areas stacked by asset class (fixed colour per class), with an optional
 * dashed line for the invested amount. Crosshair tooltip lists every class.
 */
export function NetWorthChart({ points, showInvested }: { points: HistoryPoint[]; showInvested: boolean }) {
  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        {t("Not enough history yet. Add transactions, or wait for price history to load.")}
      </p>
    );
  }
  // Only classes that appear in this range, in the fixed order (colour follows the class).
  const classes = CLASS_ORDER.filter((c) => points.some((p) => p.byClass[c] !== 0));
  const data = points.map((p) => ({ day: p.day, total: p.totalEur, invested: p.investedEur, ...p.byClass }));
  const span = (Date.parse(points.at(-1)!.day) - Date.parse(points[0]!.day)) / 86_400_000;

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label={t("Legend")}>
        {classes.map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <Swatch color={CLASS_COLOR[c]!} /> {CLASS_LABEL[c]}
          </li>
        ))}
        {showInvested && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-ink-2" /> {t("Invested")}
          </li>
        )}
      </ul>
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis
              dataKey="day"
              tickFormatter={tickDate(span)}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
              minTickGap={36}
            />
            <YAxis
              tickFormatter={compact}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <div className="min-w-48 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                    <div className="text-ink-2">{date(p.day)}</div>
                    <div className="tabular mb-1 mt-0.5 text-sm font-medium text-ink">{eur(p.total)}</div>
                    {[...classes].reverse().map((c) =>
                      p[c] ? (
                        <div key={c} className="flex items-center gap-1.5">
                          <Swatch color={CLASS_COLOR[c]!} />
                          <span className="text-ink-2">{CLASS_LABEL[c]}</span>
                          <span className="tabular ml-auto pl-3 text-ink">{eur(p[c], { decimals: 0 })}</span>
                        </div>
                      ) : null,
                    )}
                    {showInvested && (
                      <div className="mt-1 flex border-t border-line pt-1 text-ink-2">
                        {t("Invested")} <span className="tabular ml-auto pl-3">{eur(p.invested, { decimals: 0 })}</span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {classes.map((c) => (
              <Area
                key={c}
                type="monotone"
                dataKey={c}
                stackId="nw"
                fill={CLASS_COLOR[c]}
                fillOpacity={0.85}
                // A thin surface-coloured edge separates stacked bands.
                stroke="var(--surface)"
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ))}
            {showInvested && (
              <Line
                type="monotone"
                dataKey="invested"
                stroke="var(--ink-2)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
