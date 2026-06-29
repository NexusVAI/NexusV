/* Cancri 螃蟹市场 —— market_mine.html「我的上架」逻辑（2026-06-29 控制台外壳版）。
 *
 * 设计目标（对照用户图三/图四 + 文字需求）：
 *   - 套 api/usage.html 的控制台外壳：左侧项目侧边栏 + 我的上架主区。
 *   - 顶部「上传模型 / 管理模型」胶囊（与「默认项目」同款）。
 *   - 收益面板（赚了多少钱 / 冻结）+ 每日收益柱状图；右栏「被调用的数据」（Token / 请求）。
 *   - 详细信息：每个模型独立的「被调用次数」「收益」柱状条 + 调用日志。
 *   - 工单信息：提现工单（申请 + 处理结果 + 留言）；右侧「最近工单」。
 *   - 管理模型：每个模型一行 + 右侧三个竖点菜单（管理 / 编辑 / 启用·禁用 / 下架 / 删除）；
 *     展开「管理」可见 浏览量 / 卖出 Token / 调用日志 / 调整定价。
 *   - 调整定价：1 天公示期。调价后该模型进入公示期（暂不可用），到期自动切换新价并恢复上架。
 *   - 买家调用名统一展示 px: 前缀；全中文；深/浅主题适配；不再用骨架屏。
 *
 * 后端契约（cf-gateway 的 cancri-market 路由）：
 *   GET    /me/overview  -> { balance:{available_micro,frozen_micro,withdrawn_micro},
 *                             summary:{total_credit_micro,total_tx,total_tokens,total_requests,daily:[{date,credit_micro}]},
 *                             listings:[{...,views,tokens_sold,requests,earnings_credit_micro,
 *                                        pending_input_price_per_m,pending_output_price_per_m,pricing_effective_at,daily:[...]}],
 *                             recent_tickets:[...] }
 *   GET    /me/calls     -> { calls:[...] }
 *   GET    /me/tickets   -> { tickets:[...] }
 *   POST   /listings     {platform,base_url,key,model_whitelist,display_name,description,input_price_per_m,output_price_per_m,cached_input_factor}
 *   PATCH  /listings/:id {display_name?,...,status?}  或  {action:'adjust_price',input_price_per_m,output_price_per_m}
 *   DELETE /listings/:id
 *   POST   /me/withdraw  {channel:'site'|'wechat', amount_micro, wechat_id?}
 */
(function () {
  "use strict";

  var MARKET_BASE = (window.__SUPABASE_URL__ || "") + "/functions/v1/cancri-market";
  var GW = (window.__SUPABASE_URL__ || "") + "/functions/v1/chat-gateway";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";
  var PX = "px:";

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

  var STATUS_LABEL = { active: "已上架", disabled: "已禁用", pending: "审核中", failed: "校验失败", depleted: "已下架", pricing_cooldown: "调价公示中" };
  var STATUS_BADGE = { active: "active", disabled: "disabled", pending: "pending", failed: "failed", depleted: "depleted", pricing_cooldown: "cooldown" };

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
  function withPx(m) { m = String(m || ""); return m.indexOf(PX) === 0 ? m : PX + m; }
  function normalizeModels(v) {
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (typeof v === "string") {
      var s = v.trim(); if (!s) return [];
      if (s[0] === "[") { try { var a = JSON.parse(s); if (Array.isArray(a)) return a.map(function (x) { return String(x).trim(); }).filter(Boolean); } catch (e) {} }
      return s.split(/[,\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return [];
  }

  function fmtCny(micro) {
    var v = (Number(micro) || 0) / 1e6;
    if (v === 0) return "¥0.00";
    return "¥" + (Math.abs(v) < 0.01 ? v.toFixed(6) : v.toFixed(2));
  }
  function fmtPrice(n) { n = Number(n); if (n == null || !isFinite(n)) return "—"; if (n === 0) return "免费"; return "¥" + n.toFixed(2); }
  function fmtInt(n) { n = Number(n) || 0; return n.toLocaleString("en-US"); }
  function fmtTime(s) { if (!s) return "—"; try { var d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleString("zh-CN", { hour12: false }); } catch (e) { return String(s); } }
  function fmtDay(s) { try { var d = new Date(s); return (d.getMonth() + 1) + "/" + d.getDate(); } catch (e) { return String(s); } }
  function relDue(s) {
    var ms = new Date(s).getTime() - Date.now();
    if (!isFinite(ms)) return "—";
    if (ms <= 0) return "即将生效";
    var h = Math.floor(ms / 3600000), mn = Math.floor((ms % 3600000) / 60000);
    return (h > 0 ? h + " 小时 " : "") + mn + " 分钟后";
  }

  var COPY_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2"></rect>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  var DOTS_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/></svg>';

  function toast(text, isErr) {
    var root = document.getElementById("mm-toast");
    if (!root) return;
    var item = document.createElement("div");
    item.className = "mmc-toast__item" + (isErr ? " mmc-toast__item--err" : "");
    item.textContent = text;
    root.appendChild(item);
    requestAnimationFrame(function () { item.classList.add("is-show"); });
    setTimeout(function () { item.classList.remove("is-show"); setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 220); }, 3000);
  }
  function show(id) { var el = document.getElementById(id); if (el) el.removeAttribute("data-cancri-hidden"); }
  function hide(id) { var el = document.getElementById(id); if (el) el.setAttribute("data-cancri-hidden", ""); }
  function $(id) { return document.getElementById(id); }

  // ── 状态 + 接口 ────────────────────────────────────────────
  var state = { token: null, email: "", listings: [], calls: [], tickets: [], balance: {}, summary: {}, recentTickets: [] };

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
        if (!r.ok) throw Object.assign(new Error(data.error || data.message || ("HTTP " + r.status)), { status: r.status });
        return data;
      });
    });
  }
  function apiErr(e) { toast("操作失败：" + (e && e.message ? e.message : e), true); }

  // ════════════ 渲染 ════════════
  function renderAll() {
    var b = state.balance || {}, s = state.summary || {};
    $("mm-total-credit").textContent = fmtCny(s.total_credit_micro);
    $("mm-frozen").textContent = fmtCny(b.frozen_micro);
    $("mm-available").textContent = fmtCny(b.available_micro);
    $("mm-withdrawn").textContent = fmtCny(b.withdrawn_micro);
    $("mm-total-tokens").textContent = fmtInt(s.total_tokens);
    $("mm-total-requests").textContent = fmtInt(s.total_requests);
    $("mm-side-email").textContent = state.email || "—";
    renderEarnChart();
    renderDetail();
    renderTickets();
    renderListings();
  }

  // 汇总每日收益（优先用 summary.daily，否则按各 listing.daily 聚合）
  function aggregateDaily() {
    if (Array.isArray(state.summary.daily) && state.summary.daily.length) return state.summary.daily.slice();
    var map = {};
    (state.listings || []).forEach(function (l) {
      (l.daily || []).forEach(function (d) { map[d.date] = (map[d.date] || 0) + (Number(d.credit_micro) || 0); });
    });
    return Object.keys(map).sort().map(function (k) { return { date: k, credit_micro: map[k] }; });
  }
  function renderEarnChart() {
    var box = $("mm-earn-chart"); if (!box) return;
    var daily = aggregateDaily();
    if (!daily.length) { box.innerHTML = '<div class="mmc-muted">暂无收益数据。</div>'; $("mm-axis-start").textContent = "—"; $("mm-axis-end").textContent = "—"; return; }
    var max = Math.max.apply(null, daily.map(function (d) { return Number(d.credit_micro) || 0; })) || 1;
    box.innerHTML = daily.map(function (d) {
      var v = Number(d.credit_micro) || 0;
      var h = Math.max(2, Math.round((v / max) * 150));
      return '<div class="mmc-chart__bar"' + (v === 0 ? ' data-empty="1"' : "") + ' style="height:' + h + 'px" title="' + escAttr(fmtDay(d.date) + "：" + fmtCny(v)) + '"></div>';
    }).join("");
    $("mm-axis-start").textContent = fmtDay(daily[0].date);
    $("mm-axis-end").textContent = fmtDay(daily[daily.length - 1].date);
  }

  function barRow(name, valText, ratio, green) {
    var pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    return '<div class="mmc-barrow"><div class="mmc-barrow__top"><span class="mmc-barrow__name">' + esc(name) + '</span><span class="mmc-barrow__val">' + esc(valText) + '</span></div>' +
      '<div class="mmc-barrow__track"><div class="mmc-barrow__fill' + (green ? " mmc-barrow__fill--green" : "") + '" style="width:' + pct + '%"></div></div></div>';
  }
  function listingLabel(l) { return l.display_name || normalizeModels(l.model_whitelist)[0] || platformLabel(l.platform); }
  function renderDetail() {
    var list = state.listings || [];
    var callsBox = $("mm-calls-by-model"), earnBox = $("mm-earn-by-model");
    if (!list.length) { callsBox.innerHTML = earnBox.innerHTML = '<div class="mmc-muted">暂无数据。</div>'; }
    else {
      var maxReq = Math.max.apply(null, list.map(function (l) { return Number(l.requests) || 0; })) || 1;
      var maxEarn = Math.max.apply(null, list.map(function (l) { return Number(l.earnings_credit_micro) || 0; })) || 1;
      callsBox.innerHTML = list.map(function (l) { return barRow(listingLabel(l), fmtInt(l.requests) + " 次", (Number(l.requests) || 0) / maxReq, false); }).join("");
      earnBox.innerHTML = list.map(function (l) { return barRow(listingLabel(l), fmtCny(l.earnings_credit_micro), (Number(l.earnings_credit_micro) || 0) / maxEarn, true); }).join("");
    }
    renderCallsLog($("mm-calls-log"), state.calls);
  }
  function renderCallsLog(box, calls) {
    if (!box) return;
    if (!calls || !calls.length) { box.innerHTML = '<div class="mmc-muted">还没有买家通过你的挂单发起调用。</div>'; return; }
    box.innerHTML =
      '<div class="mmc-calls__row mmc-calls__row--head"><span>时间 / 买家</span><span>模型</span><span class="mmc-calls__val">输入 / 输出</span><span class="mmc-calls__val">买家实付</span><span class="mmc-calls__credit">我的收益</span></div>' +
      calls.slice(0, 50).map(function (c) {
        return '<div class="mmc-calls__row"><span><div>' + esc(fmtTime(c.created_at)) + '</div><div class="mmc-calls__val" style="font-size:11px">' + esc(c.buyer_email || "—") + '</div></span>' +
          '<span class="mmc-calls__model">' + esc(withPx(c.model_id)) + '</span>' +
          '<span class="mmc-calls__val">' + fmtInt(c.tokens_in) + " / " + fmtInt(c.tokens_out) + '</span>' +
          '<span class="mmc-calls__val">' + esc(fmtCny(c.buyer_charged_micro)) + '</span>' +
          '<span class="mmc-calls__credit">' + esc(fmtCny(c.seller_credit_micro)) + '</span></div>';
      }).join("");
  }

  function ticketStatusLabel(s) { return { pending: "待审核", approved: "已通过", rejected: "已驳回", done: "已到账" }[s] || s; }
  function ticketCard(t, mini) {
    var badge = STATUS_BADGE[t.status] || (t.status === "approved" || t.status === "done" ? "approved" : t.status === "rejected" ? "rejected" : "pending");
    return '<div class="mmc-ticket"><div class="mmc-ticket__top"><span class="mmc-ticket__amt">' + esc(fmtCny(t.amount_micro)) + '</span>' +
      '<span class="mmc-badge mmc-badge--' + badge + '">' + esc(ticketStatusLabel(t.status)) + '</span></div>' +
      '<div class="mmc-ticket__meta">' + (t.channel === "site" ? "提现到站内余额" : "提现到微信") + (t.wechat_id ? "（" + esc(t.wechat_id) + "）" : "") + " · " + esc(fmtTime(t.created_at)) + '</div>' +
      (!mini && t.review_note ? '<div class="mmc-ticket__note">管理员留言：' + esc(t.review_note) + '</div>' : "") + '</div>';
  }
  function renderTickets() {
    var full = $("mm-tickets-full"), recent = $("mm-tickets-recent");
    var list = state.tickets && state.tickets.length ? state.tickets : state.recentTickets;
    if (full) full.innerHTML = (list && list.length) ? list.map(function (t) { return ticketCard(t, false); }).join("") : '<div class="mmc-muted">还没有提现工单。点「提现」发起。</div>';
    var rc = state.recentTickets && state.recentTickets.length ? state.recentTickets : (state.tickets || []).slice(0, 4);
    if (recent) recent.innerHTML = (rc && rc.length) ? rc.slice(0, 4).map(function (t) { return ticketCard(t, true); }).join("") : '<div class="mmc-muted">暂无工单。</div>';
  }

  // ── 管理模型列表 ───────────────────────────────────────────
  function modelPills(models) {
    if (!models.length) return '<span class="mmc-muted">未填写模型 id</span>';
    return models.map(function (m) {
      var pid = withPx(m);
      return '<button type="button" class="cancri-id" data-copy="' + escAttr(pid) + '" title="点击复制调用名 ' + escAttr(pid) + '"><span class="cancri-id__text">' + esc(pid) + '</span>' + COPY_SVG + '</button>';
    }).join("");
  }
  function listingRowHtml(l) {
    var st = l.status || "active";
    var models = normalizeModels(l.model_whitelist);
    var badge = STATUS_BADGE[st] || "active";
    var cooldown = st === "pricing_cooldown" && l.pricing_effective_at;
    var toggleItem = st === "disabled"
      ? '<button type="button" class="mmc-menu__item" data-act="enable">启用</button>'
      : '<button type="button" class="mmc-menu__item" data-act="disable">禁用</button>';
    var delistItem = st === "depleted" ? "" : '<button type="button" class="mmc-menu__item" data-act="delist">下架</button>';
    return '<div class="mmc-model" data-id="' + escAttr(l.id) + '">' +
      '<div class="mmc-model__row">' +
        '<div class="mmc-model__thumb" style="background-image:url(\'' + escAttr(platformIcon(l.platform)) + '\')"></div>' +
        '<div class="mmc-model__main">' +
          '<div class="mmc-model__name">' + esc(listingLabel(l)) + ' <span class="mmc-badge mmc-badge--' + badge + '">' + esc(STATUS_LABEL[st] || st) + '</span></div>' +
          '<div class="mmc-model__sub"><span>' + esc(platformLabel(l.platform)) + '</span><span>输入 <b>' + esc(fmtPrice(l.input_price_per_m)) + '</b>/M</span><span>输出 <b>' + esc(fmtPrice(l.output_price_per_m)) + '</b>/M</span>' +
            (cooldown ? '<span style="color:var(--mm-amber)">调价 ' + esc(relDue(l.pricing_effective_at)) + '生效</span>' : "") + '</div>' +
        '</div>' +
        '<div class="mmc-model__stats">' +
          '<div class="mmc-model__stat"><div class="mmc-model__stat-num">' + fmtInt(l.views) + '</div><div class="mmc-model__stat-cap">浏览</div></div>' +
          '<div class="mmc-model__stat"><div class="mmc-model__stat-num">' + fmtInt(l.tokens_sold) + '</div><div class="mmc-model__stat-cap">卖出 Token</div></div>' +
          '<div class="mmc-model__stat"><div class="mmc-model__stat-num">' + esc(fmtCny(l.earnings_credit_micro)) + '</div><div class="mmc-model__stat-cap">收益</div></div>' +
        '</div>' +
        '<div class="mmc-dots"><button type="button" class="mmc-dots__btn" data-act="menu" aria-label="操作菜单">' + DOTS_SVG + '</button>' +
          '<div class="mmc-menu">' +
            '<button type="button" class="mmc-menu__item" data-act="manage">管理</button>' +
            '<button type="button" class="mmc-menu__item" data-act="edit">编辑</button>' +
            toggleItem + delistItem +
            '<button type="button" class="mmc-menu__item mmc-menu__item--danger" data-act="delete">删除</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="mmc-model__detail">' +
        (cooldown ? '<div class="mmc-cooldown">⏳ 定价调整公示中：新价（输入 ' + esc(fmtPrice(l.pending_input_price_per_m)) + '/M、输出 ' + esc(fmtPrice(l.pending_output_price_per_m)) + '/M）将于 <b style="margin:0 4px">' + esc(fmtTime(l.pricing_effective_at)) + '</b>（' + esc(relDue(l.pricing_effective_at)) + '）自动生效。公示期内此模型暂不可用，到期自动恢复上架。</div>' : "") +
        '<div class="mmc-detail-grid">' +
          '<div class="mmc-subcard"><div class="mmc-subcard__title">支持模型（买家调用名）</div>' + modelPills(models) + '</div>' +
          '<div class="mmc-subcard"><div class="mmc-subcard__title">每日收益</div><div class="mmc-chart" data-mini-chart style="min-height:80px;padding:8px 0"></div></div>' +
        '</div>' +
        '<div class="mmc-subcard"><div class="mmc-subcard__title">调整定价（1 天公示期）</div>' +
          '<div class="mmc-price-form">' +
            '<div class="mmc-note">提交后进入 1 天公示期：期间此模型暂不可用，到期自动切换为新价并恢复上架，避免买家用到一半被改价。</div>' +
            '<div class="mmc-row2">' +
              '<div class="mmc-field"><label>新输入价（元 / 百万 token）</label><input class="mmc-input" data-price="in" type="number" step="0.0001" min="0" value="' + escAttr(l.input_price_per_m != null ? l.input_price_per_m : "") + '"></div>' +
              '<div class="mmc-field"><label>新输出价（元 / 百万 token）</label><input class="mmc-input" data-price="out" type="number" step="0.0001" min="0" value="' + escAttr(l.output_price_per_m != null ? l.output_price_per_m : "") + '"></div>' +
            '</div>' +
            '<div><button type="button" class="mmc-btn mmc-btn--primary" data-act="adjust-price"' + (cooldown ? " disabled" : "") + '>' + (cooldown ? "公示期内不可再次调价" : "提交调价（公示 1 天）") + '</button></div>' +
          '</div>' +
        '</div>' +
        '<div class="mmc-subcard"><div class="mmc-subcard__title">此模型的调用日志</div><div data-model-calls class="mmc-calls"></div></div>' +
      '</div>' +
    '</div>';
  }
  function renderListings() {
    var box = $("mm-listings"), count = $("mm-listings-count"), list = state.listings || [];
    count.textContent = "共 " + list.length + " 个上架模型";
    if (!list.length) { box.innerHTML = ""; show("mm-listings-empty"); return; }
    hide("mm-listings-empty");
    box.innerHTML = list.map(listingRowHtml).join("");
  }
  function renderModelDetail(modelEl, l) {
    // mini 每日收益图
    var chart = modelEl.querySelector("[data-mini-chart]");
    if (chart) {
      var daily = l.daily || [];
      if (!daily.length) chart.innerHTML = '<div class="mmc-muted">暂无收益。</div>';
      else {
        var max = Math.max.apply(null, daily.map(function (d) { return Number(d.credit_micro) || 0; })) || 1;
        chart.innerHTML = daily.map(function (d) { var v = Number(d.credit_micro) || 0; return '<div class="mmc-chart__bar"' + (v === 0 ? ' data-empty="1"' : "") + ' style="height:' + Math.max(2, Math.round(v / max * 64)) + 'px" title="' + escAttr(fmtDay(d.date) + "：" + fmtCny(v)) + '"></div>'; }).join("");
      }
    }
    var callsBox = modelEl.querySelector("[data-model-calls]");
    if (callsBox) renderCallsLog(callsBox, (state.calls || []).filter(function (c) { return String(c.listing_id) === String(l.id); }));
  }

  function findListing(id) { for (var i = 0; i < state.listings.length; i++) if (String(state.listings[i].id) === String(id)) return state.listings[i]; return null; }

  function setupListingActions() {
    var box = $("mm-listings");
    box.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-act]");
      if (!btn || !box.contains(btn)) return;
      var modelEl = btn.closest(".mmc-model"); if (!modelEl) return;
      var id = modelEl.getAttribute("data-id"); var act = btn.getAttribute("data-act");
      var l = findListing(id);
      if (act === "menu") { e.stopPropagation(); toggleMenu(modelEl); return; }
      closeMenus();
      if (act === "manage") { var ex = modelEl.classList.toggle("is-expanded"); if (ex && l) renderModelDetail(modelEl, l); return; }
      if (act === "edit") return openListingModal(l);
      if (act === "enable") return patchStatus(id, "active", "已启用");
      if (act === "disable") return patchStatus(id, "disabled", "已禁用");
      if (act === "delist") { if (confirm("确认下架该模型？下架后买家无法再选用，已结算收益不受影响。")) patchStatus(id, "depleted", "已下架"); return; }
      if (act === "delete") { if (confirm("确认删除该模型挂单？不可恢复（历史成交记录保留）。")) api("DELETE", "/listings/" + id).then(function () { toast("已删除"); loadOverview(); }).catch(apiErr); return; }
      if (act === "adjust-price") return submitPriceAdjust(modelEl, l);
    });
  }
  function toggleMenu(modelEl) {
    var menu = modelEl.querySelector(".mmc-menu");
    var open = menu.classList.contains("is-open");
    closeMenus();
    if (!open) menu.classList.add("is-open");
  }
  function closeMenus() { document.querySelectorAll(".mmc-menu.is-open").forEach(function (m) { m.classList.remove("is-open"); }); }

  function patchStatus(id, status, okMsg) { api("PATCH", "/listings/" + id, { status: status }).then(function () { toast(okMsg); loadOverview(); }).catch(apiErr); }

  function submitPriceAdjust(modelEl, l) {
    var inEl = modelEl.querySelector('[data-price="in"]'), outEl = modelEl.querySelector('[data-price="out"]');
    var inP = parseFloat(inEl.value), outP = parseFloat(outEl.value);
    if (!isFinite(inP) || inP < 0 || !isFinite(outP) || outP < 0) return toast("请填写有效的输入/输出价。", true);
    if (Number(inP) === Number(l.input_price_per_m) && Number(outP) === Number(l.output_price_per_m)) return toast("新价格与当前价格一致。", true);
    if (!confirm("确认提交调价？\n新价：输入 " + fmtPrice(inP) + "/M、输出 " + fmtPrice(outP) + "/M\n将进入 1 天公示期，期间此模型暂不可用，到期自动生效。")) return;
    api("PATCH", "/listings/" + l.id, { action: "adjust_price", input_price_per_m: inP, output_price_per_m: outP })
      .then(function () { toast("调价已提交，进入 1 天公示期"); loadOverview(); }).catch(apiErr);
  }

  // ── 复制 model id（事件委托）─────────────────────────────────
  function setupCopy() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".cancri-id[data-copy]");
      if (!btn) return;
      var text = btn.getAttribute("data-copy");
      var done = function () { btn.classList.add("is-copied"); toast("已复制：" + text); setTimeout(function () { btn.classList.remove("is-copied"); }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(done); else done();
    });
    document.addEventListener("click", function () { closeMenus(); });
  }

  // ── Tab ────────────────────────────────────────────────────
  function setupTabs() {
    var tabs = document.querySelectorAll(".mmc-tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");
        var name = tab.getAttribute("data-tab");
        document.querySelectorAll(".mmc-tabpanel").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; });
        if (name === "tickets") loadTickets();
      });
    });
  }

  // ── 弹窗 ───────────────────────────────────────────────────
  function openModal(node) {
    var bd = document.createElement("div");
    bd.className = "mmc-backdrop";
    bd.appendChild(node);
    bd.addEventListener("click", function (e) { if (e.target === bd) doClose(); });
    document.getElementById("mm-modal-root").appendChild(bd);
    function onKey(e) { if (e.key === "Escape") doClose(); }
    document.addEventListener("keydown", onKey);
    function doClose() { if (bd.parentNode) bd.parentNode.removeChild(bd); document.removeEventListener("keydown", onKey); }
    return doClose;
  }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

  // ── 新增 / 编辑挂单 ────────────────────────────────────────
  function openListingModal(listing) {
    var isEdit = !!listing;
    var m = el("div", "mmc-modal");
    var platOpts = PLATFORM_OPTIONS.map(function (p) { var sel = listing && pkey(listing.platform) === p[0] ? " selected" : ""; return '<option value="' + p[0] + '"' + sel + ">" + esc(p[1]) + "</option>"; }).join("");
    var modelsText = listing ? normalizeModels(listing.model_whitelist).join("\n") : "";
    m.innerHTML =
      '<h2 class="mmc-modal__title">' + (isEdit ? "编辑模型挂单" : "上传模型") + "</h2>" +
      '<p class="mmc-modal__desc">买家调用时统一加 <code>px:</code> 前缀（如 <code>px:step-3.7-flash</code>）区分蟹市线路并计费。Key 经 AES-256-GCM 加密存储。</p>' +
      '<div class="mmc-modal__body">' +
        '<div class="mmc-field"><label>展示名称</label><input class="mmc-input" id="f-name" placeholder="如：step-3.7-flash 通道" value="' + escAttr(listing ? listing.display_name : "") + '"></div>' +
        '<div class="mmc-row2"><div class="mmc-field"><label>平台</label><select class="mmc-select" id="f-platform">' + platOpts + '</select></div>' +
          '<div class="mmc-field"><label>Base URL</label><input class="mmc-input" id="f-baseurl" placeholder="https://api.openai.com/v1" value="' + escAttr(listing ? listing.base_url : "") + '"></div></div>' +
        '<div class="mmc-field"><label>API Key' + (isEdit ? "（留空＝不修改）" : "") + '</label><input class="mmc-input" id="f-key" type="password" placeholder="' + (isEdit ? "••••••（不修改请留空）" : "sk-...") + '"></div>' +
        '<div class="mmc-field"><label>支持模型（每行一个或逗号分隔）</label><textarea class="mmc-textarea" id="f-models" placeholder="step-3.7-flash">' + esc(modelsText) + '</textarea></div>' +
        '<div class="mmc-row2"><div class="mmc-field"><label>输入价（元 / 百万 token）</label><input class="mmc-input" id="f-in" type="number" step="0.0001" min="0" placeholder="0.10" value="' + escAttr(listing && listing.input_price_per_m != null ? listing.input_price_per_m : "") + '"></div>' +
          '<div class="mmc-field"><label>输出价（元 / 百万 token）</label><input class="mmc-input" id="f-out" type="number" step="0.0001" min="0" placeholder="0.50" value="' + escAttr(listing && listing.output_price_per_m != null ? listing.output_price_per_m : "") + '"></div></div>' +
        '<div class="mmc-field"><label>简介（可选）</label><input class="mmc-input" id="f-desc" placeholder="如：余额充足，长期稳定" value="' + escAttr(listing ? listing.description : "") + '"></div>' +
        '<div class="mmc-modal__err" id="mm-modal-err"></div>' +
      '</div>' +
      '<div class="mmc-modal__foot"><button type="button" class="mmc-btn mmc-btn--ghost" id="f-cancel">取消</button>' +
        '<button type="button" class="mmc-btn mmc-btn--primary" id="f-submit">' + (isEdit ? "保存修改" : "确认上架") + "</button></div>";
    var close = openModal(m);
    m.querySelector("#f-cancel").addEventListener("click", close);
    m.querySelector("#f-submit").addEventListener("click", function () {
      var errBox = m.querySelector("#mm-modal-err");
      var name = m.querySelector("#f-name").value.trim();
      var platform = m.querySelector("#f-platform").value;
      var baseUrl = m.querySelector("#f-baseurl").value.trim();
      var key = m.querySelector("#f-key").value.trim();
      var models = m.querySelector("#f-models").value.split(/[\n,]+/).map(function (s) { return s.trim().replace(/^px:/, ""); }).filter(Boolean);
      var inP = parseFloat(m.querySelector("#f-in").value), outP = parseFloat(m.querySelector("#f-out").value);
      var desc = m.querySelector("#f-desc").value.trim();
      errBox.textContent = "";
      if (!name) return (errBox.textContent = "请填写展示名称。");
      if (!baseUrl || !/\/v1\/?$/.test(baseUrl)) return (errBox.textContent = "Base URL 必须以 /v1 结尾。");
      if (!isEdit && !key) return (errBox.textContent = "请填写 API Key。");
      if (!models.length) return (errBox.textContent = "请至少填写一个支持的模型 id。");
      if (!isFinite(inP) || inP < 0 || !isFinite(outP) || outP < 0) return (errBox.textContent = "请填写有效的输入/输出价。");
      var body = { platform: platform, base_url: baseUrl, model_whitelist: models, display_name: name, description: desc, input_price_per_m: inP, output_price_per_m: outP, cached_input_factor: 0.1 };
      if (key) body.key = key;
      var submitBtn = m.querySelector("#f-submit"); submitBtn.disabled = true;
      var p = isEdit ? api("PATCH", "/listings/" + listing.id, body) : api("POST", "/listings", body);
      p.then(function () { close(); toast(isEdit ? "已保存" : "上架成功"); loadOverview(); })
        .catch(function (e) { submitBtn.disabled = false; errBox.textContent = "提交失败：" + (e && e.message ? e.message : e); });
    });
  }

  // ── 提现（单弹窗内选渠道）──────────────────────────────────
  function openWithdrawModal() {
    var avail = (Number(state.balance.available_micro) || 0) / 1e6;
    var m = el("div", "mmc-modal");
    m.innerHTML =
      '<h2 class="mmc-modal__title">提现</h2>' +
      '<p class="mmc-modal__desc">可提现余额 <b>' + fmtCny(state.balance.available_micro) + "</b>。站内即时到账；微信需管理员审核后线下打款。</p>" +
      '<div class="mmc-modal__body">' +
        '<div class="mmc-field"><label>提现渠道</label><select class="mmc-select" id="wd-channel"><option value="site">提现到站内余额（即时）</option><option value="wechat">提现到微信（审核）</option></select></div>' +
        '<div class="mmc-field"><label>提现金额（元）</label><input class="mmc-input" id="wd-amount" type="number" step="0.01" min="0" max="' + avail + '" placeholder="0.00"></div>' +
        '<div class="mmc-field" id="wd-wechat-field" data-cancri-hidden><label>微信号 / QQ 号</label><input class="mmc-input" id="wd-wechat" placeholder="用于线下打款联系"></div>' +
        '<div class="mmc-modal__err" id="mm-wd-err"></div>' +
      '</div>' +
      '<div class="mmc-modal__foot"><button type="button" class="mmc-btn mmc-btn--ghost" id="wd-cancel">取消</button>' +
        '<button type="button" class="mmc-btn mmc-btn--primary" id="wd-submit">确认提现</button></div>';
    var close = openModal(m);
    var chSel = m.querySelector("#wd-channel"), wxField = m.querySelector("#wd-wechat-field");
    chSel.addEventListener("change", function () { if (chSel.value === "wechat") wxField.removeAttribute("data-cancri-hidden"); else wxField.setAttribute("data-cancri-hidden", ""); });
    m.querySelector("#wd-cancel").addEventListener("click", close);
    m.querySelector("#wd-submit").addEventListener("click", function () {
      var errBox = m.querySelector("#mm-wd-err");
      var channel = chSel.value;
      var amount = parseFloat(m.querySelector("#wd-amount").value);
      errBox.textContent = "";
      if (!isFinite(amount) || amount <= 0) return (errBox.textContent = "请输入有效金额。");
      if (amount > avail + 1e-9) return (errBox.textContent = "超出可提现余额。");
      var body = { channel: channel, amount_micro: Math.round(amount * 1e6) };
      if (channel === "wechat") { var wx = m.querySelector("#wd-wechat").value.trim(); if (!wx) return (errBox.textContent = "请填写微信号 / QQ 号。"); body.wechat_id = wx; }
      var btn = m.querySelector("#wd-submit"); btn.disabled = true;
      api("POST", "/me/withdraw", body).then(function () { close(); toast(channel === "site" ? "已提现到站内余额" : "提现工单已提交，等待审核"); loadOverview(); loadTickets(); })
        .catch(function (e) { btn.disabled = false; errBox.textContent = "提现失败：" + (e && e.message ? e.message : e); });
    });
  }

  // ── 数据加载 ───────────────────────────────────────────────
  function loadOverview() {
    return api("GET", "/me/overview").then(function (d) {
      state.balance = d.balance || {};
      state.summary = d.summary || {};
      state.listings = Array.isArray(d.listings) ? d.listings : [];
      state.recentTickets = Array.isArray(d.recent_tickets) ? d.recent_tickets : [];
      hide("mm-load-error"); show("mm-body");
      return loadCalls();
    }).then(function () { renderAll(); }).catch(function (e) {
      hide("mm-body"); show("mm-load-error");
      $("mm-load-error-msg").textContent = (e && e.message ? e.message : String(e)) + "（请确认已登录且 cancri-market 网关路由已部署）";
    });
  }
  function loadCalls() { return api("GET", "/me/calls").then(function (d) { state.calls = d.calls || []; }).catch(function () { state.calls = []; }); }
  function loadTickets() { return api("GET", "/me/tickets").then(function (d) { state.tickets = d.tickets || []; renderTickets(); }).catch(apiErr); }

  // ── 门禁 ───────────────────────────────────────────────────
  function hasApiAccess(token) {
    return fetch(GW, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, Authorization: "Bearer " + token }, body: JSON.stringify({ endpoint: "api_my_keys" }) })
      .then(function (r) { return r.ok ? r.json() : { applications: [] }; })
      .then(function (d) { var apps = (d && d.applications) || []; return apps.some(function (a) { return a && (a.status === "approved" || a.status === "active"); }); })
      .catch(function () { return false; });
  }

  function setupShell() {
    var shell = document.querySelector(".mmc-shell");
    var col = $("mmc-collapse"); if (col) col.addEventListener("click", function () { shell.classList.toggle("is-collapsed"); });
    var manageBtn = $("mm-btn-manage");
    if (manageBtn) manageBtn.addEventListener("click", function () { var el2 = $("mm-manage"); if (el2) el2.scrollIntoView({ behavior: "smooth", block: "start" }); });
  }

  async function boot() {
    setupShell();
    if (!window.supabase || !window.__SUPABASE_URL__ || !ANON) { show("mm-not-logged-in"); return; }
    var session = await PlatformAuth.getSession(6000).catch(function () { return null; });
    if (!PlatformAuth.isValidSession(session)) { show("mm-not-logged-in"); return; }
    state.token = session.access_token;
    try { state.email = (session.user && session.user.email) || ""; } catch (e) {}
    if (state.email) { $("mmc-user-name").textContent = state.email; $("mmc-user-avatar").textContent = state.email[0].toUpperCase(); }

    var ok = await hasApiAccess(state.token);
    if (!ok) { show("mm-no-access"); return; }

    setupTabs(); setupCopy(); setupListingActions();
    $("mm-btn-new").addEventListener("click", function () { openListingModal(null); });
    $("mm-btn-withdraw").addEventListener("click", openWithdrawModal);
    $("mm-btn-refresh").addEventListener("click", function () { loadOverview().then(function () { toast("已刷新"); }); });
    $("mm-error-retry").addEventListener("click", function () { loadOverview(); });

    await loadOverview();
    await loadTickets();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
