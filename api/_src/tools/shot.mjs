// Screenshot + health check for local /api pages (needs a static server on the GitHub/ folder).
//   node api/_src/tools/shot.mjs <outDir> <path> [path…] [--base=http://127.0.0.1:8787] [--width=1440] [--height=900] [--dark] [--full] [--mobile]
// Prints, per page: HTTP status, console errors, failed requests (4xx/5xx/aborted), and the screenshot path.
// Uses the system Edge through Playwright (no browser download needed).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("D:/A.CancriCode/package.json");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : dflt;
};
const has = (name) => args.includes(`--${name}`);
const [outDir, ...paths] = args.filter((a) => !a.startsWith("--"));
if (!outDir || !paths.length) {
  console.error("usage: node shot.mjs <outDir> <path> [path…] [--dark] [--full] [--mobile] [--width=] [--height=] [--base=]");
  process.exit(2);
}
const base = flag("base", "http://127.0.0.1:8787");
const mobile = has("mobile");
const width = Number(flag("width", mobile ? 390 : 1440));
const height = Number(flag("height", mobile ? 844 : 900));
const theme = has("dark") ? "dark" : "light";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
await context.addInitScript((t) => {
  try {
    localStorage.setItem("cancri_oai_theme", t);
    localStorage.setItem("theme", t);
    localStorage.setItem("theme_user", "1");
  } catch {}
}, theme);

let failures = 0;
for (const p of paths) {
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText || "failed"} ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  let status = 0;
  try {
    const res = await page.goto(base + p, { waitUntil: "networkidle", timeout: 30000 });
    status = res ? res.status() : 0;
  } catch (e) {
    errors.push(`goto: ${e.message}`);
  }
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}-${theme}${mobile ? "-m" : ""}.png`);
  if (has("full")) {
    // <body> is the scroll container on these pages (OpenAI's CSS), so Playwright's fullPage only
    // paints the first screen; grow the viewport to the content height instead.
    const h = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    await page.setViewportSize({ width, height: Math.min(h, 16000) });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: file });
  if (has("full")) await page.setViewportSize({ width, height });
  const bad = errors.length || failed.length || status >= 400;
  if (bad) failures++;
  console.log(`${bad ? "✗" : "✓"} ${p}  status=${status}  console-errors=${errors.length}  failed-requests=${failed.length}  → ${file}`);
  for (const e of errors.slice(0, 8)) console.log(`    console: ${e.slice(0, 200)}`);
  for (const f of failed.slice(0, 8)) console.log(`    request: ${f.slice(0, 200)}`);
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
