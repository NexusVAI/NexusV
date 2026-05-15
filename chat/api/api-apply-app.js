// api_apply.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_apply.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：
//   1. inline <script> -> 外联 .js
//   2. inline onclick="..." -> addEventListener
//   3. CSP <meta> 删 script-src 'unsafe-inline'

// IMPORTANT: storageKey must match cancri_chat.js so session is shared with main chat page
const sb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cancri_supabase_auth' } });
const GW = window.__SUPABASE_URL__ + '/functions/v1/chat-gateway';
let currentUser = null;

async function init() {
    const { data: { user } } = await sb.auth.getUser();
    document.getElementById('loading').style.display = 'none';
    if (!user || user.is_anonymous) {
        document.getElementById('login-section').style.display = 'block';
        return;
    }
    currentUser = user;
    document.getElementById('email').value = user.email || '';
    document.getElementById('apply-section').style.display = 'block';
    await checkExisting();
}

async function checkExisting() {
    try {
        const { data: { session } } = await sb.auth.getSession();
        const resp = await fetch(GW, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
            body: JSON.stringify({ endpoint: 'api_my_keys' })
        });
        const data = await resp.json();
        if (data.applications && data.applications.length > 0) {
            const app = data.applications[0];
            const box = document.getElementById('existing-status');
            box.style.display = 'block';
            const badgeClass = 'status-' + app.status;
            const statusText = { pending: '审核中', approved: '已通过', rejected: '已拒绝' }[app.status] || app.status;
            box.innerHTML = '<div class="status-box"><div>申请状态：<span class="status-badge ' + badgeClass + '">' + statusText + '</span></div><div style="color: var(--text-faint); font-size:12px; margin-top:6px">申请时间：' + new Date(app.created_at).toLocaleString('zh-CN') + '</div></div>';
            document.getElementById('apply-form').style.display = 'none';
            if (app.status === 'approved') {
                document.getElementById('key-section').style.display = 'block';
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function submitApplication() {
    const purpose = document.getElementById('purpose').value.trim();
    if (!purpose) { showMsg('请填写用途说明', true); return; }
    const btn = document.getElementById('submit-btn');
    btn.disabled = true; btn.textContent = '提交中...';
    try {
        const { data: { session } } = await sb.auth.getSession();
        const resp = await fetch(GW, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
            body: JSON.stringify({ endpoint: 'api_apply', purpose })
        });
        const data = await resp.json();
        if (resp.ok) {
            showMsg('申请已提交，请等待审核。', false);
            setTimeout(() => checkExisting(), 1000);
        } else {
            // 优先用后端的友好中文 message，其次再回退到 error / code，
            // 防止用户看到生硬的错误码（如 "invalid_purpose"）。
            showMsg(data.message || data.error || data.code || '提交失败', true);
        }
    } catch (e) {
        showMsg('网络错误', true);
    }
    btn.disabled = false; btn.textContent = '提交申请';
}

function showMsg(text, isErr) {
    const el = document.getElementById('msg');
    el.textContent = text;
    el.className = 'msg ' + (isErr ? 'err' : 'ok');
    el.style.display = 'block';
}

// 绑定 UI 监听器（替代原 inline onclick="..." 属性）。
function bindUI() {
    const loginBtn = document.getElementById('login-redirect-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => { location.href = './'; });
    }
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', submitApplication);
    }
    const manageKeysBtn = document.getElementById('manage-keys-btn');
    if (manageKeysBtn) {
        manageKeysBtn.addEventListener('click', () => { location.href = './api_keys.html'; });
    }
    const backToChatBtn = document.getElementById('back-to-chat-btn');
    if (backToChatBtn) {
        backToChatBtn.addEventListener('click', () => { location.href = './'; });
    }
}

bindUI();
init();

// 赞助横幅折叠/展开。localStorage key 与模型广场、主聊天侧边栏共用，
// 一处收起、全站收起，避免多页反复弹出打扰。
(function () {
    const banner = document.getElementById('cancriPromoBanner');
    const btn = document.getElementById('cancriPromoToggle');
    if (!banner || !btn) return;
    const KEY = 'nexusv_promo_donation_v2';
    try {
        if (localStorage.getItem(KEY) === 'collapsed') {
            banner.classList.add('is-collapsed');
            btn.setAttribute('aria-expanded', 'false');
        }
    } catch (_) {}
    btn.addEventListener('click', () => {
        const willCollapse = !banner.classList.contains('is-collapsed');
        banner.classList.toggle('is-collapsed', willCollapse);
        btn.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');
        try { localStorage.setItem(KEY, willCollapse ? 'collapsed' : 'expanded'); } catch (_) {}
    });
})();
