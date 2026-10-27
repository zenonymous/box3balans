import { Link } from "react-router";
import { cx } from "./ui";
import { useAttention } from "../queries";
import { tn } from "../i18n";

/** Sidebar / top-of-page link shown while problems or warnings are open. */
export function AttentionBadge({ className }: { className?: string }) {
  const attention = useAttention();
  const open = (attention.data ?? []).filter((i) => !i.dismissed && i.severity !== "info");
  if (!open.length) return null;
  const problem = open.some((i) => i.severity === "problem");
  return (
    <Link
      to="/attention"
      className={cx(
        "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium",
        problem ? "bg-danger-bg text-loss" : "bg-warn-bg text-warn",
        className,
      )}
    >
      <span aria-hidden>{problem ? "⛔" : "⚠"}</span>
      {tn(open.length, "{n} needs attention", "{n} need attention")}
    </Link>
  );
}
