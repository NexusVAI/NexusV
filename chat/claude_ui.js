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

    var ONBOARDING_DISMISSED_KEY = 'cancri_getting_started_dismissed_v1';
    var ONBOARDING_COMPLETED_KEY = 'cancri_getting_started_completed_v1';
    var CODE_PROMO_DISMISSED_KEY = 'cancri_code_promo_dismissed_v1';
    var ONBOARDING_TASK_IDS = ['importMemory', 'community', 'cancriCode'];
    var COMMUNITY_URL = 'https://qm.qq.com/q/RNgltzNsSQ';
    var CANCRI_CODE_URL = 'https://pan.baidu.com/s/1f65FMHdo2TenrwG7gBWQhg';
    var SERVICE_STATUS_URL = 'https://nexusvai.github.io/ChatAI-status/status.html';
    var CANCRI_CODE_PAN_CODE = 'Nexu';
    var MEMORY_IMPORT_TEXT_LIMIT = 12000;
    var memoryImportCandidates = [];
    var latestTierSubscription = null;
    var accountPlanObserverMuted = false;
    var accountPlanRefreshTimer = 0;
    var tierAuthWaitTimer = 0;

    // 等待 DOM ready，避免脚本在 cancri_chat.js 初始化前 query 不到 DOM。
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    function init() {
        [
            injectSidebarNavIconMotionStyles,
            relocateModelSelector,
            function () { requestAnimationFrame(relocateModelSelector); },
            function () { setTimeout(relocateModelSelector, 250); },
            bindSuggestPills,
            bindSearchModal,
            bindCustomNav,
            bindArtifactsNav,
            bindPlanPill,
            bindAccountPlanSync,
            bindTierAuthEvents,
            bindGettingStartedChecklist,
            bindCodePromoCard,
            bindExternalSidebarLinks,
            bindImportMemoryShortcut,
            bindImportMemoryDelegation,
            bindProjectButtons,
            bindChatsButtons,
            bindChatsPageList,
            bindProjectsPage,
            bindSettingsNav,
            bindChatTitleSync,
            bindMobileSidebarDrawer,
            bindAttachMenu,
            bindModelMoreMenu,
            bindSidebarTooltips,
            bindAuthThemeToggle,
            bindHomeInputDefensiveFocus,
            bindSettingsModalClose,
            bindPageDragOverlay,
            bindRecentHeaderToggle,
            bindGroupByDropdown,
            bindVoiceHoverAnimation,
            bindClaudeAccountPanel,
            bindClaudePasswordPanel
        ].forEach(function (step) {
            try {
                step();
            } catch (e) {
                console.error('[claude_ui] init step failed:', e);
            }
        });
    }

    // Cancri Code / 服务状态 SVG 悬停动画：写入 claude.css + 运行时注入，避免
    // styles/claude-sidebar-icons.css 未进 Git 或 CDN 缓存旧 claude.css 时线上无动画。
    function injectSidebarNavIconMotionStyles() {
        if (document.getElementById('cancri-sidebar-nav-svg-motion')) return;
        if (!document.getElementById('claudeCancriCodeNavBtn') && !document.getElementById('claudeServiceStatusNavBtn')) return;
        var style = document.createElement('style');
        style.id = 'cancri-sidebar-nav-svg-motion';
        style.textContent =
            '@media (hover:hover) and (prefers-reduced-motion:no-preference){' +
            '#claudeCancriCodeNavBtn .nav-icon-slot svg path:nth-of-type(2),' +
            '#claudeCancriCodeNavBtn .nav-icon-slot svg path:nth-of-type(3),' +
            '#claudeServiceStatusNavBtn .nav-icon-slot svg path:nth-of-type(2),' +
            '#claudeServiceStatusNavBtn .nav-icon-slot svg path:nth-of-type(3){' +
            'transition:transform 200ms cubic-bezier(0.34,1.3,0.64,1);}' +
            '#claudeServiceStatusNavBtn .nav-icon-slot svg path:nth-of-type(2){transform-origin:14px 6.5px;}' +
            '#claudeServiceStatusNavBtn .nav-icon-slot svg path:nth-of-type(3){transform-origin:6px 14px;}' +
            '#claudeCancriCodeNavBtn:hover .nav-icon-slot svg path:nth-of-type(2),' +
            '#claudeCancriCodeNavBtn:focus-visible .nav-icon-slot svg path:nth-of-type(2){transform:translateX(1px)!important;}' +
            '#claudeCancriCodeNavBtn:hover .nav-icon-slot svg path:nth-of-type(3),' +
            '#claudeCancriCodeNavBtn:focus-visible .nav-icon-slot svg path:nth-of-type(3){transform:translateX(-1px)!important;}' +
            '#claudeServiceStatusNavBtn:hover .nav-icon-slot svg path:nth-of-type(2),' +
            '#claudeServiceStatusNavBtn:focus-visible .nav-icon-slot svg path:nth-of-type(2){transform:rotate(-90deg)!important;}' +
            '#claudeServiceStatusNavBtn:hover .nav-icon-slot svg path:nth-of-type(3),' +
            '#claudeServiceStatusNavBtn:focus-visible .nav-icon-slot svg path:nth-of-type(3){transform:rotate(120deg)!important;}' +
            '}';
        document.head.appendChild(style);
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
        let card = document.getElementById('claudeSidebarTooltipCard');
        if (!card) {
            card = document.createElement('div');
            card.id = 'claudeSidebarTooltipCard';
            card.className = 'claude-sidebar-tooltip-card';
            card.hidden = true;
            document.body.appendChild(card);
        }
        function applyTitles() {
            sidebar.querySelectorAll('.nav-row').forEach(function (row) {
                const label = row.querySelector('.sidebar-label');
                const text = label ? label.textContent.trim() : row.textContent.trim();
                if (text) {
                    row.setAttribute('data-sidebar-tooltip', text);
                    row.removeAttribute('title');
                }
            });
        }
        function hideCard() {
            card.hidden = true;
        }
        function showCard(row) {
            const text = row.getAttribute('data-sidebar-tooltip') || '';
            if (
                !text ||
                window.matchMedia('(max-width: 768px)').matches ||
                !sidebar.classList.contains('collapsed') ||
                sidebar.classList.contains('is-rail-animating')
            ) {
                hideCard();
                return;
            }
            const rect = row.getBoundingClientRect();
            card.textContent = text;
            card.hidden = false;
            const top = Math.max(8, Math.min(window.innerHeight - card.offsetHeight - 8, rect.top + rect.height / 2 - card.offsetHeight / 2));
            card.style.left = Math.round(rect.right + 10) + 'px';
            card.style.top = Math.round(top) + 'px';
        }
        applyTitles();
        sidebar.addEventListener('pointerover', function (event) {
            const row = event.target.closest('.nav-row');
            if (row && sidebar.contains(row)) showCard(row);
        });
        sidebar.addEventListener('pointerout', function (event) {
            if (!event.relatedTarget || !sidebar.contains(event.relatedTarget)) hideCard();
        });
        window.addEventListener('scroll', hideCard, true);
        window.addEventListener('resize', hideCard);
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(applyTitles).observe(sidebar, { subtree: true, childList: true });
            new MutationObserver(function () {
                if (sidebar.classList.contains('is-rail-animating')) hideCard();
            }).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
        }
    }

    // 10. Mobile sidebar drawer：在 ≤768px 屏幕，点 #mobileMenuBtn 应该
    //     toggle body.sidebar-open（drawer 滑入），而不是老逻辑的
    //     sidebar.collapsed（折叠成 56px rail，在 mobile 上看不见）。
    //     用 capture-phase + stopImmediatePropagation 接管 mobile 点击，
    //     桌面端走原 cancri_chat.js 的 collapsed 逻辑（不干扰）。
    function bindMobileSidebarDrawer() {
        const btn = document.getElementById('mobileMenuBtn');
        const sidebarToggle = document.getElementById('sidebarToggle');
        if (!btn) return;
        let closeAnimationTimer = null;
        function isMobile() {
            return window.matchMedia('(max-width: 768px)').matches;
        }
        function sidebarEl() {
            return document.getElementById('sidebar');
        }
        function setToggleExpanded(open) {
            [btn, sidebarToggle].forEach(function (toggle) {
                if (toggle) toggle.setAttribute('aria-expanded', String(open));
            });
        }
        function syncMobileSidebarState(sidebar, open) {
            if (!sidebar) return;
            sidebar.classList.toggle('is-mobile-open', open);
            sidebar.classList.toggle('is-mobile-closing', false);
            sidebar.dataset.open = String(open);
            sidebar.dataset.collapsed = String(!open);
            setToggleExpanded(open);
        }
        function isDrawerOpen() {
            const sidebar = sidebarEl();
            return document.body.classList.contains('sidebar-open') ||
                Boolean(sidebar && sidebar.classList.contains('is-mobile-open')) ||
                Boolean(sidebar && sidebar.dataset.open === 'true');
        }
        // 同步两套 sidebar 语义，避免老/新规则在关闭时冲突：
        //   - 老 cancri_chat 语义：mobile 下 .collapsed 表示隐藏（默认 add 到 sidebar）
        //   - 新 claude_ui 语义：body.sidebar-open 表示抽屉打开（drawer 显示）
        // 单写 body.sidebar-open 关闭时 sidebar 不消失（老 cancri_chat.css mobile
        // rule 默认 .sidebar { transform: translateX(0) } 胜出）。
        // 必须打开时去 .collapsed + 加 .sidebar-open；关闭时反向。
        function openDrawer() {
            const sidebar = sidebarEl();
            if (closeAnimationTimer) {
                clearTimeout(closeAnimationTimer);
                closeAnimationTimer = null;
            }
            if (sidebar) sidebar.classList.remove('collapsed', 'is-mobile-closing');
            document.body.classList.add('sidebar-open');
            syncMobileSidebarState(sidebar, true);
        }
        function closeDrawer() {
            const sidebar = sidebarEl();
            if (closeAnimationTimer) {
                clearTimeout(closeAnimationTimer);
                closeAnimationTimer = null;
            }
            document.body.classList.remove('sidebar-open');
            syncMobileSidebarState(sidebar, false);
            if (sidebar) sidebar.classList.add('collapsed', 'is-mobile-closing');
            closeAnimationTimer = setTimeout(function () {
                const latest = sidebarEl();
                if (latest) latest.classList.remove('is-mobile-closing');
                closeAnimationTimer = null;
            }, 220);
        }

        [btn, sidebarToggle].forEach(function (toggle) {
            if (!toggle) return;
            toggle.addEventListener('click', function (e) {
                if (!isMobile()) return;  // 桌面端走原 cancri_chat.js .collapsed 逻辑
                e.stopImmediatePropagation();
                e.preventDefault();
                if (isDrawerOpen()) {
                    closeDrawer();
                } else {
                    openDrawer();
                }
            }, true);
        });
        // 点蒙层关闭抽屉
        document.addEventListener('click', function (e) {
            if (!isMobile()) return;
            if (!isDrawerOpen()) return;
            const sidebar = sidebarEl();
            if (!sidebar) return;
            if (sidebar.contains(e.target)) return;
            if ([btn, sidebarToggle].some(function (toggle) { return toggle && toggle.contains(e.target); })) return;
            closeDrawer();
        });
        // 屏幕变宽（旋转横屏 / 缩放）时自动清 drawer 状态。
        // 桌面端不应继承 .collapsed（rail 模式），只保留用户手动切换。
        window.matchMedia('(min-width: 769px)').addEventListener('change', function (e) {
            if (e.matches) {
                document.body.classList.remove('sidebar-open');
                const sidebar = sidebarEl();
                if (sidebar) {
                    sidebar.classList.remove('is-mobile-open');
                    sidebar.classList.remove('is-mobile-closing');
                    sidebar.dataset.open = 'false';
                }
                setToggleExpanded(false);
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
                delete titleEl.dataset.savedTitle;
                return;
            }
            const saved = titleEl.dataset.savedTitle;
            if (saved) {
                titleEl.textContent = saved;
                return;
            }
            const t = pickFirstUserText();
            titleEl.textContent = t || '新聊天';
        }

        update();

        document.addEventListener('cancri:title-updated', function (e) {
            const title = (e.detail && e.detail.title) || '';
            if (title) {
                titleEl.dataset.savedTitle = title;
                titleEl.textContent = title;
            } else {
                delete titleEl.dataset.savedTitle;
                update();
            }
        });

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

    // 0. 物理把 #modelSelector 从 .header-left 移动到 composer-actions 里，
    //    放在 #voiceToastBtn 之前。这是 Claude 主页样子：模型按钮内嵌输入框右下。
    //    cancri_chat.js 没有依赖 #modelSelector 的父级选择器，所以位置移动无副作用。
    //    modelDropdown 的位置是 inline style 动态计算，跟着按钮位置走。
    function relocateModelSelector() {
        const modelSelector = document.getElementById('modelSelector');
        const projectActions = document.querySelector('#claudeProjectDetailView.active .claude-project-composer-actions');
        const composerActions = projectActions || document.querySelector('#homeView .composer-actions') || document.querySelector('.composer-actions');
        const voiceBtn = projectActions ? document.getElementById('claudeProjectVoiceBtn') : document.getElementById('voiceToastBtn');
        if (!modelSelector || !composerActions) return;
        if (composerActions.contains(modelSelector)) {
            modelSelector.classList.add('claude-model-selector-inline');
            return;
        }
        if (voiceBtn) {
            composerActions.insertBefore(modelSelector, voiceBtn);
        } else {
            composerActions.appendChild(modelSelector);
        }
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
    function openClaudeSettingsModal() {
        var view = document.getElementById('claudeSettingsView');
        if (!view) return;
        var prevView = (document.body && document.body.dataset.view) || 'home';
        if (prevView !== 'claudeSettings') {
            window.__claudeSettingsPrevView = prevView;
        }
        var accountPopover = document.getElementById('accountPopover');
        var keepAccountSheet = Boolean(
            accountPopover &&
            accountPopover.classList.contains('open') &&
            window.matchMedia('(max-width: 768px)').matches
        );
        window.__claudeSettingsKeepAccountSheet = keepAccountSheet;
        if (typeof window.setActiveView === 'function') {
            window.setActiveView('claudeSettings', { preservePopover: keepAccountSheet });
        } else {
            document.querySelectorAll('.main > .view').forEach(function (v) {
                v.classList.toggle('active', v.id === 'claudeSettingsView');
            });
            if (document.body) document.body.dataset.view = 'claudeSettings';
        }
    }

    function bindCustomNav() {
        document.querySelectorAll('[data-claude-action="open-settings"]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopImmediatePropagation();
                e.preventDefault();
                var accountPopover = document.getElementById('accountPopover');
                var keepAccountSheet = Boolean(
                    accountPopover &&
                    accountPopover.classList.contains('open') &&
                    window.matchMedia('(max-width: 768px)').matches
                );
                document.querySelectorAll('.popover.open').forEach(function (p) {
                    if (keepAccountSheet && p.id === 'accountPopover') return;
                    p.classList.remove('open');
                });
                openClaudeSettingsModal();
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
                if (
                    document.body.classList.contains('is-paid-tier') ||
                    document.body.classList.contains('is-tier-loading')
                ) {
                    e.preventDefault();
                }
            });
        }
        var sidebarUpgrade = document.getElementById('donateBtn');
        if (sidebarUpgrade) {
            sidebarUpgrade.addEventListener('click', function (e) {
                if (
                    document.body.classList.contains('is-paid-tier') ||
                    document.body.classList.contains('is-tier-loading')
                ) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                window.location.href = './pricing.html';
            }, true);
        }
        // 进入 loading 态：CSS 在此期间隐藏 pill / nav-tag / 模糊 billing copy
        document.body.classList.add('is-tier-loading');
        if (getCancriAccessToken()) {
            document.body.classList.add('is-account-tier-loading');
        }

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
        latestTierSubscription = sub || null;
        document.body.classList.remove('is-tier-loading');
        document.body.classList.remove('is-account-tier-loading');
        if (sub && sub.tier === 'paid') {
            document.body.classList.add('is-paid-tier');
            updateBillingCopy(sub);
        } else {
            document.body.classList.remove('is-paid-tier');
            updateBillingCopy(sub || { tier: 'free' });
        }
        updateAccountPlanText(sub || { tier: 'free' });
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
            // 2026-06-17 fix：首屏 token 可能还没从 Supabase 异步恢复。此时绝不能清缓存 /
            // 误判 free——否则 Pro Max 用户会闪成「免费计划」且不再被纠正（需手动刷新）。
            // 先用缓存即时显示；无缓存则保持骨架，最多等 1.5s，之后若仍无 token 才判为登出。
            const cached0 = readTierCache();
            if (cached0) { applyTierState(cached0, true); return; }
            if (!tierAuthWaitTimer) {
                tierAuthWaitTimer = setTimeout(function () {
                    tierAuthWaitTimer = 0;
                    if (getCancriAccessToken()) {
                        applyTierUI().catch(function () {});
                    } else {
                        clearTierCache();
                        applyTierState({ tier: 'free', days_remaining: 0, expires_at: null }, false);
                    }
                }, 1500);
            }
            return;
        }
        if (tierAuthWaitTimer) { clearTimeout(tierAuthWaitTimer); tierAuthWaitTimer = 0; }
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

    function bindAccountPlanSync() {
        updateAccountPlanText(latestTierSubscription || readTierCache() || null);
        var strip = document.getElementById('accountTrigger');
        if (strip && typeof MutationObserver !== 'undefined') {
            new MutationObserver(function () {
                if (accountPlanObserverMuted) return;
                clearTimeout(accountPlanRefreshTimer);
                accountPlanRefreshTimer = setTimeout(function () {
                    updateAccountPlanText(latestTierSubscription || readTierCache() || null);
                    if (getCancriAccessToken()) {
                        applyTierUI().catch(function () {});
                    }
                }, 80);
            }).observe(strip, { childList: true, subtree: true, characterData: true });
        }
    }

    function setAccountPlanText(planEl, text) {
        accountPlanObserverMuted = true;
        planEl.textContent = text;
        setTimeout(function () { accountPlanObserverMuted = false; }, 0);
    }

    function updateAccountPlanText(sub) {
        var planEl = document.querySelector('.account-strip .account-plan');
        if (!planEl) return;
        var token = getCancriAccessToken();
        if (!token) {
            document.body.classList.remove('is-account-tier-loading');
            setAccountPlanText(planEl, '请先登录');
            return;
        }
        if (sub && sub.tier === 'paid') {
            var plan = sub.plan_code || 'pro';
            var label = PLAN_LABEL_FOR_BILLING[plan] || 'Pro';
            document.body.classList.remove('is-account-tier-loading');
            setAccountPlanText(planEl, label + ' plan');
            return;
        }
        if (sub && sub.tier === 'free') {
            document.body.classList.remove('is-account-tier-loading');
            setAccountPlanText(planEl, 'Free plan');
            return;
        }
        // 2026-06-17 fix：已登录但订阅档位尚未拿到（未知）——保持骨架，绝不写「Free plan」误导付费用户。
        document.body.classList.add('is-account-tier-loading');
    }

    // 监听 cancri_chat.js 在 Supabase auth 状态变化时派发的事件，确保登录就绪后
    // 一定会重新拉取真实档位（修首屏 token 未就绪的竞态），并兜底重试卡住的骨架。
    function bindTierAuthEvents() {
        window.addEventListener('cancri:auth-changed', function (e) {
            var signedIn = !!(e && e.detail && e.detail.signedIn);
            if (signedIn) {
                // 仅在档位尚未知时显示骨架；已知档位的路由 token 刷新静默重拉，避免名字/档位闪烁。
                if (!latestTierSubscription) {
                    document.body.classList.add('is-tier-loading');
                    document.body.classList.add('is-account-tier-loading');
                }
                if (tierAuthWaitTimer) { clearTimeout(tierAuthWaitTimer); tierAuthWaitTimer = 0; }
                applyTierUI().catch(function () {});
            } else {
                clearTierCache();
                latestTierSubscription = null;
                applyTierState({ tier: 'free', days_remaining: 0, expires_at: null }, false);
            }
        });
        function retryIfLoading() {
            if (document.body.classList.contains('is-tier-loading') && getCancriAccessToken()) {
                applyTierUI().catch(function () {});
            }
        }
        window.addEventListener('focus', retryIfLoading);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) retryIfLoading();
        });
    }

    function readOnboardingCompleted() {
        try {
            var raw = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
            var parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function writeOnboardingCompleted(done) {
        try { localStorage.setItem(ONBOARDING_COMPLETED_KEY, JSON.stringify(done || {})); } catch (e) {}
    }

    function isOnboardingDismissed() {
        try { return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1'; } catch (e) { return false; }
    }

    function dismissOnboarding(card) {
        if (!card) return;
        try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1'); } catch (e) {}
        card.classList.add('is-fading');
        setTimeout(function () {
            card.hidden = true;
            maybeShowCodePromo();
        }, 260);
    }

    function isCodePromoDismissed() {
        try { return localStorage.getItem(CODE_PROMO_DISMISSED_KEY) === '1'; } catch (e) { return false; }
    }

    function dismissCodePromo(card) {
        if (!card) return;
        try { localStorage.setItem(CODE_PROMO_DISMISSED_KEY, '1'); } catch (e) {}
        card.classList.add('is-fading');
        setTimeout(function () { card.hidden = true; }, 260);
    }

    function isOnboardingVisible() {
        var card = document.getElementById('claudeOnboardingCard');
        if (!card || card.hidden || isOnboardingDismissed()) return false;
        return true;
    }

    function maybeShowCodePromo() {
        var promo = document.getElementById('claudeCodePromoCard');
        if (!promo) return;
        if (isOnboardingVisible() || isCodePromoDismissed()) {
            promo.hidden = true;
            return;
        }
        promo.hidden = false;
        promo.classList.remove('is-fading');
    }

    function openCancriCodeDownload() {
        window.open(CANCRI_CODE_URL, '_blank', 'noopener');
        showToast('百度网盘提取码：' + CANCRI_CODE_PAN_CODE);
    }

    function renderOnboardingState(card, done) {
        if (!card) return;
        var count = 0;
        ONBOARDING_TASK_IDS.forEach(function (id) {
            var isDone = Boolean(done[id]);
            if (isDone) count++;
            var task = card.querySelector('[data-onboarding-id="' + id + '"]');
            if (task) task.classList.toggle('is-complete', isDone);
        });
        var progress = document.getElementById('claudeOnboardingProgress');
        if (progress) progress.textContent = '3步中' + count + '步完成';
        if (count >= ONBOARDING_TASK_IDS.length) dismissOnboarding(card);
    }

    function completeOnboardingTask(id, card) {
        var done = readOnboardingCompleted();
        done[id] = true;
        writeOnboardingCompleted(done);
        renderOnboardingState(card, done);
    }

    function openImportMemorySettings() {
        var api = cancriApp();
        if (api && typeof api.setActiveView === 'function') {
            api.setActiveView('claudeSettings');
        } else if (typeof window.setActiveView === 'function') {
            window.setActiveView('claudeSettings');
        } else {
            document.querySelectorAll('.main > .view').forEach(function (view) {
                view.classList.toggle('active', view.id === 'claudeSettingsView');
            });
            if (document.body) document.body.dataset.view = 'claudeSettings';
        }
        var overviewBtn = document.querySelector('.claude-snav-item[data-snav="overview"]');
        if (overviewBtn) overviewBtn.click();
        setTimeout(function () {
            var row = document.getElementById('claudeMemoryImportRow');
            if (!row) return;
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });
            row.classList.add('is-highlighted');
            setTimeout(function () { row.classList.remove('is-highlighted'); }, 1500);
        }, 60);
    }

    function cancriApp() {
        return window.CancriApp || null;
    }

    function escapeText(value) {
        const api = cancriApp();
        if (api && typeof api.escapeHtml === 'function') return api.escapeHtml(value);
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function trimImportText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_IMPORT_TEXT_LIMIT);
    }

    function appendImportText(parts, text) {
        const value = String(text || '').replace(/\s+/g, ' ').trim();
        if (value.length < 2) return;
        if (/^[a-f0-9-]{16,}$/i.test(value)) return;
        parts.push(value);
    }

    function walkImportJson(value, parts, depth) {
        if (parts.join('\n').length > MEMORY_IMPORT_TEXT_LIMIT || depth > 9) return;
        if (typeof value === 'string') {
            appendImportText(parts, value);
            return;
        }
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            value.forEach(function (item) { walkImportJson(item, parts, depth + 1); });
            return;
        }
        const obj = value;
        const role = obj.role || obj.sender || obj.author?.role || obj.from || obj.type || '';
        const prefix = role ? '[' + String(role).slice(0, 16) + '] ' : '';
        if (typeof obj.text === 'string') appendImportText(parts, prefix + obj.text);
        if (typeof obj.content === 'string') appendImportText(parts, prefix + obj.content);
        if (Array.isArray(obj.parts)) {
            obj.parts.forEach(function (part) {
                if (typeof part === 'string') appendImportText(parts, prefix + part);
                else walkImportJson(part, parts, depth + 1);
            });
        }
        if (obj.content && typeof obj.content === 'object') walkImportJson(obj.content, parts, depth + 1);
        if (obj.message && typeof obj.message === 'object') walkImportJson(obj.message, parts, depth + 1);
        ['messages', 'chat_messages', 'mapping', 'conversations', 'items', 'children'].forEach(function (key) {
            if (obj[key]) walkImportJson(obj[key], parts, depth + 1);
        });
        Object.keys(obj).forEach(function (key) {
            if (/^(id|uuid|created|created_at|updated_at|timestamp|create_time|update_time|model|metadata)$/i.test(key)) return;
            if (/^(text|content|parts|message|messages|chat_messages|mapping|conversations|items|children|role|sender|author|from|type)$/i.test(key)) return;
            walkImportJson(obj[key], parts, depth + 1);
        });
    }

    function htmlToImportText(raw) {
        try {
            const doc = new DOMParser().parseFromString(raw, 'text/html');
            doc.querySelectorAll('script,style,svg,template,noscript,iframe').forEach(function (el) { el.remove(); });
            return trimImportText(doc.body ? doc.body.textContent : doc.documentElement.textContent);
        } catch (e) {
            return trimImportText(raw);
        }
    }

    function normalizeImportSourceText(raw) {
        const text = String(raw || '').trim();
        if (!text) return '';
        if (/^\s*(<!doctype html|<html|<body|<div)\b/i.test(text)) return htmlToImportText(text);
        try {
            const parsed = JSON.parse(text);
            const parts = [];
            walkImportJson(parsed, parts, 0);
            const structured = trimImportText(parts.join('\n'));
            if (structured.length >= 20) return structured;
        } catch (e) {}
        return trimImportText(text);
    }

    function readTextFile(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result || '')); };
            reader.onerror = function () { reject(reader.error || new Error('file_read_failed')); };
            reader.readAsText(file);
        });
    }

    function ensureMemoryImportModal() {
        let modal = document.getElementById('claudeMemoryImportModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'claudeMemoryImportModal';
        modal.className = 'memory-import-modal';
        modal.hidden = true;
        modal.innerHTML =
            '<div class="memory-import-backdrop" data-memory-import-close></div>' +
            '<div class="memory-import-dialog cancri-themed-scroll" role="dialog" aria-modal="true" aria-labelledby="memoryImportTitle">' +
            '<div class="memory-import-head">' +
            '<div><h2 id="memoryImportTitle">导入聊天记录</h2><p>粘贴至多 1000 字聊天内容，由 SenseNova 6.7 提炼后填入空槽位。</p></div>' +
            '<button class="memory-import-x" type="button" data-memory-import-close aria-label="关闭">×</button>' +
            '</div>' +
            '<label class="memory-import-field memory-import-text-field"><span>聊天记录</span><textarea id="memoryImportText" class="cancri-themed-scroll" rows="10" maxlength="1000" placeholder="粘贴 ChatGPT / Claude / 本站聊天片段，最多 1000 字。"></textarea></label>' +
            '<div class="memory-import-meta"><span id="memoryImportCount">0 / 1000</span></div>' +
            '<div class="memory-import-actions"><button class="claude-primary-btn" type="button" id="memoryImportSaveBtn">总结并填入</button></div>' +
            '<div id="memoryImportPreview" class="memory-import-preview" hidden></div>' +
            '</div>';
        document.body.appendChild(modal);

        function onMemoryImportClosePress(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation();
                }
            }
            closeMemoryImportModal();
        }
        modal.querySelectorAll('[data-memory-import-close]').forEach(function (el) {
            el.addEventListener('click', onMemoryImportClosePress, true);
            el.addEventListener('touchend', onMemoryImportClosePress, { capture: true, passive: false });
        });
        const textarea = modal.querySelector('#memoryImportText');
        const saveBtn = modal.querySelector('#memoryImportSaveBtn');
        const countEl = modal.querySelector('#memoryImportCount');
        if (textarea && countEl) {
            const syncCount = function () {
                const len = String(textarea.value || '').length;
                countEl.textContent = len + ' / 1000';
            };
            textarea.addEventListener('input', syncCount);
            syncCount();
        }
        if (saveBtn) saveBtn.addEventListener('click', saveSelectedImportedMemories);
        modal.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeMemoryImportModal();
        });
        return modal;
    }

    var closingMemoryImportModal = false;
    var MEMORY_IMPORT_CLOSE_MS = 150;

    function openMemoryImportModal() {
        const modal = ensureMemoryImportModal();
        closingMemoryImportModal = false;
        modal.classList.remove('is-closing');
        modal.hidden = false;
        requestAnimationFrame(function () {
            modal.classList.add('is-open');
        });
        const textarea = modal.querySelector('#memoryImportText');
        setTimeout(function () { if (textarea) textarea.focus(); }, 40);
    }

    function closeMemoryImportModal() {
        const modal = document.getElementById('claudeMemoryImportModal');
        if (!modal || modal.hidden) return;
        if (closingMemoryImportModal || modal.classList.contains('is-closing')) return;
        closingMemoryImportModal = true;
        modal.classList.remove('is-open');
        modal.classList.add('is-closing');
        window.setTimeout(function () {
            modal.classList.remove('is-closing');
            modal.hidden = true;
            closingMemoryImportModal = false;
        }, MEMORY_IMPORT_CLOSE_MS);
    }

    function renderMemoryImportCandidates(candidates) {
        const modal = ensureMemoryImportModal();
        const preview = modal.querySelector('#memoryImportPreview');
        const saveBtn = modal.querySelector('#memoryImportSaveBtn');
        memoryImportCandidates = Array.isArray(candidates) ? candidates.slice(0, 5) : [];
        if (!preview || !saveBtn) return;
        if (!memoryImportCandidates.length) {
            preview.innerHTML = '<p>没有提炼出适合长期保存的记忆。可以粘贴更多历史，或删掉无关页面内容后再试。</p>';
            saveBtn.disabled = true;
            return;
        }
        preview.innerHTML =
            '<div class="memory-import-preview-head">候选记忆（一行一条，最多 5 条，每条 100 字内）</div>' +
            memoryImportCandidates.map(function (item, index) {
            const content = String(item.content || '').replace(/\s+/g, ' ').trim().slice(0, 100);
            return '<label class="memory-import-candidate">' +
                '<input class="memory-import-check" type="checkbox" checked data-index="' + index + '">' +
                '<span class="memory-import-candidate-index" aria-hidden="true">' + (index + 1) + '</span>' +
                '<input class="memory-import-candidate-text" type="text" maxlength="100" value="' + escapeText(content) + '">' +
                '</label>';
        }).join('');
        saveBtn.disabled = false;
    }

    async function runMemoryImportPreview() {
        const modal = ensureMemoryImportModal();
        const textarea = modal.querySelector('#memoryImportText');
        const source = modal.querySelector('#memoryImportSource');
        const preview = modal.querySelector('#memoryImportPreview');
        const previewBtn = modal.querySelector('#memoryImportPreviewBtn');
        const saveBtn = modal.querySelector('#memoryImportSaveBtn');
        const api = cancriApp();
        if (!api || typeof api.previewImportedMemories !== 'function') {
            showToast('记忆导入模块未加载，请刷新页面后重试');
            return;
        }
        const text = normalizeImportSourceText(textarea ? textarea.value : '');
        if (textarea) textarea.value = text;
        if (text.length < 20) {
            showToast('导入内容太短，请粘贴更多历史文本');
            return;
        }
        if (preview) preview.innerHTML = '<p>正在解析长期偏好…</p>';
        if (previewBtn) previewBtn.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
        try {
            const candidates = await api.previewImportedMemories({
                text: text,
                source: source ? source.value : '其他 AI'
            });
            renderMemoryImportCandidates(candidates);
            showToast(candidates.length ? '已生成候选记忆，请确认后导入' : '未找到可导入的长期记忆');
        } catch (e) {
            if (preview) preview.innerHTML = '<p>解析失败，请稍后重试。</p>';
            showToast(e && e.message ? e.message : '解析导入记忆失败');
        } finally {
            if (previewBtn) previewBtn.disabled = false;
        }
    }

    async function saveSelectedImportedMemories() {
        const modal = ensureMemoryImportModal();
        const api = cancriApp();
        if (!api || typeof api.previewImportedMemories !== 'function' || typeof api.importUserMemories !== 'function') {
            showToast('记忆导入模块未加载，请刷新页面后重试');
            return;
        }
        const textarea = modal.querySelector('#memoryImportText');
        const preview = modal.querySelector('#memoryImportPreview');
        const saveBtn = modal.querySelector('#memoryImportSaveBtn');
        const text = normalizeImportSourceText(textarea ? textarea.value : '').slice(0, 1000);
        if (textarea) textarea.value = text;
        if (text.length < 20) {
            showToast('请粘贴至少 20 字的聊天记录');
            return;
        }
        if (preview) {
            preview.hidden = false;
            preview.innerHTML = '<p>正在用 SenseNova 6.7 总结记忆…</p>';
        }
        if (saveBtn) saveBtn.disabled = true;
        try {
            const candidates = await api.previewImportedMemories({ text: text, source: '聊天记录' });
            if (!candidates.length) {
                if (preview) preview.innerHTML = '<p>未能从这段聊天提炼出可保存的记忆。</p>';
                showToast('未提炼出可导入的记忆');
                return;
            }
            const result = await api.importUserMemories(candidates.map(function (item) { return item.content; }));
            const saved = Number(result && result.saved) || 0;
            showToast(saved > 0 ? '已填入 ' + saved + ' 条记忆' : '记忆槽已满或内容重复');
            if (saved > 0) closeMemoryImportModal();
        } catch (e) {
            if (preview) preview.innerHTML = '<p>总结失败，请稍后重试。</p>';
            showToast(e && e.message ? e.message : '导入记忆失败');
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    function runOnboardingAction(action) {
        if (action === 'import-memory') {
            openImportMemorySettings();
            setTimeout(openMemoryImportModal, 140);
        } else if (action === 'open-community') {
            window.open(COMMUNITY_URL, '_blank', 'noopener');
        } else if (action === 'open-cancri-code') {
            openCancriCodeDownload();
        }
    }

    function bindGettingStartedChecklist() {
        var card = document.getElementById('claudeOnboardingCard');
        if (!card) {
            maybeShowCodePromo();
            return;
        }
        if (isOnboardingDismissed()) {
            card.hidden = true;
            maybeShowCodePromo();
            return;
        }
        renderOnboardingState(card, readOnboardingCompleted());
        var close = document.getElementById('claudeOnboardingCloseBtn');
        if (close) {
            close.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                dismissOnboarding(card);
            });
        }
        card.querySelectorAll('[data-onboarding-id][data-onboarding-action]').forEach(function (task) {
            task.addEventListener('click', function (e) {
                e.preventDefault();
                var id = task.getAttribute('data-onboarding-id');
                var action = task.getAttribute('data-onboarding-action');
                completeOnboardingTask(id, card);
                runOnboardingAction(action);
            });
        });
    }

    function bindCodePromoCard() {
        var promo = document.getElementById('claudeCodePromoCard');
        if (!promo) return;
        var close = document.getElementById('claudeCodePromoCloseBtn');
        if (close) {
            close.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                dismissCodePromo(promo);
            });
        }
        var download = document.getElementById('claudeCodePromoDownloadBtn');
        if (download) {
            download.addEventListener('click', function (e) {
                e.preventDefault();
                openCancriCodeDownload();
            });
        }
        maybeShowCodePromo();
    }

    function bindExternalSidebarLinks() {
        var codeNav = document.getElementById('claudeCancriCodeNavBtn');
        if (codeNav) {
            codeNav.addEventListener('click', function () {
                showToast('百度网盘提取码：' + CANCRI_CODE_PAN_CODE);
            });
        }
        var statusNav = document.getElementById('claudeServiceStatusNavBtn');
        if (statusNav && !statusNav.getAttribute('href')) {
            statusNav.setAttribute('href', SERVICE_STATUS_URL);
        }
        var accountDownload = document.getElementById('accountDownloadBtn');
        if (accountDownload) {
            accountDownload.addEventListener('click', function () {
                showToast('百度网盘提取码：' + CANCRI_CODE_PAN_CODE);
            });
        }
    }

    function bindImportMemoryShortcut() {
        var btn = document.getElementById('claudeImportMemoryBtn');
        if (!btn) return;
        if (btn.dataset.memoryImportBound === '1') return;
        btn.dataset.memoryImportBound = '1';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            openMemoryImportModal();
        });
    }

    function bindImportMemoryDelegation() {
        if (document.documentElement.dataset.memoryImportDelegationBound === '1') return;
        document.documentElement.dataset.memoryImportDelegationBound = '1';
        document.addEventListener('click', function (e) {
            var target = e.target && e.target.closest ? e.target.closest('#claudeImportMemoryBtn') : null;
            if (!target) return;
            e.preventDefault();
            openMemoryImportModal();
        }, true);
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
                try { localStorage.removeItem('cancri_claude_active_project_id'); } catch (_) {}
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

    function bindChatsPageList() {
        const list = document.getElementById('claudeChatsList');
        const search = document.getElementById('claudeChatsSearchInput');
        if (!list) return;
        let renderToken = 0;

        function app() {
            return window.CancriApp || null;
        }
        function titleOf(chat) {
            return String(chat && (chat.title || chat.name) || '新对话').trim() || '新对话';
        }
        function timeOf(chat) {
            const raw = chat && (chat.updated_at || chat.created_at || chat.updatedAt || chat.createdAt);
            if (!raw) return '';
            const date = new Date(raw);
            if (!Number.isFinite(date.getTime())) return '';
            return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        }
        function showEmpty(text) {
            list.innerHTML = '';
            const empty = document.createElement('div');
            empty.className = 'claude-empty-hint';
            empty.textContent = text;
            list.appendChild(empty);
        }
        function renderRows(chats) {
            const q = (search ? search.value : '').trim().toLowerCase();
            const rows = (Array.isArray(chats) ? chats : [])
                .filter(function (chat) { return !q || titleOf(chat).toLowerCase().indexOf(q) !== -1; })
                .sort(function (a, b) {
                    return new Date(b.updated_at || b.created_at || 0).getTime()
                        - new Date(a.updated_at || a.created_at || 0).getTime();
                });
            list.innerHTML = '';
            if (!rows.length) {
                showEmpty(q ? '没有匹配的聊天记录' : '暂无聊天记录。点击右上角"新聊天"开始。');
                return;
            }
            rows.forEach(function (chat) {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'claude-chat-row';
                row.dataset.chatId = chat.id || '';
                const main = document.createElement('span');
                main.className = 'claude-chat-row-main';
                const title = document.createElement('span');
                title.className = 'claude-chat-row-title';
                title.textContent = titleOf(chat);
                const meta = document.createElement('span');
                meta.className = 'claude-chat-row-meta';
                meta.textContent = chat.model || '';
                main.appendChild(title);
                if (meta.textContent) main.appendChild(meta);
                const time = document.createElement('span');
                time.className = 'claude-chat-row-time';
                time.textContent = timeOf(chat);
                row.appendChild(main);
                row.appendChild(time);
                row.addEventListener('click', function () {
                    const api = app();
                    if (api && typeof api.loadChat === 'function' && chat.id) api.loadChat(chat.id);
                });
                list.appendChild(row);
            });
        }
        async function render() {
            const token = ++renderToken;
            showEmpty('正在加载聊天记录…');
            const api = app();
            let chats = [];
            try {
                if (api && typeof api.loadChatHistoryList === 'function') chats = await api.loadChatHistoryList();
                else if (api && typeof api.getChatHistoryList === 'function') chats = api.getChatHistoryList();
            } catch (_) {
                if (api && typeof api.getChatHistoryList === 'function') chats = api.getChatHistoryList();
            }
            if (token !== renderToken) return;
            renderRows(chats);
        }

        search?.addEventListener('input', render);
        window.addEventListener('cancri:chat-history-saved', render);
        window.addEventListener('cancri:viewchange', function (e) {
            if (e.detail && e.detail.view === 'claudeChats') render();
        });
        if (document.body.dataset.view === 'claudeChats') render();
    }

    function bindProjectsPage() {
        const PROJECTS_KEY = 'cancri_claude_projects_v1';
        const ACTIVE_PROJECT_KEY = 'cancri_claude_active_project_id';
        const PROJECT_COLORS = [
            { key: 'neutral', value: '#f4f4f5' },
            { key: 'red', value: '#ff6467' },
            { key: 'orange', value: '#ff914d' },
            { key: 'yellow', value: '#ffd84d' },
            { key: 'green', value: '#45d483' },
            { key: 'blue', value: '#3aa0ff' },
            { key: 'purple', value: '#a970ff' },
            { key: 'pink', value: '#ff86bd' },
        ];
        const PROJECT_ICONS = {
            folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z"/>',
            dollar: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.2c-.6-.7-1.7-1.1-3-1.1-1.8 0-3 .8-3 2s1.2 1.8 3 2 3 .8 3 2-1.2 2-3 2c-1.5 0-2.7-.5-3.4-1.4"/>',
            monitor: '<rect x="4" y="5" width="16" height="11" rx="1.8"/><path d="M8 20h8M12 16v4"/>',
            cap: '<path d="m3 9 9-5 9 5-9 5Z"/><path d="M7 11.5v4c2.8 2 7.2 2 10 0v-4"/>',
            pen: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z"/><path d="m14.5 6.5 3 3"/>',
            tag: '<path d="M20 13.5 13.5 20 4 10.5V4h6.5L20 13.5Z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
            braces: '<path d="M8 4c-2 1-2 3-2 5 0 1.5-.8 2.4-2 3 1.2.6 2 1.5 2 3 0 2 0 4 2 5"/><path d="M16 4c2 1 2 3 2 5 0 1.5.8 2.4 2 3-1.2.6-2 1.5-2 3 0 2 0 4-2 5"/>',
            terminal: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="m8 10 3 2-3 2M13 15h3"/>',
            music: '<path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
            trash: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/>',
            wand: '<path d="m4 20 12-12M14 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1ZM19 13l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6Z"/>',
            palette: '<path d="M12 4a8 8 0 0 0 0 16h1.2a1.8 1.8 0 0 0 1.3-3.1 1.8 1.8 0 0 1 1.3-3.1H18a3 3 0 0 0 3-3C21 7 17 4 12 4Z"/><circle cx="8" cy="10" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="14" cy="9" r="1"/>',
            stethoscope: '<path d="M6 4v5a4 4 0 0 0 8 0V4"/><path d="M14 9a5 5 0 0 0 5 5v1a4 4 0 0 1-8 0v-1"/><circle cx="19" cy="14" r="1.5"/>',
            spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
            leaf: '<path d="M20 4c-9 0-14 4-14 10a6 6 0 0 0 10 4c3-3 4-8 4-14Z"/><path d="M6 20c2-5 6-8 11-10"/>',
            briefcase: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>',
            chart: '<path d="M4 19V5M9 19v-8M14 19V8M19 19v-5"/>',
            bot: '<rect x="6" y="7" width="12" height="10" rx="3"/><path d="M12 7V4M8.5 12h.01M15.5 12h.01M10 17l-1.5 3M14 17l1.5 3"/>',
            dumbbell: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
            notebook: '<path d="M7 4h11v16H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"/><path d="M8 4v16M11 8h4M11 12h4"/>',
            scale: '<path d="M12 4v16M5 7h14M7 7l-3 6h6ZM17 7l-3 6h6ZM8 20h8"/>',
            globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/>',
            mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 18v4"/><path d="M8 22h8"/>',
            arrowUp: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
            wrench: '<path d="M14 6a5 5 0 0 0 6 6L10 22l-4-4 10-10a5 5 0 0 0-2-2Z"/>',
            paw: '<circle cx="7" cy="9" r="1.5"/><circle cx="12" cy="6.5" r="1.5"/><circle cx="17" cy="9" r="1.5"/><path d="M7.5 17c1.2-3.2 7.8-3.2 9 0 .6 1.7-.6 3-2.4 2.5A7 7 0 0 0 12 19a7 7 0 0 0-2.1.5c-1.8.5-3-1-2.4-2.5Z"/>',
            flask: '<path d="M9 3h6M10 3v5l-5 9a3 3 0 0 0 2.6 4h8.8A3 3 0 0 0 19 17l-5-9V3"/><path d="M8 15h8"/>',
            brain: '<path d="M9 5a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 4 4V5ZM15 5a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-4 4V5Z"/><path d="M9 9H7M15 9h2M9 14H7M15 14h2"/>',
            heart: '<path d="M20 8.5c0 5-8 10.5-8 10.5S4 13.5 4 8.5A4.2 4.2 0 0 1 12 6a4.2 4.2 0 0 1 8 2.5Z"/>',
            gift: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M4 13h16M12 9v11M12 9H8.5A2.5 2.5 0 1 1 12 5.5ZM12 9h3.5A2.5 2.5 0 1 0 12 5.5Z"/>',
        };
        const page = document.getElementById('claudeProjectsView');
        const empty = page ? page.querySelector('.claude-projects-empty') : null;
        const search = document.getElementById('claudeProjectsSearchInput');
        const nameInput = document.getElementById('projectNameInput');
        const confirmBtn = document.getElementById('createProjectConfirmBtn');
        if (!page) return;

        let selectedIcon = 'folder';
        let selectedColor = 'neutral';
        let detailProjectId = '';
        let detailTab = 'chats';

        let list = document.getElementById('claudeProjectsList');
        if (!list) {
            list = document.createElement('div');
            list.id = 'claudeProjectsList';
            list.className = 'claude-projects-list';
            if (empty && empty.parentNode) empty.parentNode.insertBefore(list, empty);
        }

        function app() {
            return window.CancriApp || null;
        }
        function iconSvg(key) {
            const paths = PROJECT_ICONS[key] || PROJECT_ICONS.folder;
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
        }
        function colorValue(key) {
            const found = PROJECT_COLORS.find(function (item) { return item.key === key; });
            return found ? found.value : PROJECT_COLORS[0].value;
        }
        function setView(view) {
            const api = app();
            if (api && typeof api.setActiveView === 'function') {
                api.setActiveView(view);
                return;
            }
            document.body.dataset.view = view;
            document.querySelectorAll('.main > .view').forEach(function (v) {
                v.classList.toggle('active', v.id === view + 'View');
            });
            window.dispatchEvent(new CustomEvent('cancri:viewchange', { detail: { view: view } }));
        }
        function normalizeProject(project) {
            const p = project && typeof project === 'object' ? project : {};
            return {
                id: p.id || '',
                name: String(p.name || '未命名项目').trim() || '未命名项目',
                icon: p.icon && PROJECT_ICONS[p.icon] ? p.icon : 'folder',
                color: p.color || 'neutral',
                createdAt: p.createdAt || new Date().toISOString(),
                updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
                chatIds: Array.isArray(p.chatIds) ? p.chatIds : [],
                sources: Array.isArray(p.sources) ? p.sources : [],
            };
        }
        function readProjects() {
            try {
                const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
                return Array.isArray(parsed) ? parsed.map(normalizeProject).filter(function (p) { return p.id; }) : [];
            } catch (_) {
                return [];
            }
        }
        function writeProjects(projects) {
            localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
            renderProjects();
            renderSidebarProjects();
            renderProjectDetail();
        }
        function activeProjectId() {
            try { return localStorage.getItem(ACTIVE_PROJECT_KEY) || ''; } catch (_) { return ''; }
        }
        function setActiveProject(id) {
            try {
                if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id);
                else localStorage.removeItem(ACTIVE_PROJECT_KEY);
            } catch (_) {}
            renderSidebarProjects();
        }
        function chatTitle(chat) {
            return String(chat && chat.title || '新对话').trim() || '新对话';
        }
        function chatDate(chat) {
            const raw = chat && (chat.updatedAt || chat.createdAt || chat.timestamp);
            const d = raw ? new Date(raw) : null;
            if (!d || Number.isNaN(d.getTime())) return '';
            return String(d.getMonth() + 1) + '月' + String(d.getDate()) + '日';
        }
        function enhanceProjectModal() {
            if (!nameInput || nameInput.dataset.claudeProjectEnhanced === 'true') return;
            nameInput.dataset.claudeProjectEnhanced = 'true';
            const modal = document.getElementById('projectModal');
            if (modal && !modal.querySelector('.claude-project-modal-card')) {
                const header = Array.prototype.find.call(modal.children, function (el) {
                    return el.classList && el.classList.contains('modal-header');
                });
                const body = Array.prototype.find.call(modal.children, function (el) {
                    return el.classList && el.classList.contains('modal-body');
                });
                if (header && body) {
                    const card = document.createElement('div');
                    card.className = 'claude-project-modal-card';
                    modal.insertBefore(card, header);
                    card.appendChild(header);
                    card.appendChild(body);
                }
            }
            const formGroup = nameInput.closest('.form-group') || nameInput.parentElement;
            const wrap = document.createElement('div');
            wrap.className = 'claude-project-name-wrap';
            const iconBtn = document.createElement('button');
            iconBtn.type = 'button';
            iconBtn.id = 'projectIconPickerBtn';
            iconBtn.className = 'claude-project-icon-trigger';
            iconBtn.setAttribute('aria-label', '选择项目图标和颜色');
            nameInput.parentNode.insertBefore(wrap, nameInput);
            wrap.appendChild(iconBtn);
            wrap.appendChild(nameInput);
            const picker = document.createElement('div');
            picker.className = 'claude-project-picker';
            picker.id = 'projectIconColorPicker';
            picker.hidden = true;
            formGroup.appendChild(picker);
            function renderTrigger() {
                iconBtn.style.setProperty('--project-color', colorValue(selectedColor));
                iconBtn.innerHTML = iconSvg(selectedIcon);
            }
            function renderPicker() {
                picker.innerHTML =
                    '<div class="claude-project-color-row">' +
                    PROJECT_COLORS.map(function (color) {
                        return '<button type="button" class="claude-project-color-dot' + (color.key === selectedColor ? ' active' : '') + '" data-color="' + color.key + '" style="--project-color:' + color.value + '" aria-label="选择颜色"></button>';
                    }).join('') +
                    '</div><div class="claude-project-icon-grid">' +
                    Object.keys(PROJECT_ICONS).map(function (key) {
                        return '<button type="button" class="claude-project-icon-choice' + (key === selectedIcon ? ' active' : '') + '" data-icon="' + key + '" aria-label="选择图标">' + iconSvg(key) + '</button>';
                    }).join('') +
                    '</div><button type="button" class="claude-project-picker-done">完成</button>';
            }
            function syncConfirm() {
                const hasName = Boolean(nameInput.value.trim());
                if (confirmBtn) {
                    confirmBtn.disabled = !hasName;
                    confirmBtn.classList.toggle('claude-project-create-ready', hasName);
                }
            }
            function showPicker() {
                renderPicker();
                picker.hidden = false;
            }
            function hidePicker() {
                picker.hidden = true;
            }
            iconBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (picker.hidden) showPicker();
                else hidePicker();
            });
            document.getElementById('projectSettingToastBtn')?.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (picker.hidden) showPicker();
                else hidePicker();
            }, true);
            picker.addEventListener('click', function (e) {
                const colorBtn = e.target.closest('[data-color]');
                const iconChoice = e.target.closest('[data-icon]');
                if (colorBtn) selectedColor = colorBtn.getAttribute('data-color') || selectedColor;
                if (iconChoice) selectedIcon = iconChoice.getAttribute('data-icon') || selectedIcon;
                if (e.target.closest('.claude-project-picker-done')) hidePicker();
                renderTrigger();
                renderPicker();
            });
            nameInput.addEventListener('input', syncConfirm);
            nameInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && nameInput.value.trim()) {
                    e.preventDefault();
                    confirmBtn?.click();
                }
            });
            document.addEventListener('pointerdown', function (e) {
                if (picker.hidden) return;
                if (picker.contains(e.target) || iconBtn.contains(e.target)) return;
                hidePicker();
            }, true);
            renderTrigger();
            syncConfirm();
        }
        function openProjectModal() {
            enhanceProjectModal();
            const api = app();
            if (api && typeof api.openModal === 'function') {
                api.openModal('projectModal');
            } else {
                const modal = document.getElementById('projectModal');
                const scrim = document.getElementById('scrim');
                if (modal) {
                    modal.classList.add('open');
                    modal.setAttribute('aria-hidden', 'false');
                }
                if (scrim) scrim.classList.add('show');
            }
            if (nameInput) {
                nameInput.value = '';
                selectedIcon = 'folder';
                selectedColor = 'neutral';
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    confirmBtn.classList.remove('claude-project-create-ready');
                }
                const trigger = document.getElementById('projectIconPickerBtn');
                if (trigger) {
                    trigger.style.setProperty('--project-color', colorValue(selectedColor));
                    trigger.innerHTML = iconSvg(selectedIcon);
                }
                const picker = document.getElementById('projectIconColorPicker');
                if (picker) picker.hidden = true;
                requestAnimationFrame(function () { nameInput.focus(); });
            }
        }
        function closeProjectModal() {
            const api = app();
            if (api && typeof api.closeModal === 'function') {
                api.closeModal();
            } else {
                const modal = document.getElementById('projectModal');
                const scrim = document.getElementById('scrim');
                if (modal) {
                    modal.classList.remove('open');
                    modal.setAttribute('aria-hidden', 'true');
                }
                if (scrim) scrim.classList.remove('show');
            }
        }
        // 项目页 composer 辅助函数（同步首页输入框体验）
        function getProjectComposerResizeMaxHeight() {
            if (window.matchMedia('(max-width: 640px)').matches) {
                return Math.min(176, Math.max(120, Math.floor(window.innerHeight * 0.28)));
            }
            return 220;
        }
        function autoResizeProjectInput() {
            const input = document.getElementById('claudeProjectPromptInput');
            if (!input) return;
            const composer = input.closest('[data-workbench-composer], .composer');
            const minHeight = window.matchMedia('(max-width: 640px)').matches ? 44 : 36;
            const maxHeight = getProjectComposerResizeMaxHeight();
            input.style.height = '0px';
            const next = Math.max(minHeight, Math.min(input.scrollHeight, maxHeight));
            input.style.height = next + 'px';
            input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
            if (composer) {
                composer.classList.toggle('is-multiline', next > minHeight + 12 || input.value.includes('\n'));
            }
        }
        function updateProjectSendButton() {
            const input = document.getElementById('claudeProjectPromptInput');
            const btn = document.getElementById('claudeProjectPromptSubmit');
            if (!btn || !input) return;
            const hasContent = Boolean(input.value.trim());
            btn.disabled = !hasContent;
            btn.classList.toggle('hidden', !hasContent);
        }
        var projectVoiceListening = false;
        var projectVoiceRecognition = null;
        var projectVoiceBaseText = '';
        function updateProjectVoiceButtonState() {
            const btn = document.getElementById('claudeProjectVoiceBtn');
            if (!btn) return;
            btn.classList.toggle('listening', projectVoiceListening);
            btn.setAttribute('aria-pressed', String(projectVoiceListening));
            btn.title = projectVoiceListening ? '停止语音输入' : '语音输入';
        }
        function ensureProjectVoiceRecognition() {
            const Ctor = (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
            if (!Ctor) return null;
            if (projectVoiceRecognition) return projectVoiceRecognition;
            projectVoiceRecognition = new Ctor();
            projectVoiceRecognition.lang = 'zh-CN';
            projectVoiceRecognition.continuous = false;
            projectVoiceRecognition.interimResults = true;
            projectVoiceRecognition.maxAlternatives = 1;
            projectVoiceRecognition.onstart = function () {
                projectVoiceListening = true;
                projectVoiceBaseText = document.getElementById('claudeProjectPromptInput')?.value || '';
                updateProjectVoiceButtonState();
                if (window.CancriApp && typeof window.CancriApp.showToast === 'function') window.CancriApp.showToast('开始语音输入');
            };
            projectVoiceRecognition.onresult = function (event) {
                const transcript = Array.from(event.results).map(function (r) { return String(r[0]?.transcript || ''); }).join('').trim();
                const input = document.getElementById('claudeProjectPromptInput');
                if (!input) return;
                const nextText = (projectVoiceBaseText + (projectVoiceBaseText && transcript ? ' ' : '') + transcript).trim();
                if (nextText) {
                    input.value = nextText;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            };
            projectVoiceRecognition.onend = function () {
                projectVoiceListening = false;
                updateProjectVoiceButtonState();
            };
            projectVoiceRecognition.onerror = function (event) {
                projectVoiceListening = false;
                updateProjectVoiceButtonState();
                if (event.error !== 'aborted' && window.CancriApp && typeof window.CancriApp.showToast === 'function') {
                    window.CancriApp.showToast('语音输入失败：' + event.error);
                }
            };
            return projectVoiceRecognition;
        }
        function toggleProjectVoiceInput() {
            const Ctor = (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
            if (!Ctor) {
                if (window.CancriApp && typeof window.CancriApp.showToast === 'function') window.CancriApp.showToast('当前浏览器不支持语音输入');
                return;
            }
            const recognition = ensureProjectVoiceRecognition();
            if (!recognition) return;
            if (projectVoiceListening) {
                recognition.stop();
                return;
            }
            try { recognition.start(); } catch (e) {
                if (window.CancriApp && typeof window.CancriApp.showToast === 'function') window.CancriApp.showToast('语音输入已在运行');
            }
        }

        const PROJECT_COMPOSER_V = 'home-sync-2026-06';
        const PROJECT_PLUS_SVG =
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';
        const PROJECT_VOICE_SVG =
            '<svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" class="voice-wave-svg" aria-hidden="true">' +
            '<rect class="voice-bar" x="0" y="7.5" width="1" height="6" rx="0.5" fill="currentColor"></rect>' +
            '<rect class="voice-bar" x="4" y="5.5" width="1" height="10" rx="0.5" fill="currentColor"></rect>' +
            '<rect class="voice-bar" x="8" y="2.5" width="1" height="16" rx="0.5" fill="currentColor"></rect>' +
            '<rect class="voice-bar" x="12" y="5.5" width="1" height="10" rx="0.5" fill="currentColor"></rect>' +
            '<rect class="voice-bar" x="16" y="2.5" width="1" height="16" rx="0.5" fill="currentColor"></rect>' +
            '<rect class="voice-bar" x="20" y="7.5" width="1" height="6" rx="0.5" fill="currentColor"></rect>' +
            '</svg>';
        const PROJECT_SEND_SVG =
            '<svg class="send-icon-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"></path></svg>';

        function ensureDetailView() {
            let view = document.getElementById('claudeProjectDetailView');
            if (view && view.dataset.composerV !== PROJECT_COMPOSER_V) {
                view.remove();
                view = null;
            }
            if (view) return view;
            view = document.createElement('section');
            view.className = 'view';
            view.id = 'claudeProjectDetailView';
            view.dataset.composerV = PROJECT_COMPOSER_V;
            view.innerHTML =
                '<div class="claude-project-detail-page">' +
                    '<div class="claude-project-detail-shell">' +
                        '<header class="claude-project-detail-header">' +
                            '<div class="claude-project-detail-icon" id="claudeProjectDetailIcon"></div>' +
                            '<h1 id="claudeProjectDetailTitle"></h1>' +
                        '</header>' +
                        '<div class="composer-wrap claude-project-composer-wrap">' +
                            '<div class="composer claude-project-composer" data-workbench-composer>' +
                                '<textarea class="composer-input" id="claudeProjectPromptInput" rows="1" placeholder="向这个项目中的聊天提问"></textarea>' +
                                '<div class="composer-bottom">' +
                                    '<div class="composer-status" aria-live="polite"></div>' +
                                    '<div class="composer-tools-row">' +
                                        '<div class="composer-tools" aria-label="项目工具">' +
                                            '<button type="button" class="composer-tool-btn" id="claudeProjectSourceAddBtn" data-glass="button" aria-label="添加项目来源" title="添加附件">' + PROJECT_PLUS_SVG + '</button>' +
                                            '<button type="button" class="composer-tool-btn claude-project-web-search" id="claudeProjectWebSearchBtn" data-glass="button" aria-label="本轮允许联网搜索" title="本轮联网搜索">' + iconSvg('globe') + '</button>' +
                                            '<button type="button" class="composer-tool-btn claude-project-source-shortcut" id="claudeProjectSourcesShortcut">来源</button>' +
                                        '</div>' +
                                        '<div class="composer-actions claude-project-composer-actions">' +
                                            '<button type="button" class="voice-btn" id="claudeProjectVoiceBtn" data-glass="button" aria-label="语音输入" title="语音输入">' + PROJECT_VOICE_SVG + '</button>' +
                                            '<button type="button" class="send-btn hidden" id="claudeProjectPromptSubmit" data-glass="button" aria-label="发送项目消息" disabled>' + PROJECT_SEND_SVG + '</button>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="claude-project-tabs">' +
                            '<button type="button" class="active" data-project-tab="chats">聊天</button>' +
                            '<button type="button" data-project-tab="sources">来源</button>' +
                        '</div>' +
                        '<div class="claude-project-detail-list" id="claudeProjectDetailList"></div>' +
                    '</div>' +
                '</div>';
            const main = document.querySelector('.main');
            if (main) main.appendChild(view);
            const input = view.querySelector('#claudeProjectPromptInput');
            const sourceInput = document.createElement('input');
            sourceInput.type = 'file';
            sourceInput.id = 'claudeProjectSourceFileInput';
            sourceInput.multiple = true;
            sourceInput.hidden = true;
            view.appendChild(sourceInput);
            view.querySelector('#claudeProjectSourceAddBtn')?.addEventListener('click', function () {
                document.getElementById('claudeProjectSourceFileInput')?.click();
            });
            view.querySelector('#claudeProjectWebSearchBtn')?.addEventListener('click', function () {
                const api = app();
                const next = !(api && api.state && api.state.webSearchEnabled);
                if (api && typeof api.setWebSearchEnabled === 'function') api.setWebSearchEnabled(next);
                this.classList.toggle('is-active', next);
                this.setAttribute('aria-pressed', String(next));
            });
            view.querySelector('#claudeProjectSourcesShortcut')?.addEventListener('click', function () {
                detailTab = 'sources';
                renderProjectDetail();
            });
            view.querySelector('#claudeProjectPromptSubmit')?.addEventListener('click', function () {
                const value = input ? input.value.trim() : '';
                if (detailProjectId && value) beginProjectChat(detailProjectId, value, true);
            });
            input?.addEventListener('input', function () {
                autoResizeProjectInput();
                updateProjectSendButton();
            });
            input?.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    const value = input.value.trim();
                    if (value && detailProjectId) {
                        e.preventDefault();
                        beginProjectChat(detailProjectId, value, true);
                    }
                }
            });
            view.querySelector('#claudeProjectVoiceBtn')?.addEventListener('click', function () {
                toggleProjectVoiceInput();
            });
            view.querySelectorAll('[data-project-tab]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    detailTab = btn.getAttribute('data-project-tab') || 'chats';
                    renderProjectDetail();
                });
            });
            sourceInput.addEventListener('change', function () {
                if (!detailProjectId || !sourceInput.files || !sourceInput.files.length) return;
                addProjectSources(detailProjectId, Array.from(sourceInput.files));
                sourceInput.value = '';
            });
            bindProjectSourceDrop(view);
            return view;
        }
        function ensureSidebarProjectsList() {
            let section = document.getElementById('claudeSidebarProjectsSection');
            if (section) {
                section.hidden = true;
                return null;
            }
            // 2026-05-31：侧边栏项目列表暂时隐藏，待完善后再显示
            return null;
        }
        function touchProject(projects, id) {
            const p = projects.find(function (item) { return item.id === id; });
            if (p) p.updatedAt = new Date().toISOString();
            return projects;
        }
        function createProject(name) {
            const now = new Date().toISOString();
            const project = {
                id: 'project_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
                name: name,
                icon: selectedIcon,
                color: selectedColor,
                createdAt: now,
                updatedAt: now,
                chatIds: [],
                sources: [],
            };
            writeProjects([project].concat(readProjects()));
            return project;
        }
        function formatBytes(size) {
            const n = Number(size) || 0;
            if (n < 1024) return n + ' B';
            if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
            return (n / 1024 / 1024).toFixed(1) + ' MB';
        }
        function readProjectSourceText(file) {
            return new Promise(function (resolve) {
                const reader = new FileReader();
                reader.onload = function () { resolve(String(reader.result || '')); };
                reader.onerror = function () { resolve(''); };
                reader.readAsText(file);
            });
        }
        async function reserveProjectSourceUsage(files) {
            const api = app();
            if (!api || typeof api.reserveFileUploadUsage !== 'function') return true;
            return await api.reserveFileUploadUsage(files.length);
        }
        async function addProjectSources(projectId, files) {
            const projects = readProjects();
            const project = projects.find(function (p) { return p.id === projectId; });
            if (!project) return;
            const fileList = Array.from(files || []).filter(Boolean);
            if (!fileList.length) return;
            const allowed = await reserveProjectSourceUsage(fileList);
            if (!allowed) return;
            project.sources = Array.isArray(project.sources) ? project.sources : [];
            for (const file of fileList) {
                const rawText = await readProjectSourceText(file);
                const text = rawText.replace(/\u0000/g, '').trim();
                project.sources.unshift({
                    id: 'source_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
                    name: file.name,
                    type: file.type || 'application/octet-stream',
                    size: file.size || 0,
                    content: text.slice(0, 32000),
                    truncated: text.length > 32000,
                    updatedAt: new Date().toISOString(),
                    status: text ? 'indexed' : 'metadata_only',
                });
            }
            project.updatedAt = new Date().toISOString();
            writeProjects(projects);
            detailTab = 'sources';
            renderProjectDetail();
            const api = app();
            if (api && typeof api.showToast === 'function') api.showToast('来源已添加，AI 会在项目聊天中读取可解析文本。');
        }
        function bindProjectSourceDrop(view) {
            const composer = view.querySelector('.claude-project-composer');
            if (!composer) return;
            let depth = 0;
            function hasFiles(e) {
                return Array.prototype.slice.call(e.dataTransfer?.types || []).indexOf('Files') !== -1;
            }
            function setActive(active) {
                composer.classList.toggle('is-drag-over', Boolean(active));
            }
            composer.addEventListener('dragenter', function (e) {
                if (!hasFiles(e)) return;
                e.preventDefault();
                depth += 1;
                setActive(true);
            });
            composer.addEventListener('dragover', function (e) {
                if (!hasFiles(e)) return;
                e.preventDefault();
                setActive(true);
            });
            composer.addEventListener('dragleave', function (e) {
                if (!hasFiles(e)) return;
                depth = Math.max(0, depth - 1);
                if (!depth) setActive(false);
            });
            composer.addEventListener('drop', function (e) {
                if (!hasFiles(e)) return;
                e.preventDefault();
                depth = 0;
                setActive(false);
                if (detailProjectId) addProjectSources(detailProjectId, Array.from(e.dataTransfer.files || []));
            });
        }
        function removeProjectSource(projectId, sourceId) {
            const projects = readProjects();
            const project = projects.find(function (p) { return p.id === projectId; });
            if (!project) return;
            project.sources = (project.sources || []).filter(function (source) { return source.id !== sourceId; });
            project.updatedAt = new Date().toISOString();
            writeProjects(projects);
            renderProjectDetail();
        }
        function beginProjectChat(projectId, prompt, autoSend) {
            setActiveProject(projectId);
            detailProjectId = projectId;
            writeProjects(touchProject(readProjects(), projectId));
            const api = app();
            setView('home');
            if (api && typeof api.newChat === 'function') api.newChat();
            const input = document.getElementById('homeInput');
            if (input) {
                requestAnimationFrame(function () {
                    input.value = prompt || '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.focus();
                    if (autoSend && prompt) {
                        document.getElementById('sendChatBtn')?.click();
                    }
                });
            }
            // 清空项目页输入框状态
            const projectInput = document.getElementById('claudeProjectPromptInput');
            if (projectInput) {
                projectInput.value = '';
                projectInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        function loadProjectChat(projectId, chatId) {
            setActiveProject(projectId);
            const api = app();
            if (api && typeof api.loadChat === 'function') api.loadChat(chatId);
        }
        function openProject(projectId) {
            const project = readProjects().find(function (p) { return p.id === projectId; });
            if (!project) return;
            detailProjectId = projectId;
            detailTab = 'chats';
            setActiveProject(projectId);
            writeProjects(touchProject(readProjects(), projectId));
            ensureDetailView();
            setView('claudeProjectDetail');
            requestAnimationFrame(relocateModelSelector);
            renderProjectDetail();
            renderSidebarProjects();
        }
        function attachSavedChat(chatId) {
            const id = activeProjectId();
            if (!id || !chatId) return;
            const projects = readProjects();
            const project = projects.find(function (p) { return p.id === id; });
            if (!project) return;
            project.chatIds = Array.isArray(project.chatIds) ? project.chatIds : [];
            if (project.chatIds.indexOf(chatId) === -1) project.chatIds.unshift(chatId);
            project.updatedAt = new Date().toISOString();
            writeProjects(projects);
        }
        function renderSidebarProjects() {
            // 2026-05-31：侧边栏项目列表暂时隐藏，待完善后再显示
            const section = document.getElementById('claudeSidebarProjectsSection');
            if (section) section.hidden = true;
        }
        function renderProjectDetail() {
            const view = ensureDetailView();
            if (!view || !detailProjectId) return;
            const project = readProjects().find(function (p) { return p.id === detailProjectId; });
            if (!project) return;
            const icon = document.getElementById('claudeProjectDetailIcon');
            const title = document.getElementById('claudeProjectDetailTitle');
            const detailList = document.getElementById('claudeProjectDetailList');
            const input = document.getElementById('claudeProjectPromptInput');
            if (icon) {
                icon.style.setProperty('--project-color', colorValue(project.color));
                icon.innerHTML = iconSvg(project.icon);
            }
            if (title) title.textContent = project.name;
            if (input) {
                input.placeholder = '向“' + project.name + '”中的聊天提问';
                requestAnimationFrame(function () {
                    autoResizeProjectInput();
                    updateProjectSendButton();
                });
            }
            requestAnimationFrame(relocateModelSelector);
            view.querySelectorAll('[data-project-tab]').forEach(function (btn) {
                btn.classList.toggle('active', btn.getAttribute('data-project-tab') === detailTab);
            });
            if (!detailList) return;
            detailList.innerHTML = '';
            if (detailTab === 'sources') {
                const panel = document.createElement('div');
                panel.className = 'claude-project-sources-panel';
                const upload = document.createElement('button');
                upload.type = 'button';
                upload.className = 'claude-project-source-upload';
                upload.innerHTML = '<span>' + iconSvg('folder') + '</span><strong>上传来源</strong><small>文件会作为项目知识源索引，AI 按需读取，不随每条消息重复发送全文。</small>';
                upload.addEventListener('click', function () {
                    document.getElementById('claudeProjectSourceFileInput')?.click();
                });
                panel.appendChild(upload);
                const sources = Array.isArray(project.sources) ? project.sources : [];
                if (!sources.length) {
                    const emptySources = document.createElement('div');
                    emptySources.className = 'claude-project-detail-empty';
                    emptySources.textContent = '还没有添加来源。';
                    panel.appendChild(emptySources);
                } else {
                    const sourceList = document.createElement('div');
                    sourceList.className = 'claude-project-source-list';
                    sources.forEach(function (source) {
                        const row = document.createElement('div');
                        row.className = 'claude-project-source-row';
                        const sourceIcon = document.createElement('span');
                        sourceIcon.className = 'claude-project-source-icon';
                        sourceIcon.innerHTML = iconSvg('notebook');
                        const copy = document.createElement('div');
                        copy.className = 'claude-project-source-copy';
                        const name = document.createElement('strong');
                        name.textContent = source.name || '未命名来源';
                        const meta = document.createElement('small');
                        meta.textContent = formatBytes(source.size) + (source.content ? ' · 已读取文本' : ' · 仅保存元数据');
                        copy.appendChild(name);
                        copy.appendChild(meta);
                        const remove = document.createElement('button');
                        remove.type = 'button';
                        remove.textContent = '移除';
                        remove.addEventListener('click', function () { removeProjectSource(project.id, source.id); });
                        row.appendChild(sourceIcon);
                        row.appendChild(copy);
                        row.appendChild(remove);
                        sourceList.appendChild(row);
                    });
                    panel.appendChild(sourceList);
                }
                detailList.appendChild(panel);
                return;
            }
            const api = app();
            const chats = api && typeof api.getChatHistoryList === 'function' ? api.getChatHistoryList() : [];
            const chatById = new Map((Array.isArray(chats) ? chats : []).map(function (chat) { return [chat.id, chat]; }));
            const ids = Array.isArray(project.chatIds) ? project.chatIds : [];
            if (!ids.length) {
                const emptyChats = document.createElement('div');
                emptyChats.className = 'claude-project-detail-empty';
                emptyChats.textContent = '还没有项目聊天。';
                detailList.appendChild(emptyChats);
                return;
            }
            ids.forEach(function (chatId) {
                const chat = chatById.get(chatId);
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'claude-project-detail-row';
                const name = document.createElement('span');
                name.textContent = chatTitle(chat);
                const time = document.createElement('time');
                time.textContent = chatDate(chat);
                row.appendChild(name);
                row.appendChild(time);
                row.addEventListener('click', function () { loadProjectChat(project.id, chatId); });
                detailList.appendChild(row);
            });
        }
        function renderProjects() {
            const q = (search ? search.value : '').trim().toLowerCase();
            const projects = readProjects()
                .filter(function (project) { return !q || project.name.toLowerCase().indexOf(q) !== -1; })
                .sort(function (a, b) { return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0); });
            const api = app();
            const chats = api && typeof api.getChatHistoryList === 'function' ? api.getChatHistoryList() : [];
            const chatById = new Map((Array.isArray(chats) ? chats : []).map(function (chat) { return [chat.id, chat]; }));
            list.innerHTML = '';
            if (empty) empty.hidden = projects.length > 0 || Boolean(q);
            if (!projects.length) {
                if (q) {
                    const noMatch = document.createElement('div');
                    noMatch.className = 'claude-empty-hint';
                    noMatch.textContent = '没有匹配的项目';
                    list.appendChild(noMatch);
                }
                return;
            }
            projects.forEach(function (project) {
                const card = document.createElement('article');
                card.className = 'claude-project-card';
                card.tabIndex = 0;
                card.style.setProperty('--project-color', colorValue(project.color));
                const head = document.createElement('div');
                head.className = 'claude-project-card-head';
                const projectIcon = document.createElement('div');
                projectIcon.className = 'claude-project-card-icon';
                projectIcon.innerHTML = iconSvg(project.icon);
                const titleWrap = document.createElement('div');
                titleWrap.className = 'claude-project-card-copy';
                const title = document.createElement('h2');
                title.className = 'claude-project-card-title';
                title.textContent = project.name;
                const meta = document.createElement('div');
                meta.className = 'claude-project-card-meta';
                const count = Array.isArray(project.chatIds) ? project.chatIds.length : 0;
                meta.textContent = count ? count + ' 个项目对话' : '还没有项目对话';
                titleWrap.appendChild(title);
                titleWrap.appendChild(meta);
                const newBtn = document.createElement('button');
                newBtn.type = 'button';
                newBtn.className = 'claude-secondary-btn claude-project-new-chat';
                newBtn.textContent = '+ 新聊天';
                newBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    beginProjectChat(project.id, '', false);
                });
                head.appendChild(projectIcon);
                head.appendChild(titleWrap);
                head.appendChild(newBtn);
                card.appendChild(head);
                const chatList = document.createElement('div');
                chatList.className = 'claude-project-chat-list';
                (project.chatIds || []).slice(0, 4).forEach(function (chatId) {
                    const chat = chatById.get(chatId);
                    const row = document.createElement('button');
                    row.type = 'button';
                    row.className = 'claude-project-chat-row';
                    row.textContent = chatTitle(chat);
                    row.addEventListener('click', function (e) {
                        e.stopPropagation();
                        loadProjectChat(project.id, chatId);
                    });
                    chatList.appendChild(row);
                });
                if (chatList.childNodes.length) card.appendChild(chatList);
                card.addEventListener('click', function () { openProject(project.id); });
                card.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openProject(project.id);
                    }
                });
                list.appendChild(card);
            });
        }

        ['claudeNewProjectBtn', 'claudeProjectsEmptyNewBtn'].forEach(function (id) {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopImmediatePropagation();
                openProjectModal();
            }, true);
        });
        confirmBtn?.addEventListener('click', function (e) {
            const name = (nameInput ? nameInput.value : '').trim();
            if (!name) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            const project = createProject(name);
            closeProjectModal();
            openProject(project.id);
        }, true);
        document.getElementById('newChatBtn')?.addEventListener('click', function () {
            setActiveProject('');
            renderSidebarProjects();
        }, true);
        search?.addEventListener('input', renderProjects);
        window.addEventListener('cancri:viewchange', function (e) {
            if (e.detail && e.detail.view === 'claudeProjects') renderProjects();
            renderSidebarProjects();
            if (e.detail && e.detail.view === 'claudeProjectDetail') renderProjectDetail();
            requestAnimationFrame(relocateModelSelector);
        });
        window.addEventListener('cancri:chat-history-saved', function (e) {
            const chatId = e.detail && e.detail.chatId;
            attachSavedChat(chatId);
        });
        window.addEventListener('cancri:restore-session', function (e) {
            const saved = e.detail || {};
            if (saved.view !== 'claudeProjectDetail' || !saved.projectId) return;
            openProject(saved.projectId);
            if (saved.chatting && saved.chatId) {
                loadProjectChat(saved.projectId, saved.chatId);
            }
        });
        enhanceProjectModal();
        ensureDetailView();
        setTimeout(renderProjects, 0);
        setTimeout(renderSidebarProjects, 0);
    }

    // 7. 设置全屏 view 内的左 nav 切换 + "概述" 表单真实落地
    //    （主题、字体、配音、给 Cancri 的说明、全名、昵称、职业、头像）
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
                    // 切回"概述"时刷新一次表单显示，避免外面改了昵称 / 主题没同步进来。
                    if (key === 'overview') {
                        populateOverviewForm();
                        if (window.CancriApp && typeof window.CancriApp.fetchUserMemories === 'function') {
                            window.CancriApp.fetchUserMemories();
                        }
                    }
                    if (key === 'capability') populateCapabilitiesForm();
                    if (key === 'invite' && typeof window.fetchAndRenderInvitePanel === 'function') {
                        window.fetchAndRenderInvitePanel();
                    }
                    if (key === 'account') {
                        loadClaudeAccount();
                    }
                    if (key === 'billing') {
                        loadClaudeBillingActivations();
                    }
                });
            });
        }

        const settingsSearch = document.getElementById('claudeSettingsSearch');
        if (settingsSearch && navItems.length) {
            settingsSearch.addEventListener('input', function () {
                const q = settingsSearch.value.trim().toLowerCase();
                document.querySelectorAll('.claude-snav-li').forEach(function (li) {
                    const labelEl = li.querySelector('.claude-snav-label');
                    const label = (labelEl ? labelEl.textContent : li.textContent || '').trim().toLowerCase();
                    li.hidden = Boolean(q) && !label.includes(q);
                });
            });
        }

        const capManageMemoryBtn = document.getElementById('claudeCapManageMemoryBtn');
        if (capManageMemoryBtn) {
            capManageMemoryBtn.addEventListener('click', function () {
                const overviewBtn = document.querySelector('.claude-snav-item[data-snav="overview"]');
                if (overviewBtn) overviewBtn.click();
                const memoryBlock = document.getElementById('claudeMemoriesContainer');
                if (memoryBlock) memoryBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        }
        const capImportMemoryBtn = document.getElementById('claudeCapImportMemoryBtn');
        const overviewImportBtn = document.getElementById('claudeImportMemoryBtn');
        if (capImportMemoryBtn && overviewImportBtn) {
            capImportMemoryBtn.addEventListener('click', function () {
                overviewImportBtn.click();
            });
        }

        const app = window.CancriApp;
        const segBtns = document.querySelectorAll('.claude-segmented .claude-seg-btn[data-theme]');
        const accentSwatches = document.querySelectorAll('.claude-accent-row .claude-accent-swatch[data-accent]');
        const fontSel = document.getElementById('claudeFormFont');
        const voiceSel = document.getElementById('claudeFormVoice');
        const fullNameInput = document.getElementById('claudeFormFullName');
        const nicknameInput = document.getElementById('claudeFormNickname');
        const professionSel = document.getElementById('claudeFormProfession');
        const sysPromptArea = document.getElementById('claudeFormSystemPrompt');
        const sysPromptCount = document.getElementById('claudeFormSystemPromptCount');
        const avatarEl = document.getElementById('claudeFormAvatar');

        // ─── 工具：取首字母初始作为头像兜底 ───
        function pickAvatarInitial() {
            const fullName = (app && app.state && app.state.fullName) || '';
            const nickname = (app && typeof app.getNickname === 'function')
                ? app.getNickname() : '';
            const accountName = document.querySelector('.account-strip .account-name');
            const accountText = accountName ? accountName.textContent.trim() : '';
            const candidate = (fullName || nickname || accountText || 'C').trim();
            if (!candidate) return 'C';
            // 中文取第一个字、英文取首字母大写。
            const ch = candidate.charAt(0);
            return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch;
        }

        function refreshAvatar() {
            if (avatarEl) avatarEl.textContent = pickAvatarInitial();
            // 同步顶层 .account-strip .avatar（cancri_chat.js 也写它，但用户改了
            // 全名 / 昵称之后那边不主动刷新，这里兜底）。
            const stripAvatar = document.querySelector('.account-strip .avatar');
            if (stripAvatar) {
                // 不动后台头像图（如果是 <img>）；只接管纯文字 initials 那种。
                if (!stripAvatar.querySelector('img')) {
                    stripAvatar.textContent = pickAvatarInitial();
                }
            }
        }

        function populateCapabilitiesForm() {
            if (!app) return;
            const capInlineViz = document.getElementById('claudeCapInlineViz');
            if (capInlineViz) {
                capInlineViz.checked = app.state.inlineMermaidEnabled !== false;
            }
            const capNotify = document.getElementById('claudeCompletionNotify');
            if (capNotify) {
                capNotify.checked = app.state.completionNotifyEnabled !== false;
            }
        }

        // ─── 工具：把当前 state 写入表单控件 ───
        function populateOverviewForm() {
            if (!app) return;
            const st = app.state || {};

            // 主题 segmented：当前 themeMode（system/light/dark）激活对应按钮
            if (segBtns.length) {
                const currentMode = st.themeMode || 'system';
                segBtns.forEach(function (b) {
                    b.classList.toggle('active', b.getAttribute('data-theme') === currentMode);
                });
            }
            if (accentSwatches.length) {
                const currentAccent = st.accentName || '橙色';
                accentSwatches.forEach(function (b) {
                    b.classList.toggle('active', b.getAttribute('data-accent') === currentAccent);
                });
            }
            if (fontSel) fontSel.value = st.chatFont || 'sans';
            if (voiceSel) voiceSel.value = st.voicePreset || 'steady';
            if (fullNameInput) fullNameInput.value = st.fullName || '';
            if (nicknameInput && typeof app.getNickname === 'function') {
                nicknameInput.value = app.getNickname() || '';
            }
            if (professionSel) professionSel.value = st.profession || '';
            if (sysPromptArea) {
                sysPromptArea.value = st.customInstructions || '';
                if (sysPromptCount) {
                    sysPromptCount.textContent = String((st.customInstructions || '').length);
                }
            }
            refreshAvatar();
        }

        // 三按钮主题 segmented：真实切换 system / light / dark
        if (segBtns.length) {
            segBtns.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    segBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
                    const mode = btn.getAttribute('data-theme');
                    if (app && typeof app.setThemeMode === 'function') {
                        app.setThemeMode(mode);
                    }
                });
            });
        }

        // 主题色色板：点击切换 accent（复用 cancri_chat.js setAccent）
        if (accentSwatches.length) {
            accentSwatches.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    accentSwatches.forEach(function (b) { b.classList.toggle('active', b === btn); });
                    const name = btn.getAttribute('data-accent');
                    if (app && typeof app.setAccent === 'function') {
                        app.setAccent(name);
                    }
                });
            });
        }

        // 聊天字体
        if (fontSel) {
            fontSel.addEventListener('change', function () {
                if (app && typeof app.setChatFont === 'function') {
                    app.setChatFont(fontSel.value);
                }
            });
        }

        // 配音
        if (voiceSel) {
            voiceSel.addEventListener('change', function () {
                if (app && typeof app.setVoicePreset === 'function') {
                    app.setVoicePreset(voiceSel.value);
                }
            });
        }

        // 全名
        if (fullNameInput) {
            fullNameInput.addEventListener('change', function () {
                if (app && typeof app.setFullName === 'function') {
                    app.setFullName(fullNameInput.value);
                }
                refreshAvatar();
            });
            fullNameInput.addEventListener('blur', function () {
                if (app && typeof app.setFullName === 'function') {
                    app.setFullName(fullNameInput.value);
                }
                refreshAvatar();
            });
        }

        // 昵称（同步到 cancri_nickname localStorage 与 .account-strip .account-name）
        if (nicknameInput) {
            nicknameInput.addEventListener('change', function () {
                if (app && typeof app.setNickname === 'function') {
                    app.setNickname(nicknameInput.value.trim());
                }
                if (app && typeof app.refreshNicknameUI === 'function') {
                    app.refreshNicknameUI();
                }
                refreshAvatar();
            });
            nicknameInput.addEventListener('blur', function () {
                if (app && typeof app.setNickname === 'function') {
                    app.setNickname(nicknameInput.value.trim());
                }
                if (app && typeof app.refreshNicknameUI === 'function') {
                    app.refreshNicknameUI();
                }
                refreshAvatar();
            });
        }

        // 职业
        if (professionSel) {
            professionSel.addEventListener('change', function () {
                if (app && typeof app.setProfession === 'function') {
                    app.setProfession(professionSel.value);
                }
            });
        }

        // 给 Cancri 的说明（业内做法：随时持久化 + 实时 counter）
        if (sysPromptArea) {
            sysPromptArea.addEventListener('input', function () {
                const v = sysPromptArea.value.slice(0, 100);
                if (sysPromptArea.value !== v) sysPromptArea.value = v; // 防 IME 跨过 100
                if (sysPromptCount) sysPromptCount.textContent = String(v.length);
                if (app && typeof app.setCustomInstructions === 'function') {
                    app.setCustomInstructions(v);
                }
            });
        }

        const capInlineViz = document.getElementById('claudeCapInlineViz');
        if (capInlineViz) {
            capInlineViz.addEventListener('change', function () {
                if (app && typeof app.setInlineMermaidEnabled === 'function') {
                    app.setInlineMermaidEnabled(capInlineViz.checked);
                }
            });
        }

        const capNotify = document.getElementById('claudeCompletionNotify');
        if (capNotify) {
            capNotify.addEventListener('change', function () {
                if (app && typeof app.setCompletionNotifyEnabled === 'function') {
                    app.setCompletionNotifyEnabled(capNotify.checked);
                }
            });
        }

        // 初始化一次：state 在 cancri_chat.js 顶层已 restore + applyTheme，
        // 这时表单第一次显示时填进去。
        populateOverviewForm();
        populateCapabilitiesForm();

        // 当 #claudeSettingsView 变成可见 view 时（cancri 切 view 用 hidden 属性 / class），
        // 再 populate 一次保证表单显示当前 state。MutationObserver 监听 class / hidden。
        const settingsView = document.getElementById('claudeSettingsView');
        if (settingsView && typeof MutationObserver !== 'undefined') {
            new MutationObserver(function () {
                if (!settingsView.hasAttribute('hidden')) {
                    populateOverviewForm();
                    populateCapabilitiesForm();
                }
            }).observe(settingsView, { attributes: true, attributeFilter: ['hidden', 'class'] });
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
            clearTimeout(closeMenu._timer);
            menu.hidden = false;
            menu.classList.remove('is-closing');
            syncWebSearchState();
            // 测一次 offsetHeight 才能正确算 top（hidden 时为 0）
            requestAnimationFrame(function () {
                positionMenu();
                menu.classList.add('is-open');
            });
        }
        function closeMenu() {
            if (menu.hidden) return;
            menu.classList.remove('is-open');
            menu.classList.add('is-closing');
            clearTimeout(closeMenu._timer);
            closeMenu._timer = setTimeout(function () {
                menu.hidden = true;
                menu.classList.remove('is-closing');
            }, 140);
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
            e.stopPropagation();
            const action = item.dataset.action;
            if (action === 'file') {
                fileInput.click();
                closeMenu();
            } else if (action === 'screenshot') {
                closeMenu();
                captureScreenshot();
            } else if (action === 'websearch') {
                // 触发原 #webSearchToggle.click()，保留 cancri 的状态机
                if (webBtn) {
                    webBtn.dispatchEvent(new MouseEvent('click', {
                        bubbles: false,
                        cancelable: true,
                        view: window
                    }));
                }
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
        window.addEventListener('scroll', function () { if (!menu.hidden) positionMenu(); }, true);
        window.addEventListener('resize', function () { if (!menu.hidden) positionMenu(); });
    }

    // 浏览器原生屏幕截图：调用 getDisplayMedia → canvas 捕获 → 转成 File
    // 走 cancri_chat.js 的 handleSelectedAttachmentFiles 上传路径。
    async function captureScreenshot() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showToast('当前浏览器不支持截图功能');
            return;
        }
        var video = null;
        var stream = null;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'never' },
                preferCurrentTab: false,
            });
            video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            await video.play();

            // 等待至少一帧有效画面
            if (video.readyState < 2) {
                await new Promise(function (resolve) {
                    video.addEventListener('loadeddata', resolve, { once: true });
                });
            }
            await new Promise(function (resolve) { requestAnimationFrame(resolve); });

            var w = video.videoWidth || 1920;
            var h = video.videoHeight || 1080;
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('canvas context unavailable');
            ctx.drawImage(video, 0, 0, w, h);

            // 释放摄像头/屏幕流
            stream.getTracks().forEach(function (t) { t.stop(); });
            video.srcObject = null;
            stream = null;
            video = null;

            canvas.toBlob(function (blob) {
                if (!blob) {
                    showToast('截图失败');
                    return;
                }
                var file = new File([blob], 'screenshot.png', { type: 'image/png' });
                var app = window.CancriApp;
                if (app && typeof app.handleSelectedAttachmentFiles === 'function') {
                    app.handleSelectedAttachmentFiles([file]);
                } else {
                    showToast('截图已捕获，但上传入口未就绪');
                }
            }, 'image/png');
        } catch (err) {
            if (stream) {
                try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
            }
            if (video) {
                try { video.srcObject = null; } catch (_) {}
            }
            console.error('[claude_ui] screenshot failed:', err);
            var msg = (err && err.name === 'NotAllowedError') ? '截图已取消' : '截图失败';
            showToast(msg);
        }
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
            if (window.CancriApp && typeof window.CancriApp.syncModelDropdownPosition === 'function') {
                window.CancriApp.syncModelDropdownPosition();
            }
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
                + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
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

        // 2026-05-18 v2：透明 hover-bridge，覆盖主菜单与子菜单之间的几何缝隙。
        // 仅靠 gap=-2 + 220ms hover-intent 在实测中仍然「敏感肌」——鼠标轨迹中
        // 任何超出主菜单右沿但还没进 cascade 左沿的瞬间，mouseleave.relatedTarget
        // 既非 dropdown 也非 cascade（是 body / null），即便不立刻关也心理不安。
        // 经典级联菜单做法：在两菜单之间挂一块无形元素吃掉缝隙的 mouse 事件，
        // 使 dropdown→bridge→cascade 三段连续命中各自 DOM，永远不进「真空」。
        let bridge = document.getElementById('claudeModelCascadeBridge');
        if (!bridge) {
            bridge = document.createElement('div');
            bridge.id = 'claudeModelCascadeBridge';
            bridge.className = 'claude-model-cascade-bridge';
            bridge.hidden = true;
            document.body.appendChild(bridge);
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
            // 2026-05-18 v2：恢复 8px 视觉间距，hover 连续性由透明 bridge 元素负责。
            // bridge 跨度从 dropdown.right - 4（多吃 4px 重叠到主菜单内）一路到
            // cascade.left + 4（多吃 4px 重叠到子菜单内），完全包住缝隙；
            // 鼠标 dropdown→bridge→cascade 三段过渡时 mouseleave.relatedTarget
            // 始终是 bridge / cascade / dropdown 三者之一，永不触发盲区关闭。
            const gap = 8;
            // 优先放右边，不够则放左边
            let placedRight = true;
            let left = rect.right + gap;
            if (left + cw > vw - 12) {
                left = Math.max(12, rect.left - cw - gap);
                placedRight = false;
            }
            const top = Math.max(12, rect.top);
            const maxH = Math.max(220, vh - top - 24);
            cascade.style.left = left + 'px';
            cascade.style.top = top + 'px';
            cascade.style.width = cw + 'px';
            cascade.style.maxHeight = maxH + 'px';

            // bridge：占据主菜单与 cascade 之间整个空间 + 双侧各 4px 重叠余量。
            // placedRight=true 时 bridge 在 dropdown 右；false 时在 dropdown 左。
            // 高度跟随 cascade（未渲染时用 maxH 兜底，避免首帧抖动）。
            const bridgeOverlap = 4;
            let bridgeLeft, bridgeWidth;
            if (placedRight) {
                bridgeLeft = rect.right - bridgeOverlap;
                bridgeWidth = (left + bridgeOverlap) - bridgeLeft;
            } else {
                bridgeLeft = (left + cw) - bridgeOverlap;
                bridgeWidth = (rect.left + bridgeOverlap) - bridgeLeft;
            }
            bridge.style.left = bridgeLeft + 'px';
            bridge.style.top = top + 'px';
            bridge.style.width = Math.max(0, bridgeWidth) + 'px';
            bridge.style.height = maxH + 'px';
        }
        window.addEventListener('resize', function () {
            if (!cascade.hidden) requestAnimationFrame(positionCascade);
        });

        // 2026-05-18：hover-intent 延迟关闭，避免鼠标在主菜单/子菜单之间
        // 任何短暂的非两者元素（边缘像素、子像素抖动、滚动条）触发即时关闭。
        // 220ms 是用户能感知到响应又足够跨越间隙的折中值。
        let cascadeHideTimer = null;
        function cancelCascadeHide() {
            if (cascadeHideTimer) {
                clearTimeout(cascadeHideTimer);
                cascadeHideTimer = null;
            }
        }
        function scheduleCascadeHide() {
            cancelCascadeHide();
            cascadeHideTimer = setTimeout(function () {
                cascadeHideTimer = null;
                cascade.hidden = true;
                bridge.hidden = true;
            }, 220);
        }

        function showCascade() {
            if (!mqDesktop.matches) return;
            cancelCascadeHide();
            populateCascade();
            cascade.hidden = false;
            bridge.hidden = false;
            requestAnimationFrame(positionCascade);
        }
        function hideCascade() {
            cancelCascadeHide();
            cascade.hidden = true;
            bridge.hidden = true;
        }

        // 三个友好元素：cursor 在 dropdown / cascade / bridge 任一内都视作"还在菜单系统里"
        function isFriendly(el) {
            return !!(el && (dropdown.contains(el) || cascade.contains(el) || el === bridge));
        }

        moreRow.addEventListener('mouseenter', showCascade);
        // 触摸（PC 端 hover-only，但为兼容笔记本触屏保留 click）
        moreRow.addEventListener('click', function (e) {
            e.stopPropagation();
            showCascade();
        });

        // 鼠标在主 dropdown / bridge / cascade 之间穿梭时不要关；离开整个组合区才（延迟）关
        dropdown.addEventListener('mouseleave', function (e) {
            if (isFriendly(e.relatedTarget)) return;
            scheduleCascadeHide();
        });
        dropdown.addEventListener('mouseenter', cancelCascadeHide);
        cascade.addEventListener('mouseleave', function (e) {
            if (isFriendly(e.relatedTarget)) return;
            scheduleCascadeHide();
        });
        cascade.addEventListener('mouseenter', cancelCascadeHide);
        bridge.addEventListener('mouseenter', cancelCascadeHide);
        bridge.addEventListener('mouseleave', function (e) {
            if (isFriendly(e.relatedTarget)) return;
            scheduleCascadeHide();
        });
        // bridge 上任何 click / mousedown 都不能冒泡到 document：
        // cancri_chat.js 的 closeModelDropdownOutside 注册在 document.click，
        // 看到 e.target 不在 modelSelector 里就立即 closeModelDropdown，触发
        // claude_ui.js 的 modelSelector class MutationObserver → hideCascade。
        // 这就是触屏笔记本/重按 touchpad 在缝隙处碰一下菜单立刻消失的根因。
        ['click', 'mousedown'].forEach(function (evt) {
            bridge.addEventListener(evt, function (e) { e.stopPropagation(); });
        });

        // cascade click → 找原 option 触发 click，复用 cancri 的 changeModel 委托
        cascade.addEventListener('click', function (e) {
            const opt = e.target.closest('.model-option');
            if (opt) {
                const modelId = opt.dataset.model;
                if (modelId) {
                    const source = content.querySelector('.model-option[data-model="' + CSS.escape(modelId) + '"]');
                    if (source) {
                        source.click();
                        hideCascade();
                    }
                }
            }
            // 同上 bridge：阻断冒泡到 document，cancri 的 outside-click 不能误关。
            // 模型选项的 source.click() 是合成事件单独冒泡，正常走 modelSelector
            // 内部链路（target 在 modelSelector 里），cancri 自己会 closeModelDropdown。
            e.stopPropagation();
        });
        cascade.addEventListener('mousedown', function (e) { e.stopPropagation(); });

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
    function resolveToastType(msg, type) {
        const explicitType = String(type || '').toLowerCase();
        if (/^(success|error|info|warning)$/.test(explicitType)) return explicitType;

        const text = String(msg || '');
        if (/失败|错误|异常|封禁|过期|无法|拒绝|不可用|无效|损坏|过大|不支持|未就绪|用完|校验失败/.test(text)) return 'error';
        if (/警告|限制|请|稍后|只读|太长|已忽略|已暂停|已满/.test(text)) return 'warning';
        if (/已|成功|完成|开始|打开|复制|导出|导入|生成|创建|重命名|删除|切换|加载|引用|进入|选中|保存/.test(text)) return 'success';
        return 'info';
    }

    function showToast(msg, type) {
        const toast = document.getElementById('toast');
        if (!toast) { alert(msg); return; }
        toast.textContent = msg;
        const toastType = resolveToastType(msg, type);
        toast.dataset.type = toastType;
        toast.classList.toggle('is-warning', toastType === 'warning');
        toast.classList.toggle('is-info', toastType === 'info');
        toast.classList.add('show');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(function () {
            toast.classList.remove('show');
            delete toast.dataset.type;
        }, 2000);
    }

    // 2026-05-22 §23.6：设置弹窗关闭交互。
    //   原 #claudeSettingsView 是占据主区的全屏 view；CSS §23.6 把它转成 fixed
    //   居中 modal。这里补三种关闭路径：
    //   1) 点 .claude-settings-title 右侧的 ::after X 伪元素（命中 padding 区）
    //   2) 点 modal 外的 backdrop（即 #claudeSettingsView 自身，非 .claude-settings-page）
    //   3) ESC 键（仅当 settings view 处于 active 态）
    //   关闭时回到 window.__claudeSettingsPrevView（bindCustomNav 记录），缺省 'home'。
    function bindSettingsModalClose() {
        var view = document.getElementById('claudeSettingsView');
        if (!view) return;
        var closingSettings = false;
        var SETTINGS_CLOSE_MS = 150;

        function restoreAccountSheetIfNeeded() {
            if (!window.__claudeSettingsKeepAccountSheet) return;
            var accountPopover = document.getElementById('accountPopover');
            if (accountPopover) accountPopover.classList.add('open');
            var api = window.CancriApp;
            if (api && typeof api.syncAccountSheetState === 'function') {
                api.syncAccountSheetState();
            }
            if (api && typeof api.updateScrimVisibility === 'function') {
                api.updateScrimVisibility();
            }
            window.__claudeSettingsKeepAccountSheet = false;
        }

        function finishCloseSettings() {
            var target = window.__claudeSettingsPrevView || 'home';
            if (target === 'claudeSettings') target = 'home';
            var keepSheet = Boolean(window.__claudeSettingsKeepAccountSheet);
            var search = document.getElementById('claudeSettingsSearch');
            if (search) search.value = '';
            document.querySelectorAll('.claude-snav-li[hidden]').forEach(function (li) {
                li.hidden = false;
            });
            view.classList.remove('active', 'is-closing');
            if (typeof window.setActiveView === 'function') {
                window.setActiveView(target, { preservePopover: keepSheet });
            } else {
                document.querySelectorAll('.main > .view').forEach(function (v) {
                    v.classList.toggle('active', v.id === (target + 'View'));
                });
                if (document.body) document.body.dataset.view = target;
            }
            restoreAccountSheetIfNeeded();
            window.setTimeout(function () {
                closingSettings = false;
            }, 80);
        }

        function closeSettings() {
            if (closingSettings || !view.classList.contains('active')) return;
            if (view.classList.contains('is-closing')) return;
            closingSettings = true;
            view.classList.add('is-closing');
            window.setTimeout(finishCloseSettings, SETTINGS_CLOSE_MS);
        }
        window.closeClaudeSettingsModal = closeSettings;

        function onClosePress(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation();
                }
            }
            closeSettings();
        }

        var closeBtn = document.getElementById('claudeSettingsCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', onClosePress, true);
            closeBtn.addEventListener('touchend', onClosePress, { capture: true, passive: false });
        }
        // 兼容旧版 title 伪元素关闭（若仍存在）
        var title = view.querySelector('.claude-settings-title');
        if (title) {
            title.addEventListener('click', function (e) {
                if (e.target !== title) return;
                var rect = title.getBoundingClientRect();
                if (e.clientX >= rect.right - 44) {
                    e.preventDefault();
                    closeSettings();
                }
            });
            title.style.cursor = 'default';
        }
        // 点 backdrop 关闭：mousedown + click 都在 view 自身（非 .claude-settings-page）触发
        view.addEventListener('mousedown', function (e) {
            if (e.target === view) {
                view.dataset.backdropDown = '1';
            } else {
                view.dataset.backdropDown = '';
            }
        });
        view.addEventListener('click', function (e) {
            if (e.target === view && view.dataset.backdropDown === '1') {
                e.preventDefault();
                closeSettings();
            }
            view.dataset.backdropDown = '';
        });
        view.addEventListener('touchend', function (e) {
            if (e.target !== view) return;
            e.preventDefault();
            closeSettings();
        }, { passive: false });
        // ESC 关闭（capture 先于 cancri_chat 全局 ESC，避免顺带关掉账户抽屉）
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (!view.classList.contains('active')) return;
            if (document.body && document.body.dataset.view === 'claudeSettings') {
                e.preventDefault();
                e.stopPropagation();
                closeSettings();
            }
        }, true);
    }

    // 2026-05-22 §23.3：全站文件拖入提示层。
    //   - cancri_chat.js bindComposerDragAndDrop 只在 composer 元素监听 drag 事件，
    //     用户从外部拖入时只有命中 composer 才有视觉反馈。
    //   - 新方案：在 window 级监听 dragenter/over/leave/drop，激活全屏 .page-drop-overlay
    //     给出"放手就上传"提示。drop 事件由 composer 自身的 listener 处理（实际接收文件），
    //     这里的 overlay 仅做视觉提示，不抢走文件。
    //   - 项目详情页 #claudeProjectDetailView 也走这个 overlay：用户拖入会高亮全屏，
    //     drop 落到 .claude-project-composer 时由 bindProjectSourceDrop 处理。
    //   - 不在登录页 / shop / api 子页激活：判断当前 path 必须是 chat/index|claude.html。
    function bindPageDragOverlay() {
        if (document.getElementById('pageDropOverlay')) return;
        // 只在 chat 主页生效，子页面（API / 商店 / 登录）不需要这个提示
        var path = (location.pathname || '').toLowerCase();
        if (path.indexOf('/chat/api/') !== -1 || path.indexOf('/chat/code/') !== -1 || path.indexOf('/chat/shop/') !== -1) {
            return;
        }
        var overlay = document.createElement('div');
        overlay.id = 'pageDropOverlay';
        overlay.className = 'page-drop-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML =
            '<div class="page-drop-card">' +
                '<div class="page-drop-icon">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
                        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
                        '<polyline points="14 2 14 8 20 8"/>' +
                        '<line x1="12" y1="13" x2="12" y2="19"/>' +
                        '<line x1="9" y1="16" x2="15" y2="16"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="page-drop-title">拖放文件到这里</div>' +
                '<div class="page-drop-sub">松开即可添加到当前对话</div>' +
            '</div>';
        document.body.appendChild(overlay);

        var depth = 0;
        function hasFiles(e) {
            var types = (e.dataTransfer && e.dataTransfer.types) || [];
            for (var i = 0; i < types.length; i++) {
                if (types[i] === 'Files') return true;
            }
            return false;
        }
        function setActive(active) {
            overlay.classList.toggle('is-active', Boolean(active));
            overlay.setAttribute('aria-hidden', active ? 'false' : 'true');
        }
        window.addEventListener('dragenter', function (e) {
            if (!hasFiles(e)) return;
            depth += 1;
            setActive(true);
        });
        window.addEventListener('dragover', function (e) {
            if (!hasFiles(e)) return;
            // 阻止浏览器在 viewport 默认打开拖入文件（替换页面）；composer 自身的 drop
            // listener 仍会接收 drop 事件并处理上传。
            e.preventDefault();
        });
        window.addEventListener('dragleave', function (e) {
            if (!hasFiles(e)) return;
            depth = Math.max(0, depth - 1);
            // 鼠标离开 viewport 时 e.relatedTarget 通常为 null
            if (depth === 0 || !e.relatedTarget) {
                depth = 0;
                setActive(false);
            }
        });
        window.addEventListener('drop', function (e) {
            // 即使没命中 composer 也要关掉提示，否则一直挂着
            depth = 0;
            setActive(false);
            // 不命中 composer 时的兜底：阻止浏览器默认（用其他页面替换当前页）
            if (hasFiles(e) && e.target && !e.target.closest('[data-workbench-composer], .claude-project-composer, input[type="file"]')) {
                e.preventDefault();
            }
        });
        // 兜底：拖动卡死时（dragleave 没触发的边界情况），ESC 一键关
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay.classList.contains('is-active')) {
                depth = 0;
                setActive(false);
            }
        });
    }

    // 2026-05-20：记忆区事件委托（删除 / 开关 / 手填槽位）
    var memoriesContainer = document.getElementById('claudeMemoriesContainer');
    if (memoriesContainer) {
        memoriesContainer.addEventListener('click', function (e) {
            var app = window.CancriApp;
            if (!app) return;
            var saveBtn = e.target.closest('[data-action="save-memory"]');
            if (saveBtn) {
                var saveSlot = parseInt(saveBtn.getAttribute('data-slot'), 10);
                var input = memoriesContainer.querySelector('.memory-slot-input[data-slot="' + saveSlot + '"]');
                if (!isNaN(saveSlot) && input && typeof app.saveUserMemorySlot === 'function') {
                    app.saveUserMemorySlot(saveSlot, input.value);
                }
                return;
            }
            var editBtn = e.target.closest('[data-action="edit-memory"]');
            if (editBtn && typeof app.startMemorySlotEdit === 'function') {
                var editSlot = parseInt(editBtn.getAttribute('data-slot'), 10);
                if (!isNaN(editSlot)) app.startMemorySlotEdit(editSlot, editBtn.textContent || '');
                return;
            }
            var btn = e.target.closest('[data-action="delete-memory"]');
            if (!btn) return;
            var slot = parseInt(btn.getAttribute('data-slot'), 10);
            if (!isNaN(slot) && typeof app.deleteUserMemory === 'function') {
                app.deleteUserMemory(slot);
            }
        });
        memoriesContainer.addEventListener('keydown', function (e) {
            var app = window.CancriApp;
            var input = e.target.closest('[data-action="edit-memory-input"]');
            if (!input || !app) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                var slot = parseInt(input.getAttribute('data-slot'), 10);
                if (!isNaN(slot) && typeof app.saveUserMemorySlot === 'function') {
                    app.saveUserMemorySlot(slot, input.value);
                }
            } else if (e.key === 'Escape' && typeof app.cancelMemorySlotEdit === 'function') {
                app.cancelMemorySlotEdit();
            }
        });
        memoriesContainer.addEventListener('change', function (e) {
            var toggle = e.target.closest('[data-action="toggle-memory-generation"]');
            if (!toggle) return;
            if (window.CancriApp && typeof window.CancriApp.setMemoryGenerationEnabled === 'function') {
                window.CancriApp.setMemoryGenerationEnabled(Boolean(toggle.checked));
            }
        });
    }

    // 2026-05-31：Group by 下拉（无 / 日期 / 项目）
    // 选择后写入 window.CANCRI_GROUP_BY + localStorage，并重新渲染聊天记录列表。
    function bindGroupByDropdown() {
        var btn = document.getElementById('claudeGroupByBtn');
        var dropdown = document.getElementById('claudeGroupByDropdown');
        if (!btn || !dropdown) return;
        var STORAGE_KEY = 'cancri_chat_group_by';
        var saved = 'date';
        try { saved = localStorage.getItem(STORAGE_KEY) || 'date'; } catch (e) {}
        window.CANCRI_GROUP_BY = saved;

        function closeDropdown() {
            dropdown.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
        }
        function openDropdown() {
            dropdown.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
        }
        function toggleDropdown() {
            if (dropdown.hidden) openDropdown(); else closeDropdown();
        }
        function setActiveItem(target) {
            dropdown.querySelectorAll('.claude-group-by-item').forEach(function (el) {
                el.classList.remove('active');
                var svg = el.querySelector('svg');
                if (svg) svg.remove();
            });
            target.classList.add('active');
            if (!target.querySelector('svg')) {
                var check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                check.setAttribute('width', '14');
                check.setAttribute('height', '14');
                check.setAttribute('viewBox', '0 0 24 24');
                check.setAttribute('fill', 'none');
                check.setAttribute('stroke', 'currentColor');
                check.setAttribute('stroke-width', '1.5');
                check.setAttribute('stroke-linecap', 'round');
                check.setAttribute('stroke-linejoin', 'round');
                check.setAttribute('aria-hidden', 'true');
                check.innerHTML = '<path d="M20 6 9 17l-5-5"/>';
                target.appendChild(check);
            }
        }
        // 初始化：把 saved 值对应的 item 设为 active
        dropdown.querySelectorAll('.claude-group-by-item').forEach(function (item) {
            if (item.getAttribute('data-value') === saved) setActiveItem(item);
        });
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleDropdown();
        });
        dropdown.querySelectorAll('.claude-group-by-item').forEach(function (item) {
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                var value = item.getAttribute('data-value') || 'date';
                setActiveItem(item);
                closeDropdown();
                window.CANCRI_GROUP_BY = value;
                try { localStorage.setItem(STORAGE_KEY, value); } catch (err) {}
                if (typeof window.renderChatHistoryList === 'function') {
                    window.renderChatHistoryList();
                }
            });
        });
        document.addEventListener('click', function (e) {
            if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== btn) {
                closeDropdown();
            }
        });
    }

    // 2026-05-31：语音按钮波形动画 — 仅播放一次完整循环，鼠标离开后动画继续播完
    function bindVoiceHoverAnimation() {
        var btn = document.getElementById('voiceToastBtn');
        if (!btn) return;
        var fallbackTimer = null;

        btn.addEventListener('mouseenter', function () {
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }

            // 核心修复：如果 class 还在，先 remove → reflow → 再 add。
            // 这样 CSS 选择器 .voice-btn.voice-animating .voice-bar
            // 经历“匹配→不匹配→匹配”的变化，浏览器一定认为是新 animation。
            if (btn.classList.contains('voice-animating')) {
                btn.classList.remove('voice-animating');
                void btn.offsetHeight; // 强制 reflow，让浏览器感知 class 已消失
            }
            btn.classList.add('voice-animating');
        });

        btn.addEventListener('mouseleave', function () {
            var bars = btn.querySelectorAll('.voice-bar');
            var anims = [];

            // 用 Web Animations API 精确获取当前 running 的 voice-pulse
            bars.forEach(function (bar) {
                if (typeof bar.getAnimations === 'function') {
                    bar.getAnimations().forEach(function (anim) {
                        if (anim.animationName === 'voice-pulse') {
                            anims.push(anim);
                        }
                    });
                }
            });

            // 没有 running animation（已结束或从未开始），直接 remove class
            if (anims.length === 0) {
                btn.classList.remove('voice-animating');
                return;
            }

            // 等所有 running animation 自然结束
            Promise.all(anims.map(function (a) { return a.finished; }))
                .then(function () {
                    btn.classList.remove('voice-animating');
                })
                .catch(function () {
                    // animation 被 mouseenter 的 reset 打断（cancel），忽略
                });

            // 兜底：getAnimations 不工作 / 极端情况下 1.6s 后强制清理
            if (fallbackTimer) clearTimeout(fallbackTimer);
            fallbackTimer = setTimeout(function () {
                btn.classList.remove('voice-animating');
                fallbackTimer = null;
            }, 1600);
        });
    }

    // 2026-05-22 §23.2：Recents 分节标题点击折叠 / 展开聊天列表。
    //   - 点击 #claudeRecentTitle 切换 .claude-recent-header 的 data-collapsed
    //   - data-collapsed=true 时 CSS（§23.2）隐藏后面的 #chatHistoryList
    //   - chevron 旋转由 CSS 自动处理（data-collapsed 控制 rotate）
    //   - localStorage('cancri_recent_collapsed') 持久化
    function bindRecentHeaderToggle() {
        var header = document.querySelector('.claude-recent-header');
        var title = document.getElementById('claudeRecentTitle');
        if (!header || !title) return;
        var KEY = 'cancri_recent_collapsed';
        function applyState(collapsed) {
            header.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
            title.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        }
        try {
            applyState(localStorage.getItem(KEY) === 'true');
        } catch (_) {
            applyState(false);
        }
        title.addEventListener('click', function (e) {
            e.preventDefault();
            var next = header.getAttribute('data-collapsed') !== 'true';
            applyState(next);
            try { localStorage.setItem(KEY, next ? 'true' : 'false'); } catch (_) { /* 无 localStorage */ }
        });
        title.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                title.click();
            }
        });
    }

    /* ── 设置页 Account / Privacy 内嵌逻辑（2026-06-01） ── */
    var claudeAccountTimer = null;
    var SITE_SESSION_KEY = 'cancri_site_session_start';

    function getSiteSessionStartMs() {
        try {
            var raw = sessionStorage.getItem(SITE_SESSION_KEY);
            if (raw) {
                var parsed = parseInt(raw, 10);
                if (!isNaN(parsed) && parsed > 0) return parsed;
            }
            var now = Date.now();
            sessionStorage.setItem(SITE_SESSION_KEY, String(now));
            return now;
        } catch (e) {
            return Date.now();
        }
    }

    var claudeAccountSessionStart = getSiteSessionStartMs();

    function getCurrentVisitorId() {
        if (window.CancriFingerprint && typeof window.CancriFingerprint.getVisitorId === 'function') {
            return window.CancriFingerprint.getVisitorId() || '';
        }
        try {
            return localStorage.getItem('cancri_visitor_id') || '';
        } catch (e) {
            return '';
        }
    }

    function isCurrentDeviceRecord(d) {
        if (!d) return false;
        var vid = getCurrentVisitorId();
        if (vid && d.visitor_id && d.visitor_id === vid) return true;
        var ua = navigator.userAgent || '';
        return Boolean(ua && d.ua && d.ua === ua);
    }

    function setClaudeText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function esc(s) {
        var d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        return d.toLocaleString('zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    }

    function fmtDuration(ms) {
        var totalSec = Math.floor(ms / 1000);
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        if (h > 0) return h + ' 小时 ' + m + ' 分钟';
        if (m > 0) return m + ' 分钟 ' + s + ' 秒';
        return s + ' 秒';
    }

    function parseUA(ua) {
        if (!ua) return { browser: '未知', os: '' };
        var u = String(ua).toLowerCase();
        var browser = '未知';
        var os = '';
        if (u.indexOf('edg/') !== -1 || u.indexOf('edge/') !== -1) browser = 'Edge';
        else if (u.indexOf('chrome/') !== -1 && u.indexOf('chromium/') === -1) browser = 'Chrome';
        else if (u.indexOf('firefox/') !== -1) browser = 'Firefox';
        else if (u.indexOf('safari/') !== -1 && u.indexOf('chrome/') === -1) browser = 'Safari';
        else if (u.indexOf('opr/') !== -1 || u.indexOf('opera/') !== -1) browser = 'Opera';
        if (u.indexOf('windows') !== -1) os = 'Windows';
        else if (u.indexOf('macintosh') !== -1 || u.indexOf('mac os') !== -1) os = 'macOS';
        else if (u.indexOf('linux') !== -1) os = 'Linux';
        else if (u.indexOf('android') !== -1) os = 'Android';
        else if (u.indexOf('iphone') !== -1 || u.indexOf('ipad') !== -1) os = 'iOS';
        return { browser: browser, os: os };
    }

    function loadClaudeAccount() {
        if (claudeAccountTimer) { clearInterval(claudeAccountTimer); claudeAccountTimer = null; }
        var client = null;
        if (window.supabase && window.supabase.createClient) {
            try {
                client = window.supabase.createClient(
                    window.__SUPABASE_URL__,
                    window.__SUPABASE_ANON_KEY__,
                    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cancri_supabase_auth' } }
                );
            } catch (e) { client = null; }
        }
        if (!client) return;

        function fetchAccountInfo(session) {
            if (!session || !session.user) {
                setClaudeText('claudeAccountEmail', '未登录');
                return;
            }
            var user = session.user;
            setClaudeText('claudeAccountEmail', esc(user.email || '匿名用户'));
            setClaudeText('claudeAccountUid', esc(user.id).slice(0, 8) + '…');
            var uidEl = document.getElementById('claudeAccountUid');
            if (uidEl) uidEl.title = user.id;
            setClaudeText('claudeAccountCreated', fmtDate(user.created_at));
            setClaudeText('claudeAccountLastSignin', fmtDate(user.last_sign_in_at));
            claudeAccountTimer = setInterval(function () {
                setClaudeText('claudeAccountOnline', fmtDuration(Date.now() - claudeAccountSessionStart));
            }, 1000);
            setClaudeText('claudeAccountOnline', fmtDuration(Date.now() - claudeAccountSessionStart));
            var token = session.access_token;
            fetch(window.__SUPABASE_URL__ + '/functions/v1/chat-gateway', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: window.__SUPABASE_ANON_KEY__ },
                body: JSON.stringify({ endpoint: 'my_account', __auth_token: token })
            }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (data) {
                setClaudeText('claudeAccountIp', esc(data.current_ip || '—'));
                renderClaudeDevices(data.devices || []);
            }).catch(function (err) {
                console.error('my_account:', err);
                setClaudeText('claudeAccountIp', '获取失败');
                renderClaudeDevices([]);
            });
        }

        client.auth.getSession().then(function (res) {
            fetchAccountInfo(res && res.data && res.data.session);
        });

        if (window.CancriFingerprint && typeof window.CancriFingerprint.submitNow === 'function') {
            window.CancriFingerprint.submitNow().catch(function () { return null; }).then(function () {
                client.auth.getSession().then(function (res) {
                    fetchAccountInfo(res && res.data && res.data.session);
                });
            });
        }
    }

    function renderClaudeDevices(devices) {
        var tbody = document.getElementById('claudeDeviceList');
        if (!tbody) return;
        if (!devices.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="claude-device-empty">暂无记录</td></tr>';
            return;
        }
        var sorted = devices.slice().sort(function (a, b) {
            return Number(isCurrentDeviceRecord(b)) - Number(isCurrentDeviceRecord(a));
        });
        var html = '';
        sorted.forEach(function (d) {
            var parsed = parseUA(d.ua);
            var label = parsed.browser + (parsed.os ? ' (' + parsed.os + ')' : '');
            if (d.platform && label.indexOf(String(d.platform)) === -1) {
                label += ' · ' + d.platform;
            }
            var isCurrent = isCurrentDeviceRecord(d);
            var badge = isCurrent ? '<span class="claude-device-badge">当前</span>' : '';
            var location = [d.country, d.timezone].filter(Boolean).join(' / ') || '—';
            html += '<tr>' +
                '<td><div>' + esc(label) + badge + '</div>' +
                '<div style="font-size:12px;color:var(--c-text-soft);margin-top:2px;word-break:break-all;">' + esc(d.ua ? d.ua.slice(0, 80) : '') + '</div></td>' +
                '<td>' + esc(location) + '</td>' +
                '<td>' + esc(fmtDate(d.created_at)) + '</td>' +
                '</tr>';
        });
        tbody.innerHTML = html;
    }

    var BILLING_STATUS_LABEL = {
        activated: '已激活',
        approved: '待激活',
        pending: '待审核',
        rejected: '已驳回'
    };

    function loadClaudeBillingActivations() {
        var panel = document.getElementById('claudeBillingActivations');
        if (!panel) return;
        panel.innerHTML = '<p class="claude-billing-empty">正在加载…</p>';
        var token = typeof getCancriAccessToken === 'function' ? getCancriAccessToken() : '';
        if (!token) {
            panel.innerHTML = '<p class="claude-billing-empty">请先登录后查看激活记录。</p>';
            return;
        }
        fetch(window.__SUPABASE_URL__ + '/functions/v1/chat-gateway', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: window.__SUPABASE_ANON_KEY__,
                Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({ endpoint: 'list_my_orders', __auth_token: token })
        }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (data) {
            var orders = (data && data.orders) || [];
            var records = orders.filter(function (o) {
                return o.status === 'activated' || (o.activation_code && o.status === 'approved');
            });
            if (!records.length) {
                panel.innerHTML = '<p class="claude-billing-empty">暂无激活记录。提交订单并通过审核、兑换激活码后会显示在这里。</p>';
                return;
            }
            var rows = records.map(function (o) {
                var when = o.activated_at || o.updated_at || o.created_at;
                var kind = o.order_kind_label || (o.order_kind === 'topup' ? '加油包' : '订阅');
                var spec = o.spec_label || o.plan_code || o.topup_sku || '—';
                var amount = (o.amount_cny != null && o.amount_cny !== '') ? ('¥' + o.amount_cny) : '—';
                var status = BILLING_STATUS_LABEL[o.status] || o.status_label || o.status || '—';
                var code = o.activation_code ? esc(String(o.activation_code)) : '—';
                return '<tr>' +
                    '<td>' + esc(fmtDate(when)) + '</td>' +
                    '<td>' + esc(kind) + '<div style="font-size:12px;color:var(--c-text-soft);margin-top:2px;">' + esc(spec) + '</div></td>' +
                    '<td>' + esc(amount) + '</td>' +
                    '<td><code style="font-size:12px;">' + code + '</code></td>' +
                    '<td>' + esc(status) + '</td>' +
                    '</tr>';
            }).join('');
            panel.innerHTML =
                '<table class="claude-billing-table">' +
                '<thead><tr><th>时间</th><th>类型</th><th>花费</th><th>激活码</th><th>状态</th></tr></thead>' +
                '<tbody>' + rows + '</tbody></table>';
        }).catch(function (err) {
            console.error('list_my_orders:', err);
            panel.innerHTML = '<p class="claude-billing-empty">加载失败，请稍后重试。</p>';
        });
    }

    function bindClaudePasswordPanel() {
        var saveBtn = document.getElementById('claudePasswordSaveBtn');
        if (!saveBtn) return;
        saveBtn.addEventListener('click', function () {
            var msgEl = document.getElementById('claudePasswordMsg');
            var p1El = document.getElementById('claudePasswordNew');
            var p2El = document.getElementById('claudePasswordConfirm');
            var p1 = p1El ? String(p1El.value || '') : '';
            var p2 = p2El ? String(p2El.value || '') : '';
            if (p1.length < 8) {
                if (msgEl) msgEl.textContent = '密码至少 8 位。';
                return;
            }
            if (p1 !== p2) {
                if (msgEl) msgEl.textContent = '两次输入的密码不一致。';
                return;
            }
            var client = null;
            if (window.supabase && window.supabase.createClient) {
                try {
                    client = window.supabase.createClient(
                        window.__SUPABASE_URL__,
                        window.__SUPABASE_ANON_KEY__,
                        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cancri_supabase_auth' } }
                    );
                } catch (e) { client = null; }
            }
            if (!client) {
                if (msgEl) msgEl.textContent = '无法连接认证服务。';
                return;
            }
            saveBtn.disabled = true;
            if (msgEl) msgEl.textContent = '保存中…';
            client.auth.updateUser({ password: p1 }).then(function (res) {
                if (res.error) throw res.error;
                try { localStorage.setItem('cancri_password_login_enabled', '1'); } catch (e) { /* ignore */ }
                if (p1El) p1El.value = '';
                if (p2El) p2El.value = '';
                if (msgEl) msgEl.textContent = '密码已保存。下次可在登录页使用「邮箱 + 密码」登录。';
            }).catch(function (err) {
                if (msgEl) msgEl.textContent = '保存失败：' + (err && err.message ? err.message : '请稍后重试');
            }).finally(function () {
                saveBtn.disabled = false;
            });
        });
    }

    function bindClaudeAccountPanel() {
        var signOutBtn = document.getElementById('claudeSignOutAllBtn');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', function () {
                if (!confirm('确定要从所有设备登出？这将结束所有会话。')) return;
                var client = null;
                if (window.supabase && window.supabase.createClient) {
                    try {
                        client = window.supabase.createClient(
                            window.__SUPABASE_URL__,
                            window.__SUPABASE_ANON_KEY__,
                            { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cancri_supabase_auth' } }
                        );
                    } catch (e) { client = null; }
                }
                if (!client) return;
                client.auth.signOut({ scope: 'global' }).then(function () {
                    window.location.href = './index.html';
                }).catch(function (err) {
                    alert('登出失败：' + (err.message || '未知错误'));
                });
            });
        }

        var exportBtn = document.getElementById('claudeExportChatsBtn');
        var progress = document.getElementById('claudeExportProgress');
        var progressRow = document.getElementById('claudeExportProgressRow');
        if (exportBtn) {
            exportBtn.addEventListener('click', async function () {
                exportBtn.disabled = true;
                if (progressRow) progressRow.style.display = 'flex';
                if (progress) progress.textContent = '正在获取对话列表…';
                var token = getCancriAccessToken();
                var SUPABASE_URL = window.__SUPABASE_URL__ || '';
                var SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || '';
                if (!token) {
                    if (progress) progress.textContent = '请先登录。';
                    exportBtn.disabled = false;
                    return;
                }
                try {
                    var resp = await fetch(SUPABASE_URL + '/functions/v1/chat-gateway', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
                        body: JSON.stringify({ endpoint: 'chat_history', action: 'list', __auth_token: token })
                    });
                    var json = await resp.json().catch(function () { return {}; });
                    var chats = (json.data || []);
                    if (!chats.length) {
                        if (progress) progress.textContent = '暂无聊天记录可导出。';
                        exportBtn.disabled = false;
                        return;
                    }
                    var full = [];
                    for (var i = 0; i < chats.length; i++) {
                        var chat = chats[i];
                        if (progress) progress.textContent = '正在导出 ' + (i + 1) + ' / ' + chats.length + '…';
                        try {
                            var dResp = await fetch(SUPABASE_URL + '/functions/v1/chat-gateway', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
                                body: JSON.stringify({ endpoint: 'chat_history', action: 'get', id: chat.id, __auth_token: token })
                            });
                            var dJson = await dResp.json().catch(function () { return {}; });
                            full.push({ id: chat.id, title: chat.title || '', created_at: chat.created_at, updated_at: chat.updated_at, messages: (dJson.data && dJson.data.messages) || [] });
                        } catch (e) {
                            full.push({ id: chat.id, title: chat.title || '', created_at: chat.created_at, updated_at: chat.updated_at, messages: [], _error: String(e.message || e) });
                        }
                        if (i < chats.length - 1) await new Promise(function (r) { setTimeout(r, 120); });
                    }
                    var blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = 'cancri_chats_' + new Date().toISOString().slice(0, 10) + '.json';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    if (progress) progress.textContent = '导出完成：共 ' + full.length + ' 条对话。';
                } catch (err) {
                    console.error('export:', err);
                    if (progress) progress.textContent = '导出失败：' + (err.message || '未知错误');
                } finally {
                    exportBtn.disabled = false;
                }
            });
        }

        var clearBtn = document.getElementById('claudeClearLocalBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                if (!confirm('确定要清除本地聊天记录缓存吗？这不会删除服务器上的记录。')) return;
                try {
                    localStorage.removeItem('cancri_chat_history_list_cache_v1');
                    localStorage.removeItem('cancri_pinned_chats');
                    alert('本地缓存已清除。');
                } catch (e) {
                    alert('清除失败：' + (e.message || '未知错误'));
                }
            });
        }
    }
})();

// ── T5：composer 图标按钮自定义 tooltip（hover 2s 后出现）──
// 用 aria-label 当提示文案，事件委托覆盖动态注入的按钮（项目内 composer 等）。
// 对应原生 title 已从 HTML 移除，避免双重 tooltip。
(function initComposerTooltips() {
    'use strict';
    var SEL = '.composer-tools-row button[aria-label], .composer button[aria-label]';
    var DELAY = 2000;
    var tip = null;
    var timer = null;
    var current = null;

    function ensureTip() {
        if (tip) return tip;
        tip = document.createElement('div');
        tip.id = 'cancriTip';
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
        return tip;
    }

    function show(btn) {
        var label = btn.getAttribute('aria-label');
        if (!label) return;
        var t = ensureTip();
        t.textContent = label;
        t.style.left = '0px';
        t.style.top = '0px';
        var r = btn.getBoundingClientRect();
        var tr = t.getBoundingClientRect();
        var left = r.left + r.width / 2 - tr.width / 2;
        var top = r.top - tr.height - 8;
        left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
        if (top < 6) top = r.bottom + 8;
        t.style.left = left + 'px';
        t.style.top = top + 'px';
        t.classList.add('show');
    }

    function hide() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (current && current.__cancriTitle != null) {
            current.setAttribute('title', current.__cancriTitle);
            current.__cancriTitle = null;
        }
        current = null;
        if (tip) tip.classList.remove('show');
    }

    document.addEventListener('mouseover', function (e) {
        var btn = e.target.closest && e.target.closest(SEL);
        if (!btn || btn === current) return;
        hide();
        current = btn;
        // 暂存并摘掉原生 title，避免浏览器 ~1s 原生提示与 2s 自定义 tooltip 双重出现。
        if (btn.hasAttribute('title')) {
            btn.__cancriTitle = btn.getAttribute('title');
            btn.removeAttribute('title');
        }
        timer = setTimeout(function () {
            if (current === btn) show(btn);
        }, DELAY);
    });
    document.addEventListener('mouseout', function (e) {
        var btn = e.target.closest && e.target.closest(SEL);
        if (!btn) return;
        if (e.relatedTarget && btn.contains(e.relatedTarget)) return;
        hide();
    });
    document.addEventListener('click', hide, true);
    window.addEventListener('scroll', hide, true);
})();
