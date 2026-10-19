import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { csvContribution, personalData } from "../src/import/contribute.js";
import { recognise } from "../src/import/formats/index.js";
import {
  SHARED_FILES,
  SHARED_FORMATS,
  type SharedFormat,
  matchShared,
  readExpected,
  sharedFormatSchema,
} from "../src/import/formats/shared.js";
import { mappingSchema } from "../src/import/mapping.js";
import { parseCsv, parseDate } from "../src/import/parse.js";
import { readStatement } from "../src/import/statement.js";

/**
 * Formats shared by users (src/import/formats/shared/): data from strangers, so each one is checked
 * before it ships. See the README there for adding one.
 */
const DIR = path.resolve(__dirname, "../src/import/formats/shared");

function check(format: SharedFormat, all: SharedFormat[]) {
  expect(sharedFormatSchema.parse(format)).toEqual(format);
  // Its sample is its own: no built-in format, and no shared format before it, claims it.
  expect(recognise(format.sample)).toBeNull();
  expect(readStatement(format.sample)).toBeNull();
  const match = matchShared(format.sample, all);
  expect(match?.format.id).toBe(format.id);
  // It reads its sample as it says, with at least one transaction.
  expect(readExpected(format.sample, match!.mapping, format.account)).toEqual(format.expected);
  expect(format.expected.some((e) => e.status === "ok")).toBe(true);
  // Nothing in it looks like an IBAN, an e-mail address, a phone number or a BSN (dates aside).
  const order = format.mapping.dateOrder === "auto" ? "DMY" : format.mapping.dateOrder;
  const cells = parseCsv(format.sample, format.mapping.delimiter ?? ",").flat();
  const personal = cells.filter((c) => !parseDate(c, order) && personalData(c, null));
  expect(personal).toEqual([]);
}

describe("shared formats", () => {
  it("are all listed in shared.ts, each with its own id", () => {
    const files = fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect([...SHARED_FILES].sort()).toEqual(files);
    const ids = SHARED_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const format of SHARED_FORMATS)
    it(`${format.provider} (${format.id}) reads its own sample`, () => check(format, SHARED_FORMATS));

  it("a format made by the app passes the same checks", () => {
    const content = [
      "Date,Action,Instrument,ISIN,Shares,Price,Amount,Currency,Reference,Comment",
      "2025-03-01,BUY,Some Fund,IE00B4L5Y983,5,80.10,-400.50,EUR,X-1001,first buy for Robin",
      "2025-03-15,BUY,Other Share,US0378331005,2,170.00,-340.00,USD,X-1002,",
      "2025-04-01,DIVIDEND,Some Fund,IE00B4L5Y983,,,3.21,EUR,X-1003,",
      "2025-05-01,SELL,Other Share,US0378331005,-1,180.00,180.00,USD,X-1004,partial",
    ].join("\n");
    const made = csvContribution({
      content,
      mapping: mappingSchema.parse({
        columns: { date: 0, type: 1, name: 2, isin: 3, quantity: 4, price: 5, total: 6, currency: 7, id: 8, notes: 9 },
        typeMode: "column",
        typeValues: { BUY: "buy", SELL: "sell", DIVIDEND: "dividend" },
      }),
      account: "broker",
      provider: "Example Broker",
      avoid: ["Robin"],
      seed: 1,
    }).file;
    check(made, [...SHARED_FORMATS, made]);
    expect(made.sample).not.toContain("Robin");
    expect(made.expected.map((e) => e.type)).toEqual(["buy", "buy", "dividend", "sell"]);
  });
});
