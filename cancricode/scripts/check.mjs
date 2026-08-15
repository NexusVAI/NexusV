import { readFile, access, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'index.html',
  'css/style.css',
  'css/cancri-theme.css',
  'css/cancri-dark.css',
  'css/cancri-theme-toggle.css',
  'css/cancri-footer-mark.css',
  'css/cancri-social.css',
  'images/social/bilibili.svg',
  'images/social/discord.svg',
  'images/social/github.svg',
  'images/social/huggingface.svg',
  'images/social/x.svg',
  'js/main-app.js',
  'js/chunk-app.js',
  'js/jquery-3.6.1.min.js',
  'js/cancri-site.js',
  'js/cancri-theme.js',
  'js/cancri-footer-mark.js',
  'js/three.min.js',
  'js/cornerkit.js',
  'js/cancri-cornerkit.js',
  'images/cancricode-wordmark.svg',
  'css/cancri-fonts.css',
  'fonts/inter/inter-latin.woff2',
  'fonts/inter/inter-latin-ext.woff2',
  'docs/ARCHITECTURE.md',
  'AGENTS.md'
];

const failures = [];
for (const file of requiredFiles) {
  try { await access(resolve(root, file)); }
  catch { failures.push(`missing required file: ${file}`); }
}

const html = await readFile(resolve(root, 'index.html'), 'utf8');
const css = await readFile(resolve(root, 'css/cancri-theme.css'), 'utf8');

for (const hook of ['hero', 'engineering-problems', 'codex-workflow', 'downloads', 'faq', 'footer']) {
  if (!html.includes(`data-cancri-section="${hook}"`)) {
    failures.push(`missing section hook: ${hook}`);
  }
}

if (!html.includes('data-cancri-role="nav-cta"')) failures.push('missing nav CTA hook');
if (!html.includes('data-cancri-role="theme-toggle"')) failures.push('missing theme toggle hook');
if ((html.match(/<footer\b/g) || []).length !== 1) failures.push('expected exactly one footer');
if (!html.includes('./css/cancri-theme.css')) failures.push('custom theme stylesheet is not linked');
if (!html.includes('./css/cancri-dark.css')) failures.push('dark theme stylesheet is not linked');
if (!html.includes('./css/cancri-theme-toggle.css')) failures.push('theme toggle stylesheet is not linked');
if (!html.includes('./css/cancri-footer-mark.css')) failures.push('footer mark stylesheet is not linked');
if (!html.includes('./css/cancri-social.css')) failures.push('social stylesheet is not linked');
if (!html.includes('./css/cancri-fonts.css')) failures.push('local font stylesheet is not linked');
if (!html.includes('data-cancri-role="faq-social"')) failures.push('missing faq social hook');
if (!html.includes('./js/cancri-site.js')) failures.push('custom behavior script is not linked');
if (!html.includes('./js/cancri-theme.js')) failures.push('theme controller script is not linked');
if (!html.includes('./js/cancri-footer-mark.js')) failures.push('footer mark script is not linked');
if (!html.includes('./js/three.min.js')) failures.push('three.js is not linked');
if (!html.includes('./js/cornerkit.js')) failures.push('cornerkit is not linked');
if (!html.includes('./js/cancri-cornerkit.js')) failures.push('cornerkit init script is not linked');
if (!html.includes('data-cancri-role="footer-distortion"')) failures.push('missing footer distortion hook');
if (!html.includes('cancri-footer-distortion__mount')) failures.push('missing footer distortion mount');

// Verify local ./ asset references resolve to real files. Covers plain
// attributes as well as the inline script arrays that lazy-load section art.
const referenced = new Set();
for (const match of html.matchAll(/["'](\.\/[^"'#?\s]+\.[a-z0-9]{2,5})["']/gi)) referenced.add(match[1]);
for (const reference of referenced) {
  try { await access(resolve(root, reference.slice(2))); }
  catch { failures.push(`broken local asset reference: ${reference}`); }
}

// The page must render with no network. Remote asset hosts and cross-project
// relative paths both break that guarantee, so they fail the build.
const remoteHosts = ['cdn.prod.website-files.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const siblingProject = /\.\.\/(?!fonts\/|images\/|css\/|js\/)[a-z0-9][a-z0-9-]*\//gi;
const sourceFiles = ['index.html'];
for (const dir of ['css', 'js']) {
  for (const name of await readdir(resolve(root, dir))) {
    if (name.endsWith('.css') || name.endsWith('.js')) sourceFiles.push(`${dir}/${name}`);
  }
}
// Comments may legitimately cite an upstream URL as provenance.
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
for (const file of sourceFiles) {
  const source = stripComments(await readFile(resolve(root, file), 'utf8'));
  for (const host of remoteHosts) {
    if (source.includes(host)) failures.push(`remote asset host ${host} referenced in ${file}; vendor it locally`);
  }
  for (const match of source.matchAll(siblingProject)) {
    failures.push(`cross-project reference ${match[0]} in ${file}; copy the asset into this repo instead`);
  }
}

// Debug leftovers kept creeping back into the project root.
for (const entry of await readdir(root)) {
  if (entry.startsWith('_tmp_') || entry.endsWith('.bak') || entry === '.puppeteer-tmp') {
    failures.push(`debug leftover in project root: ${entry}`);
  }
}

// Regression guard for the exact Gemini failure mode that painted spacer bars.
if (/(^|\n)\s*\.g_section_space\s*\{[^}]*background(?:-color)?\s*:/s.test(css)) {
  failures.push('unsafe global .g_section_space background override detected; scope it to data-cancri-section');
}
if (/(^|\n)\s*\[data-scroll=["']bg["']\]\s*\{[^}]*background(?:-color)?\s*:/s.test(css)) {
  failures.push('unsafe global [data-scroll="bg"] background override detected');
}

if (failures.length) {
  console.error('CancriCode project check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}

console.log('CancriCode project check passed.');
