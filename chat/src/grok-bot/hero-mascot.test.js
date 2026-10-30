// @vitest-environment jsdom
/**
 * hero-mascot 冒烟测试：小蟹能挂上、img 兜底被替换、穿上已存的装饰、表情调度生效、
 * #homeView.chatting 隐藏后回首页清 busy、连点触发 celebrate、个性化胶囊开弹窗并能保存。
 * jsdom 无布局（getBoundingClientRect 全 0），眼睛跟随路径自动走守卫分支。
 * 组件是动态 import 的，全部断言走 waitFor 轮询，不写死加载耗时。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountHeroMascot } from "./hero-mascot.js";
import { OUTFIT_STORAGE_KEY, getOutfit } from "./crab-outfit.js";

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
const crabOf = (icon) => icon.querySelector("cancri-crab.hero-mascot");
const waitMounted = (icon) =>
  vi.waitFor(() => {
    expect(crabOf(icon)?.shadowRoot?.querySelector("svg")).toBeTruthy();
  }, WAIT);
const waitMood = (handle, want) =>
  vi.waitFor(() => {
    expect(handle.currentMood()).toBe(want);
  }, WAIT);
const waitMoodNot = (handle, not) =>
  vi.waitFor(() => {
    expect(handle.currentMood()).not.toBe(not);
  }, WAIT);

beforeEach(() => {
  localStorage.clear();
  document.querySelectorAll(".cc-crab-backdrop").forEach((el) => el.remove());
});

describe("mountHeroMascot", () => {
  it("挂载小蟹、撤掉 img 兜底、穿上已存的装饰", async () => {
    localStorage.setItem(OUTFIT_STORAGE_KEY, JSON.stringify(["wizard", "glasses"]));
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    expect(handle).not.toBeNull();
    await waitMounted(icon);
    const crab = crabOf(icon);
    expect(crab.getAttribute("state")).toBe("idle");
    expect(crab.getAttribute("accessory")).toBe("wizard glasses");
    expect(icon.querySelector("img")).toBeNull();
    expect(icon.querySelector(".crab-personalize-pill")).toBeTruthy();
    handle.destroy();
    expect(icon.querySelector("cancri-crab")).toBeNull();
    expect(icon.querySelector(".crab-personalize-pill")).toBeNull();
  });

  it("组件加载前调的 setBusy 在就位后仍生效（orbit → work）", async () => {
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    handle.setBusy(true); // 组件还没 import 完
    await waitMounted(icon);
    await waitMood(handle, "orbit");
    await vi.waitFor(() => expect(crabOf(icon).getAttribute("state")).toBe("work"), WAIT);
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

  it("窗口内连点 3 下触发 celebrate（crazy）", async () => {
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    await waitMounted(icon);
    const crab = crabOf(icon);
    for (let i = 0; i < 3; i++) {
      crab.dispatchEvent(new Event("pointerdown"));
    }
    await waitMood(handle, "celebrate"); // urgency 80 > idle 10，过 floorMs 即抢占
    handle.destroy();
  });

  it("个性化：胶囊开弹窗，点装饰 + 完成后写盘并同步到首页小蟹", async () => {
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    await waitMounted(icon);
    icon.querySelector(".crab-personalize-pill").click();
    await vi.waitFor(() => expect(document.querySelector(".cc-crab-card")).toBeTruthy(), WAIT);
    const tiles = document.querySelectorAll(".cc-crab-tile");
    expect(tiles.length).toBe(14);
    document.querySelector('.cc-crab-tile[data-acc="crown"]').click();
    document.querySelector('.cc-crab-tile[data-acc="cowboy"]').click(); // 同在头顶，挤掉皇冠
    document.querySelector(".cc-crab-done").click();
    expect(getOutfit()).toEqual(["cowboy"]);
    expect(crabOf(icon).getAttribute("accessory")).toBe("cowboy");
    handle.destroy();
  });

  it("个性化：Esc 放弃草稿，不写盘", async () => {
    const { homeView, icon } = makeDom();
    const handle = mountHeroMascot(icon, { homeView });
    await waitMounted(icon);
    icon.querySelector(".crab-personalize-pill").click();
    await vi.waitFor(() => expect(document.querySelector(".cc-crab-card")).toBeTruthy(), WAIT);
    document.querySelector('.cc-crab-tile[data-acc="santa"]').click();
    document.querySelector(".cc-crab-card").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(getOutfit()).toEqual([]);
    expect(crabOf(icon).getAttribute("accessory")).toBe("");
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
