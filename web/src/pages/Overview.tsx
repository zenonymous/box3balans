import { useState } from "react";
import { Link } from "react-router";
import { AllocationBar } from "../charts/AllocationBar";
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

  const slices = CLASS_ORDER.map((c) => ({
    key: c,
    label: CLASS_LABEL[c]!,
    value: Number(summary.byClass[c]),
    color: CLASS_COLOR[c]!,
  }));

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
        <Card title="Allocation by asset class" className="lg:col-span-2">
          <AllocationBar slices={slices} />
        </Card>
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
        <Card title="By account" className="lg:col-span-2" padded={false}>
          <ul className="divide-y divide-line">
            {summary.byAccount.map((a) => (
              <li key={a.accountId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <div className="text-ink">{a.name}</div>
                  <div className="text-xs capitalize text-muted">{a.kind}</div>
                </div>
                <div className="tabular text-ink">{eur(a.valueEur)}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
