/**
 * 管理 → 团队Keys。左边可滚动的 Key 条（默认打码，眼睛显示、复制、吊销、多选批量吊销），
 * 右边成员目录筛选。由 team-page.js 调 CancriTeam.createKeysView() 建；依赖 team-shared.js。
 *
 * 眼睛显示的是 key.secret（后端愿意下发时）否则 key.preview（cancri_sk_前4…后4）。
 * 现有 Key 只存哈希，完整 Key 只在创建那一刻出现一次 —— 这是有意的安全设计，别为了
 * 「能看完整 Key」去存明文。说明见 team-shared.js 顶部。
 */
(function () {
  "use strict";
  var T = window.CancriTeam;
  if (!T) return;

  var MASK = "cancri_sk_" + new Array(17).join("•");

  /**
   * 吊销确认 + 调接口 + 重拉数据。团队Keys 页与「我的团队 Key」共用。
   * after(revokedIds) 在重拉之前调，用来清掉调用方自己的勾选 / 显示状态。
   */
  T.confirmRevokeKeys = function (keys, after) {
    var el = T.el;
    var bodyEl = el("div");
    bodyEl.appendChild(
      el("p", "ctm-dialog-p", "吊销后，使用这些 Key 的请求会立即失败，且无法恢复，需要重新创建 Key。")
    );
    var ul = el("ul", "ctm-dialog-list");
    keys.slice(0, 6).forEach(function (k) {
      var li = el("li");
      li.appendChild(el("span", null, k.name + " · " + T.memberName(k.memberId)));
      li.appendChild(el("code", null, k.preview));
      ul.appendChild(li);
    });
    if (keys.length > 6) ul.appendChild(el("li", "ctm-dialog-more", "以及另外 " + (keys.length - 6) + " 个"));
    bodyEl.appendChild(ul);
    T.confirm({
      title: keys.length === 1 ? "吊销 Key「" + keys[0].name + "」？" : "吊销所选的 " + keys.length + " 个 Key？",
      body: bodyEl,
      confirmText: "吊销",
      danger: true,
      onConfirm: function () {
        var ids = keys.map(function (k) { return k.id; });
        return T.api.revokeKeys(ids).then(function (res) {
          var revoked = (res && res.revoked) || ids;
          if (after) after(revoked);
          T.toast("已吊销 " + revoked.length + " 个 Key");
          return T.reload();
        });
      },
    });
  };

  T.createKeysView = function () {
    var el = T.el;
    var revealed = {};
    var selected = {};
    var ui = {};

    var root = el("div", "ctu");
    var head = el("div", "ctu-head");
    var title = el("div", "ctu-title");
    title.appendChild(el("h2", null, "团队Keys"));
    ui.sub = el("p", "ctu-sub");
    title.appendChild(ui.sub);
    head.appendChild(title);

    var body = el("div", "ctu-body");
    var card = el("section", "ctu-card");
    card.setAttribute("aria-label", "Key 列表");

    var bar = el("div", "ctk-toolbar");
    var allLabel = el("label", "ctk-check");
    ui.all = el("input");
    ui.all.type = "checkbox";
    ui.all.setAttribute("aria-label", "全选当前列表");
    allLabel.appendChild(ui.all);
    ui.count = el("span", "ctk-count");
    ui.selActions = el("div", "ctk-sel-actions");
    var clearBtn = el("button", "ctm-btn ctm-btn-sm", "取消选择");
    clearBtn.type = "button";
    ui.bulkBtn = el("button", "ctm-btn ctm-btn-sm ctm-btn-danger");
    ui.bulkBtn.type = "button";
    ui.selActions.appendChild(clearBtn);
    ui.selActions.appendChild(ui.bulkBtn);
    bar.appendChild(allLabel);
    bar.appendChild(ui.count);
    bar.appendChild(ui.selActions);

    ui.list = el("ul", "ctk-list");
    ui.list.setAttribute("aria-label", "Key");
    card.appendChild(bar);
    card.appendChild(ui.list);

    var dir = T.buildDirectory();
    body.appendChild(card);
    body.appendChild(dir.el);
    root.appendChild(head);
    root.appendChild(body);

    ui.all.addEventListener("change", function () {
      visibleKeys().forEach(function (k) {
        if (ui.all.checked) selected[k.id] = true;
        else delete selected[k.id];
      });
      renderList();
    });
    clearBtn.addEventListener("click", function () {
      selected = {};
      renderList();
    });
    ui.bulkBtn.addEventListener("click", function () {
      var keys = visibleKeys().filter(function (k) { return selected[k.id]; });
      if (keys.length) confirmRevoke(keys);
    });

    // ---------- 数据 ----------

    function allKeys() {
      return (T.state.data && T.state.data.keys) || [];
    }
    function visibleKeys() {
      var id = T.state.memberId;
      return allKeys()
        .filter(function (k) { return id === T.ALL_ID || k.memberId === id; })
        .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    }
    function selectedCount() {
      return visibleKeys().filter(function (k) { return selected[k.id]; }).length;
    }

    // ---------- 渲染 ----------

    function render() {
      if (!T.state.data) return;
      var keys = allKeys();
      var byMember = {};
      keys.forEach(function (k) {
        var b = (byMember[k.memberId] = byMember[k.memberId] || { n: 0, last: null });
        b.n++;
        if (k.lastUsedAt && (!b.last || k.lastUsedAt > b.last)) b.last = k.lastUsedAt;
      });
      var rows = T.state.data.members.map(function (m) {
        return { member: m, b: byMember[m.id] || { n: 0, last: null } };
      });
      rows.sort(function (a, b) { return b.b.n - a.b.n; });
      var maxN = rows.length ? rows[0].b.n : 0;
      dir.render({
        countText: rows.length + " 人",
        allMeta: keys.length + " 个 Key",
        rows: rows.map(function (r) {
          return {
            member: r.member,
            meta: r.b.n + " 个 Key · " + (r.b.n ? "最近使用 " + T.fmtAgo(r.b.last) : "暂无"),
            share: maxN > 0 ? r.b.n / maxN : 0,
          };
        }),
        onPick: function () {
          // 换了筛选就清空勾选：不让「看不见的 Key」被批量吊销带走
          selected = {};
          render();
        },
      });
      renderList();
    }

    function renderList() {
      var keys = visibleKeys();
      ui.sub.textContent =
        T.memberName(T.state.memberId) + " · " + keys.length + " 个 Key · 完整 Key 只在创建时显示一次";
      var keep = ui.list.scrollTop;
      ui.list.textContent = "";
      if (!keys.length) {
        var empty = el("li", "ctk-empty", "该成员还没有团队 Key");
        ui.list.appendChild(empty);
      }
      keys.forEach(function (k) {
        ui.list.appendChild(row(k));
      });
      ui.list.scrollTop = keep;

      var n = selectedCount();
      ui.all.checked = keys.length > 0 && n === keys.length;
      ui.all.indeterminate = n > 0 && n < keys.length;
      ui.all.disabled = !keys.length;
      ui.count.textContent = n ? "已选 " + n + " 个" : "全选";
      ui.selActions.hidden = !n;
      ui.bulkBtn.textContent = "吊销所选（" + n + "）";
    }

    function row(k) {
      var li = el("li", "ctk-row");
      li.setAttribute("data-selected", selected[k.id] ? "true" : "false");

      var check = el("label", "ctk-check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!selected[k.id];
      cb.setAttribute("aria-label", "选择 " + k.name);
      cb.addEventListener("change", function () {
        if (cb.checked) selected[k.id] = true;
        else delete selected[k.id];
        renderList();
      });
      check.appendChild(cb);

      var main = el("div", "ctk-main");
      var nameLine = el("div", "ctk-name");
      nameLine.appendChild(el("span", "ctk-name-text", k.name));
      var owner = el("span", "ctk-owner");
      owner.appendChild(T.avatar(k.memberId, "ctu-avatar-xs"));
      owner.appendChild(el("span", null, T.memberName(k.memberId)));
      nameLine.appendChild(owner);
      main.appendChild(nameLine);
      main.appendChild(
        el("div", "ctk-meta",
          "创建于 " + T.fmtDate(k.createdAt) + " · 最近使用 " + T.fmtAgo(k.lastUsedAt) + " · 累计 " + T.fmtInt(k.calls || 0) + " 次")
      );

      var shown = !!revealed[k.id];
      var code = el("code", "ctk-key", shown ? k.secret || k.preview : MASK);
      code.setAttribute("data-shown", shown ? "true" : "false");

      var actions = el("div", "ctk-actions");
      var eye = iconBtn(shown ? "eyeOff" : "eye", shown ? "隐藏 Key" : "显示 Key");
      eye.addEventListener("click", function () {
        if (revealed[k.id]) delete revealed[k.id];
        else revealed[k.id] = true;
        renderList();
      });
      var copy = iconBtn("copy", "复制 Key");
      copy.addEventListener("click", function () {
        T.copyText(k.secret || k.preview).then(
          function () {
            copy.replaceChild(T.icon("check"), copy.firstChild);
            setTimeout(function () {
              if (copy.isConnected) copy.replaceChild(T.icon("copy"), copy.firstChild);
            }, 1200);
            T.toast(k.secret ? "已复制 Key" : "已复制 Key 标识（完整 Key 只在创建时显示一次）");
          },
          function () {
            T.toast("复制失败，请手动选择");
          }
        );
      });
      var del = iconBtn("trash", "吊销 Key");
      del.classList.add("ctk-danger");
      del.addEventListener("click", function () {
        confirmRevoke([k]);
      });
      actions.appendChild(eye);
      actions.appendChild(copy);
      actions.appendChild(del);

      li.appendChild(check);
      li.appendChild(main);
      li.appendChild(code);
      li.appendChild(actions);
      return li;
    }

    function iconBtn(icon, label) {
      var b = el("button", "ctk-icon-btn");
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.appendChild(T.icon(icon));
      return b;
    }

    function confirmRevoke(keys) {
      T.confirmRevokeKeys(keys, function (revokedIds) {
        revokedIds.forEach(function (id) {
          delete selected[id];
          delete revealed[id];
        });
      });
    }

    return { el: root, show: render };
  };
})();
