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
    },
    zh: {
      cancel: "取消",
      confirm: "确认",
      create: "创建",
      creating: "创建中…",
      createKeyTitle: "创建新密钥",
      keyNameLabel: "密钥名称（可选）",
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
    l.href = "console.css?v=20260625-console-modal";
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

  function updateUserChip(user) {
    var email = (user && user.email) || "";
    var name = email.split("@")[0] || "User";
    var initial = name.charAt(0).toUpperCase() || "U";
    replaceAllText("Personal", name);
    document.querySelectorAll("span, div").forEach(function (node) {
      if (node.childNodes.length === 1 && node.textContent === "P") {
        node.textContent = initial;
      }
    });
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

  function aggregateDaily(rows) {
    var dayCalls = {};
    var dayTok = {};
    var days = [];
    for (var i = 29; i >= 0; i--) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      var key = d.toISOString().slice(0, 10);
      days.push(key);
      dayCalls[key] = 0;
      dayTok[key] = 0;
    }
    (rows || []).forEach(function (r) {
      var key = new Date(r.created_at).toISOString().slice(0, 10);
      if (dayCalls[key] == null) return;
      dayCalls[key] += 1;
      dayTok[key] +=
        (Number(r.tokens_in) || 0) + (Number(r.tokens_out) || 0);
    });
    return {
      days: days,
      calls: days.map(function (k) {
        return dayCalls[k];
      }),
      tokens: days.map(function (k) {
        return dayTok[k];
      }),
    };
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
  function drawCharts(rows) {
    if (PAGE !== "overview" && PAGE !== "usage") return;
    var daily = aggregateDaily(rows);
    __lastDaily = daily;
    redrawCharts();
    // 同上：只裁外层容器，别碰 .recharts-wrapper 和 svg
    document
      .querySelectorAll(".wfoF9, .recharts-responsive-container")
      .forEach(function (el) {
        el.style.overflow = "hidden";
        el.style.maxWidth = "100%";
      });
  }

  function redrawCharts() {
    if (!__lastDaily) return;
    // 按卡片实际宽度和图表类型重算；dump 里写死的 897 宽会穿到邻格
    updateSparklineAuto(findChartHost(LABELS.requests), __lastDaily.calls);
    updateSparklineAuto(findChartHost(LABELS.tokens), __lastDaily.tokens);
    updateSparklineAuto(findChartHost(LABELS.responses), __lastDaily.calls);
  }

  function closeCsModal() {
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

  function renderKeysList(data) {
    var mount = document.querySelector(".api-key-page-content");
    if (!mount) return;
    var keys = (data && data.keys) || [];
    var countEl = mount.querySelector(".api-keys-filter-result-count");
    if (countEl) countEl.textContent = keys.length + " results";

    var emptyBlock = mount.querySelector("._4d2eR");
    var list = document.getElementById("cnc-keys-list");
    if (!list) {
      list = document.createElement("div");
      list.id = "cnc-keys-list";
      list.className = "cnc-inline-panel";
      if (emptyBlock) mount.insertBefore(list, emptyBlock);
      else mount.appendChild(list);
    }

    if (!keys.length) {
      list.innerHTML = "";
      list.hidden = true;
      if (emptyBlock) emptyBlock.hidden = false;
      return;
    }

    if (emptyBlock) emptyBlock.hidden = true;
    list.hidden = false;
    list.innerHTML = keys
      .map(function (k) {
        var prefix = k.key_prefix || k.prefix || "cancri_sk_…";
        var name = k.name || k.label || "default";
        var created = k.created_at
          ? new Date(k.created_at).toLocaleDateString("zh-CN")
          : "—";
        var id = k.id || k.key_id || "";
        return (
          '<div class="api-key-row" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--color-border,#eee)">' +
          '<div><div style="font-weight:600">' +
          esc(name) +
          '</div><div style="font-family:monospace;font-size:13px;opacity:.75">' +
          esc(prefix) +
          "</div></div>" +
          '<div style="display:flex;align-items:center;gap:12px">' +
          '<span style="font-size:13px;opacity:.7">' +
          esc(created) +
          "</span>" +
          '<button type="button" data-del-key="' +
          esc(id) +
          '" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(127,127,127,.35);background:transparent;cursor:pointer">Revoke</button>' +
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
      var agg = aggregate(usage);
      setValueNearLabels(LABELS.requests, nf(agg.totalRequests));
      setValueNearLabels(LABELS.tokens, nf(agg.totalTokens));
      // 只有概览页有这张统计卡；用量页同名的是卡片标题链接，写进去会把标题冲掉
      if (PAGE === "overview") {
        setValueNearLabels(LABELS.responses, nf(agg.totalRequests));
      }
      fillUsageCapabilityCard(agg);
      applySpendPlaceholder();
      drawCharts(usage);
      if (!window.__cncSparkResizeWired) {
        window.__cncSparkResizeWired = true;
        var resizeT = 0;
        window.addEventListener("resize", function () {
          window.clearTimeout(resizeT);
          resizeT = window.setTimeout(redrawCharts, 100);
        });
      }

      if (PAGE === "keys") {
        wireCreateKeyButton(function () {
          showModal({
            title: t("createKeyTitle"),
            input: {
              label: t("keyNameLabel"),
              placeholder: "default",
              value: "default",
            },
            confirmText: t("create"),
            onConfirm: function (name, cardEl, okBtn) {
              okBtn.disabled = true;
              okBtn.textContent = t("creating");
              call("api_generate_key", { name: name || "default" })
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
        renderKeysList(keysRes);
      }
      if (PAGE === "logs") renderLogsList(usage);

      applyPageLocale();
      patchBuildWithCards();
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
