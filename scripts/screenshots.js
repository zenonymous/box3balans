// Screenshots for the README, from the demo (made-up data), in light and dark.
//
//   npm run demo            (in another terminal; needs `npm run build -w web` first)
//   npm run screenshots
//
// Needs Chrome, Chromium, Brave or Edge; set CHROME_PATH if it isn't found. Writes WebP files to
// docs/images/. BASE_URL points elsewhere (default http://localhost:8082).
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:8082";
const OUT = path.resolve(import.meta.dirname, "../docs/images");
// Each page: its path, the height of the view, and optionally a heading to scroll to the top.
const SHOTS = [
  { name: "overzicht", path: "/", height: 840 },
  { name: "box3", path: "/box3?year=2025", height: 1040, scrollTo: "Berekening 2025" },
  { name: "aangifte", path: "/box3/aangifte?year=2025", height: 840 },
  { name: "edelmetaal", path: "/metals", height: 910 },
];

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const browserPath = process.env.CHROME_PATH ?? CANDIDATES.find((p) => fs.existsSync(p));
if (!browserPath) throw new Error("No Chrome-like browser found; set CHROME_PATH");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  // A throwaway profile, so the browser's own profile is never touched.
  userDataDir: fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "box3balans-shots-")),
  args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars"],
});
try {
  const page = await browser.newPage();
  for (const theme of ["light", "dark"]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
    for (const s of SHOTS) {
      // 1280 px wide at 1.25×: 1600 px images, sharp at the README's width on high-density screens.
      await page.setViewport({ width: 1280, height: s.height, deviceScaleFactor: 1.25 });
      await page.goto(BASE + s.path, { waitUntil: "networkidle0", timeout: 30_000 });
      await sleep(1500); // chart animations
      if (s.scrollTo) {
        await page.evaluate((text) => {
          const title = [...document.querySelectorAll("h1,h2,h3,[class*=font-semibold]")].find((e) =>
            e.textContent?.includes(text),
          );
          title?.closest("section,div")?.scrollIntoView({ block: "start" });
          window.scrollBy(0, -16);
        }, s.scrollTo);
        await sleep(500);
      }
      const file = path.join(OUT, `${s.name}-${theme}.webp`);
      await page.screenshot({ path: file, type: "webp", quality: 80 });
      console.log(`${path.relative(process.cwd(), file)}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
    }
  }
} finally {
  await browser.close();
}
