// Site-wide navigation: header menus, the API subnav tabs, and one sidebar per tab.
// Each tab's sidebar lives in nav/<tab>.mjs so different people can edit different tabs.
import overview from "./nav/overview.mjs";
import models from "./nav/models.mjs";
import protocols from "./nav/protocols.mjs";
import coding from "./nav/coding.mjs";
import realtime from "./nav/realtime.mjs";
import production from "./nav/production.mjs";
import reference from "./nav/reference.mjs";

export const SITE = {
  name: "NexusVAI Developers",
  origin: "https://www.nexusvai.xyz",
  logo: "/chat/assets/oai.logo/nexusvai_developers_wordmark.svg",
  consoleUrl: "/api/console/",
  communityUrl: "https://qm.qq.com/q/IT7SUyd2eu",
};

export const TOP_NAV = [
  { id: "home", label: "首页", href: "/api/" },
  {
    id: "api",
    label: "API",
    href: "/api/docs/",
    menu: [
      { title: "概览", desc: "开始使用 NexusVAI API", href: "/api/docs/" },
      { title: "模型", desc: "浏览模型，比较能力与价格", href: "/api/docs/models/" },
      { title: "协议", desc: "兼容 OpenAI 与 Anthropic 的接口", href: "/api/docs/guides/chat-completions/" },
      { title: "编程工具", desc: "在 Codex、Claude Code、Cursor 中接入", href: "/api/docs/guides/coding-tools/" },
      { title: "实时语音", desc: "用 GPT-Live 构建实时语音体验", href: "/api/docs/guides/realtime/" },
      { title: "生产部署", desc: "计费、限速、错误处理与团队协作", href: "/api/docs/guides/production-best-practices/" },
      { title: "API 参考", desc: "端点、参数与响应", href: "/api/reference/" },
    ],
  },
  {
    id: "products",
    label: "产品",
    href: "/chat/",
    menu: [
      { title: "NexusV 对话", desc: "在网页上与前沿模型对话", href: "/chat/" },
      { title: "Cancri Code", desc: "读懂整个项目、在云端动手的编程智能体", href: "/cancricode/" },
      { title: "订阅与定价", desc: "对话订阅套餐与按量计费", href: "/chat/pricing.html" },
      { title: "控制台", desc: "管理 API 密钥、用量与账单", href: "/api/console/" },
    ],
  },
  {
    id: "resources",
    label: "资源",
    href: "/api/docs/faq/",
    menu: [
      { title: "常见问题", desc: "接入时最常遇到的问题", href: "/api/docs/faq/" },
      { title: "社区", desc: "加入 QQ 交流群，关注 B 站与小红书", href: "/api/#community", community: true },
      { title: "联系我们", desc: "商务合作、发票与工单", href: "/api/contact/" },
    ],
  },
];

// Subnav tabs under the header on every /api/docs and /api/reference page (OpenAI: Overview … API reference).
export const TABS = [
  { id: "overview", label: "概览", href: "/api/docs/", sidebar: overview },
  { id: "models", label: "模型", href: "/api/docs/models/", sidebar: models },
  { id: "protocols", label: "协议", href: "/api/docs/guides/chat-completions/", sidebar: protocols },
  { id: "coding", label: "编程工具", href: "/api/docs/guides/coding-tools/", sidebar: coding },
  { id: "realtime", label: "实时语音", href: "/api/docs/guides/realtime/", sidebar: realtime },
  { id: "production", label: "生产部署", href: "/api/docs/guides/production-best-practices/", sidebar: production },
  { id: "reference", label: "API 参考", href: "/api/reference/", sidebar: reference },
];

// Search-only entries for pages the build does not generate.
export const EXTRA_SEARCH = [
  { title: "控制台", url: "/api/console/", text: "API 密钥 用量 日志 账单 团队 余额" },
  { title: "API 密钥", url: "/api/console/keys/", text: "创建 删除 管理 API Key 密钥" },
  { title: "用量", url: "/api/console/usage/", text: "用量 消耗 统计 token" },
  { title: "日志", url: "/api/console/logs/", text: "请求日志 订单" },
  { title: "账单与充值", url: "/api/console/billing/", text: "充值 账单 余额 兑换码 订单" },
  { title: "团队", url: "/api/console/team/", text: "团队 成员 邀请 共享余额" },
  { title: "NexusV 对话", url: "/chat/", text: "聊天 对话 网页版" },
  { title: "Cancri Code", url: "/cancricode/", text: "桌面端 编程智能体 下载" },
];
