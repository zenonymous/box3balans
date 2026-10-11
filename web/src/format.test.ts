import { describe, expect, it } from "vitest";
import { dateInputText, parseDateInput, parseNumberInput, toApiNumber, unambiguous } from "./format";

const nl = (s: string) => parseNumberInput(s, "nl-NL");
const en = (s: string) => parseNumberInput(s, "en-IE");

describe("parseNumberInput (Dutch format)", () => {
  // Review fix: "5.000" used to be stored as 5 while the UI shows numbers Dutch-style.
  it("reads a dot followed by three digits as thousands, and flags it", () => {
    expect(nl("5.000")).toEqual({ value: "5000", ambiguous: true });
    expect(nl("1.500")).toEqual({ value: "1500", ambiguous: true });
    expect(nl("12.345")).toEqual({ value: "12345", ambiguous: true });
  });

  it("reads the comma as the decimal mark", () => {
    expect(nl("1,5")).toEqual({ value: "1.5", ambiguous: false });
    expect(nl("0,0015")).toEqual({ value: "0.0015", ambiguous: false });
    expect(nl("1.234,56")).toEqual({ value: "1234.56", ambiguous: false });
    expect(nl("1.234.567,8")).toEqual({ value: "1234567.8", ambiguous: false });
    expect(nl("€ 1 234,56".replace("€", ""))).toEqual({ value: "1234.56", ambiguous: false });
  });

  it("keeps numbers copied from English sources working when they can't be thousands", () => {
    expect(nl("0.0015")).toEqual({ value: "0.0015", ambiguous: false });
    expect(nl("1.5")).toEqual({ value: "1.5", ambiguous: false });
    expect(nl("0.500")).toEqual({ value: "0.500", ambiguous: false }); // "0." can't be a thousands group
    expect(nl("1,234.56")).toEqual({ value: "1234.56", ambiguous: false });
  });

  it("handles plain numbers, empty input and garbage", () => {
    expect(nl("2500")).toEqual({ value: "2500", ambiguous: false });
    expect(nl("")).toEqual({ value: "", ambiguous: false });
    expect(nl("abc").value).toBeNull();
    expect(nl("1.23.4").value).toBeNull();
    expect(nl("1,2,3").value).toBeNull();
    expect(nl("-3,5")).toEqual({ value: "-3.5", ambiguous: false });
  });
});

describe("parseNumberInput (English format)", () => {
  it("mirrors the rules", () => {
    expect(en("5,000")).toEqual({ value: "5000", ambiguous: true });
    expect(en("1.5")).toEqual({ value: "1.5", ambiguous: false });
    expect(en("1,234.56")).toEqual({ value: "1234.56", ambiguous: false });
    expect(en("0,5")).toEqual({ value: "0.5", ambiguous: false });
  });
});

describe("helpers", () => {
  it("formats without ambiguity and rejects bad input with a readable error", () => {
    expect(unambiguous("5000", "nl-NL")).toBe("5\u202f000");
    expect(unambiguous("1234.56", "nl-NL")).toBe("1\u202f234,56");
    expect(() => toApiNumber("1.2.3,4", "Quantity")).toThrow(/“1\.2\.3,4”/);
  });
});

describe("parseDateInput (day first)", () => {
  const p = (s: string) => parseDateInput(s, "2026-10-11");

  // UI review: the browser's own date field took "27" as month 2 and day 7.
  it("reads the day first, with any common separator", () => {
    expect(p("27-7-2020")).toBe("2020-07-27");
    expect(p("27/07/2020")).toBe("2020-07-27");
    expect(p("27.7.2020")).toBe("2020-07-27");
    expect(p(" 1 2 2021 ")).toBe("2021-02-01");
  });

  it("reads two-digit years as this century unless that is in the future", () => {
    expect(p("27-7-20")).toBe("2020-07-27");
    expect(p("1-1-26")).toBe("2026-01-01");
    expect(p("3-4-85")).toBe("1985-04-03");
  });

  it("accepts a pasted ISO date and eight digits", () => {
    expect(p("2020-07-27")).toBe("2020-07-27");
    expect(p("27072020")).toBe("2020-07-27");
    expect(p("20200727")).toBe("2020-07-27");
  });

  it("rejects days that don't exist and other input", () => {
    expect(p("31-2-2021")).toBeNull();
    expect(p("29-2-2023")).toBeNull();
    expect(p("29-2-2024")).toBe("2024-02-29");
    expect(p("13-13-2020")).toBeNull();
    expect(p("27-7")).toBeNull();
    expect(p("gisteren")).toBeNull();
    expect(p("")).toBe("");
  });

  it("shows an ISO day back day first", () => {
    expect(dateInputText("2020-07-27")).toBe("27-07-2020");
    expect(dateInputText("")).toBe("");
  });
});
