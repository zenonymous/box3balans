import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { get, type User } from "../api";
import { AttentionBadge } from "../pages/Attention";
import { Spinner, cx } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: "◎", end: true },
  { to: "/holdings", label: "Holdings", icon: "▤" },
  { to: "/performance", label: "Performance", icon: "↗" },
  { to: "/income", label: "Income", icon: "❖" },
  { to: "/box3", label: "Box 3", icon: "§" },
  { to: "/transactions", label: "Transactions", icon: "⇄" },
  { to: "/metals", label: "Metals", icon: "◆" },
  { to: "/accounts", label: "Accounts", icon: "▣" },
  { to: "/connections", label: "Connections", icon: "⇅" },
  { to: "/wallets", label: "Wallets", icon: "◈" },
  { to: "/assets", label: "Assets", icon: "◇" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

// The bottom bar on phones shows the most used pages; the rest live under Settings/More.
const MOBILE_NAV = ["/", "/holdings", "/transactions", "/metals", "/settings"];

export function Layout({ user }: { user: User }) {
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
            <div className="text-[11px] text-muted">Your vault lives at home</div>
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
          Signed in as {user.username}
          {version.data && (
            <div className="mt-0.5 tabular-nums">
              Version {version.data.version} ·{" "}
              <a
                className="underline-offset-2 hover:underline"
                href={version.data.source}
                target="_blank"
                rel="noreferrer"
              >
                source
              </a>
            </div>
          )}
        </div>
      </aside>

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 sm:px-6 md:pb-10 md:pt-8">
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
