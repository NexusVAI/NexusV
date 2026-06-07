(function (window) {
  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("zh-CN", { hour12: false });
    } catch {
      return String(iso);
    }
  }

  function fmtArr(v) {
    if (v == null) return "—";
    if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(", ") : "—";
    return String(v);
  }

  function fmtScreen(s) {
    if (!s || typeof s !== "object") return "—";
    const w = s.w || 0, h = s.h || 0;
    const ratio = s.ratio ? "@" + Number(s.ratio).toFixed(2).replace(/\.?0+$/, "") + "x" : "";
    const depth = s.depth ? " · " + s.depth + "bit" : "";
    return (w && h) ? (w + "\u00d7" + h + ratio + depth) : "—";
  }

  function fmtAgeDays(days) {
    if (days == null || days < 0) return "—";
    if (days === 0) return "今天注册";
    if (days < 7) return days + " 天";
    if (days < 30) return Math.floor(days / 7) + " 周";
    if (days < 365) return Math.floor(days / 30) + " 个月";
    return Math.floor(days / 365) + " 年";
  }

  function fmtTokens(n) {
    if (n == null) return "—";
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  }

  // 把后端 token 数格式化为「X 积分」（1 积分 = 1 万 token）。
  function fmtCreditsFromTokens(tokens) {
    if (window.CancriCredits) return window.CancriCredits.fmt(tokens);
    var c = (Number(tokens) || 0) / 10000;
    return (Math.round(c * 10) / 10).toLocaleString("en-US") + " 积分";
  }

  // 管理员输入积分数 → 后端 delta_tokens。
  function creditsToTokens(credits) {
    if (window.CancriCredits) return window.CancriCredits.toTokens(credits);
    return Math.round(Number(credits) * 10000);
  }

  function fmtIpGeo(geo) {
    if (!geo) return "";
    const parts = [];
    const country = geo.country_name || geo.country;
    if (country) parts.push(country);
    if (geo.region && geo.region !== country) parts.push(geo.region);
    if (geo.city && geo.city !== geo.region) parts.push(geo.city);
    const loc = parts.join(" · ");
    const isp = geo.isp || geo.org;
    return loc + (isp ? "（" + isp + "）" : "");
  }

  window.AdminFormatters = {
    fmtTime,
    fmtArr,
    fmtScreen,
    fmtAgeDays,
    fmtTokens,
    fmtCreditsFromTokens,
    creditsToTokens,
    fmtIpGeo,
  };
})(window);
