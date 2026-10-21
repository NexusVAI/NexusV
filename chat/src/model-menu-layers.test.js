import { describe, expect, it } from "vitest";
import {
  classifyModelMenuLayers,
  compareVersions,
  isOlderThan,
  getModelCostLevel,
  isFreeMenuModel,
  parseModelLine,
} from "./model-menu-layers.js";

const ids = (arr) => arr.map((m) => m.id);

describe("parseModelLine", () => {
  it("splits family / line / version across naming styles", () => {
    expect(parseModelLine("GPT 6.1 Sol")).toEqual({ family: "gpt", line: "sol", version: [6, 1] });
    expect(parseModelLine("Claude Opus 4.6 Thinking")).toEqual({ family: "claude", line: "opus", version: [4, 6] });
    expect(parseModelLine("Qwen3.5-4B")).toEqual({ family: "qwen", line: "", version: [3, 5] });
    expect(parseModelLine("DeepSeek V4 Flash 0731")).toEqual({ family: "deepseek", line: "flash", version: [4] });
    expect(parseModelLine("Gemini 3.8 Flash High")).toEqual({ family: "gemini", line: "flash", version: [3, 8] });
    expect(parseModelLine("Kimi K2.6")).toEqual({ family: "kimi", line: "", version: [2, 6] });
  });

  it("does not treat parameter sizes or date snapshots as versions", () => {
    expect(parseModelLine("Gemma 2B IT").version).toBeNull();
    expect(parseModelLine("Ministral 14B (2512)").version).toBeNull();
    expect(parseModelLine("Qwen 3.7 Plus 0823").version).toEqual([3, 7]);
  });

  it("keeps Flash Lite / Mini as their own sub-lines", () => {
    expect(parseModelLine("Gemini 3.1 Flash Lite Thinking").line).toBe("flash lite");
    expect(parseModelLine("Gemini 2.5 Flash Lite").line).toBe("flash lite");
    expect(parseModelLine("GPT-6 Sol Plus").line).toBe("sol");
    expect(parseModelLine("GPT-6 Astra Pro5x").line).toBe("astra");
  });
});

describe("compareVersions", () => {
  it("compares component-wise with implicit zeros", () => {
    expect(compareVersions([3, 8], [3, 7])).toBeGreaterThan(0);
    expect(compareVersions([4], [4, 1])).toBeLessThan(0);
    expect(compareVersions([5, 0], [5])).toBe(0);
  });
});

describe("isOlderThan", () => {
  it("treats a lower major or a minor gap of 2+ as older, a single minor step as current", () => {
    expect(isOlderThan([5, 6], [6, 1])).toBe(true);
    expect(isOlderThan([6], [6, 1])).toBe(false);
    expect(isOlderThan([3, 7], [3, 8])).toBe(false);
    expect(isOlderThan([3, 6], [3, 8])).toBe(true);
    expect(isOlderThan([5], [5, 2])).toBe(true);
    expect(isOlderThan([6, 1], [6, 1])).toBe(false);
  });
});

describe("classifyModelMenuLayers", () => {
  it("only moves a release two minor steps behind into 较早", () => {
    const models = [
      { id: "qwen3.6-max", displayName: "Qwen 3.6 Max" },
      { id: "qwen3.7-max", displayName: "Qwen 3.7 Max" },
      { id: "qwen3.8-max", displayName: "Qwen 3.8 Max" },
    ];
    const r = classifyModelMenuLayers(models, [], { currentIds: [], olderIds: [] });
    expect(ids(r.other)).toEqual(["qwen3.7-max", "qwen3.8-max"]);
    expect(ids(r.older)).toEqual(["qwen3.6-max"]);
  });

  it("GPT 6 Sol stays current next to 6.1 Sol; GPT 5.6 Sol is older", () => {
    const models = [
      { id: "gpt-6.1-sol", displayName: "GPT-6.1 Sol" },
      { id: "gpt-6-sol", displayName: "GPT-6 Sol" },
      { id: "gpt-6-sol-plus", displayName: "GPT-6 Sol Plus" },
      { id: "gpt-6-sol-xhigh", displayName: "GPT-6 Sol XHigh" },
      { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
      { id: "pro-gpt-5.6-sol", displayName: "GPT-5.6 Sol Pro" },
    ];
    const r = classifyModelMenuLayers(models, ["gpt-6.1-sol"]);
    expect(ids(r.recommended)).toEqual(["gpt-6.1-sol"]);
    expect(ids(r.other)).toEqual(["gpt-6-sol", "gpt-6-sol-plus", "gpt-6-sol-xhigh"]);
    expect(ids(r.older)).toEqual(["gpt-5.6-sol", "pro-gpt-5.6-sol"]);
  });

  it("only recommends models that exist in the catalog, in configured order, and never repeats them", () => {
    const models = [
      { id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" },
      { id: "deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash" },
      { id: "deepseek-v4-flash-0731", displayName: "DeepSeek V4 Flash 0731" },
      { id: "gpt-6.1-sol", displayName: "GPT 6.1 Sol" },
    ];
    const r = classifyModelMenuLayers(models, ["gpt-6.1-sol", "claude-opus-4-6-thinking", "deepseek-v4-flash"]);
    expect(ids(r.recommended)).toEqual(["gpt-6.1-sol", "deepseek-v4-flash"]);
    expect(ids(r.other)).toEqual(["deepseek-v4.1-flash", "deepseek-v4-flash-0731"]);
    expect(r.older).toEqual([]);
  });

  it("keeps different product lines of one family independent", () => {
    const models = [
      { id: "gpt-6-astra", displayName: "GPT 6 Astra" },
      { id: "gpt-6.1-sol", displayName: "GPT 6.1 Sol" },
      { id: "gpt-5.6-terra", displayName: "GPT 5.6 Terra" },
      { id: "gemini-3.8-flash-high", displayName: "Gemini 3.8 Flash High" },
      { id: "gemini-3.1-flash-lite-preview", displayName: "Gemini 3.1 Flash Lite Thinking" },
      { id: "gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash Lite" },
    ];
    const r = classifyModelMenuLayers(models, []);
    expect(ids(r.other)).toEqual([
      "gpt-6-astra",
      "gpt-6.1-sol",
      "gpt-5.6-terra",
      "gemini-3.8-flash-high",
      "gemini-3.1-flash-lite-preview",
    ]);
    expect(ids(r.older)).toEqual(["gemini-2.5-flash-lite"]);
  });

  it("treats bare-named models as older once the family has a newer major", () => {
    const models = [
      { id: "gpt-5.5", displayName: "GPT-5.5" },
      { id: "gpt-6-astra", displayName: "GPT-6 Astra" },
      { id: "glm-4-9b-0414", displayName: "GLM-4-9B-0414" },
      { id: "glm-5", displayName: "GLM-5" },
      { id: "glm-5.2", displayName: "GLM 5.2" },
      { id: "kimi-k2.6", displayName: "Kimi K2.6" },
      { id: "kimi-k3", displayName: "Kimi K3" },
    ];
    const r = classifyModelMenuLayers(models, []);
    expect(ids(r.other)).toEqual(["gpt-6-astra", "glm-5.2", "kimi-k3"]);
    expect(ids(r.older)).toEqual(["gpt-5.5", "glm-4-9b-0414", "glm-5", "kimi-k2.6"]);
  });

  it("manual pins win over the automatic rule", () => {
    const models = [
      { id: "a-1", displayName: "Foo 1 Bar" },
      { id: "a-3", displayName: "Foo 3 Bar" },
      { id: "a-3x", displayName: "Foo 3 Baz" },
    ];
    const r = classifyModelMenuLayers(models, [], { currentIds: ["a-1"], olderIds: ["a-3x"] });
    expect(ids(r.other)).toEqual(["a-1", "a-3"]);
    expect(ids(r.older)).toEqual(["a-3x"]);
  });

  it("leaves models without a version in 其他", () => {
    const r = classifyModelMenuLayers([{ id: "cf:gemma-2b-it", displayName: "Gemma 2B IT" }], []);
    expect(ids(r.other)).toEqual(["cf:gemma-2b-it"]);
  });
});

describe("isFreeMenuModel", () => {
  it("prefers the backend gate tier over catalog costTier", () => {
    expect(isFreeMenuModel({ gateCostTier: "free", costTier: "normal" })).toBe(true);
    expect(isFreeMenuModel({ gateCostTier: "paid", costTier: "free" })).toBe(false);
    expect(isFreeMenuModel({ costTier: "free" })).toBe(true);
    expect(isFreeMenuModel({ costTier: "cheap", isWelfare: true })).toBe(true);
    expect(isFreeMenuModel({ costTier: "normal" })).toBe(false);
  });
});

describe("getModelCostLevel", () => {
  it("free models are always the lowest level", () => {
    expect(getModelCostLevel({ gateCostTier: "free", outputPricePerM: 9 }, "wallet_v3")).toBe(1);
  });

  it("is monotonic in real token price under pay-as-you-go billing", () => {
    const lv = (out) => getModelCostLevel({ gateCostTier: "paid", inputPricePerM: 0, outputPricePerM: out }, "wallet_v3");
    expect([lv(0.1), lv(2), lv(5), lv(10)]).toEqual([2, 3, 4, 5]);
  });

  it("uses per-call price when there is no token price", () => {
    expect(getModelCostLevel({ gateCostTier: "paid", perCallPrice: 0.002 }, "wallet_v3")).toBe(2);
    expect(getModelCostLevel({ gateCostTier: "paid", perCallPrice: 0.05 }, "wallet_v3")).toBe(3);
  });

  it("uses the allowance multiplier under plan_v4", () => {
    expect(getModelCostLevel({ gateCostTier: "paid", customMultiplier: 10, outputPricePerM: 0.1 }, "plan_v4")).toBe(5);
    expect(getModelCostLevel({ gateCostTier: "paid", costTier: "expensive" }, "plan_v4")).toBe(4);
  });
});
