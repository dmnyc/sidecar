/* Stream metadata shares the title slot and the panel below the player. */
(() => {
  'use strict';
  function mount({dock,title,trigger,allowed,onOpen,onClose}) {
    const {t,tn,fmtNum,fmtDate}=SidecarI18n;
    const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls || '';if(text)n.textContent=text;return n;};
    const swap=el('span','t-text-swap');title.replaceWith(swap);swap.append(title);
    const panel=el('section','stream-about');panel.hidden=true;panel.id='stream-about';panel.setAttribute('aria-label',t('About stream'));
    const heading=el('h2'),description=el('p','stream-about-description'),started=el('p','stream-about-started'),categories=el('p','stream-about-categories');
    heading.dir=description.dir=categories.dir='auto';
    const header=el('div','stream-about-header');
    const back=el('button','stream-about-back');back.type='button';back.title=t('Back');back.setAttribute('aria-label',t('Back'));
    back.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14"/></svg>';
    header.append(back,heading);panel.append(header,description,started,categories);document.body.append(panel);
    let item=null,timer=null,transition=null,showRuntime=false;
    function duration(){
      const value=SidecarStreams.runtime(item?.starts);if(!value)return '';
      const values={days:fmtNum(value.days),hours:fmtNum(value.hours),minutes:fmtNum(value.minutes)};
      if(value.days)return tn('Live for {{count}} day','Live for {{count}} days',value.days);
      if(!value.hours)return value.minutes?tn('Live for {{count}} minute','Live for {{count}} minutes',value.minutes):t('Live for less than a minute');
      return value.minutes?t('Live for {{hours}}h {{minutes}}m',values):tn('Live for {{count}} hour','Live for {{count}} hours',value.hours);
    }
    function reduced(){return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.matches('.reduce-motion,.reduce-balance-motion');}
    function schedule(){clearTimeout(timer);if(item?.starts)timer=setTimeout(rotate,showRuntime?4000:12000);}
    function rotate(){
      if(!item)return;
      if(reduced() || document.hidden || trigger.matches(':hover,:focus-within')){showRuntime=false;title.textContent=item.title;schedule();return;}
      showRuntime=!showRuntime;
      swap.classList.add('is-exit');
      transition=setTimeout(()=>{
        if(!item)return;
        title.textContent=showRuntime?duration():item.title;
        title.toggleAttribute('dir',!showRuntime);if(!showRuntime)title.dir='auto';
        swap.classList.remove('is-exit');swap.classList.add('is-enter-start');void swap.offsetHeight;swap.classList.remove('is-enter-start');schedule();
      },parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-swap-dur')) || 150);
    }
    function position(){
      if(panel.hidden)return;
      const top=dock.getBoundingClientRect().bottom;
      let bottom=innerHeight;
      for(const id of ['relax-status','mining-status']){const node=document.getElementById(id);if(node?.getClientRects().length && !node.classList.contains('hidden'))bottom=Math.min(bottom,node.getBoundingClientRect().top);}
      panel.style.top=top+'px';panel.style.height=Math.max(0,bottom-top)+'px';
    }
    function close(restore=false){
      const wasOpen=!panel.hidden;panel.hidden=true;document.documentElement.classList.remove('stream-about-active');trigger.setAttribute('aria-expanded','false');
      if(wasOpen && restore){onClose?.();trigger.focus();}
    }
    function toggle(){
      if(!allowed() || !item)return;
      if(!panel.hidden){close(true);return;}
      onOpen?.();heading.textContent=item.title;description.textContent=item.summary || t('No stream description available.');
      started.textContent=item.starts?t('Started {{date}}',{date:fmtDate(new Date(item.starts*1000),{dateStyle:'medium',timeStyle:'short'})}):'';
      categories.textContent=(item.categories || []).map(x=>'#'+x).join(' · ');
      panel.hidden=false;document.documentElement.classList.add('stream-about-active');trigger.setAttribute('aria-expanded','true');position();back.focus();
    }
    back.onclick=()=>close(true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && !panel.hidden){e.preventDefault();close(true);}});
    window.addEventListener('resize',position);
    const observer=new ResizeObserver(position);observer.observe(dock);
    for(const id of ['relax-status','mining-status']){const n=document.getElementById(id);if(n){observer.observe(n);new MutationObserver(position).observe(n,{attributes:true,attributeFilter:['class','hidden']});}}
    trigger.setAttribute('aria-label',t('About stream'));trigger.title=t('About stream');trigger.setAttribute('data-i18n-title','About stream');trigger.setAttribute('data-i18n-aria-label','About stream');trigger.setAttribute('aria-controls',panel.id);
    return {toggle,close,set(next){clearTimeout(timer);clearTimeout(transition);swap.classList.remove('is-exit','is-enter-start');item=next;showRuntime=false;close();if(next){title.textContent=next.title;title.dir='auto';title.title=[next.title,duration()].filter(Boolean).join(' · ');schedule();}}};
  }
  window.SidecarStreamDetails={mount};
})();
