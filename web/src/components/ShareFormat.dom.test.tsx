// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { type Contribution, ShareFormat } from "./ShareFormat";

/** Sharing a file's format without its data (ADR 0012). */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const csv = (replace: string[]): Contribution => ({
  fileName: "formaat-voorbeeldbank.json",
  file: { sample: "Datum;Omschrijving;Bedrag\n2025-03-01;Fonds A;12,50\n" },
  lines: { file: 40, sample: 3 },
  kept: [
    { kind: "header", value: "Datum", count: 1, replaced: replace.includes("header:Datum") },
    { kind: "header", value: "Omschrijving", count: 1, replaced: false },
    { kind: "word", value: "Sanne", count: 2, replaced: true, flag: "name" },
  ],
});

describe("sharing a format", () => {
  it("makes the file, lets you replace what stays from yours, and downloads exactly what it shows", async () => {
    const make = vi.fn(async ({ replace }: { provider: string; hint: string; replace: string[] }) => csv(replace));
    showPage("/import", "import", <ShareFormat kind="csv" make={make} />, {
      "GET /api/version": { version: "0.1.42", source: "https://example.org/box3balans" },
    });
    const card = (await screen.findByRole("heading", { name: "Help anderen dit bestand in te lezen" })).closest(
      "section",
    )!;
    fireEvent.click(within(card).getByRole("button", { name: "Bestand om te delen maken…" }));
    const make1 = within(card).getByRole<HTMLButtonElement>("button", { name: "Bestand maken" });
    expect(make1.disabled).toBe(true); // needs a provider first
    fireEvent.change(within(card).getByLabelText("Broker, bank of beurs"), { target: { value: " Voorbeeldbank " } });
    fireEvent.change(within(card).getByLabelText(/Welke export\?/), { target: { value: "Rekening → Export" } });
    fireEvent.click(make1);
    await waitFor(() => expect(make).toHaveBeenCalledTimes(1));
    expect(make.mock.calls[0]![0]).toEqual({ provider: "Voorbeeldbank", hint: "Rekening → Export", replace: [] });
    expect(await within(card).findByText(/Datum;Omschrijving;Bedrag/)).toBeTruthy();

    // A name in the household is always replaced: its box can't be ticked again.
    const name = within(card).getByText("Sanne").closest("label")!;
    expect(within(name).getByRole<HTMLInputElement>("checkbox").disabled).toBe(true);
    expect(within(name).getByText("een naam in je huishouden")).toBeTruthy();
    // Unticking a column name makes the file again with it replaced.
    fireEvent.click(within(within(card).getByText("Datum").closest("label")!).getByRole("checkbox"));
    await waitFor(() => expect(make).toHaveBeenCalledTimes(2));
    expect(make.mock.calls[1]![0].replace).toEqual(["header:Datum"]);

    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blob = b as Blob;
      return "blob:test";
    });
    let saved = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved = this.download;
    });
    fireEvent.click(await within(card).findByRole("button", { name: /Bestand downloaden/ }));
    expect(saved).toBe("formaat-voorbeeldbank.json");
    expect(JSON.parse(await blob!.text())).toEqual(csv(["header:Datum"]).file);
    // The form is on the project the running version came from.
    expect(
      within(card)
        .getByRole("link", { name: /Formulier op GitHub openen/ })
        .getAttribute("href"),
    ).toBe("https://example.org/box3balans/issues/new?template=formaat-delen.yml");
  });

  it("shows a statement's pages, keeps common words apart, and says what it waits for", async () => {
    const make = vi.fn(async (): Promise<Contribution> => ({
      fileName: "formaat-bank.json",
      file: { pages: [{ page: 1, text: "Jaaroverzicht 2025\nSaldo 1 januari 1.234,56" }] },
      kept: [
        { kind: "word", value: "Jaaroverzicht", count: 1, replaced: false },
        { kind: "word", value: "saldo", count: 1, replaced: false, common: true },
        { kind: "word", value: "januari", count: 1, replaced: false, common: true },
      ],
    }));
    showPage("/accounts", "accounts", <ShareFormat kind="pdf" provider="Bank" make={make} />);
    const card = (await screen.findByRole("heading", { name: "Help anderen dit overzicht in te lezen" })).closest(
      "section",
    )!;
    fireEvent.click(within(card).getByRole("button", { name: "Bestand om te delen maken…" }));
    expect(within(card).getByLabelText<HTMLInputElement>("Aanbieder").value).toBe("Bank");
    fireEvent.click(within(card).getByRole("button", { name: "Bestand maken" }));
    expect(await within(card).findByText(/— p\. 1 —/)).toBeTruthy();
    expect(within(card).getByText(/2 gewone woorden uit overzichten/)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Opnieuw maken" })).toBeTruthy();
  });
});
