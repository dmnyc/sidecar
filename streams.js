/* A persistent public player: refresh(), lock, and approval never recreate its video. */
(async () => {
  'use strict';
  // Chat, About, and bookmark controls have labels fixed at mount time.
  await SidecarI18n.ready;
  const { t } = SidecarI18n;
  const root = document.getElementById('stream-dock');
  const video = document.getElementById('stream-video');
  const directory = document.getElementById('stream-directory');
  const list = document.getElementById('stream-list');
  const status = document.getElementById('stream-status');
  const title = document.getElementById('stream-title');
  const browse = document.getElementById('stream-browse');
  const entry = document.getElementById('stream-entry');
  const feedToggle = document.getElementById('stream-feed-toggle');
  function setFeedExpanded(on) {
    feedToggle.setAttribute('aria-expanded', String(on));
    entry?.setAttribute('aria-expanded', String(on));
    document.documentElement.classList.toggle('stream-directory-active',on && !root.hidden);
  }
  const expand = document.getElementById('stream-expand');
  const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
  const profileImages = new Map();
  let savedStreams = [], savedOnly = false, savedRevision = 0;
  const savedStorage = typeof chrome !== 'undefined' && chrome.storage?.local;
  async function saveBookmarks(next) {
    try {
      if (savedStorage) await savedStorage.set({sidecar_saved_streams:next});
      else localStorage.setItem('sidecar_saved_streams', JSON.stringify(next));
      savedStreams=next; savedRevision++; paint();
      return true;
    } catch (_) { directoryError(t('Could not save streams. Try again.')); return false; }
  }
  function directoryError(text) {
    let error = document.getElementById('stream-save-error');
    if (!error) { error=document.createElement('p');error.id='stream-save-error';error.setAttribute('role','status');(directory.querySelector('.stream-directory-content') || directory).append(error); }
    error.textContent=text;
  }
  async function openSaved(item) {
    if (!item.key.startsWith('30311:')) { play(item.url,item.title);return; }
    const run=discoveryGeneration;
    const lookup=new NostrTools.SimplePool();
    try {
      const [,author,...identifier]=item.key.split(':');
      const events=await lookup.querySync([...new Set([...relays,...item.relays])],{kinds:[30311],authors:[author],'#d':[identifier.join(':')]},{maxWait:5000});
      const latest=new SidecarStreams.Directory();
      for(const event of events) { const parsed=SidecarStreams.parse(event);if(parsed?.key===item.key)latest.accept(event); }
      if(run!==discoveryGeneration || isLocked() || !enabled)return;
      const current=latest.events.get(item.key);
      if(current){for(const event of events)if(SidecarStreams.parse(event)?.key===item.key)model.accept(event);openDirectoryItem(current);}
      else directoryError(t('This saved stream is not live or could not be reached.'));
    } catch (_) { if(run===discoveryGeneration)directoryError(t('Could not load the saved stream. Try again.')); }
    finally { lookup.destroy(); }
  }
  const model = new SidecarStreams.Directory(2000);
  let hls = null, pool = null, subscription = null, timer = null, selected = false, generation = 0, discoveryGeneration = 0, discoveryAbort = null;
  let enabled = false;
  let selectedHost = null, selectedEvent = null, zapPool = null, zapAbort = null, zapRetryTimer = null, zapHistoryTimer = null;
  const lockView = document.getElementById('view-lock');
  const isLocked = () => lockView && !lockView.classList.contains('hidden');
  let chat = null,returnToChat=false;
  const details=window.SidecarStreamDetails?.mount({dock:root,title,trigger:browse,
    allowed:()=>enabled && !isLocked() && !root.classList.contains('stream-approving'),
    onOpen:()=>{returnToChat=document.documentElement.classList.contains('stream-chat-active');chat?.close();clearTimeout(feedCloseTimer);disconnect();directory.hidden=true;setFeedExpanded(false);},
    onClose:()=>{if(returnToChat)chat?.open();returnToChat=false;}});
  function syncVisibility() {
    chat?.sync();
    if(isLocked() || root.classList.contains('stream-approving'))details?.close();
    root.hidden = !enabled || !selected;
    root.classList.toggle('stream-idle', !selected);
    if (entry) { entry.hidden = !enabled; entry.disabled = !!isLocked() || root.classList.contains('stream-approving'); }
    document.getElementById('stream-zap').disabled = !!isLocked() || root.classList.contains('stream-approving');
    browse.disabled = !!isLocked() || root.classList.contains('stream-approving');
    feedToggle.hidden = !enabled || !selected || !!isLocked() || root.classList.contains('stream-approving');
    layout();
  }

  function layout() {
    const wide = root.getBoundingClientRect().width >= 480;
    expand.hidden = !selected || !wide;
    if (!wide && root.classList.contains('stream-expanded')) {
      root.classList.remove('stream-expanded'); setExpanded(false);
    }
    document.documentElement.style.setProperty('--stream-height', `${enabled && !root.hidden ? root.getBoundingClientRect().height : 0}px`);
    positionDirectory();
  }
  new ResizeObserver(layout).observe(root);
  const controls = document.querySelector?.('.stream-controls');
  if (controls) new ResizeObserver(() => {
    root.style.setProperty('--stream-control-space', Math.max(72, Math.ceil(controls.getBoundingClientRect().width) + 4) + 'px');
  }).observe(controls);
  const titleWindow = document.getElementById('stream-title-window');
  function measureTitle() {
    const overflow = Math.max(0, title.scrollWidth - titleWindow.clientWidth + 16);
    const scrolling = title.textContent.length > 0 && overflow > 16;
    titleWindow.classList.toggle('stream-title-scrolling', scrolling);
    titleWindow.style.setProperty('--stream-title-travel', `${-overflow}px`);
    titleWindow.style.setProperty('--stream-title-duration', `${Math.max(14, overflow / 12 + 6)}s`);
  }
  const titleObserver = new ResizeObserver(measureTitle);
  titleObserver.observe(titleWindow); titleObserver.observe(title);
  function message(text) { status.textContent = text; }
  function setExpanded(on) {
    const label=on?'Collapse video':'Expand video';
    const translated=on?t('Collapse video'):t('Expand video');
    expand.setAttribute('aria-expanded',String(on));
    expand.setAttribute('aria-label',translated);
    expand.setAttribute('title',translated);
    expand.setAttribute('data-i18n-aria-label',label);
    expand.setAttribute('data-i18n-title',label);
  }
  function stop() {
    chat?.close();details?.set(null);
    selectedHost = null; selectedEvent = null;
    document.getElementById('stream-zap').classList.remove('is-shining');
    clearTimeout(zapRetryTimer); zapRetryTimer=null;
    clearTimeout(zapHistoryTimer);zapHistoryTimer=null;
    zapAbort?.abort(); zapAbort = null; zapPool?.destroy(); zapPool = null;
    document.getElementById('stream-zap-total').hidden = true;
    document.getElementById('stream-info').hidden = true;
    document.getElementById('stream-viewers').hidden = true;
    root.classList.remove('stream-pip');
    generation++;
    if (hls) { hls.destroy(); hls = null; }
    video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
    setExpanded(false);
    document.getElementById('stream-stop').hidden = true;
    selected = false; root.classList.remove('stream-playing', 'stream-expanded');
    title.textContent = ''; title.removeAttribute('title'); expand.hidden = true; message(''); syncVisibility();
  }
  function setZapDigits(output, text, animate) {
    output.classList.add('t-digit-group');
    output.classList.remove('is-animating');
    output.replaceChildren();
    const chars = Array.from(text);
    chars.forEach((ch, i) => {
      const digit = document.createElement('span');
      digit.className = 't-digit';
      digit.textContent = ch;
      digit.setAttribute('aria-hidden', 'true');
      if (i === chars.length - 2) digit.dataset.stagger = '1';
      else if (i === chars.length - 1) digit.dataset.stagger = '2';
      output.appendChild(digit);
    });
    if (animate) {
      void output.offsetHeight;
      output.classList.add('is-animating');
    }
  }
  function shineZap() {
    const bolt = document.getElementById('stream-zap');
    bolt.classList.remove('is-shining');
    void bolt.offsetHeight;
    bolt.classList.add('is-shining');
  }
  document.getElementById('stream-zap').addEventListener('animationend', () => {
    document.getElementById('stream-zap').classList.remove('is-shining');
  });
  const zapSessions=new Map();
  async function watchZaps(item, run, attempt = 0) {
    const output=document.getElementById('stream-zap-total');
    const cacheKey=item.key+':'+item.host;
    let session=zapSessions.get(cacheKey);
    if(!session){session={totals:new SidecarStreams.ZapTotals(),provider:null,rows:new Map()};zapSessions.set(cacheKey,session);}
    if(zapSessions.size>20)zapSessions.delete(zapSessions.keys().next().value);
    const controller=zapAbort=new AbortController();
    const active=zapPool=new NostrTools.SimplePool();
    const current=()=>run===generation && !controller.signal.aborted;
    let loading=true, partial=true, receiptPaintTimer=null, receiptAnimate=false;
    controller.signal.addEventListener('abort',()=>clearTimeout(receiptPaintTimer),{once:true});
    const paint=(animate=false)=>{
      if(!current())return;
      output.hidden=false;
      const value=SidecarI18n.fmtNum(session.totals.msats/1000,{notation:'compact',maximumFractionDigits:1});
      setZapDigits(output,session.totals.count ? value+(loading || partial?'…':'+') : (loading?'…':'—'),animate);
      if(animate)shineZap();
      output.title=loading ? t('Loading verified zap history…') : partial ? t('Zap history incomplete; retrying available relays.') : t('Verified zaps observed on available relays; other receipts may exist.');
      if(session.totals.count)output.title+=' '+t('{{sats}} sats · {{count}} zaps observed for this event',{sats:SidecarI18n.fmtNum(session.totals.msats/1000),count:SidecarI18n.fmtNum(session.totals.count)});
      output.setAttribute('aria-label',output.title);
    };
    const scheduleReceiptPaint=animate=>{
      receiptAnimate ||= animate;
      if(receiptPaintTimer!==null)return;
      receiptPaintTimer=setTimeout(()=>{
        receiptPaintTimer=null;if(!current())return;
        window.dispatchEvent(new CustomEvent('sidecar-stream-zaps'));
        paint(receiptAnimate);receiptAnimate=false;
      },100);
    };
    paint();
    // Receipt archives are separate from the small live-discovery relay set.
    const sources=[...new Set([...item.relays || [],...relays,'wss://purplepag.es','wss://nostr.wine','wss://relay.snort.social'])];
    try {
      const meta=await SidecarStreams.zapProvider(active,sources,item.host,controller.signal,fetch);
      if(!current())return;
      if(session.provider && session.provider!==meta.nostrPubkey){session.totals=new SidecarStreams.ZapTotals();session.rows=new Map();}
      session.provider=meta.nostrPubkey;
      const started=Math.floor(Date.now()/1000);
      const accept=async(receipt,animate=false)=>{
        if(!current())return;
        const accepted=await session.totals.accept(receipt,{address:item.key,recipient:item.host,provider:meta.nostrPubkey,verify:NostrTools.verifyEvent,
          digest:async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('')});
        if(accepted){
          const request=JSON.parse(receipt.tags.find(t=>t[0]==='description')[1]);
          const invoice=SidecarStreams.invoiceDetails(receipt.tags.find(t=>t[0]==='bolt11')[1]);
          session.rows.set(receipt.id,{id:receipt.id,kind:9735,pubkey:request.pubkey,content:request.content || '',created_at:receipt.created_at,tags:receipt.tags,sats:invoice.msats/1000});
          if(session.rows.size>1000){const oldest=[...session.rows.values()].sort((a,b)=>a.created_at-b.created_at || a.id.localeCompare(b.id))[0];session.rows.delete(oldest.id);}
          if(current())scheduleReceiptPaint(animate);
        }
      };
      const filter={kinds:[9735],'#a':[item.key],'#p':[item.host]};
      const query=(relay,request)=>SidecarStreams.relayPage(active,relay,request,controller.signal);
      const subscribe=()=>active.subscribeMany(sources,{...filter,since:started},{abort:controller.signal,onevent:receipt=>{accept(receipt,!loading&&receipt.created_at>=started).catch(()=>{});}});
      let live=subscribe();
      let watermark=started;
      const recover=async()=>{
        const before=Math.floor(Date.now()/1000);
        const result=await SidecarStreams.zapHistory({sources,query,accept,filter:partial?filter:{...filter,since:Math.max(0,watermark-2)},signal:controller.signal});
        if(!current())return;
        loading=false;partial=!result.complete;if(!partial)watermark=before;paint();
        zapHistoryTimer=setTimeout(()=>{if(!current())return;live.close();live=subscribe();recover().catch(()=>{});},60000);
      };
      await recover();
    } catch (_) {
      active.destroy();if(!current())return;
      loading=false;partial=true;paint();
      if(attempt<2)zapRetryTimer=setTimeout(()=>{zapRetryTimer=null;if(current())watchZaps(item,run,attempt+1);},[2000,5000][attempt]);
    }
  }
  function play(url, label, host, item) {
    if (!enabled || isLocked()) return;
    url = SidecarStreams.httpsUrl(url);
    if (!url) { message(t('Enter an HTTPS stream URL.')); return; }
    clearTimeout(feedCloseTimer); directory.classList.remove('is-open','is-closing');
    stop(); root.append(directory); directory.classList.remove('stream-idle-directory'); const run = generation;
    selectedHost = host || null; selectedEvent = item || null;
    if (item && host) watchZaps(item, run);
    if (host) {
      const npub = NostrTools.nip19.npubEncode(host);
      const fallbackName = SidecarStreams.cocktailName(host);
      document.getElementById('stream-info').hidden = false;
      document.getElementById('stream-host').href = 'https://primal.net/p/' + npub;
      document.getElementById('stream-host-name').textContent = profileImages.get(host)?.name || fallbackName;
      const avatar = document.getElementById('stream-host-image'); avatar.hidden = true;
      avatar.onload = () => { if (run === generation) avatar.hidden = false; };
      avatar.onerror = () => { avatar.hidden = true; };
      profileImage(host, item?.relays).then(picture => {
        if (run !== generation) return;
        document.getElementById('stream-host-name').textContent = profileImages.get(host)?.name || fallbackName;
        if (picture || item?.image) avatar.src = picture || item.image;
      });
      const viewers = document.getElementById('stream-viewers');
      viewers.hidden = item?.status === 'ended' || item?.viewers == null;
      if (!viewers.hidden) {
        viewers.textContent = SidecarI18n.fmtNum(item.viewers);
        viewers.title = t('Reported viewers');
        viewers.setAttribute('aria-label',t('Reported viewers: {{count}}', { count: SidecarI18n.fmtNum(item.viewers) }));
      }
    }

    root.querySelector('.stream-live-label').textContent = item?.status === 'ended' ? t('Replay') : t('Live');
    root.classList.toggle('stream-replay', item?.status === 'ended');
    selected = true; document.getElementById('stream-stop').hidden = false; video.hidden = false; root.classList.add('stream-playing'); expand.hidden = false;
    title.textContent = label || t('Untitled livestream'); title.setAttribute('title',title.textContent); details?.set({...item,title:title.textContent}); measureTitle(); message(t('Connecting…')); directory.hidden = true; setFeedExpanded(false); disconnect();
    syncVisibility();
    const begin = () => { if (run !== generation || !enabled) return; return video.play().catch(() => { if (run === generation) message(t('Press Play to start watching.')); }); };
    const isHls = !/\.(mp4|webm|ogv)(?:[?#]|$)/i.test(url);
    if (isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: false, backBufferLength: 15, maxBufferLength: 20 });
      hls.on(Hls.Events.ERROR, (_, data) => { if (run === generation && data.fatal) message(t('Stream unavailable. Choose another stream or try again.')); });
      hls.on(Hls.Events.MANIFEST_PARSED, begin);
      hls.loadSource(url); hls.attachMedia(video);
    } else {
      if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) { message(t('This browser cannot play this stream.')); return; }
      video.src = url; begin();
    }
  }
  video.addEventListener('enterpictureinpicture', () => {
    root.classList.add('stream-pip'); layout();
  });
  video.addEventListener('leavepictureinpicture', () => {
    root.classList.remove('stream-pip'); layout();
  });
  video.addEventListener('playing', () => message(''));
  video.addEventListener('waiting', () => { if (selected) message(t('Buffering…')); });
  video.addEventListener('error', () => { if (selected) message(t('Stream unavailable. Choose another stream or try again.')); });
  function updatePlayingProfile(host, record, picture) {
    if (selectedHost !== host) return;
    if (record.name) document.getElementById('stream-host-name').textContent=record.name;
    const avatar=document.getElementById('stream-host-image');
    if (picture && avatar.getAttribute('src') !== picture) avatar.src=picture;
  }
  function profileImage(host, hints = []) {
    const cached = profileImages.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    if (!enabled || isLocked()) return Promise.resolve(null);
    // Selecting a stream closes discovery; profile resolution must finish independently.
    const profilePool = new NostrTools.SimplePool();
    const record = { expiresAt: Infinity, promise: null };
    const sources = [...new Set([...relays, 'wss://purplepag.es', ...hints.filter(url => typeof url === 'string' && url.startsWith('wss://')).slice(0,6)])];
    record.promise = (async () => {
      let event = await profilePool.get(sources, {kinds:[0], authors:[host]}, {maxWait:4000});
      if (!event) {
        const relayList = await profilePool.get(sources, {kinds:[10002], authors:[host]}, {maxWait:4000});
        const declared = [...new Set((relayList?.tags || []).filter(tag => tag[0] === 'r' && typeof tag[1] === 'string' && tag[1].startsWith('wss://')).map(tag => tag[1]))].filter(url => !sources.includes(url)).slice(0,6);
        if (declared.length) event = await profilePool.get(declared, {kinds:[0], authors:[host]}, {maxWait:4000});
      }
      return event;
    })().then(event => {
      let picture = null;
      try { const content = JSON.parse(event?.content || '{}'); picture = SidecarStreams.httpsUrl(content.picture); record.banner = SidecarStreams.httpsUrl(content.banner); record.name = content.display_name || content.displayName || content.name || ''; } catch (_) {}
      record.expiresAt = Date.now() + (picture ? 300000 : 30000);
      updatePlayingProfile(host, record, picture);
      return picture;
    }).catch(() => {
      if (profileImages.get(host) === record) profileImages.delete(host);
      return null;
    }).finally(() => profilePool.destroy());
    profileImages.set(host, record);
    return record.promise;
  }
  let pageSize = 6;
  let streamPage = 0, morePage = 0, category = 'live', detailItem = null;
  let historyLoaded = false, historyBusy = false;
  const historyCursors = new Map();
  function streamDate(value) {
    return SidecarI18n.fmtDate(new Date(value * 1000), {dateStyle:'medium',timeStyle:'short'});
  }
  function itemTiming(item) {
    if (item.status === 'planned') return item.starts ? t('Starts {{date}}', {date:streamDate(item.starts)}) : t('Start time not announced');
    if (item.status === 'ended') return item.ends ? t('Ended {{date}}', {date:streamDate(item.ends)}) : t('Ended');
    return '';
  }
  function openDirectoryItem(item) {
    if (item.status === 'ended' && item.recording) { play(item.recording,item.title,item.host,item); return; }
    if (model.isLive(item)) { play(item.url,item.title,item.host,item); return; }
    detailItem=item; paint(); revealContent(list); list.querySelector('.stream-history-back')?.focus();
  }
  function drawDirectoryDetails(item) {
    const content=document.createElement('section');content.className='stream-directory-detail';
    const header=document.createElement('div');header.className='stream-directory-detail-header';
    const back=document.createElement('button');back.type='button';back.className='stream-history-back ghost';back.setAttribute('aria-label',t('Back'));back.title=t('Back');
    back.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14"/></svg>';
    back.onclick=()=>{detailItem=null;paint();};
    const heading=document.createElement('h3');heading.textContent=item.title;heading.dir='auto';
    const timing=document.createElement('p');timing.className='stream-result-time';timing.textContent=itemTiming(item);
    const description=document.createElement('p');description.className='stream-directory-description';description.dir='auto';description.textContent=item.summary || t('No stream description available.');
    header.append(back,heading);content.append(header,timing,description);
    const state=document.createElement('p');state.textContent=item.status==='planned' ? t('This stream has not started yet.') : model.isLive(item) ? t('Live') : t('No recording available.');
    if((item.status==='ended' && item.recording) || (model.isLive(item))) {
      const watch=document.createElement('button');watch.type='button';watch.className='primary';watch.textContent=t('Watch');watch.onclick=()=>openDirectoryItem(item);content.append(watch);
    }
    else content.append(state);
    const save=document.createElement('button');save.type='button';save.className='stream-bookmark icon-btn';
    const isSaved=savedStreams.some(row=>row.key===item.key);
    save.setAttribute('aria-pressed',String(isSaved));save.title=isSaved?t('Remove saved stream'):t('Save stream');save.setAttribute('aria-label',save.title);
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill',isSaved?'currentColor':'none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','2');icon.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M6 3h12v18l-6-4-6 4V3z');icon.append(path);save.append(icon);
    save.onclick=async()=>{const entry=SidecarStreams.bookmark(item);if(entry && await saveBookmarks(isSaved?savedStreams.filter(row=>row.key!==item.key):[...savedStreams,entry]))list.querySelector('.stream-directory-detail-header .stream-bookmark')?.focus({preventScroll:true});};
    header.append(save);list.append(content);
  }
  async function loadHistory(reset=false) {
    if(historyBusy || !enabled || isLocked() || !pool)return;
    if(reset){historyCursors.clear();historyLoaded=false;}
    historyBusy=true;paint();
    const run=discoveryGeneration, activePool=pool, signal=discoveryAbort.signal;
    let confirmed=0;
    try {
      await Promise.all(relays.map(async relay=>{
        if(historyCursors.get(relay)===null){confirmed++;return;}
        const filter={kinds:[30311],limit:100};
        if(historyCursors.has(relay))filter.until=historyCursors.get(relay);
        const {events,complete}=await SidecarStreams.relayPage(activePool,relay,filter,signal,5000);
        if(run!==discoveryGeneration)return;
        if(complete)confirmed++;
        const valid=events.filter(event=>SidecarStreams.parse(event));
        for(const event of valid)model.accept(event);
        // Only confirmed EOSE advances the cursor; a timeout stays retryable.
        if(complete && valid.length)historyCursors.set(relay,Math.min(...valid.map(event=>event.created_at))-1);
        else if(complete && !events.length)historyCursors.set(relay,null);
      }));
      if(run===discoveryGeneration){historyLoaded=confirmed>0;directoryError(confirmed?'':t('Could not load stream history. Try again.'));}
    } catch (_) { if(run===discoveryGeneration)directoryError(t('Could not load stream history. Try again.')); }
    finally {if(run===discoveryGeneration){historyBusy=false;paint();}}
  }
  let historyPaging=false;
  function canLoadHistory() {
    return !savedOnly && category!=='live' && model.events.size<2000 && !relays.every(relay=>historyCursors.get(relay)===null);
  }
  async function nextHistoryPage(container,page,changePage) {
    if(historyBusy || historyPaging)return;
    const run=discoveryGeneration, view=category, extra=moreOpen, size=pageSize;
    const current=()=>run===discoveryGeneration && view===category && !savedOnly && extra===moreOpen && size===pageSize && !detailItem;
    const rows=()=> (view==='past'?model.past():model.upcoming()).filter(item=>(item.title==='Untitled livestream')===extra);
    historyPaging=true;directoryError(t('Loading…'));paint();
    try {
      // A relay batch may contain only duplicates or another category. Keep looking,
      // but bound each click so a sparse history cannot trigger an unlimited scan.
      for(let attempt=0;attempt<5 && canLoadHistory();attempt++) {
        const before=JSON.stringify([...historyCursors]);
        await loadHistory();
        if(!current())return;
        if(rows().length>(page+1)*pageSize){changePage(page+1);directoryError('');revealContent(container);return;}
        if(before===JSON.stringify([...historyCursors]))break;
      }
      if(current())directoryError(canLoadHistory()?t('No additional streams found yet. Select Next to keep looking.'):t('No more streams available.'));
    } finally {historyPaging=false;paint();}
  }
  function paginate(container, items, requested, changePage) {
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.max(0, Math.min(requested, pages - 1));
    const fetchMore=canLoadHistory();
    if ((pages > 1 || fetchMore) && (container === list ? !moreOpen : moreOpen)) {
      const nav = document.createElement('div'); nav.className = 'stream-pagination';
      for (const [label, delta] of [[t('Previous'), -1], [t('Next'), 1]]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-btn';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', delta < 0 ? 'M16 3l-9 9 9 9' : 'M8 3l9 9-9 9');
        svg.append(path); button.append(svg);
        const loading=historyBusy || historyPaging;
        button.setAttribute('aria-label', delta>0 && loading?t('Loading…'):label); button.title = label; button.disabled = loading || (delta < 0 ? page === 0 : page === pages - 1 && !fetchMore);
        button.addEventListener('click', () => {
          if(delta>0 && page===pages-1 && fetchMore){nextHistoryPage(container,page,changePage);return;}
          directoryError('');changePage(page + delta); paint(); revealContent(container);
        });
        nav.append(button);
      }
      document.getElementById('stream-page-controls').append(nav);
    }
    return { page, items: items.slice(page * pageSize, (page + 1) * pageSize) };
  }
  let moreOpen = false;
  let lookingForStreams = false;
  function paint() {
    document.getElementById('stream-page-controls').replaceChildren();
    list.replaceChildren();
    const more = document.getElementById('stream-more-list'); more.replaceChildren();
    const actions=directory.querySelector('.stream-directory-actions');
    actions.hidden=!!detailItem;
    if(detailItem){detailItem=model.events.get(detailItem.key)||detailItem;more.hidden=true;document.getElementById('stream-advanced').hidden=true;drawDirectoryDetails(detailItem);return;}
    const items = savedOnly ? savedStreams : category==='upcoming' ? model.upcoming() : category==='past' ? model.past() : model.live();
    if (!items.length) { const p=document.createElement('p');p.className='stream-empty';p.setAttribute('role','status');p.textContent=savedOnly ? t('No saved streams yet.') : (lookingForStreams || historyBusy) ? t('Looking for streams…') : category==='upcoming' ? t('No upcoming streams found.') : category==='past' ? t('No past streams found.') : t('No live streams found. Try refreshing.');list.append(p); }
    const named = items.filter(item => item.title !== 'Untitled livestream');
    const untitled = items.filter(item => item.title === 'Untitled livestream');
    const mainPage = paginate(list, named, streamPage, page => { streamPage = page; });
    const extraPage = paginate(more, untitled, morePage, page => { morePage = page; });
    streamPage = mainPage.page; morePage = extraPage.page;
    const untitledCount = untitled.length;
    for (const item of [...mainPage.items, ...extraPage.items]) {
      const row=document.createElement('div');row.className='stream-row';
      const button=document.createElement('button');button.type='button';button.className='stream-result';
      const thumb = document.createElement('span'); thumb.className = 'stream-thumbnail'; thumb.setAttribute('aria-hidden', 'true');
      const placeholder = document.createElement('span'); placeholder.className = 'stream-thumbnail-play';
      const streamIcon = entry?.querySelector('svg');
      if (streamIcon) placeholder.append(streamIcon.cloneNode(true));
      thumb.append(placeholder);
      // Hidden-until-loaded artwork must load eagerly; lazy loading waits for visibility.
      const artwork=document.createElement('img');artwork.alt='';artwork.loading='eager';artwork.referrerPolicy='no-referrer';artwork.hidden=true;
      thumb.append(artwork);
      const profileArtwork=document.createElement('img');profileArtwork.alt='';profileArtwork.hidden=true;
      profileArtwork.referrerPolicy='no-referrer';
      thumb.insertBefore(profileArtwork,artwork);
      // Loaded layers cover lower-priority fallbacks without waiting on a slow host.
      const bannerArtwork=document.createElement('img');bannerArtwork.alt='';bannerArtwork.hidden=true;
      bannerArtwork.referrerPolicy='no-referrer';
      thumb.insertBefore(bannerArtwork,artwork);
      bannerArtwork.addEventListener('load',()=>{bannerArtwork.hidden=false;});
      bannerArtwork.addEventListener('error',()=>{bannerArtwork.hidden=true;});
      profileArtwork.addEventListener('load',()=>{profileArtwork.hidden=false;});
      profileArtwork.addEventListener('error',()=>{profileArtwork.hidden=true;});
      artwork.addEventListener('load',()=>{artwork.hidden=false;});
      artwork.addEventListener('error',()=>{artwork.hidden=true;});
      if(item.image)artwork.src=item.image;
      button.append(thumb);
      const label=document.createElement('span'); label.textContent=item.title === 'Untitled livestream' ? t('Untitled livestream') : item.title;label.dir='auto';label.className='stream-result-title';button.title=label.textContent;
      const copy=document.createElement('span');copy.className='stream-result-copy';copy.append(label);
      if(!savedOnly && item.status!=='live') {
        const timing=document.createElement('span');timing.className='stream-result-time';timing.textContent=itemTiming(item);copy.append(timing);
        if(item.status==='ended'){const state=document.createElement('span');state.className='stream-result-time';state.textContent=item.recording?t('Replay available'):t('No recording available.');copy.append(state);}
      }
      button.append(copy);
      button.addEventListener('click',()=>savedOnly ? openSaved(item) : openDirectoryItem(item));
      const save=document.createElement('button');save.type='button';save.className='stream-bookmark icon-btn';
      const isSaved=savedStreams.some(e=>e.key===item.key);
      save.setAttribute('aria-pressed',String(isSaved));save.title=(isSaved?t('Remove saved stream'):t('Save stream'));save.setAttribute('aria-label',save.title);
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill',isSaved?'currentColor':'none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','2');icon.setAttribute('aria-hidden','true');
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M6 3h12v18l-6-4-6 4V3z');icon.append(path);save.append(icon);
      save.addEventListener('click',event=>{event.stopPropagation();const entry=SidecarStreams.bookmark(item);if(entry)saveBookmarks(isSaved?savedStreams.filter(e=>e.key!==item.key):[...savedStreams,entry]);});row.append(save);
      const profile=document.createElement('a');profile.className='stream-avatar';
      profile.hidden=!item.host;
      if(item.host)profile.href='https://primal.net/p/'+NostrTools.nip19.npubEncode(item.host);
      profile.target='_blank';profile.rel='noopener noreferrer';
      profile.setAttribute('aria-label',t('Streamer profile'));profile.title=t('Streamer profile');
      const avatar=document.createElement('img');avatar.alt='';avatar.hidden=true;avatar.referrerPolicy='no-referrer';
      avatar.addEventListener('load',()=>{avatar.hidden=false;});avatar.addEventListener('error',()=>{
        avatar.hidden=true;
        if (item.image && avatar.src !== item.image) avatar.src=item.image;
      });
      profile.append(avatar);row.append(button,profile);
      const run=discoveryGeneration;
      if(item.host)profileImage(item.host, item.relays).then(url=>{
        const picture = url || item.image; // Stream artwork is preferable to an empty avatar when no profile is published.
        if(run!==discoveryGeneration)return;
        if(picture)avatar.src=picture;
        if(url)profileArtwork.src=url;
        const banner=profileImages.get(item.host)?.banner;
        if(banner)bannerArtwork.src=banner;
      });
      if (item.title === 'Untitled livestream') { more.append(row); }
      else list.append(row);
    }
    document.getElementById('stream-more-toggle').hidden = !untitledCount;
    more.hidden = !untitledCount || !moreOpen;
    schedulePageSize();
  }
  let directoryPaintTimer=null;
  function queueDirectoryPaint() {
    if(directoryPaintTimer!==null)return;
    directoryPaintTimer=setTimeout(()=>{directoryPaintTimer=null;paint();},100);
  }
  const liveChecks=new Map();
  let liveCheckTimer=null, liveCheckRun=null;
  function scheduleLiveChecks(){
    if(liveCheckTimer!==null)return;
    liveCheckTimer=setTimeout(()=>{liveCheckTimer=null;checkOlderLiveStreams();},200);
  }
  async function checkOlderLiveStreams(){
    if(!enabled || isLocked() || !pool || !discoveryAbort || liveCheckRun===discoveryGeneration)return;
    const run=discoveryGeneration,signal=discoveryAbort.signal,now=Date.now()/1000;
    const urls=[...new Set([...model.events.values()].filter(item=>item.status==='live' && item.url && now-item.updated>=3600)
      .sort((a,b)=>b.updated-a.updated).map(item=>item.url))];
    // Two concurrent probes, with a cooldown per URL, bound work for noisy relays.
    const pending=urls.filter(url=>![...model.events.values()].some(item=>item.status==='live' && item.url===url && now-item.updated<3600) && (!liveChecks.has(url)||now-liveChecks.get(url)>60)).sort((a,b)=>(liveChecks.get(a)||0)-(liveChecks.get(b)||0));
    let cursor=0;liveCheckRun=run;
    try { await Promise.all([0,1].map(async()=>{
      for(;cursor<Math.min(20,pending.length) && !signal.aborted;){
        const url=pending[cursor++];liveChecks.set(url,now);
        const active=await SidecarStreams.advancingPlaylist(url,signal);
        if(run!==discoveryGeneration || signal.aborted)return;
        if(active)model.verified.set(url,Date.now()/1000);else model.verified.delete(url);
        queueDirectoryPaint();
      }
    })); } finally {if(liveCheckRun===run)liveCheckRun=null;}
  }
  function disconnect() { clearTimeout(liveCheckTimer);liveCheckTimer=null;liveChecks.clear(); historyBusy=false; chat?.close(); clearTimeout(directoryPaintTimer);directoryPaintTimer=null;discoveryGeneration++; discoveryAbort?.abort(); discoveryAbort=null; subscription?.close(); subscription=null; pool?.destroy(); pool=null; clearInterval(timer);timer=null; }
  function discover(resetHistory=false) {
    if (!enabled || isLocked()) return;
    disconnect(); lookingForStreams = true; paint();
    const run=discoveryGeneration; discoveryAbort=new AbortController();
    // Public, read-only discovery; never authenticate or keep the keystore awake.
    pool = new NostrTools.SimplePool();
    subscription = pool.subscribeMany(relays,
      { kinds:[30311], since:Math.floor(Date.now()/1000)-7*86400, limit:1000 },
      { abort:discoveryAbort.signal, onevent:event=>{if(run===discoveryGeneration && model.accept(event)){queueDirectoryPaint();scheduleLiveChecks();}}, oneose:()=>{if(run===discoveryGeneration){lookingForStreams=false;paint();}} });
    timer=setInterval(()=>{paint();scheduleLiveChecks();},30000);
    scheduleLiveChecks();
    if(category!=='live' && !savedOnly && (resetHistory || !historyLoaded))loadHistory(resetHistory);
  }
  function positionDirectory() {
    // Closing panels remain visible during their animation, but no longer take over the app.
    const open=!directory.hidden && feedToggle.getAttribute('aria-expanded')==='true';
    const playing=!root.hidden;
    document.documentElement.classList.toggle('stream-directory-active',open && playing);
    if(!open || !directory.classList.contains('stream-idle-directory'))return;
    directory.classList.toggle('stream-playing-directory',playing);
    const top=playing?root.getBoundingClientRect().bottom:(entry?.closest('.topbar')?.getBoundingClientRect().bottom || 56);
    let bottom=window.innerHeight;
    for(const id of ['relax-status','mining-status']){
      const bar=document.getElementById(id);
      if(bar && bar.getClientRects().length && !bar.classList.contains('hidden'))bottom=Math.min(bottom,bar.getBoundingClientRect().top);
    }
    directory.style.top=top+'px';directory.style.height=Math.max(0,bottom-top)+'px';directory.style.maxHeight=directory.style.height;
  }
  window.addEventListener('resize',positionDirectory);
  for(const id of ['relax-status','mining-status']){
    const bar=document.getElementById(id);
    if(bar){new ResizeObserver(positionDirectory).observe(bar);new MutationObserver(positionDirectory).observe(bar,{attributes:true,attributeFilter:['class','hidden']});}
  }
  const backup=document.createElement('div');backup.className='stream-bookmark-backup';backup.hidden=true;
  const backupRow=document.createElement('div');backupRow.className='stream-backup-row';
  const backupCopy=document.createElement('div');backupCopy.className='stream-backup-copy';
  const backupHeading=document.createElement('span');backupHeading.className='stream-backup-heading';backupHeading.textContent=t('Encrypted backup');
  const backupLabel=document.createElement('p'),backupStatus=document.createElement('p');backupLabel.dir='auto';backupStatus.setAttribute('role','status');backupStatus.setAttribute('aria-live','polite');
  backupCopy.append(backupHeading,backupLabel);
  const backupActions=document.createElement('div');backupActions.className='stream-backup-actions';
  const saveRemote=document.createElement('button'),loadRemote=document.createElement('button');
  for(const [button,label,path] of [
    [saveRemote,t('Save to account'),'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5'],
    [loadRemote,t('Restore from account'),'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5']
  ]) {
    button.type='button';button.className='icon-btn';button.title=label;button.setAttribute('aria-label',label);
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))icon.setAttribute(key,value);
    const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',path);icon.append(shape);button.append(icon);backupActions.append(button);
  }
  backupRow.append(backupCopy,backupActions);backup.append(backupRow,backupStatus);directory.append(backup);
  let backupBusy=false,backupNoticeTimer;
  function updateBackup(){
    const who=window.SidecarStreamBookmarks?.identity();backup.hidden=!savedOnly || !who;
    backupLabel.textContent=who?.name || '';backupLabel.title=backupLabel.textContent;
    backup.setAttribute('aria-busy',String(backupBusy));
    saveRemote.disabled=loadRemote.disabled=backupBusy || !who;
  }
  async function transferBookmarks(restore){
    const bridge=window.SidecarStreamBookmarks,who=bridge?.identity();if(!who || backupBusy)return;
    backupBusy=true;clearTimeout(backupNoticeTimer);updateBackup();backupStatus.textContent=(restore?t('Restoring…'):t('Saving…'));
    try{
      if(restore){const items=await bridge.restore(who.pubkey);if(bridge.identity()?.pubkey!==who.pubkey)throw new Error('Account changed');
        if(items===null){backupStatus.textContent=t('No saved streams found for this account.');return;}
        if(!await saveBookmarks(SidecarStreams.mergeBookmarks(savedStreams,items)))throw new Error('Storage failed');
      }else await bridge.save(savedStreams,who.pubkey);
      if(bridge.identity()?.pubkey===who.pubkey)backupStatus.textContent=(restore?t('Streams restored.'):t('Streams saved to your account.'));
    }catch(_){if(bridge.identity()?.pubkey===who.pubkey)backupStatus.textContent=t('Could not sync streams. Check your connection and try again.');}
    finally{backupBusy=false;updateBackup();backupNoticeTimer=setTimeout(()=>{backupStatus.textContent='';},7000);}
  }
  saveRemote.onclick=()=>transferBookmarks(false);loadRemote.onclick=()=>transferBookmarks(true);
  window.addEventListener('sidecar-chat-account',()=>{backupStatus.textContent='';updateBackup();});
  const filters=document.createElement('div');filters.className='stream-category-tabs';filters.setAttribute('role','group');filters.setAttribute('aria-label',t('Stream categories'));
  for(const [value,label] of [['live',t('Live')],['upcoming',t('Upcoming')],['past',t('Past')]]) {
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(value===category));
    button.onclick=()=>{
      directoryError('');category=value;detailItem=null;savedOnly=false;streamPage=morePage=0;moreOpen=false;
      document.getElementById('stream-saved-toggle').setAttribute('aria-pressed','false');updateBackup();
      for(const child of filters.children)child.setAttribute('aria-pressed',String(child===button));
      paint();if(value!=='live'&&!historyLoaded)loadHistory();
    };
    filters.append(button);
  }
  directory.insertBefore(filters,list);
  const directoryContent=document.createElement('div');directoryContent.className='stream-directory-content';
  const directoryActions=directory.querySelector('.stream-directory-actions');
  directoryContent.append(...directory.childNodes);
  // Keep navigation outside the scrolling results so each page has the same controls position.
  directory.append(directoryContent,directoryActions);
  let pageMeasureTimer=null, measuredWidth=0, measuredRowHeight=0;
  function schedulePageSize() {
    if(pageMeasureTimer!==null)return;
    pageMeasureTimer=setTimeout(()=>{pageMeasureTimer=null;measurePageSize();},0);
  }
  function measurePageSize() {
    if(directory.hidden || detailItem || !directoryContent.clientHeight)return;
    const active=moreOpen?document.getElementById('stream-more-list'):list;
    const rows=[...active.querySelectorAll('.stream-row')];
    if(!rows.length)return;
    const width=directoryContent.clientWidth;
    if(width!==measuredWidth){measuredWidth=width;measuredRowHeight=0;}
    // Retain the tallest measured row at this width so title wrapping does not
    // make the page capacity oscillate as different results are displayed.
    measuredRowHeight=Math.max(measuredRowHeight,...rows.map(row=>row.getBoundingClientRect().height));
    const style=getComputedStyle(active),contentStyle=getComputedStyle(directoryContent),tabStyle=getComputedStyle(filters);
    const gap=parseFloat(style.rowGap)||0;
    const reserved=filters.getBoundingClientRect().height+(parseFloat(tabStyle.marginBottom)||0)
      +(parseFloat(contentStyle.paddingTop)||0)+(parseFloat(contentStyle.paddingBottom)||0);
    const available=directoryContent.clientHeight-reserved;
    const next=Math.max(1,Math.floor((available+gap)/(measuredRowHeight+gap)));
    if(next===pageSize)return;
    streamPage=Math.floor(streamPage*pageSize/next);morePage=Math.floor(morePage*pageSize/next);
    pageSize=next;paint();
  }
  new ResizeObserver(schedulePageSize).observe(directoryContent);
  const hideDirectory=document.createElement('button');
  hideDirectory.type='button';hideDirectory.className='stream-directory-hide ghost';hideDirectory.textContent=t('Hide streams');
  hideDirectory.addEventListener('click',()=>{closeFeed();(root.hidden?entry:feedToggle)?.focus();});directory.append(hideDirectory);
  let feedCloseTimer;
  function closeFeed() {
    disconnect(); setFeedExpanded(false);
    directory.classList.remove('is-open'); directory.classList.add('is-closing');
    clearTimeout(feedCloseTimer);
    feedCloseTimer=setTimeout(()=>{directory.hidden=true;directory.classList.remove('is-closing');},parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')) || 150);
  }
  function toggleFeed() {
    if (!enabled || isLocked() || browse.disabled) return;
    if (!directory.hidden && directory.classList.contains('is-open')) { closeFeed(); return; }
    clearTimeout(feedCloseTimer);
    details?.close();updateBackup();
    window.dispatchEvent(new CustomEvent('sidecar-open-streams'));
    // The guide takes over the app area directly below the persistent player.
    document.body.append(directory); directory.classList.add('stream-idle-directory','t-dropdown');
    directory.setAttribute('data-origin','top-center');

    directory.hidden=false;directory.classList.remove('is-closing');
    void directory.offsetHeight;directory.classList.add('is-open');setFeedExpanded(true);positionDirectory();discover();chat?.sync();
  }
  chat = window.SidecarStreamChat?.mount(directory, () => selectedEvent, () => enabled && !isLocked() && !root.classList.contains('stream-approving'), () => {details?.close();disconnect();directory.hidden=true;setFeedExpanded(false);}, () => [...(zapSessions.get(selectedEvent?.key+':'+selectedEvent?.host)?.rows?.values() || [])], () => SidecarStreams.topZappers(zapSessions.get(selectedEvent?.key+':'+selectedEvent?.host)?.totals));
  chat?.sync();
  browse.addEventListener('click', ()=>details?details.toggle():toggleFeed());
  feedToggle.addEventListener('click', toggleFeed);
  entry?.addEventListener('click', toggleFeed);
  document.getElementById('acct-btn')?.addEventListener('click',()=>{if(!directory.hidden)closeFeed();});
  document.addEventListener?.('click',event=>{
    // Repainting pagination detaches the clicked button before this listener runs.
    // Use the original event path so an inside click stays inside after repaint.
    const path = event.composedPath();
    if(!directory.hidden && ![directory, entry, browse, feedToggle].some(node => node && path.includes(node)))closeFeed();
  });
  document.addEventListener?.('keydown', event => { if (event.key === 'Escape' && !directory.hidden) { closeFeed();entry?.focus(); } });
  document.getElementById('stream-saved-toggle').addEventListener('click',()=>{savedOnly=!savedOnly;detailItem=null;updateBackup();streamPage=0;moreOpen=false;document.getElementById('stream-saved-toggle').setAttribute('aria-pressed',String(savedOnly));paint();});
  document.getElementById('stream-refresh').addEventListener('click',()=>discover(true));
  function revealContent(element) {
    // Scroll only the picker, leaving the account view and browser page in place.
    directoryContent.scrollTop += element.getBoundingClientRect().top - directoryContent.getBoundingClientRect().top - 12;
  }
  document.getElementById('stream-more-toggle').addEventListener('click', () => {
    moreOpen = !moreOpen;
    paint();
    document.getElementById('stream-more-list').hidden = !moreOpen;
    document.getElementById('stream-more-toggle').setAttribute('aria-expanded', String(moreOpen));
    if (moreOpen) revealContent(document.getElementById('stream-more-list'));
  });
  document.getElementById('stream-url-toggle').addEventListener('click', () => {
    const advanced = document.getElementById('stream-advanced');
    advanced.hidden = !advanced.hidden;
    document.getElementById('stream-url-toggle').setAttribute('aria-expanded', String(!advanced.hidden));
    if (!advanced.hidden) revealContent(advanced);
  });
  document.getElementById('stream-stop').addEventListener('click',()=>{stop();disconnect();directory.hidden=true;setFeedExpanded(false);});
  expand.addEventListener('click',()=>{ if (expand.hidden) return; const on=root.classList.toggle('stream-expanded');setExpanded(on); });
  document.getElementById('stream-form').addEventListener('submit',async e=>{ e.preventDefault();const url=SidecarStreams.httpsUrl(document.getElementById('stream-url').value);if(!url)return;const name=document.getElementById('stream-url-name').value.trim() || new URL(url).hostname;const item=SidecarStreams.bookmark({url,title:name});if(document.getElementById('stream-url-save').checked && !await saveBookmarks([...savedStreams.filter(e=>e.key!==item.key),item]))return;play(url,name); });
  // Keep approval space usable even when the user was watching expanded video.
  const approval=document.getElementById('view-approval');
  new MutationObserver(()=>{
    const active=!approval.classList.contains('hidden');root.classList.toggle('stream-approving',active);syncVisibility();
    if(active){
      directory.hidden=true;disconnect();setFeedExpanded(false);
      if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    }
  }).observe(approval,{attributes:true,attributeFilter:['class']});
  if (lockView) new MutationObserver(() => {
    if (isLocked()) {
      directory.hidden = true; disconnect();
      setFeedExpanded(false);
      const advanced = document.getElementById('stream-advanced');
      if (advanced) advanced.hidden = true;
      document.getElementById('stream-url-toggle').setAttribute('aria-expanded', 'false');
    }
    syncVisibility();
  }).observe(lockView, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pagehide',()=>{stop();disconnect();});
  document.getElementById('stream-zap').addEventListener('click', () => {
    if (!selectedHost || isLocked() || root.classList.contains('stream-approving')) return;
    window.dispatchEvent(new CustomEvent('sidecar-stream-zap', { detail: { pubkey: selectedHost, event: selectedEvent && { id:selectedEvent.id, address:selectedEvent.key } } }));
  });
  const fab = document.getElementById('compose-fab');
  const composeMenu = document.getElementById('compose-menu');
  if (fab && composeMenu && document.addEventListener) {
    let closeTimer;
    function closeComposeMenu() {
      fab.setAttribute('aria-expanded','false');
      composeMenu.classList.remove('is-open'); composeMenu.classList.add('is-closing');
      clearTimeout(closeTimer);
      const duration=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')) || 150;
      closeTimer=setTimeout(()=>{composeMenu.hidden=true;composeMenu.classList.remove('is-closing');},duration);
    }
    fab.addEventListener('click',()=>{
      if(fab.disabled)return;
      if(!composeMenu.hidden && composeMenu.classList.contains('is-open')) {closeComposeMenu();return;}
      clearTimeout(closeTimer);
      composeMenu.hidden=false;composeMenu.classList.remove('is-closing');
      composeMenu.style.bottom=(window.innerHeight-fab.getBoundingClientRect().top+8)+'px';
      void composeMenu.offsetHeight;composeMenu.classList.add('is-open');fab.setAttribute('aria-expanded','true');
      document.getElementById('compose-note-btn').focus();
    });
    composeMenu.addEventListener('click',closeComposeMenu);
    document.addEventListener('click',event=>{if(!composeMenu.hidden&&!composeMenu.contains(event.target)&&!fab.contains(event.target))closeComposeMenu();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!composeMenu.hidden){closeComposeMenu();fab.focus();}});
    new MutationObserver(()=>{if(isLocked() || fab.disabled || document.getElementById('view-main').classList.contains('hidden') || !document.getElementById('view-approval').classList.contains('hidden'))closeComposeMenu();}).observe(document.getElementById('view-main'),{attributes:true,attributeFilter:['class']});
  }
  const toggle = document.getElementById('livevideo-toggle');
  function setEnabled(on) {
    enabled = on;
    if (!on) {
      stop(); disconnect(); directory.hidden = true;
      list.replaceChildren(); setFeedExpanded(false);
    }
    syncVisibility();
    if (toggle) toggle.checked = on;
    layout();
  }
  // Listen before the initial read so a newer preference always wins.
  let preferenceRevision = 0;
  toggle?.addEventListener('change', () => { preferenceRevision++; setEnabled(toggle.checked); });
  setEnabled(false);
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if(area==='local' && changes.sidecar_saved_streams){savedRevision++;savedStreams=(Array.isArray(changes.sidecar_saved_streams.newValue)?changes.sidecar_saved_streams.newValue:[]).map(SidecarStreams.bookmark).filter(Boolean);paint();}
      if (area === 'local' && changes.sidecar_settings) {
        preferenceRevision++;
        setEnabled(changes.sidecar_settings.newValue?.liveVideoEnabled !== false);
      }
    });
    const revision = preferenceRevision;
    chrome.storage.local.get('sidecar_settings').then(data => {
      if (revision === preferenceRevision) setEnabled(data.sidecar_settings?.liveVideoEnabled !== false);
    }).catch(() => { /* Keep the feature off if its saved preference cannot be read. */ });
  } else setEnabled(true); // Standalone review fixture, without extension storage.
  const readRevision=savedRevision;
  const restoreSaved=value=>{if(readRevision!==savedRevision)return;savedStreams=(Array.isArray(value)?value:[]).map(SidecarStreams.bookmark).filter(Boolean);paint();};
  if(savedStorage) {
    savedStorage.get('sidecar_saved_streams').then(data=>restoreSaved(data.sidecar_saved_streams)).catch(()=>{});
  } else if(typeof localStorage!=='undefined') {try {restoreSaved(JSON.parse(localStorage.getItem('sidecar_saved_streams')||'[]'));}catch(_) {}}

})();
