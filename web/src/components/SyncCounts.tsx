import { t } from "../i18n";

/**
 * What the last sync of a connection or a wallet did, as terms of the <dl> it sits in. Coin swaps
 * only come from exchanges.
 */
export function SyncCounts({
  r,
}: {
  r: { fetched: number; inserted: number; transfersMatched: number; revalued?: number; swaps?: number };
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
