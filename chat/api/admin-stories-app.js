// admin-stories-app.js — 满月内容管理后台 · Phase 5
// 配套 admin_stories.html。需要 admin 权限。
//
// 三视图：
//   • stories（默认）：所有故事，按状态过滤，可批量操作 + 单条 ban
//   • comments：wall 或 chronicle 评论，可删除 + ban 作者
//   • bans：禁言名单，可解禁
//
// 所有 endpoint 走 chat-gateway，service-role 二次验权 admin 身份。

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

const state = {
  view: "stories",
  // 默认显示「全部」，避免"通过后什么都看不到"的错觉
  storyFilter: "all",
  commentScope: "wall",
  selected: new Set(), // 选中的 story id（批量操作）
  cache: { stories: [], comments: [], bans: [] },
  // 各 status 的数量，用于在 tab 上显示徽章
  storyCounts: { pending: 0, approved: 0, featured: 0, rejected: 0, all: 0 },
};

const $ = (id) => document.getElementById(id);

function toast(msg, kind) {
  const t = $("toast");
  if (!t) { alert(msg); return; }
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

function shortId(s, n) {
  if (!s) return "—";
  const str = String(s);
  return str.length > (n || 8) ? str.slice(0, n || 8) + "…" : str;
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(
      () => toast("已复制", "ok"),
      () => toast("复制失败", "err"),
    );
    return;
  }
  // fallback
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    toast("已复制", "ok");
  } catch (_) {
    toast("复制失败", "err");
  }
  document.body.removeChild(ta);
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

// ─── view 切换 ───
function switchView(view) {
  state.view = view;
  state.selected.clear();
  for (const btn of $("viewTabs").querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.view === view);
  }
  $("storiesToolbar").style.display = view === "stories" ? "" : "none";
  $("commentsToolbar").style.display = view === "comments" ? "" : "none";
  $("bansToolbar").style.display = view === "bans" ? "" : "none";
  $("bulkBar").classList.add("is-hidden");
  $("list").innerHTML = '<div class="empty">加载中…</div>';
  reload();
}

// ─── 批量选择 ───
function refreshBulkBar() {
  const bar = $("bulkBar");
  const count = state.selected.size;
  $("bulkCount").textContent = `已选 ${count} 条`;
  bar.classList.toggle("is-hidden", count === 0 || state.view !== "stories");
}

// ─── 渲染 故事 ───
function metaRowHtml(s) {
  return `
    <div class="sc-meta-row">
      <span>UID: <code>${escHtml(s.user_id ? String(s.user_id).slice(0, 8) + "…" : "—")}</code>
        ${s.user_id ? `<button class="copy-btn" data-copy="${escHtml(s.user_id)}">复制</button>` : ""}
      </span>
      <span>邮箱: <code>${escHtml(s.email || "—")}</code></span>
      <span>IP: <code>${escHtml(s.ip_address || "—")}</code>
        ${s.ip_address ? `<button class="copy-btn" data-copy="${escHtml(s.ip_address)}">复制</button>` : ""}
      </span>
      <span>指纹: <code>${escHtml(s.fingerprint_hash ? String(s.fingerprint_hash).slice(0, 20) + "…" : "—")}</code>
        ${s.fingerprint_hash ? `<button class="copy-btn" data-copy="${escHtml(s.fingerprint_hash)}">复制</button>` : ""}
      </span>
    </div>`;
}

// 只放行 http(s) 图片 URL。后端已校验 image_urls 必须是 storage 公开桶前缀，
// 这里是前端纵深防御：即便后端校验回退，也不会在 admin 视图渲染出可点击的
// javascript:/data: 链接（admin 点 "查看大图" = admin 态 XSS）。
function safeImageUrl(u) {
  const s = String(u == null ? "" : u).trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

function imagesHtml(urls) {
  if (!Array.isArray(urls) || !urls.length) return "";
  const items = urls
    .map((u, i) => {
      const safe = safeImageUrl(u);
      if (!safe) return "";
      return `<a href="${escHtml(safe)}" target="_blank" rel="noopener noreferrer" title="查看大图"><img src="${escHtml(safe)}" alt="图片 ${i + 1}" loading="lazy" /></a>`;
    })
    .join("");
  if (!items) return "";
  return `<div class="sc-images">
    ${items}
  </div>`;
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
      const reject = s.status === "rejected" && s.reject_reason
        ? `<div class="sc-reject-reason">驳回原因：${escHtml(s.reject_reason)}</div>`
        : "";
      const banned = s.is_banned ? '<span class="pill banned">已禁言</span>' : "";
      const checked = state.selected.has(s.id) ? "checked" : "";
      return `
      <div class="story-card ${status}" data-story-id="${s.id}">
        <div class="sc-head">
          <div class="sc-author">
            <input type="checkbox" class="sc-select" data-select="${s.id}" ${checked} />
            <span class="pill ${status}">${
              { pending: "待审", approved: "已通过", featured: "精选", rejected: "已驳回" }[status] || status
            }</span>
            ${banned}
            <span class="sc-name">${escHtml(author)}</span>
            <span class="sc-uid">like ${Number(s.like_count || 0)} · cmt ${Number(s.comment_count || 0)}</span>
          </div>
          <div>
            <span class="sc-id">#${s.id}</span>
            <span class="sc-time" style="margin-left:8px">${formatTime(s.created_at)}</span>
          </div>
        </div>
        ${metaRowHtml(s)}
        <div class="sc-content">${escHtml(s.content)}</div>
        ${imagesHtml(s.image_urls)}
        ${reject}
        <div class="sc-actions">
          <button class="btn-approve" data-act="approve" ${status === "approved" || status === "featured" ? "disabled" : ""}>通过</button>
          <button class="btn-feature" data-act="feature" ${status === "featured" ? "disabled" : ""}>精选 ⭐</button>
          <button class="btn-reject" data-act="reject" ${status === "rejected" ? "disabled" : ""}>驳回</button>
          <button class="btn-delete" data-act="delete">删除</button>
          <button class="btn-ban" data-act="ban" ${s.is_banned ? "disabled" : ""}>禁言作者</button>
        </div>
      </div>`;
    })
    .join("");

  // 绑定事件
  listEl.querySelectorAll(".story-card").forEach((card) => {
    const id = Number(card.getAttribute("data-story-id"));
    card.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => actStory(id, btn.getAttribute("data-act"), card));
    });
    const cb = card.querySelector(".sc-select");
    if (cb) {
      cb.addEventListener("change", () => {
        if (cb.checked) state.selected.add(id);
        else state.selected.delete(id);
        refreshBulkBar();
      });
    }
  });
  listEl.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => copyToClipboard(btn.getAttribute("data-copy")));
  });
}

async function actStory(id, decision, card) {
  let rejectReason = null;
  if (decision === "reject") {
    rejectReason = prompt("驳回原因（200 字以内，用户可见）", "不符合发布规范");
    if (rejectReason === null) return;
  }
  if (decision === "delete") {
    if (!confirm(`确认物理删除故事 #${id}？此操作不可撤销。`)) return;
  }
  if (decision === "ban") {
    const story = state.cache.stories.find((s) => s.id === id);
    if (!story) return;
    openBanDialog({
      user_id: story.user_id,
      fingerprint: story.fingerprint_hash,
      email: story.email,
    });
    return;
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
      // 提示用户故事去了哪个 tab；如果当前 filter 不是 'all'，会"消失"
      const labelMap = { approved: "已通过", featured: "精选", rejected: "已驳回", pending: "待审核" };
      const nextLabel = labelMap[data.story.status] || data.story.status;
      const isHidden = state.storyFilter !== "all" && state.storyFilter !== data.story.status;
      toast(`#${id} → 「${nextLabel}」${isHidden ? "（切到「" + nextLabel + "」或「全部」可查看）" : ""}`, "ok");
    } else {
      toast("处理成功", "ok");
    }
    await reload();
  } catch (e) {
    toast(e.message || "处理失败", "err");
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ─── 批量操作 ───
async function bulkAct(decision) {
  const ids = Array.from(state.selected);
  if (!ids.length) return;
  if (decision === "delete") {
    if (!confirm(`确认批量删除 ${ids.length} 条？不可撤销。`)) return;
  }
  let rejectReason = null;
  if (decision === "reject") {
    rejectReason = prompt(`批量驳回原因（${ids.length} 条共用）`, "不符合发布规范");
    if (rejectReason === null) return;
  }
  for (const id of ids) {
    try {
      await callGw("admin_moderate_wall_story", { story_id: id, decision, reject_reason: rejectReason });
    } catch (e) {
      toast(`#${id} 失败：${e.message}`, "err");
    }
  }
  state.selected.clear();
  toast(`已处理 ${ids.length} 条`, "ok");
  await reload();
}

// ─── 渲染 评论 ───
function renderComments(list) {
  const listEl = $("list");
  if (!list || !list.length) {
    listEl.innerHTML = '<div class="empty">暂无评论。</div>';
    return;
  }
  listEl.innerHTML = list
    .map((c) => {
      const scopeClass = c.scope === "chronicle" ? "scope-chronicle" : "scope-wall";
      const scopePill = c.scope === "chronicle"
        ? '<span class="pill scope chronicle">编年史</span>'
        : '<span class="pill scope">故事墙</span>';
      const banned = c.is_banned ? '<span class="pill banned">已禁言</span>' : "";
      const featured = c.is_featured ? '<span class="pill featured">⭐ 精选</span>' : "";
      const author = c.display_name || "匿名同行者";
      const isWall = c.scope === "wall";
      const authorFeatLimit = Number(c.author_featured_count || 0) >= 1 && !c.is_featured;
      // 仅 wall 评论支持「精选」；已精选 → 取消；该作者已经有过 1 条精选 → 禁用
      let featureBtn = "";
      if (isWall) {
        if (c.is_featured) {
          featureBtn = '<button class="btn-unfeature" data-act="unfeature">取消精选</button>';
        } else if (authorFeatLimit) {
          featureBtn = '<button class="btn-feature" data-act="feature" disabled title="该作者已有 1 条评论被精选">精选 ⭐</button>';
        } else {
          featureBtn = '<button class="btn-feature" data-act="feature">精选 ⭐</button>';
        }
      }
      return `
      <div class="comment-card ${scopeClass}${c.is_featured ? " is-featured" : ""}" data-comment-id="${c.id}" data-scope="${c.scope}">
        <div class="sc-head">
          <div class="sc-author">
            ${scopePill}
            ${featured}
            ${banned}
            <span class="sc-name">${escHtml(author)}</span>
            <span class="sc-uid">→ ${escHtml(c.parent_excerpt || "")}…</span>
          </div>
          <div>
            <span class="sc-id">#${c.id}</span>
            <span class="sc-time" style="margin-left:8px">${formatTime(c.created_at)}</span>
          </div>
        </div>
        ${metaRowHtml(c)}
        <div class="sc-content">${escHtml(c.content)}</div>
        <div class="sc-actions">
          ${featureBtn}
          <button class="btn-delete" data-act="delete">删除</button>
          <button class="btn-ban" data-act="ban" ${c.is_banned ? "disabled" : ""}>禁言作者</button>
        </div>
      </div>`;
    })
    .join("");

  listEl.querySelectorAll(".comment-card").forEach((card) => {
    const id = Number(card.getAttribute("data-comment-id"));
    const scope = card.getAttribute("data-scope");
    card.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => actComment(id, scope, btn.getAttribute("data-act"), card));
    });
  });
  listEl.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => copyToClipboard(btn.getAttribute("data-copy")));
  });
}

async function actComment(id, scope, decision, card) {
  if (decision === "delete") {
    if (!confirm(`确认删除评论 #${id}？`)) return;
    const buttons = card.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    try {
      await callGw("admin_delete_wall_comment", { scope, comment_id: id });
      toast(`#${id} 已删除`, "ok");
      await reload();
    } catch (e) {
      toast(e.message || "失败", "err");
      buttons.forEach((b) => (b.disabled = false));
    }
    return;
  }
  if (decision === "ban") {
    const c = state.cache.comments.find((x) => x.id === id);
    if (!c) return;
    openBanDialog({
      user_id: c.user_id,
      fingerprint: c.fingerprint_hash,
      email: c.email,
      defaultScope: scope === "chronicle" ? "chronicle_comment" : "wall",
    });
    return;
  }
  if (decision === "feature") {
    const c = state.cache.comments.find((x) => x.id === id);
    if (!c) return;
    const ok = confirm(
      `精选这条评论？\n\n` +
      `作者：${c.email || "(无邮箱)"} (UID ${shortId(c.user_id)})\n` +
      `内容：${(c.content || "").slice(0, 60)}${c.content && c.content.length > 60 ? "…" : ""}\n` +
      `─────────────────\n` +
      `奖励：Pro 30 天激活码 + 1,000 积分\n` +
      `每个作者最多 1 条被精选。本动作会自动生成激活码（用户可在订单页激活）。`,
    );
    if (!ok) return;
    const buttons = card.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    try {
      const data = await callGw("admin_feature_wall_comment", { comment_id: id });
      const r = data.result || {};
      if (r.ok === false) {
        toast(`精选失败：${r.message || r.reason}`, "err");
        buttons.forEach((b) => (b.disabled = false));
        return;
      }
      // 成功：显著提示激活码
      const codeMsg =
        `✓ 已精选！\n\n` +
        `激活码：${r.activation_code}\n` +
        `（已点击复制按钮自动复制，发给作者）\n\n` +
        `积分：+${window.CancriCredits ? window.CancriCredits.fmt(r.tokens_granted || 0) : Number(r.tokens_granted || 0).toLocaleString()}\n` +
        `Pro 天数：${r.pro_days || 30}`;
      if (r.activation_code) {
        try { await navigator.clipboard.writeText(r.activation_code); } catch (_) {}
      }
      alert(codeMsg);
      toast("已精选 · 激活码已复制", "ok");
      await reload();
    } catch (e) {
      toast(e.message || "精选失败", "err");
      buttons.forEach((b) => (b.disabled = false));
    }
    return;
  }
  if (decision === "unfeature") {
    if (!confirm(`取消精选 #${id}？已发出的积分和 Pro 激活码不会撤回。`)) return;
    const buttons = card.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    try {
      await callGw("admin_unfeature_wall_comment", { comment_id: id });
      toast(`#${id} 已取消精选`, "ok");
      await reload();
    } catch (e) {
      toast(e.message || "失败", "err");
      buttons.forEach((b) => (b.disabled = false));
    }
  }
}

// ─── 渲染 禁言名单 ───
function renderBans(list) {
  const listEl = $("list");
  if (!list || !list.length) {
    listEl.innerHTML = '<div class="empty">禁言名单为空。</div>';
    return;
  }
  listEl.innerHTML = list
    .map((b) => {
      const activeClass = b.active ? "" : " ban-expired";
      const scopePill = `<span class="pill scope${b.scope === "chronicle_comment" ? " chronicle" : ""}">${escHtml(b.scope)}</span>`;
      const status = b.active ? '<span class="pill banned">生效中</span>' : '<span class="pill">已失效</span>';
      return `
      <div class="ban-card${activeClass}" data-ban-id="${b.id}">
        <div class="sc-head">
          <div class="sc-author">
            ${scopePill} ${status}
            <span class="sc-name">${escHtml(b.banned_email || (b.banned_fingerprint ? "fp" : "—"))}</span>
            <span class="sc-uid">UID ${shortId(b.banned_user_id)}</span>
          </div>
          <div>
            <span class="sc-id">#${b.id}</span>
            <span class="sc-time" style="margin-left:8px">封禁 ${formatTime(b.banned_at)}</span>
            ${b.expires_at ? `<span class="sc-time" style="margin-left:6px">到期 ${formatTime(b.expires_at)}</span>` : '<span class="sc-time" style="margin-left:6px">永久</span>'}
          </div>
        </div>
        <div class="sc-meta-row">
          <span>UID: <code>${escHtml(b.banned_user_id || "—")}</code></span>
          <span>指纹: <code>${escHtml(b.banned_fingerprint || "—")}</code></span>
          <span>原因: ${escHtml(b.reason || "未填写")}</span>
        </div>
        <div class="sc-actions">
          <button class="btn-unban" data-act="unban">解除禁言</button>
        </div>
      </div>`;
    })
    .join("");

  listEl.querySelectorAll(".ban-card").forEach((card) => {
    const id = Number(card.getAttribute("data-ban-id"));
    const btn = card.querySelector("button[data-act='unban']");
    if (btn) btn.addEventListener("click", () => actUnban(id, card));
  });
}

async function actUnban(id, card) {
  if (!confirm(`解除 ban #${id}？`)) return;
  const btn = card.querySelector("button");
  btn.disabled = true;
  try {
    await callGw("admin_unban_wall_user", { ban_id: id });
    toast(`ban #${id} 已解除`, "ok");
    await reload();
  } catch (e) {
    toast(e.message || "失败", "err");
    btn.disabled = false;
  }
}

// ─── ban dialog ───
function openBanDialog(opts) {
  const o = opts || {};
  const scope = o.defaultScope || "wall";
  const scopeLabel = { wall: "故事墙", chronicle_comment: "编年史评论", all: "全部" }[scope] || scope;
  const reason = prompt(
    `禁言确认\n` +
    `目标用户：${o.email || "—"} (UID ${shortId(o.user_id)})\n` +
    `指纹：${shortId(o.fingerprint, 16)}\n` +
    `Scope：${scope} (${scopeLabel})\n` +
    `─────────────────\n请输入禁言原因（留空使用「管理员手动禁言」）：`,
    "违反社区规范",
  );
  if (reason === null) return;
  const days = prompt("禁言时长（天）。留空 = 永久；数字会自动转换到 ISO 时间：", "");
  if (days === null) return;
  let expiresAt = null;
  if (days && !isNaN(Number(days)) && Number(days) > 0) {
    const t = Date.now() + Number(days) * 86400 * 1000;
    expiresAt = new Date(t).toISOString();
  }
  callGw("admin_ban_wall_user", {
    banned_user_id: o.user_id || null,
    banned_fingerprint: o.fingerprint || null,
    scope,
    reason: reason || "管理员手动禁言",
    expires_at: expiresAt,
  }).then(() => {
    toast("已禁言", "ok");
    return reload();
  }).catch((e) => {
    toast("禁言失败：" + e.message, "err");
  });
}

function openManualBanDialog() {
  const uid = prompt("输入要禁言的 user_id（UUID 格式）。留空则使用 fingerprint：", "");
  if (uid === null) return;
  let fp = null;
  if (!uid) {
    fp = prompt("输入要禁言的 fingerprint：", "");
    if (!fp) return;
  }
  openBanDialog({ user_id: uid || null, fingerprint: fp });
}

// 统计 + 更新 tab 徽章
function updateStoryCounts(allStories) {
  const c = { pending: 0, approved: 0, featured: 0, rejected: 0, all: 0 };
  for (const s of allStories) {
    c.all += 1;
    if (c[s.status] !== undefined) c[s.status] += 1;
  }
  state.storyCounts = c;
  document.querySelectorAll(".count-badge[data-count-for]").forEach((el) => {
    const key = el.getAttribute("data-count-for");
    el.textContent = String(c[key] != null ? c[key] : 0);
  });
}

// 按 state.storyFilter 本地 filter，避免每次切 tab 都打一次后端
function applyStoryFilter() {
  const f = state.storyFilter;
  const stories = state.cache.stories || [];
  if (f === "all") return stories;
  return stories.filter((s) => s.status === f);
}

// ─── reload 派发 ───
async function reload() {
  const listEl = $("list");
  listEl.innerHTML = '<div class="empty">加载中…</div>';
  try {
    if (state.view === "stories") {
      // Phase 5b：一次拉全部，本地 filter；这样切 tab 秒变，并且 count 总是准的
      const data = await callGw("admin_list_wall_stories", { status: "all" });
      state.cache.stories = data.stories || [];
      updateStoryCounts(state.cache.stories);
      renderStories(applyStoryFilter());
      refreshBulkBar();
    } else if (state.view === "comments") {
      const data = await callGw("admin_list_wall_comments", { scope: state.commentScope });
      state.cache.comments = data.comments || [];
      renderComments(state.cache.comments);
    } else if (state.view === "bans") {
      const data = await callGw("admin_list_wall_bans", {});
      state.cache.bans = data.bans || [];
      renderBans(state.cache.bans);
    }
  } catch (e) {
    if (e.status === 403) {
      listEl.innerHTML = '<div class="empty err">无权访问</div>';
    } else {
      listEl.innerHTML = `<div class="empty err">加载失败：${escHtml(e.message)}</div>`;
    }
  }
}

// ─── bootstrap ───
async function bootstrap() {
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
    if (e.status === 403) $("deny-gate").style.display = "block";
    else $("login-gate").style.display = "block";
    return;
  }

  // view tabs
  document.querySelectorAll("#viewTabs button").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // stories filter：切 tab 只做本地 re-render，已经 cache 在 state.cache.stories
  document.querySelectorAll("#statusFilter .filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#statusFilter .filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.storyFilter = btn.getAttribute("data-filter");
      state.selected.clear();
      if (state.view === "stories" && state.cache.stories.length >= 0) {
        renderStories(applyStoryFilter());
        refreshBulkBar();
      } else {
        reload();
      }
    });
  });

  // comments scope
  document.querySelectorAll("#commentScopeFilter .filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#commentScopeFilter .filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.commentScope = btn.getAttribute("data-scope");
      reload();
    });
  });

  // reloads
  $("reload-btn").addEventListener("click", reload);
  $("comments-reload-btn").addEventListener("click", reload);
  $("bans-reload-btn").addEventListener("click", reload);

  // add manual ban
  $("add-ban-btn").addEventListener("click", openManualBanDialog);

  // bulk bar
  document.querySelectorAll("#bulkBar button[data-bulk]").forEach((btn) => {
    btn.addEventListener("click", () => bulkAct(btn.getAttribute("data-bulk")));
  });
  $("bulkClearBtn").addEventListener("click", () => {
    state.selected.clear();
    refreshBulkBar();
    reload();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
