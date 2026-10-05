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

export const useAssets = () => useQuery({ queryKey: ["assets"], queryFn: () => get<Asset[]>("/api/assets") });

export const useMetals = () =>
  useQuery({ queryKey: ["metals"], queryFn: () => get<MetalsOverview>("/api/metals/overview") });

/** After any data change, everything derived from the ledger is stale. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  // Import previews are keyed by their input and their upload is gone after importing.
  return () =>
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "auth" && q.queryKey[0] !== "import-preview" });
}
