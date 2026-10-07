import { useState } from "react";
import { Link } from "react-router";
import { AllocationBar } from "../charts/AllocationBar";
import { RankedBars, type RankedRow } from "../charts/RankedBars";
import type { Holding, Summary } from "../api";
import { NetWorthChart } from "../charts/NetWorthChart";
import { RefreshButton } from "../components/RefreshButton";
import { Alert, Card, Delta, Empty, PageHeader, Spinner, Stat, Tabs } from "../components/ui";
import { CLASS_COLOR, CLASS_LABEL, CLASS_ORDER, eur, pct } from "../format";
import { useHistory, usePortfolio, usePriceStatus, type HistoryRange } from "../queries";
import { t, tj, tn } from "../i18n";
import { kindLabel } from "../labels";

const RANGES: HistoryRange[] = ["1M", "3M", "1Y", "5Y", "ALL"];
// "1M" → "1M" / "1 mnd"; ALL → "All" / "Alles".
const rangeLabel = (r: HistoryRange) =>
  ({ "1M": t("1M"), "3M": t("3M"), "1Y": t("1Y"), "5Y": t("5Y"), ALL: t("All") })[r];

function loadInvested(): boolean {
  try {
    return localStorage.getItem("showInvested") !== "false";
  } catch {
    return true;
  }
}

export function OverviewPage() {
  const portfolio = usePortfolio();
  const status = usePriceStatus();
  const [range, setRange] = useState<HistoryRange>("1Y");
  const [showInvested, setShowInvested] = useState(loadInvested);
  const history = useHistory(range);
  const toggleInvested = (v: boolean) => {
    setShowInvested(v);
    try {
      localStorage.setItem("showInvested", String(v));
    } catch {}
  };

  if (portfolio.isLoading) return <Spinner />;
  if (portfolio.error) return <Alert tone="danger">{(portfolio.error as Error).message}</Alert>;
  const { summary, holdings } = portfolio.data!;
  const failed = status.data?.status?.failed ?? [];

  if (holdings.length === 0) {
    return (
      <>
        <PageHeader title={t("Overview")} />
        <Card>
          <Empty title={t("Nothing here yet")}>
            <p>
              {tj(
                "New here? <0>Get started</0>: your household, your accounts and a first box 3 estimate in a few steps.",
                [<Link key="s" className="text-accent underline" to="/start" />],
              )}
            </p>
            <p className="mt-2">
              {tj("Or go your own way: add <0>accounts</0>, record <1>transactions</1> or add <2>physical metal</2>.", [
                <Link key="a" className="text-accent underline" to="/accounts" />,
                <Link key="t" className="text-accent underline" to="/transactions" />,
                <Link key="m" className="text-accent underline" to="/metals" />,
              ])}
            </p>
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("Overview")} actions={<RefreshButton />} />

      <div className="mb-4 flex flex-col gap-2">
        {summary.missingPrices.length > 0 && (
          <Alert>
            {t("No price yet for: {list}. These are valued at €0.", { list: summary.missingPrices.join(", ") })}
          </Alert>
        )}
        {failed.length > 0 && (
          <Alert>
            {t("The last refresh could not update {list}; showing the previous price.", {
              list: failed.map((f) => f.symbol).join(", "),
            })}
          </Alert>
        )}
        {summary.warnings.map((w) => (
          <Alert key={w}>{w}</Alert>
        ))}
      </div>

      <section className="mb-6">
        <div className="text-sm text-ink-2">{t("Net worth")}</div>
        <div className="mt-1 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{eur(summary.totalEur)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span>
            <Delta value={summary.dayChangeEur} percent={summary.dayChangePct} />{" "}
            <span className="text-muted">{t("today")}</span>
          </span>
          {summary.periodChanges.map((p) => (
            <span key={p.period} title={t("Net worth change since {day}, including deposits", { day: p.fromDay })}>
              <Delta percent={p.changePct} /> <span className="text-muted">{p.period}</span>
            </span>
          ))}
          <span className="ml-auto flex gap-3 text-xs">
            <Link to="/performance" className="text-accent">
              {t("Performance")} →
            </Link>
            <Link to="/income" className="text-accent">
              {t("Income")} →
            </Link>
          </span>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("Invested (cost basis)")}
          value={eur(summary.costEur, { decimals: 0 })}
          sub={<span className="text-muted">{t("excl. cash")}</span>}
        />
        <Stat
          label={t("Unrealized P&L")}
          value={<Delta value={summary.unrealizedEur} />}
          sub={
            <span className="text-muted">
              {t("{pct} on cost", {
                pct: Number(summary.costEur)
                  ? pct((Number(summary.unrealizedEur) / Number(summary.costEur)) * 100)
                  : "—",
              })}
            </span>
          }
        />
        <Stat
          label={t("Realized P&L")}
          value={<Delta value={summary.realizedEur} />}
          sub={<span className="text-muted">{t("all time")}</span>}
        />
        <Stat
          label={t("Dividends and rewards")}
          value={eur(summary.incomeEur)}
          sub={<span className="text-muted">{t("all time, net")}</span>}
        />
      </div>

      <Card
        title={t("Net worth over time")}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={showInvested} onChange={(e) => toggleInvested(e.target.checked)} />{" "}
              {t("Invested")}
            </label>
            <Tabs value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: rangeLabel(r) }))} />
          </div>
        }
      >
        {history.isLoading ? (
          <Spinner />
        ) : (
          <NetWorthChart points={history.data?.points ?? []} showInvested={showInvested} />
        )}
        {history.data && history.data.estimated.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {t("No price history yet for {list}; valued at cost where missing. History loads in the background.", {
              list: history.data.estimated.map((e) => e.symbol).join(", "),
            })}
          </p>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <AllocationCard summary={summary} holdings={holdings} />
        <Card
          title={t("Top holdings")}
          className="lg:col-span-3"
          padded={false}
          actions={
            <Link to="/holdings" className="text-xs text-accent">
              {t("All holdings")} →
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {holdings.slice(0, 8).map((h) => (
              <li key={h.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: CLASS_COLOR[h.assetClass] }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{h.name}</div>
                  <div className="text-xs text-muted">
                    {h.symbol} · {pct(h.weightPct, { sign: false })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tabular text-ink">{eur(h.valueEur)}</div>
                  <div className="text-xs">
                    {h.changePct24h != null ? (
                      <Delta percent={h.changePct24h} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

type AllocationView = "class" | "asset" | "account";
const TOP_ASSETS = 10;

const classSegments = (byClass: Map<string, number>) =>
  CLASS_ORDER.filter((c) => (byClass.get(c) ?? 0) > 0).map((c) => ({
    key: c,
    label: CLASS_LABEL[c]!,
    value: byClass.get(c)!,
    color: CLASS_COLOR[c]!,
  }));

/** Allocation by asset class, by individual holding, or by account (each split by asset class). */
function AllocationCard({ summary, holdings }: { summary: Summary; holdings: Holding[] }) {
  const [view, setView] = useState<AllocationView>("class");
  const slices = CLASS_ORDER.map((c) => ({
    key: c,
    label: CLASS_LABEL[c]!,
    value: Number(summary.byClass[c]),
    color: CLASS_COLOR[c]!,
  }));
  const legend = slices.filter((s) => s.value > 0).map((s) => ({ label: s.label, color: s.color }));

  let rows: RankedRow[] = [];
  if (view === "asset") {
    const sorted = holdings
      .filter((h) => Number(h.valueEur) > 0)
      .sort((a, b) => Number(b.valueEur) - Number(a.valueEur));
    rows = sorted.slice(0, TOP_ASSETS).map((h) => ({
      key: h.key,
      label: h.name,
      sub: h.symbol,
      value: Number(h.valueEur),
      segments: classSegments(new Map([[h.assetClass, Number(h.valueEur)]])),
    }));
    const rest = sorted.slice(TOP_ASSETS);
    if (rest.length) {
      const byClass = new Map<string, number>();
      for (const h of rest) byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + Number(h.valueEur));
      rows.push({
        key: "other",
        label: tn(rest.length, "{n} other holding", "{n} other holdings"),
        value: rest.reduce((a, h) => a + Number(h.valueEur), 0),
        segments: classSegments(byClass),
      });
    }
  } else if (view === "account") {
    const kind = new Map(summary.byAccount.map((a) => [a.accountId, a.kind]));
    const accounts = new Map<number, { name: string; byClass: Map<string, number> }>();
    for (const h of holdings) {
      for (const a of h.accounts) {
        const acc = accounts.get(a.accountId) ?? { name: a.accountName, byClass: new Map() };
        acc.byClass.set(h.assetClass, (acc.byClass.get(h.assetClass) ?? 0) + Number(a.valueEur));
        accounts.set(a.accountId, acc);
      }
    }
    rows = [...accounts.entries()]
      .map(([id, a]) => ({
        key: String(id),
        label: a.name,
        sub: kindLabel(kind.get(id) ?? "other"),
        value: [...a.byClass.values()].reduce((x, y) => x + y, 0),
        segments: classSegments(a.byClass),
      }))
      .sort((a, b) => b.value - a.value);
  }

  return (
    <Card
      title={t("Allocation")}
      className="lg:col-span-2"
      actions={
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "class", label: t("Class") },
            { value: "asset", label: t("Asset") },
            { value: "account", label: t("Account") },
          ]}
        />
      }
    >
      {view === "class" ? <AllocationBar slices={slices} /> : <RankedBars rows={rows} legend={legend} />}
    </Card>
  );
}
