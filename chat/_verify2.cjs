const fs = require('fs');
const h = fs.readFileSync('api_docs_oai.html','utf8');
const cnt = (re) => (h.match(re)||[]).length;
console.log('cnc-alert--info:', cnt(/cnc-alert--info/g), '| leftover alert info:', cnt(/class="alert info"/g));
console.log('cnc-alert--warn:', cnt(/cnc-alert--warn/g), '| leftover alert warn:', cnt(/class="alert warn"/g));
console.log('cnc-code-tab:', cnt(/cnc-code-tab/g), '| leftover code-tab":', cnt(/class="code-tab"/g));
console.log('cnc-lang:', cnt(/cnc-lang/g), '| leftover lang":', cnt(/class="lang"/g));
console.log('cnc-endpoint:', cnt(/cnc-endpoint/g), '| leftover endpoint":', cnt(/class="endpoint"/g));
console.log('cnc-copy-icon:', cnt(/cnc-copy-icon/g), '| leftover copy-icon":', cnt(/class="copy-icon"/g));
console.log('cnc-method:', cnt(/cnc-method/g));
console.log('pre blocks total:', cnt(/<pre/g));
console.log('astro-island count:', cnt(/<astro-island/g));
// where are astro-islands? extract surrounding context
const ai=[...h.matchAll(/<astro-island[^>]*>/g)];
ai.forEach((m,i)=>{ const ctx=h.slice(m.index-40, m.index+160).replace(/\n/g,' '); console.log('  ['+i+'] ...',ctx,'...'); });
// search input present?
console.log('header-site-search-input:', cnt(/id="header-site-search-input"/g));
console.log('header-site-search (container):', cnt(/id="header-site-search"/g));
// is the search input inside astro-island? check order
const inpIdx=h.indexOf('id="header-site-search-input"');
const firstAi=h.indexOf('<astro-island');
console.log('first astro-island before input?', firstAi<inpIdx && inpIdx<h.indexOf('</astro-island>',firstAi));
