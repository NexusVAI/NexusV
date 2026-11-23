/* /api/docs/guides/image-cost-calculator/ — 模型 Token 费用计算器.
 * Uses the same public model catalog and ¥ prices as /api/docs/pricing/.
 * Estimate each request from the model's prices per million tokens:
 *   (input − cached) × in_price + cached × in_price × cached_input_factor + output × out_price   (prices per 1M tokens)
 * Per-call models: per_call_price × requests. The catalog copy is reused for 10 minutes across tabs
 * (localStorage), so revisiting the page does not call the gateway again. */
(function () {
  "use strict";

  var M = window.NexusModels;
  var root = document.querySelector("[data-token-calc]");
  if (!M || !root) return;

  var CATALOG_MAX_AGE_MS = 10 * 60 * 1000;
  var MAX_TOKENS = 1e12;
  var MAX_REQUESTS = 1e9;
  var UNITS = { one: 1, k: 1e3, m: 1e6 };

  var esc = M.esc;
  var $ = function (sel) {
    return root.querySelector(sel);
  };
  var select = $("[data-calc-model]");
  var fields = {
    input: $('[data-calc-field="input"]'),
    cached: $('[data-calc-field="cached"]'),
    output: $('[data-calc-field="output"]'),
    requests: $('[data-calc-field="requests"]'),
  };
  var group = $("[data-calc-unit]");
  var thumb = group.querySelector("[data-segmented-thumb]");
  var notes = $("[data-calc-notes]");
  var outTotal = $("[data-calc-total]");
  var outEach = $("[data-calc-each]");
  var outEachLabel = $("[data-calc-each-label]");
  var foot = $("[data-calc-foot]");
  var detail = $("[data-calc-detail]");
  var status = $("[data-calc-status]");

  var cat = null;
  var unit = "one";

  // ── formatting ──
  function intText(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function trimZeros(s, minDecimals) {
    var dot = s.indexOf(".");
    if (dot === -1) return minDecimals ? s + "." + "00".slice(0, minDecimals) : s;
    s = s.replace(/0+$/, "");
    var dec = s.length - dot - 1;
    while (dec < minDecimals) {
      s += "0";
      dec++;
    }
    return s.replace(/\.$/, "");
  }
  // ¥ amount: 2 decimals at ≥ ¥100, up to 4 at ≥ ¥1, up to 6 below; never shows a tiny cost as ¥0.
  function money(n) {
    if (!isFinite(n)) return "—";
    if (n === 0) return "¥0.00";
    if (n < 0.000001) return "< ¥0.000001";
    var s = n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6);
    s = trimZeros(s, 2);
    var parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "¥" + parts.join(".");
  }
  function perM(n) {
    return n == null ? "—" : M.yenFixed(n) + " / 百万 token";
  }

  // ── inputs ──
  // Accepts "12,000", " 1.5 " etc. Returns { value } or { error }. Empty counts as 0.
  function readNumber(el, opts) {
    var label = opts.label + (/[A-Za-z]$/.test(opts.label) ? " " : "");
    var raw = String(el.value || "").replace(/[,\s，_]/g, "");
    if (raw === "") return { value: 0 };
    if (!/^\d*\.?\d*$/.test(raw) || raw === ".") return { error: label + "只能填非负数字" };
    var n = Number(raw);
    if (!isFinite(n)) return { error: label + "不是有效数字" };
    if (opts.integer && n !== Math.floor(n)) return { error: label + "必须是整数" };
    return { value: n };
  }

  function setInvalid(el, bad) {
    el.setAttribute("aria-invalid", bad ? "true" : "false");
  }

  function model() {
    return cat && select.value ? cat.get(select.value) : null;
  }

  function compute() {
    var errors = [];
    var mult = UNITS[unit];
    var tok = {};
    ["input", "cached", "output"].forEach(function (k) {
      var r = readNumber(fields[k], { label: fields[k].getAttribute("data-label") });
      setInvalid(fields[k], !!r.error);
      if (r.error) errors.push(r.error);
      var n = r.error ? 0 : Math.round(r.value * mult);
      if (n > MAX_TOKENS) {
        errors.push(fields[k].getAttribute("data-label") + " 超过 1 万亿，按 1 万亿计算");
        setInvalid(fields[k], true);
        n = MAX_TOKENS;
      }
      tok[k] = n;
    });
    var rq = readNumber(fields.requests, { label: "请求次数", integer: true });
    setInvalid(fields.requests, !!rq.error);
    if (rq.error) errors.push(rq.error);
    var requests = rq.error ? 1 : rq.value;
    if (requests > MAX_REQUESTS) {
      errors.push("请求次数超过 10 亿，按 10 亿计算");
      setInvalid(fields.requests, true);
      requests = MAX_REQUESTS;
    }
    if (tok.cached > tok.input) {
      errors.push("缓存命中 token 不能多于输入 token，已按输入 token 计算");
      setInvalid(fields.cached, true);
      tok.cached = tok.input;
    }
    return { tok: tok, requests: requests, errors: errors };
  }

  function row(dt, dd) {
    return "<dt>" + esc(dt) + "</dt><dd>" + esc(dd) + "</dd>";
  }

  function render() {
    var m = model();
    var c = compute();
    var lines = c.errors.slice();
    var p = m ? M.priceOf(m) : null;
    var each = null;
    var dl = "";
    var footText = "按站内单价估算。";

    if (!m) {
      outTotal.textContent = "—";
      outEach.textContent = "—";
      notes.innerHTML = lines.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("");
      return;
    }

    if (p.kind === "token") {
      var inPrice = p.input || 0;
      var outPrice = p.output || 0;
      var uncached = c.tok.input - c.tok.cached;
      var inCost = (uncached * inPrice) / 1e6;
      var cacheCost = (c.tok.cached * inPrice * p.cacheFactor) / 1e6;
      var outCost = (c.tok.output * outPrice) / 1e6;
      each = inCost + cacheCost + outCost;
      if (p.input == null) lines.push("目录里没有该模型的输入单价，输入部分按 ¥0 计算。");
      if (p.output == null) lines.push("目录里没有该模型的输出单价，输出部分按 ¥0 计算。");
      dl =
        row("输入单价", perM(p.input)) +
        row("缓存命中单价", p.cached == null ? "—" : perM(p.cached) + "（输入价 × " + p.cacheFactor + "）") +
        row("输出单价", perM(p.output)) +
        row("未命中缓存的输入", intText(uncached) + " token → " + money(inCost)) +
        row("缓存命中的输入", intText(c.tok.cached) + " token → " + money(cacheCost)) +
        row("输出", intText(c.tok.output) + " token → " + money(outCost)) +
        row("单次请求合计", money(each)) +
        row("请求次数", intText(c.requests));
    } else if (p.kind === "call") {
      each = p.call;
      footText = "该模型按次计费，与 token 数量无关。";
      dl = row("每次请求价格", money(p.call)) + row("请求次数", intText(c.requests));
    } else if (p.kind === "free") {
      each = 0;
      footText = "免费模型不扣余额，调用计入免费额度。";
      dl = row("单价", "免费") + row("请求次数", intText(c.requests));
    } else {
      footText = "目录里没有该模型的结构化单价，无法估算。";
      dl = row("目录标价", M.priceText(m));
    }

    if (m.available === false) lines.push("该模型线路当前不可用，价格仅供参考。");

    if (each == null) {
      outTotal.textContent = "—";
      outEach.textContent = "—";
    } else {
      outTotal.textContent = money(each * c.requests);
      outEach.textContent = money(each);
    }
    outEachLabel.textContent = p.kind === "call" ? "每次请求" : "单次请求";
    foot.innerHTML =
      esc(footText) +
      ' <a class="underline underline-offset-2" href="/api/docs/pricing/#price-' + encodeURIComponent(m.id) + '">价格页</a>' +
      ' · <a class="underline underline-offset-2" href="' + esc(M.detailUrl(m.id)) + '">模型详情</a>';
    detail.innerHTML = dl;
    notes.innerHTML = lines.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("");
  }

  // ── token unit segmented control ──
  function placeThumb() {
    var on = group.querySelector('[data-state="on"]');
    if (!on || !on.clientWidth) return;
    var w = Math.floor(on.clientWidth);
    if (group.clientWidth - (w + on.offsetLeft) < 2) w--;
    thumb.style.width = w + "px";
    thumb.style.transform = "translateX(" + on.offsetLeft + "px)";
  }
  function setUnit(next, focus) {
    if (!UNITS[next]) return;
    var prev = unit;
    unit = next;
    group.querySelectorAll("[data-unit]").forEach(function (b) {
      var on = b.getAttribute("data-unit") === next;
      b.setAttribute("data-state", on ? "on" : "off");
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    // Keep the token amounts: 12,000 个 → 12 千.
    if (prev !== next) {
      ["input", "cached", "output"].forEach(function (k) {
        var r = readNumber(fields[k], { label: "" });
        if (r.error || !r.value) return;
        var n = (r.value * UNITS[prev]) / UNITS[next];
        fields[k].value = trimZeros(String(Math.round(n * 1e6) / 1e6), 0);
      });
    }
    root.querySelectorAll("[data-unit-suffix]").forEach(function (s) {
      s.textContent = next === "one" ? "" : next === "k" ? "（千）" : "（百万）";
    });
    placeThumb();
    render();
  }
  group.addEventListener("click", function (e) {
    var b = e.target.closest("[data-unit]");
    if (b) setUnit(b.getAttribute("data-unit"), false);
  });
  group.addEventListener("keydown", function (e) {
    var order = ["one", "k", "m"];
    var i = order.indexOf(unit);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i = Math.min(order.length - 1, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = Math.max(0, i - 1);
    else return;
    e.preventDefault();
    setUnit(order[i], true);
  });
  window.addEventListener("resize", placeThumb);

  Object.keys(fields).forEach(function (k) {
    fields[k].addEventListener("input", render);
  });
  select.addEventListener("change", function () {
    var u = new URL(location.href);
    u.searchParams.set("model", select.value);
    history.replaceState(null, "", u);
    render();
  });

  // ── model list ──
  function optionLabel(m) {
    var p = M.priceOf(m);
    var tag = p.kind === "free" ? "免费" : p.kind === "call" ? "按次" : "";
    return m.id + (tag ? "（" + tag + "）" : "") + (m.available === false ? "（暂不可用）" : "");
  }

  function fill(prepared) {
    cat = prepared;
    var html = "";
    cat.vendors(cat.raw).forEach(function (v) {
      html += '<optgroup label="' + esc(v.label) + '">';
      v.list.forEach(function (m) {
        html += '<option value="' + esc(m.id) + '">' + esc(optionLabel(m)) + "</option>";
      });
      html += "</optgroup>";
    });
    select.innerHTML = html;
    var wanted = (new URLSearchParams(location.search).get("model") || "").trim();
    var pick = wanted && cat.get(wanted);
    if (!pick) {
      var featured = cat.featured()[0];
      pick = featured ? cat.get(featured.id) || featured : null;
    }
    if (!pick) {
      pick = cat.raw.filter(function (m) { return M.priceOf(m).kind === "token"; })[0] || cat.raw[0];
    }
    if (pick) select.value = pick.id;
    select.disabled = false;
    status.hidden = true;
    status.innerHTML = "";
    root.removeAttribute("aria-busy");
    render();
  }

  function fail(err) {
    root.removeAttribute("aria-busy");
    select.innerHTML = '<option value="">模型列表加载失败</option>';
    status.hidden = false;
    status.innerHTML =
      "<p>暂时无法加载模型与价格：" + esc(M.errorText(err)) + "。</p>" +
      '<button type="button" class="_Button_6dmow_1" data-color="primary" data-variant="outline" data-pill="" data-size="sm" data-calc-retry><span class="_ButtonInner_6dmow_4">重试</span></button>';
    render();
  }

  root.addEventListener("click", function (e) {
    if (!e.target.closest("[data-calc-retry]")) return;
    status.innerHTML = "<p>正在重新加载…</p>";
    root.setAttribute("aria-busy", "true");
    M.load({ fresh: true }).then(fill, fail);
  });

  placeThumb();
  M.load({ maxAgeMs: CATALOG_MAX_AGE_MS }).then(fill, fail);
})();
