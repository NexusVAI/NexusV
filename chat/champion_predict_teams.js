/* 2026 FIFA World Cup 48 支参赛队 · 数据来源 FIFA 官方名单（2026-06） */
(function (root, factory) {
  var teams = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = teams;
  } else {
    root.WC2026_TEAMS = teams;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return [
    { code: "CAN", name: "加拿大", conf: "HOST", flag: "ca" },
    { code: "MEX", name: "墨西哥", conf: "HOST", flag: "mx" },
    { code: "USA", name: "美国", conf: "HOST", flag: "us" },
    { code: "AUS", name: "澳大利亚", conf: "AFC", flag: "au" },
    { code: "IRQ", name: "伊拉克", conf: "AFC", flag: "iq" },
    { code: "IRN", name: "伊朗", conf: "AFC", flag: "ir" },
    { code: "JPN", name: "日本", conf: "AFC", flag: "jp" },
    { code: "JOR", name: "约旦", conf: "AFC", flag: "jo" },
    { code: "KOR", name: "韩国", conf: "AFC", flag: "kr" },
    { code: "QAT", name: "卡塔尔", conf: "AFC", flag: "qa" },
    { code: "SAU", name: "沙特阿拉伯", conf: "AFC", flag: "sa" },
    { code: "UZB", name: "乌兹别克斯坦", conf: "AFC", flag: "uz" },
    { code: "ALG", name: "阿尔及利亚", conf: "CAF", flag: "dz" },
    { code: "CPV", name: "佛得角", conf: "CAF", flag: "cv" },
    { code: "COD", name: "刚果（金）", conf: "CAF", flag: "cd" },
    { code: "CIV", name: "科特迪瓦", conf: "CAF", flag: "ci" },
    { code: "EGY", name: "埃及", conf: "CAF", flag: "eg" },
    { code: "GHA", name: "加纳", conf: "CAF", flag: "gh" },
    { code: "MAR", name: "摩洛哥", conf: "CAF", flag: "ma" },
    { code: "SEN", name: "塞内加尔", conf: "CAF", flag: "sn" },
    { code: "RSA", name: "南非", conf: "CAF", flag: "za" },
    { code: "TUN", name: "突尼斯", conf: "CAF", flag: "tn" },
    { code: "CUW", name: "库拉索", conf: "CONCACAF", flag: "cw" },
    { code: "HAI", name: "海地", conf: "CONCACAF", flag: "ht" },
    { code: "PAN", name: "巴拿马", conf: "CONCACAF", flag: "pa" },
    { code: "ARG", name: "阿根廷", conf: "CONMEBOL", flag: "ar" },
    { code: "BRA", name: "巴西", conf: "CONMEBOL", flag: "br" },
    { code: "COL", name: "哥伦比亚", conf: "CONMEBOL", flag: "co" },
    { code: "ECU", name: "厄瓜多尔", conf: "CONMEBOL", flag: "ec" },
    { code: "PAR", name: "巴拉圭", conf: "CONMEBOL", flag: "py" },
    { code: "URU", name: "乌拉圭", conf: "CONMEBOL", flag: "uy" },
    { code: "NZL", name: "新西兰", conf: "OFC", flag: "nz" },
    { code: "AUT", name: "奥地利", conf: "UEFA", flag: "at" },
    { code: "BEL", name: "比利时", conf: "UEFA", flag: "be" },
    { code: "BIH", name: "波黑", conf: "UEFA", flag: "ba" },
    { code: "CRO", name: "克罗地亚", conf: "UEFA", flag: "hr" },
    { code: "CZE", name: "捷克", conf: "UEFA", flag: "cz" },
    { code: "ENG", name: "英格兰", conf: "UEFA", flag: "gb-eng" },
    { code: "FRA", name: "法国", conf: "UEFA", flag: "fr" },
    { code: "GER", name: "德国", conf: "UEFA", flag: "de" },
    { code: "NED", name: "荷兰", conf: "UEFA", flag: "nl" },
    { code: "NOR", name: "挪威", conf: "UEFA", flag: "no" },
    { code: "POR", name: "葡萄牙", conf: "UEFA", flag: "pt" },
    { code: "SCO", name: "苏格兰", conf: "UEFA", flag: "gb-sct" },
    { code: "ESP", name: "西班牙", conf: "UEFA", flag: "es" },
    { code: "SWE", name: "瑞典", conf: "UEFA", flag: "se" },
    { code: "SUI", name: "瑞士", conf: "UEFA", flag: "ch" },
    { code: "TUR", name: "土耳其", conf: "UEFA", flag: "tr" },
  ];
});
