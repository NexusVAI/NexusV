# CancriCode 宣传页

CancriCode 的官方宣传落地页，单页静态站点，**不依赖任何外部 CDN**——字体、图片、脚本全部在仓库内，断网也能完整预览。

项目按「**供应商基线 + Cancri 自定义层**」分层，避免后续模型为了改一个颜色去全局覆盖 Webflow 类，造成整页串样式。

## 快速开始

```bash
npm install
npm run check
npm run dev
```

默认预览地址：`http://127.0.0.1:5000`。可用 `PORT=8080 npm run dev` 改端口。

## 目录结构

```text
.
├─ index.html          # 唯一页面入口
├─ css/                # style.css 为 vendor 只读，cancri-\\\*.css 为自定义层
├─ js/                 # main-app/chunk-app/gsap 等为 vendor，cancri-\\\*.js 为自定义层
├─ images/             # 页面在用的图片（logos/ 模型墙、social/ 社交图标）
├─ fonts/              # 本地字体，含 inter/ 子集
├─ assets-unused/      # 暂存：当前没被引用的素材，见其中 README
├─ docs/               # 架构与变更记录
├─ scripts/check.mjs   # 无依赖的结构 / 回归检查
└─ serve.mjs           # 本地静态预览服务器
```

## 修改前先读

1. `AGENTS.md` —— 给任何 AI / Coding Agent 的第一入口。
2. `docs/ARCHITECTURE.md` —— 文件职责、页面区域、选择器约定。
3. `docs/CHANGELOG.md` —— 最近修复记录。

## 最重要的规则

* **不要直接改** `css/style.css`、`js/main-app.js`、`js/chunk-app.js`。它们是 vendor snapshot。
* 页面视觉覆盖写到 `css/cancri-theme.css`。
* Cancri 自己的交互写到 `js/cancri-site.js`。
* 结构/文案才改 `index.html`。
* 所有新样式优先挂在 `data-cancri-section` / `data-cancri-role` 上，不要再写全局 `.g\\\_section\\\_space { background: ... }`。
* **新素材一律放进本仓库**，不要引用 `../devin-ai/`、`../trae-ai/` 等兄弟项目，也不要新增 CDN 外链。
* 调试截图、一次性脚本、`\\\*.bak` 不要留在根目录，`.gitignore` 已经拦掉常见的几类。

