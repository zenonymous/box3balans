import { Fragment } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { get, type Box3Year, type Dossier } from "../api";
import { Alert, Badge, Button, Card, Spinner, Stat } from "../components/ui";
import { date, eur, eurPrice, num } from "../format";
import { t, tn } from "../i18n";
import { categoryLabel, kindLabel, ownerLabel } from "../labels";
import { useHousehold } from "../queries";
import { ActualReturnCard } from "./Box3Actual";
import { CalculationCard } from "./Box3";

const PROVIDER: Record<string, string> = {
  bitvavo: "Bitvavo",
  binance: "Binance",
  coingecko: "CoinGecko",
  yahoo: "Yahoo Finance",
  tradegate: "Tradegate",
  "gold-api": "gold-api.com",
  metal: "gold-api.com",
  ecb: "ECB",
  fx: "ECB",
  kraken: "Kraken",
  coinbase: "Coinbase",
  ibkr: "Interactive Brokers",
};

/**
 * A recorded price source in words: "bitvavo:BTC-EUR" → "Bitvavo BTC-EUR", a coin valued through its
 * successor ("bitvavo:T-EUR×3.259242", "migration:T×3.259242") with the rate.
 */
function sourceLabel(source: string): string {
  if (source === "manual") return t("entered by you");
  const [provider = "", ...rest] = source.split(":");
  const [ref, ratio] = rest.join(":").split("×");
  if (provider === "migration") return t("{ratio} × {symbol}", { ratio: num(ratio ?? "1", 8), symbol: ref ?? "" });
  const name = PROVIDER[provider] ?? provider;
  const what = ref ? `${name} ${ref}` : name;
  return ratio ? `${what} × ${num(ratio, 8)}` : what;
}

/** The source shown for a holding's price; a feed (marked *) when the close has none recorded. */
function priceSource(p: Dossier["prices"][number] | undefined): string {
  if (!p) return "—";
  const what = p.source ?? p.feed;
  // A euro is a euro; other money is always at the ECB rate, recorded or not.
  if (!what || what === "fx:EUR" || what === "ecb:EUR") return "—";
  if (what.startsWith("fx:") || what.startsWith("ecb:")) return sourceLabel(`ecb:${what.split(":")[1]}`);
  return p.source ? sourceLabel(p.source) : `${sourceLabel(what)} *`;
}

const short = (address: string) => (address.length > 20 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address);

/**
 * One printable document per year: the box 3 overview and calculation, the actual return, and per
 * account where every amount comes from (a connection, a wallet, a CSV import, entries by hand, a
 * bank export), with for each price its date and source. For your own records, and for questions
 * from the Belastingdienst.
 */
export function DossierPage() {
  const year = Number(useParams().year);
  const people = useHousehold();
  const box3 = useQuery({ queryKey: ["box3", year], queryFn: () => get<Box3Year>(`/api/box3/${year}`) });
  const dossier = useQuery({
    queryKey: ["box3", year, "dossier"],
    queryFn: () => get<Dossier>(`/api/box3/${year}/dossier`),
  });

  if (box3.isLoading || dossier.isLoading) return <Spinner />;
  const error = box3.error ?? dossier.error;
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  const y = box3.data!;
  const d = dossier.data!;
  const persons = people.data ?? [];
  const names = persons
    .filter((p) => p.role !== "child")
    .map((p) => p.name)
    .join(" & ");
  const priceOf = new Map(d.prices.map((p) => [`${p.assetId}:${p.day}`, p]));
  const unrecorded = d.prices.some((p) => priceSource(p).endsWith("*"));

  const byAccount = new Map<number, Box3Year["rows"]>();
  for (const row of y.rows) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 text-ink">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={`/box3?year=${year}`} className="text-sm text-accent">
          ← {t("Box 3")}
        </Link>
        <Button onClick={() => window.print()} title={t("Use “Save as PDF” in the print dialog")}>
          ⎙ {t("Print / PDF")}
        </Button>
      </div>

      <header>
        <h1 className="text-2xl font-semibold">{t("Box 3 dossier {year}", { year })}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {[
            t("Peildatum {date}", { date: date(y.peildatum) }),
            names,
            y.partner ? t("with fiscal partner") : t("on your own"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {t("Made on {date} with Box3balans {version}", {
            date: date(d.generatedAt.slice(0, 10)),
            version: d.version,
          })}
        </p>
      </header>

      {y.warnings.length > 0 && (
        <div className="flex flex-col gap-2">
          {y.warnings.map((w) => (
            <Alert key={w}>{w}</Alert>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Bank balances")} value={eur(y.totals.bank, { decimals: 0 })} />
        <Stat label={t("Other assets")} value={eur(y.calculation?.otherEur ?? y.totals.other, { decimals: 0 })} />
        <Stat label={t("Debts")} value={eur(y.debtsEur, { decimals: 0 })} />
        <Stat
          label={t("Estimated box 3 tax {year}", { year: y.year })}
          value={y.calculation ? eur(y.calculation.netTaxEur, { decimals: 0 }) : "—"}
          sub={y.rates && !y.rates.final ? <Badge tone="warn">{t("provisional rates")}</Badge> : undefined}
        />
      </div>

      <CalculationCard y={y} />
      <ActualReturnCard y={y} />

      <h2 className="mt-2 text-lg font-semibold">{t("Per account: values and where they come from")}</h2>
      {[...byAccount].map(([id, rows]) => {
        const first = rows[0]!;
        const origin = d.accounts.find((a) => a.id === id);
        const total = rows.reduce((sum, r) => sum + Number(r.valueEur), 0);
        const holdings = rows.filter((r) => r.source === "transactions");
        return (
          <Card
            key={id}
            className="print:break-inside-avoid"
            padded={false}
            title={
              <span className="flex flex-wrap items-baseline gap-x-2">
                {first.accountName}
                <span className="text-xs font-normal text-muted">
                  {kindLabel(first.accountKind)} · {ownerLabel(first, persons)} · {categoryLabel(first.category)}
                  {Number(first.countedPct) !== 100 && ` · ${t("{pct}% counts", { pct: num(first.countedPct, 2) })}`}
                </span>
              </span>
            }
          >
            <ul className="flex flex-col gap-0.5 px-4 pt-3 text-xs text-ink-2">
              {origin?.sync && (
                <li>
                  {t("Synced with {provider} ({n} transactions up to the peildatum), last on {date}", {
                    provider: PROVIDER[origin.sync.provider] ?? origin.sync.provider,
                    n: origin.entries.api,
                    date: origin.sync.lastSyncAt ? date(origin.sync.lastSyncAt.slice(0, 10)) : "—",
                  })}
                </li>
              )}
              {origin?.wallets.map((w) => (
                <li key={`${w.chain}:${w.address}`}>
                  {t("Wallet on {chain}: {address}, read from the blockchain ({n} transactions)", {
                    chain: w.chain,
                    address: short(w.address),
                    n: origin.entries.chain,
                  })}
                </li>
              ))}
              {origin?.imports.map((f) => (
                <li key={`${f.fileName}:${f.at}`}>
                  {t("Imported from {file} on {date} ({n} transactions)", {
                    file: f.fileName,
                    date: date(f.at.slice(0, 10)),
                    n: f.inserted,
                  })}
                </li>
              ))}
              {!!origin?.entries.manual && (
                <li>
                  {tn(origin.entries.manual, "1 transaction entered by hand", "{n} transactions entered by hand")}
                </li>
              )}
              {origin?.yearly && (
                <li>
                  {origin.yearly.source
                    ? t("Value on 1 January from {source}, last changed on {date}", {
                        source: origin.yearly.source,
                        date: date(origin.yearly.updatedAt.slice(0, 10)),
                      })
                    : t("Value on 1 January entered per year, last changed on {date}", {
                        date: date(origin.yearly.updatedAt.slice(0, 10)),
                      })}
                </li>
              )}
            </ul>
            <div className="overflow-x-auto">
              <table className="tabular mt-2 w-full min-w-[640px] text-sm">
                {holdings.length > 0 && (
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-2">
                      <th className="px-3 py-2 text-left font-medium">{t("Asset")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Quantity")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Price")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("Price date")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("Price source")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Value")}</th>
                    </tr>
                  </thead>
                )}
                <tbody className="divide-y divide-line">
                  {rows.map((row) => {
                    if (row.source === "yearly")
                      return (
                        <tr key={`${id}-yearly`}>
                          <td className="px-3 py-1.5 text-ink-2" colSpan={5}>
                            {t("Value on 1 January (entered per year)")}
                          </td>
                          <td className="px-3 py-1.5 text-right">{eur(row.valueEur)}</td>
                        </tr>
                      );
                    const p = row.priceDay ? priceOf.get(`${row.assetId}:${row.priceDay}`) : undefined;
                    return (
                      <Fragment key={`${row.assetId}-${row.physical}`}>
                        <tr>
                          <td className="px-3 py-1.5">
                            {row.name} <span className="text-xs text-muted">{row.symbol}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-ink-2">
                            {num(row.quantity, row.unit === "g" ? 3 : 8)}
                            {row.unit === "g" ? " g" : ""}
                          </td>
                          <td className="px-3 py-1.5 text-right text-ink-2">
                            {row.missingPrice ? (
                              <Badge tone="warn">{t("no price")}</Badge>
                            ) : (
                              `${eurPrice(row.priceEur)}${row.unit === "g" ? "/g" : ""}`
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-ink-2">{row.priceDay ? date(row.priceDay) : "—"}</td>
                          <td className="px-3 py-1.5 text-xs text-ink-2">{priceSource(p)}</td>
                          <td className="px-3 py-1.5 text-right">{eur(row.valueEur)}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  <tr className="font-medium">
                    <td className="px-3 py-2" colSpan={5}>
                      {t("Total on {date}", { date: date(y.peildatum) })}
                    </td>
                    <td className="px-3 py-2 text-right">{eur(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      <Card title={t("How the values are determined")} className="print:break-inside-avoid">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
          <li>
            {t(
              "Box 3 counts what you had on {peildatum}: the holdings at the end of {day}, valued at that day's close or the last one before it.",
              { peildatum: date(y.peildatum), day: date(y.valuedAt) },
            )}
          </li>
          <li>{t("Amounts in a foreign currency are converted at the ECB reference rate of that day.")}</li>
          <li>
            {t(
              "Crypto is valued at the price of the source shown. For a coin an exchange no longer trades, a price from Yahoo or Binance is only used when your own trades in it confirm it's the same coin; a coin swapped for a successor is valued at the successor's price times the fixed rate.",
            )}
          </li>
          <li>
            {t(
              "A value per year is the amount entered for 1 January, by hand or from your bank's export (the file is named).",
            )}
          </li>
          {unrecorded && (
            <li>
              {t(
                "* No recorded source: a price stored before version 0.1.9 that couldn't be traced back to its source. The holding's price source is shown instead.",
              )}
            </li>
          )}
        </ul>
        <p className="mt-3 text-xs text-muted">
          {t(
            "This dossier is an aid for your own records, not tax advice. Check the amounts against the year statements of your banks and brokers before you copy them into your tax return.",
          )}
        </p>
      </Card>
    </div>
  );
}
