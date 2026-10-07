import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  get,
  type Account,
  type Asset,
  type Holding,
  type MetalsOverview,
  type RefreshStatus,
  type HistoryResponse,
  type Summary,
  type Person,
} from "./api";

export const usePortfolio = () =>
  useQuery({
    queryKey: ["portfolio"],
    queryFn: () => get<{ summary: Summary; holdings: Holding[] }>("/api/portfolio"),
    refetchInterval: 5 * 60_000,
  });

export type HistoryRange = "1M" | "3M" | "1Y" | "5Y" | "ALL";

export const useHistory = (range: HistoryRange) =>
  useQuery({
    queryKey: ["history", range],
    queryFn: () => get<HistoryResponse>(`/api/portfolio/history?range=${range}`),
  });

export const usePriceStatus = () =>
  useQuery({
    queryKey: ["price-status"],
    queryFn: () => get<{ status: RefreshStatus | null; intervalMinutes: number }>("/api/prices/status"),
    refetchInterval: 60_000,
  });

export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: () => get<Account[]>("/api/accounts") });

export const useHousehold = () => useQuery({ queryKey: ["household"], queryFn: () => get<Person[]>("/api/household") });

export const useAssets = () => useQuery({ queryKey: ["assets"], queryFn: () => get<Asset[]>("/api/assets") });

export const useMetals = () =>
  useQuery({ queryKey: ["metals"], queryFn: () => get<MetalsOverview>("/api/metals/overview") });

export interface Issue {
  key: string;
  severity: "problem" | "warning" | "info";
  title: string;
  detail?: string;
  link?: { to: string; label: string };
  fingerprint: string;
  dismissible: boolean;
  dismissed: boolean;
}

/** Things that need a look (see the Needs attention page); refreshed every few minutes. */
export const useAttention = () =>
  useQuery({
    queryKey: ["attention"],
    queryFn: () => get<Issue[]>("/api/attention"),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

/** After any data change, everything derived from the ledger is stale. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  // Import previews are keyed by their input and their upload is gone after importing.
  return () =>
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "auth" && q.queryKey[0] !== "import-preview" });
}

/** Demo mode (DEMO=true on the server): example data, made-up prices. Known once signed in. */
export function useDemo(): boolean {
  const qc = useQueryClient();
  return qc.getQueryData<{ demo?: boolean }>(["auth"])?.demo ?? false;
}
