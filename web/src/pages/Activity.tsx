import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../api";
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner, Tabs } from "../components/ui";
import { TX_LABEL, date, relativeTime } from "../format";
import { useInvalidateAll } from "../queries";

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
  transaction: "Transaction",
  asset: "Asset",
  account: "Account",
  account_years: "Values per year",
  person: "Household",
  metal_item: "Metal item",
  import: "CSV import",
  integration: "Connection",
  wallet_address: "Wallet address",
};

const FIELD_LABEL: Record<string, string> = {
  occurredAt: "Date",
  feeEur: "Fee (EUR)",
  fxRate: "Exchange rate",
  taxWithheld: "Tax withheld",
  amount: "Dividend amount",
  accountId: "Account",
  assetId: "Asset",
  settleAssetId: "Cash settlement",
  transferGroup: "Transfer link",
  noAutoMatch: "Never auto-link",
  priceSource: "Price source",
  priceRef: "Price feed",
  assetClass: "Asset class",
  grossWeightG: "Weight (g)",
  purchaseDate: "Purchase date",
  purchasePriceEur: "Price paid (EUR)",
  spotValueAtPurchaseEur: "Spot value at purchase",
  soldDate: "Sold on",
  salePriceEur: "Sale price (EUR)",
  includeUnlisted: "Include unlisted tokens",
  scriptType: "Address type",
};

const FLAG_LABEL: Record<string, string> = {
  unlinked: "Transfer unlinked",
  transferUndoneByImport: "Transfer undone by undoing an import",
};

const ACTION: Record<Entry["action"], { label: string; tone: "accent" | "neutral" | "danger" }> = {
  create: { label: "Added", tone: "accent" },
  update: { label: "Changed", tone: "neutral" },
  delete: { label: "Deleted", tone: "danger" },
};

const fieldLabel = (f: string) => FIELD_LABEL[f] ?? f.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function value(field: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (field === "transferGroup") return "linked";
  if (field === "type" && typeof v === "string") return TX_LABEL[v] ?? v;
  if (typeof v === "boolean") return v ? "yes" : "no";
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
      <p className="text-sm text-muted">No changes recorded.</p>
    ) : (
      <Empty title="Nothing recorded yet">Changes you make appear here.</Empty>
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
                    ? "restored"
                    : e.via === "sync"
                      ? "by a sync"
                      : e.via === "import"
                        ? "by an import"
                        : e.via}
                </span>
              )}
              <span className="ml-auto text-xs text-muted" title={new Date(e.at).toLocaleString()}>
                {relativeTime(e.at)}
              </span>
              {e.restorable && (
                <Button size="sm" onClick={() => void restore(e)}>
                  Restore
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
            Show older
          </Button>
        </div>
      )}
    </>
  );
}

const FILTERS: { value: "all" | Entity; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "transaction", label: "Transactions" },
  { value: "metal_item", label: "Metals" },
  { value: "asset", label: "Assets" },
  { value: "account", label: "Accounts" },
  { value: "import", label: "Imports" },
];

export function ActivityPage() {
  const [filter, setFilter] = useState<"all" | Entity>("all");
  return (
    <>
      <PageHeader
        title="History"
        subtitle="Every change you made, and what syncs and imports changed. Deleted transactions and metal items can be restored."
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
