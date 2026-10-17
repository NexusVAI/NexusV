// 移植自 cancri-code/src/core/control-tags.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — 特权控制通道的定界标签（2026-08-30 审计 CC-SEC-005）
 *
 * ## 这里在防什么
 *
 * turn context 的 durable / ephemeral 两条通道都会被**外层**包进一个
 * `<system-reminder>…</system-reminder>`（`agent/turn-context.ts wrapSystemReminder`）。
 * 内层块里如果出现一个字面的 `</system-reminder>`，外层就被提前闭合 ——
 * 之后的文本逃出这个块，攻击者可以紧接着写一段自己的 `<system-reminder>`，
 * 让模型读到一条"系统级最高优先级指令"。
 *
 * 也就是说：**尖括号在这里是一个权限提升原语**，而不是普通字符。
 *
 * ## 为什么单独成一个模块
 *
 * 原实现是 `turn-context.ts` 里一条写死两个标签名的正则。它有三个结构性问题：
 *
 * 1. **标签名的"权威清单"不存在。** 谁往 prompt 里加一个新的定界标签，
 *    都不会有任何东西提醒他去更新那条正则；漏了就是一个静默的注入通道。
 *    现在 `RESERVED_CONTROL_TAGS` 是唯一清单，且由 `control-tags.test.ts`
 *    机械核对"代码里出现过的 `<xxx>` 包装标签是否都在清单里"。
 * 2. **`tools/` 层用不到它。** 中和只发生在 `agent/turn-context.ts`，而技能正文、
 *    工具结果这些同样不可信的内容在别的层被拼进 prompt。放在无依赖的 `core/`
 *    才能让每一层都用同一份判据（否则又是"两套强度"）。
 * 3. **只认最规范的写法。** 旧正则的 `<\/?\s*name` 认 `</ name>` 但不认 `< /name>`；
 *    也不处理 HTML 实体形式。见下面 `neutralizeControlTags` 的注释。
 *
 * ## 为什么是"中和"而不是"删除"
 *
 * 删除会静默改写不可信内容的语义（一段正当讨论 `<system-reminder>` 用法的文档会
 * 突然缺字）。把尖括号换成外观相近的书名号 `‹ ›`：模型照旧读得懂在讲什么，
 * 而任何解析器（包括模型自己的定界识别）都不再把它当作真标签。
 */

/**
 * 本仓不用、但主流模型会当成结构信号的第三方定界标签。
 * 权威全文在 `RESERVED_CONTROL_TAGS`；这份清单给测试做「扫本仓源码抓不到」的显式锁
 * （2026-09-18 审计 K-08 / 弱锁 C-03）。加第三方分隔符先加这里。
 */
export const THIRD_PARTY_RESERVED_DELIMITERS: readonly string[] = [
  "antml:invoke",
  "antml:function_calls",
  "antml:parameter",
  "function_calls",
  "function_results",
  "tool_result",
  "tool-result",
  "important_instructions",
];

/**
 * 特权通道使用的全部定界标签名。**新增任何 prompt 包装标签都必须登记到这里。**
 *
 * 判据不是"这个标签重不重要"，而是"模型会不会把它读成结构信号"——
 * 会，就必须登记，否则不可信内容可以伪造它。
 */
export const RESERVED_CONTROL_TAGS: readonly string[] = [
  "system-reminder",
  "system_reminder",
  "code_context",
  "code-context",
  // 下面几个当前不是本仓在用的包装标签，但它们是主流模型/同类产品的
  // 结构信号，模型对它们有先验反应。不可信内容伪造它们同样能改变行为，
  // 成本只是几个正则分支，收益是"换个上游模型也不会突然多一条注入通道"。
  "system",
  "assistant",
  "user",
  "tool_result",
  "tool-result",
  "function_results",
  "function_calls",
  "antml:invoke",
  // 2026-09-18 审计 K-08：Anthropic 工具调用的另外两个定界标签。
  // `antml:invoke` 在清单里而这两条不在 —— 扫本仓源码的锁抓不到第三方分隔符（弱锁 C-03）。
  "antml:function_calls",
  "antml:parameter",
  "thinking",
  "important_instructions",
];

/**
 * 把标签名转成正则片段。`antml:invoke` 这类含 `:` 的名字要转义。
 */
function tagAlternation(): string {
  return RESERVED_CONTROL_TAGS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

/**
 * ⚠ 三处比旧实现更宽：
 *   1. `<` 与 `/` 之间允许空白（`< /system-reminder>`）；
 *   2. 结束尖括号前允许属性与空白（`<system-reminder foo="bar" >`）；
 *   3. 自闭合形式（`<system-reminder/>`）。
 * 都不是理论洁癖：模型对"看起来像闭合标签"的东西一样会反应，
 * 而我们没有理由把判据卡在最规范的那一种写法上。
 */
const CONTROL_TAG_RE = new RegExp(`<\\s*/?\\s*(?:${tagAlternation()})\\b[^>]*>`, "gi");

/**
 * HTML 实体形式：`&lt;/system-reminder&gt;`。
 *
 * 这一条**不是**为了防解析器（没有任何解析器会把实体还原成标签），而是为了防
 * 「不可信内容 → markdown 渲染 → 用户看到一段像系统提示的东西」以及
 * 「模型自己把实体读成标签」。中和它零成本。
 */
const CONTROL_ENTITY_RE = new RegExp(
  `&lt;\\s*/?\\s*(?:${tagAlternation()})\\b[^&]*&gt;`,
  "gi",
);

/**
 * 中和不可信内容里的控制定界标签，防提示注入。
 *
 * ⚠ 只对**不可信内容本体**用，不要套在 `wrapSystemReminder` 的输出上 ——
 * 那会把合法的外层标签一起中和（durable 是"内层块自带标签 + 外层再包一次"的双层结构）。
 */
export function neutralizeControlTags(s: string): string {
  if (!s) return s;
  return s
    .replace(CONTROL_TAG_RE, (m) => m.replace(/</g, "‹").replace(/>/g, "›"))
    .replace(CONTROL_ENTITY_RE, (m) => m.replace(/&lt;/gi, "‹").replace(/&gt;/gi, "›"));
}

/**
 * 判定一段文本是否仍带有未中和的控制标签。给回归测试与结构性断言用
 * （比"字符串里有没有某个魔法子串"更能说明意图）。
 */
export function containsControlTag(s: string): boolean {
  if (!s) return false;
  CONTROL_TAG_RE.lastIndex = 0;
  CONTROL_ENTITY_RE.lastIndex = 0;
  return CONTROL_TAG_RE.test(s) || CONTROL_ENTITY_RE.test(s);
}
