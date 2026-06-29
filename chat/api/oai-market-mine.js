/* Cancri 螃蟹市场 — market_mine.html「我的上架」页面逻辑（2026-06-28 重写）。
 *
 * 设计目标（对照用户反馈）：
 *   - 与模型广场一致的卡片：平台图标缩略图 + 展示名 + 可复制 model id pill +
 *     V3 输入/输出价（不再显示「倍率」）。
 *   - 挂单支持：编辑 / 启用·禁用 / 下架 / 删除。
 *   - 收益统计卡 + 我的挂单 / 调用日志 / 提现工单 三个可切换 Tab（筛选真正生效）。
 *   - 提现到站内（即时）/ 提现到微信（走审批）。
 *   - 全中文；按钮使用平台 _Button_ 风格，不再用裸蓝色。
 *   - 不再用骨架屏占位：加载态明确，失败可重试。
 *
 * 后端契约（cf-gateway 的 cancri-market 路由，见 docs/cancri-market-backend.md）：
 *   GET    /me/overview            -> { balance:{available_micro,frozen_micro,withdrawn_micro}, listings:[...], summary:{total_credit_micro,total_fee_micro,total_tx} }
 *   GET    /me/calls               -> { calls:[...] }
 *   GET    /me/tickets             -> { tickets:[...] }
 *   POST   /listings   {platform,base_url,key,model_whitelist,display_name,description,input_price_per_m,output_price_per_m,cached_input_factor}
 *   PATCH  /listings/:id {display_name?,description?,model_whitelist?,input_price_per_m?,output_price_per_m?,base_url?,key?,status?}
 *   DELETE /listings/:id
 *   POST   /me/withdraw {channel:'site'|'wechat', amount_micro, wechat_id?}
 * 鉴权：Authorization: Bearer <jwt>，apikey: ANON。
 */
(function () {
  "use strict";

  var MARKET_BASE = (window.__SUPABASE_URL__ || "") + "/functions/v1/cancri-market";
  var GW = (window.__SUPABASE_URL__ || "") + "/functions/v1/chat-gateway";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";

  var PLATFORM_ICON = {
    openai: "./openai.svg", anthropic: "./claude-color.svg", google: "./gemini-color.svg",
    deepseek: encodeURI("./deepseek-color (1).svg"), xai: "./grok.svg", moonshot: "./moonshot.svg",
    zhipu: "./zhipu-color.svg", qwen: "./qwen-color.svg", minimax: "./minimax-color.svg",
    doubao: "./doubao-color.svg", meta: "./meta-color.svg", mistral: "./mistral-color.svg",
  };
  var PLATFORM_LABEL = {
    openai: "OpenAI", anthropic: "Anthropic", google: "Google", deepseek: "DeepSeek",
    xai: "xAI", moonshot: "Moonshot", zhipu: "智谱", qwen: "通义千问", minimax: "MiniMax",
    doubao: "豆包", meta: "Meta", mistral: "Mistral",
  };
  var PLATFORM_OPTIONS = [
    ["openai", "OpenAI"], ["anthropic", "Anthropic"], ["google", "Google"],
    ["deepseek", "DeepSeek"], ["xai", "xAI"], ["moonshot", "Moonshot"],
    ["zhipu", "智谱 Zhipu"], ["qwen", "通义千问 Qwen"], ["minimax", "MiniMax"],
    ["doubao", "豆包 Doubao"], ["meta", "Meta"], ["mistral", "Mistral"], ["custom", "自定义"],
  ];
  function pkey(p) { return String(p || "").toLowerCase().replace(/[\s_-]/g, ""); }
  function platformIcon(p) { return PLATFORM_ICON[pkey(p)] || "../Logo/Cancri1.jpg"; }
  function platformLabel(p) { return PLATFORM_LABEL[pkey(p)] || p || "自定义"; }

  var STATUS_LABEL = { active: "已上架", disabled: "已禁用", pending: "审核中", failed: "校验失败", depleted: "已下架" };

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  function fmtCny(micro) {
    var v = (Number(micro) || 0) / 1e6;
    if (v === 0) return "¥0.00";
    return "¥" + (Math.abs(v) < 0.01 ? v.toFixed(6) : v.toFixed(2));
  }
  function fmtPrice(n) {
    n = Number(n);
    if (n == null || !isFinite(n)) return "—";
    if (n === 0) return "免费";
    return "¥" + (n < 1 ? n.toFixed(2) : n.toFixed(2));
  }
  function fmtTime(s) {
    if (!s) return "—";
    try { var d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleString("zh-CN", { hour12: false }); }
    catch (e) { return String(s); }
  }

  var COPY_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2"></rect>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  function toast(text, isErr) {
    var t = document.getElementById("mm-toast");
    if (!t) { t = document.createElement("div"); t.id = "mm-toast"; t.className = "mm-toast"; document.body.appendChild(t); }
    t.textContent = text;
    t.className = "mm-toast" + (isErr ? " err" : "");
    requestAnimationFrame(function () { t.classList.add("show"); });
    clearTimeout(t.__timer);
    t.__timer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  function show(id) { var el = document.getElementById(id); if (el) el.removeAttribute("data-cancri-hidden"); }
  function hide(id) { var el = document.getElementById(id); if (el) el.setAttribute("data-cancri-hidden", ""); }

  // ── 鉴权 + 接口 ────────────────────────────────────────────
  var state = { token: null, listings: [], calls: [], tickets: [], balance: {}, summary: {} };

  function authHeaders(extra) {
    var h = { apikey: ANON, Authorization: "Bearer " + state.token };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  function api(method, path, body) {
    var opts = { method: method, headers: authHeaders(body ? { "Content-Type": "application/json" } : null) };
    if (body) opts.body = JSON.stringify(body);
    return fetch(MARKET_BASE + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw Object.assign(new Error(data.error || ("HTTP " + r.status)), { status: r.status });
        return data;
      });
    });
  }

  // ── 渲染：收益统计 + 挂单 ──────────────────────────────────
  function renderOverview() {
    var b = state.balance || {};
    var s = state.summary || {};
    document.getElementById("mm-available").textContent = fmtCny(b.available_micro);
    document.getElementById("mm-frozen").textContent = fmtCny(b.frozen_micro);
    document.getElementById("mm-withdrawn").textContent = fmtCny(b.withdrawn_micro);
    document.getElementById("mm-total-credit").textContent = fmtCny(s.total_credit_micro);
    document.getElementById("mm-total-tx").textContent = "共 " + (s.total_tx || 0) + " 笔成交";
    renderListings();
  }

  function modelPills(models) {
    if (!Array.isArray(models) || !models.length) return "";
    return '<div class="mm-id-row">' + models.map(function (m) {
      return '<button type="button" class="cancri-id" data-copy="' + escAttr(m) + '" title="点击复制 model id（买家调用时前缀 px:）">' +
        '<span class="cancri-id__text">' + esc(m) + "</span>" + COPY_SVG + "</button>";
    }).join("") + "</div>";
  }

  function listingCardHtml(l) {
    var name = l.display_name || platformLabel(l.platform);
    var st = l.status || "active";
    var models = Array.isArray(l.model_whitelist) ? l.model_whitelist : [];
    var actToggle = st === "disabled"
      ? '<button type="button" class="mm-act" data-act="enable" data-id="' + escAttr(l.id) + '">启用</button>'
      : '<button type="button" class="mm-act" data-act="disable" data-id="' + escAttr(l.id) + '">禁用</button>';
    var actDelist = st === "depleted" ? "" :
      '<button type="button" class="mm-act" data-act="delist" data-id="' + escAttr(l.id) + '">下架</button>';
    return (
      '<div class="flex flex-col text-emphasis" data-listing-id="' + escAttr(l.id) + '">' +
        '<div class="h-[180px] w-full">' +
          '<div class="cancri-thumb flex h-full w-full flex-1 flex-row items-center justify-center gap-4 rounded-lg" ' +
               'style="background-image:url(\'' + escAttr(platformIcon(l.platform)) + '\')">' +
            '<span class="cancri-thumb__name">' + esc(name) + "</span>" +
          "</div>" +
        "</div>" +
        '<div class="mt-5 flex flex-col gap-1">' +
          '<div class="flex items-center justify-between gap-2">' +
            '<div class="text-base font-semibold text-emphasis">' + esc(name) + "</div>" +
            '<span class="mm-card-status" data-s="' + escAttr(st) + '">' + esc(STATUS_LABEL[st] || st) + "</span>" +
          "</div>" +
          (l.description ? '<div class="text-sm text-secondary">' + esc(l.description) + "</div>" : "") +
          (l.status_detail ? '<div class="text-sm text-secondary">' + esc(l.status_detail) + "</div>" : "") +
          '<div class="cancri-spec mt-3">' +
            '<div class="cancri-spec__row"><span class="cancri-spec__key">平台</span><span class="cancri-spec__val">' + esc(platformLabel(l.platform)) + "</span></div>" +
            '<div class="cancri-spec__row" style="align-items:flex-start;"><span class="cancri-spec__key">支持模型</span><span class="cancri-spec__val">' + (models.length ? modelPills(models) : "—") + "</span></div>" +
            '<div class="cancri-spec__row"><span class="cancri-spec__key">输入价</span><span class="cancri-spec__val cancri-price"><span class="cancri-price__num">' + esc(fmtPrice(l.input_price_per_m)) + '</span><span class="cancri-price__unit">/百万 token</span></span></div>' +
            '<div class="cancri-spec__row"><span class="cancri-spec__key">输出价</span><span class="cancri-spec__val cancri-price"><span class="cancri-price__num">' + esc(fmtPrice(l.output_price_per_m)) + '</span><span class="cancri-price__unit">/百万 token</span></span></div>' +
          "</div>" +
          '<div class="mm-actions">' +
            '<button type="button" class="mm-act" data-act="edit" data-id="' + escAttr(l.id) + '">编辑</button>' +
            actToggle + actDelist +
            '<button type="button" class="mm-act mm-act--danger" data-act="delete" data-id="' + escAttr(l.id) + '">删除</button>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function renderListings() {
    var box = document.getElementById("mm-listings");
    var empty = document.getElementById("mm-listings-empty");
    var count = document.getElementById("mm-listings-count");
    var list = state.listings || [];
    count.textContent = String(list.length);
    if (!list.length) { box.innerHTML = ""; show("mm-listings-empty"); return; }
    hide("mm-listings-empty");
    if (empty) empty.setAttribute("data-cancri-hidden", "");
    box.innerHTML = list.map(listingCardHtml).join("");
  }

  function renderCalls() {
    var box = document.getElementById("mm-calls");
    var list = state.calls || [];
    if (!list.length) { box.innerHTML = '<div class="mm-empty">还没有买家通过你的挂单发起调用。</div>'; return; }
    box.innerHTML =
      '<div class="mm-table-wrap"><table class="mm-table"><thead><tr>' +
      "<th>时间</th><th>买家</th><th>模型</th><th class='num'>输入 token</th><th class='num'>输出 token</th><th class='num'>买家实付</th><th class='num'>我的收益</th>" +
      "</tr></thead><tbody>" +
      list.map(function (c) {
        return "<tr>" +
          "<td>" + esc(fmtTime(c.created_at)) + "</td>" +
          "<td>" + esc(c.buyer_email || "—") + "</td>" +
          "<td><code>" + esc(c.model_id) + "</code></td>" +
          "<td class='num'>" + esc(c.tokens_in) + "</td>" +
          "<td class='num'>" + esc(c.tokens_out) + "</td>" +
          "<td class='num'>" + esc(fmtCny(c.buyer_charged_micro)) + "</td>" +
          "<td class='num'>" + esc(fmtCny(c.seller_credit_micro)) + "</td>" +
          "</tr>";
      }).join("") +
      "</tbody></table></div>";
  }

  function ticketStatusLabel(s) { return { pending: "待审核", approved: "已通过", rejected: "已驳回", done: "已到账" }[s] || s; }
  function renderTickets() {
    var box = document.getElementById("mm-tickets");
    var list = state.tickets || [];
    if (!list.length) { box.innerHTML = '<div class="mm-empty">还没有提现工单。点上方「提现到站内 / 微信」发起提现。</div>'; return; }
    box.innerHTML =
      '<div class="mm-table-wrap"><table class="mm-table"><thead><tr>' +
      "<th>申请时间</th><th>渠道</th><th class='num'>金额</th><th>微信/QQ</th><th>状态</th><th>备注</th>" +
      "</tr></thead><tbody>" +
      list.map(function (t) {
        return "<tr>" +
          "<td>" + esc(fmtTime(t.created_at)) + "</td>" +
          "<td>" + (t.channel === "site" ? "站内余额" : "微信") + "</td>" +
          "<td class='num'>" + esc(fmtCny(t.amount_micro)) + "</td>" +
          "<td>" + esc(t.wechat_id || "—") + "</td>" +
          "<td>" + esc(ticketStatusLabel(t.status)) + "</td>" +
          "<td>" + esc(t.review_note || "—") + "</td>" +
          "</tr>";
      }).join("") +
      "</tbody></table></div>";
  }

  // ── Tab ────────────────────────────────────────────────────
  function setupTabs() {
    var tabs = document.querySelectorAll(".mm-tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");
        var name = tab.getAttribute("data-tab");
        ["listings", "calls", "tickets"].forEach(function (n) {
          var panel = document.getElementById("mm-panel-" + n);
          if (panel) panel.hidden = n !== name;
        });
        if (name === "calls" && !state.calls.length) loadCalls();
        if (name === "tickets") loadTickets();
      });
    });
  }

  // ── 复制 model id ──────────────────────────────────────────
  function setupCopy() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".cancri-id[data-copy]");
      if (!btn) return;
      var text = btn.getAttribute("data-copy");
      var done = function () { btn.classList.add("is-copied"); toast("已复制：" + text); setTimeout(function () { btn.classList.remove("is-copied"); }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(done);
      else done();
    });
  }

  // ── 挂单操作（编辑/启用/禁用/下架/删除）────────────────────
  function findListing(id) {
    for (var i = 0; i < state.listings.length; i++) if (String(state.listings[i].id) === String(id)) return state.listings[i];
    return null;
  }
  function setupListingActions() {
    document.getElementById("mm-listings").addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".mm-act[data-act]");
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      var act = btn.getAttribute("data-act");
      if (act === "edit") return openListingModal(findListing(id));
      if (act === "enable") return patchStatus(id, "active", "已启用");
      if (act === "disable") return patchStatus(id, "disabled", "已禁用");
      if (act === "delist") {
        if (!confirm("确认下架该挂单？下架后买家将无法再选用，已结算收益不受影响。")) return;
        return patchStatus(id, "depleted", "已下架");
      }
      if (act === "delete") {
        if (!confirm("确认删除该挂单？此操作不可恢复（历史成交记录保留）。")) return;
        api("DELETE", "/listings/" + id).then(function () { toast("已删除"); loadOverview(); }).catch(apiErr);
      }
    });
  }
  function patchStatus(id, status, okMsg) {
    api("PATCH", "/listings/" + id, { status: status }).then(function () { toast(okMsg); loadOverview(); }).catch(apiErr);
  }
  function apiErr(e) { toast("操作失败：" + (e && e.message ? e.message : e), true); }

  // ── 弹窗基础 ───────────────────────────────────────────────
  function openModal(node) {
    var bd = document.createElement("div");
    bd.className = "mm-modal-backdrop";
    bd.appendChild(node);
    bd.addEventListener("click", function (e) { if (e.target === bd) document.body.removeChild(bd); });
    document.body.appendChild(bd);
    var esc = function (e) { if (e.key === "Escape") { if (bd.parentNode) document.body.removeChild(bd); document.removeEventListener("keydown", esc); } };
    document.addEventListener("keydown", esc);
    return function close() { if (bd.parentNode) document.body.removeChild(bd); document.removeEventListener("keydown", esc); };
  }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

  // ── 新增 / 编辑挂单 ────────────────────────────────────────
  function openListingModal(listing) {
    var isEdit = !!listing;
    var m = el("div", "mm-modal");
    var platOpts = PLATFORM_OPTIONS.map(function (p) {
      var sel = listing && pkey(listing.platform) === p[0] ? " selected" : "";
      return '<option value="' + p[0] + '"' + sel + ">" + esc(p[1]) + "</option>";
    }).join("");
    m.innerHTML =
      "<h2>" + (isEdit ? "编辑挂单" : "新增上架") + "</h2>" +
      '<div class="mm-modal__sub">买家调用时会被强制加 <code>px:</code> 前缀（如 <code>px:gpt-4o</code>）以区分蟹市线路并计费。</div>' +
      '<div class="mm-modal__err" id="mm-modal-err"></div>' +
      '<div class="mm-field"><label>展示名称</label><input class="mm-input" id="f-name" placeholder="如：我的 GPT-4o 通道" value="' + escAttr(listing ? listing.display_name : "") + '"></div>' +
      '<div class="mm-grid2">' +
        '<div class="mm-field"><label>平台</label><select class="mm-select" id="f-platform">' + platOpts + "</select></div>" +
        '<div class="mm-field"><label>Base URL</label><input class="mm-input" id="f-baseurl" placeholder="https://api.openai.com/v1" value="' + escAttr(listing ? listing.base_url : "") + '"></div>' +
      "</div>" +
      '<div class="mm-field"><label>API Key' + (isEdit ? "（留空＝不修改）" : "") + '</label><input class="mm-input" id="f-key" type="password" placeholder="' + (isEdit ? "••••••（不修改请留空）" : "sk-...") + '"><div class="mm-hint">Key 经 AES-256-GCM 加密存储，明文绝不回传浏览器。</div></div>' +
      '<div class="mm-field"><label>支持模型（每行一个，或逗号分隔）</label><textarea class="mm-textarea" id="f-models" placeholder="gpt-4o\ngpt-4o-mini">' + esc(listing && listing.model_whitelist ? listing.model_whitelist.join("\n") : "") + "</textarea></div>" +
      '<div class="mm-grid2">' +
        '<div class="mm-field"><label>输入价（元 / 百万 token）</label><input class="mm-input" id="f-in" type="number" step="0.0001" min="0" placeholder="0.15" value="' + escAttr(listing && listing.input_price_per_m != null ? listing.input_price_per_m : "") + '"></div>' +
        '<div class="mm-field"><label>输出价（元 / 百万 token）</label><input class="mm-input" id="f-out" type="number" step="0.0001" min="0" placeholder="0.60" value="' + escAttr(listing && listing.output_price_per_m != null ? listing.output_price_per_m : "") + '"></div>' +
      "</div>" +
      '<div class="mm-field"><label>简介（可选）</label><input class="mm-input" id="f-desc" placeholder="如：官方直连，余额充足" value="' + escAttr(listing ? listing.description : "") + '"></div>' +
      '<div class="mm-modal__actions">' +
        '<button type="button" class="_Button_6dmow_1" data-color="secondary" data-variant="ghost" data-pill data-size="md" id="f-cancel"><span class="_ButtonInner_6dmow_4">取消</span></button>' +
        '<button type="button" class="_Button_6dmow_1" data-color="primary" data-variant="solid" data-pill data-size="md" id="f-submit"><span class="_ButtonInner_6dmow_4">' + (isEdit ? "保存修改" : "确认上架") + "</span></button>" +
      "</div>";
    var close = openModal(m);
    m.querySelector("#f-cancel").addEventListener("click", close);
    m.querySelector("#f-submit").addEventListener("click", function () {
      var errBox = m.querySelector("#mm-modal-err");
      var name = m.querySelector("#f-name").value.trim();
      var platform = m.querySelector("#f-platform").value;
      var baseUrl = m.querySelector("#f-baseurl").value.trim();
      var key = m.querySelector("#f-key").value.trim();
      var models = m.querySelector("#f-models").value.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      var inP = parseFloat(m.querySelector("#f-in").value);
      var outP = parseFloat(m.querySelector("#f-out").value);
      var desc = m.querySelector("#f-desc").value.trim();
      errBox.textContent = "";
      if (!name) return (errBox.textContent = "请填写展示名称。");
      if (!baseUrl || !/\/v1\/?$/.test(baseUrl)) return (errBox.textContent = "Base URL 必须以 /v1 结尾。");
      if (!isEdit && !key) return (errBox.textContent = "请填写 API Key。");
      if (!models.length) return (errBox.textContent = "请至少填写一个支持的模型 id。");
      if (!isFinite(inP) || inP < 0 || !isFinite(outP) || outP < 0) return (errBox.textContent = "请填写有效的输入/输出价。");
      var body = { platform: platform, base_url: baseUrl, model_whitelist: models, display_name: name, description: desc, input_price_per_m: inP, output_price_per_m: outP, cached_input_factor: 0.1 };
      if (key) body.key = key;
      var p = isEdit ? api("PATCH", "/listings/" + listing.id, body) : api("POST", "/listings", body);
      var submitBtn = m.querySelector("#f-submit");
      submitBtn.setAttribute("disabled", "");
      p.then(function () { close(); toast(isEdit ? "已保存" : "上架成功"); loadOverview(); })
        .catch(function (e) { submitBtn.removeAttribute("disabled"); errBox.textContent = "提交失败：" + (e && e.message ? e.message : e); });
    });
  }

  // ── 提现 ───────────────────────────────────────────────────
  function openWithdrawModal(channel) {
    var avail = (Number(state.balance.available_micro) || 0) / 1e6;
    var m = el("div", "mm-modal");
    m.innerHTML =
      "<h2>" + (channel === "site" ? "提现到站内余额" : "提现到微信") + "</h2>" +
      '<div class="mm-modal__sub">' + (channel === "site" ? "即时到账到你的平台钱包，可用于消费。" : "提交工单，管理员审核通过后线下打款。") + "可提现余额 <b>" + fmtCny(state.balance.available_micro) + "</b>。</div>" +
      '<div class="mm-modal__err" id="mm-wd-err"></div>' +
      '<div class="mm-field"><label>提现金额（元）</label><input class="mm-input" id="wd-amount" type="number" step="0.01" min="0" max="' + avail + '" placeholder="0.00"></div>' +
      (channel === "wechat" ? '<div class="mm-field"><label>微信号 / QQ 号</label><input class="mm-input" id="wd-wechat" placeholder="用于线下打款联系"></div>' : "") +
      '<div class="mm-modal__actions">' +
        '<button type="button" class="_Button_6dmow_1" data-color="secondary" data-variant="ghost" data-pill data-size="md" id="wd-cancel"><span class="_ButtonInner_6dmow_4">取消</span></button>' +
        '<button type="button" class="_Button_6dmow_1" data-color="primary" data-variant="solid" data-pill data-size="md" id="wd-submit"><span class="_ButtonInner_6dmow_4">确认提现</span></button>' +
      "</div>";
    var close = openModal(m);
    m.querySelector("#wd-cancel").addEventListener("click", close);
    m.querySelector("#wd-submit").addEventListener("click", function () {
      var errBox = m.querySelector("#mm-wd-err");
      var amount = parseFloat(m.querySelector("#wd-amount").value);
      errBox.textContent = "";
      if (!isFinite(amount) || amount <= 0) return (errBox.textContent = "请输入有效金额。");
      if (amount > avail + 1e-9) return (errBox.textContent = "超出可提现余额。");
      var body = { channel: channel, amount_micro: Math.round(amount * 1e6) };
      if (channel === "wechat") {
        var wx = m.querySelector("#wd-wechat").value.trim();
        if (!wx) return (errBox.textContent = "请填写微信号 / QQ 号。");
        body.wechat_id = wx;
      }
      var btn = m.querySelector("#wd-submit"); btn.setAttribute("disabled", "");
      api("POST", "/me/withdraw", body).then(function () {
        close(); toast(channel === "site" ? "已提现到站内余额" : "提现工单已提交，等待审核"); loadOverview(); loadTickets();
      }).catch(function (e) { btn.removeAttribute("disabled"); errBox.textContent = "提现失败：" + (e && e.message ? e.message : e); });
    });
  }

  // ── 数据加载 ───────────────────────────────────────────────
  function loadOverview() {
    return api("GET", "/me/overview").then(function (d) {
      state.balance = d.balance || {};
      state.summary = d.summary || {};
      state.listings = Array.isArray(d.listings) ? d.listings : [];
      renderOverview();
    }).catch(function (e) {
      toast("加载我的上架失败：" + (e && e.message ? e.message : e), true);
    });
  }
  function loadCalls() {
    return api("GET", "/me/calls").then(function (d) { state.calls = d.calls || []; renderCalls(); }).catch(apiErr);
  }
  function loadTickets() {
    return api("GET", "/me/tickets").then(function (d) { state.tickets = d.tickets || []; renderTickets(); }).catch(apiErr);
  }

  // ── 访问门禁：登录 + 已开通 API ────────────────────────────
  function hasApiAccess(token) {
    return fetch(GW, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON, Authorization: "Bearer " + token },
      body: JSON.stringify({ endpoint: "api_my_keys" }),
    }).then(function (r) { return r.ok ? r.json() : { applications: [] }; })
      .then(function (d) {
        var apps = (d && d.applications) || [];
        return apps.some(function (a) { return a && (a.status === "approved" || a.status === "active"); });
      }).catch(function () { return false; });
  }

  async function boot() {
    if (!window.supabase || !window.__SUPABASE_URL__ || !ANON) { show("mm-not-logged-in"); return; }
    var session = await PlatformAuth.getSession(6000).catch(function () { return null; });
    if (!PlatformAuth.isValidSession(session)) { show("mm-not-logged-in"); return; }
    state.token = session.access_token;

    var ok = await hasApiAccess(state.token);
    if (!ok) { show("mm-no-access"); return; }
    show("mm-accessible");

    setupTabs();
    setupCopy();
    setupListingActions();
    document.getElementById("mm-btn-new").addEventListener("click", function () { openListingModal(null); });
    document.getElementById("mm-btn-wsite").addEventListener("click", function () { openWithdrawModal("site"); });
    document.getElementById("mm-btn-wwechat").addEventListener("click", function () { openWithdrawModal("wechat"); });
    document.getElementById("mm-btn-refresh").addEventListener("click", function () { loadOverview(); toast("已刷新"); });

    await loadOverview();
    await loadTickets();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
