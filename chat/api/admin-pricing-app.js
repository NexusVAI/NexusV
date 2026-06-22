// admin_pricing.html 逻辑（2026-06-22 按量计费）。
// 拉 live catalog 全模型 + 现价（admin_get_model_pricing），逐模型设
// 按量(token: 输入/输出 元/M)或按次(call: 元/次)，写 model_pricing（admin_set_model_pricing）。
// model_pricing 无 gateway 缓存（v3 RPC 每请求直读）→ 改价即时生效。
// 鉴权 / callGW 模式沿用 admin-models-app.js。

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

let STATE = { models: [], billingMode: "quota_v2" };

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
  setTimeout(() => t.classList.remove("show"), 2800);
}

async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
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
  $("main").style.display = "block";
  bindControls();
  await loadPricing();
}

async function loadPricing() {
  const session = await getSession();
  const r = await callGW({ endpoint: "admin_get_model_pricing" }, session);
  if (r.status === 403) { $("deny-gate").style.display = "block"; $("main").style.display = "none"; return; }
  if (!r.ok) { showToast("加载失败：HTTP " + r.status, "err"); return; }
  STATE.models = Array.isArray(r.data?.models) ? r.data.models : [];
  STATE.billingMode = r.data?.billing_mode === "wallet_v3" ? "wallet_v3" : "quota_v2";
  renderMode();
  renderTable();
}

// ─── 计费模式 ───────────────────────────────────────────────
function renderMode() {
  const pill = $("mode-pill");
  if (STATE.billingMode === "wallet_v3") {
    pill.textContent = "wallet_v3 · 按量充值";
    pill.className = "mode-pill wallet";
    $("mode-toggle").textContent = "切回 quota_v2";
  } else {
    pill.textContent = "quota_v2 · 旧订阅/积分";
    pill.className = "mode-pill quota";
    $("mode-toggle").textContent = "切到 wallet_v3";
  }
}

async function toggleMode() {
  const target = STATE.billingMode === "wallet_v3" ? "quota_v2" : "wallet_v3";
  let msg;
  if (target === "wallet_v3") {
    const unpriced = STATE.models.filter((m) => m.paid && !isReady(m)).length;
    msg = `切到 wallet_v3 将对全站启用按量计费。\n当前有 ${unpriced} 个付费模型未定价，切换后它们会返回 402 不可用。\n确认切换？`;
  } else {
    msg = "切回 quota_v2（旧订阅/积分计费）。确认？";
  }
  if (!window.confirm(msg)) return;
  const session = await getSession();
  const btn = $("mode-toggle");
  btn.disabled = true;
  const r = await callGW({ endpoint: "admin_set_billing_mode", mode: target }, session);
  btn.disabled = false;
  if (!r.ok) { showToast("切换失败：" + (r.data?.message || r.status), "err"); return; }
  STATE.billingMode = target;
  renderMode();
  showToast("已切到 " + target + "（≤60s 全量生效）", "ok");
}

// ─── 定价表 ─────────────────────────────────────────────────
function isReady(m) {
  const p = m.pricing;
  if (!p || !p.enabled) return false;
  if (p.unit === "call") return p.per_call_price != null;
  return p.input_price_per_m != null && p.output_price_per_m != null;
}

function passesFilter(m) {
  const q = ($("filter").value || "").trim().toLowerCase();
  if ($("only-paid").checked && !m.paid) return false;
  if ($("only-unpriced").checked && !(m.paid && !isReady(m))) return false;
  if (!q) return true;
  return (
    String(m.id).toLowerCase().includes(q) ||
    String(m.displayName || "").toLowerCase().includes(q) ||
    String(m.brand || "").toLowerCase().includes(q)
  );
}

function renderTable() {
  const paidCount = STATE.models.filter((m) => m.paid).length;
  const unpriced = STATE.models.filter((m) => m.paid && !isReady(m)).length;
  $("summary").innerHTML =
    `共 <b>${STATE.models.length}</b> 个模型，其中付费 <b>${paidCount}</b>，` +
    `<span class="warn">未定价 ${unpriced}</span>（付费且未正确定价 → 切到 wallet_v3 后不可用）。`;

  const rows = STATE.models.filter(passesFilter);
  const tbody = $("rows");
  tbody.innerHTML = rows.map(rowHtml).join("");
  tbody.querySelectorAll("button[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => saveRow(btn.getAttribute("data-save"), btn));
  });
}

function rowHtml(m) {
  const p = m.pricing || {};
  const defaultUnit = p.unit || (m.kind === "image" || m.kind === "video" ? "call" : "token");
  const ready = isReady(m);
  const enabled = p.enabled !== false; // 缺省视为启用（保存时填齐才真正可用）
  let statusBadge;
  if (!m.paid) statusBadge = '<span class="badge free">免费</span>';
  else if (ready) statusBadge = '<span class="badge ok">已定价</span>';
  else statusBadge = '<span class="badge unpriced">未定价</span>';

  const tierBadge = m.paid
    ? '<span class="badge paid">付费</span>'
    : '<span class="badge free">免费</span>';
  const v = (x) => (x === null || x === undefined ? "" : esc(x));
  const rowCls = (m.paid && !ready ? "row-unpriced " : "") + (!m.paid ? "is-free" : "");

  return `<tr class="${rowCls}" data-id="${esc(m.id)}">
    <td class="mid">${esc(m.displayName || m.id)}
      <div class="sub">${esc(m.id)} · ${esc(m.brand || "")}${m.kind && m.kind !== "chat" ? " · " + esc(m.kind) : ""}</div></td>
    <td>${tierBadge}</td>
    <td>
      <select class="f-unit">
        <option value="token"${defaultUnit === "token" ? " selected" : ""}>按量</option>
        <option value="call"${defaultUnit === "call" ? " selected" : ""}>按次</option>
      </select>
    </td>
    <td><input class="f-in" type="number" min="0" step="0.01" value="${v(p.input_price_per_m)}" placeholder="—" /></td>
    <td><input class="f-out" type="number" min="0" step="0.01" value="${v(p.output_price_per_m)}" placeholder="—" /></td>
    <td><input class="f-cached" type="number" min="0" step="0.05" value="${p.cached_input_factor != null ? esc(p.cached_input_factor) : "0.1"}" /></td>
    <td><input class="f-call" type="number" min="0" step="0.01" value="${v(p.per_call_price)}" placeholder="—" /></td>
    <td>${statusBadge}<label style="display:block;margin-top:3px;font-size:10.5px;color:var(--text-faint)"><input type="checkbox" class="f-enabled"${enabled ? " checked" : ""}/> 启用</label></td>
    <td><button class="btn-save" data-save="${esc(m.id)}">保存</button></td>
  </tr>`;
}

async function saveRow(modelId, btn) {
  const tr = btn.closest("tr");
  if (!tr) return;
  const unit = tr.querySelector(".f-unit").value;
  const inEl = tr.querySelector(".f-in").value.trim();
  const outEl = tr.querySelector(".f-out").value.trim();
  const cachedEl = tr.querySelector(".f-cached").value.trim();
  const callEl = tr.querySelector(".f-call").value.trim();
  const enabled = tr.querySelector(".f-enabled").checked;

  // 客户端先校验，避免无效保存（与服务端 _cancri_pricing_ready 一致）
  if (enabled) {
    if (unit === "token" && (inEl === "" || outEl === "")) {
      showToast("按量需同时填输入价与输出价（元/M）", "err");
      return;
    }
    if (unit === "call" && callEl === "") {
      showToast("按次需填每次价格（元/次）", "err");
      return;
    }
  }
  const payload = {
    endpoint: "admin_set_model_pricing",
    model_id: modelId,
    unit,
    input_price_per_m: inEl === "" ? null : Number(inEl),
    output_price_per_m: outEl === "" ? null : Number(outEl),
    per_call_price: callEl === "" ? null : Number(callEl),
    cached_input_factor: cachedEl === "" ? 0.1 : Number(cachedEl),
    enabled,
  };
  const session = await getSession();
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "保存中…";
  const r = await callGW(payload, session);
  btn.disabled = false;
  btn.textContent = old;
  if (!r.ok) { showToast("保存失败：" + (r.data?.message || r.status), "err"); return; }
  // 更新本地 state + 重渲染该行状态
  const m = STATE.models.find((x) => x.id === modelId);
  if (m) {
    m.pricing = {
      unit,
      input_price_per_m: payload.input_price_per_m,
      output_price_per_m: payload.output_price_per_m,
      per_call_price: payload.per_call_price,
      cached_input_factor: payload.cached_input_factor,
      enabled,
    };
  }
  renderTable();
  showToast("已保存 " + modelId, "ok");
}

function bindControls() {
  $("mode-toggle").addEventListener("click", toggleMode);
  $("reload-btn").addEventListener("click", loadPricing);
  $("filter").addEventListener("input", renderTable);
  $("only-paid").addEventListener("change", renderTable);
  $("only-unpriced").addEventListener("change", renderTable);
}

init().catch((e) => {
  console.error(e);
  $("loading").style.display = "none";
  showToast("初始化失败，请刷新重试", "err");
});
