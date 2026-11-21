// Sidebar of the 模型 tab. Item: { title, href } · Section: { group?, items }.
import groups from '../model-guides.json' with { type: 'json' };

export default [
  { items: [{ title: "模型目录", href: "/api/docs/models/" }] },
  {
    group: "选择模型",
    items: [
      { title: "价格", href: "/api/docs/pricing/" },
      { title: "模型选择", href: "/api/docs/guides/model-selection/" },
    ],
  },
  ...groups.map(({ group, items }) => ({ group, items: items.map(([slug, title, local = slug]) => ({ title, href: `/api/docs/guides/${local}/` })) })),
];
