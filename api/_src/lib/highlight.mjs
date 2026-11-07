// Minimal build-time highlighter that emits the same token markup as OpenAI's shiki output
// (span.shiki-token with --shiki-light / --shiki-dark, GitHub light/dark palette).
import { esc } from "./util.mjs";

const PALETTE = {
  txt: ["#24292E", "#E1E4E8"],
  kw: ["#D73A49", "#F97583"],
  str: ["#032F62", "#9ECBFF"],
  num: ["#005CC5", "#79B8FF"],
  key: ["#005CC5", "#79B8FF"],
  fn: ["#6F42C1", "#B392F0"],
  com: ["#6A737D", "#6A737D"],
  var: ["#E36209", "#FFAB70"],
};

const JS_KW = "import|from|export|default|const|let|var|function|return|if|else|for|while|of|in|new|await|async|try|catch|finally|throw|class|extends|true|false|null|undefined|typeof|this";
const PY_KW = "import|from|as|def|return|if|elif|else|for|while|in|not|and|or|with|try|except|finally|raise|class|None|True|False|async|await|lambda|yield|pass|print";

const RULES = {
  bash: [
    ["com", /(?<=^|\s)#[^\n]*/y],
    ["str", /"(?:[^"\\]|\\[\s\S])*"|'[^']*'/y],
    ["var", /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/y],
    ["key", /(?<=^|\s)--?[A-Za-z][\w-]*/y],
    ["fn", /(?<=^|\n|[|;&]\s*|^\s+|\n\s+)(?:sudo\s+)?[A-Za-z_][\w.-]*(?=\s|$)/y],
    ["num", /\b\d+(?:\.\d+)?\b/y],
  ],
  powershell: [
    ["com", /(?<=^|\s)#[^\n]*/y],
    ["str", /"(?:[^"`]|`[\s\S])*"|'[^']*'/y],
    ["var", /\$[A-Za-z_][\w:]*/y],
    ["key", /(?<=^|\s)-[A-Za-z][\w-]*/y],
    ["fn", /(?<=^|\n|[|;]\s*)[A-Za-z][\w-]*(?=\s|$)/y],
    ["num", /\b\d+(?:\.\d+)?\b/y],
  ],
  json: [
    ["com", /\/\/[^\n]*/y],
    ["key", /"(?:[^"\\]|\\.)*"(?=\s*:)/y],
    ["str", /"(?:[^"\\]|\\.)*"/y],
    ["num", /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b/y],
  ],
  python: [
    ["com", /#[^\n]*/y],
    ["str", /[rbfu]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/y],
    ["kw", new RegExp(`\\b(?:${PY_KW})\\b`, "y")],
    ["fn", /\b[A-Za-z_]\w*(?=\()/y],
    ["num", /\b\d+(?:\.\d+)?\b/y],
  ],
  javascript: [
    ["com", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ["str", /`(?:[^`\\]|\\[\s\S])*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y],
    ["kw", new RegExp(`\\b(?:${JS_KW})\\b`, "y")],
    ["fn", /\b[A-Za-z_$][\w$]*(?=\()/y],
    ["num", /\b\d+(?:\.\d+)?\b/y],
  ],
  toml: [
    ["com", /#[^\n]*/y],
    ["fn", /(?<=^|\n)\s*\[[^\]\n]+\]/y],
    ["key", /(?<=^|\n)\s*[A-Za-z0-9_.-]+(?=\s*=)/y],
    ["str", /"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/y],
    ["num", /\b\d+(?:\.\d+)?\b|\b(?:true|false)\b/y],
  ],
  yaml: [
    ["com", /(?<=^|\s)#[^\n]*/y],
    ["key", /(?<=^|\n)\s*-?\s*[A-Za-z0-9_.-]+(?=:)/y],
    ["str", /"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/y],
    ["num", /\b\d+(?:\.\d+)?\b|\b(?:true|false|null)\b/y],
  ],
  http: [
    ["kw", /(?<=^|\n)(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/y],
    ["key", /(?<=^|\n)[A-Za-z-]+(?=:\s)/y],
    ["str", /"(?:[^"\\]|\\.)*"/y],
    ["num", /\b\d+(?:\.\d+)?\b/y],
  ],
  text: [],
};

const ALIAS = {
  sh: "bash", shell: "bash", zsh: "bash", console: "bash", curl: "bash",
  ps: "powershell", ps1: "powershell", pwsh: "powershell",
  jsonc: "json", json5: "json",
  py: "python",
  js: "javascript", mjs: "javascript", node: "javascript", ts: "javascript", typescript: "javascript", tsx: "javascript", jsx: "javascript",
  yml: "yaml", ini: "toml", env: "bash", dotenv: "bash",
  plaintext: "text", txt: "text", "": "text",
};

export const LANG_LABEL = {
  bash: "Bash", sh: "Shell", shell: "Shell", curl: "cURL", console: "终端",
  powershell: "PowerShell", ps1: "PowerShell",
  json: "JSON", jsonc: "JSON",
  python: "Python", py: "Python",
  javascript: "JavaScript", js: "JavaScript", node: "Node.js", typescript: "TypeScript", ts: "TypeScript",
  toml: "TOML", yaml: "YAML", yml: "YAML", http: "HTTP", text: "文本", env: ".env",
};

export function canonicalLang(lang) {
  const l = String(lang || "").toLowerCase();
  return RULES[l] ? l : ALIAS[l] || "text";
}

function tokenize(code, lang) {
  const rules = RULES[canonicalLang(lang)] || [];
  const out = [];
  let i = 0;
  let plain = "";
  outer: while (i < code.length) {
    for (const [type, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i && m[0].length) {
        if (plain) { out.push(["txt", plain]); plain = ""; }
        out.push([type, m[0]]);
        i += m[0].length;
        continue outer;
      }
    }
    plain += code[i++];
  }
  if (plain) out.push(["txt", plain]);
  return out;
}

/** Returns the inner HTML of <code>: line-number gutter + one span per line, OpenAI markup. */
export function highlight(code, lang) {
  const src = String(code).replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
  const lines = [[]];
  for (const [type, text] of tokenize(src, lang)) {
    const parts = text.split("\n");
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part) lines[lines.length - 1].push([type, part]);
    });
  }
  const tok = ([type, text]) => {
    const [light, dark] = PALETTE[type] || PALETTE.txt;
    return `<span class="shiki-token" style="--shiki-dark:${dark};--shiki-light:${light}">${esc(text)}</span>`;
  };
  const gutter = lines
    .map((_, n) => `<span class="syntax-highlighter-line-number">${n + 1}${n < lines.length - 1 ? "\n" : ""}</span>`)
    .join("");
  const body = lines
    .map((toks, n) => `<span class="syntax-highlighter-line">${toks.map(tok).join("")}${n < lines.length - 1 ? "\n" : ""}</span>`)
    .join("");
  return { html: `<span aria-hidden="true" class="syntax-highlighter-line-numbers">${gutter}</span>${body}`, text: src, lines: lines.length };
}
