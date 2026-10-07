import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { post, type Mismatch } from "../api";
import { num, todayIso } from "../format";
import { useAssets, useInvalidateAll } from "../queries";
import { Alert, Button } from "./ui";
import { t } from "../i18n";

const question = (
  diff: number,
  source: "exchange" | "blockchain",
  p: { amount: string; symbol: string; account: string },
) =>
  diff > 0
    ? source === "exchange"
      ? t("Record a deposit of {amount} {symbol} in {account} so it matches the exchange?", p)
      : t("Record a deposit of {amount} {symbol} in {account} so it matches the blockchain?", p)
    : source === "exchange"
      ? t("Record a withdrawal of {amount} {symbol} in {account} so it matches the exchange?", p)
      : t("Record a withdrawal of {amount} {symbol} in {account} so it matches the blockchain?", p);

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
      !confirm(question(diff, source, { amount: num(Math.abs(diff)), symbol: m.symbol, account: accountName }))
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
        notes:
          diff > 0 && !cash
            ? t("Balance adjustment to match {account} (cost basis unknown)", { account: accountName })
            : t("Balance adjustment to match {account}", { account: accountName }),
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
        <span aria-hidden>⚠</span> {t("These balances differ from what the imported transactions add up to.")}{" "}
        {source === "exchange"
          ? t("Usually history the API doesn't expose (very old trades, internal moves).")
          : t("Usually staked or locked funds, or activity the explorer doesn't report.")}{" "}
        {t("Fix the history, or record an adjustment.")}
      </div>
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-xs text-ink-2">
              <th className="px-3 py-1.5 text-left font-medium">{t("Asset")}</th>
              <th className="px-3 py-1.5 text-right font-medium">
                {source === "exchange" ? t("Exchange says") : t("Blockchain says")}
              </th>
              <th className="px-3 py-1.5 text-right font-medium">{t("Transactions say")}</th>
              <th className="px-3 py-1.5 text-right font-medium">{t("Difference")}</th>
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
                    <span className="text-xs text-gain">✓ {t("adjusted")}</span>
                  ) : (
                    <Button size="sm" onClick={() => adjust(m)}>
                      {t("Adjust")}
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
