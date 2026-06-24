// Build script: assemble 1:1 OpenAI-docs-layout replica with Cancri content.
// Sources:
//  - shell: _tmp_live.html (live https://developers.openai.ac.cn/api/docs, clean)
//  - css:   _tmp_oai_src/{platform-docs,PageLayout,index}.css + live inline styles
//  - js:    _tmp_oai_src/{theme,scroll,animate,copy}.js + vanilla island behavior
//  - content: api_docs.html (Cancri) main sections
//  - logo:  ../Logo/Cancri.svg
const fs = require('fs');
const SRC = '_tmp_oai_src/';
const read = (p) => fs.readFileSync(p, 'utf8');

// ---------- 1. CSS ----------
const cssBundles = ['platform-docs.css','PageLayout.css','index.css'].map(f => read(SRC+f)).join('\n');
// live inline <style> blocks (skip the mirror junk ones: the 1st style in live head hides header + "OpenAI 教程")
const liveHtml = read('_tmp_live.html');
const liveHead = liveHtml.match(/<head>([\s\S]*?)<\/head>/i)[1];
const inlineStyles = [...liveHead.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]);
// inlineStyles[0] = mirror junk (header hide + OpenAI 教程 text) -> DROP
// inlineStyles[1] = "@layer theme, base, components, utilities;" -> keep
// inlineStyles[2] = icon-item + code-sample _root_1x2h7 -> keep
// inlineStyles[3] = _ModelsTitle + syntax-highlighter -> keep
const keepInline = [inlineStyles[1], inlineStyles[2], inlineStyles[3]].join('\n');

// Cancri content re-style CSS (mapped classes in OpenAI theme)
const cncCss = `
/* === Cancri content classes restyled into OpenAI theme === */
.cnc-alert{padding:12px 16px;border-radius:12px;font-size:14px;margin:16px 0;line-height:1.6;border:1px solid var(--color-border-primary-surface);background:var(--color-surface-secondary)}
.cnc-alert--info{background:color-mix(in srgb,var(--color-text) 4%,transparent);border-color:color-mix(in srgb,var(--color-text) 18%,transparent)}
.cnc-alert--warn{background:color-mix(in srgb,#fbbf24 8%,transparent);border-color:color-mix(in srgb,#fbbf24 28%,transparent)}
.cnc-alert--danger{background:color-mix(in srgb,#f87171 8%,transparent);border-color:color-mix(in srgb,#f87171 28%,transparent)}
.cnc-alert b{color:var(--color-text-emphasis);font-weight:600}
.cnc-alert code{font-size:.9em}
.cnc-endpoint{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;background:var(--code-snippet-bg);border:.5px solid var(--color-border-primary-surface);border-radius:8px;font-family:var(--monospace);font-size:13px;margin:10px 0;flex-wrap:wrap}
.cnc-method{font-weight:700;font-size:11px;padding:2px 8px;border-radius:4px}
.cnc-method--get{background:rgba(74,222,128,.14);color:#16a34a}
.cnc-method--post{background:rgba(96,165,250,.14);color:#2563eb}
.cnc-pill{display:inline-block;font-size:11px;padding:2px 8px;border-radius:4px;background:var(--color-surface-secondary);border:.5px solid var(--color-border-primary-surface);color:var(--color-text-secondary);margin-right:4px;font-family:var(--monospace)}
/* code tabs -> OpenAI code-sample look */
.cnc-code-block{position:relative;border:.5px solid var(--color-border-primary-surface);border-radius:8px;background:var(--code-snippet-bg);margin:16px 0;overflow:hidden}
.cnc-code-tabs{display:flex;gap:2px;padding:4px 8px;border-bottom:.5px solid var(--color-border-primary-surface);background:transparent}
.cnc-code-tab{padding:6px 12px;background:transparent;border:none;color:var(--color-text-secondary);font-size:12px;cursor:pointer;border-radius:6px;transition:background .15s,color .15s;font-family:var(--monospace);letter-spacing:var(--font-tracking-wide)}
.cnc-code-tab:hover{color:var(--color-text-emphasis);background:var(--color-background-primary-soft-alpha,var(--color-background-primary-soft))}
.cnc-code-tab.active{color:var(--color-text-emphasis);background:var(--color-background-primary-soft)}
.cnc-code-block pre.cnc-lang{display:none;margin:0;padding:12px 16px;font-family:var(--monospace);font-size:13px;line-height:20px;white-space:pre;overflow-x:auto;background:transparent;color:var(--color-text);border:0;border-radius:0}
.cnc-code-block pre.cnc-lang.active{display:block}
.cnc-code-block pre.cnc-lang code{font-family:var(--monospace)}
/* standalone pre (no tabs) -> flush code-sample look */
.prose pre:not(.cnc-lang){background:var(--code-snippet-bg);border:.5px solid var(--color-border-primary-surface);border-radius:8px;padding:12px 16px;font-family:var(--monospace);font-size:13px;line-height:20px;overflow-x:auto;color:var(--color-text)}
.prose pre code{font-family:var(--monospace);background:none;border:0;padding:0}
/* syntax spans (Cancri .k/.s/.n/.c) -> OpenAI syntax vars */
pre .k{color:var(--syntax2,#c084fc)}
pre .s{color:var(--syntax3,#86efac)}
pre .n{color:var(--syntax1,#fbbf24)}
pre .c{color:var(--color-text-disabled);font-style:italic}
.cnc-copy-icon{position:absolute;top:6px;right:6px;padding:4px 10px;background:var(--color-surface);border:.5px solid var(--color-border-primary-surface);color:var(--color-text-secondary);font-size:11px;border-radius:6px;cursor:pointer;opacity:.7;transition:opacity .15s,color .15s}
.cnc-code-block:hover .cnc-copy-icon{opacity:1}
.cnc-copy-icon:hover{color:var(--color-text-emphasis)}
.cnc-copy-icon.copied{color:#16a34a;opacity:1}
/* endpoint copy button (Cancri .copy-icon with data-copy-text) */
.cnc-endpoint .cnc-copy-icon{position:static;opacity:1}
/* intro figure */
.cnc-intro-figure{margin:24px 0;border-radius:16px;overflow:hidden;border:.5px solid var(--color-border-primary-surface);position:relative;max-width:720px}
.cnc-intro-figure img,.cnc-intro-figure video{display:block;width:100%;height:auto}
/* prose tweaks to match OpenAI doc body */
.prose{--tw-prose-body:var(--color-text);--tw-prose-headings:var(--color-text-emphasis);--tw-prose-links:var(--color-text-emphasis);--tw-prose-bold:var(--color-text-emphasis);--tw-prose-code:var(--color-text-emphasis);--tw-prose-bullets:var(--color-text-secondary);--tw-prose-counters:var(--color-text-secondary);--tw-prose-quotes:var(--color-text-emphasis);--tw-prose-th-borders:var(--color-border-primary-surface);--tw-prose-td-borders:var(--color-border-primary-surface);max-width:none;font-size:16px;line-height:1.7;color:var(--color-text)}
.prose h2{font-size:1.875rem;font-weight:600;letter-spacing:-.02em;margin-top:2.5em;margin-bottom:.8em;color:var(--color-text-emphasis);scroll-margin-top:80px}
.prose h3{font-size:1.25rem;font-weight:600;margin-top:1.8em;margin-bottom:.6em;color:var(--color-text-emphasis);scroll-margin-top:80px}
.prose :where(table):not(:where([class~=not-prose] *)){font-size:14px}
.prose :where(code):not(:where([class~=not-prose] *)):not(pre code){background:var(--color-surface-secondary);border:.5px solid var(--color-border-primary-surface);border-radius:4px;padding:1px 5px;font-size:.875em;font-family:var(--monospace)}
.prose :where(a):not(:where([class~=not-prose] *)){text-decoration:none}
.prose :where(a):not(:where([class~=not-prose] *)):hover{text-decoration:underline}
/* right TOC */
.cnc-toc{position:sticky;top:88px;max-height:calc(100vh - 110px);overflow-y:auto;padding:8px 0;font-size:13px}
.cnc-toc h4{font-size:11px;font-weight:600;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}
.cnc-toc ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.cnc-toc li a{display:block;padding:4px 10px;border-radius:6px;color:var(--color-text-secondary);text-decoration:none;line-height:1.45;transition:color .15s,background .15s}
.cnc-toc li a:hover{color:var(--color-text-emphasis);background:var(--color-background-primary-soft)}
.cnc-toc li a.is-active{color:var(--color-text-emphasis);font-weight:500;background:var(--color-background-primary-soft)}
.cnc-toc li.cnc-toc-h3 a{padding-left:22px;font-size:12px}
.cnc-toc::-webkit-scrollbar{width:6px}
.cnc-toc::-webkit-scrollbar-thumb{background:var(--color-border-primary-surface);border-radius:3px}
/* === VAI brand logo + Nexus scroll collapse (from Cancri official site) === */
.cancri-brand{display:inline-flex;align-items:center;gap:.35rem;color:var(--color-text);text-decoration:none}
.cancri-brand__icon{display:block;width:28px;height:28px;object-fit:contain;flex-shrink:0;color:var(--color-text)}
.cancri-brand__word-wrap{display:inline-block;overflow:hidden;vertical-align:bottom;max-width:0;opacity:0;transform:translateX(10px);transition:max-width 280ms cubic-bezier(0,0,.2,1),opacity 240ms cubic-bezier(.32,.72,0,1),transform 280ms cubic-bezier(.32,.72,0,1)}
.cancri-brand__word-wrap.is-in{max-width:5.2em;opacity:1;transform:translateX(0)}
html.is-auth-nav-scrolled .cancri-brand__word-wrap.is-in{max-width:0;opacity:0;transform:translateX(10px)}
.cancri-brand__word{display:inline-block;padding-right:.04em;font-family:"OpenAI Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;font-size:1.125rem;font-weight:500;letter-spacing:-.02em;line-height:1;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.cancri-brand__word-wrap{transition:none!important}}
/* overview page quickstart card */
.cnc-quickstart-card{border-radius:16px;background:var(--color-surface-secondary);padding:24px 32px}
@media(min-width:768px){.cnc-quickstart-card{padding:32px}}
.cnc-quickstart-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:9999px;padding:10px 20px;font-size:14px;font-weight:500;transition:opacity .15s;text-decoration:none}
.cnc-quickstart-btn--primary{background:var(--color-text);color:var(--color-surface)}
.cnc-quickstart-btn--primary:hover{opacity:.88}
.cnc-quickstart-btn--secondary{background:var(--color-alpha-05);color:var(--color-text);border:.5px solid var(--color-border-primary-surface)}
.cnc-quickstart-btn--secondary:hover{background:var(--color-alpha-10)}
/* overview video */
.cnc-overview-video{border-radius:16px;overflow:hidden;border:.5px solid var(--color-border-primary-surface);max-width:720px;width:100%;margin:0 auto}
.cnc-overview-video video{display:block;width:100%;height:auto}
`;

const allCss = cssBundles + '\n' + keepInline + '\n' + cncCss;
console.log('CSS total bytes:', allCss.length);

// ---------- 2. JS ----------
const jsTheme = read(SRC+'theme.js');
const jsScroll = read(SRC+'scroll.js');
const jsAnimate = read(SRC+'animate.js');
const jsCopy = read(SRC+'copy.js');

const vanillaJs = `
// === Cancri code-tab switching (preserved from api-docs-app.js) ===
document.querySelectorAll('.cnc-code-tab').forEach((btn)=>{
  btn.addEventListener('click',()=>{
    const grp=btn.dataset.grp, lang=btn.dataset.lang;
    document.querySelectorAll('.cnc-code-tab[data-grp="'+grp+'"]').forEach(b=>b.classList.toggle('active', b===btn));
    document.querySelectorAll('pre.cnc-lang[data-grp="'+grp+'"]').forEach(p=>p.classList.toggle('active', p.dataset.lang===lang));
  });
});
// === Cancri endpoint copy buttons ===
document.querySelectorAll('.cnc-copy-icon[data-copy-text]').forEach((btn)=>{
  btn.addEventListener('click',async()=>{
    const id=btn.dataset.copyText; let text='';
    const el=document.getElementById(id); if(el) text=el.innerText.trim();
    if(!text) text=btn.getAttribute('data-copy-raw')||'';
    try{ if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text); else{const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);} }
    catch(e){}
    btn.classList.add('copied'); const orig=btn.textContent; btn.textContent='已复制';
    setTimeout(()=>{btn.classList.remove('copied');btn.textContent=orig;},1800);
  });
});
// === Header search overlay toggle ===
(function(){
  const overlay=document.getElementById('header-search-overlay');
  const openBtn=document.getElementById('header-search-open');
  const closeBtn=overlay?.querySelector('[data-header-search-close]');
  const dismiss=overlay?.querySelector('[data-header-search-dismiss]');
  const emptyState=overlay?.querySelector('[data-site-search-empty-state="true"]');
  const emptyHTML=emptyState?emptyState.innerHTML:'';
  function open(){ if(!overlay)return; overlay.classList.remove('hidden'); overlay.classList.add('flex'); overlay.setAttribute('aria-hidden','false'); overlay.setAttribute('data-open','true'); document.documentElement.classList.add('has-header-search-open'); const inp=document.getElementById('header-site-search-input'); if(inp){ inp.value=''; if(emptyState){emptyState.innerHTML=emptyHTML;} setTimeout(()=>inp.focus(),60); } }
  function close(){ if(!overlay)return; overlay.classList.add('hidden'); overlay.classList.remove('flex'); overlay.setAttribute('aria-hidden','true'); overlay.setAttribute('data-open','false'); document.documentElement.classList.remove('has-header-search-open'); }
  if(openBtn) openBtn.addEventListener('click',open);
  if(closeBtn) closeBtn.addEventListener('click',close);
  if(dismiss) dismiss.addEventListener('click',close);
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') close(); });
  // simple in-page search over doc sections
  const inp=document.getElementById('header-site-search-input');
  if(inp && emptyState){
    const sections=[...document.querySelectorAll('main section[id]')].map(s=>({id:s.id,title:s.querySelector('h2,h3')?.textContent||s.id,text:s.textContent.toLowerCase()}));
    inp.addEventListener('input',()=>{
      const q=inp.value.trim().toLowerCase();
      if(!q){ emptyState.innerHTML=emptyHTML; return; }
      emptyState.innerHTML='';
      const hits=sections.filter(s=>s.title.toLowerCase().includes(q)||s.text.includes(q)).slice(0,12);
      if(!hits.length){ emptyState.innerHTML='<p class="text-sm text-secondary px-1">没有匹配项，换个关键词试试。</p>'; return; }
      const wrap=document.createElement('div'); wrap.className='flex flex-col gap-1';
      hits.forEach(h=>{const a=document.createElement('a');a.href='#'+h.id;a.className='block px-4 py-2 text-sm text-default transition-colors hover:bg-primary-soft-alpha rounded-lg';a.textContent=h.title;a.addEventListener('click',close);wrap.appendChild(a);});
      emptyState.appendChild(wrap);
    });
    inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ const first=emptyState.querySelector('a'); if(first){ location.hash=first.getAttribute('href'); close(); } } });
  }
})();
// === Mobile drawer toggle ===
(function(){
  const drawerBtn=document.getElementById('header-drawer-button');
  const drawer=document.getElementById('drawer');
  if(!drawerBtn||!drawer)return;
  drawerBtn.addEventListener('click',()=>{ const open=drawer.classList.contains('translate-x-0'); if(open){drawer.classList.remove('translate-x-0');drawer.classList.add('translate-x-full');} else {drawer.classList.add('translate-x-0');drawer.classList.remove('translate-x-full');} });
  // close on link click (both in-page # and cross-page links)
  drawer.querySelectorAll('a[href]').forEach(a=>a.addEventListener('click',()=>{drawer.classList.remove('translate-x-0');drawer.classList.add('translate-x-full');}));
})();
// === Right TOC scroll-spy ===
(function(){
  const links=[...document.querySelectorAll('.cnc-toc a[data-toc-target]')];
  if(!links.length)return;
  const map=new Map(); links.forEach(l=>{const t=document.getElementById(l.dataset.tocTarget); if(t) map.set(t,l);});
  const obs=new IntersectionObserver((entries)=>{ entries.forEach(en=>{ if(en.isIntersecting){ links.forEach(l=>l.classList.remove('is-active')); const l=map.get(en.target); if(l) l.classList.add('is-active'); } }); },{rootMargin:'-80px 0px -70% 0px',threshold:0});
  map.forEach((l,t)=>obs.observe(t));
})();
// === Sidebar active link on hash ===
(function(){
  const links=[...document.querySelectorAll('nav.cnc-sidebar a[href]')];
  function sync(){ let h=location.hash.replace('#',''); if(!h) h='intro'; links.forEach(l=>{ const href=l.getAttribute('href'); const hash=href.includes('#')?href.split('#')[1]:''; l.classList.toggle('bg-primary-ghost-active', hash===h); }); }
  window.addEventListener('hashchange',sync); sync();
})();
// === Nexus scroll collapse (from Cancri official site auth-login-chrome.js) ===
(function(){
  var SCROLL_THRESHOLD=32;
  function setNavScrolled(scrolled){ document.documentElement.classList.toggle('is-auth-nav-scrolled',scrolled); }
  function getScrollY(){ return window.scrollY||document.documentElement.scrollTop||0; }
  function onScroll(){ setNavScrolled(getScrollY()>SCROLL_THRESHOLD); }
  // init: show Nexus word on load
  document.querySelectorAll('[data-cancri-brand] .cancri-brand__word-wrap').forEach(function(el){ el.classList.add('is-in'); });
  window.addEventListener('scroll',onScroll,{passive:true});
  onScroll();
})();
`;
const allJs = jsTheme + '\n' + jsScroll + '\n' + jsAnimate + '\n' + jsCopy + '\n' + vanillaJs;
console.log('JS total bytes:', allJs.length);

// ---------- 3. Cancri content extraction + transform ----------
const cncHtml = read('api_docs.html');
const mainMatch = cncHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
let cncMain = mainMatch[1];
// Extract from <h1>Cancri API 文档</h1> to the last </section> before docsPager
const h1Idx = cncMain.indexOf('<h1>Cancri API 文档</h1>');
const pagerIdx = cncMain.indexOf('<nav class="docs-pager"');
let rawContent = cncMain.slice(h1Idx, pagerIdx > 0 ? pagerIdx : undefined);
// strip the docs-intro-figure glass-pill (needs liquid-glass JS)
rawContent = rawContent.replace(/<a\s+class="docs-glass-pill"[\s\S]*?<\/a>/, '');

// Split: intro part (h1 + p + figure) for overview page, sections for detail page
const firstSectionIdx = rawContent.indexOf('<section id="intro">');
let introPart = rawContent.slice(0, firstSectionIdx); // h1 + p + figure
let sectionsContent = rawContent.slice(firstSectionIdx); // all <section> elements

// For overview: remove the duplicate poster <img>, keep only <video>
introPart = introPart.replace(/<img\s+class="docs-intro-figure__poster"[\s\S]*?\/>/, '');

// Class rename helper (applied to both parts)
function renameClasses(s) {
  return s
    .replace(/class="alert info"/g, 'class="cnc-alert cnc-alert--info"')
    .replace(/class="alert warn"/g, 'class="cnc-alert cnc-alert--warn"')
    .replace(/class="alert danger"/g, 'class="cnc-alert cnc-alert--danger"')
    .replace(/class="alert"/g, 'class="cnc-alert"')
    .replace(/class="endpoint"/g, 'class="cnc-endpoint"')
    .replace(/class="code-tabs"/g, 'class="cnc-code-tabs"')
    .replace(/class="code-tab active"/g, 'class="cnc-code-tab active"')
    .replace(/class="code-tab"/g, 'class="cnc-code-tab"')
    .replace(/class="code-block"/g, 'class="cnc-code-block"')
    .replace(/class="copy-icon"/g, 'class="cnc-copy-icon"')
    .replace(/class="method get"/g, 'class="cnc-method cnc-method--get"')
    .replace(/class="method post"/g, 'class="cnc-method cnc-method--post"')
    .replace(/class="pill"/g, 'class="cnc-pill"')
    .replace(/class="lang active"/g, 'class="cnc-lang active"')
    .replace(/class="lang"/g, 'class="cnc-lang"')
    .replace(/class="docs-intro-figure"/g, 'class="cnc-intro-figure"')
    .replace(/class="docs-intro-figure__poster"/g, 'class=""')
    .replace(/class="docs-intro-figure__video"/g, 'class=""');
}
introPart = renameClasses(introPart);
let content = renameClasses(sectionsContent);

// add ids to id-less <h3> so TOC anchors + scroll-spy work
let h3Counter = {};
content = content.replace(/<h3([^>]*)>([\s\S]*?)<\/h3>/g, (full, attrs, inner) => {
  if (/\bid=/.test(attrs)) return full;
  let slug = inner.replace(/<[^>]+>/g,'').trim().toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g,'-').replace(/^-+|-+$/g,'');
  if (!slug) slug = 'h3';
  h3Counter[slug] = (h3Counter[slug]||0)+1;
  if (h3Counter[slug]>1) slug += '-'+h3Counter[slug];
  return '<h3 id="'+slug+'"'+attrs+'>'+inner+'</h3>';
});
console.log('content bytes:', content.length, '| sections:', (content.match(/<section id=/g)||[]).length);

// ---------- 4. Build sidebar tree (OpenAI grouping + Cancri sections) ----------
const sidebarGroups = [
  {title:'开始使用', items:[['概述','intro'],['快速开始','quickstart'],['认证','auth'],['列出模型','models'],['SDK','sdk']]},
  {title:'核心概念', items:[['易混淆点','common-misunderstandings'],['Chat Completions','chat'],['Messages（Anthropic 协议）','messages'],['Responses（OpenAI 新协议）','responses']]},
  {title:'CLI 接入', items:[['Codex CLI','cli-codex'],['Claude Code','cli-claude'],['OpenCode','cli-opencode'],['OpenClaw','cli-openclaw'],['Aider','cli-aider']]},
  {title:'客户端接入', items:[['Cherry Studio','client-cherry'],['SillyTavern','client-sillytavern'],['CC Switch','client-ccswitch'],['Chatbox','client-chatbox'],['LobeChat','client-lobechat'],['Cursor','client-cursor'],['Cline','client-cline'],['Continue','client-continue'],['常见问题','client-faq']]},
  {title:'配额与限制', items:[['配额机制','quota'],['免费档保护机制','quota-anti-freeloading'],['速率限制','ratelimit']]},
  {title:'参考', items:[['错误码','errors'],['FAQ','faq']]},
];
function sidebarTree(){
  let out='';
  sidebarGroups.forEach((g,gi)=>{
    out += `<div><h3 class="mb-2 ml-3 mt-6 text-sm font-semibold select-none">${g.title}</h3><ul class="flex flex-col gap-0.25 text-sm text-default w-full">`;
    g.items.forEach(([label,id])=>{
      out += `<li><a href="api_docs_detail.html#${id}" class="px-3 py-1.5 w-full rounded-[8px] transition-colors text-default pl-5 block hover:text-default hover:bg-primary-ghost-hover"><span class="line-clamp-2">${label}</span></a></li>`;
    });
    out += `</ul></div>`;
  });
  return out;
}

// ---------- 5. Build right TOC from h2/h3 ----------
function buildToc(){
  // walk sections: each section has h2 (id=section id) + optional h3[id]
  const items=[];
  const secRe=/<section id="([^"]+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<section id=|<nav class="docs-pager"|$)/g;
  let m;
  while((m=secRe.exec(content))!==null){
    const id=m[1], title=m[2].replace(/<[^>]+>/g,'').trim();
    items.push({id,title,level:2});
    // h3 within this section
    const body=m[3]||'';
    const h3Re=/<h3[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g;
    let h3m;
    while((h3m=h3Re.exec(body))!==null){
      items.push({id:h3m[1], title:h3m[2].replace(/<[^>]+>/g,'').trim(), level:3});
    }
  }
  let out='<aside class="cnc-toc hidden xl:block w-[200px] shrink-0"><h4>本页内容</h4><ul>';
  items.forEach(it=>{ out += `<li class="${it.level===3?'cnc-toc-h3':''}"><a href="#${it.id}" data-toc-target="${it.id}">${it.title}</a></li>`; });
  out += '</ul></aside>';
  return {out, items};
}
const toc = buildToc();
console.log('TOC items:', toc.items.length);

// ---------- 6. Shell parts from live HTML ----------
const body = liveHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
function sliceBetween(s, startMarker, endMarker){ const i=s.indexOf(startMarker); if(i<0)return null; const j=s.indexOf(endMarker,i+startMarker.length); if(j<0)return null; return s.slice(i,j); }
let header = sliceBetween(body, '<header id="header"', '</header>') + '</header>';
// swap logo -> VAI-logo.svg inline (cleaned, currentColor) + Nexus scroll collapse
const vaiSvgInline = read('_tmp_vai_cleaned.svg').trim();
header = header.replace(/<img[^>]*alt="OpenAI Developers"[^>]*>/, '<a href="api_docs_oai.html" class="cancri-brand" data-cancri-brand aria-label="NexusVAI 首页"><span class="cancri-brand__icon">' + vaiSvgInline + '</span><span class="cancri-brand__word-wrap"><span class="cancri-brand__word">Nexus</span></span></a>');
// === Rebuild desktop nav with Cancri content (preserve exact CSS classes) ===
const chevronSvg = '<svg viewBox="0 0 24 24" fill="none" xmlns="https://w3org.cn/2000/svg" class="h-3.5 w-3.5 text-tertiary astro-3ef6ksr2 "><path d="M11.2929 16.2929C11.6834 16.6834 12.3166 16.6834 12.7071 16.2929L18.7071 10.2929C19.0976 9.90237 19.0976 9.26921 18.7071 8.87868C18.3166 8.48816 17.6834 8.48816 17.2929 8.87868L12 14.1716L6.70711 8.87868C6.31658 8.48816 5.68342 8.48816 5.29289 8.87868C4.90237 9.26921 4.90237 9.90237 5.29289 10.2929L11.2929 16.2929Z" fill="currentColor"></path></svg>';
const dropdownPanelCls = 'invisible opacity-0 absolute left-0 top-full z-50 mt-2 min-w-full w-max transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 before:content-[&#39;&#39;] before:absolute before:-top-2 before:left-0 before:right-0 before:h-2 astro-3ef6ksr2';
const dropdownInnerCls = 'overflow-hidden rounded-md border border-primary-surface bg-surface shadow-md ring-1 ring-black/5 dark:ring-white/10 astro-3ef6ksr2';
const menuItemCls = 'block px-4 py-3 text-sm text-default transition-colors hover:bg-primary-soft-alpha dark:hover:bg-alpha-10 hover:text-default astro-3ef6ksr2';

function navItem(link, label, active) {
  return `<div class="relative group astro-3ef6ksr2"> <a href="${link}" class="flex items-center gap-1 text-sm px-2.5 py-1 rounded-md ${active?'text-default bg-primary-soft':'text-primary-soft hover:text-default hover:bg-primary-soft-alpha'} astro-3ef6ksr2">${label}</a> </div>`;
}
function navDropdown(link, label, items, active) {
  const menuItems = items.map(([href,title,desc]) =>
    `<a role="menuitem" href="${href}" class="${menuItemCls}"> <div class="flex flex-col gap-1 astro-3ef6ksr2"> <div class="font-medium astro-3ef6ksr2">${title}</div> <div class="text-sm text-secondary astro-3ef6ksr2"> ${desc} </div> </div> </a>`
  ).join('');
  return `<div class="relative group astro-3ef6ksr2"> <a href="${link}" class="flex items-center gap-1 text-sm px-2.5 py-1 rounded-md ${active?'text-default bg-primary-soft':'text-primary-soft hover:text-default hover:bg-primary-soft-alpha'} astro-3ef6ksr2" aria-haspopup="menu">${label}${chevronSvg} </a> <div class="${dropdownPanelCls}" role="menu"> <div class="${dropdownInnerCls}"> ${menuItems} </div> </div> </div>`;
}

const cancriNav = `<nav class="hidden md:flex items-center justify-center gap-1 astro-3ef6ksr2"> ${
  navItem('api/index.html', '首页', false)
} ${
  navDropdown('api_docs_oai.html', 'API', [
    ['api_docs_oai.html', '概述', 'Cancri API 平台概览与快速入门'],
    ['api_docs_detail.html', '文档', 'Cancri API 的指南和概念'],
    ['api_models.html', 'API 参考', '端点、参数和响应'],
  ], true)
} ${
  navDropdown('api_docs_detail.html#cli-codex', 'CLI 接入', [
    ['api_docs_detail.html#cli-codex', 'Codex CLI', '通过 Codex CLI 接入 Cancri'],
    ['api_docs_detail.html#cli-claude', 'Claude Code', '通过 Claude Code 接入 Cancri'],
    ['api_docs_detail.html#cli-aider', 'Aider', '通过 Aider 接入 Cancri'],
  ], false)
} ${
  navDropdown('api_docs_detail.html#client-cherry', '客户端', [
    ['api_docs_detail.html#client-cherry', 'Cherry Studio', '桌面客户端接入指南'],
    ['api_docs_detail.html#client-sillytavern', 'SillyTavern', '角色扮演前端接入'],
    ['api_docs_detail.html#client-cursor', 'Cursor', 'IDE 集成接入'],
  ], false)
} ${
  navDropdown('api_docs_detail.html#faq', '资源', [
    ['api_models.html', '模型列表', '可用模型与定价'],
    ['api_docs_detail.html#quota', '配额机制', '积分与速率限制'],
    ['api_docs_detail.html#errors', '错误码', 'API 错误码参考'],
    ['api_docs_detail.html#faq', 'FAQ', '常见问题解答'],
  ], false)
} </nav>`;

// Replace the entire desktop nav block
const navStart = header.indexOf('<nav class="hidden md:flex');
const navEnd = header.indexOf('</nav>', navStart);
header = header.slice(0, navStart) + cancriNav + header.slice(navEnd + 6);

// give the search button an id for JS
header = header.replace(/(<button[^>]*class="[^"]*min-w-52[^"]*")/, '$1 id="header-search-open"');
// console button link
header = header.replace(/href="https:\/\/platform\.openai\.com\/login"/g, 'href="api_keys.html"');

// search overlay: keep structure, swap branding text
let search = sliceBetween(body, '<div id="header-search-overlay"', '<div id="drawer"');
// swap placeholder
search = search.replace(/placeholder="Start searching"/g, 'placeholder="搜索文档"');
// swap recommended chips (OpenAI terms -> Cancri terms)
search = search.replace(/data-search-query="responses create">responses create/g, 'data-search-query="认证">认证');
search = search.replace(/data-search-query="reasoning_effort">reasoning_effort/g, 'data-search-query="Chat Completions">Chat Completions');
search = search.replace(/data-search-query="realtime">realtime/g, 'data-search-query="配额机制">配额机制');
search = search.replace(/data-search-query="prompt caching">prompt caching/g, 'data-search-query="Codex CLI">Codex CLI');

// drawer: rebuild minimal with Cancri tree
const drawerShell = `<div id="drawer" class="fixed inset-0 z-40 flex flex-col bg-surface transform translate-x-full transition-transform duration-300 md:hidden">
  <div class="flex flex-col h-full w-full">
    <div class="px-6 pt-6 w-full mt-16">
      <span id="mobile-nav-primary-label" class="sr-only">主导航</span>
      <div class="flex items-center gap-2">
        <nav class="min-w-0 flex-1 flex items-center gap-2 overflow-x-auto pb-2 -mx-1 px-1" role="tablist">
          <button class="shrink-0 rounded-full border border-primary-surface px-3.5 py-1.5 text-sm text-default bg-primary-soft" role="tab" aria-selected="true">API 文档</button>
          <a href="api/index.html" class="shrink-0 rounded-full border border-primary-surface px-3.5 py-1.5 text-sm text-secondary transition-colors">首页</a>
          <a href="api_models.html" class="shrink-0 rounded-full border border-primary-surface px-3.5 py-1.5 text-sm text-secondary transition-colors">模型</a>
          <a href="api_keys.html" class="shrink-0 rounded-full border border-primary-surface px-3.5 py-1.5 text-sm text-secondary transition-colors">Keys</a>
        </nav>
        <button id="drawer-theme-button" class="shrink-0 mb-2 rounded-full border border-primary-surface p-2 text-secondary transition-colors" aria-label="切换主题">
          <svg viewBox="0 0 24 24" fill="none" class="h-5 w-5"><path d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36 6.36-1.42-1.42M7.05 7.05 5.64 5.64m12.72 0-1.41 1.41M7.05 16.95l-1.41 1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
    <div class="flex-1 w-full overflow-y-auto px-6 py-4 flex flex-col gap-6">
      <div class="flex flex-col gap-3">
        ${sidebarGroups.map(g=>`<h3 class="text-xs tracking-wide text-secondary mt-4">${g.title}</h3><ul class="flex flex-col gap-1 text-sm text-default w-full">${g.items.map(([l,id])=>`<li><a href="api_docs_detail.html#${id}" class="px-3 py-1.5 rounded-lg transition-colors block hover:text-default hover:bg-primary-ghost-hover">${l}</a></li>`).join('')}</ul>`).join('')}
      </div>
    </div>
  </div>
</div>`;

// ---------- 7. Assemble ----------
// Common head builder
function buildHead(title, canonical) {
  return `<!DOCTYPE html>
<html lang="zh-hans" class="dark" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Cancri 开放平台文档">
<link rel="icon" type="image/svg+xml" href="assets/VAI-logo.svg">
<link rel="canonical" href="${canonical}">
<link rel="preload" href="https://cdn.openai.com/common/fonts/openai-sans/v2/OpenAISans-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="https://cdn.openai.com/common/fonts/openai-sans/v2/OpenAISans-Bold.woff2" as="font" type="font/woff2" crossorigin>
<title>${title}</title>
<style>${allCss}</style>
</head>`;
}

// Extract quickstart code sample from content for overview page
// The code-block has nested divs, so we need to find the matching closing </div>
function extractCodeBlock(html) {
  const start = html.indexOf('<div class="cnc-code-block">');
  if (start < 0) return '';
  let depth = 0, i = start;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[0] === '<div') depth++;
    else { depth--; if (depth === 0) return html.slice(start, m.index + m[0].length); }
  }
  return '';
}
const qsCodeSample = extractCodeBlock(content);

// Extract video element from introPart (poster img already removed)
const videoMatch = introPart.match(/<video[\s\S]*?<\/video>/);
const videoEl = videoMatch ? videoMatch[0] : '';

// === OVERVIEW PAGE (api_docs_oai.html) ===
const overviewMain = `<main class="min-w-0 flex-1">
  <section class="mx-auto w-full max-w-6xl px-4 py-8 md:px-12 xl:px-4">
    <div class="flex flex-col gap-6 md:gap-7">
      <div>
        <h1 class="m-0 heading-2xl md:heading-2xl text-[var(--color-text-emphasis)]">Cancri API 平台</h1>
      </div>
      <div class="prose max-w-none">
        <p>Cancri API 在一个端点后面统一了 GPT、Claude、Gemini、DeepSeek、GLM、Qwen 等模型，<strong>同一把 Key，三种协议</strong>。优先选择客户端原生支持的协议；IDE/Agent 的厂商托管模式不会自动继承这个自定义网关。</p>
      </div>
      <div class="cnc-quickstart-card">
        <div class="flex flex-col gap-6 lg:flex-row lg:items-center">
          <div class="flex max-w-sm flex-col gap-3">
            <h2 class="text-lg font-semibold text-[var(--color-text-emphasis)] m-0">开发者快速入门</h2>
            <p class="text-sm text-[var(--color-text-secondary)] m-0">在几分钟内发送您的第一个 API 请求。了解 Cancri API 平台的基础知识。</p>
            <div class="flex flex-wrap gap-2 pt-1">
              <a href="api_docs_detail.html#quickstart" class="cnc-quickstart-btn cnc-quickstart-btn--primary">开始使用</a>
              <a href="api_keys.html" class="cnc-quickstart-btn cnc-quickstart-btn--secondary">创建 API 密钥</a>
            </div>
          </div>
          <div class="w-full flex-1">
            ${qsCodeSample}
          </div>
        </div>
      </div>
      <div class="cnc-overview-video">
        ${videoEl}
      </div>
      <div class="prose max-w-none">
        <h2>三种协议，一个入口</h2>
        <table>
          <thead><tr><th>路径</th><th>协议</th><th>适合的客户端</th></tr></thead>
          <tbody>
            <tr><td>POST /v1/chat/completions</td><td>OpenAI Chat Completions</td><td>openai SDK、LangChain、LiteLLM、OpenCode 等</td></tr>
            <tr><td>POST /v1/responses</td><td>OpenAI Responses</td><td>Codex CLI（默认协议）</td></tr>
            <tr><td>POST /v1/messages</td><td>Anthropic Messages</td><td>Claude Code、@anthropic-ai/sdk、OpenClaw</td></tr>
          </tbody>
        </table>
        <div class="cnc-endpoint">
          <span style="color:var(--color-text-secondary)">Base URL：</span>
          <span id="base-url">https://chat.nexusvai.xyz/functions/v1/api-gateway</span>
          <button class="cnc-copy-icon" data-copy-text="base-url">复制</button>
        </div>
        <p>更多内容请查看 <a href="api_docs_detail.html">完整 API 文档</a>。</p>
      </div>
    </div>
  </section>
</main>`;

const overviewWrapper = `<div class="pt-16">${overviewMain}</div>`;
const overviewHtml = buildHead('Cancri API 平台 · 概述', 'api_docs_oai.html') +
  '\n<body class="bg-surface text-default overflow-x-hidden">\n' +
  header + '\n' + search + '\n' + drawerShell + '\n' + overviewWrapper +
  '\n<script>' + allJs + '</script>\n</body>\n</html>';

fs.writeFileSync('api_docs_oai.html', overviewHtml, 'utf8');
console.log('WROTE api_docs_oai.html (overview) bytes:', overviewHtml.length);

// === DETAIL PAGE (api_docs_detail.html) ===
const sidebarHtml = `<div class="hidden md:flex md:flex-col w-[218px] px-3 pb-6 pt-2 md:fixed md:top-16 md:bottom-0 md:z-40 overflow-y-auto">
  <nav class="cnc-sidebar flex-1 overflow-y-auto overflow-x-visible">${sidebarTree()}</nav>
</div>`;

const detailMain = `<main class="min-w-0 flex-1 md:pl-[240px]">
  <section class="mx-auto w-full max-w-6xl px-4 py-8 md:px-12 xl:px-4">
    <div class="flex flex-col gap-6 md:gap-7">
      <div>
        <h1 class="m-0 heading-2xl md:heading-2xl text-[var(--color-text-emphasis)]">Cancri API 文档</h1>
      </div>
      <div class="flex gap-8">
        <div class="prose min-w-0 flex-1">
          ${content}
        </div>
        ${toc.out}
      </div>
    </div>
  </section>
</main>`;

const detailWrapper = `<div class="flex pt-16">${sidebarHtml}${detailMain}</div>`;
const detailHtml = buildHead('API 文档 · Cancri 开放平台', 'api_docs_detail.html') +
  '\n<body class="bg-surface text-default overflow-x-hidden">\n' +
  header + '\n' + search + '\n' + drawerShell + '\n' + detailWrapper +
  '\n<script>' + allJs + '</script>\n</body>\n</html>';

fs.writeFileSync('api_docs_detail.html', detailHtml, 'utf8');
console.log('WROTE api_docs_detail.html (detail) bytes:', detailHtml.length);
