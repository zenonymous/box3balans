import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The documentation comes in Dutch and English: README.md next to README.en.md, docs/x.md next to
 * docs/en/x.md (SECURITY.md has both in one file, because GitHub only shows that one). And every
 * relative link in either language, with its #anchor, has to lead somewhere.
 */
const ROOT = path.resolve(__dirname, "../..");
const rel = (f: string) => path.relative(ROOT, f);

function markdown(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ["node_modules", ".git", "dist", ".data"].includes(e.name) ? [] : markdown(p);
    return e.name.endsWith(".md") ? [p] : [];
  });
}

// Dutch documents and where their English version is.
function englishOf(file: string): string | null {
  const r = rel(file);
  if (r.startsWith("docs/en/") || r.endsWith(".en.md")) return null;
  if (r.startsWith("docs/")) return path.join(ROOT, "docs/en", r.slice("docs/".length));
  if (["README.md", "CONTRIBUTING.md", "CONTEXT.md"].includes(r) || r.startsWith("server/src/import/formats/shared/"))
    return file.replace(/\.md$/, ".en.md");
  return null;
}

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered.
function anchors(file: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence = false;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    const m = !fence && /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (!m) continue;
    const text = m[1]!.replace(/`/g, "").replace(/\\/g, "");
    const slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    out.add(n ? `${slug}-${n}` : slug);
  }
  return out;
}

const files = markdown(ROOT);

describe("documentation in two languages", () => {
  it("has an English version of every Dutch document", () => {
    const missing = files
      .map((f) => [f, englishOf(f)] as const)
      .filter(([, en]) => en && !fs.existsSync(en))
      .map(([f]) => rel(f));
    expect(missing).toEqual([]);
    expect(fs.readFileSync(path.join(ROOT, "SECURITY.md"), "utf8")).toContain("# Security (in English)");
  });

  it("has no relative link or anchor that leads nowhere", () => {
    const broken: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
      for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1]!;
        if (/^[a-z]+:/i.test(target)) continue; // https:, mailto:
        const [p, hash] = target.split("#") as [string, string | undefined];
        const dest = p ? path.resolve(path.dirname(file), decodeURI(p)) : file;
        if (!fs.existsSync(dest)) broken.push(`${rel(file)}: ${target}`);
        else if (hash && dest.endsWith(".md") && !anchors(dest).has(decodeURIComponent(hash)))
          broken.push(`${rel(file)}: ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
