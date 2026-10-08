/**
 * 团队页（team.html）共享层：接口调用 + 数据适配、格式化、DOM 工具、分段控件、成员目录、
 * 确认弹窗、toast。
 * 加载顺序：team-shared → team-usage → team-keys → team-page（都是 defer，按书写顺序执行）。
 *
 * 后端 = chat-gateway 的 team_* 端点（cf-gateway/src/team-endpoints.ts）。读只有一个
 * team_get，写操作成功后统一 T.reload() 重拉、重画 —— 不在前端维护第二份状态。
 * 适配后的形状（各视图只认这个）：
 *   {
 *     me:       { id, role: "admin" | "member" },
 *     team:     { id, name, inviteCode?(仅管理员) },
 *     settings: { usagePublic },
 *     members:  [{ id, name, role, email?(仅管理员), daily: [{ date, cost, requests, tokens }] }],
 *     announcements: [{ id, body, createdAt }],
 *     keys:     [{ id, memberId, name, preview, createdAt, lastUsedAt, calls }],
 *     usageScope: "all" | "self",
 *     wallet?:  { balance, debt, myBalance }    // 仅管理员，单位 ¥
 *   }
 *   - 成员身份：后端不下发别人的 Key / 邮箱 / 钱包；usageScope=self 时别人的 daily 全是 0。
 *     前端隐藏不是权限控制，权限在后端判。
 *   - Key 只存哈希，preview 只有前缀（cancri_sk_XXXX…）；完整 Key 只在创建时弹一次。
 *
 * 本地预览：URL 带 ?demo=1 用内存示例数据（不打接口）；再加 &as=member 看成员视角。
 */
(function () {
  "use strict";
  if (document.body.getAttribute("data-console-page") !== "team") return;

  var T = (window.CancriTeam = {});
  T.ALL_ID = "__all__";
  T.BRAND = "#E36E30";
  T.state = { data: null, memberId: T.ALL_ID };
  var QS = new URLSearchParams(location.search);
  T.DEMO = QS.get("demo") === "1";

  // ---------- 邀请码暂存 ----------
  // 未登录打开邀请链接会被送去登录页；先把邀请码记下，登录回来进团队页还能接着加入。
  var INVITE_KEY = "cancri_team_pending_invite";
  (function stashInvite() {
    var code = (QS.get("invite") || "").trim();
    if (!code) return;
    try {
      localStorage.setItem(INVITE_KEY, JSON.stringify({ code: code, at: Date.now() }));
    } catch (e) {}
  })();
  T.pendingInvite = function () {
    try {
      var v = JSON.parse(localStorage.getItem(INVITE_KEY) || "null");
      if (v && v.code && Date.now() - v.at < 7 * 86400000) return v.code;
    } catch (e) {}
    return "";
  };
  T.clearInvite = function () {
    try {
      localStorage.removeItem(INVITE_KEY);
    } catch (e) {}
    if (QS.has("invite")) {
      QS.delete("invite");
      var q = QS.toString();
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    }
  };
  T.inviteLink = function (code) {
    return location.origin + location.pathname + "?invite=" + encodeURIComponent(code);
  };

  // ---------- 接口 ----------

  var GW = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  function call(endpoint, payload) {
    return Promise.resolve(window.PlatformAuth ? window.PlatformAuth.getSession(6000) : null).then(function (s) {
      if (!s || !s.access_token) {
        var e0 = new Error("请先登录。");
        e0.code = "not_logged_in";
        throw e0;
      }
      return fetch(GW, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: window.__SUPABASE_ANON_KEY__ || "" },
        body: JSON.stringify(Object.assign({ endpoint: endpoint }, payload || {}, { __auth_token: s.access_token })),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) {
            var e = new Error(d.message || d.error || "请求失败（" + r.status + "）");
            e.code = d.code || d.error || "http_" + r.status;
            e.status = r.status;
            throw e;
          }
          return d;
        });
      });
    });
  }
  T.call = call;

  /** 用量按上海自然日聚合（与后端 cancri_team_usage_daily 同口径）。 */
  function shanghaiToday() {
    var d = new Date(Date.now() + 8 * 3600000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  /** team_get 原始响应 → 视图用的形状。 */
  T.adapt = function (raw) {
    if (!raw || !raw.team) return { team: null };
    var days = (raw.usage && raw.usage.days) || 30;
    var today = shanghaiToday();
    var dates = [];
    for (var i = days - 1; i >= 0; i--) dates.push(T.isoDate(new Date(today.getTime() - i * 86400000)));
    var byMember = {};
    ((raw.usage && raw.usage.rows) || []).forEach(function (u) {
      (byMember[u.member_id] = byMember[u.member_id] || {})[u.day] = u;
    });
    var members = (raw.members || []).map(function (m) {
      var rows = byMember[m.id] || {};
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        email: m.email || null,
        joinedAt: m.joined_at,
        daily: dates.map(function (d) {
          var u = rows[d];
          return {
            date: d,
            cost: u ? (u.charged_micro || 0) / 1e6 : 0,
            requests: u ? u.requests || 0 : 0,
            tokens: u ? u.tokens || 0 : 0,
          };
        }),
      };
    });
    var w = raw.wallet;
    return {
      me: raw.me,
      team: { id: raw.team.id, name: raw.team.name, inviteCode: raw.team.invite_code || null },
      settings: { usagePublic: !!raw.team.usage_public },
      usageScope: (raw.usage && raw.usage.scope) || "self",
      members: members,
      announcements: (raw.announcements || []).map(function (a) {
        return { id: a.id, body: a.body, createdAt: a.created_at };
      }),
      keys: (raw.keys || []).map(function (k) {
        return {
          id: k.id,
          memberId: k.member_id,
          name: k.name,
          preview: (k.key_prefix || "cancri_sk_") + "…",
          createdAt: k.created_at,
          lastUsedAt: k.last_used_at,
          calls: k.request_count || 0,
        };
      }),
      wallet: w
        ? { balance: (w.balance_micro || 0) / 1e6, debt: (w.debt_micro || 0) / 1e6, myBalance: (w.my_balance_micro || 0) / 1e6 }
        : null,
      limits: raw.limits || {},
    };
  };

  var listeners = [];
  /** 数据变化（首次加载 / 任何写操作之后）时回调，参数是新数据。 */
  T.onData = function (fn) {
    listeners.push(fn);
  };
  function setData(data) {
    T.state.data = data;
    if (data && data.members && T.state.memberId !== T.ALL_ID && !T.memberById(T.state.memberId)) {
      T.state.memberId = T.ALL_ID;
    }
    listeners.forEach(function (fn) {
      try {
        fn(data);
      } catch (e) {
        console.error(e);
      }
    });
    return data;
  }

  var dataPromise = null;
  T.ensureData = function () {
    if (!dataPromise) dataPromise = T.api.load().then(setData);
    return dataPromise;
  };
  T.reload = function () {
    dataPromise = T.api.load().then(setData);
    return dataPromise;
  };
  T.isAdmin = function () {
    return !!(T.state.data && T.state.data.me && T.state.data.me.role === "admin");
  };

  T.api = T.DEMO ? demoApi() : {
    load: function () { return call("team_get").then(T.adapt); },
    preview: function (code) { return call("team_invite_preview", { code: code }); },
    create: function (name) { return call("team_create", { name: name }); },
    join: function (code) { return call("team_join", { code: code }); },
    leave: function () { return call("team_leave"); },
    removeMember: function (id) { return call("team_remove_member", { user_id: id }); },
    dissolve: function () { return call("team_dissolve"); },
    transfer: function (amountCny) { return call("team_transfer_in", { amount_cny: amountCny }); },
    update: function (patch) { return call("team_update", patch); },
    inviteReset: function () { return call("team_invite_reset"); },
    addAnnouncement: function (body) { return call("team_announcement_add", { body: body }); },
    deleteAnnouncement: function (id) { return call("team_announcement_delete", { id: id }); },
    createKey: function (name) { return call("team_create_key", { name: name }); },
    revokeKeys: function (ids) { return call("team_revoke_keys", { key_ids: ids }); },
  };

  /** ?demo=1：内存示例数据，响应形状与真实后端一致（走同一个 adapt）。 */
  function demoApi() {
    var raw = null;
    function ok(extra) { return Promise.resolve(Object.assign({ ok: true }, extra || {})); }
    function ensure() {
      if (!raw) raw = demoRaw(30);
      return raw;
    }
    return {
      load: function () { return Promise.resolve(T.adapt(ensure())); },
      preview: function () { return Promise.resolve({ team: { name: "示例团队", member_count: 10, max_members: 50 } }); },
      create: function () { return ok(); },
      join: function () { return ok(); },
      leave: function () { return ok(); },
      removeMember: function (id) { var r = ensure(); r.members = r.members.filter(function (m) { return m.id !== id; }); return ok(); },
      dissolve: function () { return ok({ refunded_micro: 0 }); },
      transfer: function (amt) { var w = ensure().wallet; w.balance_micro += Math.round(amt * 1e6); w.my_balance_micro -= Math.round(amt * 1e6); return ok(); },
      update: function (patch) { var t = ensure().team; if (patch.name) t.name = patch.name; if (typeof patch.usage_public === "boolean") t.usage_public = patch.usage_public; return ok(); },
      inviteReset: function () { ensure().team.invite_code = "demo" + Date.now().toString(36); return ok(); },
      addAnnouncement: function (body) { ensure().announcements.unshift({ id: Date.now(), body: body, created_at: new Date().toISOString() }); return ok(); },
      deleteAnnouncement: function (id) { var r = ensure(); r.announcements = r.announcements.filter(function (a) { return a.id !== id; }); return ok(); },
      createKey: function (name) {
        var k = { id: "k" + Date.now(), name: name || "default", key_prefix: "cancri_sk_demo", member_id: ensure().me.id, created_at: new Date().toISOString(), last_used_at: null, request_count: 0 };
        ensure().keys.unshift(k);
        return ok({ key: "cancri_sk_demo_示例Key不能用于调用", key_data: k });
      },
      revokeKeys: function (ids) { var r = ensure(); r.keys = r.keys.filter(function (k) { return ids.indexOf(k.id) < 0; }); return ok({ revoked: ids }); },
    };
  }

  function demoRaw(days) {
    var rnd = mulberry32(20261007);
    var people = ["戴维", "林晓", "周子墨", "陈一凡", "王思远", "赵可", "孙蔓", "刘洋", "何青", "吴越"];
    var KEY_NAMES = ["default", "本地开发", "CI 流水线", "Cursor", "测试环境", "数据清洗脚本", "客服机器人"];
    var today = shanghaiToday();
    var now = Date.now();
    var rows = [];
    var keys = [];
    var members = people.map(function (name, idx) {
      var id = "m" + idx;
      var level = 2 + rnd() * 18;
      var active = 0.55 + rnd() * 0.4;
      var pricePerM = 1.5 + rnd() * 6;
      for (var i = days - 1; i >= 0; i--) {
        if (rnd() >= active) continue;
        var req = Math.round(level * (0.3 + rnd() * 1.6));
        var tok = req * Math.round(20000 + rnd() * 140000);
        rows.push({ member_id: id, day: T.isoDate(new Date(today.getTime() - i * 86400000)), requests: req, tokens: tok, charged_micro: Math.round((tok / 1e6) * pricePerM * 1e6) });
      }
      var nk = 1 + Math.floor(rnd() * 3);
      for (var k = 0; k < nk; k++) {
        keys.push({
          id: id + "_k" + k,
          member_id: id,
          name: KEY_NAMES[Math.floor(rnd() * KEY_NAMES.length)],
          key_prefix: "cancri_sk_" + Math.floor(rnd() * 65536).toString(16),
          created_at: new Date(now - (5 + rnd() * 120) * 86400000).toISOString(),
          last_used_at: rnd() < 0.85 ? new Date(now - rnd() * 6 * 86400000).toISOString() : null,
          request_count: Math.round(rnd() * 600),
        });
      }
      return { id: id, name: name, role: idx === 0 ? "admin" : "member", joined_at: new Date(now - idx * 86400000).toISOString() };
    });
    var asMember = QS.get("as") === "member";
    return {
      me: asMember ? { id: "m3", role: "member" } : { id: "m0", role: "admin" },
      team: { id: "demo", name: "示例团队", usage_public: false, invite_code: asMember ? undefined : "demoInviteCode00" },
      members: members,
      announcements: [{ id: 1, body: "这是示例公告", created_at: new Date().toISOString() }],
      keys: asMember ? keys.filter(function (k) { return k.member_id === "m3"; }) : keys,
      usage: { days: days, rows: asMember ? rows.filter(function (r) { return r.member_id === "m3"; }) : rows, scope: asMember ? "self" : "all" },
      wallet: asMember ? undefined : { balance_micro: 128500000, debt_micro: 0, my_balance_micro: 36200000 },
    };
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  T.memberById = function (id) {
    var list = (T.state.data && T.state.data.members) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };
  T.memberName = function (id) {
    if (id === T.ALL_ID) return "全部成员";
    var m = T.memberById(id);
    return m ? m.name : "已离开的成员";
  };
  /** 最后 days 天的合计；daily 缺省按 0 算。 */
  T.totals = function (daily, days) {
    var t = { cost: 0, requests: 0, tokens: 0 };
    (daily || []).slice(-days).forEach(function (d) {
      t.cost += d.cost || 0;
      t.requests += d.requests || 0;
      t.tokens += d.tokens || 0;
    });
    return t;
  };

  // ---------- 格式化 ----------

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }
  T.pad2 = pad2;
  T.isoDate = function (d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  };
  T.parseDate = function (s) {
    var p = s.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  };
  /** ¥ 金额：≥0.01 两位小数；更小的非零值给 4 位，免得一次调用显示成 ¥0.00。 */
  T.fmtCny = function (v) {
    v = Number(v) || 0;
    if (v !== 0 && Math.abs(v) < 0.01) return "¥" + v.toFixed(4);
    return "¥" + v.toFixed(2);
  };
  T.fmtInt = function (v) {
    return Math.round(v).toLocaleString("en-US");
  };
  T.fmtReq = function (v) {
    return T.fmtInt(v) + " 次";
  };
  function trim(n) {
    return n.toFixed(2).replace(/\.?0+$/, "");
  }
  T.fmtTokens = function (v) {
    if (v >= 1e9) return trim(v / 1e9) + "B";
    if (v >= 1e6) return trim(v / 1e6) + "M";
    if (v >= 1e3) return trim(v / 1e3) + "K";
    return String(Math.round(v));
  };
  T.fmtDate = function (iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "—" : d.getFullYear() + "/" + pad2(d.getMonth() + 1) + "/" + pad2(d.getDate());
  };
  T.fmtAgo = function (iso) {
    if (!iso) return "从未使用";
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!(s >= 0)) return "—";
    if (s < 60) return "刚刚";
    if (s < 3600) return Math.floor(s / 60) + " 分钟前";
    if (s < 86400) return Math.floor(s / 3600) + " 小时前";
    if (s < 86400 * 30) return Math.floor(s / 86400) + " 天前";
    return T.fmtDate(iso);
  };

  // ---------- DOM ----------

  T.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  var SVG_NS = "http://www.w3.org/2000/svg";
  T.svg = function (tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  var ICON_PATHS = {
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  };
  /** 线性图标，currentColor 描边，跟随主题。 */
  T.icon = function (name) {
    var span = document.createElement("span");
    span.className = "ctm-icon";
    span.setAttribute("aria-hidden", "true");
    span.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      ICON_PATHS[name] + "</svg>";
    return span;
  };

  var AVATAR_COLORS = ["#3a83f7", "#E36E30", "#10a37f", "#8b5cf6", "#e5484d", "#d97706", "#0ea5e9", "#db2777"];
  /** 成员头像：首字 + 按成员在名单里的位置取色（同一个人在各处颜色一致）。 */
  T.avatar = function (memberId, cls) {
    var av = T.el("span", "ctu-avatar" + (cls ? " " + cls : ""));
    av.setAttribute("aria-hidden", "true");
    if (memberId === T.ALL_ID) {
      av.textContent = "全";
      av.setAttribute("data-all", "true");
      return av;
    }
    var list = T.state.data.members;
    var idx = list.indexOf(T.memberById(memberId));
    var m = list[idx];
    av.textContent = m ? m.name.slice(0, 1) : "?";
    av.style.background = AVATAR_COLORS[Math.max(0, idx) % AVATAR_COLORS.length];
    return av;
  };

  T.copyText = function (text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {}
      ta.remove();
      ok ? resolve() : reject(new Error("copy_failed"));
    });
  };

  var toastTimer = 0;
  T.toast = function (msg) {
    var t = document.getElementById("ctm-toast");
    if (!t) {
      t = T.el("div", "ctm-toast");
      t.id = "ctm-toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.setAttribute("data-show", "true");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.setAttribute("data-show", "false");
    }, 1800);
  };

  /**
   * 确认弹窗。opts:
   *   title, body(string|Node), confirmText, danger,
   *   input?: { label, placeholder, value, type, maxLength, inputMode }  —— 有则 onConfirm 收到输入值
   *   validate?(value) → 出错文案 | ""           —— 不通过不发请求
   *   noCancel?: 只有一颗按钮（展示完整 Key 这类「看完就关」的场景）
   *   onConfirm(value) → Promise
   * onConfirm 失败时把错误显示在卡片里、按钮恢复，不关窗。
   */
  T.confirm = function (opts) {
    var prevFocus = document.activeElement;
    var back = T.el("div", "ctm-dialog-back");
    var card = T.el("div", "ctm-dialog");
    card.setAttribute("role", opts.danger ? "alertdialog" : "dialog");
    card.setAttribute("aria-modal", "true");
    var title = T.el("div", "ctm-dialog-title", opts.title);
    title.id = "ctm-dialog-title";
    card.setAttribute("aria-labelledby", title.id);
    var body = T.el("div", "ctm-dialog-body");
    if (typeof opts.body === "string") body.appendChild(T.el("p", "ctm-dialog-p", opts.body));
    else if (opts.body) body.appendChild(opts.body);
    var input = null;
    if (opts.input) {
      var field = T.el("label", "ctm-field");
      if (opts.input.label) field.appendChild(T.el("span", null, opts.input.label));
      input = T.el("input", "ctm-input");
      input.type = opts.input.type || "text";
      if (opts.input.placeholder) input.placeholder = opts.input.placeholder;
      if (opts.input.value != null) input.value = opts.input.value;
      if (opts.input.maxLength) input.maxLength = opts.input.maxLength;
      if (opts.input.inputMode) input.inputMode = opts.input.inputMode;
      field.appendChild(input);
      body.appendChild(field);
    }
    var err = T.el("div", "ctm-dialog-err");
    err.hidden = true;
    var foot = T.el("div", "ctm-dialog-foot");
    var cancel = T.el("button", "ctm-btn", "取消");
    cancel.type = "button";
    var ok = T.el("button", "ctm-btn" + (opts.danger ? " ctm-btn-danger" : " ctm-btn-primary"), opts.confirmText || "确定");
    ok.type = "button";
    if (!opts.noCancel) foot.appendChild(cancel);
    foot.appendChild(ok);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(err);
    card.appendChild(foot);
    back.appendChild(card);
    document.body.appendChild(back);

    function close() {
      document.removeEventListener("keydown", onKey, true);
      back.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function focusables() {
      return [input, opts.noCancel ? null : cancel, ok].filter(function (x) { return x && !x.disabled; });
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!ok.disabled) close();
      } else if (e.key === "Enter" && input && document.activeElement === input) {
        e.preventDefault();
        ok.click();
      } else if (e.key === "Tab") {
        // 焦点锁在弹窗内
        var f = focusables();
        if (!f.length) return;
        e.preventDefault();
        var i = f.indexOf(document.activeElement);
        f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    back.addEventListener("mousedown", function (e) {
      if (e.target === back && !opts.noCancel && !ok.disabled) close();
    });
    cancel.addEventListener("click", close);
    ok.addEventListener("click", function () {
      var value = input ? input.value.trim() : undefined;
      var bad = opts.validate ? opts.validate(value) : "";
      if (bad) {
        err.hidden = false;
        err.textContent = bad;
        if (input) input.focus();
        return;
      }
      var label = ok.textContent;
      ok.disabled = cancel.disabled = true;
      if (input) input.disabled = true;
      ok.textContent = "处理中…";
      Promise.resolve(opts.onConfirm && opts.onConfirm(value))
        .then(close)
        .catch(function (e) {
          ok.disabled = cancel.disabled = false;
          if (input) input.disabled = false;
          ok.textContent = label;
          err.hidden = false;
          err.textContent = (e && e.message) || String(e);
        });
    });
    (input || (opts.noCancel ? ok : cancel)).focus();
  };

  /** 新建 Key 后展示一次完整 Key（库里只存哈希，关掉就再也看不到）。 */
  T.showNewKey = function (key) {
    var box = T.el("div");
    box.appendChild(T.el("p", "ctm-dialog-p", "请立即复制保存。出于安全考虑，关闭后将无法再次查看完整 Key。调用费用从团队余额扣除。"));
    var code = T.el("code", "ctm-keybox", key);
    box.appendChild(code);
    T.confirm({
      title: "团队 Key 已创建",
      body: box,
      confirmText: "复制并关闭",
      noCancel: true,
      onConfirm: function () {
        return T.copyText(key).then(
          function () { T.toast("已复制完整 Key"); },
          function () { T.toast("复制失败，请手动选中复制"); throw new Error("复制失败，请手动选中上面的 Key 复制。"); }
        );
      },
    });
  };

  /** 接口错误 → 给人看的一句话（后端已带中文 message，这里只兜底）。 */
  T.errText = function (e) {
    return (e && e.message) || "操作失败，请稍后重试。";
  };

  /**
   * 克隆页面顶部那条页签做分段控件 —— 样式与快照完全同源，不另造一套。
   * template 是页签 group 的干净副本。返回 { host, select(i), relayout() }。
   */
  T.makeSegmented = function (labels, ariaLabel, onSelect) {
    var host = T.segTemplate.cloneNode(true);
    host.removeAttribute("id");
    host.setAttribute("aria-label", ariaLabel);
    var proto = host.querySelector("button.nCgbF");
    host.querySelectorAll("button.nCgbF").forEach(function (b) { b.remove(); });
    var thumb = host.querySelector("[data-tab-switcher-thumb]");
    var cur = 0;
    var btns = labels.map(function (label, i) {
      var b = proto.cloneNode(true);
      b.removeAttribute("id");
      b.querySelectorAll("span").forEach(function (s) { s.textContent = label; });
      b.addEventListener("click", function (e) {
        e.preventDefault();
        select(i);
        onSelect(i);
      });
      host.appendChild(b);
      return b;
    });
    function select(i) {
      cur = i;
      btns.forEach(function (b, k) {
        b.setAttribute("data-state", k === i ? "on" : "off");
        b.setAttribute("aria-checked", k === i ? "true" : "false");
      });
      relayout();
    }
    function relayout() {
      var b = btns[cur];
      if (thumb && b && b.offsetWidth) {
        thumb.style.width = b.offsetWidth + "px";
        thumb.style.transform = "translateX(" + b.offsetLeft + "px)";
      }
    }
    return { host: host, select: select, relayout: relayout };
  };

  /**
   * 右侧成员目录（团队用量 / 团队Keys 共用）。选中成员存在 T.state.memberId，
   * 两个页签之间切换时保持同一个人。
   * opts: { title, countText, allMeta, rows: [{ member, meta, share }], onPick }
   */
  T.buildDirectory = function () {
    var aside = T.el("aside", "ctu-members");
    aside.setAttribute("aria-label", "成员目录");
    var head = T.el("div", "ctu-members-head", "成员");
    var count = T.el("span");
    head.appendChild(count);
    var list = T.el("ul", "ctu-list");
    aside.appendChild(head);
    aside.appendChild(list);

    function item(id, name, role, meta, share, onPick) {
      var li = T.el("li");
      var b = T.el("button", "ctu-member");
      b.type = "button";
      b.setAttribute("aria-pressed", T.state.memberId === id ? "true" : "false");
      var txt = T.el("span", "ctu-mtext");
      var nm = T.el("span", "ctu-mname");
      nm.appendChild(T.el("span", null, name));
      if (role === "admin") nm.appendChild(T.el("span", "ctu-role", "管理员"));
      txt.appendChild(nm);
      txt.appendChild(T.el("span", "ctu-mmeta", meta));
      if (share != null) {
        var bar = T.el("span", "ctu-bar");
        var fill = T.el("i");
        fill.style.width = Math.max(share > 0 ? 2 : 0, Math.round(share * 100)) + "%";
        bar.appendChild(fill);
        txt.appendChild(bar);
      }
      b.appendChild(T.avatar(id));
      b.appendChild(txt);
      b.addEventListener("click", function () {
        T.state.memberId = id;
        onPick();
      });
      li.appendChild(b);
      return li;
    }

    function render(opts) {
      var keep = list.scrollTop;
      list.textContent = "";
      count.textContent = opts.countText;
      list.appendChild(item(T.ALL_ID, "全部成员", "", opts.allMeta, null, opts.onPick));
      opts.rows.forEach(function (r) {
        list.appendChild(item(r.member.id, r.member.name, r.member.role, r.meta, r.share, opts.onPick));
      });
      list.scrollTop = keep;
      var picked = list.querySelector('[aria-pressed="true"]');
      if (picked && !aside.closest("[hidden]")) picked.scrollIntoView({ block: "nearest" });
    }
    return { el: aside, render: render };
  };
})();
