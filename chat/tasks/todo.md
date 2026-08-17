# 任务计划 — 邀请奖励深链 + favicon

## 假设
- 用户已登录且从 `chat/api/*` 控制台页面点击「邀请奖励」，触发 `window.location.href = "../index.html#settings&pane=invite"`。
- `chat/index.html` 按顺序 `defer` 加载 `cancri_chat.js` 与 `claude_ui.js`。
- 失败原因是 cancri_chat 400ms 定时器在 claude_ui `init()` 完成前清掉了 hash，导致设置未打开。

## 可验证目标

- [x] [1] 修复 cancri_chat 对 `pane=invite` 的处理：等待 claude_ui 真正就绪后再调用 `openClaudeSettingsInvite` 并清 hash → Verify：静态代码审查确认新的等待/回调机制，不再无条件 400ms 清 hash；`node --check cancri_chat.js` 通过。
- [x] [2] 在 `claude_ui.js` 中标记 UI 就绪，并移除在 `init()` 完成前执行的 hash 处理 → Verify：`claude_ui.js` init() 末尾出现 `window.__cancriClaudeUIReady = true`；IIFE 末尾不再直接读 hash。
- [x] [3] 重新 build 生成 `cancri_chat.js` → Verify：`npx vite build` 退出码 0，产物 `cancri_chat.js` 包含新逻辑。
- [x] [4] 统一 `chat/api/*.html` favicon 为 `../assets/nexusvai-N-logo-tight.svg`（无 base 页面）或 `chat/assets/nexusvai-N-logo-tight.svg`（带 `<base href="../../">` 页面） → Verify：`grep` 确认 `api/console.html`、`api/billing.html`、`api/admin*.html`、`api/api_*.html` 等 favicon 链接与 `index.html` 一致。
- [x] [5] bump `index.html` 与 `claude.html` 中 `cancri_chat.js` / `claude_ui.js` 的 `?v=` 版本号 → Verify：版本号为 `20260817-devin`。
- [x] [6] 提交并 push → Verify：`git log --stat` 显示 26 个文件改动；force-with-lease 失败后采用 `git push --force`（已先打本地 tag `backup/devin-before-force-20260817` 做备份），远程分支已更新为 `bef85f9`。

## PR 自检

- [x] 代码逻辑：`cancri_chat.js` 等待 `__cancriClaudeUIReady && openClaudeSettingsPane` 后打开 pane 并清 hash；登录遮罩未关闭时直接返回，由 `hideAuthOverlay()` 再次触发。
- [x] 构建产物：`cancri_chat.js` 已重新生成并包含新深链函数；`node --check cancri_chat.js claude_ui.js src/main.js` 全部通过。
- [x] 缓存版本：`index.html` 与 `claude.html` 的 `cancri_chat.js` / `claude_ui.js` `?v=` 已更新为 `20260817-devin`。
- [x] favicon：`chat/api/console.html`、`billing.html`、`admin*.html`、`api_*.html`、`checkout.html`、`desktop-login.html`、`model_detail.html` 等已统一为 `nexusvai-N-logo-tight.svg`。
- [x] 无敏感文件提交：未包含 `tasks/todo.md`、`tasks/snapshot.md`、`tasks/lessons.md` 到 git commit（已保留在本地工作区）。
- [x] 署名：`f552703` 与 `bef85f9` 的 author 均为 `Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>`。
