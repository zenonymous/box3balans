import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NL } from "./nl";

/**
 * Every text the code passes to t(), tn() or tj() needs a Dutch translation in nl.ts. Texts must be
 * string literals (in double quotes) so this check can find them.
 */
const SRC = path.resolve(__dirname, "..");
const unquote = (s: string) => JSON.parse(`"${s}"`) as string;
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !p.includes(`${path.sep}i18n${path.sep}`)
      ? [p]
      : [];
  });
}

export function usedTexts(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sources(SRC)) {
    const code = fs.readFileSync(file, "utf8");
    const rel = path.relative(SRC, file);
    for (const m of code.matchAll(new RegExp(String.raw`\b(?:t|tj)\(\s*${STR}`, "g"))) found.set(unquote(m[1]!), rel);
    for (const m of code.matchAll(
      new RegExp(String.raw`\btn\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*${STR}\s*,\s*${STR}`, "g"),
    )) {
      found.set(unquote(m[1]!), rel);
      found.set(unquote(m[2]!), rel);
    }
  }
  return found;
}

describe("Dutch translations", () => {
  it("cover every text in the app", () => {
    const missing = [...usedTexts()].filter(([text]) => !(text in NL)).map(([text, file]) => `${file}: ${text}`);
    expect(missing).toEqual([]);
  });

  it("keep placeholders and element markers", () => {
    const tokens = (s: string) => [...s.matchAll(/\{\w+\}|<\/?\d+>/g)].map((m) => m[0]).sort();
    const broken = Object.entries(NL)
      .filter(([en, nl]) => JSON.stringify(tokens(en)) !== JSON.stringify(tokens(nl)))
      .map(([en]) => en);
    expect(broken).toEqual([]);
  });
});
