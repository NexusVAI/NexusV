export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function stripTags(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Attribute map from the inside of a start tag: `a="1" b='2' c` → {a:"1", b:"2", c:""}. */
export function parseAttrs(src) {
  const out = {};
  const re = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src || ""))) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

/** "/api/docs/quickstart" and "/api/docs/quickstart/" compare equal; hash/query ignored. */
export function normUrl(u) {
  let s = String(u || "").split("#")[0].split("?")[0];
  if (!s.endsWith("/") && !/\.[a-z0-9]+$/i.test(s)) s += "/";
  return s;
}
