/* claude_ui.js — Claude 1:1 复刻所需的最小 JS hookup
   ----------------------------------------------------------------
   职责（不和 cancri_chat.js 冲突，只补它没做的）：
     1. 5 个 suggest pill 点击 → 注入 prompt 模板到 #homeInput
     2. sidebar "搜索" nav-row → 弹 #claudeSearchModal（拦截原 sidebarSearchBtn 的 inline 输入框）
     3. sidebar "自定义" nav-row → 打开 #settingsModal
     4. sidebar "文物" nav-row → 弹 toast「文物功能正在开发中」
     5. claudeProjectsView / claudeChatsView 的 "新聊天" / "新项目" 按钮
     6. 顶栏 Plan pill 点击 → 弹 toast 提示
   ----------------------------------------------------------------
   纯 ES2020+，不依赖框架。defer 加载在 cancri_chat.js 之后。 */
(function () {
    'use strict';

    // 等待 DOM ready，避免脚本在 cancri_chat.js 初始化前 query 不到 DOM。
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    function init() {
        relocateModelSelector();
        bindSuggestPills();
        bindSearchModal();
        bindCustomNav();
        bindArtifactsNav();
        bindPlanPill();
        bindProjectButtons();
        bindChatsButtons();
        bindSettingsNav();
        bindHeroGreeting();
        bindChatTitleSync();
        bindMobileSidebarDrawer();
        bindAttachMenu();
        bindModelMoreMenu();
        bindSidebarTooltips();
        bindAuthThemeToggle();
        bindHomeInputDefensiveFocus();
    }

    // 15. 群友反馈"对话中点输入框移动端无法触发打字"。
    //     根因怀疑：cancri_chat.js setComposerBusy(false) 把 homeInput.readOnly = false
    //     在 iOS Safari 上偶发不彻底（属性留缓存 / hit-test 失效）。
    //     防御：tap textarea 时显式 removeAttribute('readonly') —— 当 .is-busy class
    //     不在的情况下（不在 streaming）一律强制清，让 iOS 软键盘可弹起。
    //     同时观察 .is-busy class 移除事件，作为 readonly 已结束的二次保险。
    function bindHomeInputDefensiveFocus() {
        const homeInput = document.getElementById('homeInput');
        if (!homeInput) return;
        function clearReadOnlyIfIdle() {
            if (homeInput.classList.contains('is-busy')) return;  // streaming 中保留 readonly
            if (homeInput.hasAttribute('readonly')) {
                homeInput.removeAttribute('readonly');
            }
        }
        // 用户 tap 时：如果不在 streaming，强制清 readonly 让 iOS 弹键盘
        ['touchstart', 'pointerdown', 'click'].forEach(function (evt) {
            homeInput.addEventListener(evt, clearReadOnlyIfIdle, { passive: true });
        });
        // .is-busy class 切换观察：streaming 结束（remove .is-busy）时同步清 readonly
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(clearReadOnlyIfIdle)
                .observe(homeInput, { attributes: true, attributeFilter: ['class'] });
        }
    }

    // 13. Sidebar nav-row 自动注入 title 属性：折叠态（.sidebar.collapsed）
    //     sidebar-label 被 CSS 隐藏，hover 时浏览器需要 title 才能弹原生 tooltip
    //     显示项名（图 6 Claude 折叠态 hover 显示 "Chats"）。简单方案先用 native
    //     title；若用户希望 Claude 那种自定义气泡式 tooltip 再升级。
    //     幂等：已设过 title 不覆盖；MutationObserver 监听 sidebar 子节点新增
    //     （cancri 动态加 history 行）保证新行也有 title。
    function bindSidebarTooltips() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        function applyTitles() {
            sidebar.querySelectorAll('.nav-row').forEach(function (row) {
                if (row.title) return;
                const label = row.querySelector('.sidebar-label');
                const text = label ? label.textContent.trim() : row.textContent.trim();
                if (text) row.title = text;
            });
        }
        applyTitles();
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(applyTitles).observe(sidebar, { subtree: true, childList: true });
        }
    }

    // 10. Mobile sidebar drawer：在 ≤768px 屏幕，点 #mobileMenuBtn 应该
    //     toggle body.sidebar-open（drawer 滑入），而不是老逻辑的
    //     sidebar.collapsed（折叠成 56px rail，在 mobile 上看不见）。
    //     用 capture-phase + stopImmediatePropagation 接管 mobile 点击，
    //     桌面端走原 cancri_chat.js 的 collapsed 逻辑（不干扰）。
    function bindMobileSidebarDrawer() {
        const btn = document.getElementById('mobileMenuBtn');
        if (!btn) return;
        function isMobile() {
            return window.matchMedia('(max-width: 768px)').matches;
        }
        // 同步两套 sidebar 语义，避免老/新规则在关闭时冲突：
        //   - 老 cancri_chat 语义：mobile 下 .collapsed 表示隐藏（默认 add 到 sidebar）
        //   - 新 claude_ui 语义：body.sidebar-open 表示抽屉打开（drawer 显示）
        // 单写 body.sidebar-open 关闭时 sidebar 不消失（老 cancri_chat.css mobile
        // rule 默认 .sidebar { transform: translateX(0) } 胜出）。
        // 必须打开时去 .collapsed + 加 .sidebar-open；关闭时反向。
        function openDrawer() {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.remove('collapsed');
            document.body.classList.add('sidebar-open');
        }
        function closeDrawer() {
            const sidebar = document.getElementById('sidebar');
            document.body.classList.remove('sidebar-open');
            // 恢复 cancri_chat 老语义：mobile 下 .collapsed = 隐藏。
            // 这让 cancri_chat.js 的其他逻辑（如 isMobileViewport scrim 判断）
            // 也能识别"sidebar 已关"状态，保持解耦。
            if (sidebar) sidebar.classList.add('collapsed');
        }

        btn.addEventListener('click', function (e) {
            if (!isMobile()) return;  // 桌面端走原 cancri_chat.js .collapsed 逻辑
            e.stopImmediatePropagation();
            e.preventDefault();
            if (document.body.classList.contains('sidebar-open')) {
                closeDrawer();
            } else {
                openDrawer();
            }
        }, true);
        // 点蒙层关闭抽屉
        document.addEventListener('click', function (e) {
            if (!isMobile()) return;
            if (!document.body.classList.contains('sidebar-open')) return;
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            if (sidebar.contains(e.target)) return;
            if (btn.contains(e.target)) return;
            closeDrawer();
        });
        // 屏幕变宽（旋转横屏 / 缩放）时自动清 drawer 状态。
        // 桌面端不应继承 .collapsed（rail 模式），只保留用户手动切换。
        window.matchMedia('(min-width: 769px)').addEventListener('change', function (e) {
            if (e.matches) {
                document.body.classList.remove('sidebar-open');
                // 桌面端不强制 collapsed，由用户/cancri_chat 自己管。
            }
        });
    }

    // 9. 对话页顶栏标题同步：监听 #homeView 的 .chatting class 与 #chatMessages
    //    的内容变化，提取第一条 user message 前 30 字作为标题，写到 #claudeChatTitle。
    //    同时把 body.is-chatting 加上/去掉，让 claude.css 的显示规则生效。
    function bindChatTitleSync() {
        const homeView = document.getElementById('homeView');
        const chatMessages = document.getElementById('chatMessages');
        const titleEl = document.querySelector('#claudeChatTitle .claude-chat-title-text');
        if (!homeView || !chatMessages || !titleEl) return;

        function pickFirstUserText() {
            // 兼容多种 DOM 结构：data-role="user" / .user-message / .message.user
            const candidates = chatMessages.querySelectorAll(
                '.message[data-role="user"] .message-content, ' +
                '.message.user-message .message-content, ' +
                '.message.user .message-content'
            );
            if (candidates.length === 0) return '';
            const text = (candidates[0].textContent || '').trim();
            if (!text) return '';
            // 取首行前 30 字
            const firstLine = text.split('\n')[0];
            return firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine;
        }

        function update() {
            const isChatting = homeView.classList.contains('chatting');
            document.body.classList.toggle('is-chatting', isChatting);
            if (!isChatting) {
                titleEl.textContent = '新聊天';
                return;
            }
            const t = pickFirstUserText();
            titleEl.textContent = t || '新聊天';
        }

        update();

        if (typeof MutationObserver !== 'undefined') {
            // 监听 homeView class 变化（chatting 切换）
            new MutationObserver(update).observe(homeView, {
                attributes: true,
                attributeFilter: ['class'],
            });
            // 关键：只监听顶层 childList（新消息插入/移除时触发），
            // 不要监听 subtree+characterData——流式输出每字符更新会触发
            // 上百次回调直接卡死页面（v2026-05-14-claude-ui-b 故障）。
            // 用 requestAnimationFrame debounce 保险，避免一次插入多个节点重复 update。
            let scheduled = false;
            const debouncedUpdate = function () {
                if (scheduled) return;
                scheduled = true;
                requestAnimationFrame(function () {
                    scheduled = false;
                    update();
                });
            };
            new MutationObserver(debouncedUpdate).observe(chatMessages, {
                childList: true,
            });
        }
    }

    // 8. Hero 动态问候：根据当前时间显示"早上好/下午好/晚上好，{昵称}"。
    //    昵称取自 #nicknameDisplay → .account-strip .account-name → 兜底 "克劳姆"。
    //    监听这两个元素的内容变化，登录/改昵称时自动刷新 hero 文本。
    function bindHeroGreeting() {
        const hero = document.getElementById('heroTitle');
        if (!hero) return;

        // v2026-05-15 改进：只有用户真正设了昵称才显示。
        // 默认 (邮箱前缀如 "3573799137" / 未设置 / 未登录) 一律显示纯问候，
        // 避免 hero 出现 "早上好，3573799137" 这种 QQ 号尴尬（群友图 9 反馈）。
        function pickName() {
            const display = document.getElementById('nicknameDisplay');
            let nick = display ? display.textContent.trim() : '';
            if (!nick || nick === '未设置') {
                const accName = document.querySelector('.account-strip .account-name');
                if (accName) nick = accName.textContent.trim();
            }
            if (!nick) return '';
            // 占位/默认/邮箱前缀（含 @ / 纯数字 / 未登录态）一律视为"未设置"
            const placeholders = ['未登录', 'MR', 'Cancri 用户', 'Kraum', '克劳姆'];
            if (placeholders.indexOf(nick) >= 0) return '';
            if (nick.indexOf('@') > 0) return '';  // 邮箱直接 fallback
            if (/^\d{4,}$/.test(nick)) return '';  // 纯数字 QQ 号
            return nick;
        }

        function update() {
            const h = new Date().getHours();
            let greet = '晚上好';
            if (h >= 5 && h < 12) greet = '早上好';
            else if (h >= 12 && h < 18) greet = '下午好';
            const nick = pickName();
            // 2026-05-15 fix(C3)：去掉 hero 前的 ✱ 星号，跟群友反馈
            //   "我们站内的欢迎语里的'*'星号去掉" 一致。Claude 真站点用的是
            //   品牌 sparkle icon，我们没有对应资源，干脆纯文字更干净。
            if (!nick) {
                hero.textContent = greet;
                return;
            }
            const safeNick = nick.replace(/[<>&"']/g, function (c) {
                return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c];
            });
            hero.innerHTML = greet + '，' + safeNick;
        }

        update();

        // 观察昵称源元素的变化，cancri_chat.js 同步昵称/账户信息后自动刷新。
        const nodes = [
            document.getElementById('nicknameDisplay'),
            document.querySelector('.account-strip .account-name'),
        ].filter(Boolean);
        if (nodes.length && typeof MutationObserver !== 'undefined') {
            const obs = new MutationObserver(update);
            nodes.forEach(function (n) {
                obs.observe(n, { childList: true, characterData: true, subtree: true });
            });
        }
        // 跨小时刷新（用户长时间停在主页时，从下午变晚上时也应该自动改）
        setInterval(update, 60 * 1000);
    }

    // 0. 物理把 #modelSelector 从 .header-left 移动到 composer-actions 里，
    //    放在 #voiceToastBtn 之前。这是 Claude 主页样子：模型按钮内嵌输入框右下。
    //    cancri_chat.js 没有依赖 #modelSelector 的父级选择器，所以位置移动无副作用。
    //    modelDropdown 的位置是 inline style 动态计算，跟着按钮位置走。
    function relocateModelSelector() {
        const modelSelector = document.getElementById('modelSelector');
        const composerActions = document.querySelector('.composer-actions');
        const voiceBtn = document.getElementById('voiceToastBtn');
        if (!modelSelector || !composerActions || !voiceBtn) return;
        // 已经在 composer-actions 里就跳过（防止 DOMContentLoaded 重复触发）
        if (composerActions.contains(modelSelector)) return;
        composerActions.insertBefore(modelSelector, voiceBtn);
        modelSelector.classList.add('claude-model-selector-inline');
    }

    // 1. Suggest pills（写 / 学习 / 代码 / 生活提示 / Gmail）
    function bindSuggestPills() {
        const homeInput = document.getElementById('homeInput');
        if (!homeInput) return;
        document.querySelectorAll('.claude-suggest[data-prompt-template]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const tmpl = btn.getAttribute('data-prompt-template') || '';
                homeInput.value = tmpl;
                homeInput.focus();
                // 把光标移到末尾
                homeInput.setSelectionRange(tmpl.length, tmpl.length);
                // 触发 input 事件让 cancri_chat.js 的 sendChatBtn enable 逻辑跑起来
                homeInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
    }

    // 2. Search modal
    function bindSearchModal() {
        const sidebarSearchBtn = document.getElementById('sidebarSearchBtn');
        const modal = document.getElementById('claudeSearchModal');
        const input = document.getElementById('claudeSearchInput');
        const closeBtn = document.getElementById('claudeSearchCloseBtn');
        const results = document.getElementById('claudeSearchResults');
        if (!sidebarSearchBtn || !modal || !input) return;

        // 拦截原侧栏 sidebarSearchBtn 的 click：先阻止 cancri_chat.js 的展开
        // inline 输入框逻辑（capture 阶段抢先），再 open Claude modal。
        sidebarSearchBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            openSearch();
        }, { capture: true });

        function openSearch() {
            modal.setAttribute('aria-hidden', 'false');
            modal.classList.add('open');
            renderResults('');
            // 给浏览器渲染一帧再 focus
            requestAnimationFrame(function () { input.focus(); });
        }
        function closeSearch() {
            modal.setAttribute('aria-hidden', 'true');
            modal.classList.remove('open');
            input.value = '';
        }

        closeBtn?.addEventListener('click', closeSearch);
        // 点击 backdrop 关闭
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeSearch();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modal.classList.contains('open')) closeSearch();
        });

        // 简单本地过滤：从 #chatHistoryList 里抓现有条目作为搜索源
        input.addEventListener('input', function () {
            renderResults(input.value.trim().toLowerCase());
        });

        function renderResults(query) {
            if (!results) return;
            const historyItems = document.querySelectorAll('#chatHistoryList .recent-item, #chatHistoryList [data-chat-id], #chatHistoryList [data-conv-id]');
            if (historyItems.length === 0) {
                results.innerHTML = '<div class="claude-search-empty">暂无聊天记录可供搜索</div>';
                return;
            }
            const matched = [];
            historyItems.forEach(function (el) {
                const text = (el.textContent || '').trim();
                if (!query || text.toLowerCase().indexOf(query) !== -1) {
                    const chatId = el.getAttribute('data-chat-id') || el.getAttribute('data-conv-id') || '';
                    matched.push({ text: text, id: chatId, source: el });
                }
            });
            if (matched.length === 0) {
                results.innerHTML = '<div class="claude-search-empty">无匹配结果</div>';
                return;
            }
            results.innerHTML = matched.slice(0, 20).map(function (m, idx) {
                const safeText = m.text.replace(/[<>&"']/g, function (c) {
                    return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c];
                });
                return '<div class="claude-search-row" data-idx="' + idx + '">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
                    '<span class="claude-search-row-title">' + safeText + '</span>' +
                    '</div>';
            }).join('');
            // 点击某行触发原历史条目的 click
            results.querySelectorAll('.claude-search-row').forEach(function (row, idx) {
                row.addEventListener('click', function () {
                    closeSearch();
                    matched[idx].source.click();
                });
            });
        }
    }

    // 3. "自定义" / "个性化" nav-row → 切到 claudeSettings view（不再用老的 settingsModal）
    //    2026-05-15 fix(M5)：用 capture-phase + stopImmediatePropagation 抢在 cancri_chat.js
    //    给 #themeShortcutBtn 注册的 bubble-phase listener (line 9786 `openModal("settingsModal")`)
    //    前面把 click 干掉。否则旧 modal 会先被打开 → 触发 scrim → 用户体感"东西不显示还弄个遮罩"。
    //    同时显式关 .popover.open（cancri 老逻辑靠 document click 委托关 popover，但我们 stop
    //    propagation 后那条委托不再触发，需要自己关）。
    function bindCustomNav() {
        document.querySelectorAll('[data-claude-action="open-settings"]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopImmediatePropagation();
                e.preventDefault();
                // 关闭打开的 popover（如 accountPopover），保持 click "打开 popover → 选项 → 切 view"
                // 的体感一致（cancri closePopover 走不到了）。
                document.querySelectorAll('.popover.open').forEach(function (p) {
                    p.classList.remove('open');
                });
                // 走 cancri_chat.js 暴露的 setActiveView（如果存在），否则手动切。
                if (typeof window.setActiveView === 'function') {
                    window.setActiveView('claudeSettings');
                } else {
                    // Fallback：手动 toggle .active 在所有 .main > .view 上。
                    document.querySelectorAll('.main > .view').forEach(function (v) {
                        v.classList.toggle('active', v.id === 'claudeSettingsView');
                    });
                    if (document.body) document.body.dataset.view = 'claudeSettings';
                }
            }, true);  // capture phase
        });
    }

    // 4. "文物" nav-row → toast
    function bindArtifactsNav() {
        document.querySelectorAll('[data-claude-toast]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                const msg = el.getAttribute('data-claude-toast') || '功能开发中';
                showToast(msg);
            });
        });
    }

    // 5. Plan pill toast + 付费用户隐藏升级 UI（2026-05-17 修复 PAID-as-FREE bug）
    //
    // 行为：
    //   - 页面加载即给 body 加 `is-tier-loading` class，CSS 隐藏升级 pill + nav-tag，
    //     billing copy 也显示"加载中…"。这阻止 PAID 用户首屏闪现"免费计划"文案。
    //   - localStorage 缓存上一次解析的 tier（TTL 5 分钟），下次加载时立刻应用，
    //     消除"已登录但要等网络"的延迟。
    //   - 应用最终 tier 后移除 `is-tier-loading`：FREE → 显示升级 pill + FREE 文案；
    //     PAID → 加 `is-paid-tier` class，CSS 隐藏 pill 并替换 billing copy。
    //   - 网络失败 + 无缓存：保留 `is-tier-loading`，避免错判 PAID 用户为 FREE。
    //     失败重试 2 次（指数退避），无效再 fail-soft。
    //   - 订阅到期：缓存 5 分钟过期后下次刷新拉到 'free'，自动回到 free 显示。
    var TIER_CACHE_KEY = 'cancri_tier_cache_v1';
    var TIER_CACHE_TTL_MS = 5 * 60 * 1000;
    var TIER_FETCH_MAX_ATTEMPTS = 3;

    function bindPlanPill() {
        const pill = document.getElementById('claudePlanPill');
        if (pill) {
            pill.addEventListener('click', function (e) {
                e.preventDefault();
                showToast('升级到 Cancri Pro 以解锁更多模型');
            });
        }
        // 进入 loading 态：CSS 在此期间隐藏 pill / nav-tag / 模糊 billing copy
        document.body.classList.add('is-tier-loading');

        // 先尝试用缓存即时应用（避免首屏闪烁）
        var cached = readTierCache();
        if (cached) {
            applyTierState(cached, /* fromCache */ true);
        }
        // 然后异步拉新鲜数据
        applyTierUI().catch(function () {
            // fail-soft 已在 applyTierUI 内部处理；这里仅吞错避免冒泡
        });
    }

    function getCancriAccessToken() {
        try {
            const raw = localStorage.getItem('cancri_supabase_auth');
            if (!raw) return '';
            const parsed = JSON.parse(raw);
            return (parsed && parsed.access_token) ? String(parsed.access_token) : '';
        } catch (e) { return ''; }
    }

    function readTierCache() {
        try {
            var raw = localStorage.getItem(TIER_CACHE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (typeof parsed.cachedAt !== 'number') return null;
            if (Date.now() - parsed.cachedAt > TIER_CACHE_TTL_MS) return null;
            if (!parsed.subscription) return null;
            return parsed.subscription;
        } catch (e) { return null; }
    }

    function writeTierCache(sub) {
        try {
            localStorage.setItem(TIER_CACHE_KEY, JSON.stringify({
                cachedAt: Date.now(),
                subscription: sub,
            }));
        } catch (e) { /* quota full / private mode：忽略 */ }
    }

    function clearTierCache() {
        try { localStorage.removeItem(TIER_CACHE_KEY); } catch (e) { /* ignore */ }
    }

    // 把订阅信息映射到 DOM 状态（class + billing copy）。
    // fromCache 仅用于日志区分，不影响行为。
    function applyTierState(sub, fromCache) {
        document.body.classList.remove('is-tier-loading');
        if (sub && sub.tier === 'paid') {
            document.body.classList.add('is-paid-tier');
            updateBillingCopy(sub);
        } else {
            document.body.classList.remove('is-paid-tier');
            updateBillingCopy(sub || { tier: 'free' });
        }
        void fromCache;
    }

    // 失败时调用：无缓存就维持 loading 态隐藏升级 UI（保守，避免 PAID 用户看 FREE）；
    // 有缓存就保持缓存结果。
    function applyTierFallback() {
        var cached = readTierCache();
        if (cached) {
            applyTierState(cached, /* fromCache */ true);
        }
        // 无缓存：维持 is-tier-loading，billing copy 保持"加载中"。
    }

    async function applyTierUI() {
        const token = getCancriAccessToken();
        if (!token) {
            // 未登录：默认 free（不算 fail，因为这是确定结论）
            clearTierCache();
            applyTierState({ tier: 'free', days_remaining: 0, expires_at: null }, false);
            return;
        }
        const SUPABASE_URL = window.__SUPABASE_URL__ || '';
        const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || '';
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            applyTierFallback();
            return;
        }

        var lastErr = null;
        for (var attempt = 0; attempt < TIER_FETCH_MAX_ATTEMPTS; attempt++) {
            try {
                var resp = await fetch(SUPABASE_URL + '/functions/v1/chat-gateway', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': 'Bearer ' + token,
                    },
                    body: JSON.stringify({ endpoint: 'get_my_subscription', __auth_token: token }),
                });
                if (!resp || !resp.ok) {
                    lastErr = new Error('HTTP ' + (resp && resp.status));
                } else {
                    var data = await resp.json().catch(function () { return null; });
                    var sub = data && data.subscription;
                    if (sub) {
                        writeTierCache(sub);
                        applyTierState(sub, false);
                        return;
                    }
                    lastErr = new Error('missing subscription field');
                }
            } catch (e) {
                lastErr = e;
            }
            // 指数退避：300ms / 900ms
            if (attempt < TIER_FETCH_MAX_ATTEMPTS - 1) {
                await new Promise(function (r) { setTimeout(r, 300 * Math.pow(3, attempt)); });
            }
        }
        // 全部重试失败 → fail-soft（用缓存或维持 loading）
        try { console.warn('applyTierUI failed after retries:', lastErr); } catch (e) { /* ignore */ }
        applyTierFallback();
    }

    // 把 settings 面板里 billing 区的文案替换成对应 tier 的精确状态。
    // 现在 HTML 默认是 #claudeBillingCopy data-tier-state="loading" + 占位文案，
    // 我们根据 sub.tier 写两种文案。
    // 2026-05-17 Phase A: plan_code 直接显示为档位标签
    var PLAN_LABEL_FOR_BILLING = { pro: 'Pro', pro_plus: 'Pro+', pro_max: 'Pro Max' };
    var PLAN_CHIP_FOR_BILLING = { pro: 'PRO', pro_plus: 'PRO+', pro_max: 'PRO MAX' };

    function updateBillingCopy(sub) {
        var copy = document.getElementById('claudeBillingCopy');
        if (!copy) return;
        if (sub.tier === 'paid') {
            var days = (sub.days_remaining > 0)
                ? sub.days_remaining + ' 天剩余'
                : '已激活';
            var exp = sub.expires_at
                ? new Date(sub.expires_at).toLocaleDateString('zh-CN')
                : '';
            var plan = sub.plan_code || 'pro';
            var planLabel = PLAN_LABEL_FOR_BILLING[plan] || 'Pro';
            var planChip = PLAN_CHIP_FOR_BILLING[plan] || 'PAID';
            // 2026-05-17 Phase A grandfather：方案 F 标志，仅 Pro 档显示
            var isGrandfathered = Boolean(sub.is_grandfathered) && plan === 'pro';
            var grandfatherChip = isGrandfathered
                ? '<span class="claude-tier-chip is-grandfather" style="margin-left:6px;vertical-align:middle" title="Phase A 老用户福利：本订阅周期内可调 Claude Opus 全系">老用户 · Opus 可调</span>'
                : '';
            copy.setAttribute('data-tier-state', 'paid');
            copy.innerHTML = '您当前是<strong>Cancri ' + planLabel + '</strong>'
                + '<span class="claude-tier-chip is-paid" style="margin-left:8px;vertical-align:middle">' + planChip + '</span>'
                + grandfatherChip
                + (exp ? '。订阅到期 ' + exp : '')
                + '（<span class="claude-billing-days">' + days + '</span>）';
        } else {
            copy.setAttribute('data-tier-state', 'free');
            copy.innerHTML = '您当前是<strong>免费计划</strong>'
                + '<span class="claude-tier-chip is-free" style="margin-left:8px;vertical-align:middle">FREE</span>'
                + '。<a href="./pricing.html">升级到付费档位</a>';
        }
    }

    // 6. 项目页 / 聊天页按钮
    function bindProjectButtons() {
        ['claudeNewProjectBtn', 'claudeProjectsEmptyNewBtn'].forEach(function (id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('click', function (e) {
                e.preventDefault();
                showToast('项目功能正在开发中');
            });
        });
    }
    function bindChatsButtons() {
        const newBtn = document.getElementById('claudeNewChatFromListBtn');
        if (newBtn) {
            newBtn.addEventListener('click', function (e) {
                e.preventDefault();
                // 复用现有 newChatBtn 的流程
                const newChatBtn = document.getElementById('newChatBtn');
                if (newChatBtn) newChatBtn.click();
            });
        }
        const selBtn = document.getElementById('claudeSelectChatsBtn');
        if (selBtn) {
            selBtn.addEventListener('click', function (e) {
                e.preventDefault();
                showToast('多选功能正在开发中');
            });
        }
    }

    // 7. 设置全屏 view 内的左 nav 切换 + 三按钮主题切换
    function bindSettingsNav() {
        // 左二级 nav 切换
        const navItems = document.querySelectorAll('.claude-snav-item[data-snav]');
        const targets = document.querySelectorAll('.claude-snav-target[data-snav-target]');
        if (navItems.length && targets.length) {
            navItems.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    const key = btn.getAttribute('data-snav');
                    navItems.forEach(function (b) { b.classList.toggle('active', b === btn); });
                    targets.forEach(function (t) {
                        t.classList.toggle('active', t.getAttribute('data-snav-target') === key);
                    });
                });
            });
        }

        // 三按钮主题 segmented：纯视觉 active 切换（真实主题切换交给 cancri_chat.js）
        const segBtns = document.querySelectorAll('.claude-segmented .claude-seg-btn[data-theme]');
        if (segBtns.length) {
            segBtns.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    segBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
                    // 注意：这里不真正改 data-theme，因为整个 Claude UI 锁 dark。
                    // 若用户选 light，下一阶段考虑提供 light 配色版本。
                });
            });
        }
    }

    // 11. + 按钮自定义菜单（Claude 风格）：拦截 composer 里 #plusTrigger 的
    //     click，弹出小菜单替代 cancri 老的 #plusPopover（"上传图片/上传文件"
    //     两项挤一起的样子）。
    //     菜单项：添加文件或照片 / 截图占位 / 网络搜索 toggle。
    //     模块化解耦：不修改 cancri_chat.js 的事件绑定，用 capture-phase
    //     stopImmediatePropagation 抢在 cancri 的 click handler 前面阻止它打开
    //     plusPopover；菜单项手动触发 #attachmentInput.click() 或 #webSearchToggle.click()。
    function bindAttachMenu() {
        // 真正的触发按钮 = composer 里那个 + button。
        // 老 #attachBtn 其实是 #plusPopover 内的 "上传图片" 菜单项，不是触发器。
        const triggerBtn = document.getElementById('plusTrigger');
        const fileInput = document.getElementById('attachmentInput');
        const webBtn = document.getElementById('webSearchToggle');
        const oldPopover = document.getElementById('plusPopover');
        if (!triggerBtn || !fileInput) return;

        // 永久隐藏 cancri 老 popover —— 用 inline style 避免和 cancri 的
        // openPopover() 切换 class 起冲突（即使老逻辑 add `.open`，display:none 也覆盖）。
        if (oldPopover) {
            oldPopover.style.display = 'none';
        }

        // 一次创建菜单元素，常驻 body。display:none 默认。
        let menu = document.getElementById('claudeAttachMenu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'claudeAttachMenu';
            menu.className = 'claude-attach-menu';
            menu.setAttribute('role', 'menu');
            menu.hidden = true;
            menu.innerHTML = ''
                + '<button type="button" class="claude-attach-item" data-action="file">'
                +   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'
                +   '<span>添加文件或照片</span>'
                + '</button>'
                + '<button type="button" class="claude-attach-item" data-action="screenshot">'
                +   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/></svg>'
                +   '<span>截图</span>'
                + '</button>'
                + '<div class="claude-attach-sep"></div>'
                + '<button type="button" class="claude-attach-item" data-action="websearch" id="claudeAttachWebSearch">'
                +   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
                +   '<span>网络搜索</span>'
                +   '<span class="claude-attach-toggle" aria-hidden="true"></span>'
                + '</button>';
            document.body.appendChild(menu);
        }
        const webSearchItem = menu.querySelector('#claudeAttachWebSearch');

        function syncWebSearchState() {
            if (!webBtn || !webSearchItem) return;
            // 与 #webSearchToggle 的 active class / aria-pressed 同步显示开关态
            const isOn = webBtn.classList.contains('active')
                || webBtn.classList.contains('is-on')
                || webBtn.getAttribute('aria-pressed') === 'true';
            webSearchItem.classList.toggle('is-on', isOn);
        }
        syncWebSearchState();

        function positionMenu() {
            const rect = triggerBtn.getBoundingClientRect();
            // 默认菜单 ~220px 宽 200px 高，弹在按钮上方。
            menu.style.left = Math.max(8, Math.round(rect.left)) + 'px';
            menu.style.top = Math.max(8, Math.round(rect.top - menu.offsetHeight - 8)) + 'px';
        }

        function openMenu() {
            menu.hidden = false;
            syncWebSearchState();
            // 测一次 offsetHeight 才能正确算 top（hidden 时为 0）
            requestAnimationFrame(positionMenu);
        }
        function closeMenu() {
            menu.hidden = true;
        }

        // 拦截 plusTrigger click（capture phase + stopImmediatePropagation），
        // 抢在 cancri_chat.js 里给 #plusTrigger 注册的 bubble-phase listener 前面，
        // 阻止它调用 openPopover(plusPopover)。
        triggerBtn.addEventListener('click', function (e) {
            e.stopImmediatePropagation();
            e.preventDefault();
            if (menu.hidden) {
                openMenu();
            } else {
                closeMenu();
            }
        }, true);

        // 菜单项委托
        menu.addEventListener('click', function (e) {
            const item = e.target.closest('.claude-attach-item');
            if (!item) return;
            const action = item.dataset.action;
            if (action === 'file') {
                fileInput.click();
                closeMenu();
            } else if (action === 'screenshot') {
                showToast('截图功能正在开发中');
                closeMenu();
            } else if (action === 'websearch') {
                // 触发原 #webSearchToggle.click()，保留 cancri 的状态机
                if (webBtn) webBtn.click();
                // 同步显示，不关闭菜单（让用户看到 toggle 状态）
                setTimeout(syncWebSearchState, 50);
            }
        });

        // 外部点击关闭
        document.addEventListener('click', function (e) {
            if (menu.hidden) return;
            if (menu.contains(e.target)) return;
            if (triggerBtn.contains(e.target)) return;
            closeMenu();
        });
        // ESC 关闭
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !menu.hidden) closeMenu();
        });
        // 滚动 / resize 关闭（避免位置漂移）
        window.addEventListener('scroll', function () { if (!menu.hidden) closeMenu(); }, true);
        window.addEventListener('resize', function () { if (!menu.hidden) closeMenu(); });
    }

    // 12. 模型 dropdown 折叠 + cascade submenu（PC）/ 全展开（mobile）
    //     PC（>768px）：主 dropdown 默认折叠只显示 active 模型 + "更多模型 →"
    //                   行；hover 该行 → 在主 dropdown 右侧弹出 cascade 容器
    //                   显示其他全部模型。模型点击通过转发到主 dropdown 内
    //                   同 data-model 的原 option，复用 cancri 的 click 委托。
    //     Mobile（≤768px）：不折叠，不创建 cascade，主 dropdown 直接显示全部
    //                       （搜索 + filter + 列表，跟原 cancri 行为一致）。
    //     模块化解耦：不重写 cancri 的 renderModelDropdownFromCatalog；cascade
    //     是 body 直接子节点，渲染时 cloneNode 主 dropdown 内的 .model-option
    //     和 .model-group-header。
    function bindModelMoreMenu() {
        const dropdown = document.getElementById('modelDropdown');
        if (!dropdown) return;
        const content = document.getElementById('modelDropdownContent');
        const searchInput = document.getElementById('modelSearchInput');
        const modelSelector = document.getElementById('modelSelector');
        if (!content) return;

        const mqDesktop = window.matchMedia('(min-width: 769px)');

        // ── 1. dropdown 自身大小适配（仅桌面）──
        // 桌面：dropdown 用 position: fixed，cancri 按按钮 getBoundingClientRect().bottom
        //   设 inline `top`。按钮在 composer 中下，向下展开会顶穿 viewport 底，导致底
        //   圆角被切。CSS max-height 是死值，这里按 inline top 动态写 max-height。
        // 移动：claude.css 走 bottom-anchor + max-height:50dvh !important，不需要
        //   动态算（也避免被 99-polish-fixes 的 top !important 干扰）。
        //
        // 2026-05-15 fix(M7)：群友反馈"PC端点不动这个模型菜单"——根因是 chat 模式
        // 下 composer 沉底，cancri 算的 inlineTop = rect.bottom + 8 接近 viewport 底，
        // dropdown 向下展开整体落到屏外。修复：在 chat 模式（body.is-chatting）下，
        // 检测 spaceBelow < 320 时把 dropdown 翻成 bottom-anchor（向上展开），
        // 同时清掉 cancri 算的 inline top。这样不动 cancri 逻辑，只在 claude 层做
        // viewport-aware 翻转。non-chat 模式（home / settings 等）保留向下展开。
        function sizeDropdownByViewport() {
            if (!mqDesktop.matches) return; // mobile 完全交给 CSS
            const inlineTop = parseFloat(dropdown.style.top || '');
            if (!Number.isFinite(inlineTop) || inlineTop <= 0) return;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            if (!vh) return;

            // chat-mode 翻转判定：用户希望对话中输入框居底时菜单向上拉。
            const triggerEl = modelSelector?.querySelector('.model-current')
                              || document.getElementById('modelCurrentBtn');
            const rect = triggerEl ? triggerEl.getBoundingClientRect() : null;
            const isChatBottom = rect
                && document.body.classList.contains('is-chatting')
                && (vh - rect.bottom) < 320;

            if (isChatBottom && rect) {
                // 翻转到 bottom-anchor：dropdown 底边 8px 上贴 trigger 顶
                const bottomPx = Math.max(8, Math.round(vh - rect.top + 8));
                const maxH = Math.max(220, Math.round(rect.top - 24));
                if (dropdown.style.top !== 'auto') dropdown.style.top = 'auto';
                if (dropdown.style.bottom !== bottomPx + 'px') {
                    dropdown.style.bottom = bottomPx + 'px';
                }
                if (dropdown.style.maxHeight !== maxH + 'px') {
                    dropdown.style.maxHeight = maxH + 'px';
                }
                return;
            }

            // 非 chat-mode（或空间足够）：默认向下展开，bottom 留空。
            if (dropdown.style.bottom) {
                dropdown.style.bottom = '';
            }
            const maxH = Math.max(220, Math.round(vh - inlineTop - 24));
            const want = maxH + 'px';
            if (dropdown.style.maxHeight === want) return;
            dropdown.style.maxHeight = want;
        }
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(sizeDropdownByViewport)
                .observe(dropdown, { attributes: true, attributeFilter: ['style'] });
        }
        window.addEventListener('resize', sizeDropdownByViewport);
        sizeDropdownByViewport();

        // ── 2. PC 端 cascade submenu ──
        // 注入 "更多模型 →" 行（cancri 重渲染 content 后会被 observer 重新 append）
        let moreRow = dropdown.querySelector('.claude-more-models-row');
        if (!moreRow) {
            moreRow = document.createElement('div');
            moreRow.className = 'claude-more-models-row';
            moreRow.setAttribute('role', 'menuitem');
            moreRow.innerHTML = '<span class="claude-more-models-label">更多模型</span>'
                + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
            content.parentNode.insertBefore(moreRow, content.nextSibling);
        }

        // cascade 容器（body 直挂，避免被主 dropdown 的 overflow:hidden 裁剪）
        let cascade = document.getElementById('claudeModelCascade');
        if (!cascade) {
            cascade = document.createElement('div');
            cascade.id = 'claudeModelCascade';
            cascade.className = 'claude-model-cascade';
            cascade.hidden = true;
            document.body.appendChild(cascade);
        }

        function applyDesktopFolding() {
            if (mqDesktop.matches) {
                dropdown.classList.add('claude-collapsed-models');
                moreRow.style.display = '';
            } else {
                // mobile：去折叠，隐藏 moreRow（用户截图就是想看到全部）
                dropdown.classList.remove('claude-collapsed-models');
                moreRow.style.display = 'none';
                hideCascade();
            }
        }

        function populateCascade() {
            // 每次重新拷贝，反映当前模型状态（quota 锁、speed dot 等）
            cascade.innerHTML = '';
            const items = content.querySelectorAll('.model-group-header, .model-option:not(.active)');
            items.forEach(function (el) {
                const clone = el.cloneNode(true);
                cascade.appendChild(clone);
            });
        }

        function positionCascade() {
            const rect = dropdown.getBoundingClientRect();
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            const cw = 280;
            const gap = 6;
            // 优先放右边，不够则放左边
            let left = rect.right + gap;
            if (left + cw > vw - 12) {
                left = Math.max(12, rect.left - cw - gap);
            }
            const top = Math.max(12, rect.top);
            cascade.style.left = left + 'px';
            cascade.style.top = top + 'px';
            cascade.style.width = cw + 'px';
            cascade.style.maxHeight = Math.max(220, vh - top - 24) + 'px';
        }

        function showCascade() {
            if (!mqDesktop.matches) return;
            populateCascade();
            cascade.hidden = false;
            requestAnimationFrame(positionCascade);
        }
        function hideCascade() {
            cascade.hidden = true;
        }

        moreRow.addEventListener('mouseenter', showCascade);
        // 触摸（PC 端 hover-only，但为兼容笔记本触屏保留 click）
        moreRow.addEventListener('click', function (e) {
            e.stopPropagation();
            showCascade();
        });

        // 鼠标在主 dropdown / cascade 之间穿梭时不要关；离开整个组合区才关
        dropdown.addEventListener('mouseleave', function (e) {
            const next = e.relatedTarget;
            if (next && cascade.contains(next)) return;
            hideCascade();
        });
        cascade.addEventListener('mouseleave', function (e) {
            const next = e.relatedTarget;
            if (next && dropdown.contains(next)) return;
            hideCascade();
        });

        // cascade click → 找原 option 触发 click，复用 cancri 的 changeModel 委托
        cascade.addEventListener('click', function (e) {
            const opt = e.target.closest('.model-option');
            if (!opt) return;
            const modelId = opt.dataset.model;
            if (!modelId) return;
            const source = content.querySelector('.model-option[data-model="' + CSS.escape(modelId) + '"]');
            if (source) {
                source.click();
                hideCascade();
            }
        });

        // 搜索框有内容：取消折叠让 cancri 的 filter 在主 dropdown 内显示结果
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                if (!mqDesktop.matches) return;
                if (searchInput.value.trim()) {
                    dropdown.classList.remove('claude-collapsed-models');
                    hideCascade();
                } else {
                    dropdown.classList.add('claude-collapsed-models');
                }
            });
        }

        // 主 dropdown 关闭（modelSelector 失去 .open）时同步关 cascade + 重置搜索
        if (modelSelector && typeof MutationObserver !== 'undefined') {
            new MutationObserver(function () {
                if (!modelSelector.classList.contains('open')
                    && !modelSelector.classList.contains('is-open')) {
                    hideCascade();
                    if (searchInput) searchInput.value = '';
                    // 关闭后重新加 collapsed class（搜索路径可能去掉过）
                    if (mqDesktop.matches) {
                        dropdown.classList.add('claude-collapsed-models');
                    }
                }
            }).observe(modelSelector, { attributes: true, attributeFilter: ['class'] });
        }

        // cancri 每次 openModelDropdown 后会重新渲染 .model-option，重新插入 moreRow
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(function () {
                if (moreRow.parentNode !== content.parentNode
                    || moreRow.previousSibling !== content) {
                    content.parentNode.insertBefore(moreRow, content.nextSibling);
                }
            }).observe(content, { childList: true });
        }

        // 视口尺寸变化：重新决定 mobile / desktop 模式
        applyDesktopFolding();
        if (typeof mqDesktop.addEventListener === 'function') {
            mqDesktop.addEventListener('change', applyDesktopFolding);
        } else if (typeof mqDesktop.addListener === 'function') {
            mqDesktop.addListener(applyDesktopFolding);
        }
    }

    // 14. 登录页左下角 theme 切换按钮。
    //     直接操作 root data-theme + 同步 cancri state + 写 localStorage，
    //     不再绕 sidebarThemeToggle.click()（避免依赖 js/ui/theme.js
    //     绑定时序 / sidebar element 可见性）。
    function bindAuthThemeToggle() {
        const btn = document.getElementById('authThemeToggle');
        if (!btn) return;
        const STORAGE_KEY = 'cancri_ui_prefs';

        function getCurrentTheme() {
            return document.documentElement.getAttribute('data-theme') === 'dark'
                ? 'dark' : 'light';
        }
        function syncIcon() {
            const isDark = getCurrentTheme() === 'dark';
            btn.dataset.theme = isDark ? 'dark' : 'light';
            btn.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
            btn.setAttribute('title', isDark ? '切换到浅色模式' : '切换到深色模式');
        }
        function persistTheme(theme) {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                const prefs = raw ? JSON.parse(raw) : {};
                prefs.theme = theme;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
            } catch (_) { /* localStorage 不可用静默忽略 */ }
        }
        function applyTheme(next) {
            // 1) 同步到 cancri 内部 state，让 cancri.applyTheme() 跟 UI 一致
            const app = window.CancriApp;
            if (app && app.state) {
                app.state.theme = next;
            }
            // 2) 调 cancri 内部 applyTheme（会触发 setAttribute + persist + UI 更新）
            if (app && typeof app.applyTheme === 'function') {
                app.applyTheme();
            } else {
                // cancri 尚未初始化的极端 case：手动设置
                document.documentElement.setAttribute('data-theme', next);
                persistTheme(next);
            }
            // 3) 同步 sidebar label（js/ui/theme.js 用 MutationObserver
            //    自动同步，这里冗余调用保证立即生效）
            const label = document.getElementById('sidebarThemeLabel');
            if (label) label.textContent = next === 'dark' ? '浅色模式' : '深色模式';
            syncIcon();
            showToast(next === 'dark' ? '已切换至深色' : '已切换至浅色');
        }
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
        });
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(syncIcon).observe(document.documentElement, {
                attributes: true, attributeFilter: ['data-theme']
            });
        }
        syncIcon();
    }

    // 公共 toast：使用现有 #toast 元素，没有就 fallback alert
    function showToast(msg) {
        const toast = document.getElementById('toast');
        if (!toast) { alert(msg); return; }
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(function () {
            toast.classList.remove('show');
        }, 2000);
    }
})();
