const fs = require('fs');
const s = fs.readFileSync('cancri_chat.js', 'utf8');
const m = s.match(/var MODEL_CATALOG_FALLBACK = \[([\s\S]*?)\n\s*\];/);
if (!m) { console.log('NO MATCH'); process.exit(0); }
const ids = [...m[1].matchAll(/id:\s*['"]([^'"]+)['"]/g)].map(x => x[1]);
console.log('fallback count:', ids.length);
console.log('first 8:', ids.slice(0, 8));

// Check mapServerModelToCatalogEntry: does it copy canonicalId from server?
const mapFn = s.match(/function mapServerModelToCatalogEntry[\s\S]*?\n\s{2}\}\n/);
console.log('---mapServerModelToCatalogEntry---');
console.log(mapFn ? mapFn[0] : 'NOT FOUND');
