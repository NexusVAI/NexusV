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
            const star = '<span class="hero-star" aria-hidden="true">\u2731</span>';
            if (!nick) {
                hero.innerHTML = star + greet;
                return;
            }
            const safeNick = nick.replace(/[<>&"']/g, function (c) {
                return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c];
            });
            hero.innerHTML = star + greet + '，' + safeNick;
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

    // 3. "自定义" nav-row → 切到 claudeSettings view（不再用老的 modal）
    function bindCustomNav() {
        document.querySelectorAll('[data-claude-action="open-settings"]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
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
            });
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

    // 5. Plan pill toast
    function bindPlanPill() {
        const pill = document.getElementById('claudePlanPill');
        if (!pill) return;
        pill.addEventListener('click', function (e) {
            e.preventDefault();
            showToast('升级到 Cancri Pro 以解锁更多模型');
        });
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

    // 11. + 按钮自定义菜单（Claude 风格）：拦截 #attachBtn click，
    //     弹出小菜单替代直接打开文件选择器。
    //     菜单项：添加文件或照片 / 网络搜索 toggle / 截图占位。
    //     模块化解耦：不修改 cancri_chat.js 的事件绑定，用 capture-phase
    //     拦截，菜单项手动触发 attachmentInput.click() 或 webSearchToggle.click()。
    function bindAttachMenu() {
        const attachBtn = document.getElementById('attachBtn');
        const fileInput = document.getElementById('attachmentInput');
        const webBtn = document.getElementById('webSearchToggle');
        if (!attachBtn || !fileInput) return;

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
            const rect = attachBtn.getBoundingClientRect();
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

        // 拦截 attachBtn click（capture phase + stop），阻止 cancri 直接打开文件选择器
        attachBtn.addEventListener('click', function (e) {
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
            if (attachBtn.contains(e.target)) return;
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

    // 12. 模型 dropdown "更多模型" 折叠：默认只显示当前选中模型 +
    //     一个 "更多模型 →" 行；hover/click 该行后展开全部模型。
    //     不重写 cancri 的 renderModelDropdownFromCatalog，只在 dropdown
    //     打开时注入 "更多模型" 行并切换 dropdown 上的 collapse class。
    //     搜索框有内容时自动展开全部（兼容 cancri 的 filter）。
    function bindModelMoreMenu() {
        const dropdown = document.getElementById('modelDropdown');
        if (!dropdown) return;
        const content = document.getElementById('modelDropdownContent');
        const searchInput = document.getElementById('modelSearchInput');
        if (!content) return;

        // 注入 "更多模型 →" 行（在 modelDropdownContent 之后兄弟位置）
        let moreRow = dropdown.querySelector('.claude-more-models-row');
        if (!moreRow) {
            moreRow = document.createElement('div');
            moreRow.className = 'claude-more-models-row';
            moreRow.setAttribute('role', 'menuitem');
            moreRow.innerHTML = '<span class="claude-more-models-label">更多模型</span>'
                + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
            // 紧跟 content 之后插入
            content.parentNode.insertBefore(moreRow, content.nextSibling);
        }

        // 默认折叠：dropdown 加 class，CSS 控制隐藏非 active 项
        dropdown.classList.add('claude-collapsed-models');

        function expand() {
            dropdown.classList.add('claude-show-extras');
        }
        function collapse() {
            dropdown.classList.remove('claude-show-extras');
        }

        // hover "更多模型" 展开
        moreRow.addEventListener('mouseenter', expand);
        // mobile 触摸：点击展开
        moreRow.addEventListener('click', function (e) {
            e.stopPropagation();
            expand();
        });

        // 鼠标离开整个 dropdown 收起（给用户回去看 active 项的余地）
        dropdown.addEventListener('mouseleave', collapse);

        // 搜索框有内容时自动展开（让 cancri 的 filter 正常工作）
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                if (searchInput.value.trim()) {
                    expand();
                } else {
                    collapse();
                }
            });
        }

        // dropdown 关闭时重置 collapse 状态
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(function () {
                if (dropdown.hidden) {
                    collapse();
                    if (searchInput) searchInput.value = '';
                }
            }).observe(dropdown, { attributes: true, attributeFilter: ['hidden'] });
        }

        // cancri 每次 openModelDropdown 后会重新渲染 .model-option，重新插入 moreRow
        // 到末尾确保它在 dropdown 关闭后再打开仍在末尾。
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(function () {
                if (moreRow.parentNode !== content.parentNode
                    || moreRow.previousSibling !== content) {
                    content.parentNode.insertBefore(moreRow, content.nextSibling);
                }
            }).observe(content, { childList: true });
        }
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
