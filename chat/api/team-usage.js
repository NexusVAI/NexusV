/* Team permissions and daily buckets come from team_get; chart presentation is shared with personal usage. */
(function () {
  'use strict';
  const T=window.CancriTeam;
  if (!T) return;
  const metrics=[['cost','费用','spend',T.fmtCny],['tokens','Tokens','tokens',T.fmtTokens],['requests','请求','calls',T.fmtReq]];
  const ranges=[7,30];
  T.createUsageView=function () {
    const el=T.el, root=el('div','ctu'),head=el('div','ctu-head'),title=el('div','ctu-title'),controls=el('div','ctu-controls');
    let metric=0, range=1;
    title.append(el('h2',null,'团队用量'));
    const metricSeg=T.makeSegmented(metrics.map(m=>m[1]),'用量指标',i=>{metric=i;render()});
    const rangeSeg=T.makeSegmented(ranges.map(d=>d+' 天'),'时间范围',i=>{range=i;render()});
    controls.append(metricSeg.host,rangeSeg.host);head.append(title,controls);
    const body=el('div','ctu-body'),card=el('section','ctu-card'),stats=el('div','ctu-stats'),plot=el('div','ctu-plot'),dir=T.buildDirectory();
    const values=metrics.map(([key,label,tone])=>{const b=el('button','ctu-stat'),value=el('div','ctu-stat-value','—');b.type='button';b.dataset.tone=tone;b.append(el('div','ctu-stat-label',label),value);b.onclick=()=>{metric=metrics.findIndex(m=>m[0]===key);metricSeg.select(metric);render()};stats.append(b);return {b,value}});
    card.append(stats,plot);body.append(card,dir.el);root.append(head,body);
    function render() {
      if (!T.state.data) return;
      const days=ranges[range], [key,label,tone,fmt]=metrics[metric], members=T.state.data.members;
      const daily=new Map();
      for(const member of members) if(T.state.memberId===T.ALL_ID||member.id===T.state.memberId) {
        for(const d of (member.daily||[]).slice(-days)) {const item=daily.get(d.date)||{date:d.date,cost:0,requests:0,tokens:0};for(const [k] of metrics)item[k]+=Number(d[k])||0;daily.set(d.date,item)}
      }
      const rows=[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)); const totals=T.totals(rows,days);
      metrics.forEach(([k,,,f],i)=>{values[i].value.textContent=f(totals[k]);values[i].b.dataset.active=String(i===metric);values[i].b.setAttribute('aria-pressed',String(i===metric))});
      const ranked=members.map(member=>({member,t:T.totals(member.daily,days)})).sort((a,b)=>b.t[key]-a.t[key]);
      const max=ranked[0]?.t[key]||0,all={cost:0,tokens:0,requests:0};ranked.forEach(r=>metrics.forEach(([k])=>{all[k]+=r.t[k]}));
      const meta=t=>[T.fmtCny(t.cost),T.fmtReq(t.requests),T.fmtTokens(t.tokens)].join(' · ');
      dir.render({countText:members.length+' 人',allMeta:meta(all),rows:ranked.map(({member,t})=>({member,meta:meta(t),share:max?t[key]/max:0})),onPick:render});
      window.ConsoleTrend.render(plot,rows.map(d=>({tick:d.date.slice(5).replace('-','/'),label:d.date,value:d[key],detail:meta(d)})),{label:T.memberName(T.state.memberId)+' '+label,tone,format:fmt,axis:key==='requests'?T.fmtInt:fmt,integer:key!=='cost'});
    }
    new ResizeObserver(()=>{metricSeg.relayout();rangeSeg.relayout()}).observe(controls);
    return {el:root,show(){metricSeg.select(metric);rangeSeg.select(range);render()}};
  };
})();
