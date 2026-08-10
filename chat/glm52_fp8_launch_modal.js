/* GLM-5.2 FP8 限时上线公告战役配置。
   壳样式/交互见 model_launch_modal.js（Fable5 f5lm）。
   END_AT 必须与后端访问期同日：cf-gateway/src/shared-catalog.ts 与
   cf-modelscope-proxy/src/index.ts 的 MODEL_ACCESS_END_MS。 */
(function () {
  "use strict";

  if (!window.NexusVModelLaunch || typeof window.NexusVModelLaunch.mount !== "function") {
    console.warn("[glm52-launch] NexusVModelLaunch missing; load model_launch_modal.js first");
    return;
  }

  var MODEL_ID = "glm-5.2-fp8";

  window.NexusVModelLaunch.mount({
    id: "glm52-fp8",
    seenKey: "nexusv_glm52_fp8_launch_v1",
    killParam: "noglm52",
    endAt: "2026-08-15T23:59:59+08:00",
    badge: false,
    titleHtml: "部署在我们硬件上的<br />GLM-5.2 FP8 版本<sup>1</sup>",
    leadHtml: "即刻体验部署在 NexusV AI 硬件上的 GLM-5.2 FP8。",
    noteHtml: "<sup>1</sup> 确保你了解了我们的政策",
    media: {
      type: "image",
      srcChat: "../Logo/9156717884b690b7cc98e5fceb253ea1.png",
      srcApi: "Logo/9156717884b690b7cc98e5fceb253ea1.png",
      alt: "GLM-5.2 FP8",
    },
    primary: {
      label: "即刻使用 →",
      hrefChat: "./api_models.html#cancri-free-section",
      hrefApi: "chat/api_models.html#cancri-free-section",
    },
    secondary: { label: "稍后再说" },
  });
})();
