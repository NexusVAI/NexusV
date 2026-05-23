// 2026-05-24: 用户申诉表单脚本（chat/appeal.html 用）。
//
// 流程：
//   1. 读 supabase auth session → 必须登录（即使被封也能登录，只是不能调 chat）
//   2. ?reason=xxx 翻译成中文 banner（封禁原因）
//   3. submit → POST chat-gateway endpoint='submit_appeal'
//      （submit_appeal 在 chat-gateway 里被放在 ban-check 之前，所以
//       已封禁用户也能调用）
//   4. 后端写 account_appeals row，admin 在 admin_appeals.html 处理。
//
// 24h 内最多 3 次（后端 enforce），超过返回 429 + code='too_many_appeals'。

(function () {
  "use strict";

  const SUPABASE_URL =
    (window.__SUPABASE_URL__ || "").trim() ||
    `${window.location.origin}/api/supabase`;
  const SUPABASE_ANON_KEY = (window.__SUPABASE_ANON_KEY__ || "").trim();
  const EDGE = `${SUPABASE_URL}/functions/v1/chat-gateway`;

  const $ = (id) => document.getElementById(id);

  function reasonLabel(code) {
    const map = {
      captcha_failed: "您因连续 3 次答错算术验证而被自动封禁。",
      captcha_failed_3_attempts: "您因连续 3 次答错算术验证而被自动封禁。",
      captcha_timeout: "您因 5 分钟内未完成人机校验而被自动封禁。",
      failed: "您因人机校验失败而被自动封禁。",
      expired: "您因人机校验超时而被自动封禁。",
    };
    return map[code] || null;
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const reasonCode = params.get("reason");
    const reasonText = reasonLabel(reasonCode);
    if (reasonText) {
      const banner = $("reason-banner");
      banner.textContent = reasonText + " 请通过本表单提交申诉。";
      banner.style.display = "";
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
      $("loading").style.display = "none";
      $("login-gate").style.display = "";
      return;
    }
    const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storageKey: "cancri_supabase_auth",
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    const { data: sessRes } = await supa.auth.getSession();
    const session = sessRes?.session;
    if (!session?.user) {
      $("loading").style.display = "none";
      $("login-gate").style.display = "";
      return;
    }
    $("loading").style.display = "none";
    $("form-card").style.display = "";
    $("email").value = session.user.email || "";

    const reasonInput = $("reason");
    const counter = $("reason-count");
    reasonInput.addEventListener("input", () => {
      counter.textContent = reasonInput.value.length;
    });

    $("appeal-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("email").value.trim();
      const reason = reasonInput.value.trim();
      const imageUrl = $("image_url").value.trim();
      const errBox = $("error-banner");
      errBox.style.display = "none";

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errBox.textContent = "邮箱格式不合法";
        errBox.style.display = "";
        return;
      }
      if (reason.length < 10) {
        errBox.textContent = "申诉理由至少 10 字";
        errBox.style.display = "";
        return;
      }

      const submitBtn = $("submit-btn");
      submitBtn.disabled = true;
      submitBtn.textContent = "提交中…";

      try {
        const resp = await fetch(EDGE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            endpoint: "submit_appeal",
            __auth_token: session.access_token,
            email,
            reason,
            image_url: imageUrl || null,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          errBox.textContent =
            data.message || data.error || `HTTP ${resp.status}`;
          errBox.style.display = "";
          submitBtn.disabled = false;
          submitBtn.textContent = "提交申诉";
          return;
        }
        $("form-card").style.display = "none";
        $("success").style.display = "";
        if (data.message) $("success-msg").textContent = data.message;
      } catch (err) {
        errBox.textContent = "网络异常，请稍后重试。";
        errBox.style.display = "";
        submitBtn.disabled = false;
        submitBtn.textContent = "提交申诉";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
