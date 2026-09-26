# Changelog

## 2026-08-09 — Apple 风格动效层（cancri-motion）

* 新增 `css/cancri-motion.css` + `js/cancri-motion.js`：零依赖动效层，所有状态挂在 `html.cancri-motion` 之下——无 JS 或 prefers-reduced-motion 时页面完整可见，不会藏内容。
* 滚动显现（IntersectionObserver）：Codex 工作流标题/行、下载区标题与三张卡（错落 0.1s）、FAQ 标题与条目。文本用 blur-to-sharp 渐显，媒体/卡片用透明+位移（避开 codex 图片宿主的 drop-shadow filter 冲突）；显现完成后移除属性回归原生状态。
* Hero 退场视差：滚动时标题区以 0.25 速率滞后并淡出，Apple 产品页式 scrub。
* 顶栏滚动 >10px 后追加发丝线 + 软阴影（`html.cancri-nav-scrolled`，深色主题另配）。
* Hero / 顶栏 CTA 磁性悬停（≤4px 跟随）+ 全站胶囊 Apple 弹簧按压（`:active` scale 0.96）。
* Windows 下载卡 3D 倾斜跟随（rAF lerp，作用在 rimlight host 上，与 CornerKit 圆角共存）。
* 页内锚点缓动滚动（easeInOutQuint，自动扣除顶栏高度，滚轮/触摸打断）。
* 已有动画区（hero 标题 SplitText、核心难题 data-scroll、integrations 标题/卡墙）刻意排除，避免双重动画。

## 2026-08-09 — 仓库整理 + 资源自持

* 项目更名为「CancriCode 宣传页」，目录从 `anthropic-clone` 改为 `cancricode`（曾用名 `cancricode-landing`）。
* 去掉页面内 Anthropic / Claude 外链；仅保留社交条外链。导航登录置 `#`，下载类按钮改指向 `#downloads`。
* 清掉根目录调试垃圾：`.puppeteer-tmp/`（4002 个文件 / 40MB 无头浏览器缓存）、13 张 `\_tmp\_\*.png` 截图、9 个 `\_tmp\_\*.mjs` 一次性脚本、`index.html.bak`、`original\_section1.html`、`\_integration\_extract/`。项目体积 49MB → 8.7MB。
* 被删的 `\_tmp\_\*.mjs` 曾用 `../devin-ai/` 读兄弟项目源码来生成 `css/cancri-integration.css`。产物已在本仓库，跨项目依赖就此断开。
* 30 处 `cdn.prod.website-files.com` 外链改为本地路径（28 张图本地早就有了，`dots.svg` 与 `fable-marmot\_bg.avif` 补下载）。`css/style.css` 只改了 URL 字符串，未动样式声明。
* Google Fonts 的 Inter 本地化为 `css/cancri-fonts.css` + `fonts/inter/`（latin / latin-ext 两个子集，四个字重共用同一份可变字体）。页面现已零外部资源引用。
* 29 个未被引用的素材移入 `assets-unused/`，附清单 README。
* 新增 `.gitignore`；`npm run check` 增加外链、跨项目引用、根目录调试垃圾三类守卫，本地资源检查也覆盖内联 JS 里的图片数组。

## 2026-08-09 — Brand blue accents + CTA CornerKit

* Codex「最佳方式」、两则 h3、下载区标题「使用 Cancri Code 构建」品牌蓝 `#2200FF`。
* 核心难题 CTA 未全屏时用 CornerKit（`radius: 40, smoothing: 1`），滚到全宽时圆角归零。

## 2026-08-09 — Hero underlined phrases brand blue

* Hero 标题下划线短语（链接）改为 `#2200FF`。

## 2026-08-09 — Nav frosted glass

* 顶栏改为半透明毛玻璃（`backdrop-filter`），滚动时投射下方内容；深色同理。
* 修复双顶栏：毛玻璃只挂在 `.nav\_wrap`，去掉 `.nav\_component` 多余模糊层。

## 2026-08-09 — Download card CornerKit squircles

* 安装 `@cornerkit/core`，本地拷贝 `js/cornerkit.js`。
* 下载卡应用 `radius: 40, smoothing: 1` 连续曲率圆角。
* 下载按钮与卡片做 concentric / nested radius：`R\_btn = R\_card − padding`。

## 2026-08-09 — Download card layered surfaces

* 下载卡背景改为 #EFEFEF 层次灰（三张卡深浅递进），Windows 卡略抬高；图标区白底分层。

## 2026-08-08 — Nav stays pinned while scrolling

* 顶栏改为 `position: fixed`（vendor sticky 被 `page\_wrap` overflow 与页脚层叠规则打断）。
* 为 `main.page\_wrap` 预留 `--nav--height`，滚动时始终能看到顶栏。
* 导航预留区去掉 ivory 黄底，背景跟随 `--cancri-bg` 主题。

## 2026-08-08 — FAQ social strip

* FAQ 底部原 `g\_section\_space` 改为 Trae 风格分割线 + 左侧社交图标。
* 图标来自 Simple Icons：Bilibili / Discord / GitHub / Hugging Face / X。

## 2026-08-08 — Footer distortion Three.js port

* 按 Trae Distortion 原样用 Three.js 重写页脚形变；修复黑屏（自绘 WebGL 失败）。
* 引入本地 `js/three.min.js`，色带挂载点改为 `\_\_mount`。

## 2026-08-08 — Footer distortion hover fix

* 修复悬停无效果：改用 RGBA8 data texture（避开 float LINEAR 采样失败），并抬高色带命中层级。

## 2026-08-08 — Footer Trae-equivalent grid distortion

* 页脚动效改为与 Trae 同款：WebGL data-texture 网格形变（鼠标速度写入 + 0.9 衰减 + `uv - 0.02 \* offset`）。
* 品牌带 `#2200FF`，字标合成进纹理；带宽高比 `3.83228`。

## 2026-08-08 — Footer brand band fix

* 页脚品牌带改为 `#2200FF` 铺满，去掉中间空白白条。
* 波纹改为鼠标悬停局部跟随，离开后回静止（非常驻全局浪）。
* 带宽高比靠近 Trae（\~3.66），主题按钮叠在色带右上角。

## 2026-08-08 — Footer fixed brand mark

* 参考 Trae 页脚：固定色带压在主内容下、滚入 spacer 后露出。
* 新增 `cancri-footer-mark.css/js` + `cancricode-wordmark.svg`，自有 Canvas 波纹，非复制 Trae 源码。

## 2026-08-08 — Hero headline reposition

* Hero 主标题改为强调独立虚拟机安全测试与真机验证交付的「人工智能软件工程师」。

## 2026-08-08 — Hero CTAs sync with title animation

* Hero 胶囊默认隐藏，随标题 word animation 进入视口后以相同缓动淡入上移。

## 2026-08-08 — Hero CTAs + longer headline

* Hero 右侧英文说明改为两个胶囊：「试试 Cancri Code」「联系我们」。
* 主标题加长并略放宽行距；下载区补 `id="downloads"` 供锚点跳转。

## 2026-08-08 — Dark mode CTA network ink

* 白色 CTA 面板上的网络连线、枢纽文案、占位色块同步改为深色，避免浅色描边不可见。

## 2026-08-08 — Dark mode CTA panel white

* 深色模式下「核心难题」黑色大面板改为白色；标题深色，「了解工作原理」改为黑底白字胶囊。

## 2026-08-08 — Dark mode footer white

* 深色模式下 `footer#footer` 改为白色；主题切换按钮改为深色描边以保持可读。

## 2026-08-08 — Dark mode pill contrast

* 新增 `--cancri-pill-fill` / `--cancri-pill-label`；深色下白底黑字，修复顶栏 CTA 与下载胶囊白底白字。

## 2026-08-08 — Dark mode text + logo invert fix

* Logo SVG 去掉内联 `#111111`，改走 `--cancri-ink` / `currentColor`。
* `cancri-dark.css` 补齐导航文字/汉堡线/下拉、Hero、下载区、FAQ 内联深色字覆盖。

## 2026-08-08 — Mobile nav white + modular theme toggle

* 移动菜单 / 顶栏 ivory 背景改为纯白。
* 页脚右下角增加浅/深色切换（对标 CancriCode GitHub footer / OpenAI 胶囊图标按钮）。
* 可维护拆分：`css/cancri-dark.css`、`css/cancri-theme-toggle.css`、`js/cancri-theme.js`（不堆进 site.js / index）。

## 2026-08-08 — Codex text centered on stacked layout

* 窄屏下 `codex-row` 改为居中；文字块不再被 `align-items: flex-end` 顶到右侧（对齐 Codex）。

## 2026-08-08 — Codex section font stack

* `codex-workflow` 字体改为 Inter + OpenAI Sans + PingFang SC / 微软雅黑等 CJK 回退（去掉未加载的 OpenAI Sans SC）。

## 2026-08-08 — Nav dropdown cards white

* `.nav\_dropdown\_main\_content.is-desktop` 背景由 ivory-light 改为纯白。

## 2026-08-08 — Fix desktop nav pill vertical alignment

* 顶栏胶囊在被 stretch 的 `li` 内垂直居中；固定高度 `2.25rem`，避免贴顶歪斜。

## 2026-08-08 — Pill buttons (match CancriCode GitHub site)

* 对照 `D:\\A.CancriCode\\GitHub` 的 `.cta-btn` / `.btn-pill` / mobile actions：圆胶囊 `999px` + 悬停颜色反转。
* 作用范围（均挂在 data-cancri 锚点下，不做全局 `.btn\_main\_wrap` 覆盖）：

  * 黑色区「了解工作原理」
  * 桌面顶栏 `nav-cta` 组合按钮
  * 下载区 Windows / macOS / Linux 按钮
  * 移动菜单「登录」「下载」

## 2026-08-08 — Pure white sections + nav polish

* `codex-workflow` / `downloads` / `faq` / `nav\_menu\_scroll` 背景统一为纯白；去掉下载区与 FAQ 分区描边。
* 下载卡去掉 border，卡片底 `g\_background` 改为白色。
* 移动菜单内隐藏错位的 split CTA；桌面顶栏 CTA 继续保持紧凑布局。
* 导航「登录」按钮改为黑色。

## 2026-08-08 — Hero background white

* Hero `#main` 增加 `data-cancri-section="hero"`。
* 在 `css/cancri-theme.css` 将 hero 背景从父级 ivory medium 覆盖为白色（`--cancri-bg`）。

## 2026-08-08 — Gemini regression repair / maintainability pass

* 以项目自带 `index.html.bak` 的稳定版本为基线，移除后来叠加的两组全局 monochrome fix。
* 修复黑色“核心难题”区域：外部背景为白色，内部黑色面板和内容层保持深色，不再出现中央白块。
* 修复下载卡和 FAQ 的异常白条：禁止全局给 `.g\_section\_space` 上背景色。
* 顶栏 CTA 恢复原本紧凑 split-button 圆角，移除额外 9999px 胶囊覆盖。
* 下载卡恢复基础几何，不再人为添加 24px 卡片圆角和 pill 下载按钮。
* 页脚清空为 Cancri 自有空骨架，移除 Anthropic/Claude 大量遗留链接和 footer 内联脚本。
* 新增 `css/cancri-theme.css`、`js/cancri-site.js`、`AGENTS.md`、`docs/ARCHITECTURE.md`。
* jQuery 改为本地 `js/jquery-3.6.1.min.js`，删除无关的 Anthropic tracking/privacy 与 HubSpot 外链脚本。
* 新增 `npm run check` 回归守卫。


- 2026-09-26：Hero 拼贴与核心难题区交界处加渐变模糊带（`[data-cancri-section="engineering-problems"]::before`，写在 `css/cancri-hero-collage.css`），消除拼贴被下一分区背景硬裁切的直线。
- 2026-09-26：下载按钮（顶栏移动端「下载 CancriCode」×2、下载卡「下载 Windows 版」）改为直链 `dl.nexusvai.xyz/cancri-code/3.0.0/Cancri-Code_3.0.0_x64-setup.exe?build=20260926b`。
- 2026-09-26：叙事由「本地虚拟机 / 真机」改为「派欧云（PPIO）弹性云沙箱」：Hero 标题、核心难题区副标题与两个节点、Codex 工作流两段、Windows 下载卡、安全 FAQ、meta 描述。
- 2026-09-26：「帮助文档 / 关于团队」下拉 8 项（桌面 + 移动各一份）接到博客站 `www.nexusvai.xyz/article.html?id=cc*`（新文章写在 `A.CancriCode/GitHub/js/article.js`）；「开发者 API 文档」指向已有的 `chat/api_docs.html`。
- 2026-09-27：下载直链统一改为 `dl.nexusvai.xyz/cancri-code/3.0.2/Cancri-Code_3.0.2_x64-setup.exe`（3 处）。
- 2026-09-27：核心难题区「了解工作原理」按钮补上链接（沿用 `g_clickable_wrap` 覆盖层写法），新标签页打开博客发布稿 `article.html?id=cancriCode3`。
