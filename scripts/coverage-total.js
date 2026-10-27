// Adds up the statement coverage of the server and the web app (after `npm run coverage` wrote
// server/coverage and web/coverage) and fails below 80% together: the OpenSSF Best Practices
// silver level asks for 80% statement coverage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN = 80;
let covered = 0;
let total = 0;
for (const part of ["server", "web"]) {
  const { statements } = JSON.parse(
    fs.readFileSync(path.join(ROOT, part, "coverage/coverage-summary.json"), "utf8"),
  ).total;
  console.log(`${part}: ${statements.pct}% of ${statements.total} statements`);
  covered += statements.covered;
  total += statements.total;
}
const pct = Math.round((covered / total) * 10000) / 100;
console.log(`together: ${pct}% of ${total} statements (at least ${MIN}% required)`);
if (pct < MIN) process.exitCode = 1;
