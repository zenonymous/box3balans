// Turns the online demo's recorded answers (Dutch) into one fixture for the page tests:
// web/src/test/demo.fixture.json, { "/api/…?query": answer }. Run after `npm run build:online-demo`:
//
//   npm run fixtures:demo
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "web/dist-demo/data/nl");
const index = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));
const out = {};
for (const [url, saved] of Object.entries(index).sort(([a], [b]) => a.localeCompare(b)))
  if (saved.status === 200) out[url] = JSON.parse(fs.readFileSync(path.join(DIR, saved.file), "utf8"));
const file = path.join(ROOT, "web/src/test/demo.fixture.json");
fs.writeFileSync(file, JSON.stringify(out) + "\n");
console.log(
  `${Object.keys(out).length} answers in ${path.relative(ROOT, file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`,
);
