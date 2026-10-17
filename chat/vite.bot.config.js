import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

// 网页 / 手机端 Bot：chat/bot.html 用的 cancri_bot.js + cancri_bot.css。
//  - 对话界面是 Cancri Code 桌面端 src/bot/ 的原样移植（npm run sync:bot → src/bot-port/），
//    这里只把桌面专属的依赖（Tauri、本地 agent 运行时、云电脑直连、桌面登录）换成 src/bot-web/shims/ 里的网页替身。
//  - 和 vite.config.js 一样是 IIFE 单文件、写回 chat 根目录、不清空 outDir。
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = path.join(here, "src/bot-port/src");
const SHIMS = path.join(here, "src/bot-web/shims");
const norm = (p) => p.replace(/\\/g, "/");

/** 移植树里的模块（相对 cancri-code/src，不带扩展名） → 网页替身 */
const SHIM_MAP = {
  auth: "auth.ts",
  "bot/bot-runtime": "bot-runtime.ts",
  "bot/bot-computer": "bot-computer.ts",
  "sandbox/backend": "sandbox.ts",
  "tools/builtin/sandbox-cloud": "sandbox.ts",
  "tools/builtin/websearch": "web-tools.ts",
  "tools/builtin/webfetch": "web-tools.ts",
};

function shimDesktopDeps() {
  return {
    name: "cancri-bot-shims",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source.startsWith("@tauri-apps/")) return path.join(SHIMS, "tauri.ts");
      if (!importer || !norm(importer).startsWith(norm(PORT))) return null;
      if (!source.startsWith(".")) return null;
      const abs = norm(path.resolve(path.dirname(importer), source)).replace(/\.(ts|js)$/, "");
      const rel = abs.startsWith(norm(PORT) + "/") ? abs.slice(norm(PORT).length + 1) : null;
      if (rel && SHIM_MAP[rel]) return path.join(SHIMS, SHIM_MAP[rel]);
      return null;
    },
  };
}

/** Service Worker 不进 bundle：原样拷到根目录（作用域 /chat/ 需要它和 bot.html 同级） */
function copyWorker() {
  return {
    name: "cancri-bot-sw",
    closeBundle() {
      fs.copyFileSync(path.join(here, "src/bot-web/bot-sw.js"), path.join(here, "bot-sw.js"));
    },
  };
}

export default defineConfig({
  plugins: [shimDesktopDeps(), copyWorker()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: ".",
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
    target: "es2020",
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    lib: {
      entry: fileURLToPath(new URL("./src/bot-web/main.ts", import.meta.url)),
      formats: ["iife"],
      name: "CancriBot",
      fileName: () => "cancri_bot.js",
      cssFileName: "cancri_bot",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
