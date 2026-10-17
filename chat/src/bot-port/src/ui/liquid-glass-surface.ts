// 移植自 cancri-code/src/ui/liquid-glass-surface.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 实时液态玻璃表面 —— CSS backdrop-filter + SVG 位移滤镜（feDisplacementMap）。
 *
 * 取代旧的「Rust 截屏 → WebGL 冻结纹理」方案：backdrop-filter 每帧对元素背后的
 * 真实画面取样，聊天流式输出、光标、动画都会实时透过玻璃折射，菜单展开动画期间
 * 折射也保持正确（旧方案纹理会被拉伸）。零截屏、零 Rust 往返、无闪白。
 *
 * 折射原理：feDisplacementMap 用位移图的 R 通道决定水平位移、G 通道决定垂直位移，
 * 值 128 = 不动，P' = P + scale * (C - 0.5)。位移只集中在圆角矩形边缘一圈
 * （bezel 带），中心保持中性——这是「玻璃厚板」而非「一团扭曲」的关键，
 * 对应 LGJ 默认材质 refThickness≈18 / refFactor≈1.35 的手感。
 * 色散（LGJ refDispersion）：R/G/B 三通道用略不同的位移比例各跑一遍再合成，
 * 边缘出现轻微彩色镶边。
 *
 * 每个玻璃面板持有**独立**滤镜实例（见 GlassSurfaceKey），共用一份会互相踩几何。
 *
 * 兼容性：backdrop-filter: url(#svg) 是 Chromium-only；本应用跑在 WebView2
 * （Chromium）上可用。detectLiquidGlassSupport() 为 false 时调用方退回
 * 纯 blur + 半透明底（CSS .glass-active 不带 .glass-refract）。
 */

const SVG_HOST_ID = "cc-lg-defs";
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * 每个玻璃面板一个独立滤镜。
 *
 * ⛔ 禁改区：**不要**退回"全局共用一个 #cc-lg-refraction"。
 * 滤镜是 filterUnits="userSpaceOnUse" + 显式 x/y/width/height；区域必须覆盖引用元素的
 * 边框盒以及位移向外取样所需的余量，最终可见范围仍由菜单自己的圆角/overflow 裁切。
 * 共用一份时，后调用 sync 的面板会把区域改成自己的尺寸，另一个面板超出该矩形的部分
 * 直接失去 backdrop-filter 输出 —— 症状就是「悬停计费卡，模型菜单的玻璃整块没了」。
 * 每个面板各持一份是硬性要求。
 */
export type GlassSurfaceKey =
  | "menu"
  | "cost"
  | "ctx"
  | "effort"
  | "skill"
  | "skill-hint"
  | "dialog"
  | "shortcut"
  | "rail"
  | "hovercard"
  | "change"
  | "approval"
  | "account"
  // 顶栏「文件/编辑/查看/…」下拉。不能蹭 "menu"：模型菜单可以同时开着，
  // 后 sync 的那张会把滤镜矩形改成自己的尺寸，另一张超出部分玻璃直接没了。
  | "titlebar"
  // 计划/运行状态弹层。不能蹭 "menu"：模型菜单与计划菜单可同时在场。
  | "plan"
  // 终端「+」的 shell 选择菜单。不能蹭 "ctx"：终端标签右键菜单与它可同时在场。
  | "term-shell"
  // 液态开关/滑块的旋钮（设置页等）。所有旋钮共享同一固定几何
  // （LG_KNOB_W×LG_KNOB_H 胶囊），同尺寸元素共用一份滤镜不会互踩区域
  // （禁改区针对的是不同尺寸面板）；故一个 key 足够。
  | "lg-knob";

/** 各面板滤镜的 DOM id；CSS 侧 `url(#…)` 必须与此一致 */
export function glassFilterId(key: GlassSurfaceKey): string {
  return `cc-lg-${key}`;
}

/** 边缘折射带宽度（CSS px）—— LGJ 默认 refThickness=18 的近似手感 */
export const GLASS_BEZEL_PX = 20;
/** feDisplacementMap scale：边缘最大位移 ≈ scale/2 px */
const DISPLACE_SCALE = 26;

/**
 * 每个滤镜实例的可选几何/强度覆盖。
 * 小尺寸表面（如 40×24 的开关旋钮）必须用更小的 bezel/scale：
 * 默认 20px bezel 会盖满整个旋钮（中心中性区消失，整团扭曲而不是玻璃厚板）。
 * displaceScale 在滤镜创建时烘焙进 feDisplacementMap，之后改不动（同 key 二次同步忽略）。
 */
export interface GlassSurfaceTune {
  bezel?: number;
  displaceScale?: number;
}
/** 色散强度：R/B 通道位移相对 G 的偏移比例（LGJ refDispersion 的轻量近似） */
const DISPERSION_RATIO = 0.07;

/**
 * filter region 需要覆盖色散后最大的向外取样距离：scale × (1 + dispersion) / 2。
 * 位移图本身仍从 (0, 0) 对齐菜单边框盒；这里只扩展 SVG 的采样/输出区，最后由 CSS 壳裁切。
 */
export function getGlassFilterPadding(tune?: GlassSurfaceTune): number {
  const baseScale = tune?.displaceScale ?? DISPLACE_SCALE;
  return Math.ceil((baseScale * (1 + DISPERSION_RATIO)) / 2);
}

/**
 * Chromium/WebView2 can expose a transparent Mica area as transparent black to SVG filters.
 * Keep the source opaque before displacement so transparent chrome is not turned into a gray
 * rectangle, while opaque page content remains unchanged because SourceGraphic is composited over
 * this theme-colored base.
 */
function getGlassBackdropFallbackColor(): string {
  const scheme = typeof document === "undefined" ? "light" : document.documentElement.dataset.scheme;
  if (scheme === "black") return "#000000";
  if (scheme === "dark") return "#181818";
  return "#ffffff";
}

/**
 * 抽 R/G/B 单通道时用的 feColorMatrix（导出给单测防回归）。
 * 每条最后一行必须是 `0 0 0 1 0`（保留 alpha）——若写成 `0 0 0 0 0`，
 * Chromium 预乘 alpha 会把该通道颜色乘成 0，只剩 R → 整块玻璃发红。
 */
export const CHANNEL_EXTRACT_MATRICES = {
  R: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  G: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  B: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
} as const;

/**
 * backdrop-filter 是否支持引用 SVG 滤镜（url(#…)）。
 * Chromium/WebView2 → true；不支持时只能用普通 blur 玻璃兜底。
 */
export function detectLiquidGlassSupport(): boolean {
  try {
    if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
    const probe = `url(#${glassFilterId("menu")})`;
    return (
      CSS.supports("backdrop-filter", probe) || CSS.supports("-webkit-backdrop-filter", probe)
    );
  } catch {
    return false;
  }
}

/**
 * 生成圆角矩形边缘折射位移图的像素缓冲（RGBA，R=水平 G=垂直，128=中性）。
 * 纯函数，便于单测：不依赖 DOM/canvas。
 *
 * 每个像素：算到圆角矩形边框的内侧深度 depth；depth ≥ bezel → 中性；
 * 否则沿外法线方向位移，强度 (1 - depth/bezel)^2 —— 越贴边弯折越强，
 * 读起来是「玻璃边缘的透镜」而不是全脸糊。
 */
export function buildDisplacementMap(
  width: number,
  height: number,
  cornerRadius: number,
  bezel: number = GLASS_BEZEL_PX,
): Uint8ClampedArray {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const r = Math.max(0, Math.min(cornerRadius, Math.min(w, h) / 2));
  const out = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2;
  const cy = h / 2;
  const halfW = w / 2 - r;
  const halfH = h / 2 - r;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 像素中心坐标相对面板中心
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const qx = Math.abs(px) - halfW;
      const qy = Math.abs(py) - halfH;
      // 圆角矩形 SDF（负值在内部）
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const sdf = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
      const depth = -sdf; // 距边框的内侧深度

      let dr = 128;
      let dg = 128;
      if (depth < bezel) {
        // 外法线方向
        let nx: number;
        let ny: number;
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(qx, qy) || 1;
          nx = (qx / len) * Math.sign(px);
          ny = (qy / len) * Math.sign(py);
        } else if (qx > qy) {
          nx = Math.sign(px);
          ny = 0;
        } else {
          nx = 0;
          ny = Math.sign(py);
        }
        // 平方 ramp：贴边最强，向内衰减但保留「厚度」。
        //
        // ⛔ 别换成斯涅尔定律（θi=asin(t²) / θt=asin(sinθi/n) / -tan(θt-θi)）。
        // 2026-07-26 试过，物理上更对，观感上更差：峰值不变但边缘往内 1~6px
        // 整段塌一半以上（1px 处 11.7→6.3，4px 处 8.3→3.1），可见折射带
        // 14.6px→10.3px，变成「一根尖刺 + 一层余晖」。LGJ 那套参数靠折射/色散/
        // Fresnel/glare/渐进模糊五样叠加撑住，我们这儿只有折射一样，
        // 带宽收窄就没东西透出玻璃厚度了 —— 面板会读成塑料。
        const t = 1 - Math.max(depth, 0) / bezel;
        const strength = t * t;
        dr = 128 + nx * strength * 127;
        dg = 128 + ny * strength * 127;
      }

      const i = (y * w + x) * 4;
      out[i] = dr;
      out[i + 1] = dg;
      out[i + 2] = 128;
      out[i + 3] = 255;
    }
  }
  return out;
}

function pixelsToDataUrl(pixels: Uint8ClampedArray, width: number, height: number): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

interface FilterEntry {
  filter: SVGFilterElement;
  feImage: SVGFEImageElement;
  /**
   * 玻璃底色那层 feFlood。必须留着引用：底色**跟随配色实时变**，
   * ⛔ 不能像 displaceScale 那样在创建时烘焙一次（见 applyBackdropBase 的判据）。
   */
  backdropBase: SVGFEFloodElement;
  /** 上次同步的 `${w}x${h}r${radius}`，同尺寸重复调用直接跳过 */
  geometryKey: string;
  /** feImage 当前 href 指向的 dataUrl（"" = 尚未挂图）。 */
  appliedUrl: string;
  /** href 换图令牌：先发的 decode 回调不得覆盖后到的几何。 */
  swapSeq: number;
}

const filters = new Map<string, FilterEntry>();

/**
 * 位移图跨会话缓存（2026-08-19）。
 *
 * 同一几何（w/h/radius/bezel）的位移图是逐字节确定的纯函数结果，每次冷启动重算纯属浪费，
 * 而这份浪费正好压在「用户点击 → 菜单出现」之间。真实窗口实测（280×292、43 行的模型菜单）：
 * 首次打开阻塞主线程 73.2ms 并产生两个 86ms 长任务，第 2 次起降到 11~18ms；其中
 * buildDisplacementMap 6.7ms + toDataURL 12.3ms + 本函数 4.5ms ≈ 23.5ms 花在位移图上。
 * 微基准（预热后）显示生成 2.3ms、PNG 编码 5.0ms —— **编码比像素循环更贵**。
 *
 * 因此缓存的是「编码后的 data URL」而不是像素。命中后连生成带编码一起跳过，
 * 且输出与重算逐字节相同 → 零视觉风险。
 *
 * 已实测但**故意没做**的两项，别再重复试：
 *   - 只算 bezel 边缘带、内区一次性填中性：输出确实逐字节相同（maxDelta=0），
 *     但只省 0.51ms（2.32→1.81），因为瓶颈在编码。不值得为此增加一份几何分支代码。
 *   - 换编码格式：toBlob+createObjectURL 10.4ms、WebP 9.33ms，都比现在的 PNG 5.0ms 更慢。
 * 半分辨率生成（合计 2.04ms）确实更省，但会改折射带采样精度，属于视觉改动，未做。
 */
const DISP_MAP_CACHE_KEY = "cancri.lgDispMap.v2";
/**
 * ⚠ 改动 buildDisplacementMap 的输出（bezel ramp、SDF、通道含义等）必须把上面的 v1 递增，
 * 否则用户本机会一直复用旧算法生成的图，代码改了观感却不变，极难排查。
 */
/** 单张图落盘上限（base64 字符数）。超限不缓存，避免挤爆 localStorage 配额。 */
const DISP_MAP_MAX_CHARS = 64 * 1024;

/**
 * 每个 surface 保留的最近几何图数量上限（插入序淘汰最旧）。
 * 计费卡形变按终态即时建图（map 必须 ≥ 元素，见 main.ts applyCostCardGlass），
 * 扫行在几个高度间来回 —— 单槽缓存必全 miss，逐像素重建落在手势上就是顿挫
 * （2026-08-12 实报）。多槽位让「见过的几何」零成本命中。
 * 结构换成 surface→{geometryKey→dataUrl} 多槽后缓存键升到 v2（旧 v1 单槽条目不兼容）。
 */
const DISP_MAP_PER_SURFACE = 8;
type DispMapCache = Record<string, Record<string, string>>;

/**
 * 已解码完成的位移图 dataUrl 集合。
 *
 * feImage 换 href 后 Chromium 要**异步解码** PNG，解码窗口里 map 输入为空
 * → feDisplacementMap 拿到空图，折射整段消失/全卡最大位移（2026-09-23 用户
 * 实报「延迟折射又来了」—— 形变换图后折射要等解码落地才出现）。命中这个
 * 集合的 URL 可以同步换 href；未命中的走 decode 门控，先解码再换，
 * 窗口内旧图继续在新矩形里拉伸过渡（见 syncGlassFilterGeometry 尾部）。
 */
const warmUrls = new Set<string>();
const pendingDecodes = new Map<string, Promise<void>>();

function warmDecode(dataUrl: string): Promise<void> {
  const pending = pendingDecodes.get(dataUrl);
  if (pending) return pending;
  const p = new Promise<void>((resolve) => {
    const img = new Image();
    const done = () => {
      warmUrls.add(dataUrl);
      pendingDecodes.delete(dataUrl);
      resolve();
    };
    img.onload = done;
    // 解码失败也放行：commit 之后让 Chromium 自己兜底，别把换图卡死
    img.onerror = done;
    img.src = dataUrl;
  });
  pendingDecodes.set(dataUrl, p);
  return p;
}

/** 内存侧备份：避免每次几何变化都 JSON.parse 一遍整块缓存。 */
let dispMapCache: DispMapCache | null = null;

function readDispMapCache(): DispMapCache {
  if (dispMapCache) return dispMapCache;
  dispMapCache = {};
  try {
    if (typeof localStorage === "undefined") return dispMapCache;
    const raw = localStorage.getItem(DISP_MAP_CACHE_KEY);
    if (!raw) return dispMapCache;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") dispMapCache = parsed as DispMapCache;
  } catch {
    // 损坏/不可用（隐私模式、配额异常）→ 当作空缓存，走重算原路
  }
  return dispMapCache;
}

function writeDispMapCache(surface: GlassSurfaceKey, geometryKey: string, dataUrl: string): void {
  if (dataUrl.length > DISP_MAP_MAX_CHARS) return;
  const cache = readDispMapCache();
  const existing = cache[surface];
  const perSurface = existing && typeof existing === "object" ? existing : {};
  delete perSurface[geometryKey]; // 重插到尾部 = MRU
  perSurface[geometryKey] = dataUrl;
  const keys = Object.keys(perSurface);
  while (keys.length > DISP_MAP_PER_SURFACE) delete perSurface[keys.shift()!];
  cache[surface] = perSurface;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(DISP_MAP_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 写不进去不影响正确性：缓存只是加速，内存侧仍然生效
  }
  // 生成即预热解码：到换图那一刻 decode 已落地，decode 门控同步放行
  void warmDecode(dataUrl);
}

/** SVG 宿主必须占 0×0 但不能 display:none（display:none 会让滤镜引用失效）。 */
function ensureSvgDefs(): SVGDefsElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(SVG_HOST_ID);
  if (existing) {
    const defs = existing.querySelector("defs");
    if (defs) return defs as SVGDefsElement;
    existing.remove();
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = SVG_HOST_ID;
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.style.left = "-9999px";
  svg.style.top = "0";

  const defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

/**
 * 建立（每个 key 一次性）SVG 滤镜骨架：
 *   主题底色 feFlood + SourceGraphic → 位移图 feImage → 三次 feDisplacementMap（R/G/B 各自略不同 scale）→
 *   feColorMatrix 抽单通道 → feComposite 相加合成 → feComposite 还原 alpha。
 */
/**
 * 把玻璃底色对齐**当前**配色。
 *
 * ⛔ 这层底色不是创建时的一次性参数。`filters` 是模块级缓存、`ensureFilter` 命中缓存
 * 就直接返回、`syncGlassFilterGeometry` 在几何未变时还会提前 return —— 于是
 * 「在深色下开过一次某个面板」会把它的 flood-color 永久钉死成 #181818；切回浅色后，
 * 半透明菜单压在深灰底上合成出一块灰（用户实报「设置菜单发灰，切回浅色不跟随」，
 * 2026-08-28）。与本文件下方 alpha 禁改区记的是**同一族**症状：玻璃底一错就发灰。
 * 只写不同的值（changed 才 setAttribute）：无谓的属性写会让 Chromium 重跑整条滤镜。
 */
function applyBackdropBase(entry: FilterEntry): void {
  const color = getGlassBackdropFallbackColor();
  if (entry.backdropBase.getAttribute("flood-color") === color) return;
  entry.backdropBase.setAttribute("flood-color", color);
}

/** 配色切换时，把**已在场**的面板（可能正开着）底色一起刷新。 */
export function refreshGlassBackdropBase(): void {
  filters.forEach((entry) => applyBackdropBase(entry));
}

let schemeWatchBound = false;
/**
 * 监听 `<html data-scheme>`。惰性安装（首个面板创建时），⛔ 不放模块顶层：
 * CLI 单文件产物有「模块顶层不得出现浏览器 API」的发布闸门。
 * 有了它，切配色时**正开着**的面板也会立刻跟随，而不必等下一次 sync。
 */
function ensureSchemeWatch(): void {
  if (schemeWatchBound) return;
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  schemeWatchBound = true;
  new MutationObserver(() => refreshGlassBackdropBase()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-scheme"],
  });
}

function ensureFilter(key: GlassSurfaceKey, tune?: GlassSurfaceTune): FilterEntry | null {
  const cached = filters.get(key);
  if (cached && cached.filter.isConnected) {
    // 命中缓存也要对齐底色：这是「切了配色、面板复用旧滤镜」的唯一收口。
    applyBackdropBase(cached);
    return cached;
  }

  const defs = ensureSvgDefs();
  if (!defs) return null;
  ensureSchemeWatch();

  const filter = document.createElementNS(SVG_NS, "filter") as SVGFilterElement;
  filter.id = glassFilterId(key);
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");

  const feImage = document.createElementNS(SVG_NS, "feImage") as SVGFEImageElement;
  feImage.setAttribute("x", "0");
  feImage.setAttribute("y", "0");
  feImage.setAttribute("preserveAspectRatio", "none");
  feImage.setAttribute("result", "map");
  filter.appendChild(feImage);

  // 透明 Mica backdrop 在 WebView2 里可能以透明黑进入 SVG。先垫主题底色，再让真实
  // SourceGraphic 覆盖它：不透明主区保持原色，透明侧栏仍能进入同一套折射链而不发灰。
  const backdropBase = document.createElementNS(SVG_NS, "feFlood") as SVGFEFloodElement;
  backdropBase.setAttribute("flood-color", getGlassBackdropFallbackColor());
  backdropBase.setAttribute("flood-opacity", "1");
  backdropBase.setAttribute("result", "glassBase");
  filter.appendChild(backdropBase);

  const glassBackdrop = document.createElementNS(SVG_NS, "feComposite");
  glassBackdrop.setAttribute("in", "SourceGraphic");
  glassBackdrop.setAttribute("in2", "glassBase");
  glassBackdrop.setAttribute("operator", "over");
  glassBackdrop.setAttribute("result", "glassBackdrop");
  filter.appendChild(glassBackdrop);

  // 三通道色散：G 用基准 scale，R 略小、B 略大 → 边缘轻微彩边。
  //
  // 关键（曾导致整块玻璃发红）：
  //   Chromium 滤镜按预乘 alpha 合成。若 G/B 的 feColorMatrix 把 A 置 0，
  //   预乘后 G/B 颜色贡献为 0，arithmetic 相加只剩 R 通道 → 满屏红。
  // 正确做法：抽单通道时仍保留原 alpha，最后再用 feComposite "in" 把 alpha 收回来。
  const baseScale = tune?.displaceScale ?? DISPLACE_SCALE;
  const channels: Array<{ name: "R" | "G" | "B"; scaleFactor: number; matrix: string }> = [
    { name: "R", scaleFactor: 1 - DISPERSION_RATIO, matrix: CHANNEL_EXTRACT_MATRICES.R },
    { name: "G", scaleFactor: 1, matrix: CHANNEL_EXTRACT_MATRICES.G },
    { name: "B", scaleFactor: 1 + DISPERSION_RATIO, matrix: CHANNEL_EXTRACT_MATRICES.B },
  ];
  for (const ch of channels) {
    const disp = document.createElementNS(SVG_NS, "feDisplacementMap") as SVGFEDisplacementMapElement;
    disp.setAttribute("in", "glassBackdrop");
    disp.setAttribute("in2", "map");
    disp.setAttribute("scale", String(baseScale * ch.scaleFactor));
    disp.setAttribute("xChannelSelector", "R");
    disp.setAttribute("yChannelSelector", "G");
    disp.setAttribute("result", `disp${ch.name}`);
    filter.appendChild(disp);

    const cm = document.createElementNS(SVG_NS, "feColorMatrix");
    cm.setAttribute("in", `disp${ch.name}`);
    cm.setAttribute("type", "matrix");
    cm.setAttribute("values", ch.matrix);
    cm.setAttribute("result", `ch${ch.name}`);
    filter.appendChild(cm);
  }

  const addRG = document.createElementNS(SVG_NS, "feComposite");
  addRG.setAttribute("in", "chR");
  addRG.setAttribute("in2", "chG");
  addRG.setAttribute("operator", "arithmetic");
  addRG.setAttribute("k1", "0");
  addRG.setAttribute("k2", "1");
  addRG.setAttribute("k3", "1");
  addRG.setAttribute("k4", "0");
  addRG.setAttribute("result", "chRG");
  filter.appendChild(addRG);

  const addRGB = document.createElementNS(SVG_NS, "feComposite");
  addRGB.setAttribute("in", "chRG");
  addRGB.setAttribute("in2", "chB");
  addRGB.setAttribute("operator", "arithmetic");
  addRGB.setAttribute("k1", "0");
  addRGB.setAttribute("k2", "1");
  addRGB.setAttribute("k3", "1");
  addRGB.setAttribute("k4", "0");
  addRGB.setAttribute("result", "chRGB");
  filter.appendChild(addRGB);

  // 三次 arithmetic 相加把 alpha 也加了三遍。用 "in" 拿 dispG 的 alpha 罩回来：
  // 颜色取自三通道合成，alpha 取自（同样位移过的）原始背景。
  //
  // ⛔ 禁改区：**绝不能**在这里改用 feColorMatrix 把 alpha 强制写成 1
  //   （`0 0 0 0 1`）。侧栏在 Mica / 透明 chrome 下网页层完全不作画，背景是
  //   透明黑 (0,0,0,0)；强制 alpha=1 会把它变成**不透明黑**，半透明菜单压上去
  //   实测正好是 #CDCDCE —— 就是「浅色三点菜单整块发灰」那个 bug。
  //   0.82 × 250 = 205 三通道逐一对齐，别再去调 alpha 参数掩盖它。
  const restoreAlpha = document.createElementNS(SVG_NS, "feComposite");
  restoreAlpha.setAttribute("in", "chRGB");
  restoreAlpha.setAttribute("in2", "dispG");
  restoreAlpha.setAttribute("operator", "in");
  filter.appendChild(restoreAlpha);

  defs.appendChild(filter);

  const entry: FilterEntry = {
    filter,
    feImage,
    backdropBase,
    geometryKey: "",
    appliedUrl: "",
    swapSeq: 0,
  };
  filters.set(key, entry);
  return entry;
}

/**
 * 让某个面板的滤镜几何与它当前 CSS 尺寸对齐（打开/尺寸变化时调用）。
 * 位移图按精确尺寸重新生成；同尺寸重复调用零开销（geometryKey 缓存）。
 *
 * @param surface 面板标识 —— 每个面板持有独立滤镜，见 GlassSurfaceKey 上的禁改区说明
 */
export function syncGlassFilterGeometry(
  surface: GlassSurfaceKey,
  cssWidth: number,
  cssHeight: number,
  cornerRadius: number,
  tune?: GlassSurfaceTune,
): void {
  const w = Math.max(1, Math.round(cssWidth));
  const h = Math.max(1, Math.round(cssHeight));
  const filterPadding = getGlassFilterPadding(tune);
  const bezel = tune?.bezel ?? GLASS_BEZEL_PX;
  const geometryKey = `${w}x${h}r${cornerRadius}b${bezel}`;

  const entry = ensureFilter(surface, tune);
  if (!entry) return;
  if (entry.geometryKey === geometryKey) {
    // 同几何早退也要把 feImage 矩形摆正：形变期拉伸跟随（setGlassMapStretch）
    // 可能把 height 留在中间值，下一次同几何同步若不归位，陈旧拉伸会以
    // 「底缘环错位 = 折射缝」复活（收卡打断跟帧、再次首开等路径）。
    entry.feImage.setAttribute("width", String(w));
    entry.feImage.setAttribute("height", String(h));
    return;
  }

  // 先查跨会话缓存（见 DISP_MAP_CACHE_KEY 上方说明）：命中则跳过生成 + PNG 编码，
  // 这两步合计是首次打开卡顿的主要来源。多槽位按 geometryKey 索引（2026-09-22：
  // 计费卡形变要即时按终态建图，单槽在扫行中全 miss）。
  const cached = readDispMapCache()[surface];
  let dataUrl =
    cached && typeof cached === "object" ? (cached[geometryKey] ?? null) : null;
  if (!dataUrl) {
    const pixels = buildDisplacementMap(w, h, cornerRadius, bezel);
    dataUrl = pixelsToDataUrl(pixels, w, h);
    if (!dataUrl) return;
    writeDispMapCache(surface, geometryKey, dataUrl);
  }

  // 几何属性立即更新：feImage 的绘制矩形和 filter 区域不等解码 ——
  // 换图窗口里旧图在新矩形里拉伸过渡（同配方圆角 bezel 图，边缘环仍贴边）。
  entry.filter.setAttribute("x", String(-filterPadding));
  entry.filter.setAttribute("y", String(-filterPadding));
  entry.filter.setAttribute("width", String(w + filterPadding * 2));
  entry.filter.setAttribute("height", String(h + filterPadding * 2));
  entry.feImage.setAttribute("width", String(w));
  entry.feImage.setAttribute("height", String(h));

  // decode 门控：有旧图在位时新图先解码再换 href，窗口期旧图继续服役，
  // 绝不出现「空 map → 折射消失/全卡位移」帧（2026-09-23 实报）。
  // 无旧图（首次挂图）直接换 —— 反正没有更好的东西可看。
  entry.swapSeq += 1;
  const seq = entry.swapSeq;
  const commit = () => {
    if (seq !== entry.swapSeq || !entry.filter.isConnected) return;
    entry.feImage.setAttribute("href", dataUrl);
    entry.feImage.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", dataUrl);
    entry.appliedUrl = dataUrl;
  };
  if (!entry.appliedUrl || warmUrls.has(dataUrl)) commit();
  else void warmDecode(dataUrl).then(commit);
  entry.geometryKey = geometryKey;
}

/**
 * 形变期逐帧把位移图**垂直拉伸**到元素实时高度（只写 feImage.height，不换图、
 * 不重新烘焙）。调用方在高度过渡的 rAF 循环里每帧调用。
 *
 * 为什么需要它：「位移图 ≥ 元素」不变量解决了矮图的缝，但图比元素高时
 * 底缘 bezel 环落在元素底边**之外** → 形变全程卡片底边没有折射，要等落定
 * 收齐才出现（2026-09-23 用户实报「延迟折射又来了」）。把图拉伸到实时高后
 * 底缘环永远压在元素底边上，四边折射全程在线；代价只是 bezel 带厚度随
 * 拉伸比轻微变化（380ms 过渡内自校正）。宽度恒定不动，所以只拉伸高度。
 */
export function setGlassMapStretch(surface: GlassSurfaceKey, cssHeight: number): void {
  const entry = filters.get(surface);
  if (!entry || !entry.filter.isConnected) return;
  const h = String(Math.max(1, Math.round(cssHeight)));
  if (entry.feImage.getAttribute("height") !== h) entry.feImage.setAttribute("height", h);
}
