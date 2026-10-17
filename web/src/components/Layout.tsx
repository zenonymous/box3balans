import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { get, type User } from "../api";
import { AttentionBadge } from "../pages/Attention";
import { Alert, Spinner, cx } from "./ui";
import { t, tj } from "../i18n";
import { MOBILE_BAR, NAV_GROUPS, PAGES, isCurrent, type Page } from "../nav";

function SideLink({ n }: { n: Page }) {
  return (
    <NavLink
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
  );
}

function BarLink({ to, icon, label, current }: { to: string; icon: string; label: string; current: boolean }) {
  return (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      className={cx(
        "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
        current ? "text-accent" : "text-ink-2",
      )}
    >
      <span aria-hidden className="text-base leading-none">
        {icon}
      </span>
      {label}
    </Link>
  );
}

export function Layout({ user, demo }: { user: User; demo?: boolean }) {
  const { pathname } = useLocation();
  // "More" is where you are on any page the bottom bar doesn't show.
  const inBar = MOBILE_BAR.some((p) => isCurrent(p, pathname));
  const version = useQuery({
    queryKey: ["version"],
    queryFn: () => get<{ version: string; source: string }>("/api/version"),
    staleTime: Infinity,
  });
  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-surface px-3 py-2 text-sm font-medium text-ink shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        {t("Skip to content")}
      </a>
      <aside className="print:hidden sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-8" />
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">Box3balans</div>
            <div className="text-[11px] text-muted">{t("Your box 3, in balance")}</div>
          </div>
        </div>
        <AttentionBadge className="mb-3" />
        <nav className="flex flex-col gap-4" aria-label={t("Main menu")}>
          {NAV_GROUPS.map((g) => (
            <div key={g.label} className="flex flex-col gap-0.5">
              <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{g.label}</div>
              {g.pages.map((n) => (
                <SideLink key={n.to} n={n} />
              ))}
            </div>
          ))}
          <div className="border-t border-line pt-3">
            <SideLink n={PAGES.settings} />
          </div>
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

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-24 pt-5 outline-none sm:px-6 md:pb-10 md:pt-8"
      >
        {demo && (
          <div className="mb-4 print:hidden">
            <Alert>
              {__STATIC_DEMO__
                ? tj(
                    "This is the online demo: an example household with made-up prices, to look around in. Nothing can be saved here. <0>Install Box3balans</0> to keep track of your own.",
                    [<a key="i" className="underline" href={version.data?.source} target="_blank" rel="noreferrer" />],
                  )
                : tj(
                    "This is the demo: an example household with made-up prices. Changes are lost when it restarts. <0>Install Box3balans</0> to keep track of your own.",
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

      <nav
        aria-label={t("Main menu")}
        className="print:hidden fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {MOBILE_BAR.map((p) => (
          <BarLink key={p.to} to={p.to} icon={p.icon} label={p.label} current={isCurrent(p, pathname)} />
        ))}
        <BarLink to={PAGES.settings.to} icon="⋯" label={t("More")} current={!inBar} />
      </nav>
    </div>
  );
}
