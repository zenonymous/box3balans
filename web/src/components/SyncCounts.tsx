import type { SyncResult } from "../api";
import { t } from "../i18n";

/**
 * What the last sync of a connection or a wallet did, as terms of the <dl> it sits in. Coin swaps
 * only come from exchanges: a wallet's sync result never has them.
 */
export function SyncCounts({
  result: r,
}: {
  result: Pick<SyncResult, "fetched" | "inserted" | "transfersMatched" | "revalued" | "swaps">;
}) {
  return (
    <>
      <dt className="text-ink-2">{t("Imported")}</dt>
      <dd>
        {t("{n} new", { n: r.inserted })} <span className="text-muted">{t("of {total}", { total: r.fetched })}</span>
      </dd>
      <dt className="text-ink-2">{t("Transfers linked")}</dt>
      <dd>{r.transfersMatched}</dd>
      {!!r.revalued && (
        <>
          <dt className="text-ink-2">{t("Valued after all")}</dt>
          <dd title={t("Rewards and deposits that were booked at €0 because no price was known yet")}>{r.revalued}</dd>
        </>
      )}
      {!!r.swaps && (
        <>
          <dt className="text-ink-2">{t("Coin swaps booked")}</dt>
          <dd title={t("A coin the exchange swapped for another, booked as a sale and a purchase at the same value")}>
            {r.swaps}
          </dd>
        </>
      )}
    </>
  );
}
