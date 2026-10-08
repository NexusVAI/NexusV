/**
 * 管理 → 团队用量。左边大图（悬停竖线 + 圆点 + 用量卡片），右边成员目录点选切换。
 * 由 team-page.js 调 CancriTeam.createUsageView() 建出来挂进管理面板；依赖 team-shared.js。
 */
(function () {
  "use strict";
  var T = window.CancriTeam;
  if (!T) return;

  var RANGES = [
    { label: "7 天", days: 7 },
    { label: "30 天", days: 30 },
  ];
  var METRICS = [
    { key: "cost", label: "费用", fmt: T.fmtCny, axis: fmtCnyShort },
    { key: "tokens", label: "Tokens", fmt: T.fmtTokens, axis: T.fmtTokens },
    { key: "requests", label: "请求", fmt: T.fmtReq, axis: T.fmtInt },
  ];
  var WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function fmtCnyShort(v) {
    if (!v) return "¥0";
    // 单次调用常常只有零点零几分钱：< ¥1 按两位有效数字，避免整条轴都显示成 ¥0.00
    return v >= 1000 ? "¥" + (v / 1000).toFixed(1) + "k" : "¥" + (v >= 10 ? Math.round(v) : v >= 1 ? v.toFixed(1) : Number(v.toPrecision(2)));
  }
  function fmtDay(s) {
    var d = T.parseDate(s);
    return d.getMonth() + 1 + "月" + d.getDate() + "日 " + WEEK[d.getDay()];
  }
  function fmtTick(s) {
    var d = T.parseDate(s);
    return T.pad2(d.getMonth() + 1) + "/" + T.pad2(d.getDate());
  }
  /** 1/2/2.5/5 × 10^n 的整齐上界，让 y 轴刻度落在好读的数上。 */
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  T.createUsageView = function () {
    var el = T.el;
    var st = { range: 1, metric: 0, hover: -1 };
    var ui = {};

    var root = el("div", "ctu");
    var head = el("div", "ctu-head");
    var title = el("div", "ctu-title");
    title.appendChild(el("h2", null, "团队用量"));
    ui.sub = el("p", "ctu-sub");
    title.appendChild(ui.sub);
    var controls = el("div", "ctu-controls");
    ui.metricSeg = T.makeSegmented(METRICS.map(function (m) { return m.label; }), "用量指标", function (i) {
      st.metric = i;
      render();
    });
    ui.rangeSeg = T.makeSegmented(RANGES.map(function (r) { return r.label; }), "时间范围", function (i) {
      st.range = i;
      render();
    });
    controls.appendChild(ui.metricSeg.host);
    controls.appendChild(ui.rangeSeg.host);
    head.appendChild(title);
    head.appendChild(controls);

    var body = el("div", "ctu-body");
    var card = el("section", "ctu-card");
    card.setAttribute("aria-label", "用量趋势");
    var stats = el("div", "ctu-stats");
    ui.stats = METRICS.map(function (m, i) {
      var s = el("div", "ctu-stat");
      var v = el("div", "ctu-stat-value", "—");
      s.appendChild(el("div", "ctu-stat-label", m.label));
      s.appendChild(v);
      s.style.cursor = "pointer";
      s.addEventListener("click", function () {
        st.metric = i;
        ui.metricSeg.select(i);
        render();
      });
      stats.appendChild(s);
      return { box: s, value: v };
    });
    ui.plot = el("div", "ctu-plot");
    ui.plot.tabIndex = 0;
    ui.svg = T.svg("svg", { role: "img" });
    ui.tip = el("div", "ctu-tip");
    ui.tip.setAttribute("aria-hidden", "true");
    ui.empty = el("div", "ctu-empty", "该时段暂无用量");
    ui.empty.hidden = true;
    ui.plot.appendChild(ui.svg);
    ui.plot.appendChild(ui.empty);
    ui.plot.appendChild(ui.tip);
    card.appendChild(stats);
    card.appendChild(ui.plot);

    var dir = T.buildDirectory();
    body.appendChild(card);
    body.appendChild(dir.el);
    root.appendChild(head);
    root.appendChild(body);
    wireHover();

    // ---------- 数据 ----------

    function series() {
      var members = T.state.data.members;
      var days = RANGES[st.range].days;
      var list = T.state.memberId === T.ALL_ID ? members : members.filter(function (m) { return m.id === T.state.memberId; });
      if (!list.length) list = members;
      var len = list[0] && list[0].daily ? list[0].daily.length : 0;
      var out = [];
      for (var i = Math.max(0, len - days); i < len; i++) {
        var row = { date: list[0].daily[i].date, cost: 0, requests: 0, tokens: 0 };
        list.forEach(function (m) {
          var d = m.daily && m.daily[i];
          if (!d) return;
          row.cost += d.cost || 0;
          row.requests += d.requests || 0;
          row.tokens += d.tokens || 0;
        });
        out.push(row);
      }
      return out;
    }

    // ---------- 渲染 ----------

    function render() {
      if (!T.state.data) return;
      st.hover = -1;
      var days = RANGES[st.range].days;
      var metric = METRICS[st.metric];
      ui.sub.textContent = T.memberName(T.state.memberId) + " · 近 " + days + " 天 · 按" + metric.label;

      var t = T.totals(series(), days);
      METRICS.forEach(function (m, i) {
        ui.stats[i].value.textContent = m.fmt(t[m.key]);
        ui.stats[i].box.setAttribute("data-active", i === st.metric ? "true" : "false");
      });

      var rows = T.state.data.members.map(function (m) {
        return { member: m, t: T.totals(m.daily, days) };
      });
      rows.sort(function (a, b) { return b.t[metric.key] - a.t[metric.key]; });
      var max = rows.length ? rows[0].t[metric.key] : 0;
      var all = { cost: 0, requests: 0, tokens: 0 };
      rows.forEach(function (r) {
        all.cost += r.t.cost;
        all.requests += r.t.requests;
        all.tokens += r.t.tokens;
      });
      function meta(x) {
        return T.fmtCny(x.cost) + " · " + T.fmtReq(x.requests) + " · " + T.fmtTokens(x.tokens);
      }
      dir.render({
        countText: rows.length + " 人",
        allMeta: meta(all),
        rows: rows.map(function (r) {
          return { member: r.member, meta: meta(r.t), share: max > 0 ? r.t[metric.key] / max : 0 };
        }),
        onPick: render,
      });
      renderChart();
    }

    /** 每次都按容器实际尺寸重画；ResizeObserver 触发时也走这里。 */
    function renderChart() {
      var data = series();
      var metric = METRICS[st.metric];
      var W = Math.max(200, ui.plot.clientWidth - 16);
      var H = Math.max(200, ui.plot.clientHeight - 12);
      var pad = { l: 52, r: 12, t: 12, b: 26 };
      var pw = W - pad.l - pad.r;
      var ph = H - pad.t - pad.b;
      var vals = data.map(function (d) { return d[metric.key] || 0; });
      var max = niceMax(Math.max.apply(null, vals.concat([0])));
      var n = data.length;

      var s = ui.svg;
      s.textContent = "";
      s.setAttribute("viewBox", "0 0 " + W + " " + H);
      s.setAttribute("width", W);
      s.setAttribute("height", H);

      // 上界首位是 5 / 2.5 时分 5 格，否则分 4 格 —— 保证每格都是整齐数（不出 $12.5→$13）
      var lead = max / Math.pow(10, Math.floor(Math.log10(max)));
      var ticks = Math.abs(lead - 5) < 1e-9 || Math.abs(lead - 2.5) < 1e-9 ? 5 : 4;
      for (var i = 0; i <= ticks; i++) {
        var y = Math.round(pad.t + ph - (i / ticks) * ph) + 0.5;
        s.appendChild(T.svg("line", { class: "ctu-grid", x1: pad.l, x2: W - pad.r, y1: y, y2: y, "data-base": i === 0 ? "true" : "false" }));
        var lab = T.svg("text", { class: "ctu-axis", x: pad.l - 8, y: y + 4, "text-anchor": "end" });
        lab.textContent = metric.axis((max * i) / ticks);
        s.appendChild(lab);
      }

      var pts = vals.map(function (v, k) {
        return {
          x: pad.l + (n <= 1 ? pw / 2 : (k / (n - 1)) * pw),
          y: pad.t + ph - (v / max) * ph,
        };
      });

      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 64))));
      data.forEach(function (d, k) {
        if (k % every !== 0 && k !== n - 1) return;
        if (k !== n - 1 && n - 1 - k < every) return; // 避免最后两个标签挤在一起
        var t = T.svg("text", { class: "ctu-axis", x: pts[k].x, y: H - 6, "text-anchor": k === 0 ? "start" : k === n - 1 ? "end" : "middle" });
        t.textContent = fmtTick(d.date);
        s.appendChild(t);
      });

      if (pts.length) {
        var line = "M" + pts.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join("L");
        var base = (pad.t + ph).toFixed(1);
        var area = line + "L" + pts[n - 1].x.toFixed(1) + "," + base + "L" + pts[0].x.toFixed(1) + "," + base + "Z";
        s.appendChild(T.svg("path", { class: "ctu-area", d: area }));
        s.appendChild(T.svg("path", { class: "ctu-line", d: line }));
      }

      ui.cross = T.svg("line", { class: "ctu-cross", y1: pad.t, y2: pad.t + ph, visibility: "hidden" });
      ui.dot = T.svg("circle", { class: "ctu-dot", r: 5, visibility: "hidden" });
      s.appendChild(ui.cross);
      s.appendChild(ui.dot);

      ui.geo = { pts: pts, series: data, pad: pad, pw: pw, W: W, H: H };
      ui.empty.hidden = vals.some(function (v) { return v > 0; });
      s.setAttribute(
        "aria-label",
        T.memberName(T.state.memberId) + " 近 " + RANGES[st.range].days + " 天" + metric.label + "趋势，合计 " +
          metric.fmt(vals.reduce(function (a, b) { return a + b; }, 0))
      );
      if (st.hover >= 0) showHover(st.hover);
      else hideHover();
    }

    // ---------- 悬停 ----------

    function wireHover() {
      function idxFromEvent(e) {
        var g = ui.geo;
        if (!g || !g.pts.length) return -1;
        var r = ui.svg.getBoundingClientRect();
        var x = ((e.clientX - r.left) / r.width) * g.W;
        if (x < g.pad.l - 12 || x > g.W - g.pad.r + 12) return -1;
        var n = g.pts.length;
        return n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((x - g.pad.l) / g.pw) * (n - 1))));
      }
      ui.plot.addEventListener("pointermove", function (e) {
        var i = idxFromEvent(e);
        if (i < 0) return hideHover();
        if (i !== st.hover) showHover(i);
      });
      ui.plot.addEventListener("pointerleave", function (e) {
        if (e.pointerType === "mouse") hideHover();
      });
      ui.plot.addEventListener("keydown", function (e) {
        var g = ui.geo;
        if (!g || !g.pts.length) return;
        var n = g.pts.length;
        var i = st.hover;
        if (e.key === "ArrowLeft") i = i < 0 ? n - 1 : Math.max(0, i - 1);
        else if (e.key === "ArrowRight") i = i < 0 ? 0 : Math.min(n - 1, i + 1);
        else if (e.key === "Home") i = 0;
        else if (e.key === "End") i = n - 1;
        else if (e.key === "Escape") return hideHover();
        else return;
        e.preventDefault();
        showHover(i);
      });
      ui.plot.addEventListener("blur", hideHover);
    }

    function showHover(i) {
      var g = ui.geo;
      if (!g || !g.pts[i]) return;
      st.hover = i;
      var p = g.pts[i];
      var d = g.series[i];
      ui.cross.setAttribute("x1", p.x);
      ui.cross.setAttribute("x2", p.x);
      ui.cross.setAttribute("visibility", "visible");
      ui.dot.setAttribute("cx", p.x);
      ui.dot.setAttribute("cy", p.y);
      ui.dot.setAttribute("visibility", "visible");

      var tip = ui.tip;
      tip.textContent = "";
      tip.appendChild(el("div", "ctu-tip-date", fmtDay(d.date)));
      tip.appendChild(el("div", "ctu-tip-who", T.memberName(T.state.memberId)));
      METRICS.forEach(function (m, k) {
        var row = el("div", "ctu-tip-row");
        row.setAttribute("data-active", k === st.metric ? "true" : "false");
        row.appendChild(el("span", null, m.label));
        row.appendChild(el("b", null, m.fmt(d[m.key] || 0)));
        tip.appendChild(row);
      });
      tip.setAttribute("data-show", "true");

      // svg 坐标 → 绘图区像素；卡片默认放在点的右下方，碰到右/下边就翻到另一侧
      var sr = ui.svg.getBoundingClientRect();
      var pr = ui.plot.getBoundingClientRect();
      var sx = sr.width / g.W;
      var px = sr.left - pr.left + p.x * sx;
      var py = sr.top - pr.top + p.y * sx;
      var tw = tip.offsetWidth;
      var th = tip.offsetHeight;
      var left = px + 14;
      if (left + tw > pr.width - 4) left = px - 14 - tw;
      var top = py + 14;
      if (top + th > pr.height - 4) top = Math.max(4, py - 14 - th);
      tip.style.transform = "translate(" + Math.round(Math.max(4, left)) + "px," + Math.round(top) + "px)";
    }

    function hideHover() {
      st.hover = -1;
      if (ui.cross) ui.cross.setAttribute("visibility", "hidden");
      if (ui.dot) ui.dot.setAttribute("visibility", "hidden");
      if (ui.tip) ui.tip.setAttribute("data-show", "false");
    }

    if (window.ResizeObserver) {
      var raf = 0;
      new ResizeObserver(function () {
        if (!T.state.data || !ui.plot.offsetWidth) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () {
          renderChart();
          ui.metricSeg.relayout();
          ui.rangeSeg.relayout();
        });
      }).observe(ui.plot);
    }

    return {
      el: root,
      /** 面板显示之后调：隐藏时 offsetWidth 全是 0，滑块和图都要显示后再量。 */
      show: function () {
        ui.metricSeg.select(st.metric);
        ui.rangeSeg.select(st.range);
        render();
      },
    };
  };
})();
