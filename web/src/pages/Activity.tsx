import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../api";
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner, Tabs } from "../components/ui";
import { TX_LABEL, date, relativeTime } from "../format";
import { useInvalidateAll } from "../queries";
import { t } from "../i18n";

export type Entity =
  | "transaction"
  | "asset"
  | "account"
  | "account_years"
  | "person"
  | "metal_item"
  | "import"
  | "integration"
  | "wallet_address";

interface Entry {
  id: number;
  at: string;
  entity: Entity;
  entityId: number;
  action: "create" | "update" | "delete";
  title: string;
  via?: string;
  changes: { fields: { field: string; from: unknown; to: unknown }[]; flags: string[] } | null;
  restorable: boolean;
}

const ENTITY_LABEL: Record<Entity, string> = {
  transaction: t("Transaction"),
  asset: t("Asset"),
  account: t("Account"),
  account_years: t("Values per year"),
  person: t("Household"),
  metal_item: t("Metal item"),
  import: t("CSV import"),
  integration: t("Connection"),
  wallet_address: t("Wallet address"),
};

const FIELD_LABEL: Record<string, string> = {
  occurredAt: t("Date"),
  type: t("Type"),
  quantity: t("Quantity"),
  price: t("Price"),
  currency: t("Currency"),
  notes: t("Notes"),
  name: t("Name"),
  symbol: t("Symbol"),
  kind: t("Type"),
  feeEur: t("Fee (EUR)"),
  fxRate: t("Exchange rate"),
  taxWithheld: t("Tax withheld"),
  amount: t("Dividend amount"),
  accountId: t("Account"),
  assetId: t("Asset"),
  settleAssetId: t("Cash settlement"),
  transferGroup: t("Transfer link"),
  noAutoMatch: t("Never auto-link"),
  priceSource: t("Price source"),
  priceRef: t("Price feed"),
  assetClass: t("Asset class"),
  grossWeightG: t("Weight (g)"),
  purity: t("Purity"),
  product: t("Product"),
  purchaseDate: t("Purchase date"),
  purchasePriceEur: t("Price paid (EUR)"),
  spotValueAtPurchaseEur: t("Spot value at purchase"),
  soldDate: t("Sold on"),
  salePriceEur: t("Sale price (EUR)"),
  includeUnlisted: t("Include unlisted tokens"),
  scriptType: t("Address type"),
  archived: t("Archived"),
  hidden: t("Hidden"),
  tracking: t("Kept with"),
  owner: t("Owner"),
  jointSelfPct: t("Your share (%)"),
  foreign: t("Abroad"),
  birthDate: t("Date of birth"),
  custody: t("Custody"),
  valueEur: t("Value on 1 January"),
  inEur: t("Money in"),
  outEur: t("Money out"),
  incomeEur: t("Income"),
  costsEur: t("Costs"),
  terPct: t("TER (%)"),
};

const FLAG_LABEL: Record<string, string> = {
  unlinked: t("Transfer unlinked"),
  transferUndoneByImport: t("Transfer undone by undoing an import"),
};

const ACTION: Record<Entry["action"], { label: string; tone: "accent" | "neutral" | "danger" }> = {
  create: { label: t("Added"), tone: "accent" },
  update: { label: t("Changed"), tone: "neutral" },
  delete: { label: t("Deleted"), tone: "danger" },
};

/** A field name in words; values per year come as "2024 valueEur". */
function fieldLabel(f: string): string {
  const year = /^(\d{4}) (\w+)$/.exec(f);
  if (year) return `${year[1]} · ${fieldLabel(year[2]!)}`;
  return FIELD_LABEL[f] ?? f.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function value(field: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (field === "transferGroup") return t("linked");
  if (field === "type" && typeof v === "string") return TX_LABEL[v] ?? v;
  if (typeof v === "boolean") return v ? t("yes") : t("no");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    return `${date(d)} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return date(v);
  return String(v);
}

const PAGE = 50;

/** History entries, newest first; filtered to one entity type or a single record. */
export function ActivityList({ entity, entityId, compact }: { entity?: Entity; entityId?: number; compact?: boolean }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<string>();
  const params = new URLSearchParams({ limit: String(PAGE) });
  if (entity) params.set("entity", entity);
  if (entityId) params.set("entityId", String(entityId));
  const list = useInfiniteQuery({
    queryKey: ["activity", params.toString()],
    queryFn: ({ pageParam }) => get<{ total: number; items: Entry[] }>(`/api/activity?${params}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const restore = async (e: Entry) => {
    setError(undefined);
    try {
      await post(`/api/activity/${e.id}/restore`);
      invalidate();
      await qc.invalidateQueries({ queryKey: ["activity"] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (list.isLoading) return <Spinner />;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  if (!items.length) {
    return compact ? (
      <p className="text-sm text-muted">{t("No changes recorded.")}</p>
    ) : (
      <Empty title={t("Nothing recorded yet")}>{t("Changes you make appear here.")}</Empty>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <ul className={compact ? "flex flex-col gap-2" : "divide-y divide-line"}>
        {items.map((e) => (
          <li key={e.id} className={compact ? "text-sm" : "px-4 py-3 text-sm"}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ACTION[e.action].tone}>{ACTION[e.action].label}</Badge>
              {!compact && <span className="text-xs text-ink-2">{ENTITY_LABEL[e.entity] ?? e.entity}</span>}
              <span className="font-medium">{compact && e.action === "update" ? "" : e.title}</span>
              {e.via && (
                <span className="text-xs text-muted">
                  {e.via === "restore"
                    ? t("restored")
                    : e.via === "sync"
                      ? t("by a sync")
                      : e.via === "import"
                        ? t("by an import")
                        : e.via}
                </span>
              )}
              <span className="ml-auto text-xs text-muted" title={new Date(e.at).toLocaleString()}>
                {relativeTime(e.at)}
              </span>
              {e.restorable && (
                <Button size="sm" onClick={() => void restore(e)}>
                  {t("Restore")}
                </Button>
              )}
            </div>
            {e.changes && (e.changes.fields.length > 0 || e.changes.flags.length > 0) && (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-2">
                {e.changes.fields.map((c) => (
                  <li key={c.field}>
                    {fieldLabel(c.field)}: <span className="text-muted line-through">{value(c.field, c.from)}</span> →{" "}
                    <span className="text-ink">{value(c.field, c.to)}</span>
                  </li>
                ))}
                {e.changes.flags
                  .filter((f) => FLAG_LABEL[f])
                  .map((f) => (
                    <li key={f}>{FLAG_LABEL[f]}</li>
                  ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <div className={compact ? "mt-2" : "border-t border-line px-4 py-2"}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            {t("Show older")}
          </Button>
        </div>
      )}
    </>
  );
}

const FILTERS: { value: "all" | Entity; label: string }[] = [
  { value: "all", label: t("Everything") },
  { value: "transaction", label: t("Transactions") },
  { value: "metal_item", label: t("Metals") },
  { value: "asset", label: t("Assets") },
  { value: "account", label: t("Accounts") },
  { value: "account_years", label: t("Values per year") },
  { value: "person", label: t("Household") },
  { value: "import", label: t("Imports") },
];

export function ActivityPage() {
  const [filter, setFilter] = useState<"all" | Entity>("all");
  return (
    <>
      <PageHeader
        title={t("History")}
        subtitle={t(
          "Every change you made, and what syncs and imports changed. Deleted transactions and metal items can be restored.",
        )}
      />
      <div className="mb-3">
        <Tabs value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      <Card padded={false}>
        <ActivityList entity={filter === "all" ? undefined : filter} />
      </Card>
    </>
  );
}
