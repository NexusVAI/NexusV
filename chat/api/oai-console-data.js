/**
 * NexusVAI API console — auth + wallet/usage/keys/logs on SingleFile snapshots.
 */
(function () {
  "use strict";

  var PAGE = document.body.getAttribute("data-console-page") || "overview";
  var GW =
    (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") +
    "/functions/v1/chat-gateway";
  // 余额 ≥ 1 元就算健康：不再刷黄底、不再显示告警三角
  var WALLET_LOW_THRESHOLD = 1;
  var HIDE_NAV = [
    "Chat",
    "Audio",
    "Images",
    "Codex",
    "Batches",
    "Storage",
    "ChatGPT Apps",
    "Settings",
  ];

  // 2026-09-07：这里原本有一套从桌面端 cancri-code/src/ui/squircle-path.ts 搬来的
  // 苹果式平滑圆角（clip-path + 贝塞尔，smoothing 0.6），给弹窗和账号菜单用。已删。
  // 原因：半径只有 12–14px 时那条曲线几乎贴着直边走（实测 r=14 时前 15px 只下沉
  // 1.5px），肉眼就是方角——工单原话「圆角去哪里了」；而且 clip-path 会把 1px 描边
  // 的四个角一起裁掉，还得把 box-shadow 换成 drop-shadow 才不被裁。现在圆角一律由
  // CSS border-radius 给（console.css 的 .cs-modal / .cs-select__menu 等）。
  // ⛔ 想重新引入的话，半径要 ≥24px 才看得出「平滑」，别再按 12/14 挂。

  function detectLang() {
    // 控制台产品文案以中文为准；localStorage.lang=en 仍可强制英文模态框。
    try {
      var saved = localStorage.getItem("lang");
      if (saved === "en") return "en";
    } catch (e) {}
    return "zh";
  }

  var LANG = detectLang();

  var LABELS = {
    credit: ["Credit remaining", "剩余额度"],
    requests: ["Total requests", "总请求数"],
    // dump 已是「总 token 数」小写；locale 曾写「总 Token 数」需兼容两边
    tokens: ["Total tokens", "总 token 数", "总 Token 数"],
    spend: ["Total Spend", "总消耗"],
    responses: [
      "Responses and Chat Completions",
      "Responses 与 Chat Completions",
      "响应与 Chat Completions",
    ],
    balance: ["Current balance", "当前余额", "Wallet Balance", "钱包余额"],
  };

  var SIDEBAR_KEY = "nexusv_console_sidebar";
  var THEME_KEY_INDEX = "theme";
  var THEME_KEY_OAI = "cancri_oai_theme";

  // Pre-paint theme (script is at end of body; still beats late paint of data cards).
  (function earlyTheme() {
    try {
      var raw = localStorage.getItem(THEME_KEY_INDEX);
      var t =
        raw === "light"
          ? "light"
          : raw === "dark" || raw === "warm" || raw === "blue"
            ? "dark"
            : localStorage.getItem(THEME_KEY_OAI) === "light"
              ? "light"
              : "dark";
      if (t === "light") {
        document.documentElement.classList.remove("dark");
        document.documentElement.setAttribute("data-theme", "light");
      } else {
        document.documentElement.classList.add("dark");
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch (e) {}
  })();

  function revealL10n() {
    document.documentElement.setAttribute("data-cnc-l10n", "1");
  }

  // 正文是英文 OAI dump，汉化靠 JS 改文本节点。
  // 先藏 #root；必须等 requireSession 成功才 reveal。禁止定时放出——否则未登录也能看见控制台。
  (function earlyL10nGate() {
    try {
      var s = document.createElement("style");
      s.id = "nexusv-l10n-gate";
      s.textContent = "html:not([data-cnc-l10n]) #root{visibility:hidden!important}";
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  var FEATURED_MODELS = [
    {
      id: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      desc: "Anthropic 旗舰，适合复杂推理与长任务",
    },
    {
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      desc: "OpenAI 编程与专业工作主力",
    },
    {
      id: "grok-4.5",
      name: "Grok 4.5",
      desc: "xAI 高速多模态模型",
    },
    {
      id: "gemini-3.6-flash",
      name: "Gemini 3.6 Flash",
      desc: "Google 轻量快速，按次计费",
    },
  ];

  var I18N = {
    en: {
      cancel: "Cancel",
      confirm: "Confirm",
      create: "Create",
      creating: "Creating…",
      createKeyTitle: "Create new secret key",
      keyNameLabel: "Key name (optional)",
      keyGroupLabel: "Model group (optional)",
      keyGroupAny: "All models (no restriction)",
      keyGroupHint:
        "Pick a group and this key may only call models in that group; other models return 403. Leave it on \u201CAll models\u201D to skip.",
      keyGroupTag: "Group: ",
      keyCreatedTitle: "Secret key created",
      keyCreatedHint: "Copy now — you won't see it again.",
      copy: "Copy",
      close: "Close",
      revokeTitle: "Revoke key",
      revokeHint: "Revoke this key? This cannot be undone.",
      revoke: "Revoke",
      revoking: "Revoking…",
      revokeFailed: "Revoke failed: ",
      createFailed: "Create failed: ",
      time: "Time",
      model: "Model",
      status: "Status",
      authLoadFail: "Failed to load auth scripts. Check network and refresh.",
      // 密钥页搜索 / 筛选（2026-09-07）
      searchPlaceholder: "Search...",
      searchAria: "Search API keys",
      results: "{n} results",
      resultsOf: "{n} of {total} results",
      noMatch: "No keys match the current filters.",
      callsN: "{n} calls",
      clearFilter: "Clear filter",
      fAny: "Any",
      fReset: "Reset",
      fDone: "Done",
      fGroupTitle: "Model group",
      fGroupAny: "All keys",
      fGroupLimited: "Group-restricted only",
      fGroupUnlimited: "Unrestricted only",
      fAgeTitle: "Created",
      fAgeBeforeOpt: "Older than N days",
      fAgeAfterOpt: "Within the last N days",
      fAgeBefore: "Older than {n} days",
      fAgeAfter: "Created in last {n} days",
      fDaysUnit: "days ago",
      fCallsTitle: "Request count",
      fCallsMostOpt: "Top N most used",
      fCallsLeastOpt: "Top N least used",
      fCallsMost: "Top {n} most used",
      fCallsLeast: "Top {n} least used",
      fKeysUnit: "keys",
      rangeAll: "All",
    },
    zh: {
      cancel: "取消",
      confirm: "确认",
      create: "创建",
      creating: "创建中…",
      createKeyTitle: "创建新密钥",
      keyNameLabel: "密钥名称（可选）",
      keyGroupLabel: "指定分组（可选）",
      keyGroupAny: "全部模型（不限制）",
      keyGroupHint:
        "选定分组后，此密钥只能调用该分组内的模型，调其它模型返回 403。保持「全部模型」即跳过此限制。",
      keyGroupTag: "分组：",
      keyCreatedTitle: "密钥已创建",
      keyCreatedHint: "请立即复制，关闭后将无法再次查看。",
      copy: "复制",
      close: "关闭",
      revokeTitle: "撤销密钥",
      revokeHint: "确认撤销此密钥？此操作不可恢复。",
      revoke: "撤销",
      revoking: "撤销中…",
      revokeFailed: "撤销失败：",
      createFailed: "创建失败：",
      time: "时间",
      model: "模型",
      status: "状态",
      authLoadFail: "依赖脚本加载失败，请检查网络后刷新。",
      // 密钥页搜索 / 筛选（2026-09-07）
      searchPlaceholder: "搜索名称或前缀…",
      searchAria: "搜索 API 密钥",
      results: "{n} 条结果",
      resultsOf: "{n} / {total} 条结果",
      noMatch: "没有符合当前筛选条件的密钥。",
      callsN: "调用 {n} 次",
      clearFilter: "清除该筛选",
      fAny: "不限",
      fReset: "重置",
      fDone: "完成",
      fGroupTitle: "分组限制",
      fGroupAny: "全部密钥",
      fGroupLimited: "仅限定分组的",
      fGroupUnlimited: "仅不限定分组的",
      fAgeTitle: "创建时间",
      fAgeBeforeOpt: "早于 N 天前创建",
      fAgeAfterOpt: "晚于 N 天前创建",
      fAgeBefore: "早于 {n} 天前创建",
      fAgeAfter: "晚于 {n} 天前创建",
      fDaysUnit: "天前",
      fCallsTitle: "调用次数",
      fCallsMostOpt: "调用最多的前 N 把",
      fCallsLeastOpt: "调用最少的前 N 把",
      fCallsMost: "调用最多的前 {n} 把",
      fCallsLeast: "调用最少的前 {n} 把",
      fKeysUnit: "把密钥",
      rangeAll: "全部",
    },
  };

  function t(key) {
    var pack = I18N[LANG] || I18N.en;
    return pack[key] || I18N.en[key] || key;
  }

  function applyPageLocale() {
    document.documentElement.lang = "zh-CN";
    var pairs = [
      ["Credit remaining", "剩余额度"],
      ["Total requests", "总请求数"],
      ["Total tokens", "总 Token 数"],
      ["Total Spend", "总消耗"],
      ["Current balance", "当前余额"],
      ["Wallet Balance", "钱包余额"],
      ["API Keys", "API 密钥"],
      ["API keys", "API 密钥"],
      ["Usage", "用量"],
      ["Logs", "日志"],
      ["Home", "首页"],
      ["Billing", "结算"],
      ["Default project", "默认项目"],
      ["Organization", "个人版"],
      ["Create new secret key", "创建新密钥"],
      ["Create an API key to access the NexusVAI API", "创建 API 密钥以调用 NexusVAI API"],
      ["Add credits", "充值"],
      ["Overview", "概览"],
      ["Explore in playground", "在对话中打开"],
      ["Read the docs", "了解怎么使用"],
      ["We've cleaned things up", "导航已整理"],
      ["Explore what's changed with the redesigned navigation.", "看看新版导航有哪些变化。"],
      ["Explore what's changed with the redesigned navigation", "看看新版导航有哪些变化"],
      ["Learn more", "了解更多"],
      ["API Key Usage", "密钥用量"],
      ["Search...", "搜索…"],
      ["Active", "有效"],
      ["+ Add filter", "+ 添加筛选"],
      ["Add filter", "添加筛选"],
      ["0 results", "0 条结果"],
      ["Responses and Chat Completions", "响应与 Chat Completions"],
      ["Responses 与 Chat Completions", "响应与 Chat Completions"],
      ["Recommended", "推荐模型"],
      ["Updates", "更新"],
      ["June spend", "本月消耗"],
      ["Personal", "个人"],
      ["Revoke", "撤销"],
      // 用量页
      ["API capabilities", "API 能力"],
      ["Spend categories", "消耗分类"],
      ["Group by", "分组方式"],
      ["Users", "用户"],
      ["Services", "服务"],
      ["Manage", "管理"],
      ["Cost", "花费"],
      ["Model", "模型"],
      ["Project", "项目"],
      ["All", "全部"],
      ["Today", "今天"],
      ["This month", "本月"],
      ["Last 30 days", "近 30 天"],
      ["There is no usage data for this period and group.", "该时间段内没有用量数据。"],
      ["No data available", "暂无数据"],
      ["Export", "导出"],
      // 首页工具卡
      ["Search the web in real-time", "实时联网搜索"],
      ["Upload, manage, and attach skills", "上传、管理并挂载技能"],
      // 日志页
      ["Responses", "响应"],
      ["Completions", "补全"],
      ["Agent Traces", "智能体追踪"],
      ["Conversations", "会话"],
      ["ChatKit Threads", "ChatKit 线程"],
      ["Your Responses will appear here", "这里会显示你的调用记录"],
      ["Use the Responses API to view your logs.", "调用 API 后即可在此查看日志。"],
      ["用 Codex 开始构建", "用Cancri Code 开始构建"],
      ["用 NexusVAI 构建", "由NexusVAI构建"],
    ];
    pairs.forEach(function (p) {
      replaceAllText(p[0], p[1]);
    });
    var titles = {
      overview: "首页 · NexusVAI API",
      usage: "用量 · NexusVAI API",
      logs: "日志 · NexusVAI API",
      keys: "API 密钥 · NexusVAI API",
      billing: "结算 · NexusVAI API",
    };
    if (titles[PAGE]) document.title = titles[PAGE];
    localizePatterns();
  }

  var MONTH_ZH = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  };

  // 数量随数据变化，固定串对不上，只能按模式改
  var TEXT_PATTERNS = [
    [/^([\d,.]+)\s+requests?$/, "$1 次请求"],
    [/^([\d,.]+)\s+input tokens?$/, "$1 输入 Token"],
    [/^([\d,.]+)\s+output tokens?$/, "$1 输出 Token"],
    [/^([\d,.]+)\s+tokens?$/, "$1 Token"],
    [/^([\d,.]+)\s+images?$/, "$1 张图"],
    [/^([\d,.]+)\s+results?$/, "$1 条结果"],
    [/^([\d,.]+)\s+keys?$/, "$1 个密钥"],
  ];

  // 带序号/前后缀的节点（如 "3. Add credits"）整串对不上，只能按子串换
  var TEXT_CONTAINS = [
    ["Create an API key", "创建 API 密钥"],
    ["Test models", "试用模型"],
    ["Add credits", "充值"],
    ["Dismiss", "关闭"],
    ["Get started", "开始使用"],
    ["View all", "查看全部"],
    ["See all", "查看全部"],
    ["Copy", "复制"],
    ["Close", "关闭"],
  ];

  function localizePatterns() {
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    var node;
    while ((node = walker.nextNode())) {
      var raw = node.nodeValue;
      if (!raw) continue;
      var s = raw.trim();
      if (!s || s.length > 60 || !/[A-Za-z]/.test(s)) continue;
      if (s.length <= 60) {
        var sub = raw;
        for (var c = 0; c < TEXT_CONTAINS.length; c++) {
          if (sub.indexOf(TEXT_CONTAINS[c][0]) >= 0) {
            sub = sub.split(TEXT_CONTAINS[c][0]).join(TEXT_CONTAINS[c][1]);
          }
        }
        if (sub !== raw) {
          node.nodeValue = sub;
          continue;
        }
      }
      if (s.length > 40) continue;
      var next = null;
      for (var i = 0; i < TEXT_PATTERNS.length; i++) {
        if (TEXT_PATTERNS[i][0].test(s)) {
          next = s.replace(TEXT_PATTERNS[i][0], TEXT_PATTERNS[i][1]);
          break;
        }
      }
      if (next === null) {
        var m = s.match(/^([A-Z][a-z]{2})\s+(\d{1,2})$/);
        if (m && MONTH_ZH[m[1]]) next = MONTH_ZH[m[1]] + "月" + Number(m[2]) + "日";
      }
      if (next !== null && next !== s) node.nodeValue = raw.replace(s, next);
    }
  }

  // 只做 Chat/Responses：dump 里其余能力卡是死数据，留着误导用户
  var USAGE_DEAD_CARDS = [
    "Images",
    "Web Searches",
    "File Searches",
    "Moderation",
    "Embeddings",
    "Audio Speeches",
    "Audio Transcriptions",
    "Vector Stores",
    "Code Interpreter Sessions",
  ];

  // 用量页仅存的那张能力卡里是 dump 的死 0，用真实聚合值填掉
  function fillUsageCapabilityCard(agg) {
    if (PAGE !== "usage" || !agg) return;
    var card = document.querySelector(
      ".rounded-lg.border.border-solid.border-default.p-4"
    );
    if (!card) return;
    var walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var s = (node.nodeValue || "").trim();
      if (/^[\d,.]+\s*次请求$/.test(s)) {
        node.nodeValue = nf(agg.totalRequests) + " 次请求";
      } else if (/^[\d,.]+\s*输入 Token$/.test(s)) {
        node.nodeValue = nf(agg.totalTokens) + " Token";
      }
    }
  }

  function stripDeadUsageBlocks() {
    if (PAGE !== "usage") return;
    document
      .querySelectorAll(".rounded-lg.border.border-solid.border-default.p-4")
      .forEach(function (card) {
        var head = card.firstElementChild;
        if (!head) return;
        var title = (head.textContent || "").replace(/\s+/g, " ").trim();
        if (USAGE_DEAD_CARDS.indexOf(title) >= 0) card.remove();
      });
    // 右侧「按用户/服务/密钥分组」面板后端没有对应数据源，永远是空态
    document.querySelectorAll(".cmy7W").forEach(function (panel) {
      if (/There is no usage data|该时间段内没有用量数据/.test(panel.textContent || "")) {
        panel.style.display = "none";
      }
    });
  }

  function trimSidebar() {
    document.querySelectorAll("a.HPtRB.O3ygq").forEach(function (a) {
      var label = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (HIDE_NAV.indexOf(label) >= 0) a.remove();
    });
    document.querySelectorAll('button.HPtRB.O3ygq[aria-label*="More"]').forEach(function (b) {
      b.remove();
    });
  }

  // SingleFile 快照里的「界面已焕然一新」等 Dismiss 按钮没有 React 处理器，点了无反应。
  var NAV_UPDATE_SEEN_KEY = "nexusv_console_nav_update_dismissed_v1";
  var UPDATE_DISMISS_KEY = "nexusv_console_update_dismissed_v1";

  function hideEl(node) {
    if (!node) return;
    node.style.display = "none";
    node.setAttribute("hidden", "");
  }

  function wireStaticDismissers() {
    // 硬化：.lkCln:before 铺满按钮但未 pointer-events:none，部分环境下会吃掉点击
    if (!document.getElementById("nexusv-console-dismiss-fix")) {
      var s = document.createElement("style");
      s.id = "nexusv-console-dismiss-fix";
      s.textContent =
        ".lkCln:before{pointer-events:none!important}" +
        'button[aria-label="Dismiss navigation update"],' +
        'button[aria-label^="Dismiss update:"]{position:relative;z-index:2;pointer-events:auto}';
      document.head.appendChild(s);
    }

    var navBtn = document.querySelector(
      'button[aria-label="Dismiss navigation update"]'
    );
    if (navBtn) {
      var navCard =
        navBtn.closest(".a6re5") ||
        navBtn.closest(".rxdQY") ||
        navBtn.closest("._3eq3b");
      try {
        if (localStorage.getItem(NAV_UPDATE_SEEN_KEY) === "1") hideEl(navCard);
      } catch (_e) {}
      if (navCard && !navBtn.__nexusvDismissBound) {
        navBtn.__nexusvDismissBound = true;
        navBtn.addEventListener(
          "click",
          function (e) {
            e.preventDefault();
            e.stopPropagation();
            try {
              localStorage.setItem(NAV_UPDATE_SEEN_KEY, "1");
            } catch (_e2) {}
            hideEl(navCard);
          },
          true
        );
      }
    }

    var dismissed = {};
    try {
      dismissed = JSON.parse(localStorage.getItem(UPDATE_DISMISS_KEY) || "{}") || {};
    } catch (_e3) {
      dismissed = {};
    }
    document.querySelectorAll('button[aria-label^="Dismiss update:"]').forEach(function (btn) {
      var label = btn.getAttribute("aria-label") || "";
      var row = btn.closest("._8lZuy") || btn.parentElement;
      if (dismissed[label]) hideEl(row);
      if (!row || btn.__nexusvDismissBound) return;
      btn.__nexusvDismissBound = true;
      btn.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopPropagation();
          dismissed[label] = 1;
          try {
            localStorage.setItem(UPDATE_DISMISS_KEY, JSON.stringify(dismissed));
          } catch (_e4) {}
          hideEl(row);
        },
        true
      );
    });
  }

  function ensureConsoleCss() {
    if (document.querySelector('link[href*="console.css"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "console.css?v=20260907-keyfilters";
    document.head.appendChild(l);
  }

  function nf(n) {
    return (Number(n) || 0).toLocaleString();
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function fmtMoney(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    return "¥" + n.toFixed(2);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    } else {
      var t = el("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try {
        document.execCommand("copy");
      } catch (e) {}
      t.remove();
    }
  }

  async function getSession() {
    return window.PlatformAuth.getSession(6000);
  }

  async function call(endpoint, payload) {
    var s = await getSession();
    if (!s) throw new Error("not_logged_in");
    var r = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.__SUPABASE_ANON_KEY__,
      },
      body: JSON.stringify(
        Object.assign({ endpoint: endpoint }, payload || {}, {
          __auth_token: s.access_token,
        })
      ),
    });
    var d = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      throw Object.assign(new Error(d.message || d.error || r.statusText), {
        status: r.status,
        body: d,
      });
    }
    return d;
  }

  function findTextNodes(text, root) {
    var out = [];
    var walker = document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (n.nodeValue && n.nodeValue.trim() === text) out.push(n);
    }
    return out;
  }

  function setValueNearLabel(label, value) {
    return setValueNearLabels([label], value);
  }

  function setValueNearLabels(labels, value) {
    var applied = false;
    for (var li = 0; li < labels.length; li++) {
      findTextNodes(labels[li]).forEach(function (textNode) {
        var card =
          textNode.parentElement &&
          (textNode.parentElement.closest(".flex.h-full.flex-col") ||
            textNode.parentElement.closest("[class*='flex-col']") ||
            textNode.parentElement.closest(
              "[data-testid='organization-spend-summary-section']"
            ));
        if (!card) return;
        var valEl =
          card.querySelector(".text-lg.font-semibold") ||
          card.querySelector(".text-xl.font-semibold") ||
          card.querySelector(".font-semibold");
        if (!valEl) return;
        var textChild = null;
        for (var i = 0; i < valEl.childNodes.length; i++) {
          if (valEl.childNodes[i].nodeType === 3) {
            textChild = valEl.childNodes[i];
            break;
          }
        }
        if (textChild) textChild.nodeValue = String(value) + " ";
        else valEl.textContent = String(value);
        applied = true;
      });
    }
    return applied;
  }

  function findStatCard(labels) {
    for (var li = 0; li < labels.length; li++) {
      var nodes = findTextNodes(labels[li]);
      for (var i = 0; i < nodes.length; i++) {
        var root =
          nodes[i].parentElement &&
          nodes[i].parentElement.closest(".flex.h-full.flex-col");
        if (root) return root;
      }
    }
    return null;
  }

  function replaceAllText(oldText, newText) {
    findTextNodes(oldText).forEach(function (n) {
      n.nodeValue = newText;
    });
  }

  function patchBuildWithCards() {
    document.querySelectorAll("a.fSPaI").forEach(function (a) {
      var title = a.querySelector("p.text-sm");
      var sub = a.querySelector("p.text-xs");
      if (title) {
        Array.prototype.forEach.call(title.childNodes, function (n) {
          if (n.nodeType !== 3 || !n.nodeValue) return;
          if (n.nodeValue.indexOf("用 Codex 开始构建") >= 0) {
            n.nodeValue = n.nodeValue.split("用 Codex 开始构建").join("用Cancri Code 开始构建");
          }
        });
      }
      if (sub && (sub.textContent || "").trim() === "用 NexusVAI 构建") {
        sub.textContent = "由NexusVAI构建";
      }
    });
  }

  /**
   * 「快速开始」标题右边那个「× 关闭」删掉。
   * 它是快照里的静态 span[role=button]，没有 React 处理器，点了什么都不会发生 ——
   * 留着就是个死控件。整个 .UXT3g 容器一起删（里面只有它）。
   */
  function stripQuickStartClose() {
    if (PAGE !== "overview") return;
    document.querySelectorAll("h2.oALpN").forEach(function (h) {
      var txt = (h.textContent || "").trim();
      if (txt !== "快速开始" && txt.indexOf("Get started") < 0) return;
      var head = h.parentElement;
      if (!head) return;
      head.querySelectorAll(".UXT3g").forEach(function (n) {
        n.remove();
      });
    });
  }

  /**
   * 「用 Cancri Code 开始构建」暂时不可用：变淡 + 完全不可交互。
   * 只加 pointer-events:none 挡不住键盘 —— <a href> 仍然能被 Tab 选中并回车打开，
   * 所以这里把 href 一起摘掉；文字选中由 CSS 的 user-select:none 管。
   */
  function dimComingSoonCards() {
    if (PAGE !== "overview") return;
    document.querySelectorAll("a.fSPaI").forEach(function (a) {
      if (!/Cancri Code|用 Codex 开始构建/.test(a.textContent || "")) return;
      if (a.dataset.cncDisabled === "1") return;
      a.dataset.cncDisabled = "1";
      a.classList.add("cnc-card-disabled");
      a.removeAttribute("href");
      a.removeAttribute("target");
      a.removeAttribute("rel");
      a.setAttribute("aria-disabled", "true");
      a.tabIndex = -1;
    });
  }

  // 2026-08-15：左下角显示**完整邮箱**并支持点击复制。
  //
  // 为什么不把聊天页的设置面板搬过来：活面板是 #claudeSettingsView，由 claude_ui.js
  // 的 openClaudeSettingsModal 驱动，依赖 window.setActiveView / window.CancriApp
  // （主题、记忆、用量）。控制台各页根本不加载 claude_ui.js 与 CancriApp，
  // 整块搬等于把聊天页一半依赖拖进来；且 OAI 控制台的 HIDE_NAV 本就含 "Settings"。
  // 因此这里只做：完整邮箱 + 一键复制 + 跳转到聊天页设置（deep-link，复用既有 UI）。
  var CHAT_SETTINGS_URL = "../index.html#settings";

  function updateUserChip(user) {
    var email = (user && user.email) || "";
    var name = email.split("@")[0] || "User";
    var initial = name.charAt(0).toUpperCase() || "U";
    // ⛔ 必须同时替换英文原文与已汉化的「个人」（2026-08-15 实测 bug）：
    // boot 里 applyPageLocale() 先跑（:1488）把 "Personal" 换成 "个人"，
    // updateUserChip 后跑（:1496）再找 "Personal" 就已经找不到了 → 芯片永远停在「个人」。
    // oai-billing.js 里的调用顺序恰好相反（先 chip 后 locale），所以两个页面表现不同。
    // 这里对两种文案都替换，让结果与调用顺序无关。
    replaceAllText("Personal", email || name);
    replaceAllText("个人", email || name);
    document.querySelectorAll("span, div").forEach(function (node) {
      if (node.childNodes.length === 1 && node.textContent === "P") {
        node.textContent = initial;
      }
    });
    if (email) decorateUserChip(email);
  }

  /**
   * 给左下角芯片挂「复制邮箱 / 打开设置」。
   * 芯片是页面快照里的静态 DOM（button._1xLkN 在 div._8xLvG 内），没有框架事件，
   * 直接委托到它的祖先容器即可；重复调用用 dataset 标记防止叠加多个 listener。
   */
  function decorateUserChip(email) {
    var box = document.querySelector("._8xLvG");
    if (!box || box.dataset.ccChipBound === "1") return;
    box.dataset.ccChipBound = "1";
    box.style.cursor = "pointer";
    box.title = "账号菜单";
    box.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleChipMenu(box, email);
    });
  }

  /**
   * 左下角账号菜单。
   * 为什么是自绘小菜单而不是把聊天页的设置面板搬过来：活面板是 #claudeSettingsView，
   * 由 claude_ui.js 的 openClaudeSettingsModal 驱动，依赖 window.CancriApp
   * （主题 / 记忆 / 用量）。控制台各页都不加载 claude_ui.js 与 CancriApp，
   * 整块搬等于把聊天页一半依赖拖进来。因此这里只做入口，真正的设置仍是聊天页那一套。
   */
  var chipMenuEl = null;
  function toggleChipMenu(anchor, email) {
    if (chipMenuEl) { closeChipMenu(); return; }
    var items = [
      { label: "复制邮箱", sub: email, act: function () { copyText(email); flashChipHint(anchor, "已复制邮箱"); } },
      { label: "账号设置", sub: "在聊天页打开", act: function () { window.location.href = CHAT_SETTINGS_URL + "&pane=account"; } },
      // 2026-08-18 晚：邀请奖励从「重置卡」改为「¥1 API 额度」；「重置卡」这一项
      // 整条删除（重置卡系统下线，billing.html#reset 已不存在）。
      { label: "邀请奖励", sub: "邀请好友得 ¥1 API 额度", act: function () { window.location.href = CHAT_SETTINGS_URL + "&pane=invite"; } },
      { label: "退出登录", sub: "", act: function () { doSignOut(); } },
    ];
    var m = el("div");
    m.setAttribute("data-cnc-chip-menu", "1");
    m.style.cssText =
      "position:fixed;z-index:99998;min-width:236px;padding:6px;border-radius:12px;" +
      "background:var(--color-surface,#fff);color:var(--color-text,#0d0d0d);" +
      "border:1px solid var(--color-border,#e5e5e2);box-shadow:0 12px 32px rgba(0,0,0,.18)";
    items.forEach(function (it) {
      var row = el("div");
      row.style.cssText =
        "padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;flex-direction:column;gap:2px";
      var t = el("div"); t.textContent = it.label; t.style.cssText = "font-size:13px;font-weight:600";
      row.appendChild(t);
      if (it.sub) {
        var s = el("div");
        s.textContent = it.sub;
        s.style.cssText =
          "font-size:11.5px;color:var(--color-text-secondary,#6b6b6b);overflow:hidden;" +
          "text-overflow:ellipsis;white-space:nowrap;max-width:210px";
        row.appendChild(s);
      }
      row.addEventListener("mouseenter", function () {
        row.style.background = "var(--color-background-primary-soft,rgba(128,128,128,.10))";
      });
      row.addEventListener("mouseleave", function () { row.style.background = "transparent"; });
      row.addEventListener("click", function (ev) { ev.stopPropagation(); closeChipMenu(); it.act(); });
      m.appendChild(row);
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    // 菜单向上弹（芯片在视口底部，向下会被裁）
    m.style.left = Math.round(r.left) + "px";
    m.style.top = Math.max(8, Math.round(r.top - m.offsetHeight - 8)) + "px";
    chipMenuEl = m;
    setTimeout(function () { document.addEventListener("click", closeChipMenu, { once: true }); }, 0);
  }

  function closeChipMenu() {
    if (!chipMenuEl) return;
    chipMenuEl.remove();
    chipMenuEl = null;
  }

  // ⚠️ PlatformAuth 只导出 resolveLoginUrl / redirectToLogin / hide / showAuthError /
  // getSupabase / getSession / isValidSession / requireSession（platform-auth.js:101-110），
  // **没有 signOut**。所以走 supabase client 自己的 signOut，别去调不存在的方法。
  function doSignOut() {
    var done = function () { window.location.href = "../index.html"; };
    try {
      var sb = window.PlatformAuth && window.PlatformAuth.getSupabase && window.PlatformAuth.getSupabase();
      if (sb && sb.auth && typeof sb.auth.signOut === "function") {
        sb.auth.signOut().then(done, done);
        return;
      }
    } catch (e) { /* 落到兜底：至少把人送回首页 */ }
    done();
  }

  function flashChipHint(anchor, text) {
    var tip = el("div");
    tip.textContent = text;
    tip.style.cssText =
      "position:fixed;z-index:99999;padding:6px 10px;border-radius:8px;font-size:12px;" +
      "background:var(--color-background-primary-solid,#0d0d0d);color:var(--color-text-primary-solid,#fff);" +
      "pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.18)";
    document.body.appendChild(tip);
    var r = anchor.getBoundingClientRect();
    tip.style.left = Math.round(r.left + 8) + "px";
    tip.style.top = Math.round(r.top - 34) + "px";
    setTimeout(function () { tip.remove(); }, 1400);
  }

  function findCreditCard() {
    var labels = LABELS.credit;
    for (var li = 0; li < labels.length; li++) {
      var nodes = findTextNodes(labels[li]);
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i].parentElement;
        while (el && el !== document.body) {
          if (
            el.classList &&
            (el.classList.contains("p-4") ||
              el.className.indexOf("bg-yellow") >= 0)
          ) {
            return el;
          }
          el = el.parentElement;
        }
      }
    }
    return null;
  }

  function applyWallet(wallet) {
    if (!wallet) return;
    var bal = Number(
      wallet.balance_cny != null ? wallet.balance_cny : wallet.balance
    );
    if (!isFinite(bal)) return;
    var money = fmtMoney(bal);
    setValueNearLabels(LABELS.credit, money);
    setValueNearLabels(LABELS.balance, money);

    var card = findCreditCard();
    if (!card) return;
    var low = bal < WALLET_LOW_THRESHOLD;
    if (low) {
      card.classList.add("bg-yellow-25", "dark:bg-yellow-900");
    } else {
      card.classList.remove("bg-yellow-25", "dark:bg-yellow-900");
    }
    // 余额充足时连告警三角一起收掉；它和金额同在 .font-semibold 行内，充值按钮的图标不在这里
    var valueRow = card.querySelector(".text-lg.font-semibold, .text-xl.font-semibold");
    if (valueRow) {
      valueRow.querySelectorAll("svg").forEach(function (svg) {
        svg.style.display = low ? "" : "none";
      });
    }
  }

  // ─── 概览页时间档（2026-09-07） ──────────────────────────────────
  //
  // ⚠️ 没有 90d 这一档，而且**不许加回来**：后端 handleApiMyUsage 把窗口写死成
  // `now() - 30 days`（api_usage 表里其实存着更久的数据，是端点自己钳的）。
  // 挂一个只有 30 天数据的「90d」按钮等于骗人。真要 90 天得给那个端点加
  // window_days 参数并重新部署 cf-gateway（见 模型运维总纲 §6 的部署门禁）。
  // 「全部」= 端点返回的全部（也就是近 30 天），默认选它。
  var USAGE_RANGES = [
    { key: "all", buckets: 30, bucketMs: 86400000, all: true },
    { key: "24h", buckets: 24, bucketMs: 3600000 },
    { key: "7d", buckets: 7, bucketMs: 86400000 },
    { key: "30d", buckets: 30, bucketMs: 86400000 },
  ];

  function rangeByKey(key) {
    for (var i = 0; i < USAGE_RANGES.length; i++) {
      if (USAGE_RANGES[i].key === key) return USAGE_RANGES[i];
    }
    return USAGE_RANGES[0];
  }

  /** 桶的左边界。小时档对齐到整点、天档对齐到本地零点（与旧实现同口径）。 */
  function rangeBounds(def) {
    var end = new Date();
    if (def.bucketMs === 3600000) end.setMinutes(0, 0, 0);
    else end.setHours(0, 0, 0, 0);
    var endMs = end.getTime();
    return { n: def.buckets, step: def.bucketMs, start: endMs - (def.buckets - 1) * def.bucketMs };
  }

  /** 统计卡的数字与迷你图必须同口径，所以两者共用同一个 start。 */
  function rowsInRange(rows, def) {
    if (def.all) return rows || [];
    var b = rangeBounds(def);
    return (rows || []).filter(function (r) {
      var ts = new Date(r.created_at).getTime();
      return isFinite(ts) && ts >= b.start;
    });
  }

  function aggregateSeries(rows, def) {
    var b = rangeBounds(def);
    var calls = [];
    var toks = [];
    for (var i = 0; i < b.n; i++) {
      calls.push(0);
      toks.push(0);
    }
    (rows || []).forEach(function (r) {
      var ts = new Date(r.created_at).getTime();
      if (!isFinite(ts)) return;
      var idx = Math.floor((ts - b.start) / b.step);
      if (idx < 0 || idx >= b.n) return;
      calls[idx] += 1;
      toks[idx] += (Number(r.tokens_in) || 0) + (Number(r.tokens_out) || 0);
    });
    return { calls: calls, tokens: toks };
  }

  function aggregate(rows) {
    var totIn = 0;
    var totOut = 0;
    var totalRequests = 0;
    rows.forEach(function (r) {
      totIn += Number(r.tokens_in) || 0;
      totOut += Number(r.tokens_out) || 0;
      totalRequests += 1;
    });
    return {
      totalRequests: totalRequests,
      totalTokens: totIn + totOut,
    };
  }

  function sampleSeries(values, count) {
    if (!count || count < 1) return [];
    if (!values || !values.length) return new Array(count).fill(0);
    if (values.length === count) return values.slice();
    var out = [];
    for (var i = 0; i < count; i++) {
      var idx = Math.floor((i / Math.max(1, count - 1)) * (values.length - 1));
      out.push(values[idx] || 0);
    }
    return out;
  }

  function buildSparklinePath(values, width, height) {
    var pad = { l: 6, r: 6, t: 6, b: 6 };
    var innerW = width - pad.l - pad.r;
    var innerH = height - pad.t - pad.b;
    var max = Math.max(1, Math.max.apply(null, values));
    var n = values.length;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var x = pad.l + (i / Math.max(1, n - 1)) * innerW;
      var y = pad.t + innerH - (values[i] / max) * innerH;
      pts.push({ x: x, y: y });
    }
    if (!pts.length) return "";
    var d = "M" + pts[0].x + "," + pts[0].y;
    for (var j = 1; j < pts.length; j++) {
      d += "L" + pts[j].x + "," + pts[j].y;
    }
    return { d: d, last: pts[pts.length - 1] };
  }

  function sparkSvgSize(card) {
    var svg = card && card.querySelector("svg.recharts-surface");
    if (!svg) return { svg: null, width: 200, height: 44 };
    var wrap =
      card.querySelector(".recharts-responsive-container") ||
      card.querySelector(".wfoF9") ||
      card;
    var width = Math.max(
      40,
      Math.floor(
        wrap.clientWidth ||
          parseFloat(svg.getAttribute("width")) ||
          200
      )
    );
    var height = Math.max(
      24,
      Math.floor(parseFloat(svg.getAttribute("height")) || 44)
    );
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.style.overflow = "hidden";
    // svg 的父级 .recharts-wrapper 又挂在 0 宽测量容器下，设百分比 max-width 会把它压成 0
    svg.style.removeProperty("max-width");
    var wrapper = svg.closest && svg.closest(".recharts-wrapper");
    if (wrapper) {
      wrapper.style.removeProperty("max-width");
      wrapper.style.width = width + "px";
    }
    // clipPath rect if present
    var clip = svg.querySelector("clipPath rect");
    if (clip) {
      clip.setAttribute("width", String(width));
      clip.setAttribute("height", String(height));
    }
    return { svg: svg, width: width, height: height };
  }

  function updateLineSparkline(card, values) {
    if (!card) return;
    var path = card.querySelector(".recharts-line-curve");
    var dot = card.querySelector(".recharts-line-dots circle");
    if (!path) return;
    var size = sparkSvgSize(card);
    var built = buildSparklinePath(values, size.width, size.height);
    path.setAttribute("d", built.d);
    if (dot && built.last) {
      dot.setAttribute("cx", String(built.last.x));
      dot.setAttribute("cy", String(built.last.y));
    }
  }

  function updateBarSparkline(card, values) {
    if (!card) return;
    var bars = card.querySelectorAll(".recharts-bar-rectangle path");
    if (!bars.length) return;
    var size = sparkSvgSize(card);
    var n = bars.length;
    var series = sampleSeries(values, n);
    var max = Math.max(1, Math.max.apply(null, series));
    var pad = 6;
    var gap = 2;
    var barW = Math.max(2, Math.floor((size.width - pad * 2) / n) - gap);
    for (var i = 0; i < n; i++) {
      var bar = bars[i];
      var h = Math.max(2, Math.round((series[i] / max) * (size.height - 12)));
      var y = size.height - h;
      var xn = pad + i * (barW + gap);
      var r = 1;
      bar.setAttribute("x", String(xn));
      bar.setAttribute("width", String(barW));
      bar.setAttribute("height", String(h));
      bar.setAttribute("y", String(y));
      bar.setAttribute(
        "d",
        "M" +
          xn +
          "," +
          (y + r) +
          "A " +
          r +
          "," +
          r +
          ",0,0,1," +
          (xn + r) +
          "," +
          y +
          "L" +
          (xn + barW - r) +
          "," +
          y +
          "A " +
          r +
          "," +
          r +
          ",0,0,1," +
          (xn + barW) +
          "," +
          (y + r) +
          "L" +
          (xn + barW) +
          "," +
          (y + h) +
          "L" +
          xn +
          "," +
          (y + h) +
          "Z"
      );
    }
  }

  function updateSparklineAuto(card, values) {
    if (!card) return;
    var hasLine = !!card.querySelector(".recharts-line-curve");
    var hasBar = !!card.querySelector(".recharts-bar-rectangle path");
    if (hasLine) updateLineSparkline(card, values);
    if (hasBar) updateBarSparkline(card, values);
    if (!hasLine && !hasBar) sparkSvgSize(card);
  }

  /** 从标签文本往上找到第一个真正含 recharts 画布的祖先（概览与用量页容器类名不同）。 */
  function findChartHost(labels) {
    for (var li = 0; li < labels.length; li++) {
      var nodes = findTextNodes(labels[li]);
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i].parentElement;
        while (el && el !== document.body) {
          if (el.querySelector && el.querySelector(".recharts-surface")) return el;
          el = el.parentElement;
        }
      }
    }
    return null;
  }

  var __lastDaily = null;
  var __usageRows = [];
  var __rangeKey = "all";

  function drawCharts(rows) {
    if (PAGE !== "overview" && PAGE !== "usage") return;
    __usageRows = rows || [];
    applyUsageRange();
    // 同上：只裁外层容器，别碰 .recharts-wrapper 和 svg
    document
      .querySelectorAll(".wfoF9, .recharts-responsive-container")
      .forEach(function (el) {
        el.style.overflow = "hidden";
        el.style.maxWidth = "100%";
      });
  }

  /** 把当前时间档套到统计卡数字 + 三张迷你图上。切档和窗口变化都走这里。 */
  function applyUsageRange() {
    var def = rangeByKey(__rangeKey);
    var rows = rowsInRange(__usageRows, def);
    __lastDaily = aggregateSeries(rows, def);
    var agg = aggregate(rows);
    setValueNearLabels(LABELS.requests, nf(agg.totalRequests));
    setValueNearLabels(LABELS.tokens, nf(agg.totalTokens));
    // 只有概览页有这张统计卡；用量页同名的是卡片标题链接，写进去会把标题冲掉
    if (PAGE === "overview") {
      setValueNearLabels(LABELS.responses, nf(agg.totalRequests));
    }
    fillUsageCapabilityCard(agg);
    redrawCharts();
  }

  function redrawCharts() {
    if (!__lastDaily) return;
    // 按卡片实际宽度和图表类型重算；dump 里写死的 897 宽会穿到邻格
    updateSparklineAuto(findChartHost(LABELS.requests), __lastDaily.calls);
    updateSparklineAuto(findChartHost(LABELS.tokens), __lastDaily.tokens);
    updateSparklineAuto(findChartHost(LABELS.responses), __lastDaily.calls);
  }

  /**
   * 概览页右上角的 24h / 7d / 30d 时间档。
   * 快照里这四颗按钮是 Radix 的 SegmentedControl，没有 React 就完全不响应
   * （工单：「点了没反应」）。这里自己接线，顺带把滑块 .V5HTp 按选中项挪位 ——
   * 它靠 inline 的 width + translateX 定位，React 原本负责更新这两个值。
   */
  function wireUsageRangeControl() {
    if (PAGE !== "overview") return;
    var host = null;
    document.querySelectorAll(".F5Sy7").forEach(function (h) {
      if (!host && /24h/.test(h.textContent || "")) host = h;
    });
    if (!host || host.dataset.cncRangeWired === "1") return;
    host.dataset.cncRangeWired = "1";

    var btns = Array.prototype.slice.call(host.querySelectorAll("button.VewWL"));
    // 顺序就是 dump 里的 24h / 7d / 30d / 90d，最后一颗整个摘掉（见 USAGE_RANGES 注释）
    if (btns.length >= 4) btns.pop().remove();
    var allBtn = btns[0].cloneNode(true);
    var allSpan = allBtn.querySelector("span") || allBtn;
    allSpan.textContent = t("rangeAll");
    host.insertBefore(allBtn, btns[0]);
    btns.unshift(allBtn);
    var keys = ["all", "24h", "7d", "30d"];

    var thumb = host.querySelector(".V5HTp");
    function select(i) {
      __rangeKey = keys[i] || "all";
      btns.forEach(function (b, k) {
        b.setAttribute("data-state", k === i ? "on" : "off");
        b.setAttribute("aria-checked", k === i ? "true" : "false");
        b.tabIndex = k === i ? 0 : -1;
      });
      if (thumb) {
        thumb.style.width = btns[i].offsetWidth + "px";
        thumb.style.transform = "translateX(" + btns[i].offsetLeft + "px)";
      }
      applyUsageRange();
    }
    btns.forEach(function (b, i) {
      b.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          select(i);
        },
        true
      );
    });
    host.setAttribute("aria-label", "用量时间范围");
    select(0);
  }

  var CS_CHEV_SVG =
    '<svg class="cs-select__chev" width="12" height="12" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">' +
    '<path d="M.25 10.36a1 1 0 0 1 1.41-.1L5 13.17l3.34-2.91a1 1 0 1 1 1.32 1.5l-4 3.49a1 1 0 0 1-1.32 0l-4-3.49a1 1 0 0 1-.09-1.4Z"/></svg>';
  var CS_TICK_SVG =
    '<svg class="cs-select__tick" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path fill-rule="evenodd" d="M18.06 5.67a1 1 0 0 1 .27 1.39l-7.5 11a1 1 0 0 1-1.54.15l-4.5-4.5a1 1 0 1 1 1.42-1.42l3.64 3.65 6.82-10a1 1 0 0 1 1.39-.27Z" clip-rule="evenodd"/></svg>';

  /**
   * 给 showModal 生成的自绘下拉接线。菜单挂在 <body> 上而不是留在 .cs-modal 里，
   * 因为后者是 overflow-y:auto，菜单一超出卡片就被裁掉。
   * 值写回同一个 #cs-modal-select（hidden input），调用方不受影响。
   */
  function wireCsSelect(card) {
    var root = card.querySelector(".cs-select");
    if (!root || root.dataset.cncWired === "1") return;
    root.dataset.cncWired = "1";
    var hidden = root.querySelector("#cs-modal-select");
    var btn = root.querySelector(".cs-select__btn");
    var menu = root.querySelector(".cs-select__menu");
    var valueEl = root.querySelector(".cs-select__value");
    var opts = Array.prototype.slice.call(menu.querySelectorAll(".cs-select__opt"));
    if (!opts.length) return;
    // 菜单移出卡片后仍要能被 closeCsModal 一起清掉
    document.body.appendChild(menu);
    var active = Math.max(0, opts.findIndex(function (o) { return o.dataset.selected === "1"; }));

    function place() {
      var r = btn.getBoundingClientRect();
      menu.style.width = Math.round(r.width) + "px";
      menu.style.left = Math.round(r.left) + "px";
      var below = window.innerHeight - r.bottom - 8;
      var h = menu.offsetHeight;
      // 下方放不下就向上翻（弹窗在视口居中，长下拉常常撞底）
      if (below < h && r.top > h + 8) menu.style.top = Math.round(r.top - h - 6) + "px";
      else menu.style.top = Math.round(r.bottom + 6) + "px";
    }
    function markActive(i) {
      active = (i + opts.length) % opts.length;
      opts.forEach(function (o, k) {
        if (k === active) o.dataset.active = "1";
        else o.removeAttribute("data-active");
      });
      opts[active].scrollIntoView({ block: "nearest" });
    }
    function open() {
      if (root.dataset.open === "1") return;
      root.dataset.open = "1";
      btn.setAttribute("aria-expanded", "true");
      menu.hidden = false;
      place();
      markActive(active);
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true);
      setTimeout(function () { document.addEventListener("click", onDocClick, true); }, 0);
    }
    function close() {
      if (root.dataset.open !== "1") return;
      root.dataset.open = "0";
      btn.setAttribute("aria-expanded", "false");
      menu.hidden = true;
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("click", onDocClick, true);
    }
    function onDocClick(e) {
      if (menu.contains(e.target) || root.contains(e.target)) return;
      close();
    }
    function pick(opt) {
      hidden.value = opt.dataset.value || "";
      valueEl.textContent = (opt.querySelector("span") || opt).textContent;
      opts.forEach(function (o) {
        if (o === opt) { o.dataset.selected = "1"; o.setAttribute("aria-selected", "true"); }
        else { o.removeAttribute("data-selected"); o.setAttribute("aria-selected", "false"); }
      });
      close();
      btn.focus();
    }
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (root.dataset.open === "1") close();
      else open();
    });
    opts.forEach(function (o, i) {
      o.addEventListener("mouseenter", function () { markActive(i); });
      o.addEventListener("click", function (e) { e.stopPropagation(); pick(o); });
    });
    btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (root.dataset.open !== "1") { open(); return; }
        if (e.key === "ArrowDown") markActive(active + 1);
        else if (e.key === "ArrowUp") markActive(active - 1);
        else pick(opts[active]);
      } else if (e.key === "Escape" && root.dataset.open === "1") {
        // 只关下拉，别顺手把整个弹窗关掉
        e.stopPropagation();
        close();
      }
    });
  }

  function closeCsModal() {
    document.querySelectorAll(".cs-select__menu").forEach(function (m) {
      m.remove();
    });
    document.querySelectorAll(".cs-modal__backdrop").forEach(function (b) {
      b.remove();
    });
    document.removeEventListener("keydown", csModalEsc);
  }

  function csModalEsc(e) {
    if (e.key === "Escape") closeCsModal();
  }

  function showModal(opts) {
    opts = opts || {};
    closeCsModal();
    var backdrop = el("div", "cs-modal__backdrop");
    var card = el(
      "div",
      "cs-modal" + (opts.kind ? " cs-modal--" + opts.kind : "")
    );
    var head =
      '<div class="cs-modal__head"><div class="cs-modal__title">' +
      esc(opts.title || "") +
      "</div></div>";
    var bodyHtml = opts.body
      ? '<div class="cs-modal__body">' + opts.body + "</div>"
      : "";
    var inputHtml = "";
    if (opts.input) {
      inputHtml =
        '<label class="cs-modal__field"><span>' +
        esc(opts.input.label || "") +
        '</span><input id="cs-modal-input" type="text" placeholder="' +
        esc(opts.input.placeholder || "") +
        '" value="' +
        esc(opts.input.value || "") +
        '" /></label>';
    }
    // 2026-08-20：可选下拉（建 Key 的「指定分组」用）。onConfirm 只收 input 的值，
    // 下拉值由回调自己从 card.querySelector('#cs-modal-select') 读，避免改所有调用点的签名。
    //
    // 2026-09-07：可见部分改成自绘（原生 <select> 的选项列表由操作系统画，深色态下
    // 是一块浅色方框、圆角字体都对不上站内）。#cs-modal-select 退化成 hidden input
    // 只承载值 —— 调用方照旧读 `.value`，签名不变。
    if (opts.select) {
      var selValue = String(opts.select.value == null ? "" : opts.select.value);
      var selOpts = opts.select.options || [];
      var current = null;
      for (var si = 0; si < selOpts.length; si++) {
        if (String(selOpts[si].value == null ? "" : selOpts[si].value) === selValue) {
          current = selOpts[si];
          break;
        }
      }
      var optsHtml = selOpts
        .map(function (o) {
          var v = o.value == null ? "" : String(o.value);
          return (
            '<div class="cs-select__opt" role="option" data-value="' + esc(v) + '"' +
            (v === selValue ? ' data-selected="1" aria-selected="true"' : ' aria-selected="false"') +
            "><span>" + esc(o.label) + "</span>" + CS_TICK_SVG + "</div>"
          );
        })
        .join("");
      inputHtml +=
        '<div class="cs-modal__field"><span id="cs-modal-select-label">' +
        esc(opts.select.label || "") +
        '</span><div class="cs-select" data-open="0">' +
        '<input type="hidden" id="cs-modal-select" value="' + esc(selValue) + '" />' +
        '<button type="button" class="cs-select__btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="cs-modal-select-label">' +
        '<span class="cs-select__value">' +
        esc((current && current.label) || (selOpts[0] && selOpts[0].label) || "") +
        "</span>" + CS_CHEV_SVG + "</button>" +
        '<div class="cs-select__menu" role="listbox" hidden>' + optsHtml + "</div>" +
        "</div></div>" +
        (opts.select.hint
          ? '<p class="cs-modal__hint">' + esc(opts.select.hint) + "</p>"
          : "");
    }
    var foot =
      '<div class="cs-modal__foot">' +
      '<button type="button" class="csbtn csbtn--ghost" id="cs-modal-cancel">' +
      esc(opts.cancelText || t("cancel")) +
      "</button>" +
      '<button type="button" class="csbtn ' +
      (opts.confirmKind === "danger" ? "csbtn--danger" : "csbtn--primary") +
      '" id="cs-modal-ok">' +
      esc(opts.confirmText || t("confirm")) +
      "</button></div>";
    card.innerHTML = head + bodyHtml + inputHtml + foot;
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    if (opts.select) wireCsSelect(card);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeCsModal();
    });
    card.querySelector("#cs-modal-cancel").addEventListener("click", closeCsModal);
    var okBtn = card.querySelector("#cs-modal-ok");
    var inp = card.querySelector("#cs-modal-input");
    function submit() {
      if (opts.onConfirm) opts.onConfirm(inp ? inp.value : null, card, okBtn);
    }
    okBtn.addEventListener("click", submit);
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
    }
    document.addEventListener("keydown", csModalEsc);
    return card;
  }

  function showNewKeyModal(key) {
    showModal({
      title: t("keyCreatedTitle"),
      kind: "success",
      body:
        '<p class="cs-modal__hint">' + esc(t("keyCreatedHint")) + "</p>" +
        '<div class="cs-modal__keybox"><code id="cs-new-key-code">' +
        esc(key) +
        "</code></div>",
      confirmText: t("copy"),
      cancelText: t("close"),
      onConfirm: function () {
        copyText(key);
        closeCsModal();
      },
    });
    setTimeout(function () {
      var codeEl = document.getElementById("cs-new-key-code");
      if (codeEl) {
        codeEl.addEventListener("click", function () {
          copyText(key);
        });
      }
    }, 0);
  }

  // 2026-08-20：建 Key 的「指定分组」下拉选项。
  // `model_public_catalog` 是公开端点（无需鉴权），复用 call() 只是图它已经拼好了网关地址；
  // 多带的 __auth_token 那边会忽略。失败一律静默返回空数组 —— 分组只是可选项，
  // 拉不到不能把「建 Key」这个主流程也堵死。
  function loadGroupOptions() {
    return call("model_public_catalog", {})
      .then(function (d) {
        return selectableGroups((d && d.models) || []).map(function (g) {
          // g.count 是**组内线路条数**，不是分组数量。写「个分组」会让用户以为
          // 选一项等于选 N 个分组（2026-08-21 审计 findings 3）。
          return { value: g.id, label: g.label + "（" + g.count + " 条线路）" };
        });
      })
      .catch(function () { return []; });
  }

  /* 分组原语：本文件只需要「可选的分组列表」。
     分组本身来自 DB model_catalog 四列，经 catalog 下发成 m.group={id,label,variant,rank}，
     本文件零硬编码 —— 运维加模型/调分组只跑 SQL。
     ⚠⚠ 同语义在开放平台有 3 份逐字副本（按要求不新增共享文件）：
         1) api/oai-models.js  2) api/model_detail.html  3) 本文件
     改分桶键 / 排序 / 标题回退规则时三处必须一起改。
     只给**成员 ≥ 2** 的组：单成员组选它等于选一个模型，没有「分组」的意义，
     只会把下拉撑长。 */
  function selectableGroups(models) {
    var list = Array.isArray(models) ? models : [];
    function gid(m) {
      var g = m && m.group;
      if (!g || typeof g !== "object") return "";
      return g.id == null ? "" : String(g.id).trim();
    }
    function mid(m) { return String((m && (m.id || m.canonicalId)) || ""); }
    function rank(m) {
      var g = m && m.group;
      var n = g ? Number(g.rank) : NaN;
      return isFinite(n) ? n : 0;
    }
    var byId = {};
    var order = [];
    list.forEach(function (m) {
      var key = gid(m);
      if (!key) return;
      if (!byId[key]) { byId[key] = []; order.push(key); }
      byId[key].push(m);
    });
    return order
      .map(function (key) {
        var members = byId[key];
        members.sort(function (a, b) {
          var d = rank(a) - rank(b);
          if (d !== 0) return d;
          return mid(a) < mid(b) ? -1 : mid(a) > mid(b) ? 1 : 0;
        });
        // 卡名/组名：DB 显式 group_label 优先，否则用代表成员的展示名。
        var explicit = "";
        for (var i = 0; i < members.length; i++) {
          var g = members[i].group;
          var lbl = g && g.label != null ? String(g.label).trim() : "";
          if (lbl) { explicit = lbl; break; }
        }
        var lead = members[0];
        return {
          id: key,
          label: explicit || String((lead && (lead.displayName || lead.id)) || key),
          count: members.length,
        };
      })
      .filter(function (g) { return g.count >= 2; })
      .sort(function (a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0; });
  }

  // 建 Key 弹窗（含 2026-08-20 新增的「指定分组」下拉）。
  // 分组选项异步拉，先用「全部模型」占位 —— 用户在 catalog 回来之前点开弹窗，
  // 也至少能建一把不限分组的 Key，而不是看到空下拉。
  function wireCreateKeyModal() {
    var groupOptions = [{ value: "", label: t("keyGroupAny") }];
    loadGroupOptions().then(function (opts) {
      groupOptions = groupOptions.concat(opts);
    });
    wireCreateKeyButton(function () {
      showModal({
        title: t("createKeyTitle"),
        input: {
          label: t("keyNameLabel"),
          placeholder: "default",
          value: "default",
        },
        select: {
          label: t("keyGroupLabel"),
          options: groupOptions,
          value: "",
          hint: t("keyGroupHint"),
        },
        confirmText: t("create"),
        onConfirm: function (name, cardEl, okBtn) {
          okBtn.disabled = true;
          okBtn.textContent = t("creating");
          var sel = cardEl.querySelector("#cs-modal-select");
          var group = sel && sel.value ? sel.value : null;
          call("api_generate_key", { name: name || "default", allowed_group: group })
            .then(function (d) {
              closeCsModal();
              if (d && d.key) showNewKeyModal(d.key);
              return call("api_my_keys", {});
            })
            .then(renderKeysList)
            .catch(function (e) {
              okBtn.disabled = false;
              okBtn.textContent = t("create");
              var errEl = cardEl.querySelector(".cs-modal__err");
              if (!errEl) {
                errEl = el("div", "cs-modal__err");
                cardEl.querySelector(".cs-modal__foot").before(errEl);
              }
              errEl.textContent =
                t("createFailed") + (e && e.message ? e.message : e);
            });
        },
      });
    });
  }

  function wireCreateKeyButton(onCreate) {
    var needles = ["Create new secret key", "创建新密钥", "Create an API key"];
    document.querySelectorAll("button").forEach(function (btn) {
      var txt = (btn.textContent || "").replace(/\s+/g, " ").trim();
      var hit = false;
      for (var i = 0; i < needles.length; i++) {
        if (txt.indexOf(needles[i]) >= 0) {
          hit = true;
          break;
        }
      }
      if (!hit) return;
      if (btn.dataset.cncKeyWired === "1") return;
      btn.dataset.cncKeyWired = "1";
      btn.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          onCreate();
        },
        true
      );
    });
  }

  // ─── 密钥页：列表 + 搜索 + 筛选（2026-09-07） ─────────────────────
  //
  // 全部筛选维度都用 api_my_keys 已经下发的列，**零后端改动**：
  //   分组限制 → allowed_group（NULL = 不限制，见 模型运维总纲 §2.2.6）
  //   创建时间 → created_at
  //   调用次数 → used_request_count（网关每次调用累加的计数器）
  // 排序/过滤全在浏览器里做：该端点上限 50 把 Key，没有分页可言。
  //
  // ⚠️ 「有效」那个芯片不是筛选项：handleApiMyKeys 只 select is_active=true，
  // 失效的 Key 前端根本拿不到，所以它的清除 × 是死控件，已在 wireKeyFilters 里藏掉。
  var keysAll = [];
  var keyFilter = {
    q: "",
    group: "any", // any | limited | unlimited
    age: "off", // off | before | after
    ageDays: 30,
    calls: "off", // off | most | least
    callsN: 3,
  };

  function keyCallCount(k) {
    return Number(k && k.used_request_count) || 0;
  }

  function keyFilterActive() {
    return (
      !!keyFilter.q ||
      keyFilter.group !== "any" ||
      keyFilter.age !== "off" ||
      keyFilter.calls !== "off"
    );
  }

  function filteredKeys() {
    var q = String(keyFilter.q || "").trim().toLowerCase();
    var edge = Date.now() - Math.max(0, keyFilter.ageDays) * 86400000;
    var list = keysAll.filter(function (k) {
      if (q) {
        var hay = [
          k.name || k.label || "",
          k.key_prefix || k.prefix || "",
          k.allowed_group || "",
        ]
          .join(" ")
          .toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      if (keyFilter.group === "limited" && !k.allowed_group) return false;
      if (keyFilter.group === "unlimited" && k.allowed_group) return false;
      if (keyFilter.age !== "off") {
        var ts = k.created_at ? new Date(k.created_at).getTime() : NaN;
        if (!isFinite(ts)) return false;
        if (keyFilter.age === "before" && ts > edge) return false;
        if (keyFilter.age === "after" && ts < edge) return false;
      }
      return true;
    });
    if (keyFilter.calls !== "off") {
      var desc = keyFilter.calls === "most";
      list = list.slice().sort(function (a, b) {
        var d = keyCallCount(b) - keyCallCount(a);
        if (!desc) d = -d;
        if (d !== 0) return d;
        // 次数打平就按新到旧，避免每次重绘顺序乱跳
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
      list = list.slice(0, Math.max(1, Math.floor(keyFilter.callsN) || 1));
    }
    return list;
  }

  function renderKeysList(data) {
    if (data) keysAll = (data && data.keys) || [];
    paintKeysList();
  }

  function paintKeysList() {
    var mount = document.querySelector(".api-key-page-content");
    if (!mount) return;
    var keys = filteredKeys();
    var countEl = mount.querySelector(".api-keys-filter-result-count");
    if (countEl) {
      countEl.textContent =
        keys.length !== keysAll.length
          ? t("resultsOf")
              .replace("{n}", keys.length)
              .replace("{total}", keysAll.length)
          : t("results").replace("{n}", keys.length);
    }

    var emptyBlock = mount.querySelector("._4d2eR");
    var list = document.getElementById("cnc-keys-list");
    if (!list) {
      list = document.createElement("div");
      list.id = "cnc-keys-list";
      list.className = "cnc-inline-panel";
      if (emptyBlock) mount.insertBefore(list, emptyBlock);
      else mount.appendChild(list);
    }

    // 一把 Key 都没有 → 用快照自带的空态（带「创建新密钥」按钮）。
    // 有 Key 但被筛没了 → 那张空态会误导成「你还没有密钥」，改用自己的提示。
    if (!keysAll.length) {
      list.innerHTML = "";
      list.hidden = true;
      if (emptyBlock) emptyBlock.hidden = false;
      renderKeyFilterChips();
      return;
    }
    if (emptyBlock) emptyBlock.hidden = true;
    list.hidden = false;
    if (!keys.length) {
      list.innerHTML = '<div class="cnc-keys-empty">' + esc(t("noMatch")) + "</div>";
      renderKeyFilterChips();
      return;
    }

    list.innerHTML = keys
      .map(function (k) {
        var prefix = k.key_prefix || k.prefix || "cancri_sk_…";
        var name = k.name || k.label || "default";
        var created = k.created_at
          ? new Date(k.created_at).toLocaleDateString("zh-CN")
          : "—";
        var id = k.id || k.key_id || "";
        var meta = [];
        // 2026-08-20：建 Key 时选过分组的，列表里要看得见 —— 否则用户过几天忘了
        // 这把 Key 有限制，只会看到莫名其妙的 403。
        if (k.allowed_group) {
          meta.push(esc(t("keyGroupTag")) + esc(String(k.allowed_group)));
        }
        // 有「按调用次数筛前 N 把」这个筛选，就必须把次数摆出来，否则用户无从判断
        meta.push(t("callsN").replace("{n}", nf(keyCallCount(k))));
        return (
          '<div class="api-key-row">' +
          '<div class="cnc-key-main">' +
          '<div class="cnc-key-name">' + esc(name) + "</div>" +
          '<div class="cnc-key-prefix">' + esc(prefix) + "</div>" +
          '<div class="cnc-key-meta"><span>' + meta.join("</span><span>") + "</span></div>" +
          "</div>" +
          '<div class="cnc-key-side">' +
          '<span class="cnc-key-date">' + esc(created) + "</span>" +
          '<button type="button" class="cnc-key-revoke" data-del-key="' +
          esc(id) + '">' + esc(t("revoke")) + "</button>" +
          "</div></div>"
        );
      })
      .join("");

    list.querySelectorAll("[data-del-key]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-del-key");
        if (!id) return;
        showModal({
          title: t("revokeTitle"),
          kind: "danger",
          body:
            '<p class="cs-modal__hint">' + esc(t("revokeHint")) + "</p>",
          confirmText: t("revoke"),
          confirmKind: "danger",
          onConfirm: function (val, cardEl, okBtn) {
            okBtn.disabled = true;
            okBtn.textContent = t("revoking");
            call("api_delete_key", { key_id: id, id: id })
              .then(function () {
                closeCsModal();
                return call("api_my_keys", {});
              })
              .then(renderKeysList)
              .catch(function (e) {
                okBtn.disabled = false;
                okBtn.textContent = t("revoke");
                var errEl = cardEl.querySelector(".cs-modal__err");
                if (!errEl) {
                  errEl = el("div", "cs-modal__err");
                  cardEl.querySelector(".cs-modal__foot").before(errEl);
                }
                errEl.textContent =
                  t("revokeFailed") + (e && e.message ? e.message : e);
              });
          },
        });
      });
    });
    renderKeyFilterChips();
  }

  /** 已生效的筛选条件，挨着快照自带的「有效」芯片显示，每个都能单独 ×。 */
  function renderKeyFilterChips() {
    var host = document.querySelector(".api-keys-filter-chips");
    if (!host) return;
    var box = document.getElementById("cnc-key-chips");
    if (!box) {
      box = el("div");
      box.id = "cnc-key-chips";
      box.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap";
      host.appendChild(box);
    }
    var chips = [];
    if (keyFilter.group !== "any") {
      chips.push({
        k: "group",
        label: keyFilter.group === "limited" ? t("fGroupLimited") : t("fGroupUnlimited"),
      });
    }
    if (keyFilter.age !== "off") {
      chips.push({
        k: "age",
        label: (keyFilter.age === "before" ? t("fAgeBefore") : t("fAgeAfter")).replace(
          "{n}",
          keyFilter.ageDays
        ),
      });
    }
    if (keyFilter.calls !== "off") {
      chips.push({
        k: "calls",
        label: (keyFilter.calls === "most" ? t("fCallsMost") : t("fCallsLeast")).replace(
          "{n}",
          keyFilter.callsN
        ),
      });
    }
    box.innerHTML = chips
      .map(function (c) {
        return (
          '<span class="cnc-chip">' + esc(c.label) +
          '<button type="button" class="cnc-chip__x" data-clear-filter="' + c.k +
          '" aria-label="' + esc(t("clearFilter")) + '">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
          '<path fill-rule="evenodd" d="M5.64 5.64a1 1 0 0 1 1.41 0L12 10.59l4.95-4.95a1 1 0 0 1 1.41 1.41L13.41 12l4.95 4.95a1 1 0 0 1-1.41 1.41L12 13.41l-4.95 4.95a1 1 0 0 1-1.41-1.41L10.59 12 5.64 7.05a1 1 0 0 1 0-1.41Z" clip-rule="evenodd"/></svg>' +
          "</button></span>"
        );
      })
      .join("");
    box.querySelectorAll("[data-clear-filter]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var k = b.getAttribute("data-clear-filter");
        if (k === "group") keyFilter.group = "any";
        if (k === "age") keyFilter.age = "off";
        if (k === "calls") keyFilter.calls = "off";
        closeKeyFilterPop();
        paintKeysList();
      });
    });
  }

  function wireKeyFilters() {
    if (PAGE !== "keys") return;
    var bar = document.querySelector(".api-keys-filter-bar");
    if (!bar || bar.dataset.cncFilterWired === "1") return;
    bar.dataset.cncFilterWired = "1";

    // 搜索框。placeholder 是属性不是文本节点，applyPageLocale 的 replaceAllText
    // 摸不到它 —— 这就是页面上一直挂着英文 "Search..." 的原因。
    var wrap = bar.querySelector(".api-keys-global-search");
    var input = wrap && wrap.querySelector("input");
    if (input) {
      input.placeholder = t("searchPlaceholder");
      input.setAttribute("aria-label", t("searchAria"));
      input.addEventListener("input", function () {
        keyFilter.q = input.value || "";
        paintKeysList();
      });
      input.addEventListener("focus", function () {
        if (wrap) wrap.setAttribute("data-focused", "true");
      });
      input.addEventListener("blur", function () {
        if (wrap) wrap.setAttribute("data-focused", "false");
      });
    }

    // 「有效」芯片上那颗清除 × 是死的（后端只返回有效密钥），藏掉
    bar.querySelectorAll(".api-keys-filter-chip button").forEach(function (b) {
      if ((b.getAttribute("aria-label") || "").indexOf("Clear") >= 0) b.style.display = "none";
    });

    var addBtn = bar.querySelector(".api-keys-add-filter-button");
    if (addBtn) {
      addBtn.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (keyFilterPopEl) closeKeyFilterPop();
          else openKeyFilterPop(addBtn);
        },
        true
      );
    }
  }

  var keyFilterPopEl = null;

  function closeKeyFilterPop() {
    if (!keyFilterPopEl) return;
    keyFilterPopEl.remove();
    keyFilterPopEl = null;
    document.removeEventListener("click", onKeyFilterDocClick, true);
    document.removeEventListener("keydown", onKeyFilterEsc);
  }

  function onKeyFilterDocClick(e) {
    if (keyFilterPopEl && !keyFilterPopEl.contains(e.target)) closeKeyFilterPop();
  }

  function onKeyFilterEsc(e) {
    if (e.key === "Escape") closeKeyFilterPop();
  }

  /** 自绘筛选卡：三段单选 + 两个数字输入，改一下立刻重绘列表（不做「应用」按钮）。 */
  function openKeyFilterPop(anchor) {
    var pop = el("div", "cnc-filter-pop");
    function sec(label, field, rows, numKey, numSuffix, numOffWhen) {
      var html =
        '<div class="cnc-filter-sec"><div class="cnc-filter-sec__label">' +
        esc(label) + "</div>";
      html += rows
        .map(function (r) {
          return (
            '<div class="cnc-filter-opt" role="radio" tabindex="0" data-field="' + field +
            '" data-val="' + r.v + '" data-on="' + (keyFilter[field] === r.v ? "1" : "0") +
            '" aria-checked="' + (keyFilter[field] === r.v ? "true" : "false") + '">' +
            '<span class="cnc-filter-opt__mark"></span><span>' + esc(r.label) + "</span></div>"
          );
        })
        .join("");
      if (numKey) {
        html +=
          '<div class="cnc-filter-num" data-num-for="' + field + '" data-off="' +
          (numOffWhen() ? "1" : "0") + '">' +
          '<input type="number" min="1" max="3650" step="1" data-num="' + numKey +
          '" value="' + keyFilter[numKey] + '" /><span>' + esc(numSuffix) + "</span></div>";
      }
      return html + "</div>";
    }

    pop.innerHTML =
      sec(
        t("fGroupTitle"),
        "group",
        [
          { v: "any", label: t("fGroupAny") },
          { v: "limited", label: t("fGroupLimited") },
          { v: "unlimited", label: t("fGroupUnlimited") },
        ],
        null
      ) +
      sec(
        t("fAgeTitle"),
        "age",
        [
          { v: "off", label: t("fAny") },
          { v: "before", label: t("fAgeBeforeOpt") },
          { v: "after", label: t("fAgeAfterOpt") },
        ],
        "ageDays",
        t("fDaysUnit"),
        function () {
          return keyFilter.age === "off";
        }
      ) +
      sec(
        t("fCallsTitle"),
        "calls",
        [
          { v: "off", label: t("fAny") },
          { v: "most", label: t("fCallsMostOpt") },
          { v: "least", label: t("fCallsLeastOpt") },
        ],
        "callsN",
        t("fKeysUnit"),
        function () {
          return keyFilter.calls === "off";
        }
      ) +
      '<div class="cnc-filter-pop__foot">' +
      '<button type="button" class="csbtn csbtn--ghost csbtn--sm" data-filter-reset>' +
      esc(t("fReset")) + "</button>" +
      '<button type="button" class="csbtn csbtn--primary csbtn--sm" data-filter-done>' +
      esc(t("fDone")) + "</button></div>";

    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.left =
      Math.round(Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))) + "px";
    pop.style.top =
      Math.round(
        Math.min(r.bottom + 8, Math.max(8, window.innerHeight - pop.offsetHeight - 8))
      ) + "px";

    function syncNumDisabled() {
      pop.querySelectorAll("[data-num-for]").forEach(function (n) {
        var f = n.getAttribute("data-num-for");
        n.setAttribute("data-off", keyFilter[f] === "off" ? "1" : "0");
      });
    }
    function choose(optEl) {
      var f = optEl.getAttribute("data-field");
      keyFilter[f] = optEl.getAttribute("data-val");
      pop.querySelectorAll('[data-field="' + f + '"]').forEach(function (o) {
        var on = o === optEl;
        o.setAttribute("data-on", on ? "1" : "0");
        o.setAttribute("aria-checked", on ? "true" : "false");
      });
      syncNumDisabled();
      paintKeysList();
    }
    pop.querySelectorAll(".cnc-filter-opt").forEach(function (o) {
      o.addEventListener("click", function () {
        choose(o);
      });
      o.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose(o);
        }
      });
    });
    pop.querySelectorAll("input[data-num]").forEach(function (i) {
      i.addEventListener("input", function () {
        var k = i.getAttribute("data-num");
        var n = Math.floor(Number(i.value));
        if (!isFinite(n) || n < 1) return; // 输入框清空过程中别把列表清空
        keyFilter[k] = Math.min(n, 3650);
        paintKeysList();
      });
    });
    pop.querySelector("[data-filter-reset]").addEventListener("click", function () {
      keyFilter.group = "any";
      keyFilter.age = "off";
      keyFilter.calls = "off";
      keyFilter.ageDays = 30;
      keyFilter.callsN = 3;
      closeKeyFilterPop();
      paintKeysList();
    });
    pop.querySelector("[data-filter-done]").addEventListener("click", closeKeyFilterPop);

    keyFilterPopEl = pop;
    setTimeout(function () {
      document.addEventListener("click", onKeyFilterDocClick, true);
      document.addEventListener("keydown", onKeyFilterEsc);
    }, 0);
  }

  function renderLogsList(rows) {
    if (!rows || !rows.length) return;
    var panel =
      document.querySelector(".Jp-M8 ._4d2eR") ||
      document.querySelector("._4d2eR[data-fill=static]");
    if (!panel) return;

    panel.dataset.fill = "none";
    panel.style.cssText =
      "display:block;width:100%;height:auto;align-items:stretch;justify-content:flex-start";
    Array.from(panel.children).forEach(function (ch) {
      if (ch.id !== "cnc-logs-list") ch.style.display = "none";
    });

    var sorted = rows.slice().sort(function (a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
    var list = document.getElementById("cnc-logs-list");
    if (!list) {
      list = document.createElement("div");
      list.id = "cnc-logs-list";
      list.style.cssText = "padding:16px;overflow:auto;width:100%";
      panel.appendChild(list);
    }
    list.innerHTML =
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      "<thead><tr><th style=\"text-align:left;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">" +
      esc(t("time")) +
      "</th>" +
      "<th style=\"text-align:left;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">" +
      esc(t("model")) +
      "</th>" +
      "<th style=\"text-align:right;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">In</th>" +
      "<th style=\"text-align:right;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">Out</th>" +
      "<th style=\"text-align:left;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">" +
      esc(t("status")) +
      "</th></tr></thead><tbody>" +
      sorted
        .slice(0, 200)
        .map(function (r) {
          return (
            "<tr><td style=\"padding:8px;border-bottom:1px solid rgba(127,127,127,.12)\">" +
            esc(new Date(r.created_at).toLocaleString("zh-CN")) +
            "</td><td style=\"padding:8px;border-bottom:1px solid rgba(127,127,127,.12)\">" +
            esc(r.model || "—") +
            '</td><td style="padding:8px;text-align:right;border-bottom:1px solid rgba(127,127,127,.12)">' +
            nf(r.tokens_in) +
            '</td><td style="padding:8px;text-align:right;border-bottom:1px solid rgba(127,127,127,.12)">' +
            nf(r.tokens_out) +
            "</td><td style=\"padding:8px;border-bottom:1px solid rgba(127,127,127,.12)\">" +
            esc(r.status_code || 200) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  function injectConsoleChromeCss() {
    if (document.getElementById("nexusv-console-chrome-css")) return;
    var s = document.createElement("style");
    s.id = "nexusv-console-chrome-css";
    s.textContent =
      "@media (min-width:768px){" +
      "main.sm8f7[data-sidebar=collapsed]{--side-nav-width:var(--side-nav-collapsed-width,56px)}" +
      "main.sm8f7[data-sidebar=collapsed] aside._1qzLV," +
      "main.sm8f7[data-sidebar=collapsed] .CO5li[data-sidebar-collapsible]," +
      "main.sm8f7[data-sidebar=collapsed] ._3eq3b{width:var(--side-nav-collapsed-width,56px)!important;max-width:var(--side-nav-collapsed-width,56px)!important;overflow:hidden!important}" +
      "main.sm8f7[data-sidebar=collapsed] .yaYrI{left:var(--side-nav-collapsed-width,56px)}" +
      "main.sm8f7[data-sidebar=collapsed] .SjyEm," +
      "main.sm8f7[data-sidebar=collapsed] .rxdQY," +
      "main.sm8f7[data-sidebar=collapsed] .a6re5," +
      "main.sm8f7[data-sidebar=collapsed] ._3DFLd," +
      "main.sm8f7[data-sidebar=collapsed] .CtBQA," +
      "main.sm8f7[data-sidebar=collapsed] .-ZU7U," +
      "main.sm8f7[data-sidebar=collapsed] ._6UBrL," +
      "main.sm8f7[data-sidebar=collapsed] #cnc-theme-toggle{display:none!important}" +
      "main.sm8f7[data-sidebar=collapsed] ._4SoGl{margin:0}" +
      "main.sm8f7[data-sidebar=collapsed] .HPtRB.O3ygq{justify-content:center;padding-left:0;padding-right:0}" +
      "}" +
      ".cnc-theme-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;margin-left:4px;border:0;border-radius:8px;background:transparent;color:var(--color-text-secondary,inherit);cursor:pointer}" +
      ".cnc-theme-btn:hover{background:var(--color-background-primary-soft,rgba(127,127,127,.12));color:var(--color-text,inherit)}" +
      "section._3s6q5.y5pFn .OQedc:empty::before{content:'（更新内容待填写）';display:block;padding:12px 0;color:var(--color-text-secondary,#888);font-size:14px}" +
      /* overview sparkline 穿模：卡片内强制裁切 */
      // ⚠ 不要给 .recharts-wrapper / svg 设 max-width：它们的父级是 recharts 那层
      // width:0;height:0 的测量容器，百分比会解析成 0，整张图直接消失。
      ".Z5hMp .wfoF9,.Z5hMp .ZhrJy,.Z5hMp .recharts-responsive-container{overflow:hidden!important;max-width:100%!important}";
    document.head.appendChild(s);
  }

  function mapIndexThemeToOai(raw) {
    if (raw === "light") return "light";
    if (raw === "dark" || raw === "warm" || raw === "blue") return "dark";
    return null;
  }

  function resolveTheme() {
    try {
      var fromIndex = mapIndexThemeToOai(localStorage.getItem(THEME_KEY_INDEX));
      if (fromIndex) return fromIndex;
      var fromOai = localStorage.getItem(THEME_KEY_OAI);
      if (fromOai === "light" || fromOai === "dark") return fromOai;
    } catch (e) {}
    return "dark";
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === "light") {
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
    } else {
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
    }
    try {
      localStorage.setItem(THEME_KEY_OAI, theme);
      localStorage.setItem(THEME_KEY_INDEX, theme);
    } catch (e) {}
    var btn = document.getElementById("cnc-theme-toggle");
    if (btn) {
      btn.setAttribute("aria-label", theme === "dark" ? "切换到浅色" : "切换到深色");
      btn.title = theme === "dark" ? "浅色模式" : "深色模式";
    }
  }

  function wireThemeToggle() {
    applyTheme(resolveTheme());
    var host =
      document.querySelector("button.O3ygq.FzNxy") &&
      document.querySelector("button.O3ygq.FzNxy").parentElement;
    if (!host || document.getElementById("cnc-theme-toggle")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "cnc-theme-toggle";
    btn.className = "cnc-theme-btn";
    btn.setAttribute("data-cancri-theme-toggle", "1");
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm0 15a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm9-6a1 1 0 0 1-1 1h-1a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1ZM5 12a1 1 0 0 1-1 1H3a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm12.95 6.364a1 1 0 0 1-1.414 0l-.707-.707a1 1 0 0 1 1.414-1.414l.707.707a1 1 0 0 1 0 1.414ZM7.757 7.757a1 1 0 0 1-1.414 0l-.707-.707A1 1 0 0 1 7.05 5.636l.707.707a1 1 0 0 1 0 1.414Zm9.9-2.121a1 1 0 0 1 0 1.414l-.708.707A1 1 0 1 1 15.535 6.343l.707-.707a1 1 0 0 1 1.415 0ZM7.05 18.364a1 1 0 0 1 0-1.414l.707-.707a1 1 0 1 1 1.414 1.414l-.707.707a1 1 0 0 1-1.414 0ZM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>';
    host.appendChild(btn);
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      applyTheme(cur === "dark" ? "light" : "dark");
    });
    applyTheme(resolveTheme());
  }

  function wireSidebarCollapse() {
    var main = document.querySelector("main.sm8f7[data-sidebar]");
    var btn = document.querySelector('button.O3ygq.FzNxy[aria-label*="侧边栏"], button.O3ygq.FzNxy');
    if (!main || !btn || btn.dataset.cncCollapseWired === "1") return;
    btn.dataset.cncCollapseWired = "1";

    function setCollapsed(collapsed) {
      main.setAttribute("data-sidebar", collapsed ? "collapsed" : "expanded");
      btn.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
      try {
        localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
      } catch (e) {}
      // 侧栏宽度变了 → 概览 sparkline 按新宽度重算
      window.setTimeout(redrawCharts, 80);
    }

    var saved = null;
    try {
      saved = localStorage.getItem(SIDEBAR_KEY);
    } catch (e) {}
    if (saved === "collapsed" || saved === "expanded") {
      setCollapsed(saved === "collapsed");
    }

    btn.addEventListener(
      "click",
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        var now = main.getAttribute("data-sidebar") === "collapsed";
        setCollapsed(!now);
      },
      true
    );
  }

  function clearUpdatesSection() {
    if (PAGE !== "overview") return;
    document.querySelectorAll("section._3s6q5.y5pFn .OQedc").forEach(function (box) {
      box.innerHTML = "";
    });
  }

  function rewriteActionLinks(card, modelId) {
    var links = card.querySelectorAll("a");
    if (links[0]) {
      links[0].setAttribute("href", "../index.html?models=" + encodeURIComponent(modelId));
      links[0].removeAttribute("target");
      links[0].removeAttribute("rel");
      // keep icon, replace trailing text
      var nodes = Array.prototype.slice.call(links[0].childNodes);
      nodes.forEach(function (n) {
        if (n.nodeType === 3) n.nodeValue = "";
      });
      links[0].appendChild(document.createTextNode(" 在对话中打开"));
    }
    if (links[1]) {
      links[1].setAttribute("href", "../api_docs_detail.html#intro");
      links[1].setAttribute("target", "_blank");
      links[1].setAttribute("rel", "noopener noreferrer");
      var nodes2 = Array.prototype.slice.call(links[1].childNodes);
      nodes2.forEach(function (n) {
        if (n.nodeType === 3) n.nodeValue = "";
      });
      links[1].appendChild(document.createTextNode(" 了解怎么使用"));
    }
  }

  function patchFeaturedModels() {
    if (PAGE !== "overview") return;
    var grid = document.querySelector("section._3s6q5 ._7Yo0u");
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll(".F9uU-"));
    if (!cards.length) return;

    // Keep first N card shells (icons), drop extras
    FEATURED_MODELS.forEach(function (m, i) {
      var card = cards[i];
      if (!card) {
        card = cards[0].cloneNode(true);
        grid.appendChild(card);
      }
      card.setAttribute("aria-label", m.name);
      card.setAttribute("data-interactive", "true");
      card.setAttribute("role", "group");
      var title = card.querySelector("h6.Ai6pw");
      var desc = card.querySelector("p.RBw-C");
      if (title) title.textContent = m.name;
      if (desc) desc.textContent = m.desc;
      var groups = card.querySelectorAll(".j4lZ6");
      if (groups[0]) groups[0].setAttribute("aria-label", m.name + " top action");
      if (groups[1]) groups[1].setAttribute("aria-label", m.name + " bottom action");
      rewriteActionLinks(card, m.id);
    });
    // remove leftover cards beyond featured set
    Array.prototype.slice
      .call(grid.querySelectorAll(".F9uU-"))
      .slice(FEATURED_MODELS.length)
      .forEach(function (n) {
        n.remove();
      });
  }

  function patchActionCtasEverywhere() {
    document.querySelectorAll("a").forEach(function (a) {
      var t = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (t.indexOf("Explore in playground") >= 0 || t.indexOf("在对话中打开") >= 0) {
        // normalize label
        var href = a.getAttribute("href") || "";
        if (/models=/.test(href) || /index\.html/.test(href)) {
          var nodes = Array.prototype.slice.call(a.childNodes);
          nodes.forEach(function (n) {
            if (n.nodeType === 3) n.nodeValue = "";
          });
          a.appendChild(document.createTextNode(" 在对话中打开"));
        }
      }
      if (t.indexOf("Read the docs") >= 0 || t.indexOf("了解怎么使用") >= 0) {
        var nodes2 = Array.prototype.slice.call(a.childNodes);
        nodes2.forEach(function (n) {
          if (n.nodeType === 3) n.nodeValue = "";
        });
        a.appendChild(document.createTextNode(" 了解怎么使用"));
      }
    });
  }

  /** api_usage 无金额列；Spend 不能伪造。显示 — 并改成 ¥ 口径文案。 */
  function applySpendPlaceholder() {
    setValueNearLabels(LABELS.spend, "—");
    // organization-spend-summary $0.00 → —
    document.querySelectorAll('[data-testid="organization-spend-summary-section"] .text-lg.font-semibold').forEach(function (el) {
      if (/^\$/.test((el.textContent || "").trim()) || (el.textContent || "").trim() === "$0.00") {
        el.textContent = "—";
      }
    });
    // Total Spend big number
    findTextNodes("Total Spend").concat(findTextNodes("总消耗")).forEach(function (tn) {
      var wrap = tn.parentElement && tn.parentElement.parentElement;
      if (!wrap) return;
      var val = wrap.querySelector(".text-xl.font-semibold div, .text-xl.font-semibold");
      if (val && /\$/.test(val.textContent || "")) val.textContent = "—";
    });
  }

  async function boot() {
    ensureConsoleCss();
    injectConsoleChromeCss();
    applyTheme(resolveTheme());
    trimSidebar();
    wireStaticDismissers();
    wireSidebarCollapse();
    wireThemeToggle();
    clearUpdatesSection();
    patchFeaturedModels();
    // 汉化必须赶在首帧之前，否则英文 dump 会先画一遍（同 model_detail 的 5.5 闪现）
    stripDeadUsageBlocks();
    applyPageLocale();
    patchBuildWithCards();
    stripQuickStartClose();
    dimComingSoonCards();
    patchActionCtasEverywhere();
    try {
      if (!window.PlatformAuth) throw new Error("supabase_not_loaded");
      var session = await PlatformAuth.requireSession({});
      if (!session) return;
      revealL10n();
      updateUserChip(session.user);

      var walletP = call("get_quota_status", {}).catch(function () {
        return null;
      });
      var usageP = call("api_my_usage", {}).catch(function () {
        return { usage: [] };
      });
      var keysP =
        PAGE === "keys"
          ? call("api_my_keys", {}).catch(function () {
              return { keys: [] };
            })
          : Promise.resolve(null);

      var walletRes = await walletP;
      var usageRes = await usageP;
      var keysRes = await keysP;

      applyWallet(walletRes && walletRes.wallet);

      var usage = (usageRes && usageRes.usage) || [];
      applySpendPlaceholder();
      if (PAGE === "overview" || PAGE === "usage") {
        // 统计卡数字与三张迷你图都由 applyUsageRange 按当前时间档统一填，
        // drawCharts 内部会调它一次；wireUsageRangeControl 的 select(0) 再刷一遍。
        drawCharts(usage);
        wireUsageRangeControl();
      } else {
        var agg = aggregate(usage);
        setValueNearLabels(LABELS.requests, nf(agg.totalRequests));
        setValueNearLabels(LABELS.tokens, nf(agg.totalTokens));
      }
      if (!window.__cncSparkResizeWired) {
        window.__cncSparkResizeWired = true;
        var resizeT = 0;
        window.addEventListener("resize", function () {
          window.clearTimeout(resizeT);
          resizeT = window.setTimeout(redrawCharts, 100);
        });
      }

      // 建 Key 弹窗：密钥页当然要，概览页的「1. Create an API key」上手清单按钮
      // 在 2026-08-20 之前是**没接线的死按钮**（wireCreateKeyButton 只在 keys 页调），
      // 用户按了没反应。这里一并接上；renderKeysList 在概览页找不到挂载点会自己 return。
      if (PAGE === "keys" || PAGE === "overview") {
        wireCreateKeyModal();
        if (PAGE === "keys") {
          renderKeysList(keysRes);
          wireKeyFilters();
        }
      }
      if (PAGE === "logs") renderLogsList(usage);

      applyPageLocale();
      patchBuildWithCards();
      stripQuickStartClose();
      dimComingSoonCards();
      patchActionCtasEverywhere();
      // locale may recreate English CTA leftovers — re-assert featured cards
      patchFeaturedModels();
      clearUpdatesSection();
    } catch (e) {
      if (e && e.message === "supabase_not_loaded") {
        var login =
          (document.body && document.body.getAttribute("data-login-url")) ||
          "../index.html";
        if (window.PlatformAuth) PlatformAuth.redirectToLogin();
        else window.location.replace(login);
        return;
      }
      revealL10n();
    }
  }

  // 2026-08-15：把用户芯片实现导出成单一来源。
  // oai-billing.js 原本自带一份 updateUserChip（只显示 @ 前缀、无复制），
  // 与本文件这份并存 = 同一 UI 两套行为，结算页和其它控制台页表现不一致。
  // billing.html 同时加载本文件与 oai-billing.js，故让后者直接复用这里的实现。
  window.CancriConsoleChip = { update: updateUserChip };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
