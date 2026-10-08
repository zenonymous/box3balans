import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { del, get, post, put, type Asset, type Transaction, type TxType } from "../api";
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "../components/ui";
import {
  CLASS_LABEL,
  CLASS_ORDER,
  TX_LABEL,
  date,
  eur,
  eurPrice,
  num,
  todayIso,
  parseNumberInput,
  toApiNumber,
  toInputNumber,
} from "../format";
import { useAccounts, useAssets, useInvalidateAll } from "../queries";
import { ActivityList } from "./Activity";
import { t, tj, tn } from "../i18n";

const PAGE = 50;
const ENTRY_TYPES: TxType[] = ["buy", "sell", "deposit", "withdrawal", "dividend", "reward", "fee", "split"];

export function TransactionsPage() {
  const accounts = useAccounts();
  const assets = useAssets();
  // Links elsewhere (e.g. Needs attention) can open the list pre-filtered.
  const [search] = useSearchParams();
  const [filters, setFilters] = useState({
    accountId: search.get("accountId") ?? "",
    assetId: search.get("assetId") ?? "",
    type: search.get("type") ?? "",
    q: search.get("q") ?? "",
  });
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Transaction | "new" | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const list = useQuery({
    queryKey: ["transactions", params.toString()],
    queryFn: () => get<{ total: number; items: Transaction[] }>(`/api/transactions?${params}`),
  });

  const setFilter = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(0);
  };

  const noSetup = accounts.data?.length === 0;

  return (
    <>
      <PageHeader
        title={t("Transactions")}
        subtitle={list.data ? tn(list.data.total, "{n} transaction", "{n} transactions") : undefined}
        actions={
          <>
            <Link
              to="/transactions/import"
              className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              ↑ {t("Import CSV")}
            </Link>
            <Button onClick={() => setTransferOpen(true)} disabled={noSetup}>
              ⇄ {t("Transfer")}
            </Button>
            <Button variant="primary" onClick={() => setEditing("new")} disabled={noSetup}>
              {t("+ Add transaction")}
            </Button>
          </>
        }
      />
      {noSetup && (
        <div className="mb-4">
          <Alert>
            {tj("Create an <0>account</0> first.", [<Link key="a" to="/accounts" className="underline" />])}
          </Alert>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Input
          placeholder={t("Search…")}
          value={filters.q}
          onChange={(e) => setFilter("q", e.target.value)}
          className="col-span-2 sm:max-w-56"
          aria-label={t("Search")}
        />
        <Select
          value={filters.accountId}
          onChange={(e) => setFilter("accountId", e.target.value)}
          className="sm:max-w-48"
          aria-label={t("Account")}
        >
          <option value="">{t("All accounts")}</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          value={filters.assetId}
          onChange={(e) => setFilter("assetId", e.target.value)}
          className="sm:max-w-48"
          aria-label={t("Asset")}
        >
          <option value="">{t("All assets")}</option>
          {assets.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.symbol} — {a.name}
            </option>
          ))}
        </Select>
        <Select
          value={filters.type}
          onChange={(e) => setFilter("type", e.target.value)}
          className="sm:max-w-40"
          aria-label={t("Type")}
        >
          <option value="">{t("All types")}</option>
          {Object.entries(TX_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      <Card padded={false}>
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4">
            <Alert tone="danger">{list.error.message}</Alert>
          </div>
        ) : list.data!.items.length === 0 ? (
          <Empty title={t("No transactions yet")}>{t("Add a buy, deposit or dividend to get started.")}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.items.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => setEditing(x)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-2"
                >
                  <div className="w-20 shrink-0 text-xs text-ink-2 sm:w-24">{date(x.occurredAt)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink">
                      <span className="font-medium">{TX_LABEL[x.type]}</span> {x.assetSymbol}
                      <span className="text-ink-2"> · {x.accountName}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {describe(x)}
                      {x.source !== "manual" && (
                        <>
                          {" "}
                          · <Badge>{SOURCE_BADGE[x.source]}</Badge>
                        </>
                      )}
                      {x.notes && <> · {x.notes}</>}
                    </div>
                  </div>
                  <div className="tabular shrink-0 text-right text-ink">{eurValue(x)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {list.data && list.data.total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-ink-2">
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t("← Newer")}
          </Button>
          <span>
            {t("{from}–{to} of {total}", {
              from: page * PAGE + 1,
              to: Math.min((page + 1) * PAGE, list.data.total),
              total: list.data.total,
            })}
          </span>
          <Button size="sm" disabled={(page + 1) * PAGE >= list.data.total} onClick={() => setPage(page + 1)}>
            {t("Older →")}
          </Button>
        </div>
      )}

      {editing && <TxModal tx={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {transferOpen && <TransferModal onClose={() => setTransferOpen(false)} />}
    </>
  );
}

function describe(x: Transaction): string {
  switch (x.type) {
    case "dividend":
      return Number(x.taxWithheld)
        ? t("{amount} {currency} gross, {tax} tax", {
            amount: num(x.amount, 2),
            currency: x.currency,
            tax: num(x.taxWithheld, 2),
          })
        : t("{amount} {currency} gross", { amount: num(x.amount, 2), currency: x.currency });
    case "split":
      return `${num(x.quantity)} : 1`;
    case "transfer_in":
    case "transfer_out":
    case "fee":
    case "withdrawal":
      return `${num(x.quantity)}`;
    default:
      return `${num(x.quantity)} × ${eurPrice(x.price, x.currency)}${Number(x.feeEur) ? ` + ${t("{amount} fee", { amount: eur(x.feeEur) })}` : ""}`;
  }
}

function eurValue(x: Transaction): string {
  const fx = Number(x.fxRate);
  if (x.type === "dividend") return eur((Number(x.amount) - Number(x.taxWithheld)) * fx);
  if (["buy", "sell", "deposit", "reward"].includes(x.type) && Number(x.price)) {
    const v = Number(x.quantity) * Number(x.price) * fx;
    return eur(x.type === "buy" ? -(v + Number(x.feeEur)) : x.type === "sell" ? v - Number(x.feeEur) : v, {
      sign: x.type === "buy" || x.type === "sell",
    });
  }
  return "";
}

function AssetSelect({
  assets,
  value,
  onChange,
  id,
}: {
  assets: Asset[];
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">{t("Choose asset…")}</option>
      {CLASS_ORDER.map((c) => {
        const list = assets.filter((a) => a.assetClass === c && (!a.hidden || String(a.id) === value));
        if (!list.length) return null;
        return (
          <optgroup key={c} label={CLASS_LABEL[c]}>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.symbol} — {a.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </Select>
  );
}

/** The calendar date of a timestamp in the browser's time zone (YYYY-MM-DD for <input type=date>). */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function TxModal({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const accounts = useAccounts();
  const assets = useAssets();
  const invalidate = useInvalidateAll();
  const isTransfer = tx?.transferGroup != null;
  const [f, setF] = useState({
    type: tx?.type ?? "buy",
    accountId: tx ? String(tx.accountId) : "",
    assetId: tx ? String(tx.assetId) : "",
    day: tx ? toLocalInput(tx.occurredAt) : todayIso(),
    quantity: tx ? strip(tx.quantity) : "",
    price: tx ? strip(tx.price) : "",
    currency: tx?.currency ?? "EUR",
    fxRate: tx && tx.currency !== "EUR" ? strip(tx.fxRate) : "",
    feeEur: tx && Number(tx.feeEur) ? strip(tx.feeEur) : "",
    amount: tx && Number(tx.amount) ? strip(tx.amount) : "",
    taxWithheld: tx && Number(tx.taxWithheld) ? strip(tx.taxWithheld) : "",
    notes: tx?.notes ?? "",
  });
  const [settleCash, setSettleCash] = useState(tx ? tx.settleAssetId != null : false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const asset = assets.data?.find((a) => String(a.id) === f.assetId);
  // Picking an asset defaults the trade currency to its quote currency.
  const pickAsset = (id: string) => {
    const a = assets.data?.find((x) => String(x.id) === id);
    setF((s) => ({ ...s, assetId: id, currency: a?.currency ?? s.currency, fxRate: "" }));
  };

  const ecb = useQuery({
    queryKey: ["fx", f.currency, f.day],
    queryFn: () => get<{ eurPerUnit: string }>(`/api/fx?currency=${f.currency}&date=${f.day}`),
    enabled: /^[A-Z]{3}$/.test(f.currency) && f.currency !== "EUR" && /^\d{4}-\d{2}-\d{2}$/.test(f.day),
    staleTime: Infinity,
  });

  const kind = f.type;
  const usesPrice = ["buy", "sell", "deposit", "reward"].includes(kind);
  const usesCurrency = usesPrice || kind === "dividend";
  const usesFee = ["buy", "sell", "dividend", "withdrawal"].includes(kind);
  const settles = ["buy", "sell", "dividend"].includes(kind);
  const qtyLabel =
    kind === "split"
      ? t("Split ratio (new shares per old share)")
      : asset?.unit === "g"
        ? t("Quantity (grams)")
        : t("Quantity");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    // Keep the exact original time (synced trades have one) unless the date was changed; a new
    // date gets noon, which keeps it on that day in any European time zone.
    const occurredAt =
      tx && f.day === toLocalInput(tx.occurredAt) ? tx.occurredAt : new Date(`${f.day}T12:00:00`).toISOString();
    try {
      if (isTransfer) {
        await put(`/api/transactions/${tx.id}`, {
          occurredAt,
          quantity: toApiNumber(f.quantity, t("Quantity")),
          feeEur: toApiNumber(f.feeEur, t("Fee")) || "0",
          notes: f.notes || null,
        });
      } else {
        const body = {
          type: f.type,
          accountId: Number(f.accountId),
          assetId: Number(f.assetId),
          occurredAt,
          quantity: kind === "dividend" ? "0" : toApiNumber(f.quantity, t("Quantity")),
          price: usesPrice ? toApiNumber(f.price, t("Price")) || "0" : "0",
          currency: usesCurrency ? f.currency : "EUR",
          ...(usesCurrency && f.currency !== "EUR" && f.fxRate ? { fxRate: toApiNumber(f.fxRate, t("FX rate")) } : {}),
          feeEur: usesFee ? toApiNumber(f.feeEur, t("Fee")) || "0" : "0",
          amount: kind === "dividend" ? toApiNumber(f.amount, t("Gross amount")) : "0",
          taxWithheld: kind === "dividend" ? toApiNumber(f.taxWithheld, t("Tax withheld")) || "0" : "0",
          settleCash: settles && settleCash,
          notes: f.notes || null,
        };
        if (tx) await put(`/api/transactions/${tx.id}`, body);
        else await post("/api/transactions", body);
      }
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(isTransfer ? t("Delete both legs of this transfer?") : t("Delete this transaction?"))) return;
    try {
      await del(`/api/transactions/${tx!.id}`);
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Undo a (wrongly) linked transfer: both legs become a withdrawal and a deposit again and are
  // never auto-matched again.
  const unlink = async () => {
    if (
      !confirm(
        t(
          "Unlink this transfer? Both legs become a separate withdrawal and deposit, and they won't be linked automatically again.",
        ),
      )
    )
      return;
    try {
      await post(`/api/transactions/${tx!.id}/unlink`);
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const total = useMemo(() => {
    const num = (v: string) => Number(parseNumberInput(v).value) || 0;
    const q = num(f.quantity);
    const p = num(f.price);
    const fx = f.currency === "EUR" ? 1 : num(f.fxRate) || Number(ecb.data?.eurPerUnit || 0);
    if (!usesPrice || !q || !p || !fx) return null;
    return q * p * fx + (kind === "buy" ? num(f.feeEur) : kind === "sell" ? -num(f.feeEur) : 0);
  }, [f, ecb.data, usesPrice, kind]);

  return (
    <Modal
      open
      onClose={onClose}
      title={
        tx
          ? isTransfer
            ? t("Edit {name}", { name: TX_LABEL[tx.type]?.toLowerCase() ?? tx.type })
            : t("Edit transaction")
          : t("Add transaction")
      }
      wide
      footer={
        <>
          {tx && (
            <Button variant="danger" onClick={remove} className="mr-auto">
              {t("Delete")}
            </Button>
          )}
          {isTransfer && <Button onClick={unlink}>{t("Unlink")}</Button>}
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="tx-form" disabled={busy}>
            {busy ? t("Saving…") : t("Save")}
          </Button>
        </>
      }
    >
      <form id="tx-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isTransfer ? (
          <p className="text-sm text-ink-2 sm:col-span-2">
            {t("{type} of {asset} at {account}. Changing the date moves both legs.", {
              type: TX_LABEL[tx.type] ?? tx.type,
              asset: tx.assetSymbol,
              account: tx.accountName,
            })}
          </p>
        ) : (
          <>
            <Field label={t("Type")}>
              {(id) => (
                <Select id={id} value={f.type} onChange={(e) => set("type")(e.target.value)}>
                  {ENTRY_TYPES.map((k) => (
                    <option key={k} value={k}>
                      {TX_LABEL[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("Date")}>
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={f.day}
                  max={todayIso()}
                  onChange={(e) => set("day")(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label={t("Account")}>
              {(id) => (
                <Select id={id} value={f.accountId} onChange={(e) => set("accountId")(e.target.value)} required>
                  <option value="">{t("Choose account…")}</option>
                  {accounts.data
                    ?.filter((a) => !a.archived || String(a.id) === f.accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field
              label={t("Asset")}
              hint={tj("Missing? <0>Add an asset</0>", [
                <Link key="a" to="/assets" className="text-accent underline" onClick={onClose} />,
              ])}
            >
              {(id) => <AssetSelect id={id} assets={assets.data ?? []} value={f.assetId} onChange={pickAsset} />}
            </Field>
          </>
        )}

        {isTransfer && (
          <Field label={t("Date")}>
            {(id) => <Input id={id} type="date" value={f.day} onChange={(e) => set("day")(e.target.value)} required />}
          </Field>
        )}

        {kind !== "dividend" && (
          <Field label={qtyLabel}>
            {(id) => (
              <AmountInput
                id={id}

                value={f.quantity}
                onChange={(e) => set("quantity")(e.target.value)}
                required
              />
            )}
          </Field>
        )}

        {usesPrice && !isTransfer && (
          <Field
            label={
              kind === "reward"
                ? t("Market price per unit at receipt")
                : kind === "deposit"
                  ? t("Cost per unit (optional)")
                  : t("Price per unit")
            }
          >
            {(id) => (
              <AmountInput
                id={id}

                value={f.price}
                onChange={(e) => set("price")(e.target.value)}
                required={kind === "buy" || kind === "sell"}
              />
            )}
          </Field>
        )}

        {kind === "dividend" && (
          <>
            <Field label={t("Gross amount")}>
              {(id) => (
                <AmountInput
                  id={id}

                  value={f.amount}
                  onChange={(e) => set("amount")(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label={t("Tax withheld")}>
              {(id) => (
                <AmountInput
                  id={id}

                  value={f.taxWithheld}
                  onChange={(e) => set("taxWithheld")(e.target.value)}
                  placeholder="0"
                />
              )}
            </Field>
          </>
        )}

        {usesCurrency && !isTransfer && (
          <>
            <Field label={t("Currency")}>
              {(id) => (
                <Input
                  id={id}
                  value={f.currency}
                  maxLength={3}
                  onChange={(e) => set("currency")(e.target.value.toUpperCase())}
                  required
                />
              )}
            </Field>
            {f.currency !== "EUR" && (
              <Field
                label={t("FX rate (EUR per 1 {currency})", { currency: f.currency })}
                hint={
                  ecb.data
                    ? t("ECB rate on this date: {rate} — leave empty to use it", {
                        rate: toInputNumber(Number(ecb.data.eurPerUnit).toFixed(6)),
                      })
                    : ecb.isError
                      ? t("No ECB rate found; enter it manually")
                      : t("Looking up ECB rate…")
                }
              >
                {(id) => (
                  <AmountInput
                    id={id}

                    value={f.fxRate}
                    onChange={(e) => set("fxRate")(e.target.value)}
                    placeholder={ecb.data ? toInputNumber(Number(ecb.data.eurPerUnit).toFixed(6)) : ""}
                  />
                )}
              </Field>
            )}
          </>
        )}

        {(usesFee || isTransfer) && (
          <Field label={t("Fee (EUR)")}>
            {(id) => (
              <AmountInput
                id={id}

                value={f.feeEur}
                onChange={(e) => set("feeEur")(e.target.value)}
                placeholder="0"
              />
            )}
          </Field>
        )}

        {settles && !isTransfer && (
          <label className="flex items-start gap-2 text-sm text-ink-2 sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settleCash}
              onChange={(e) => setSettleCash(e.target.checked)}
            />
            <span>
              {kind === "buy"
                ? t("Pay from this account’s {currency} cash balance", { currency: f.currency || "EUR" })
                : t("Credit to this account’s {currency} cash balance", { currency: f.currency || "EUR" })}
              <span className="block text-xs text-muted">
                {t("Keeps the cash balance right when you also track deposits and withdrawals here.")}
              </span>
            </span>
          </label>
        )}

        <Field label={t("Notes")} className="sm:col-span-2">
          {(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />}
        </Field>

        {total != null && (
          <p className="text-sm text-ink-2 sm:col-span-2">
            {kind === "buy" ? t("Total cost") : kind === "sell" ? t("Net proceeds") : t("Value")}:{" "}
            <span className="tabular font-medium text-ink">{eur(total)}</span>
          </p>
        )}
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
      </form>
      {tx && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-2">
            {t("History")}
            {tx.source !== "manual" && ` · ${t("came from {source}", { source: SOURCE_LABEL[tx.source] })}`}
          </summary>
          <div className="mt-2">
            <ActivityList entity="transaction" entityId={tx.id} compact />
          </div>
        </details>
      )}
    </Modal>
  );
}

const SOURCE_LABEL: Record<Transaction["source"], string> = {
  manual: t("manual entry"),
  csv: t("a CSV import"),
  api: t("an exchange sync"),
  chain: t("a wallet sync"),
};

const SOURCE_BADGE: Record<Transaction["source"], string> = {
  manual: t("manual"),
  csv: "csv",
  api: t("sync"),
  chain: t("wallet"),
};

function TransferModal({ onClose }: { onClose: () => void }) {
  const accounts = useAccounts();
  const assets = useAssets();
  const invalidate = useInvalidateAll();
  const [f, setF] = useState({
    fromAccountId: "",
    toAccountId: "",
    assetId: "",
    day: todayIso(),
    quantity: "",
    receivedQuantity: "",
    feeEur: "",
    notes: "",
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const active = accounts.data?.filter((a) => !a.archived) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await post("/api/transactions/transfer", {
        fromAccountId: Number(f.fromAccountId),
        toAccountId: Number(f.toAccountId),
        assetId: Number(f.assetId),
        occurredAt: new Date(`${f.day}T12:00:00`).toISOString(),
        quantity: toApiNumber(f.quantity, t("Quantity sent")),
        ...(f.receivedQuantity ? { receivedQuantity: toApiNumber(f.receivedQuantity, t("Quantity received")) } : {}),
        feeEur: toApiNumber(f.feeEur, t("Fee")) || "0",
        notes: f.notes || null,
      });
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Transfer between accounts")}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="transfer-form" disabled={busy}>
            {busy ? t("Saving…") : t("Save transfer")}
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <p className="text-sm text-ink-2 sm:col-span-2">
          {t("Moves an asset and its cost basis, e.g. from an exchange to your hardware wallet. No gain is realized.")}
        </p>
        <Field label={t("From")}>
          {(id) => (
            <Select id={id} value={f.fromAccountId} onChange={(e) => set("fromAccountId")(e.target.value)} required>
              <option value="">{t("Choose…")}</option>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("To")}>
          {(id) => (
            <Select id={id} value={f.toAccountId} onChange={(e) => set("toAccountId")(e.target.value)} required>
              <option value="">{t("Choose…")}</option>
              {active
                .filter((a) => String(a.id) !== f.fromAccountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t("Asset")}>
          {(id) => <AssetSelect id={id} assets={assets.data ?? []} value={f.assetId} onChange={set("assetId")} />}
        </Field>
        <Field label={t("Date")}>
          {(id) => (
            <Input
              id={id}
              type="date"
              value={f.day}
              max={todayIso()}
              onChange={(e) => set("day")(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t("Quantity sent")}>
          {(id) => (
            <AmountInput
              id={id}

              value={f.quantity}
              onChange={(e) => set("quantity")(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t("Quantity received")} hint={t("If a network fee was deducted")}>
          {(id) => (
            <AmountInput
              id={id}

              value={f.receivedQuantity}
              onChange={(e) => set("receivedQuantity")(e.target.value)}
              placeholder={f.quantity || t("same as sent")}
            />
          )}
        </Field>
        <Field label={t("Fee (EUR)")}>
          {(id) => (
            <AmountInput
              id={id}

              value={f.feeEur}
              onChange={(e) => set("feeEur")(e.target.value)}
              placeholder="0"
            />
          )}
        </Field>
        <Field label={t("Notes")}>
          {(id) => <Input id={id} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />}
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
      </form>
    </Modal>
  );
}

/**
 * A stored NUMERIC prepared for editing: trailing zeros trimmed ("1.500000000" -> "1.5") and written
 * in the user's number format ("1,5" for Dutch), so it reads back as the same number.
 */
function strip(v: string): string {
  return toInputNumber(v.includes(".") ? v.replace(/\.?0+$/, "") : v);
}
