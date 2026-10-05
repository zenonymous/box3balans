import { describe, expect, it } from "vitest";
import { yahooQuote } from "../src/prices/yahoo.js";

describe("test setup", () => {
  it("blocks real network calls, so every test runs on stubs", async () => {
    await expect(yahooQuote("AAPL")).rejects.toThrow(/Real network call in a test/);
  });
});
