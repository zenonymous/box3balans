import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { downloadFile } from "../download";
import { t, tn } from "../i18n";
import { Alert, Badge, Button, ButtonLink, Card, CopyButton, Field, Input } from "./ui";

// ---- Types mirroring server/src/import/contribute.ts ----

type KeptKind = "header" | "type" | "currency" | "assetType" | "metal" | "word";
type Flag = "name" | "iban" | "email" | "phone" | "bsn";

interface Kept {
  kind: KeptKind;
  value: string;
  count: number;
  replaced: boolean;
  flag?: Flag;
  common?: boolean;
}

export interface Contribution {
  file: { sample?: string; pages?: { page: number; text: string }[] };
  fileName: string;
  kept: Kept[];
  lines?: { file: number; sample: number };
}

const KIND_LABEL: Record<KeptKind, string> = {
  header: t("Column names"),
  type: t("Type words"),
  currency: t("Currency codes"),
  assetType: t("Asset types"),
  metal: t("Metals"),
  word: t("Words"),
};

const FLAG_LABEL: Record<Flag, string> = {
  name: t("a name in your household"),
  iban: t("looks like an IBAN"),
  email: t("looks like an e-mail address"),
  phone: t("looks like a phone number"),
  bsn: t("looks like a BSN"),
};

const keyOf = (k: Kept) => `${k.kind}:${k.value}`;

/**
 * Sharing a format without sharing your data (ADR 0012). The server makes a file with the format and
 * a made-up sample; the user sees exactly what's in it, can replace anything that stays from their
 * file, and downloads it to attach to a GitHub issue themselves. The app sends nothing.
 */
export function ShareFormat({
  kind,
  make,
  provider: initialProvider = "",
  waitFor,
}: {
  kind: "csv" | "pdf";
  make: (args: { provider: string; hint: string; replace: string[] }) => Promise<Contribution>;
  provider?: string;
  /** What the user has to do first, if anything: the file can't be made yet. */
  waitFor?: string;
}) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(initialProvider);
  const [hint, setHint] = useState("");
  const [replace, setReplace] = useState<string[]>([]);
  const [made, setMade] = useState<Contribution | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const version = useQuery({
    queryKey: ["version"],
    queryFn: () => get<{ version: string; source: string }>("/api/version"),
    staleTime: Infinity,
    enabled: open,
  });
  const source = version.data?.source ?? "https://github.com/zenonymous/box3balans";

  const run = async (nextReplace = replace) => {
    setBusy(true);
    setError(undefined);
    try {
      setMade(await make({ provider: provider.trim(), hint: hint.trim(), replace: nextReplace }));
      setReplace(nextReplace);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (k: Kept, keep: boolean) => {
    const key = keyOf(k);
    void run(keep ? replace.filter((r) => r !== key) : [...replace, key]);
  };

  const json = made ? JSON.stringify(made.file, null, 2) + "\n" : "";
  const download = () => downloadFile(made!.fileName, new Blob([json], { type: "application/json" }));

  const title = kind === "csv" ? t("Help others read this file") : t("Help others read this statement");
  if (!open)
    return (
      <Card title={title}>
        <p className="text-sm text-ink-2">
          {kind === "csv"
            ? t(
                "Box3balans doesn't know this export yet. You can share its format, so it's read by itself in a next version: Box3balans makes a file with your column settings and a few made-up lines in the same layout, without your data. You see exactly what's in it before you share it yourself.",
              )
            : t(
                "Box3balans doesn't know this statement yet. You can share its layout, so it's recognised in a next version: Box3balans makes a file with the text of the statement in which every number is made up and every uncommon word is crossed out. You see exactly what's in it before you share it yourself.",
              )}
        </p>
        <Button size="sm" className="mt-3" onClick={() => setOpen(true)}>
          {t("Make a file to share…")}
        </Button>
      </Card>
    );

  const kept = made?.kept ?? [];
  const own = kept.filter((k) => !k.common);
  const common = kept.filter((k) => k.common);
  const keptItem = (k: Kept) => (
    <label key={keyOf(k)} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs">
      <input
        type="checkbox"
        checked={!k.replaced}
        disabled={busy || !!k.flag}
        onChange={(e) => toggle(k, e.target.checked)}
      />
      <span className={k.replaced ? "text-muted line-through" : "font-mono"}>{k.value}</span>
      {k.flag && <Badge tone="warn">{FLAG_LABEL[k.flag]}</Badge>}
    </label>
  );

  return (
    <Card title={title}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === "csv" ? t("Broker, bank or exchange") : t("Provider")}>
            {(id) => <Input id={id} value={provider} maxLength={60} onChange={(e) => setProvider(e.target.value)} />}
          </Field>
          <Field
            label={kind === "csv" ? t("Which export?") : t("Which statement?")}
            hint={t("Where in their app or website you get it. Optional.")}
          >
            {(id) => (
              <Input
                id={id}
                value={hint}
                maxLength={300}
                placeholder={
                  kind === "csv" ? t("e.g. Account → Transactions → Export as CSV") : t("e.g. Financial year statement")
                }
                onChange={(e) => setHint(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void run()} disabled={busy || !provider.trim() || !!waitFor}>
            {busy ? t("Making…") : made ? t("Make again") : t("Make the file")}
          </Button>
          {waitFor && <span className="text-xs text-muted">{waitFor}</span>}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}

        {made && (
          <>
            <p className="text-ink-2">
              {made.lines
                ? tn(
                    made.lines.sample,
                    "The file has {n} made-up line in the layout of yours (which has {total}): other dates, amounts, IDs and texts, and well-known funds and coins instead of yours.",
                    "The file has {n} made-up lines in the layout of yours (which has {total}): other dates, amounts, IDs and texts, and well-known funds and coins instead of yours.",
                    { total: made.lines.file },
                  )
                : t(
                    "The file has the text of the first page and of the pages with the values you ticked. Every number is made up (years, 1 January and 31 December stay); words below that aren't ticked are crossed out (xxxx).",
                  )}
            </p>

            <div>
              <h3 className="mb-1 font-semibold">{t("What stays from your file")}</h3>
              <p className="mb-2 text-xs text-muted">
                {t(
                  "Untick anything that shouldn't be shared; it's then replaced by a made-up value. What looks like a name, an IBAN or a phone number is replaced already.",
                )}
              </p>
              {(["header", "type", "currency", "assetType", "metal", "word"] as KeptKind[]).map((group) => {
                const items = own.filter((k) => k.kind === group);
                return (
                  items.length > 0 && (
                    <div key={group} className="mb-2">
                      <div className="mb-1 text-xs font-medium text-ink-2">{KIND_LABEL[group]}</div>
                      <div className="flex flex-wrap gap-1.5">{items.map(keptItem)}</div>
                    </div>
                  )
                );
              })}
              {common.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-ink-2">
                    {tn(
                      common.length,
                      "{n} common word of statements, such as “saldo” or “januari”",
                      "{n} common words of statements, such as “saldo” or “januari”",
                    )}
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">{common.map(keptItem)}</div>
                </details>
              )}
            </div>

            <div>
              <h3 className="mb-1 font-semibold">{t("What the file shows")}</h3>
              <pre className="max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed whitespace-pre">
                {made.file.sample ??
                  made.file.pages?.map((p) => `— ${t("p. {page}", { page: p.page })} —\n${p.text}`).join("\n\n")}
              </pre>
            </div>

            <div className="rounded-lg border border-line p-3">
              <h3 className="mb-1 font-semibold">{t("Share it")}</h3>
              <ol className="mb-3 list-decimal space-y-1 pl-5 text-ink-2">
                <li>{t("Download the file.")}</li>
                <li>
                  {t("Open the form on GitHub, drag the file into it and send it. You need a GitHub account for that.")}
                </li>
              </ol>
              <p className="mb-3 text-xs text-muted">
                {t(
                  "The form is public: anyone can see the file, and that you have this provider, under your GitHub name. Box3balans itself sends nothing.",
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={download} disabled={busy}>
                  ↓ {t("Download the file")}
                </Button>
                <CopyButton text={json} disabled={busy} />
                <ButtonLink href={`${source}/issues/new?template=formaat-delen.yml`} target="_blank" rel="noreferrer">
                  {t("Open the form on GitHub")} ↗
                </ButtonLink>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
