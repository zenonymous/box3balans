// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { TransactionsPage } from "./Transactions";

/** Recording transactions by hand, and filtering the list, with the demo household's accounts. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

async function openForm() {
  fireEvent.click(await screen.findByRole("button", { name: /Transactie toevoegen/ }));
  return screen.findByRole("dialog");
}

describe("Transactions page", () => {
  it("records a purchase with quantity and price in the notation you type", async () => {
    const api = showPage("/transactions", "transactions", <TransactionsPage />);
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText("Rekening"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Belegging"), { target: { value: "7" } });
    fireEvent.change(within(dialog).getByLabelText("Aantal"), { target: { value: "2,5" } });
    fireEvent.change(within(dialog).getByLabelText("Koers per eenheid"), { target: { value: "1.234,50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "POST", "/api/transactions")).toHaveLength(1));
    expect(sent(api, "POST", "/api/transactions")[0]).toMatchObject({
      type: "buy",
      accountId: 1,
      assetId: 7,
      quantity: "2.5",
      price: "1234.50", // as typed, not rounded
      currency: "EUR",
      feeEur: "0",
    });
  });

  it("records a dividend as a gross amount with the tax withheld, without a quantity", async () => {
    const api = showPage("/transactions", "transactions", <TransactionsPage />);
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText("Soort"), { target: { value: "dividend" } });
    fireEvent.change(within(dialog).getByLabelText("Rekening"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Belegging"), { target: { value: "7" } });
    fireEvent.change(await within(dialog).findByLabelText("Brutobedrag"), { target: { value: "20" } });
    fireEvent.change(within(dialog).getByLabelText("Ingehouden belasting"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(sent(api, "POST", "/api/transactions")).toHaveLength(1));
    expect(sent(api, "POST", "/api/transactions")[0]).toMatchObject({
      type: "dividend",
      quantity: "0",
      amount: "20",
      taxWithheld: "3",
    });
  });

  it("records a transfer between two of your own accounts", async () => {
    const api = showPage("/transactions", "transactions", <TransactionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Overboeking/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Van"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Naar"), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Belegging"), { target: { value: "8" } });
    fireEvent.change(within(dialog).getByLabelText("Aantal verstuurd"), { target: { value: "0,1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Overboeking opslaan" }));
    await waitFor(() => expect(sent(api, "POST", "/api/transactions/transfer")).toHaveLength(1));
    expect(sent(api, "POST", "/api/transactions/transfer")[0]).toMatchObject({
      fromAccountId: 2,
      toAccountId: 3,
      assetId: 8,
      quantity: "0.1",
    });
  });

  it("asks the server for the transactions of the account you filter on", async () => {
    const api = showPage("/transactions", "transactions", <TransactionsPage />);
    await screen.findAllByRole("option", { name: "Bitvavo" });
    const filter = screen.getByLabelText("Rekening");
    fireEvent.change(filter, { target: { value: "2" } });
    await waitFor(() =>
      expect(api.requests.some((r) => r.url.startsWith("/api/transactions?") && r.url.includes("accountId=2"))).toBe(
        true,
      ),
    );
  });
});
