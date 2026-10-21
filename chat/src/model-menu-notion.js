// Notion AI 模型菜单（2026-10-21）：DOM 结构与原子类名直接取自参考页
// 「Notion AI ｜ Notion (2026_10_21 15：50：46).html」的三个 role=dialog 菜单，
// 样式在 styles/notion-model-menu.css（同一批原子规则原样摘出）。
//
// 这里只负责「画」和「子菜单开合」，模型归属见 model-menu-layers.js；
// 选模型 / 付费闸门（.disabled / .quota-blocked / PAID+Upgrade）仍走 main.js
// 原有链路 —— 所以每一行都必须保留 .model-option、data-model 和一个
// .model-speed-dot（updateModelDropdownIndicators 找不到它会直接跳过该行）。

const MENUITEM_CLASS =
  "x87ps6o x1b7c0jy x1ypdohk xh8yej3 x78zum5 x1i5p2am x1whfx0g xr2y4jy x1ihp6rs xdxgbl4 xayv9eh";
const MENUITEM_STYLE =
  "--x-umghl:rgb(from var(--ca-bacIntTra) r g b/calc(alpha*(1 + 0.5*var(--btn-adj-mult,0)*1)));" +
  "--x-ph3bdx:rgb(from var(--ca-bacIntTra) r g b/calc(alpha*(1 + 0.5*var(--btn-adj-mult,1)*2)))";
const MENUITEM_OPEN_BG =
  "rgb(from var(--ca-bacIntTra) r g b/calc(alpha*(1 + 0.5*var(--btn-adj-mult,0)*1)))";
const ROW_INNER_CLASS =
  "x78zum5 x6s0dn4 xkds0cx xh8yej3 xif65rj x87ps6o xe0p6wg x3pnbk8 xfex06f xmzvs34 xf159sx";
const ICON_SLOT_CLASS = "x78zum5 x6s0dn4 xl56j7k xt4ypqs xisnujt x2lah0s";
const LABEL_SLOT_CLASS = "xeuugli x1isitws x4lel18 x1c9tiao";
const LABEL_TEXT_CLASS = "xuxw1ft x6ikm8r x10wlt62 xlyipyv";
const SECTION_CLASS =
  "x1n2onr6 x1iorvi4 x11lfxj5 xjkvuk6 x135b78x x78zum5 xdt5ytf xm83of2 x121lspk";
const SECTION_SEPARATOR_CLASS = "x10l6tqk x1pdr0v7 xjm9jq1 x102ppi5 x1r4y97 x9q68il";
const GROUP_HEADER_CLASS =
  "x78zum5 xmzvs34 xf159sx x1k70j0n x1e56ztr x1b8rd1j xgol4h7 xfifm61 xk50ysn xkds0cx x87ps6o x1winvzj";
const GROUP_HEADER_TEXT_CLASS = "xamitd3 xuxw1ft x6ikm8r x10wlt62 xlyipyv";
const BADGE_CLASS =
  "xamitd3 x1nn3v0j x11lfxj5 x1120s5i x135b78x xjwep3j x1t39747 x1wcsgtt x1pczhz8 x1j6dyjg xk50ysn xwn7fz2 xuxw1ft xt2wqj3 x14rh7hd";
const BADGE_STYLE = "--x-background:var(--ca-graBacSecTra);--x-color:var(--c-graTexAccPri)";
const DIALOG_CLASS =
  "x16qb05n xi7iut8 x1dm3dyd x1pv694p x1n2onr6 xvv7f4i xe0qb83 x1mmz80m x1t853zo xs1r7gh x4ma8is";
const DIALOG_SIZER_CLASS = "x78zum5 xdt5ytf x5lhr3w xkj4a21 xf68679 x16ye13r x1jols5v";
const DIALOG_SIZER_STYLE =
  "--x-width:max-content;--x-minWidth:240px;--x-maxWidth:calc(100vw - 24px);--x-height:100%;--x-maxHeight:70vh";
const SCROLLER_CLASS = "x1iyjqo2 x2lwn1j x17dzmu4 x14jbevu x6ikm8r x1odjw0f notion-scroller vertical";
const MENU_CLASS = "x16qb05n xi7iut8 x1dm3dyd x1pv694p";

const SVG_NS = "http://www.w3.org/2000/svg";
const CHEVRON_RIGHT_PATH =
  "M6.722 3.238a.625.625 0 1 0-.884.884L9.716 8l-3.878 3.878a.625.625 0 0 0 .884.884l4.32-4.32a.625.625 0 0 0 0-.884z";
const CHECKMARK_PATH =
  "M11.834 3.309a.625.625 0 0 1 1.072.642l-5.244 8.74a.625.625 0 0 1-1.01.085L3.155 8.699a.626.626 0 0 1 .95-.813l2.93 3.419z";

export const SUBMENU_OTHER = "other";
export const SUBMENU_OLDER = "older";
const SUBMENU_LEVEL = { [SUBMENU_OTHER]: 1, [SUBMENU_OLDER]: 2 };
const SUBMENU_TITLE = { [SUBMENU_OTHER]: "其他模型", [SUBMENU_OLDER]: "较早的模型" };

function el(tag, className, style) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (style) node.setAttribute("style", style);
  return node;
}

function svgIcon(className, pathD, style) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("role", "graphics-symbol");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", className);
  if (style) svg.setAttribute("style", style);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathD);
  svg.appendChild(path);
  return svg;
}

function chevronRight() {
  return svgIcon(
    "arrowChevronSingleRightSmall directional-icon x1lliihq x2lah0s x1kky2od xlup9mm x19zyb68 x14rh7hd",
    CHEVRON_RIGHT_PATH,
    "--x-fill:var(--c-icoSec);--x-color:var(--c-icoSec)",
  );
}

// 「GPT 6.1 Sol」→ 粗体「GPT」+ 灰字「6.1 Sol」，与参考页「Sonnet」+「5.5」同构。
function splitDisplayName(name) {
  const text = String(name || "").trim();
  const idx = text.indexOf(" ");
  if (idx <= 0) return [text, ""];
  return [text.slice(0, idx), text.slice(idx + 1)];
}

function buildSection(withSeparator) {
  const section = el("div", SECTION_CLASS + (withSeparator ? " xvijh9v" : ""));
  if (withSeparator) section.appendChild(el("div", SECTION_SEPARATOR_CLASS));
  return section;
}

function buildGroupHeader(text) {
  const header = el("div", GROUP_HEADER_CLASS + " nmm-group-header");
  const label = el("div", GROUP_HEADER_TEXT_CLASS);
  label.textContent = text;
  header.appendChild(label);
  return header;
}

// row: { id, displayName, iconPath, iconClass, title, available, unavailableMessage }
export function buildModelRow(row, { active, free }) {
  const item = el("div", "model-option nmm-item " + MENUITEM_CLASS, MENUITEM_STYLE);
  item.setAttribute("role", "menuitem");
  item.tabIndex = -1;
  item.dataset.model = row.id;
  item.dataset.canonical = row.canonicalId || row.id;
  item.dataset.lineLabel = row.lineLabel || "";
  item.dataset.multimodal = row.multimodal ? "true" : "false";
  if (row.brand) item.dataset.brand = row.brand;
  item.title = row.title || "";

  // 状态点：视觉上不显示（Notion 行没有），但 updateModelDropdownIndicators 依赖它。
  const speedDot = el("span", "model-speed-dot speed-unknown");
  item.appendChild(speedDot);

  const inner = el("div", ROW_INNER_CLASS);
  const iconSlot = el("div", ICON_SLOT_CLASS);
  const icon = document.createElement("img");
  icon.className = "nmm-icon" + (row.iconClass ? " " + row.iconClass : "");
  icon.src = row.iconPath || "./openai.svg";
  icon.alt = "";
  icon.width = 16;
  icon.height = 16;
  iconSlot.appendChild(icon);
  inner.appendChild(iconSlot);

  const labelSlot = el("div", LABEL_SLOT_CLASS, "--x-marginInlineStart:0px;--x-marginInlineEnd:0px");
  const labelText = el("div", LABEL_TEXT_CLASS);
  labelText.setAttribute("role", "presentation");
  const nameRow = el("div", "x78zum5", "align-items:baseline;gap:4px");
  const [primary, secondary] = splitDisplayName(row.displayName || row.id);
  const strong = el("div", "nmm-name", "font-size:14px;line-height:20px;font-weight:500");
  strong.textContent = primary;
  nameRow.appendChild(strong);
  if (secondary) {
    const soft = el("div", "nmm-name-secondary", "color:var(--c-texSec);font-size:14px;line-height:20px;font-weight:400");
    soft.textContent = secondary;
    nameRow.appendChild(soft);
  }
  labelText.appendChild(nameRow);
  labelSlot.appendChild(labelText);
  inner.appendChild(labelSlot);

  // 行右侧：FREE 胶囊（复用参考页「测试版」徽章的同一组原子类）+ 选中勾。
  const trailing = el("div", "xvc5jky xeuugli x2lah0s x78zum5 x6s0dn4 nmm-trailing", "gap:6px");
  if (free) {
    const badge = el("div", BADGE_CLASS + " nmm-free-badge", BADGE_STYLE);
    badge.textContent = "FREE";
    trailing.appendChild(badge);
  }
  const check = svgIcon(
    "checkmarkSmall x1lliihq x2lah0s x1kky2od xlup9mm x1kihv7h x1heor9g x1hc1fzr nmm-check",
    CHECKMARK_PATH,
  );
  trailing.appendChild(check);
  inner.appendChild(trailing);

  item.appendChild(inner);
  item.classList.toggle("active", Boolean(active));
  if (row.available === false) {
    item.classList.add("disabled");
    item.title = row.unavailableMessage || item.title;
  }
  return item;
}

function buildSubmenuTrigger(submenu, text) {
  const item = el("div", "nmm-submenu-trigger " + MENUITEM_CLASS, MENUITEM_STYLE);
  item.setAttribute("role", "menuitem");
  item.tabIndex = -1;
  item.setAttribute("aria-haspopup", "dialog");
  item.setAttribute("aria-expanded", "false");
  item.dataset.submenu = submenu;
  const inner = el("div", ROW_INNER_CLASS);
  const labelSlot = el("div", LABEL_SLOT_CLASS, "--x-marginInlineStart:0px;--x-marginInlineEnd:0px");
  const label = el("div", LABEL_TEXT_CLASS);
  label.setAttribute("role", "presentation");
  label.textContent = text;
  labelSlot.appendChild(label);
  inner.appendChild(labelSlot);
  const chevronSlot = el("div", "x2lah0s");
  chevronSlot.appendChild(chevronRight());
  inner.appendChild(chevronSlot);
  item.appendChild(inner);
  return item;
}

// 窄屏下子菜单盖在上一层上面，需要一个返回行（桌面端由 CSS 隐藏）。
function buildBackRow(text) {
  const item = el("div", "nmm-back-row " + MENUITEM_CLASS, MENUITEM_STYLE);
  item.setAttribute("role", "menuitem");
  item.tabIndex = -1;
  item.dataset.submenuBack = "1";
  const inner = el("div", ROW_INNER_CLASS);
  const chevronSlot = el("div", "x2lah0s nmm-back-chevron");
  chevronSlot.appendChild(chevronRight());
  inner.appendChild(chevronSlot);
  const labelSlot = el("div", LABEL_SLOT_CLASS, "--x-marginInlineStart:0px;--x-marginInlineEnd:0px");
  const label = el("div", LABEL_TEXT_CLASS);
  label.textContent = text;
  labelSlot.appendChild(label);
  inner.appendChild(labelSlot);
  item.appendChild(inner);
  return item;
}

function buildPanel(submenu) {
  const panel = el("div", "nmm-panel");
  panel.dataset.layer = submenu;
  panel.dataset.level = String(SUBMENU_LEVEL[submenu]);
  panel.hidden = true;
  const dialog = el("div", DIALOG_CLASS);
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", SUBMENU_TITLE[submenu]);
  const sizer = el("div", DIALOG_SIZER_CLASS, DIALOG_SIZER_STYLE);
  const scroller = el("div", SCROLLER_CLASS);
  const menu = el("div", MENU_CLASS);
  menu.setAttribute("role", "menu");
  scroller.appendChild(menu);
  sizer.appendChild(scroller);
  dialog.appendChild(sizer);
  panel.appendChild(dialog);
  return { panel, menu };
}

function appendGroupedRows(menu, groups, makeRow, firstWithSeparator) {
  let first = true;
  for (const [title, rows] of groups) {
    if (!rows.length) continue;
    const section = buildSection(first ? firstWithSeparator : false);
    if (title) section.appendChild(buildGroupHeader(title));
    rows.forEach((r) => section.appendChild(makeRow(r)));
    menu.appendChild(section);
    first = false;
  }
  return !first;
}

function groupByBrand(rows) {
  const groups = new Map();
  rows.forEach((r) => {
    const brand = r.brand || "Other";
    if (!groups.has(brand)) groups.set(brand, []);
    groups.get(brand).push(r);
  });
  return Array.from(groups.entries());
}

// 渲染三层菜单。content = 第一层容器（#modelDropdownContent），
// dropdown = 子菜单面板的定位宿主（#modelDropdown）。
// layers = { recommended, other, older }（或 search 结果时 { results }）。
export function renderNotionModelMenu({ dropdown, content, layers, searchResults, makeRow }) {
  dropdown.querySelectorAll(":scope > .nmm-panel").forEach((p) => p.remove());
  content.textContent = "";
  const rootMenu = el("div", MENU_CLASS + " nmm-root-menu");
  rootMenu.setAttribute("role", "menu");
  content.appendChild(rootMenu);

  if (searchResults) {
    const any = appendGroupedRows(rootMenu, groupByBrand(searchResults), makeRow, false);
    if (!any) {
      const section = buildSection(false);
      const empty = el("div", GROUP_HEADER_CLASS + " nmm-empty");
      empty.textContent = "没有匹配的模型";
      section.appendChild(empty);
      rootMenu.appendChild(section);
    }
    return;
  }

  // 第一层：推荐 + 「其他模型 ›」
  const hasRecommended = appendGroupedRows(rootMenu, [["推荐", layers.recommended]], makeRow, false);
  const hasOther = layers.other.length > 0 || layers.older.length > 0;
  if (hasOther) {
    const section = buildSection(hasRecommended);
    section.appendChild(buildSubmenuTrigger(SUBMENU_OTHER, SUBMENU_TITLE[SUBMENU_OTHER]));
    rootMenu.appendChild(section);

    // 第二层：按品牌分组 + 「较早的模型 ›」
    const other = buildPanel(SUBMENU_OTHER);
    other.menu.appendChild(buildBackRow("返回"));
    const hasBrandRows = appendGroupedRows(other.menu, groupByBrand(layers.other), makeRow, false);
    if (layers.older.length) {
      const section2 = buildSection(hasBrandRows);
      section2.appendChild(buildSubmenuTrigger(SUBMENU_OLDER, SUBMENU_TITLE[SUBMENU_OLDER]));
      other.menu.appendChild(section2);

      // 第三层：较早的模型（参考页同样只有一个总标题，不再按品牌分组）
      const older = buildPanel(SUBMENU_OLDER);
      older.menu.appendChild(buildBackRow("返回"));
      appendGroupedRows(older.menu, [[SUBMENU_TITLE[SUBMENU_OLDER], layers.older]], makeRow, false);
      dropdown.appendChild(other.panel);
      dropdown.appendChild(older.panel);
    } else {
      dropdown.appendChild(other.panel);
    }
  }
}

// ── 子菜单开合 ────────────────────────────────────────────────
function panelLevel(node) {
  const panel = node && node.closest ? node.closest(".nmm-panel") : null;
  return panel ? Number(panel.dataset.level) || 0 : 0;
}

function setTriggerExpanded(trigger, expanded) {
  trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
  trigger.classList.toggle("xt2wqj3", expanded);
  trigger.style.setProperty("--x-background", expanded ? MENUITEM_OPEN_BG : "");
}

export function closeNotionSubmenus(dropdown, fromLevel = 1) {
  if (!dropdown) return;
  dropdown.querySelectorAll(":scope > .nmm-panel").forEach((panel) => {
    if (Number(panel.dataset.level) >= fromLevel) panel.hidden = true;
  });
  dropdown.querySelectorAll(".nmm-submenu-trigger").forEach((trigger) => {
    const level = SUBMENU_LEVEL[trigger.dataset.submenu] || 1;
    if (level >= fromLevel) setTriggerExpanded(trigger, false);
  });
}

function positionPanel(dropdown, panel, trigger) {
  const host = trigger.closest(".nmm-panel")?.firstElementChild || dropdown;
  const hostRect = host.getBoundingClientRect();
  const ddRect = dropdown.getBoundingClientRect();
  const anchorRect = trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 4;
  const margin = 8;
  panel.style.visibility = "hidden";
  panel.hidden = false;
  const dialog = panel.firstElementChild;
  const pw = dialog.offsetWidth;
  const ph = dialog.offsetHeight;
  let left = hostRect.right + gap;
  if (left + pw > vw - margin) left = hostRect.left - gap - pw;
  if (left < margin) left = Math.max(margin, vw - margin - pw);
  // 第一行与触发行对齐（参考页同样是从触发行往上展开）
  let top = anchorRect.top - 4;
  if (top + ph > vh - margin) top = vh - margin - ph;
  if (top < margin) top = margin;
  panel.style.left = `${Math.round(left - ddRect.left)}px`;
  panel.style.top = `${Math.round(top - ddRect.top)}px`;
  panel.style.visibility = "";
}

function openSubmenu(dropdown, trigger) {
  const submenu = trigger.dataset.submenu;
  const level = SUBMENU_LEVEL[submenu] || 1;
  const panel = dropdown.querySelector(`:scope > .nmm-panel[data-layer="${submenu}"]`);
  if (!panel) return;
  if (!panel.hidden && trigger.getAttribute("aria-expanded") === "true") return;
  closeNotionSubmenus(dropdown, level);
  setTriggerExpanded(trigger, true);
  positionPanel(dropdown, panel, trigger);
}

// 绑定一次即可：事件委托在 dropdown 上，重渲染不需要重新绑定。
export function bindNotionSubmenus(dropdown, { isCompact }) {
  if (!dropdown || dropdown.dataset.nmmBound === "1") return;
  dropdown.dataset.nmmBound = "1";
  let closeTimer = 0;
  let closeFromLevel = Infinity;

  const cancelClose = () => {
    clearTimeout(closeTimer);
    closeTimer = 0;
    closeFromLevel = Infinity;
  };
  const scheduleClose = (fromLevel) => {
    if (closeTimer && fromLevel >= closeFromLevel) return;
    clearTimeout(closeTimer);
    closeFromLevel = fromLevel;
    // 给斜着移向子菜单的鼠标留时间（经过兄弟行时不立刻收起）
    closeTimer = setTimeout(() => {
      closeTimer = 0;
      closeNotionSubmenus(dropdown, fromLevel);
      closeFromLevel = Infinity;
    }, 250);
  };

  dropdown.addEventListener("mouseover", (e) => {
    if (isCompact()) return;
    const level = panelLevel(e.target);
    if (closeTimer && level >= closeFromLevel) cancelClose();
    const trigger = e.target.closest(".nmm-submenu-trigger");
    if (trigger && dropdown.contains(trigger)) {
      cancelClose();
      openSubmenu(dropdown, trigger);
      return;
    }
    const row = e.target.closest('[role="menuitem"]');
    if (row && dropdown.querySelector(`:scope > .nmm-panel:not([hidden])`)) {
      const deeperOpen = Array.from(dropdown.querySelectorAll(":scope > .nmm-panel:not([hidden])"))
        .some((p) => Number(p.dataset.level) > level);
      if (deeperOpen) scheduleClose(level + 1);
    }
  });

  dropdown.addEventListener("click", (e) => {
    const back = e.target.closest("[data-submenu-back]");
    if (back && dropdown.contains(back)) {
      e.stopPropagation();
      closeNotionSubmenus(dropdown, panelLevel(back));
      return;
    }
    const trigger = e.target.closest(".nmm-submenu-trigger");
    if (!trigger || !dropdown.contains(trigger)) return;
    e.stopPropagation();
    cancelClose();
    const level = SUBMENU_LEVEL[trigger.dataset.submenu] || 1;
    if (trigger.getAttribute("aria-expanded") === "true") closeNotionSubmenus(dropdown, level);
    else openSubmenu(dropdown, trigger);
  });
}

// ── 输入框旁的「信号格」消耗指示（参考页 agent-service-reasoning-effort-button 内的 5 根柱）──
const SIGNAL_BAR_HEIGHTS = [3, 5, 7, 9, 11];

export function renderCostSignal(container, level, label) {
  if (!container) return;
  const clamped = Math.max(1, Math.min(5, Math.round(level) || 1));
  let bars = container.querySelector(":scope > .nmm-signal-bars");
  if (!bars) {
    bars = el(
      "div",
      "nmm-signal-bars",
      "display:flex;align-items:flex-end;justify-content:center;gap:1px;width:20px;height:16px;padding-bottom:2px;box-sizing:border-box;flex-shrink:0",
    );
    bars.setAttribute("aria-hidden", "true");
    SIGNAL_BAR_HEIGHTS.forEach((h) => {
      bars.appendChild(el("div", "", `width:3px;border-radius:1.5px;flex-shrink:0;height:${h}px`));
    });
    container.appendChild(bars);
  }
  Array.from(bars.children).forEach((bar, i) => {
    const pct = i < clamped ? 100 : 0;
    bar.style.backgroundImage = `linear-gradient(to right,var(--c-icoSec) ${pct}%,var(--c-icoDis) ${pct}%)`;
  });
  container.dataset.level = String(clamped);
  container.setAttribute("aria-label", label);
  container.title = label;
}
