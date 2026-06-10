# NexusV 全仓库安全审计报告

> 审计时间：2026-06-10  
> 审计范围：NexusVAI/NexusV 仓库全部前端代码（后端闭源，不在仓库内，但对前端暴露的接口和凭据一并分析）

---

## 一、严重 / 高危问题

### 1. HTML 预览 iframe 沙箱权限过大（XSS → 同源攻击）

**文件**：`chat/index.html:2721`

```html
<iframe id="htmlPreviewFrame"
  sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
  ...>
```

`allow-scripts` + `allow-same-origin` 同时存在时，iframe 内的脚本可以**移除 sandbox 属性并获得与父页面完全相同的权限**。AI 模型生成的 HTML 代码若含恶意脚本，攻击者可通过此 iframe 窃取用户的 Supabase access_token（存于 `localStorage`）、调用任意后端 API、修改页面 DOM 等。

**建议**：移除 `allow-same-origin`，改为 blob URL + `sandbox="allow-scripts allow-popups"` 即可满足预览需求；或使用独立子域名 iframe 隔离。

---

### 2. 多个官网页面缺少 Content-Security-Policy（CSP）

以下 **7 个页面** 完全没有 CSP meta 标签：

| 页面 | 风险 |
|------|------|
| `index.html` | 官网首页 |
| `about.html` | 关于页 |
| `article.html` | 文章页 |
| `privacy.html` | 隐私协议页 |
| `terms.html` | 服务条款页 |
| `research.html` | 研究页 |
| `celebrate-rules.html` | 庆典规则页 |

`chat/` 子目录下的核心页面已有 CSP（较好），但这些官网页面缺失 CSP 意味着：
- 一旦存在 XSS，攻击者可注入任意外部脚本
- 无法阻止数据外泄到第三方域名

**建议**：统一添加 CSP 策略，至少限制 `script-src`、`connect-src`、`object-src 'none'`、`frame-ancestors 'none'`。

---

### 3. `js/article.js` 中 `innerHTML` 使用存在 XSS 风险

`js/article.js:2231` 通过 `template.innerHTML = html` 解析从 API 获取的文章内容。虽然后续使用了自定义 `sanitizeArticleNode()` 白名单过滤器，但：
- 该过滤器 **手写**，未使用 DOMPurify 等经过大量安全审计的成熟库
- `ARTICLE_ALLOWED_TAGS` 白名单中如果遗漏了危险属性（如 `onerror`、`onload` 等事件处理器），就会导致 XSS
- `isSafeArticleHref()` 的实现需要额外审查以确保覆盖 `javascript:` 等伪协议

**建议**：引入 DOMPurify 替代手写 sanitizer，或至少对现有 sanitizer 补充属性白名单过滤。

---

### 4. `chat/cancri_chat.js` 中 CSP 指令含 `'unsafe-eval'`

```
script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net ...
```

`unsafe-eval` 允许 `eval()`、`new Function()` 等动态代码执行。虽然 chat 应用可能依赖某些库需要此权限（如 Monaco Editor / KaTeX），但这大幅削弱了 CSP 对 XSS 的防护能力。

**建议**：排查哪些库真正需要 `eval`，尝试使用 `'wasm-unsafe-eval'` 或其他更窄的替代方案。

---

## 二、中等风险问题

### 5. Supabase 直连 URL 硬编码为 fallback

**文件**：`js/fingerprint.js:30`、`js/telemetry.js:31`

```js
var SUPABASE_URL = window.__SUPABASE_URL__ || 'https://diusqgphvybnzazgopor.supabase.co';
```

虽然 `cancri_config.js` 已将主 URL 切换到 `chat.nexusvai.xyz`（Cloudflare 边缘网关），但这两个文件中仍有硬编码的 Supabase 直连地址作为 fallback。

**影响**：
- 如果 `cancri_config.js` 未加载（非 chat 页面），前端会绕过 Cloudflare 网关直连 Supabase，失去 WAF/限流保护
- 暴露了真实的 Supabase 项目 URL

**建议**：移除直连 fallback，确保所有页面都先加载 `cancri_config.js`；或将 fallback 也改为网关地址。

---

### 6. 客户端管理后台鉴权仅依赖前端检查

`chat/api/admin-*.js` 中多处使用以下模式：

```js
if (!check.ok || !check.data?.is_admin) { /* 跳转走 */ }
```

虽然后端（chat-gateway）理应也做 ADMIN_USER_IDS 校验，但前端代码（`admin.html`、`admin_dashboard.html` 等）及其 JS 文件**对外完全可见**，任何人可以直接阅读管理后台的 API 调用逻辑和接口路径。

**建议**：
- 确认后端对所有 admin 端点做了独立的服务端鉴权（不信任 `is_admin` 前端字段）
- 考虑将 admin 页面从公开仓库中移除，或拆分到独立的私有部署

---

### 7. `_anti-debug.js` 安全性为零

该脚本通过屏蔽 F12、右键菜单、检测 DevTools 窗口大小差异来"保护"前端代码。如注释中所述，这**完全无法阻止**任何人查看前端源码：

- 所有 JS 文件可通过直接下载获得
- 浏览器扩展、代理抓包等都可轻松绕过
- 该脚本反而可能**误伤**正常用户调试体验

**建议**：移除此脚本。前端代码既然已开源，反调试措施毫无意义，还会劣化用户体验。

---

### 8. `desktop-login.html` 的 OAuth 回调验证较宽松

`desktop-login.html:222-228` 校验回调 URL：

```js
function isValidCb(url) {
  const u = new URL(url);
  return u.protocol === "http:" && 
    (u.hostname === "127.0.0.1" || u.hostname === "localhost") && 
    u.pathname === "/cb";
}
```

此验证**仅限 localhost**，风险较低，但：
- 未限制端口范围（任何本地端口均可接收 token）
- 本地恶意程序可能监听某端口接收 access_token + refresh_token

**建议**：考虑引入 PKCE 或一次性 state 参数绑定桌面端会话。

---

### 9. 缺少 LICENSE 文件

仓库声称"开源"但没有 LICENSE 文件。在没有明确许可的情况下，默认版权法意味着**无人有权复制、修改或分发代码**，与"开源"的宣传相矛盾。

**建议**：添加明确的 LICENSE 文件（如 MIT、Apache 2.0 等）。如果前端开源、后端闭源，在 README 和 LICENSE 中明确说明。

---

## 三、低风险 / 改进建议

### 10. `base64.txt` 包含一张裸 JPEG Base64

该文件是一张图片的 Base64 编码（约 6KB），以 `data:image/jpeg;base64,...` 开头。虽然不是安全凭据，但：
- 文件名不具有可读性，用途不明
- 增加仓库体积且无 `.gitattributes` 追踪

**建议**：将其转为实际图片文件放入 `Logo/` 目录，或注释说明用途。

---

### 11. `training_metrics.csv` / `training_metrics_clean.csv` 不应在前端仓库

两个 CSV 文件（共 ~72KB）看起来是模型训练数据。它们与前端代码无关，不应出现在前端仓库中。

**建议**：迁移至文档仓库或删除。

---

### 12. `main.tex` LaTeX 论文文件

该文件是一篇学术论文的 LaTeX 源码。与前端代码无关。

**建议**：迁移至文档仓库或删除。

---

### 13. `liquid-glass-react-master/` 直接包含第三方库源码

该目录是一个 React 库的完整源码拷贝（非 npm 依赖），无版本管理，可能存在供应链安全风险。

**建议**：通过 CDN 或包管理器引入，或至少在目录中注明来源和版本。

---

### 14. `chat/code/` 目录包含大量 bundled assets（~19MB）

`chat/code/assets/` 包含多个压缩的 JS bundle（如 Monaco Editor 的 worker 文件），文件名含 hash。这些文件：
- 不应直接提交到 Git（应由 CI/CD 构建产出）
- 增加仓库体积，导致 clone 缓慢

**建议**：将 build artifacts 添加到 `.gitignore`，通过 CI 构建和部署。

---

### 15. 外部脚本缺少 SRI（Subresource Integrity）

`chat/turnstile_check.html` 中加载 Cloudflare Turnstile 脚本时缺少 `integrity` 属性：

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

部分 HTML 页面已对 Supabase SDK 使用了 SRI（如 `desktop-login.html`），但不一致。

**建议**：所有外部脚本统一添加 SRI hash。

---

### 16. README 中 API 示例使用旧的直连地址

旧 README 中 curl 示例使用 `diusqgphvybnzazgopor.supabase.co` 直连地址，与当前 `chat.nexusvai.xyz` 网关地址不一致。

**建议**：已在新 README 中修复为 `chat.nexusvai.xyz`。

---

### 17. 项目结构描述中引用了不存在的目录

旧 README 提到 `docs/` 和 `css/后端/supabase/functions/` 目录，实际仓库中均不存在。

**建议**：已在新 README 中修正。

---

## 四、总结

| 等级 | 数量 | 关键问题 |
|------|------|----------|
| **严重/高危** | 4 | iframe 沙箱逃逸、多页面缺失 CSP、手写 sanitizer、`unsafe-eval` |
| **中等** | 5 | Supabase 直连 fallback、admin 页面暴露、反调试无效、桌面登录回调宽松、缺少 LICENSE |
| **低风险/改进** | 8 | 无关文件、第三方库管理、SRI 不一致、README 错误等 |

### 最高优先级修复建议

1. **修复 iframe sandbox**：移除 `allow-same-origin` 或使用独立域名隔离
2. **为所有页面添加 CSP**
3. **引入 DOMPurify** 替代手写 HTML sanitizer
4. **添加 LICENSE 文件**
5. **移除 `_anti-debug.js`**（或至少移出开源仓库）
