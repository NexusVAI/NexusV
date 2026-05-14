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
    const t = document.getElementById("toast");
    t.textContent = text;
    t.className = "toast" + (kind ? " " + kind : "");
    t.style.display = "block";
    setTimeout(() => {
        t.style.display = "none";
    }, 3500);
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
