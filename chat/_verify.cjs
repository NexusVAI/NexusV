const fs = require('fs');
const h = fs.readFileSync('api_docs_oai.html','utf8');
console.log('total bytes:', h.length);
const checks = [
  ['Cancri.svg logo', /src="..\/Logo\/Cancri.svg"/],
  ['sidebar nav', /class="cnc-sidebar/],
  ['prose wrapper', /class="prose min-w-0 flex-1"/],
  ['right TOC', /class="cnc-toc/],
  ['cnc-alert', /cnc-alert/],
  ['cnc-code-tab', /cnc-code-tab/],
  ['cnc-lang pre', /pre class="cnc-lang/],
  ['theme.js inlined', /function changeTheme/],
  ['scroll.js inlined', /function onScroll/],
  ['animate.js inlined', /function animate/],
  ['copy.js inlined', /initCopyButtons/],
  ['search open btn id', /id="header-search-open"/],
  ['drawer', /id="drawer"/],
  ['header-search-overlay', /id="header-search-overlay"/],
  ['header-theme-button', /id="header-theme-button"/],
];
for (const [name,re] of checks) console.log(name, '=>', (h.match(re)||[]).length);
// leftover openai.ac.cn links (should be 0 except font cdn)
const oaiLinks = [...h.matchAll(/developers\.openai\.ac\.cn[^\s"']*/g)].map(m=>m[0]);
console.log('leftover developers.openai.ac.cn refs:', oaiLinks.length);
oaiLinks.slice(0,10).forEach(x=>console.log('  ',x));
// leftover platform.openai.com
console.log('platform.openai.com refs:', (h.match(/platform\.openai\.com/g)||[]).length);
// mirror junk
console.log('adsbygoogle:', (h.match(/adsbygoogle/g)||[]).length, '| bing search:', (h.match(/bing\.com/g)||[]).length, '| OpenAI 教程 text:', (h.match(/OpenAI 教程/g)||[]).length);
// astro-island leftover
console.log('astro-island:', (h.match(/astro-island/g)||[]).length);
// section ids present
const ids=[...h.matchAll(/<section id="([^"]+)"/g)].map(m=>m[1]);
console.log('section ids:', ids.length, ids.slice(0,8).join(', '));
// count h2/h3
console.log('h2:', (h.match(/<h2/g)||[]).length, 'h3:', (h.match(/<h3/g)||[]).length);
