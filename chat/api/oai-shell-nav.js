/**
 * Shared open-platform shell (header + mobile drawer + sidebar).
 * One wheel for api_models.html + api_docs_detail.html.
 *
 * Body attrs:
 *   data-oai-page="models" | "docs" | "overview" | ...
 * Mounts (required):
 *   #oai-mount-header  — replaced with <header id="header">…
 *   #oai-mount-drawer  — replaced with #drawer
 *   #oai-mount-sidebar — filled with platform nav + API docs disclosure
 * Optional:
 *   #oai-mount-search  — replaced with #header-search-overlay (if present)
 */
(function () {
  // MUST resolve inside mount() — this file loads in <head>, body is null here.
  var PAGE = "";
  var IS_DOCS = false;
  var IS_MODELS = false;
  /** Prefix for pages under chat/api/ (e.g. model_detail): "../" → rewrite ./foo to ../foo */
  var ROOT = "";

  var DISCLOSURE_KEY = "cancri_oai_nav_disclosure";

  function resolvePage() {
    PAGE = (document.body && document.body.getAttribute("data-oai-page")) || "";
    IS_DOCS = PAGE === "docs";
    IS_MODELS = PAGE === "models";
    ROOT = (document.body && document.body.getAttribute("data-oai-root")) || "";
  }

  /** Rewrite ./relative paths when the page lives under chat/api/. */
  function u(path) {
    if (!ROOT) return path;
    if (path.charAt(0) === "#") return path;
    if (path.indexOf("./") === 0) return ROOT + path.slice(2);
    return ROOT + path;
  }

  function withRoot(html) {
    if (!ROOT) return html;
    return html.replace(/(href|src)="(\.\/[^"]*)"/g, function (_, attr, path) {
      return attr + '="' + u(path) + '"';
    });
  }

  function readDisclosureMap() {
    try {
      var raw = localStorage.getItem(DISCLOSURE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeDisclosureMap(map) {
    try {
      localStorage.setItem(DISCLOSURE_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  /** Page rules win for API docs; other sections keep user preference. */
  function disclosureShouldOpen(id, fallback) {
    if (id === "nav-api-docs") {
      if (IS_DOCS) return true;
      if (IS_MODELS) return false;
    }
    var saved = readDisclosureMap()[id];
    if (typeof saved === "boolean") return saved;
    return !!fallback;
  }

  var CHEVRON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="nav-disclosure-chevron w-3 h-3 inline-block ml-1 text-secondary transition-transform duration-150" aria-hidden="true"><path d="M8.29289 4.29289C8.68342 3.90237 9.31658 3.90237 9.70711 4.29289L16.7071 11.2929C17.0976 11.6834 17.0976 12.3166 16.7071 12.7071L9.70711 19.7071C9.31658 20.0976 8.68342 20.0976 8.29289 19.7071C7.90237 19.3166 7.90237 18.6834 8.29289 18.2929L14.5858 12L8.29289 5.70711C7.90237 5.31658 7.90237 4.68342 8.29289 4.29289Z" fill="currentColor"></path></svg>';

  var DROP_CHEVRON =
    '<svg viewBox="0 0 24 24" fill="none" class="h-3.5 w-3.5 text-tertiary"><path d="M11.2929 16.2929C11.6834 16.6834 12.3166 16.6834 12.7071 16.2929L18.7071 10.2929C19.0976 9.90237 19.0976 9.26921 18.7071 8.87868C18.3166 8.48816 17.6834 8.48816 17.2929 8.87868L12 14.1716L6.70711 8.87868C6.31658 8.48816 5.68342 8.48816 5.29289 8.87868C4.90237 9.26921 4.90237 9.90237 5.29289 10.2929L11.2929 16.2929Z" fill="currentColor"></path></svg>';

  var EXT_ICON =
    '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-2 h-2 inline-block shrink-0 text-current"><path d="M10.2426 0.757385C10.7949 0.757385 11.2426 1.2051 11.2426 1.75739V8.82843C11.2426 9.38071 10.7949 9.82843 10.2426 9.82843C9.69036 9.82843 9.24264 9.38071 9.24264 8.82843V4.17157L2.46447 10.9497C2.07394 11.3403 1.44078 11.3403 1.05025 10.9497C0.659728 10.5592 0.659728 9.92606 1.05025 9.53553L7.82843 2.75736H3.17157C2.61929 2.75736 2.17157 2.30964 2.17157 1.75736C2.17157 1.20507 2.61929 0.757385 3.17157 0.757385H10.2426Z" fill="currentColor"></path></svg>';

  function topCls(active) {
    return active
      ? "flex items-center gap-1 text-sm px-2.5 py-1 rounded-md text-default bg-primary-soft"
      : "flex items-center gap-1 text-sm px-2.5 py-1 rounded-md text-primary-soft hover:text-default hover:bg-primary-soft-alpha";
  }

  function sideCls(active) {
    return active
      ? "px-3 py-1.5 w-full rounded-[8px] transition-colors text-default bg-primary-soft block"
      : "px-3 py-1.5 w-full rounded-[8px] transition-colors text-default block hover:text-default hover:bg-primary-ghost-hover";
  }

  function menuItem(href, title, desc) {
    return (
      '<a role="menuitem" href="' +
      href +
      '" class="block px-4 py-3 text-sm text-default transition-colors hover:bg-primary-soft-alpha hover:text-default"><div class="flex flex-col gap-1"><div class="font-medium">' +
      title +
      '</div><div class="text-sm text-secondary">' +
      desc +
      "</div></div></a>"
    );
  }

  function dropdown(label, href, active, itemsHtml) {
    return (
      '<div class="relative group">' +
      '<a href="' +
      href +
      '" class="' +
      topCls(active) +
      '" aria-haspopup="menu"' +
      (active ? ' aria-current="page"' : "") +
      ">" +
      label +
      DROP_CHEVRON +
      "</a>" +
      '<div class="invisible opacity-0 absolute left-0 top-full z-50 mt-2 min-w-full w-max transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 before:content-[\'\'] before:absolute before:-top-2 before:left-0 before:right-0 before:h-2" role="menu">' +
      '<div class="overflow-hidden rounded-md border border-primary-surface bg-surface shadow-md ring-1 ring-black/5 dark:ring-white/10">' +
      itemsHtml +
      "</div></div></div>"
    );
  }

  function buildHeader() {
    return (
      '<header id="header" class="fixed top-0 w-full h-16 z-50 bg-white dark:bg-black border-b border-primary-surface">' +
      '<div class="flex items-center h-full px-4 md:px-8 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-6">' +
      '<a href="./api/index.html" class="flex items-center gap-2 font-semibold ml-0 md:-ml-1 md:justify-self-start">' +
      '<img class="h-6 w-auto" src="./assets/oai.logo/nexusvai_developers_wordmark.svg" alt="NexusVAI Developers" height="24" />' +
      "</a>" +
      '<nav class="hidden md:flex items-center justify-center gap-1">' +
      '<div class="relative group"><a href="./api/index.html" class="' +
      topCls(PAGE === "overview") +
      '"' +
      (PAGE === "overview" ? ' aria-current="page"' : "") +
      ">概览</a></div>" +
      '<div class="relative group"><a href="./api_models.html" class="' +
      topCls(IS_MODELS) +
      '"' +
      (IS_MODELS ? ' aria-current="page"' : "") +
      ">模型</a></div>" +
      dropdown(
        "文档",
        "./api_docs.html",
        IS_DOCS,
        menuItem("./api_docs.html", "文档中心", "接入指南与示例") +
          menuItem("./api_docs.html#quickstart", "快速开始", "5 分钟完成首次调用"),
      ) +
      dropdown(
        "控制台",
        "./api/console.html",
        PAGE === "console",
        menuItem("./api/keys.html", "API 密钥", "生成与管理密钥") +
          menuItem("./api/billing.html", "充值", "按量充值，永不过期") +
          menuItem("./api/billing.html#bills", "我的订单", "充值与订单记录"),
      ) +
      dropdown(
        "资源",
        "./api_apply.html",
        PAGE === "resources",
        menuItem("./api_apply.html", "联系我们", "提交工单 / 反馈") +
          menuItem("./", "返回聊天", "回到 NexusV 对话"),
      ) +
      "</nav>" +
      '<div class="ml-auto flex items-center gap-4 md:gap-5 md:ml-0 md:justify-end md:justify-self-end">' +
      '<button type="button" data-header-search-button aria-controls="header-search-overlay" aria-expanded="false" class="hidden min-w-52 items-center justify-between gap-3 rounded-full border border-primary-surface bg-surface px-4 py-2 text-sm text-secondary transition-colors hover:bg-primary-soft-alpha hover:text-default xl:flex">' +
      '<span class="truncate">开始搜索</span>' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
      "</button>" +
      '<div class="hidden md:flex">' +
      '<a href="./api/console.html" class="_Button_6dmow_1 not-prose !h-9 !w-9 justify-center !px-0 min-[1000px]:!w-auto min-[1000px]:!px-4" data-color="primary" data-variant="solid" data-pill data-size="md">' +
      '<span class="_ButtonInner_6dmow_4"><span class="sr-only min-[1000px]:not-sr-only">控制台</span>' +
      '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" class="shrink-0"><path fill-rule="evenodd" d="M16.243 6.757a1 1 0 0 1 1 1v7.072a1 1 0 0 1-2 0v-4.657L8.464 16.95a1 1 0 0 1-1.414-1.414l6.778-6.779H9.172a1 1 0 0 1 0-2h7.07Z" clip-rule="evenodd"></path></svg>' +
      "</span></a></div>" +
      '<button id="header-theme-button" aria-label="切换深色 / 浅色主题" class="hidden md:flex text-secondary hover:text-default transition-colors">' +
      '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" class="block dark:hidden w-4 h-4"><path fill-rule="evenodd" clip-rule="evenodd" d="M11 0C11.5523 0 12 0.447715 12 1V3C12 3.55228 11.5523 4 11 4C10.4477 4 10 3.55228 10 3V1C10 0.447715 10.4477 0 11 0ZM3.22183 3.22183C3.61235 2.8313 4.24551 2.8313 4.63604 3.22183L6.05025 4.63604C6.44078 5.02656 6.44078 5.65973 6.05025 6.05025C5.65973 6.44078 5.02656 6.44078 4.63604 6.05025L3.22183 4.63604C2.8313 4.24551 2.8313 3.61235 3.22183 3.22183ZM18.7782 3.22183C19.1687 3.61235 19.1687 4.24551 18.7782 4.63604L17.364 6.05025C16.9734 6.44078 16.3403 6.44078 15.9497 6.05025C15.5592 5.65973 15.5592 5.02656 15.9497 4.63604L17.364 3.22183C17.7545 2.8313 18.3876 2.8313 18.7782 3.22183ZM11 8C9.34315 8 8 9.34315 8 11C8 12.6569 9.34315 14 11 14C12.6569 14 14 12.6569 14 11C14 9.34315 12.6569 8 11 8ZM6 11C6 8.23858 8.23858 6 11 6C13.7614 6 16 8.23858 16 11C16 13.7614 13.7614 16 11 16C8.23858 16 6 13.7614 6 11ZM0 11C0 10.4477 0.447715 10 1 10H3C3.55228 10 4 10.4477 4 11C4 11.5523 3.55228 12 3 12H1C0.447715 12 0 11.5523 0 11ZM18 11C18 10.4477 18.4477 10 19 10H21C21.5523 10 22 10.4477 22 11C22 11.5523 21.5523 12 21 12H19C18.4477 12 18 11.5523 18 11ZM6.05025 15.9497C6.44078 16.3403 6.44078 16.9734 6.05025 17.364L4.63604 18.7782C4.24551 19.1687 3.61235 19.1687 3.22183 18.7782C2.8313 18.3876 2.8313 17.7545 3.22183 17.364L4.63604 15.9497C5.02656 15.5592 5.65973 15.5592 6.05025 15.9497ZM15.9497 15.9497C16.3403 15.5592 16.9734 15.5592 17.364 15.9497L18.7782 17.364C19.1687 17.7545 19.1687 18.3876 18.7782 18.7782C18.3877 19.1687 17.7545 19.1687 17.364 18.7782L15.9497 17.364C15.5592 16.9734 15.5592 16.3403 15.9497 15.9497ZM11 18C11.5523 18 12 18.4477 12 19V21C12 21.5523 11.5523 22 11 22C10.4477 22 10 21.5523 10 21V19C10 18.4477 10.4477 18 11 18Z" fill="currentColor"></path></svg>' +
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="hidden dark:block w-4 h-4"><path d="M10.7836 0.470481C10.9676 0.765118 10.9855 1.13415 10.8309 1.44525C10.2994 2.51497 10 3.7211 10 5.00001C10 9.41829 13.5817 13 18 13L18.0575 12.9998C18.4049 12.9974 18.7287 13.1754 18.9127 13.47C19.0968 13.7647 19.1147 14.1337 18.9601 14.4448C17.325 17.7352 13.9279 20 10 20C4.47715 20 0 15.5229 0 10C0 4.50107 4.43841 0.038857 9.92838 0.000268937C10.2758 -0.00217271 10.5995 0.175844 10.7836 0.470481ZM8.40989 2.15803C4.75344 2.8954 2 6.12619 2 10C2 14.4183 5.58172 18 10 18C12.587 18 14.8886 16.7721 16.3516 14.8648C11.6131 14.0789 8 9.96139 8 5.00001C8 4.01361 8.1431 3.05953 8.40989 2.15803Z" fill="currentColor"></path></svg>' +
      "</button>" +
      '<button type="button" data-header-search-button aria-label="搜索" aria-controls="header-search-overlay" aria-expanded="false" class="text-secondary hover:text-default transition-colors md:inline-flex xl:hidden">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
      "</button>" +
      '<button id="header-drawer-button" type="button" aria-label="菜单" aria-controls="drawer" aria-expanded="false" class="md:hidden relative right-1 text-secondary hover:text-default transition-colors">' +
      '<svg width="18" height="10" viewBox="0 0 18 10" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4"><path d="M0 1C0 0.447715 0.447715 0 1 0H17C17.5523 0 18 0.447715 18 1C18 1.55228 17.5523 2 17 2H1C0.447715 2 0 1.55228 0 1ZM0 9C0 8.44772 0.447715 8 1 8H11C11.5523 8 12 8.44772 12 9C12 9.55229 11.5523 10 11 10H1C0.447715 10 0 9.55229 0 9Z" fill="currentColor"></path></svg>' +
      "</button>" +
      "</div></div></header>"
    );
  }

  function buildSearch() {
    return (
      '<div id="header-search-overlay" role="dialog" aria-modal="true" aria-hidden="true" data-open="false" class="fixed inset-0 z-[60] hidden items-start justify-center px-4 pt-20 pb-10 md:px-6 md:pt-24">' +
      '<div class="absolute inset-0 cancri-overlay-backdrop backdrop-blur-xs" data-header-search-dismiss></div>' +
      '<div class="relative z-10 w-full max-w-4xl overflow-hidden rounded-[28px] bg-surface border border-primary-surface">' +
      '<div class="flex items-center gap-3 px-5 py-4 border-b border-primary-surface">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 shrink-0 text-secondary"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
      '<input id="cancri-search-input" type="text" placeholder="搜索模型、文档、控制台…" autocomplete="off" class="flex-1 bg-transparent outline-none text-base text-default placeholder:text-secondary" />' +
      '<button type="button" data-header-search-dismiss class="text-secondary hover:text-default text-xs border border-primary-surface rounded-md px-2 py-1">Esc</button>' +
      "</div>" +
      '<div id="cancri-search-results" class="max-h-[60vh] overflow-y-auto p-2"></div>' +
      "</div></div>"
    );
  }

  /** Docs TOC — single source; hash targets work with api-docs-pager. */
  function docsTocHtml() {
    var base = "./api_docs_detail.html";
    function item(hash, label) {
      return (
        '<li><a href="' +
        base +
        "#" +
        hash +
        '" class="px-3 py-1.5 w-full rounded-[8px] transition-colors text-default pl-5 block hover:text-default hover:bg-primary-ghost-hover"><span class="line-clamp-2">' +
        label +
        "</span></a></li>"
      );
    }
    function group(title, items) {
      return (
        '<div><h3 class="mb-2 ml-3 mt-4 text-sm font-semibold select-none">' +
        title +
        '</h3><ul class="flex flex-col gap-0.25 text-sm text-default w-full">' +
        items +
        "</ul></div>"
      );
    }
    return (
      group(
        "开始使用",
        item("intro", "概述") +
          item("quickstart", "快速开始") +
          item("migration", "迁移支持") +
          item("auth", "认证") +
          item("models", "列出模型") +
          item("sdk", "SDK"),
      ) +
      group(
        "核心概念",
        item("common-misunderstandings", "易混淆点") +
          item("chat", "Chat Completions") +
          item("messages", "Messages（Anthropic 协议）") +
          item("responses", "Responses（OpenAI 新协议）"),
      ) +
      group(
        "CLI 接入",
        item("cli-codex", "Codex CLI") +
          item("cli-claude", "Claude Code") +
          item("cli-opencode", "OpenCode") +
          item("cli-openclaw", "OpenClaw") +
          item("cli-aider", "Aider"),
      ) +
      group(
        "客户端接入",
        item("client-cherry", "Cherry Studio") +
          item("client-sillytavern", "SillyTavern") +
          item("client-ccswitch", "CC Switch") +
          item("client-chatbox", "Chatbox") +
          item("client-lobechat", "LobeChat") +
          item("client-cursor", "Cursor") +
          item("client-cline", "Cline") +
          item("client-continue", "Continue") +
          item("client-faq", "常见问题"),
      ) +
      group(
        "配额与限制",
        item("quota", "计费与余额") + item("ratelimit", "速率限制"),
      ) +
      group("参考", item("errors", "错误码") + item("faq", "FAQ"))
    );
  }

  function disclosure(id, title, open, innerHtml) {
    return (
      '<details class="nav-disclosure"' +
      (id ? ' id="' + id + '"' : "") +
      (open ? " open" : "") +
      ">" +
      '<summary class="list-none cursor-pointer select-none px-3 py-2 rounded-lg transition-colors flex items-center justify-between gap-2 text-default font-semibold hover:text-default hover:bg-primary-ghost-hover">' +
      '<span class="flex-1 min-w-0 line-clamp-2">' +
      title +
      "</span>" +
      CHEVRON +
      "</summary>" +
      innerHtml +
      "</details>"
    );
  }

  function buildSidebarNav(opts) {
    opts = opts || {};
    var withIds = !!opts.anchorDocs;
    return (
      '<nav class="cnc-sidebar flex-1 overflow-y-auto overflow-x-visible pt-4">' +
      '<ul class="flex flex-col gap-0.25 text-sm text-default w-full mb-2">' +
      '<li><a href="./api/index.html" class="' +
      sideCls(PAGE === "overview") +
      '"><span class="line-clamp-2">概览</span></a></li>' +
      "</ul>" +
      disclosure(
        withIds ? "nav-models" : null,
        "模型",
        disclosureShouldOpen("nav-models", IS_MODELS),
        '<ul class="mt-1 ml-3 flex flex-col gap-0.5 text-sm text-default w-full mb-2">' +
          '<li><a href="./api_models.html" class="' +
          sideCls(IS_MODELS) +
          '"' +
          (IS_MODELS ? ' aria-current="page"' : "") +
          '><span class="line-clamp-2">模型广场</span></a></li>' +
          '<li><a href="./api_docs.html#pricing" class="' +
          sideCls(false) +
          '"><span class="line-clamp-2">计费倍率</span></a></li>' +
          "</ul>",
      ) +
      disclosure(
        withIds ? "nav-api-docs" : null,
        "API 文档",
        disclosureShouldOpen("nav-api-docs", IS_DOCS),
        '<div class="mt-1 ml-1 mb-2">' + docsTocHtml() + "</div>",
      ) +
      disclosure(
        withIds ? "nav-console" : null,
        "控制台",
        disclosureShouldOpen("nav-console", false),
        '<ul class="mt-1 ml-3 flex flex-col gap-0.5 text-sm text-default w-full mb-2">' +
          '<li><a href="./api/keys.html" class="' +
          sideCls(false) +
          '"><span class="line-clamp-2">API 密钥</span></a></li>' +
          '<li><a href="./api/usage.html" class="' +
          sideCls(false) +
          '"><span class="line-clamp-2">用量</span></a></li>' +
          '<li><a href="./api/billing.html" class="' +
          sideCls(false) +
          '"><span class="line-clamp-2">充值</span></a></li>' +
          '<li><a href="./api/billing.html#bills" class="' +
          sideCls(false) +
          '"><span class="line-clamp-2">我的订单</span></a></li>' +
          "</ul>",
      ) +
      '<div><h3 class="mb-2 ml-3 mt-6 text-sm font-semibold select-none">资源</h3>' +
      '<ul class="flex flex-col gap-0.25 text-sm text-default w-full">' +
      '<li><a href="./api_apply.html" class="' +
      sideCls(false) +
      '"><span class="line-clamp-2">联系我们</span></a></li>' +
      '<li><a href="./" class="' +
      sideCls(false) +
      ' flex items-center justify-between gap-1"><span class="line-clamp-2 min-w-0 flex-1">返回聊天</span>' +
      EXT_ICON +
      "</a></li></ul></div>" +
      "</nav>"
    );
  }

  function buildDrawer() {
    return (
      '<div id="drawer" data-open="false" aria-hidden="true" class="fixed inset-0 z-[60] hidden flex-col bg-white dark:bg-black pt-16 md:hidden">' +
      '<div class="flex-1 overflow-y-auto p-4" data-mobile-nav-panels>' +
      buildSidebarNav({ anchorDocs: false }).replace(
        'class="cnc-sidebar flex-1 overflow-y-auto overflow-x-visible pt-4"',
        'class="cnc-sidebar cnc-sidebar--mobile flex-1 overflow-y-auto overflow-x-visible"',
      ) +
      "</div></div>"
    );
  }

  function replaceMount(id, html) {
    var el = document.getElementById(id);
    if (!el) return null;
    var tmp = document.createElement("div");
    tmp.innerHTML = html.trim();
    var node = tmp.firstElementChild;
    if (!node) return null;
    el.replaceWith(node);
    return node;
  }

  function fillMount(id, html) {
    var el = document.getElementById(id);
    if (!el) return null;
    el.innerHTML = html;
    return el;
  }

  function syncApiDocsDisclosure() {
    var details = document.getElementById("nav-api-docs");
    if (!details) return;
    details.open = disclosureShouldOpen("nav-api-docs", IS_DOCS);
    if (IS_DOCS && details.open) {
      requestAnimationFrame(function () {
        try {
          details.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } catch (_) {
          details.scrollIntoView(true);
        }
      });
    }
  }

  function bindDisclosurePersistence(root) {
    if (!root) return;
    root.querySelectorAll("details.nav-disclosure[id]").forEach(function (d) {
      d.addEventListener("toggle", function () {
        var map = readDisclosureMap();
        map[d.id] = !!d.open;
        writeDisclosureMap(map);
      });
    });
  }

  function mount() {
    resolvePage();
    replaceMount("oai-mount-header", withRoot(buildHeader()));
    replaceMount("oai-mount-search", withRoot(buildSearch()));
    replaceMount("oai-mount-drawer", withRoot(buildDrawer()));
    var side = fillMount(
      "oai-mount-sidebar",
      withRoot(buildSidebarNav({ anchorDocs: true })),
    );
    syncApiDocsDisclosure();
    bindDisclosurePersistence(side);
  }

  // Register before oai-platform.js so mount wins the DOMContentLoaded FIFO
  // and theme/search/drawer buttons exist when platform wires them.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
