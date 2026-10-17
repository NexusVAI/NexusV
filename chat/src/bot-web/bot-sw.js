/*
 * Cancri Bot 网页推送 Service Worker（chat/bot-sw.js，作用域 /chat/）。
 * 只管 Bot 通知，不做离线缓存：
 *  - push：云端 BotHub 发来 {title, body, tag, conv, url}。正在前台看同一个会话时不弹（页面里已经看到了）；
 *    页面在前台但看别的会话时静音弹出。
 *  - notificationclick：已经开着的 Bot 页面直接切到那个会话，否则新开窗口。
 * 源文件在 src/bot-web/bot-sw.js，`npm run build:bot` 原样拷到根目录。
 */
// Service Worker 全局（self / clients）在 eslint.config.js 里按 globals.serviceworker 声明
const ICON = "./assets/bot-icon-192.png";
const BADGE = "./assets/bot-badge-96.png";

/** 各个页面（clientId）报上来的：正在看哪个会话、是否在前台 */
const views = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const id = event.source && event.source.id;
  const d = event.data || {};
  if (!id) return;
  const prev = views.get(id) || { conv: null, visible: true };
  if (d.type === "active") views.set(id, { ...prev, conv: d.conv || null });
  else if (d.type === "visible") views.set(id, { ...prev, visible: !!d.visible });
});

function isBotPage(client) {
  try {
    const u = new URL(client.url);
    return /\/chat\/bot(\.html)?$/.test(u.pathname);
  } catch {
    return false;
  }
}

async function focusedBotPages() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.filter((c) => isBotPage(c) && c.visibilityState === "visible");
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Cancri Bot", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      const pages = await focusedBotPages();
      const watching = pages.some((c) => {
        const v = views.get(c.id);
        return c.focused && v && v.visible !== false && data.conv && v.conv === data.conv;
      });
      // 正在看这个会话：不打扰（iOS 要求每个 push 都显示通知，否则会被收回推送权限，所以 iOS 仍显示但静音）
      const ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent);
      if (watching && !ios) return;
      const url = new URL(data.url || "./bot.html", self.registration.scope).href;
      const tag = data.tag || data.conv || "cancri-bot";
      await self.registration.showNotification(data.title || "Cancri Bot", {
        body: data.body || "",
        tag,
        renotify: !watching,
        silent: watching || pages.length > 0,
        icon: ICON,
        badge: BADGE,
        timestamp: Date.now(),
        data: { url, conv: data.conv || null },
      });
      if (watching) {
        // 静音那条几秒后收掉
        setTimeout(async () => {
          for (const n of await self.registration.getNotifications({ tag })) n.close();
        }, 4000);
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, conv } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const page = list.find(isBotPage);
      if (page) {
        if (conv) page.postMessage({ type: "open", conv });
        try {
          await page.focus();
        } catch {
          /* 某些平台不允许聚焦：退回新开 */
          if (self.clients.openWindow) await self.clients.openWindow(url);
        }
        return;
      }
      if (self.clients.openWindow) await self.clients.openWindow(url || "./bot.html");
    })(),
  );
});
