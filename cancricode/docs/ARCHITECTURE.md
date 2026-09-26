# CancriCode 宣传页架构

## 目标

这个项目不是把 Webflow 导出完全重写成 React，而是先建立一层**可持续的维护边界**：原始运行时保持稳定，Cancri 的视觉和行为集中在少量可读文件里。后续无论是 Codex、Claude、Gemini 还是其他模型，都应该能在几分钟内定位正确修改点。

## 文件地图

```text
.
├─ index.html                 # 唯一页面入口：结构、内容、稳定 data-cancri-\\\* 锚点
├─ css/
│  ├─ style.css                 # VENDOR / READ-ONLY：Webflow 基础样式
│  ├─ cancri-theme.css          # OWNED：浅色默认视觉 / 分区修复
│  ├─ cancri-dark.css           # OWNED：深色主题 token（data-cancri-theme=dark）
│  ├─ cancri-theme-toggle.css   # OWNED：页脚主题切换按钮
│  ├─ cancri-motion.css         # OWNED：Apple 风格动效层（html.cancri-motion 门控）
│  └─ cancri-fonts.css          # OWNED：Inter 本地 @font-face（替代 Google Fonts）
├─ js/
│  ├─ jquery-3.6.1.min.js       # VENDOR：本地化依赖，避免 CDN 失效
│  ├─ chunk-app.js              # VENDOR / READ-ONLY
│  ├─ main-app.js               # VENDOR / READ-ONLY
│  ├─ gsap.min.js ...           # VENDOR / READ-ONLY
│  ├─ cancri-site.js            # OWNED：FAQ 等页面交互
│  ├─ cancri-motion.js          # OWNED：滚动显现/Hero 视差/CTA 物理/锚点缓动
│  └─ cancri-theme.js           # OWNED：浅/深色切换
├─ images/ / fonts/          # 页面在用的静态资源
├─ assets-unused/            # 暂存：未被引用的素材（见其中 README）
├─ scripts/check.mjs         # 无依赖结构/回归检查
├─ serve.mjs                 # 本地静态预览服务器
├─ AGENTS.md                 # AI 修改契约 / 第一入口
└─ docs/
   ├─ ARCHITECTURE.md        # 本文件
   └─ CHANGELOG.md           # 变更记录
```

## 资源自持原则

页面必须在**完全断网**的情况下渲染正常。因此：

* 所有图片、字体、脚本都存在仓库内，`index.html` 只用 `./` 相对路径。
* 不引用兄弟项目（`../devin-ai/` 等）。`css/cancri-integration.css` 当初是从 devin-ai 的样式提取的，但产物已经落地在本仓库，源目录不再是依赖。
* 唯一保留的外部 URL 是页面上的**跳转链接**（GitHub、Discord、Bilibili 等），它们不影响渲染。
* `npm run check` 会扫描远程资源引用并直接报错。

## 页面区域与修改位置

### 1\) 顶栏 CTA

锚点：`\\\[data-cancri-role="nav-cta"]`

视觉：`css/cancri-theme.css` 的 `Navigation` 区域。

当前约束：保持 Webflow 原本的紧凑 split-button，圆角使用 `var(--radius--main)`，不要再把父容器做成 9999px 大胶囊。

### 1b) Hero

锚点：`\\\[data-cancri-section="hero"]`（`#main.hero\\\_wrap`）

视觉：`css/cancri-theme.css` 的 `Hero` 区域。背景为白色；不要改 `main.page\\\_wrap.u-bg-ivory-medium` 全局类，也不要给内部 `.g\\\_section\\\_space` 单独上色。

右侧 CTA：`\\\[data-cancri-role="hero-ctas"]`（`.cancri-hero-cta`），主按钮链到 `#downloads`，次按钮为联系入口。

### 2\) “核心难题”黑色网络图区域

锚点：`\\\[data-cancri-section="engineering-problems"]`

关键结构：

* `.big-cta\\\_scroll-bg.is-kt3`：黑色圆角大面板
* `.big-cta\\\_container.is-kt3`：内部布局
* `.big-cta-content\\\_wrap.is-kt3`：标题/按钮内容层
* `.ktve-stage`：网络图背景层

原则：**只把黑色面板外部改成白色；不能把内部内容层改白。**

### 3\) Codex 工作流区域

锚点：`\\\[data-cancri-section="codex-workflow"]`

背景为纯白。若后续大改布局，优先给内部元素增加 `cancri-\\\*` class，再在自定义 CSS 中维护；inline style 的 background 必须与主题白一致。

### 4\) 客户端下载

锚点：`\\\[data-cancri-section="downloads"]`

这里的 `.g\\\_section\\\_space` 只是高度占位。它必须透明继承父区背景。2026-08-08 出现的卡片内“白条”就是因为有人把 `.g\\\_section\\\_space` 全局强制成白色。

卡片无描边；背景为 `#EFEFEF` 灰阶分层（三张卡递进）。圆角用 CornerKit squircle（`js/cornerkit.js` + `js/cancri-cornerkit.js`，卡 `radius: 40, smoothing: 1`）。下载 CTA 与卡片同心圆角（nested/concentric：`R\\\_btn = R\\\_card − padding`）；禁用态为 muted outline。

### 5\) FAQ

锚点：`\\\[data-cancri-section="faq"]`

背景纯白。视觉在 `css/cancri-theme.css`，交互在 `js/cancri-site.js`。JS 会自动补 `aria-expanded` / `aria-controls`，不要再把 FAQ click handler 写回 HTML 内联脚本。

### 6\) 页脚

锚点：`\\\[data-cancri-section="footer"]`

深色 footer 骨架。主题切换：`\\\[data-cancri-role="theme-toggle"]`。

* 切换样式：`css/cancri-theme-toggle.css`
* 切换逻辑：`js/cancri-theme.js`（`localStorage` key：`cancri-landing-theme`）
* 深色覆盖：`css/cancri-dark.css`

底部品牌带（参考 Trae 的 fixed-under-content 结构，自有实现）：

* 锚点：`\\\[data-cancri-role="footer-distortion"]`
* 底色：`#2200FF`（浅/深色主题均保持，避免空白色块）
* 样式：`css/cancri-footer-mark.css`（父级 padding 占位 + `position:fixed` 色带压在主内容之下）
* 动效：`js/cancri-footer-mark.js` + `js/three.min.js`（照搬 Trae Distortion / grid-distortion；字标 `images/cancricode-wordmark.svg`）
* FAQ 社交条：`css/cancri-social.css` + `images/social/\\\*`（Simple Icons；`data-cancri-role="faq-social"`）
* 主题按钮叠在色带右上角，不要再单独做白色 skeleton 占位条

未来加正式页脚链接时，放进 `.cancri-footer-skeleton`，不要把主题按钮写回 inline style。

### 7\) 主题系统

* 默认浅色；`html\\\[data-cancri-theme="dark"]` 开启深色。
* head 内仅保留极小 FOUC guard；完整 API 在 `window.CancriTheme`。
* 浅色分区样式继续写 `cancri-theme.css`；深色增量只写 `cancri-dark.css`。

## CSS 约定

1. 先用 `data-cancri-\\\*` 限定区域，再写后代选择器。
2. `!important` 仅用于覆盖 vendor inline/高优先级变量，且必须有区域锚点。
3. 不允许全局给 `.g\\\_section\\\_space`、`.g\\\_section\\\_wrap`、`\\\[data-scroll="bg"]` 上背景色。
4. 不允许修改 `css/style.css` 来完成 Cancri 视觉需求。
5. 新增颜色先放到 `css/cancri-theme.css :root` 的 `--cancri-\\\*` token；深色对应覆盖写到 `cancri-dark.css`。

## JS 约定

* FAQ / 普通交互 → `js/cancri-site.js`。
* 主题切换 → `js/cancri-theme.js`（不要混进 site.js）。
* 动效（滚动显现 / 视差 / CTA 物理 / 锚点缓动）→ `js/cancri-motion.js` + `css/cancri-motion.css`。所有隐藏态必须挂在 `html.cancri-motion` 之下（JS 且非 reduced-motion 才加该类），保证无 JS 时内容不缺失。给带 `filter`（如 codex drop-shadow）的元素做显现时用非 blur 变体。hero 标题、engineering-problems、integrations 已有各自动画，不要重复加显现目标。`cancri-motion.js` 必须在 `cancri-rimlight.js` 之后加载（依赖其生成的 wrapper）。
* 页脚品牌带动效 → `js/cancri-footer-mark.js`。
* 初始化必须可重复调用而不重复绑定事件（使用 `data-cancri-ready` 或等价 guard）。
* 与 Webflow runtime 无关的行为不要写进 `main-app.js` / `chunk-app.js`。

## 回归检查

`npm run check` 当前会验证：

* 核心文件存在；
* 5 个 `data-cancri-section` 和 nav role 都还在；
* footer 只有一个；
* 自定义 CSS/JS 已挂载；
* 不再出现会制造“白条”的全局 spacer/background 覆盖；
* 本地 `./` 资源引用都能解析到真实文件；
* 没有远程资源外链（CDN / Google Fonts）；
* 没有跨项目相对引用（`../devin-ai/` 之类）；
* 根目录没有回流的调试垃圾（`\\\_tmp\\\_\\\*`、`\\\*.bak`、`.puppeteer-tmp/`）。

以后发生过一次的事故，应该把对应规则加进 `scripts/check.mjs`，把经验变成自动保护，而不是只写在聊天记录里。

