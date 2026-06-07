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
  const el = document.getElementById("loading");
  if (el) el.style.display = "none";
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
    console.error("api_apply init:", e);
    showLoadError(
      e && e.message === "supabase_not_loaded"
        ? "依赖脚本加载失败，请检查网络后刷新页面。"
        : "加载失败，请刷新页面或返回聊天页重新登录。",
    );
  }
}

async function checkExisting() {
  try {
    const data = await callGateway("api_my_keys", {});
    if (data.applications && data.applications.length > 0) {
      const app = data.applications[0];
      const box = document.getElementById("existing-status");
      box.style.display = "block";
      const badgeClass = "status-" + app.status;
      const statusText = { pending: "审核中", approved: "已通过", rejected: "已拒绝" }[app.status] || app.status;
      box.innerHTML =
        '<div class="status-box"><div>申请状态：<span class="status-badge ' +
        badgeClass +
        '">' +
        statusText +
        '</span></div><div style="color: var(--text-faint); font-size:12px; margin-top:6px">申请时间：' +
        new Date(app.created_at).toLocaleString("zh-CN") +
        "</div></div>";
      document.getElementById("apply-form").style.display = "none";
      if (app.status === "approved") {
        document.getElementById("key-section").style.display = "block";
      }
    }
  } catch (e) {
    console.error("checkExisting:", e);
    showMsg("读取申请状态失败，请稍后刷新。", true);
  }
}

async function submitApplication() {
  const purpose = document.getElementById("purpose").value.trim();
  if (!purpose) { showMsg("请填写用途说明", true); return; }
  const btn = document.getElementById("submit-btn");
  btn.disabled = true; btn.textContent = "提交中...";
  try {
    await callGateway("api_apply", { purpose });
    showMsg("申请已提交，请等待审核。", false);
    setTimeout(() => checkExisting(), 1000);
  } catch (e) {
    const m = (e.body && (e.body.message || e.body.error)) || e.message || "提交失败";
    showMsg(m, true);
  }
  btn.disabled = false; btn.textContent = "提交申请";
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
    submitBtn.addEventListener("click", submitApplication);
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

// 赞助横幅折叠/展开。localStorage key 与模型广场、主聊天侧边栏共用，
// 一处收起、全站收起，避免多页反复弹出打扰。
(function () {
  const banner = document.getElementById("cancriPromoBanner");
  const btn = document.getElementById("cancriPromoToggle");
  if (!banner || !btn) return;
  const KEY = "nexusv_promo_donation_v2";
  try {
    if (localStorage.getItem(KEY) === "collapsed") {
      banner.classList.add("is-collapsed");
      btn.setAttribute("aria-expanded", "false");
    }
  } catch (_) {}
  btn.addEventListener("click", () => {
    const willCollapse = !banner.classList.contains("is-collapsed");
    banner.classList.toggle("is-collapsed", willCollapse);
    btn.setAttribute("aria-expanded", willCollapse ? "false" : "true");
    try { localStorage.setItem(KEY, willCollapse ? "collapsed" : "expanded"); } catch (_) {}
  });
})();
