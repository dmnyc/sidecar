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
  const expand = document.getElementById('stream-expand');
  const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
  const profileImages = new Map();
  const model = new SidecarStreams.Directory();
  let hls = null, pool = null, subscription = null, timer = null, selected = false, generation = 0, discoveryGeneration = 0, discoveryAbort = null;
  let enabled = false;
  let selectedHost = null;
  const lockView = document.getElementById('view-lock');
  const isLocked = () => lockView && !lockView.classList.contains('hidden');
  function syncVisibility() {
    root.hidden = !enabled || (isLocked() && !selected);
    document.getElementById('stream-zap').disabled = !!isLocked() || root.classList.contains('stream-approving');
    browse.disabled = !!isLocked() || root.classList.contains('stream-approving');
    layout();
  }

  function layout() {
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
    selectedHost = null; document.getElementById('stream-info').hidden = true;
    root.classList.remove('stream-pip');
    generation++;
    if (hls) { hls.destroy(); hls = null; }
    video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
    setExpanded(false);
    document.getElementById('stream-stop').hidden = true;
    selected = false; root.classList.remove('stream-playing', 'stream-expanded');
    title.textContent = ''; title.removeAttribute('title'); expand.hidden = true; message(''); syncVisibility();
  }
  function play(url, label, host, item) {
    if (!enabled || isLocked()) return;
    url = SidecarStreams.httpsUrl(url);
    if (!url) { message(t('Enter an HTTPS stream URL.')); return; }
    stop(); const run = generation;
    selectedHost = host || null;
    if (host) {
      const npub = NostrTools.nip19.npubEncode(host);
      document.getElementById('stream-info').hidden = false;
      document.getElementById('stream-host').href = 'https://primal.net/p/' + npub;
      document.getElementById('stream-host-name').textContent = profileImages.get(host)?.name || npub.slice(0,12) + '…';
      const avatar = document.getElementById('stream-host-image'); avatar.hidden = true;
      avatar.onload = () => { if (run === generation) avatar.hidden = false; };
      avatar.onerror = () => { avatar.hidden = true; };
      profileImage(host).then(picture => {
        if (run !== generation) return;
        document.getElementById('stream-host-name').textContent = profileImages.get(host)?.name || npub.slice(0,12) + '…';
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
    title.textContent = label || t('Untitled livestream'); title.setAttribute('title',title.textContent); measureTitle(); message(t('Connecting…')); directory.hidden = true; browse.setAttribute('aria-expanded','false'); disconnect();
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
  function profileImage(host) {
    const cached = profileImages.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    if (!pool || !enabled || isLocked()) return Promise.resolve(null);
    const signal = discoveryAbort?.signal;
    const record = { expiresAt: Infinity, promise: null };
    record.promise = pool.get([...relays, 'wss://purplepag.es'], {kinds:[0], authors:[host]}, {abort:signal, maxWait:4000}).then(event => {
      let picture = null;
      try { const content = JSON.parse(event?.content || '{}'); picture = SidecarStreams.httpsUrl(content.picture); record.name = content.display_name || content.displayName || content.name || ''; } catch (_) {}
      record.expiresAt = Date.now() + (picture ? 300000 : 30000);
      if (signal?.aborted && profileImages.get(host) === record) profileImages.delete(host);
      return picture;
    }).catch(() => {
      if (profileImages.get(host) === record) profileImages.delete(host);
      return null;
    });
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
  function paint() {
    document.getElementById('stream-page-controls').replaceChildren();
    list.replaceChildren();
    const more = document.getElementById('stream-more-list'); more.replaceChildren();
    const items = model.live();
    if (!items.length) { const p=document.createElement('p');p.textContent=t('No live streams found. Try refreshing.');list.append(p); }
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
      const placeholder = document.createElement('span'); placeholder.className = 'stream-thumbnail-play'; thumb.append(placeholder);
      if(item.image) {
        const img=document.createElement('img');img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
        img.addEventListener('error', async () => {
          img.hidden=true;
          const activePool=pool, run=discoveryGeneration;
          if (!activePool || !enabled || isLocked()) return;
          const fallback=await profileImage(item.host);
          if(run!==discoveryGeneration || !fallback || fallback===img.src) return;
          img.src=fallback;img.hidden=false;
        });img.src=item.image;thumb.append(img);
      }
      button.append(thumb);
      const label=document.createElement('span'); label.textContent=item.title === 'Untitled livestream' ? t('Untitled livestream') : item.title;label.dir='auto';label.className='stream-result-title';button.title=label.textContent;button.append(label);
      button.addEventListener('click',()=>play(item.url,label.textContent,item.host,item));
      const profile=document.createElement('a');profile.className='stream-avatar';
      profile.href='https://primal.net/p/'+NostrTools.nip19.npubEncode(item.host);
      profile.target='_blank';profile.rel='noopener noreferrer';
      profile.setAttribute('aria-label',t('Streamer profile'));profile.title=t('Streamer profile');
      const avatar=document.createElement('img');avatar.alt='';avatar.hidden=true;avatar.referrerPolicy='no-referrer';
      avatar.addEventListener('load',()=>{avatar.hidden=false;});avatar.addEventListener('error',()=>{
        avatar.hidden=true;
        if (item.image && avatar.src !== item.image) avatar.src=item.image;
      });
      profile.append(avatar);row.append(button,profile);
      const run=discoveryGeneration;
      profileImage(item.host).then(url=>{
        const picture = url || item.image; // Stream artwork is preferable to an empty avatar when no profile is published.
        if(picture && run===discoveryGeneration)avatar.src=picture;
      });
      if (item.title === 'Untitled livestream') { more.append(row); }
      else list.append(row);
    }
    document.getElementById('stream-more-toggle').hidden = !untitledCount;
    more.hidden = !untitledCount || !moreOpen;
  }
  function disconnect() { discoveryGeneration++; discoveryAbort?.abort(); discoveryAbort=null; subscription?.close(); subscription=null; pool?.destroy(); pool=null; clearInterval(timer);timer=null; }
  function discover() {
    if (!enabled || isLocked()) return;
    disconnect(); paint();
    const run=discoveryGeneration; discoveryAbort=new AbortController();
    // Public, read-only discovery; never authenticate or keep the keystore awake.
    pool = new NostrTools.SimplePool();
    subscription = pool.subscribeMany(relays,
      { kinds:[30311], since:Math.floor(Date.now()/1000)-3600, limit:100 },
      { abort:discoveryAbort.signal, onevent:event=>{if(run===discoveryGeneration && model.accept(event))paint();}, oneose:()=>{if(run===discoveryGeneration)paint();} });
    timer=setInterval(paint,30000);
  }
  browse.addEventListener('click',()=>{ if (!enabled || isLocked() || browse.disabled) return; directory.hidden=!directory.hidden;browse.setAttribute('aria-expanded',String(!directory.hidden));if(directory.hidden)disconnect();else discover(); });
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
  document.getElementById('stream-stop').addEventListener('click',()=>{stop();disconnect();directory.hidden=true;browse.setAttribute('aria-expanded','false');});
  expand.addEventListener('click',()=>{ const on=root.classList.toggle('stream-expanded');setExpanded(on); });
  document.getElementById('stream-form').addEventListener('submit',e=>{ e.preventDefault();play(document.getElementById('stream-url').value,t('Live stream')); });
  // Keep approval space usable even when the user was watching expanded video.
  const approval=document.getElementById('view-approval');
  new MutationObserver(()=>{
    const active=!approval.classList.contains('hidden');root.classList.toggle('stream-approving',active);syncVisibility();
    if(active){
      directory.hidden=true;disconnect();browse.setAttribute('aria-expanded','false');
      if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    }
  }).observe(approval,{attributes:true,attributeFilter:['class']});
  if (lockView) new MutationObserver(() => {
    if (isLocked()) {
      directory.hidden = true; disconnect();
      browse.setAttribute('aria-expanded', 'false');
      const advanced = document.getElementById('stream-advanced');
      if (advanced) advanced.hidden = true;
      document.getElementById('stream-url-toggle').setAttribute('aria-expanded', 'false');
    }
    syncVisibility();
  }).observe(lockView, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pagehide',()=>{stop();disconnect();});
  document.getElementById('stream-zap').addEventListener('click', () => {
    if (!selectedHost || isLocked() || root.classList.contains('stream-approving')) return;
    window.dispatchEvent(new CustomEvent('sidecar-stream-zap', { detail: { pubkey: selectedHost } }));
  });
  const toggle = document.getElementById('livevideo-toggle');
  function setEnabled(on) {
    enabled = on;
    if (!on) {
      stop(); disconnect(); directory.hidden = true;
      list.replaceChildren(); browse.setAttribute('aria-expanded', 'false');
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
})();
