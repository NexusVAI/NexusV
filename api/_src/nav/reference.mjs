// Sidebar of the API 参考 tab. Item: { title, href, method? } · Section: { group?, items }.
// `method` (GET/POST/…/WS) renders the coloured badge in front of the title.
// Every endpoint listed here is implemented in cf-gateway/src/api-gateway.ported.ts; don't add one that isn't.
export default [
  { items: [{ title: "概览", href: "/api/reference/" }] },
  {
    group: "文本生成",
    items: [
      { title: "Chat Completions", href: "/api/reference/chat-completions/", method: "POST" },
      { title: "Responses", href: "/api/reference/responses/", method: "POST" },
      { title: "Messages", href: "/api/reference/messages/", method: "POST" },
      { title: "计算输入 token", href: "/api/reference/count-tokens/", method: "POST" },
    ],
  },
  {
    group: "实时语音",
    items: [{ title: "实时语音会话", href: "/api/reference/realtime/", method: "WS" }],
  },
  {
    group: "账户与模型",
    items: [
      { title: "列出模型", href: "/api/reference/models/", method: "GET" },
      { title: "查询余额与用量", href: "/api/reference/balance/", method: "GET" },
    ],
  },
];
