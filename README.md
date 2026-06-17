<p align="center">
  <img src="Logo/Cancri.png" alt="NexusV" width="96">
</p>

<h1 align="center">NexusV</h1>

<p align="center">
  聚合主流大语言模型的 AI 对话平台 — 一个界面，接入 30+ 模型，自由切换、横向对比。
</p>

<p align="center">
  <a href="https://www.nexusvai.xyz">官网</a> ·
  <a href="https://www.nexusvai.xyz/chat/">在线对话</a> ·
  <a href="https://www.nexusvai.xyz/chat/api_docs.html">API 文档</a> ·
  <a href="https://www.nexusvai.xyz/chat/api_models.html">模型广场</a>
</p>

---

[![Star History Chart](https://api.star-history.com/chart?repos=NexusVAI/NexusV&type=date&legend=top-left)](https://www.star-history.com/?repos=NexusVAI%2FNexusV&type=date&legend=top-left)

## 简介

NexusV 是一个多模型 AI 对话平台，为用户提供统一的多模型对话体验。通过一个简洁的 Web 界面，您可以同时访问来自不同供应商的数十个大语言模型，在同一会话中切换模型、横向比较输出质量。

> **开源范围说明**
>
> 本仓库**仅开源前端代码**（静态页面、聊天界面、API 平台界面等全部浏览器端代码）。
> 后端（Supabase Edge Functions、网关、路由、鉴权、计费等服务端代码）为**闭源**，不包含在本仓库中。
> 前端中出现的 `__SUPABASE_ANON_KEY__`、Turnstile site key 等均为设计上公开的客户端公钥，不构成敏感信息。

**当前接入的上游模型供应方：**

阿里云百炼 · 魔搭社区 · 智谱 · 月之暗面 · Mistral · Google Gemini · 星火 · 商汤 · 以及更多第三方中转服务

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
│  前端（本仓库 · 开源）                            │
│  GitHub Pages 静态托管                            │
│  index.html · chat/ · js/ · css/                 │
└──────────────┬───────────────────────────────────┘
               │ HTTPS（经 Cloudflare 边缘网关反代）
┌──────────────▼───────────────────────────────────┐
│  后端（闭源 · 不在本仓库）                        │
│  Supabase Edge Functions (Deno / TypeScript)     │
│                                                  │
│  chat-gateway ──┬── modelscope-proxy ──► 上游模型 │
│  api-gateway  ──┘   (路由 / 鉴权 / 重试)         │
│  chat-history     web-search                     │
└──────────────┬───────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────┐
│  Supabase PostgreSQL（闭源）                      │
│  用户 · 对话历史 · 配额 · 模型目录 · 使用统计     │
└──────────────────────────────────────────────────┘
```

| 后端组件（闭源） | 说明 |
|------|------|
| **chat-gateway** | 面向前端的主入口，处理鉴权、配额、队列、system prompt 注入 |
| **api-gateway** | OpenAI 兼容 API 入口，Bearer Token 鉴权，转发至 modelscope-proxy |
| **modelscope-proxy** | 核心路由层，30+ 个 provider 的 URL 构造、密钥注入、重试、健康检测 |
| **chat-history** | 对话历史的 CRUD |
| **web-search** | 对话中的联网搜索工具 |

所有鉴权、配额、限流、密钥管理均在服务端强制执行；前端代码不包含任何上游模型密钥或服务端机密。

## 快速开始

### 使用对话

1. 访问 [https://www.nexusvai.xyz/chat/](https://www.nexusvai.xyz/chat/)
2. 使用邮箱验证码登录（无需密码）
3. 在模型选择器中选择模型，开始对话

### 使用 API

```bash
curl https://chat.nexusvai.xyz/functions/v1/api-gateway/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-5.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

API Key 在 [API 管理页](https://www.nexusvai.xyz/chat/api_keys.html) 生成，完整文档见 [API Docs](https://www.nexusvai.xyz/chat/api_docs.html)。

## 项目结构（本仓库 / 前端）

更详细的目录职责、提交前检查清单和第三方示例说明见 [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)。

```
├── index.html              # 官网首页
├── about.html / research.html / article.html   # 内容页
├── privacy.html            # 隐私协议
├── terms.html              # 服务条款
├── pricing.html            # 价格页
├── chat/                   # 对话应用
│   ├── index.html          # 聊天主界面
│   ├── cancri_chat.js      # 聊天核心逻辑
│   ├── cancri_config.js    # 前端公开配置（网关地址 / 公钥）
│   ├── api/                # API 开放平台与管理后台界面
│   ├── shop/               # 商店 / 订单界面
│   └── api_docs.html · api_keys.html · api_models.html
├── js/                     # 官网公共脚本（导航 / 主题 / 搜索 / 评论等）
├── css/                    # 样式
└── Logo/                   # 品牌素材
```

## 本地开发

前端为纯静态页面，无需构建步骤：

```bash
git clone https://github.com/NexusVAI/NexusV.git
cd NexusV

# 启动本地服务器（推荐，直接双击打开会受 CORS 限制）
python -m http.server 8080
# 浏览器访问 http://localhost:8080
```

注意：本地运行的前端仍会连接线上后端网关（`chat.nexusvai.xyz`）。后端闭源，无法本地自建完整环境。

## 贡献

欢迎针对**前端**提交 Issue 和 Pull Request。请通过 [GitHub Issues](https://github.com/NexusVAI/NexusV/issues) 报告 bug 或提出功能建议。涉及后端的问题（鉴权、配额、模型路由等）也欢迎通过 Issue 反馈，但相应代码不在本仓库维护。

## 联系方式

| 渠道 | 链接 |
|------|------|
| GitHub | [github.com/NexusVAI](https://github.com/NexusVAI) |
| 邮箱 | nexusvai@139.com / nexusvai@foxmail.com |
| X / Twitter | [@NexusVAI](https://x.com/NexusVAI) |
| 官网 | [https://www.nexusvai.xyz/](https://www.nexusvai.xyz/) |

## 许可

本仓库中的**前端代码**开源公开；**后端服务端代码闭源**，不在本仓库范围内。仓库目前未附带正式的 LICENSE 文件——在补充 LICENSE 之前，默认保留所有权利（All Rights Reserved），仅供学习与参考。
