# NexusV

> 一个复刻 OpenAI 官网风格的前端演示项目，基于纯静态 HTML/CSS/JavaScript 构建。

![GitHub language stats](https://img.shields.io/github/languages/top/yourusername/NexusV)  ![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-deployed-brightgreen)

NexusV 是一个轻量级的静态网页项目，旨在模拟 OpenAI 官网界面的外观和基础交互。所有页面均为纯前端实现，可通过 GitHub Pages 快速部署和访问，适合作为学习、演示或 API 集成的起点。

---

## 功能特性


- 🎨 **自定义样式** – 完全使用 CSS 手写样式，无第三方 UI 库依赖
- 🔍 **搜索功能示例** – `search.js` 提供前端搜索过滤的参考实现
- 📄 **多页面支持** – 包含 `index.html`（主页）和 `article.html`（文章展示页）
- ⚙️ **GitHub Actions 自动部署** – 通过 `static.yml` 工作流自动构建并发布到 GitHub Pages

---

## 在线演示

项目已部署到 GitHub Pages，您可以通过以下地址访问：

👉 [https://nexusvai.github.io/NexusV/]


---

## 技术栈

- **HTML5** – 页面结构
- **CSS3** – 样式布局与动画
- **JavaScript (ES6)** – 交互逻辑
- **GitHub Actions** – 持续集成与部署

语言占比：
- JavaScript: ≈60%
- CSS: ≈30%
- HTML: ≈10%



## 快速开始

### 本地运行

1. 克隆仓库：
   ```bash
   git clone https://github.com/yourusername/NexusV.git
   cd NexusV
   ```

2. 使用任意 HTTP 服务器预览（例如 Python 的 `http.server`）：
   ```bash
   # Python 3
   python -m http.server 8000
   ```
   打开浏览器访问 `http://localhost:8000` 即可。

### 部署到 GitHub Pages

项目已配置 GitHub Actions 自动部署，每次推送到 `main` 分支都会触发构建并更新 Pages。您只需在仓库 Settings > Pages 中将 Source 设置为 “GitHub Actions” 即可。

如需手动部署，也可以将根目录文件上传至任意静态托管服务。

---

## 自定义与扩展

- **修改样式**：编辑 `style.css` 即可调整主题颜色、字体等。
- **添加新页面**：创建新的 `.html` 文件，并引入 `style.css` 和必要的脚本。
- **接入真实 API**：在 `script.js` 中通过 `fetch` 调用后端接口（注意跨域和 API 密钥安全）。

---

## 贡献

欢迎提交 Issue 或 Pull Request 来改进项目。在贡献之前，请确保您的代码风格与现有代码保持一致，并尽可能添加注释。

---

## 许可证

本项目采用 MIT 许可证。详情请参见 [LICENSE](LICENSE) 文件。

---


