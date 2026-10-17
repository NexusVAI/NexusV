/**
 * 网页通知（Web Push）：iOS 16.4+（添加到主屏幕后）、Android Chrome / Edge / Firefox、Windows Chrome / Edge / Firefox。
 *
 *   1. 注册 bot-sw.js（scope = /chat/），它收推送、弹系统通知、点通知回到对应会话；
 *   2. 用户点「开启通知」（必须是用户手势，iOS 才会弹授权框）→ 授权 → pushManager.subscribe(VAPID 公钥 = GET /push/key)
 *      → POST /push/subscribe 交给云端（BotHub 每个账号最多记 10 台设备）；
 *   3. 云端：Bot 发消息、要你批准、监控出事/恢复时推送（cf-gateway src/bot-hub/webpush.ts，aes128gcm + VAPID）。
 *
 * iOS Safari 网页里没有 PushManager：只有「分享 → 添加到主屏幕」后从主屏图标打开才有，所以这时只给提示。
 */
const API = "https://chat.nexusvai.xyz/functions/v1/bot-hub";

export type PushPhase = "unsupported" | "ios-home" | "default" | "denied" | "on" | "busy" | "error";

export interface PushEnv {
  token: () => Promise<string | null>;
}

export function pushSupport(): { ok: boolean; ios: boolean; standalone: boolean } {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { ok, ios, standalone };
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function call(env: PushEnv, path: string, method = "GET", body?: unknown): Promise<Record<string, unknown>> {
  const token = await env.token();
  if (!token) throw new Error("not_signed_in");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(j.code ?? j.error ?? `http_${res.status}`));
  return j;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
export function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  registration ??= "serviceWorker" in navigator
    ? navigator.serviceWorker.register("./bot-sw.js?v=1", { scope: "./" }).catch((e) => {
        console.warn("[bot] service worker 注册失败", e);
        return null;
      })
    : Promise.resolve(null);
  return registration;
}

/** 现在的状态（不弹任何授权框） */
export async function pushPhase(): Promise<PushPhase> {
  const s = pushSupport();
  if (!s.ok) return s.ios && !s.standalone ? "ios-home" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registerWorker();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return Notification.permission === "granted" && sub ? "on" : "default";
}

/** 用户点了「开启通知」：必须在点击回调里直接调用（iOS 要求用户手势） */
export async function enablePush(env: PushEnv): Promise<PushPhase> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "default";
  const reg = await registerWorker();
  if (!reg) return "error";
  await navigator.serviceWorker.ready;
  const { publicKey } = (await call(env, "/push/key")) as { publicKey?: string };
  if (!publicKey) return "error";
  let sub = await reg.pushManager.getSubscription();
  // 服务端换过 VAPID 公钥：旧订阅作废，重新订
  const want = b64urlToBytes(publicKey);
  const have = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && have && (have.length !== want.length || have.some((b, i) => b !== want[i]))) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  await call(env, "/push/subscribe", "POST", { endpoint: j.endpoint, keys: j.keys, ua: deviceLabel() });
  return "on";
}

export async function disablePush(env: PushEnv): Promise<void> {
  const reg = await registerWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await call(env, "/push/unsubscribe", "POST", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function testPush(env: PushEnv): Promise<number> {
  const r = await call(env, "/push/test", "POST", {});
  return Number(r.delivered) || 0;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : "Web";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}
