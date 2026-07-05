// admin_orders.html 的页面逻辑。2026-05-13 审查后从 inline <script> 抽出以便
// admin_orders.html 的 CSP 删除 'unsafe-inline'。

const sb = window.supabase.createClient(
    window.__SUPABASE_URL__,
    window.__SUPABASE_ANON_KEY__,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            storageKey: "cancri_supabase_auth",
        },
    },
);
const GW =
    window.__SUPABASE_URL__ + "/functions/v1/chat-gateway";

let currentStatusFilter = "";
let cachedOrders = [];
// 2026-06-23：wallet_v3 按量计费模式下，订单批准即自动入钱包，无激活码 / 无订阅档。
let BILLING_MODE = "quota_v2";
const IS_WALLET_V3 = () => BILLING_MODE === "wallet_v3";

function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
}

const { fmtTime, fmtArr, fmtScreen, fmtAgeDays, fmtTokens, fmtCreditsFromTokens, fmtIpGeo } = window.AdminFormatters;

function fmtPayable(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toFixed(2).replace(/\.?0+$/, "");
}

// 对账核心：展示 server 下单时算出的「用户应付」，不是 catalog 标价。
function renderPayableBlock(o) {
    const payable = o.user_payable_cny != null ? o.user_payable_cny : o.amount_cny;
    const list = o.list_price_cny;
    const kind = o.order_kind || "subscription";
    let hint = "";
    if (kind === "upgrade") {
        hint = "升级补差价";
    } else if (list != null && Number(list) !== Number(payable)) {
        hint = "非标价";
    }
    const listNote =
        list != null && Number(list) !== Number(payable)
            ? '<span class="order-payable__list">标价 ¥' +
              esc(fmtPayable(list)) +
              " · 以用户应付为准</span>"
            : "";
    return (
        '<div class="order-payable">' +
        '<span class="order-payable__label">用户应付</span>' +
        '<span class="order-payable__amount">¥' +
        esc(fmtPayable(payable)) +
        "</span>" +
        (hint
            ? '<span class="order-payable__hint">' + esc(hint) + "</span>"
            : "") +
        '<span class="order-payable__method">' +
        esc(o.method || "—") +
        "</span>" +
        listNote +
        "</div>"
    );
}

// 用户上下文摘要：注册多久 / 历史订单 / 用量 / 是否封禁
function renderUserContext(o) {
    const m = o.user_meta;
    const h = o.order_history;
    const u = o.recent_usage;
    const ban = o.ban;
    const parts = [];
    if (m) {
        parts.push(
            '<span class="ctx-pill" title="账号注册于 ' + esc(m.created_at || "?") + '">' +
            "🕐 " + esc(fmtAgeDays(m.age_days)) +
            "</span>"
        );
    }
    if (h && h.total > 1) {
        // total > 1 说明本订单不是首单，标出来
        const segs = [];
        if (h.activated) segs.push(h.activated + " 已激活");
        if (h.approved) segs.push(h.approved + " 已通过");
        if (h.rejected) segs.push('<span class="ctx-warn">' + h.rejected + " 被拒</span>");
        if (h.submitted) segs.push(h.submitted + " 待审");
        parts.push(
            '<span class="ctx-pill" title="此 user_id 共 ' + h.total + ' 张订单">📋 历史 ' + segs.join(" / ") +
            "</span>"
        );
    }
    if (u && u.call_count > 0) {
        parts.push(
            '<span class="ctx-pill" title="近 7 天 API 调用">⚡ 7d ' + u.call_count + " 次 · " +
            esc(fmtTokens((u.tokens_in || 0) + (u.tokens_out || 0))) + " tok</span>"
        );
    }
    if (ban) {
        const label = ban.active ? "当前已封禁" : "曾被封禁";
        const cls = ban.active ? "ctx-danger" : "ctx-warn";
        const reasonStr = ban.reason ? "：" + ban.reason : "";
        parts.push(
            '<span class="ctx-pill ' + cls + '" title="' + esc(ban.banned_at) + esc(reasonStr) + '">🚫 ' +
            esc(label) + "</span>"
        );
    }
    if (parts.length === 0) return "";
    return '<div class="ctx-row">' + parts.join("") + "</div>";
}

// 设备指纹块：仅 device 非空时渲染，否则空字符串。
// "宁可多" 原则：把所有有信号的字段都列出来，多账号判断主要看 suspect.distinct_users + WebRTC leak。
function renderDeviceBlock(o) {
    const dev = o.device;
    const sus = o.suspect;
    const ipReuse = o.ip_reuse;
    const ipGeo = o.ip_geo;
    const dupEmail = o.duplicate_email;
    const dupQq = o.duplicate_qq;

    // 即使没指纹，只要有重复邮箱/QQ 也要展示风险
    const hasAnything = dev || sus || ipReuse || ipGeo || dupEmail || dupQq;
    if (!hasAnything) {
        return '<div class="dev-block dev-empty">设备指纹：暂无（用户从未登录访问过任何挂了 fingerprint.js 的页面）</div>';
    }

    const flags = [];
    if (dev && dev.vpn_suspected) flags.push('<span class="dev-flag warn">VPN 嫌疑</span>');
    if (dev && dev.webrtc_leak_detected) flags.push('<span class="dev-flag warn">WebRTC 漏 IP</span>');
    if (ipGeo && ipGeo.proxy) flags.push('<span class="dev-flag warn">代理 IP</span>');
    if (ipGeo && ipGeo.hosting) flags.push('<span class="dev-flag warn">机房 IP</span>');
    if (sus && sus.distinct_users >= 2) {
        flags.push('<span class="dev-flag danger">多账号嫌疑：同设备 ' + sus.distinct_users + ' 号</span>');
    }
    if (ipReuse && ipReuse.user_count >= 2) {
        flags.push('<span class="dev-flag warn">同 IP ' + ipReuse.user_count + ' 个账号</span>');
    }
    if (dupEmail && dupEmail.count >= 2) {
        flags.push('<span class="dev-flag danger">同邮箱 ' + dupEmail.count + ' 号</span>');
    }
    if (dupQq && dupQq.count >= 2) {
        flags.push('<span class="dev-flag danger">同 QQ ' + dupQq.count + ' 号</span>');
    }
    const flagsHtml = flags.length ? '<div class="dev-flags">' + flags.join("") + "</div>" : "";

    const otherUsers = (sus && Array.isArray(sus.user_ids))
        ? sus.user_ids.filter((u) => u && u !== o.user_id)
        : [];
    const ipReuseUsers = (ipReuse && Array.isArray(ipReuse.user_ids))
        ? ipReuse.user_ids.filter((u) => u && u !== o.user_id)
        : [];
    const dupEmailUsers = (dupEmail && Array.isArray(dupEmail.user_ids))
        ? dupEmail.user_ids.filter((u) => u && u !== o.user_id)
        : [];
    const dupQqUsers = (dupQq && Array.isArray(dupQq.user_ids))
        ? dupQq.user_ids.filter((u) => u && u !== o.user_id)
        : [];

    function userIdsHtml(label, ids) {
        if (!ids || ids.length === 0) return "";
        return '<div class="dev-row"><span class="dev-k">' + label + "</span><span class=\"dev-v\"><code>"
            + ids.map((u) => esc(String(u))).join("</code> <code>") + "</code></span></div>";
    }

    const rows = [];
    if (dev) {
        const geoLabel = fmtIpGeo(ipGeo);
        rows.push(
            '<div class="dev-row"><span class="dev-k">真实 IP</span><span class="dev-v"><code>'
            + esc(dev.server_ip || "—") + "</code>"
            + (geoLabel ? "<br>" + esc(geoLabel) : (dev.server_country ? " · " + esc(dev.server_country) : ""))
            + "</span></div>"
        );
        const wrtPub = fmtArr(dev.webrtc_public_ips);
        const wrtLoc = fmtArr(dev.webrtc_local_ips);
        rows.push(
            '<div class="dev-row"><span class="dev-k">WebRTC 公网</span><span class="dev-v"><code>'
            + esc(wrtPub) + "</code></span></div>"
        );
        rows.push(
            '<div class="dev-row"><span class="dev-k">WebRTC 内网</span><span class="dev-v"><code>'
            + esc(wrtLoc) + "</code></span></div>"
        );
        rows.push(
            '<div class="dev-row"><span class="dev-k">时区 / 语言</span><span class="dev-v">'
            + esc(dev.timezone || "—") + " · " + esc(fmtArr(dev.languages)) + "</span></div>"
        );
        rows.push(
            '<div class="dev-row"><span class="dev-k">浏览器 UA</span><span class="dev-v ua">'
            + esc(dev.ua || "—") + "</span></div>"
        );
        rows.push(
            '<div class="dev-row"><span class="dev-k">平台 / 厂商</span><span class="dev-v">'
            + esc(dev.platform || "—") + " · " + esc(dev.vendor || "—") + "</span></div>"
        );
        const hw = (dev.hardware_concurrency != null) ? (dev.hardware_concurrency + " 核") : "—";
        const mem = (dev.device_memory != null) ? (dev.device_memory + " GB") : "—";
        rows.push(
            '<div class="dev-row"><span class="dev-k">硬件</span><span class="dev-v">'
            + esc(hw) + " · " + esc(mem) + " · " + esc(fmtScreen(dev.screen)) + "</span></div>"
        );
        rows.push(
            '<div class="dev-row"><span class="dev-k">visitor_id</span><span class="dev-v"><code>'
            + esc(dev.visitor_id || "—") + "</code></span></div>"
        );
        rows.push(
            '<div class="dev-row"><span class="dev-k">指纹时间窗</span><span class="dev-v">首次 '
            + esc(fmtTime(dev.first_seen)) + " · 最近 " + esc(fmtTime(dev.last_seen))
            + ' · <span style="color:var(--text-mute)">' + (dev.fingerprint_count || 0) + " 条记录</span></span></div>"
        );
    }

    const otherIdsHtml =
        userIdsHtml("同设备其他账号", otherUsers) +
        userIdsHtml("同 IP 其他账号", ipReuseUsers) +
        userIdsHtml("同邮箱其他账号", dupEmailUsers) +
        userIdsHtml("同 QQ 其他账号", dupQqUsers);

    return (
        '<details class="dev-block"><summary class="dev-summary">'
        + '<span>设备指纹 / 风险信号</span>'
        + flagsHtml
        + "</summary>"
        + '<div class="dev-detail">' + rows.join("") + otherIdsHtml + "</div>"
        + "</details>"
    );
}

// tier badge：与 admin_users / pricing 页保持一致的视觉语言。
// 2026-05-17 Phase A：tier 仍是 'free'/'paid'，但若 plan_code 已知则显示档位（PRO / PRO+ / PRO MAX）。
// 2026-06-23：wallet_v3 下无订阅档 / 无 free·paid 之分（仅限速档），不再渲染该徽章。
function renderTierPill(tier, planCode) {
    if (IS_WALLET_V3()) return "";
    if (tier === "paid") {
        const label = planCode === "pro_max" ? "PRO MAX"
                    : planCode === "pro_plus" ? "PRO+"
                    : planCode === "pro" ? "PRO"
                    : "PAID";
        return '<span class="status-pill s-2xx" title="付费档 ' + esc(planCode || "") + '">' + esc(label) + '</span>';
    }
    return '<span class="status-pill" style="background:var(--hover);color:var(--text-soft);border:1px solid var(--line)" title="免费档">FREE</span>';
}

// 2026-05-17 Phase A：订单类型 / 规格徽章。订阅显示档位，加油包显示规格。
// 2026-06-23：新增 recharge（按量充值）类型，显示"充值 ¥X"。
// 2026-06-23：wallet_v3 下所有 kind 批准即入钱包，统一显示「充值 ¥X」（按用户应付）。
function renderOrderKindCell(o) {
    const kind = o.order_kind || "subscription";
    if (IS_WALLET_V3() || kind === "recharge" || kind === "token_plan") {
        const micro = Number(o.wallet_credit_micro || 0);
        const cny = micro > 0 ? (micro / 1000000).toFixed(2) : (Number(o.amount_cny || 0)).toFixed(2);
        return '<span class="status-pill" style="background:rgba(34,197,94,.18);color:#22c55e" title="按量充值 ¥' + esc(cny) + '">充值 ¥' + esc(cny) + '</span>';
    }
    if (kind === "topup") {
        const sku = o.topup_sku || "";
        const tokens = Number(o.topup_tokens || 0);
        const creditsLabel = fmtCreditsFromTokens(tokens);
        return '<span class="status-pill" style="background:rgba(168,85,247,.18);color:#a855f7" title="加油包 ' + esc(sku) + ' · ' + esc(creditsLabel) + '">加油包 ' + esc(creditsLabel) + '</span>';
    }
    const plan = o.plan_code || "pro";
    const label = plan === "pro_max" ? "Pro Max"
                : plan === "pro_plus" ? "Pro+"
                : "Pro";
    const color = plan === "pro_max" ? "#a855f7"
                : plan === "pro_plus" ? "#60a5fa"
                : "#f59e0b";
    const bg = plan === "pro_max" ? "rgba(168,85,247,.18)"
             : plan === "pro_plus" ? "rgba(96,165,250,.18)"
             : "rgba(245,158,11,.18)";
    return '<span class="status-pill" style="background:' + bg + ';color:' + color + '" title="订阅 ' + esc(plan) + '">订阅 ' + esc(label) + '</span>';
}

async function getSession() {
    const {
        data: { session },
    } = await sb.auth.getSession();
    return session;
}

async function callGateway(endpoint, payload) {
    const session = await getSession();
    if (!session) throw new Error("not_logged_in");
    const resp = await fetch(GW, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: window.__SUPABASE_ANON_KEY__,
        },
        body: JSON.stringify({ endpoint, ...(payload || {}), __auth_token: session.access_token }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok)
        throw Object.assign(new Error(data.error || resp.statusText), {
            status: resp.status,
            body: data,
        });
    return data;
}

function showToast(text, kind) {
    // api-platform.css .toast uses opacity:0 + .show class pattern, not
    // display:none. Setting inline display:block does nothing because the
    // base rule keeps opacity:0. Mirror admin-users-app.js's correct impl.
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = text;
    t.className = "toast" + (kind ? " " + kind : "");
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => t.classList.remove("show"), 3500);
}

function renderOrders() {
    const filtered = currentStatusFilter
        ? cachedOrders.filter(
              (o) => o.status === currentStatusFilter,
          )
        : cachedOrders;
    const container = document.getElementById("orders");
    const empty = document.getElementById("empty-msg");
    if (filtered.length === 0) {
        container.innerHTML = "";
        empty.style.display = "block";
        return;
    }
    empty.style.display = "none";

    container.innerHTML = filtered
        .map((o) => {
            const created = new Date(o.created_at).toLocaleString(
                "zh-CN",
                { hour12: false },
            );
            const reviewed = o.reviewed_at
                ? new Date(o.reviewed_at).toLocaleString("zh-CN", {
                      hour12: false,
                  })
                : "—";
            const activated = o.activated_at
                ? new Date(o.activated_at).toLocaleString("zh-CN", {
                      hour12: false,
                  })
                : "—";
            const statusPill =
                '<span class="status-pill ' +
                esc(o.status) +
                '">' +
                esc(o.status) +
                "</span>";
            let actions = "";
            const deleteBtn =
                o.status !== "activated"
                    ? '<button class="btn-tiny reject" data-action="delete" data-id="' +
                      esc(o.id) +
                      '" title="从后台删除此记录（已激活不可删）">删除记录</button>'
                    : "";
            if (o.status === "submitted") {
                actions =
                    '<div class="order-actions">' +
                    '<input type="text" placeholder="备注（可选）" data-note="' +
                    esc(o.id) +
                    '" maxlength="500" />' +
                    '<button class="btn-tiny approve" data-action="approve" data-id="' +
                    esc(o.id) +
                    '">' + (IS_WALLET_V3() ? "通过 · 入钱包" : "通过 + 生成激活码") + '</button>' +
                    '<button class="btn-tiny reject" data-action="reject" data-id="' +
                    esc(o.id) +
                    '">拒绝</button>' +
                    deleteBtn +
                    "</div>";
            } else if (o.activation_code) {
                const codeBlock =
                    '<div class="approved-code">激活码：<strong>' +
                    esc(o.activation_code) +
                    '</strong> <button class="btn-tiny approve" data-copy="' +
                    esc(o.activation_code) +
                    '">复制</button>' +
                    (deleteBtn
                        ? '<div class="order-actions" style="margin-top:8px;justify-content:flex-start">' +
                          deleteBtn +
                          "</div>"
                        : "") +
                    "</div>";
                actions = codeBlock;
            } else {
                actions = deleteBtn
                    ? '<div class="order-actions" style="justify-content:flex-start">' +
                      deleteBtn +
                      "</div>"
                    : "—";
            }

            // 联系信息 + 用户备注突出展示（审单时需要直接看到，不用在 meta 里找）
            const contactBlock =
                '<div class="order-contact">' +
                '<span class="oc-label">联系</span>' +
                '<span class="oc-item">邮箱 <code>' + esc(o.email || "—") + "</code></span>" +
                (o.qq
                    ? '<span class="oc-item">QQ <code>' + esc(o.qq) + "</code></span>"
                    : "") +
                (o.wechat_id
                    ? '<span class="oc-item">微信 <code>' + esc(o.wechat_id) + "</code></span>"
                    : "") +
                (o.user_note
                    ? '<span class="oc-note"><strong>用户备注：</strong>' + esc(o.user_note) + "</span>"
                    : "") +
                "</div>";

            return (
                '<div class="order-row' +
                (o.status === "submitted" ? " is-submitted" : "") +
                '">' +
                renderPayableBlock(o) +
                contactBlock +
                '<div class="order-meta-block">' +
                "<strong>" +
                esc(o.email) +
                "</strong>" +
                '<span style="font-size:11px">' +
                "user " +
                "<code>" +
                esc(
                    String(o.user_id || "").slice(0, 8) +
                        "…" +
                        String(o.user_id || "").slice(-4),
                ) +
                "</code></span>" +
                "</div>" +
                '<div class="order-meta-block">' +
                "<span>" +
                statusPill +
                " " +
                renderTierPill(o.tier, o.plan_code) +
                "</span>" +
                "<span>" + renderOrderKindCell(o) + "</span>" +
                "</div>" +
                '<div class="order-meta-block">' +
                "<span>提交 " +
                esc(created) +
                "</span>" +
                "<span>审核 " +
                esc(reviewed) +
                "</span>" +
                "<span>激活 " +
                esc(activated) +
                "</span>" +
                (o.admin_note
                    ? "<span>站主备注：" +
                      esc(o.admin_note) +
                      "</span>"
                    : "") +
                "</div>" +
                actions +
                renderUserContext(o) +
                renderDeviceBlock(o) +
                "</div>"
            );
        })
        .join("");

    // Wire up action buttons
    container
        .querySelectorAll("[data-action]")
        .forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const action = btn.getAttribute("data-action");
                const noteInput = container.querySelector(
                    '[data-note="' + id + '"]',
                );
                const note = noteInput
                    ? noteInput.value.trim()
                    : "";
                if (action === "approve") {
                    // 防手滑：点击后进入 5 秒倒计时，按钮变为「撤销」，
                    // 再点一次即取消；倒计时结束才真正调后端。
                    if (btn.dataset.undoTimer) {
                        clearInterval(Number(btn.dataset.undoTimer));
                        delete btn.dataset.undoTimer;
                        btn.classList.remove("undo");
                        btn.classList.add("approve");
                        btn.textContent = btn.dataset.origLabel || "通过";
                        showToast("已撤销，未提交", "ok");
                        return;
                    }
                    btn.dataset.origLabel = btn.textContent;
                    btn.classList.remove("approve");
                    btn.classList.add("undo");
                    let left = 5;
                    btn.textContent = "撤销（" + left + "s）";
                    const timer = setInterval(async () => {
                        left -= 1;
                        if (left > 0) {
                            btn.textContent = "撤销（" + left + "s）";
                            return;
                        }
                        clearInterval(timer);
                        delete btn.dataset.undoTimer;
                        btn.disabled = true;
                        btn.textContent = "提交中…";
                        try {
                            const r = await callGateway(
                                "admin_approve_order",
                                { order_id: id, admin_note: note },
                            );
                            // 2026-06-23：recharge 订单审核后 auto_credited=true，无激活码
                            if (r.auto_credited) {
                                showToast(
                                    "✅ 通过 · 已自动充值入钱包 ¥" +
                                        ((r.credited_micro || 0) / 1000000).toFixed(2),
                                    "ok",
                                );
                            } else {
                                showToast(
                                    "✅ 通过 · 激活码：" +
                                        (r.activation_code || ""),
                                    "ok",
                                );
                            }
                            // 先本地更新状态并重渲染（即时反馈），
                            // 后台再静默拉一次全量对齐服务端。
                            patchLocalOrder(id, {
                                status: r.auto_credited ? "activated" : "approved",
                                activation_code: r.activation_code || null,
                                admin_note: note || null,
                                reviewed_at: new Date().toISOString(),
                                activated_at: r.auto_credited
                                    ? new Date().toISOString()
                                    : null,
                            });
                            loadOrders();
                            loadOpsAlerts();
                        } catch (err) {
                            const m =
                                (err.body &&
                                    (err.body.message || err.body.error)) ||
                                err.message ||
                                "操作失败";
                            showToast("❌ " + m, "err");
                            btn.disabled = false;
                            btn.classList.remove("undo");
                            btn.classList.add("approve");
                            btn.textContent = btn.dataset.origLabel || "通过";
                        }
                    }, 1000);
                    btn.dataset.undoTimer = String(timer);
                    showToast("⏳ 5 秒后提交通过，点「撤销」可取消", "ok");
                    return;
                }
                btn.disabled = true;
                try {
                    if (action === "reject") {
                        if (
                            !confirm(
                                "确认拒绝？建议先在备注里写明原因（用户能看到）。",
                            )
                        ) {
                            btn.disabled = false;
                            return;
                        }
                        await callGateway("admin_reject_order", {
                            order_id: id,
                            admin_note: note || "未通过审核",
                        });
                        showToast("✅ 已拒绝", "ok");
                        patchLocalOrder(id, {
                            status: "rejected",
                            admin_note: note || "未通过审核",
                            reviewed_at: new Date().toISOString(),
                        });
                    } else if (action === "delete") {
                        if (
                            !confirm(
                                "确认删除此订单记录？\n\n" +
                                    "• 仅在你这边清除记录（如手滑重复提交）\n" +
                                    "• 待审订单删除后仪表盘红点会同步减少\n" +
                                    "• 已激活订单不可删除",
                            )
                        ) {
                            btn.disabled = false;
                            return;
                        }
                        await callGateway("admin_delete_order", { order_id: id });
                        showToast("✅ 订单已删除", "ok");
                        cachedOrders = cachedOrders.filter((o) => o.id !== id);
                        updateStats();
                        renderOrders();
                    }
                    // 本地已即时更新，后台静默对齐服务端（不 await，不阻塞 UI）
                    loadOrders();
                    loadOpsAlerts();
                } catch (err) {
                    const m =
                        (err.body &&
                            (err.body.message ||
                                err.body.error)) ||
                        err.message ||
                        "操作失败";
                    showToast("❌ " + m, "err");
                    btn.disabled = false;
                }
            });
        });

    container.querySelectorAll("[data-copy]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const code = btn.getAttribute("data-copy");
            navigator.clipboard.writeText(code).then(() => {
                const orig = btn.textContent;
                btn.textContent = "已复制";
                setTimeout(() => (btn.textContent = orig), 1500);
            });
        });
    });
}

// 局部乐观更新：审批后立刻把结果反映到列表，不等全量 reload。
function patchLocalOrder(id, patch) {
    const o = cachedOrders.find((x) => x.id === id);
    if (!o) return;
    Object.assign(o, patch);
    updateStats();
    renderOrders();
}

function updateStats() {
    const counts = {
        submitted: 0,
        approved: 0,
        activated: 0,
        rejected: 0,
    };
    cachedOrders.forEach((o) => {
        if (counts[o.status] !== undefined) counts[o.status]++;
    });
    document.getElementById("stat-submitted").textContent =
        counts.submitted;
    document.getElementById("stat-approved").textContent =
        counts.approved;
    document.getElementById("stat-activated").textContent =
        counts.activated;
    document.getElementById("stat-rejected").textContent =
        counts.rejected;
}

async function loadOrders() {
    try {
        const data = await callGateway("admin_list_orders", {});
        cachedOrders = data.orders || [];
        updateStats();
        renderOrders();
    } catch (err) {
        showToast(
            "❌ 加载失败：" +
                ((err.body && err.body.message) || err.message),
            "err",
        );
    }
}

document
    .getElementById("statusFilter")
    .addEventListener("click", (e) => {
        const btn = e.target.closest("[data-status]");
        if (!btn) return;
        currentStatusFilter = btn.getAttribute("data-status") || "";
        document
            .querySelectorAll(".filter-btn")
            .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderOrders();
    });

document
    .getElementById("reload-btn")
    .addEventListener("click", loadOrders);

// Wire up the "邮箱赠码" panel. We attach the listener once on script load
// (the panel is in static HTML) and reuse callGateway for transport so
// auth + JSON encoding stay consistent with the rest of the page.
function wireGrantPanel() {
    const btn = document.getElementById("grantBtn");
    const emailInput = document.getElementById("grantEmail");
    const skuSelect = document.getElementById("grantSku");
    const noteInput = document.getElementById("grantNote");
    const resultBox = document.getElementById("grantResult");
    const rechargeAmountInput = document.getElementById("grantRechargeAmount");
    if (!btn || !emailInput || !noteInput || !resultBox) return;

    // 2026-06-23：选择 recharge 时显示金额输入框，其余隐藏
    if (skuSelect && rechargeAmountInput) {
        skuSelect.addEventListener("change", () => {
            const isRecharge = skuSelect.value.startsWith("recharge:");
            rechargeAmountInput.style.display = isRecharge ? "" : "none";
        });
    }

    btn.addEventListener("click", async () => {
        const email = emailInput.value.trim().toLowerCase();
        const note = noteInput.value.trim();
        // Mirror the backend regex so the user gets immediate feedback
        // instead of waiting for a 400 round-trip.
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast("❌ 请输入有效邮箱", "err");
            emailInput.focus();
            return;
        }
        btn.disabled = true;
        btn.textContent = "生成中…";
        resultBox.classList.remove("show");
        resultBox.innerHTML = "";
        try {
            // 2026-05-17 Phase A：解析 grantSku 选择器
            //   "plan:pro" / "plan:pro_plus" / "plan:pro_max"
            //   "topup:topup_small" / "topup:topup_medium" / "topup:topup_large"
            // 后端 admin_grant_activation_code 接受 plan_code 或 topup_sku，互斥。
            // 2026-06-23：新增 recharge 选项。后端暂无 admin 直接给目标邮箱充值的 RPC，
            // 提示管理员让用户自行提交充值订单后审核（admin_approve_order 自动入钱包）。
            const skuRaw = (skuSelect && skuSelect.value) || "plan:pro";
            const [kind, slug] = String(skuRaw).split(":");
            if (kind === "recharge") {
                showToast("ℹ️ 充值订单需用户自行提交后审核。请让用户在充值页提交 ¥" + (rechargeAmountInput?.value || "?") + " 订单，您在此页审核通过即可自动入钱包。", "info");
                return;
            }
            const grantPayload = { email, admin_note: note };
            if (kind === "topup") {
                grantPayload.topup_sku = slug;
            } else {
                grantPayload.plan_code = slug || "pro";
            }
            const r = await callGateway("admin_grant_activation_code", grantPayload);
            const code = r.activation_code || "";
            // Show the code inline (user-select:all on the box) and try to
            // auto-copy. Auto-copy can fail in some browsers if the click
            // wasn't user-gesture-tied (it should be here, but we don't
            // want a copy failure to block displaying the code).
            resultBox.innerHTML =
                "✅ 已为 <strong>" +
                esc(r.email || email) +
                "</strong> 生成激活码：<br/><strong>" +
                esc(code) +
                "</strong><br/><span style=\"font-size:11.5px;color:var(--text-mute);\">已自动复制到剪贴板，点击文本可重新选中。</span>";
            resultBox.classList.add("show");
            try {
                await navigator.clipboard.writeText(code);
                showToast("✅ 激活码已复制：" + code, "ok");
            } catch {
                showToast(
                    "✅ 已生成（剪贴板权限被拒，请手动复制）",
                    "ok",
                );
            }
            // Reset the inputs so the admin can immediately grant another
            // without manually clearing fields. Keep the result visible.
            emailInput.value = "";
            noteInput.value = "";
            // Refresh the order list — the new row should now show up
            // under "已通过 · 待激活" with admin-grant marker.
            await loadOrders();
        } catch (err) {
            const m =
                (err.body && (err.body.message || err.body.error)) ||
                err.message ||
                "生成失败";
            showToast("❌ " + m, "err");
        } finally {
            btn.disabled = false;
            btn.textContent = "生成激活码";
        }
    });

    // Submit on Enter inside the email input for fast workflow.
    emailInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            btn.click();
        }
    });
}

wireGrantPanel();

async function loadOpsAlerts() {
    const box = document.getElementById("ops-alerts");
    if (!box) return;
    try {
        const data = await callGateway("admin_ops_alerts", {});
        const dup = data.duplicate_submitted || [];
        // 2026-06-23：wallet_v3 下订阅档已下线，后端不再返回 expiring_subscriptions；
        // 兼容旧响应但不再渲染「到期订阅」告警。
        if (dup.length === 0) {
            box.style.display = "none";
            box.innerHTML = "";
            return;
        }
        box.style.display = "block";
        let html = "";
        if (dup.length > 0) {
            html +=
                '<div class="ops-alert ops-alert--warn"><strong>⚠️ 重复待审订单</strong> · ' +
                dup.length +
                " 个用户有多条 submitted（可能是手滑连点）<ul>";
            dup.slice(0, 8).forEach(function (d) {
                html +=
                    "<li>" +
                    esc(d.email || d.user_id) +
                    " · " +
                    d.count +
                    " 条 · 保留 1 条删其余 → " +
                    d.order_ids
                        .slice(1)
                        .map(function (oid) {
                            return (
                                '<button type="button" class="ops-del-btn" data-order-id="' +
                                esc(oid) +
                                '">删</button>'
                            );
                        })
                        .join(" ") +
                    "</li>";
            });
            html += "</ul></div>";
        }
        box.innerHTML = html;
        box.querySelectorAll(".ops-del-btn").forEach(function (b) {
            b.addEventListener("click", async function () {
                const oid = b.getAttribute("data-order-id");
                if (!oid || !confirm("删除重复订单 " + oid.slice(0, 8) + "… ？")) return;
                b.disabled = true;
                try {
                    await callGateway("admin_delete_order", { order_id: oid });
                    showToast("✅ 已删除重复订单", "ok");
                    await loadOrders();
                    await loadOpsAlerts();
                } catch (err) {
                    showToast(
                        "❌ " +
                            ((err.body && err.body.message) || err.message),
                        "err",
                    );
                    b.disabled = false;
                }
            });
        });
    } catch (_e) {
        box.style.display = "none";
    }
}

async function init() {
    const loading = document.getElementById("loading");
    const loginGate = document.getElementById("login-gate");
    const denyGate = document.getElementById("deny-gate");
    const main = document.getElementById("main");

    const {
        data: { user },
    } = await sb.auth.getUser();
    if (!user || user.is_anonymous) {
        loading.style.display = "none";
        loginGate.style.display = "block";
        return;
    }
    try {
        const r = await callGateway("admin_check", {});
        loading.style.display = "none";
        if (!r.is_admin) {
            denyGate.style.display = "block";
            return;
        }
        BILLING_MODE = r.billing_mode || "quota_v2";
        // wallet_v3：激活码赠送面板已无意义（无订阅档可赠），隐藏。
        if (IS_WALLET_V3()) {
            const gp = document.getElementById("grantPanel");
            if (gp) gp.style.display = "none";
        }
        main.style.display = "block";
        await loadOrders();
        await loadOpsAlerts();
    } catch (err) {
        loading.style.display = "none";
        denyGate.style.display = "block";
    }
}

init();
