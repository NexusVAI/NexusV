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

function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
}

const { fmtTime, fmtArr, fmtScreen, fmtAgeDays, fmtTokens, fmtIpGeo } = window.AdminFormatters;

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
function renderTierPill(tier, planCode) {
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
function renderOrderKindCell(o) {
    const kind = o.order_kind || "subscription";
    if (kind === "topup") {
        const sku = o.topup_sku || "";
        const tokens = Number(o.topup_tokens || 0);
        const tokensLabel = tokens >= 100000000 ? (tokens / 100000000).toFixed(2).replace(/\.?0+$/, "") + " 亿"
                          : tokens >= 10000 ? Math.round(tokens / 10000) + " 万"
                          : tokens.toLocaleString();
        return '<span class="status-pill" style="background:rgba(168,85,247,.18);color:#a855f7" title="加油包 ' + esc(sku) + '">加油包 ' + esc(tokensLabel) + '</span>';
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
            Authorization: "Bearer " + session.access_token,
        },
        body: JSON.stringify({ endpoint, ...(payload || {}) }),
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
            if (o.status === "submitted") {
                actions =
                    '<div class="order-actions">' +
                    '<input type="text" placeholder="备注（可选）" data-note="' +
                    esc(o.id) +
                    '" maxlength="500" />' +
                    '<button class="btn-tiny approve" data-action="approve" data-id="' +
                    esc(o.id) +
                    '">通过 + 生成激活码</button>' +
                    '<button class="btn-tiny reject" data-action="reject" data-id="' +
                    esc(o.id) +
                    '">拒绝</button>' +
                    "</div>";
            } else if (o.activation_code) {
                const codeBlock =
                    '<div class="approved-code">激活码：<strong>' +
                    esc(o.activation_code) +
                    '</strong> <button class="btn-tiny approve" data-copy="' +
                    esc(o.activation_code) +
                    '">复制</button></div>';
                actions = codeBlock;
            } else {
                actions = "—";
            }

            return (
                '<div class="order-row">' +
                '<div class="order-meta-block">' +
                "<strong>" +
                esc(o.email) +
                "</strong>" +
                "<span>QQ <code>" +
                esc(o.qq) +
                "</code></span>" +
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
                "<span>提交 " +
                esc(created) +
                "</span>" +
                "<span>审核 " +
                esc(reviewed) +
                "</span>" +
                "<span>激活 " +
                esc(activated) +
                "</span>" +
                "</div>" +
                '<div class="order-meta-block">' +
                "<span>" +
                statusPill +
                " " +
                renderTierPill(o.tier, o.plan_code) +
                "</span>" +
                "<span>" + renderOrderKindCell(o) + "</span>" +
                "<span>¥" +
                esc(o.amount_cny) +
                " · " +
                esc(o.method) +
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
                btn.disabled = true;
                try {
                    if (action === "approve") {
                        const r = await callGateway(
                            "admin_approve_order",
                            { order_id: id, admin_note: note },
                        );
                        showToast(
                            "✅ 通过 · 激活码：" +
                                (r.activation_code || ""),
                            "ok",
                        );
                    } else {
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
                    }
                    await loadOrders();
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
    if (!btn || !emailInput || !noteInput || !resultBox) return;

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
            const skuRaw = (skuSelect && skuSelect.value) || "plan:pro";
            const [kind, slug] = String(skuRaw).split(":");
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
        main.style.display = "block";
        await loadOrders();
    } catch (err) {
        loading.style.display = "none";
        denyGate.style.display = "block";
    }
}

init();
