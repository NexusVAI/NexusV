// celebrate_lottery.js — Phase 5b 互动抽奖结果展示
// 由 celebrate-signin 返回的 lottery 字段触发。中奖弹大卡片；未中奖小 toast；
// 已领过/到日限的安静处理（避免骚扰已经做过这个动作的用户）。
//
// 用法：window.celebrateShowLottery(lottery, kind)
//   lottery: { ok, tier, tokens, message, reason?, daily_remaining? } | null
//   kind: 'chronicle_comment' | 'like'
(function () {
  "use strict";

  // ─── 样式只注入一次 ───
  function injectStyles() {
    if (document.getElementById("celebrate-lottery-styles")) return;
    var s = document.createElement("style");
    s.id = "celebrate-lottery-styles";
    s.textContent = [
      ".celebrate-lottery-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);z-index:99999;opacity:0;transition:opacity .25s;}",
      ".celebrate-lottery-overlay.show{opacity:1;}",
      ".celebrate-lottery-card{background:linear-gradient(140deg,#1a1410 0%,#2a1b0e 100%);color:#f7e9c8;border:1px solid #d4a04d;border-radius:18px;padding:32px 28px 26px;max-width:340px;width:calc(100% - 48px);box-shadow:0 24px 60px rgba(0,0,0,.5),0 0 0 1px rgba(212,160,77,.25);transform:scale(.86);transition:transform .35s cubic-bezier(.2,1,.3,1.15);text-align:center;}",
      ".celebrate-lottery-overlay.show .celebrate-lottery-card{transform:scale(1);}",
      ".celebrate-lottery-emoji{font-size:54px;line-height:1;margin-bottom:12px;display:block;animation:celebrate-lottery-bounce 1s ease-in-out infinite alternate;}",
      "@keyframes celebrate-lottery-bounce{from{transform:translateY(0) rotate(-6deg);}to{transform:translateY(-8px) rotate(6deg);}}",
      ".celebrate-lottery-title{font-size:22px;font-weight:700;margin:0 0 8px;color:#ffd584;letter-spacing:1px;}",
      ".celebrate-lottery-amount{font-size:34px;font-weight:800;margin:6px 0 14px;background:linear-gradient(120deg,#ffd584 0%,#fff5d9 50%,#ffd584 100%);background-clip:text;-webkit-background-clip:text;color:transparent;}",
      ".celebrate-lottery-amount small{display:block;font-size:13px;color:#c9a266;font-weight:500;margin-top:4px;letter-spacing:0.5px;}",
      ".celebrate-lottery-sub{font-size:13px;color:#c9b289;margin:0 0 22px;line-height:1.6;}",
      ".celebrate-lottery-btn{background:linear-gradient(120deg,#d4a04d,#e8b85f);color:#1a1208;border:none;border-radius:999px;padding:11px 32px;font-size:14px;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .15s;}",
      ".celebrate-lottery-btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(212,160,77,.4);}",
      ".celebrate-lottery-mini{position:fixed;left:50%;top:24px;transform:translateX(-50%) translateY(-12px);background:#1a1410;color:#f7e9c8;border:1px solid #d4a04d;border-radius:10px;padding:10px 18px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.4);opacity:0;transition:opacity .25s,transform .25s;z-index:99998;pointer-events:none;}",
      ".celebrate-lottery-mini.show{opacity:1;transform:translateX(-50%) translateY(0);}",
    ].join("\n");
    document.head.appendChild(s);
  }

  // ─── 中奖大弹窗 ───
  function showJackpot(opts) {
    injectStyles();
    var overlay = document.createElement("div");
    overlay.className = "celebrate-lottery-overlay";
    overlay.innerHTML =
      '<div class="celebrate-lottery-card" role="dialog" aria-modal="true" aria-label="中奖通知">' +
      '<span class="celebrate-lottery-emoji">' + opts.emoji + "</span>" +
      '<h3 class="celebrate-lottery-title">' + opts.title + "</h3>" +
      '<div class="celebrate-lottery-amount">' + opts.amount +
      (opts.sub ? '<small>' + opts.sub + '</small>' : "") +
      "</div>" +
      '<p class="celebrate-lottery-sub">' + (opts.note || "") + "</p>" +
      '<button class="celebrate-lottery-btn" type="button">收下</button>' +
      "</div>";
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add("show"); });

    function close() {
      overlay.classList.remove("show");
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 300);
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    overlay.querySelector("button").addEventListener("click", close);
    // 8 秒兜底自动关
    setTimeout(close, 12000);
  }

  // ─── 小 toast（用于 miss 或安慰提示） ───
  function showMini(msg) {
    injectStyles();
    var t = document.createElement("div");
    t.className = "celebrate-lottery-mini";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
      }, 300);
    }, 2400);
  }

  function fmtTokens(n) {
    if (n >= 10000000) return (n / 10000000).toFixed(0) + " 千万";
    if (n >= 1000000) return (n / 1000000).toFixed(0) + " 百万";
    if (n >= 10000) return (n / 10000).toFixed(0) + " 万";
    return String(n);
  }

  function show(lottery, kind) {
    if (!lottery || typeof lottery !== "object") return;

    // ok=false 的处理
    if (lottery.ok === false) {
      var reason = String(lottery.reason || "");
      if (reason === "already_claimed" || reason === "already_drawn_for_target") {
        // 静默：用户已经领过这个奖了，不刷屏
        return;
      }
      if (reason === "daily_cap_reached") {
        showMini("今日点赞抽奖已用完，明天再来吧 ✨");
        return;
      }
      if (reason === "banned") {
        // 极少触发，但静默处理避免暴露内部状态
        return;
      }
      // 其他未知原因：debug log，不弹给用户
      console.warn("[celebrate-lottery] unknown reason", reason, lottery);
      return;
    }

    if (lottery.ok !== true) return;

    var tier = String(lottery.tier || "");
    var tokens = Number(lottery.tokens || 0);

    // miss：安慰小 toast
    if (tier === "miss" || tokens === 0) {
      showMini("感谢你的点赞 ❤  下次说不定就中啦");
      return;
    }

    // 中奖：大弹窗
    var emoji, title, note;
    if (kind === "chronicle_comment") {
      emoji = tier === "tier3" ? "🌟" : (tier === "tier2" ? "🎉" : "🎁");
      title = "感谢你的评论！";
      note = "已自动到账你的 token 余额，可在订单页查看。每位用户限领一次。";
    } else {
      emoji = tier === "tier2" ? "💫" : "✨";
      title = "点赞抽中啦！";
      var remaining = lottery.daily_remaining;
      note = "已自动到账。" + (typeof remaining === "number"
        ? "今天还能抽 " + remaining + " 次。"
        : "");
    }

    showJackpot({
      emoji: emoji,
      title: title,
      amount: "+ " + fmtTokens(tokens) + " token",
      sub: lottery.message || "",
      note: note,
    });
  }

  window.celebrateShowLottery = show;
})();
