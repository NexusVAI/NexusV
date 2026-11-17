import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveLoginReturnTarget, stripLoginReturnParam } from "./utils/login-return.js";

const HERE = "https://www.nexusvai.xyz/chat/?next=x";

describe("resolveLoginReturnTarget", () => {
  it("站内路径原样返回（含 query 与 hash）", () => {
    expect(resolveLoginReturnTarget("/api/console/", HERE)).toBe("/api/console/");
    expect(resolveLoginReturnTarget("/api/console/team/?invite=abc#m", HERE)).toBe("/api/console/team/?invite=abc#m");
    expect(resolveLoginReturnTarget("/chat/bot#bot:abc", HERE)).toBe("/chat/bot#bot:abc");
  });

  it("拒绝跨域与协议相对地址（开放跳转）", () => {
    for (const bad of ["https://evil.com/", "//evil.com/x", "/\\evil.com", "javascript:alert(1)", "evil.com", "", null, undefined]) {
      expect(resolveLoginReturnTarget(bad, HERE)).toBeNull();
    }
  });

  it("目标就是聊天页本身时不跳（避免原地刷新）", () => {
    expect(resolveLoginReturnTarget("/chat/", HERE)).toBeNull();
    expect(resolveLoginReturnTarget("/chat/index.html", HERE)).toBeNull();
    expect(resolveLoginReturnTarget("/chat/?q=hi", HERE)).toBe("/chat/?q=hi");
  });
});

describe("stripLoginReturnParam", () => {
  it("只去掉 next，保留其它参数和 hash", () => {
    expect(stripLoginReturnParam("https://www.nexusvai.xyz/chat/?next=%2Fapi%2F&q=1#settings")).toBe("/chat/?q=1#settings");
    expect(stripLoginReturnParam("https://www.nexusvai.xyz/chat/?next=%2Fapi%2F")).toBe("/chat/");
  });
});

describe("登录回跳接线", () => {
  const main = readFileSync(fileURLToPath(new URL("./main.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  it("聊天页三处拿到会话的入口都会先尝试回跳", () => {
    expect(main).toContain("if (followLoginReturn()) return;\n          updateAccountInfo(data.session.user);");
    expect(main).toContain("onSession: (session) => {\n          if (followLoginReturn()) return;");
    expect(main).toContain('if (event === "SIGNED_IN" && followLoginReturn()) return;');
  });

  it("控制台共享鉴权跳登录时带上当前地址", () => {
    const pa = readFileSync(fileURLToPath(new URL("../api/platform-auth.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
    expect(pa).toContain('win.location.replace(withReturnTo(resolveLoginUrl()));');
    expect(pa).toContain('u.searchParams.set("next", location.pathname + location.search + location.hash);');
  });
});
