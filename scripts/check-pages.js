// Opens every page of the demo on a phone and a desktop screen, in light and dark, and reports what a
// screenshot would show is wrong: errors in the console, a page that scrolls sideways, and text cut
// off by a box that hides its overflow (text shortened with "…" on purpose, and tables that scroll
// inside their card, don't count).
//
//   npm run demo           (in another terminal; needs `npm run build -w web` first)
//   npm run check:pages
//   npm run check:pages -- / /holdings      (just these pages)
//
// Needs Chrome, Chromium, Brave or Edge (CHROME_PATH if it isn't found). BASE_URL points elsewhere.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:8082";
const ALL = [
  "/",
  "/holdings",
  "/performance",
  "/income",
  "/box3",
  "/box3/aangifte",
  `/box3/${new Date().getFullYear() - 1}/dossier`,
  "/transactions",
  "/transactions/import",
  "/accounts",
  "/connections",
  "/wallets",
  "/metals",
  "/metals/inventory",
  "/assets",
  "/household",
  "/settings",
  "/activity",
  "/start",
];
const PAGES = process.argv.length > 2 ? process.argv.slice(2) : ALL;
const SCREENS = [
  { name: "phone", width: 375, height: 812, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1280, height: 900 },
];

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const browserPath = process.env.CHROME_PATH ?? CANDIDATES.find((p) => fs.existsSync(p));
if (!browserPath) throw new Error("No Chrome-like browser found; set CHROME_PATH");

// Runs in the page: what sticks out.
function inspect() {
  const out = [];
  const root = document.scrollingElement;
  if (root.scrollWidth > window.innerWidth + 1)
    out.push(`page scrolls sideways (${root.scrollWidth}px wide for ${window.innerWidth}px)`);
  const describe = (el) => {
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
    return `<${el.tagName.toLowerCase()}> "${text}"`;
  };
  // Text in an element that scrolls on purpose (a wide table in its card) may run past the edge.
  const scrollsBetween = (el, outer) => {
    for (let p = el.parentElement; p && p !== outer; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll") return true;
    }
    return false;
  };
  const texts = [...document.querySelectorAll("body *")].filter((el) => {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
    const cs = getComputedStyle(el);
    return cs.textOverflow !== "ellipsis" && cs.visibility !== "hidden" && !el.closest(".sr-only, [aria-hidden=true]");
  });
  for (const el of texts) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Outside its card: covered by the card next to it, or cut off.
    const card = el.closest("section");
    if (card && !scrollsBetween(el, card)) {
      const c = card.getBoundingClientRect();
      if (r.right > c.right + 1 || r.left < c.left - 1) {
        out.push(`${describe(el)} sticks out of its card`);
        continue;
      }
    }
    // Cut off by something narrower that hides what doesn't fit.
    for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
      const o = getComputedStyle(box).overflowX;
      if (o === "auto" || o === "scroll") break;
      if (o !== "hidden" && o !== "clip") continue;
      // A line shortened with "…" on purpose.
      if (getComputedStyle(box).textOverflow === "ellipsis") break;
      const b = box.getBoundingClientRect();
      if (r.right > b.right + 1 || r.left < b.left - 1) out.push(`${describe(el)} is cut off`);
      break;
    }
  }
  return [...new Set(out)];
}

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  userDataDir: fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "box3balans-check-")),
  args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars"],
});
let problems = 0;
try {
  const page = await browser.newPage();
  let errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const theme of ["light", "dark"]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
    for (const screen of SCREENS) {
      await page.setViewport(screen);
      for (const p of PAGES) {
        errors = [];
        await page.goto(BASE + p, { waitUntil: "networkidle0", timeout: 30_000 });
        await new Promise((r) => setTimeout(r, 700));
        const found = [...errors.map((e) => `console: ${e.slice(0, 160)}`), ...(await page.evaluate(inspect))];
        for (const f of found) console.log(`${p} (${screen.name}, ${theme}): ${f}`);
        problems += found.length;
      }
    }
  }
} finally {
  await browser.close();
}
console.log(problems ? `${problems} problem(s).` : `All ${PAGES.length} pages look fine.`);
process.exit(problems ? 1 : 0);
