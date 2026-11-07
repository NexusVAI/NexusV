// Sidebar of the 编程工具 tab. Item: { title, href } · Section: { group?, items }.
export default [
  { items: [{ title: "概览", href: "/api/docs/guides/coding-tools/" }] },
  {
    group: "命令行智能体",
    items: [
      { title: "Codex CLI", href: "/api/docs/guides/codex-cli/" },
      { title: "Claude Code", href: "/api/docs/guides/claude-code/" },
      { title: "OpenCode", href: "/api/docs/guides/opencode/" },
      { title: "OpenClaw", href: "/api/docs/guides/openclaw/" },
      { title: "Aider", href: "/api/docs/guides/aider/" },
    ],
  },
  {
    group: "编辑器与 IDE",
    items: [
      { title: "Cursor", href: "/api/docs/guides/cursor/" },
      { title: "Cline", href: "/api/docs/guides/cline/" },
      { title: "Continue", href: "/api/docs/guides/continue/" },
    ],
  },
  {
    group: "桌面客户端",
    items: [
      { title: "Cherry Studio", href: "/api/docs/guides/cherry-studio/" },
      { title: "Chatbox", href: "/api/docs/guides/chatbox/" },
      { title: "LobeChat", href: "/api/docs/guides/lobechat/" },
      { title: "SillyTavern", href: "/api/docs/guides/sillytavern/" },
      { title: "CC Switch", href: "/api/docs/guides/cc-switch/" },
    ],
  },
  {
    group: "排查",
    items: [{ title: "客户端常见问题", href: "/api/docs/guides/client-faq/" }],
  },
];
