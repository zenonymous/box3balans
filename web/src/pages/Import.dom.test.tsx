// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../test/import.fixture.json";
import { fakeApi } from "../test/api";
import { ImportPage } from "./Import";

/**
 * The import page with a CSV Box3balans doesn't recognise: the columns as the server guesses them,
 * the preview it sends back (rows read, and a row it can't read), and a changed setting that asks
 * for a new preview. The server's answers are written out here; the server tests cover how it
 * reads the file itself.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CSV =
  "Datum;Soort;ISIN;Aantal;Koers\n05-01-2025;Koop;IE00B4L5Y983;10;85,40\n31-02-2025;Koop;IE00B4L5Y983;1;86,00\n";

const fields = [
  "date",
  "time",
  "type",
  "symbol",
  "isin",
  "name",
  "assetType",
  "quantity",
  "price",
  "total",
  "currency",
  "fee",
  "amount",
  "tax",
  "notes",
  "id",
];
const mapping = {
  skipRows: 0,
  delimiter: null,
  decimal: "auto",
  dateOrder: "auto",
  columns: { ...Object.fromEntries(fields.map((f) => [f, null])), date: 0, type: 1, isin: 2, quantity: 3, price: 4 },
  typeMode: "column",
  fixedType: "buy",
  typeValues: { Koop: "buy" },
  assetKind: "auto",
  defaultCurrency: "EUR",
  feeCurrency: "trade",
  settleCash: false,
  assetOverrides: {},
};
const plan = {
  headers: ["Datum", "Soort", "ISIN", "Aantal", "Koers"],
  sample: [
    ["05-01-2025", "Koop", "IE00B4L5Y983", "10", "85,40"],
    ["31-02-2025", "Koop", "IE00B4L5Y983", "1", "86,00"],
  ],
  detected: { delimiter: ";", decimal: ",", dateOrder: "DMY" },
  typeValues: [{ value: "Koop", count: 2 }],
  rows: [
    {
      line: 2,
      status: "new",
      date: "2025-01-05T11:00:00.000Z",
      type: "buy",
      assetKey: "security:IE00B4L5Y983",
      quantity: "10",
      price: "85.4",
      currency: "EUR",
    },
    { line: 3, status: "error", message: "Datum “31-02-2025” kan niet worden gelezen" },
  ],
  assets: [
    {
      key: "security:IE00B4L5Y983",
      label: "IE00B4L5Y983",
      rows: 1,
      match: {
        id: 90,
        symbol: "IWDA",
        name: "iShares Core MSCI World",
        assetClass: "etf",
        priceSource: "yahoo",
        priceRef: "IWDA.AS",
      },
      overridden: false,
    },
  ],
  summary: { new: 1, duplicate: 0, deleted: 0, "possible-duplicate": 0, skipped: 0, error: 1 },
  warnings: [],
};

function show(routes: Record<string, unknown> = {}) {
  const api = fakeApi({
    ...fixture,
    "/api/imports": [],
    "POST /api/import/upload": { uploadId: "u-1", fileName: "export.csv", format: null, mapping, preset: null },
    "POST /api/import/preview": plan,
    ...routes,
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/transactions/import"]}>
        <ImportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}

async function chooseFile() {
  const account = await screen.findByLabelText("Importeren in rekening");
  await waitFor(() => expect(within(account).getAllByRole("option").length).toBeGreaterThan(1));
  fireEvent.change(account, { target: { value: "1" } });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File([CSV], "export.csv", { type: "text/csv" })] } });
}

describe("CSV import page", () => {
  it("sends the file, shows the columns and what each line becomes, with the line it can't read", async () => {
    const api = show();
    await chooseFile();
    await screen.findByText("2 · Kolommen");
    expect(api.requests.find((r) => r.url === "/api/import/upload")?.body).toMatchObject({
      fileName: "export.csv",
      content: CSV,
    });
    // The preview: the line read (date, type, asset, quantity) and the error for the other.
    expect(await screen.findByText("Datum “31-02-2025” kan niet worden gelezen")).toBeTruthy();
    expect(screen.getAllByText(/IWDA/).length).toBeGreaterThan(0);
    expect(screen.getByText("5 jan 2025")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 transactie importeren" })).toBeTruthy();
    expect(api.missed).toEqual([]);
  });

  it("asks for a new preview with the setting you change", async () => {
    const api = show();
    await chooseFile();
    const decimal = await screen.findByLabelText("Decimaalteken");
    fireEvent.change(decimal, { target: { value: "," } });
    await waitFor(() =>
      expect(
        api.requests.some(
          (r) =>
            r.url === "/api/import/preview" && (r.body as { mapping: { decimal: string } }).mapping.decimal === ",",
        ),
      ).toBe(true),
    );
    const last = api.requests.filter((r) => r.url === "/api/import/preview").at(-1)!.body as {
      uploadId: string;
      accountId: number;
    };
    expect(last).toMatchObject({ uploadId: "u-1", accountId: 1 });
  });

  it("imports the new lines and says what it added", async () => {
    const api = show({
      "POST /api/import/commit": {
        importId: 3,
        inserted: 1,
        skipped: 0,
        newAssets: ["IWDA"],
        warnings: [],
        transfersMatched: 0,
      },
    });
    await chooseFile();
    fireEvent.click(await screen.findByRole("button", { name: "1 transactie importeren" }));
    expect(await screen.findByText(/1 transactie toegevoegd aan/)).toBeTruthy();
    expect(screen.getByText(/Nieuwe beleggingen: IWDA/)).toBeTruthy();
    expect(api.requests.find((r) => r.url === "/api/import/commit")?.body).toMatchObject({
      uploadId: "u-1",
      accountId: 1,
      include: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "Nog een bestand importeren" }));
    expect(await screen.findByLabelText("Importeren in rekening")).toBeTruthy();
  });

  it("reads a DEGIRO portfolio as a statement: in the DEGIRO account, for the day you give", async () => {
    const check = {
      accountId: 1,
      source: "Portfolio.csv",
      day: "2025-12-31",
      differences: 0,
      rows: [
        {
          assetId: 90,
          name: "iShares Core MSCI World",
          isin: "IE00B4L5Y983",
          reported: "10",
          computed: "10",
          difference: "0",
          price: "100",
          currency: "EUR",
        },
      ],
    };
    const api = show({
      "POST /api/import/upload": {
        uploadId: "u-2",
        fileName: "Portfolio.csv",
        statement: {
          label: "DEGIRO-portefeuille",
          positions: 1,
          currencies: ["EUR"],
          day: null,
          source: "degiro-portfolio",
        },
      },
      "POST /api/import/statement": check,
      "/api/import/statement/1": check,
    });
    // No account chosen: the statement goes to the only DEGIRO account.
    await waitFor(() =>
      expect(within(screen.getByLabelText("Importeren in rekening")).getAllByRole("option").length).toBeGreaterThan(1),
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["Product,Symbool/ISIN"], "Portfolio.csv")] } });
    expect(await screen.findByText("2 · Herkend: DEGIRO-portefeuille")).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Importeren in rekening").value).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Vergelijken met de transacties" }));
    expect(await screen.findByText(/DEGIRO: alles klopt met het overzicht van/)).toBeTruthy();
    expect(api.requests.find((r) => r.url === "/api/import/statement")?.body).toMatchObject({
      uploadId: "u-2",
      accountId: 1,
      day: expect.stringMatching(/^\d{4}-12-31$/),
    });
  });

  it("undoes an earlier import after you confirm", async () => {
    const api = show({
      "/api/imports": [
        {
          id: 3,
          accountName: "DEGIRO",
          fileName: "Account.csv",
          rows: 40,
          inserted: 38,
          remaining: 36,
          createdAt: "2026-10-20T10:00:00Z",
        },
      ],
      "DELETE /api/imports/3": {},
    });
    const earlier = (await screen.findByText("Account.csv")).closest("li")!;
    expect(within(earlier).getByText(/38 geïmporteerd, 36 nog aanwezig/)).toBeTruthy();
    fireEvent.click(within(earlier).getByRole("button", { name: "Terugdraaien" }));
    const dialog = await screen.findByRole("dialog", { name: "Deze import terugdraaien?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "36 transacties verwijderen" }));
    await waitFor(() =>
      expect(api.requests.some((r) => r.method === "DELETE" && r.url === "/api/imports/3")).toBe(true),
    );
  });
});
