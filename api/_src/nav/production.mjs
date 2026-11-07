// Sidebar of the 生产部署 tab. Item: { title, href } · Section: { group?, items }.
export default [
  { items: [{ title: "生产最佳实践", href: "/api/docs/guides/production-best-practices/" }] },
  {
    group: "成本与用量",
    items: [
      { title: "计费与余额", href: "/api/docs/guides/billing/" },
      { title: "查询余额与用量", href: "/api/docs/guides/usage/" },
    ],
  },
  {
    group: "可靠性",
    items: [
      { title: "速率限制", href: "/api/docs/guides/rate-limits/" },
      { title: "错误码", href: "/api/docs/guides/error-codes/" },
    ],
  },
  {
    group: "组织",
    items: [{ title: "团队", href: "/api/docs/guides/teams/" }],
  },
];
