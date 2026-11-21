/* One responsive, keyboard-readable plot for the console. A null value is a gap, never zero. */
(function (root) {
  "use strict";
  const NS = 'http://www.w3.org/2000/svg';
  const plots = new WeakMap();
  function svg(tag, attrs, text) {
    const el = document.createElementNS(NS, tag);
    for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
    if (text != null) el.textContent = text;
    return el;
  }
  function draw(host, state) {
    const { points, options: o } = state;
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    const compact = !!o.compact, left = compact ? 4 : 51, right = compact ? 4 : 12;
    const top = compact ? 5 : 12, bottom = H - (compact ? 6 : 26), width = Math.max(1, W - left - right);
    const finite = points.filter(p => Number.isFinite(p.value));
    const peak = finite.reduce((m,p) => Math.max(m,p.value),0);
    const power = 10 ** Math.floor(Math.log10(peak || 1));
    const ceiling = ([1,2,2.5,5,10].find(step => step * power >= peak) || 10) * power;
    const max = o.integer ? Math.ceil(ceiling) : ceiling;
    const x = i => left + (points.length < 2 ? .5 : i / (points.length-1)) * width;
    const y = v => bottom - v / max * (bottom-top);
    const canvas = state.svg;
    canvas.replaceChildren(); canvas.setAttribute('viewBox',`0 0 ${W} ${H}`);
    const ticks = compact || !peak ? [0] : o.integer && max < 2 ? [0,max] : [0,o.integer ? Math.floor(max/2) : max/2,max];
    for (const v of ticks) {
      canvas.append(svg('line',{x1:left,x2:W-right,y1:y(v),y2:y(v),class:'ctr-grid'}));
      if (!compact) canvas.append(svg('text',{x:left-9,y:y(v)+4,'text-anchor':'end',class:'ctr-axis'},o.axis ? o.axis(v) : o.format(v)));
    }
    if (!compact && points.length) {
      const count = Math.min(points.length,Math.max(2,Math.min(7,Math.floor(width/76))));
      for (let k=0;k<count;k++) {
        const i=count===1?0:Math.round(k*(points.length-1)/(count-1));
        canvas.append(svg('text',{x:x(i),y:H-5,'text-anchor':count===1?'middle':k===0?'start':k===count-1?'end':'middle',class:'ctr-axis'},points[i].tick));
      }
    }
    for (let i=0;i<points.length;) {
      if (!Number.isFinite(points[i].value)) { i++; continue; }
      const first=i, coords=[];
      do { coords.push(`${x(i).toFixed(2)},${y(points[i].value).toFixed(2)}`); i++; } while(i<points.length && Number.isFinite(points[i].value));
      const last=i-1, line='M'+coords.join(' L');
      if (last>first) {
        if (peak && !compact) canvas.append(svg('path',{d:`${line} L${x(last)},${bottom} L${x(first)},${bottom} Z`,class:'ctr-area'}));
        canvas.append(svg('path',{d:line,class:'ctr-line'}));
      }
      if (last===first || compact) canvas.append(svg('circle',{cx:x(last),cy:y(points[last].value),r:3,class:'ctr-point'}));
    }
    const guide=svg('line',{y1:top,y2:bottom,class:'ctr-guide'}), dot=svg('circle',{r:4,class:'ctr-marker'});
    const cursor=svg('g',{visibility:'hidden'}); cursor.append(guide,dot); canvas.append(cursor);
    state.index=-1; state.tip.hidden=true;
    state.show=i=>{
      if (i<0 || i>=points.length) { cursor.setAttribute('visibility','hidden'); state.tip.hidden=true; state.index=-1; return; }
      const p=points[i], px=x(i); state.index=i; cursor.setAttribute('visibility','visible');
      guide.setAttribute('x1',px); guide.setAttribute('x2',px); dot.setAttribute('cx',px); dot.setAttribute('cy',Number.isFinite(p.value)?y(p.value):bottom);
      dot.style.display=Number.isFinite(p.value)?'':'none';
      state.tip.textContent=p.label+' · '+(p.detail || (o.label+' '+(p.value==null?'—':o.format(p.value))));
      state.tip.hidden=false;
      state.tip.style.left=Math.max(2,Math.min(W-state.tip.offsetWidth-2,px-state.tip.offsetWidth/2))+'px';
    };
    state.fromX=px=>Math.max(0,Math.min(points.length-1,Math.round((px-left)/width*(points.length-1))));
  }
  function render(host, points, options) {
    let state=plots.get(host);
    if (!state) {
      state={}; plots.set(host,state); host.classList.add('ctr'); host.tabIndex=0;
      state.svg=svg('svg',{'aria-hidden':'true'}); state.tip=document.createElement('output'); state.tip.className='ctr-tip'; state.tip.hidden=true;
      host.replaceChildren(state.svg,state.tip);
      host.addEventListener('pointermove',e=>state.show?.(state.fromX(e.clientX-host.getBoundingClientRect().left)));
      host.addEventListener('pointerdown',e=>state.show?.(state.fromX(e.clientX-host.getBoundingClientRect().left)));
      host.addEventListener('pointerleave',()=>state.show?.(-1)); host.addEventListener('blur',()=>state.show?.(-1));
      host.addEventListener('keydown',e=>{
        const n=state.points.length, i=state.index;
        const next={ArrowRight:Math.min(n-1,i+1),ArrowLeft:i<0?n-1:Math.max(0,i-1),Home:0,End:n-1,Escape:-1};
        if (Object.hasOwn(next,e.key)) {e.preventDefault();state.show?.(next[e.key]);}
      });
      state.observer=new ResizeObserver(()=>draw(host,state)); state.observer.observe(host);
    }
    state.points=points; state.options=options; host.dataset.tone=options.tone; host.dataset.compact=String(!!options.compact);
    host.setAttribute('role','group'); host.setAttribute('aria-label',options.label+'趋势'); draw(host,state);
  }
  root.ConsoleTrend={render};
})(window);
