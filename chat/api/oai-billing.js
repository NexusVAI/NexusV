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
      ["Billing", "账单"],
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
  // tabFromHash 的 indexOf 判定为未知 → 回落到 DEFAULT_TAB，不会白屏。
  // 2026-09-08：顺序与默认页签都改成 API 额度优先 —— 这页的主要来客是查
  // API 余额的开放平台用户，订阅套餐是次要入口。billing.html 里的按钮 DOM
  // 顺序要跟这里一致，否则滑块位置和视觉顺序会对不上。
  // 2026-09-09：新增 "redeem"（16688 发卡通道的卡密兑换）。它排在 bills 右边，
  // billing.html 里的按钮 DOM 顺序必须与本数组一致，否则滑块位置会对不上。
  var TABS = ["api", "plan", "bills", "redeem"];
  var DEFAULT_TAB = "api";

  // 发卡店（收款通道，2026-09-09 起替代爱发电 + 自建 checkout）。
  // ⚠️ 同一串还写在 billing.html 的几个 <a> 里（静态锚点，不依赖 JS 也能点），
  //    以及 chat/assets/claude-upgrade/pricing-page.js（那边是按套餐深链到具体商品）。
  //    换店铺时三处都要改。
  var SHOP_URL = "https://www.16688.com.cn/shop/S570528";

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
    return TABS.indexOf(h) >= 0 ? h : DEFAULT_TAB;
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
      '<div class="convert-desc">限时窗口内，钱包余额可等值换购订阅套餐：扣除对应套餐价，剩余余额继续用于 API 按量；余额不足可先<a href="' + SHOP_URL + '" target="_blank" rel="noopener">买张充值卡</a>凑单。</div>' +
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
  //
  // 2026-09-09：卡密兑换与旧的 api_orders 并入同一张表。
  // 卡密是无记名票据，没有"下单"这一步，所以它**不落 api_orders** —— 在这之前
  // 用户兑完卡回到这一页，看到的是「暂无账单记录」，充进去的钱毫无痕迹。
  function renderBills(data) {
    var orders = (data && data.orders) || [];
    var cards = (data && data.card_redemptions) || [];
    var metaEl = $("bills-meta");
    var wrapEl = $("bills-table-wrap");
    if (!wrapEl) return;

    var items = [];
    orders.forEach(function (o) {
      items.push({
        at: o.created_at,
        date: fmtDate(o.created_at),
        kind: o.order_kind_label || (o.order_kind === "topup" ? "充值" : "订阅"),
        spec: o.spec_label || "—",
        amountHtml: fmtCny(o.amount_cny),
        status: o.status || "pending",
        statusLabel: o.status_label || o.status || "pending",
        note: o.admin_note ? esc(o.admin_note) : "—",
      });
    });
    cards.forEach(function (c) {
      var face = Number(c.face_cny);
      // 到账额度与实付是两个数（实付含转嫁的通道费），两个都要显示：
      // 只显示一个，用户对账时必然会怀疑被多收。
      var paid = Number(c.paid_cny);
      var amountHtml = fmtCny(face);
      if (isFinite(paid) && isFinite(face) && paid > face) {
        amountHtml += '<span style="color:var(--color-text-tertiary);font-size:12px"> （实付 ' + fmtCny(paid) + "）</span>";
      }
      items.push({
        at: c.redeemed_at,
        date: fmtDate(c.redeemed_at),
        kind: c.kind === "plan" ? "卡密兑换 · 套餐" : "卡密兑换 · API 额度",
        spec: c.display_name || c.sku || "—",
        amountHtml: amountHtml,
        status: c.refunded ? "rejected" : "activated",
        statusLabel: c.refunded ? "已退款待处理" : "已到账",
        note: c.trade_no ? "发卡单号 " + esc(c.trade_no) : "—",
      });
    });

    if (!items.length) {
      if (metaEl) metaEl.textContent = "暂无账单记录。";
      wrapEl.innerHTML = "";
      return;
    }
    items.sort(function (a, b) {
      return new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime();
    });
    if (metaEl) {
      metaEl.textContent = "共 " + items.length + " 条记录"
        + (cards.length ? "（含 " + cards.length + " 笔卡密兑换）" : "");
    }
    var rows = items.map(function (it) {
      return "<tr><td>" + esc(it.date) + "</td><td>" + esc(it.kind) + "</td><td>" + esc(it.spec) +
        "</td><td>" + it.amountHtml +
        '</td><td><span class="bills-status" data-s="' + esc(it.status) + '">' + esc(it.statusLabel) +
        "</span></td><td>" + it.note + "</td></tr>";
    }).join("");
    wrapEl.innerHTML = '<table class="bills-table"><thead><tr><th>日期</th><th>类型</th><th>规格</th><th>金额</th><th>状态</th><th>备注</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  // 2026-08-18 晚：重置卡整段已删除（原 callResetCard / o5period / renderReset /
  // loadReset / bindResetButton 共约 228 行）。重置卡系统随 Opus5 免费期结束一并下线：
  // 后端 slug /functions/v1/reset-card 与 4 个 RPC 均已移除，邀请奖励改为直接送 ¥1
  // 赠送余额，未消费的存卡已按 ¥1/张 折成余额补偿。
  // 若要恢复，别只加回这段 —— 还要同时恢复后端 slug、RPC，以及 billing.html 的 tab 与面板。

  // ── 兑换卡密（16688 发卡通道）────────────────────────────────────────
  //
  // ⛔ 授权判决**全在后端**：网关先按卡号回查平台订单（确实卖出、未退款、金额够）
  //    才入账。这里只做两件事：省掉一次显然格式错的往返，以及把后端给的文案显示出来。
  //    别在这里加任何本地「看起来像有效卡就先给个成功提示」的乐观处理 ——
  //    用户会以为到账了。
  var REDEEM_PREFIX = "CANCRI-CARD";
  var REDEEM_BODY_LEN = 32;

  // 与后端 shop16688-redeem.ts 的 formatCardCode 同规则：剥掉一切非字母数字再重建。
  // 这样「带横线」「不带横线」「小写」「中间有空格」都能兑。
  function normalizeCardCode(raw) {
    var bare = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    var prefix = REDEEM_PREFIX.replace(/-/g, "");
    if (bare.indexOf(prefix) !== 0) return null;
    var body = bare.slice(prefix.length);
    if (body.length !== REDEEM_BODY_LEN) return null;
    if (!/^[A-Z2-7]+$/.test(body)) return null;
    var groups = [];
    for (var i = 0; i < REDEEM_BODY_LEN; i += 8) groups.push(body.slice(i, i + 8));
    return REDEEM_PREFIX + "-" + groups.join("-");
  }

  function setRedeemMsg(text, kind) {
    var el = $("redeem-msg");
    if (!el) return;
    el.textContent = text || "";
    el.dataset.s = kind || "";
  }

  async function refreshAfterRedeem() {
    try {
      var results = await Promise.allSettled([
        callGateway("plan_v4_status", {}),
        callGateway("list_my_orders", {}),
      ]);
      if (results[0].status === "fulfilled") { renderPlan(results[0].value); applyConvertStatus(results[0].value); }
      if (results[1].status === "fulfilled") {
        renderWallet(results[1].value);
        renderBills(results[1].value);
        convertState.balance = results[1].value && results[1].value.wallet ? results[1].value.wallet.balance_cny : null;
      }
    } catch (e) { /* 刷新失败不影响兑换本身已经成功的事实 */ }
  }

  async function doRedeem() {
    var input = $("redeem-input");
    var btn = $("redeem-btn");
    if (!input || !btn) return;
    var code = normalizeCardCode(input.value);
    if (!code) {
      setRedeemMsg("卡密格式不对。正确格式形如 CANCRI-CARD-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX。", "err");
      return;
    }
    input.value = code;
    btn.disabled = true;
    input.disabled = true;
    setRedeemMsg("正在核验卡密…", "warn");
    try {
      var res = await callGateway("redeem_card", { code: code });
      if (res && res.already) {
        setRedeemMsg("这张卡你已经兑换过了，额度早就到账了。", "ok");
      } else if (res && res.kind === "plan") {
        setRedeemMsg("套餐已开通，有效期 30 天。下方「套餐」页签可以看到最新状态。", "ok");
      } else {
        var face = Number(res && res.face_cny);
        setRedeemMsg(
          isFinite(face) && face > 0
            ? "兑换成功，" + fmtCny(face) + " 已进入 API 额度余额。"
            : "兑换成功，额度已到账。",
          "ok",
        );
      }
      input.value = "";
      await refreshAfterRedeem();
    } catch (e) {
      var body = (e && e.body) || {};
      // 后端已经给了面向用户的文案，这里原样显示 —— 别在前端再维护一份错误码映射，
      // 两份迟早会漂（AGENTS.md §5.5.1 反复记录的形状）。
      setRedeemMsg(body.message || (e && e.message) || "兑换失败，请稍后重试。", body.retryable ? "warn" : "err");
    } finally {
      btn.disabled = false;
      input.disabled = false;
    }
  }

  function bindRedeem() {
    var btn = $("redeem-btn");
    var input = $("redeem-input");
    if (btn) btn.addEventListener("click", function () { doRedeem(); });
    if (input) {
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); doRedeem(); }
      });
    }
  }

  async function init() {
    initTabs();
    bindRedeem();
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
