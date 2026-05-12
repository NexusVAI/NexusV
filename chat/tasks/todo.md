# NexusVArena Workbench - UI 清理

## 第三轮修复（截图问题）

### 11. 顶部栏品牌
- [x] 删除 "竞技场" 文字
- [x] 改成 Logo + NexusVArena 品牌区（.app-brand）
- [x] 添加 brandHomeBtnTop 点击回到首页

### 12. 排行榜页隐藏匿名对战选择器
- [x] setActiveView 添加 document.body.dataset.view = view
- [x] CSS: body[data-view="leaderboard"] 隐藏 arena-top-mode, modelSelector, compareModelSelector

### 13. 移动端 header 高度 56px
- [x] --header-h 改回 56px
- [x] 删除 2 行 grid 布局，改为 flex 单行
- [x] 移动端隐藏 model-selector
- [x] arena-top-mode 默认隐藏，仅首页显示

### 14. 移动端首页布局
- [x] justify-content: space-between -> flex-start
- [x] hero 添加 overflow-wrap: anywhere
- [x] social-links margin-bottom 缩小
- [x] tool-pill 移动端 display:none

### 15. 联网搜索 pill 移除
- [x] HTML 删除 webSearchStatusPill
- [x] CSS 移动端 .tool-pill display:none
- [x] composer-bottom 固定三列，overflow:hidden

### 16. + 菜单 fixed 定位
- [x] plusTrigger 点击用 getBoundingClientRect 计算坐标
- [x] plusPopover CSS 改为 position:fixed

### 17. 排行榜移动端
- [x] leaderboard-side display:none
- [x] leaderboard-page 改为单列
- [x] leaderboard-hero display:block
- [x] leaderboard-toolbar display:none
- [x] #leaderboardView.active 移动端高度和滚动

### 18. JS 模块路径验证
- [x] js/main.js, js/ui/theme.js, js/ui/sidebar.js 均存在

---

## 第二轮完成项

### 1. 禁用独立 Arena 页
- [x] 侧边栏 Arena 点击改为 setActiveView('home') + setTopArenaMode('anonymous')
- [x] arenaView HTML 保留但不再激活（.view 默认 display:none）
- [x] 删除 data-view-target="arena"，改为 "home"

### 2. 删除独立图片生成页
- [x] 移除 imagesView 的 setActiveView 调用
- [x] 移除 openImagesFromPlus / openImagesFromMore 事件监听
- [x] 移除 + 菜单中的"创建图片"按钮
- [x] 移除 More 菜单中的"图片"项
- [x] 移除 sendImagePromptBtn 和 image-prompt-chip 事件监听
- [x] handleHomeSubmit 图片模式改为 sendImageGenerationMessage 聊天流
- [x] 保留 generateImageFromPrompt / sendImageGenerationMessage 聊天内生图能力

### 3. + 菜单向下展开
- [x] plusPopover CSS 定位改为 top:100%; left:0; margin-top:6px; transform-origin:top left
- [x] 菜单只保留"上传图片"和"上传文件"
- [x] 点击外部关闭 / Esc 关闭已有逻辑

### 4. 语音按钮 OpenAI 式圆形
- [x] 移除 hidden 属性
- [x] 样式改为 36x36 圆形，无边框，灰色底
- [x] 录音中 pulse 动画已有
- [x] 不支持浏览器点击显示 toast

### 5. 侧边栏收起态修复
- [x] layout-sidebar.css 添加 width:0; max-width:0; overflow:hidden; margin:0; padding:0
- [x] cancri_chat.css 同步更新 collapsed 规则
- [x] 覆盖: sidebar-label, sidebar-footer-text, recent-item-title, account-meta, upgrade-btn, account-arrow, recent-wrap, section-title, recent-placeholder, sidebar-search-wrap

### 6. 深色模式切换修复 + 中文化
- [x] theme.js 标签改为 "深色模式" / "浅色模式"
- [x] HTML 初始文本改为 "深色模式"
- [x] sidebarThemeToggle 点击 -> app.applyTheme() -> persistUiPreferences() 已有

### 7. 右上角按钮移走
- [x] header-right 移除 exportBtn, clearBtn, upgradeBtn
- [x] 添加到 accountPopover 中
- [x] 点击后 closePopover()

### 8. 全站中文化
- [x] Dark mode -> 深色模式
- [x] Light mode -> 浅色模式 (theme.js)
- [x] Settings -> 设置 (sidebar footer)
- [x] Side by Side -> 双模型对话
- [x] View as -> 查看方式
- [x] Ranking -> 排名
- [x] Pareto -> 帕累托
- [x] Pareto 前沿 -> 帕累托前沿
- [x] Thinking -> 思考中
- [x] Thought for Xs -> 思考 X 秒
- [x] Sign out -> 退出

### 9. 清理无效事件绑定
- [x] openImagesFromPlus / openImagesFromMore 监听已删除
- [x] sendImagePromptBtn / imagePromptInput 监听添加 null guard
- [x] imageGenerationStatus 引用添加 null guard
- [x] 无 missing element 控制台报警

### 10. 验证
- [x] node --check cancri_chat.js 通过
- [x] node --check cancri_arena.js 通过
- [x] grep 验证无残留英文（legacy/ 除外）
- [x] js/main.js 等模块文件均存在

## 删除的旧路由
- arenaView: 不再从侧边栏进入，HTML 保留但不激活
- imagesView: 不再从任何入口进入，HTML 保留但不激活

## 保留在聊天流的能力
- 匿名对战 / 双模型对话 / 单模型: 通过主页顶部模式选择器
- 图片生成: 通过 handleHomeSubmit -> sendImageGenerationMessage
- 排行榜: leaderboardView 正常工作
