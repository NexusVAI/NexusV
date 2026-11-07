/* API 参考端点页（/api/reference/*）的交互：参数分区的「展开 / 收起」、示例切换（默认 / 流式 …）、
 * 参数深链按钮。外壳交互（主题、抽屉、搜索、代码块复制与语言切换、复制页面）仍由 shell.js 负责。
 * 标记结构见 api/_src/pages/reference/*.html。 */
(function () {
  "use strict";

  var doc = document;
  var qsa = function (sel, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); };

  // ── 参数分区：展开 / 收起全部嵌套参数 ─────────────────────────────────
  function groupFor(btn) {
    var key = btn.getAttribute("data-reference-property-toggle");
    var section = btn.closest("._section_1btwc_47") || doc;
    return section.querySelector('[data-stldocs-property-group="' + key + '"]');
  }
  function syncToggle(btn, expanded) {
    btn.setAttribute("aria-expanded", String(expanded));
    var more = btn.querySelector("[data-reference-expand-label]");
    var less = btn.querySelector("[data-reference-collapse-label]");
    if (more) more.hidden = expanded;
    if (less) less.hidden = !expanded;
  }
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-reference-property-toggle]");
    if (!btn) return;
    var group = groupFor(btn);
    if (!group) return;
    var expand = btn.getAttribute("aria-expanded") !== "true";
    qsa("details", group).forEach(function (d) { d.open = expand; });
    syncToggle(btn, expand);
  });
  // 用户逐个点开 / 收起时，让按钮文字跟着全组状态走
  doc.addEventListener("toggle", function (e) {
    var d = e.target;
    if (!d || d.tagName !== "DETAILS") return;
    var group = d.closest("[data-stldocs-property-group]");
    if (!group) return;
    var section = group.closest("._section_1btwc_47");
    var btn = section && section.querySelector("[data-reference-property-toggle]");
    if (!btn) return;
    var all = qsa("details", group);
    syncToggle(btn, all.length > 0 && all.every(function (x) { return x.open; }));
  }, true);

  // ── 示例切换（OpenAI SegmentedControl）────────────────────────────────
  function placeThumb(control) {
    var thumb = control.querySelector("[data-ref-thumb]");
    var on = control.querySelector('[data-state="on"]');
    if (!thumb || !on) return;
    thumb.style.width = on.offsetWidth + "px";
    thumb.style.transform = "translateX(" + on.offsetLeft + "px)";
  }
  function selectExample(container, index) {
    qsa("[data-ref-example]", container).forEach(function (b) {
      var on = b.getAttribute("data-ref-example") === index;
      b.setAttribute("data-state", on ? "on" : "off");
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    qsa("[data-ref-pane]", container).forEach(function (p) {
      p.hidden = p.getAttribute("data-ref-pane") !== index;
    });
    var control = container.querySelector("._SegmentedControl_16x8u_1");
    if (control) placeThumb(control);
  }
  var examples = qsa("[data-ref-examples]");
  examples.forEach(function (container) {
    var control = container.querySelector("._SegmentedControl_16x8u_1");
    if (!control) return;
    control.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ref-example]");
      if (b) selectExample(container, b.getAttribute("data-ref-example"));
    });
    control.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var buttons = qsa("[data-ref-example]", control);
      var i = buttons.findIndex(function (b) { return b.getAttribute("data-state") === "on"; });
      var next = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
      selectExample(container, next.getAttribute("data-ref-example"));
      next.focus();
      e.preventDefault();
    });
    placeThumb(control);
  });
  if (examples.length) {
    window.addEventListener("resize", function () {
      examples.forEach(function (c) {
        var control = c.querySelector("._SegmentedControl_16x8u_1");
        if (control) placeThumb(control);
      });
    });
    // 字体加载完成后按钮宽度会变，滑块再量一次
    if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(function () {
        examples.forEach(function (c) {
          var control = c.querySelector("._SegmentedControl_16x8u_1");
          if (control) placeThumb(control);
        });
      });
    }
  }

  // ── 参数深链按钮（悬停参数时出现，与 OpenAI 一致）──────────────────────
  var LINK_SVG =
    '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.293 5.707a4.657 4.657 0 0 0-6.586 0l-1 1a1 1 0 0 1-1.414-1.414l1-1a6.657 6.657 0 0 1 9.414 9.414l-1 1a1 1 0 0 1-1.414-1.414l1-1a4.657 4.657 0 0 0 0-6.586ZM15.707 8.293a1 1 0 0 1 0 1.414l-6 6a1 1 0 0 1-1.414-1.414l6-6a1 1 0 0 1 1.414 0ZM6.707 9.293a1 1 0 0 1 0 1.414l-1 1a4.657 4.657 0 0 0 6.586 6.586l1-1a1 1 0 0 1 1.414 1.414l-1 1a6.657 6.657 0 0 1-9.414-9.414l1-1a1 1 0 0 1 1.414 0Z"></path></svg>';
  qsa(".ref-root ._info_mjoyi_16[id]").forEach(function (info) {
    var prop = info.closest(".stldocs-property");
    if (!prop || prop.querySelector(":scope > ._deepLink_mjoyi_221")) return;
    var a = doc.createElement("a");
    a.href = "#" + info.id;
    a.className = "_Button_6dmow_1 not-prose stldocs-deep-link-button _deepLink_mjoyi_221";
    a.setAttribute("data-color", "secondary");
    a.setAttribute("data-variant", "outline");
    a.setAttribute("data-uniform", "");
    a.setAttribute("data-size", "sm");
    a.setAttribute("aria-label", "此参数的链接");
    a.innerHTML = '<span class="_ButtonInner_6dmow_4">' + LINK_SVG + "</span>";
    prop.appendChild(a);
  });

  // 打开带锚点的链接时，展开目标参数外层的所有折叠层（目标自己的子参数保持原状）
  function revealHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    var target = doc.getElementById(id);
    if (!target || !target.closest(".ref-root")) return;
    var prop = target.closest(".stldocs-property") || target;
    for (var d = prop.parentElement && prop.parentElement.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
    requestAnimationFrame(function () { target.scrollIntoView({ block: "start" }); });
  }
  window.addEventListener("hashchange", revealHash);
  revealHash();
})();
