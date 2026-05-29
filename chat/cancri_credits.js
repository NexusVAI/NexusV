// cancri_credits.js
//
// 2026-05-29 积分化（display-only re-denomination）。
//
// 背景：用户面板一直按「原始 token」显示消耗（已用 X万 / 2000万 tokens），
// 配上 3x~80x 的模型倍率，一次 IDE 滚雪球对话就扣几百万，用户看到「几千万没了」
// 直接吓退、坏口碑（见 tasks/lessons.md 两起 Pro 光速消耗事故）。
//
// 本文件只做「显示层换算」：后端一切仍按 token 存储/计费（零迁移、零计费风险），
// 前端把 token 数除以 TOKENS_PER_CREDIT 显示成「积分」。
//
//   1 积分 = 1 万 token
//     Pro      2000万 token → 2000 积分
//     Pro+     8000万 token → 8000 积分
//     Pro Max  3亿   token → 30000 积分
//     免费共享池 1亿 token → 10000 积分
//
// 全站唯一换算来源。任何页面（chat 额度面板 / pricing / orders / api_keys /
// api_docs / api_models）显示「余额 / 配额 / 扣减」一律走这里，禁止各页自己
// 再写一份除法常量（lessons.md 多次踩过「两处手工同步」漂移坑）。
//
// 注意：进度条百分比是无量纲的，不需要换算；真实 token 收发明细（输入/输出/
// 缓存命中遥测）保留 token 口径，不要套积分（那是 I/O 计数，不是计费单位）。

(function () {
  'use strict';

  var TOKENS_PER_CREDIT = 10000;
  var UNIT = '积分';

  function toCredits(tokens) {
    var n = Number(tokens);
    if (!isFinite(n)) return 0;
    return n / TOKENS_PER_CREDIT;
  }

  function trimZeros(s) {
    if (s.indexOf('.') === -1) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
  }

  // 把 token 数格式化成积分数字（不带单位）。
  //   >= 100      → 整数 + 千分位（2,000 / 30,000）
  //   1 ~ 100     → 1 位小数去尾零（12.5 / 8）
  //   0 ~ 1       → 2 位小数去尾零（0.6 / 0.05）
  function num(tokens) {
    var c = toCredits(tokens);
    var neg = c < 0;
    c = Math.abs(c);
    var s;
    if (c === 0) {
      s = '0';
    } else if (c < 1) {
      s = trimZeros(c.toFixed(2));
    } else if (c < 100) {
      s = trimZeros(c.toFixed(1));
    } else {
      s = Math.round(c).toLocaleString('en-US');
    }
    return (neg ? '-' : '') + s;
  }

  // 带「积分」单位的完整字符串，如 "2,000 积分"。
  function fmt(tokens) {
    return num(tokens) + ' ' + UNIT;
  }

  // 直接把「积分数」格式化（用于已经是积分的数值，不再除换算系数）。
  function fmtCredits(credits) {
    return num(Number(credits) * TOKENS_PER_CREDIT);
  }

  window.CancriCredits = {
    TOKENS_PER_CREDIT: TOKENS_PER_CREDIT,
    UNIT: UNIT,
    toCredits: toCredits,
    num: num,
    fmt: fmt,
    fmtCredits: fmtCredits,
  };
})();
