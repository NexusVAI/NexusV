/**
 * claude-port-layout.js — 首页主区 / 对话贴底 双骨架切换（不改视觉，只搬节点 + 显隐）
 *
 * 首页 DOM：#portHomePane（来自 chat首页.html）
 * 对话 DOM：#chatColumn（来自对话快照，含 #messageList + #composerDock）
 * 信号源：shim #homeView.chatting（main.js / cancri_chat.js 已有约定）
 * textarea#homeInput 只有一份，在 #portHomeEditorHost ↔ #portChatEditorHost 间移动，
 * 保证 cancri_chat 启动时拿到的元素引用始终有效。
 */
(function () {
  var PORT_SOURCE_DIR = "移植，直接搬";
  var PORT_COMPONENTS = Object.freeze([
    { id: "ai-prompt-block", file: "ai提问块.html", kind: "prompt-block" },
    { id: "artifacts", file: "Artifacts页面（深色（.html", kind: "page" },
    { id: "home", file: "chat首页.html", kind: "base" },
    { id: "code", file: "Code页面.html", kind: "page" },
    { id: "cowork-safety", file: "cowork的安全弹窗.html", kind: "page" },
    { id: "mcp-chat-card", file: "MCP+对话卡片.html", kind: "article" },
    { id: "projects", file: "Projects 页面 深色).html", kind: "page" },
    { id: "light-home", file: "白色首页.html", kind: "home-state" },
    { id: "image-open", file: "打开输入框的图片.html", kind: "dialog" },
    { id: "skills-page-3", file: "第九页技能的分页3.html", kind: "dialog" },
    { id: "chats", file: "对话列表.html", kind: "page" },
    { id: "chat-plus", file: "对话内的+菜单.html", kind: "menu" },
    { id: "chat-more", file: "对话三点菜单.html", kind: "menu" },
    { id: "chat-search", file: "对话搜索卡片.html", kind: "dialog" },
    { id: "chat-sidecar", file: "对话页+输入框的副栏.html", kind: "page" },
    { id: "reflection-home", file: "反思首页.html", kind: "page" },
    { id: "reflection-loading", file: "反思页面加载中.html", kind: "page" },
    { id: "share", file: "分享卡片.html", kind: "dialog" },
    { id: "chat-rich-content", file: "覆盖样式的对话页（例如气泡上的图片，气泡上的方块装着文字）.html", kind: "page" },
    { id: "scheduled", file: "计划任务首页.html", kind: "page" },
    { id: "memory-settings", file: "记忆设定.html", kind: "dialog" },
    { id: "memory-chat", file: "记忆页交流.html", kind: "page" },
    { id: "claude-password-chat", file: "克劳德密码对话页.html", kind: "page" },
    { id: "design", file: "克劳德设计.html", kind: "body-page" },
    { id: "design-params", file: "克劳德设计参数页.html", kind: "body-page" },
    { id: "design-chat", file: "克劳德设计对话页.html", kind: "body-page" },
    { id: "design-home", file: "克劳德设计首页.html", kind: "page" },
    { id: "model-menu", file: "模型菜单样式.html", kind: "menu" },
    { id: "settings-password", file: "设置第八页克劳德密码.html", kind: "dialog" },
    { id: "settings-2", file: "设置第二页.html", kind: "dialog" },
    { id: "settings-skills", file: "设置第九页技能.html", kind: "dialog" },
    { id: "settings-skills-mcp", file: "设置第九页技能的MCP页.html", kind: "dialog" },
    { id: "settings-7-notice", file: "设置第七页+提醒弹窗.html", kind: "dialog" },
    { id: "settings-3", file: "设置第三页.html", kind: "dialog" },
    { id: "settings-4", file: "设置第四页.html", kind: "dialog" },
    { id: "settings-1", file: "设置第一页.html", kind: "dialog" },
    { id: "settings-card", file: "设置小卡片.html", kind: "menu" },
    { id: "usage", file: "设置-用量页面.html", kind: "dialog" },
    { id: "web-search-chat", file: "深色模式对话页+AI搜索工具样式+正文的网页标注样式.html", kind: "page" },
    { id: "dark-home-upload", file: "深色模式首页+首页上传文件输入框样式.html", kind: "composer" },
    { id: "code-first", file: "首次进入code页的卡片.html", kind: "page" },
    { id: "home-toast", file: "首页右下角弹窗.html", kind: "toast" },
    { id: "plus-menu", file: "输入框的 + 号菜单.html", kind: "menu" },
    { id: "file-effort", file: "输入框文件样式+模型菜单Effort.html", kind: "composer" },
    { id: "prompt-category-state", file: "输入框下5个卡片的点击后效果.html", kind: "prompt-grid" },
    { id: "drag-upload", file: "拖动上传文件样式.html", kind: "composer" },
    { id: "project-chat", file: "项目内对话.html", kind: "page" },
    { id: "project-components", file: "项目页面各项组件.html", kind: "page" },
    { id: "project-deep", file: "项目页面更深处，深色.html", kind: "page" },
    { id: "model-promo", file: "新模型的推广卡片.html", kind: "dialog" },
    { id: "bubble-style", file: "修改对话中气泡的样式.html", kind: "message-template" },
    { id: "privacy-chat", file: "隐私对话页面样式.html", kind: "page" },
    { id: "privacy-chat-entered", file: "隐私对话页已进入+右下角提醒.html", kind: "page" },
    { id: "language", file: "语言2.html", kind: "dialog" },
    { id: "voice", file: "语音.html", kind: "page" },
    { id: "sidebar-collapsed", file: "左侧边栏收起后样式+设置小卡片.html", kind: "sidebar" },
  ]);
  var PORT_COMPONENT_BY_ID = new Map(
    PORT_COMPONENTS.map(function (component) {
      return [component.id, component];
    }),
  );
  var portMountState = new Map();
  var portSourceCache = new Map();
  var portReturnFocus = new Map();
  var portConcealedRegions = new Map();

  function normalizePortText(value) {
    return String(value || "")
      .replace(/[\uE000-\uF8FF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function portSourceUrl(file) {
    return new URL(
      "../" + encodeURIComponent(PORT_SOURCE_DIR) + "/" + encodeURIComponent(file),
      window.location.href,
    ).href;
  }

  function portOwnerForKind(kind) {
    if (kind === "page" || kind === "body-page" || kind === "home-state") return "page";
    if (kind === "sidebar") return "sidebar";
    if (kind === "composer") return "composer";
    if (kind === "article" || kind === "prompt-block") return "message";
    if (kind === "prompt-grid") return "prompt";
    return "transient";
  }

  function lastNode(list) {
    return list.length ? list[list.length - 1] : null;
  }

  function findNodeByText(doc, text) {
    var wanted = normalizePortText(text);
    if (!wanted) return null;
    var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    var node;
    while ((node = walker.nextNode())) {
      if (node.children.length > 4) continue;
      var actual = normalizePortText(node.textContent);
      if (actual === wanted || actual.includes(wanted)) return node;
    }
    return null;
  }

  function rewritePortCssUrls(css, sourceUrl) {
    return css.replace(
      /url\(\s*(["']?)(?!data:|blob:|https?:|\/|#)([^"')]+)\1\s*\)/gi,
      function (_all, quote, rawPath) {
        return "url(" + (quote || "\"") + new URL(rawPath.trim(), sourceUrl).href + (quote || "\"") + ")";
      },
    );
  }

  async function loadPortSource(component) {
    if (portSourceCache.has(component.file)) return portSourceCache.get(component.file);
    var promise = (async function () {
      var url = portSourceUrl(component.file);
      var response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error("HTTP " + response.status + " " + component.file);
      var html = await response.text();
      var parsed = new DOMParser().parseFromString(html, "text/html");
      parsed
        .querySelectorAll(
          "script,iframe,object,embed,template,yd-mg-icon,yd-mg-block-icon," +
            "yd-image-ocr,yd-mg-huaci,yd-floating-ball,#CEB-extension-all," +
            ".intercom-lightweight-app,[class*='-booster-visusalizer']",
        )
        .forEach(function (node) {
          node.remove();
        });
      var css = Array.from(parsed.head.querySelectorAll("style"))
        .filter(function (style) {
          return !style.closest("template") && !/sf-hidden/.test(style.getAttribute("data-sf-original-href") || "");
        })
        .map(function (style) {
          return style.textContent || "";
        })
        .join("\n");
      return {
        doc: parsed,
        css: rewritePortCssUrls(css, url),
        mode: parsed.querySelector('[data-mode="dark"]') ? "dark" : "light",
      };
    })();
    portSourceCache.set(component.file, promise);
    promise.catch(function () {
      portSourceCache.delete(component.file);
    });
    while (portSourceCache.size > 4) {
      portSourceCache.delete(portSourceCache.keys().next().value);
    }
    return promise;
  }

  function floatingContext(node, doc) {
    if (!node) return null;
    var best = node;
    var current = node.parentElement;
    var depth = 0;
    while (current && current !== doc.body && depth < 6) {
      var signature =
        (current.getAttribute("class") || "") + " " +
        (current.getAttribute("style") || "") + " " +
        (current.getAttribute("data-floating-ui-portal") || "");
      if (/\bfixed\b|\babsolute\b|position\s*:\s*(?:fixed|absolute)|inset-0|z-\[|z-\d/.test(signature)) {
        best = current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return best;
  }

  function compactTextComponent(node, doc, minimumButtons) {
    if (!node) return null;
    var best = node;
    var current = node;
    while (current && current !== doc.body) {
      var buttons = current.querySelectorAll("button,[role='button'],[role='option']").length;
      var textLength = normalizePortText(current.textContent).length;
      if (buttons >= minimumButtons && textLength < 2200) best = current;
      if (buttons > 12 || textLength > 2200) break;
      current = current.parentElement;
    }
    return best;
  }

  function selectPortFragment(source, component) {
    var doc = source.doc;
    var node = null;
    if (component.kind === "menu") {
      node = lastNode(Array.from(doc.querySelectorAll('[role="menu"]')));
      return floatingContext(node, doc);
    }
    if (component.kind === "dialog") {
      node = lastNode(Array.from(doc.querySelectorAll('[role="dialog"]')));
      if (!node) node = lastNode(Array.from(doc.querySelectorAll('[role="menu"]')));
      if (!node) node = doc.querySelector('[role="main"]');
      return floatingContext(node, doc);
    }
    if (component.kind === "page" || component.kind === "home-state") {
      return doc.querySelector('[role="main"]') || doc.querySelector("main");
    }
    if (component.kind === "body-page") {
      var bodyPage = doc.createElement("div");
      Array.from(doc.body.children).forEach(function (child) {
        bodyPage.appendChild(child.cloneNode(true));
      });
      return bodyPage;
    }
    if (component.kind === "sidebar") {
      var sidebar = doc.querySelector("aside") || doc.querySelector('nav[aria-label="Sidebar"]');
      if (!sidebar) return null;
      var sidebarBundle = doc.createElement("div");
      sidebarBundle.appendChild(sidebar.cloneNode(true));
      Array.from(doc.querySelectorAll('[role="menu"]')).forEach(function (menu) {
        sidebarBundle.appendChild(floatingContext(menu, doc).cloneNode(true));
      });
      return sidebarBundle;
    }
    if (component.kind === "composer") {
      node = doc.querySelector('[data-testid="chat-input"]');
      var composer = node?.closest("fieldset") || node?.parentElement || null;
      if (!composer) return null;
      var composerBundle = doc.createElement("div");
      composerBundle.appendChild(composer.cloneNode(true));
      var addedFloating = new Set();
      Array.from(doc.querySelectorAll('[role="menu"],[role="dialog"]')).forEach(function (floating) {
        if (composer.contains(floating)) return;
        var context = floatingContext(floating, doc);
        if (addedFloating.has(context)) return;
        addedFloating.add(context);
        composerBundle.appendChild(context.cloneNode(true));
      });
      return composerBundle;
    }
    if (component.kind === "article") {
      return lastNode(Array.from(doc.querySelectorAll('[role="article"]')));
    }
    if (component.kind === "toast") {
      var fixedBottom = Array.from(doc.querySelectorAll('[class*="fixed"]')).filter(function (candidate) {
        var cls = candidate.getAttribute("class") || "";
        return /bottom|right/.test(cls) && normalizePortText(candidate.textContent).length > 8;
      });
      node = lastNode(fixedBottom) || findNodeByText(doc, "Reflect on how you use Claude");
      return compactTextComponent(node, doc, 1);
    }
    if (component.kind === "prompt-grid") {
      node = findNodeByText(doc, "Track personal goals") || findNodeByText(doc, "Roleplay difficult conversations");
      return compactTextComponent(node, doc, 3);
    }
    if (component.kind === "prompt-block") {
      node = findNodeByText(doc, "先理清方向和优先级") || findNodeByText(doc, "直接讨论技术实现路径");
      return compactTextComponent(node, doc, 3);
    }
    return null;
  }

  function portRegionNode(owner) {
    if (owner === "page") {
      return document.querySelector('[data-route-outlet]') || document.getElementById("main-content");
    }
    if (owner === "sidebar") {
      return document.querySelector("aside") || document.querySelector('nav[aria-label="Sidebar"]');
    }
    if (owner === "composer") return document.getElementById("homeInput")?.closest("fieldset") || null;
    if (owner === "prompt") return document.querySelector('[aria-label="Prompt categories"]');
    return null;
  }

  function portRegionRect(owner) {
    var target = portRegionNode(owner);
    if (!target) return null;
    return target.getBoundingClientRect();
  }

  function ensurePortHost(owner) {
    var id = "port" + owner[0].toUpperCase() + owner.slice(1) + "ComponentHost";
    var host = document.getElementById(id);
    if (host) return host;
    host = document.createElement("div");
    host.id = id;
    host.hidden = true;
    host.dataset.portOwner = owner;
    host.attachShadow({ mode: "open" });
    var parent = document.body;
    if (owner === "message") parent = document.getElementById("messageList") || parent;
    if (owner === "prompt") {
      var promptCategories = document.querySelector('[aria-label="Prompt categories"]');
      parent = promptCategories?.parentElement || document.getElementById("portHomePane") || parent;
    }
    parent.appendChild(host);
    return host;
  }

  function concealPortRegion(owner) {
    if (!/^(sidebar|composer|prompt)$/.test(owner) || portConcealedRegions.has(owner)) return;
    var region = portRegionNode(owner);
    if (!region) return;
    portConcealedRegions.set(owner, { node: region, visibility: region.style.visibility });
    region.style.visibility = "hidden";
  }

  function restorePortRegion(owner) {
    var record = portConcealedRegions.get(owner);
    if (!record) return;
    record.node.style.visibility = record.visibility;
    portConcealedRegions.delete(owner);
  }

  function closePortOwner(owner, restoreFocus) {
    var host = ensurePortHost(owner);
    if (host.hidden) {
      restorePortRegion(owner);
      return;
    }
    host.hidden = true;
    host.removeAttribute("data-port-component");
    host.style.removeProperty("left");
    host.style.removeProperty("top");
    host.style.removeProperty("width");
    host.style.removeProperty("height");
    host.shadowRoot.replaceChildren();
    portMountState.delete(owner);
    restorePortRegion(owner);
    var trigger = portReturnFocus.get(owner);
    portReturnFocus.delete(owner);
    if (restoreFocus !== false && trigger?.focus) trigger.focus();
  }

  function closeAllPortComponents(restoreFocus) {
    ["transient", "composer", "prompt", "message", "page", "sidebar"].forEach(function (owner) {
      closePortOwner(owner, restoreFocus);
    });
  }

  function positionPortHost(host, owner) {
    var rect = portRegionRect(owner);
    if (!rect) return;
    host.style.left = rect.left + "px";
    host.style.top = rect.top + "px";
    host.style.width = rect.width + "px";
    host.style.height = rect.height + "px";
  }

  async function openPortComponent(id, trigger) {
    var component = PORT_COMPONENT_BY_ID.get(id);
    if (!component) throw new Error("unknown Claude component " + id);
    if (/^(base|message-template|style-source|framework-style)$/.test(component.kind)) return false;
    var owner = portOwnerForKind(component.kind);
    var host = ensurePortHost(owner);
    var token = Symbol(id);
    portMountState.set(owner, token);
    portReturnFocus.set(owner, trigger || document.activeElement);
    var source = await loadPortSource(component);
    if (portMountState.get(owner) !== token) return false;
    var fragment = selectPortFragment(source, component);
    if (!fragment) throw new Error("no fragment for " + component.file + " (" + component.kind + ")");

    host.hidden = false;
    host.dataset.portComponent = id;
    positionPortHost(host, owner);
    concealPortRegion(owner);
    var shadow = host.shadowRoot;
    shadow.replaceChildren();

    var baseStyle = document.createElement("style");
    baseStyle.textContent =
      ":host{all:initial;display:block;box-sizing:border-box;font-family:Anthropic Sans,Arial,sans-serif}" +
      "*,*::before,*::after{box-sizing:border-box}" +
      "#portDismiss{position:fixed;inset:0;border:0;background:transparent;padding:0;margin:0;pointer-events:auto}" +
      "#portSourceRoot{width:100%;height:100%;position:relative;color:inherit}" +
      "#portFragment{width:100%;height:100%;position:relative;pointer-events:auto}" +
      ":host([data-port-owner=transient]) #portFragment{width:auto;height:auto}" +
      ":host([data-port-owner=message]) #portSourceRoot,:host([data-port-owner=message]) #portFragment," +
      ":host([data-port-owner=prompt]) #portSourceRoot,:host([data-port-owner=prompt]) #portFragment{height:auto}";
    var sourceStyle = document.createElement("style");
    sourceStyle.textContent = source.css;
    shadow.append(sourceStyle, baseStyle);

    if (owner === "transient") {
      var dismiss = document.createElement("button");
      dismiss.id = "portDismiss";
      dismiss.type = "button";
      dismiss.setAttribute("aria-label", "Close");
      dismiss.addEventListener("click", function () {
        closePortOwner("transient", true);
      });
      shadow.appendChild(dismiss);
    }

    var sourceRoot = document.createElement("div");
    sourceRoot.id = "portSourceRoot";
    sourceRoot.className = "cds-root text-primary contents " + (source.mode === "dark" ? "dark" : "");
    sourceRoot.setAttribute("data-theme", "claude");
    sourceRoot.setAttribute("data-mode", source.mode);
    sourceRoot.setAttribute("data-density", "comfortable");
    sourceRoot.setAttribute("data-platform", "web");
    sourceRoot.setAttribute("data-font", "anthropic");
    var fragmentHost = document.createElement("div");
    fragmentHost.id = "portFragment";
    fragmentHost.appendChild(document.importNode(fragment, true));
    sourceRoot.appendChild(fragmentHost);
    shadow.appendChild(sourceRoot);
    if (id === "image-open") hydratePortImagePreview(shadow, trigger);
    bindPortComponentEvents(host, component, owner);
    return true;
  }

  function hydratePortImagePreview(shadow, trigger) {
    var liveImage = trigger?.closest?.(".attachment-item")?.querySelector("img") || trigger?.querySelector?.("img");
    if (!liveImage?.src) return;
    var previewImage = shadow.querySelector('[role="dialog"] img');
    if (!previewImage) return;
    previewImage.src = liveImage.src;
    previewImage.alt = liveImage.alt || "Attachment preview";
    var heading = shadow.querySelector('[role="dialog"] h1,[role="dialog"] h2,[role="dialog"] h3');
    if (heading && liveImage.alt) heading.textContent = "Preview of " + liveImage.alt;
  }

  function routePortSettingsTab(text) {
    if (/^(overview|概览|简介)$/.test(text)) return "settings-1";
    if (/^(account|账号|账户)$/.test(text)) return "settings-2";
    if (/^(privacy|隐私)$/.test(text)) return "settings-3";
    if (/^(billing|账单)$/.test(text)) return "settings-4";
    if (/^(capabilities|能力|reflection|反思)$/.test(text)) return "reflection-home";
    if (/^(time and focus|时间与专注)$/.test(text)) return "settings-7-notice";
    if (/claude password|克劳德密码/.test(text)) return "settings-password";
    if (/^(skills|技能)$/.test(text)) return "settings-skills";
    if (/connectors|plugins|连接器|插件|mcp/.test(text)) return "settings-skills-mcp";
    if (/^(memory|记忆)$/.test(text)) return "memory-settings";
    return "";
  }

  function routePortHref(rawHref) {
    if (!rawHref || rawHref === "#") return "";
    var url;
    try {
      url = new URL(rawHref, "https://claude.ai/");
    } catch (_error) {
      return "";
    }
    var path = url.pathname;
    if (path === "/" || path === "/new") return "$home";
    if (path.startsWith("/recents")) return "chats";
    if (path.startsWith("/projects")) return "projects";
    if (path.startsWith("/artifacts")) return "artifacts";
    if (path.startsWith("/code")) return "code-first";
    if (path.startsWith("/customize")) return "settings-1";
    if (path.startsWith("/discover/design")) return "design-home";
    if (path.startsWith("/chat/")) return "$chat";
    return "";
  }

  function routePortControl(componentId, text, aria, testId, href) {
    var hrefRoute = routePortHref(href);
    if (hrefRoute) return hrefRoute;
    var settingsRoute = routePortSettingsTab(text);
    if (settingsRoute) return settingsRoute;

    if (/^(close|done|finish|结束|关闭|完成)$/.test(text) || /close|dismiss|关闭/.test(aria)) return "$close";
    if (/log out|logout|退出登录/.test(text)) return "$logout";
    if (/^light$|浅色/.test(text)) return "$theme-light";
    if (/^dark$|深色|黑暗/.test(text)) return "$theme-dark";
    if (/collapse sidebar|close sidebar|收起侧边栏|关闭侧边栏/.test(aria)) return "sidebar-collapsed";
    if (/expand sidebar|open sidebar|展开侧边栏|打开侧边栏/.test(aria)) return "$sidebar-open";
    if (/^(home|首页)$/.test(text) || /^(home|首页)$/.test(aria)) return "$home";
    if (/^(search|搜索)$/.test(aria) || /sidebar-search/.test(testId)) return "chat-search";
    if (/^(chats|聊天|聊天和任务|chats and tasks)$/.test(text)) return "chats";
    if (/^(projects|项目)$/.test(text)) return "projects";
    if (/^(artifacts|文物)$/.test(text)) return "artifacts";
    if (/^(code|代码)( upgrade| 升级)?$/.test(text)) return "code-first";
    if (/^(scheduled|计划任务)$/.test(text)) return "scheduled";
    if (/^(customize|自定义)$/.test(text)) return "settings-1";
    if (/^(design|设计)$/.test(text)) return "design-home";
    if (/new chat|new conversation|新聊天|新对话/.test(text)) return "$home";
    if (/quick task|快速任务/.test(aria)) return "home-toast";
    if (/^view all$|^查看全部$/.test(text + " " + aria)) return "chats";
    if (/get apps and extensions|获取应用和扩展/.test(aria)) return "settings-skills-mcp";
    if (/use incognito|隐私对话/.test(aria)) return "privacy-chat";
    if (/^share$|^分享$/.test(text) || /^share$|^分享$/.test(aria)) return "share";
    if (/more options for|对话选项/.test(aria)) return "chat-more";
    if (/model-selector-dropdown/.test(testId) || /^model:/.test(aria)) return "model-menu";
    if (/add files, connectors, and more/.test(aria)) {
      return document.documentElement.classList.contains("port-chatting") ? "chat-plus" : "plus-menu";
    }
    if (/^settings$|^设置$/.test(aria)) return "file-effort";
    if (/settings|设置|账号设置/.test(aria) || testId === "user-menu-button") return "settings-card";
    if (/press and hold to record|use voice mode|语音/.test(aria)) return "voice";
    if (/^(write|learn|life stuff|claude.s choice|写|学习|生活琐事|克洛德的选择)$/.test(text)) {
      return "prompt-category-state";
    }
    if (/^cowork$/.test(text)) return "cowork-safety";

    if (componentId === "settings-card" && /language|语言/.test(text)) return "language";
    if (componentId === "settings-card" && /get apps|应用|扩展/.test(text)) return "settings-skills-mcp";
    if (componentId === "settings-card" && /upgrade plan|升级计划/.test(text)) return "settings-4";
    if (componentId === "settings-card") return "settings-1";
    if (componentId === "settings-4" && /usage|用量|查看/.test(text)) return "usage";
    if (componentId === "settings-password" && /chat|对话|try|开始/.test(text)) return "claude-password-chat";
    if (componentId === "settings-skills" && /browse|分页|更多|下一页|next/.test(text + " " + aria)) return "skills-page-3";
    if ((componentId === "settings-skills" || componentId === "skills-page-3") && /mcp|connector|连接器/.test(text)) {
      return "settings-skills-mcp";
    }
    if (componentId === "memory-settings" && /manage|view|交流|查看|管理|chat/.test(text)) return "memory-chat";
    if (componentId === "reflection-home" && /start|try|开始|试试|反思/.test(text)) return "reflection-loading";
    if (componentId === "privacy-chat" && /continue|开始|进入|继续/.test(text)) return "privacy-chat-entered";
    if (componentId === "projects" && /new project|创建项目|新项目/.test(text + " " + aria)) return "project-components";
    if ((componentId === "projects" || componentId === "project-components") && /project|项目/.test(text)) return "project-deep";
    if (componentId === "project-deep" && /chat|对话|open|打开/.test(text)) return "project-chat";
    if (componentId === "artifacts" && /artifact|文物|open|打开|view/.test(text)) return "chat-rich-content";
    if (componentId === "code-first" && /continue|try|start|开始|继续|code/.test(text)) return "code";
    if (componentId === "code" && /schedule|scheduled|计划|任务/.test(text)) return "scheduled";
    if (componentId === "design-home" && /start|create|try|开始|创建|设计/.test(text)) return "design";
    if (componentId === "design" && /parameter|参数|settings|设置/.test(text)) return "design-params";
    if ((componentId === "design" || componentId === "design-params") && /chat|对话|continue|继续/.test(text)) return "design-chat";
    if ((componentId === "plus-menu" || componentId === "chat-plus") && /upload|file|image|上传|文件|图片/.test(text)) return "$file";
    if ((componentId === "plus-menu" || componentId === "chat-plus") && /connector|mcp|连接器/.test(text)) return "mcp-chat-card";
    if ((componentId === "plus-menu" || componentId === "chat-plus") && /project|项目/.test(text)) return "project-components";
    if (componentId === "file-effort" && /effort|model|思考|模型/.test(text + " " + aria)) return "model-menu";
    if (componentId === "prompt-category-state") return "ai-prompt-block";
    if (componentId === "chat-rich-content" && /search|搜索|web/.test(text + " " + aria)) return "web-search-chat";
    if (componentId === "web-search-chat" && /mcp|connector|连接器/.test(text)) return "mcp-chat-card";
    if (componentId === "mcp-chat-card" && /side|panel|副栏|details|详情/.test(text)) return "chat-sidecar";
    if (componentId === "language" && /voice|语音|style|风格/.test(text)) return "voice";
    if (componentId === "model-menu" && /new|promo|推广|新模型/.test(text)) return "model-promo";
    if (componentId === "chat-more" && /share|分享/.test(text)) return "share";
    if (componentId === "chat-more" && /incognito|private|隐私/.test(text)) return "privacy-chat";
    if (componentId === "home-toast" || componentId === "model-promo") return "$close";
    return "";
  }

  function bridgePortModelSelection(text) {
    var wanted = normalizePortText(text)
      .replace(/第五十四行诗|十四行诗/g, "sonnet")
      .replace(/俳句/g, "haiku")
      .replace(/作品/g, "opus")
      .replace(/寓言/g, "fable")
      .replace(/\b(medium|extended|thinking|fast|recommended|new)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!/(sonnet|opus|haiku|fable|claude|gpt|gemini|deepseek|qwen|glm|mistral)/.test(wanted)) return false;
    var wantedSignature = wanted.match(/(sonnet|opus|haiku|fable)\s*(\d+(?:\.\d+)?)/);
    var options = document.querySelectorAll("#modelDropdownContent .model-option");
    for (var i = 0; i < options.length; i += 1) {
      var optionText = normalizePortText(options[i].textContent + " " + (options[i].title || ""));
      var optionSignature = optionText.match(/(sonnet|opus|haiku|fable)\s*(\d+(?:\.\d+)?)/);
      var sameSignature =
        wantedSignature && optionSignature &&
        wantedSignature[1] === optionSignature[1] &&
        wantedSignature[2] === optionSignature[2];
      if (sameSignature || optionText.includes(wanted) || wanted.includes(optionText)) {
        options[i].click();
        if (options[i].classList.contains("active")) closePortOwner("transient", false);
        return true;
      }
    }
    return false;
  }

  function bridgePortArchiveSelection(text) {
    var wanted = normalizePortText(text);
    if (!wanted) return false;
    var rows = document.querySelectorAll("#chatHistoryList a,#chatHistoryList button,#chatHistoryList li");
    for (var i = 0; i < rows.length; i += 1) {
      var rowText = normalizePortText(rows[i].textContent);
      if (rowText && (rowText === wanted || rowText.includes(wanted) || wanted.includes(rowText))) {
        closeAllPortComponents(false);
        rows[i].click();
        return true;
      }
    }
    return false;
  }

  function applyPortAppearance(targetMode) {
    var row = document.getElementById("appearanceRow");
    if (!row) return;
    for (var i = 0; i < 4 && document.documentElement.getAttribute("data-mode") !== targetMode; i += 1) row.click();
  }

  async function runPortRoute(route, target, sourceText, owner) {
    if (!route) return false;
    if (route === "$close") {
      closePortOwner(owner, true);
      return true;
    }
    if (route === "$home") {
      closeAllPortComponents(false);
      var home = document.getElementById("newChatBtn") || document.getElementById("brandHomeBtn");
      if (home) home.click();
      return true;
    }
    if (route === "$sidebar-open") {
      closePortOwner("sidebar", true);
      return true;
    }
    if (route === "$logout") {
      closeAllPortComponents(false);
      document.getElementById("settingsLogoutRow")?.click();
      return true;
    }
    if (route === "$theme-light" || route === "$theme-dark") {
      applyPortAppearance(route === "$theme-light" ? "light" : "dark");
      closePortOwner(owner, true);
      if (route === "$theme-light" && !isChatting()) await openPortComponent("light-home", target);
      return true;
    }
    if (route === "$file") {
      closePortOwner("transient", false);
      closePortOwner("composer", false);
      document.getElementById("fileInput")?.click();
      return true;
    }
    if (route === "$chat") {
      if (!bridgePortArchiveSelection(sourceText)) closePortOwner(owner, true);
      return true;
    }
    return openPortComponent(route, target);
  }

  function reportPortComponentError(error, componentId) {
    console.error("[claude-port] component mount failed", componentId, error);
  }

  function readPortEditorValue(editor) {
    if ("value" in editor) return String(editor.value || "");
    return String(editor.innerText || editor.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/\n$/, "");
  }

  function syncPortEditor(editor) {
    var liveInput = document.getElementById("homeInput");
    if (!liveInput) return null;
    liveInput.value = readPortEditorValue(editor);
    liveInput.dispatchEvent(new Event("input", { bubbles: true }));
    return liveInput;
  }

  function submitPortEditor(editor) {
    var liveInput = syncPortEditor(editor);
    if (!liveInput) return;
    var send = document.getElementById("sendChatBtn");
    if (send && !send.disabled) send.click();
    else {
      liveInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    closeAllPortComponents(false);
  }

  function forwardPortFiles(files) {
    var liveFile = document.getElementById("fileInput");
    if (!liveFile || !files?.length) return;
    var transfer = new DataTransfer();
    Array.from(files).forEach(function (file) {
      transfer.items.add(file);
    });
    liveFile.files = transfer.files;
    liveFile.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function bindPortShadowComposer(shadow) {
    var editor = shadow.querySelector('[data-testid="chat-input"]');
    if (!editor) return;
    var voiceButton = shadow.querySelector('[aria-label="Use voice mode"],[aria-label="使用语音模式"]');
    var voiceTemplate = voiceButton ? voiceButton.cloneNode(true) : null;

    function bindSend(button) {
      if (!button || button.dataset.portSendBound === "1") return;
      button.dataset.portSendBound = "1";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        submitPortEditor(editor);
      });
    }

    function updateAction() {
      syncPortEditor(editor);
      var hasText = readPortEditorValue(editor).trim().length > 0;
      var capturedSend = shadow.querySelector(
        '[aria-label="Send message"],[aria-label="发送消息"],[data-port-send-button="true"]',
      );
      if (capturedSend) bindSend(capturedSend);
      if (hasText && !capturedSend && voiceButton?.isConnected) {
        var liveSend = document.getElementById("sendChatBtn");
        if (!liveSend) return;
        var exactSend = liveSend.cloneNode(true);
        exactSend.removeAttribute("id");
        exactSend.removeAttribute("disabled");
        exactSend.removeAttribute("data-trigger-disabled");
        exactSend.disabled = false;
        exactSend.dataset.portSendButton = "true";
        bindSend(exactSend);
        voiceButton.replaceWith(exactSend);
      } else if (!hasText && capturedSend?.dataset.portSendButton === "true" && voiceTemplate) {
        voiceButton = voiceTemplate.cloneNode(true);
        capturedSend.replaceWith(voiceButton);
      }
    }

    editor.addEventListener("input", updateAction);
    editor.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      submitPortEditor(editor);
    });
    shadow
      .querySelectorAll('[aria-label="Send message"],[aria-label="发送消息"]')
      .forEach(bindSend);
    shadow.querySelectorAll('input[type="file"]').forEach(function (input) {
      input.addEventListener("change", function () {
        forwardPortFiles(input.files);
      });
    });
    updateAction();
  }

  function bindPortComponentEvents(host, component, owner) {
    var shadow = host.shadowRoot;
    bindPortShadowComposer(shadow);
    shadow.addEventListener("submit", function (event) {
      event.preventDefault();
    });
    shadow.addEventListener("drop", function (event) {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      forwardPortFiles(event.dataTransfer.files);
      closePortOwner("composer", false);
    });
    shadow.addEventListener(
      "click",
      function (event) {
        var target = event.target?.closest?.(
          "a,button,[role='button'],[role='radio'],[role='tab']," +
            "[role='menuitem'],[role='menuitemradio'],[role='option'],label",
        );
        if (!target) return;
        var text = normalizePortText(target.textContent);
        var aria = normalizePortText(target.getAttribute("aria-label"));
        var testId = normalizePortText(target.getAttribute("data-testid"));
        if (component.id === "model-menu" && bridgePortModelSelection(text)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        var route = routePortControl(
          component.id,
          text,
          aria,
          testId,
          target.matches("a") ? target.getAttribute("href") : "",
        );
        if (!route && owner === "composer" && target.querySelector("img")) route = "image-open";
        if (!route) {
          if (target.matches("a")) event.preventDefault();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        runPortRoute(route, target, text, owner).catch(function (error) {
          reportPortComponentError(error, route);
        });
      },
      true,
    );
    shadow.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePortOwner(owner, true);
    });
  }

  function bindPortComponentShellRoutes() {
    if (document.documentElement.dataset.portComponentRoutes === "1") return;
    document.documentElement.dataset.portComponentRoutes = "1";
    document.addEventListener(
      "click",
      function (event) {
        if (event.target.closest("#authOverlay,[data-port-owner]")) return;
        var attachment = event.target.closest(".attachment-item");
        if (attachment && !event.target.closest(".attachment-remove") && attachment.querySelector("img")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          openPortComponent("image-open", attachment).catch(function (error) {
            reportPortComponentError(error, "image-open");
          });
          return;
        }
        var target = event.target.closest(
          "a,button,[role='button'],[role='radio'],[role='tab']",
        );
        if (!target) return;
        var text = normalizePortText(target.textContent);
        var aria = normalizePortText(target.getAttribute("aria-label"));
        var testId = normalizePortText(target.getAttribute("data-testid"));
        var route = routePortControl(
          "shell",
          text,
          aria,
          testId,
          target.matches("a") ? target.getAttribute("href") : "",
        );
        if (!route) return;
        if (route === "$home" && /^(newChatBtn|brandHomeBtn)$/.test(target.id)) {
          closeAllPortComponents(false);
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        runPortRoute(route, target, text, "transient").catch(function (error) {
          reportPortComponentError(error, route);
        });
      },
      true,
    );
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      var owner = ["transient", "composer", "prompt", "message", "page", "sidebar"].find(function (name) {
        return portMountState.has(name);
      });
      if (!owner) return;
      event.preventDefault();
      closePortOwner(owner, true);
    });
    document.addEventListener("dragenter", function (event) {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      if (portMountState.has("composer")) return;
      openPortComponent("drag-upload", document.getElementById("homeInput")).catch(function (error) {
        reportPortComponentError(error, "drag-upload");
      });
    });
    window.addEventListener("resize", function () {
      ["page", "sidebar", "composer"].forEach(function (owner) {
        if (portMountState.has(owner)) positionPortHost(ensurePortHost(owner), owner);
      });
    });
    var fileInput = document.getElementById("fileInput");
    fileInput?.addEventListener("change", function () {
      if (!fileInput.files?.length) return;
      var componentId = isChatting() ? "file-effort" : "dark-home-upload";
      openPortComponent(componentId, fileInput).catch(function (error) {
        reportPortComponentError(error, componentId);
      });
    });
  }
  function isChatting() {
    var hv = document.getElementById("homeView");
    return !!(hv && hv.classList.contains("chatting"));
  }

  function syncPortLayout() {
    var chatting = isChatting();
    document.documentElement.classList.toggle("port-chatting", chatting);

    var input = document.getElementById("homeInput");
    var homeHost = document.getElementById("portHomeEditorHost");
    var chatHost = document.getElementById("portChatEditorHost");
    var host = chatting ? chatHost : homeHost;
    if (input && host && input.parentElement !== host) {
      host.appendChild(input);
    }
  }

  function bindHomeProxies() {
    var homePane = document.getElementById("portHomePane");
    if (!homePane || homePane.dataset.proxiesBound === "1") return;
    homePane.dataset.proxiesBound = "1";

    var modelBtn = homePane.querySelector('[data-testid="model-selector-dropdown"]');
    if (modelBtn) {
      modelBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var target = document.getElementById("modelCurrentBtn");
        if (target) target.click();
      });
    }

    var plusBtn = homePane.querySelector(
      '[aria-label="Add files, connectors, and more"]',
    );
    if (plusBtn) {
      plusBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var target = document.getElementById("plusTrigger");
        if (target) target.click();
      });
    }
  }

  function boot() {
    bindHomeProxies();
    bindPortComponentShellRoutes();
    syncPortLayout();
    var hv = document.getElementById("homeView");
    if (hv) {
      new MutationObserver(syncPortLayout).observe(hv, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
