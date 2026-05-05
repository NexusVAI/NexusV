# NexusV - OpenAI 复刻版

> 这不是一个模板，这是一个有灵魂的作品。

[English](#english-version) | [中文](#中文版本)

---

## 中文版本

### 🌟 项目简介

NexusV 是一个精心打造的 OpenAI.com 复刻项目。这不仅仅是界面的模仿，而是对现代 AI 应用用户体验的深度理解和实践。每一个像素、每一行代码都承载着对优秀设计的热爱。

### ✨ 核心特性

- **极致的UI/UX设计** - 完美还原 OpenAI 现代简约的设计风格
- **响应式布局** - 完美适配桌面、平板和移动设备
- **流畅的交互** - 精心打磨的用户交互体验
- **高性能** - 优化的前端代码，快速加载和流畅动画
- **易于部署** - 使用 GitHub Pages 一键部署

### 🛠️ 技术栈

| 技术 | 占比 | 用途 |
|------|------|------|
| **JavaScript** | 79.8% | 核心交互逻辑与动画 |
| **CSS** | 13.5% | 样式设计与响应式布局 |
| **HTML** | 6.5% | 页面结构 |
| **TeX** | 0.2% | 数学公式渲染 |

项目采用纯前端技术栈，无需后端依赖，确保最大的部署灵活性。

### 📦 项目结构

```
NexusV/
├── index.html              # 主页面入口
├── css/                    # 样式文件
│   ├── style.css          # 主样式表
│   └── responsive.css     # 响应式设计
├── js/                    # JavaScript 脚本
│   ├── main.js           # 核心逻辑
│   └── interactions.js    # 交互模块
├── chat AI/               # AI 对话相关功能
│   ├── index.html        # 对话界面
│   └── styles/           # 对话样式
├── status-page/           # 服务状态监控页面
└── README.md             # 项目文档

```

### 🚀 快速开始

#### 1. 本地开发

```bash
# 克隆仓库
git clone https://github.com/NexusVAI/NexusV.git
cd NexusV

# 使用 Python 简单 HTTP 服务器（推荐）
python -m http.server 8000

# 或使用 Node.js http-server
npx http-server

# 打开浏览器
# 访问 http://localhost:8000
```

#### 2. 部署到 GitHub Pages

- 推送代码到 GitHub 仓库
- 在仓库 **Settings > Pages** 中启用 GitHub Pages
- 选择部署分支（通常是 `main`）
- 稍等片刻，你的项目就会在 `https://username.github.io/NexusV` 上线

#### 3. 自定义配置

编辑项目根目录的配置文件，自定义：
- 页面标题和描述
- 主题颜色
- API 端点设置
- 功能模块开关

### 📝 主要功能模块

#### Chat AI 对话模块
- 仿 OpenAI ChatGPT 的对话界面
- 支持流式响应显示
- Markdown 渲染支持
- 代码高亮显示

#### 状态监控页面
- 简约的服务状态展示
- 实时监控服务健康状态
- 支持多个服务并行显示
- 自动刷新机制

### 🎨 设计理念

这个项目遵循以下设计原则：

1. **简约而不简单** - 极简的视觉设计，但功能完整
2. **用户至上** - 每个交互都经过仔细考虑
3. **性能优先** - 轻量级代码，快速响应
4. **可访问性** - 支持各种屏幕尺寸和设备
5. **易于维护** - 清晰的代码结构，方便二次开发

### 💡 使用场景

- 🎓 学习现代 Web 设计最佳实践
- 🏗️ 作为 AI 应用的前端模板
- 📱 创建自己的 AI 聊天应用
- 🌐 搭建展示页面或文档站点

### 🔧 配置说明

#### 修改 API 端点

编辑 `js/main.js`：

```javascript
const API_ENDPOINT = 'https://your-api-endpoint.com/api';
const API_KEY = 'your-api-key';
```

#### 自定义主题色

编辑 `css/style.css` 的 CSS 变量：

```css
:root {
  --primary-color: #10a37f;
  --bg-color: #ffffff;
  --text-color: #0d0d0d;
  --border-color: #d1d5db;
}
```

### 📸 功能预览

- ✅ 精美的登陆界面
- ✅ 实时对话交互
- ✅ 流式响应渲染
- ✅ 深色/浅色主题切换
- ✅ 对话历史管理
- ✅ 分享对话功能
- ✅ 完整的移动适配

### 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

### 🌟 项目进度

| 功能模块 | 状态 | 说明 |
|---------|------|------|
| 主页面 | ✅ 完成 | 响应式布局，完美适配 |
| 对话界面 | ✅ 完成 | 支持流式响应 |
| 状态监控 | ✅ 完成 | 实时服务监控 |
| 用户认证 | 🚀 规划中 | 计划添加用户系统 |
| 数据持久化 | 🚀 规划中 | 本地存储支持 |

### 📞 联系方式

- 📧 Email: support@nexusai.com
- 🐛 Bug 报告: [Issues](https://github.com/NexusVAI/NexusV/issues)
- 💬 讨论: [Discussions](https://github.com/NexusVAI/NexusV/discussions)

---

## English Version

### 🌟 Project Introduction

NexusV is a meticulously crafted recreation of OpenAI.com. This is not merely a UI mockup, but a deep understanding and practice of modern AI application user experience. Every pixel and every line of code carries a passion for excellent design.

### ✨ Core Features

- **Exquisite UI/UX Design** - Perfect reproduction of OpenAI's modern minimalist design style
- **Responsive Layout** - Seamlessly adapts to desktops, tablets, and mobile devices
- **Smooth Interactions** - Carefully refined user interaction experience
- **High Performance** - Optimized frontend code with fast loading and smooth animations
- **Easy Deployment** - Deploy with one click using GitHub Pages

### 🛠️ Technology Stack

| Technology | Percentage | Purpose |
|------------|-----------|---------|
| **JavaScript** | 79.8% | Core interaction logic and animations |
| **CSS** | 13.5% | Style design and responsive layout |
| **HTML** | 6.5% | Page structure |
| **TeX** | 0.2% | Mathematical formula rendering |

The project uses a pure frontend technology stack with no backend dependencies, ensuring maximum deployment flexibility.

### 📦 Project Structure

```
NexusV/
├── index.html              # Main page entry
├── css/                    # Style files
│   ├── style.css          # Main stylesheet
│   └── responsive.css     # Responsive design
├── js/                    # JavaScript scripts
│   ├── main.js           # Core logic
│   └── interactions.js    # Interaction modules
├── chat AI/               # AI chat functionality
│   ├── index.html        # Chat interface
│   └── styles/           # Chat styles
├── status-page/           # Service status monitoring page
└── README.md             # Project documentation
```

### 🚀 Quick Start

#### 1. Local Development

```bash
# Clone the repository
git clone https://github.com/NexusVAI/NexusV.git
cd NexusV

# Using Python Simple HTTP Server (Recommended)
python -m http.server 8000

# Or using Node.js http-server
npx http-server

# Open your browser
# Visit http://localhost:8000
```

#### 2. Deploy to GitHub Pages

- Push your code to GitHub repository
- Go to **Settings > Pages** in your repository
- Select the deployment branch (usually `main`)
- Wait a moment and your project will be live at `https://username.github.io/NexusV`

#### 3. Custom Configuration

Edit the configuration file in the project root to customize:
- Page title and description
- Theme colors
- API endpoint settings
- Feature module switches

### 📝 Main Feature Modules

#### Chat AI Module
- Chat interface mimicking OpenAI ChatGPT
- Support for streaming response display
- Markdown rendering support
- Code syntax highlighting

#### Status Monitoring Page
- Minimalist service status display
- Real-time service health monitoring
- Support for multiple services in parallel
- Automatic refresh mechanism

### 🎨 Design Philosophy

This project follows these design principles:

1. **Simplicity with Substance** - Minimalist visual design with complete functionality
2. **User-First** - Every interaction is carefully considered
3. **Performance Priority** - Lightweight code with fast response times
4. **Accessibility** - Support for various screen sizes and devices
5. **Easy Maintenance** - Clear code structure for easy secondary development

### 💡 Use Cases

- 🎓 Learn modern web design best practices
- 🏗️ Use as a template for AI application frontends
- 📱 Create your own AI chat application
- 🌐 Build showcase pages or documentation sites

### 🔧 Configuration Guide

#### Modify API Endpoint

Edit `js/main.js`:

```javascript
const API_ENDPOINT = 'https://your-api-endpoint.com/api';
const API_KEY = 'your-api-key';
```

#### Customize Theme Colors

Edit CSS variables in `css/style.css`:

```css
:root {
  --primary-color: #10a37f;
  --bg-color: #ffffff;
  --text-color: #0d0d0d;
  --border-color: #d1d5db;
}
```

### 📸 Feature Preview

- ✅ Beautiful login interface
- ✅ Real-time chat interaction
- ✅ Streaming response rendering
- ✅ Dark/Light theme switching
- ✅ Chat history management
- ✅ Share conversation feature
- ✅ Complete mobile adaptation

### 🤝 Contributing

We welcome Issues and Pull Requests!

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

### 🌟 Project Status

| Feature Module | Status | Description |
|---|---|---|
| Main Page | ✅ Complete | Responsive layout, perfect adaptation |
| Chat Interface | ✅ Complete | Supports streaming responses |
| Status Monitoring | ✅ Complete | Real-time service monitoring |
| User Authentication | 🚀 Planning | User system coming soon |
| Data Persistence | 🚀 Planning | Local storage support planned |

### 📞 Contact

- 📧 Email: support@nexusai.com
- 🐛 Bug Reports: [Issues](https://github.com/NexusVAI/NexusV/issues)
- 💬 Discussions: [Discussions](https://github.com/NexusVAI/NexusV/discussions)

---

<div align="center">

### ⭐ Star History

[![Star History Chart](https://api.star-history.com/chart?repos=NexusVAI/NexusV&type=date)](https://www.star-history.com/?repos=NexusVAI%2FNexusV&type=date)

Made with ❤️ by [NexusVAI](https://github.com/NexusVAI)

</div>
