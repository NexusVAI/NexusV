// Cancri 账号设置页逻辑
// 2026-06-01

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
const GW = window.__SUPABASE_URL__ + "/functions/v1/chat-gateway";

let sessionStartMs = Date.now();
let onlineTimer = null;

async function getSession() {
    const { data: { session } } = await sb.auth.getSession();
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

function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
}

function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("zh-CN", {
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
}

function fmtDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return h + " 小时 " + m + " 分钟";
    if (m > 0) return m + " 分钟 " + s + " 秒";
    return s + " 秒";
}

function parseUA(ua) {
    if (!ua) return { browser: "未知", os: "" };
    const u = String(ua).toLowerCase();
    let browser = "未知";
    let os = "";
    if (u.includes("edg/") || u.includes("edge/")) browser = "Edge";
    else if (u.includes("chrome/") && !u.includes("chromium/")) browser = "Chrome";
    else if (u.includes("firefox/")) browser = "Firefox";
    else if (u.includes("safari/") && !u.includes("chrome/")) browser = "Safari";
    else if (u.includes("opr/") || u.includes("opera/")) browser = "Opera";
    if (u.includes("windows")) os = "Windows";
    else if (u.includes("macintosh") || u.includes("mac os")) os = "macOS";
    else if (u.includes("linux")) os = "Linux";
    else if (u.includes("android")) os = "Android";
    else if (u.includes("iphone") || u.includes("ipad")) os = "iOS";
    return { browser, os };
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ── 导航切换 ──
function bindNav() {
    const nav = document.getElementById("settings-nav");
    if (!nav) return;
    nav.querySelectorAll(".nav-item[data-section]").forEach(function (item) {
        item.addEventListener("click", function (e) {
            e.preventDefault();
            const section = item.getAttribute("data-section");
            nav.querySelectorAll(".nav-item").forEach(function (n) { n.classList.remove("is-active"); });
            item.classList.add("is-active");
            ["account", "privacy"].forEach(function (id) {
                const el = document.getElementById("section-" + id);
                if (el) el.classList.toggle("hidden", id !== section);
            });
        });
    });
}

// ── 加载账号数据 ──
async function loadAccount() {
    const session = await getSession();
    if (!session || !session.user) {
        location.href = "./index.html";
        return;
    }
    const user = session.user;
    setText("account-email", esc(user.email || "匿名用户"));
    setText("account-uid", esc(user.id).slice(0, 8) + "…");
    document.getElementById("account-uid").title = user.id;
    setText("account-created", fmtDate(user.created_at));
    setText("account-last-signin", fmtDate(user.last_sign_in_at));

    // 在线计时
    sessionStartMs = Date.now();
    if (onlineTimer) clearInterval(onlineTimer);
    onlineTimer = setInterval(function () {
        setText("account-online", fmtDuration(Date.now() - sessionStartMs));
    }, 1000);
    setText("account-online", fmtDuration(0));

    // 后端拉设备 + IP
    try {
        const info = await callGateway("my_account");
        setText("account-ip", esc(info.current_ip || "—"));
        renderDevices(info.devices || []);
    } catch (err) {
        console.error("my_account:", err);
        setText("account-ip", "获取失败");
        renderDevices([]);
    }
}

function renderDevices(devices) {
    const tbody = document.getElementById("device-list");
    if (!tbody) return;
    if (!devices.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="td-empty">暂无记录</td></tr>';
        return;
    }
    let html = "";
    devices.forEach(function (d, idx) {
        const parsed = parseUA(d.ua);
        const isCurrent = idx === 0 && d.ua === navigator.userAgent;
        const badge = isCurrent ? '<span class="device-badge">当前</span>' : "";
        const location = [d.country, d.timezone].filter(Boolean).join(" / ") || "—";
        html +=
            "<tr>" +
            '<td><div>' + esc(parsed.browser + (parsed.os ? " (" + parsed.os + ")" : "")) + badge + '</div>' +
            '<div class="device-ua">' + esc(d.ua ? d.ua.slice(0, 80) : "") + "</div></td>" +
            "<td>" + esc(location) + "</td>" +
            "<td>" + esc(fmtDate(d.created_at)) + "</td>" +
            "</tr>";
    });
    tbody.innerHTML = html;
}

// ── 登出 ──
function bindSignOut() {
    const btn = document.getElementById("btn-signout-all");
    if (!btn) return;
    btn.addEventListener("click", async function () {
        if (!confirm("确定要从所有设备登出？这将结束所有会话。")) return;
        btn.disabled = true;
        btn.textContent = "处理中…";
        try {
            await sb.auth.signOut({ scope: "global" });
            location.href = "./index.html";
        } catch (err) {
            alert("登出失败：" + (err.message || "未知错误"));
            btn.disabled = false;
            btn.textContent = "登出";
        }
    });
}

// ── 导出聊天记录 ──
function bindExport() {
    const btn = document.getElementById("btn-export");
    const progress = document.getElementById("export-progress");
    if (!btn) return;
    btn.addEventListener("click", async function () {
        btn.disabled = true;
        progress.classList.remove("hidden");
        progress.textContent = "正在获取对话列表…";

        try {
            const listResp = await callGateway("chat_history", { action: "list" });
            const chats = (listResp.data || []);
            if (!chats.length) {
                progress.textContent = "暂无聊天记录可导出。";
                btn.disabled = false;
                return;
            }

            const full = [];
            for (let i = 0; i < chats.length; i++) {
                const chat = chats[i];
                progress.textContent = "正在导出 " + (i + 1) + " / " + chats.length + "…";
                try {
                    const detail = await callGateway("chat_history", { action: "get", id: chat.id });
                    full.push({
                        id: chat.id,
                        title: chat.title || "",
                        created_at: chat.created_at,
                        updated_at: chat.updated_at,
                        messages: (detail.data && detail.data.messages) || [],
                    });
                } catch (e) {
                    full.push({
                        id: chat.id,
                        title: chat.title || "",
                        created_at: chat.created_at,
                        updated_at: chat.updated_at,
                        messages: [],
                        _error: String(e.message || e),
                    });
                }
                // 轻微节流，避免并发冲击
                if (i < chats.length - 1) await new Promise(function (r) { setTimeout(r, 120); });
            }

            const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "cancri_chats_" + new Date().toISOString().slice(0, 10) + ".json";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            progress.textContent = "导出完成：共 " + full.length + " 条对话。";
        } catch (err) {
            console.error("export:", err);
            progress.textContent = "导出失败：" + (err.message || "未知错误");
        } finally {
            btn.disabled = false;
        }
    });
}

// ── 清除本地缓存 ──
function bindClearLocal() {
    const btn = document.getElementById("btn-clear-local");
    if (!btn) return;
    btn.addEventListener("click", function () {
        if (!confirm("确定要清除本地聊天记录缓存吗？这不会删除服务器上的记录。")) return;
        try {
            localStorage.removeItem("cancri_chat_history_list_cache_v1");
            localStorage.removeItem("cancri_pinned_chats");
            alert("本地缓存已清除。");
        } catch (e) {
            alert("清除失败：" + (e.message || "未知错误"));
        }
    });
}

// ── 初始化 ──
(async function init() {
    bindNav();
    bindSignOut();
    bindExport();
    bindClearLocal();
    await loadAccount();
})();
