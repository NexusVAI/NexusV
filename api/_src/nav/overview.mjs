// Sidebar of the 概览 tab. Item: { title, href } · Section: { group?, items }.
export default [
  { items: [{ title: "概览", href: "/api/docs/" }] },
  {
    group: "开始使用",
    items: [
      { title: "快速开始", href: "/api/docs/quickstart/" },
      { title: "认证与 API 密钥", href: "/api/docs/guides/authentication/" },
      { title: "SDK 与兼容性", href: "/api/docs/libraries/" },
      { title: "从其他平台迁移", href: "/api/docs/guides/migration/" },
    ],
  },
  {
    group: "核心概念",
    items: [
      { title: "使用约定", href: "/api/docs/guides/conventions/" },
      { title: "免费模型与免费额度", href: "/api/docs/guides/free-tier/" },
    ],
  },
  {
    group: "资源",
    items: [{ title: "常见问题", href: "/api/docs/faq/" }],
  },
];
