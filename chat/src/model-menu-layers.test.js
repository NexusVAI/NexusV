import { describe, expect, it } from "vitest";
import {
  classifyModelMenuLayers,
  compareVersions,
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

  it("does not treat parameter sizes as versions", () => {
    expect(parseModelLine("Gemma 2B IT").version).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares component-wise with implicit zeros", () => {
    expect(compareVersions([3, 8], [3, 7])).toBeGreaterThan(0);
    expect(compareVersions([4], [4, 1])).toBeLessThan(0);
    expect(compareVersions([5, 0], [5])).toBe(0);
  });
});

describe("classifyModelMenuLayers", () => {
  it("puts an older release of the same line into 较早 and the newest into 其他", () => {
    const models = [
      { id: "qwen3.7-max", displayName: "Qwen 3.7 Max" },
      { id: "qwen3.8-max", displayName: "Qwen 3.8 Max" },
    ];
    const r = classifyModelMenuLayers(models, []);
    expect(ids(r.other)).toEqual(["qwen3.8-max"]);
    expect(ids(r.older)).toEqual(["qwen3.7-max"]);
  });

  it("only recommends models that exist in the catalog, in configured order, and never repeats them", () => {
    const models = [
      { id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" },
      { id: "deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash" },
      { id: "gpt-6.1-sol", displayName: "GPT 6.1 Sol" },
      { id: "gpt-6-sol", displayName: "GPT 6 Sol" },
    ];
    const r = classifyModelMenuLayers(models, ["gpt-6.1-sol", "claude-opus-4-6-thinking", "deepseek-v4-flash"]);
    expect(ids(r.recommended)).toEqual(["gpt-6.1-sol", "deepseek-v4-flash"]);
    expect(ids(r.other)).toEqual(["deepseek-v4.1-flash"]);
    expect(ids(r.older)).toEqual(["gpt-6-sol"]);
  });

  it("keeps different product lines of one family independent", () => {
    const models = [
      { id: "gpt-6-astra", displayName: "GPT 6 Astra" },
      { id: "gpt-6.1-sol", displayName: "GPT 6.1 Sol" },
      { id: "gpt-5.6-terra", displayName: "GPT 5.6 Terra" },
    ];
    const r = classifyModelMenuLayers(models, []);
    expect(ids(r.other)).toEqual(["gpt-6-astra", "gpt-6.1-sol", "gpt-5.6-terra"]);
    expect(r.older).toEqual([]);
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
