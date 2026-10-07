import { useState } from "react";
import { post, type RefreshStatus } from "../api";
import { relativeTime } from "../format";
import { useDemo, useInvalidateAll, usePriceStatus } from "../queries";
import { Button } from "./ui";
import { t } from "../i18n";

export function RefreshButton() {
  const demo = useDemo();
  const status = usePriceStatus();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const s = status.data?.status;

  const refresh = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await post<RefreshStatus>("/api/prices/refresh");
      await invalidate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The demo's prices are made up and stay that way.
  if (demo) return <span className="text-xs text-muted">{t("Example prices")}</span>;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted" title={s?.at}>
        {error ? (
          <span className="text-loss">{error}</span>
        ) : status.isLoading ? (
          ""
        ) : s?.at ? (
          t("Prices updated {time}", { time: relativeTime(s.at) })
        ) : (
          t("Prices not refreshed yet")
        )}
      </span>
      <Button size="sm" onClick={refresh} disabled={busy}>
        {busy ? t("Refreshing…") : `↻ ${t("Refresh")}`}
      </Button>
    </div>
  );
}
