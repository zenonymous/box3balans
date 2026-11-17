// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { toCsv } from "../../server/src/lib/csv";
import { downloadCsv } from "./csv";

afterEach(() => vi.restoreAllMocks());

/** Runs downloadCsv and returns the file it would have downloaded. */
async function download<T>(rows: T[], columns: Parameters<typeof downloadCsv<T>>[2]) {
  let blob: Blob | undefined;
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    blob = b as Blob;
    return "blob:test";
  });
  let name = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    name = this.download;
  });
  downloadCsv("export.csv", rows, columns);
  return { name, text: await blob!.text(), type: blob!.type };
}

describe("downloadCsv", () => {
  it("writes a header and rows with RFC 4180 quoting, CRLF line ends and a BOM for Excel", async () => {
    const { name, text, type } = await download(
      [{ name: 'Fonds "Wereld", acc', amount: 1234.5, note: null }],
      [
        { header: "Name", value: (r) => r.name },
        { header: "Amount", value: (r) => r.amount },
        { header: "Note", value: (r) => r.note },
      ],
    );
    expect(name).toBe("export.csv");
    expect(type).toBe("text/csv;charset=utf-8");
    expect(text).toBe("\uFEFF" + 'Name,Amount,Note\r\n"Fonds ""Wereld"", acc",1234.5,');
  });

  it("defuses text that a spreadsheet would run as a formula, but leaves negative numbers alone", async () => {
    const { text } = await download(
      ['=HYPERLINK("x")', "+31 6", "@SUM(A1)", "-12.50", "-x"],
      [{ header: "v", value: (r) => r }],
    );
    expect(text.split("\r\n").slice(1)).toEqual(['"\'=HYPERLINK(""x"")"', "'+31 6", "'@SUM(A1)", "-12.50", "'-x"]);
  });

  // The server exports CSV too (server/src/lib/csv.ts), with the same defusing of formulas (CWE-1236).
  // A fix in one must reach the other: both get the same hostile cells and must write the same file.
  it("escapes exactly like the server's CSV export", async () => {
    const cells = [
      "=1+1",
      "+31 6 1234",
      "-5",
      "-5 euro",
      "-0.25",
      "@SUM(A1)",
      "\tcmd",
      "\rcmd",
      'a "quoted", cell',
      "two\nlines",
      '=HYPERLINK("http://x", "y")',
      "",
      "gewoon",
    ];
    const rows = cells.map((cell) => ({ cell, n: -12.5 }));
    const columns = [
      { header: "=Header", value: (r: { cell: string }) => r.cell },
      { header: "N", value: (r: { n: number }) => r.n },
    ];
    const { text } = await download(rows, columns);
    // The server ends the file with a line end; the web doesn't.
    expect(text + "\r\n").toBe(toCsv(rows, columns));
    expect(text).toContain("'=1+1");
  });
});
