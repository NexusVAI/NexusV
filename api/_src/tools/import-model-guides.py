"""Import article bodies, not the mirror's navigation, tracking, inline scripts or account controls.
python -I api/_src/tools/import-model-guides.py <site> <verified-image-cache>
Run once to seed editable article sources. Refuses to replace an existing article.
"""
import hashlib, html, json, re, shutil, sys
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from bs4 import BeautifulSoup

SITE = Path(sys.argv[1]).resolve(); CACHE = Path(sys.argv[2]).resolve()
SRC = Path(__file__).resolve().parents[1]; API = SRC.parent
BASE = 'https://developers.openai.com'; PREFIX = '/api/assets/model-guides/'
GROUPS = json.loads((SRC/'model-guides.json').read_text('utf-8'))
ENTRIES = [item for group in GROUPS for item in group['items']]
ROUTES = {'/api/docs/guides/'+row[0]: '/api/docs/guides/'+row[-1]+'/' if len(row)==3 else '/api/docs/guides/'+row[0]+'/' for row in ENTRIES}
ROUTES.update({p:p+'/' for p in ['/api/docs/models','/api/docs/pricing','/api/docs/guides/model-selection','/api/docs/quickstart','/api/docs']})
IMAGES = json.loads((CACHE/'images.json').read_text('utf-8')); ENGINES = {}; VISITED = set()
WIDGETS = {'ImageTokenCalculator','GptImageTokenCalculator','ImageGallery','CodeGallery'}

def asset_name(url):
    name = IMAGES.get(url)
    if not name: return None
    src=(CACHE/name).resolve(); assert src.is_relative_to(CACHE) and src.is_file() and re.fullmatch(r'[a-f0-9]{20}\.(png|webp|jpe?g|gif|avif)',name)
    out=API/'assets/model-guides/img'/name;out.parent.mkdir(parents=True,exist_ok=True)
    if not out.exists(): shutil.copyfile(src,out)
    return PREFIX+'img/'+name

def target(href, path):
    if href.startswith('#'): return href
    absolute=urljoin(BASE+path+'/',href); u=urlsplit(absolute)
    if u.scheme not in ('http','https'): return href if u.scheme=='mailto' else None
    if u.hostname=='developers.openai.com' and u.path.rstrip('/') in ROUTES:
        return ROUTES[u.path.rstrip('/')]+('?' + u.query if u.query else '')+('#' + u.fragment if u.fragment else '')
    return asset_name(absolute) or absolute

def unpack(v):
    if isinstance(v,dict): return {k:unpack(w) for k,w in v.items()}
    if isinstance(v,list):
        if len(v)<2: return None
        return [unpack(x) for x in v[1]] if v[0]==1 else unpack(v[1])
    return v

def engine(name):
    if name in VISITED: return
    assert re.fullmatch(r'[\w.-]+\.js',name);VISITED.add(name)
    text=(SITE/'_astro'/name).read_text('utf-8')
    if name.startswith('helpers.'):
        # UI helpers need only the two feature flags, not the original site's bundled build environment.
        text=re.sub(r'\bQ=\{ASSETS_PREFIX:.*?SSR:!1\},et=', 'Q={DEV:false,MODE:"production"},et=',text,flags=re.S)
        if 'PUBLIC_VERCEL_' in text: raise ValueError('Unexpected widget build metadata; review before importing')
    for dep in set(re.findall(r'(?:from\s*|import\s*\(?\s*)["\'`]\./([\w.-]+\.js)(?:\?[^"\'`]*)?["\'`]',text)): engine(dep)
    text=re.sub(r'(?<=\.js)\?dpl=[\w-]+','',text)
    def url(m):
        quote,src=m.groups()
        if src.startswith('/images/') or src.startswith('https://cdn.openai.com/'):
            absolute=urljoin(BASE,src);return quote+(asset_name(absolute) or absolute)+quote
        if src.rstrip('/') in ROUTES: return quote+ROUTES[src.rstrip('/')]+quote
        return m.group(0)
    text=re.sub(r'(["\'`])((?:/images/|/api/docs/|https://cdn\.openai\.com/)[^"\'`\s$]+)\1',url,text)
    out=API/'assets/model-guides/widgets'/name;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(text,encoding='utf-8')

def article(row):
    slug,title,*alias=row; local=alias[0] if alias else slug; path='/api/docs/guides/'+slug
    doc=BeautifulSoup((SITE/path.lstrip('/')/'index.html').read_bytes(),'html.parser'); a=doc.select_one('article#mainContent'); assert a
    def tag(name,text=None,**attrs):
        t=doc.new_tag(name,attrs=attrs)
        if text is not None: t.string=text
        return t
    samples={}; widgets=False
    for node in a.select('script,style,iframe,object,embed,link,base,form,template') :node.decompose()
    for i in list(reversed(a.select('astro-island'))):
        if not i.parent:continue
        file=urlsplit(i['component-url']).path.rsplit('/',1)[-1]; kind=file.split('.')[0]; exp=i.get('component-export','default');props=unpack(json.loads(i.get('props','{}')))
        if 'CodeSample' in (kind,exp) or kind=='QuickstartCodeSample':
            code=props['code']; code={props.get('language','text'):code} if isinstance(code,str) else code
            assert isinstance(code,dict); ordered=sorted(code,key=lambda k:k!=props.get('defaultLanguage'))
            raw='<code-tabs title="'+html.escape(props.get('title') or '',quote=True)+'">\n'
            for lang in ordered:
                content=code[lang].replace('{{MODEL}}','gpt-6-astra');assert '</pre>' not in content
                raw+='<pre data-lang="'+html.escape(lang,quote=True)+'">'+content+'</pre>\n'
            key='GUIDECODESAMPLE'+str(len(samples))+'END';samples[key]=raw+'</code-tabs>';i.replace_with(key)
        elif kind=='SwitcherSelector':
            select=tag('select',**{'data-guide-switch':'','aria-label':props.get('ariaLabel') or '切换示例'})
            for opt in props['options']:
                item=tag('option',opt['label'],value=opt['value']);select.append(item)
                if opt['value']==props['initialValue']:item['selected']=''
            i.replace_with(select)
        elif kind in ('Expander','DeepDive'):
            contents=i.select_one('.expn-content,.deep-dive-content');assert contents
            details=tag('details',**{'class':'guide-disclosure'});details.append(tag('summary',props.get('label') or props.get('title') or '展开'))
            for node in list(contents.contents):details.append(node.extract())
            i.replace_with(details)
        elif kind in WIDGETS:
            renderer=urlsplit(i['renderer-url']).path.rsplit('/',1)[-1]; engine(file);engine(renderer)
            ENGINES[kind]=[file,exp,renderer];widgets=True
            i.name='div';i.attrs={'data-guide-widget':kind,'data-props':json.dumps(props,separators=(',',':')),'prefix':i.get('prefix',''),'ssr':''}
        elif kind=='CopyButton':
            button=i.select_one('button');button['data-guide-copy']=props.get('copyValue','');i.unwrap()
        else:i.unwrap()
    for e in a.select('astro-slot,astro-static-slot'):e.unwrap()
    for h in a.select('h2,h3,h4'):
        for b in h.select('button'):b.decompose()
        value=h.get_text(' ',strip=True);h.clear();h.string=value;h.attrs={'id':h.get('id') or re.sub(r'[^a-z0-9]+','-',value.lower()).strip('-')}
    for name in {h['id'] for h in a.select('h2[id],h3[id],h4[id]')}:
        headers=a.find_all(['h2','h3','h4'],id=name)
        default=next((h for h in headers if not h.find_parent(hidden=True)),headers[0])
        for n,h in enumerate(headers,1):
            if h is default:continue
            pane=h.find_parent(attrs={'data-content-switcher-pane':True}) or h.find_parent(attrs={'data-content-mode-switch':True})
            alias=name+'-'+str(n);h['id']=alias
            if pane:
                for anchor in pane.find_all('a',href='#'+name):anchor['href']='#'+alias
    for el in a.select('a[href]'):
        dest=target(el['href'],path)
        if dest: el['href']=dest
        else:del el['href']
        if el.get('target')=='_blank':el['rel']='noopener noreferrer'
    for img in a.select('img[src]'):
        url=urljoin(BASE,img['src']);dest=asset_name(url)
        img['src']=dest or url;img['loading']='lazy';img['referrerpolicy']='no-referrer'
        if not dest:img['data-guide-original']=url
        img.attrs.pop('srcset',None)
    for el in a.find_all(True):
        for k in list(el.attrs):
            if k.startswith('on') or k in ('srcdoc','formaction','action','autofocus','nonce'):del el[k]
        if el.name=='svg' and 'viewbox' in el.attrs:el['viewBox']=el.attrs.pop('viewbox')
    description=doc.select_one('meta[name=description]');description=description['content'].replace('\n',' ').strip() if description else ''
    # Strip the outer header; title/lead, TOC and prev/next come from our normal docs layout.
    body=a.decode_contents(formatter='minimal');
    for k,val in samples.items():body=body.replace(k,val)
    out=SRC/'pages/docs/guides'/f'{local}.html';out.parent.mkdir(parents=True,exist_ok=True)
    js='/api/assets/model-guide.js'+(', /api/assets/model-guides/widgets/boot.js' if widgets else '')
    content='---\ntitle: '+title+'\ndescription: '+description+'\ntab: models\nlead: false\ncss: /api/assets/oai/markdown.css, /api/assets/oai/select.css, /api/assets/oai/segmented.css, /api/assets/model-guides/widgets/gallery.css\njs: '+js+'\n---\n<!-- OpenAI Developers mirror: '+BASE+path+' (reference copy for local review). -->\n'+body.strip()+'\n'
    if out.exists():
        if content!=out.read_text('utf-8'):sys.exit(f'Existing article: {out}; refusing to overwrite')
    else:out.write_text(content,encoding='utf-8')

for row in ENTRIES:article(row)
folder=API/'assets/model-guides/widgets'
imports=['(async function () {']
imports+=['const widgets='+json.dumps(ENGINES)+';', 'const roots=[...document.querySelectorAll("[data-guide-widget]")];','await Promise.all(roots.map(async el=>{','  el.inert=true; el.setAttribute("aria-busy","true");','  const [file, name, renderer] = widgets[el.dataset.guideWidget];','  const [component, client] = await Promise.all([import("./"+file),import("./"+renderer)]);','  const mounted=new MutationObserver(()=>{mounted.disconnect();el.inert=false;el.removeAttribute("aria-busy");el.dataset.guideReady="true";});','  mounted.observe(el,{childList:true});','  client.default(el)(component[name], JSON.parse(el.dataset.props), {}, {client:"only"});','}));', '})();']
(folder/'boot.js').write_text('\n'.join(imports),encoding='utf-8');(folder/'gallery.css').write_text('\n'.join(p.read_text('utf-8') for p in sorted((SITE/'_astro').glob('Gallery.*.css'))),encoding='utf-8')
print('Imported',len(ENTRIES),'guide bodies;',len(VISITED),'local widget dependencies.')
