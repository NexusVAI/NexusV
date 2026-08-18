// oai-billing.js — API 控制台「结算」页逻辑（套餐 / API 额度 双 Tab）
// 数据源：chat-gateway plan_v4_status（套餐 + 档位目录）+ list_my_orders（钱包）。
(function () {
  "use strict";

  var GW = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  var sb = null;

  function $(id) { return document.getElementById(id); }
  function fmtCny(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return "¥—";
    return "¥" + v.toFixed(2);
  }
  function fmtDate(s) {
    var d = new Date(s);
    if (isNaN(d.getTime())) return "—";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getSupabase() {
    if (sb) return sb;
    if (!window.supabase || !window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) {
      throw new Error("supabase_not_loaded");
    }
    sb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cancri_supabase_auth" },
    });
    return sb;
  }

  async function callGateway(endpoint, payload) {
    var r = await getSupabase().auth.getSession();
    var session = r && r.data ? r.data.session : null;
    if (!session) throw new Error("not_logged_in");
    var resp = await fetch(GW, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: window.__SUPABASE_ANON_KEY__ },
      body: JSON.stringify(Object.assign({ endpoint: endpoint }, payload || {}, { __auth_token: session.access_token })),
    });
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw Object.assign(new Error(data.message || data.error || resp.statusText), { status: resp.status, body: data });
    return data;
  }

  // ── 侧边栏本地化 + 用户芯片（与 oai-console-data.js 同步）──
  function detectLang() {
    try {
      var saved = localStorage.getItem("lang");
      if (saved === "zh" || saved === "en") return saved;
    } catch (e) {}
    var nav = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    return nav.indexOf("zh") >= 0 ? "zh" : "en";
  }

  function findTextNodes(text, root) {
    var out = [];
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (n.nodeValue && n.nodeValue.trim() === text) out.push(n);
    }
    return out;
  }

  function replaceAllText(oldText, newText) {
    findTextNodes(oldText).forEach(function (n) { n.nodeValue = newText; });
  }

  function applyPageLocale() {
    var lang = detectLang();
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en-US";
    if (lang !== "zh") return;
    [
      ["Home", "首页"],
      ["API Keys", "API 密钥"],
      ["Usage", "用量"],
      ["Logs", "日志"],
      ["Billing", "结算"],
      ["Default project", "默认项目"],
      ["Organization", "个人版"],
    ].forEach(function (p) { replaceAllText(p[0], p[1]); });
  }

  // 2026-08-15：优先复用 oai-console-data.js 导出的单一实现
  // （billing.html 同时加载了它）。本文件原有的那份只显示 @ 前缀、没有复制/设置入口，
  // 与其它控制台页表现不一致 —— 那正是「同一 UI 两套实现」的漂移。
  // 保留本地兜底：万一 oai-console-data.js 加载失败，芯片仍显示邮箱而不是英文 Personal。
  function updateUserChip(user) {
    if (window.CancriConsoleChip && typeof window.CancriConsoleChip.update === "function") {
      window.CancriConsoleChip.update(user);
      return;
    }
    var email = (user && user.email) || "";
    var name = email.split("@")[0] || "User";
    var initial = name.charAt(0).toUpperCase() || "U";
    // 与 oai-console-data.js 同款：两种文案都替换，结果不依赖 applyPageLocale 的先后
    replaceAllText("Personal", email || name);
    replaceAllText("个人", email || name);
    document.querySelectorAll("span, div").forEach(function (node) {
      if (node.childNodes.length === 1 && node.textContent === "P") {
        node.textContent = initial;
      }
    });
  }

  // ── Tabs（hash 记忆：#plan / #api / #bills）──
  function moveThumb(tab) {
    var thumb = $("bp-tab-thumb");
    var btn = $("bp-tab-" + tab);
    if (!thumb || !btn) return;
    thumb.style.width = btn.offsetWidth + "px";
    thumb.style.transform = "translateX(" + btn.offsetLeft + "px)";
  }
  // tab 名单是 setTab / tabFromHash / initTabs 三处共用的唯一来源，
  // 漏改的表现是：按钮能点但面板不切，或 hash 直达失效。
  // 2026-08-18 晚移除 "reset"（重置卡系统下线）。旧书签 #reset 会被
  // tabFromHash 的 indexOf 判定为未知 → 回落到 "plan"，不会白屏。
  var TABS = ["plan", "api", "bills"];

  function setTab(tab) {
    TABS.forEach(function (t) {
      var on = t === tab;
      var btn = $("bp-tab-" + t);
      var panel = $("bp-panel-" + t);
      if (btn) {
        btn.dataset.state = on ? "on" : "off";
        btn.setAttribute("aria-checked", String(on));
      }
      if (panel) panel.hidden = !on;
    });
    moveThumb(tab);
    try { history.replaceState(null, "", "#" + tab); } catch (e) { /* ignore */ }
  }
  function tabFromHash() {
    var h = String(location.hash || "").replace(/^#/, "");
    return TABS.indexOf(h) >= 0 ? h : "plan";
  }
  function initTabs() {
    setTab(tabFromHash());
    TABS.forEach(function (t) {
      var btn = $("bp-tab-" + t);
      if (btn) btn.addEventListener("click", function () { setTab(t); });
    });
    window.addEventListener("hashchange", function () { setTab(tabFromHash()); });
  }

  // ── 限时：API 余额换购套餐（wallet_convert 窗口内才展示）──
  var convertState = { info: null, catalog: [], plan: null, balance: null, timer: null };

  function fmtCountdown(endsAt) {
    var ms = new Date(endsAt).getTime() - Date.now();
    if (!(ms > 0)) return null;
    var d = Math.floor(ms / 86400000);
    var h = Math.floor((ms % 86400000) / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    return d > 0 ? d + " 天 " + h + " 小时" : h > 0 ? h + " 小时 " + m + " 分钟" : m + " 分钟";
  }

  function setConvertMsg(text, kind) {
    var el = document.getElementById("convert-msg");
    if (!el) return;
    el.textContent = text || "";
    el.dataset.s = kind || "";
  }

  function renderConvert() {
    var card = $("convert-card");
    if (!card) return;
    var info = convertState.info;
    var countdown = info && info.enabled && info.ends_at ? fmtCountdown(info.ends_at) : null;
    if (!countdown || !convertState.catalog.length) {
      card.hidden = true;
      card.innerHTML = "";
      if (convertState.timer) { clearInterval(convertState.timer); convertState.timer = null; }
      return;
    }
    var bal = Number(convertState.balance);
    var activeCode = convertState.plan && convertState.plan.active ? convertState.plan.plan_code : null;
    var activeRank = 0;
    convertState.catalog.forEach(function (p) { if (p.plan_code === activeCode) activeRank = Number(p.rank) || 0; });
    var rows = convertState.catalog.map(function (p) {
      var listPrice = Number(p.price_cny);
      var q = p.quote || null;
      var isDowngrade = (q && q.downgrade_not_allowed) || (activeCode && Number(p.rank) < activeRank);
      // 升级按天折价：实付 = server 报价（旧套餐剩余时间折抵）
      var price = q && Number.isFinite(Number(q.pay_price_cny)) ? Number(q.pay_price_cny) : listPrice;
      var credit = q ? Number(q.credit_cny) || 0 : 0;
      var enough = Number.isFinite(bal) && bal >= price;
      var label = activeCode === p.plan_code ? "用余额续费" : (q && q.is_upgrade ? "折价升级" : "用余额换购");
      var meta = "月度额度 " + fmtCny(p.allowance_cny) + " · " + p.duration_days + " 天";
      if (Number(p.burn_multiplier) > 1) meta += " · 套餐内 ×" + Number(p.burn_multiplier) + " 计扣";
      if (credit > 0) meta += " · 已折抵旧套餐剩余 " + fmtCny(credit);
      if (!enough && Number.isFinite(bal)) meta += " · 还差 " + fmtCny(price - bal) + "，可充值凑单";
      if (isDowngrade) meta += " · 有效期内不可换低档";
      var priceHtml = price < listPrice
        ? fmtCny(price) + ' <s style="opacity:.55;font-weight:400">' + fmtCny(listPrice) + "</s>"
        : fmtCny(price);
      return '<div class="convert-plan-row"><div><div class="convert-plan-name">' + esc(p.display_name || p.plan_code) +
        " 套餐 · " + priceHtml + '</div><div class="convert-plan-meta">' + esc(meta) + "</div></div>" +
        '<button type="button" class="convert-btn" data-plan="' + esc(p.plan_code) + '" data-price="' + price + '"' +
        ((enough && !isDowngrade) ? "" : " disabled") + ">" + label + "</button></div>";
    }).join("");
    card.innerHTML =
      '<div class="convert-title"><span class="convert-badge">限时</span>API 余额换购套餐<span style="font-weight:400;font-size:13px;color:var(--color-text-secondary)">· 剩余 ' + esc(countdown) + "</span></div>" +
      '<div class="convert-desc">限时窗口内，钱包余额可等值换购订阅套餐：扣除对应套餐价，剩余余额继续用于 API 按量；余额不足可先<a href="./checkout.html?kind=recharge">充值</a>凑单。</div>' +
      '<div class="convert-plans">' + rows + "</div>" +
      '<div class="convert-msg" id="convert-msg"></div>';
    card.hidden = false;
    Array.prototype.forEach.call(card.querySelectorAll(".convert-btn"), function (btn) {
      btn.addEventListener("click", function () { doConvert(btn); });
    });
    if (!convertState.timer) {
      convertState.timer = setInterval(renderConvert, 60000);
    }
  }

  async function doConvert(btn) {
    var planCode = btn.dataset.plan;
    var price = Number(btn.dataset.price);
    var p = null;
    convertState.catalog.forEach(function (x) { if (x.plan_code === planCode) p = x; });
    var name = p ? (p.display_name || planCode) : planCode;
    var isUp = p && p.quote && p.quote.is_upgrade;
    if (!window.confirm("确认用钱包余额换购 " + name + " 套餐？将扣除 " + fmtCny(price) + (isUp ? "（升级价已按旧套餐剩余天数折抵）" : "") + "，剩余余额继续用于 API 按量。")) return;
    btn.disabled = true;
    setConvertMsg("正在换购…", "");
    try {
      var res = await callGateway("buy_plan_v4_with_wallet", { plan_code: planCode });
      var balCny = Number(res.balance_micro) / 1000000;
      setConvertMsg("换购成功！套餐已生效，钱包剩余 " + fmtCny(balCny) + "。", "ok");
      try {
        var results = await Promise.allSettled([callGateway("plan_v4_status", {}), callGateway("list_my_orders", {})]);
        if (results[0].status === "fulfilled") { renderPlan(results[0].value); applyConvertStatus(results[0].value); }
        if (results[1].status === "fulfilled") { renderWallet(results[1].value); renderBills(results[1].value); convertState.balance = results[1].value && results[1].value.wallet ? results[1].value.wallet.balance_cny : null; }
      } catch (e2) { /* ignore refresh errors */ }
    } catch (e) {
      btn.disabled = false;
      var code = e && e.body && (e.body.code || e.body.error);
      var msg = (e && e.body && e.body.message) || "换购失败，请稍后重试。";
      if (code === "insufficient_balance") msg = "钱包余额不足，可先充值凑单后再换购。";
      if (code === "convert_window_closed") msg = "限时换购窗口已结束。";
      setConvertMsg(msg, "err");
    }
  }

  function applyConvertStatus(data) {
    convertState.info = data && data.wallet_convert ? data.wallet_convert : null;
    convertState.catalog = (data && data.catalog) || [];
    convertState.plan = data && data.plan;
    renderConvert();
  }

  // ── API 额度（钱包）──
  function renderWallet(data) {
    var wallet = data && data.wallet;
    var balEl = $("billing-balance");
    var metaEl = $("billing-meta");
    if (balEl) balEl.textContent = wallet ? fmtCny(wallet.balance_cny) : "¥0.00";
    if (metaEl) {
      if (wallet) {
        var bits = [];
        if (Number(wallet.debt_cny) > 0) bits.push("欠费 " + fmtCny(wallet.debt_cny));
        bits.push("累计充值 " + fmtCny(wallet.cumulative_recharge_cny));
        bits.push("限速档 Tier " + (wallet.tier || 0));
        metaEl.textContent = bits.join(" · ");
      } else {
        metaEl.textContent = "余额加载失败，请刷新重试。";
      }
    }
  }

  // ── 套餐 ──
  function renderPlan(data) {
    var plan = data && data.plan;
    var nameEl = $("plan-name");
    var remainEl = $("plan-remaining");
    var metaEl = $("plan-meta");
    var ctaEl = $("plan-cta");
    if (plan && plan.active) {
      var label = plan.display_name || { go: "Go", plus: "Plus", pro: "Pro" }[plan.plan_code] || plan.plan_code || "";
      if (nameEl) nameEl.textContent = label + " 套餐";
      var total = Number(plan.allowance_cny);
      var remain = Number(plan.remaining_cny);
      if (remainEl) remainEl.textContent = fmtCny(remain);
      var multNote = Number(plan.burn_multiplier) > 1 ? " · 套餐内按模型定价 ×" + Number(plan.burn_multiplier) + " 计扣" : "";
      if (metaEl) metaEl.textContent = "月度额度 " + fmtCny(total) + "（已用 " + fmtCny(plan.used_cny) + "）· 有效期至 " + fmtDate(plan.period_end) + multNote;
      if (ctaEl) { var s = ctaEl.querySelector(".NBPKZ"); (s || ctaEl).textContent = "续费 / 升级套餐"; }
    } else {
      if (nameEl) nameEl.textContent = "未订阅";
      if (remainEl) remainEl.textContent = "¥0.00";
      if (metaEl) metaEl.textContent = "订阅套餐后，Web Chat 与 Cancri Code IDE 的付费模型将从套餐月度额度扣费。";
      if (ctaEl) { var s2 = ctaEl.querySelector(".NBPKZ"); (s2 || ctaEl).textContent = "选择套餐"; }
    }
  }

  // ── 账单记录 ──
  function renderBills(data) {
    var orders = (data && data.orders) || [];
    var metaEl = $("bills-meta");
    var wrapEl = $("bills-table-wrap");
    if (!wrapEl) return;
    if (!orders.length) {
      if (metaEl) metaEl.textContent = "暂无账单记录。";
      wrapEl.innerHTML = "";
      return;
    }
    if (metaEl) metaEl.textContent = "共 " + orders.length + " 条记录";
    var rows = orders.map(function (o) {
      var created = fmtDate(o.created_at);
      var kind = o.order_kind_label || (o.order_kind === "topup" ? "充值" : "订阅");
      var spec = o.spec_label || "—";
      var status = o.status || "pending";
      var statusLabel = o.status_label || status;
      var code = o.activation_code ? "<code>" + esc(o.activation_code) + "</code>" : "—";
      var note = o.admin_note ? esc(o.admin_note) : "—";
      return "<tr><td>" + esc(created) + "</td><td>" + esc(kind) + "</td><td>" + esc(spec) +
        "</td><td>" + fmtCny(o.amount_cny) +
        '</td><td><span class="bills-status" data-s="' + esc(status) + '">' + esc(statusLabel) + "</span></td><td>" +
        code + "</td><td>" + note + "</td></tr>";
    }).join("");
    wrapEl.innerHTML = '<table class="bills-table"><thead><tr><th>日期</th><th>类型</th><th>规格</th><th>金额</th><th>工单状态</th><th>激活码</th><th>备注</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  // 2026-08-18 晚：重置卡整段已删除（原 callResetCard / o5period / renderReset /
  // loadReset / bindResetButton 共约 228 行）。重置卡系统随 Opus5 免费期结束一并下线：
  // 后端 slug /functions/v1/reset-card 与 4 个 RPC 均已移除，邀请奖励改为直接送 ¥1
  // 赠送余额，未消费的存卡已按 ¥1/张 折成余额补偿。
  // 若要恢复，别只加回这段 —— 还要同时恢复后端 slug、RPC，以及 billing.html 的 tab 与面板。

  async function init() {
    initTabs();
    // 2026-08-18 晚：原先这里还有 bindResetButton()。删函数时留下调用 = 运行时
    // `bindResetButton is not defined` 直接中断整个 init()，整页数据都不加载 ——
    // 而 `node --check` 只验语法、抓不到未定义引用（实测差点漏掉）。
    try {
      if (!window.PlatformAuth) throw new Error("supabase_not_loaded");
      getSupabase();
      var session = await PlatformAuth.requireSession({ timeoutMs: 6000 });
      if (!session) return;
      updateUserChip(session.user);
      applyPageLocale();
      var results = await Promise.allSettled([
        callGateway("plan_v4_status", {}),
        callGateway("list_my_orders", {}),
      ]);
      if (results[0].status === "fulfilled") renderPlan(results[0].value);
      else { var pm = $("plan-meta"); if (pm) pm.textContent = "套餐状态加载失败，请刷新重试。"; }
      if (results[1].status === "fulfilled") {
        renderWallet(results[1].value);
        renderBills(results[1].value);
        convertState.balance = results[1].value && results[1].value.wallet ? results[1].value.wallet.balance_cny : null;
      } else {
        renderWallet(null);
        var bm = $("bills-meta"); if (bm) bm.textContent = "账单记录加载失败，请刷新重试。";
      }
      if (results[0].status === "fulfilled") applyConvertStatus(results[0].value);
    } catch (e) {
      var metaEl = $("billing-meta");
      var planMeta = $("plan-meta");
      if (e && e.message === "supabase_not_loaded") {
        if (metaEl) metaEl.textContent = "依赖脚本加载失败，请检查网络后刷新。";
        if (planMeta) planMeta.textContent = "依赖脚本加载失败，请检查网络后刷新。";
        return;
      }
      if (e && e.message === "not_logged_in") {
        if (window.PlatformAuth) PlatformAuth.redirectToLogin();
        return;
      }
      if (metaEl) metaEl.textContent = "余额加载失败，请刷新重试。";
      if (planMeta) planMeta.textContent = "套餐状态加载失败，请刷新重试。";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
