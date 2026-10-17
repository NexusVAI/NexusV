// 移植自 cancri-code/src/ui/squircle-path.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 苹果 / Figma 式圆角（corner smoothing）的几何核心。
 *
 * 为什么不是 CSS 的 corner-shape: squircle
 * ----------------------------------------
 * 苹果的圆角**不是超椭圆**。多方逆向的结论一致：Marc Edwards(2017) 拟合出 n≈5，
 * Mike Swanson 用遗传算法验证，最终 Manfred Schwind 直接查 iOS 代码确认是**贝塞尔构造**；
 * Figma 2018 的《Desperately Seeking Squircles》记录了从超椭圆 → 回旋曲线 → 贝塞尔弧的全过程。
 * CSS 的 superellipse() 是另一条曲线，差异恰好出现在最显眼的地方——直边到圆角的过渡段，
 * 以及边框在对角处会变粗。所以要「和 iPhone 对得上」，只能用这套构造。
 *
 * 构造方式
 * --------
 * 角的中心保留一段圆弧，两侧各接一段三次贝塞尔，从零曲率（直边）平滑过渡到圆弧曲率：
 *   p            = (1 + s) × r      一个角沿着边吃掉的总长度
 *   arcMeasure   = 90° × (1 − s)    中间剩下的圆弧角度
 *   s = 0        → 退化成普通 border-radius
 *   s = 0.6      → iOS 标准（Figma 里的 60% corner smoothing）
 *
 * a/b/c/d 是四个控制点距离，由半角恒等式导出。
 *
 * ⚠️ 纯函数，不碰 DOM。改这里必须跑 squircle-path.test.ts —— 曲线错了整站圆角都歪。
 */

/** 一个角的贝塞尔参数 */
export interface CornerParams {
  /** 沿边吃掉的总长度 = (1+s)·r，可能被 budget 压缩 */
  p: number;
  /** 实际使用的圆弧半径 */
  radius: number;
  /** 圆弧段的弦长 */
  arcSectionLength: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface SquircleOptions {
  width: number;
  height: number;
  /** 目标圆角半径 */
  radius: number;
  /** 0–1，iOS 标准 0.6 */
  smoothing?: number;
  /** 向内缩进，用于生成描边的内轮廓 */
  inset?: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 保留两位小数，缩短 path 字符串（浏览器解析更快，且避免浮点噪声） */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 解一个角的贝塞尔参数。
 *
 * @param radius  目标圆角
 * @param smoothing 0–1
 * @param budget  这个角最多能吃掉多长的边（= min(w,h)/2）。
 *                超出时整组参数等比缩放，保持曲线形状而不是粗暴截断——
 *                直接把 smoothing 调小会让角出现折角。
 */
export function getCornerParams(
  radius: number,
  smoothing: number,
  budget: number,
): CornerParams {
  const r = Math.max(0, Math.min(radius, budget));
  const s = Math.max(0, Math.min(1, smoothing));

  const arcMeasure = 90 * (1 - s);
  const arcSectionLength = Math.sin(toRad(arcMeasure / 2)) * r * Math.SQRT2;

  // 贝塞尔段：从直边(零曲率)接到圆弧端点(曲率 1/r)
  const angleAlpha = (90 - arcMeasure) / 2;
  const p3ToP4 = r * Math.tan(toRad(angleAlpha / 2));
  const angleBeta = 45 * s;
  const c = p3ToP4 * Math.cos(toRad(angleBeta));
  const d = c * Math.tan(toRad(angleBeta));

  let p = (1 + s) * r;
  let b = (p - arcSectionLength - c - d) / 3;
  let a = 2 * b;

  // 空间不够时等比缩放全部参数，保持 S 形过渡的比例
  if (p > budget) {
    const k = budget / p;
    return {
      p: budget,
      radius: r * k,
      arcSectionLength: arcSectionLength * k,
      a: a * k,
      b: b * k,
      c: c * k,
      d: d * k,
    };
  }
  return { p, radius: r, arcSectionLength, a, b, c, d };
}

/**
 * 生成 squircle 的 SVG path（顺时针，从上边靠右处起笔）。
 * 坐标系原点在元素左上角，可直接用于 `clip-path: path('...')`。
 */
export function squirclePath(options: SquircleOptions): string {
  const { width, height, radius, smoothing = 0.6, inset = 0 } = options;
  const w = width - inset * 2;
  const h = height - inset * 2;
  if (w <= 0 || h <= 0) return `M ${r2(inset)},${r2(inset)} Z`;

  const budget = Math.min(w, h) / 2;
  const k = getCornerParams(radius, smoothing, budget);
  const { p, a, b, c, d, arcSectionLength: arc } = k;
  const rr = r2(k.radius);
  const o = inset;

  // 圆弧用 SVG 弧命令；两侧各一段三次贝塞尔
  const arcCmd = arc > 0.01 ? `a ${rr} ${rr} 0 0 1` : "";

  return [
    `M ${r2(o + w - p)},${r2(o)}`,
    // 右上
    `c ${r2(a)},0 ${r2(a + b)},0 ${r2(a + b + c)},${r2(d)}`,
    arc > 0.01 ? `${arcCmd} ${r2(arc)},${r2(arc)}` : "",
    `c ${r2(d)},${r2(c)} ${r2(d)},${r2(b + c)} ${r2(d)},${r2(a + b + c)}`,
    `L ${r2(o + w)},${r2(o + h - p)}`,
    // 右下
    `c 0,${r2(a)} 0,${r2(a + b)} ${r2(-d)},${r2(a + b + c)}`,
    arc > 0.01 ? `${arcCmd} ${r2(-arc)},${r2(arc)}` : "",
    `c ${r2(-c)},${r2(d)} ${r2(-b - c)},${r2(d)} ${r2(-a - b - c)},${r2(d)}`,
    `L ${r2(o + p)},${r2(o + h)}`,
    // 左下
    `c ${r2(-a)},0 ${r2(-a - b)},0 ${r2(-a - b - c)},${r2(-d)}`,
    arc > 0.01 ? `${arcCmd} ${r2(-arc)},${r2(-arc)}` : "",
    `c ${r2(-d)},${r2(-c)} ${r2(-d)},${r2(-b - c)} ${r2(-d)},${r2(-a - b - c)}`,
    `L ${r2(o)},${r2(o + p)}`,
    // 左上
    `c 0,${r2(-a)} 0,${r2(-a - b)} ${r2(d)},${r2(-a - b - c)}`,
    arc > 0.01 ? `${arcCmd} ${r2(arc)},${r2(-arc)}` : "",
    `c ${r2(c)},${r2(-d)} ${r2(b + c)},${r2(-d)} ${r2(a + b + c)},${r2(-d)}`,
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * 同心圆角：内层半径 = 外层半径 − 间距。
 * 苹果自己的嵌套卡片就是这么算的，间距取内外边缘的实际距离（padding / inset）。
 */
export function concentricRadius(outerRadius: number, gap: number): number {
  return Math.max(0, outerRadius - gap);
}
