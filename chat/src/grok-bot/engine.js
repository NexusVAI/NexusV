/*
 * grok-bot 引擎装配入口。
 *
 * ⚠ 出处：学习/液态玻璃组件源码【开源】/grok-icon-study-main —— 该仓库自述是对
 * Grok Bot.app v0.18.0 的复刻，几何数据抽自其 app.asar，并声明「素材归 xAI /
 * 相应权利人所有，请勿商用或再分发」。这里 vendor 进来只是把它跑起来，授权问题未解决。
 *
 * 被 vendor 的 7 个文件仍是原始 IIFE，彼此靠 globalThis 上的 GROK_* 命名空间串联，
 * 所以这里的 import 顺序 = 依赖顺序，不能重排（math → tables → pose → tricks → fx → eyes → character）。
 * 保持原样是为了以后能直接对着上游文件做 diff。
 */
import "./geometry-data.js";
import "./math.js";
import "./tables.js";
import "./pose.js";
import "./tricks.js";
import "./fx.js";
import "./eyes.js";
import "./character.js";

export const GrokCharacter = globalThis.GrokCharacter;
export const GROK_GEO = globalThis.GROK_GEO;
export const GROK_META = globalThis.GROK_META;
