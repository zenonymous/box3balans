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

const RANGES: HistoryRange[] = ["1M", "3M", "1Y", "5Y", "ALL"];

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
        <PageHeader title="Overview" />
        <Card>
          <Empty title="Your portfolio is empty">
            Start by adding an{" "}
            <Link className="text-accent underline" to="/accounts">
              account
            </Link>{" "}
            (broker, exchange, vault or home safe), then record{" "}
            <Link className="text-accent underline" to="/transactions">
              transactions
            </Link>{" "}
            or add{" "}
            <Link className="text-accent underline" to="/metals">
              physical metal
            </Link>
            .
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Overview" actions={<RefreshButton />} />

      <div className="mb-4 flex flex-col gap-2">
        {summary.missingPrices.length > 0 && (
          <Alert>No price yet for: {summary.missingPrices.join(", ")}. These are valued at €0.</Alert>
        )}
        {failed.length > 0 && (
          <Alert>
            Last refresh could not update {failed.map((f) => f.symbol).join(", ")}; showing the previous price.
          </Alert>
        )}
        {summary.warnings.map((w) => (
          <Alert key={w}>{w}</Alert>
        ))}
      </div>

      <section className="mb-6">
        <div className="text-sm text-ink-2">Net worth</div>
        <div className="mt-1 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{eur(summary.totalEur)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span>
            <Delta value={summary.dayChangeEur} percent={summary.dayChangePct} />{" "}
            <span className="text-muted">today</span>
          </span>
          {summary.periodChanges.map((p) => (
            <span key={p.period} title={`Net worth change since ${p.fromDay}, including deposits`}>
              <Delta percent={p.changePct} /> <span className="text-muted">{p.period}</span>
            </span>
          ))}
          <span className="ml-auto flex gap-3 text-xs">
            <Link to="/performance" className="text-accent">
              Performance →
            </Link>
            <Link to="/income" className="text-accent">
              Income →
            </Link>
          </span>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Invested (cost basis)"
          value={eur(summary.costEur, { decimals: 0 })}
          sub={<span className="text-muted">excl. cash</span>}
        />
        <Stat
          label="Unrealized P&L"
          value={<Delta value={summary.unrealizedEur} />}
          sub={
            <span className="text-muted">
              {Number(summary.costEur) ? pct((Number(summary.unrealizedEur) / Number(summary.costEur)) * 100) : "—"} on
              cost
            </span>
          }
        />
        <Stat
          label="Realized P&L"
          value={<Delta value={summary.realizedEur} />}
          sub={<span className="text-muted">all time</span>}
        />
        <Stat
          label="Dividends & rewards"
          value={eur(summary.incomeEur)}
          sub={<span className="text-muted">all time, net</span>}
        />
      </div>

      <Card
        title="Net worth over time"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={showInvested} onChange={(e) => toggleInvested(e.target.checked)} />{" "}
              Invested
            </label>
            <Tabs value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: r }))} />
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
            No price history yet for {history.data.estimated.map((e) => e.symbol).join(", ")}; valued at cost where
            missing. History loads in the background.
          </p>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <AllocationCard summary={summary} holdings={holdings} />
        <Card
          title="Top holdings"
          className="lg:col-span-3"
          padded={false}
          actions={
            <Link to="/holdings" className="text-xs text-accent">
              All holdings →
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
        label: `${rest.length} other holding${rest.length === 1 ? "" : "s"}`,
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
        sub: kind.get(id),
        value: [...a.byClass.values()].reduce((x, y) => x + y, 0),
        segments: classSegments(a.byClass),
      }))
      .sort((a, b) => b.value - a.value);
  }

  return (
    <Card
      title="Allocation"
      className="lg:col-span-2"
      actions={
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "class", label: "Class" },
            { value: "asset", label: "Asset" },
            { value: "account", label: "Account" },
          ]}
        />
      }
    >
      {view === "class" ? <AllocationBar slices={slices} /> : <RankedBars rows={rows} legend={legend} />}
    </Card>
  );
}
