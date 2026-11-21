/* Local controls for the imported article body. No mirror shell, account UI or telemetry. */
(function () {
  const article=document.querySelector('#mainContent'); if(!article)return;
  const modes=[...article.querySelectorAll('[data-content-mode-switch][data-group="api-mode"]')];
  const active=document.querySelector('[data-api-toc]');
  function syncToc(){active?.querySelectorAll('li[data-id]').forEach(li=>{const h=document.getElementById(li.dataset.id);li.hidden=!!h?.closest('[hidden]')})}
  if(modes.length){
    const select=document.createElement('select');select.dataset.guideSwitchMode='';select.setAttribute('aria-label','API 协议');
    for(const [v,label] of [['responses','Responses API'],['chat','Chat Completions']])select.add(new Option(label,v));
    if(new URLSearchParams(location.search).get('api-mode')==='chat')select.value='chat';
    function apply(){const value=select.value;for(const pane of modes)pane.hidden=!JSON.parse(pane.dataset.ids).includes(value);syncToc()}
    select.onchange=()=>{const u=new URL(location.href);u.searchParams.set('api-mode',select.value);history.replaceState(null,'',u);apply()};article.prepend(select);apply();
  }
  for(const control of article.querySelectorAll('[data-guide-switch]')) {
    const box=control.closest('[data-content-switcher-root]');
    function select(){box.dataset.contentSwitcherValue=control.value;for(const pane of box.querySelectorAll('[data-content-switcher-pane]'))if(pane.closest('[data-content-switcher-root]')===box)pane.hidden=pane.dataset.value!==control.value;}
    control.addEventListener('change',()=>{select();syncToc()});select();
  }
  article.addEventListener('click',e=>{
    const copy=e.target.closest('[data-guide-copy]');
    if(copy){navigator.clipboard.writeText(copy.dataset.guideCopy).then(()=>{const label=copy.textContent;copy.textContent='已复制';setTimeout(()=>copy.textContent=label,1500)}).catch(()=>{});return;}
    const trigger=e.target.closest('[data-codex-screenshot-trigger]');if(!trigger)return;
    const img=Array.from(trigger.querySelectorAll('img')).find(i=>i.getBoundingClientRect().width>0);if(!img)return;
    const dlg=document.createElement('dialog');dlg.className='guide-zoom';dlg.setAttribute('aria-label',img.alt||'原图');
    const full=document.createElement('img');full.src=img.currentSrc||img.src;full.alt=img.alt;dlg.append(full);document.body.append(dlg);
    dlg.addEventListener('click',()=>dlg.close());dlg.addEventListener('close',()=>{dlg.remove();trigger.focus()});dlg.showModal();
  });
})();
