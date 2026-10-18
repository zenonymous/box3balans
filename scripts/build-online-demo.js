// Builds the online demo for box3balans.nl/demo/ into web/dist-demo: the web app without a server
// (vite build --mode online-demo), plus every answer the demo's pages ask for, recorded once from a
// real demo server, in Dutch and in English. web/src/staticDemo.ts answers from those.
//
//   npm run build:online-demo
//   npm run preview:online-demo -w web      (then open http://localhost:4173/demo/)
//
// It starts its own demo server (an in-memory database, no network) on DEMO_PORT, 8099 by default.
// DEMO_VERSION is the version the demo shows (CI passes the release tag); else `git describe`.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "web/dist-demo");
const PORT = Number(process.env.DEMO_PORT ?? 8099);
const BASE = `http://127.0.0.1:${PORT}`;

// What every page asks for when it opens.
const FIXED = [
  "/api/auth/state",
  "/api/auth/2fa",
  "/api/version",
  "/api/updates",
  "/api/settings",
  "/api/household",
  "/api/accounts",
  "/api/assets",
  "/api/attention",
  "/api/portfolio",
  "/api/prices/status",
  "/api/performance",
  "/api/returns",
  "/api/costs",
  "/api/income",
  "/api/dividends/forecast",
  "/api/dividends/withholding",
  "/api/box3",
  "/api/metals/overview",
  "/api/metals/products",
  "/api/integrations",
  "/api/integrations/providers",
  "/api/wallets",
  "/api/wallets/chains",
  "/api/backups",
  "/api/imports",
  "/api/import/presets",
  "/api/network",
];
const RANGES = ["1M", "3M", "1Y", "5Y", "ALL"];
// Saved whole; staticDemo.ts filters and pages them.
const LISTS = ["/api/transactions", "/api/activity"];
const DOWNLOADS = ["/api/export/transactions.csv", "/api/export/holdings.csv", "/api/import/template.csv"];
// The app's pages (web/src/main.tsx); each gets its own copy of index.html, so a link to it works.
const PAGES = [
  "holdings",
  "performance",
  "income",
  "box3",
  "box3/aangifte",
  "transactions",
  "transactions/import",
  "metals",
  "metals/inventory",
  "accounts",
  "household",
  "start",
  "connections",
  "wallets",
  "assets",
  "settings",
  "activity",
  "attention",
  "network",
];

function version() {
  const tag =
    process.env.DEMO_VERSION ??
    (() => {
      try {
        return execFileSync("git", ["describe", "--tags", "--abbrev=0"], { cwd: ROOT, encoding: "utf8" }).trim();
      } catch {
        return "dev";
      }
    })();
  return tag.replace(/^v/, "");
}

let cookie = "";
async function call(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "x-requested-with": "portfolio",
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // One session for the whole recording (the demo signs in every visitor without one).
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
}

async function waitForServer(server) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("the demo server stopped");
    try {
      if ((await fetch(`${BASE}/api/version`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the demo server did not start");
}

const shown = version();

async function record(lang) {
  const dir = path.join(OUT, "data", lang);
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  const index = {};
  const save = async (url, data, status = 200) => {
    // A server outside Docker doesn't know its version (the version, the dossier and updates show it).
    for (const key of ["version", "current"]) if (data?.[key] === "dev") data = { ...data, [key]: shown };
    const file = `${createHash("sha256").update(url).digest("hex").slice(0, 16)}.json`;
    // The demo keeps its backups in a temporary folder of this machine; show the image's folder.
    fs.writeFileSync(path.join(dir, file), JSON.stringify(data).replace(/[^"]*box3balans-demo-\w+/g, "/backups"));
    index[url] = { status, file };
    return data;
  };
  const get = async (url) => {
    const res = await call("GET", url);
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    if (res.status >= 500) throw new Error(`${url}: ${res.status} ${JSON.stringify(data)}`);
    return save(url, data, res.status);
  };

  for (const url of FIXED) await get(url);
  for (const range of RANGES) await get(`/api/portfolio/history?range=${range}`);

  const accounts = await (await call("GET", "/api/accounts")).json();
  for (const a of accounts) {
    await get(`/api/accounts/${a.id}/years`);
    await get(`/api/import/statement/${a.id}`);
  }

  const { years } = await (await call("GET", "/api/box3")).json();
  const yearList = years.map((y) => (typeof y === "number" ? y : y.year));
  for (const y of yearList) {
    for (const part of ["", "/checklist", "/dossier", "/return"]) await get(`/api/box3/${y}${part}`);
    for (const a of accounts) await get(`/api/import/statement/${a.id}?day=${y - 1}-12-31`);
  }
  const future = await (await call("GET", "/api/box3/future")).json();
  for (const p of future.presets ?? []) {
    await get(`/api/box3/future?${new URLSearchParams({ preset: p.id })}`);
    // The one choice there that isn't typed in.
    for (const back of ["0", "1"])
      await get(`/api/box3/future?${new URLSearchParams({ preset: p.id, carryBackYears: back })}`);
  }

  for (const list of LISTS) {
    const items = [];
    for (let offset = 0; ; offset += 200) {
      const res = await call("GET", `${list}?limit=200&offset=${offset}`);
      const page = await res.json();
      if (!res.ok) throw new Error(`${list}: ${res.status} ${JSON.stringify(page)}`);
      items.push(...page.items);
      if (!page.items.length || items.length >= page.total) break;
    }
    await save(list, { total: items.length, items });
  }

  for (const url of DOWNLOADS) {
    const res = await call("GET", url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    fs.writeFileSync(path.join(dir, "files", url.split("/").pop()), Buffer.from(await res.arrayBuffer()));
  }

  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  return yearList;
}

// 1. The app.
fs.rmSync(OUT, { recursive: true, force: true });
execFileSync("npx", ["vite", "build", "--mode", "online-demo"], { cwd: path.join(ROOT, "web"), stdio: "inherit" });

// 2. The answers, from a demo server of this checkout.
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: path.join(ROOT, "server"),
  env: { ...process.env, DEMO: "true", PORT: String(PORT), HOST: "127.0.0.1", LOG_LEVEL: "warn", WEB_DIST: "-" },
  stdio: ["ignore", "inherit", "inherit"],
});
let years;
try {
  await waitForServer(server);
  for (const lang of ["nl", "en"]) {
    const res = await call("PUT", "/api/settings", { language: lang });
    if (!res.ok) throw new Error(`language ${lang}: ${res.status}`);
    years = await record(lang);
  }
  await call("PUT", "/api/settings", { language: "nl" });
} finally {
  server.kill();
}

// 3. A page for every route, kept out of search results (the example household isn't anyone's).
const html = fs
  .readFileSync(path.join(OUT, "index.html"), "utf8")
  .replace("<title>", '<meta name="robots" content="noindex" />\n    <title>');
fs.writeFileSync(path.join(OUT, "index.html"), html);
// Both box3.html and box3/index.html: GitHub Pages serves /demo/box3 from either, and box3/ also
// holds the pages below it.
for (const page of [...PAGES, ...years.map((y) => `box3/${y}/dossier`)]) {
  for (const file of [path.join(OUT, `${page}.html`), path.join(OUT, page, "index.html")]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
  }
}
const manifestFile = path.join(OUT, "manifest.webmanifest");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
manifest.start_url = manifest.scope = "/demo/";
manifest.icons = manifest.icons.map((i) => ({ ...i, src: `/demo${i.src}` }));
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

const size = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => {
    const p = path.join(d, e.name);
    return n + (e.isDirectory() ? size(p) : fs.statSync(p).size);
  }, 0);
console.log(
  `Online demo in ${path.relative(ROOT, OUT)}: ${(size(OUT) / 1e6).toFixed(1)} MB, of which data ${(size(path.join(OUT, "data")) / 1e6).toFixed(1)} MB; years ${years.join(", ")}`,
);
