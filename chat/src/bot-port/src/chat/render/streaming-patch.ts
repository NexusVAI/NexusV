// 移植自 cancri-code/src/chat/render/streaming-patch.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 流式 Markdown 的增量 DOM 补丁：只动变了的节点，新增文字包进一次性的
 * `span.chat-stream-fade`（尾字渐隐），动画结束后还原成普通文本节点。
 *
 * Agent（chat.ts）与 Bot（bot/bot-view.ts）共用这一份。原先只长在 ChatPane 里，
 * Bot 气泡只能整块 innerHTML 重写，没有尾字渐隐。
 */

/**
 * 由**别的模块**在运行时挂到 DOM 上的 class —— markdown 渲染器根本不会吐出它们。
 *
 * 流式增量 patch 拿 class 当"这是不是同一个节点"的指纹，所以这几个必须排除在外，
 * 否则被接管过的节点（代码块的 `sq-active`、表格的 `has-scroll-fade`）在现存 DOM 上
 * 永远比新渲染的多一个 class，每帧都被判成"换了个节点"而整块重建 = 肉眼可见的闪烁。
 *
 * ⛔ 加新的运行时 class（新的装饰模块）时必须同步登记到这里。
 */
const RUNTIME_ONLY_CLASSES = new Set([
  "sq-active", // ui/apple-corners.ts：贝塞尔苹果曲线接管态
  "cc-apple-magnify", // 展开时那一帧的放大动画
  "has-scroll-fade", // ui/md-table-scroll.ts / applyScrollEdgeFade 的滚动边缘渐变
]);

/**
 * 与 RUNTIME_ONLY_CLASSES 对称的**属性**清单（2026-09-18 审计 U-04）。
 *
 * 上面那条 class 契约 2026-08-27 就立了，但同一条推理**从没应用到属性上**：
 * `syncStreamingAttributes` 会把 `next` 里没有的属性一律删掉，而装饰模块写的正是
 * 「渲染器不可能吐出来」的属性 —— 于是每一帧都被擦一遍、下一帧装饰模块再写回来。
 * 实测受害者：`ui/md-table-scroll.ts` 的渐隐轨道（内联 `--md-table-fade-*` + 注入的
 * `.md-table-hscroll` 子节点）在流式输出期间逐帧销毁重建；`.md-code` 只是**碰巧**没事
 * （`patchStreamingCodeBlock` 在调 syncStreamingAttributes 之前就 return 了），
 * 所以下一个进 apple-corners TARGETS 的 markdown 内部元素会直接表现成「流式时四角是直角」
 * （apple-corners 写的 clip-path 就是内联 style）。
 *
 * ⛔ 新增运行时装饰模块时必须登记到下面三张表之一，否则它的效果在流式输出期间静默失效。
 */
const RUNTIME_ONLY_ATTRS = new Set([
  "data-sq-radius", // ui/apple-corners.ts：接管前的原始设计半径
  "data-sq-suspended", // 同上：拖拽期间临时让出盒外绘制（审计 U-11）
  "data-favicon-next", // 站点 logo 的候选链游标（见 chat.ts bodyEl 那条捕获式 error 委托）
  "data-sq-live-radius", // ui/apple-corners.ts：智能 UI 卡壳接管后的实际半径（内层同心用）
  "data-ui-resolving", // rich-ui-interact.ts：本地图片正在解析
  "src", // rich-ui-interact.ts：本地图片解析出的 asset URL（渲染器只写 data-ui-local-src）
]);

/**
 * 运行时写进**内联 style** 的属性名（含自定义属性）。
 *
 * style 不能像 data-* 那样整条豁免：渲染器**也**可能写 style（`shimmerPhaseStyle` 就写
 * `--cc-shimmer-phase`）。所以按 class 的同一套办法**按属性合并** —— 渲染器那部分整体换掉，
 * 这张表里的原样留下。
 */
const RUNTIME_ONLY_STYLE_PROPS = [
  // ui/apple-corners.ts
  "clip-path",
  "border-radius", // 接管时写成 0 !important，优先级必须一起保住
  "--sq-ring-path",
  "--md-fence-inset",
  "--ui-r-live",
  "--worklog-card-inset",
  // shared scroll viewport edge fade
  "--chat-scroll-fade-top",
  "--chat-scroll-fade-bottom",
  // ui/md-table-scroll.ts
  "--md-table-fade-left",
  "--md-table-fade-right",
];

/**
 * 运行时**注入的子节点**：渲染器的输出里没有它们，所以子节点对账会把它们当
 * 「多出来的尾节点」删掉（patchStreamingChildren 末尾那个 while）。
 */
const RUNTIME_ONLY_CHILD_SELECTOR = ".md-table-hscroll";

function patchStreamingCodeBlock(current: Element, next: Element): boolean {
  if (!current.matches("pre.md-code") || !next.matches("pre.md-code")) return false;
  const currentCode = current.querySelector(":scope > code");
  const nextCode = next.querySelector(":scope > code");
  if (!currentCode || !nextCode) return false;
  if (!currentCode.isEqualNode(nextCode)) patchStreamingChildren(currentCode, nextCode);
  const currentLang = current.querySelector(":scope > .md-code-head > .md-code-lang");
  const nextLang = next.querySelector(":scope > .md-code-head > .md-code-lang");
  if (currentLang && nextLang && currentLang.textContent !== nextLang.textContent) {
    currentLang.textContent = nextLang.textContent;
  }
  for (const selector of [".md-code-copy", ".md-code-download"]) {
    const currentButton = current.querySelector<HTMLElement>(selector);
    const nextButton = next.querySelector<HTMLElement>(selector);
    if (!currentButton || !nextButton) continue;
    for (const name of ["data-copy", "data-download", "data-filename"]) {
      const value = nextButton.getAttribute(name);
      if (value === null) currentButton.removeAttribute(name);
      else if (currentButton.getAttribute(name) !== value) currentButton.setAttribute(name, value);
    }
  }
  return true;
}

function syncStreamingAttributes(current: Element, next: Element): void {
  for (const attr of Array.from(current.attributes)) {
    // class / style 都要「渲染器那部分换掉、运行时那部分留下」，各自在下面单独处理
    if (attr.name === "class" || attr.name === "style") continue;
    if (RUNTIME_ONLY_ATTRS.has(attr.name)) continue;
    if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  }
  for (const attr of Array.from(next.attributes)) {
    if (attr.name === "class" || attr.name === "style") continue;
    if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  }
  syncStreamingInlineStyle(current, next);
  // class 单独处理：渲染器给的那部分整体换掉，运行时 class 原样留下。
  // 直接照抄 next 的 class 会把 `sq-active` 抹掉 → apple-corners 的 clip-path 与
  // `overflow: visible` 一起失效，下一帧再被加回来，就是一次可见的抖动。
  const keep = Array.from(current.classList).filter((c) => RUNTIME_ONLY_CLASSES.has(c));
  const fromRenderer = Array.from(next.classList);
  const merged = [...fromRenderer, ...keep.filter((c) => !fromRenderer.includes(c))];
  const nextClass = merged.join(" ");
  if (current.getAttribute("class") !== nextClass) current.setAttribute("class", nextClass);
}

/**
 * 内联 style 的合并：先把运行时那几条读出来（连 `!important` 优先级一起），
 * 换上渲染器给的 style，再把运行时那几条写回去。
 *
 * ⛔ 不要图省事整条豁免 style：渲染器也会写（`shimmerPhaseStyle`），整条留下的话
 * 它的更新就永远落不到已存在的节点上。
 */
function syncStreamingInlineStyle(current: Element, next: Element): void {
  const style = (current as HTMLElement).style as CSSStyleDeclaration | undefined;
  const nextStyle = next.getAttribute("style");
  if (!style) {
    if (nextStyle === null) current.removeAttribute("style");
    else if (current.getAttribute("style") !== nextStyle) current.setAttribute("style", nextStyle);
    return;
  }
  const keep = RUNTIME_ONLY_STYLE_PROPS
    .map((prop) => ({
      prop,
      value: style.getPropertyValue(prop),
      priority: style.getPropertyPriority(prop),
    }))
    .filter((entry) => entry.value !== "");
  if (keep.length === 0) {
    if (nextStyle === null) current.removeAttribute("style");
    else if (current.getAttribute("style") !== nextStyle) current.setAttribute("style", nextStyle);
    return;
  }
  if (nextStyle === null) current.removeAttribute("style");
  else current.setAttribute("style", nextStyle);
  for (const entry of keep) style.setProperty(entry.prop, entry.value, entry.priority);
}

function createStreamingFade(value: string, doc: Document): Node {
  if (!value.trim()) return doc.createTextNode(value);
  const reducedMotion = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reducedMotion) return doc.createTextNode(value);
  const fade = doc.createElement("span");
  fade.className = "chat-stream-fade";
  fade.textContent = value;
  fade.addEventListener("animationend", () => {
    const parent = fade.parentNode;
    if (!parent) return;
    parent.replaceChild(doc.createTextNode(fade.textContent ?? ""), fade);
    parent.normalize();
  }, { once: true });
  return fade;
}

function createStreamingAppend(node: Node, doc: Document): Node {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue ?? "";
    return createStreamingFade(value, doc);
  }
  if (!(node instanceof Element)) return node.cloneNode(true);
  const clone = node.cloneNode(false) as Element;
  for (const child of Array.from(node.childNodes)) {
    clone.appendChild(createStreamingAppend(child, doc));
  }
  return clone;
}

/** 把 target 现有的全部文字换成淡入节点（新 text segment 首个大批次用）。 */
export function animateStreamingSubtree(target: HTMLElement): void {
  const doc = target.ownerDocument;
  const animated = Array.from(target.childNodes).map((node) => createStreamingAppend(node, doc));
  target.replaceChildren(...animated);
}

function patchStreamingTextLeaf(
  current: Element | DocumentFragment,
  next: Element | DocumentFragment,
): boolean {
  const nextChildren = Array.from(next.childNodes);
  if (nextChildren.length !== 1 || nextChildren[0].nodeType !== Node.TEXT_NODE) return false;
  const currentChildren = Array.from(current.childNodes);
  if (!currentChildren.every((node) => isStreamingTextPiece(node))) return false;
  const currentText = current.textContent ?? "";
  const nextText = nextChildren[0].nodeValue ?? "";
  if (currentText === nextText) return true;
  if (nextText.startsWith(currentText)) {
    const suffix = nextText.slice(currentText.length);
    if (suffix) current.appendChild(createStreamingFade(suffix, current.ownerDocument!));
    return true;
  }
  current.replaceChildren(createStreamingFade(nextText, current.ownerDocument!));
  return true;
}

function isStreamingTextPiece(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE ||
    (node instanceof Element && node.matches("span.chat-stream-fade"));
}

/** 节点身份用的 class 指纹：只看 markdown 渲染器写的那些，忽略运行时挂上去的。 */
function stableClassKey(el: Element): string {
  const own = Array.from(el.classList).filter((c) => !RUNTIME_ONLY_CLASSES.has(c));
  own.sort();
  return own.join(" ");
}

/**
 * 智能 UI 块内的轻量对账：带 data-ui-sig 的条目按指纹比，相同就整棵保留；
 * 其余容器按位置递归。⛔ 不走 patchStreamingChildren：那条路会把文本拆成渐隐 span（SVG 里画不出来）。
 */
function morphRichUi(current: Element, next: Element): void {
  const nextChildren = Array.from(next.childNodes);
  let i = 0;
  for (const n of nextChildren) {
    let c: ChildNode | null = current.childNodes[i] ?? null;
    while (c instanceof Element && c.matches(".ui-tip")) { i += 1; c = current.childNodes[i] ?? null; }
    if (!c) { current.appendChild(n); i += 1; continue; }
    if (c.nodeType === Node.TEXT_NODE && n.nodeType === Node.TEXT_NODE) {
      if (c.nodeValue !== n.nodeValue) c.nodeValue = n.nodeValue;
    } else if (c instanceof Element && n instanceof Element && c.tagName === n.tagName && stableClassKey(c) === stableClassKey(n)) {
      const sig = n.getAttribute("data-ui-sig");
      if (sig !== null) {
        if (c.getAttribute("data-ui-sig") !== sig) current.replaceChild(n, c);
      } else {
        syncStreamingAttributes(c, n);
        morphRichUi(c, n);
      }
    } else {
      current.replaceChild(n, c);
    }
    i += 1;
  }
  while (current.childNodes.length > i) {
    const extra = current.childNodes[i];
    if (extra instanceof Element && extra.matches(".ui-tip")) { i += 1; continue; }
    extra.remove();
  }
}

function patchStreamingNode(current: Node, next: Node): boolean {
  if (!(current instanceof Element) || !(next instanceof Element)) return false;
  if (current.tagName !== next.tagName) return false;
  // ⛔ 比较 class 时必须剔除运行时 class（见 RUNTIME_ONLY_CLASSES）。
  // 用裸 getAttribute("class") 比的话，凡是被 apple-corners / 表格滚动条接管过的节点，
  // 现存 DOM 上永远比新渲染出来的多一个 class → 判定"不是同一个节点" → 走
  // replaceChild 整块重建。代码块每帧被销毁重建一次，就是用户反复报的
  // 「模型还在输出时 MD 一直闪」（2026-08-27，之前几次都没查到这一层）。
  if (stableClassKey(current) !== stableClassKey(next)) return false;
  // 智能交互组件（rich-ui.ts）整块原子对账：key 相同 = 同一份数据，保留现有节点
  // （连同用户切过的标签页、拖过的滑块、浮层）；key 变了就整块替换。
  // ⛔ 不能往下走逐子节点 patch：文本会被拆成渐隐 <span>，塞进 SVG <text> 就画不出来了。
  if (current.matches(".ui-block")) {
    if (current.getAttribute("data-ui-key") === next.getAttribute("data-ui-key")) return true;
    // 流式渐进渲染中的列表型组件（rich-ui.ts STREAM_LISTS）：逐条目对账，写完的条目原样保留
    // （图片不重载、不闪），写完后的权威渲染也从这里接管、不整块重建。
    if (current.hasAttribute("data-ui-stream") && current.getAttribute("data-ui-type") === next.getAttribute("data-ui-type")) {
      syncStreamingAttributes(current, next);
      morphRichUi(current, next);
      return true;
    }
    return false;
  }
  if (patchStreamingCodeBlock(current, next)) return true;
  syncStreamingAttributes(current, next);
  patchStreamingChildren(current, next);
  return true;
}

/** 把 current 对账成 next：没变的节点原样保留，新增文字走尾字渐隐。 */
export function patchStreamingChildren(current: Element | DocumentFragment, next: Element | DocumentFragment): void {
  if (patchStreamingTextLeaf(current, next)) return;
  const nextChildren = Array.from(next.childNodes);
  const ownerDocument = current.ownerDocument!;
  let currentIndex = 0;

  for (const nextNode of nextChildren) {
    let currentNode: ChildNode | null = current.childNodes[currentIndex] ?? null;
    // 运行时注入的子节点不参与对账：拿它去和渲染器的下一个节点配对，会因为 tag/class
    // 对不上而走 replaceChild 把它换掉（审计 U-04）。今天它总在末尾，靠下面那个
    // while 就够；这里多跳一步是为了它以后换位置时不静默失效。
    while (currentNode instanceof Element && currentNode.matches(RUNTIME_ONLY_CHILD_SELECTOR)) {
      currentIndex += 1;
      currentNode = current.childNodes[currentIndex] ?? null;
    }
    if (nextNode.nodeType === Node.TEXT_NODE) {
      const run: Node[] = [];
      while (currentNode && isStreamingTextPiece(currentNode)) {
        run.push(currentNode);
        currentNode = currentNode.nextSibling;
      }
      const nextText = nextNode.nodeValue ?? "";
      if (!run.length) {
        current.insertBefore(createStreamingFade(nextText, ownerDocument), currentNode);
        currentIndex += 1;
        continue;
      }
      const currentText = run.map((node) => node.textContent ?? "").join("");
      if (nextText.startsWith(currentText)) {
        const suffix = nextText.slice(currentText.length);
        if (suffix) {
          current.insertBefore(createStreamingFade(suffix, ownerDocument), currentNode);
        }
        currentIndex += run.length + (suffix ? 1 : 0);
        continue;
      }
      current.insertBefore(createStreamingFade(nextText, ownerDocument), run[0]);
      for (const node of run) node.parentNode?.removeChild(node);
      currentIndex += 1;
      continue;
    }

    while (currentNode && isStreamingTextPiece(currentNode)) {
      currentNode.remove();
      currentNode = current.childNodes[currentIndex] ?? null;
    }
    if (!currentNode) {
      current.appendChild(createStreamingAppend(nextNode, ownerDocument));
    } else if (!currentNode.isEqualNode(nextNode) && !patchStreamingNode(currentNode, nextNode)) {
      current.replaceChild(createStreamingAppend(nextNode, ownerDocument), currentNode);
    }
    currentIndex += 1;
  }

  // 尾部多出来的节点要清掉，但**运行时注入的**不算多余（审计 U-04：表格渐隐轨道
  // `.md-table-hscroll` 就挂在这里，逐帧删掉 = 流式输出时轨道一直被销毁重建）。
  while (current.childNodes.length > currentIndex) {
    const node = current.childNodes[currentIndex];
    if (node instanceof Element && node.matches(RUNTIME_ONLY_CHILD_SELECTOR)) {
      currentIndex += 1;
      continue;
    }
    node.remove();
  }
}

/** 用一段新渲染好的 HTML 给 target 打增量补丁。 */
export function patchStreamingHtml(target: Element, html: string): void {
  const template = target.ownerDocument.createElement("template");
  template.innerHTML = html;
  patchStreamingChildren(target, template.content);
}
