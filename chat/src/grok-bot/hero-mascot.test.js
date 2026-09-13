// @vitest-environment jsdom
/**
 * hero-mascot 冒烟测试：引擎能挂上、img 兜底被替换、表情调度生效、
 * #homeView.chatting 时暂停且回首页清 busy、连点触发 celebrate。
 * jsdom 无布局（getBoundingClientRect 全 0），指针跟随路径自动走守卫分支。
 * 引擎是动态 import 的，全部断言走 waitFor 轮询，不写死加载耗时。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { mountHeroMascot } from "./hero-mascot.js";

beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (cb) =>
      setTimeout(() => cb(performance.now()), 16);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  }
  if (typeof globalThis.matchMedia !== "function") {
    globalThis.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }
});

function makeDom(theme = "dark") {
  document.documentElement.setAttribute("data-theme", theme);
  document.body.innerHTML =
    '<div id="homeView"><h1 id="heroTitle">' +
    '<span class="hero-icon"><img class="hero-icon-img" alt=""></span>' +
    '<span class="hero-text">你好</span></h1></div>';
  return {
    homeView: document.getElementById("homeView"),
    icon: document.querySelector(".hero-icon"),
  };
}

const WAIT = { timeout: 4000, interval: 20 };
const waitMounted = (icon) =>
  vi.waitFor(() => {
    expect(icon.querySelector("svg.hero-mascot")).toBeTruthy();
  }, WAIT);
const waitMood = (handle, want) =>
  vi.waitFor(
    () => {
      expect(handle.currentMood()).toBe(want);
    },
    WAIT,
  );
const waitMoodNot = (handle, not) =>
  vi.waitFor(
    () => {
      expect(handle.currentMood()).not.toBe(not);
    },
    WAIT,
  );

describe("mountHeroMascot", () => {
  it("挂载云朵 svg、撤掉 img 兜底、画出 body", async () => {
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    expect(handle).not.toBeNull();
    await waitMounted(icon);
    const svg = icon.querySelector("svg.hero-mascot");
    expect(svg.getAttribute("viewBox")).toBeTruthy();
    expect(svg.querySelector("path")).toBeTruthy();
    expect(icon.querySelector("img")).toBeNull();
    handle.destroy();
  });

  it("引擎加载前调的 setBusy 在引擎就位后仍生效（orbit）", async () => {
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    handle.setBusy(true); // 引擎还没 import 完
    await waitMounted(icon);
    await waitMood(handle, "orbit");
    handle.destroy();
  });

  it("setBusy(false) 后回到非 orbit 表情", async () => {
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    await waitMounted(icon);
    handle.setBusy(true);
    await waitMood(handle, "orbit");
    handle.setBusy(false);
    await waitMoodNot(handle, "orbit"); // orbit holdMs=1000 后允许切走
    handle.destroy();
  });

  it("#homeView.chatting 隐藏时回到首页会清掉 busy", async () => {
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    await waitMounted(icon);
    handle.setBusy(true);
    homeView.classList.add("chatting");
    await waitMood(handle, "orbit");
    homeView.classList.remove("chatting");
    await waitMoodNot(handle, "orbit");
    handle.destroy();
  });

  it("窗口内连点 3 下触发 celebrate", async () => {
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    await waitMounted(icon);
    const svg = icon.querySelector("svg.hero-mascot");
    for (let i = 0; i < 3; i++) {
      svg.dispatchEvent(new Event("pointerdown"));
    }
    await waitMood(handle, "celebrate"); // urgency 80 > idle 10，过 floorMs 即抢占
    handle.destroy();
  });

  it("重复挂载返回 null，destroy 后可再挂", async () => {
    const { homeView, icon } = makeDom();
    const first = mountHeroMascot(icon, { homeView });
    expect(first).not.toBeNull();
    expect(mountHeroMascot(icon, { homeView })).toBeNull();
    first.destroy();
    const second = mountHeroMascot(icon, { homeView });
    expect(second).not.toBeNull();
    await waitMounted(icon);
    second.destroy();
  });
});
