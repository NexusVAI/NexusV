// admin_models.html 的页面逻辑（2026-05-30 Phase A）。
// 倍率档位 / 促销窗口 / 默认聊天模型全部迁到 DB（model_cost_tiers /
// model_config_kv）后，这个页面让 admin 网页改这些值，≤60s 全量生效，
// 无需重新部署 chat-gateway。沿用 admin-lines-app.js 的鉴权 / callGW 模式。

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

const TIER_ORDER = ["free", "cheap", "normal", "expensive", "vip"];
const TIER_LABELS = {
  free: "免费 · free",
  cheap: "便宜 · cheap",
  normal: "普通 · normal",
  expensive: "较贵 · expensive",
  vip: "VIP · vip",
};

let STATE = { tiers: [], config: {} };

const $ = (id) => document.getElementById(id);
const esc = (s) => {
  const d = document.createElement("div");
  d.textContent = String(s == null ? "" : s);
  return d.innerHTML;
};

function showToast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + (kind || "");
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => t.classList.remove("show"), 2600);
}

async function getSession() {
  const {
    data: { session },
  } = await sb.auth.getSession();
  return session;
}

async function callGW(payload, session) {
  const resp = await fetch(GW, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: window.__SUPABASE_ANON_KEY__,
    },
    body: JSON.stringify({ ...payload, __auth_token: session.access_token }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

async function init() {
  const session = await getSession();
  $("loading").style.display = "none";
  if (!session || !session.user || session.user.is_anonymous) {
    $("login-gate").style.display = "block";
    return;
  }
  const check = await callGW({ endpoint: "admin_check" }, session);
  if (!check.ok || !check.data?.is_admin) {
    $("deny-gate").style.display = "block";
    return;
  }
  await loadConfig();
}

async function loadConfig() {
  const session = await getSession();
  const r = await callGW({ endpoint: "admin_get_model_config" }, session);
  if (r.status === 403) {
    $("deny-gate").style.display = "block";
    return;
  }
  if (!r.ok) {
    showToast("加载失败：HTTP " + r.status, "err");
    return;
  }
  STATE.tiers = Array.isArray(r.data?.tiers) ? r.data.tiers : [];
  STATE.config = r.data?.config || {};
  $("main").style.display = "block";
  renderTiers();
  renderPromo();
  renderDefaultModel();
}

// ─── 倍率档位 ───────────────────────────────────────────────
function renderTiers() {
  const map = {};
  STATE.tiers.forEach((t) => {
    map[t.tier] = Number(t.factor);
  });
  const root = $("tiers");
  root.innerHTML = TIER_ORDER.map((tier) => {
    const factor = map[tier] != null && Number.isFinite(map[tier]) ? map[tier] : "";
    return `<div class="cfg-row">
      <div class="cfg-label">${esc(TIER_LABELS[tier] || tier)}</div>
      <input class="cfg-input" type="number" min="0" step="0.1" id="tier-${esc(tier)}" value="${esc(factor)}" />
      <span class="cfg-unit">×</span>
      <button class="btn-save" data-tier="${esc(tier)}">保存</button>
    </div>`;
  }).join("");
  root.querySelectorAll("button[data-tier]").forEach((btn) => {
    btn.addEventListener("click", () => saveTier(btn.getAttribute("data-tier"), btn));
  });
}

async function saveTier(tier, btn) {
  const input = $("tier-" + tier);
  const factor = Number(input.value);
  if (!Number.isFinite(factor) || factor < 0) {
    showToast("倍率必须是 ≥ 0 的数字", "err");
    return;
  }
  const session = await getSession();
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "保存中…";
  const r = await callGW({ endpoint: "admin_set_cost_tier", tier, factor }, session);
  btn.disabled = false;
  btn.textContent = old;
  if (!r.ok) {
    showToast("保存失败：" + (r.data?.message || r.status), "err");
    return;
  }
  showToast(`已保存 ${tier} = ${factor}×（≤60s 全量生效）`, "ok");
}

// ─── 促销窗口 ───────────────────────────────────────────────
function msToLocalInput(ms) {
  const n = Number(ms);
  if (!n || !Number.isFinite(n)) return "";
  const d = new Date(n);
  if (isNaN(d.getTime())) return "";
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToMs(s) {
  if (!s) return NaN;
  const d = new Date(s);
  return d.getTime();
}

function renderPromo() {
  const p = STATE.config.promo_window || {};
  $("promo-enabled").checked = p.enabled !== false;
  $("promo-start").value = msToLocalInput(p.start_ms);
  $("promo-end").value = msToLocalInput(p.end_ms);
  $("promo-factor").value = p.factor != null ? p.factor : "";
  updatePromoPreview();
}

function updatePromoPreview() {
  const enabled = $("promo-enabled").checked;
  const startMs = localInputToMs($("promo-start").value);
  const endMs = localInputToMs($("promo-end").value);
  const factor = Number($("promo-factor").value);
  const now = Date.now();
  let status, cls;
  if (!enabled) {
    status = "已关闭 · 倍率不打折";
    cls = "off";
  } else if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    status = "时间未设置";
    cls = "off";
  } else if (now >= startMs && now < endMs) {
    status = `进行中 · 当前全站 ×${Number.isFinite(factor) ? factor : "?"} 折扣`;
    cls = "on";
  } else if (now < startMs) {
    status = "未开始 · 到点后自动生效";
    cls = "pending";
  } else {
    status = "已结束 · 倍率不打折";
    cls = "off";
  }
  const el = $("promo-preview");
  el.textContent = "状态：" + status;
  el.className = "preview " + cls;
}

async function savePromo(btn) {
  const enabled = $("promo-enabled").checked;
  const startMs = localInputToMs($("promo-start").value);
  const endMs = localInputToMs($("promo-end").value);
  const factor = Number($("promo-factor").value);
  if (!Number.isFinite(factor) || factor < 0) {
    showToast("折扣系数必须是 ≥ 0 的数字（如 0.5 = 五折）", "err");
    return;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    showToast("请设置开始 / 结束时间", "err");
    return;
  }
  if (endMs <= startMs) {
    showToast("结束时间必须晚于开始时间", "err");
    return;
  }
  const session = await getSession();
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "保存中…";
  const r = await callGW(
    {
      endpoint: "admin_set_config",
      key: "promo_window",
      value: { enabled, start_ms: startMs, end_ms: endMs, factor },
    },
    session,
  );
  btn.disabled = false;
  btn.textContent = old;
  if (!r.ok) {
    showToast("保存失败：" + (r.data?.message || r.status), "err");
    return;
  }
  showToast("促销窗口已保存（≤60s 生效）", "ok");
  updatePromoPreview();
}

// ─── 默认聊天模型 ───────────────────────────────────────────
function renderDefaultModel() {
  const d = STATE.config.default_chat_model || {};
  $("default-model").value = d.id || "";
}

async function saveDefaultModel(btn) {
  const id = $("default-model").value.trim();
  if (!id) {
    showToast("请填写默认模型 ID", "err");
    return;
  }
  const session = await getSession();
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "保存中…";
  const r = await callGW(
    { endpoint: "admin_set_config", key: "default_chat_model", value: { id } },
    session,
  );
  btn.disabled = false;
  btn.textContent = old;
  if (!r.ok) {
    const msg =
      r.data?.code === "invalid_model_id"
        ? "该模型 ID 不在 SERVER_MODEL_REGISTRY 中"
        : r.data?.message || r.status;
    showToast("保存失败：" + msg, "err");
    return;
  }
  showToast("默认模型已保存（≤60s 生效）", "ok");
}

// ─── 事件绑定（静态元素，脚本加载时已在 DOM 中）───────────────
["promo-enabled", "promo-start", "promo-end", "promo-factor"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("input", updatePromoPreview);
});
$("promo-save").addEventListener("click", () => savePromo($("promo-save")));
$("default-save").addEventListener("click", () => saveDefaultModel($("default-save")));
$("reload-btn").addEventListener("click", () => loadConfig());

init();
