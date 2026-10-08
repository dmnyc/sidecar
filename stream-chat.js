/* NIP-53 chat. The player owns visibility; the panel owns identity and signing. */
(function (root) {
  'use strict';
  const addressOK = value => /^30311:[a-f0-9]{64}:.*$/.test(value || '');
  function template(address, content, reply, decode=root.NostrTools?.nip19.decode) {
    if (!addressOK(address) || typeof content !== 'string' || !content.trim() || content.length > 4000) throw new Error('Invalid chat message');
    const tags = [['a', address]];
    if (reply && /^[a-f0-9]{64}$/.test(reply.id) && /^[a-f0-9]{64}$/.test(reply.pubkey)) tags.push(['e', reply.id], ['p', reply.pubkey]);
    if(decode)for(const part of contentParts(content,decode))if(part.pubkey && !tags.some(tag=>tag[0]==='p' && tag[1]===part.pubkey))tags.push(['p',part.pubkey]);
    return {kind:1311, created_at:Math.floor(Date.now()/1000), content:content.trim(), tags};
  }
  class Messages {
    constructor(address) { this.address=address;this.events=new Map(); }
    accept(event, verify) {
      if (event?.kind!==1311 || !Array.isArray(event.tags) || !event.tags.some(t=>Array.isArray(t) && t[0]==='a' && t[1]===this.address) || typeof event.content!=='string' || event.content.length>4000 || !Number.isSafeInteger(event.created_at) || event.created_at<0 || event.created_at>Date.now()/1000+60 || this.events.has(event.id) || !verify(event)) return false;
      this.events.set(event.id,event);
      if(this.events.size>1000)this.events.delete(this.rows()[0].id);
      return true;
    }
    rows() { return [...this.events.values()].sort((a,b)=>a.created_at-b.created_at || a.id.localeCompare(b.id)); }
  }
  function reactionTemplate(target,content){
    if(target?.kind!==1311 || !/^[a-f0-9]{64}$/.test(target.id) || !/^[a-f0-9]{64}$/.test(target.pubkey) || typeof content!=='string' || !content.trim() || content.length>64)throw new Error('Invalid reaction');
    return {kind:7,created_at:Math.floor(Date.now()/1000),content:content.trim(),tags:[['e',target.id],['p',target.pubkey],['k','1311']]};
  }
  class Reactions {
    constructor(){this.events=new Map();}
    accept(event,messages,verify){
      if(event?.kind!==7 || !Array.isArray(event.tags) || event.tags.some(t=>!Array.isArray(t)) || typeof event.content!=='string' || event.content.length>64 || !Number.isSafeInteger(event.created_at) || event.created_at<0 || event.created_at>Date.now()/1000+60 || this.events.has(event.id) || this.events.size>=10000)return false;
      const target=messages.get(event.tags.filter(t=>t[0]==='e').at(-1)?.[1]);
      const recipient=event.tags.filter(t=>t[0]==='p').at(-1)?.[1];
      if(!target || (recipient && recipient!==target.pubkey) || !verify(event))return false;
      this.events.set(event.id,event);return true;
    }
    groups(id,pubkey,muted=()=>false){
      const groups=new Map();
      for(const event of this.events.values()){
        if(event.tags.filter(t=>t[0]==='e').at(-1)?.[1]!==id || muted(event))continue;
        const content=event.content.trim(),key=content==='+' || !content?'❤️':content;
        // Count a person's repeated copies of the same reaction once.
        const group=groups.get(key) || {content:key,authors:new Set(),mine:false};
        group.authors.add(event.pubkey);group.mine ||= event.pubkey===pubkey;groups.set(key,group);
      }
      return [...groups.values()].map(g=>({content:g.content,count:g.authors.size,mine:g.mine})).sort((a,b)=>b.count-a.count || a.content.localeCompare(b.content));
    }
  }
  // Unlike querySync, preserve the distinction between an empty EOSE and failure.
  async function readPage(pool, sources, filter, signal, timeout=6500) {
    const core=root.SidecarStreams || (typeof require==='function'?require('./stream-core'):null);
    const results=await Promise.all(sources.map(relay=>core.relayPage(pool,relay,filter,signal,timeout)));
    return {events:[...new Map(results.flatMap(r=>r.events).map(e=>[e.id,e])).values()],complete:results.every(r=>r.complete),answered:results.filter(r=>r.complete).length};
  }
  // Tokenize without interpreting user content as markup.
  function contentParts(content, decode) {
    const parts=[];let last=0;
    const pattern=/https?:\/\/[^\s<>]+|(?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1[02-9ac-hj-np-z]+|(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu;
    for(const match of content.matchAll(pattern)){
      if(match.index>last)parts.push({text:content.slice(last,match.index)});
      let text=match[0],part={text};
      if(/^https?:/.test(text)){
        const clean=text.replace(/[.,!?;:)]+$/,'');
        try{const url=new URL(clean);part={text:url.host+(url.pathname==='/'?'':url.pathname).slice(0,36)+(url.search?'…':''),href:clean};}catch(_){}
        parts.push(part);if(clean.length<text.length)parts.push({text:text.slice(clean.length)});
      }else if(text.startsWith('#'))parts.push({text,hashtag:text.slice(1)});
      else {
        const entity=text.replace(/^nostr:/,'');
        try{const d=decode(entity);part={text,entity,type:d.type,pubkey:d.type==='npub'?d.data:d.type==='nprofile'?d.data.pubkey:null};}catch(_){}
        parts.push(part);
      }
      last=match.index+text.length;
    }
    if(last<content.length)parts.push({text:content.slice(last)});
    return parts;
  }
  function recentRows(messages,zaps,limit=50) {
    return [...new Map([...messages,...zaps].map(e=>[e.id,e])).values()]
      .sort((a,b)=>b.created_at-a.created_at || b.id.localeCompare(a.id)).slice(0,limit);
  }
  // Never let contenteditable import clipboard HTML or image/file nodes.
  function pastePlainText(event,insert) {
    event.preventDefault();event.stopPropagation();
    const text=event.clipboardData?.getData('text/plain') || '';
    if(text)insert(text);
  }
  function commentZapContext(event,nameFor=key=>SidecarStreams.cocktailName(key)){
    const context=document.createElement('div');context.className='stream-comment-zap-context';
    const label=document.createElement('strong');label.textContent=SidecarI18n.t('Zap comment');
    const excerpt=document.createElement('blockquote');excerpt.textContent=contentParts(event.content,NostrTools.nip19.decode).map(part=>part.pubkey?'@'+nameFor(part.pubkey):part.entity?SidecarI18n.t(part.type==='naddr'?'Linked event':'Linked note'):part.text).join('');excerpt.dir='auto';excerpt.title=event.content;
    context.append(label,excerpt);return context;
  }
  function mount(directory, getItem, allowed, onOpen, getZaps=()=>[], getTopZappers=()=>[]) {
    const {t}=SidecarI18n;
    const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
    const toggle=el('button','icon-btn');toggle.type='button';toggle.id='stream-chat-toggle';
    toggle.setAttribute('aria-label',t('Stream chat'));toggle.title=t('Stream chat');
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','stream-chat-panel');
    toggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/></svg>';
    document.getElementById('stream-info').append(toggle);
    const pane=el('section','stream-chat');pane.id='stream-chat-panel';pane.setAttribute('aria-label',t('Stream chat'));pane.hidden=true;
    const older=el('button','ghost',t('Older messages')),log=el('div','stream-chat-log'),notice=el('p','stream-chat-status'),newer=el('button','ghost',t('New messages'));
    const leaders=el('div','stream-top-zappers');leaders.setAttribute('aria-label',t('Top zappers'));leaders.setAttribute('role','region');leaders.tabIndex=0;leaders.hidden=true;
    newer.hidden=true;log.setAttribute('aria-label',t('Stream chat'));
    const form=el('form','stream-chat-form'),identity=el('div','stream-chat-identity'),replyLabel=el('div','stream-chat-reply'),send=el('button','primary');
    let input=el('textarea'),mentionEditor=null;
    const identityRow=el('div','stream-chat-identity-row'),hideChat=el('button','stream-chat-hide',t('Hide chat'));
    hideChat.type='button';hideChat.onclick=()=>{show(false);toggle.focus();};identityRow.append(identity,hideChat);
    const draftText=()=>mentionEditor?mentionEditor.getText():input.value;
    const clearDraft=()=>{if(mentionEditor)mentionEditor.setText('');else input.value='';};
    send.setAttribute('aria-label',t('Send'));send.title=t('Send');send.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v14"/></svg>';
    input.maxLength=4000;input.rows=2;input.placeholder=t('Write a message');input.setAttribute('aria-label',t('Write a message'));input.required=true;
    const replyText=el('span'),cancelReply=el('button','icon-btn');
    cancelReply.type='button';cancelReply.setAttribute('aria-label',t('Cancel reply'));cancelReply.title=t('Cancel reply');
    cancelReply.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    replyLabel.append(replyText,cancelReply);replyLabel.hidden=true;send.type='submit';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');form.append(identityRow,replyLabel,input,send,notice);pane.append(leaders,log,newer,form);document.body.append(pane);
    let pool=null,sub=null,model=null,run=0,reply=null,account=null,busy=false,historyBusy=false,profiles=new Map(),abort=null,retryTimer=null,paintTimer=null;
    let retryAttempt=0,visibleLimit=50,profileRetry=null,noticeTimer=null,reactions=new Reactions(),reactionPicker=null,reactionTimer=null;
    const reactionTargets=new Set(),reactionSubs=[],reactionPending=new Set();
    function setNotice(text,duration=0){
      clearTimeout(noticeTimer);noticeTimer=null;notice.textContent=text;
      if(duration)noticeTimer=setTimeout(()=>{noticeTimer=null;notice.textContent='';},duration);
    }
    function historyNotice(text){if(!busy && !noticeTimer)setNotice(text,text?7000:0);}
    function revealLatest(){newer.hidden=true;log.scrollTop=log.scrollHeight;}
    const profileAttempts=new Map();
    const sessions=new Map(),expanded=new Set();
    let profilePending=new Set(),profileQueue=new Set(),profileWorkers=0,profilePaintTimer=null,profileScrollTimer=null;
    const changedProfiles=new Set(),avatarNodes=new Map();let leaderSignature=null;
    const bridge=()=>root.SidecarStreamChatAccount;
    function sizeChat(){
      if(pane.hidden)return;
      const top=document.getElementById('stream-dock').getBoundingClientRect().bottom;
      let bottom=window.innerHeight;
      for(const id of ['relax-status','mining-status']){
        const bar=document.getElementById(id);
        if(bar && bar.getClientRects().length && !bar.classList.contains('hidden'))bottom=Math.min(bottom,bar.getBoundingClientRect().top);
      }
      pane.style.top=top+'px';pane.style.height=Math.max(0,bottom-top)+'px';
    }
    const sizeObserver=new ResizeObserver(sizeChat);
    for(const id of ['stream-dock','relax-status','mining-status']){const node=document.getElementById(id);if(node){sizeObserver.observe(node);new MutationObserver(sizeChat).observe(node,{attributes:true,attributeFilter:['class','hidden']});}}
    window.addEventListener('resize',sizeChat);
    const sources=()=>[...new Set([...(getItem()?.relays || []),'wss://relay.damus.io','wss://nos.lol','wss://relay.primal.net','wss://nostr.wine','wss://relay.snort.social'])];
    function stop(){run++;clearTimeout(profileScrollTimer);clearTimeout(profilePaintTimer);profilePaintTimer=null;changedProfiles.clear();reactionPicker?.remove();reactionPicker=null;clearTimeout(reactionTimer);reactionTimer=null;reactionSubs.splice(0).forEach(s=>s.close());reactionTargets.clear();clearTimeout(noticeTimer);noticeTimer=null;notice.textContent='';abort?.abort();clearTimeout(retryTimer);clearTimeout(profileRetry);clearTimeout(paintTimer);paintTimer=null;mentionEditor?.close();sub?.close();sub=null;pool?.destroy();pool=null;}
    function clearReply(){reply=null;replyLabel.hidden=true;}
    cancelReply.onclick=()=>{clearReply();input.focus();};
    function syncAccount(){
      const current=bridge()?.identity();
      if(account!==current?.pubkey){account=current?.pubkey || null;reactionPicker?.remove();reactionPicker=null;clearDraft();mentionEditor?.close();clearReply();}
      identity.textContent=current?t('Posting as {{name}}',{name:current.name}):t('Unlock to chat');
      const disabled=!account || busy || !allowed();
      input.disabled=send.disabled=disabled;
      if(mentionEditor){input.contentEditable=String(!disabled);input.setAttribute('aria-disabled',String(disabled));}
      return current;
    }
    const displayName=key=>{const name=profiles.get(key)?.name;return (typeof name==='string' && name.trim()) || SidecarStreams.cocktailName(key);};
    function avatar(picture,slot){
      let frame=avatarNodes.get(slot);
      if(!frame){frame=el('span','stream-chat-avatar');frame.setAttribute('aria-hidden','true');avatarNodes.set(slot,frame);if(avatarNodes.size>1500)avatarNodes.delete(avatarNodes.keys().next().value);}
      const url=SidecarStreams.httpsUrl(picture) || '';
      if(frame.dataset.picture===url)return frame;
      frame.dataset.picture=url;frame.replaceChildren();
      if(url){
        const image=el('img');image.alt='';image.referrerPolicy='no-referrer';image.hidden=true;image.decoding='async';
        image.onload=()=>{image.hidden=false;};image.onerror=()=>image.remove();image.src=url;frame.append(image);
      }
      return frame;
    }
    const profileKeys=events=>events.flatMap(e=>[e.pubkey,...contentParts(e.content || '',NostrTools.nip19.decode).map(p=>p.pubkey).filter(Boolean)]);
    function seedProfiles(events){
      const keys=[...new Set([...getTopZappers().map(e=>e.pubkey),...profileKeys(events)])];
      for(const [key,p] of bridge()?.cachedProfiles?.(keys) || [])if(!profiles.has(key))receivedProfile(key,p,run);
    }
    function updateProfileNodes(){
      profilePaintTimer=null;if(pane.hidden)return;
      const atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
      for(const author of log.querySelectorAll('.stream-chat-author')){
        const key=author.dataset.pubkey;if(!changedProfiles.has(key))continue;
        author.querySelector('.stream-chat-name').textContent=displayName(key);author.title=displayName(key);
        author.prepend(avatar(profiles.get(key)?.picture,author.dataset.avatarSlot));
      }
      for(const link of log.querySelectorAll('a[data-pubkey]'))if(changedProfiles.has(link.dataset.pubkey))link.textContent='@'+displayName(link.dataset.pubkey);
      for(const button of leaders.children){const key=button.dataset.pubkey;if(!changedProfiles.has(key))continue;
        button.title=t('{{name}} · {{sats}} sats',{name:displayName(key),sats:SidecarI18n.fmtNum(Number(button.dataset.sats))});button.setAttribute('aria-label',button.title);button.prepend(avatar(profiles.get(key)?.picture,'leader:'+key));
      }
      changedProfiles.clear();mentionEditor?.refreshSuggestions?.();if(atBottom)revealLatest();
    }
    function receivedProfile(key,profile,token){
      if(token!==run || profiles.get(key)===profile)return;profiles.set(key,profile);changedProfiles.add(key);
      if(!profilePaintTimer)profilePaintTimer=setTimeout(updateProfileNodes,50);
    }
    function richText(node,content){
      for(const part of contentParts(content,NostrTools.nip19.decode)){
        if(!part.href && !part.entity && !part.hashtag){node.append(document.createTextNode(part.text));continue;}
        const link=el('a','stream-chat-link');link.target='_blank';link.rel='noopener noreferrer';
        link.href=part.href || (part.hashtag?'https://primal.net/search/'+encodeURIComponent('#'+part.hashtag):'https://njump.me/'+part.entity);
        link.textContent=part.pubkey?'@'+displayName(part.pubkey):part.entity?(part.type==='naddr'?t('Linked event'):t('Linked note')):part.text;
        if(part.hashtag && bridge()?.openHashtag){
          bridge().hashtagUrl(part.hashtag).then(url=>{link.href=url;}).catch(()=>{});
          link.onclick=e=>{if(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)return;e.preventDefault();bridge().openHashtag(part.hashtag).catch(()=>{});};
        }
        if(part.pubkey){link.dataset.pubkey=part.pubkey;link.onclick=e=>{e.preventDefault();bridge()?.profile(part.pubkey);};}
        node.append(link);
      }
    }
    const visibleRows=()=>recentRows(model?.rows() || [],getZaps(),1000).filter(e=>!bridge()?.muted(e)).slice(0,visibleLimit).reverse();
    async function react(event,content,who=bridge()?.identity()?.pubkey){
      if(!allowed() || !who || bridge()?.identity()?.pubkey!==who)return;
      const key=who+':'+event.id+':'+content,token=run;
      if(reactionPending.has(key) || reactions.groups(event.id,who).some(g=>g.content===content && g.mine))return;
      reactionPending.add(key);setNotice(t('Sending reaction…'));
      try{
        const signed=await bridge().react(event,content,sources(),who);
        if(token!==run || bridge()?.identity()?.pubkey!==who)return;
        if(!reactions.accept(signed,model.events,NostrTools.verifyEvent) && !reactions.events.has(signed.id))throw new Error('Invalid reaction');
        paint();setNotice(t('Reacted {{reaction}}',{reaction:content}),2500);
      }catch(_){if(token===run && bridge()?.identity()?.pubkey===who)setNotice(t('Could not send reaction. Try again.'),7000);}
      finally{reactionPending.delete(key);}
    }
    function watchReactions(){
      if(!pool)return;
      const ids=visibleRows().filter(e=>e.kind===1311 && !reactionTargets.has(e.id)).map(e=>e.id),token=run;
      for(let i=0;i<ids.length;i+=25){
        const batch=ids.slice(i,i+25);batch.forEach(id=>reactionTargets.add(id));
        reactionSubs.push(pool.subscribeMany(sources(),{kinds:[7],'#e':batch,limit:1000},{onevent:event=>{
          if(token!==run || !reactions.accept(event,model.events,NostrTools.verifyEvent) || reactionTimer)return;
          reactionTimer=setTimeout(()=>{reactionTimer=null;if(token===run)paint();},150);
        }}));
      }
    }
    function paintLeaders(){
      const left=leaders.scrollLeft,focused=leaders.contains(document.activeElement)?document.activeElement.dataset.pubkey:null;
      const top=getTopZappers(),signature=top.map(e=>e.pubkey+':'+e.sats).join('|');
      if(signature===leaderSignature)return;leaderSignature=signature;leaders.replaceChildren();leaders.hidden=!top.length;
      for(const entry of top){
        const name=displayName(entry.pubkey),button=el('button','stream-top-zapper');button.type='button';button.dataset.pubkey=entry.pubkey;button.dataset.sats=entry.sats;
        button.title=t('{{name}} · {{sats}} sats',{name,sats:SidecarI18n.fmtNum(entry.sats)});button.setAttribute('aria-label',button.title);
        button.onclick=()=>bridge()?.profile(entry.pubkey);
        button.append(avatar(profiles.get(entry.pubkey)?.picture,'leader:'+entry.pubkey));
        button.append(el('span',null,'⚡ '+SidecarI18n.fmtNum(entry.sats,{notation:'compact',maximumFractionDigits:1})));leaders.append(button);
      }
      leaders.scrollLeft=left;
      if(focused)[...leaders.children].find(node=>node.dataset.pubkey===focused)?.focus({preventScroll:true});
    }
    function paint(preservePosition=false){
      if(!model)return;
      const atBottom=!preservePosition && log.scrollHeight-log.scrollTop-log.clientHeight<40,top=log.scrollTop;
      const anchor=[...log.querySelectorAll('article')].find(el=>el.getBoundingClientRect().bottom>log.getBoundingClientRect().top);
      const anchorId=anchor?.id,anchorOffset=anchor?.getBoundingClientRect().top;
      seedProfiles(visibleRows());paintLeaders();
      log.replaceChildren(older);let day='';const clamps=[];
      for(const event of visibleRows()){
        const date=new Date(event.created_at*1000),stamp=date.toDateString();
        if(day!==stamp){day=stamp;log.append(el('div','stream-chat-day',SidecarI18n.fmtDate(date,{year:'numeric',month:'short',day:'numeric'})));}
        const row=el('article','stream-chat-message'),head=el('div','stream-chat-head'),profile=profiles.get(event.pubkey);
        row.id='stream-chat-'+event.id;
        const author=el('button','stream-chat-author');author.type='button';author.dataset.pubkey=event.pubkey;author.dataset.avatarSlot='message:'+event.id;author.onclick=()=>bridge()?.profile(event.pubkey);
        const name=el('span','stream-chat-name',displayName(event.pubkey));name.dir='auto';author.append(name);author.title=displayName(event.pubkey);
        author.prepend(avatar(profile?.picture,author.dataset.avatarSlot));
        const time=el('time','stream-chat-time',SidecarI18n.fmtDate(date,{hour:'numeric',minute:'2-digit'}));time.dateTime=date.toISOString();time.title=SidecarI18n.fmtDate(date,{dateStyle:'full',timeStyle:'short'});
        const answer=el('button','icon-btn stream-chat-answer');answer.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 5-7 6 7 6M3 11h10a8 8 0 0 1 8 8"/></svg>';answer.type='button';answer.setAttribute('aria-label',t('Reply'));answer.onclick=()=>{reply=event;replyText.textContent=t('Replying to {{name}}',{name:profile?.name || author.textContent});replyLabel.hidden=false;input.focus();};
        const zap=el('button','icon-btn stream-chat-zap-action');zap.type='button';zap.setAttribute('aria-label',t(event.kind===9735?'Zap author':'Zap comment'));zap.title=zap.getAttribute('aria-label');
        const bolt=document.getElementById('stream-zap')?.querySelector('svg');if(bolt)zap.append(bolt.cloneNode(true));zap.onclick=()=>{if(allowed())bridge()?.zap(event);};
        const actions=el('div','stream-chat-actions');actions.append(answer,zap);
        const reactButton=el('button','icon-btn');reactButton.type='button';reactButton.title=t('React');reactButton.setAttribute('aria-label',t('React'));
        reactButton.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>';
        reactButton.onclick=()=>{const who=syncAccount()?.pubkey;if(!who || !allowed())return;reactionPicker?.remove();reactionPicker=bridge()?.pickReaction?.(pane,content=>react(event,content,who));};
        actions.prepend(reactButton);
        head.append(author,time);row.append(head);
        const body=el('p','stream-chat-body');body.dir='auto';richText(body,event.content);
        if(event.kind===9735){
          row.classList.add('stream-chat-zap');answer.remove();
          const amount=el('span','stream-chat-zap-amount',t('⚡ {{amount}} sats',{amount:SidecarI18n.fmtNum(event.sats)}));
          head.insertBefore(amount,time);
          if(event.content.trim()){body.title=event.content;body.tabIndex=0;row.append(body);}
          zap.onclick=()=>{if(allowed())bridge()?.zapRecipient?.(event.pubkey);};
        }else{
          const parentId=event.tags.find(tag=>tag[0]==='e' && tag[3]==='reply')?.[1] || event.tags.find(tag=>tag[0]==='e')?.[1];
          if(/^[a-f0-9]{64}$/.test(parentId || '')){
            const parent=model.events.get(parentId),preview=el('a','stream-chat-parent');
            preview.href=parent?'#stream-chat-'+parentId:'https://njump.me/'+NostrTools.nip19.noteEncode(parentId);
            if(!parent){preview.target='_blank';preview.rel='noopener noreferrer';}
            preview.textContent=parent?t('↳ {{name}}: {{message}}',{name:displayName(parent.pubkey),message:parent.content.replace(/(?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1[02-9ac-hj-np-z]+/g,t('Linked reference'))}):t('↳ Linked reply');
            row.append(preview);
          }
          row.append(body);
        }
        const more=el('button','stream-chat-more',t(expanded.has(event.id)?'Less':'More'));more.type='button';more.setAttribute('aria-expanded',String(expanded.has(event.id)));more.hidden=true;
        row.classList.toggle('is-expanded',expanded.has(event.id));
        more.onclick=()=>{const open=!expanded.has(event.id);if(open)expanded.add(event.id);else expanded.delete(event.id);row.classList.toggle('is-expanded',open);more.textContent=t(open?'Less':'More');more.setAttribute('aria-expanded',String(open));};
        if(event.kind!==9735){
          const chips=el('div','stream-chat-reactions');
          for(const group of reactions.groups(event.id,account,e=>bridge()?.muted(e))){
            const chip=el('button','stream-chat-reaction',group.content+' '+SidecarI18n.fmtNum(group.count));chip.type='button';
            chip.setAttribute('aria-pressed',String(group.mine));chip.title=t(group.mine?'You reacted {{reaction}}':'React {{reaction}}',{reaction:group.content});chip.setAttribute('aria-label',chip.title);chip.disabled=group.mine;chip.onclick=()=>react(event,group.content);chips.append(chip);
          }
          row.append(more,chips,actions);clamps.push({body,more,event});
        }
        log.append(row);
      }
      // Measure only after insertion so short messages never acquire a More button.
      for(const {body,more,event} of clamps)more.hidden=!expanded.has(event.id) && body.scrollHeight<=body.clientHeight+1 && body.scrollWidth<=body.clientWidth+1;
      if(atBottom)log.scrollTop=log.scrollHeight;
      else {const retained=anchorId && document.getElementById(anchorId);log.scrollTop=retained?top+retained.getBoundingClientRect().top-anchorOffset:top;}
      watchReactions();
    }
    function hydrate(events,token){
      if(token!==run || !pool)return;
      const viewport=log.getBoundingClientRect(),rowsById=new Map(visibleRows().map(e=>['stream-chat-'+e.id,e]));
      const visible=[...log.querySelectorAll('article')].filter(n=>{const r=n.getBoundingClientRect();return r.bottom>viewport.top && r.top<viewport.bottom;}).map(n=>rowsById.get(n.id)).filter(Boolean);
      const leaderKeys=[...leaders.children].filter(n=>{const r=n.getBoundingClientRect(),v=leaders.getBoundingClientRect();return r.right>v.left && r.left<v.right;}).map(n=>n.dataset.pubkey);
      const keys=[...new Set([...profileKeys(visible.reverse()),...leaderKeys,...profileKeys([...events].reverse())])];
      for(const [key,p] of bridge()?.cachedProfiles?.(keys) || [])if(!profiles.has(key))receivedProfile(key,p,token);
      profileQueue=new Set([...keys,...profileQueue].filter(k=>!profiles.has(k) && !profilePending.has(k) && (profileAttempts.get(k) || 0)<2));
      drainProfiles(token);
    }
    function drainProfiles(token){
      if(token!==run || !pool)return;
      while(profileWorkers<2 && profileQueue.size){
        const batch=[...profileQueue].slice(0,12),pending=profilePending,activePool=pool,signal=abort.signal;
        batch.forEach(k=>{profileQueue.delete(k);pending.add(k);profileAttempts.set(k,(profileAttempts.get(k) || 0)+1);});profileWorkers++;
        const onProfile=(key,p)=>receivedProfile(key,p,token);
        const request=bridge()?.profiles?bridge().profiles(batch,onProfile,signal):SidecarStreams.profileBatch({pool:activePool,sources:['wss://purplepag.es',...sources()],keys:batch,signal,verify:NostrTools.verifyEvent,onProfile});
        Promise.resolve(request).then(found=>{if(token===run)for(const [key,p] of found || [])if(p)onProfile(key,p);}).catch(()=>{}).finally(()=>{
          batch.forEach(k=>pending.delete(k));if(token!==run)return;profileWorkers--;
          drainProfiles(token);
          if(batch.some(k=>!profiles.has(k) && (profileAttempts.get(k) || 0)<2)){
            clearTimeout(profileRetry);profileRetry=setTimeout(()=>hydrate(visibleRows(),token),10000);
          }
        });
      }
    }
    async function history(latest=false){
      if(historyBusy || !pool)return;if(model.events.size>=1000){historyNotice(t('This chat has too many messages to load further history.'));return;}historyBusy=true;older.disabled=true;const token=run;
      try{
        const first=latest?null:model.rows()[0];
        const filter={kinds:[1311],'#a':[model.address]};
        // Drain the inclusive boundary before moving back a second.
        if(first){
          const boundaryPage=await readPage(pool,sources(),{...filter,since:first.created_at,until:first.created_at,limit:1000},abort.signal);
          const boundary=boundaryPage.events;
          if(token!==run)return;
          boundary.forEach(e=>model.accept(e,NostrTools.verifyEvent));
          if(boundary.length>=1000){paint();historyNotice(t('This chat has too many messages to load further history.'));return;}
        }
        const page=await readPage(pool,sources(),{...filter,...(first?{until:first.created_at-1}:{}),limit:50},abort.signal);
        const events=page.events;
        if(token!==run)return;
        events.forEach(e=>model.accept(e,NostrTools.verifyEvent));paint();
        historyNotice(!page.complete?t('Some chat relays are unavailable. Retrying…'):events.length?'':t('No earlier messages found.'));hydrate(visibleRows(),token);
        if(!page.complete)retryTimer=setTimeout(()=>{if(token===run)history(true);},Math.min(60000,10000*2**retryAttempt++));else retryAttempt=0;
      }catch(_){if(token===run)historyNotice(t('Could not load chat. Try again.'));}
      finally{if(token===run){historyBusy=false;older.disabled=false;}}
    }
    older.type='button';older.onclick=()=>{visibleLimit+=50;paint(true);hydrate(visibleRows(),run);history();};newer.type='button';newer.onclick=revealLatest;
    async function open(){
      stop();retryAttempt=0;visibleLimit=50;profileAttempts.clear();abort=new AbortController();const key=getItem().key;
      model=sessions.get(key) || new Messages(key);sessions.set(key,model);reactions=new Reactions();
      if(sessions.size>10)sessions.delete(sessions.keys().next().value);
      profilePending=new Set();profileQueue=new Set();profileWorkers=0;leaders.scrollLeft=0;log.replaceChildren();log.scrollTop=0;paint();setNotice(t('Looking for messages…'));historyBusy=false;
      pool=new NostrTools.SimplePool();const token=run;
      syncAccount();try{await bridge()?.prepare();}catch(_){}if(token!==run)return;
      const since=Math.floor(Date.now()/1000)-10;
      await history(true);if(token!==run)return;
      sub=pool.subscribeMany(sources(),{kinds:[1311],'#a':[model.address],since},{onevent:event=>{
        if(token!==run || !model.accept(event,NostrTools.verifyEvent))return;
        const atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;paint();if(!atBottom)newer.hidden=false;hydrate([event],token);
      }});
    }
    log.addEventListener('scroll',()=>{clearTimeout(profileScrollTimer);profileScrollTimer=setTimeout(()=>{if(!pane.hidden)hydrate([],run);},120);},{passive:true});
    leaders.addEventListener('scroll',()=>{if(!pane.hidden)hydrate([],run);},{passive:true});
    leaders.addEventListener('keydown',event=>{if(event.target!==leaders)return;if(event.key==='ArrowRight' || event.key==='ArrowLeft'){event.preventDefault();leaders.scrollBy({left:(event.key==='ArrowRight'?1:-1)*120});}});
    root.addEventListener('sidecar-stream-zaps',()=>{
      if(pane.hidden || paintTimer)return;
      const token=run;paintTimer=setTimeout(()=>{paintTimer=null;if(token!==run)return;paint();hydrate(visibleRows(),token);},150);
    });
    function show(chat){
      chat=chat && allowed() && !!bridge()?.identity() && addressOK(getItem()?.key);
      if(chat && !pane.hidden)return;
      if(chat)onOpen?.();
      pane.hidden=!chat;document.documentElement.classList.toggle('stream-chat-active',!!chat);
      toggle.setAttribute('aria-expanded',String(!!chat));
      toggle.setAttribute('aria-label',t(chat?'Close chat':'Stream chat'));toggle.title=t(chat?'Close chat':'Stream chat');
      if(chat){
        if(!mentionEditor && bridge()?.createMentionEditor){
          mentionEditor=bridge().createMentionEditor({placeholder:t('Write a message'),candidates:()=>[...profiles].map(([pubkey,p])=>({pubkey,...p})),onChange:()=>{send.disabled=!account || busy || !allowed() || draftText().length>4000;}});
          input.replaceWith(mentionEditor.wrap);input=mentionEditor.editor;
          input.setAttribute('role','textbox');input.setAttribute('aria-label',t('Write a message'));input.setAttribute('aria-multiline','true');
          mentionEditor.wrap.classList.add('stream-chat-editor');
          input.addEventListener('paste',event=>pastePlainText(event,text=>{
            // insertText retains selection replacement and the browser's undo stack.
            document.execCommand('insertText',false,text);mentionEditor.sync();
          }));
          input.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();});
          input.addEventListener('keydown',event=>{if(event.key==='Escape' && mentionEditor.wrap.querySelector('.ac-dropdown'))event.stopPropagation();},true);
        }
        sizeChat();open();
      }else stop();
    }
    toggle.onclick=()=>show(pane.hidden);
    document.addEventListener('keydown',event=>{if(event.key==='Escape' && !pane.hidden){if(reply){clearReply();input.focus();event.preventDefault();}else{show(false);toggle.focus();}}});
    form.onsubmit=async event=>{
      event.preventDefault();const who=syncAccount();if(!who || busy || !allowed())return;
      const token=run,content=draftText();busy=true;syncAccount();setNotice(t('Sending…'));
      try{
        const signed=await bridge().send(template(model.address,content,reply),sources(),who.pubkey);
        if(token!==run || account!==who.pubkey)return;
        model.accept(signed,NostrTools.verifyEvent);
        if(!model.events.has(signed.id))throw new Error('Signed message was not accepted');
        clearDraft();mentionEditor?.close();clearReply();paint();setNotice(t('Sent'),2500);revealLatest();
      }catch(_){if(token===run)setNotice(t('Could not send. Check your account and connection, then try again.'),7000);}
      finally{busy=false;syncAccount();if(token===run && account===who.pubkey)input.focus();}
    };
    root.addEventListener('sidecar-chat-account',()=>{syncAccount();if(!account){show(false);return;}if(!pane.hidden){bridge()?.prepare().then(paint).catch(()=>{});paint();}});
    return {sync(){toggle.hidden=!addressOK(getItem()?.key) || !bridge()?.identity() || !allowed();if(toggle.hidden){show(false);clearDraft();mentionEditor?.close();clearReply();}syncAccount();},open(){show(true);},close(){show(false);},destroy:stop};
  }
  const api={template,Messages,reactionTemplate,Reactions,readPage,contentParts,recentRows,pastePlainText,commentZapContext,mount};root.SidecarStreamChat=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
