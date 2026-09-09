// pricing-page.js — Cancri 套餐定价页交互（Claude upgrade 页 1:1 搬运版）
// 结构与样式来自 claude.ai/upgrade 静态导出；此脚本只补三件事：
// 1. 顶部返回按钮 → 返回上一页（无历史则回 Chat 首页）
// 2. 「个人套餐 / API 按量充值」分段控件 → 第二段跳转 API 控制台结算页
// 3. Plus 卡片内「月付 / 按量对比」分段 → 纯锚定展示，点击无副作用
//
// ⚠️ 三个「订购 X 套餐」按钮**不需要**在这里绑 handler：整张套餐卡片外面包着一个
//    <a>，按钮的点击会冒泡到它完成跳转。曾经在这里给按钮另加过一次 window.open，
//    结果是一次点击开两个标签页。跳转目标改到发卡店商品页了，改的是 pricing.html
//    里那三个 <a href>，不是这里。
(function () {
  "use strict";

  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  onReady(function () {
    // 1. 返回按钮（header 内第一个 button）
    var back = document.querySelector("header button");
    if (back) {
      back.addEventListener("click", function () {
        if (history.length > 1) history.back();
        else location.href = "index.html";
      });
    }

    // 2. 顶部分段控件：API 按量充值 → api/billing.html
    var apiSeg = document.querySelector('button[aria-label="API 按量充值"]');
    if (apiSeg) {
      apiSeg.addEventListener("click", function () {
        location.href = "api/billing.html";
      });
    }

  });
})();
