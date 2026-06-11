/* Cancri · 冠军预测活动页 */
(function () {
  "use strict";

  var CHAT_URL = "./index.html";
  var DEFAULT_QUESTION =
    "帮我分析 2026 世界杯冠军热门球队，并给出你的预测理由";
  var SUPABASE_BASE =
    (
      (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz").replace(/\/+$/, "") +
      "/functions/v1"
    );
  var SUPPORT_URL = SUPABASE_BASE + "/wc2026-support";

  var state = {
    status: null,
    pendingTeam: null,
    locked: false,
  };

  var _supabaseClient = null;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function formatTokens(n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + " 亿";
    if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1) + " 万";
    return n.toLocaleString("zh-CN");
  }

  function flagSrc(team) {
    if (!team || !team.flag) return "./assets/wc-flags/unknown.png";
    return "./assets/wc-flags/" + team.flag + ".png";
  }

  function flagImgHtml(team, className) {
    var cls = className || "cp-team-flag-img";
    var name = team && team.name ? team.name : "";
    return (
      '<img class="' +
      cls +
      '" src="' +
      flagSrc(team) +
      '" alt="' +
      name +
      '" width="48" height="36" loading="lazy" decoding="async" />'
    );
  }

  function findTeam(code) {
    var list = window.WC2026_TEAMS || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].code === code) return list[i];
    }
    var btn = document.querySelector(
      ".cp-team-btn[data-team-code=\"" + code + "\"]"
    );
    if (btn) {
      return {
        code: code,
        name: btn.getAttribute("data-team-name") || code,
        flag: btn.getAttribute("data-team-flag") || "un",
      };
    }
    return null;
  }

  function teamFromButton(btn) {
    return {
      code: btn.getAttribute("data-team-code") || "",
      name: btn.getAttribute("data-team-name") || "",
      flag: btn.getAttribute("data-team-flag") || "un",
    };
  }

  function updateTeamGridState() {
    var grid = $("#cpTeamGrid");
    if (!grid) return;
    var selected =
      state.status && state.status.supported ? state.status.team_code : null;
    state.locked = Boolean(selected);
    grid.querySelectorAll(".cp-team-btn").forEach(function (btn) {
      var code = btn.getAttribute("data-team-code");
      btn.disabled = state.locked;
      btn.classList.remove("is-selected", "is-muted");
      if (state.locked) {
        if (code === selected) btn.classList.add("is-selected");
        else btn.classList.add("is-muted");
      }
    });
  }

  function bindTeamGridClicks() {
    var grid = $("#cpTeamGrid");
    if (!grid || grid.dataset.clicksBound) return;
    grid.dataset.clicksBound = "1";
    grid.querySelectorAll(".cp-team-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (state.locked) return;
        var team = teamFromButton(btn);
        if (!team.code) return;
        openConfirmModal(team);
      });
    });

    var filter = $("#cpTeamFilter");
    if (filter && !filter.dataset.bound) {
      filter.dataset.bound = "1";
      filter.addEventListener("input", function () {
        var q = filter.value.trim().toLowerCase();
        grid.querySelectorAll(".cp-team-btn").forEach(function (el) {
          var name = (el.getAttribute("data-team-name") || "").toLowerCase();
          var code = (el.getAttribute("data-team-code") || "").toLowerCase();
          el.hidden = q && name.indexOf(q) < 0 && code.indexOf(q) < 0;
        });
      });
    }
  }

  function chatUrlForQuestion(text) {
    return CHAT_URL + "?q=" + encodeURIComponent(text);
  }

  function getSupabaseClient() {
    if (_supabaseClient) return _supabaseClient;
    var url = window.__SUPABASE_URL__;
    var key = window.__SUPABASE_ANON_KEY__;
    if (!url || !key || !window.supabase || !window.supabase.createClient) return null;
    _supabaseClient = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "cancri_supabase_auth",
      },
    });
    return _supabaseClient;
  }

  function getAccessToken() {
    var sb = getSupabaseClient();
    if (!sb) return Promise.resolve(null);
    return sb.auth
      .getSession()
      .then(function (res) {
        var session = res && res.data && res.data.session;
        return session && session.access_token ? session.access_token : null;
      })
      .catch(function () {
        return null;
      });
  }

  function apiPost(body) {
    return getAccessToken().then(function (token) {
      if (!token) return { error: "not_logged_in" };
      return fetch(SUPPORT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          apikey: window.__SUPABASE_ANON_KEY__ || "",
        },
        body: JSON.stringify(body),
      }).then(function (res) {
        return res.json().then(function (data) {
          return { httpStatus: res.status, data: data };
        });
      });
    });
  }

  function bindPromptButtons() {
    document.querySelectorAll("[data-cp-prompt]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.getAttribute("data-cp-prompt") || "";
        if (!text) return;
        window.location.href = chatUrlForQuestion(text);
      });
      btn.addEventListener("mouseenter", function () {
        document.querySelectorAll(".cp-prompt-btn").forEach(function (b) {
          b.classList.remove("is-active");
        });
        btn.classList.add("is-active");
      });
    });
  }

  function bindHeroAndCta() {
    document.querySelectorAll("[data-cp-cta]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        window.location.href = chatUrlForQuestion(DEFAULT_QUESTION);
      });
    });
  }

  function initPromptStack() {
    var first = document.querySelector(".cp-prompt-btn");
    if (first) first.classList.add("is-active");
  }

  function renderStatusPanel(status, errKind) {
    var panel = $("#cpSupportStatus");
    if (!panel) return;

    if (errKind === "loading") {
      panel.innerHTML = '<p class="cp-support-msg">正在同步你的主队状态…</p>';
      return;
    }

    if (errKind === "not_logged_in") {
      panel.innerHTML =
        '<p class="cp-support-msg">登录后从下方 <strong>48 支参赛队</strong> 中选主队，<strong>选定后不可更改</strong>。</p>' +
        '<a class="celebrate-btn celebrate-btn--primary" href="./index.html">去登录 / 工作台</a>';
      return;
    }

    if (errKind === "error") {
      panel.innerHTML =
        '<p class="cp-support-msg cp-support-msg--warn">状态加载失败，仍可先选主队；请刷新或稍后重试。</p>';
      return;
    }

    if (!status || !status.supported) {
      var perWin = status && status.tokens_per_win ? status.tokens_per_win : 100000;
      var pts = status && status.points_per_win ? status.points_per_win : 10;
      panel.innerHTML =
        '<p class="cp-support-msg">点击国旗选择主队。每赢一场，你获得 <strong>' +
        formatTokens(perWin) +
        " Token</strong>（" +
        pts +
        " 积分 × 1 万）· <strong>不可更改</strong></p>";
      return;
    }

    var team = findTeam(status.team_code) || {
      code: status.team_code,
      name: status.team_name,
      flag: "un",
    };
    var wins = status.team_wins || 0;
    var earned = status.tokens_earned || 0;
    var perWin = status.tokens_per_win || 100000;

    panel.innerHTML =
      '<div class="cp-supported-card">' +
      '<div class="cp-supported-flag-wrap">' +
      flagImgHtml(team, "cp-supported-flag-img") +
      "</div>" +
      '<div class="cp-supported-body">' +
      '<p class="cp-supported-label">我的主队</p>' +
      '<p class="cp-supported-name">' +
      team.name +
      ' <span class="cp-supported-code">' +
      team.code +
      "</span></p>" +
      '<p class="cp-supported-stats">主队已赢 <strong>' +
      wins +
      "</strong> 场 · 我已获得 <strong>" +
      formatTokens(earned) +
      " Token</strong></p>" +
      '<p class="cp-supported-hint">每场胜利 +" +
      formatTokens(perWin) +
      " Token · 已锁定</p>" +
      "</div></div>";
  }

  function renderTeamGrid() {
    var grid = $("#cpTeamGrid");
    if (!grid) return;

    if (grid.querySelector(".cp-team-btn")) {
      updateTeamGridState();
      bindTeamGridClicks();
      return;
    }

    var teams = window.WC2026_TEAMS || [];
    var selected =
      state.status && state.status.supported ? state.status.team_code : null;
    state.locked = Boolean(selected);

    grid.textContent = "";
    if (!teams.length) {
      grid.innerHTML =
        '<p class="cp-support-msg">球队列表加载失败，请刷新页面。</p>';
      return;
    }

    teams.forEach(function (team) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cp-team-btn";
      btn.setAttribute("data-team-code", team.code);
      btn.setAttribute("data-team-name", team.name);
      btn.setAttribute("data-team-flag", team.flag || "un");
      btn.setAttribute("aria-label", team.name);

      if (state.locked) {
        btn.disabled = true;
        if (team.code === selected) btn.classList.add("is-selected");
        else btn.classList.add("is-muted");
      }

      btn.innerHTML =
        flagImgHtml(team, "cp-team-flag-img") +
        '<span class="cp-team-name">' +
        team.name +
        "</span>" +
        '<span class="cp-team-code">' +
        team.code +
        "</span>";

      grid.appendChild(btn);
    });

    bindTeamGridClicks();
  }

  function openConfirmModal(team) {
    if (state.locked) return;
    state.pendingTeam = team;
    var modal = $("#cpConfirmModal");
    var title = $("#cpConfirmTitle");
    var flagWrap = $("#cpConfirmFlagWrap");
    if (!modal || !title || !flagWrap) return;
    title.textContent = "确认支持 " + team.name + "？";
    flagWrap.innerHTML = flagImgHtml(team, "cp-modal-flag-img");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function closeConfirmModal() {
    var modal = $("#cpConfirmModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    state.pendingTeam = null;
  }

  function bindModal() {
    var modal = $("#cpConfirmModal");
    if (!modal) return;

    modal.querySelectorAll("[data-cp-modal-close]").forEach(function (el) {
      el.addEventListener("click", closeConfirmModal);
    });

    var confirmBtn = $("#cpConfirmBtn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        if (!state.pendingTeam || state.locked) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = "提交中…";

        apiPost({
          action: "pick_team",
          team_code: state.pendingTeam.code,
          team_name: state.pendingTeam.name,
        })
          .then(function (result) {
            if (result.error === "not_logged_in") {
              window.location.href = "./index.html";
              return;
            }
            var data = result.data;
            if (data && data.ok && data.status) {
              state.status = data.status;
              closeConfirmModal();
              renderStatusPanel(state.status);
              renderTeamGrid();
              return;
            }
            if (
              data &&
              data.pick &&
              data.pick.reason === "already_supported"
            ) {
              fetchSupportStatus();
              return;
            }
            alert((data && data.message) || "支持失败，请稍后重试");
          })
          .catch(function () {
            alert("网络错误，请稍后重试");
          })
          .finally(function () {
            confirmBtn.disabled = false;
            confirmBtn.textContent = "确认支持";
          });
      });
    }
  }

  function fetchSupportStatus() {
    renderStatusPanel(null, "loading");
    return apiPost({ action: "status" }).then(function (result) {
      if (result.error === "not_logged_in") {
        state.status = null;
        renderStatusPanel(null, "not_logged_in");
        renderTeamGrid();
        return;
      }
      var data = result.data;
      if (!data || !data.ok || !data.status) {
        renderStatusPanel(null, "error");
        renderTeamGrid();
        return;
      }
      state.status = data.status;
      renderStatusPanel(state.status);
      renderTeamGrid();
    });
  }

  function initSupport() {
    bindModal();
    renderStatusPanel(null, "loading");
    renderTeamGrid();

    var attempts = 0;
    (function tryFetch() {
      if (window.supabase && window.supabase.createClient) {
        fetchSupportStatus();
        return;
      }
      attempts++;
      if (attempts < 24) {
        setTimeout(tryFetch, 200);
      } else {
        renderStatusPanel(null, "not_logged_in");
        renderTeamGrid();
      }
    })();
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindPromptButtons();
    bindHeroAndCta();
    initPromptStack();
    initSupport();
  });
})();
