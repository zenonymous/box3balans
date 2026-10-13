import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { get, type ChecklistItem, type PeildatumChecklist } from "../api";
import { Badge, Card, cx } from "./ui";
import { t, tn } from "../i18n";

const ORDER: ChecklistItem["status"][] = ["todo", "later", "info", "ok"];

const label = (s: ChecklistItem["status"]) =>
  ({ todo: t("To do"), later: t("After 31 December"), info: t("For your information"), ok: "✓" })[s];

/**
 * What box 3 of `year` needs for its peildatum, per account: open items first. Collapsed when
 * everything is done, unless `expanded`.
 */
export function PeildatumCard({ year, expanded }: { year: number; expanded?: boolean }) {
  const q = useQuery({
    queryKey: ["peildatum", year],
    queryFn: () => get<PeildatumChecklist>(`/api/box3/${year}/checklist`),
  });
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [showDone, setShowDone] = useState(false);
  const c = q.data;
  if (!c) return null;
  const waiting = c.items.filter((i) => i.status === "later").length;
  const open = toggled ?? (expanded || c.open > 0);
  const sorted = [...c.items].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const done = sorted.filter((i) => i.status === "ok").length;
  // What's done folds into one line.
  const items = showDone ? sorted : sorted.filter((i) => i.status !== "ok");
  return (
    <Card
      title={c.passed ? t("Ready for 1 January {year}?", { year }) : t("Getting ready for 1 January {year}", { year })}
      actions={
        <div className="flex items-center gap-3">
          {c.open > 0 ? (
            <Badge tone="warn">{tn(c.open, "{n} to do", "{n} to do")}</Badge>
          ) : waiting > 0 ? (
            <Badge>{tn(waiting, "{n} after 31 December", "{n} after 31 December")}</Badge>
          ) : (
            <span className="text-xs text-gain">✓ {t("Ready")}</span>
          )}
          <button type="button" className="text-xs text-accent" onClick={() => setToggled(!open)}>
            {open ? t("Hide") : t("Show")}
          </button>
        </div>
      }
      padded={false}
    >
      {open && (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span
                className={cx(
                  // On its own line on phones, a column beside the text on larger screens.
                  "w-full shrink-0 text-xs sm:w-32",
                  i.status === "todo" ? "font-medium text-warn" : i.status === "ok" ? "text-gain" : "text-muted",
                )}
              >
                {label(i.status)}
              </span>
              <span className={cx("min-w-0 flex-1", i.status === "ok" ? "text-ink-2" : "text-ink")}>
                {i.account && <span className="font-medium">{i.account}: </span>}
                {i.text}
              </span>
              {i.link && (
                <Link to={i.link.to} className="shrink-0 text-xs text-accent">
                  {i.link.label} →
                </Link>
              )}
            </li>
          ))}
          {done > 0 && (
            <li className="px-4 py-2.5 text-sm">
              <button
                type="button"
                className="text-xs text-ink-2 hover:text-ink"
                onClick={() => setShowDone(!showDone)}
              >
                <span className="text-gain">✓</span> {tn(done, "{n} done", "{n} done")} ·{" "}
                <span className="text-accent">{showDone ? t("Hide") : t("Show")}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
