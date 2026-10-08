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
import { CLASS_COLOR, CLASS_LABEL, CLASS_ORDER, eurPrice, relativeTime, toApiNumber, toInputNumber } from "../format";
import { useAssets, useInvalidateAll } from "../queries";
import { t } from "../i18n";

const SOURCE_LABEL: Record<string, string> = {
  yahoo: "Yahoo Finance",
  coingecko: "CoinGecko",
  metal: t("Spot"),
  fx: t("ECB rate"),
  manual: t("Manual"),
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
        title={t("Assets")}
        subtitle={t("Instruments you can record transactions for, with their price source")}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t("+ Add asset")}
          </Button>
        }
      />
      <label className="mb-3 flex items-center gap-1.5 text-sm text-ink-2">
        <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />{" "}
        {t("Show hidden")}
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
                            {a.name} {a.hidden && <Badge>{t("hidden")}</Badge>}
                          </div>
                          <div className="truncate text-xs text-muted">
                            {a.symbol}
                            {a.isin && ` · ${a.isin}`} · {SOURCE_LABEL[a.priceSource]}
                            {a.priceRef && a.priceSource !== "fx" && a.priceSource !== "metal" && ` (${a.priceRef})`}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="tabular text-ink">
                            {a.price ? eurPrice(a.price.priceEur) : <span className="text-muted">{t("no price")}</span>}
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
    <Modal open onClose={onClose} title={t("Add asset")} wide>
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
            { value: "securities", label: t("Stock / ETF") },
            { value: "crypto", label: t("Crypto") },
            { value: "cash", label: t("Cash") },
            { value: "manual", label: t("Manual") },
          ]}
        />
      </div>

      {(mode === "securities" || mode === "crypto") && (
        <>
          <form onSubmit={submitSearch} className="flex gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                mode === "securities" ? t("Name, ticker or ISIN (e.g. IE00B4L5Y983)") : t("Coin name or symbol")
              }
              autoFocus
              aria-label={t("Search")}
            />
            <Button type="submit" variant="primary">
              {t("Search")}
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            {mode === "securities"
              ? t(
                  "Prices come from Yahoo Finance. Pick the listing on the exchange you actually trade (e.g. .AS Amsterdam, .DE Xetra) — the quote currency is detected automatically.",
                )
              : t("Prices come from CoinGecko (in EUR).")}
          </p>
          <div className="mt-3">
            {search.isFetching && <Spinner />}
            {search.error && <Alert tone="danger">{search.error.message}</Alert>}
            {search.data && search.data.length === 0 && <Empty title={t("No matches")} />}
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
                      {busy === c.priceRef ? t("Adding…") : t("Add")}
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
                name: t("Cash {currency}", { currency: cashCurrency }),
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
            {t(
              "A EUR cash asset exists already. Add other currencies to track cash balances held at brokers or banks; they are valued at the ECB rate.",
            )}
          </p>
          <Field label={t("Currency")}>
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
              {t("Add cash asset")}
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
            {t("For anything without a free price feed (unlisted shares, collectibles). You set its price yourself.")}
          </p>
          <Field label={t("Name")}>
            {(id) => (
              <Input
                id={id}
                value={manual.name}
                onChange={(e) => setManual({ ...manual, name: e.target.value })}
                required
              />
            )}
          </Field>
          <Field label={t("Symbol")}>
            {(id) => (
              <Input
                id={id}
                value={manual.symbol}
                onChange={(e) => setManual({ ...manual, symbol: e.target.value })}
                required
              />
            )}
          </Field>
          <Field label={t("Class")}>
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
          <Field label={t("Currency")}>
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
          <Field label={t("ISIN (optional)")}>
            {(id) => (
              <Input id={id} value={manual.isin} onChange={(e) => setManual({ ...manual, isin: e.target.value })} />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" disabled={busy !== null}>
              {t("Add asset")}
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
    terPct: toInputNumber(asset.terPct?.replace(/\.?0+$/, "") ?? ""),
  });
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string>();
  const builtin = asset.priceSource === "metal" || (asset.priceSource === "fx" && asset.priceRef === "EUR");
  const editableRef = asset.priceSource === "yahoo" || asset.priceSource === "coingecko";
  const isFund = asset.assetClass === "etf";

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
        ...(isFund ? { terPct: f.terPct.trim() ? toApiNumber(f.terPct, t("Running costs")) : null } : {}),
      });
      if (price)
        await post(`/api/assets/${asset.id}/price`, {
          price: toApiNumber(price, t("Price")),
          currency: asset.currency,
        });
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Edit {name}", { name: asset.symbol })}
      footer={
        <>
          {!builtin && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() =>
                confirm(t("Delete {name}?", { name: asset.name })) && run(() => del(`/api/assets/${asset.id}`))
              }
            >
              {t("Delete")}
            </Button>
          )}
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="asset-form">
            {t("Save")}
          </Button>
        </>
      }
    >
      <form id="asset-form" onSubmit={save} className="flex flex-col gap-3">
        <Field label={t("Name")}>
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
        <Field label={t("Symbol")}>
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
            label={asset.priceSource === "yahoo" ? t("Yahoo ticker") : t("CoinGecko id")}
            hint={t("Change only if the price feed is wrong")}
          >
            {(id) => (
              <Input id={id} value={f.priceRef} onChange={(e) => setF({ ...f, priceRef: e.target.value })} required />
            )}
          </Field>
        )}
        {isFund && (
          <Field
            label={t("Running costs per year (TER, %)")}
            hint={t(
              "From the fund's factsheet, e.g. 0,20. Used to estimate what holding it costs (Performance → Costs).",
            )}
          >
            {(id) => <AmountInput id={id} value={f.terPct} onChange={(e) => setF({ ...f, terPct: e.target.value })} />}
          </Field>
        )}
        {asset.priceSource === "manual" && (
          <Field
            label={t("Current price ({currency})", { currency: asset.currency })}
            hint={
              asset.price
                ? t("Last set {when}: {price}", {
                    when: relativeTime(asset.price.fetchedAt),
                    price: eurPrice(asset.price.price, asset.currency),
                  })
                : t("Not set yet")
            }
          >
            {(id) => <AmountInput id={id} value={price} onChange={(e) => setPrice(e.target.value)} />}
          </Field>
        )}
        {!builtin && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={f.hidden} onChange={(e) => setF({ ...f, hidden: e.target.checked })} />{" "}
            {t("Hidden: left out of totals and forms (e.g. spam tokens)")}
          </label>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Modal>
  );
}
