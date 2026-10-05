import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The commit the running code was built from. `git archive` (used by scripts/deploy.sh) fills in
 * the placeholder in the repository's VERSION file; anything else (a dev checkout) reads as "dev".
 */
function readVersion(): string {
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../VERSION");
    const v = fs.readFileSync(file, "utf8").trim();
    return v && !v.includes("$Format") ? v : "dev";
  } catch {
    return "dev";
  }
}

export const APP_VERSION = readVersion();
