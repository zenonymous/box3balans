import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { del, get, post, put, type Asset, type AssetCandidate, type AssetClass } from "../api";
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
  Tabs,
} from "../components/ui";
import { CLASS_COLOR, CLASS_LABEL, CLASS_ORDER, eurPrice, relativeTime, toApiNumber } from "../format";
import { useAssets, useInvalidateAll } from "../queries";

const SOURCE_LABEL: Record<string, string> = {
  yahoo: "Yahoo Finance",
  coingecko: "CoinGecko",
  metal: "Spot",
  fx: "ECB rate",
  manual: "Manual",
};

export function AssetsPage() {
  const assets = useAssets();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const list = (assets.data ?? []).filter((a) => showHidden || !a.hidden);

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="Instruments you can record transactions for, with their price source"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Add asset
          </Button>
        }
      />
      <label className="mb-3 flex items-center gap-1.5 text-sm text-ink-2">
        <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
      </label>
      {assets.isLoading ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4">
          {CLASS_ORDER.map((c) => {
            const rows = list.filter((a) => a.assetClass === c);
            if (!rows.length) return null;
            return (
              <Card
                key={c}
                title={
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-sm" style={{ background: CLASS_COLOR[c] }} aria-hidden />
                    {CLASS_LABEL[c]}
                  </span>
                }
                padded={false}
              >
                <ul className="divide-y divide-line">
                  {rows.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => setEditing(a)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-ink">
                            {a.name} {a.hidden && <Badge>hidden</Badge>}
                          </div>
                          <div className="truncate text-xs text-muted">
                            {a.symbol}
                            {a.isin && ` · ${a.isin}`} · {SOURCE_LABEL[a.priceSource]}
                            {a.priceRef && a.priceSource !== "fx" && a.priceSource !== "metal" && ` (${a.priceRef})`}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="tabular text-ink">
                            {a.price ? eurPrice(a.price.priceEur) : <span className="text-muted">no price</span>}
                            {a.unit === "g" && a.price ? "/g" : ""}
                          </div>
                          <div className="text-xs text-muted">
                            {a.price && a.price.currency !== "EUR" && `${eurPrice(a.price.price, a.price.currency)} · `}
                            {a.price ? relativeTime(a.price.fetchedAt) : ""}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      {adding && <AddAssetModal onClose={() => setAdding(false)} />}
      {editing && <EditAssetModal asset={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

type Mode = "securities" | "crypto" | "cash" | "manual";

function AddAssetModal({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidateAll();
  const [mode, setMode] = useState<Mode>("securities");
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState({
    name: "",
    symbol: "",
    assetClass: "other" as AssetClass,
    currency: "EUR",
    isin: "",
  });
  const [cashCurrency, setCashCurrency] = useState("USD");

  const search = useQuery({
    queryKey: ["asset-search", mode, submittedQ],
    queryFn: () => get<AssetCandidate[]>(`/api/assets/search?kind=${mode}&q=${encodeURIComponent(submittedQ)}`),
    enabled: (mode === "securities" || mode === "crypto") && submittedQ.length > 0,
    staleTime: 5 * 60_000,
  });

  const create = async (body: object, key: string) => {
    setBusy(key);
    setError(undefined);
    try {
      await post("/api/assets", body);
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setSubmittedQ(q.trim());
  };

  return (
    <Modal open onClose={onClose} title="Add asset" wide>
      <div className="mb-4">
        <Tabs
          value={mode}
          onChange={(m) => {
            setMode(m);
            setSubmittedQ("");
            setQ("");
            setError(undefined);
          }}
          options={[
            { value: "securities", label: "Stock / ETF" },
            { value: "crypto", label: "Crypto" },
            { value: "cash", label: "Cash" },
            { value: "manual", label: "Manual" },
          ]}
        />
      </div>

      {(mode === "securities" || mode === "crypto") && (
        <>
          <form onSubmit={submitSearch} className="flex gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={mode === "securities" ? "Name, ticker or ISIN (e.g. IE00B4L5Y983)" : "Coin name or symbol"}
              autoFocus
              aria-label="Search"
            />
            <Button type="submit" variant="primary">
              Search
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            {mode === "securities"
              ? "Prices come from Yahoo Finance. Pick the listing on the exchange you actually trade (e.g. .AS Amsterdam, .DE Xetra) — the quote currency is detected automatically."
              : "Prices come from CoinGecko (in EUR)."}
          </p>
          <div className="mt-3">
            {search.isFetching && <Spinner />}
            {search.error && <Alert tone="danger">{(search.error as Error).message}</Alert>}
            {search.data && search.data.length === 0 && <Empty title="No matches" />}
            {search.data && search.data.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {search.data.map((c) => (
                  <li key={c.priceRef} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{c.name}</div>
                      <div className="text-xs text-muted">
                        {c.priceRef}
                        {c.exchange && ` · ${c.exchange}`} · {CLASS_LABEL[c.assetClass]}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => create({ ...c, isin: c.isin ?? null }, c.priceRef)}
                    >
                      {busy === c.priceRef ? "Adding…" : "Add"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {mode === "cash" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(
              {
                assetClass: "cash",
                name: `Cash ${cashCurrency}`,
                symbol: cashCurrency,
                priceSource: "fx",
                currency: cashCurrency,
              },
              "cash",
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm text-ink-2">
            A EUR cash asset exists already. Add other currencies to track cash balances held at brokers or banks; they
            are valued at the ECB rate.
          </p>
          <Field label="Currency">
            {(id) => (
              <Input
                id={id}
                value={cashCurrency}
                maxLength={3}
                onChange={(e) => setCashCurrency(e.target.value.toUpperCase())}
                required
              />
            )}
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={busy !== null}>
              Add cash asset
            </Button>
          </div>
        </form>
      )}

      {mode === "manual" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create({ ...manual, isin: manual.isin || null, priceSource: "manual" }, "manual");
          }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <p className="text-sm text-ink-2 sm:col-span-2">
            For anything without a free price feed (unlisted shares, collectibles). You set its price yourself.
          </p>
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                value={manual.name}
                onChange={(e) => setManual({ ...manual, name: e.target.value })}
                required
              />
            )}
          </Field>
          <Field label="Symbol">
            {(id) => (
              <Input
                id={id}
                value={manual.symbol}
                onChange={(e) => setManual({ ...manual, symbol: e.target.value })}
                required
              />
            )}
          </Field>
          <Field label="Class">
            {(id) => (
              <Select
                id={id}
                value={manual.assetClass}
                onChange={(e) => setManual({ ...manual, assetClass: e.target.value as AssetClass })}
              >
                {CLASS_ORDER.filter((c) => c !== "metal" && c !== "cash").map((c) => (
                  <option key={c} value={c}>
                    {CLASS_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Currency">
            {(id) => (
              <Input
                id={id}
                value={manual.currency}
                maxLength={3}
                onChange={(e) => setManual({ ...manual, currency: e.target.value.toUpperCase() })}
                required
              />
            )}
          </Field>
          <Field label="ISIN (optional)">
            {(id) => (
              <Input id={id} value={manual.isin} onChange={(e) => setManual({ ...manual, isin: e.target.value })} />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" disabled={busy !== null}>
              Add asset
            </Button>
          </div>
        </form>
      )}

      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}

function EditAssetModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const invalidate = useInvalidateAll();
  const [f, setF] = useState({
    name: asset.name,
    symbol: asset.symbol,
    isin: asset.isin ?? "",
    priceRef: asset.priceRef ?? "",
    hidden: asset.hidden,
  });
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string>();
  const builtin = asset.priceSource === "metal" || (asset.priceSource === "fx" && asset.priceRef === "EUR");
  const editableRef = asset.priceSource === "yahoo" || asset.priceSource === "coingecko";

  const run = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await put(`/api/assets/${asset.id}`, {
        name: f.name,
        symbol: f.symbol,
        isin: f.isin || null,
        hidden: f.hidden,
        ...(editableRef ? { priceRef: f.priceRef } : {}),
      });
      if (price)
        await post(`/api/assets/${asset.id}/price`, { price: toApiNumber(price, "Price"), currency: asset.currency });
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${asset.symbol}`}
      footer={
        <>
          {!builtin && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => confirm(`Delete ${asset.name}?`) && run(() => del(`/api/assets/${asset.id}`))}
            >
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="asset-form">
            Save
          </Button>
        </>
      }
    >
      <form id="asset-form" onSubmit={save} className="flex flex-col gap-3">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              required
              disabled={builtin}
            />
          )}
        </Field>
        <Field label="Symbol">
          {(id) => (
            <Input
              id={id}
              value={f.symbol}
              onChange={(e) => setF({ ...f, symbol: e.target.value })}
              required
              disabled={builtin}
            />
          )}
        </Field>
        {!builtin && (
          <Field label="ISIN">
            {(id) => <Input id={id} value={f.isin} onChange={(e) => setF({ ...f, isin: e.target.value })} />}
          </Field>
        )}
        {editableRef && (
          <Field
            label={asset.priceSource === "yahoo" ? "Yahoo ticker" : "CoinGecko id"}
            hint="Change only if the price feed is wrong"
          >
            {(id) => (
              <Input id={id} value={f.priceRef} onChange={(e) => setF({ ...f, priceRef: e.target.value })} required />
            )}
          </Field>
        )}
        {asset.priceSource === "manual" && (
          <Field
            label={`Current price (${asset.currency})`}
            hint={
              asset.price
                ? `Last set ${relativeTime(asset.price.fetchedAt)}: ${eurPrice(asset.price.price, asset.currency)}`
                : "Not set yet"
            }
          >
            {(id) => <AmountInput id={id} value={price} onChange={(e) => setPrice(e.target.value)} />}
          </Field>
        )}
        {!builtin && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={f.hidden} onChange={(e) => setF({ ...f, hidden: e.target.checked })} />{" "}
            Hidden: left out of totals and forms (e.g. spam tokens)
          </label>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Modal>
  );
}
