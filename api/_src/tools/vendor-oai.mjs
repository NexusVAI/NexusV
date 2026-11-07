// Re-vendors the OpenAI Developers stylesheets into api/assets/oai/.
// Only needed when re-syncing with a newer mirror; normal edits never run this.
//   node api/_src/tools/vendor-oai.mjs
// Source mirror and the extracted inline styles live outside the repo (paths below).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../assets/oai");
const ASTRO = "D:/A.CANCRICODEVITE/openai/bundle/site/_astro";
const INLINE = "D:/A.CancriCode/tasks/2026-11-07_api-oai-redesign/oai-skel/inline-styles.css";

const FILES = [
  ["Header.CufqkI5x.css", "header.css"],
  ["pages.BVX-oTcw.css", "pages.css"],
  ["ApiReferencePage.CsaOlLDn.css", "reference.css"],
  ["primitives.Ctyv9Bad.css", "primitives.css"],
  ["Markdown.CTmxiq48.css", "markdown.css"],
  ["_modelName_.NHK-D5bQ.css", "model-detail.css"],
  ["Select.CWbGcYsN.css", "select.css"],
  ["SegmentedControl.DN9Jh44Z.css", "segmented.css"],
];

// The site never ships OpenAI's font files: drop every @font-face that would fetch
// OpenAI Sans (from /fonts or cdn.openai.com) or KaTeX (from /_astro).
function stripFonts(css) {
  let dropped = 0;
  const out = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    if (/OpenAI Sans|KaTeX/i.test(block)) {
      dropped++;
      return "";
    }
    return block;
  });
  return { css: out, dropped };
}

function banner(src) {
  return `/* Vendored from OpenAI Developers (${src}) by api/_src/tools/vendor-oai.mjs — do not edit; override in api/assets/api.css. */\n`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [src, dst] of FILES) {
  const raw = fs.readFileSync(path.join(ASTRO, src), "utf8");
  const { css, dropped } = stripFonts(raw);
  fs.writeFileSync(path.join(OUT, dst), banner(src) + css, "utf8");
  const remote = (css.match(/url\((?:"|')?https?:\/\//g) || []).length;
  console.log(`${dst.padEnd(18)} ${String(css.length).padStart(8)} B  dropped @font-face: ${dropped}  remote url(): ${remote}`);
}

// Inline <style> blocks: the reference-only @layer order is emitted by the reference layout itself.
{
  const raw = fs.readFileSync(INLINE, "utf8");
  const css = raw.replace(/^@layer theme, base, api-reference, components, utilities;\s*$/m, "");
  const { css: out, dropped } = stripFonts(css);
  fs.writeFileSync(path.join(OUT, "inline.css"), banner("inline <style> blocks") + out, "utf8");
  console.log(`inline.css         ${String(out.length).padStart(8)} B  dropped @font-face: ${dropped}`);
}
