import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { get, type User } from "../api";
import { AttentionBadge } from "../pages/Attention";
import { Alert, Spinner, cx } from "./ui";
import { t, tj } from "../i18n";

const NAV = [
  { to: "/", label: t("Overview"), icon: "◎", end: true },
  { to: "/holdings", label: t("Holdings"), icon: "▤" },
  { to: "/performance", label: t("Performance"), icon: "↗" },
  { to: "/income", label: t("Income"), icon: "❖" },
  { to: "/box3", label: t("Box 3"), icon: "§" },
  { to: "/transactions", label: t("Transactions"), icon: "⇄" },
  { to: "/metals", label: t("Metals"), icon: "◆" },
  { to: "/accounts", label: t("Accounts"), icon: "▣" },
  { to: "/household", label: t("Household"), icon: "⌂" },
  { to: "/connections", label: t("Connections"), icon: "⇅" },
  { to: "/wallets", label: t("Wallets"), icon: "◈" },
  { to: "/assets", label: t("Assets"), icon: "◇" },
  { to: "/settings", label: t("Settings"), icon: "⚙" },
];

// The bottom bar on phones shows the most used pages; the rest live under Settings/More.
const MOBILE_NAV = ["/", "/holdings", "/transactions", "/metals", "/settings"];

export function Layout({ user, demo }: { user: User; demo?: boolean }) {
  const version = useQuery({
    queryKey: ["version"],
    queryFn: () => get<{ version: string; source: string }>("/api/version"),
    staleTime: Infinity,
  });
  return (
    <div className="min-h-dvh md:flex">
      <aside className="print:hidden sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="/favicon.svg" alt="" className="size-8" />
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">Kluishuis</div>
            <div className="text-[11px] text-muted">{t("Your vault lives at home")}</div>
          </div>
        </div>
        <AttentionBadge className="mb-3" />
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                  isActive ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )
              }
            >
              <span aria-hidden className="w-4 text-center">
                {n.icon}
              </span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-2.5 text-xs text-muted">
          {t("Signed in as {name}", { name: user.username })}
          {version.data && (
            <div className="mt-0.5 tabular-nums">
              {t("Version {version}", { version: version.data.version })} ·{" "}
              <a
                className="underline-offset-2 hover:underline"
                href={version.data.source}
                target="_blank"
                rel="noreferrer"
              >
                {t("source")}
              </a>
            </div>
          )}
        </div>
      </aside>

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 sm:px-6 md:pb-10 md:pt-8">
        {demo && (
          <div className="mb-4 print:hidden">
            <Alert>
              {tj(
                "This is the demo: an example household with made-up prices. Changes are lost when it restarts. <0>Install Kluishuis</0> to keep track of your own.",
                [<a key="i" className="underline" href={version.data?.source} target="_blank" rel="noreferrer" />],
              )}
            </Alert>
          </div>
        )}
        <AttentionBadge className="mb-4 md:hidden print:hidden" />
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>

      <nav className="print:hidden fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.filter((n) => MOBILE_NAV.includes(n.to)).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", isActive ? "text-accent" : "text-ink-2")
            }
          >
            <span aria-hidden className="text-base leading-none">
              {n.icon}
            </span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
