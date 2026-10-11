import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, type StatementCheck as Check, type StatementRow } from "../api";
import { date, eurPrice, num } from "../format";
import { useInvalidateAll } from "../queries";
import { Alert, Button, Card, Spinner } from "./ui";
import { t, tn } from "../i18n";

export const statementKey = (accountId: number) => ["statement", accountId];

// Positions in units, cash as money.
const shown = (r: StatementRow, v: string) => (r.isin ? num(v) : eurPrice(v, r.currency));

/**
 * A broker's statement of positions on a day (DEGIRO's portfolio export) next to what the account's
 * transactions add up to, with a one-click adjustment on that day for each difference.
 */
export function StatementCheckCard({ accountId, accountName }: { accountId: number; accountName: string }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<string>();
  const check = useQuery({
    queryKey: statementKey(accountId),
    queryFn: () => get<Check | null>(`/api/import/statement/${accountId}`),
  });

  const adjust = async (c: Check, r: StatementRow) => {
    const diff = Number(r.difference);
    const p = {
      amount: shown(r, String(Math.abs(diff))),
      name: r.isin ? r.name : "",
      account: accountName,
      date: date(c.day),
    };
    if (
      !confirm(
        (diff > 0
          ? t("Record a deposit of {amount} {name} in {account} on {date}, so it matches the statement?", p)
          : t("Record a withdrawal of {amount} {name} in {account} on {date}, so it matches the statement?", p)
        ).replace(/ {2,}/g, " "),
      )
    )
      return;
    setError(undefined);
    try {
      await post("/api/transactions", {
        accountId,
        assetId: r.assetId,
        type: diff > 0 ? "deposit" : "withdrawal",
        occurredAt: new Date(`${c.day}T12:00:00`).toISOString(),
        quantity: r.difference.replace("-", ""),
        price: r.price ?? "0",
        currency: r.currency,
        notes: t("Balance adjustment to match the statement of {date}", { date: date(c.day) }),
      });
      await invalidate();
      await qc.invalidateQueries({ queryKey: statementKey(accountId) });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (check.isLoading) return <Spinner />;
  const c = check.data;
  if (!c) return null;
  return (
    <Card
      title={
        c.differences
          ? tn(
              c.differences,
              "{account}: {n} difference with the statement of {date}",
              "{account}: {n} differences with the statement of {date}",
              { account: accountName, date: date(c.day) },
            )
          : t("{account}: everything matches the statement of {date}", { account: accountName, date: date(c.day) })
      }
      padded={false}
    >
      {c.differences > 0 && (
        <p className="border-b border-line px-4 py-2.5 text-sm text-ink-2">
          {t("Usually history that is missing from the transactions. Import it, or record an adjustment on that day.")}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-xs text-ink-2">
              <th className="px-4 py-2 text-left font-medium">{t("Position")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("Statement says")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("Transactions say")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("Difference")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {c.rows.map((r) => {
              const off = Number(r.difference) !== 0;
              return (
                <tr key={`${r.assetId ?? r.isin}`}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-ink">{r.name}</div>
                    <div className="text-xs text-muted">{r.isin ?? r.currency}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{shown(r, r.reported)}</td>
                  <td className="px-3 py-2 text-right">{shown(r, r.computed)}</td>
                  <td className={off ? "px-3 py-2 text-right text-warn" : "px-3 py-2 text-right text-muted"}>
                    {off ? `${Number(r.difference) > 0 ? "+" : ""}${shown(r, r.difference)}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!off ? (
                      <span className="text-xs text-gain">✓</span>
                    ) : r.assetId == null ? (
                      <span className="text-xs text-ink-2">{t("No transactions yet: import them first")}</span>
                    ) : (
                      <Button size="sm" onClick={() => void adjust(c, r)}>
                        {t("Adjust")}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && (
        <div className="p-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Card>
  );
}
