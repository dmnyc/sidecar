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
  const messageEl = document.getElementById('stream-message');
  const title = document.getElementById('stream-title');
  const browse = document.getElementById('stream-browse');           // LIVE: shows and hides the stream list
  const titleButton = document.getElementById('stream-title-button'); // the title: opens About stream
  const entry = document.getElementById('stream-entry');
  const feedToggle = document.getElementById('stream-feed-toggle');
  function setFeedExpanded(on) {
    feedToggle.setAttribute('aria-expanded', String(on));
    browse.setAttribute('aria-expanded', String(on));
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
  const details=window.SidecarStreamDetails?.mount({dock:root,title,trigger:titleButton,
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
    browse.disabled = titleButton.disabled = !!isLocked() || root.classList.contains('stream-approving');
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
  // EVERY STATUS MESSAGE IS SAID IN THE TOP ROW, next to LIVE, in the title's place, and none
  // on a line of its own: a line under the player grew the dock each time the player
  // connected, stalled or failed, and shrank it again after. The title gives way for as long
  // as the message lasts, nothing else in the dock moves, and the full text is in the
  // tooltip for the ones too long to fit.
  function message(text) {
    titleWindow.classList.toggle('stream-messaging', !!text);
    messageEl.hidden = !text;
    messageEl.textContent = text;
    if (text) messageEl.setAttribute('title', text); else messageEl.removeAttribute('title');
  }
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
  const ZAP_EXTRA_DEADLINE=30000, ZAP_EXTRA_BATCH=5;
  async function watchZaps(item, run, attempt = 0) {
    const output=document.getElementById('stream-zap-total');
    const cacheKey=item.key+':'+item.host;
    let session=zapSessions.get(cacheKey);
    if(!session){session={totals:new SidecarStreams.ZapTotals(),provider:null,rows:new Map()};zapSessions.set(cacheKey,session);}
    if(zapSessions.size>20)zapSessions.delete(zapSessions.keys().next().value);
    const controller=zapAbort=new AbortController();
    const active=zapPool=new NostrTools.SimplePool();
    const current=()=>run===generation && !controller.signal.aborted;
    let loading=true, extending=!session.extended, partial=true, answered=0, truncated=false, receiptPaintTimer=null, receiptAnimate=false;
    const hints=new Map();
    controller.signal.addEventListener('abort',()=>clearTimeout(receiptPaintTimer),{once:true});
    const paint=(animate=false)=>{
      if(!current())return;
      const value=SidecarI18n.fmtNum(session.totals.msats/1000,{notation:'compact',maximumFractionDigits:1});
      const counting=loading || extending;
      const mark=SidecarStreams.zapTotalMark({count:session.totals.count,loading:counting,answered,truncated});
      const text=session.totals.count ? value+mark : mark;
      // Nothing to show, nothing drawn: an empty total is hidden rather than left as a blank slot.
      output.hidden=!text;
      setZapDigits(output,text,animate);
      // A total still being counted pulses instead of trailing an ellipsis.
      output.classList.toggle('stream-zap-counting',counting && !!session.totals.count);
      if(animate)shineZap();
      output.title=counting ? t('Loading verified zap history…') : SidecarStreams.zapTotalUncertain({answered,truncated}) ? t('Zap history incomplete; retrying available relays.') : t('Verified zaps observed on available relays; other receipts may exist.');
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
          for(const url of SidecarStreams.relayHints(request))hints.set(url,(hints.get(url)||0)+1);
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
        loading=false;partial=!result.complete;answered=result.answered;truncated=!!result.truncated;if(!partial)watermark=before;paint();
        zapHistoryTimer=setTimeout(()=>{if(!current())return;live.close();live=subscribe();recover().catch(()=>{});},60000);
      };
      // The second scan reads more relays once the first has answered, so the player is never kept
      // waiting on it. It pulses the total until it is done or its deadline passes.
      const extend=async()=>{
        if(!current())return;
        const more=session.extended ? [] : SidecarStreams.extraZapRelays({known:sources,hints});
        if(!more.length){extending=false;paint();return;}
        const stop=new AbortController(),abort=()=>stop.abort();
        controller.signal.addEventListener('abort',abort,{once:true});
        const cap=setTimeout(abort,ZAP_EXTRA_DEADLINE);
        try {
          for(let i=0;i<more.length && !stop.signal.aborted;i+=ZAP_EXTRA_BATCH) {
            const result=await SidecarStreams.zapHistory({sources:more.slice(i,i+ZAP_EXTRA_BATCH),query:(relay,request)=>SidecarStreams.relayPage(active,relay,request,stop.signal),accept,filter,signal:stop.signal});
            if(!current())return;
            answered+=result.answered;truncated=truncated || !!result.truncated;paint();
          }
          if(!stop.signal.aborted)session.extended=true;
        } finally {
          clearTimeout(cap);controller.signal.removeEventListener('abort',abort);
          if(current()){extending=false;paint();}
        }
      };
      await recover();
      await extend();
    } catch (_) {
      active.destroy();if(!current())return;
      loading=false;extending=false;partial=true;paint();
      if(attempt<2)zapRetryTimer=setTimeout(()=>{zapRetryTimer=null;if(current())watchZaps(item,run,attempt+1);},[2000,5000][attempt]);
    }
  }
  function play(url, label, host, item) {
    if (!enabled || isLocked()) return;
    url = SidecarStreams.httpsUrl(url);
    if (!url) {
      // A correction, not a state: it must not keep the title of a stream that is playing fine
      // covered, so it clears itself.
      const text = t('Enter an HTTPS stream URL.');
      message(text);
      setTimeout(() => { if (messageEl.textContent === text) message(''); }, 4000);
      return;
    }
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
        // A host nothing answered for gets one more ask once the miss has expired. updatePlayingProfile
        // puts the name and picture in place if it finds them.
        if (!picture && !profileImages.get(host)?.name) setTimeout(() => { if (run === generation) profileImage(host, item?.relays); }, PROFILE_MISS_MS + 500);
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
    if (!isHls) { video.src = url; begin(); return; }
    loadHls().then((loaded) => {
      if (run !== generation) return;
      if (loaded && Hls.isSupported()) {
        hls = new Hls({ enableWorker: false, backBufferLength: 15, maxBufferLength: 20 });
        hls.on(Hls.Events.ERROR, (_, data) => { if (run === generation && data.fatal) message(t('Stream unavailable. Choose another stream or try again.')); });
        hls.on(Hls.Events.MANIFEST_PARSED, begin);
        hls.loadSource(url); hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url; begin();
      } else {
        message(loaded ? t('This browser cannot play this stream.') : t('Stream unavailable. Choose another stream or try again.'));
      }
    });
  }
  // hls.js is 1.65 MB and only a stream needs it, so it is injected on the first HLS play
  // instead of loading with the panel (the jsqr pattern in sidepanel.js). Resolves true or
  // false and never rejects; a failed load clears the memo so the next play tries again.
  let hlsPromise = null;
  function loadHls() {
    if (typeof Hls !== 'undefined') return Promise.resolve(true);
    if (hlsPromise) return hlsPromise;
    hlsPromise = new Promise((resolve) => {
      const tag = document.createElement('script');
      tag.src = 'hls.js';
      tag.onload = () => { const ok = typeof Hls !== 'undefined'; if (!ok) hlsPromise = null; resolve(ok); };
      tag.onerror = () => { hlsPromise = null; tag.remove(); resolve(false); };
      document.head.appendChild(tag);
    });
    return hlsPromise;
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
    const record = { expiresAt: Infinity, promise: null, name: '', banner: null };
    record.promise = new Promise(resolve => { profileWaiting.set(host, { record, resolve, hints }); });
    profileImages.set(host, record);
    if (profileFlushTimer === null) profileFlushTimer = setTimeout(flushProfiles, PROFILE_WINDOW_MS);
    return record.promise;
  }
  // PROFILE LOOKUPS ARE BATCHED. Every row of the list and the player want a host's profile, and each
  // used to open a pool of its own: a list of twenty opened about eighty connections at once, relays
  // refused many of them, and a refused lookup read as "no profile". Asks made within a moment now
  // share one read, one request per relay for every host in it, and each host settles the moment its
  // profile arrives instead of waiting for the slowest relay. A miss is remembered for seconds, not
  // half a minute, so it cannot outlive the next try.
  const PROFILE_WINDOW_MS = 40, PROFILE_BATCH = 50, PROFILE_HIT_MS = 300000, PROFILE_NO_PICTURE_MS = 30000, PROFILE_MISS_MS = 3000, PROFILE_DECLARED_HOSTS = 4;
  const profileWaiting = new Map();
  let profileFlushTimer = null;
  async function flushProfiles() {
    profileFlushTimer = null;
    const waiting = [...profileWaiting];
    profileWaiting.clear();
    for (let at = 0; at < waiting.length; at += PROFILE_BATCH) await readProfiles(waiting.slice(at, at + PROFILE_BATCH));
  }
  async function readProfiles(entries) {
    const byHost = new Map(entries), settled = new Set();
    const settle = (host, profile) => {
      const entry = byHost.get(host);
      if (!entry) return;
      const { record, resolve } = entry;
      // The first profile to arrive settles the host. A newer version arriving later from a slower relay
      // corrects the name and picture, though not a row that has already been drawn.
      if (settled.has(host) && !(profile && profile.created_at > (record.created || 0))) return;
      const first = !settled.has(host);
      settled.add(host);
      let picture = null;
      if (profile) {
        picture = SidecarStreams.httpsUrl(profile.content?.picture);
        record.banner = SidecarStreams.httpsUrl(profile.content?.banner);
        record.name = profile.name || '';
        record.created = profile.created_at || 0;
      }
      record.expiresAt = Date.now() + (picture ? PROFILE_HIT_MS : profile ? PROFILE_NO_PICTURE_MS : PROFILE_MISS_MS);
      updatePlayingProfile(host, record, picture);
      if (first) resolve(picture);
    };
    // Selecting a stream closes discovery; profile resolution must finish independently.
    const pool = new NostrTools.SimplePool();
    try {
      const hints = [...new Set(entries.flatMap(([, entry]) => entry.hints || []).filter(url => typeof url === 'string' && url.startsWith('wss://')))].slice(0, 6);
      const sources = [...new Set([...relays, 'wss://purplepag.es', ...hints])];
      await SidecarStreams.profileBatch({ pool, sources, keys: [...byHost.keys()], verify: NostrTools.verifyEvent, onProfile: settle });
      // A host nobody had a profile for may publish it only to relays it declares in its own list.
      const missing = [...byHost.keys()].filter(host => !settled.has(host))
        .sort((a, b) => (b === selectedHost) - (a === selectedHost)).slice(0, PROFILE_DECLARED_HOSTS);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(2, missing.length) }, async () => {
        while (next < missing.length) {
          const host = missing[next++];
          const relayList = await pool.get(sources, { kinds: [10002], authors: [host] }, { maxWait: 3000 });
          const declared = [...new Set((relayList?.tags || []).filter(tag => tag[0] === 'r' && typeof tag[1] === 'string' && tag[1].startsWith('wss://')).map(tag => tag[1]))].filter(url => !sources.includes(url)).slice(0, 6);
          if (!declared.length) continue;
          const event = await pool.get(declared, { kinds: [0], authors: [host] }, { maxWait: 3000 });
          try {
            const content = JSON.parse(event?.content || '{}');
            if (content && typeof content === 'object') settle(host, { content, name: [content.display_name, content.displayName, content.name].find(x => typeof x === 'string' && x.trim()) || '' });
          } catch (_) {}
        }
      }));
      for (const host of byHost.keys()) settle(host, null);
    } catch (_) {
      // The lookup itself failed, which says nothing about the profile: forget it so the next ask tries again.
      for (const [host, { record, resolve }] of byHost) {
        if (settled.has(host)) continue;
        settled.add(host);
        if (profileImages.get(host) === record) profileImages.delete(host);
        resolve(null);
      }
    } finally { pool.destroy(); }
  }
  // THE DIRECTORY IS A LIST THAT SCROLLS, NOT A SET OF PAGES. Rows are revealed REVEAL_BATCH at a
  // time as the end of a list nears the bottom of the scroller, and fetched from history when
  // there are no more known ones. `reveal` is how many of each list are showing.
  const REVEAL_BATCH = 20;
  const reveal = { main: REVEAL_BATCH, more: REVEAL_BATCH };
  const listTotals = { main: 0, more: 0 };
  let category = 'live', detailItem = null, detailScroll = 0;
  let historyLoaded = false, historyBusy = false;
  // A history scan that came back with nothing while more history remains. It is not retried on
  // its own: the list ends in a button, so the reader chooses to keep looking.
  let historyStalled = false;
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
    detailScroll=directoryContent.scrollTop;detailItem=item; paint(); revealContent(list); list.querySelector('.stream-history-back')?.focus();
  }
  function drawDirectoryDetails(item) {
    const content=document.createElement('section');content.className='stream-directory-detail';
    const header=document.createElement('div');header.className='stream-directory-detail-header';
    const back=document.createElement('button');back.type='button';back.className='stream-history-back ghost';back.setAttribute('aria-label',t('Back'));back.title=t('Back');
    back.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14"/></svg>';
    back.onclick=()=>{detailItem=null;paint();directoryContent.scrollTop=detailScroll;};
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
    const copyAddress=copyAddressButton(item);if(copyAddress)header.append(copyAddress);
    header.append(save);list.append(content);
  }
  async function loadHistory(reset=false) {
    if(historyBusy || !enabled || isLocked() || !pool)return;
    if(reset){historyCursors.clear();historyLoaded=false;historyStalled=false;}
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
  // Fetch the next batch of history for the list that has run out of known streams. Bounded: a
  // sparse history cannot trigger an unlimited scan, and a scan that finds nothing stops and asks.
  async function loadMoreHistory(kind) {
    if(historyBusy || historyPaging || !canLoadHistory())return;
    const run=discoveryGeneration, view=category, extra=kind==='more';
    const current=()=>run===discoveryGeneration && view===category && !savedOnly && !detailItem;
    const known=()=>(view==='past'?model.past():model.upcoming()).filter(item=>(item.title==='Untitled livestream')===extra).length;
    const before=known();
    historyPaging=true;paint();
    try {
      // A relay batch may contain only duplicates or another category. Keep looking, but
      // bound each trigger.
      for(let attempt=0;attempt<5 && canLoadHistory();attempt++) {
        const cursors=JSON.stringify([...historyCursors]);
        await loadHistory();
        if(!current())return;
        if(known()>before)return;
        if(cursors===JSON.stringify([...historyCursors]))break;
      }
      if(current())historyStalled=canLoadHistory();
    } finally {historyPaging=false;paint();}
  }
  // ROWS ARE KEPT ACROSS REPAINTS. paint() runs on every discovery event, on a timer and on every
  // history load, and a list that is rebuilt each time loses the reader's place and flashes
  // every thumbnail. A row is built once per stream and reused until something it shows changes.
  const rowCache = new Map();
  const rowSig = item => JSON.stringify([item.title,item.status,item.starts,item.ends,item.recording||'',item.image||'',item.thumb||'',item.host||'',savedOnly,savedStreams.some(e=>e.key===item.key)]);
  function syncRows(container, items) {
    const wanted=[];
    for(const item of items) {
      const sig=rowSig(item);let kept=rowCache.get(item.key);
      if(!kept || kept.sig!==sig){kept={sig,row:buildRow(item)};rowCache.set(item.key,kept);}
      else kept.row.refreshAvatar?.();
      wanted.push(kept.row);
    }
    // Touch only what differs, so the scroll position and the loaded images stay where they are.
    wanted.forEach((row,index)=>{const at=container.children[index];if(at!==row)container.insertBefore(row,at||null);});
    while(container.children.length>wanted.length)container.lastElementChild.remove();
  }
  function resetReveal() {
    reveal.main=reveal.more=REVEAL_BATCH;historyStalled=false;rowCache.clear();
    directoryContent.scrollTop=0;
  }
  // What closes a list: the next batch is on its way, there is a button to keep looking, or there
  // is nothing more. An empty foot still holds its place, because it is what the scroll watches.
  const foot = { main: makeFoot('main'), more: makeFoot('more') };
  function makeFoot(kind) {
    const el=document.createElement('div');el.className='stream-list-foot';el.setAttribute('role','status');el.setAttribute('data-list',kind);return el;
  }
  function paintFoot(kind, total) {
    const el=foot[kind];el.replaceChildren();
    if(total>reveal[kind])return;                       // more is known: the scroll will reveal it
    if(canLoadHistory()) {
      if(historyBusy || historyPaging)el.textContent=t('Loading…');
      else if(historyStalled) {
        const again=document.createElement('button');again.type='button';again.className='ghost';again.textContent=t('Keep looking');
        again.addEventListener('click',()=>{historyStalled=false;loadMoreHistory(kind);});
        el.append(again);
      }
    } else if(total>REVEAL_BATCH)el.textContent=t('No more streams available.');
  }
  // Is the end of this list within reach of the bottom of the scroller?
  function nearEnd(kind) {
    const el=foot[kind];
    if(!el || el.hidden || directory.hidden || detailItem || !directoryContent.clientHeight)return false;
    return el.getBoundingClientRect().top <= directoryContent.getBoundingClientRect().bottom + 160;
  }
  function loadMore(kind) {
    if(listTotals[kind]>reveal[kind]){reveal[kind]+=REVEAL_BATCH;paint();return;}
    if(canLoadHistory() && !historyBusy && !historyPaging && !historyStalled)loadMoreHistory(kind);
  }
  let endCheck=null;
  function scheduleEndCheck() {
    if(endCheck!==null)return;
    endCheck=(typeof requestAnimationFrame==='function'?requestAnimationFrame:setTimeout)(()=>{
      endCheck=null;
      for(const kind of ['main','more'])if(nearEnd(kind)){loadMore(kind);break;}
    });
  }
  let moreOpen = false;
  let lookingForStreams = false;
  // A row's avatar. It is asked for when the row is built and again each time the row is reused,
  // until a profile has answered, because a reused row is not rebuilt: a lookup that came back
  // after the list had reconnected used to be dropped, and its row kept a blank avatar for good.
  // The avatar is this row's own to set whenever it arrives; only the player's artwork, which is
  // shared, waits on the discovery that asked for it.
  //
  // The two artwork layers under the row's thumbnail are passed in. They were once used here without
  // being given, so as soon as a profile arrived the line that set them threw a ReferenceError inside
  // the promise, silently, and a stream whose own image did not load never got its host's picture or
  // banner as a thumbnail.
  function rowAvatar(item, avatar, profileArtwork, bannerArtwork) {
    const run=discoveryGeneration;
    let answered=false, asking=false;
    return function refresh() {
      if(!item.host || answered || asking)return;
      asking=true;
      profileImage(item.host, item.relays).then(url=>{
        asking=false;
        const picture = url || item.image; // Stream artwork is preferable to an empty avatar when no profile is published.
        if(url)answered=true;
        if(picture && avatar.getAttribute('src')!==picture)avatar.src=picture;
        if(run!==discoveryGeneration)return;
        if(url)profileArtwork.src=url;
        const banner=profileImages.get(item.host)?.banner;
        if(banner)bannerArtwork.src=banner;
      });
    };
  }
  // A stream's address, copied to the clipboard as an naddr: the same thing the stream box takes, so a
  // stream can be sent to someone and opened from it. Not offered for a saved video link, which has no
  // announcement behind it. The icon turns into a tick for a moment so the copy is seen to have happened.
  function copyAddressButton(item) {
    const address = SidecarStreams.streamAddress(item);
    if (!address) return null;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'stream-copy icon-btn';
    const label = t('Copy stream address');
    button.title = label; button.setAttribute('aria-label', label);
    const drawIcon = done => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
      if (done) {
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'path'); tick.setAttribute('d', 'M5 13l4 4L19 7'); svg.append(tick);
      } else {
        const back = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); back.setAttribute('x', '9'); back.setAttribute('y', '9'); back.setAttribute('width', '11'); back.setAttribute('height', '11'); back.setAttribute('rx', '2');
        const front = document.createElementNS('http://www.w3.org/2000/svg', 'path'); front.setAttribute('d', 'M5 15V6a2 2 0 0 1 2-2h9');
        svg.append(back, front);
      }
      button.replaceChildren(svg);
    };
    drawIcon(false);
    let timer = null;
    button.addEventListener('click', async event => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(NostrTools.nip19.naddrEncode(address));
      } catch (_) { return; }
      const copied = t('Copied');
      button.title = copied; button.setAttribute('aria-label', copied);
      drawIcon(true);
      clearTimeout(timer);
      timer = setTimeout(() => { button.title = label; button.setAttribute('aria-label', label); drawIcon(false); }, 1500);
    });
    return button;
  }
  function buildRow(item) {
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
      // The stream's own live frame (the thumb tag) outranks the host's banner but not the announced image.
      const thumbArtwork=document.createElement('img');thumbArtwork.alt='';thumbArtwork.hidden=true;
      thumbArtwork.referrerPolicy='no-referrer';
      thumb.insertBefore(thumbArtwork,artwork);
      thumbArtwork.addEventListener('load',()=>{thumbArtwork.hidden=false;});
      thumbArtwork.addEventListener('error',()=>{thumbArtwork.hidden=true;});
      if(item.thumb)thumbArtwork.src=item.thumb;
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
      const copyAddress=copyAddressButton(item);if(copyAddress)row.append(copyAddress);
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
      row.refreshAvatar=rowAvatar(item,avatar,profileArtwork,bannerArtwork);
      row.refreshAvatar();
      return row;
  }
  function paint() {
    const more = document.getElementById('stream-more-list');
    const actions=directory.querySelector('.stream-directory-actions');
    actions.hidden=!!detailItem;
    if(detailItem){
      list.replaceChildren();more.replaceChildren();foot.main.hidden=foot.more.hidden=true;
      detailItem=model.events.get(detailItem.key)||detailItem;more.hidden=true;document.getElementById('stream-advanced').hidden=true;drawDirectoryDetails(detailItem);return;
    }
    const items = savedOnly ? savedStreams : category==='upcoming' ? model.upcoming() : category==='past' ? model.past() : model.live();
    const named = items.filter(item => item.title !== 'Untitled livestream');
    const untitled = items.filter(item => item.title === 'Untitled livestream');
    listTotals.main=named.length;listTotals.more=untitled.length;
    if (!items.length) { const p=document.createElement('p');p.className='stream-empty';p.setAttribute('role','status');p.textContent=savedOnly ? t('No saved streams yet.') : (lookingForStreams || historyBusy) ? t('Looking for streams…') : category==='upcoming' ? t('No upcoming streams found.') : category==='past' ? t('No past streams found.') : t('No live streams found. Try refreshing.');list.replaceChildren(p); }
    else syncRows(list,named.slice(0,reveal.main));
    syncRows(more,untitled.slice(0,reveal.more));
    // Rows that left the lists are forgotten, so a long session does not hold every stream it saw.
    const keep=new Set([...named.slice(0,reveal.main),...untitled.slice(0,reveal.more)].map(item=>item.key));
    for(const key of [...rowCache.keys()])if(!keep.has(key))rowCache.delete(key);
    document.getElementById('stream-more-toggle').hidden = !untitled.length;
    more.hidden = !untitled.length || !moreOpen;
    foot.main.hidden=false;foot.more.hidden=more.hidden;
    paintFoot('main',named.length);paintFoot('more',untitled.length);
    const loading=historyBusy || historyPaging;
    list.setAttribute('aria-busy',String(loading));more.setAttribute('aria-busy',String(loading));
    scheduleEndCheck();
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
  // The streamer's avatar and name open their profile card in the panel, as chat names do. The
  // link to the web client stays as the fallback when no account is available to show it.
  function openHostProfile(event) {
    const bridge = window.SidecarStreamChatAccount;
    if (!selectedHost || !bridge?.identity()) return;
    event.preventDefault();
    bridge.profile(selectedHost);
  }
  document.getElementById('stream-host').addEventListener('click', openHostProfile);
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
    for(const id of ['relax-status','payment-status','mining-status']){
      const bar=document.getElementById(id);
      if(bar && bar.getClientRects().length && !bar.classList.contains('hidden'))bottom=Math.min(bottom,bar.getBoundingClientRect().top);
    }
    directory.style.top=top+'px';directory.style.height=Math.max(0,bottom-top)+'px';directory.style.maxHeight=directory.style.height;
  }
  window.addEventListener('resize',positionDirectory);
  for(const id of ['relax-status','payment-status','mining-status']){
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
      directoryError('');category=value;detailItem=null;savedOnly=false;moreOpen=false;resetReveal();
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
  // The end of each list, watched from inside the scroller. Where there is no IntersectionObserver
  // the scroll itself is watched.
  list.after(foot.main);document.getElementById('stream-more-list').after(foot.more);
  if(typeof IntersectionObserver==='function') {
    const ends=new IntersectionObserver(scheduleEndCheck,{root:directoryContent,rootMargin:'0px 0px 160px 0px'});
    ends.observe(foot.main);ends.observe(foot.more);
  } else directoryContent.addEventListener('scroll',scheduleEndCheck,{passive:true});
  new ResizeObserver(scheduleEndCheck).observe(directoryContent);
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
  // LIVE shows and hides the list, as the chevron does. The title keeps About stream.
  browse.addEventListener('click', toggleFeed);
  titleButton.addEventListener('click', ()=>details?details.toggle():toggleFeed());
  feedToggle.addEventListener('click', toggleFeed);
  entry?.addEventListener('click', toggleFeed);
  document.getElementById('acct-btn')?.addEventListener('click',()=>{if(!directory.hidden)closeFeed();});
  document.addEventListener?.('click',event=>{
    // Repainting pagination detaches the clicked button before this listener runs.
    // Use the original event path so an inside click stays inside after repaint.
    const path = event.composedPath();
    if(!directory.hidden && ![directory, entry, browse, titleButton, feedToggle].some(node => node && path.includes(node)))closeFeed();
  });
  document.addEventListener?.('keydown', event => { if (event.key === 'Escape' && !directory.hidden) { closeFeed();entry?.focus(); } });
  document.getElementById('stream-saved-toggle').addEventListener('click',()=>{savedOnly=!savedOnly;detailItem=null;updateBackup();moreOpen=false;resetReveal();document.getElementById('stream-saved-toggle').setAttribute('aria-pressed',String(savedOnly));paint();});
  document.getElementById('stream-refresh').addEventListener('click',()=>{resetReveal();discover(true);});
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
  // The naddr of a stream announcement is looked up on the relays and opened the way a row of the list
  // is: it plays if it is live or has a recording, and shows its details if it does not.
  // The lookup settles shortly after the first relay answers rather than waiting for the slowest:
  // another relay may hold a newer version of the announcement, so the others get a moment more.
  const STREAM_LOOKUP_GRACE_MS = 700, STREAM_LOOKUP_MAX_MS = 5000;
  async function findStream(address) {
    const pool = new NostrTools.SimplePool();
    const controller = new AbortController(), events = [];
    let grace = null;
    try {
      const sources = [...new Set([...address.relays, ...relays, 'wss://purplepag.es'])];
      const filter = { kinds: [30311], authors: [address.pubkey], '#d': [address.identifier] };
      await Promise.all(sources.map(url => SidecarStreams.relayPage(pool, url, filter, controller.signal, STREAM_LOOKUP_MAX_MS, event => {
        if (event.pubkey !== address.pubkey || !SidecarStreams.parse(event) || !NostrTools.verifyEvent(event)) return;
        events.push(event);
        if (grace === null) grace = setTimeout(() => controller.abort(), STREAM_LOOKUP_GRACE_MS);
      })));
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
      const item = newest && SidecarStreams.parse(newest);
      if (!item) return null;
      model.accept(newest);
      return model.events.get(item.key) || item;
    } finally { clearTimeout(grace); controller.abort(); pool.destroy(); }
  }
  let streamFormBusy = false;
  const streamForm = document.getElementById('stream-form');
  streamForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (streamFormBusy || !enabled || isLocked()) return;
    const typed = SidecarStreams.parseStreamAddress(document.getElementById('stream-url').value, value => NostrTools.nip19.decode(value));
    if (!typed) return;
    directoryError('');
    if (typed.error) { directoryError(typed.error === 'not-a-stream' ? t('That address is not a stream.') : t('Enter a video link or a stream naddr.')); return; }
    const save = document.getElementById('stream-url-save').checked;
    if (typed.url) {
      const name = document.getElementById('stream-url-name').value.trim() || new URL(typed.url).hostname;
      const item = SidecarStreams.bookmark({ url: typed.url, title: name });
      if (save && !await saveBookmarks([...savedStreams.filter(row => row.key !== item.key), item])) return;
      play(typed.url, name);
      return;
    }
    streamFormBusy = true;
    const submit = streamForm.querySelector('button[type=submit]'), label = submit.textContent;
    submit.disabled = true; submit.textContent = t('Looking…');
    try {
      const item = await findStream(typed.naddr);
      if (!item) { directoryError(t('Could not find that stream. Check the address and try again.')); return; }
      if (save) {
        const entry = SidecarStreams.bookmark(item);
        if (entry && !await saveBookmarks([...savedStreams.filter(row => row.key !== entry.key), entry])) return;
      }
      openDirectoryItem(item);
    } catch (_) {
      directoryError(t('Could not find that stream. Check the address and try again.'));
    } finally { streamFormBusy = false; submit.disabled = false; submit.textContent = label; }
  });
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
  // The total sits against the bolt and reads as part of it, so a click on it is a click on the bolt.
  document.getElementById('stream-zap-total').addEventListener('click', () => document.getElementById('stream-zap').click());
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
