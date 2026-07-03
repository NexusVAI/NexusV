// checkout-app.js — NexusV Stripe 风格结账页逻辑
// 流程：从 URL 参数读取订单选择（kind/plan/sku/amount/label/desc）→ 渲染左侧
//   "今日应付合计" → 用户扫码 + 填表（邮箱必填、QQ/微信二选一、备注选填）→
//   提交 submit_payment_order（后端按 ORDER_CATALOG 重算真实金额，前端 amount 仅预览）。
// 后端契约见 cf-gateway/src/chat-gateway.ported.ts handleSubmitPaymentOrder。
(function () {
  "use strict";

  var GW = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  var sb = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }
  function fmtPrice(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toFixed(2).replace(/\.00$/, "");
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
  async function getSession() {
    var r = await getSupabase().auth.getSession();
    return r && r.data ? r.data.session : null;
  }
  async function callGateway(endpoint, payload) {
    var session = await getSession();
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

  // ── 解析订单选择（来自 pricing 页跳转的 query params）──
  // 2026-07-02：定价页已退役为跳转，默认 kind=recharge（按量充值），用户在页面输入金额。
  function readSelection() {
    var p = new URLSearchParams(location.search);
    var kind = (p.get("kind") || "recharge").toLowerCase();
    if (kind !== "subscription" && kind !== "topup" && kind !== "recharge" && kind !== "plan_v4") kind = "recharge";
    var plan = p.get("plan") || "";
    var sku = p.get("sku") || "";
    var amount = Number(p.get("amount"));
    if (!Number.isFinite(amount)) amount = null;
    var label = p.get("label") || "";
    var desc = p.get("desc") || "";
    return { kind: kind, plan: plan, sku: sku, amount: amount, label: label, desc: desc };
  }

  var KIND_LABEL = { subscription: "订阅", topup: "加油包", recharge: "按量充值", plan_v4: "套餐订阅" };
  var PLAN_LABEL = { pro: "Pro", pro_plus: "Pro+", pro_max: "Pro Max" };
  // plan_v4 三档（Chat/IDE 套餐制），价格由后端 plan_catalog_v4 裁决，此处仅展示
  var PLAN_V4_LABEL = { go: "Go", plus: "Plus", pro: "Pro" };
  var PLAN_V4_PRICE = { go: 9.9, plus: 19, pro: 99 };
  var SKU_LABEL = {
    topup_small: "加油包 1500 万", topup_medium: "加油包 9000 万",
    topup_large: "加油包 4 亿", topup_custom: "自定义加油包",
  };

  // ── 渲染左栏（Stripe 风格：ProductSummary + LineItem + 小计 + 今日应付合计）──
  function renderSummary(sel) {
    var amount = sel.amount;
    var amountStr = amount != null ? "¥" + fmtPrice(amount) : "¥—";

    // ProductSummary：订阅名 + 大号金额 + 周期
    var psName = "";
    var interval = "";
    if (sel.kind === "plan_v4") {
      psName = "订阅 " + (sel.label || (PLAN_V4_LABEL[sel.plan] || "") + " 套餐");
      interval = "每月";
    } else if (sel.kind === "subscription") {
      psName = "订阅 " + (sel.label || PLAN_LABEL[sel.plan] || "Pro");
      interval = "每月";
    } else if (sel.kind === "recharge") {
      psName = "按量充值";
      interval = "一次性";
    } else {
      psName = sel.label || SKU_LABEL[sel.sku] || "加油包";
      interval = "一次性";
    }
    $("ps-name").textContent = psName;
    $("ps-amount").textContent = amountStr;
    $("ps-interval").textContent = interval;

    // LineItem：产品名 + 描述 + 计费周期 + 金额
    $("li-name").textContent = sel.label || psName;
    $("li-desc").textContent = sel.desc || "";
    $("li-billing").textContent = interval === "每月" ? "按月计费" : (interval === "一次性" ? "一次性付款" : interval);
    $("li-amount").textContent = amountStr;

    // 小计 + 今日应付合计（无税，二者同值）
    $("subtotal-value").textContent = amountStr;
    $("total-value").textContent = amountStr;

    // QR 金额同步（QR section 现在在左栏今日应付合计下方）
    $("qr-amount").textContent = amountStr;

    // 隐藏左栏骨架屏，显示真实 ProductSummary
    var skel = $("skel-ps");
    if (skel) skel.style.display = "none";
    var real = $("real-ps");
    if (real) real.style.display = "flex";

    // 显示 QR section（初始 display:none，渲染时显示）
    var qrSection = $("ck-qr-section");
    if (qrSection) qrSection.style.display = "flex";
  }

  // ── 支付方式切换（带淡入淡出）──
  function setupPayMethodTabs() {
    var tabs = $("pay-method-tabs");
    var qrImg = $("qr-img");
    var qrRecommend = $("qr-recommend");
    if (!tabs || !qrImg) return;
    var QR_SRC = { wechat: "Logo/1107.jpg", alipay: "Logo/ZFB.jpg" };
    var QR_ALT = { wechat: "微信收款码", alipay: "支付宝收款码" };
    var RECOMMEND = { wechat: "推荐使用微信支付", alipay: "推荐使用支付宝" };
    var current = "wechat";

    function switchTo(method) {
      if (!QR_SRC[method] || method === current) return;
      current = method;
      tabs.querySelectorAll("button").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-pay-method") === method);
      });
      qrRecommend.textContent = RECOMMEND[method];
      // 淡出旧图 → 切 src → 淡入新图
      qrImg.classList.add("is-leaving");
      setTimeout(function () {
        qrImg.src = QR_SRC[method];
        qrImg.alt = QR_ALT[method];
        qrImg.classList.remove("is-leaving");
      }, 200);
    }

    tabs.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () { switchTo(btn.getAttribute("data-pay-method")); });
    });
    // 暴露当前方式给提交逻辑
    window.__checkoutMethod = function () { return current; };
  }

  // ── 按量充值金额输入框联动（2026-07-02）──
  // 用户输入/选 chip → 校验 ¥1-2000 → 更新 sel.amount → 重新渲染所有金额显示。
  var AMOUNT_MIN = 1, AMOUNT_MAX = 2000;

  function setupAmountInput(sel) {
    var input = $("ck-amount-input");
    var hint = $("ck-amount-hint");
    var chipsWrap = $("ck-amount-chips");
    if (!input) return;

    // 套餐/订阅类订单：金额由后端目录裁决，隐藏自定义金额区
    if (sel.kind === "plan_v4" || sel.kind === "subscription") {
      var section = $("ck-amount-section");
      if (section) section.style.display = "none";
      if (sel.kind === "plan_v4" && sel.amount == null) {
        sel.amount = PLAN_V4_PRICE[sel.plan] != null ? PLAN_V4_PRICE[sel.plan] : null;
        renderSummary(sel);
      }
      return;
    }

    function syncChips(val) {
      if (!chipsWrap) return;
      var chips = chipsWrap.querySelectorAll(".ck-amount-chip");
      chips.forEach(function (c) {
        c.classList.toggle("is-active", Number(c.getAttribute("data-amount")) === val);
      });
    }

    function apply(val, fromChip) {
      var v = Number(val);
      if (!Number.isFinite(v)) v = 0;
      var clamped = Math.round(v);
      var valid = clamped >= AMOUNT_MIN && clamped <= AMOUNT_MAX;
      if (valid) {
        sel.amount = clamped;
        renderSummary(sel);
        input.classList.remove("is-invalid");
        hint.textContent = "¥1 - ¥2000，到账 1:1（¥1 = 100 万 token 积分）";
        hint.classList.remove("is-warn");
        syncChips(clamped);
      } else {
        input.classList.add("is-invalid");
        hint.textContent = clamped < AMOUNT_MIN
          ? "最少充值 ¥1。"
          : "最多充值 ¥2000，如需更大额度请联系客服。";
        hint.classList.add("is-warn");
        syncChips(-1);
      }
      return valid;
    }

    // 初始：若 URL 没带 amount，用输入框默认值（value=10）
    if (sel.amount == null) {
      sel.amount = Number(input.value) || AMOUNT_MIN;
    } else {
      input.value = sel.amount;
    }
    apply(sel.amount, true);

    input.addEventListener("input", function () { apply(input.value, false); });

    if (chipsWrap) {
      chipsWrap.addEventListener("click", function (e) {
        var chip = e.target.closest(".ck-amount-chip");
        if (!chip) return;
        var val = Number(chip.getAttribute("data-amount"));
        input.value = val;
        apply(val, true);
      });
    }

    // 暴露校验结果给 submitOrder
    window.__checkoutAmountValid = function () { return apply(input.value, false); };
  }

  function showMsg(text, kind) {
    var el = $("ck-msg");
    if (!el) return;
    var cls = kind === "warn" ? "ck-alert--warn" : (kind === "ok" ? "ck-alert--ok" : "ck-alert--info");
    el.innerHTML = '<div class="ck-alert ' + cls + '">' + text + "</div>";
  }

  function validate() {
    var email = $("cf-email").value.trim();
    var qq = $("cf-qq").value.trim();
    var wechat = $("cf-wechat").value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "请填写有效邮箱。";
    }
    var qqValid = qq && /^[0-9]{5,15}$/.test(qq);
    var wechatValid = wechat && wechat.length >= 2 && !/\s/.test(wechat);
    if (!qqValid && !wechatValid) {
      return "请至少填写 QQ 号（5-15 位纯数字）或微信号（至少 2 位、不含空格）其一。";
    }
    if (qq && !qqValid) return "QQ 号必须是 5-15 位纯数字。";
    if (wechat && !wechatValid) return "微信号至少 2 位且不含空格。";
    return null;
  }

  async function submitOrder(sel) {
    var err = validate();
    if (err) { showMsg(esc(err), "warn"); return; }
    // 金额校验（按量充值）
    if (window.__checkoutAmountValid && !window.__checkoutAmountValid()) {
      showMsg(esc("请输入有效的充值金额（¥1 - ¥2000）。"), "warn"); return;
    }
    var btn = $("cf-submit");
    btn.disabled = true; var orig = btn.textContent; btn.textContent = "提交中…";
    var payload = {
      email: $("cf-email").value.trim().toLowerCase(),
      qq: $("cf-qq").value.trim() || null,
      wechat_id: $("cf-wechat").value.trim() || null,
      user_note: $("cf-note").value.trim() || null,
      method: (window.__checkoutMethod && window.__checkoutMethod()) || "unspecified",
      order_kind: sel.kind,
    };
    if (sel.kind === "plan_v4") {
      payload.plan_code = sel.plan || "go";
    } else if (sel.kind === "subscription") {
      payload.plan_code = sel.plan || "pro";
    } else if (sel.kind === "topup") {
      payload.topup_sku = sel.sku || "topup_custom";
      if (sel.sku === "topup_custom" || !sel.sku) payload.amount_cny = sel.amount;
    } else if (sel.kind === "recharge") {
      payload.amount_cny = sel.amount;
    }
    try {
      var data = await callGateway("submit_payment_order", payload);
      var order = data.order || {};
      showMsg(
        "✅ 订单已提交，订单号 <code>" + esc(order.id) + "</code>。" +
        "应付 <code>¥" + esc(fmtPrice(order.amount_cny)) + "</code>（以服务端核定为准）。" +
        "请扫码付款后等待审核，到账后权益自动开通。" +
        ' <a href="chat/orders.html">查看订单 →</a>',
        "ok"
      );
      btn.disabled = false; btn.textContent = "已提交，再提交一单";
    } catch (e) {
      var m = (e.body && (e.body.message || e.body.error)) || e.message || "提交失败";
      showMsg(esc("❌ " + m), "warn");
      btn.disabled = false; btn.textContent = orig;
    }
  }

  async function init() {
    var sel = readSelection();
    renderSummary(sel);
    setupPayMethodTabs();
    setupAmountInput(sel);
    var auth = window.PlatformAuth;
    var skelPay = $("skel-payment");
    var payMount = skelPay && skelPay.parentElement;

    try {
      if (!window.PlatformAuth) throw new Error("supabase_not_loaded");
      getSupabase();
      var session = await PlatformAuth.requireSession({ timeoutMs: 6000 });
      if (skelPay) skelPay.style.display = "none";
      if (!session) return;
      var emailEl = $("cf-email");
      if (emailEl) {
        emailEl.value = session.user.email || "";
        emailEl.disabled = false;
      }
      $("ck-body").style.display = "block";
    } catch (e) {
      if (skelPay) skelPay.style.display = "none";
      if (e && e.message === "supabase_not_loaded") {
        if (auth) auth.showAuthError("依赖脚本加载失败，请检查网络后刷新。", payMount);
        return;
      }
      if (auth) auth.redirectToLogin();
    }

    var form = $("checkout-form");
    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); submitOrder(sel); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
