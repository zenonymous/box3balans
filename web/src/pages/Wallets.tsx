import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, pollUntil, post, put, type ChainInfo, type WalletAddress, type WalletSyncResult } from "../api";
import { Mismatches } from "../components/Mismatches";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { relativeTime } from "../format";
import { useAccounts, useInvalidateAll } from "../queries";
import { t, tn } from "../i18n";

const SCRIPT_LABEL: Record<string, string> = {
  p2pkh: "Legacy (1…)",
  "p2sh-p2wpkh": "Nested SegWit (3…)",
  p2wpkh: "Native SegWit (bc1q…)",
  p2tr: "Taproot (bc1p…)",
};

const looksLikeXpub = (s: string) => /^[a-zA-Z]{4}[1-9A-HJ-NP-Za-km-z]{100,}$/.test(s.trim());
const short = (a: string) => (a.length > 24 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a);

const useWallets = () =>
  useQuery({
    queryKey: ["wallets"],
    queryFn: () => get<WalletAddress[]>("/api/wallets"),
    refetchInterval: (q) => (q.state.data?.some((w) => w.running) ? 3_000 : 60_000),
  });

const useChains = () =>
  useQuery({ queryKey: ["chains"], queryFn: () => get<ChainInfo[]>("/api/wallets/chains"), staleTime: Infinity });

interface Group {
  key: string;
  accountId: number;
  accountName: string;
  chain: string;
  rows: WalletAddress[];
}

export function WalletsPage() {
  const wallets = useWallets();
  const chains = useChains();
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const w of wallets.data ?? []) {
      const key = `${w.accountId}:${w.chain}`;
      const g = map.get(key) ?? { key, accountId: w.accountId, accountName: w.accountName, chain: w.chain, rows: [] };
      g.rows.push(w);
      map.set(key, g);
    }
    return [...map.values()];
  }, [wallets.data]);

  return (
    <>
      <PageHeader
        title={t("Wallets")}
        subtitle={t(
          "Self-custody wallets tracked by public address. Nothing here can move funds: never paste a seed phrase or private key.",
        )}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t("+ Add address")}
          </Button>
        }
      />
      {wallets.isLoading || chains.isLoading ? (
        <Spinner />
      ) : wallets.error ? (
        <Alert tone="danger">{wallets.error.message}</Alert>
      ) : groups.length === 0 ? (
        <Card>
          <Empty title={t("No wallets yet")}>
            {t(
              "Add a Bitcoin, Litecoin or Dogecoin address or xpub, an Ethereum, L2 or BNB Chain address, or a Solana, Cardano, XRP or Tron address. History and balances are read from public blockchain explorers.",
            )}
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <WalletGroup key={g.key} group={g} chain={chains.data?.find((c) => c.id === g.chain)} />
          ))}
        </div>
      )}
      {adding && chains.data && <AddModal chains={chains.data} onClose={() => setAdding(false)} />}
    </>
  );
}

function StatusBadge({ rows }: { rows: WalletAddress[] }) {
  const w = rows[0]!;
  if (rows.some((r) => r.running)) return <Badge tone="accent">⟳ {t("syncing…")}</Badge>;
  if (rows.every((r) => !r.enabled)) return <Badge>{t("paused")}</Badge>;
  if (w.lastStatus === "error") return <Badge tone="danger">⛔ {t("failed")}</Badge>;
  if (w.lastResult?.partial) return <Badge tone="accent">{t("importing history…")}</Badge>;
  if (w.lastStatus === "warning") return <Badge tone="warn">⚠ {t("needs attention")}</Badge>;
  if (w.lastStatus === "ok") return <Badge>✓ {t("up to date")}</Badge>;
  return <Badge>{t("not synced yet")}</Badge>;
}

function WalletGroup({ group, chain }: { group: Group; chain?: ChainInfo }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showTokens, setShowTokens] = useState(false);
  const r = group.rows[0]!.lastResult;
  const includeUnlisted = group.rows.some((w) => w.includeUnlisted);

  const refresh = async () => {
    await invalidate();
    await qc.invalidateQueries({ queryKey: ["wallets"] });
  };

  const syncNow = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // Starts in the background; the page polls while `running` is set.
      await post("/api/wallets/sync", { accountId: group.accountId, chain: group.chain });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const remove = async (w: WalletAddress) => {
    const last = group.rows.length === 1;
    const purge =
      last &&
      confirm(
        t(
          "Stop tracking {address}.\n\nAlso delete the transactions imported from {chain}? (OK = delete them, Cancel = keep them)",
          { address: short(w.address), chain: chain?.label ?? w.chain },
        ),
      );
    if (
      !last &&
      !confirm(
        t("Stop tracking {address}? The other addresses re-import on their next sync.", { address: short(w.address) }),
      )
    )
      return;
    try {
      await del(`/api/wallets/${w.id}?deleteTransactions=${purge}`);
      if (!last) await post("/api/wallets/sync", { accountId: group.accountId, chain: group.chain });
    } catch (err) {
      setError((err as Error).message);
    }
    await refresh();
  };

  const toggleUnlisted = async () => {
    for (const w of group.rows) await put(`/api/wallets/${w.id}`, { includeUnlisted: !includeUnlisted });
    await syncNow();
  };

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {group.accountName} <span className="font-normal text-ink-2">· {chain?.label ?? group.chain}</span>{" "}
          <StatusBadge rows={group.rows} />
        </span>
      }
      actions={
        <Button size="sm" variant="primary" onClick={syncNow} disabled={busy || group.rows.some((w) => w.running)}>
          {busy || group.rows.some((w) => w.running) ? t("Syncing…") : t("↻ Sync now")}
        </Button>
      }
    >
      <ul className="mb-3 divide-y divide-line rounded-lg border border-line">
        {group.rows.map((w) => (
          <li key={w.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              {w.label && <div className="font-medium">{w.label}</div>}
              <div className="truncate font-mono text-xs text-ink-2" title={w.address}>
                {short(w.address)}
              </div>
            </div>
            {looksLikeXpub(w.address) && <Badge>{w.scriptType ? SCRIPT_LABEL[w.scriptType] : t("extended key")}</Badge>}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove(w)}
              aria-label={t("Remove {name}", { name: w.address })}
            >
              {t("Remove")}
            </Button>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-ink-2">{t("Last sync")}</dt>
        <dd title={group.rows[0]!.lastSyncAt ?? undefined}>{relativeTime(group.rows[0]!.lastSyncAt)}</dd>
        {r && !r.error && (
          <>
            <dt className="text-ink-2">{t("Imported")}</dt>
            <dd>
              {t("{n} new", { n: r.inserted })}{" "}
              <span className="text-muted">{t("of {total}", { total: r.fetched })}</span>
            </dd>
            <dt className="text-ink-2">{t("Transfers linked")}</dt>
            <dd>{r.transfersMatched}</dd>
          </>
        )}
      </dl>

      <div className="mt-3 flex flex-col gap-2">
        {error && <Alert tone="danger">{error}</Alert>}
        {r?.error && <Alert tone="danger">{r.error}</Alert>}
        {r?.info && <p className="text-xs text-ink-2">{r.info}</p>}
        {r?.newAssets && r.newAssets.length > 0 && (
          <p className="text-xs text-ink-2">{t("New assets added: {list}", { list: r.newAssets.join(", ") })}</p>
        )}
        {r?.warnings?.map((w) => (
          <Alert key={w}>{w}</Alert>
        ))}
        {r && (r.skippedTokens.length > 0 || includeUnlisted) && (
          <div className="text-xs text-ink-2">
            {includeUnlisted ? (
              <>{t("Unrecognised tokens are included (manually priced).")} </>
            ) : (
              <>
                <button type="button" className="underline" onClick={() => setShowTokens(!showTokens)}>
                  {tn(r.skippedTokens.length, "{n} unrecognised token skipped", "{n} unrecognised tokens skipped")}
                </button>{" "}
                {t("(not on CoinGecko, usually spam airdrops).")}{" "}
              </>
            )}
            <button type="button" className="text-accent underline" onClick={toggleUnlisted}>
              {includeUnlisted ? t("Skip them again") : t("Include them anyway")}
            </button>
            {showTokens && !includeUnlisted && (
              <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-line p-2 font-mono">
                {r.skippedTokens.map((tk) => (
                  <li key={tk.contract} className="truncate">
                    {tk.symbol} · {tk.contract}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {r && r.mismatches.length > 0 && (
          <Mismatches
            accountId={group.accountId}
            accountName={group.accountName}
            source="blockchain"
            rows={r.mismatches}
            refreshKey="wallets"
          />
        )}
      </div>
    </Card>
  );
}

function AddModal({ chains, onClose }: { chains: ChainInfo[]; onClose: () => void }) {
  const accounts = useAccounts();
  const invalidate = useInvalidateAll();
  const qc = useQueryClient();
  const [chain, setChain] = useState("bitcoin");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [scriptType, setScriptType] = useState("");
  const [alsoOn, setAlsoOn] = useState<string[]>([]);
  const [accountChoice, setAccountChoice] = useState("new");
  const [accountName, setAccountName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<{ chain: string; result: WalletSyncResult | null }[]>();

  const info = chains.find((c) => c.id === chain)!;
  const isEvm = info.evm;
  // Other EVM chains the same address can be tracked on.
  const otherEvm = chains.filter((c) => c.evm && c.id !== chain);
  const xpub = info.supportsXpub && looksLikeXpub(address);
  const wallets = accounts.data?.filter((a) => !a.archived && (a.kind === "wallet" || a.kind === "other")) ?? [];
  const label_ = (id: string) => chains.find((c) => c.id === id)?.label ?? id;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const targets = [chain, ...(isEvm ? alsoOn.filter((c) => otherEvm.some((o) => o.id === c && !o.unavailable)) : [])];
    let accountId = accountChoice === "new" ? undefined : Number(accountChoice);
    const out: { chain: string; result: WalletSyncResult | null }[] = [];
    try {
      for (const c of targets) {
        setBusy(t("Adding {chain}…", { chain: label_(c) }));
        const res = await post<{ accountId: number }>("/api/wallets", {
          chain: c,
          address,
          label: label || null,
          scriptType: xpub && scriptType ? scriptType : null,
          ...(accountId
            ? { accountId }
            : { accountName: accountName.trim() || t("{chain} wallet", { chain: info.label }) }),
        });
        accountId = res.accountId; // further chains go into the same account
        out.push({ chain: c, result: null });
      }
      // Imports run in the background (in parallel per chain); wait for all of them.
      setBusy(t("Importing history…"));
      await qc.invalidateQueries({ queryKey: ["wallets"] });
      const mine = (list: WalletAddress[]) =>
        list.filter((w) => w.accountId === accountId && targets.includes(w.chain));
      const list = await pollUntil(
        () => get<WalletAddress[]>("/api/wallets"),
        (l) => mine(l).every((w) => !w.running && w.lastResult),
      );
      for (const o of out) o.result = mine(list).find((w) => w.chain === o.chain)?.lastResult ?? null;
      setResults(out);
    } catch (err) {
      setError((err as Error).message);
      if (out.length) setResults(out);
    } finally {
      setBusy(null);
      await invalidate();
      await qc.invalidateQueries({ queryKey: ["wallets"] });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("Track a wallet address")}
      footer={
        results ? (
          <Button variant="primary" onClick={onClose}>
            {t("Done")}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t("Cancel")}</Button>
            <Button variant="primary" type="submit" form="wallet-form" disabled={!!busy || !!info.unavailable}>
              {busy ?? t("Add and import")}
            </Button>
          </>
        )
      }
    >
      {results ? (
        <div className="flex flex-col gap-3 text-sm">
          {results.map(({ chain: c, result: r }) => (
            <div key={c}>
              <div className="font-medium">{label_(c)}</div>
              {!r ? (
                <p className="text-ink-2">{t("Added; it syncs shortly.")}</p>
              ) : r.error ? (
                <Alert tone="danger">{r.error}</Alert>
              ) : (
                <p className="text-ink-2">
                  <span className="text-gain">✓</span>{" "}
                  {tn(r.inserted, "Imported {n} transaction", "Imported {n} transactions")}
                  {r.transfersMatched
                    ? tn(
                        r.transfersMatched,
                        ", linked {n} transfer to your other accounts",
                        ", linked {n} transfers to your other accounts",
                      )
                    : ""}
                  {r.skippedTokens.length
                    ? tn(
                        r.skippedTokens.length,
                        "; skipped {n} unrecognised token",
                        "; skipped {n} unrecognised tokens",
                      )
                    : ""}
                  .{r.partial && ` ${t("Older history continues on the next syncs.")}`}
                </p>
              )}
            </div>
          ))}
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      ) : (
        <form id="wallet-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("Blockchain")}>
            {(id) => (
              <Select id={id} value={chain} onChange={(e) => setChain(e.target.value)}>
                {chains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.nativeSymbol}){c.unavailable ? ` – ${t("needs setup")}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("Label (optional)")}>
            {(id) => (
              <Input
                id={id}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("e.g. Ledger savings")}
              />
            )}
          </Field>
          {info.unavailable && (
            <div className="sm:col-span-2">
              <Alert tone="warn">{info.unavailable}</Alert>
            </div>
          )}
          <Field label={t("Public address")} hint={info.addressHint} className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                className="font-mono"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                required
              />
            )}
          </Field>
          {xpub && (
            <Field
              label={t("Address type")}
              hint={t("Leave on automatic unless your wallet uses Taproot with an xpub.")}
              className="sm:col-span-2"
            >
              {(id) => (
                <Select id={id} value={scriptType} onChange={(e) => setScriptType(e.target.value)}>
                  <option value="">{t("Automatic (from the key prefix)")}</option>
                  {info.scriptTypes.map((s) => (
                    <option key={s} value={s}>
                      {SCRIPT_LABEL[s] ?? s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {isEvm && (
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-xs font-medium text-ink-2">{t("Also track this address on")}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {otherEvm.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-1.5${c.unavailable ? " text-muted" : ""}`}
                    title={c.unavailable ?? undefined}
                  >
                    <input
                      type="checkbox"
                      disabled={!!c.unavailable}
                      checked={!c.unavailable && alsoOn.includes(c.id)}
                      onChange={(e) =>
                        setAlsoOn(e.target.checked ? [...alsoOn, c.id] : alsoOn.filter((x) => x !== c.id))
                      }
                    />
                    {c.label}
                    {c.unavailable && ` (${t("needs setup")})`}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field label={t("Account")}>
            {(id) => (
              <Select id={id} value={accountChoice} onChange={(e) => setAccountChoice(e.target.value)}>
                <option value="new">{t("Create a new wallet account")}</option>
                {wallets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {t("{name} (existing)", { name: a.name })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {accountChoice === "new" ? (
            <Field label={t("Account name")}>
              {(id) => (
                <Input
                  id={id}
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder={t("{chain} wallet", { chain: info.label })}
                />
              )}
            </Field>
          ) : (
            <p className="self-end text-xs text-muted">
              {t(
                "Transactions you entered by hand for this account stay; imported ones are added next to them, so check for duplicates.",
              )}
            </p>
          )}
          {busy && (
            <p className="text-sm text-ink-2 sm:col-span-2">
              {busy}{" "}
              {t(
                "Large wallets can take a few minutes; you can close this dialog and the import continues in the background.",
              )}
            </p>
          )}
          {error && (
            <div className="sm:col-span-2">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
