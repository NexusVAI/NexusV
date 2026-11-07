/* Client-side redirects for the retired API-area URLs (/chat/api/, /chat/api_*.html, /chat/api/*.html,
 * /api/models/). GitHub Pages has no server-side redirects, so each old page is a stub that loads this
 * file synchronously in <head> with data-kind="home | models | model-detail | docs | live"; the stub's
 * <meta refresh> covers the no-JS case. */
(function () {
  "use strict";

  // Section id of the old docs page (the #hash of api_docs_detail / api_docs / api_docs_oai) → new page.
  var DOCS = {
    "intro": "/api/docs/",
    "quickstart": "/api/docs/quickstart/",
    "migration": "/api/docs/guides/migration/",
    "auth": "/api/docs/guides/authentication/",
    "models": "/api/reference/models/",
    "balance": "/api/docs/guides/usage/",
    "sdk": "/api/docs/libraries/",
    "common-misunderstandings": "/api/docs/guides/conventions/",
    "chat": "/api/docs/guides/chat-completions/",
    "messages": "/api/docs/guides/messages/",
    "responses": "/api/docs/guides/responses/",
    "cli-codex": "/api/docs/guides/codex-cli/",
    "cli-claude": "/api/docs/guides/claude-code/",
    "cli-opencode": "/api/docs/guides/opencode/",
    "cli-openclaw": "/api/docs/guides/openclaw/",
    "cli-aider": "/api/docs/guides/aider/",
    "client-cherry": "/api/docs/guides/cherry-studio/",
    "client-sillytavern": "/api/docs/guides/sillytavern/",
    "client-ccswitch": "/api/docs/guides/cc-switch/",
    "client-chatbox": "/api/docs/guides/chatbox/",
    "client-lobechat": "/api/docs/guides/lobechat/",
    "client-cursor": "/api/docs/guides/cursor/",
    "client-cline": "/api/docs/guides/cline/",
    "client-continue": "/api/docs/guides/continue/",
    "client-faq": "/api/docs/guides/client-faq/",
    "team": "/api/docs/guides/teams/",
    "quota": "/api/docs/guides/billing/",
    "free-model-limits": "/api/docs/guides/free-tier/",
    "ratelimit": "/api/docs/guides/rate-limits/",
    "errors": "/api/docs/guides/error-codes/",
    "faq": "/api/docs/faq/",
    "pricing": "/api/docs/pricing/",
    "realtime": "/api/docs/guides/realtime/"
  };
  // Anchors that sat inside an old docs section → that section. "rate-limit" is what the chat quota
  // panel used to link to.
  var DOCS_SUB = {
    "faq-cache": "client-faq",
    "team-start": "team", "team-roles": "team", "team-billing": "team", "team-keys": "team", "team-leave": "team",
    "wallet-model": "quota", "free-models": "quota", "recharge": "quota", "check-balance": "quota",
    "ratelimit-tiers": "ratelimit", "ratelimit-metering": "ratelimit", "ratelimit-key": "ratelimit",
    "rate-limit": "ratelimit",
    "model-unavailable": "errors", "error-retry": "errors", "error-format": "errors"
  };

  // Section id of the old GPT-Live page (api_docs_live) → new page.
  var LIVE = {
    "intro": "/api/docs/guides/realtime/",
    "quickstart": "/api/docs/guides/realtime/",
    "connect": "/api/docs/guides/realtime-connect/",
    "session-start": "/api/docs/guides/realtime-sessions/",
    "backends": "/api/docs/guides/realtime-sessions/",
    "events": "/api/docs/guides/realtime-events/",
    "pricing": "/api/docs/guides/realtime-billing/",
    "limits": "/api/docs/guides/realtime-billing/",
    "errors": "/api/docs/guides/realtime-errors/"
  };
  var LIVE_SUB = { "backend-official": "backends", "backend-site": "backends", "backend-client": "backends" };

  var has = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };

  // Only the last "#…" segment counts: the old api_docs.html stub produced URLs like "#intro#quota".
  function hashKey(hash) {
    var parts = String(hash || "").split("#").filter(Boolean);
    var key = parts.length ? parts[parts.length - 1] : "";
    try { key = decodeURIComponent(key); } catch (e) {}
    return key.trim().toLowerCase();
  }

  function byHash(map, sub, hash, fallback) {
    var key = hashKey(hash);
    if (!has(map, key) && has(sub, key)) key = sub[key];
    return has(map, key) ? map[key] : fallback;
  }

  // kind + the old page's location → path on the new site. Query strings are always kept; the hash is
  // kept where the new page understands it (home, model catalog #model-<id>) and consumed elsewhere.
  function legacyTarget(kind, loc) {
    var search = loc.search || "";
    var hash = loc.hash || "";
    switch (kind) {
      case "home":
        return "/api/" + search + hash;
      case "models":
        return "/api/docs/models/" + search + hash;
      case "model-detail":
        return new URLSearchParams(search).get("model") ? "/api/docs/models/detail/" + search + hash : "/api/docs/models/";
      case "docs":
        return byHash(DOCS, DOCS_SUB, hash, "/api/docs/") + search;
      case "live":
        return byHash(LIVE, LIVE_SUB, hash, "/api/docs/guides/realtime/") + search;
      default:
        return "/api/";
    }
  }

  if (typeof module === "object" && module && module.exports) {
    module.exports = { legacyTarget: legacyTarget };
  } else if (typeof document !== "undefined" && document.currentScript) {
    location.replace(legacyTarget(document.currentScript.getAttribute("data-kind"), location));
  }
})();
