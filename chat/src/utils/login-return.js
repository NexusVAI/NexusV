// 登录后回跳：需要登录的页面跳到 /chat/?next=<站内路径>，聊天页登录成功后回到那里。
// next 来自地址栏，任何人都能构造，所以只放行同源路径（拒绝 //evil.com、/\evil.com 这类开放跳转）。
export const LOGIN_RETURN_PARAM = "next";

function normalizePath(pathname) {
  return pathname.replace(/\/index(\.html)?$/i, "/").replace(/\.html$/i, "");
}

/** 返回可跳转的 path+search+hash；不可用（空、跨域、就是当前页）返回 null。 */
export function resolveLoginReturnTarget(raw, currentHref) {
  if (typeof raw !== "string" || !raw) return null;
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return null;
  let current;
  let target;
  try {
    current = new URL(currentHref);
    target = new URL(raw, current.origin);
  } catch {
    return null;
  }
  if (target.origin !== current.origin) return null;
  if (
    normalizePath(target.pathname) === normalizePath(current.pathname) &&
    !target.search &&
    !target.hash
  ) {
    return null;
  }
  return target.pathname + target.search + target.hash;
}

/** 去掉地址栏里的 next 参数后的地址（path+search+hash）。 */
export function stripLoginReturnParam(currentHref) {
  const url = new URL(currentHref);
  url.searchParams.delete(LOGIN_RETURN_PARAM);
  return url.pathname + url.search + url.hash;
}
