// admin_descriptions.html — 模型广场公开描述管理（2026-06-12）

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

let MODEL_ROWS = [];
let DESC_MAP = new Map();
let FILTER = "";

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

async function fetchPublicCatalog() {
  const resp = await fetch(GW, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: window.__SUPABASE_ANON_KEY__,
    },
    body: JSON.stringify({ endpoint: "model_public_catalog" }),
    cache: "no-store",
  });
  if (!resp.ok) throw new Error("catalog HTTP " + resp.status);
  const data = await resp.json();
  const raw = Array.isArray(data.models) ? data.models : [];
  const byCanonical = new Map();
  for (const m of raw) {
    const cid = m.canonicalId || m.id;
    if (!byCanonical.has(cid)) {
      byCanonical.set(cid, {
        id: cid,
        displayName: m.displayName || cid,
        brand: m.brand || "",
      });
    }
  }
  return Array.from(byCanonical.values()).sort((a, b) =>
    String(a.displayName).localeCompare(String(b.displayName), "zh-CN"),
  );
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
  $("desc-search").addEventListener("input", (e) => {
    FILTER = String(e.target.value || "").trim().toLowerCase();
    renderList();
  });
  $("reload-btn").addEventListener("click", () => loadAll(true));
  await loadAll(false);
}

async function loadAll(showOk) {
  const session = await getSession();
  if (!session) return;
  try {
    const [catalog, descRes] = await Promise.all([
      fetchPublicCatalog(),
      callGW({ endpoint: "admin_get_model_descriptions" }, session),
    ]);
    if (!descRes.ok) {
      showToast("描述加载失败：HTTP " + descRes.status, "err");
      return;
    }
    DESC_MAP = new Map();
    for (const row of descRes.data?.descriptions || []) {
      const id = String(row.model_id || "").trim();
      const text = String(row.description || "").trim();
      if (id && text) DESC_MAP.set(id, text);
    }
    MODEL_ROWS = catalog.map((m) => ({
      ...m,
      savedDescription: DESC_MAP.get(m.id) || "",
    }));
    renderList();
    if (showOk) showToast("已刷新", "ok");
  } catch (e) {
    showToast("加载失败：" + (e.message || e), "err");
  }
}

function rowMatches(row) {
  if (!FILTER) return true;
  const hay = [
    row.id,
    row.displayName,
    row.brand,
    row.savedDescription,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(FILTER);
}

function renderList() {
  const root = $("desc-list");
  const visible = MODEL_ROWS.filter(rowMatches);
  const configured = MODEL_ROWS.filter((r) => r.savedDescription).length;
  $("desc-stats").textContent =
    `共 ${MODEL_ROWS.length} 个模型 · 已配置 ${configured} 条 · 显示 ${visible.length}`;

  if (!visible.length) {
    root.innerHTML = '<div class="desc-empty">没有匹配的模型</div>';
    return;
  }

  root.innerHTML = visible
    .map(
      (row) => `
    <div class="desc-card${row.savedDescription ? " has-desc" : ""}" data-model-id="${esc(row.id)}">
      <div class="desc-head">
        <div class="desc-head-text">
          <div class="desc-name">${esc(row.displayName)}</div>
          <div class="desc-meta">${esc(row.brand || "—")}</div>
          <div class="desc-id">${esc(row.id)}</div>
        </div>
        ${row.savedDescription ? '<span class="desc-pill">已发布</span>' : ""}
      </div>
      <div class="desc-body">
        <textarea
          class="desc-textarea"
          data-model-id="${esc(row.id)}"
          maxlength="500"
          placeholder="填写模型广场卡片上的一行简介（1–500 字）。留空并清除 = 不展示。"
        ></textarea>
        <div class="desc-actions">
          <button class="btn-save" type="button" data-save="${esc(row.id)}">保存</button>
          <button class="btn-clear" type="button" data-clear="${esc(row.id)}">清除描述</button>
          <span class="desc-hint">保存后 ≤15s 在模型广场生效</span>
        </div>
      </div>
    </div>`,
    )
    .join("");

  root.querySelectorAll(".desc-textarea").forEach((el) => {
    const id = el.getAttribute("data-model-id");
    const row = MODEL_ROWS.find((x) => x.id === id);
    if (row) el.value = row.savedDescription || "";
  });

  root.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => saveDescription(btn.getAttribute("data-save"), btn));
  });
  root.querySelectorAll("[data-clear]").forEach((btn) => {
    btn.addEventListener("click", () => clearDescription(btn.getAttribute("data-clear"), btn));
  });
}

async function saveDescription(modelId, btn) {
  const card = btn.closest(".desc-card");
  const input = card ? card.querySelector(".desc-textarea") : null;
  if (!input) return;
  const description = String(input.value || "").trim();
  if (!description) {
    showToast("描述不能为空；若要移除请点「清除描述」", "err");
    return;
  }
  if (description.length > 500) {
    showToast("描述最多 500 字", "err");
    return;
  }
  const session = await getSession();
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "保存中…";
  const r = await callGW(
    { endpoint: "admin_set_model_description", model_id: modelId, description },
    session,
  );
  btn.disabled = false;
  btn.textContent = old;
  if (!r.ok) {
    showToast("保存失败：" + (r.data?.message || r.status), "err");
    return;
  }
  DESC_MAP.set(modelId, description);
  const row = MODEL_ROWS.find((x) => x.id === modelId);
  if (row) row.savedDescription = description;
  showToast(`已保存 ${modelId}（≤15s 生效）`, "ok");
  renderList();
}

async function clearDescription(modelId, btn) {
  if (!DESC_MAP.has(modelId)) {
    const card = btn.closest(".desc-card");
    const input = card ? card.querySelector(".desc-textarea") : null;
    if (input) input.value = "";
    showToast("该模型尚未配置描述", "err");
    return;
  }
  if (!window.confirm(`清除 ${modelId} 的广场描述？`)) return;
  const session = await getSession();
  btn.disabled = true;
  const r = await callGW(
    { endpoint: "admin_delete_model_description", model_id: modelId },
    session,
  );
  btn.disabled = false;
  if (!r.ok) {
    showToast("清除失败：" + (r.status || ""), "err");
    return;
  }
  DESC_MAP.delete(modelId);
  const row = MODEL_ROWS.find((x) => x.id === modelId);
  if (row) row.savedDescription = "";
  const card = btn.closest(".desc-card");
  const input = card ? card.querySelector(".desc-textarea") : null;
  if (input) input.value = "";
  showToast(`已清除 ${modelId}`, "ok");
  renderList();
}

init();
