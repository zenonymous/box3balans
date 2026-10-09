import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { accounts, walletAddresses } from "../db/schema.js";
import type { FetchFn } from "../lib/http.js";
import { HistoryService } from "../prices/history.js";
import type { PriceService } from "../prices/service.js";
import { AssetResolver } from "../sync/assets.js";
import { Importer } from "../sync/importer.js";
import { purgeSynced } from "../sync/purge.js";
import { type Mismatch, reconcile } from "../sync/reconcile.js";
import { revalueUnpriced } from "../sync/revalue.js";
import { matchTransfers } from "../sync/transfers.js";
import type { AssetRef, Balance, SyncEvent } from "../sync/types.js";
import { movementsToEvents } from "./netting.js";
import { buildChains } from "./registry.js";
import type { ChainAdapter } from "./types.js";
import { trn } from "../i18n/index.js";

export interface WalletSyncResult {
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
  skippedTokens: { symbol: string; contract: string }[];
  pendingTokens: number;
  partial: boolean;
  info?: string;
  warnings: string[];
  error?: string;
}

// CoinGecko contract lookups per sync; the rest are checked on following syncs.
const MAX_TOKEN_LOOKUPS = 25;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const groupKey = (accountId: number, chain: string) => `${accountId}:${chain}`;

export class WalletService {
  readonly chains: Record<string, ChainAdapter>;
  private running = new Set<string>();
  /** Called after every sync (e.g. to backfill price history for newly imported assets). */
  onDone?: () => void;
  private inflight = new Map<string, Promise<WalletSyncResult>>();

  constructor(
    private db: DB,
    private prices: PriceService,
    opts: {
      chains?: Record<string, ChainAdapter>;
      fetchFn?: FetchFn;
      sleep?: (ms: number) => Promise<void>;
      tokenThrottleMs?: number;
    } = {},
  ) {
    this.chains = opts.chains ?? buildChains();
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? realSleep;
    this.tokenThrottleMs = opts.tokenThrottleMs ?? 2_500;
  }

  private fetchFn: FetchFn;
  private sleep: (ms: number) => Promise<void>;
  private tokenThrottleMs: number;

  anyRunning() {
    return this.running.size > 0;
  }

  isRunning(accountId: number, chain: string) {
    return this.running.has(groupKey(accountId, chain));
  }

  /**
   * Starts a sync without waiting for it (first imports can take minutes on rate-limited chains).
   * Returns false when one is already running. Progress shows up via `running` / `lastResult`.
   */
  start(accountId: number, chain: string): boolean {
    const key = groupKey(accountId, chain);
    if (this.running.has(key)) return false;
    const p = this.sync(accountId, chain).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return true;
  }

  /** Resolves when the running sync (if any) for this wallet finishes. */
  async whenIdle(accountId: number, chain: string): Promise<void> {
    await this.inflight.get(groupKey(accountId, chain));
  }

  /** Syncs all enabled addresses of one account on one chain together. */
  async sync(accountId: number, chain: string): Promise<WalletSyncResult> {
    const key = groupKey(accountId, chain);
    if (this.running.has(key)) throw new Error("A sync for this wallet is already running");
    this.running.add(key);
    const started = Date.now();
    const result: WalletSyncResult = {
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
      skippedTokens: [],
      pendingTokens: 0,
      partial: false,
      warnings: [],
    };
    let cursor: Record<string, unknown> | undefined;
    try {
      const adapter = this.chains[chain];
      if (!adapter) throw new Error(`Unsupported chain ${chain}`);
      const rows = await this.db
        .select()
        .from(walletAddresses)
        .where(
          and(
            eq(walletAddresses.accountId, accountId),
            eq(walletAddresses.chain, chain),
            eq(walletAddresses.enabled, true),
          ),
        );
      if (rows.length === 0) throw new Error("No enabled addresses");

      // Netting depends on the full address set: if it changed, re-import this chain from scratch.
      const addrSet = rows
        .map((r) => `${r.address}|${r.scriptType ?? ""}`)
        .sort()
        .join(",");
      let prev = rows.find((r) => r.cursor)?.cursor ?? null;
      if (prev && prev.addrSet !== addrSet) {
        await purgeSynced(this.db, accountId, "chain", `${chain}:`);
        prev = null;
      }

      const fetched = await adapter.fetch(
        rows.map((r) => ({ address: r.address, scriptType: r.scriptType })),
        { fetchFn: this.fetchFn, sleep: this.sleep, cursor: prev },
      );
      result.partial = !!fetched.partial;
      result.info = fetched.info;
      result.warnings.push(...fetched.warnings);

      const resolver = new AssetResolver(this.db, this.fetchFn, this.tokenThrottleMs, this.sleep);
      const includeUnlisted = rows.some((r) => r.includeUnlisted);
      const { events, balances } = await this.filterTokens(
        resolver,
        [
          ...movementsToEvents(chain, fetched.movements, fetched.fees),
          ...(fetched.rewards ?? []).map((r): SyncEvent => ({
            kind: r.kind,
            id: `${chain}:${r.id}`,
            at: r.at,
            asset: r.asset,
            quantity: r.amount.toFixed(),
            note: r.note,
          })),
        ],
        fetched.balances,
        new Set(fetched.spamContracts ?? []),
        includeUnlisted,
        result,
      );
      result.fetched = events.length;

      const history = new HistoryService(this.db, this.prices.fx, this.fetchFn, 2_500, this.sleep);
      const importer = new Importer(this.db, resolver, this.prices.fx, history);
      const imported = await importer.import(accountId, "chain", events);
      Object.assign(result, {
        inserted: imported.inserted,
        duplicates: imported.duplicates,
        ignored: imported.ignored,
      });
      result.warnings.push(...imported.warnings);
      result.revalued = await revalueUnpriced(this.db, history, accountId);
      result.transfersMatched = await matchTransfers(this.db);

      // Reconcile only once the whole history is in, and only this chain's assets.
      if (!result.partial && result.pendingTokens === 0) {
        const ids = new Set<number>();
        for (const e of events) {
          ids.add((await resolver.resolve(e.asset)).id);
          if (e.kind === "trade" && e.quoteRef) ids.add((await resolver.resolve(e.quoteRef)).id);
        }
        result.mismatches = await reconcile(this.db, resolver, accountId, balances, "all", ids);
      }
      result.warnings.push(...resolver.warnings);
      result.newAssets = resolver.describeCreated();
      const fresh = [...resolver.created, ...resolver.upgraded].map((a) => a.id);
      if (fresh.length) await this.prices.refreshAll(fresh);

      cursor = { ...fetched.cursor, addrSet };
      if (result.warnings.length || result.mismatches.length || result.partial || result.pendingTokens)
        result.status = "warning";
    } catch (err) {
      result.status = "error";
      result.error = (err as Error).message;
    } finally {
      result.durationMs = Date.now() - started;
      await this.db
        .update(walletAddresses)
        .set({
          lastSyncAt: new Date(),
          lastStatus: result.status,
          lastResult: result as unknown as Record<string, unknown>,
          ...(cursor ? { cursor } : {}),
        })
        .where(and(eq(walletAddresses.accountId, accountId), eq(walletAddresses.chain, chain)));
      this.running.delete(key);
      this.onDone?.();
    }
    return result;
  }

  /**
   * Drops tokens CoinGecko doesn't list (usually spam airdrops) unless the wallet opts in. A swap
   * with an unlisted token keeps only its listed side, so that balance still adds up.
   */
  private async filterTokens(
    resolver: AssetResolver,
    events: SyncEvent[],
    balances: Balance[],
    spam: Set<string>,
    includeUnlisted: boolean,
    result: WalletSyncResult,
  ): Promise<{ events: SyncEvent[]; balances: Balance[] }> {
    const status = new Map<string, "listed" | "unlisted" | "pending">();
    let rateLimited = false;
    const skipped = new Map<string, { symbol: string; contract: string }>();
    const check = async (ref: AssetRef): Promise<boolean> => {
      if (ref.kind !== "crypto" || !ref.contract || !ref.chain) return true;
      const k = `${ref.chain}:${ref.contract.toLowerCase()}`;
      let s = status.get(k);
      if (!s) {
        if (spam.has(ref.contract.toLowerCase())) s = "unlisted";
        else {
          const cacheOnly = rateLimited || resolver.networkLookups >= MAX_TOKEN_LOOKUPS;
          try {
            const c = await resolver.classifyToken(ref.chain, ref.contract, ref, { cacheOnly });
            s = c === null ? "pending" : c.listed ? "listed" : "unlisted";
          } catch {
            // CoinGecko unavailable or rate limited: stop looking up for this sync, retry next time.
            rateLimited = true;
            s = "pending";
          }
        }
        status.set(k, s);
        if (s === "unlisted") skipped.set(k, { symbol: ref.symbol, contract: ref.contract });
      }
      return s === "listed" || (s === "unlisted" && includeUnlisted);
    };

    const out: SyncEvent[] = [];
    for (const e of events) {
      if (e.kind === "trade" && e.quoteRef) {
        const [a, q] = [await check(e.asset), await check(e.quoteRef)];
        if (a && q) out.push(e);
        else if (a)
          out.push({
            kind: "deposit",
            id: e.id,
            at: e.at,
            asset: e.asset,
            quantity: e.quantity,
            note: "Swap from an untracked token",
          });
        else if (q)
          out.push({
            kind: "withdrawal",
            id: e.id,
            at: e.at,
            asset: e.quoteRef,
            quantity: e.quote!.amount,
            note: "Swap into an untracked token",
          });
      } else if (e.kind !== "dividend" && (await check(e.asset))) out.push(e);
    }
    const keptBalances: Balance[] = [];
    for (const b of balances) if (await check(b.asset)) keptBalances.push(b);

    result.skippedTokens = includeUnlisted ? [] : [...skipped.values()];
    result.pendingTokens = [...status.values()].filter((s) => s === "pending").length;
    if (result.pendingTokens) {
      result.warnings.push(
        trn(
          result.pendingTokens,
          "{n} token not identified yet (CoinGecko rate limit); it is added on the next sync.",
          "{n} tokens not identified yet (CoinGecko rate limit); they are added on the next sync.",
        ),
      );
    }
    return { events: out, balances: keptBalances };
  }

  /** Syncs every enabled wallet group, one after another. */
  async runAll() {
    const rows = await this.db
      .selectDistinct({ accountId: walletAddresses.accountId, chain: walletAddresses.chain, account: accounts.name })
      .from(walletAddresses)
      .innerJoin(accounts, eq(accounts.id, walletAddresses.accountId))
      .where(eq(walletAddresses.enabled, true));
    const out = [];
    for (const r of rows) {
      if (this.isRunning(r.accountId, r.chain)) continue;
      out.push({ ...r, result: await this.sync(r.accountId, r.chain) });
    }
    return out;
  }
}
