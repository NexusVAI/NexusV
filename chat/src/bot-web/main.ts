/**
 * 网页 / 手机端 Bot（chat/bot.html）入口。
 *
 * 对话界面不在这里写：整套 UI 是 Cancri Code 桌面端 src/bot/ 原样移植过来的（scripts/sync-bot-port.mjs →
 * src/bot-port/，勿手改），这里只做网页壳：
 *  - 复用 Chat 站点的登录态（shims/auth.ts）；
 *  - remote 模式：本地不跑 agent，发消息走云端 BotHub（gpt-6-luna），回复 / 正在输入 / 已读从云端事件来；
 *  - 顶栏：回 Chat、通知开关（Web Push：Windows / Android 直接开，iOS 需先“添加到主屏幕”）；
 *  - 地址栏 #bot:<id> / #group:<id> 直达会话（通知点进来）。
 */
import "../bot-port/desktop-shared.css";
import "./bot-web.css";
import { createBotView, type BotViewHandle } from "../bot-port/src/bot/bot-view";
import { botComputer } from "./shims/bot-computer";
import { auth } from "./shims/auth";
import { disablePush, enablePush, pushPhase, pushSupport, registerWorker, testPush, type PushPhase } from "./push";

const CHAT_HOME = "./index.html";

function applyTheme(): void {
  const html = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const set = () => {
    html.dataset.theme = "codex";
    html.dataset.scheme = mq.matches ? "dark" : "light";
    html.dataset.flavor = "cancri";
    html.dataset.menuChrome = "transparent";
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = mq.matches ? "#181818" : "#ffffff";
  };
  set();
  mq.addEventListener?.("change", set);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const ICON_BACK =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_BELL =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6.5a4 4 0 1 1 8 0c0 2.6.8 3.9 1.4 4.6H2.6C3.2 10.4 4 9.1 4 6.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.5 13.2a1.6 1.6 0 0 0 3 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

/** 顶栏：← Chat · 标题 · 通知 */
function buildBar(): { bar: HTMLElement; notify: HTMLButtonElement; tip: HTMLElement } {
  const bar = el("header", "bw-bar");
  const back = el("a", "bw-back");
  back.href = CHAT_HOME;
  back.innerHTML = `${ICON_BACK}<span>Chat</span>`;
  back.title = "回到 Chat";
  const title = el("div", "bw-title", "Bot");
  const notify = el("button", "bw-notify");
  notify.type = "button";
  const tip = el("div", "bw-tip");
  tip.hidden = true;
  bar.append(back, title, notify);
  return { bar, notify, tip };
}

const PHASE_LABEL: Record<PushPhase, string> = {
  unsupported: "通知不可用",
  "ios-home": "开启通知",
  default: "开启通知",
  denied: "通知已屏蔽",
  on: "通知已开启",
  busy: "处理中…",
  error: "重试开启通知",
};

function wireNotify(notify: HTMLButtonElement, tip: HTMLElement): void {
  const env = { token: () => auth.ensureAccessToken() };
  let phase: PushPhase = "default";
  let tipTimer = 0;
  const say = (text: string, ms = 6000) => {
    tip.textContent = text;
    tip.hidden = false;
    clearTimeout(tipTimer);
    if (ms) tipTimer = window.setTimeout(() => (tip.hidden = true), ms);
  };
  const render = () => {
    notify.innerHTML = `${ICON_BELL}<span>${PHASE_LABEL[phase]}</span>`;
    notify.dataset.phase = phase;
    notify.title = phase === "on" ? "点一下发测试通知；右键 / 长按关闭这台设备的通知" : "Bot 回复、审批、定时任务结果推送到这台设备";
    notify.disabled = phase === "busy";
  };
  const refresh = async () => {
    phase = await pushPhase().catch(() => "error" as PushPhase);
    render();
  };
  /** 已授权且本机有订阅：静默再登记一次（服务端丢了订阅 / 换了 VAPID 公钥都能自愈；不会弹授权框） */
  const resync = async () => {
    if ((await pushPhase().catch(() => "error")) !== "on") return;
    await enablePush(env).catch(() => undefined);
  };
  notify.addEventListener("click", async () => {
    const sup = pushSupport();
    if (phase === "ios-home" || (!sup.ok && sup.ios && !sup.standalone)) {
      say("iPhone / iPad 要先把本页加到主屏幕：Safari 点「分享」→「添加到主屏幕」，再从主屏幕图标打开后开启通知（需 iOS 16.4 及以上）。", 0);
      return;
    }
    if (phase === "unsupported") {
      say("这个浏览器不支持网页推送。Windows / Android 请用 Chrome 或 Edge；iPhone 请用 Safari 添加到主屏幕。");
      return;
    }
    if (phase === "denied") {
      say("通知被浏览器屏蔽了：点地址栏左侧的站点设置，把「通知」改成允许后再回来。", 0);
      return;
    }
    if (phase === "on") {
      // 已开：再点一下 = 发一条测试；长按 / 右键 = 关闭
      phase = "busy";
      render();
      try {
        let n = await testPush(env);
        // 服务端没有这台设备的订阅（比如上次登记失败）：用现有授权重新登记一次再试
        if (n === 0 && (await enablePush(env)) === "on") n = await testPush(env);
        say(n > 0 ? "已发送一条测试通知。" : "测试通知没有送达：请关闭后重新开启通知。");
      } catch (e) {
        say(`测试失败：${e instanceof Error ? e.message : String(e)}`);
      }
      await refresh();
      return;
    }
    phase = "busy";
    render();
    try {
      phase = await enablePush(env);
      if (phase === "on") say("通知已开启：Bot 回复、需要你审批、定时任务结果都会推到这台设备。再点一次可发测试。");
      else if (phase === "denied") say("你拒绝了通知权限，需要到浏览器站点设置里改回允许。", 0);
    } catch (e) {
      phase = "error";
      say(`开启失败：${e instanceof Error ? e.message : String(e)}`);
    }
    render();
  });
  notify.addEventListener("contextmenu", async (ev) => {
    if (phase !== "on") return;
    ev.preventDefault();
    if (!confirm("关闭这台设备上的 Bot 通知？")) return;
    phase = "busy";
    render();
    await disablePush(env).catch(() => undefined);
    await refresh();
    say("已关闭这台设备的通知。");
  });
  render();
  void refresh().then(resync);
}

function signedOut(stage: HTMLElement): void {
  const box = el("div", "bw-signin");
  box.innerHTML = `<div class="bw-signin-card"><div class="bw-signin-title">登录后使用 Bot</div><p>Bot 在云端运行，手机、网页和 Cancri Code 桌面端共用同一套 Bot 和聊天记录。</p></div>`;
  const go = el("a", "bw-signin-btn", "去登录");
  go.href = CHAT_HOME;
  box.querySelector(".bw-signin-card")!.append(go);
  stage.append(box);
}

function convFromHash(): string | null {
  const h = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
  return /^(bot|group):[\w-]+$/.test(h) ? h : null;
}

async function boot(): Promise<void> {
  applyTheme();
  const shell = el("div", "bw-shell");
  const { bar, notify, tip } = buildBar();
  const stage = el("main", "bw-stage");
  stage.id = "bot-stage";
  shell.append(bar, tip, stage);
  document.body.append(shell);

  await auth.init();
  if (!auth.getUserId()) {
    notify.hidden = true;
    signedOut(stage);
    // 在别的标签页登录了：直接刷新进来
    const off = auth.onAuthChange(() => {
      if (auth.getUserId()) {
        off();
        location.reload();
      }
    });
    return;
  }

  const reg = registerWorker();
  wireNotify(notify, tip);

  let view: BotViewHandle | null = null;
  view = createBotView(stage, {
    remote: true,
    computer: botComputer() as never,
    onActive: (conv) => {
      if (conv) {
        if (location.hash !== `#${conv}`) history.replaceState(null, "", `#${conv}`);
      } else if (location.hash) {
        history.replaceState(null, "", location.pathname + location.search);
      }
      // 告诉 Service Worker 正在看哪个会话：这条会话的新消息不再弹系统通知
      void reg.then((r) => r?.active?.postMessage({ type: "active", conv }));
    },
  });
  view.show();
  const first = convFromHash();
  if (first) view.open(first);
  window.addEventListener("hashchange", () => {
    const c = convFromHash();
    if (c) view?.open(c);
  });
  navigator.serviceWorker?.addEventListener("message", (ev: MessageEvent) => {
    const d = ev.data as { type?: string; conv?: string } | null;
    if (d?.type === "open" && d.conv) view?.open(d.conv);
  });
  document.addEventListener("visibilitychange", () => {
    void reg.then((r) => r?.active?.postMessage({ type: "visible", visible: document.visibilityState === "visible" }));
  });
  // 账号换了 / 退出：整页重来（桌面端同样按账号隔离本地存档）
  let uid = auth.getUserId();
  auth.onAuthChange(() => {
    const now = auth.getUserId();
    if (now !== uid) {
      uid = now;
      location.reload();
    }
  });
}

void boot();
