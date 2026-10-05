import { useState } from "react";
import { post, type RefreshStatus } from "../api";
import { relativeTime } from "../format";
import { useInvalidateAll, usePriceStatus } from "../queries";
import { Button } from "./ui";

export function RefreshButton() {
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

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted" title={s?.at}>
        {error ? (
          <span className="text-loss">{error}</span>
        ) : status.isLoading ? (
          ""
        ) : (
          `Prices updated ${relativeTime(s?.at)}`
        )}
      </span>
      <Button size="sm" onClick={refresh} disabled={busy}>
        {busy ? "Refreshing…" : "↻ Refresh"}
      </Button>
    </div>
  );
}
