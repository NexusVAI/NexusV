// 移植自 cancri-code/src/chat/render/rich-ui-formula.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 智能交互界面 · 计算器控件的公式求值。
 *
 * ⛔ 公式来自模型输出，是不可信文本：**禁止**用 eval / new Function。
 * 这里是一个只认「数字 / 变量 / + - * / % ^ / 比较 / 逻辑 / 三元 / 括号 / 白名单函数」的
 * 递归下降解析器，解析不了就返回 null，由调用方显示「—」。
 *
 * 2026-10-17 扩展（智能交互「应用」组件要按模式切换系数、按角度画图）：
 *   · 比较 `< <= > >= == !=` 与逻辑 `&& || !` 的结果是 1 / 0；
 *   · 三元 `c ? a : b`（右结合，优先级最低），以及等价的函数 `if(c, a, b)`；
 *   · 角度制三角 `sind cosd tand`、反三角、`atan2 hypot sign clamp lerp deg rad`。
 */

const FUNCS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  hypot: Math.hypot,
  sign: Math.sign,
  trunc: Math.trunc,
  sind: (d) => Math.sin((d * Math.PI) / 180),
  cosd: (d) => Math.cos((d * Math.PI) / 180),
  tand: (d) => Math.tan((d * Math.PI) / 180),
  deg: (r) => (r * 180) / Math.PI,
  rad: (d) => (d * Math.PI) / 180,
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  lerp: (a, b, t) => a + (b - a) * t,
  if: (c, a, b) => (c ? a : b),
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, true: 1, false: 0 };

/** 双字符运算符（必须先于单字符匹配）。 */
const OPS2 = ["<=", ">=", "==", "!=", "&&", "||"];

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: "id", v: id[0] }); i += id[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/%^(),<>!?:".includes(c)) { out.push({ t: "op", v: c }); i += 1; continue; }
    return null;
  }
  return out;
}

/** 求值；任何语法错误 / 未知标识符 / 非有限结果都返回 null。 */
export function evaluateFormula(src: string, vars: Record<string, number>): number | null {
  if (typeof src !== "string" || src.length > 500) return null;
  const toks = tokenize(src);
  if (!toks) return null;
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const isOp = (v: string): boolean => { const k = peek(); return !!k && k.t === "op" && k.v === v; };

  // expr := or ('?' expr ':' expr)?        （三元，右结合）
  const expr = (): number => {
    const c = or();
    if (!isOp("?")) return c;
    p += 1;
    const a = expr();
    if (!isOp(":")) throw new Error(":");
    p += 1;
    const b = expr();
    return c ? a : b;
  };
  // or := and ('||' and)*；and := cmp ('&&' cmp)*
  const or = (): number => {
    let v = and();
    while (isOp("||")) { p += 1; const r = and(); v = v || r ? 1 : 0; }
    return v;
  };
  const and = (): number => {
    let v = cmp();
    while (isOp("&&")) { p += 1; const r = cmp(); v = v && r ? 1 : 0; }
    return v;
  };
  // cmp := sum (('<'|'<='|'>'|'>='|'=='|'!=') sum)?
  const cmp = (): number => {
    const l = sum();
    for (const op of ["<=", ">=", "==", "!=", "<", ">"]) {
      if (!isOp(op)) continue;
      p += 1;
      const r = sum();
      const eq = Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r));
      switch (op) {
        case "<": return l < r && !eq ? 1 : 0;
        case ">": return l > r && !eq ? 1 : 0;
        case "<=": return l < r || eq ? 1 : 0;
        case ">=": return l > r || eq ? 1 : 0;
        case "==": return eq ? 1 : 0;
        default: return eq ? 0 : 1;
      }
    }
    return l;
  };
  // sum := term (('+'|'-') term)*
  const sum = (): number => {
    let v = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  // term := unary (('*'|'/'|'%') unary)*
  const term = (): number => {
    let v = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (toks[p++] as { v: string }).v;
      const r = unary();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  // unary := ('-'|'+'|'!') unary | power
  const unary = (): number => {
    if (isOp("!")) { p += 1; return unary() ? 0 : 1; }
    if (isOp("-")) { p += 1; return -unary(); }
    if (isOp("+")) { p += 1; return unary(); }
    return power();
  };
  // power := atom ('^' unary)?   （右结合）
  const power = (): number => {
    const base = atom();
    if (isOp("^")) { p += 1; return Math.pow(base, unary()); }
    return base;
  };
  const atom = (): number => {
    const k = toks[p++];
    if (!k) throw new Error("eof");
    if (k.t === "num") return k.v;
    if (k.t === "op" && k.v === "(") {
      const v = expr();
      if (!isOp(")")) throw new Error(")");
      p += 1;
      return v;
    }
    if (k.t === "id") {
      if (isOp("(")) {
        const fn = Object.prototype.hasOwnProperty.call(FUNCS, k.v) ? FUNCS[k.v] : undefined;
        if (!fn) throw new Error(`fn ${k.v}`);
        p += 1;
        const args: number[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) { p += 1; args.push(expr()); }
        }
        if (!isOp(")")) throw new Error(")");
        p += 1;
        return fn(...args);
      }
      if (Object.prototype.hasOwnProperty.call(vars, k.v)) return vars[k.v];
      if (Object.prototype.hasOwnProperty.call(CONSTS, k.v)) return CONSTS[k.v];
      throw new Error(`var ${k.v}`);
    }
    throw new Error("token");
  };

  try {
    const v = expr();
    if (p !== toks.length) return null;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
