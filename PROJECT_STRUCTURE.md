# NexusV 仓库结构说明

本文档用于快速定位 NexusV 前端仓库中的主要目录、页面和辅助文件，避免把依赖、构建产物或临时文件误提交到仓库。

## 根目录

| 路径 | 说明 |
| --- | --- |
| `index.html` | 官网首页。 |
| `about.html`、`research.html`、`article.html`、`pricing.html` | 官网内容页与价格页。 |
| `privacy.html`、`terms.html` | 隐私协议与服务条款页面。 |
| `style.css` | 早期或全局样式入口。新页面样式优先放在 `css/` 下。 |
| `script.js`、`search.js` | 根目录脚本；公共模块优先放在 `js/` 下。 |
| `README.md` | 项目介绍、快速开始和贡献说明。 |
| `SECURITY_AUDIT.md` | 安全审计与安全相关记录。 |
| `vercel.json`、`CNAME` | 部署与自定义域名配置。 |

## 前端资源目录

| 路径 | 说明 |
| --- | --- |
| `css/` | 官网和公共页面样式，按页面或组件拆分。 |
| `js/` | 官网公共脚本、组件、主题、国际化、评论、搜索等。 |
| `js/vendor/` | 第三方前端库的本地副本。更新时请记录来源和版本。 |
| `Logo/` | 品牌图、文章配图、视频、PDF 等静态媒体资源。 |

## Chat 应用

| 路径 | 说明 |
| --- | --- |
| `chat/` | NexusV 对话应用及其静态资源。 |
| `chat/api/` | API 平台、管理后台和相关页面脚本。 |
| `chat/shop/` | 商店、订单与管理页面。 |
| `chat/assets/`、`chat/img/`、`chat/fonts/` | Chat 应用专用静态资源。 |
| `chat/styles/`、`chat/js/` | Chat 应用拆分出的样式和脚本。 |

## 嵌入的第三方示例

| 路径 | 说明 |
| --- | --- |
| `liquid-glass-react-master/` | Liquid Glass React 组件源码及示例。 |
| `liquid-glass-react-master/liquid-glass-example/` | Next.js 示例应用。依赖目录 `node_modules/` 不应提交。 |

## 提交前检查清单

1. 确认没有提交 `node_modules/`、`.next/`、`dist/`、日志、环境变量文件或本地 IDE 配置。
2. 如果新增公开配置，请确认其中仅包含可公开的客户端公钥或 URL。
3. 修改静态页面后，建议用本地静态服务器检查页面是否能正常加载：

   ```bash
   python -m http.server 8080
   ```

4. 修改 `liquid-glass-react-master/` 时，可在该目录运行对应的 `npm` 脚本进行构建或类型检查。
