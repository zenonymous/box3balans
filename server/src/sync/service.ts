import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, integrations } from "../db/schema.js";
import type { FetchFn } from "../lib/http.js";
import type { SecretBox } from "../lib/secrets.js";
import { HistoryService } from "../prices/history.js";
import type { PriceService } from "../prices/service.js";
import { AssetResolver } from "./assets.js";
import { Importer, knownIds } from "./importer.js";
import { bitvavo } from "./providers/bitvavo.js";
import { coinbase } from "./providers/coinbase.js";
import { ibkr } from "./providers/ibkr.js";
import { kraken } from "./providers/kraken.js";
import { type Mismatch, reconcile } from "./reconcile.js";
import { revalueUnpriced } from "./revalue.js";
import { matchTransfers } from "./transfers.js";
import type { ExchangeProvider, ProviderContext } from "./types.js";

export const PROVIDERS: Record<string, ExchangeProvider<any>> = { bitvavo, kraken, coinbase, ibkr };

export interface SyncResult {
  at: string;
  status: "ok" | "warning" | "error";
  durationMs: number;
  fetched: number;
  inserted: number;
  duplicates: number;
  ignored: number;
  transfersMatched: number;
  /** Rewards and deposits booked at €0 earlier that now have a value. */
  revalued?: number;
  newAssets: string[];
  mismatches: Mismatch[];
  warnings: string[];
  error?: string;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SyncService {
  private running = new Set<number>();
  /** Called after every sync (e.g. to backfill price history for newly imported assets). */
  onDone?: () => void;
  private inflight = new Map<number, Promise<SyncResult>>();

  constructor(
    private db: DB,
    private secrets: SecretBox,
    private prices: PriceService,
    private fetchFn: FetchFn = fetch,
    private sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  private ctx(accountId: number, cursor: Record<string, unknown> | null): ProviderContext {
    return {
      fetchFn: this.fetchFn,
      cursor,
      sleep: this.sleep,
      isKnown: (ids) => knownIds(this.db, accountId, "api", ids),
    };
  }

  /** Validates credentials against the provider and returns the parsed form. */
  async testCredentials(providerId: string, raw: unknown) {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`Unknown provider ${providerId}`);
    const creds = provider.credentials.parse(raw);
    await provider.test(creds, this.ctx(0, null));
    return { provider, creds };
  }

  anyRunning() {
    return this.running.size > 0;
  }

  isRunning(id: number) {
    return this.running.has(id);
  }

  /** Starts a sync without waiting for it; false when one is already running. */
  start(integrationId: number): boolean {
    if (this.running.has(integrationId)) return false;
    const p = this.run(integrationId).finally(() => this.inflight.delete(integrationId));
    this.inflight.set(integrationId, p);
    return true;
  }

  /** Resolves when the running sync (if any) for this connection finishes. */
  async whenIdle(integrationId: number): Promise<void> {
    await this.inflight.get(integrationId);
  }

  async run(integrationId: number): Promise<SyncResult> {
    if (this.running.has(integrationId)) throw new Error("A sync for this connection is already running");
    this.running.add(integrationId);
    const started = Date.now();
    const result: SyncResult = {
      at: new Date().toISOString(),
      status: "ok",
      durationMs: 0,
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      ignored: 0,
      transfersMatched: 0,
      newAssets: [],
      mismatches: [],
      warnings: [],
    };
    let cursor: Record<string, unknown> | null | undefined;
    try {
      const [row] = await this.db.select().from(integrations).where(eq(integrations.id, integrationId));
      if (!row) throw new Error("Connection not found");
      const provider = PROVIDERS[row.provider]!;
      const creds = provider.credentials.parse(this.secrets.open(row.credentials));

      const fetched = await provider.fetch(creds, this.ctx(row.accountId, row.cursor ?? null));
      result.fetched = fetched.events.length;
      result.warnings.push(...fetched.warnings);

      // CoinGecko lookups spaced out: its free tier answers a burst with a rate limit.
      const resolver = new AssetResolver(this.db, this.fetchFn, 2_500, this.sleep);
      const history = new HistoryService(this.db, this.prices.fx, this.fetchFn);
      const importer = new Importer(this.db, resolver, this.prices.fx, history);
      const imported = await importer.import(row.accountId, "api", fetched.events);
      Object.assign(result, {
        inserted: imported.inserted,
        duplicates: imported.duplicates,
        ignored: imported.ignored,
      });
      result.warnings.push(...imported.warnings);
      await resolver.upgradeManualIn(row.accountId, row.provider === "bitvavo" ? "bitvavo" : undefined);
      result.revalued = await revalueUnpriced(this.db, history, row.accountId);

      result.transfersMatched = await matchTransfers(this.db);
      if (fetched.balances) {
        result.mismatches = await reconcile(this.db, resolver, row.accountId, fetched.balances, fetched.balanceScope);
      }
      result.warnings.push(...resolver.warnings);
      result.newAssets = resolver.describeCreated();
      const fresh = [...resolver.created, ...resolver.upgraded].map((a) => a.id);
      if (fresh.length) await this.prices.refreshAll(fresh);
      cursor = fetched.cursor;
      if (result.warnings.length || result.mismatches.length) result.status = "warning";
    } catch (err) {
      result.status = "error";
      result.error = (err as Error).message;
    } finally {
      result.durationMs = Date.now() - started;
      await this.db
        .update(integrations)
        .set({
          lastSyncAt: new Date(),
          lastStatus: result.status,
          lastResult: result as unknown as Record<string, unknown>,
          ...(cursor !== undefined ? { cursor } : {}),
        })
        .where(eq(integrations.id, integrationId));
      this.running.delete(integrationId);
      this.onDone?.();
    }
    return result;
  }

  /** Syncs every enabled connection, one after another. */
  async runAll(): Promise<{ id: number; account: string; result: SyncResult }[]> {
    const rows = await this.db
      .select({ id: integrations.id, account: accounts.name })
      .from(integrations)
      .innerJoin(accounts, eq(accounts.id, integrations.accountId))
      .where(eq(integrations.enabled, true));
    const out = [];
    for (const r of rows) {
      if (this.running.has(r.id)) continue;
      out.push({ ...r, result: await this.run(r.id) });
    }
    return out;
  }
}
