/* A persistent public player: refresh(), lock, and approval never recreate its video. */
(() => {
  'use strict';
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
    browse.setAttribute('aria-expanded', String(on));
    feedToggle.setAttribute('aria-expanded', String(on));
    entry?.setAttribute('aria-expanded', String(on));
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
    if (!error) { error=document.createElement('p');error.id='stream-save-error';error.setAttribute('role','status');directory.append(error); }
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
      const current=latest.live().find(e=>e.key===item.key);
      if(current)play(current.url,current.title,current.host,current);
      else directoryError(t('This saved stream is not live or could not be reached.'));
    } catch (_) { if(run===discoveryGeneration)directoryError(t('Could not load the saved stream. Try again.')); }
    finally { lookup.destroy(); }
  }
  const model = new SidecarStreams.Directory();
  let hls = null, pool = null, subscription = null, timer = null, selected = false, generation = 0, discoveryGeneration = 0, discoveryAbort = null;
  let enabled = false;
  let selectedHost = null, selectedEvent = null, zapPool = null, zapAbort = null, zapRetryTimer = null;
  const lockView = document.getElementById('view-lock');
  const isLocked = () => lockView && !lockView.classList.contains('hidden');
  function syncVisibility() {
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
  }
  new ResizeObserver(layout).observe(root);
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
    expand.setAttribute('aria-expanded',String(on));
    expand.setAttribute('aria-label',t(label));
    expand.setAttribute('title',t(label));
    expand.setAttribute('data-i18n-aria-label',label);
    expand.setAttribute('data-i18n-title',label);
  }
  function stop() {
    selectedHost = null; selectedEvent = null;
    document.getElementById('stream-zap').classList.remove('is-shining');
    clearTimeout(zapRetryTimer); zapRetryTimer=null;
    zapAbort?.abort(); zapAbort = null; zapPool?.destroy(); zapPool = null;
    document.getElementById('stream-zap-total').hidden = true;
    document.getElementById('stream-info').hidden = true;
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
  async function watchZaps(item, run, attempt = 0) {
    const output = document.getElementById('stream-zap-total');
    output.hidden = true; output.replaceChildren();
    output.removeAttribute('title');
    output.removeAttribute('aria-label');
    const controller = zapAbort = new AbortController();
    const active = zapPool = new NostrTools.SimplePool();
    const sources = [...new Set([...item.relays || [], ...relays, 'wss://purplepag.es'])];
    try {
      const meta = await SidecarStreams.zapProvider(active, sources, item.host, controller.signal, fetch);
      if (run !== generation || controller.signal.aborted) return;
      const totals = new SidecarStreams.ZapTotals();
      const subscribedAt = Math.floor(Date.now() / 1000);
      let historyLoaded = false;
      const paintTotals = (animate) => {
        if (run !== generation || controller.signal.aborted) return;
        output.hidden = false;
        if (animate) shineZap();
        setZapDigits(output, SidecarI18n.fmtNum(totals.msats/1000, {notation:'compact', maximumFractionDigits:1}), animate);
        output.title = t('{{sats}} sats · {{count}} zaps observed for this event', {sats:SidecarI18n.fmtNum(totals.msats/1000),count:SidecarI18n.fmtNum(totals.count)});
        output.setAttribute('aria-label', output.title);
      };
      active.subscribeMany(sources, {kinds:[9735], '#a':[item.key], '#p':[item.host], limit:1000}, {
        abort:controller.signal,
        oneose: () => { historyLoaded = true; },
        onevent: async receipt => {
          const animate = historyLoaded && receipt.created_at >= subscribedAt;
          const accepted = await totals.accept(receipt, {address:item.key, recipient:item.host, provider:meta.nostrPubkey,
            verify:NostrTools.verifyEvent,
            digest: async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))), b=>b.toString(16).padStart(2,'0')).join('') });
          if (accepted) paintTotals(animate);
        }
      });
    } catch (_) {
      active.destroy();
      if (run !== generation || controller.signal.aborted) return;
      // Retry transient profile/provider failures, never invent a zero total.
      if (attempt < 2) zapRetryTimer=setTimeout(()=>{
        zapRetryTimer=null;
        if(run===generation && !controller.signal.aborted)watchZaps(item,run,attempt+1);
      }, [2000,5000][attempt]);
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
      const fallbackName = label && label !== 'Untitled livestream' && label !== t('Untitled livestream') ? label : npub.slice(0,12) + '…';
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
      viewers.hidden = item?.viewers == null;
      if (!viewers.hidden) {
        viewers.textContent = SidecarI18n.fmtNum(item.viewers);
        viewers.title = t('Reported viewers');
        viewers.setAttribute('aria-label',t('Reported viewers: {{count}}', { count: SidecarI18n.fmtNum(item.viewers) }));
      }
    }

    selected = true; document.getElementById('stream-stop').hidden = false; video.hidden = false; root.classList.add('stream-playing'); expand.hidden = false;
    title.textContent = label || t('Untitled livestream'); title.setAttribute('title',title.textContent); measureTitle(); message(t('Connecting…')); directory.hidden = true; setFeedExpanded(false); disconnect();
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
  const PAGE_SIZE = 6;
  let streamPage = 0, morePage = 0;
  function paginate(container, items, requested, changePage) {
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = Math.max(0, Math.min(requested, pages - 1));
    if (pages > 1 && (container === list ? !moreOpen : moreOpen)) {
      const nav = document.createElement('div'); nav.className = 'stream-pagination';
      for (const [label, delta] of [['Previous', -1], ['Next', 1]]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-btn';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', delta < 0 ? 'M16 3l-9 9 9 9' : 'M8 3l9 9-9 9');
        svg.append(path); button.append(svg);
        button.setAttribute('aria-label', t(label)); button.title = t(label); button.disabled = delta < 0 ? page === 0 : page === pages - 1;
        button.addEventListener('click', () => { changePage(page + delta); paint(); revealContent(container); });
        nav.append(button);
      }
      document.getElementById('stream-page-controls').append(nav);
    }
    return { page, items: items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) };
  }
  let moreOpen = false;
  let lookingForStreams = false;
  function paint() {
    document.getElementById('stream-page-controls').replaceChildren();
    list.replaceChildren();
    const more = document.getElementById('stream-more-list'); more.replaceChildren();
    const items = savedOnly ? savedStreams : model.live();
    if (!items.length) { const p=document.createElement('p');p.className='stream-empty';p.setAttribute('role','status');p.textContent=savedOnly ? t('No saved streams yet.') : lookingForStreams ? t('Looking for streams…') : t('No live streams found. Try refreshing.');list.append(p); }
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
      const label=document.createElement('span'); label.textContent=item.title === 'Untitled livestream' ? t('Untitled livestream') : item.title;label.dir='auto';label.className='stream-result-title';button.title=label.textContent;button.append(label);
      button.addEventListener('click',()=>savedOnly ? openSaved(item) : play(item.url,label.textContent,item.host,item));
      const save=document.createElement('button');save.type='button';save.className='stream-bookmark icon-btn';
      const isSaved=savedStreams.some(e=>e.key===item.key);
      save.setAttribute('aria-pressed',String(isSaved));save.title=t(isSaved?'Remove saved stream':'Save stream');save.setAttribute('aria-label',save.title);
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
  }
  let directoryPaintTimer=null;
  function queueDirectoryPaint() {
    if(directoryPaintTimer!==null)return;
    directoryPaintTimer=setTimeout(()=>{directoryPaintTimer=null;paint();},100);
  }
  function disconnect() { clearTimeout(directoryPaintTimer);directoryPaintTimer=null;discoveryGeneration++; discoveryAbort?.abort(); discoveryAbort=null; subscription?.close(); subscription=null; pool?.destroy(); pool=null; clearInterval(timer);timer=null; }
  function discover() {
    if (!enabled || isLocked()) return;
    disconnect(); lookingForStreams = true; paint();
    const run=discoveryGeneration; discoveryAbort=new AbortController();
    // Public, read-only discovery; never authenticate or keep the keystore awake.
    pool = new NostrTools.SimplePool();
    subscription = pool.subscribeMany(relays,
      { kinds:[30311], since:Math.floor(Date.now()/1000)-3600, limit:100 },
      { abort:discoveryAbort.signal, onevent:event=>{if(run===discoveryGeneration && model.accept(event))queueDirectoryPaint();}, oneose:()=>{if(run===discoveryGeneration){lookingForStreams=false;paint();}} });
    timer=setInterval(paint,30000);
  }
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
    window.dispatchEvent(new CustomEvent('sidecar-open-streams'));
    // Anchor below the toolbar so the account switcher remains reachable during playback.
    document.body.append(directory); directory.classList.add('stream-idle-directory','t-dropdown');
    directory.setAttribute('data-origin','top-center');
    directory.style.top=((entry?.getBoundingClientRect().bottom || 56)+8)+'px';
    directory.style.maxHeight='calc(100dvh - '+directory.style.top+' - 12px)';
    directory.hidden=false;directory.classList.remove('is-closing');
    void directory.offsetHeight;directory.classList.add('is-open');setFeedExpanded(true);discover();
  }
  browse.addEventListener('click', toggleFeed);
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
  document.getElementById('stream-saved-toggle').addEventListener('click',()=>{savedOnly=!savedOnly;streamPage=0;moreOpen=false;document.getElementById('stream-saved-toggle').setAttribute('aria-pressed',String(savedOnly));paint();});
  document.getElementById('stream-refresh').addEventListener('click',discover);
  function revealContent(element) {
    // Scroll only the picker, leaving the account view and browser page in place.
    directory.scrollTop += element.getBoundingClientRect().top - directory.getBoundingClientRect().top - 12;
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
