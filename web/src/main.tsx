import { StrictMode, lazy, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import "./index.css";
import { ApiError, get, post, setUnauthorizedHandler, type User } from "./api";
import { Layout } from "./components/Layout";
import { Button, Field, Input, Spinner } from "./components/ui";

// Pages load on demand, so the first paint (and the login screen) skips the charting library.
const OverviewPage = lazy(() => import("./pages/Overview").then((m) => ({ default: m.OverviewPage })));
const HoldingsPage = lazy(() => import("./pages/Holdings").then((m) => ({ default: m.HoldingsPage })));
const TransactionsPage = lazy(() => import("./pages/Transactions").then((m) => ({ default: m.TransactionsPage })));
const ImportPage = lazy(() => import("./pages/Import").then((m) => ({ default: m.ImportPage })));
const MetalsPage = lazy(() => import("./pages/Metals").then((m) => ({ default: m.MetalsPage })));
const AccountsPage = lazy(() => import("./pages/Accounts").then((m) => ({ default: m.AccountsPage })));
const ConnectionsPage = lazy(() => import("./pages/Connections").then((m) => ({ default: m.ConnectionsPage })));
const WalletsPage = lazy(() => import("./pages/Wallets").then((m) => ({ default: m.WalletsPage })));
const PerformancePage = lazy(() => import("./pages/Performance").then((m) => ({ default: m.PerformancePage })));
const IncomePage = lazy(() => import("./pages/Income").then((m) => ({ default: m.IncomePage })));
const Box3Page = lazy(() => import("./pages/Box3").then((m) => ({ default: m.Box3Page })));
const AssetsPage = lazy(() => import("./pages/Assets").then((m) => ({ default: m.AssetsPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2 },
  },
});

interface AuthState {
  needsSetup: boolean;
  user: User | null;
}

function AuthGate() {
  const qc = useQueryClient();
  const auth = useQuery({ queryKey: ["auth"], queryFn: () => get<AuthState>("/api/auth/state"), staleTime: Infinity });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(["auth"], (s: AuthState | undefined) => ({ needsSetup: s?.needsSetup ?? false, user: null }));
    });
  }, [qc]);

  if (auth.isLoading) return <Spinner />;
  if (auth.error) return <p className="p-6 text-loss">Cannot reach the server: {(auth.error as Error).message}</p>;
  if (!auth.data?.user) return <Login setup={auth.data?.needsSetup ?? false} />;

  return (
    <Routes>
      <Route element={<Layout user={auth.data.user} />}>
        <Route index element={<OverviewPage />} />
        <Route path="holdings" element={<HoldingsPage />} />
        <Route path="performance" element={<PerformancePage />} />
        <Route path="income" element={<IncomePage />} />
        <Route path="box3" element={<Box3Page />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="transactions/import" element={<ImportPage />} />
        <Route path="metals" element={<MetalsPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="wallets" element={<WalletsPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="settings" element={<SettingsPage />} />
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
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (setup && password !== confirm) return setError("Passwords do not match");
    setBusy(true);
    try {
      const { user } = await post<{ user: User }>(setup ? "/api/auth/setup" : "/api/auth/login", {
        username,
        password,
      });
      qc.clear();
      qc.setQueryData(["auth"], { needsSetup: false, user });
    } catch (err) {
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
          <div className="text-sm text-muted">Your vault lives at home</div>
        </div>
        <h1 className="text-lg font-semibold">{setup ? "Welcome — create your account" : "Sign in"}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {setup
            ? "Kluishuis has a single user. Choose a strong password (12+ characters)."
            : "Stocks, crypto, gold and silver, on your own server."}
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <Field label="Username">
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
          <Field label="Password">
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
            <Field label="Confirm password">
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
          {error && <p className="text-sm text-loss">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "…" : setup ? "Create account" : "Sign in"}
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
