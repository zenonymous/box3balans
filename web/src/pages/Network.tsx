import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { get, put } from "../api";
import { Alert, Button, Card, PageHeader, Spinner } from "../components/ui";
import { date } from "../format";
import { dateLocale, t, tj, tn } from "../i18n";

interface Destination {
  id: string;
  purpose: string;
  sends: string;
  when: string;
  hosts: string[];
}
interface Request {
  at: string;
  method: string;
  host: string;
  what: string;
  status?: number;
  error?: string;
  blocked?: boolean;
  reason?: "unlisted" | "off";
  purposes?: string[];
}
interface NetworkInfo {
  destinations: Destination[];
  off: string[];
  switchable: string[];
  since: string;
  daily: { day: string; hosts: Record<string, number> }[];
  recent: Request[];
  blocked: Request[];
}

const time = (v: string) =>
  new Date(v).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Where Box3balans may connect, and what it sent (server/src/lib/net.ts, docs/privacy.md). */
export function NetworkPage() {
  const q = useQuery({ queryKey: ["network"], queryFn: () => get<NetworkInfo>("/api/network") });
  const d = q.data;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const setOff = async (off: string[]) => {
    setSaving(true);
    setSaveError(undefined);
    try {
      await put("/api/network/off", { off });
      await q.refetch();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const toggle = (id: string, on: boolean) =>
    d && void setOff(on ? d.off.filter((x) => x !== id) : [...new Set([...d.off, id])]);
  const label = (r: Request) =>
    d?.destinations
      .filter((x) => r.purposes?.includes(x.id))
      .map((x) => x.purpose)
      .join(" / ") || "—";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("Network")}
        subtitle={t(
          "Box3balans only connects to the addresses below, only over HTTPS, and never sends amounts, balances or transactions. Anything else is refused and shown here. Your browser only talks to your own Box3balans.",
        )}
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !d ? (
        <Alert tone="danger">{q.error?.message}</Alert>
      ) : (
        <>
          {d.blocked.length ? (
            <Alert tone="danger">
              {tn(
                d.blocked.length,
                "{n} request was refused: it went to an address that isn't on the list.",
                "{n} requests were refused: they went to addresses that aren't on the list.",
              )}{" "}
              {d.blocked.map((b) => `${time(b.at)} ${b.host}${b.what}`).join(" · ")}
            </Alert>
          ) : (
            <p className="text-sm text-gain">
              ✓ {t("No request has been refused: everything went to an address on the list.")}
            </p>
          )}

          <Card
            title={t("Where Box3balans may connect")}
            padded={false}
            actions={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={saving || d.off.length === d.switchable.length}
                  onClick={() => void setOff(d.switchable)}
                >
                  {t("Offline: all off")}
                </Button>
                <Button size="sm" disabled={saving || d.off.length === 0} onClick={() => void setOff([])}>
                  {t("All on")}
                </Button>
              </div>
            }
          >
            {d.off.length > 0 && (
              <p className="px-4 pt-3 text-sm text-ink-2">
                {t(
                  "Turned off: Box3balans doesn't contact those addresses, also not when you ask it to. Prices and syncs from there stop until you turn them on again; you can fill in prices yourself.",
                )}
              </p>
            )}
            {saveError && (
              <div className="px-4 pt-3">
                <Alert tone="danger">{saveError}</Alert>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-2">
                    <th className="px-4 py-2 font-medium">{t("For")}</th>
                    <th className="px-4 py-2 font-medium">{t("What goes out")}</th>
                    <th className="px-4 py-2 font-medium">{t("Addresses")}</th>
                    <th className="px-4 py-2 font-medium">{t("On")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.destinations.map((x) => (
                    <tr key={x.id} className="border-b border-line align-top last:border-0">
                      <td className="px-4 py-2">
                        <div className="font-medium">{x.purpose}</div>
                        <div className="text-xs text-muted">{x.when}</div>
                      </td>
                      <td className="px-4 py-2 text-ink-2">{x.sends}</td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-2">{x.hosts.join(", ")}</td>
                      <td className="px-4 py-2">
                        {d.switchable.includes(x.id) ? (
                          // The label's padding makes a 24 px target around the 16 px box.
                          <label className="-m-1 inline-flex cursor-pointer p-1">
                            <input
                              type="checkbox"
                              className="size-4 accent-accent"
                              aria-label={x.purpose}
                              checked={!d.off.includes(x.id)}
                              disabled={saving}
                              onChange={(e) => toggle(x.id, e.target.checked)}
                            />
                          </label>
                        ) : (
                          <Link to="/settings" className="text-xs text-accent underline">
                            {t("Settings → About")}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-xs text-muted">
              {tj("The list is in the source code, with an explanation per address: <0>what Box3balans sends</0>.", [
                <a
                  key="d"
                  className="underline"
                  href="https://github.com/zenonymous/box3balans/blob/main/docs/privacy.md"
                  target="_blank"
                  rel="noreferrer"
                />,
              ])}
            </p>
          </Card>

          <Card title={t("Per day")} padded={false}>
            {d.daily.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-2">{t("Nothing sent yet.")}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {d.daily.map((day) => (
                  <li key={day.day} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2">
                    <span className="w-28 shrink-0 font-medium">{date(day.day)}</span>
                    <span className="min-w-0 text-ink-2">
                      {Object.entries(day.hosts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([host, n]) => `${host} (${n})`)
                        .join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("Latest requests")} padded={false}>
            {d.recent.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-2">
                {t("Nothing sent since Box3balans started ({date}).", { date: time(d.since) })}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-2">
                      <th className="px-4 py-2 font-medium">{t("When")}</th>
                      <th className="px-4 py-2 font-medium">{t("For")}</th>
                      <th className="px-4 py-2 font-medium">{t("Sent")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("Answer")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recent.map((r, i) => (
                      <tr key={i} className="border-b border-line align-top last:border-0">
                        <td className="whitespace-nowrap px-4 py-1.5 text-ink-2">{time(r.at)}</td>
                        <td className="px-4 py-1.5">
                          {r.blocked ? (r.reason === "off" ? t("Turned off") : t("Refused")) : label(r)}
                        </td>
                        <td className="break-all px-4 py-1.5 font-mono text-xs text-ink-2">
                          {r.method} {r.host}
                          {r.what}
                        </td>
                        <td className="px-4 py-1.5 text-right text-ink-2">
                          {r.status ?? (r.blocked ? "—" : r.error ? "!" : "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-4 py-3 text-xs text-muted">
              {t(
                "Keys and long values (addresses, tokens) are shortened here. The latest requests are kept until a restart; the counts per day for 90 days.",
              )}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
