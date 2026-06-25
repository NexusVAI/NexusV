/**
 * NexusVAI API console — auth + wallet/usage/keys/logs on SingleFile snapshots.
 */
(function () {
  "use strict";

  var PAGE = document.body.getAttribute("data-console-page") || "overview";
  var GW =
    (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") +
    "/functions/v1/chat-gateway";
  var WALLET_LOW_THRESHOLD = 10;
  var HIDE_NAV = [
    "Chat",
    "Audio",
    "Images",
    "Codex",
    "Batches",
    "Storage",
    "ChatGPT Apps",
    "Settings",
  ];

  function detectLang() {
    try {
      var saved = localStorage.getItem("lang");
      if (saved === "zh" || saved === "en") return saved;
    } catch (e) {}
    var nav = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    return nav.indexOf("zh") >= 0 ? "zh" : "en";
  }

  var LANG = detectLang();

  var I18N = {
    en: {
      cancel: "Cancel",
      confirm: "Confirm",
      create: "Create",
      creating: "Creating…",
      createKeyTitle: "Create new secret key",
      keyNameLabel: "Key name (optional)",
      keyCreatedTitle: "Secret key created",
      keyCreatedHint: "Copy now — you won't see it again.",
      copy: "Copy",
      close: "Close",
      revokeTitle: "Revoke key",
      revokeHint: "Revoke this key? This cannot be undone.",
      revoke: "Revoke",
      revoking: "Revoking…",
      revokeFailed: "Revoke failed: ",
      createFailed: "Create failed: ",
      time: "Time",
      model: "Model",
      status: "Status",
      authLoadFail: "Failed to load auth scripts. Check network and refresh.",
    },
    zh: {
      cancel: "取消",
      confirm: "确认",
      create: "创建",
      creating: "创建中…",
      createKeyTitle: "创建新密钥",
      keyNameLabel: "密钥名称（可选）",
      keyCreatedTitle: "密钥已创建",
      keyCreatedHint: "请立即复制，关闭后将无法再次查看。",
      copy: "复制",
      close: "关闭",
      revokeTitle: "撤销密钥",
      revokeHint: "确认撤销此密钥？此操作不可恢复。",
      revoke: "撤销",
      revoking: "撤销中…",
      revokeFailed: "撤销失败：",
      createFailed: "创建失败：",
      time: "时间",
      model: "模型",
      status: "状态",
      authLoadFail: "依赖脚本加载失败，请检查网络后刷新。",
    },
  };

  function t(key) {
    var pack = I18N[LANG] || I18N.en;
    return pack[key] || I18N.en[key] || key;
  }

  function applyPageLocale() {
    document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en-US";
    if (LANG !== "zh") return;
    var pairs = [
      ["Credit remaining", "剩余额度"],
      ["Total requests", "总请求数"],
      ["Total tokens", "总 Token 数"],
      ["Current balance", "当前余额"],
      ["Wallet Balance", "钱包余额"],
      ["API Keys", "API 密钥"],
      ["Usage", "用量"],
      ["Logs", "日志"],
      ["Home", "首页"],
      ["Default project", "默认项目"],
      ["Create new secret key", "创建新密钥"],
      ["Add credits", "充值"],
      ["Overview", "概览"],
    ];
    pairs.forEach(function (p) {
      replaceAllText(p[0], p[1]);
    });
  }

  function trimSidebar() {
    document.querySelectorAll("a.HPtRB.O3ygq").forEach(function (a) {
      var label = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (HIDE_NAV.indexOf(label) >= 0) a.remove();
    });
    document.querySelectorAll('button.HPtRB.O3ygq[aria-label*="More"]').forEach(function (b) {
      b.remove();
    });
  }

  function ensureConsoleCss() {
    if (document.querySelector('link[href*="console.css"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "console.css?v=20260625-console-modal";
    document.head.appendChild(l);
  }

  function nf(n) {
    return (Number(n) || 0).toLocaleString();
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function fmtMoney(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    return "¥" + n.toFixed(2);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    } else {
      var t = el("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try {
        document.execCommand("copy");
      } catch (e) {}
      t.remove();
    }
  }

  async function getSession() {
    return window.PlatformAuth.getSession(6000);
  }

  async function call(endpoint, payload) {
    var s = await getSession();
    if (!s) throw new Error("not_logged_in");
    var r = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.__SUPABASE_ANON_KEY__,
      },
      body: JSON.stringify(
        Object.assign({ endpoint: endpoint }, payload || {}, {
          __auth_token: s.access_token,
        })
      ),
    });
    var d = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      throw Object.assign(new Error(d.message || d.error || r.statusText), {
        status: r.status,
        body: d,
      });
    }
    return d;
  }

  function findTextNodes(text, root) {
    var out = [];
    var walker = document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (n.nodeValue && n.nodeValue.trim() === text) out.push(n);
    }
    return out;
  }

  function setValueNearLabel(label, value) {
    findTextNodes(label).forEach(function (textNode) {
      var card =
        textNode.parentElement &&
        (textNode.parentElement.closest(".flex.h-full.flex-col") ||
          textNode.parentElement.closest("[class*='flex-col']") ||
          textNode.parentElement.closest("[data-testid='organization-spend-summary-section']"));
      if (!card) return;
      var valEl =
        card.querySelector(".text-lg.font-semibold") ||
        card.querySelector(".text-xl.font-semibold") ||
        card.querySelector(".font-semibold");
      if (!valEl) return;
      var textChild = null;
      for (var i = 0; i < valEl.childNodes.length; i++) {
        if (valEl.childNodes[i].nodeType === 3) {
          textChild = valEl.childNodes[i];
          break;
        }
      }
      if (textChild) textChild.nodeValue = String(value) + " ";
      else valEl.textContent = String(value);
    });
  }

  function replaceAllText(oldText, newText) {
    findTextNodes(oldText).forEach(function (n) {
      n.nodeValue = newText;
    });
  }

  function updateUserChip(user) {
    var email = (user && user.email) || "";
    var name = email.split("@")[0] || "User";
    var initial = name.charAt(0).toUpperCase() || "U";
    replaceAllText("Personal", name);
    document.querySelectorAll("span, div").forEach(function (node) {
      if (node.childNodes.length === 1 && node.textContent === "P") {
        node.textContent = initial;
      }
    });
  }

  function findCreditCard() {
    var nodes = findTextNodes("Credit remaining");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i].parentElement;
      while (el && el !== document.body) {
        if (
          el.classList &&
          (el.classList.contains("p-4") ||
            el.className.indexOf("bg-yellow") >= 0)
        ) {
          return el;
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  function applyWallet(wallet) {
    if (!wallet) return;
    var bal = Number(wallet.balance_cny != null ? wallet.balance_cny : wallet.balance);
    if (!isFinite(bal)) return;
    var money = fmtMoney(bal);
    setValueNearLabel("Credit remaining", money);
    setValueNearLabel("Current balance", money);
    setValueNearLabel("Wallet Balance", money);

    var card = findCreditCard();
    if (!card) return;
    var low = bal < WALLET_LOW_THRESHOLD;
    if (low) {
      card.classList.add("bg-yellow-25", "dark:bg-yellow-900");
    } else {
      card.classList.remove("bg-yellow-25", "dark:bg-yellow-900");
    }
  }

  function hideOverviewTokenStat() {
    if (PAGE !== "overview") return;
    findTextNodes("Total tokens").forEach(function (textNode) {
      var cell = textNode.parentElement;
      while (cell && cell !== document.body) {
        if (cell.classList && cell.classList.contains("col-span-1")) {
          cell.style.display = "none";
          return;
        }
        cell = cell.parentElement;
      }
    });
  }

  function aggregate(rows) {
    var totIn = 0;
    var totOut = 0;
    var totalRequests = 0;
    rows.forEach(function (r) {
      totIn += Number(r.tokens_in) || 0;
      totOut += Number(r.tokens_out) || 0;
      totalRequests += 1;
    });
    return {
      totalRequests: totalRequests,
      totalTokens: totIn + totOut,
    };
  }

  function closeCsModal() {
    document.querySelectorAll(".cs-modal__backdrop").forEach(function (b) {
      b.remove();
    });
    document.removeEventListener("keydown", csModalEsc);
  }

  function csModalEsc(e) {
    if (e.key === "Escape") closeCsModal();
  }

  function showModal(opts) {
    opts = opts || {};
    closeCsModal();
    var backdrop = el("div", "cs-modal__backdrop");
    var card = el(
      "div",
      "cs-modal" + (opts.kind ? " cs-modal--" + opts.kind : "")
    );
    var head =
      '<div class="cs-modal__head"><div class="cs-modal__title">' +
      esc(opts.title || "") +
      "</div></div>";
    var bodyHtml = opts.body
      ? '<div class="cs-modal__body">' + opts.body + "</div>"
      : "";
    var inputHtml = "";
    if (opts.input) {
      inputHtml =
        '<label class="cs-modal__field"><span>' +
        esc(opts.input.label || "") +
        '</span><input id="cs-modal-input" type="text" placeholder="' +
        esc(opts.input.placeholder || "") +
        '" value="' +
        esc(opts.input.value || "") +
        '" /></label>';
    }
    var foot =
      '<div class="cs-modal__foot">' +
      '<button type="button" class="csbtn csbtn--ghost" id="cs-modal-cancel">' +
      esc(opts.cancelText || t("cancel")) +
      "</button>" +
      '<button type="button" class="csbtn ' +
      (opts.confirmKind === "danger" ? "csbtn--danger" : "csbtn--primary") +
      '" id="cs-modal-ok">' +
      esc(opts.confirmText || t("confirm")) +
      "</button></div>";
    card.innerHTML = head + bodyHtml + inputHtml + foot;
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeCsModal();
    });
    card.querySelector("#cs-modal-cancel").addEventListener("click", closeCsModal);
    var okBtn = card.querySelector("#cs-modal-ok");
    var inp = card.querySelector("#cs-modal-input");
    function submit() {
      if (opts.onConfirm) opts.onConfirm(inp ? inp.value : null, card, okBtn);
    }
    okBtn.addEventListener("click", submit);
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
    }
    document.addEventListener("keydown", csModalEsc);
    return card;
  }

  function showNewKeyModal(key) {
    showModal({
      title: t("keyCreatedTitle"),
      kind: "success",
      body:
        '<p class="cs-modal__hint">' + esc(t("keyCreatedHint")) + "</p>" +
        '<div class="cs-modal__keybox"><code id="cs-new-key-code">' +
        esc(key) +
        "</code></div>",
      confirmText: t("copy"),
      cancelText: t("close"),
      onConfirm: function () {
        copyText(key);
        closeCsModal();
      },
    });
    setTimeout(function () {
      var codeEl = document.getElementById("cs-new-key-code");
      if (codeEl) {
        codeEl.addEventListener("click", function () {
          copyText(key);
        });
      }
    }, 0);
  }

  function wireCreateKeyButton(onCreate) {
    document.querySelectorAll("button").forEach(function (btn) {
      var t = (btn.textContent || "").replace(/\s+/g, " ").trim();
      if (t.indexOf("Create new secret key") >= 0) {
        btn.addEventListener(
          "click",
          function (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
            onCreate();
          },
          true
        );
      }
    });
  }

  function renderKeysList(data) {
    var mount = document.querySelector(".api-key-page-content");
    if (!mount) return;
    var keys = (data && data.keys) || [];
    var countEl = mount.querySelector(".api-keys-filter-result-count");
    if (countEl) countEl.textContent = keys.length + " results";

    var emptyBlock = mount.querySelector("._4d2eR");
    var list = document.getElementById("cnc-keys-list");
    if (!list) {
      list = document.createElement("div");
      list.id = "cnc-keys-list";
      list.className = "cnc-inline-panel";
      if (emptyBlock) mount.insertBefore(list, emptyBlock);
      else mount.appendChild(list);
    }

    if (!keys.length) {
      list.innerHTML = "";
      list.hidden = true;
      if (emptyBlock) emptyBlock.hidden = false;
      return;
    }

    if (emptyBlock) emptyBlock.hidden = true;
    list.hidden = false;
    list.innerHTML = keys
      .map(function (k) {
        var prefix = k.key_prefix || k.prefix || "cancri_sk_…";
        var name = k.name || k.label || "default";
        var created = k.created_at
          ? new Date(k.created_at).toLocaleDateString("zh-CN")
          : "—";
        var id = k.id || k.key_id || "";
        return (
          '<div class="api-key-row" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--color-border,#eee)">' +
          '<div><div style="font-weight:600">' +
          esc(name) +
          '</div><div style="font-family:monospace;font-size:13px;opacity:.75">' +
          esc(prefix) +
          "</div></div>" +
          '<div style="display:flex;align-items:center;gap:12px">' +
          '<span style="font-size:13px;opacity:.7">' +
          esc(created) +
          "</span>" +
          '<button type="button" data-del-key="' +
          esc(id) +
          '" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(127,127,127,.35);background:transparent;cursor:pointer">Revoke</button>' +
          "</div></div>"
        );
      })
      .join("");

    list.querySelectorAll("[data-del-key]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-del-key");
        if (!id) return;
        showModal({
          title: t("revokeTitle"),
          kind: "danger",
          body:
            '<p class="cs-modal__hint">' + esc(t("revokeHint")) + "</p>",
          confirmText: t("revoke"),
          confirmKind: "danger",
          onConfirm: function (val, cardEl, okBtn) {
            okBtn.disabled = true;
            okBtn.textContent = t("revoking");
            call("api_delete_key", { key_id: id, id: id })
              .then(function () {
                closeCsModal();
                return call("api_my_keys", {});
              })
              .then(renderKeysList)
              .catch(function (e) {
                okBtn.disabled = false;
                okBtn.textContent = t("revoke");
                var errEl = cardEl.querySelector(".cs-modal__err");
                if (!errEl) {
                  errEl = el("div", "cs-modal__err");
                  cardEl.querySelector(".cs-modal__foot").before(errEl);
                }
                errEl.textContent =
                  t("revokeFailed") + (e && e.message ? e.message : e);
              });
          },
        });
      });
    });
  }

  function renderLogsList(rows) {
    if (!rows || !rows.length) return;
    var panel =
      document.querySelector(".Jp-M8 ._4d2eR") ||
      document.querySelector("._4d2eR[data-fill=static]");
    if (!panel) return;

    panel.dataset.fill = "none";
    panel.style.cssText =
      "display:block;width:100%;height:auto;align-items:stretch;justify-content:flex-start";
    Array.from(panel.children).forEach(function (ch) {
      if (ch.id !== "cnc-logs-list") ch.style.display = "none";
    });

    var sorted = rows.slice().sort(function (a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
    var list = document.getElementById("cnc-logs-list");
    if (!list) {
      list = document.createElement("div");
      list.id = "cnc-logs-list";
      list.style.cssText = "padding:16px;overflow:auto;width:100%";
      panel.appendChild(list);
    }
    list.innerHTML =
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      "<thead><tr><th style=\"text-align:left;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">" +
      esc(t("time")) +
      "</th>" +
      "<th style=\"text-align:left;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">" +
      esc(t("model")) +
      "</th>" +
      "<th style=\"text-align:right;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">In</th>" +
      "<th style=\"text-align:right;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">Out</th>" +
      "<th style=\"text-align:left;padding:8px;border-bottom:1px solid rgba(127,127,127,.25)\">" +
      esc(t("status")) +
      "</th></tr></thead><tbody>" +
      sorted
        .slice(0, 200)
        .map(function (r) {
          return (
            "<tr><td style=\"padding:8px;border-bottom:1px solid rgba(127,127,127,.12)\">" +
            esc(new Date(r.created_at).toLocaleString("zh-CN")) +
            "</td><td style=\"padding:8px;border-bottom:1px solid rgba(127,127,127,.12)\">" +
            esc(r.model || "—") +
            '</td><td style="padding:8px;text-align:right;border-bottom:1px solid rgba(127,127,127,.12)">' +
            nf(r.tokens_in) +
            '</td><td style="padding:8px;text-align:right;border-bottom:1px solid rgba(127,127,127,.12)">' +
            nf(r.tokens_out) +
            "</td><td style=\"padding:8px;border-bottom:1px solid rgba(127,127,127,.12)\">" +
            esc(r.status_code || 200) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  async function boot() {
    ensureConsoleCss();
    trimSidebar();
    applyPageLocale();
    try {
      if (!window.PlatformAuth) throw new Error("supabase_not_loaded");
      var session = await PlatformAuth.requireSession({});
      if (!session) return;
      updateUserChip(session.user);
      hideOverviewTokenStat();

      var walletP = call("get_quota_status", {}).catch(function () {
        return null;
      });
      var usageP = call("api_my_usage", {}).catch(function () {
        return { usage: [] };
      });
      var keysP =
        PAGE === "keys"
          ? call("api_my_keys", {}).catch(function () {
              return { keys: [] };
            })
          : Promise.resolve(null);

      var walletRes = await walletP;
      var usageRes = await usageP;
      var keysRes = await keysP;

      applyWallet(walletRes && walletRes.wallet);

      var usage = (usageRes && usageRes.usage) || [];
      var agg = aggregate(usage);
      setValueNearLabel("Total requests", nf(agg.totalRequests));
      if (PAGE !== "overview") {
        setValueNearLabel("Total tokens", nf(agg.totalTokens));
      }

      if (PAGE === "keys") {
        renderKeysList(keysRes);
        wireCreateKeyButton(function () {
          showModal({
            title: t("createKeyTitle"),
            input: {
              label: t("keyNameLabel"),
              placeholder: "default",
              value: "default",
            },
            confirmText: t("create"),
            onConfirm: function (name, cardEl, okBtn) {
              okBtn.disabled = true;
              okBtn.textContent = t("creating");
              call("api_generate_key", { name: name || "default" })
                .then(function (d) {
                  closeCsModal();
                  if (d && d.key) showNewKeyModal(d.key);
                  return call("api_my_keys", {});
                })
                .then(renderKeysList)
                .catch(function (e) {
                  okBtn.disabled = false;
                  okBtn.textContent = t("create");
                  var errEl = cardEl.querySelector(".cs-modal__err");
                  if (!errEl) {
                    errEl = el("div", "cs-modal__err");
                    cardEl.querySelector(".cs-modal__foot").before(errEl);
                  }
                  errEl.textContent =
                    t("createFailed") + (e && e.message ? e.message : e);
                });
            },
          });
        });
      }
      if (PAGE === "logs") renderLogsList(usage);
    } catch (e) {
      if (e && e.message === "supabase_not_loaded") {
        PlatformAuth.showAuthError(t("authLoadFail"));
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
