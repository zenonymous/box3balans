import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { Layout } from "../components/Layout";
import { fakeDemoApi } from "./api";
import demo from "./demo.fixture.json";

/** A page at `path`, inside the app's layout, answered by the demo household (see fakeDemoApi). */
export function showPage(path: string, route: string, page: ReactElement, routes: Record<string, unknown> = {}) {
  const api = fakeDemoApi(demo, routes);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout user={{ id: 1, username: "demo" }} demo />}>
            <Route path={route} element={page} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}
