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

// 时间戳格式化（缺省 — 而非空串），用于设备指纹的 first_seen / last_seen
function fmtTime(iso) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN", { hour12: false });
    } catch {
        return String(iso);
    }
}

// 把可能的 jsonb 数组渲染成逗号分隔字符串（处理 string[] / null / 单字符串）
function fmtArr(v) {
    if (v == null) return "—";
    if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(", ") : "—";
    return String(v);
}

// 渲染 screen JSONB → 形如 "1920×1080@2x · 24bit"
function fmtScreen(s) {
    if (!s || typeof s !== "object") return "—";
    const w = s.w || 0, h = s.h || 0;
    const ratio = s.ratio ? "@" + Number(s.ratio).toFixed(2).replace(/\.?0+$/, "") + "x" : "";
    const depth = s.depth ? " · " + s.depth + "bit" : "";
    return (w && h) ? (w + "\u00d7" + h + ratio + depth) : "—";
}

// 设备指纹块：仅 device 非空时渲染，否则空字符串。
// "宁可多" 原则：把所有有信号的字段都列出来，多账号判断主要看 suspect.distinct_users + WebRTC leak。
function renderDeviceBlock(o) {
    const dev = o.device;
    const sus = o.suspect;
    if (!dev && !sus) {
        return '<div class="dev-block dev-empty">设备指纹：暂无（用户从未登录访问过任何挂了 fingerprint.js 的页面）</div>';
    }

    const flags = [];
    if (dev && dev.vpn_suspected) flags.push('<span class="dev-flag warn">VPN 嫌疑</span>');
    if (dev && dev.webrtc_leak_detected) flags.push('<span class="dev-flag warn">WebRTC 漏 IP</span>');
    if (sus && sus.distinct_users >= 2) {
        flags.push('<span class="dev-flag danger">多账号嫌疑：同设备 ' + sus.distinct_users + ' 号</span>');
    }
    const flagsHtml = flags.length ? '<div class="dev-flags">' + flags.join("") + "</div>" : "";

    const otherUsers = (sus && Array.isArray(sus.user_ids))
        ? sus.user_ids.filter((u) => u && u !== o.user_id)
        : [];
    const otherUsersHtml = otherUsers.length
        ? '<div class="dev-row"><span class="dev-k">同设备其他账号</span><span class="dev-v"><code>'
            + otherUsers.map((u) => esc(String(u))).join("</code> <code>") + "</code></span></div>"
        : "";

    const rows = [];
    if (dev) {
        rows.push(
            '<div class="dev-row"><span class="dev-k">真实 IP / 国家</span><span class="dev-v"><code>'
            + esc(dev.server_ip || "—") + "</code> · "
            + esc(dev.server_country || "—") + "</span></div>"
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

    return (
        '<details class="dev-block"><summary class="dev-summary">'
        + '<span>设备指纹</span>'
        + flagsHtml
        + "</summary>"
        + '<div class="dev-detail">' + rows.join("") + otherUsersHtml + "</div>"
        + "</details>"
    );
}

// tier badge：与 admin_users / pricing 页保持一致的视觉语言
function renderTierPill(tier) {
    if (tier === "paid") {
        return '<span class="status-pill s-2xx" title="付费档">PAID</span>';
    }
    return '<span class="status-pill" style="background:var(--hover);color:var(--text-soft);border:1px solid var(--line)" title="免费档">FREE</span>';
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
                renderTierPill(o.tier) +
                "</span>" +
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
            const r = await callGateway("admin_grant_activation_code", {
                email,
                admin_note: note,
            });
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
