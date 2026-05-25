// admin-stories-app.js — 满月故事审核后台
// 配套 admin_stories.html。需要 admin 权限。

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

let currentFilter = "pending";
let cached = [];

const $ = (id) => document.getElementById(id);

function toast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + (kind || "");
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => t.classList.remove("show"), 2500);
}

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function callGw(endpoint, payload) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("not_logged_in");
  const resp = await fetch(GW, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: window.__SUPABASE_ANON_KEY__,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      endpoint,
      ...(payload || {}),
      __auth_token: session.access_token,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.message || data.error || "request_failed");
    err.status = resp.status;
    throw err;
  }
  return data;
}

function renderStories(list) {
  const listEl = $("list");
  if (!list || !list.length) {
    listEl.innerHTML = '<div class="empty">没有符合条件的故事。</div>';
    return;
  }
  listEl.innerHTML = list
    .map((s) => {
      const status = s.status || "pending";
      const author = s.display_name || "匿名同行者";
      const uid = s.user_id ? String(s.user_id).slice(0, 8) : "—";
      const reject = s.status === "rejected" && s.reject_reason
        ? `<div class="sc-reject-reason">驳回原因：${escHtml(s.reject_reason)}</div>`
        : "";
      const isHandled = status !== "pending";
      return `
      <div class="story-card ${status}" data-story-id="${s.id}">
        <div class="sc-head">
          <div class="sc-author">
            <span class="pill ${status}">${
              { pending: "待审", approved: "已通过", featured: "精选", rejected: "已驳回" }[status] || status
            }</span>
            <span class="sc-name">${escHtml(author)}</span>
            <span class="sc-uid">${uid}…</span>
          </div>
          <div>
            <span class="sc-id">#${s.id}</span>
            <span class="sc-time" style="margin-left:8px">${formatTime(s.created_at)}</span>
          </div>
        </div>
        <div class="sc-content">${escHtml(s.content)}</div>
        ${reject}
        <div class="sc-actions">
          <button class="btn-approve" data-act="approve" ${status === "approved" || status === "featured" ? "disabled" : ""}>通过</button>
          <button class="btn-feature" data-act="feature" ${status === "featured" ? "disabled" : ""}>精选 ⭐</button>
          <button class="btn-reject" data-act="reject" ${status === "rejected" ? "disabled" : ""}>驳回</button>
          <button class="btn-delete" data-act="delete">删除</button>
        </div>
      </div>`;
    })
    .join("");

  listEl.querySelectorAll(".story-card").forEach((card) => {
    const id = Number(card.getAttribute("data-story-id"));
    card.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => moderateStory(id, btn.getAttribute("data-act"), card));
    });
  });
}

async function moderateStory(id, decision, card) {
  let rejectReason = null;
  if (decision === "reject") {
    rejectReason = prompt("驳回原因（200 字以内，用户可见）", "不符合发布规范");
    if (rejectReason === null) return;
  }
  if (decision === "delete") {
    if (!confirm(`确认物理删除故事 #${id}？此操作不可撤销。`)) return;
  }
  const buttons = card.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    const data = await callGw("admin_moderate_wall_story", {
      story_id: id,
      decision,
      reject_reason: rejectReason,
    });
    if (data.deleted) {
      toast(`#${id} 已删除`, "ok");
    } else if (data.ok && data.story) {
      toast(`#${id} → ${data.story.status}`, "ok");
    } else {
      toast("处理成功", "ok");
    }
    await reload();
  } catch (e) {
    toast(e.message || "处理失败", "err");
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function reload() {
  const listEl = $("list");
  listEl.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await callGw("admin_list_wall_stories", { status: currentFilter });
    cached = data.stories || [];
    renderStories(cached);
  } catch (e) {
    if (e.status === 403) {
      // 不应该走到这；admin_check 阶段已拦。
      listEl.innerHTML = '<div class="empty err">无权访问</div>';
    } else {
      listEl.innerHTML = `<div class="empty err">加载失败：${escHtml(e.message)}</div>`;
    }
  }
}

async function bootstrap() {
  // 等待登录态
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    $("loading").style.display = "none";
    $("login-gate").style.display = "block";
    return;
  }
  try {
    await callGw("admin_check", {});
    $("loading").style.display = "none";
    $("main").style.display = "block";
    await reload();
  } catch (e) {
    $("loading").style.display = "none";
    if (e.status === 403) {
      $("deny-gate").style.display = "block";
    } else {
      $("login-gate").style.display = "block";
    }
  }

  document.querySelectorAll("#statusFilter .filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#statusFilter .filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.getAttribute("data-filter");
      reload();
    });
  });
  $("reload-btn").addEventListener("click", reload);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
