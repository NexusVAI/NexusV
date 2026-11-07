/* /api/docs/models/detail/?model=<id> — one model in OpenAI's ModelView layout: header, stat strip, overview,
 * then titled sections (价格 / 模态 / 端点 / 特性 / 分组 / 在 API 中使用 / 可用性 / 速率限制).
 * The page stays hidden until the catalog answers; a missing or unknown id gets a not-found state.
 * Everything shown comes from model_public_catalog / model_health — no per-model facts are hard-coded. */
(function () {
  "use strict";

  var M = window.NexusModels;
  var root = document.querySelector('[data-models-page="detail"]');
  if (!M || !root) return;

  var esc = M.esc;
  var loading = root.querySelector("[data-detail-loading]");
  var state = root.querySelector("[data-detail-state]");
  var main = root.querySelector("[data-detail-main]");
  var requested = (new URLSearchParams(location.search).get("model") || "").trim();
  var SITE = " | NexusVAI Developers";

  // Icon paths copied from OpenAI's model page (tasks/2026-11-07_api-oai-redesign/oai-skel/models-page.html).
  var P = {
    textGlyph: "M8 9a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0h-1v4a1 1 0 1 1 0 2h-2a1 1 0 1 1 0-2v-4h-1a1 1 0 1 1-2 0V9Z",
    box: "M10.357 3h3.286c1.084 0 1.958 0 2.666.058.729.06 1.369.185 1.961.487a5 5 0 0 1 2.185 2.185c.302.592.428 1.233.487 1.961C21 8.4 21 9.273 21 10.357v3.286c0 1.084 0 1.958-.058 2.666-.06.729-.185 1.369-.487 1.961a5 5 0 0 1-2.185 2.185c-.592.302-1.232.428-1.961.487C15.6 21 14.727 21 13.643 21h-3.286c-1.084 0-1.958 0-2.666-.058-.728-.06-1.369-.185-1.96-.487a5 5 0 0 1-2.186-2.185c-.302-.592-.428-1.232-.487-1.961C3 15.6 3 14.727 3 13.643v-3.286c0-1.084 0-1.958.058-2.666.06-.728.185-1.369.487-1.96A5 5 0 0 1 5.73 3.544c.592-.302 1.233-.428 1.961-.487C8.4 3 9.273 3 10.357 3ZM7.854 5.051c-.605.05-.953.142-1.216.276a3 3 0 0 0-1.311 1.311c-.134.263-.226.611-.276 1.216C5.001 8.471 5 9.264 5 10.4v3.2c0 1.137 0 1.929.051 2.546.05.605.142.953.276 1.216a3 3 0 0 0 1.311 1.311c.263.134.611.226 1.216.276.617.05 1.41.051 2.546.051h3.2c1.137 0 1.929 0 2.546-.051.605-.05.953-.142 1.216-.276a3 3 0 0 0 1.311-1.311c.134-.263.226-.611.276-1.216.05-.617.051-1.41.051-2.546v-3.2c0-1.137 0-1.929-.051-2.546-.05-.605-.142-.953-.276-1.216a3 3 0 0 0-1.311-1.311c-.263-.134-.611-.226-1.216-.276C15.529 5.001 14.736 5 13.6 5h-3.2c-1.137 0-1.929 0-2.546.051Z",
    image: "M8.759 3h6.482c.805 0 1.47 0 2.01.044.563.046 1.08.145 1.565.392a4 4 0 0 1 1.748 1.748c.247.485.346 1.002.392 1.564C21 7.29 21 7.954 21 8.758v6.483c0 .805 0 1.47-.044 2.01-.046.563-.145 1.08-.392 1.565a4 4 0 0 1-1.748 1.748c-.485.247-1.002.346-1.564.392-.541.044-1.206.044-2.01.044H8.758c-.805 0-1.47 0-2.01-.044-.563-.046-1.08-.145-1.565-.392a4 4 0 0 1-1.748-1.748c-.247-.485-.346-1.002-.392-1.564C3 16.71 3 16.046 3 15.242V8.758c0-.805 0-1.47.044-2.01.046-.563.145-1.08.392-1.565a4 4 0 0 1 1.748-1.748c.485-.247 1.002-.346 1.564-.392C7.29 3 7.954 3 8.758 3ZM6.91 5.038c-.438.035-.663.1-.819.18a2 2 0 0 0-.874.874c-.08.156-.145.38-.18.819C5 7.361 5 7.943 5 8.8v4.786l.879-.879a3 3 0 0 1 4.242 0l6.286 6.286c.261-.005.484-.014.682-.03.438-.036.663-.101.819-.181a2 2 0 0 0 .874-.874c.08-.156.145-.38.18-.819.037-.45.038-1.032.038-1.889V8.8c0-.857 0-1.439-.038-1.889-.035-.438-.1-.663-.18-.819a2 2 0 0 0-.874-.874c-.156-.08-.38-.145-.819-.18C16.639 5 16.057 5 15.2 5H8.8c-.857 0-1.439 0-1.889.038ZM13.586 19l-4.879-4.879a1 1 0 0 0-1.414 0l-2.286 2.286c.005.261.014.484.03.682.036.438.101.663.181.819a2 2 0 0 0 .874.874c.156.08.38.145.819.18C7.361 19 7.943 19 8.8 19h4.786ZM14.5 8.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-3 1a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z",
    maskSlash: "M1.58594 4.06069L4.06081 1.58582L22.475 20L20.0002 22.4749L1.58594 4.06069Z",
    slash: "M18.1162 19.8839L18.4697 20.2375L18.8233 19.8839L19.8839 18.8233L20.2375 18.4697L19.8839 18.1162L2.88394 1.11617L2.53039 0.76262L2.17683 1.11617L1.11617 2.17683L0.76262 2.53039L1.11617 2.88394L18.1162 19.8839Z",
    videoBox: "M19 10c0-1.067 0-1.807-.048-2.382-.046-.563-.131-.88-.252-1.116A2.752 2.752 0 0 0 17.498 5.3c-.236-.12-.553-.206-1.116-.252C15.807 5 15.067 5 14 5h-4c-1.067 0-1.807 0-2.382.048-.563.046-.88.131-1.116.252A2.752 2.752 0 0 0 5.3 6.502c-.12.237-.206.553-.252 1.116C5 8.193 5 8.933 5 10v4c0 1.067 0 1.807.048 2.382.046.563.131.88.252 1.116.263.517.685.938 1.202 1.202.237.12.553.206 1.116.252C8.193 19 8.933 19 10 19h4c1.067 0 1.807 0 2.382-.048.563-.046.88-.131 1.116-.252a2.752 2.752 0 0 0 1.202-1.202c.12-.236.206-.553.252-1.116C19 15.807 19 15.067 19 14v-4Zm2 4c0 1.033 0 1.868-.055 2.544-.056.687-.175 1.297-.463 1.862a4.751 4.751 0 0 1-2.076 2.076c-.565.288-1.175.407-1.862.463C15.868 21 15.034 21 14 21h-4c-1.033 0-1.869 0-2.544-.055-.687-.056-1.297-.175-1.862-.463a4.751 4.751 0 0 1-2.076-2.076c-.288-.565-.407-1.175-.463-1.862C3 15.868 3 15.034 3 14v-4c0-1.033 0-1.869.055-2.544.056-.687.174-1.297.463-1.862a4.752 4.752 0 0 1 2.076-2.076c.565-.288 1.175-.407 1.862-.463C8.131 3 8.966 3 10 3h4c1.033 0 1.868 0 2.544.055.687.056 1.297.174 1.862.463a4.751 4.751 0 0 1 2.076 2.076c.288.565.407 1.175.463 1.862C21 8.131 21 8.966 21 10v4Z",
    play: "M9.5 9.332v5.336a1 1 0 0 0 1.54.841l4.152-2.668a1 1 0 0 0 0-1.682L11.04 8.49a1 1 0 0 0-1.541.842Z",
    sparkle: "M11.9972 5.90068C11.5146 7.36246 10.7637 8.64901 9.70633 9.70633C8.64901 10.7637 7.36247 11.5146 5.90068 11.9972C7.35215 12.4717 8.64505 13.2104 9.71037 14.2517C10.7594 15.277 11.5171 16.527 11.997 17.9559C12.4691 16.5364 13.2145 15.2806 14.2475 14.2475C15.2806 13.2145 16.5364 12.4691 17.9559 11.997C16.527 11.5171 15.277 10.7594 14.2517 9.71037C13.2104 8.64505 12.4717 7.35215 11.9972 5.90068ZM12.0015 1.75C12.7277 1.75074 13.3378 2.29619 13.4195 3.01779C13.9224 7.4581 16.4402 10.1766 20.9478 10.577C21.6855 10.6426 22.2508 11.261 22.25 12.0016C22.2492 12.7422 21.6825 13.3594 20.9446 13.4233C16.5007 13.8079 13.8079 16.5007 13.4233 20.9446C13.3594 21.6825 12.7422 22.2492 12.0016 22.25C11.261 22.2508 10.6426 21.6855 10.577 20.9478C10.1766 16.4402 7.4581 13.9224 3.01779 13.4195C2.29619 13.3378 1.75074 12.7277 1.75 12.0015C1.74926 11.2753 2.29346 10.664 3.01489 10.5808C7.51908 10.0613 10.0613 7.51908 10.5808 3.01489C10.664 2.29346 11.2753 1.74926 12.0015 1.75Z",
    maxOut: "M8.7587 3L10 3C10.5523 3 11 3.44772 11 4C11 4.55229 10.5523 5 10 5H8.8C7.94342 5 7.36113 5.00078 6.91104 5.03755C6.47262 5.07337 6.24842 5.1383 6.09202 5.21799C5.7157 5.40973 5.40973 5.7157 5.21799 6.09202C5.1383 6.24842 5.07337 6.47262 5.03755 6.91104C5.00078 7.36113 5 7.94342 5 8.8V15.2C5 16.0566 5.00078 16.6389 5.03755 17.089C5.07337 17.5274 5.1383 17.7516 5.21799 17.908C5.40973 18.2843 5.7157 18.5903 6.09202 18.782C6.24842 18.8617 6.47262 18.9266 6.91104 18.9624C7.36113 18.9992 7.94342 19 8.8 19H10C10.5523 19 11 19.4477 11 20C11 20.5523 10.5523 21 10 21H8.75868C7.95372 21 7.28936 21 6.74817 20.9558C6.18608 20.9099 5.66937 20.8113 5.18404 20.564C4.43139 20.1805 3.81947 19.5686 3.43597 18.816C3.18868 18.3306 3.09012 17.8139 3.04419 17.2518C2.99998 16.7106 2.99999 16.0463 3 15.2413V8.7587C2.99999 7.95373 2.99998 7.28937 3.04419 6.74817C3.09012 6.18608 3.18868 5.66937 3.43597 5.18404C3.81947 4.43139 4.43139 3.81947 5.18404 3.43597C5.66937 3.18868 6.18608 3.09012 6.74817 3.04419C7.28937 2.99998 7.95373 2.99999 8.7587 3ZM15.2929 7.29289C15.6834 6.90237 16.3166 6.90237 16.7071 7.29289L20.7071 11.2929C21.0976 11.6834 21.0976 12.3166 20.7071 12.7071L16.7071 16.7071C16.3166 17.0976 15.6834 17.0976 15.2929 16.7071C14.9024 16.3166 14.9024 15.6834 15.2929 15.2929L17.5858 13H11C10.4477 13 10 12.5523 10 12C10 11.4477 10.4477 11 11 11H17.5858L15.2929 8.70711C14.9024 8.31658 14.9024 7.68342 15.2929 7.29289Z",
    bulb: "M12.5996 4C9.14783 4 6.34961 6.79822 6.34961 10.25C6.34961 11.6198 6.78911 12.884 7.535 13.9132C7.64286 14.062 7.75714 14.2059 7.87744 14.3445C8.23946 14.7616 8.19481 15.3932 7.77772 15.7552C7.36063 16.1172 6.72904 16.0726 6.36703 15.6555C6.20849 15.4728 6.05783 15.2831 5.91559 15.0868C4.9306 13.7278 4.34961 12.0553 4.34961 10.25C4.34961 5.69365 8.04326 2 12.5996 2C17.156 2 20.8496 5.69365 20.8496 10.25C20.8496 12.0553 20.2686 13.7278 19.2836 15.0868C19.1414 15.2831 18.9907 15.4728 18.8322 15.6555C18.4702 16.0726 17.8386 16.1172 17.4215 15.7552C17.0044 15.3932 16.9598 14.7616 17.3218 14.3445C17.4421 14.2059 17.5564 14.062 17.6642 13.9132C18.4101 12.884 18.8496 11.6198 18.8496 10.25C18.8496 6.79822 16.0514 4 12.5996 4ZM8.09961 18C8.09961 17.4477 8.54732 17 9.09961 17H16.0996C16.6519 17 17.0996 17.4477 17.0996 18C17.0996 19.1196 16.8129 20.3463 16.0903 21.3206C15.3389 22.3336 14.1658 23 12.5996 23C11.0334 23 9.8603 22.3336 9.10893 21.3206C8.38629 20.3463 8.09961 19.1196 8.09961 18ZM10.2132 19C10.3149 19.4286 10.4838 19.817 10.7153 20.1291C11.0889 20.6329 11.6658 21 12.5996 21C13.5334 21 14.1103 20.6329 14.4839 20.1291C14.7154 19.817 14.8843 19.4286 14.986 19H10.2132Z",
    bubble: "M12 4.5c-4.473 0-8 3.41-8 7.5 0 1.696.6 3.263 1.62 4.525a1 1 0 0 1 .206.814 14.712 14.712 0 0 1-.37 1.501 15.17 15.17 0 0 0 1.842-.4 1 1 0 0 1 .745.08A8.371 8.371 0 0 0 12 19.5c4.473 0 8-3.41 8-7.5s-3.527-7.5-8-7.5ZM2 12c0-5.3 4.532-9.5 10-9.5S22 6.7 22 12s-4.532 9.5-10 9.5c-1.63 0-3.174-.371-4.539-1.032a17.88 17.88 0 0 1-3.4.53 1 1 0 0 1-.995-1.357c.29-.755.534-1.496.704-2.242A9.137 9.137 0 0 1 2 12Z",
    bubbleDots: "M9.25 12a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm4 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm4 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z",
    stream: "M7.401 4.035a5 5 0 0 1 9.198 0A5 5 0 0 1 21.197 12a5 5 0 0 1-4.598 7.965 5 5 0 0 1-9.198 0A5 5 0 0 1 2.803 12 5 5 0 0 1 7.4 4.035Zm1.908.638a4.997 4.997 0 0 1 2.495 4.32 3.058 3.058 0 0 0 1.152-.148A3.002 3.002 0 0 0 12 3a3 3 0 0 0-2.691 1.673Zm2.093 6.291A5.04 5.04 0 0 1 10.804 12a5.044 5.044 0 0 1 .598 1.036 5.027 5.027 0 0 1 1.196 0A5.02 5.02 0 0 1 13.196 12a5.033 5.033 0 0 1-.598-1.036 5.028 5.028 0 0 1-1.196 0Zm3.104-.636a3.059 3.059 0 0 0 .705.922 3.002 3.002 0 0 0 4.583-3.75A3.001 3.001 0 0 0 17 6.005a4.997 4.997 0 0 1-2.494 4.323Zm.195 3.006a3.053 3.053 0 0 0-.446 1.072 3.002 3.002 0 0 0 5.54 2.094 3.001 3.001 0 0 0-.104-3.167 4.997 4.997 0 0 1-4.99 0Zm-2.505 1.672A2.994 2.994 0 0 0 9 18a3.001 3.001 0 0 0 5.691 1.327 4.997 4.997 0 0 1-2.495-4.32Zm-2.702-1.334a2.996 2.996 0 0 0-4.677-.922A3.001 3.001 0 0 0 7 17.995a4.997 4.997 0 0 1 2.494-4.322ZM9.3 10.666a3.059 3.059 0 0 0 .446-1.072A3.002 3.002 0 0 0 4.205 7.5a3.001 3.001 0 0 0 .104 3.167 4.997 4.997 0 0 1 4.99 0Z",
  };
  function path(d, evenodd) {
    return "<path" + (evenodd ? ' fill-rule="evenodd" clip-rule="evenodd"' : "") + ' d="' + d + '"></path>';
  }
  var GLYPH = {
    text: path(P.textGlyph, true) + path(P.box, true),
    image: path(P.image),
    video: path(P.videoBox) + path(P.play),
    bubble: path(P.bubble) + path(P.bubbleDots),
    stream: path(P.stream, true),
    bulb: path(P.bulb, true),
  };
  function glyphSvg(glyph, viewBox) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="' + (viewBox || "0 0 24 24") + '">' + glyph + "</svg>";
  }
  var maskSeq = 0;
  // OpenAI's "not supported" glyph: the icon masked by a diagonal cut plus a slash. Mask ids must be unique.
  function crossedSvg(glyph) {
    var id = "models-mask-" + ++maskSeq;
    return (
      '<svg width="1em" height="1em" xmlns="http://www.w3.org/2000/svg"><defs><mask id="' + id + '" x="0" y="0" width="1em" height="1em">' +
      '<rect width="1em" height="1em" fill="white"></rect><path fill-rule="evenodd" clip-rule="evenodd" d="' + P.maskSlash + '" fill="black"></path></mask></defs>' +
      '<g mask="url(#' + id + ')">' + glyphSvg(glyph) + "</g>" +
      '<svg width="1em" height="1em" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="' + P.slash + '" fill="currentColor" stroke="var(--color-surface)"></path></svg></svg>'
    );
  }

  function link(href, text) {
    return '<a href="' + esc(href) + '" class="_TextLink_ssta1_1" data-underline="always">' + esc(text) + "</a>";
  }

  // ── header ───────────────────────────────────────────────────────────
  function header(m) {
    var name = m.displayName || m.id;
    var desc = M.description(m);
    var badges = (M.isFree(m) ? M.badge("免费", "success") : "") + (m.available === false ? M.badge("暂不可用", "warning") : "");
    return (
      '<div class="flex flex-col justify-between gap-4 lg:flex-row">' +
      '<div class="flex flex-col items-start gap-4 sm:flex-row sm:items-center">' +
      '<div class="flex flex-row items-center gap-2" data-model-id="' + esc(m.id) + '"><div class="cancri-thumb flex shrink-0 overflow-hidden rounded-lg w-16 h-16" style="' + M.coverStyle(m.id) + '"></div></div>' +
      '<div class="flex flex-1 flex-col"><div class="flex flex-row flex-wrap items-center gap-2">' +
      M.brandLogo(m, "link") + '<h1 class="text-2xl font-semibold whitespace-nowrap">' + esc(name) + "</h1>" +
      '<div class="flex flex-row items-center"><code class="text-xs">' + esc(m.id) + "</code>" + M.copyButton(m.id, "复制 Model ID") + "</div>" + badges + "</div>" +
      (desc ? '<div class="hidden text-secondary sm:flex">' + esc(desc) + "</div>" : "") +
      "</div></div>" +
      (desc ? '<div class="flex text-secondary sm:hidden">' + esc(desc) + "</div>" : "") +
      (m.available === false && m.unavailableMessage ? '<div class="flex text-sm text-secondary lg:hidden">' + esc(m.unavailableMessage) + "</div>" : "") +
      '<div class="flex flex-row items-center gap-2">' +
      '<a href="/api/docs/pricing/#price-' + encodeURIComponent(m.id) + '" class="_Button_6dmow_1 flex-1" data-color="primary" data-variant="outline" data-pill="" data-size="xl"><span class="_ButtonInner_6dmow_4">比较价格</span></a>' +
      '<a href="/chat/" class="_Button_6dmow_1 flex-1" data-color="primary" data-variant="solid" data-pill="" data-size="xl"><span class="_ButtonInner_6dmow_4">在对话中试用</span></a>' +
      "</div></div>"
    );
  }

  // ── stat strip ───────────────────────────────────────────────────────
  function stat(label, value, sub) {
    return (
      '<div class="flex w-full flex-1 flex-row items-center justify-between gap-2 border-0 border-t border-solid border-default py-3 lg:w-auto lg:flex-col lg:rounded-lg lg:border-none lg:px-2 lg:py-5">' +
      '<div class="text-sm font-semibold lg:text-xs lg:text-gray-400 lg:uppercase">' + esc(label) + "</div>" +
      '<div class="flex flex-row items-center gap-2 text-lg font-bold lg:text-2xl">' + value + "</div>" +
      '<div class="hidden text-sm lg:block truncate line-clamp-1">' + sub + "</div></div>"
    );
  }
  function pair(a, b, cls) {
    var part = function (t, last) {
      return '<span class="inline-flex items-center gap-2 max-w-[85px]' + (cls ? " " + cls : "") + '" title="' + esc(t) + '"><span class="truncate line-clamp-1 inline-block max-w-[85px]">' + esc(t) + "</span>" + (last ? "" : '<span class="text-secondary">•</span>') + "</span>";
    };
    return part(a, false) + part(b, true);
  }
  function modalIcon(glyph, ok) {
    return '<div class="flex items-center text-lg md:text-xl' + (ok ? "" : " text-gray-400") + '">' + (ok ? glyphSvg(glyph) : crossedSvg(glyph)) + "</div>";
  }
  var DIVIDER = '<div class="hidden h-12 w-px bg-primary-soft lg:block"></div>';
  function stats(m) {
    var p = M.priceOf(m);
    var price, sub;
    if (p.kind === "token") {
      price = '<div class="text-lg md:text-xl flex items-center gap-2">' + pair(M.yen(p.input), M.yen(p.output)) + "</div>";
      sub = '<div class="flex items-center gap-2">' + pair("输入", "输出", "truncate line-clamp-1") + "</div>";
    } else {
      price = '<div class="text-lg md:text-xl">' + esc(p.kind === "call" ? M.yen(p.call) : p.kind === "free" ? "免费" : M.priceText(m)) + "</div>";
      sub = p.kind === "call" ? "每次请求" : p.kind === "free" ? "不扣余额" : "";
    }
    var tokens = function (n) {
      return '<div class="text-lg md:text-xl">' + esc(M.compactTokens(n) || "—") + "</div>";
    };
    return (
      '<div class="flex flex-col items-center lg:flex-row lg:rounded-lg lg:border lg:border-solid lg:border-default">' +
      stat("价格", price, sub) + DIVIDER +
      stat("上下文窗口", tokens(m.maxInputTokens), "tokens") + DIVIDER +
      stat("最大输出", tokens(m.maxOutputTokens), "tokens") + DIVIDER +
      stat("输入", modalIcon(GLYPH.text, true) + modalIcon(GLYPH.image, !!m.multimodal), m.multimodal ? "文本、图像" : "文本") + DIVIDER +
      stat("输出", modalIcon(GLYPH.text, true), "文本") +
      "</div>"
    );
  }

  // ── overview: generated sentence on the left, key specs with icons on the right ──
  function overview(m) {
    var caps = [];
    if (m.enableThinking) caps.push("思考模式");
    if (m.multimodal) caps.push("图像输入");
    var spec = function (svgHtml, text) {
      return '<div class="flex flex-row items-center gap-2"><div class="flex items-center text-2xl">' + svgHtml + "</div><div>" + esc(text) + "</div></div>";
    };
    var specs = "";
    if (M.groupDigits(m.maxInputTokens)) specs += spec(glyphSvg(path(P.sparkle)), M.groupDigits(m.maxInputTokens) + " 上下文窗口");
    if (M.groupDigits(m.maxOutputTokens)) specs += spec(glyphSvg(path(P.maxOut)), M.groupDigits(m.maxOutputTokens) + " 最大输出 token");
    if (m.enableThinking) specs += spec(glyphSvg(GLYPH.bulb, "0 0 25 24"), "支持思考模式");
    if (m.multimodal) specs += spec(glyphSvg(GLYPH.image), "支持图像输入");
    return (
      '<div class="flex flex-col gap-8 md:flex-row"><div class="flex flex-2 flex-col"><div class="_MarkdownContent_13d6z_1 _Compact_13d6z_289">' +
      "<p>" + esc(m.displayName || m.id) + " 是 " + esc(M.brandLabel(m.brand || "其他")) + " 系列模型" + (caps.length ? "，支持" + caps.join("与") : "") + "。</p>" +
      "<p>在请求中把 <code>model</code> 设为 <code>" + esc(m.id) + "</code> 即可调用；价格、分组与调用示例见下方。</p>" +
      '</div></div><div class="flex flex-1 flex-col gap-3">' + specs + "</div></div>"
    );
  }

  function section(title, body, id) {
    return (
      '<div class="h-px w-full bg-primary-soft"></div>' +
      '<div class="flex flex-col gap-4 lg:flex-row' + (id ? ' models-anchor" id="' + esc(id) : "") + '"><div class="flex w-[200px] shrink-0">' + esc(title) + "</div>" +
      '<div class="flex min-w-0 flex-1 flex-col gap-4">' + body + "</div></div>"
    );
  }

  function priceBox(label, value) {
    return '<div class="flex flex-1 flex-col gap-1 rounded-lg border border-solid border-default bg-surface-secondary px-3 py-4"><div>' + esc(label) + '</div><div class="text-2xl font-semibold">' + esc(value) + "</div></div>";
  }
  function note(html) {
    return '<div class="[&_p]:!m-0 [&_p]:!leading-relaxed"><div class="_MarkdownContent_13d6z_1 _Compact_13d6z_289"><p>' + html + "</p></div></div>";
  }
  function pricing(m) {
    var p = M.priceOf(m);
    var head = function (left, right) {
      return '<div class="flex flex-col justify-between gap-2 md:flex-row"><div>' + left + '</div><div class="flex flex-row gap-2 text-sm text-secondary"><div class="flex flex-row items-center gap-1"><div>' + right + "</div></div></div></div>";
    };
    var boxes;
    var notes = [];
    if (p.kind === "token") {
      boxes = head("文本 token", "每百万 token") + '<div class="flex flex-col gap-2 md:flex-row">' + priceBox("输入", M.yenFixed(p.input)) + priceBox("缓存输入", M.yenFixed(p.cached)) + priceBox("输出", M.yenFixed(p.output)) + "</div>";
      notes.push("命中缓存的输入 token 按输入价格的 " + Math.round(p.cacheFactor * 100) / 10 + " 折计费。");
      notes.push("上游返回缓存写入用量（cache write）时，写入部分按输入价格的 1.25 倍计费。");
    } else if (p.kind === "call") {
      boxes = head("按次计费", "每次请求") + '<div class="flex flex-col gap-2 md:flex-row">' + priceBox("每次请求", M.yenFixed(p.call)) + "</div>";
      notes.push("每次成功的请求按固定价格扣费一次，与 token 数量无关。");
    } else if (p.kind === "free") {
      boxes = head("文本 token", "每百万 token") + '<div class="flex flex-col gap-2 md:flex-row">' + priceBox("输入", "免费") + priceBox("输出", "免费") + "</div>";
      notes.push("免费模型不扣余额，调用计入免费额度，并受速率限制约束。详见" + link("/api/docs/guides/free-tier/", "免费模型与免费额度") + "。");
    } else {
      boxes = head("价格", "") + '<div class="flex flex-col gap-2 md:flex-row">' + priceBox("价格", M.priceText(m)) + "</div>";
    }
    notes.push("价格以人民币计。返回 4xx 或 5xx 的失败请求不扣费。");
    return section(
      "价格",
      "<div>按实际用量计费：多数模型按输入与输出 token 计价，部分模型按次计价。所有模型的价格见" + link("/api/docs/pricing/", "价格") + "页。</div>" +
        '<div class="flex flex-col gap-4">' + boxes + '<div class="flex flex-col gap-2 text-sm text-secondary">' + notes.map(note).join("") + "</div></div>",
      "pricing",
    );
  }

  function capItem(glyph, title, sub, ok) {
    return (
      '<div class="flex flex-row gap-2"><div class="relative flex flex-col items-center justify-center text-xl">' +
      '<div class="flex h-8 w-8 flex-row items-center justify-center gap-2 rounded-lg p-1 ' + (ok ? "bg-primary-soft" : "text-gray-400") + '">' + (ok ? glyphSvg(glyph) : crossedSvg(glyph)) + "</div></div>" +
      '<div class="flex flex-col justify-center"><div class="text-sm font-semibold' + (ok ? "" : " text-gray-400") + '">' + esc(title) + '</div><div class="text-xs text-tertiary">' + esc(sub) + "</div></div></div>"
    );
  }
  function grid(items) {
    return '<div class="grid w-full grid-cols-1 gap-4 md:grid-cols-2">' + items.join("") + "</div>";
  }
  function capabilities(m) {
    var html = section("模态", grid([capItem(GLYPH.text, "文本", "输入与输出", true), capItem(GLYPH.image, "图像", m.multimodal ? "仅输入" : "不支持", !!m.multimodal)]), "modalities");
    html += section(
      "端点",
      "<div>同一个 Model ID 可以在下面三个文本接口中使用。图像与视频生成只对网页版开放，API 调用返回 <code>403 endpoint_disabled</code>。</div>" +
        grid([
          capItem(GLYPH.bubble, "Chat Completions", "v1/chat/completions", true),
          capItem(GLYPH.bubble, "Responses", "v1/responses", true),
          capItem(GLYPH.bubble, "Messages（Anthropic）", "v1/messages", true),
          capItem(GLYPH.image, "图像生成", "v1/images/generations", false),
          capItem(GLYPH.video, "视频生成", "v1/videos/generations", false),
        ]),
      "endpoints",
    );
    var features = [capItem(GLYPH.stream, "流式输出", "支持", true)];
    if (m.enableThinking) features.push(capItem(GLYPH.bulb, "思考模式", "支持", true));
    return html + section("特性", grid(features), "features");
  }

  function variants(cat, m) {
    var members = cat.members(m.id);
    if (!members) return "";
    var rows = members.map(function (mem) {
      var cur = mem.id === m.id;
      var label = M.variantOf(mem) || mem.displayName || mem.id;
      return (
        '<a href="' + esc(M.detailUrl(mem.id)) + '" class="flex flex-row items-center gap-2 rounded-lg text-emphasis no-underline hover:text-emphasis hover:no-underline" data-model-id="' + esc(mem.id) + '"' + (cur ? ' aria-current="page"' : "") + ">" +
        '<div class="cancri-thumb flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft" style="' + M.coverStyle(mem.id) + '"></div>' +
        '<div class="flex items-start gap-3"><div class="flex flex-col"><div class="font-mono text-sm font-semibold">' + esc(mem.id) + "</div>" +
        '<div class="flex flex-row items-center gap-2 text-xs text-tertiary"><div>' + esc(label + " · " + M.priceText(mem)) + "</div></div></div>" +
        (cur ? '<div class="rounded-full border border-default px-1.5 py-0.5 text-xs font-normal text-tertiary">当前</div>' : "") +
        (M.isFree(mem) ? M.badge("免费", "success") : "") +
        "</div></a>"
      );
    });
    return section(
      "分组",
      "<div>同一模型的多条线路（分组）在模型目录里合并成一张卡片，各分组的价格与配额不同。分组只区分 Model ID：同一把 API 密钥可以调用所有分组，把对应的 Model ID 填进请求即可。</div>" +
        '<div class="flex flex-col gap-4">' + rows.join("") + "</div>",
      "variants",
    );
  }

  function availability() {
    return section(
      "可用性",
      "<div>近 24 小时内真实用户请求的抽样成功率，每格代表一小时，高度表示请求量。把鼠标停在格子上可查看该小时的请求数与成功率。</div>" +
        '<div data-health-bars>' + M.uptimeHtml(null, "lg") + '</div><div class="text-sm text-secondary" data-health-summary>正在加载可用性数据…</div>',
      "availability",
    );
  }
  function rateLimits() {
    return section(
      "速率限制",
      "<div>速率限制按账户生效，所有模型共用同一组 RPM（每分钟请求数）与 TPM（每分钟 token 数）限额，档位随累计充值提升。详见" + link("/api/docs/guides/rate-limits/", "速率限制") + "。</div>",
      "rate-limits",
    );
  }

  function paintHealth(m) {
    M.loadHealth().then(function () {
      var bars = root.querySelector("[data-health-bars]");
      var summary = root.querySelector("[data-health-summary]");
      if (!bars || !summary) return;
      var row = M.healthRow(m.id);
      bars.innerHTML = M.uptimeHtml(M.bestHourly([m.id]), "lg");
      var total = row ? Number(row.total_requests) || 0 : 0;
      summary.textContent = total > 0 && typeof row.success_rate === "number" ? "近 24 小时成功率 " + row.success_rate + "%，共 " + total + " 次请求样本。" : "近 24 小时没有该模型的请求样本。";
    });
  }

  function fillPlaceholders(m) {
    var walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.indexOf("__MODEL_") === -1) continue;
      node.nodeValue = node.nodeValue.split("__MODEL_ID__").join(m.id).split("__MODEL_NAME__").join(m.displayName || m.id);
    }
  }

  function render(cat, m) {
    document.title = (m.displayName || m.id) + SITE;
    root.querySelector("[data-detail-top]").innerHTML = header(m) + stats(m) + overview(m) + pricing(m) + capabilities(m) + variants(cat, m);
    root.querySelector("[data-detail-bottom]").innerHTML = availability() + rateLimits();
    fillPlaceholders(m);
    loading.hidden = true;
    state.hidden = true;
    main.hidden = false;
    M.syncCovers();
    paintHealth(m);
  }

  // ── states ───────────────────────────────────────────────────────────
  function showState(title, bodyHtml, retry) {
    document.title = title + SITE;
    loading.hidden = true;
    main.hidden = true;
    state.hidden = false;
    state.innerHTML =
      '<div class="flex flex-col items-start gap-4 py-10"' + (retry ? ' role="alert"' : "") + '><h1 class="_ModelsTitle_163e7_1">' + esc(title) + "</h1>" + bodyHtml +
      '<div class="flex flex-wrap gap-3">' +
      (retry ? '<button type="button" class="_Button_6dmow_1" data-color="primary" data-variant="solid" data-pill="" data-size="lg" data-models-retry><span class="_ButtonInner_6dmow_4">重试</span></button>' : "") +
      '<a href="/api/docs/models/" class="_Button_6dmow_1" data-color="primary" data-variant="' + (retry ? "outline" : "solid") + '" data-pill="" data-size="lg"><span class="_ButtonInner_6dmow_4">浏览模型目录</span></a>' +
      "</div></div>";
  }
  // Up to three ids that look like what was typed, closest first: containing it, else the longest shared prefix.
  function suggestions(cat, id) {
    var q = id.toLowerCase();
    return cat.raw
      .map(function (m) {
        var mid = m.id.toLowerCase();
        var n = 0;
        while (n < q.length && n < mid.length && q[n] === mid[n]) n++;
        return { m: m, score: mid.indexOf(q) !== -1 ? 1000 - mid.length : n };
      })
      .filter(function (x) {
        return x.score >= 3;
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, 3)
      .map(function (x) {
        return x.m;
      });
  }
  function showNotFound(cat) {
    var near = suggestions(cat, requested);
    showState(
      "找不到这个模型",
      '<p class="text-base text-secondary">「' + esc(requested) + "」不在当前的模型目录中，可能已经下架，或者 Model ID 有误。</p>" +
        (near.length
          ? '<p class="text-base text-secondary">你是不是要找：' + near.map(function (m) { return link(M.detailUrl(m.id), m.displayName || m.id); }).join("、") + "</p>"
          : ""),
      false,
    );
  }

  function boot(fresh) {
    if (!requested) {
      showState("选择一个模型", '<p class="text-base text-secondary">从模型目录中选择一个模型，查看它的价格、上下文长度、能力与调用示例。</p>', false);
      return;
    }
    loading.hidden = false;
    state.hidden = true;
    M.load({ fresh: fresh }).then(
      function (cat) {
        var m = cat.get(requested);
        if (m) render(cat, m);
        else showNotFound(cat);
      },
      function (err) {
        showState("暂时无法加载模型信息", '<p class="text-base text-secondary">' + esc(M.errorText(err)) + "。请检查网络后重试。</p>", true);
      },
    );
  }

  root.addEventListener("click", function (e) {
    if (e.target.closest("[data-models-retry]")) boot(true);
  });
  boot(false);
})();
