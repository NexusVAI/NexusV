import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { usage, legacyUsage } from "./fixtures/logs-usage.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const output = resolve(root, "../tasks/artifacts/logs-redesign");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
let server;
let browser;
let origin;

before(async () => {
  server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let path = resolve(root, "." + pathname);
    if (!path.startsWith(root + sep)) return res.writeHead(403).end();
    if (pathname.endsWith("/")) path = resolve(path, "index.html");
    try {
      const content = await readFile(path);
      res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" }).end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  await mkdir(output, { recursive: true });
});
after(async () => {
  await browser?.close();
  await new Promise((done) => server?.close(done));
});

async function openPage(t, { theme = "light", rows = usage, viewport = { width: 1720, height: 1100 }, mobile = false, preview = true, authenticated = true } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, timezoneId: "Asia/Shanghai", isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  t.after(() => context.close());
  await context.addInitScript((theme) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("cancri_oai_theme", theme);
    localStorage.setItem("theme_user", "1");
    localStorage.setItem("lang", "zh");
  }, theme);
  const calls = [];
  const outside = [];
  const errors = [];
  const failed = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/chat/api/platform-auth.js") {
      // Test-only session stub: never shipped or installed in the production page.
      return route.fulfill({ contentType: "text/javascript", body: `window.PlatformAuth={requireSession:async()=>(${authenticated ? '{user:{email:"preview@example.test",id:"synthetic-preview"}}' : 'null'}),getSession:async()=>({access_token:"local-fixture"}),redirectToLogin:()=>{}};` });
    }
    if (url.pathname === "/functions/v1/chat-gateway") {
      const endpoint = request.postDataJSON()?.endpoint;
      calls.push(endpoint);
      const data = endpoint === "api_my_usage" ? { usage: rows, spend: { total_micro: 0, month_micro: 0 } }
        : endpoint === "get_quota_status" ? { wallet: { balance_micro: 100000000 } }
        : endpoint === "list_my_orders" ? { orders: [] } : {};
      return route.fulfill({ contentType: "application/json", json: data });
    }
    if (url.origin === origin) return route.continue();
    outside.push(url.origin + url.pathname);
    return route.fulfill({ contentType: "application/json", json: {} });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
  page.on("requestfailed", (request) => failed.push(`${request.failure()?.errorText} ${request.url()}`));
  const response = await page.goto(origin + "/api/console/logs/", { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  if (authenticated && rows.length) {
    try { await page.locator("#cnc-logs-list table").waitFor(); }
    catch (error) {
      console.error("Log page probe:", { calls, errors, failed, outside, state: await page.evaluate(() => ({ localized: document.documentElement.dataset.cncL10n, auth: typeof window.PlatformAuth, table: typeof window.CancriLogsTable, panel: !!document.querySelector("._4d2eR"), title: document.title })) });
      throw error;
    }
  }
  if (preview && authenticated) {
    await page.evaluate(() => {
      const title = document.querySelector(".Q7AC0");
      const badge = document.createElement("span");
      badge.textContent = "模拟数据 · UI 预览";
      badge.style.cssText = "display:inline-flex;align-items:center;font:500 11px/24px system-ui,sans-serif;letter-spacing:0;border:1px solid var(--border-color);border-radius:6px;padding:0 9px;margin-left:16px;vertical-align:middle;color:var(--secondary-text);background:var(--pill-bg)";
      title?.appendChild(badge);
    });
  }
  return { page, calls, outside, errors, failed };
}

function assertHealthy(result) {
  assert.deepEqual(result.errors, [], "browser console should be clean");
  assert.deepEqual(result.failed, [], "local assets should load");
  assert.deepEqual(result.outside, [], "no unmocked production request should be made");
}

async function screenshot(page, name) {
  await page.screenshot({ path: resolve(output, name + ".png"), animations: "disabled" });
  console.log("Screenshot: " + resolve(output, name + ".png"));
}

test("full desktop log uses real page chrome and all requested columns", async (t) => {
  const result = await openPage(t);
  const { page } = result;
  const table = page.locator(".cnc-log-table--detail");
  assert.equal(await table.locator("thead th").count(), 10);
  assert.equal(await table.locator("tbody tr").count(), usage.length);
  assert.equal(await table.locator('[data-effort="max"][data-tone="red"]').count(), 1);
  assert.equal(await table.locator('[data-effort="xhigh"][data-tone="yellow"]').count(), 1);
  assert.equal(await table.locator('[data-effort="none"][data-tone="gray"]').count(), 2);
  assert.match(await table.locator("tbody tr").first().innerText(), /77\.8%/);
  assert.match(await table.locator("tbody tr").first().innerText(), /5,248/);
  assert.match(await table.locator("tbody tr").first().innerText(), /¥0\.0352/);
  const fits = await page.locator(".cnc-log-scroll").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  assert.equal(fits, true, "wide desktop should show all columns without horizontal scrolling");
  assertHealthy(result);
  await screenshot(page, "logs-desktop-light");
});

test("1440px desktop keeps all columns and has no document overflow", async (t) => {
  const result = await openPage(t, { viewport: { width: 1440, height: 1000 } });
  const metrics = await result.page.evaluate(() => ({
    width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    tableWidth: document.querySelector(".cnc-log-scroll").clientWidth,
    tableScrollWidth: document.querySelector(".cnc-log-scroll").scrollWidth,
  }));
  assert.ok(metrics.documentWidth <= metrics.width + 1 && metrics.bodyWidth <= metrics.width + 1, JSON.stringify(metrics));
  assert.ok(metrics.tableScrollWidth <= metrics.tableWidth + 1, "1440px desktop should show every column");
  assertHealthy(result);
  await screenshot(result.page, "logs-desktop-1440");
});

test("search, filters, empty result and today tab still work after redesign", async (t) => {
  const { page, ...health } = await openPage(t);
  const search = page.getByRole("searchbox");
  await search.fill("opus");
  assert.equal(await page.locator(".cnc-log-table tbody tr").count(), 2);
  await search.fill("no-such-model");
  assert.match(await page.locator("#cnc-logs-list").innerText(), /没有|无/);
  await search.fill("");
  await page.getByRole("button", { name: "添加筛选" }).click();
  await page.locator('.cnc-filter-opt:has-text("只看失败")').click();
  assert.equal(await page.locator(".cnc-log-table tbody tr").count(), 1);
  assert.match(await page.locator(".cnc-log-table tbody").innerText(), /429/);
  await page.keyboard.press("Escape");
  await page.locator('[data-clear-filter="status"]').click();
  assert.equal(await page.locator(".cnc-log-table tbody tr").count(), usage.length);
  await page.getByRole("radio", { name: "今日概览" }).click();
  assert.equal(await page.locator("#cnc-today-panel").isVisible(), true);
  assert.equal(await page.locator(".cnc-log-table").isVisible(), false);
  await page.getByRole("radio", { name: "响应", exact: true }).click();
  assert.equal(await page.locator(".cnc-log-table tbody tr").count(), usage.length);
  assertHealthy(health);
});

test("real API-shaped rows never receive fixture telemetry", async (t) => {
  const result = await openPage(t, { rows: legacyUsage, preview: false });
  const table = result.page.locator(".cnc-log-table");
  assert.equal(await table.locator("[data-cache-tone]").count(), 0);
  assert.equal(await table.locator("[data-effort]").count(), 0);
  assert.match(await table.innerText(), /¥0\.0352/);
  assert.doesNotMatch(await table.innerText(), /0\.00 s|77\.8%|203\.0\.113\.24|非流/);
  assert.equal(await result.page.getByText("模拟数据 · UI 预览").count(), 0);
  assertHealthy(result);
});

test("narrow touch screens scroll every column without overflowing the page", async (t) => {
  const result = await openPage(t, { viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = result;
  const scroller = page.locator(".cnc-log-scroll");
  const metrics = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
  assert.ok(metrics.documentWidth <= 391 && metrics.bodyWidth <= 391, JSON.stringify(metrics));
  assert.ok(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth));
  await scroller.focus();
  assert.equal(await scroller.evaluate((el) => el === document.activeElement), true);
  // The snapshot scrolls .-Kn9p rather than body; restore its top after testing focus.
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.querySelector(".-Kn9p").scrollTop = 0;
  });
  const title = await page.locator(".Q7AC0").boundingBox();
  assert.ok(title.y >= 0 && title.y < 150, "overview screenshot must include the page title");
  await screenshot(page, "logs-mobile");
  await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  const ip = await page.locator(".cnc-log-table tbody tr:first-child td:nth-child(9)").boundingBox();
  const key = await page.locator(".cnc-log-table tbody tr:first-child td:nth-child(10)").boundingBox();
  const bounds = await scroller.boundingBox();
  assert.ok(ip.x >= bounds.x && key.x + key.width <= bounds.x + bounds.width + 1, "IP and key columns must be fully readable");
  await screenshot(page, "logs-mobile-details");
  assertHealthy(result);
});

test("dark theme keeps cache and effort colors distinct", async (t) => {
  const result = await openPage(t, { theme: "dark" });
  assert.equal(await result.page.locator("html").getAttribute("data-theme"), "dark");
  const colors = await result.page.locator("[data-cache-tone]").evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.dataset.cacheTone, getComputedStyle(node).color])));
  assert.equal(new Set(Object.values(colors)).size, 3);
  assertHealthy(result);
  await screenshot(result.page, "logs-desktop-dark");
});

test("no-session route remains gated with no usage calls", async (t) => {
  const result = await openPage(t, { authenticated: false, preview: false });
  assert.equal(await result.page.locator(".cnc-log-table").count(), 0);
  assert.deepEqual(result.calls, []);
  assert.equal(await result.page.locator("html").getAttribute("data-cnc-l10n"), null);
  assertHealthy(result);
});

test("a truly empty usage response preserves the existing empty state", async (t) => {
  const result = await openPage(t, { rows: [], preview: false });
  assert.equal(await result.page.locator(".cnc-log-table").count(), 0);
  assert.equal(await result.page.locator('._4d2eR[data-fill="static"]').isVisible(), true);
  assertHealthy(result);
});
