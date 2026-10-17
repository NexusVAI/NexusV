#!/usr/bin/env node
/**
 * 把 Cancri Code 桌面端的 Bot 界面**原样**移植到网页（bot.html）。
 *
 *   node scripts/sync-bot-port.mjs [--src ../../cancri-code]
 *
 * 做三件事：
 *   1. 从 cancri-code/src/bot/bot-view.ts 起沿 import 图走一遍，把用到的源码逐字拷到 src/bot-port/src/<同一相对路径>
 *      （相对 import 因此一个字不用改）。只依赖桌面 / Tauri / agent loop 的那几个模块不拷，
 *      由 vite.bot.config.js 在构建时换成 src/bot-web/shims/ 里的网页实现（见 SHIMS）。
 *   2. `?raw` 引到 src 外面的图标（tasks/_codex-icons/…）一起拷。
 *   3. 桌面全局样式（styles.css / devin-ui.css / chat-port.css / rich-ui.css）按「移植过来的代码里出现过的类名」
 *      裁出一份 src/bot-port/desktop-shared.css：Bot 界面用到的 token、气泡 / 对话框 / 提示条 / 图片查看器样式与桌面一致。
 *
 * ⛔ src/bot-port/ 下的文件都是生成物，勿手改 —— 改桌面端源码后重跑本脚本。对话 UI 与 Cancri Code 一模一样靠的就是这个。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHAT = path.resolve(here, "..");
const argSrc = process.argv.indexOf("--src");
const DESKTOP = path.resolve(argSrc > 0 ? process.argv[argSrc + 1] : path.join(CHAT, "..", "..", "cancri-code"));
const SRC = path.join(DESKTOP, "src");
const OUT = path.join(CHAT, "src", "bot-port");
const ENTRY = "bot/bot-view.ts";

/** 不拷、构建时换成网页实现的模块（相对 cancri-code/src）。与 vite.bot.config.js 的 SHIMS 保持一致 */
export const SHIMS = [
  "auth.ts",
  "bot/bot-runtime.ts",
  "bot/bot-computer.ts",
  "sandbox/backend.ts",
  "tools/builtin/sandbox-cloud.ts",
  "tools/builtin/websearch.ts",
  "tools/builtin/webfetch.ts",
];
// model-menu-duck.css：确认 / 输入弹窗（showConfirmDialog 的 .cc-glass-dialog）的定位与尺寸在这里。
// 漏了它，网页端删除确认框会退回无样式的 modal-card：贴在左上角、撑满整屏高（2026-10-17 实报）。
const GLOBAL_CSS = ["styles.css", "devin-ui.css", "chat-port.css", "model-menu-duck.css", "chat/render/rich-ui.css"];
/** 网页没有的大字体：中文回落系统字体（PingFang / 微软雅黑 / Noto） */
const DROP_FONTS = ["NotoSansSC-Variable.woff2", "OpenAISans-"];

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveRel(fromAbs, spec) {
  const clean = spec.replace(/\?raw$/, "");
  const base = path.resolve(path.dirname(fromAbs), clean);
  for (const c of [base, `${base}.ts`, path.join(base, "index.ts"), `${base}.js`]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  throw new Error(`找不到 ${spec}（来自 ${path.relative(DESKTOP, fromAbs)}）`);
}

const copied = new Map(); // abs → rel to DESKTOP
const external = new Set();
function walk(abs) {
  const rel = path.relative(SRC, abs).replace(/\\/g, "/");
  if (copied.has(abs)) return;
  if (SHIMS.includes(rel)) return;
  copied.set(abs, path.relative(DESKTOP, abs).replace(/\\/g, "/"));
  if (!/\.(ts|js)$/.test(abs)) return;
  const code = fs.readFileSync(abs, "utf8");
  for (const m of code.matchAll(IMPORT_RE)) {
    if (m[1]) continue; // import type / export type：构建时擦掉
    const spec = m[2] || m[3];
    if (!spec.startsWith(".")) {
      external.add(spec);
      continue;
    }
    walk(resolveRel(abs, spec));
  }
}
walk(path.join(SRC, ENTRY));

fs.rmSync(OUT, { recursive: true, force: true });
const manifest = { source: path.relative(CHAT, DESKTOP).replace(/\\/g, "/"), entry: ENTRY, shims: SHIMS, external: [...external].sort(), files: {} };
const header = (rel) => `移植自 cancri-code/${rel}（scripts/sync-bot-port.mjs 原样拷贝，勿手改）`;
const tokens = new Set();
for (const [abs, rel] of copied) {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let body = fs.readFileSync(abs);
  const text = body.toString("utf8");
  if (/\.(ts|js)$/.test(abs)) {
    for (const t of text.match(/[A-Za-z][\w-]*/g) ?? []) tokens.add(t);
    body = Buffer.from(`// ${header(rel)}\n${text}`, "utf8");
  } else if (/\.css$/.test(abs)) {
    body = Buffer.from(`/* ${header(rel)} */\n${text}`, "utf8");
  }
  fs.writeFileSync(dest, body);
  manifest.files[rel] = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex").slice(0, 16);
}
// 网页壳自己的类名也算（bot.html / src/bot-web）
for (const f of walkDir(path.join(CHAT, "src", "bot-web"))) for (const t of fs.readFileSync(f, "utf8").match(/[A-Za-z][\w-]*/g) ?? []) tokens.add(t);

function walkDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

// ── 全局样式裁剪 ────────────────────────────────────────────────────────────
function selectorAlive(sel) {
  // 伪元素 / 伪类里的参数（:not(.x)、:is(...)）不要求出现：只看主干上的类名与 id
  const trunk = sel.replace(/:(?:not|is|where|has)\((?:[^()]|\([^()]*\))*\)/g, "");
  const classes = trunk.match(/\.[A-Za-z_][\w-]*/g) ?? [];
  const ids = trunk.match(/#[A-Za-z_][\w-]*/g) ?? [];
  return classes.every((c) => tokens.has(c.slice(1))) && ids.every((i) => tokens.has(i.slice(1)));
}
let kept = 0;
let dropped = 0;
const parts = [];
for (const file of GLOBAL_CSS) {
  const css = fs.readFileSync(path.join(SRC, file), "utf8");
  const root = postcss.parse(css, { from: file });
  root.walkComments((c) => c.remove());
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const alive = rule.selectors.filter(selectorAlive);
    if (!alive.length) {
      rule.remove();
      dropped++;
      return;
    }
    if (alive.length !== rule.selectors.length) rule.selectors = alive;
    kept++;
  });
  root.walkAtRules("font-face", (at) => {
    const src = at.nodes?.find((n) => n.prop === "src")?.value ?? "";
    if (DROP_FONTS.some((f) => src.includes(f))) at.remove();
  });
  root.walkDecls((d) => {
    if (d.value.includes('url("/fonts/')) d.value = d.value.replace(/url\("\/fonts\//g, 'url("./fonts/');
    if (/url\("\/(?!\/)/.test(d.value)) d.remove(); // 桌面安装包里的图片：网页上没有
  });
  // 清掉删空了的 @media / @supports
  let again = true;
  while (again) {
    again = false;
    root.walkAtRules((at) => {
      if (/^(media|supports|layer|container)$/i.test(at.name) && (!at.nodes || at.nodes.length === 0)) {
        at.remove();
        again = true;
      }
    });
  }
  parts.push(`/* ── 裁自 cancri-code/src/${file} ── */\n${root.toString()}`);
}
fs.writeFileSync(
  path.join(OUT, "desktop-shared.css"),
  `/* ${header("src/{" + GLOBAL_CSS.join(",") + "}")}\n * 只保留移植代码里出现过的类名 / id 能命中的规则（保留 :root / html / body / 元素选择器与 token）。 */\n${parts.join("\n")}`,
);
manifest.css = { kept, dropped };
fs.writeFileSync(path.join(OUT, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
console.log(`bot-port：拷了 ${copied.size} 个文件；全局样式保留 ${kept} 条规则、裁掉 ${dropped} 条；外部依赖 ${[...external].join(", ") || "无"}`);
