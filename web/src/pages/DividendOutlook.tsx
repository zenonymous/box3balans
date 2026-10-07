import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get } from "../api";
import { downloadCsv } from "../csv";
import { Button, Card, Empty, Select, Spinner } from "../components/ui";
import { date, eur, getLocale, pct } from "../format";
import { dateLocale, t } from "../i18n";

interface Forecast {
  months: { month: string; grossEur: number; netEur: number }[];
  byAsset: {
    assetId: number;
    symbol: string;
    name: string;
    payments: number;
    nextExDate: string | null;
    grossEur: number;
    netEur: number;
    taxPct: number | null;
    taxSource: "yours" | "default" | "unknown";
  }[];
  totalGrossEur: number;
  totalNetEur: number;
  noDividends: string[];
  failed: string[];
}

interface WithholdingRow {
  year: number;
  country: string;
  payments: number;
  grossEur: number;
  taxEur: number;
  ratePct: number | null;
}

const monthLabel = (m: string) =>
  new Intl.DateTimeFormat(dateLocale(), { month: "short" }).format(new Date(`${m}-01T00:00:00`));
const compact = (v: number) =>
  new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

/** Next 12 months of dividends, by month and by holding. */
export function DividendForecastCard() {
  const f = useQuery({ queryKey: ["dividend-forecast"], queryFn: () => get<Forecast>("/api/dividends/forecast") });
  if (f.isLoading)
    return (
      <Card title={t("Expected dividends, next 12 months")}>
        <Spinner />
      </Card>
    );
  const d = f.data;
  if (!d || d.byAsset.length === 0) {
    return (
      <Card title={t("Expected dividends, next 12 months")}>
        <Empty title={t("No dividends expected")}>
          {d?.noDividends.length
            ? t("{list} paid no dividends in the last year (accumulating).", { list: d.noDividends.join(", ") })
            : t("None of your holdings paid a dividend in the last year.")}
        </Empty>
      </Card>
    );
  }
  const data = d.months.map((m) => ({ ...m, label: monthLabel(m.month) }));
  return (
    <Card
      title={t("Expected dividends, next 12 months")}
      actions={
        <span className="tabular text-sm">
          {eur(d.totalNetEur)}{" "}
          <span className="text-xs text-muted">{t("net · {gross} gross", { gross: eur(d.totalGrossEur) })}</span>
        </span>
      }
    >
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
              interval={0}
            />
            <YAxis
              tickFormatter={compact}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                const m = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !m) return null;
                return (
                  <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                    <div className="text-ink-2">
                      {new Intl.DateTimeFormat(dateLocale(), { month: "long", year: "numeric" }).format(
                        new Date(`${m.month}-01T00:00:00`),
                      )}
                    </div>
                    <div className="tabular mt-0.5 font-medium text-ink">
                      {t("{amount} net", { amount: eur(m.netEur) })}
                    </div>
                    <div className="tabular text-ink-2">{t("{amount} gross", { amount: eur(m.grossEur) })}</div>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="netEur"
              fill="var(--series-1)"
              maxBarSize={32}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-2">
              <th className="py-2 pr-3 text-left font-medium">{t("Holding")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("Next ex-date")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("Gross")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("Tax")}</th>
              <th className="py-2 pl-3 text-right font-medium">{t("Net")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.byAsset.map((a) => (
              <tr key={a.assetId}>
                <td className="py-2 pr-3">
                  <span className="font-medium">{a.symbol}</span>{" "}
                  <span className="text-xs text-muted">{t("{n}× a year", { n: a.payments })}</span>
                </td>
                <td className="px-3 py-2 text-right text-ink-2">{a.nextExDate ? date(a.nextExDate) : "—"}</td>
                <td className="px-3 py-2 text-right">{eur(a.grossEur)}</td>
                <td
                  className="px-3 py-2 text-right text-ink-2"
                  title={
                    a.taxSource === "yours"
                      ? t("What you were withheld on it recently")
                      : a.taxSource === "default"
                        ? t("Usual rate for its country (you have no payments of it yet)")
                        : t("Unknown: no payments yet and no usual rate for its country")
                  }
                >
                  {a.taxPct != null ? pct(a.taxPct, { sign: false }) : "?"}
                  {a.taxSource === "default" && <span className="text-muted">*</span>}
                </td>
                <td className="py-2 pl-3 text-right font-medium">{eur(a.netEur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        {t(
          "Last year's dividends per share, for what you hold now, at today's exchange rates. Dates are ex-dividend dates; payment usually follows a few weeks later. * usual rate for the country, until you've had a payment.",
        )}
        {d.noDividends.length > 0 &&
          ` ${t("No dividends in the last year: {list}.", { list: d.noDividends.join(", ") })}`}
        {d.failed.length > 0 && ` ${t("Couldn't load dividends for {list}.", { list: d.failed.join(", ") })}`}
      </p>
    </Card>
  );
}

const countryName = (code: string) => {
  if (code === "??") return t("Unknown (no ISIN)");
  try {
    return new Intl.DisplayNames([dateLocale()], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

function note(r: WithholdingRow): string {
  if (!r.taxEur) return t("Nothing withheld.");
  if (r.country === "NL")
    return t("Dutch dividend tax: offset in full in your tax return (ingehouden dividendbelasting).");
  if (r.country === "US" && (r.ratePct ?? 0) > 15.5)
    return t("Above the 15% treaty rate: give your broker a W-8BEN form; the extra is hard to reclaim.");
  return t(
    "Foreign tax: offset in your tax return up to the treaty rate (often 15%); more must be reclaimed from that country.",
  );
}

/** Dividends and tax withheld per country and year, for the tax return. */
export function WithholdingCard() {
  const q = useQuery({ queryKey: ["withholding"], queryFn: () => get<WithholdingRow[]>("/api/dividends/withholding") });
  const years = [...new Set((q.data ?? []).map((r) => String(r.year)))];
  const [selected, setSelected] = useState<string | null>(null);
  const year = selected ?? years[0];
  if (q.isLoading) return null;
  if (!q.data?.length) return null;
  const rows = q.data.filter((r) => String(r.year) === year);
  const total = rows.reduce((a, r) => ({ gross: a.gross + r.grossEur, tax: a.tax + r.taxEur }), { gross: 0, tax: 0 });
  return (
    <Card
      title={t("Tax withheld by country")}
      padded={false}
      actions={
        <div className="flex items-center gap-2">
          <Select
            aria-label={t("Year")}
            value={year}
            onChange={(e) => setSelected(e.target.value)}
            className="w-auto py-1 text-xs"
          >
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
          <Button
            size="sm"
            onClick={() =>
              downloadCsv(`dividend-tax-${year}.csv`, rows, [
                { header: t("Country"), value: (r) => r.country },
                { header: t("Payments"), value: (r) => r.payments },
                { header: t("Gross EUR"), value: (r) => r.grossEur.toFixed(2) },
                { header: t("Tax withheld EUR"), value: (r) => r.taxEur.toFixed(2) },
                { header: t("Rate %"), value: (r) => (r.ratePct == null ? "" : r.ratePct.toFixed(2)) },
              ])
            }
          >
            CSV
          </Button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-2">
              <th className="px-3 py-2 text-left font-medium">{t("Country")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("Gross")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("Withheld")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("Rate")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.country} className="align-top">
                <td className="px-3 py-2">
                  {countryName(r.country)} <span className="text-xs text-muted">{r.payments}×</span>
                  <div className="text-xs text-ink-2">{note(r)}</div>
                </td>
                <td className="px-3 py-2 text-right">{eur(r.grossEur)}</td>
                <td className="px-3 py-2 text-right">{eur(r.taxEur)}</td>
                <td
                  className={`px-3 py-2 text-right ${r.country === "US" && (r.ratePct ?? 0) > 15.5 ? "text-warn" : "text-ink-2"}`}
                >
                  {r.ratePct != null ? pct(r.ratePct, { sign: false }) : "—"}
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="px-3 py-2">{t("Total")}</td>
              <td className="px-3 py-2 text-right">{eur(total.gross)}</td>
              <td className="px-3 py-2 text-right">{eur(total.tax)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-xs text-muted">
        {t(
          "Country from each security's ISIN; Irish and Luxembourg funds withhold nothing themselves. An overview to check against your brokers' annual statements, not tax advice.",
        )}
      </p>
    </Card>
  );
}
