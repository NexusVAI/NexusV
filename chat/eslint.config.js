import js from "@eslint/js";
import globals from "globals";

// 扁平配置（ESLint 9）。核心目的：no-undef 作为「拆模块后漏 import」的安全网。
// 把所有由兄弟脚本 / CDN / cancri_config.js 注入的运行时全局列入白名单，
// 这样 src 模块里出现的、既非本模块声明、又非白名单的标识符，才会被判为 undefined。
export default [
  {
    ignores: [
      "node_modules/**",
      "cancri_chat.js",
      "dist/**",
      "*.config.js",
      // src/grok-bot 下 9 个文件是 vendor 自 cancri-code 的引擎（IIFE + globalThis
      // 串联），必须保持与上游逐字一致以便 diff；维护代码（hero-mascot/mood-director
      // /测试）不在此列，照常 lint。
      "src/grok-bot/geometry-data.js",
      "src/grok-bot/math.js",
      "src/grok-bot/tables.js",
      "src/grok-bot/pose.js",
      "src/grok-bot/tricks.js",
      "src/grok-bot/fx.js",
      "src/grok-bot/eyes.js",
      "src/grok-bot/character.js",
      "src/grok-bot/engine.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        supabase: "readonly",
        turnstile: "readonly",
        __SUPABASE_URL__: "readonly",
        __SUPABASE_ANON_KEY__: "readonly",
        __LOGIN_TURNSTILE_SITE_KEY__: "readonly",
        NexusLoginCaptcha: "readonly",
        NexusAuthCaptcha: "readonly",
        CancriThemeIcons: "readonly",
        CancriImageLoader: "readonly",
        CancriOrbLoader: "readonly",
        CancriMermaid: "readonly",
        CancriUpgradeQuotaUI: "readonly",
        NexusWorkbench: "readonly",
        __katexRender: "readonly",
        __KATEX_FAILED__: "readonly",
        CANCRI_GROUP_BY: "writable",
        articleData: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": "off",
      "no-control-regex": "off",
      "no-useless-escape": "warn",
      "no-prototype-builtins": "off",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    files: ["src/**/*.test.js", "test/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
