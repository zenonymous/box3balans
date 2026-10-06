import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, del, get, post, type TxType } from "../api";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Tabs, cx } from "../components/ui";
import { CLASS_LABEL, TX_LABEL, date, eurPrice, num, relativeTime } from "../format";
import { useAccounts, useAssets, useInvalidateAll } from "../queries";
import { readText } from "../files";

// ---- Types mirroring /api/import ----

type Field =
  | "date"
  | "time"
  | "type"
  | "symbol"
  | "isin"
  | "name"
  | "assetType"
  | "quantity"
  | "price"
  | "total"
  | "currency"
  | "fee"
  | "amount"
  | "tax"
  | "notes"
  | "id";
type CsvType = Exclude<TxType, "transfer_in" | "transfer_out">;
const CSV_TYPES: CsvType[] = ["buy", "sell", "deposit", "withdrawal", "dividend", "reward", "fee", "split"];

interface Mapping {
  skipRows: number;
  delimiter: "," | ";" | "\t" | "|" | null;
  decimal: "auto" | "." | ",";
  dateOrder: "auto" | "YMD" | "DMY" | "MDY";
  columns: Record<Field, number | null>;
  typeMode: "column" | "fixed" | "sign";
  fixedType: CsvType;
  typeValues: Record<string, CsvType | "skip">;
  assetKind: "auto" | "security" | "crypto" | "metal";
  defaultCurrency: string;
  feeCurrency: "trade" | "EUR";
  settleCash: boolean;
  assetOverrides: Record<string, number>;
}

type RowStatus = "new" | "duplicate" | "deleted" | "possible-duplicate" | "skipped" | "error";

interface PlannedRow {
  line: number;
  status: RowStatus;
  message?: string;
  duplicateOf?: number;
  date?: string;
  type?: CsvType;
  assetKey?: string;
  quantity?: string;
  price?: string;
  currency?: string;
  fee?: string;
  amount?: string;
  tax?: string;
  notes?: string;
}

interface Plan {
  headers: string[];
  sample: string[][];
  detected: { delimiter: string; decimal: "." | ","; dateOrder: "YMD" | "DMY" | "MDY" };
  typeValues: { value: string; count: number }[];
  rows: PlannedRow[];
  assets: {
    key: string;
    label: string;
    rows: number;
    match: {
      id: number;
      symbol: string;
      name: string;
      assetClass: string;
      priceSource: string;
      priceRef: string | null;
    };
    overridden: boolean;
  }[];
  summary: Record<RowStatus, number>;
  warnings: string[];
}

interface Upload {
  uploadId: string;
  fileName: string;
  mapping: Mapping;
  preset: string | null;
}

interface CommitResult {
  importId: number | null;
  inserted: number;
  skipped: number;
  newAssets: string[];
  warnings: string[];
  transfersMatched: number;
}

interface PastImport {
  id: number;
  accountName: string;
  fileName: string;
  rows: number;
  inserted: number;
  remaining: number;
  createdAt: string;
}

// ---- Labels ----

const FIELD_INFO: { field: Exclude<Field, "type">; label: string; hint?: string }[] = [
  { field: "date", label: "Date", hint: "Date, or date and time" },
  { field: "time", label: "Time", hint: "Only when the time has its own column" },
  { field: "symbol", label: "Symbol / ticker", hint: "e.g. IWDA or BTC; a currency code for cash rows" },
  { field: "isin", label: "ISIN", hint: "The surest way to find a stock or ETF" },
  { field: "name", label: "Name / product", hint: "Used when there's no symbol" },
  { field: "quantity", label: "Quantity", hint: "Shares, coins or grams; the amount for cash rows" },
  { field: "price", label: "Price per unit", hint: "In the row's currency" },
  { field: "total", label: "Total", hint: "Value before fees, used when there's no price" },
  { field: "currency", label: "Currency", hint: "Of the price and fee" },
  { field: "fee", label: "Fee" },
  { field: "amount", label: "Dividend amount", hint: "Gross, before withholding tax" },
  { field: "tax", label: "Tax withheld" },
  { field: "assetType", label: "Asset type", hint: "stock, etf, crypto, metal or cash per row" },
  { field: "notes", label: "Notes / description" },
  { field: "id", label: "Transaction ID", hint: "Recognises the same rows in later exports" },
];

const STATUS: Record<RowStatus, { label: string; tone: "neutral" | "warn" | "danger" | "accent" }> = {
  new: { label: "New", tone: "accent" },
  duplicate: { label: "Already imported", tone: "neutral" },
  deleted: { label: "Deleted before", tone: "neutral" },
  "possible-duplicate": { label: "Possible duplicate", tone: "warn" },
  skipped: { label: "Skipped", tone: "neutral" },
  error: { label: "Problem", tone: "danger" },
};

const DELIMITER_LABEL: Record<string, string> = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" };
const ORDER_LABEL = { YMD: "year-month-day", DMY: "day-month-year", MDY: "month-day-year" };

const letter = (i: number): string =>
  i < 26 ? String.fromCharCode(65 + i) : `${letter(Math.floor(i / 26) - 1)}${letter(i % 26)}`;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// ---- Page ----

export function ImportPage() {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [upload, setUpload] = useState<Upload | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateAll();

  const reset = () => {
    setUpload(null);
    setMapping(null);
    setInclude(new Set());
    setResult(null);
    setError(undefined);
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setBusy(true);
    try {
      const content = await readText(file);
      const up = await post<Upload>("/api/import/upload", { fileName: file.name, content });
      setUpload(up);
      setMapping(up.mapping);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const debounced = useDebounced(mapping, 350);
  const plan = useQuery({
    queryKey: ["import-preview", upload?.uploadId, accountId, JSON.stringify(debounced)],
    queryFn: () =>
      post<Plan>("/api/import/preview", {
        uploadId: upload!.uploadId,
        accountId: Number(accountId),
        mapping: debounced,
      }),
    enabled: !!upload && !!accountId && !!debounced && !result,
    placeholderData: (prev) => prev,
    retry: false,
  });
  const expired = !result && plan.error instanceof ApiError && plan.error.status === 410;

  const commit = async () => {
    if (!upload || !mapping) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await post<CommitResult>("/api/import/commit", {
        uploadId: upload.uploadId,
        accountId: Number(accountId),
        mapping,
        include: [...include],
      });
      setResult(r);
      invalidate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toImport = plan.data ? plan.data.summary.new + include.size : 0;
  const account = accounts.data?.find((a) => String(a.id) === accountId);

  return (
    <>
      <PageHeader
        title="Import CSV"
        subtitle="Transactions from a broker or exchange export, or from the Kluishuis template"
        actions={
          <a
            href="/api/import/template.csv"
            className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
          >
            ↓ Template
          </a>
        }
      />

      <div className="flex flex-col gap-4">
        <Card title="1 · Account and file">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Import into account" hint="Each file goes into one account.">
              {(id) => (
                <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Choose…</option>
                  {accounts.data
                    ?.filter((a) => !a.archived)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field
              label="CSV file"
              hint={
                upload?.preset
                  ? `Using your saved settings “${upload.preset}”`
                  : "Exported from your broker, exchange or spreadsheet"
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  disabled={busy}
                  onChange={(e) => void choose(e.target.files?.[0])}
                  className="file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-2.5 file:py-1 file:text-sm file:text-ink"
                />
              )}
            </Field>
          </div>
          {error && (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          {expired && (
            <div className="mt-3">
              <Alert>The uploaded file has expired. Choose it again.</Alert>
            </div>
          )}
        </Card>

        {result ? (
          <ResultCard result={result} accountName={account?.name ?? ""} onAgain={reset} />
        ) : (
          upload &&
          mapping &&
          accountId && (
            <>
              <MappingCard
                mapping={mapping}
                setMapping={setMapping}
                plan={plan.data}
                uploadHeaders={plan.data?.headers ?? []}
              />
              <ReviewCard
                plan={plan.data}
                loading={plan.isFetching}
                error={plan.error && !expired ? (plan.error as Error).message : undefined}
                mapping={mapping}
                setMapping={setMapping}
                include={include}
                setInclude={setInclude}
              />
              <div className="flex flex-wrap items-center justify-end gap-3">
                {plan.data && plan.data.summary.error > 0 && (
                  <span className="text-sm text-ink-2">Rows with problems are left out.</span>
                )}
                <Button
                  variant="primary"
                  onClick={() => void commit()}
                  disabled={busy || plan.isFetching || toImport === 0}
                >
                  {busy ? "Importing…" : `Import ${toImport} transaction${toImport === 1 ? "" : "s"}`}
                </Button>
              </div>
            </>
          )
        )}

        <PastImports />
      </div>
    </>
  );
}

function ColumnSelect({
  id,
  value,
  headers,
  sample,
  onChange,
}: {
  id: string;
  value: number | null;
  headers: string[];
  sample: string[][];
  onChange: (v: number | null) => void;
}) {
  return (
    <Select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      <option value="">— not in the file —</option>
      {headers.map((h, i) => {
        const example = sample.find((r) => r[i])?.[i];
        return (
          <option key={i} value={i}>
            {letter(i)} · {h || "(no header)"}
            {example ? ` — e.g. ${example.slice(0, 24)}` : ""}
          </option>
        );
      })}
    </Select>
  );
}

function MappingCard({
  mapping,
  setMapping,
  plan,
  uploadHeaders,
}: {
  mapping: Mapping;
  setMapping: (m: Mapping) => void;
  plan: Plan | undefined;
  uploadHeaders: string[];
}) {
  const set = <K extends keyof Mapping>(k: K, v: Mapping[K]) => setMapping({ ...mapping, [k]: v });
  const setCol = (f: Field, v: number | null) => setMapping({ ...mapping, columns: { ...mapping.columns, [f]: v } });
  const headers = plan?.headers ?? uploadHeaders;
  const sample = plan?.sample ?? [];
  const [showAll, setShowAll] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [saved, setSaved] = useState<string>();
  const unmappedTypes = plan?.typeValues.filter((t) => !mapping.typeValues[t.value] && !knownWord(t.value)) ?? [];

  const visible = FIELD_INFO.filter(
    (f) =>
      showAll || mapping.columns[f.field] != null || ["date", "symbol", "isin", "quantity", "price"].includes(f.field),
  );

  const savePreset = async () => {
    await post("/api/import/presets", { name: presetName.trim(), headers, mapping });
    setSaved(presetName.trim());
    setPresetName("");
  };

  return (
    <Card title="2 · Columns">
      {plan && (
        <p className="mb-4 text-sm text-ink-2">
          Read as {DELIMITER_LABEL[plan.detected.delimiter] ?? plan.detected.delimiter}-separated, with{" "}
          {plan.detected.decimal === "," ? "decimal commas" : "decimal points"} and dates as{" "}
          {ORDER_LABEL[plan.detected.dateOrder]}. {headers.length} columns, {plan.rows.length} rows.
        </p>
      )}

      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((f) => (
          <Field key={f.field} label={f.label} hint={f.hint}>
            {(id) => (
              <ColumnSelect
                id={id}
                value={mapping.columns[f.field]}
                headers={headers}
                sample={sample}
                onChange={(v) => setCol(f.field, v)}
              />
            )}
          </Field>
        ))}
      </div>
      {!showAll && visible.length < FIELD_INFO.length && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(true)}>
          More columns: time, fee, dividend, notes, ID…
        </Button>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold">Transaction type</h3>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Comes from">
          {(id) => (
            <Select
              id={id}
              value={mapping.typeMode}
              onChange={(e) => set("typeMode", e.target.value as Mapping["typeMode"])}
            >
              <option value="column">A column</option>
              <option value="fixed">Same for every row</option>
              <option value="sign">Quantity sign: positive buy, negative sell</option>
            </Select>
          )}
        </Field>
        {mapping.typeMode === "column" && (
          <Field label="Type column">
            {(id) => (
              <ColumnSelect
                id={id}
                value={mapping.columns.type}
                headers={headers}
                sample={sample}
                onChange={(v) => setCol("type", v)}
              />
            )}
          </Field>
        )}
        {mapping.typeMode === "fixed" && (
          <Field label="Every row is a">
            {(id) => (
              <Select id={id} value={mapping.fixedType} onChange={(e) => set("fixedType", e.target.value as CsvType)}>
                {CSV_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TX_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      {mapping.typeMode === "column" && plan && plan.typeValues.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full max-w-xl text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-2">
                <th className="py-1 pr-3 font-medium">Value in the file</th>
                <th className="py-1 pr-3 font-medium">Rows</th>
                <th className="py-1 font-medium">Means</th>
              </tr>
            </thead>
            <tbody>
              {plan.typeValues.map((t) => {
                const current = mapping.typeValues[t.value] ?? knownWord(t.value) ?? "";
                return (
                  <tr key={t.value} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-mono text-xs">{t.value || "(empty)"}</td>
                    <td className="py-1.5 pr-3 tabular text-ink-2">{t.count}</td>
                    <td className="py-1">
                      <Select
                        aria-label={`Meaning of ${t.value}`}
                        value={current}
                        className={cx("py-1", !current && "border-warn")}
                        onChange={(e) =>
                          set("typeValues", { ...mapping.typeValues, [t.value]: e.target.value as CsvType | "skip" })
                        }
                      >
                        <option value="">Choose…</option>
                        {CSV_TYPES.map((ty) => (
                          <option key={ty} value={ty}>
                            {TX_LABEL[ty]}
                          </option>
                        ))}
                        <option value="skip">Skip these rows</option>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {unmappedTypes.length > 0 && (
            <p className="mt-2 text-xs text-warn">Choose a meaning for each value; rows without one aren't imported.</p>
          )}
        </div>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold">Reading the file</h3>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Symbols are" hint="Automatic goes by the account kind; an ISIN or asset type column overrides it">
          {(id) => (
            <Select
              id={id}
              value={mapping.assetKind}
              onChange={(e) => set("assetKind", e.target.value as Mapping["assetKind"])}
            >
              <option value="auto">Automatic</option>
              <option value="security">Stocks and ETFs</option>
              <option value="crypto">Crypto</option>
              <option value="metal">Precious metals (grams)</option>
            </Select>
          )}
        </Field>
        <Field label="Currency" hint="For rows without a currency column">
          {(id) => (
            <Input
              id={id}
              value={mapping.defaultCurrency}
              maxLength={3}
              onChange={(e) => set("defaultCurrency", e.target.value.toUpperCase())}
            />
          )}
        </Field>
        <Field label="Fees are in">
          {(id) => (
            <Select
              id={id}
              value={mapping.feeCurrency}
              onChange={(e) => set("feeCurrency", e.target.value as "trade" | "EUR")}
            >
              <option value="trade">The trade's currency</option>
              <option value="EUR">Always EUR</option>
            </Select>
          )}
        </Field>
        <Field label="Lines before the header">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={50}
              value={mapping.skipRows}
              onChange={(e) => set("skipRows", Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
            />
          )}
        </Field>
        <Field label="Separator">
          {(id) => (
            <Select
              id={id}
              value={mapping.delimiter ?? ""}
              onChange={(e) => set("delimiter", (e.target.value || null) as Mapping["delimiter"])}
            >
              <option value="">Automatic</option>
              <option value=",">Comma</option>
              <option value=";">Semicolon</option>
              <option value={"\t"}>Tab</option>
              <option value="|">Pipe</option>
            </Select>
          )}
        </Field>
        <Field label="Decimal mark">
          {(id) => (
            <Select
              id={id}
              value={mapping.decimal}
              onChange={(e) => set("decimal", e.target.value as Mapping["decimal"])}
            >
              <option value="auto">Automatic</option>
              <option value=",">Comma (1.234,56)</option>
              <option value=".">Point (1,234.56)</option>
            </Select>
          )}
        </Field>
        <Field label="Dates">
          {(id) => (
            <Select
              id={id}
              value={mapping.dateOrder}
              onChange={(e) => set("dateOrder", e.target.value as Mapping["dateOrder"])}
            >
              <option value="auto">Automatic</option>
              <option value="DMY">Day-month-year</option>
              <option value="MDY">Month-day-year</option>
              <option value="YMD">Year-month-day</option>
            </Select>
          )}
        </Field>
        <label className="flex items-start gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={mapping.settleCash}
            onChange={(e) => set("settleCash", e.target.checked)}
          />
          <span>
            Book cash for buys, sells and dividends
            <span className="block text-xs text-muted">Only when the file also has the deposits</span>
          </span>
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <Field label="Save these settings for next time" hint="Files with the same columns then use them automatically">
          {(id) => (
            <Input
              id={id}
              placeholder="e.g. DEGIRO transactions"
              value={presetName}
              maxLength={60}
              onChange={(e) => setPresetName(e.target.value)}
            />
          )}
        </Field>
        <Button onClick={() => void savePreset()} disabled={!presetName.trim()} className="mb-[1px]">
          Save
        </Button>
        {saved && <span className="mb-2 text-xs text-ink-2">Saved as “{saved}”</span>}
      </div>
    </Card>
  );
}

// Words the server maps without help (mirrors knownType on the server, for the UI only).
const KNOWN: Record<string, CsvType> = {
  buy: "buy",
  bought: "buy",
  koop: "buy",
  aankoop: "buy",
  sell: "sell",
  sold: "sell",
  verkoop: "sell",
  deposit: "deposit",
  storting: "deposit",
  withdrawal: "withdrawal",
  withdraw: "withdrawal",
  opname: "withdrawal",
  dividend: "dividend",
  reward: "reward",
  staking: "reward",
  "staking reward": "reward",
  interest: "reward",
  rente: "reward",
  fee: "fee",
  split: "split",
};
const knownWord = (v: string): CsvType | undefined =>
  KNOWN[
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  ];

function ReviewCard({
  plan,
  loading,
  error,
  mapping,
  setMapping,
  include,
  setInclude,
}: {
  plan: Plan | undefined;
  loading: boolean;
  error?: string;
  mapping: Mapping;
  setMapping: (m: Mapping) => void;
  include: Set<number>;
  setInclude: (s: Set<number>) => void;
}) {
  const assets = useAssets();
  const [filter, setFilter] = useState<"all" | RowStatus>("all");
  const [limit, setLimit] = useState(100);
  const assetLabel = useMemo(() => new Map(plan?.assets.map((a) => [a.key, a.match.symbol || a.label]) ?? []), [plan]);
  if (error) {
    return (
      <Card title="3 · Review">
        <Alert tone="danger">{error}</Alert>
      </Card>
    );
  }
  if (!plan) {
    return (
      <Card title="3 · Review">
        <p className="text-sm text-ink-2">{loading ? "Reading the file…" : "Choose an account to see the preview."}</p>
      </Card>
    );
  }
  const rows = plan.rows.filter((r) => filter === "all" || r.status === filter);
  const toggle = (line: number) => {
    const s = new Set(include);
    if (s.has(line)) s.delete(line);
    else s.add(line);
    setInclude(s);
  };
  const override = (key: string, id: string) => {
    const next = { ...mapping.assetOverrides };
    if (id) next[key] = Number(id);
    else delete next[key];
    setMapping({ ...mapping, assetOverrides: next });
  };
  const counts = (Object.keys(STATUS) as RowStatus[]).filter((s) => plan.summary[s] > 0);

  return (
    <Card title="3 · Review" actions={loading ? <span className="text-xs text-muted">Updating…</span> : undefined}>
      <div className="mb-4 flex flex-wrap gap-2">
        {counts.map((s) => (
          <Badge key={s} tone={STATUS[s].tone}>
            {plan.summary[s]} {STATUS[s].label.toLowerCase()}
          </Badge>
        ))}
      </div>
      {plan.warnings.map((w) => (
        <div key={w} className="mb-2">
          <Alert>{w}</Alert>
        </div>
      ))}

      {plan.assets.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold">Assets</h3>
          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-2">
                  <th className="py-1 pr-3 font-medium">In the file</th>
                  <th className="py-1 pr-3 font-medium">Rows</th>
                  <th className="py-1 pr-3 font-medium">Booked on</th>
                  <th className="py-1 font-medium">Use another asset</th>
                </tr>
              </thead>
              <tbody>
                {plan.assets.map((a) => (
                  <tr key={a.key} className="border-t border-line align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{a.label}</td>
                    <td className="py-2 pr-3 tabular text-ink-2">{a.rows}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{a.match.name}</span>
                        <span className="text-ink-2">{a.match.symbol}</span>
                        {a.match.id < 0 ? <Badge tone="accent">new</Badge> : <Badge>existing</Badge>}
                      </div>
                      <div className="text-xs text-muted">
                        {CLASS_LABEL[a.match.assetClass] ?? a.match.assetClass} ·{" "}
                        {a.match.priceSource === "manual"
                          ? "no price feed found (manual price)"
                          : `${a.match.priceSource} ${a.match.priceRef ?? ""}`}
                      </div>
                    </td>
                    <td className="py-1.5">
                      <Select
                        aria-label={`Asset for ${a.label}`}
                        value={mapping.assetOverrides[a.key] ?? ""}
                        className="py-1"
                        onChange={(e) => override(a.key, e.target.value)}
                      >
                        <option value="">As matched</option>
                        {assets.data
                          ?.filter((x) => !x.hidden)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.symbol} · {x.name}
                            </option>
                          ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Rows</h3>
        <Tabs
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setLimit(100);
          }}
          options={[
            { value: "all" as const, label: `All ${plan.rows.length}` },
            ...counts.map((s) => ({ value: s, label: `${STATUS[s].label} ${plan.summary[s]}` })),
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <Empty title="No rows" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-2">
                <th className="py-1 pr-2 font-medium">Line</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Type</th>
                <th className="py-1 pr-2 font-medium">Asset</th>
                <th className="py-1 pr-2 text-right font-medium">Quantity</th>
                <th className="py-1 pr-2 text-right font-medium">Price</th>
                <th className="py-1 pr-2 text-right font-medium">Fee</th>
                <th className="py-1 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <tr key={r.line} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 tabular text-ink-2">{r.line}</td>
                  <td className="py-1.5 pr-2">
                    {r.status === "possible-duplicate" ? (
                      <label className="flex items-center gap-1.5 whitespace-nowrap">
                        <input type="checkbox" checked={include.has(r.line)} onChange={() => toggle(r.line)} />
                        <Badge tone="warn">Import anyway</Badge>
                      </label>
                    ) : (
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{r.date ? date(r.date) : "—"}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{r.type ? TX_LABEL[r.type] : "—"}</td>
                  <td className="py-1.5 pr-2">{r.assetKey ? assetLabel.get(r.assetKey) : "—"}</td>
                  <td className="py-1.5 pr-2 text-right tabular">{r.quantity ? num(r.quantity) : ""}</td>
                  <td className="py-1.5 pr-2 text-right tabular whitespace-nowrap">
                    {r.price ? eurPrice(r.price, r.currency) : ""}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular">{r.fee ? num(r.fee) : ""}</td>
                  <td className="py-1.5 text-xs text-ink-2">
                    <Details row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit(limit + 200)}>
              Show more ({rows.length - limit} left)
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function Details({ row: r }: { row: PlannedRow }) {
  const parts: ReactNode[] = [];
  if (r.amount) parts.push(`gross ${eurPrice(r.amount, r.currency)}`);
  if (r.tax) parts.push(`tax ${eurPrice(r.tax, r.currency)}`);
  if (r.message) parts.push(<span className={r.status === "error" ? "text-loss" : undefined}>{r.message}</span>);
  if (r.notes) parts.push(r.notes);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
    </>
  );
}

function ResultCard({
  result,
  accountName,
  onAgain,
}: {
  result: CommitResult;
  accountName: string;
  onAgain: () => void;
}) {
  return (
    <Card title="Imported">
      <p className="text-sm">
        {result.inserted} transaction{result.inserted === 1 ? "" : "s"} added to <strong>{accountName}</strong>
        {result.transfersMatched > 0 &&
          `, and ${result.transfersMatched} transfer${result.transfersMatched === 1 ? "" : "s"} to or from your other accounts linked`}
        .
      </p>
      {result.newAssets.length > 0 && (
        <p className="mt-2 text-sm text-ink-2">
          New assets: {result.newAssets.join(", ")}. If one was matched to the wrong price feed, fix it under{" "}
          <Link to="/assets" className="underline">
            Assets
          </Link>
          .
        </p>
      )}
      {result.warnings.map((w) => (
        <div key={w} className="mt-2">
          <Alert>{w}</Alert>
        </div>
      ))}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/transactions"
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          View transactions
        </Link>
        <Button onClick={onAgain}>Import another file</Button>
      </div>
    </Card>
  );
}

function PastImports() {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const list = useQuery({ queryKey: ["imports"], queryFn: () => get<PastImport[]>("/api/imports") });
  const [undoing, setUndoing] = useState<PastImport | null>(null);
  const [busy, setBusy] = useState(false);
  if (!list.data?.length) return null;

  const undo = async () => {
    if (!undoing) return;
    setBusy(true);
    try {
      await del(`/api/imports/${undoing.id}`);
      setUndoing(null);
      invalidate();
      await qc.invalidateQueries({ queryKey: ["imports"] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Earlier imports" padded={false}>
      <ul className="divide-y divide-line">
        {list.data.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <div>
              <div className="font-medium">{i.fileName}</div>
              <div className="text-xs text-ink-2">
                {i.accountName} · {relativeTime(i.createdAt)} · {i.inserted} imported
                {i.remaining !== i.inserted && `, ${i.remaining} still there`}
              </div>
            </div>
            <Button size="sm" variant="danger" onClick={() => setUndoing(i)}>
              Undo
            </Button>
          </li>
        ))}
      </ul>
      <Modal
        open={!!undoing}
        onClose={() => setUndoing(null)}
        title="Undo this import?"
        footer={
          <>
            <Button onClick={() => setUndoing(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void undo()} disabled={busy}>
              Delete {undoing?.remaining} transactions
            </Button>
          </>
        }
      >
        <p className="text-sm">
          This deletes the {undoing?.remaining} transactions that “{undoing?.fileName}” added to {undoing?.accountName}.
          Transfers they were linked to become plain deposits or withdrawals again. You can import the file again
          afterwards.
        </p>
      </Modal>
    </Card>
  );
}
