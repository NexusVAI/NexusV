import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// 库模式：把 src/ 的 ESM 模块打包成单个经典脚本 cancri_chat.js（IIFE）。
// 关键约束：
//  - 产物文件名固定 cancri_chat.js，写回 chat 根目录（claude.html / index.html
//    的 <script defer src="./cancri_chat.js?v=..."> 标签因此无需改动）。
//  - emptyOutDir:false：outDir 即 chat 根目录，绝不能清空（里面有 24 个 HTML 等）。
//  - minify:false：产物可读、可审查、可 diff。
//  - IIFE 在加载时自执行，行为等价于原经典脚本；末尾仍由源码自身挂 window.CancriApp。
export default defineConfig({
  build: {
    outDir: ".",
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: "es2020",
    lib: {
      entry: fileURLToPath(new URL("./src/main.js", import.meta.url)),
      formats: ["iife"],
      name: "CancriChat",
      fileName: () => "cancri_chat.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
