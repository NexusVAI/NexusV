// api_apply.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_apply.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：
//   1. inline <script> -> 外联 .js
//   2. inline onclick="..." -> addEventListener
//   3. CSP <meta> 删 script-src 'unsafe-inline'

// IMPORTANT: storageKey must match cancri_chat.js so session is shared with main chat page
const GW = window.__SUPABASE_URL__ + "/functions/v1/chat-gateway";
let currentUser = null;
let sb = null;

const esc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

function getSupabase() {
  if (sb) return sb;
  if (!window.supabase || !window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) {
    throw new Error("supabase_not_loaded");
  }
  sb = window.supabase.createClient(
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
  return sb;
}

async function getSession() {
  const client = getSupabase();
  const { data: { session } } = await client.auth.getSession();
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
  if (!resp.ok) {
    throw Object.assign(new Error(data.message || data.error || resp.statusText), {
      status: resp.status,
      body: data,
    });
  }
  return data;
}

function hideLoading() {
  if (window.PlatformSkeleton) PlatformSkeleton.hide("loading");
  else {
    const el = document.getElementById("loading");
    if (el) el.style.display = "none";
  }
}

function showLoadError(msg) {
  hideLoading();
  const login = document.getElementById("login-section");
  if (login) {
    login.style.display = "block";
    login.innerHTML =
      '<p style="margin-bottom:12px;color:var(--err)">' +
      String(msg || "页面初始化失败，请刷新重试。") +
      '</p><button id="login-redirect-btn" class="btn-primary full-btn">返回聊天</button>';
    const btn = document.getElementById("login-redirect-btn");
    if (btn) btn.addEventListener("click", () => { location.href = "./"; });
  }
}

async function init() {
  try {
    getSupabase();
    const session = await getSession();
    hideLoading();
    if (!session || !session.user || session.user.is_anonymous) {
      document.getElementById("login-section").style.display = "block";
      return;
    }
    currentUser = session.user;
    document.getElementById("email").value = session.user.email || "";
    document.getElementById("apply-section").style.display = "block";
    await checkExisting();
  } catch (e) {
    console.error("contact_ticket init:", e);
    showLoadError(
      e && e.message === "supabase_not_loaded"
        ? "依赖脚本加载失败，请检查网络后刷新页面。"
        : "加载失败，请刷新页面或返回聊天页重新登录。",
    );
  }
}

// 2026-08-04：申请制取消，本页改为工单/反馈；只展示 kind='contact' 的工单，
// 表单不再隐藏（可提多张，上限由后端控制）。创建 Key 无需审核，常驻入口。
async function checkExisting() {
  try {
    const data = await callGateway("api_my_keys", {});
    document.getElementById("key-section").style.display = "block";
    const tickets = (data.applications || []).filter((a) => a.kind === "contact");
    if (tickets.length === 0) return;
    const t = tickets[0];
    const box = document.getElementById("existing-status");
    box.style.display = "block";
    const st = esc(String(t.status || ""));
    const statusText = esc({ pending: "待处理", approved: "已处理", rejected: "已关闭" }[t.status] || st);
    box.innerHTML =
      '<div class="status-box"><div>最近工单：<span class="status-badge status-' +
      st + '">' + statusText +
      '</span></div><div style="color: var(--text-faint); font-size:12px; margin-top:6px">提交时间：' +
      new Date(t.created_at).toLocaleString("zh-CN") +
      "</div></div>";
  } catch (e) {
    console.error("checkExisting:", e);
    showMsg("读取工单状态失败，请稍后刷新。", true);
  }
}

async function submitTicket() {
  const content = document.getElementById("purpose").value.trim();
  if (content.length < 2) { showMsg("请填写工单内容（至少 2 个字符）", true); return; }
  const btn = document.getElementById("submit-btn");
  btn.disabled = true; btn.textContent = "提交中...";
  try {
    await callGateway("contact_ticket", { content });
    showMsg("已提交，我们会通过注册邮箱回复你。", false);
    document.getElementById("purpose").value = "";
    setTimeout(() => checkExisting(), 1000);
  } catch (e) {
    const m = (e.body && (e.body.message || e.body.error)) || e.message || "提交失败";
    showMsg(m, true);
  }
  btn.disabled = false; btn.textContent = "提交工单";
}

function showMsg(text, isErr) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = "msg " + (isErr ? "err" : "ok");
  el.style.display = "block";
}

// 绑定 UI 监听器（替代原 inline onclick="..." 属性）。
function bindUI() {
  const loginBtn = document.getElementById("login-redirect-btn");
  if (loginBtn) {
    loginBtn.addEventListener("click", () => { location.href = "./"; });
  }
  const submitBtn = document.getElementById("submit-btn");
  if (submitBtn) {
    submitBtn.addEventListener("click", submitTicket);
  }
  const manageKeysBtn = document.getElementById("manage-keys-btn");
  if (manageKeysBtn) {
    manageKeysBtn.addEventListener("click", () => { location.href = "./api_keys.html"; });
  }
  const backToChatBtn = document.getElementById("back-to-chat-btn");
  if (backToChatBtn) {
    backToChatBtn.addEventListener("click", () => { location.href = "./"; });
  }
}

bindUI();
init();
