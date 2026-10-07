import { Fragment, useMemo, useState } from "react";
import type { Holding } from "../api";
import { RefreshButton } from "../components/RefreshButton";
import { Alert, Badge, Card, Delta, Empty, Input, PageHeader, Select, Spinner } from "../components/ui";
import { CLASS_COLOR, CLASS_LABEL, CLASS_ORDER, eur, eurPrice, num, pct, relativeTime } from "../format";
import { usePortfolio } from "../queries";
import { t, tn } from "../i18n";

type SortKey = "name" | "valueEur" | "unrealizedEur" | "unrealizedPct" | "changePct24h" | "weightPct";

const COLS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: t("Asset") },
  { key: "valueEur", label: t("Value"), numeric: true },
  { key: "changePct24h", label: t("24h"), numeric: true },
  { key: "unrealizedEur", label: t("Unrealized"), numeric: true },
  { key: "weightPct", label: t("Weight"), numeric: true },
];

const qtyLabel = (h: Holding) => (h.unit === "g" ? `${num(h.quantity, 2)} g` : num(h.quantity));

export function HoldingsPage() {
  const portfolio = usePortfolio();
  const [cls, setCls] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "valueEur", dir: -1 });
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = portfolio.data?.holdings ?? [];
    const needle = q.trim().toLowerCase();
    return all
      .filter((h) => showClosed || Number(h.quantity) !== 0)
      .filter((h) => cls === "all" || h.assetClass === cls)
      .filter((h) => !needle || h.name.toLowerCase().includes(needle) || h.symbol.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (sort.key === "name") return a.name.localeCompare(b.name) * sort.dir;
        return (Number(a[sort.key] ?? -Infinity) - Number(b[sort.key] ?? -Infinity)) * sort.dir;
      });
  }, [portfolio.data, cls, q, sort, showClosed]);

  if (portfolio.isLoading) return <Spinner />;
  if (portfolio.error) return <Alert tone="danger">{(portfolio.error as Error).message}</Alert>;

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "name" ? 1 : -1 }));

  return (
    <>
      <PageHeader
        title={t("Holdings")}
        subtitle={`${tn(rows.length, "{n} position", "{n} positions")} · ${eur(portfolio.data!.summary.totalEur)}`}
        actions={<RefreshButton />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("Search…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-56"
          aria-label={t("Search holdings")}
        />
        <Select value={cls} onChange={(e) => setCls(e.target.value)} className="max-w-48" aria-label={t("Asset class")}>
          <option value="all">{t("All classes")}</option>
          {CLASS_ORDER.map((c) => (
            <option key={c} value={c}>
              {CLASS_LABEL[c]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />{" "}
          {t("Show closed positions")}
        </label>
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty title={t("No holdings match")} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-2">
                    {COLS.map((c) => (
                      <th key={c.key} className={`px-4 py-2.5 font-medium ${c.numeric ? "text-right" : "text-left"}`}>
                        <button type="button" onClick={() => toggleSort(c.key)} className="hover:text-ink">
                          {c.label}
                          {sort.key === c.key && <span aria-hidden> {sort.dir === 1 ? "↑" : "↓"}</span>}
                        </button>
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-right font-medium">{t("Price / avg cost")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((h) => (
                    <Fragment key={h.key}>
                      <tr
                        className="cursor-pointer hover:bg-surface-2"
                        onClick={() => setExpanded(expanded === h.key ? null : h.key)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="size-2.5 shrink-0 rounded-sm"
                              style={{ background: CLASS_COLOR[h.assetClass] }}
                              aria-hidden
                            />
                            <div className="min-w-0">
                              <div className="font-medium text-ink">
                                {h.name} {h.priceStale && <Badge tone="warn">{t("stale price")}</Badge>}
                              </div>
                              <div className="text-xs text-muted">
                                {h.symbol} · {qtyLabel(h)} · {CLASS_LABEL[h.assetClass]}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="tabular px-4 py-2.5 text-right text-ink">{eur(h.valueEur)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {h.changePct24h != null ? (
                            <Delta percent={h.changePct24h} />
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {h.assetClass === "cash" ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <Delta value={h.unrealizedEur} percent={h.unrealizedPct} />
                          )}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right text-ink-2">
                          {pct(h.weightPct, { sign: false })}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right text-xs text-ink-2">
                          <div>
                            {eurPrice(h.priceEur)}
                            {h.unit === "g" ? "/g" : ""}
                          </div>
                          <div className="text-muted">
                            {h.avgCostEur ? t("avg {price}", { price: eurPrice(h.avgCostEur) }) : ""}
                          </div>
                        </td>
                      </tr>
                      {expanded === h.key && <Detail h={h} colSpan={6} />}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-line md:hidden">
              {rows.map((h) => (
                <li key={h.key} className="px-4 py-3" onClick={() => setExpanded(expanded === h.key ? null : h.key)}>
                  <div className="flex items-start gap-2.5">
                    <span
                      className="mt-1.5 size-2.5 shrink-0 rounded-sm"
                      style={{ background: CLASS_COLOR[h.assetClass] }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{h.name}</div>
                      <div className="text-xs text-muted">
                        {h.symbol} · {qtyLabel(h)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-ink">{eur(h.valueEur)}</div>
                      <div className="text-xs">
                        {h.assetClass === "cash" ? null : <Delta value={h.unrealizedEur} percent={h.unrealizedPct} />}
                      </div>
                    </div>
                  </div>
                  {expanded === h.key && <MobileDetail h={h} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}

function Detail({ h, colSpan }: { h: Holding; colSpan: number }) {
  return (
    <tr className="bg-surface-2/50">
      <td colSpan={colSpan} className="px-4 py-3">
        <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-[1fr_auto]">
          <table className="w-full">
            <thead>
              <tr className="text-muted">
                <th className="py-1 text-left font-medium">{t("Account / location")}</th>
                <th className="py-1 text-right font-medium">{t("Quantity")}</th>
                <th className="py-1 text-right font-medium">{t("Cost")}</th>
                <th className="py-1 text-right font-medium">{t("Value")}</th>
              </tr>
            </thead>
            <tbody>
              {h.accounts.map((a) => (
                <tr key={a.accountId}>
                  <td className="py-1 text-ink">{a.accountName}</td>
                  <td className="tabular py-1 text-right text-ink-2">{num(a.quantity)}</td>
                  <td className="tabular py-1 text-right text-ink-2">{eur(a.costEur)}</td>
                  <td className="tabular py-1 text-right text-ink">{eur(a.valueEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:min-w-56">
            <dt className="text-muted">{t("Cost basis")}</dt>
            <dd className="tabular text-right">{eur(h.costEur)}</dd>
            <dt className="text-muted">{t("Realized")}</dt>
            <dd className="text-right">
              <Delta value={h.realizedEur} />
            </dd>
            <dt className="text-muted">{t("Income")}</dt>
            <dd className="tabular text-right">{eur(h.incomeEur)}</dd>
            <dt className="text-muted">{t("Fees paid")}</dt>
            <dd className="tabular text-right">{eur(h.feesEur)}</dd>
            {h.fxEffectEur && (
              <>
                <dt
                  className="text-muted"
                  title={t("Open gain split: price movement (at the {currency} rate you paid) and currency movement", {
                    currency: h.localCurrency ?? "",
                  })}
                >
                  {t("From price")}
                </dt>
                <dd className="text-right">
                  <Delta value={h.priceEffectEur} />
                </dd>
                <dt className="text-muted">{t("From {currency}", { currency: h.localCurrency ?? "" })}</dt>
                <dd className="text-right">
                  <Delta value={h.fxEffectEur} />
                </dd>
              </>
            )}
            <dt className="text-muted">{t("Price updated")}</dt>
            <dd className="text-right">{relativeTime(h.priceFetchedAt)}</dd>
          </dl>
        </div>
      </td>
    </tr>
  );
}

function MobileDetail({ h }: { h: Holding }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-surface-2 p-3 text-xs">
      <dt className="text-muted">{t("Price")}</dt>
      <dd className="tabular text-right">{eurPrice(h.priceEur)}</dd>
      <dt className="text-muted">{t("Avg cost")}</dt>
      <dd className="tabular text-right">{eurPrice(h.avgCostEur)}</dd>
      <dt className="text-muted">{t("24h")}</dt>
      <dd className="text-right">{h.changePct24h != null ? <Delta percent={h.changePct24h} /> : "—"}</dd>
      <dt className="text-muted">{t("Realized")}</dt>
      <dd className="text-right">
        <Delta value={h.realizedEur} />
      </dd>
      {h.accounts.map((a) => (
        <Fragment key={a.accountId}>
          <dt className="truncate text-muted">{a.accountName}</dt>
          <dd className="tabular text-right">{eur(a.valueEur)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
