import { StrictMode, lazy, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import "./index.css";
import { ApiError, get, post, setUnauthorizedHandler, type User } from "./api";
import { Layout } from "./components/Layout";
import { switchSession } from "./queries";
import { Button, Field, Input, Spinner } from "./components/ui";
import { followLanguage, t, type Lang } from "./i18n";

// Pages load on demand, so the first paint (and the login screen) skips the charting library.
const OverviewPage = lazy(() => import("./pages/Overview").then((m) => ({ default: m.OverviewPage })));
const HoldingsPage = lazy(() => import("./pages/Holdings").then((m) => ({ default: m.HoldingsPage })));
const TransactionsPage = lazy(() => import("./pages/Transactions").then((m) => ({ default: m.TransactionsPage })));
const ImportPage = lazy(() => import("./pages/Import").then((m) => ({ default: m.ImportPage })));
const ActivityPage = lazy(() => import("./pages/Activity").then((m) => ({ default: m.ActivityPage })));
const InventoryPage = lazy(() => import("./pages/Inventory").then((m) => ({ default: m.InventoryPage })));
const AttentionPage = lazy(() => import("./pages/Attention").then((m) => ({ default: m.AttentionPage })));
const MetalsPage = lazy(() => import("./pages/Metals").then((m) => ({ default: m.MetalsPage })));
const AccountsPage = lazy(() => import("./pages/Accounts").then((m) => ({ default: m.AccountsPage })));
const ConnectionsPage = lazy(() => import("./pages/Connections").then((m) => ({ default: m.ConnectionsPage })));
const WalletsPage = lazy(() => import("./pages/Wallets").then((m) => ({ default: m.WalletsPage })));
const PerformancePage = lazy(() => import("./pages/Performance").then((m) => ({ default: m.PerformancePage })));
const IncomePage = lazy(() => import("./pages/Income").then((m) => ({ default: m.IncomePage })));
const Box3Page = lazy(() => import("./pages/Box3").then((m) => ({ default: m.Box3Page })));
const AssetsPage = lazy(() => import("./pages/Assets").then((m) => ({ default: m.AssetsPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const HouseholdPage = lazy(() => import("./pages/Household").then((m) => ({ default: m.HouseholdPage })));
const StartPage = lazy(() => import("./pages/Start").then((m) => ({ default: m.StartPage })));
const TaxReturnPage = lazy(() => import("./pages/TaxReturn").then((m) => ({ default: m.TaxReturnPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2 },
  },
});

interface AuthState {
  needsSetup: boolean;
  user: User | null;
  language?: Lang;
  demo?: boolean;
}

function AuthGate() {
  const qc = useQueryClient();
  const auth = useQuery({ queryKey: ["auth"], queryFn: () => get<AuthState>("/api/auth/state"), staleTime: Infinity });

  // The language is a server setting; this browser follows it (reloading once if it changed).
  useEffect(() => followLanguage(auth.data?.language), [auth.data?.language]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(["auth"], (s: AuthState | undefined) => ({ needsSetup: s?.needsSetup ?? false, user: null }));
    });
  }, [qc]);

  if (auth.isLoading) return <Spinner />;
  if (auth.error)
    return (
      <p className="p-6 text-loss">{t("Cannot reach the server: {error}", { error: (auth.error as Error).message })}</p>
    );
  if (!auth.data?.user) return <Login setup={auth.data?.needsSetup ?? false} />;

  return (
    <Routes>
      <Route element={<Layout user={auth.data.user} demo={auth.data.demo} />}>
        <Route index element={<OverviewPage />} />
        <Route path="holdings" element={<HoldingsPage />} />
        <Route path="performance" element={<PerformancePage />} />
        <Route path="income" element={<IncomePage />} />
        <Route path="box3" element={<Box3Page />} />
        <Route path="box3/aangifte" element={<TaxReturnPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="transactions/import" element={<ImportPage />} />
        <Route path="metals" element={<MetalsPage />} />
        <Route path="metals/inventory" element={<InventoryPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="household" element={<HouseholdPage />} />
        <Route path="start" element={<StartPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="wallets" element={<WalletsPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="attention" element={<AttentionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Login({ setup }: { setup: boolean }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Asked for after the password when two-step verification is on.
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (setup && password !== confirm) return setError(t("Passwords do not match"));
    setBusy(true);
    try {
      const { user } = await post<{ user: User }>(setup ? "/api/auth/setup" : "/api/auth/login", {
        username,
        password,
        ...(needsCode ? { code } : {}),
      });
      switchSession(qc, user);
    } catch (err) {
      if (err instanceof ApiError && err.data?.needsCode) {
        // The first time it's a question, not an error.
        if (needsCode) setError(err.message);
        setNeedsCode(true);
        setCode("");
        return;
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="" className="size-14" />
          <div className="mt-3 text-xl font-semibold tracking-tight">Kluishuis</div>
          <div className="text-sm text-muted">{t("Your vault lives at home")}</div>
        </div>
        <h1 className="text-lg font-semibold">{setup ? t("Welcome: create your account") : t("Sign in")}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {setup
            ? t("Kluishuis has a single user. Choose a strong password (12 or more characters).")
            : t("Your investments and box 3, on your own server.")}
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <Field label={t("Username")}>
            {(id) => (
              <Input
                id={id}
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            )}
          </Field>
          <Field label={t("Password")}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete={setup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={setup ? 12 : 1}
              />
            )}
          </Field>
          {setup && (
            <Field label={t("Confirm password")}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              )}
            </Field>
          )}
          {needsCode && (
            <Field
              label={t("Code from your authenticator app")}
              hint={t("Or one of your recovery codes, if you don't have your phone.")}
            >
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoFocus
                />
              )}
            </Field>
          )}
          {error && <p className="text-sm text-loss">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "…" : setup ? t("Create account") : t("Sign in")}
          </Button>
        </div>
      </form>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
