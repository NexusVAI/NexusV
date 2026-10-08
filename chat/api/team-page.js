/**
 * 团队页总控：页签、按角色显隐、未入团（建团 / 凭邀请入团）、「团队详情」各区块、
 * 「管理」面板（团队用量 / 团队Keys / 团队余额 / 设置）。
 *
 * 页签：团队详情 / 管理（仅你可见）。快照原有的「团队用量」「团队Keys」两颗顶层页签在
 *   运行时摘掉（收进管理）。
 * 角色：
 *   管理员 — 两个页签都有；团队详情照原样显示「在这管理您的成员」（点「添加成员」出邀请链接）。
 *   成员   — 只有团队详情（页签条整个藏掉）；「在这管理您的成员」换成团队成员名单；
 *            「阅览成员用量」看设置 usagePublic：公开则看全员今日用量，否则只看自己的。
 *   两者都有「我的团队 Key」（自己建、自己吊销；费用扣团队余额）。
 * 数据：T.ensureData() 首次加载；任何写操作成功后 T.reload()，经 T.onData 统一重画。
 * URL：#manage / #manage/keys / #manage/balance / #manage/settings 直达（旧的 #usage 也认）；
 *   ?invite=<code> 是邀请链接。成员访问 #manage* 一律落回团队详情。
 * ⚠ 前端隐藏只是体验，不是权限 —— 权限与数据裁剪在后端 team-endpoints.ts。
 */
(function () {
  "use strict";
  var T = window.CancriTeam;
  if (!T) return;
  var el = T.el;

  var SUBS = [
    { hash: "usage", label: "团队用量" },
    { hash: "keys", label: "团队Keys" },
    { hash: "balance", label: "团队余额" },
    { hash: "settings", label: "设置" },
  ];
  var NOTICE_TEXT = "本通知由管理员统一设置，并非Cancri官方设置";

  function parseHash() {
    var h = location.hash.replace(/^#/, "");
    if (h === "usage") return { tab: 1, sub: 0 };
    var m = /^manage(?:\/(\w+))?$/.exec(h);
    if (!m) return { tab: 0, sub: 0 };
    var sub = 0;
    SUBS.forEach(function (s, i) {
      if (s.hash === m[1]) sub = i;
    });
    return { tab: 1, sub: sub };
  }

  /** 写操作通用收尾：成功 toast + 重拉；失败 toast。返回 promise（失败时 reject，供弹窗显示）。 */
  function act(p, okText) {
    return p.then(function (res) {
      if (okText) T.toast(typeof okText === "function" ? okText(res) : okText);
      return T.reload().then(function () { return res; });
    });
  }
  function actToast(p, okText) {
    return act(p, okText).catch(function (e) {
      T.toast(T.errText(e));
    });
  }
  function btn(text, cls) {
    var b = el("button", "ctm-btn" + (cls ? " " + cls : ""), text);
    b.type = "button";
    return b;
  }

  // ---------- 页面骨架（启动时抓一次） ----------

  var dom = {};

  function grabDom() {
    dom.host = document.querySelector('[data-tab-switcher][aria-label="团队 sections"]');
    dom.detail = document.querySelector('.oNUrP > [role="tabpanel"]');
    if (!dom.host || !dom.detail) return false;
    dom.bar = dom.host.closest(".JfaJ8") || dom.host;
    dom.content = dom.detail.querySelector(".f6oCa") || dom.detail;
    dom.h1 = document.querySelector("h1._6NWmi");
    dom.peopleSec = dom.detail.querySelector("section._-2lho");
    dom.peopleH2 = dom.peopleSec && dom.peopleSec.querySelector("h2");
    dom.peopleBox = dom.peopleSec && dom.peopleSec.querySelector(".JnYBN");
    dom.addCard = dom.peopleBox && dom.peopleBox.querySelector("a.iju-m");
    dom.annAside = dom.detail.querySelector('aside[aria-label="团队公告"]');
    dom.annList = dom.annAside && dom.annAside.querySelector("ol");
    dom.annTemplate = dom.annList && dom.annList.querySelector("li") ? dom.annList.querySelector("li").cloneNode(true) : null;
    dom.usageSec = dom.detail.querySelector("section.CqCTU");
    return true;
  }

  // 状态条（加载中 / 出错）与「未入团」面板，挂在团队详情最前面
  function statusBox() {
    if (!dom.status) {
      dom.status = el("div", "ctp-status");
      dom.detail.insertBefore(dom.status, dom.detail.firstChild);
    }
    return dom.status;
  }
  function setStatus(text, isError) {
    var s = statusBox();
    s.hidden = !text;
    s.textContent = text || "";
    s.setAttribute("data-error", isError ? "true" : "false");
  }

  // ---------- 未入团：建团 / 凭邀请入团 ----------

  function renderNoTeam() {
    dom.content.hidden = true;
    dom.bar.hidden = true;
    if (dom.panel) dom.panel.hidden = true;
    dom.detail.hidden = false;
    if (dom.h1) dom.h1.textContent = "团队";
    if (!dom.join) {
      dom.join = el("div", "ctp-join");
      dom.detail.appendChild(dom.join);
    }
    dom.join.hidden = false;
    dom.join.textContent = "";

    var code = T.pendingInvite();
    if (code) {
      var inv = el("section", "ctp-card");
      inv.appendChild(el("h2", "ctp-card-title", "你收到了一个团队邀请"));
      var line = el("p", "ctp-card-desc", "正在读取邀请信息…");
      inv.appendChild(line);
      var row = el("div", "ctp-actions");
      var joinBtn = btn("加入团队", "ctm-btn-primary");
      var skipBtn = btn("忽略");
      joinBtn.disabled = true;
      row.appendChild(joinBtn);
      row.appendChild(skipBtn);
      inv.appendChild(row);
      var err = el("p", "ctp-err");
      err.hidden = true;
      inv.appendChild(err);
      dom.join.appendChild(inv);

      T.api.preview(code).then(
        function (res) {
          var t = res.team || {};
          line.textContent = "加入「" + t.name + "」· 当前 " + t.member_count + " / " + t.max_members + " 人。加入后可以创建团队 Key，调用费用由团队余额支付。";
          joinBtn.disabled = false;
        },
        function (e) {
          line.textContent = T.errText(e);
          joinBtn.hidden = true;
          skipBtn.textContent = "知道了";
        }
      );
      joinBtn.addEventListener("click", function () {
        joinBtn.disabled = skipBtn.disabled = true;
        joinBtn.textContent = "加入中…";
        act(T.api.join(code), "已加入团队").then(
          function () { T.clearInvite(); },
          function (e) {
            joinBtn.disabled = skipBtn.disabled = false;
            joinBtn.textContent = "加入团队";
            err.hidden = false;
            err.textContent = T.errText(e);
            if (e && (e.code === "invalid_invite" || e.code === "already_in_team")) T.clearInvite();
          }
        );
      });
      skipBtn.addEventListener("click", function () {
        T.clearInvite();
        renderNoTeam();
      });
    }

    var card = el("section", "ctp-card");
    card.appendChild(el("h2", "ctp-card-title", code ? "或者，创建自己的团队" : "你还没有加入团队"));
    card.appendChild(
      el("p", "ctp-card-desc",
        "创建团队后，你是管理员：可以邀请成员、发布公告、给团队余额充值，并查看所有成员的用量与 Key。想加入别人的团队，请让对方管理员把邀请链接发给你。")
    );
    var form = el("form", "ctp-form");
    var input = el("input", "ctm-input");
    input.placeholder = "团队名称（1–40 字）";
    input.maxLength = 40;
    input.setAttribute("aria-label", "团队名称");
    var create = btn("创建团队", "ctm-btn-primary");
    create.type = "submit";
    form.appendChild(input);
    form.appendChild(create);
    var cerr = el("p", "ctp-err");
    cerr.hidden = true;
    card.appendChild(form);
    card.appendChild(cerr);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = input.value.trim();
      if (!name) {
        cerr.hidden = false;
        cerr.textContent = "请填写团队名称。";
        input.focus();
        return;
      }
      create.disabled = input.disabled = true;
      create.textContent = "创建中…";
      act(T.api.create(name), "团队已创建").catch(function (e2) {
        create.disabled = input.disabled = false;
        create.textContent = "创建团队";
        cerr.hidden = false;
        cerr.textContent = T.errText(e2);
      });
    });
    dom.join.appendChild(card);
  }

  // ---------- 团队详情 ----------

  /** 管理员：「在这管理您的成员」照原样；成员：换成团队成员名单。 */
  function renderPeople(data) {
    if (!dom.peopleSec || !dom.peopleBox) return;
    var admin = T.isAdmin();
    if (dom.peopleH2) dom.peopleH2.textContent = admin ? "在这管理您的成员" : "团队成员";
    // 不能用 hidden：快照里 .iju-m 的 display:flex 会压过 [hidden]
    Array.prototype.forEach.call(dom.peopleBox.children, function (c) {
      if (!c.classList.contains("ctd-people")) c.classList.toggle("ctd-hide", !admin);
    });
    var grid = dom.peopleBox.querySelector(".ctd-people");
    if (admin) {
      if (grid) grid.remove();
      return;
    }
    if (!grid) {
      grid = el("ul", "ctd-people");
      grid.setAttribute("aria-label", "团队成员");
      dom.peopleBox.appendChild(grid);
    }
    grid.textContent = "";
    data.members.forEach(function (m) {
      var li = el("li", "ctd-person");
      li.appendChild(T.avatar(m.id));
      li.appendChild(el("span", "ctd-person-name", m.name));
      if (m.role === "admin") li.appendChild(el("span", "ctu-role", "管理员"));
      if (m.id === data.me.id) li.appendChild(el("span", "ctu-role", "我"));
      grid.appendChild(li);
    });
  }

  /** 公告：沿用快照里那条时间线的样式；没有公告显示斜体「暂无内容」。 */
  function renderAnnouncements(data) {
    if (!dom.annList) return;
    if (dom.annAside) dom.annAside.hidden = false;
    dom.annList.textContent = "";
    if (!data.announcements.length) {
      var li0 = el("li", "ctd-ann-empty");
      li0.appendChild(el("em", null, "暂无内容"));
      dom.annList.appendChild(li0);
      return;
    }
    data.announcements.forEach(function (a) {
      var li = dom.annTemplate ? dom.annTemplate.cloneNode(true) : el("li", "oKL42");
      var title = li.querySelector(".BHwtp");
      var sub = li.querySelector(".l8Zzw");
      if (title) title.textContent = a.body;
      else li.appendChild(el("span", "BHwtp", a.body));
      if (sub) sub.textContent = NOTICE_TEXT + " · " + T.fmtDate(a.createdAt);
      dom.annList.appendChild(li);
    });
  }

  function todayText(m) {
    var t = T.totals(m.daily, 1);
    return "今日用量:" + T.fmtCny(t.cost) + " 请求" + T.fmtInt(t.requests) + "次 " + T.fmtTokens(t.tokens) + " Tokens";
  }

  /** 「阅览成员用量」：管理员或已公开 → 全员今日用量；否则只看自己。 */
  function renderUsageCards(data) {
    var sec = dom.usageSec;
    if (!sec) return;
    var admin = T.isAdmin();
    var all = admin || data.usageScope === "all";
    var h2 = sec.querySelector("h2");
    if (h2) h2.textContent = all ? "阅览成员用量" : "我的用量";
    var note = sec.querySelector(".ctd-note");
    if (!note) {
      note = el("p", "ctd-note");
      if (h2) h2.after(note);
    }
    note.textContent = admin
      ? data.settings.usagePublic
        ? "成员也能看到这份用量（可在 管理 → 设置 里关闭）· 只统计团队 Key 的调用"
        : "仅你可见；成员只能看到自己的用量（可在 管理 → 设置 里公开）· 只统计团队 Key 的调用"
      : all
        ? "管理员已向成员公开团队用量 · 只统计团队 Key 的调用"
        : "管理员未公开团队用量，这里只显示你自己的 · 只统计团队 Key 的调用";

    var ul = sec.querySelector('ul[aria-label="成员用量"]');
    if (!ul) return;
    ul.textContent = "";
    var me = T.memberById(data.me.id);
    var list = all ? data.members : me ? [me] : [];
    list.forEach(function (m) {
      var li = el("li");
      var card = el(admin ? "a" : "div", "iju-m dKS3q");
      if (admin) {
        card.href = "#manage/usage";
        card.addEventListener("click", function (e) {
          e.preventDefault();
          T.state.memberId = m.id;
          if (dom.goManage) dom.goManage(0);
        });
      }
      var top = el("span", "wxJo4");
      top.appendChild(T.avatar(m.id));
      card.appendChild(top);
      var txt = el("span", "lGYLo");
      txt.appendChild(el("span", "IzJw4", m.id === data.me.id && !admin ? m.name + "（我）" : m.name));
      var sub = todayText(m);
      if (!all) {
        var t30 = T.totals(m.daily, 30);
        sub += " · 近30天 " + T.fmtCny(t30.cost) + " 请求" + T.fmtInt(t30.requests) + "次";
      }
      txt.appendChild(el("span", "_-4I3z", sub));
      card.appendChild(txt);
      li.appendChild(card);
      ul.appendChild(li);
    });
  }

  /** 「我的团队 Key」：只列自己建的；新建后弹一次完整 Key。 */
  function renderMyKeys(data) {
    if (!dom.myKeys) {
      var sec = el("section", "CqCTU ctd-mykeys");
      sec.setAttribute("aria-label", "我的团队 Key");
      var head = el("div", "ctd-sec-head");
      head.appendChild(el("h2", "ntm4O", "我的团队 Key"));
      var add = btn("新建团队 Key", "ctm-btn-primary ctm-btn-sm");
      add.addEventListener("click", createKeyDialog);
      head.appendChild(add);
      sec.appendChild(head);
      sec.appendChild(el("p", "ctd-note", "用团队 Key 调用 API，费用从团队余额扣除，用量计入团队统计。完整 Key 只在创建时显示一次。"));
      var ul = el("ul", "ctd-keylist");
      sec.appendChild(ul);
      dom.myKeys = { sec: sec, ul: ul, add: add };
      dom.content.appendChild(sec);
    }
    var mine = data.keys.filter(function (k) { return k.memberId === data.me.id; });
    var max = (data.limits && data.limits.max_keys_per_member) || 5;
    dom.myKeys.add.disabled = mine.length >= max;
    dom.myKeys.add.title = mine.length >= max ? "每人最多 " + max + " 个团队 Key" : "";
    var ul2 = dom.myKeys.ul;
    ul2.textContent = "";
    if (!mine.length) {
      ul2.appendChild(el("li", "ctd-keys-empty", "你还没有团队 Key。"));
      return;
    }
    mine.forEach(function (k) {
      var li = el("li", "ctd-keyrow");
      var main = el("div", "ctk-main");
      main.appendChild(el("div", "ctk-name", k.name));
      main.appendChild(el("div", "ctk-meta", "创建于 " + T.fmtDate(k.createdAt) + " · 最近使用 " + T.fmtAgo(k.lastUsedAt) + " · 累计 " + T.fmtInt(k.calls) + " 次"));
      li.appendChild(main);
      li.appendChild(el("code", "ctk-key", k.preview));
      var del = el("button", "ctk-icon-btn ctk-danger");
      del.type = "button";
      del.title = del.ariaLabel = "吊销 Key";
      del.setAttribute("aria-label", "吊销 Key");
      del.appendChild(T.icon("trash"));
      del.addEventListener("click", function () {
        T.confirmRevokeKeys([k]);
      });
      li.appendChild(del);
      ul2.appendChild(li);
    });
  }

  function createKeyDialog() {
    T.confirm({
      title: "新建团队 Key",
      body: "给这把 Key 起个名字，方便以后辨认（比如「本地开发」「CI」）。",
      input: { label: "Key 名称", placeholder: "default", maxLength: 60 },
      confirmText: "创建",
      onConfirm: function (name) {
        return T.api.createKey(name || "default").then(function (res) {
          return T.reload().then(function () {
            setTimeout(function () { T.showNewKey(res.key); }, 0);
          });
        });
      },
    });
  }

  /** 成员底部的「退出团队」。管理员不显示（管理员只能解散）。 */
  function renderLeave(data) {
    if (!dom.leave) {
      dom.leave = el("div", "ctd-leave");
      var b = btn("退出团队", "ctm-btn-sm ctm-btn-ghost-danger");
      b.addEventListener("click", function () {
        T.confirm({
          title: "退出「" + T.state.data.team.name + "」？",
          body: "退出后，你创建的团队 Key 会立即被吊销；之后需要管理员重新邀请才能回来。",
          confirmText: "退出团队",
          danger: true,
          onConfirm: function () {
            return act(T.api.leave(), "已退出团队");
          },
        });
      });
      dom.leave.appendChild(b);
      dom.content.appendChild(dom.leave);
    }
    dom.leave.hidden = data.me.role === "admin";
  }

  // ---------- 邀请弹窗（管理员点「添加成员」 / 设置页） ----------

  function inviteDialog() {
    var data = T.state.data;
    var box = el("div");
    box.appendChild(el("p", "ctm-dialog-p", "把下面的链接发给要加入的人。对方登录后打开链接即可加入（当前 " + data.members.length + " / " + ((data.limits && data.limits.max_members) || 50) + " 人）。"));
    var code = el("code", "ctm-keybox", data.team.inviteCode ? T.inviteLink(data.team.inviteCode) : "邀请链接未生成");
    box.appendChild(code);
    var reset = el("button", "ctm-linkbtn", "重置链接（旧链接立即失效）");
    reset.type = "button";
    reset.addEventListener("click", function () {
      reset.disabled = true;
      T.api.inviteReset().then(
        function (res) {
          code.textContent = T.inviteLink(res.invite_code);
          reset.disabled = false;
          T.toast("邀请链接已重置");
          T.reload();
        },
        function (e) {
          reset.disabled = false;
          T.toast(T.errText(e));
        }
      );
    });
    box.appendChild(reset);
    T.confirm({
      title: "邀请成员",
      body: box,
      confirmText: "复制链接",
      onConfirm: function () {
        return T.copyText(code.textContent).then(function () { T.toast("邀请链接已复制"); });
      },
    });
  }

  // ---------- 管理 → 团队余额 ----------

  function createBalanceView() {
    var root = el("div", "ctu");
    var head = el("div", "ctu-head");
    var title = el("div", "ctu-title");
    title.appendChild(el("h2", null, "团队余额"));
    title.appendChild(el("p", "ctu-sub", "团队 Key 的每次调用都从这里扣费"));
    head.appendChild(title);
    root.appendChild(head);

    var card = el("section", "ctm-settings");
    var r1 = el("div", "ctm-setting");
    var t1 = el("div", "ctm-setting-text");
    t1.appendChild(el("div", "ctm-setting-title", "团队余额"));
    var bal = el("div", "ctb-amount");
    t1.appendChild(bal);
    var debt = el("div", "ctm-setting-desc ctb-debt");
    t1.appendChild(debt);
    r1.appendChild(t1);
    card.appendChild(r1);

    var r2 = el("div", "ctm-setting");
    var t2 = el("div", "ctm-setting-text");
    t2.appendChild(el("div", "ctm-setting-title", "从我的个人余额划转"));
    var mine = el("div", "ctm-setting-desc");
    t2.appendChild(mine);
    r2.appendChild(t2);
    var go = btn("划转到团队", "ctm-btn-primary");
    r2.appendChild(go);
    card.appendChild(r2);
    root.appendChild(card);
    root.appendChild(el("p", "ctd-note ctb-foot", "划转是单向的，每次 ¥1 – ¥10,000。解散团队时，剩余团队余额（扣除欠费后）会退回管理员的个人余额。"));

    go.addEventListener("click", function () {
      var w = T.state.data.wallet || {};
      T.confirm({
        title: "划转到团队余额",
        body: "当前个人余额 " + T.fmtCny(w.myBalance || 0) + "。",
        input: { label: "划转金额（¥）", placeholder: "例如 50", inputMode: "decimal", maxLength: 10 },
        confirmText: "确认划转",
        validate: function (v) {
          var n = Number(v);
          if (!v || !isFinite(n) || n <= 0) return "请输入金额。";
          if (Math.round(n * 100) / 100 !== n) return "金额最多两位小数。";
          if (n < 1 || n > 10000) return "每次划转 ¥1 – ¥10,000。";
          if (n > (w.myBalance || 0)) return "个人余额不足。";
          return "";
        },
        onConfirm: function (v) {
          return act(T.api.transfer(Number(v)), "已划转 " + T.fmtCny(Number(v)) + " 到团队");
        },
      });
    });

    function show() {
      var w = T.state.data.wallet || { balance: 0, debt: 0, myBalance: 0 };
      bal.textContent = T.fmtCny(w.balance);
      debt.hidden = !(w.debt > 0);
      debt.textContent = "欠费 " + T.fmtCny(w.debt) + "（下次划转会先抵扣）";
      mine.textContent = "你的个人余额 " + T.fmtCny(w.myBalance);
      go.disabled = !(w.myBalance >= 1);
    }
    return { el: root, show: show };
  }

  // ---------- 管理 → 设置 ----------

  function settingCard(titleText) {
    var card = el("section", "ctm-settings");
    card.setAttribute("aria-label", titleText);
    var h = el("div", "ctm-card-head", titleText);
    card.appendChild(h);
    return { card: card, head: h };
  }
  function settingRow(title, desc) {
    var row = el("div", "ctm-setting");
    var text = el("div", "ctm-setting-text");
    text.appendChild(el("div", "ctm-setting-title", title));
    if (desc) text.appendChild(el("div", "ctm-setting-desc", desc));
    row.appendChild(text);
    return { row: row, text: text };
  }

  function createSettingsView() {
    var root = el("div", "ctu");
    var head = el("div", "ctu-head");
    var title = el("div", "ctu-title");
    title.appendChild(el("h2", null, "设置"));
    title.appendChild(el("p", "ctu-sub", "这些设置只有管理员能改"));
    head.appendChild(title);
    root.appendChild(head);

    // 基本
    var basic = settingCard("基本");
    var nameRow = settingRow("团队名称");
    var nameForm = el("form", "ctp-form ctm-inline-form");
    var nameInput = el("input", "ctm-input");
    nameInput.maxLength = 40;
    nameInput.setAttribute("aria-label", "团队名称");
    var nameSave = btn("保存", "ctm-btn-sm");
    nameSave.type = "submit";
    nameForm.appendChild(nameInput);
    nameForm.appendChild(nameSave);
    nameRow.row.appendChild(nameForm);
    nameForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = nameInput.value.trim();
      if (!v || v === T.state.data.team.name) return;
      nameSave.disabled = true;
      actToast(T.api.update({ name: v }), "团队名称已更新").then(function () { nameSave.disabled = false; });
    });
    basic.card.appendChild(nameRow.row);

    var pubRow = settingRow("向成员公开团队用量", "开启后，成员在「团队详情」能看到所有成员的今日用量；关闭时只看得到自己的。团队Keys 与团队余额始终只有管理员可见。");
    var sw = el("button", "ctm-switch");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-label", "向成员公开团队用量");
    sw.appendChild(el("span", "ctm-switch-knob"));
    pubRow.row.appendChild(sw);
    sw.addEventListener("click", function () {
      var next = !T.state.data.settings.usagePublic;
      sw.disabled = true;
      actToast(T.api.update({ usage_public: next }), next ? "已向成员公开团队用量" : "已关闭，成员只能看到自己的用量").then(function () {
        sw.disabled = false;
      });
    });
    basic.card.appendChild(pubRow.row);
    root.appendChild(basic.card);

    // 邀请
    var invite = settingCard("邀请成员");
    var invRow = settingRow("邀请链接", "");
    var invCode = el("code", "ctm-keybox ctm-keybox-inline");
    invRow.text.appendChild(invCode);
    var invBtns = el("div", "ctp-actions");
    var invCopy = btn("复制", "ctm-btn-sm");
    var invReset = btn("重置", "ctm-btn-sm");
    invBtns.appendChild(invCopy);
    invBtns.appendChild(invReset);
    invRow.row.appendChild(invBtns);
    invCopy.addEventListener("click", function () {
      T.copyText(invCode.textContent).then(function () { T.toast("邀请链接已复制"); }, function () { T.toast("复制失败，请手动选中复制"); });
    });
    invReset.addEventListener("click", function () {
      T.confirm({
        title: "重置邀请链接？",
        body: "旧链接会立即失效，已经加入的成员不受影响。",
        confirmText: "重置",
        onConfirm: function () { return act(T.api.inviteReset(), "邀请链接已重置"); },
      });
    });
    invite.card.appendChild(invRow.row);
    root.appendChild(invite.card);

    // 公告
    var ann = settingCard("公告");
    var annList = el("ul", "ctm-list");
    ann.card.appendChild(annList);
    var annForm = el("form", "ctp-form ctm-add-form");
    var annInput = el("input", "ctm-input");
    annInput.maxLength = 200;
    annInput.placeholder = "写一条公告，成员会在「团队详情」右侧看到（最多 200 字）";
    annInput.setAttribute("aria-label", "新公告");
    var annAdd = btn("发布", "ctm-btn-primary ctm-btn-sm");
    annAdd.type = "submit";
    annForm.appendChild(annInput);
    annForm.appendChild(annAdd);
    ann.card.appendChild(annForm);
    annForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = annInput.value.trim();
      if (!v) return;
      annAdd.disabled = annInput.disabled = true;
      act(T.api.addAnnouncement(v), "公告已发布").then(
        function () { annInput.value = ""; annAdd.disabled = annInput.disabled = false; },
        function (e2) { annAdd.disabled = annInput.disabled = false; T.toast(T.errText(e2)); }
      );
    });
    root.appendChild(ann.card);

    // 成员
    var mem = settingCard("成员");
    var memList = el("ul", "ctm-list");
    mem.card.appendChild(memList);
    root.appendChild(mem.card);

    // 危险操作
    var danger = settingCard("危险操作");
    danger.card.classList.add("ctm-danger-zone");
    var dRow = settingRow("解散团队", "所有成员被移出、全部团队 Key 立即吊销；剩余团队余额（扣除欠费后）退回你的个人余额。无法撤销。");
    var dBtn = btn("解散团队", "ctm-btn-danger ctm-btn-sm");
    dRow.row.appendChild(dBtn);
    danger.card.appendChild(dRow.row);
    root.appendChild(danger.card);
    dBtn.addEventListener("click", function () {
      var name = T.state.data.team.name;
      T.confirm({
        title: "解散「" + name + "」？",
        body: "请输入团队名称确认。若还有进行中的请求，会提示稍后再试。",
        input: { label: "团队名称", placeholder: name },
        confirmText: "解散团队",
        danger: true,
        validate: function (v) { return v === name ? "" : "团队名称不一致。"; },
        onConfirm: function () {
          return act(T.api.dissolve(), function (res) {
            var r = (res && res.refunded_micro) || 0;
            return r > 0 ? "团队已解散，" + T.fmtCny(r / 1e6) + " 已退回你的个人余额" : "团队已解散";
          });
        },
      });
    });

    function show() {
      var data = T.state.data;
      if (document.activeElement !== nameInput) nameInput.value = data.team.name;
      sw.setAttribute("aria-checked", data.settings.usagePublic ? "true" : "false");
      invCode.textContent = data.team.inviteCode ? T.inviteLink(data.team.inviteCode) : "—";

      var maxAnn = (data.limits && data.limits.max_announcements) || 10;
      ann.head.textContent = "公告（" + data.announcements.length + " / " + maxAnn + "）";
      annAdd.disabled = data.announcements.length >= maxAnn;
      annList.textContent = "";
      if (!data.announcements.length) annList.appendChild(el("li", "ctm-list-empty", "还没有公告。"));
      data.announcements.forEach(function (a) {
        var li = el("li", "ctm-list-row");
        var t = el("div", "ctm-setting-text");
        t.appendChild(el("div", "ctm-setting-title ctm-wrap", a.body));
        t.appendChild(el("div", "ctm-setting-desc", T.fmtDate(a.createdAt)));
        li.appendChild(t);
        var d = btn("删除", "ctm-btn-sm");
        d.addEventListener("click", function () {
          d.disabled = true;
          actToast(T.api.deleteAnnouncement(a.id), "公告已删除");
        });
        li.appendChild(d);
        annList.appendChild(li);
      });

      var maxMem = (data.limits && data.limits.max_members) || 50;
      mem.head.textContent = "成员（" + data.members.length + " / " + maxMem + "）";
      memList.textContent = "";
      data.members.forEach(function (m) {
        var li = el("li", "ctm-list-row");
        li.appendChild(T.avatar(m.id));
        var t = el("div", "ctm-setting-text");
        var nm = el("div", "ctu-mname");
        nm.appendChild(el("span", null, m.name));
        if (m.role === "admin") nm.appendChild(el("span", "ctu-role", "管理员"));
        t.appendChild(nm);
        t.appendChild(el("div", "ctm-setting-desc", (m.email ? m.email + " · " : "") + "加入于 " + T.fmtDate(m.joinedAt)));
        li.appendChild(t);
        if (m.role !== "admin") {
          var rm = btn("移除", "ctm-btn-sm");
          rm.addEventListener("click", function () {
            T.confirm({
              title: "移除「" + m.name + "」？",
              body: "对方创建的团队 Key 会立即吊销。之后需要重新邀请才能加入。",
              confirmText: "移除",
              danger: true,
              onConfirm: function () { return act(T.api.removeMember(m.id), "已移除 " + m.name); },
            });
          });
          li.appendChild(rm);
        }
        memList.appendChild(li);
      });
    }
    return { el: root, show: show };
  }

  // ---------- 管理面板 ----------

  var mgr = null;

  function buildManage() {
    var panel = el("div");
    panel.id = "cnc-team-manage-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-label", "管理（仅你可见）");
    panel.hidden = true;
    var wrap = el("div", "ctm");
    var mhead = el("div", "ctm-head");
    var views = [];
    var holders = SUBS.map(function () {
      var h = el("div");
      h.hidden = true;
      return h;
    });
    var subSeg = T.makeSegmented(SUBS.map(function (s) { return s.label; }), "管理", function (i) {
      showSub(i);
    });
    mhead.appendChild(subSeg.host);
    if (T.DEMO) mhead.appendChild(el("span", "ctu-demo", "示例数据"));
    wrap.appendChild(mhead);
    holders.forEach(function (h) { wrap.appendChild(h); });
    panel.appendChild(wrap);
    dom.detail.after(panel);
    dom.panel = panel;

    var state = { tab: 0, sub: 0 };
    function view(i) {
      if (!views[i]) {
        views[i] =
          i === 0 ? T.createUsageView()
          : i === 1 ? T.createKeysView()
          : i === 2 ? createBalanceView()
          : createSettingsView();
        holders[i].appendChild(views[i].el);
      }
      return views[i];
    }
    function showSub(i, fromHash) {
      state.sub = i;
      holders.forEach(function (h, k) { h.hidden = k !== i; });
      subSeg.select(i);
      if (!fromHash) history.replaceState(null, "", location.pathname + location.search + "#manage/" + SUBS[i].hash);
      view(i).show();
    }
    function selectTab(i, sub, fromHash) {
      state.tab = i;
      var tabs = mgr.tabs;
      tabs.forEach(function (b, k) {
        b.setAttribute("data-state", k === i ? "on" : "off");
        b.setAttribute("aria-checked", k === i ? "true" : "false");
      });
      if (mgr.thumb && tabs[i]) {
        mgr.thumb.style.width = tabs[i].offsetWidth + "px";
        mgr.thumb.style.transform = "translateX(" + tabs[i].offsetLeft + "px)";
      }
      dom.detail.hidden = i !== 0;
      panel.hidden = i !== 1;
      if (i === 1) showSub(sub == null ? state.sub : sub, fromHash);
      else if (!fromHash) history.replaceState(null, "", location.pathname + location.search);
    }
    return {
      panel: panel,
      selectTab: selectTab,
      /** 数据刷新后只重画当前看得见的那个子页。 */
      refresh: function () {
        if (state.tab === 1 && views[state.sub]) views[state.sub].show();
      },
      relayout: function () { subSeg.relayout(); },
      tabs: null,
      thumb: null,
    };
  }

  // ---------- 渲染入口 ----------

  function render(data) {
    setStatus("");
    if (!data || !data.team) {
      renderNoTeam();
      return;
    }
    if (dom.join) dom.join.hidden = true;
    dom.content.hidden = false;
    if (dom.h1) dom.h1.textContent = "团队 · " + data.team.name;

    // 已在团队里还带着邀请：忽略并提示一次
    var pending = T.pendingInvite();
    if (pending) {
      T.clearInvite();
      T.toast("你已经在团队「" + data.team.name + "」中，邀请链接已忽略");
    }

    var admin = data.me.role === "admin";
    renderPeople(data);
    renderAnnouncements(data);
    renderUsageCards(data);
    renderMyKeys(data);
    renderLeave(data);

    if (!admin) {
      dom.bar.hidden = true;
      if (mgr) mgr.panel.hidden = true;
      dom.detail.hidden = false;
      if (/^#(manage|usage)/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    dom.bar.hidden = false;
    dom.host.style.visibility = "";
    if (!mgr) {
      mgr = buildManage();
      mgr.tabs = dom.tabs;
      mgr.thumb = dom.thumb;
      dom.goManage = function (sub) { mgr.selectTab(1, sub); };
      var r = parseHash();
      mgr.selectTab(r.tab, r.sub, true);
    } else {
      mgr.refresh();
    }
  }

  function boot() {
    if (!grabDom() || dom.host.dataset.cncTeamWired === "1") return;
    dom.host.dataset.cncTeamWired = "1";
    var btns = Array.prototype.slice.call(dom.host.querySelectorAll("button.nCgbF"));
    if (btns.length < 4) return;

    // 分段控件模板先从原始页签克隆，再动原页签
    T.segTemplate = dom.host.cloneNode(true);
    T.segTemplate.removeAttribute("data-cnc-team-wired");
    // 角色确定之前不露页签与快照里的示例内容
    dom.host.style.visibility = "hidden";
    dom.content.hidden = true;
    btns[1].remove();
    btns[2].remove();
    dom.tabs = [btns[0], btns[3]];
    dom.thumb = dom.host.querySelector("[data-tab-switcher-thumb]");
    dom.tabs.forEach(function (b, i) {
      b.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (mgr) mgr.selectTab(i);
        },
        true
      );
    });
    if (dom.addCard) {
      dom.addCard.addEventListener("click", function (e) {
        e.preventDefault();
        if (T.isAdmin()) inviteDialog();
      });
    }
    window.addEventListener("hashchange", function () {
      if (!mgr || !T.isAdmin()) return;
      var r = parseHash();
      mgr.selectTab(r.tab, r.sub, true);
    });
    window.addEventListener("resize", function () {
      if (mgr) mgr.relayout();
    });

    setStatus("正在加载团队信息…");
    T.onData(render);
    T.ensureData().catch(function (e) {
      setStatus(
        e && e.code === "not_logged_in" ? "请先登录后再查看团队。" : "团队信息加载失败：" + T.errText(e) + "（刷新页面重试）",
        true
      );
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
