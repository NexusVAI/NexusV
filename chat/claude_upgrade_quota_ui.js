// chat/claude_upgrade_quota_ui.js
// Claude 1:1 升级弹窗 + composer 顶部额度条。数据来自 cancri_chat.js quotaState。

(function () {
  "use strict";

  var PRICING_URL = "./pricing.html";
  var CARD_IMG_KEYS = { 0: "card0", 1: "ccode", 2: "card2", 3: "n5" };
  var modalEl = null;
  var ribbonEl = null;
  var lastRibbonKey = "";

  var FEATURE_CARDS = [
    {
      title: "Cowork",
      desc: "把任务交给 Cancri，让你专注其他工作。",
      imgKey: 0,
      href: "https://www.nexusvai.xyz/chat/",
    },
    {
      title: "CancriCode",
      desc: "用自然语言描述需求，在 IDE 里构建、调试与交付。",
      imgKey: 1,
      href: "./code/",
    },
    {
      title: "Microsoft Office",
      desc: "与 Cancri 协作分析数据、生成幻灯片与文档。",
      imgKey: 2,
      href: "./api_docs.html",
    },
    {
      title: "NexusV 平台",
      desc: "开放平台套餐、API Key 与多模型统一接入。",
      imgKey: 3,
      href: "./api/",
    },
  ];

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatTimeShort(d) {
    if (!d || Number.isNaN(d.getTime())) return "";
    return (
      (d.getHours() >= 12 ? "下午 " : "上午 ") +
      ((d.getHours() % 12) || 12) +
      ":" +
      pad2(d.getMinutes())
    );
  }

  function formatDateZh(iso) {
    if (!iso) return "";
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return Number(m[1]) + "年" + Number(m[2]) + "月" + Number(m[3]) + "日";
    }
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return (
        d.getFullYear() +
        "年" +
        (d.getMonth() + 1) +
        "月" +
        d.getDate() +
        "日"
      );
    } catch (e) {
      return String(iso);
    }
  }

  function formatPoolResetLabel(iso) {
    var date = formatDateZh(iso);
    return date ? date + " 00:00（UTC+8）" : "";
  }

  function formatBeijingMidnightLabel() {
    return "明日 0:00（UTC+8）";
  }

  function nextMidnightBeijing() {
    var now = Date.now();
    var bj = new Date(now + 8 * 3600 * 1000);
    var y = bj.getUTCFullYear();
    var m = bj.getUTCMonth();
    var d = bj.getUTCDate();
    return new Date(Date.UTC(y, m, d + 1, 0, 0, 0) - 8 * 3600 * 1000);
  }

  function estimateTokenWindowReset() {
    var snap = getSnapshot();
    if (!snap || snap.tokenWindow5hUsed == null || snap.tokenWindow5hLimit == null) {
      return null;
    }
    if (snap.tokenWindow5hUsed < snap.tokenWindow5hLimit) return null;
    return new Date(Date.now() + 5 * 3600 * 1000);
  }

  function getSnapshot() {
    if (typeof window.CancriQuotaRuntime !== "undefined" &&
        typeof window.CancriQuotaRuntime.getSnapshot === "function") {
      return window.CancriQuotaRuntime.getSnapshot();
    }
    return null;
  }

  function analyzeExhaustion(snap) {
    if (!snap || !snap.fetchedAt) return null;

    var topup = snap.topupBalance;
    var hasTopup = topup !== null && Number(topup) > 0;

    if (snap.tier === "paid") {
      var monthlyRem = snap.monthlyRemaining;
      if (monthlyRem !== null && Number(monthlyRem) <= 0 && !hasTopup) {
        return {
          kind: "paid_monthly",
          tier: "paid",
          planCode: snap.planCode,
          daysRemaining: snap.daysRemaining,
          expiresAt: snap.expiresAt,
        };
      }
      return null;
    }

    if (snap.tier !== "free") return null;

    var tw5Used = snap.tokenWindow5hUsed;
    var tw5Limit = snap.tokenWindow5hLimit;
    if (
      tw5Used !== null &&
      tw5Limit !== null &&
      Number(tw5Used) >= Number(tw5Limit)
    ) {
      return {
        kind: "free_token_5h",
        tier: "free",
        resetAt: estimateTokenWindowReset(),
      };
    }

    var twWUsed = snap.tokenWindowWeekUsed;
    var twWLimit = snap.tokenWindowWeekLimit;
    if (
      twWUsed !== null &&
      twWLimit !== null &&
      Number(twWUsed) >= Number(twWLimit)
    ) {
      return {
        kind: "free_token_week",
        tier: "free",
      };
    }

    var pool = snap.freePoolRemaining;
    var daily = snap.dailyPaidRemaining;
    var poolOut = pool !== null && Number(pool) <= 0;
    var dailyOut = daily !== null && Number(daily) <= 0;

    if (!poolOut && !dailyOut) return null;
    if (hasTopup) return null;

    if (poolOut && dailyOut) {
      return {
        kind: "free_all",
        tier: "free",
        poolPeriodEnd: snap.freePoolPeriodEnd,
        resetAt: nextMidnightBeijing(),
      };
    }
    if (dailyOut) {
      return {
        kind: "free_daily",
        tier: "free",
        resetAt: nextMidnightBeijing(),
      };
    }
    return {
      kind: "free_pool",
      tier: "free",
      poolPeriodEnd: snap.freePoolPeriodEnd,
    };
  }

  function buildModalCopy(exhaustion) {
    if (!exhaustion) {
      return {
        title: "升级以继续聊天",
        lead: "当前额度已用完，升级可获得更高限额与更多能力。",
        sub: "此外，你还可以通过以下方式使用 Cancri：",
      };
    }
    if (exhaustion.kind === "paid_monthly") {
      var days = exhaustion.daysRemaining;
      var exp = formatDateZh(exhaustion.expiresAt);
      var lead =
        "本周期月度配额与加油包均已用完" +
        (days != null && days > 0
          ? "；订阅剩余 " + days + " 天（至 " + exp + "）"
          : "") +
        "。可购买加油包立即继续使用，或升级套餐。";
      return {
        title: "升级以继续聊天",
        lead: lead,
        sub: "升级或购买加油包，解锁更多模型与更高额度：",
      };
    }
    if (exhaustion.kind === "free_token_5h") {
      var when = formatTimeShort(exhaustion.resetAt);
      return {
        title: "升级以继续聊天",
        lead:
          "你已达到 5 小时 token 窗口上限" +
          (when ? "，约于 " + when + " 起逐步恢复" : "，请稍后再试") +
          "；升级 Pro 可解除该限制。",
        sub: "此外，你还可以通过以下方式使用 Cancri：",
      };
    }
    if (exhaustion.kind === "free_token_week") {
      return {
        title: "升级以继续聊天",
        lead: "你已达到本周 token 窗口上限，请稍后再试或升级 Pro。",
        sub: "此外，你还可以通过以下方式使用 Cancri：",
      };
    }
    if (exhaustion.kind === "free_daily") {
      return {
        title: "升级以继续聊天",
        lead: "今日 PAID 模型试用次数已用完，将于 " + formatBeijingMidnightLabel() + " 重置。",
        sub: "此外，你还可以通过以下方式使用 Cancri：",
      };
    }
    if (exhaustion.kind === "free_pool" || exhaustion.kind === "free_all") {
      var pe = formatPoolResetLabel(exhaustion.poolPeriodEnd);
      return {
        title: "升级以继续聊天",
        lead:
          "免费共享池本月额度已用完" +
          (pe ? "，将于 " + pe + " 重置" : "") +
          "。",
        sub: "此外，你还可以通过以下方式使用 Cancri：",
      };
    }
    return {
      title: "升级以继续聊天",
      lead: "免费额度已用完，可升级订阅或购买加油包继续使用。",
      sub: "此外，你还可以通过以下方式使用 Cancri：",
    };
  }

  function buildRibbonCopy(exhaustion) {
    if (!exhaustion) return null;
    if (exhaustion.kind === "paid_monthly") {
      var days = exhaustion.daysRemaining;
      var exp = formatDateZh(exhaustion.expiresAt);
      return {
        message:
          "本周期配额已用完" +
          (days != null && days > 0
            ? "，订阅剩余 " + days + " 天"
            : "") +
          (exp ? "（至 " + exp + "）" : "") +
          "，可购买加油包",
        upgradeLabel: "升级 / 加油包",
      };
    }
    if (exhaustion.kind === "free_token_5h") {
      var when = formatTimeShort(exhaustion.resetAt);
      return {
        message:
          "免费 token 5 小时窗口已用完" +
          (when ? "，约 " + when + " 起恢复" : ""),
        upgradeLabel: "升级",
      };
    }
    if (exhaustion.kind === "free_token_week") {
      return {
        message: "本周免费 token 窗口已用完，请稍后再试",
        upgradeLabel: "升级",
      };
    }
    if (exhaustion.kind === "free_daily") {
      return {
        message: "今日 PAID 试用次数已用完，将于 " + formatBeijingMidnightLabel() + " 重置",
        upgradeLabel: "升级",
      };
    }
    if (exhaustion.kind === "free_pool" || exhaustion.kind === "free_all") {
      var pe = formatPoolResetLabel(exhaustion.poolPeriodEnd);
      return {
        message:
          "免费共享池已用完" + (pe ? "，将于 " + pe + " 重置" : ""),
        upgradeLabel: "升级",
      };
    }
    return {
      message: "免费额度已用完，可升级或购买加油包",
      upgradeLabel: "升级",
    };
  }

  function cardImgSrc(key) {
    var bag = window.CancriUpgradeAssets;
    var assetKey = CARD_IMG_KEYS[key];
    if (!bag || !assetKey) return "";
    return bag[assetKey] || "";
  }

  function renderFeatureCards() {
    return FEATURE_CARDS.map(function (card) {
      var src = cardImgSrc(card.imgKey);
      return (
        '<a href="' +
        escapeHtml(card.href) +
        '" target="_blank" rel="noopener noreferrer" class="claude-upgrade-card group">' +
        '<img alt="" class="claude-upgrade-card-img" src="' +
        escapeHtml(src) +
        '">' +
        '<div class="claude-upgrade-card-text">' +
        '<span class="claude-upgrade-card-title">' +
        escapeHtml(card.title) +
        "</span>" +
        '<span class="claude-upgrade-card-desc">' +
        escapeHtml(card.desc) +
        "</span>" +
        "</div></a>"
      );
    }).join("");
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.id = "claudeUpgradeQuotaModal";
    modalEl.className = "claude-upgrade-modal-root";
    modalEl.hidden = true;
    modalEl.setAttribute("aria-hidden", "true");
    modalEl.innerHTML =
      '<div class="claude-upgrade-modal-scrim" data-upgrade-close></div>' +
      '<div class="claude-upgrade-modal-panel" role="dialog" aria-modal="true" aria-labelledby="claudeUpgradeModalTitle">' +
      '<div class="claude-upgrade-modal-body">' +
      '<div class="claude-upgrade-modal-head">' +
      '<h1 class="claude-upgrade-modal-title" id="claudeUpgradeModalTitle"></h1>' +
      '<p class="claude-upgrade-modal-lead" id="claudeUpgradeModalLead"></p>' +
      '<p class="claude-upgrade-modal-sub" id="claudeUpgradeModalSub"></p>' +
      "</div>" +
      '<div class="claude-upgrade-modal-cards-wrap">' +
      '<div class="claude-upgrade-modal-cards" id="claudeUpgradeModalCards"></div>' +
      "</div>" +
      '<div class="claude-upgrade-modal-actions">' +
      '<button type="button" class="claude-upgrade-btn-secondary" data-upgrade-close>暂不升级</button>' +
      '<a class="claude-upgrade-btn-primary" id="claudeUpgradeModalCta" href="' +
      PRICING_URL +
      '">查看套餐</a>' +
      "</div>" +
      "</div></div>";
    document.body.appendChild(modalEl);

    modalEl.addEventListener("click", function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest("[data-upgrade-close]")) {
        closeModal();
      }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && modalEl && !modalEl.hidden) closeModal();
    });
    return modalEl;
  }

  function ensureRibbon() {
    if (ribbonEl) return ribbonEl;
    ribbonEl = document.getElementById("claudeComposerQuotaRibbon");
    if (!ribbonEl) {
      var wrap = document.querySelector("#homeView .composer-wrap");
      if (!wrap) return null;
      ribbonEl = document.createElement("div");
      ribbonEl.id = "claudeComposerQuotaRibbon";
      ribbonEl.className = "claude-composer-quota-ribbon";
      ribbonEl.hidden = true;
      wrap.insertBefore(ribbonEl, wrap.firstChild);
    }
    return ribbonEl;
  }

  function openModal(reason) {
    var snap = getSnapshot();
    var exhaustion = analyzeExhaustion(snap) || { kind: reason || "generic" };
    var copy = buildModalCopy(exhaustion);
    var modal = ensureModal();
    modal.querySelector("#claudeUpgradeModalTitle").textContent = copy.title;
    modal.querySelector("#claudeUpgradeModalLead").textContent = copy.lead;
    modal.querySelector("#claudeUpgradeModalSub").textContent = copy.sub;
    modal.querySelector("#claudeUpgradeModalCards").innerHTML = renderFeatureCards();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("claude-upgrade-modal-open");
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.hidden = true;
    modalEl.setAttribute("aria-hidden", "true");
    document.body.classList.remove("claude-upgrade-modal-open");
  }

  function renderRibbon() {
    var ribbon = ensureRibbon();
    if (!ribbon) return;
    var snap = getSnapshot();
    var exhaustion = analyzeExhaustion(snap);
    if (!exhaustion) {
      ribbon.hidden = true;
      ribbon.innerHTML = "";
      lastRibbonKey = "";
      var legacy = document.getElementById("freeQuotaBanner");
      if (legacy) {
        legacy.hidden = true;
        legacy.textContent = "";
      }
      return;
    }
    var copy = buildRibbonCopy(exhaustion);
    if (!copy) {
      ribbon.hidden = true;
      return;
    }
    var key = exhaustion.kind + "|" + copy.message;
    if (key === lastRibbonKey && !ribbon.hidden) return;
    lastRibbonKey = key;
    ribbon.innerHTML =
      '<div class="claude-composer-quota-ribbon-inner">' +
      '<div class="claude-composer-quota-ribbon-msg">' +
      '<div class="text-sm">' +
      escapeHtml(copy.message) +
      "</div></div>" +
      '<div class="claude-composer-quota-ribbon-action">' +
      '<a href="' +
      PRICING_URL +
      '" class="claude-composer-quota-upgrade-link">' +
      escapeHtml(copy.upgradeLabel) +
      "</a></div></div>";
    ribbon.hidden = false;

    var legacy = document.getElementById("freeQuotaBanner");
    if (legacy) {
      legacy.hidden = true;
      legacy.textContent = "";
    }
  }

  function init() {
    renderRibbon();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.CancriUpgradeQuotaUI = {
    renderRibbon: renderRibbon,
    openModal: openModal,
    closeModal: closeModal,
    analyzeExhaustion: analyzeExhaustion,
  };
})();
