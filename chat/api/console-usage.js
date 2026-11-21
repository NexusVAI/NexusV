/* Calendar ranges match the reporting timezone. Only full, in-range buckets feed both cards and plots. */
(function (root) {
  'use strict';
  const HOUR=3600000, DAY=24*HOUR, SH=8*HOUR;
  const date=ms=>new Date(ms+SH).toISOString().slice(0,10);
  const midnight=d=>Date.parse(d+'T00:00:00+08:00');
  const today=()=>date(Date.now());
  const num=n=>n==null?'—':Number(n).toLocaleString('zh-CN',{maximumFractionDigits:1});
  const money=m=>m==null?'—':'¥'+(m/1e6).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:m!==0&&Math.abs(m)<10000?6:2});
  const compact=n=>n>=1e6?num(n/1e6)+'M':n>=1000?num(n/1000)+'k':num(n);
  const metrics={requests:['请求数','calls',num],input:['输入 Token','tokens',num],tokens:['Token','tokens',num],cost:['费用','spend',money],wallet:['钱包扣费','spend',money],plan:['套餐抵扣','tokens',money]};
  const zero=()=>({requests:0,input:0,output:0,tokens:0,wallet:0,plan:0,cost:0});
  const sum=(a,b)=>a==null||b==null?null:a+b;
  function series(report, range, now=Date.now()) {
    const {start,end}=range, {unit,buckets}=report;
    const indexed=new Map(buckets.map(b=>[b.at,b])); const rows=[], total=zero();
    let t=start;
    while(t<end) {
      const d=new Date(t+SH), m=d.getUTCMonth(), year=d.getUTCFullYear();
      const at=unit==='hour'?Math.floor(t/HOUR)*HOUR:unit==='day'?midnight(date(t)):Date.UTC(year,m,1)-SH;
      const next=unit==='month'?Date.UTC(year,m+1,1)-SH:at+(unit==='hour'?HOUR:DAY);
      const b=indexed.get(at)||zero(), v={...b,tokens:b.input+b.output,cost:sum(b.wallet,b.plan)};
      const iso=date(at), hour=String(d.getUTCHours()).padStart(2,'0')+':00';
      const label=unit==='hour'?iso+' '+hour:unit==='month'?iso.slice(0,7):iso;
      rows.push({label,tick:unit==='hour'?hour:unit==='month'?label:iso.slice(5).replace('-','/'),v:at>now?null:v});
      if (at<=now) for(const key of Object.keys(total)) total[key]=sum(total[key],v[key]);
      t=next;
    }
    return {rows,total};
  }
  function plot(host,rows,key,small) {
    const [label,tone,format]=metrics[key];
    root.ConsoleTrend.render(host,rows.map(r=>({label:r.label,tick:r.tick,value:r.v?r.v[key]:null})),{label,tone,format,axis:format===money?money:compact,integer:format!==money,compact:small});
  }
  function dates(from,to) {return {start:midnight(from),end:midnight(to)+DAY};}
  function presets() {
    const d=today(), e=midnight(d)+DAY;
    return [['今天',d,d],['昨天',date(e-2*DAY),date(e-2*DAY)],['近 7 天',date(e-7*DAY),d],['本月',d.slice(0,8)+'01',d]];
  }
  function datePicker(button,changed) {
    let from=today(),to=from;
    const dialog=document.createElement('dialog'); dialog.className='cu-calendar'; dialog.setAttribute('aria-label','选择日期范围');
    dialog.innerHTML='<form><div class="cu-presets"></div><div class="cu-dates"><label>开始日期<input type="date" name="from" required></label><label>结束日期<input type="date" name="to" required></label></div><footer><button type="button" data-close>取消</button><button class="cu-primary">应用</button></footer></form>';
    document.body.append(dialog); const form=dialog.firstElementChild, a=form.elements.from,b=form.elements.to;
    function caption() {button.querySelector('[data-range-text]').textContent=from===to?from.replaceAll('-','/'):from.replaceAll('-','/')+' – '+to.replaceAll('-','/');}
    button.addEventListener('click',()=>{
      a.value=from;b.value=to; a.max=b.max=today(); b.min=a.value;
      const shortcuts=dialog.querySelector('.cu-presets');shortcuts.replaceChildren();
      for(const [text,s,e] of presets()) {const el=document.createElement('button');el.type='button';el.textContent=text;el.setAttribute('aria-pressed',String(s===from&&e===to));el.onclick=()=>{a.value=s;b.value=e;apply()};shortcuts.append(el);}
      dialog.showModal();button.setAttribute('aria-expanded','true');
      const rect=button.getBoundingClientRect(),w=dialog.offsetWidth,h=dialog.offsetHeight;
      dialog.style.left=Math.max(8,Math.min(rect.left,innerWidth-w-8))+'px';dialog.style.top=Math.max(8,Math.min(rect.bottom+7,innerHeight-h-8))+'px';
    });
    function apply(){b.min=a.value;if(!form.reportValidity())return;from=a.value;to=b.value;caption();dialog.close();changed(dates(from,to));}
    a.oninput=()=>{b.min=a.value};form.onsubmit=e=>{e.preventDefault();apply()};dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.onclose=()=>{button.setAttribute('aria-expanded','false');button.focus()};dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}};
    caption();
  }
  function stat(key,title,withPlot=true) {return `<section class="cu-stat"><h3>${title}</h3><strong data-value="${key}">—</strong>${withPlot?`<div class="cu-mini" data-plot="${key}"></div>`:''}</section>`;}
  function segment(name,options) {return `<div class="cu-seg" role="group" aria-label="${name}">${options.map(([key,label],i)=>`<button type="button" data-metric="${key}" aria-pressed="${!i}">${label}</button>`).join('')}</div>`;}
  function mount(page,call) {
    const panel=page==='usage'; let range=dates(today(),today()),generation=0, current=null, lower='requests',category=false, monthly=null;
    const cached=new Map();
    function load(r) {
      const id=r.start+':'+r.end; let entry=cached.get(id);
      if(!entry || Date.now()-entry.at>30000) {
        const promise=call('api_usage_report',r).then(res=>{if(!Array.isArray(res.buckets)||!['hour','day','month'].includes(res.unit))throw Error('report_unavailable');return series(res,r)});
        entry={at:Date.now(),promise};cached.set(id,entry);promise.catch(()=>{if(cached.get(id)===entry)cached.delete(id)});
      }
      return entry.promise;
    }
    let surface, monthEl, overviewCards=[], error, retry;
    if(panel) {
      surface=document.querySelector('.min-h-full.w-full.flex-col'); if(!surface)return;
      surface.classList.add('cu-page');
      surface.innerHTML='<header class="cu-head"><h1>用量</h1><div class="cu-toolbar"><span class="cu-project">默认项目</span><button type="button" class="cu-range" aria-label="选择日期范围" aria-expanded="false" aria-haspopup="dialog"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4"/></svg><span data-range-text></span><span aria-hidden="true">⌄</span></button></div></header><div class="cu-dashboard"><section class="cu-spending"><h2>总消耗</h2><strong data-value="cost">—</strong><div class="cu-large" data-plot="cost"></div></section><div class="cu-stats">'+stat('month','本月消耗',false)+stat('tokens','总 Token 数')+stat('requests','总请求数')+'</div></div><section class="cu-breakdown">'+segment('用量明细',[['cap','API 能力'],['fees','消耗分类']])+'<div class="cu-detail"><div class="cu-detail-head"><h2></h2><div data-lower-controls></div></div><div class="cu-medium" data-detail-plot></div></div></section>';
      datePicker(surface.querySelector('.cu-range'),query);
      monthEl=surface.querySelector('[data-value="month"]');
      surface.querySelector('.cu-breakdown > .cu-seg').onclick=e=>{if(!e.target.dataset.metric)return;category=e.target.dataset.metric==='fees';lower=category?'wallet':'requests';controls();paint()};
      function controls(){surface.querySelector('.cu-detail h2').textContent=category?'消耗分类':'Responses 与 Chat Completions';
        surface.querySelector('[data-lower-controls]').innerHTML=segment('图表指标',category?[['wallet','钱包扣费'],['plan','套餐抵扣']]:[['requests','请求数'],['input','输入 Token']]);
        surface.querySelectorAll('.cu-breakdown > .cu-seg button').forEach(b=>b.setAttribute('aria-pressed',String(category===(b.dataset.metric==='fees'))));}
      controls();surface.querySelector('[data-lower-controls]').onclick=e=>{if(!e.target.dataset.metric)return;lower=e.target.dataset.metric;paint()};
      const month=dates(today().slice(0,8)+'01',today());
      function loadMonth(){load(month).then(d=>{monthly=d.total.cost;monthEl.textContent=money(monthly)},()=>{monthEl.textContent='—'})}
      loadMonth(); retry=()=>{if(monthly==null)loadMonth();query(range)};
    } else {
      const rc=document.querySelector('.F5Sy7:has(button.VewWL)'); if(!rc)return;
      const defs=[['24h','24h'],['7d','7d'],['30d','30d']];
      const temp=document.createElement('div');temp.innerHTML=segment('用量时间范围',defs);const seg=temp.firstElementChild;rc.replaceWith(seg);
      function getRange(key) {const end=midnight(today())+DAY;if(key==='24h'){const until=Math.floor(Date.now()/HOUR)*HOUR+HOUR;return {start:until-DAY,end:until}}return {start:end-Number(key.slice(0,-1))*DAY,end};}
      range=getRange('30d');
      seg.onclick=e=>{const k=e.target.dataset.metric;if(!k)return;seg.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===e.target)));query(getRange(k))};
      seg.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.metric==='30d')));
      document.querySelectorAll('.flex.h-full.flex-col:has(.wfoF9)').forEach(card=>{
        const key=/token/i.test(card.textContent)?'tokens':'requests', host=card.querySelector('.wfoF9'),value=card.querySelector('.text-lg.font-semibold, .text-xl.font-semibold');
        host.className='cu-overview-plot';host.replaceChildren();overviewCards.push({key,host,value});
      });
      surface=seg.parentElement;retry=()=>query(range);
    }
    error=document.createElement('div');error.className='cu-error';error.hidden=true;error.setAttribute('role','status');
    const retryBtn=document.createElement('button');retryBtn.type='button';retryBtn.textContent='重试';retryBtn.onclick=retry;error.append('用量暂时无法载入。',retryBtn);
    if(panel)surface.querySelector('.cu-head').after(error);else surface.append(error);
    function paint(){
      const rows=current?.rows||[], total=current?.total;
      if(panel){surface.querySelectorAll('[data-value]:not([data-value="month"])').forEach(el=>{const k=el.dataset.value;el.textContent=metrics[k][2](total?.[k])});
        surface.querySelectorAll('[data-plot]').forEach(el=>plot(el,rows,el.dataset.plot,el.classList.contains('cu-mini')));
        const buttons=surface.querySelectorAll('[data-lower-controls] button');buttons.forEach(b=>{const k=b.dataset.metric;b.setAttribute('aria-pressed',String(lower===k));b.textContent=metrics[k][0]+' '+metrics[k][2](total?.[k]);});
        plot(surface.querySelector('[data-detail-plot]'),rows,lower,false);
      } else for(const {key,host,value} of overviewCards){if(value)value.textContent=num(total?.[key]);plot(host,rows,key,true)}
    }
    async function query(r){range=r;const ticket=++generation;current=null;error.hidden=true;surface.setAttribute('aria-busy','true');paint();
      try {const next=await load(r);if(ticket!==generation)return;current=next;paint()}catch{if(ticket===generation)error.hidden=false}finally{if(ticket===generation)surface.removeAttribute('aria-busy');}}
    query(range);
  }
  root.ConsoleUsage={mount};
})(window);
