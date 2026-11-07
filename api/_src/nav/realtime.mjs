// Sidebar of the 实时语音 tab. Item: { title, href } · Section: { group?, items }.
export default [
  { items: [{ title: "GPT-Live 概览", href: "/api/docs/guides/realtime/" }] },
  {
    group: "构建",
    items: [
      { title: "连接与认证", href: "/api/docs/guides/realtime-connect/" },
      { title: "会话与后端模式", href: "/api/docs/guides/realtime-sessions/" },
      { title: "事件参考", href: "/api/docs/guides/realtime-events/" },
    ],
  },
  {
    group: "运行",
    items: [
      { title: "计费与限制", href: "/api/docs/guides/realtime-billing/" },
      { title: "错误与排查", href: "/api/docs/guides/realtime-errors/" },
    ],
  },
];
