import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { post, type Mismatch } from "../api";
import { num, todayIso } from "../format";
import { useAssets, useInvalidateAll } from "../queries";
import { Alert, Button } from "./ui";

/** Balances that don't add up, with a one-click adjustment transaction per row. */
export function Mismatches({
  accountId,
  accountName,
  rows,
  source,
  refreshKey,
}: {
  accountId: number;
  accountName: string;
  rows: Mismatch[];
  source: "exchange" | "blockchain";
  refreshKey: string;
}) {
  const assets = useAssets();
  const invalidate = useInvalidateAll();
  const qc = useQueryClient();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<Set<number>>(new Set());

  const adjust = async (m: Mismatch) => {
    const asset = assets.data?.find((a) => a.id === m.assetId);
    const diff = Number(m.difference);
    if (
      !asset ||
      !confirm(
        `Record a ${diff > 0 ? "deposit" : "withdrawal"} of ${num(Math.abs(diff))} ${m.symbol} in ${accountName} so it matches the ${source}?`,
      )
    )
      return;
    try {
      const cash = asset.assetClass === "cash";
      await post("/api/transactions", {
        accountId: accountId,
        assetId: m.assetId,
        type: diff > 0 ? "deposit" : "withdrawal",
        occurredAt: new Date(`${todayIso()}T12:00:00`).toISOString(),
        quantity: m.difference.replace("-", ""),
        price: cash ? "1" : "0",
        currency: cash ? asset.currency : "EUR",
        notes: `Balance adjustment to match ${accountName}${diff > 0 && !cash ? " (cost basis unknown)" : ""}`,
      });
      setDone((s) => new Set(s).add(m.assetId));
      await invalidate();
      await qc.invalidateQueries({ queryKey: [refreshKey] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="rounded-lg border border-line">
      <div className="border-b border-line px-3 py-2 text-xs text-ink-2">
        <span aria-hidden>⚠</span> These balances differ from what the imported transactions add up to.{" "}
        {source === "exchange"
          ? " Usually history the API doesn’t expose (very old trades, internal moves)."
          : " Usually staked or locked funds, or activity the explorer doesn’t report."}{" "}
        Fix the history, or record an adjustment.
      </div>
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-xs text-ink-2">
              <th className="px-3 py-1.5 text-left font-medium">Asset</th>
              <th className="px-3 py-1.5 text-right font-medium">
                {source === "exchange" ? "Exchange says" : "Blockchain says"}
              </th>
              <th className="px-3 py-1.5 text-right font-medium">Transactions say</th>
              <th className="px-3 py-1.5 text-right font-medium">Difference</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((m) => (
              <tr key={m.assetId}>
                <td className="px-3 py-1.5 font-medium">{m.symbol}</td>
                <td className="px-3 py-1.5 text-right">{num(m.reported)}</td>
                <td className="px-3 py-1.5 text-right">{num(m.computed)}</td>
                <td className="px-3 py-1.5 text-right">
                  {Number(m.difference) > 0 ? "+" : ""}
                  {num(m.difference)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {done.has(m.assetId) ? (
                    <span className="text-xs text-gain">✓ adjusted</span>
                  ) : (
                    <Button size="sm" onClick={() => adjust(m)}>
                      Adjust
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <div className="p-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </div>
  );
}
