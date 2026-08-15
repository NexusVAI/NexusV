/* ============================================================
 * NexusV Model Launch Modal — reusable engine (Fable5 / f5lm shell)
 * 2026-08-09
 *
 * Usage:
 *   NexusVModelLaunch.mount({ id, endAt, badge, titleHtml, ... })
 * Spec: docs/superpowers/specs/2026-08-09-model-launch-modal-design.md
 * ============================================================ */
(function (global) {
  "use strict";

  var API = global.NexusVModelLaunch || {};
  var STYLE_ID = "nexusv-model-launch-modal-styles";
  var activeById = Object.create(null);

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function sanitizeId(id) {
    return String(id || "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
  }

  function detectSurface() {
    var p = String(global.location.pathname || "");
    if (/api_models\.html$/i.test(p) || p.indexOf("api_models") >= 0) return "api";
    if (/\/chat\/api\//.test(p) || /\/api\/index\.html$/i.test(p)) return "api";
    return "chat";
  }

  function isQqBrowser() {
    return /QQBrowser|MQQBrowser|QQ\//i.test(navigator.userAgent || "");
  }

  function showDelayMs() {
    return isQqBrowser() ? 2600 : 1200;
  }

  function parseEndAt(endAt) {
    if (endAt == null || endAt === "") return NaN;
    if (typeof endAt === "number") return endAt;
    return new Date(String(endAt)).getTime();
  }

  function resolveConfig(raw) {
    var id = String((raw && raw.id) || "").trim();
    if (!id) throw new Error("[NexusVModelLaunch] config.id required");
    var safe = sanitizeId(id);
    var seenKey = (raw.seenKey && String(raw.seenKey)) || "nexusv_launch_" + id + "_v1";
    var killKey = (raw.killKey && String(raw.killKey)) || "nexusv_launch_" + id + "_off";
    var killParam = (raw.killParam && String(raw.killParam)) || "no" + safe;
    var secondary = raw.secondary || {};
    return {
      id: id,
      seenKey: seenKey,
      killKey: killKey,
      killParam: killParam,
      endAtMs: parseEndAt(raw.endAt),
      // badge: omit/undefined → default「全新上线」; "" / false / null → hide
      badge:
        raw.badge === "" || raw.badge === false || raw.badge === null
          ? ""
          : String(raw.badge || "全新上线"),
      titleHtml: String(raw.titleHtml || ""),
      leadHtml: String(raw.leadHtml || ""),
      noteHtml: raw.noteHtml == null ? "" : String(raw.noteHtml),
      media: raw.media || null,
      primary: raw.primary || null,
      secondaryLabel: String(secondary.label || "稍后再说"),
      delayMs: raw.delayMs != null ? Number(raw.delayMs) : showDelayMs(),
    };
  }

  function isKilled(cfg) {
    try {
      var q = String(global.location.search || "");
      if (q.indexOf(cfg.killParam + "=1") >= 0) {
        localStorage.setItem(cfg.killKey, "1");
        return true;
      }
      if (localStorage.getItem(cfg.killKey) === "1") return true;
    } catch (_) {}
    return false;
  }

  function isSeen(cfg, surface) {
    try {
      var raw = localStorage.getItem(cfg.seenKey) || "";
      return raw.split(",").indexOf(surface) >= 0;
    } catch (_) {
      return false;
    }
  }

  function markSeen(cfg, surface) {
    try {
      var parts = (localStorage.getItem(cfg.seenKey) || "").split(",").filter(Boolean);
      if (parts.indexOf(surface) < 0) parts.push(surface);
      localStorage.setItem(cfg.seenKey, parts.join(","));
    } catch (_) {}
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      ".f5lm-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;display:flex;align-items:center;justify-content:center;",
      "padding:16px;background:rgba(15,15,15,.52);",
      "opacity:0;transition:opacity .28s ease;-webkit-transform:translateZ(0);transform:translateZ(0)}",
      ".f5lm-overlay.f5lm-open{opacity:1}",
      ".f5lm-card{position:relative;width:100%;max-width:920px;max-height:92vh;overflow:hidden;",
      "background:#faf9f5;color:#29261b;border-radius:20px;",
      "box-shadow:0 1px 2px rgba(0,0,0,.05),0 16px 40px rgba(0,0,0,.12);",
      "border:1px solid rgba(112,107,87,.2);transform:translateY(10px) scale(.982);",
      "transition:transform .3s cubic-bezier(.2,.7,.3,1);-webkit-transform:translateY(10px) scale(.982)}",
      ".f5lm-overlay.f5lm-open .f5lm-card{transform:translateY(0) scale(1);-webkit-transform:translateY(0) scale(1)}",
      ".f5lm-grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);min-height:0}",
      "@media (max-width:767px){.f5lm-grid{grid-template-columns:1fr}}",
      ".f5lm-panel{display:flex;flex-direction:column;justify-content:space-between;gap:24px;",
      "padding:28px 28px 24px;min-width:0}",
      "@media (min-width:768px){.f5lm-panel{padding:32px 32px 28px}}",
      ".f5lm-badge{display:inline-flex;align-items:center;align-self:flex-start;height:24px;padding:0 10px;",
      "border-radius:8px;font-size:12px;font-weight:600;letter-spacing:.02em;",
      "background:rgba(217,119,87,.14);color:#9a3412}",
      ".f5lm-title{margin:0;font-size:clamp(22px,3.2vw,28px);line-height:1.22;font-weight:700;color:#29261b;",
      "font-family:'Source Serif 4','Source Serif Pro',ui-serif,Georgia,serif;letter-spacing:-.01em}",
      ".f5lm-lead{margin:0;font-size:15px;line-height:1.6;color:#535146}",
      ".f5lm-note{margin-top:4px;border:1px solid rgba(112,107,87,.22);border-radius:14px;",
      "padding:14px 16px;font-size:13px;line-height:1.55;color:#535146;background:#fff}",
      ".f5lm-note strong{display:block;color:#29261b;font-weight:600;margin-bottom:4px}",
      ".f5lm-note code{font-size:12px;background:#f3f1ea;padding:1px 6px;border-radius:4px;font-family:ui-monospace,monospace}",
      ".f5lm-note a{color:#9a3412;text-decoration:underline}",
      ".f5lm-actions{display:flex;flex-direction:column;gap:10px;width:100%}",
      ".f5lm-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:40px;",
      "border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid transparent;",
      "font-family:inherit;transition:background .15s,border-color .15s,color .15s,transform .12s;",
      "text-decoration:none;box-sizing:border-box;color:inherit}",
      ".f5lm-btn:active{transform:translateY(1px)}",
      ".f5lm-btn--primary{background:#29261b;color:#faf9f5}",
      ".f5lm-btn--primary:hover{background:#1f1d17;color:#faf9f5}",
      ".f5lm-btn--secondary{background:#faf9f5;color:#29261b;border-color:rgba(112,107,87,.35)}",
      ".f5lm-btn--secondary:hover{background:#f3f1ea}",
      ".f5lm-media-mobile{display:block;border-radius:14px;overflow:hidden;aspect-ratio:16/10;background:#ebe6da}",
      "@media (min-width:768px){.f5lm-media-mobile{display:none}}",
      ".f5lm-media{position:relative;display:none;align-items:stretch;justify-content:center;",
      "background:#ebe6da;overflow:hidden;border-radius:0 20px 20px 0;min-height:220px}",
      "@media (min-width:768px){.f5lm-media{display:flex}}",
      ".f5lm-video,.f5lm-image{width:100%;height:100%;object-fit:cover;display:block}",
      ".f5lm-close{position:absolute;top:14px;right:14px;z-index:2;width:36px;height:36px;",
      "border:none;border-radius:50%;background:rgba(250,249,245,.92);color:#29261b;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.08);",
      "transition:background .15s,transform .12s}",
      ".f5lm-close:hover{background:#fff;transform:scale(1.04)}",
      ".f5lm-close svg{width:18px;height:18px;flex-shrink:0}",
      "@media (max-width:767px){.f5lm-close{top:10px;right:10px}}",
    ].join("");
    document.head.appendChild(s);
  }

  function mediaSrc(media, surface) {
    if (!media) return "";
    return surface === "api" ? String(media.srcApi || "") : String(media.srcChat || "");
  }

  function renderMediaInner(media, surface) {
    var src = mediaSrc(media, surface);
    if (!src) return "";
    var type = String((media && media.type) || "image").toLowerCase();
    if (type === "video") {
      return (
        '<video class="f5lm-video" autoplay loop muted playsinline webkit-playsinline aria-hidden="true">' +
        '<source src="' +
        escapeAttr(src) +
        '" type="video/mp4">' +
        "</video>"
      );
    }
    var alt = escapeAttr((media && media.alt) || "");
    return '<img class="f5lm-image" src="' + escapeAttr(src) + '" alt="' + alt + '" />';
  }

  function buildModal(cfg, surface) {
    injectStyles();
    var titleId = "f5lm-title-" + sanitizeId(cfg.id);
    var mediaInner = renderMediaInner(cfg.media, surface);
    var primary = cfg.primary || {};
    var primaryHref =
      surface === "api" ? String(primary.hrefApi || "") : String(primary.hrefChat || "");
    var primaryLabel = escapeHtml(primary.label || "立即体验");
    var noteBlock = cfg.noteHtml
      ? '<div class="f5lm-note">' + cfg.noteHtml + "</div>"
      : "";

    var overlay = document.createElement("div");
    overlay.className = "f5lm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", titleId);
    overlay.setAttribute("data-launch-id", cfg.id);

    overlay.innerHTML =
      '<div class="f5lm-card">' +
      '  <div class="f5lm-grid">' +
      '    <div class="f5lm-panel">' +
      '      <div style="display:flex;flex-direction:column;gap:14px">' +
      (cfg.badge
        ? '        <span class="f5lm-badge">' + escapeHtml(cfg.badge) + "</span>"
        : "") +
      (mediaInner ? '        <div class="f5lm-media-mobile">' + mediaInner + "</div>" : "") +
      '        <h1 class="f5lm-title" id="' +
      escapeAttr(titleId) +
      '">' +
      cfg.titleHtml +
      "</h1>" +
      '        <p class="f5lm-lead">' +
      cfg.leadHtml +
      "</p>" +
      noteBlock +
      "      </div>" +
      '      <div class="f5lm-actions">' +
      '        <a class="f5lm-btn f5lm-btn--primary" data-f5lm-action="primary" href="' +
      escapeAttr(primaryHref) +
      '">' +
      primaryLabel +
      "</a>" +
      '        <button type="button" class="f5lm-btn f5lm-btn--secondary" data-f5lm-action="later">' +
      escapeHtml(cfg.secondaryLabel) +
      "</button>" +
      "      </div>" +
      "    </div>" +
      (mediaInner ? '    <div class="f5lm-media">' + mediaInner + "</div>" : "") +
      "  </div>" +
      '  <button type="button" class="f5lm-close" aria-label="关闭">' +
      '    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M15.147 4.146a.5.5 0 0 1 .707.707L10.707 10l5.147 5.147a.5.5 0 0 1-.63.771l-.078-.064L10 10.707l-5.146 5.147a.5.5 0 0 1-.708-.707L9.293 10 4.146 4.853a.5.5 0 0 1 .708-.707L10 9.293z"></path></svg>' +
      "  </button>" +
      "</div>";

    return overlay;
  }

  function closeModal(overlay, cfg, surface) {
    overlay.classList.remove("f5lm-open");
    markSeen(cfg, surface);
    if (overlay.__f5lmPrevHtmlOverflow != null) {
      document.documentElement.style.overflow = overlay.__f5lmPrevHtmlOverflow;
      document.body.style.overflow = overlay.__f5lmPrevBodyOverflow;
    }
    global.setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (activeById[cfg.id] === overlay) delete activeById[cfg.id];
    }, 280);
  }

  function showNow(cfg) {
    if (activeById[cfg.id]) return;
    if (isKilled(cfg)) return;
    if (!isNaN(cfg.endAtMs) && Date.now() > cfg.endAtMs) return;
    var surface = detectSurface();
    if (isSeen(cfg, surface)) return;

    var overlay = buildModal(cfg, surface);
    activeById[cfg.id] = overlay;
    document.body.appendChild(overlay);
    overlay.__f5lmPrevHtmlOverflow = document.documentElement.style.overflow;
    overlay.__f5lmPrevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    function dismiss() {
      closeModal(overlay, cfg, surface);
    }

    var closeBtn = overlay.querySelector(".f5lm-close");
    var laterBtn = overlay.querySelector('[data-f5lm-action="later"]');
    var primaryBtn = overlay.querySelector('[data-f5lm-action="primary"]');
    if (closeBtn) closeBtn.addEventListener("click", dismiss);
    if (laterBtn) laterBtn.addEventListener("click", dismiss);
    if (primaryBtn) {
      primaryBtn.addEventListener("click", function () {
        markSeen(cfg, surface);
      });
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) dismiss();
    });

    function onKey(e) {
      if (e.key !== "Escape") return;
      if (!document.body.contains(overlay)) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      document.removeEventListener("keydown", onKey);
      dismiss();
    }
    document.addEventListener("keydown", onKey);

    global.setTimeout(function () {
      overlay.classList.add("f5lm-open");
      var vids = overlay.querySelectorAll("video");
      for (var i = 0; i < vids.length; i++) {
        if (vids[i].play) vids[i].play().catch(function () {});
      }
      if (closeBtn && closeBtn.focus) closeBtn.focus();
    }, 30);
  }

  function scheduleShow(cfg) {
    global.setTimeout(function () {
      try {
        showNow(cfg);
      } catch (e) {
        console.warn("[NexusVModelLaunch] show failed", e);
        delete activeById[cfg.id];
      }
    }, cfg.delayMs);

    if (isQqBrowser()) {
      global.addEventListener(
        "load",
        function () {
          global.setTimeout(function () {
            try {
              showNow(cfg);
            } catch (e) {
              console.warn("[NexusVModelLaunch] qq load retry failed", e);
            }
          }, 900);
        },
        { once: true }
      );
    }
  }

  function mount(raw) {
    var cfg = resolveConfig(raw || {});
    if (isKilled(cfg)) return { ok: false, reason: "killed" };
    if (!isNaN(cfg.endAtMs) && Date.now() > cfg.endAtMs) {
      return { ok: false, reason: "ended" };
    }

    function start() {
      scheduleShow(cfg);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
    return { ok: true, id: cfg.id };
  }

  API.mount = mount;
  API.detectSurface = detectSurface;
  global.NexusVModelLaunch = API;
})(typeof window !== "undefined" ? window : globalThis);
