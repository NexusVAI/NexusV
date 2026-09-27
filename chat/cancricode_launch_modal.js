/* Cancri Code 3 桌面端上线公告配置。
   壳样式/交互见 model_launch_modal.js（Fable5 f5lm）。
   每个 surface（chat / api）各只显示一次，由 seenKey 记录。 */
(function () {
  "use strict";

  if (!window.NexusVModelLaunch || typeof window.NexusVModelLaunch.mount !== "function") {
    console.warn("[cancricode-launch] NexusVModelLaunch missing; load model_launch_modal.js first");
    return;
  }

  window.NexusVModelLaunch.mount({
    id: "cancricode-3",
    seenKey: "nexusv_cancricode3_launch_v1",
    killParam: "nocc3",
    badge: "全新上线",
    titleHtml: "Cancri Code 3<br />见识一下你的软件工程师",
    leadHtml: "读得懂整个项目、在云端沙箱里动手干活、改完先验证再交付。Windows 桌面端现已开放下载。",
    media: {
      type: "video",
      srcChat: "../Logo/CancriCode3-Intro.mp4",
      srcApi: "../../Logo/CancriCode3-Intro.mp4",
      alt: "Cancri Code 3",
    },
    primary: {
      label: "去了解CancriCode",
      hrefChat: "https://www.nexusvai.xyz/cancricode/",
      hrefApi: "https://www.nexusvai.xyz/cancricode/",
    },
    secondary: { label: "现在不行" },
  });
})();
