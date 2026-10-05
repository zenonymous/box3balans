import { D } from "../lib/decimal.js";
import { getJson, type FetchFn } from "../lib/http.js";
import type { AssetCandidate, PriceProvider, Quote } from "./types.js";

const BASE = "https://api.coingecko.com/api/v3";

export function coingeckoProvider(fetchFn?: FetchFn): PriceProvider {
  return {
    name: "coingecko",
    async quotes(refs) {
      const out = new Map<string, Quote>();
      for (let i = 0; i < refs.length; i += 200) {
        const ids = refs.slice(i, i + 200);
        const url = `${BASE}/simple/price?ids=${ids.map(encodeURIComponent).join(",")}&vs_currencies=eur&include_24hr_change=true`;
        const data = await getJson<Record<string, { eur?: number; eur_24h_change?: number }>>(url, { fetchFn });
        for (const id of ids) {
          const row = data[id];
          if (row?.eur == null) continue;
          out.set(id, {
            price: D(row.eur),
            currency: "EUR",
            changePct24h: row.eur_24h_change != null ? D(row.eur_24h_change) : undefined,
            source: "coingecko",
          });
        }
      }
      return out;
    },
  };
}

export async function coingeckoSearch(query: string, fetchFn?: FetchFn): Promise<AssetCandidate[]> {
  const data = await getJson<{ coins: { id: string; name: string; symbol: string }[] }>(
    `${BASE}/search?query=${encodeURIComponent(query)}`,
    { fetchFn },
  );
  return (data.coins ?? []).slice(0, 10).map((c) => ({
    assetClass: "crypto" as const,
    name: c.name,
    symbol: c.symbol.toUpperCase(),
    priceSource: "coingecko" as const,
    priceRef: c.id,
  }));
}
