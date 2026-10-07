import { useState } from "react";
import { Link } from "react-router";
import { post } from "../api";
import { Button, Card, Empty, PageHeader, Spinner, cx } from "../components/ui";
import { useAttention, type Issue } from "../queries";
import { t, tn } from "../i18n";

const SEVERITY: Record<Issue["severity"], { label: string; icon: string; tone: string }> = {
  problem: { label: t("Problems"), icon: "⛔", tone: "text-loss" },
  warning: { label: t("Warnings"), icon: "⚠", tone: "text-warn" },
  info: { label: t("Worth a look"), icon: "ⓘ", tone: "text-ink-2" },
};

export function AttentionPage() {
  const attention = useAttention();
  const [showDismissed, setShowDismissed] = useState(false);
  if (attention.isLoading) return <Spinner />;
  const all = attention.data ?? [];
  const shown = all.filter((i) => showDismissed || !i.dismissed);
  const dismissedCount = all.filter((i) => i.dismissed).length;

  const dismiss = async (i: Issue) => {
    await post("/api/attention/dismiss", { key: i.key, fingerprint: i.fingerprint });
    await attention.refetch();
  };

  return (
    <>
      <PageHeader
        title={t("Needs attention")}
        subtitle={t("Failed syncs, missing prices, backups and data that looks off, in one place.")}
        actions={
          dismissedCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} />
              {t("Show dismissed ({n})", { n: dismissedCount })}
            </label>
          )
        }
      />
      {shown.length === 0 ? (
        <Card>
          <Empty title={t("All good ✓")}>{t("Nothing needs your attention right now.")}</Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {(["problem", "warning", "info"] as const).map((sev) => {
            const items = shown.filter((i) => i.severity === sev);
            if (!items.length) return null;
            return (
              <Card key={sev} title={`${SEVERITY[sev].label} (${items.length})`} padded={false}>
                <ul className="divide-y divide-line">
                  {items.map((i) => (
                    <li key={i.key} className={cx("flex gap-3 px-4 py-3 text-sm", i.dismissed && "opacity-60")}>
                      <span aria-hidden className={cx("mt-0.5 w-4 shrink-0 text-center", SEVERITY[sev].tone)}>
                        {SEVERITY[sev].icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink">{i.title}</div>
                        {i.detail && <div className="mt-0.5 text-ink-2">{i.detail}</div>}
                      </div>
                      <div className="flex shrink-0 items-start gap-2">
                        {i.link && (
                          <Link
                            to={i.link.to}
                            className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
                          >
                            {i.link.label} →
                          </Link>
                        )}
                        {i.dismissible && !i.dismissed && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void dismiss(i)}
                            title={t("Hide until it changes")}
                          >
                            {t("Dismiss")}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Sidebar / top-of-page link shown while problems or warnings are open. */
export function AttentionBadge({ className }: { className?: string }) {
  const attention = useAttention();
  const open = (attention.data ?? []).filter((i) => !i.dismissed && i.severity !== "info");
  if (!open.length) return null;
  const problem = open.some((i) => i.severity === "problem");
  return (
    <Link
      to="/attention"
      className={cx(
        "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium",
        problem ? "bg-danger-bg text-loss" : "bg-warn-bg text-warn",
        className,
      )}
    >
      <span aria-hidden>{problem ? "⛔" : "⚠"}</span>
      {tn(open.length, "{n} needs attention", "{n} need attention")}
    </Link>
  );
}
