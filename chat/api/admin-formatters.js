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
    fmtIpGeo,
  };
})(window);