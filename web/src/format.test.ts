import { describe, expect, it } from "vitest";
import { parseNumberInput, toApiNumber, unambiguous } from "./format";

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
    expect(() => toApiNumber("1.2.3,4", "Quantity")).toThrow("Quantity: “1.2.3,4” is not a number");
  });
});
