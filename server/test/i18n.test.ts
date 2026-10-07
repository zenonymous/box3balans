import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NL } from "../src/i18n/nl.js";
import { createTestApp, type TestApp } from "./helpers.js";

/**
 * Every message the server passes to tr(), trn() or msg() needs a Dutch translation in nl.ts.
 * Messages must be string literals (in double quotes) so this check can find them.
 */
const SRC = path.resolve(__dirname, "../src");
const unquote = (s: string) => JSON.parse(`"${s}"`) as string;
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return p.endsWith(`${path.sep}i18n`) ? [] : sources(p);
    return e.name.endsWith(".ts") ? [p] : [];
  });
}

export function usedMessages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sources(SRC)) {
    const code = fs.readFileSync(file, "utf8");
    const rel = path.relative(SRC, file);
    for (const m of code.matchAll(new RegExp(String.raw`\b(?:tr|msg)\(\s*${STR}`, "g"))) found.set(unquote(m[1]!), rel);
    for (const m of code.matchAll(
      new RegExp(String.raw`\btrn\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*${STR}\s*,\s*${STR}`, "g"),
    )) {
      found.set(unquote(m[1]!), rel);
      found.set(unquote(m[2]!), rel);
    }
  }
  return found;
}

describe("Dutch server messages", () => {
  it("cover every message", () => {
    const missing = [...usedMessages()].filter(([text]) => !(text in NL)).map(([text, file]) => `${file}: ${text}`);
    expect(missing).toEqual([]);
  });

  it("keep placeholders", () => {
    const tokens = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
    const broken = Object.entries(NL)
      .filter(([en, nl]) => JSON.stringify(tokens(en)) !== JSON.stringify(tokens(nl)))
      .map(([en]) => en);
    expect(broken).toEqual([]);
  });
});

describe("the app in Dutch", () => {
  let t: TestApp;

  it("answers in the language that is set, validation messages included", async () => {
    t = await createTestApp(undefined, { lang: "nl" });
    try {
      const missing = await t.api("PUT", "/api/accounts/999999", { name: "x" });
      expect(JSON.parse(missing.body).error).toBe("Rekening niet gevonden");
      const invalid = JSON.parse((await t.api("POST", "/api/household", { role: "self" })).body);
      expect(invalid.error).toBe("Ongeldige invoer");
      expect(invalid.issues[0].message).toMatch(/^Ongeldige invoer/);

      await t.api("PUT", "/api/settings", { language: "en" });
      const english = await t.api("PUT", "/api/accounts/999999", { name: "x" });
      expect(JSON.parse(english.body).error).toBe("Account not found");
    } finally {
      await t.close();
    }
  });
});
