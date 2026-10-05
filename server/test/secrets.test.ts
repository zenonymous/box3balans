import { describe, expect, it } from "vitest";
import { SecretBox } from "../src/lib/secrets.js";

describe("SecretBox", () => {
  const box = new SecretBox("a".repeat(40));

  it("round-trips and never stores plaintext", () => {
    const sealed = box.seal({ apiKey: "KEY123", apiSecret: "SECRET456" });
    expect(sealed).not.toContain("SECRET456");
    expect(box.open(sealed)).toEqual({ apiKey: "KEY123", apiSecret: "SECRET456" });
  });

  it("uses a fresh IV each time", () => {
    expect(box.seal("x")).not.toBe(box.seal("x"));
  });

  it("rejects tampering and a different APP_SECRET", () => {
    const sealed = box.seal({ a: 1 });
    const raw = Buffer.from(sealed.slice(3), "base64");
    raw[raw.length - 1]! ^= 1;
    expect(() => box.open(`v1:${raw.toString("base64")}`)).toThrow(/cannot be decrypted/);
    expect(() => new SecretBox("b".repeat(40)).open(sealed)).toThrow(/cannot be decrypted/);
  });
});
