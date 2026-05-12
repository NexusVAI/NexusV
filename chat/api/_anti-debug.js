// _anti-debug.js — 轻量反调试（仅防小白）
//
// ⚠️  注意：此脚本只是给"第一波小人"添堵——
//   关闭 JS、命令行启动 devtools、抓包工具都能轻易绕过。
//   真正的安全门必须在后端（chat-gateway 的 ADMIN_USER_IDS / 速率限制 / Turnstile）。
//
// 行为：
//   1. 拦截 F12 / Ctrl+Shift+I/J/C / Ctrl+U / 右键菜单
//   2. 启发式检测 devtools 打开（通过 outerWidth-innerWidth 差值），
//      检测到则把 [data-sensitive] 标记的元素模糊化并打印警告
//
// 用法：在 HTML <head> 里 <script src="./_anti-debug.js"></script>
//   并给敏感内容加 data-sensitive 属性。
(function () {
  "use strict";

  // ─── 1. 拦截快捷键 ───
  const blockedHotkey = (e) => {
    const k = (e.key || "").toLowerCase();
    if (k === "f12") return true;
    if (e.ctrlKey && e.shiftKey && (k === "i" || k === "j" || k === "c"))
      return true;
    if (e.metaKey && e.altKey && (k === "i" || k === "j")) return true; // mac
    if (e.ctrlKey && k === "u") return true; // view-source
    if (e.ctrlKey && k === "s") return true; // save page
    return false;
  };
  document.addEventListener(
    "keydown",
    (e) => {
      if (blockedHotkey(e)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    },
    true,
  );

  // ─── 2. 禁用右键菜单 ───
  document.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
      return false;
    },
    true,
  );

  // ─── 3. 检测 devtools 打开 ───
  let warned = false;
  const obfuscate = () => {
    if (warned) return;
    warned = true;
    document.querySelectorAll("[data-sensitive]").forEach((el) => {
      el.style.filter = "blur(10px)";
      el.style.pointerEvents = "none";
      el.setAttribute("aria-hidden", "true");
    });
    // 装饰性警告（小白会被吓到）
    try {
      const styleBig =
        "color:#f87171;font-size:32px;font-weight:bold;text-shadow:0 0 8px #f87171;";
      const styleSmall = "color:#9a9a9a;font-size:13px;";
      console.log("%c⚠ 警告", styleBig);
      console.log(
        "%c为保护账号安全，已检测到开发者工具被打开。\n敏感数据已模糊处理。\n请关闭开发者工具后刷新页面。",
        styleSmall,
      );
    } catch (_e) {
      // ignore
    }
  };

  // 通过 window 内外尺寸差检测 devtools。docked 时 ≥160 触发；
  // 浮窗 (undocked) 模式下不可靠，但作为补充信号 console.log 钩子也设。
  setInterval(() => {
    const threshold = 160;
    const wDiff = window.outerWidth - window.innerWidth;
    const hDiff = window.outerHeight - window.innerHeight;
    if (wDiff > threshold || hDiff > threshold) obfuscate();
  }, 1000);

  // 通过对象 toString 钩子检测 console 是否被使用（懒人 devtools）
  const probe = /./;
  probe.toString = function () {
    obfuscate();
    return "";
  };
  setInterval(() => {
    try {
      console.log(probe);
      console.clear();
    } catch (_e) {
      // ignore
    }
  }, 2000);
})();
