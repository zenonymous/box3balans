import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
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

const PAGE = 50;
const ENTRY_TYPES: TxType[] = ["buy", "sell", "deposit", "withdrawal", "dividend", "reward", "fee", "split"];

export function TransactionsPage() {
  const accounts = useAccounts();
  const assets = useAssets();
  const [filters, setFilters] = useState({ accountId: "", assetId: "", type: "", q: "" });
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
        title="Transactions"
        subtitle={list.data ? `${list.data.total} transactions` : undefined}
        actions={
          <>
            <Link
              to="/transactions/import"
              className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              ↑ Import CSV
            </Link>
            <Button onClick={() => setTransferOpen(true)} disabled={noSetup}>
              ⇄ Transfer
            </Button>
            <Button variant="primary" onClick={() => setEditing("new")} disabled={noSetup}>
              + Add transaction
            </Button>
          </>
        }
      />
      {noSetup && (
        <div className="mb-4">
          <Alert>
            Create an{" "}
            <Link to="/accounts" className="underline">
              account
            </Link>{" "}
            first.
          </Alert>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Input
          placeholder="Search…"
          value={filters.q}
          onChange={(e) => setFilter("q", e.target.value)}
          className="col-span-2 sm:max-w-56"
          aria-label="Search"
        />
        <Select
          value={filters.accountId}
          onChange={(e) => setFilter("accountId", e.target.value)}
          className="sm:max-w-48"
          aria-label="Account"
        >
          <option value="">All accounts</option>
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
          aria-label="Asset"
        >
          <option value="">All assets</option>
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
          aria-label="Type"
        >
          <option value="">All types</option>
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
            <Alert tone="danger">{(list.error as Error).message}</Alert>
          </div>
        ) : list.data!.items.length === 0 ? (
          <Empty title="No transactions yet">Add a buy, deposit or dividend to get started.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-2"
                >
                  <div className="w-20 shrink-0 text-xs text-ink-2 sm:w-24">{date(t.occurredAt)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink">
                      <span className="font-medium">{TX_LABEL[t.type]}</span> {t.assetSymbol}
                      <span className="text-ink-2"> · {t.accountName}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {describe(t)}
                      {t.source !== "manual" && (
                        <>
                          {" "}
                          · <Badge>{t.source}</Badge>
                        </>
                      )}
                      {t.notes && <> · {t.notes}</>}
                    </div>
                  </div>
                  <div className="tabular shrink-0 text-right text-ink">{eurValue(t)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {list.data && list.data.total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-ink-2">
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ← Newer
          </Button>
          <span>
            {page * PAGE + 1}–{Math.min((page + 1) * PAGE, list.data.total)} of {list.data.total}
          </span>
          <Button size="sm" disabled={(page + 1) * PAGE >= list.data.total} onClick={() => setPage(page + 1)}>
            Older →
          </Button>
        </div>
      )}

      {editing && <TxModal tx={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {transferOpen && <TransferModal onClose={() => setTransferOpen(false)} />}
    </>
  );
}

function describe(t: Transaction): string {
  switch (t.type) {
    case "dividend":
      return `${num(t.amount, 2)} ${t.currency} gross${Number(t.taxWithheld) ? `, ${num(t.taxWithheld, 2)} tax` : ""}`;
    case "split":
      return `${num(t.quantity)} : 1`;
    case "transfer_in":
    case "transfer_out":
    case "fee":
    case "withdrawal":
      return `${num(t.quantity)}`;
    default:
      return `${num(t.quantity)} × ${eurPrice(t.price, t.currency)}${Number(t.feeEur) ? ` + ${eur(t.feeEur)} fee` : ""}`;
  }
}

function eurValue(t: Transaction): string {
  const fx = Number(t.fxRate);
  if (t.type === "dividend") return eur((Number(t.amount) - Number(t.taxWithheld)) * fx);
  if (["buy", "sell", "deposit", "reward"].includes(t.type) && Number(t.price)) {
    const v = Number(t.quantity) * Number(t.price) * fx;
    return eur(t.type === "buy" ? -(v + Number(t.feeEur)) : t.type === "sell" ? v - Number(t.feeEur) : v, {
      sign: t.type === "buy" || t.type === "sell",
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
      <option value="">Choose asset…</option>
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
    type: (tx?.type ?? "buy") as TxType,
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

  const t = f.type;
  const usesPrice = ["buy", "sell", "deposit", "reward"].includes(t);
  const usesCurrency = usesPrice || t === "dividend";
  const usesFee = ["buy", "sell", "dividend", "withdrawal"].includes(t);
  const settles = ["buy", "sell", "dividend"].includes(t);
  const qtyLabel =
    t === "split" ? "Split ratio (new shares per old share)" : `Quantity${asset?.unit === "g" ? " (grams)" : ""}`;

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
        await put(`/api/transactions/${tx!.id}`, {
          occurredAt,
          quantity: toApiNumber(f.quantity, "Quantity"),
          feeEur: toApiNumber(f.feeEur, "Fee") || "0",
          notes: f.notes || null,
        });
      } else {
        const body = {
          type: f.type,
          accountId: Number(f.accountId),
          assetId: Number(f.assetId),
          occurredAt,
          quantity: t === "dividend" ? "0" : toApiNumber(f.quantity, "Quantity"),
          price: usesPrice ? toApiNumber(f.price, "Price") || "0" : "0",
          currency: usesCurrency ? f.currency : "EUR",
          ...(usesCurrency && f.currency !== "EUR" && f.fxRate ? { fxRate: toApiNumber(f.fxRate, "FX rate") } : {}),
          feeEur: usesFee ? toApiNumber(f.feeEur, "Fee") || "0" : "0",
          amount: t === "dividend" ? toApiNumber(f.amount, "Gross amount") : "0",
          taxWithheld: t === "dividend" ? toApiNumber(f.taxWithheld, "Tax withheld") || "0" : "0",
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
    if (!confirm(isTransfer ? "Delete both legs of this transfer?" : "Delete this transaction?")) return;
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
        "Unlink this transfer? Both legs become a separate withdrawal and deposit, and they won't be linked automatically again.",
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
    return q * p * fx + (t === "buy" ? num(f.feeEur) : t === "sell" ? -num(f.feeEur) : 0);
  }, [f, ecb.data, usesPrice, t]);

  return (
    <Modal
      open
      onClose={onClose}
      title={tx ? (isTransfer ? `Edit ${TX_LABEL[tx.type]?.toLowerCase()}` : "Edit transaction") : "Add transaction"}
      wide
      footer={
        <>
          {tx && (
            <Button variant="danger" onClick={remove} className="mr-auto">
              Delete
            </Button>
          )}
          {isTransfer && <Button onClick={unlink}>Unlink</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="tx-form" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="tx-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isTransfer ? (
          <p className="text-sm text-ink-2 sm:col-span-2">
            {TX_LABEL[tx!.type]} of {tx!.assetSymbol} at {tx!.accountName}. Changing the date moves both legs.
          </p>
        ) : (
          <>
            <Field label="Type">
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
            <Field label="Date">
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
            <Field label="Account">
              {(id) => (
                <Select id={id} value={f.accountId} onChange={(e) => set("accountId")(e.target.value)} required>
                  <option value="">Choose account…</option>
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
              label="Asset"
              hint={
                <>
                  Missing?{" "}
                  <Link to="/assets" className="text-accent underline" onClick={onClose}>
                    Add an asset
                  </Link>
                </>
              }
            >
              {(id) => <AssetSelect id={id} assets={assets.data ?? []} value={f.assetId} onChange={pickAsset} />}
            </Field>
          </>
        )}

        {isTransfer && (
          <Field label="Date">
            {(id) => <Input id={id} type="date" value={f.day} onChange={(e) => set("day")(e.target.value)} required />}
          </Field>
        )}

        {t !== "dividend" && (
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
              t === "reward"
                ? "Market price per unit at receipt"
                : t === "deposit"
                  ? "Cost per unit (optional)"
                  : "Price per unit"
            }
          >
            {(id) => (
              <AmountInput
                id={id}

                value={f.price}
                onChange={(e) => set("price")(e.target.value)}
                required={t === "buy" || t === "sell"}
              />
            )}
          </Field>
        )}

        {t === "dividend" && (
          <>
            <Field label="Gross amount">
              {(id) => (
                <AmountInput
                  id={id}

                  value={f.amount}
                  onChange={(e) => set("amount")(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Tax withheld">
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
            <Field label="Currency">
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
                label={`FX rate (EUR per 1 ${f.currency})`}
                hint={
                  ecb.data
                    ? `ECB rate on this date: ${toInputNumber(Number(ecb.data.eurPerUnit).toFixed(6))} — leave empty to use it`
                    : ecb.isError
                      ? "No ECB rate found; enter it manually"
                      : "Looking up ECB rate…"
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
          <Field label="Fee (EUR)">
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
              {t === "buy" ? "Pay from" : "Credit to"} this account’s {f.currency || "EUR"} cash balance
              <span className="block text-xs text-muted">
                Keeps the cash balance right when you also track deposits and withdrawals here.
              </span>
            </span>
          </label>
        )}

        <Field label="Notes" className="sm:col-span-2">
          {(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />}
        </Field>

        {total != null && (
          <p className="text-sm text-ink-2 sm:col-span-2">
            {t === "buy" ? "Total cost" : t === "sell" ? "Net proceeds" : "Value"}:{" "}
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
            History{tx.source !== "manual" && ` · came from ${SOURCE_LABEL[tx.source]}`}
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
  manual: "manual entry",
  csv: "a CSV import",
  api: "an exchange sync",
  chain: "a wallet sync",
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
        quantity: toApiNumber(f.quantity, "Quantity sent"),
        ...(f.receivedQuantity ? { receivedQuantity: toApiNumber(f.receivedQuantity, "Quantity received") } : {}),
        feeEur: toApiNumber(f.feeEur, "Fee") || "0",
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
      title="Transfer between accounts"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="transfer-form" disabled={busy}>
            {busy ? "Saving…" : "Save transfer"}
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <p className="text-sm text-ink-2 sm:col-span-2">
          Moves an asset and its cost basis, e.g. from an exchange to your hardware wallet. No gain is realized.
        </p>
        <Field label="From">
          {(id) => (
            <Select id={id} value={f.fromAccountId} onChange={(e) => set("fromAccountId")(e.target.value)} required>
              <option value="">Choose…</option>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="To">
          {(id) => (
            <Select id={id} value={f.toAccountId} onChange={(e) => set("toAccountId")(e.target.value)} required>
              <option value="">Choose…</option>
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
        <Field label="Asset">
          {(id) => <AssetSelect id={id} assets={assets.data ?? []} value={f.assetId} onChange={set("assetId")} />}
        </Field>
        <Field label="Date">
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
        <Field label="Quantity sent">
          {(id) => (
            <AmountInput
              id={id}

              value={f.quantity}
              onChange={(e) => set("quantity")(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Quantity received" hint="If a network fee was deducted">
          {(id) => (
            <AmountInput
              id={id}

              value={f.receivedQuantity}
              onChange={(e) => set("receivedQuantity")(e.target.value)}
              placeholder={f.quantity || "same as sent"}
            />
          )}
        </Field>
        <Field label="Fee (EUR)">
          {(id) => (
            <AmountInput
              id={id}

              value={f.feeEur}
              onChange={(e) => set("feeEur")(e.target.value)}
              placeholder="0"
            />
          )}
        </Field>
        <Field label="Notes">
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
