<p align="center">
  <img src="Logo/Cancri.png" alt="NexusV" width="96">
</p>

<h1 align="center">NexusV</h1>

<p align="center">
  聚合主流大语言模型的 AI 对话平台 — 一个界面，接入 30+ 模型，自由切换、横向对比。
</p>

<p align="center">
  <a href="https://nexusvai.github.io/NexusV/">官网</a> ·
  <a href="https://nexusvai.github.io/NexusV/chat/">对话</a> ·
  <a href="https://nexusvai.github.io/NexusV/chat/api_docs.html">API 文档</a> ·
  <a href="https://nexusvai.github.io/NexusV/api_models.html">模型广场</a>
</p>

---

## 简介

NexusV 是一个非商业开源项目，旨在为用户提供统一的多模型 AI 对话体验。通过一个简洁的 Web 界面，您可以同时访问来自不同供应商的数十个大语言模型，在同一会话中切换模型、横向比较输出质量。

**当前接入的上游模型供应方：**

OpenAI · Anthropic · DeepSeek · 阿里云百炼 · 魔搭社区 · 智谱 · MiniMax · 月之暗面 · Mistral · Grok · Google Gemini · 火山引擎（豆包） · 阶跃星辰 · 商汤 · 以及更多第三方中转服务

## 功能特性

- **多模型对话** — 在同一界面与 30+ 个模型对话，支持文本、图像理解、代码生成
- **模型切换** — 会话中途切换模型，横向比较不同模型的回答质量
- **竞技场模式** — 匿名对比两个模型的输出，投票选出更优回答
- **图像生成** — 调用 DALL·E、Grok Imagine 等模型生成图像
- **语音朗读** — 基于小米 MiMo TTS 的流式语音合成，支持多种音色预设
- **OpenAI 兼容 API** — 为开发者提供标准 `/v1/chat/completions` 接口，一个 API Key 访问所有模型
- **对话历史** — 云端保存、随时回查、支持搜索
- **主题切换** — 暖色 / 亮色 / 深蓝三套主题
- **多语言** — 中文 / 英文界面

## 技术架构

```
┌──────────────────────────────────────────────────┐
│  Frontend (GitHub Pages)                         │
│  index.html · chat/ · js/ · css/                 │
└──────────────┬───────────────────────────────────┘
               │ HTTPS
┌──────────────▼───────────────────────────────────┐
│  Supabase Edge Functions (Deno / TypeScript)     │
│                                                  │
│  chat-gateway ──┬── modelscope-proxy ──► 上游模型 │
│  api-gateway  ──┘   (路由 / 鉴权 / 重试)         │
│  chat-history     web-search                     │
└──────────────┬───────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────┐
│  Supabase PostgreSQL                             │
│  用户 · 对话历史 · 配额 · 模型目录 · 使用统计     │
└──────────────────────────────────────────────────┘
```

| 组件 | 说明 |
|------|------|
| **chat-gateway** | 面向前端的主入口，处理鉴权、配额、队列、system prompt 注入 |
| **api-gateway** | OpenAI 兼容 API 入口，Bearer Token 鉴权，转发至 modelscope-proxy |
| **modelscope-proxy** | 核心路由层，30+ 个 provider 的 URL 构造、密钥注入、重试、健康检测 |
| **chat-history** | 对话历史的 CRUD |
| **web-search** | 对话中的联网搜索工具 |

## 快速开始

### 使用对话

1. 访问 [nexusvai.github.io/NexusV/chat/](https://nexusvai.github.io/NexusV/chat/)
2. 使用邮箱验证码登录（无需密码）
3. 在模型选择器中选择模型，开始对话

### 使用 API

```bash
curl https://diusqgphvybnzazgopor.supabase.co/functions/v1/api-gateway/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-5.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

API Key 在 [API 管理页](https://nexusvai.github.io/NexusV/chat/api_keys.html) 生成，完整文档见 [API Docs](https://nexusvai.github.io/NexusV/chat/api_docs.html)。

## 项目结构

```
├── index.html              # 官网首页
├── about.html              # 关于页
├── privacy.html            # 隐私协议
├── terms.html              # 服务条款
├── chat/                   # 对话应用
│   ├── index.html          # 聊天主界面
│   ├── cancri_chat.js      # 聊天核心逻辑
│   ├── api_docs.html       # API 文档
│   ├── api_keys.html       # API Key 管理
│   └── api_models.html     # 模型广场
├── js/                     # 公共脚本
│   ├── menu.js             # 导航栏
│   ├── components.js       # 共享组件注入
│   └── theme.js            # 主题切换
├── css/                    # 样式
│   └── 后端/               # ⚠️ 实际是后端代码
│       └── supabase/
│           └── functions/  # Edge Functions 源码
├── Logo/                   # 品牌素材
└── docs/                   # 文档与指南
```

## 本地开发

本项目为纯静态前端 + Supabase 后端，无需构建步骤：

```bash
# 克隆仓库
git clone https://github.com/NexusVAI/NexusV.git
cd NexusV

# 直接用浏览器打开
open index.html

# 或启动本地服务器
python -m http.server 8080
```

后端 Edge Functions 的开发与部署参见 [Management API Guide](docs/supabase-management-api-guide.md)。

## 贡献

欢迎提交 Issue 和 Pull Request。请通过 [GitHub Issues](https://github.com/NexusVAI/NexusV/issues) 报告 bug 或提出功能建议。

## 联系方式

| 渠道 | 链接 |
|------|------|
| GitHub | [github.com/NexusVAI](https://github.com/NexusVAI) |
| 邮箱 | nexusvai@139.com / nexusvai@foxmail.com |
| X / Twitter | [@NexusVAI](https://x.com/NexusVAI) |
| 官网 | [nexusvai.github.io/NexusV](https://nexusvai.github.io/NexusV/) |

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=NexusVAI/NexusV&type=date&legend=top-left)](https://www.star-history.com/?repos=NexusVAI%2FNexusV&type=date&legend=top-left)

## 许可

本项目为开源项目，代码公开于 GitHub。详见仓库中的许可文件。
