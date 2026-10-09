/* Public NIP-53 discovery. No account, signing, or wallet state belongs here. */
(function (root) {
  'use strict';
  // Same cocktail vocabulary as new accounts; stable per public key so a
  // participant does not change aliases when history or profile data reloads.
  const COCKTAILS = ['Negroni', 'Martini', 'Manhattan', 'Boulevardier', 'Sidecar', 'Daiquiri',
    'Margarita', 'Sazerac', 'Aviation', 'Gimlet', 'Cosmopolitan', 'Vesper', 'Bellini', 'Mojito',
    'Paloma', 'Spritz', 'Mule', 'Sour', 'Highball', 'Collins', 'Julep', 'Cobbler', 'Americano',
    'Bramble', 'Gibson', 'Stinger', 'Hurricane', 'Gascogne', 'Martinez', 'Bijou'];
  const ADJECTIVES = ['Velvet', 'Smoky', 'Golden', 'Midnight', 'Gilded', 'Bitter', 'Spiced',
    'Twilight', 'Crimson', 'Amber', 'Dry', 'Vintage', 'Frosted', 'Burnt', 'Silken', 'Oaked',
    'Sparkling', 'Top-Shelf', 'Neat', 'Mahogany', 'Botanical', 'Barrel-Aged', 'Hush', 'Last-Call'];
  function cocktailName(pubkey) {
    let hash=2166136261;
    for(const char of String(pubkey || ''))hash=Math.imul(hash ^ char.charCodeAt(0),16777619)>>>0;
    return ADJECTIVES[hash % ADJECTIVES.length]+' '+COCKTAILS[Math.floor(hash/ADJECTIVES.length) % COCKTAILS.length];
  }

  function httpsUrl(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch (_) { return null; }
  }
  function parse(event, now = Date.now() / 1000) {
    if (!event || event.kind !== 30311 || !Array.isArray(event.tags) || !/^[a-f0-9]{64}$/.test(event.pubkey) || !Number.isFinite(event.created_at) || event.created_at > now + 60) return null;
    const tag = key => event.tags.find(t => Array.isArray(t) && t[0] === key)?.[1];
    const d = tag('d');
    if (typeof d !== 'string') return null;
    return { key: `30311:${event.pubkey}:${d}`, id: event.id, updated: event.created_at,
      title: String(tag('title') || 'Untitled livestream').slice(0, 240),
      url: httpsUrl(tag('streaming')), image: httpsUrl(tag('image')),
      summary: String(tag('summary') || '').slice(0,12000),
      starts: /^\d+$/.test(tag('starts') || '') && Number.isSafeInteger(Number(tag('starts'))) && Number(tag('starts'))>0 && Number(tag('starts'))<=now ? Number(tag('starts')) : null,
      categories: event.tags.filter(t=>Array.isArray(t) && t[0]==='t' && typeof t[1]==='string').slice(0,12).map(t=>t[1].slice(0,80)),
      live: tag('status') === 'live' && now - event.created_at < 3600,
      viewers: /^\d+$/.test(tag('current_participants') || '') && Number.isSafeInteger(Number(tag('current_participants'))) ? Number(tag('current_participants')) : null,
      relays: event.tags.filter(t => Array.isArray(t) && t[0] === 'relays').flatMap(t => t.slice(1)).filter(u => typeof u === 'string' && u.startsWith('wss://')).slice(0,6),
      host: event.tags.find(t => Array.isArray(t) && t[0] === 'p' && typeof t[3] === 'string' && t[3].toLowerCase() === 'host' && /^[a-f0-9]{64}$/.test(t[1]))?.[1] || event.pubkey };
  }
  class Directory {
    constructor() { this.events = new Map(); }
    accept(event, now) {
      const item = parse(event, now); if (!item) return false;
      const old = this.events.get(item.key);
      if (old && (old.updated > item.updated || (old.updated === item.updated && old.id <= item.id))) return false;
      this.events.set(item.key, item);
      if (this.events.size > 300) this.events.delete([...this.events].sort((a,b) => a[1].updated-b[1].updated)[0][0]);
      return true;
    }
    live(now = Date.now()/1000) { return [...this.events.values()].filter(e => e.live && e.url && now-e.updated < 3600).sort((a,b)=>b.updated-a.updated); }
  }
  function bookmark(item) {
    const url = httpsUrl(item?.url);
    if (!url) return null;
    const key = /^30311:[a-f0-9]{64}:/.test(item.key || '') ? item.key : 'url:' + url;
    return { key, url, title:String(item.title || new URL(url).hostname).slice(0,240),
      image:httpsUrl(item.image), host:/^[a-f0-9]{64}$/.test(item.host || '') ? item.host : null,
      relays:(Array.isArray(item.relays) ? item.relays : []).filter(u => typeof u === 'string' && u.startsWith('wss://')).slice(0,6) };
  }
  async function zapProvider(pool, sources, host, signal, request = fetch) {
    const newest = async (kind, urls) => {
      const events = await pool.querySync(urls, {kinds:[kind], authors:[host]}, {abort:signal,maxWait:5000});
      return events.filter(e=>e.kind===kind && e.pubkey===host).sort((a,b)=>b.created_at-a.created_at || String(a.id).localeCompare(String(b.id)))[0];
    };
    let [profile, relayList] = await Promise.all([newest(0,sources),newest(10002,sources)]);
    if (signal.aborted) throw new Error('Aborted');
    const declared=(relayList?.tags || []).filter(t=>t[0]==='r' && typeof t[1]==='string' && t[1].startsWith('wss://')).map(t=>t[1]).slice(0,6);
    for(const url of declared)if(!sources.includes(url))sources.push(url);
    if (!profile && declared.length) profile=await newest(0,declared);
    if (signal.aborted) throw new Error('Aborted');
    const content=JSON.parse(profile?.content || '{}');
    const parts=typeof content.lud16==='string' && content.lud16.split('@');
    if(!parts || parts.length!==2 || !parts[0] || !/^[a-z0-9.-]+$/i.test(parts[1]))throw new Error('No zap provider');
    const fetchAbort=new AbortController();
    const cancel=()=>fetchAbort.abort();
    signal.addEventListener('abort',cancel,{once:true});
    const timeout=setTimeout(cancel,8000);
    try {
      const response=await request('https://'+parts[1]+'/.well-known/lnurlp/'+encodeURIComponent(parts[0]),{signal:fetchAbort.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error('Provider unavailable');
      const meta=await response.json();
      if(!meta.allowsNostr || !/^[a-f0-9]{64}$/.test(meta.nostrPubkey))throw new Error('Invalid zap provider');
      return meta;
    } finally {clearTimeout(timeout);signal.removeEventListener('abort',cancel);}
  }
  // Pool-level oneose also runs on connection failure/CLOSED. Use the relay directly,
  // and expire our deadline before the library's synthetic EOSE timeout can fire.
  function relayPage(pool,url,filter,signal,timeout=6500,onEvent){
    return new Promise(resolve=>{
      const events=[];let sub,done=false;
      const finish=complete=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);sub?.close();resolve({events,complete});};
      const abort=()=>finish(false),timer=setTimeout(abort,timeout);
      if(signal?.aborted){abort();return;}
      signal?.addEventListener('abort',abort,{once:true});
      pool.ensureRelay(url,{connectionTimeout:timeout}).then(relay=>{
        if(done)return;
        sub=relay.subscribe([filter],{eoseTimeout:timeout+1000,onevent:event=>{if(done)return;events.push(event);onEvent?.(event);},oneose:()=>finish(true),onclose:()=>finish(false)});
        if(done)sub.close();
      }).catch(abort);
    });
  }
  async function profileBatch({pool,sources,keys,signal,verify,onProfile,timeout=4000}){
    const wanted=new Set(keys),found=new Map();
    const accept=event=>{
      if(signal?.aborted || event?.kind!==0 || !wanted.has(event.pubkey) || !Number.isSafeInteger(event.created_at) || event.created_at<0 || event.created_at>Date.now()/1000+60 || !verify(event))return;
      const previous=found.get(event.pubkey);
      if(previous && (previous.created_at>event.created_at || (previous.created_at===event.created_at && previous.id>=event.id)))return;
      try{
        const data=JSON.parse(event.content);
        if(!data || typeof data!=='object')return;
        const profile={name:[data.display_name,data.displayName,data.name].find(x=>typeof x==='string' && x.trim()) || '',picture:httpsUrl(data.picture) || '',created_at:event.created_at,id:event.id,content:data};
        found.set(event.pubkey,profile);onProfile?.(event.pubkey,profile);
      }catch(_){}
    };
    await Promise.all([...new Set(sources)].map(url=>relayPage(pool,url,{kinds:[0],authors:[...wanted],limit:Math.max(100,wanted.size)},signal,timeout,accept)));
    // Some relays let old versions of one profile crowd out other authors.
    // Two fallback reads at a time, and paint every result as soon as it arrives.
    const missing=[...wanted].filter(key=>!found.has(key));let next=0;
    await Promise.all(Array.from({length:Math.min(2,missing.length)},async()=>{
      while(next<missing.length && !signal?.aborted){const key=missing[next++];await relayPage(pool,'wss://purplepag.es',{kinds:[0],authors:[key],limit:1},signal,2500,accept);}
    }));
    return found;
  }
  // Scan relays independently: one relay's recent page must not truncate another's history.
  async function zapHistory({sources, query, accept, filter, signal, pageSize=250, maxPages=80}) {
    const results=await Promise.all(sources.map(async relay=>{
      let until=filter.until ?? Math.floor(Date.now()/1000), pages=0;
      try {
        while(!signal.aborted && pages++<maxPages) {
          const page=await query(relay,{...filter,until,limit:pageSize});
          const events=Array.isArray(page)?page:page.events;
          if(signal.aborted)return false;
          if(!events.length)return Array.isArray(page) || page.complete;
          const valid=events.filter(e=>Number.isSafeInteger(e.created_at) && e.created_at<=until && e.created_at>=0);
          if(!valid.length)return false;
          for(const event of valid)await accept(event);
          if(!Array.isArray(page) && !page.complete)return false;
          const oldest=Math.min(...valid.map(e=>e.created_at));
          // Drain the boundary second before advancing, including ties across pages.
          const boundaryPage=await query(relay,{...filter,since:oldest,until:oldest,limit:1000});
          const boundary=Array.isArray(boundaryPage)?boundaryPage:boundaryPage.events;
          if(signal.aborted)return false;
          for(const event of boundary)await accept(event);
          if(!Array.isArray(boundaryPage) && !boundaryPage.complete)return false;
          if(boundary.length>=1000)return false; // Cannot prove this second was exhausted.
          if(oldest===0 || (filter.since!=null && oldest<=filter.since))return true;
          until=oldest-1;
        }
      } catch (_) { return false; }
      return false;
    }));
    return {complete:!signal.aborted && results.every(Boolean), answered:results.filter(Boolean).length};
  }
  // A provider-signed receipt is counted only after its signed request and invoice agree.
  function invoiceDetails(raw) {
    if (typeof raw !== 'string' || raw.length > 20000 || (raw !== raw.toLowerCase() && raw !== raw.toUpperCase())) return null;
    const inv = raw.toLowerCase(), sep = inv.lastIndexOf('1');
    const match = /^lnbc(\d+)([munp]?)$/.exec(inv.slice(0, sep));
    if (!match) return null;
    const factors = { '':100000000000n, m:100000000n, u:100000n, n:100n, p:1n };
    let amount = BigInt(match[1]) * factors[match[2]];
    if (match[2] === 'p') { if (amount % 10n) return null; amount /= 10n; }
    if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const words = [...inv.slice(sep+1)].map(c => alphabet.indexOf(c));
    if (words.some(w => w < 0) || words.length < 117) return null;
    let check = 1;
    const step = v => { const top=check>>>25; check=((check&0x1ffffff)<<5)^v; [0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3].forEach((g,i)=>{if((top>>>i)&1)check^=g;}); };
    const prefix=inv.slice(0,sep);
    for(const c of prefix)step(c.charCodeAt(0)>>>5); step(0);
    for(const c of prefix)step(c.charCodeAt(0)&31); for(const w of words)step(w);
    if(check!==1)return null;
    const hashes={}; const end=words.length-110;
    for(let i=7;i<end;) {
      if(i+3>end)return null;
      const type=words[i], length=words[i+1]*32+words[i+2]; i+=3;
      if(i+length>end)return null;
      if(type===1 || type===23) {
        if(length!==52 || hashes[type])return null;
        let bits=0,value=0; const bytes=[];
        for(const w of words.slice(i,i+length)){value=(value<<5)|w;bits+=5;if(bits>=8){bits-=8;bytes.push((value>>>bits)&255);}}
        if((value & ((1<<bits)-1))!==0)return null;
        hashes[type]=bytes.map(b=>b.toString(16).padStart(2,'0')).join('');
      }
      i+=length;
    }
    return hashes[1] && hashes[23] ? {msats:Number(amount), paymentHash:hashes[1], descriptionHash:hashes[23]} : null;
  }
  class ZapTotals {
    constructor() { this.payments=new Set(); this.msats=0; this.count=0; this.authors=new Map(); }
    async accept(receipt, {address, recipient, provider, verify, digest}) {
      try {
        const one=(event,key)=>{const tags=event.tags.filter(t=>Array.isArray(t)&&t[0]===key);return tags.length===1?tags[0][1]:null;};
        if(receipt.kind!==9735 || receipt.pubkey!==provider || !verify(receipt))return false;
        if(one(receipt,'a')!==address || one(receipt,'p')!==recipient)return false;
        const description=one(receipt,'description'), request=JSON.parse(description);
        if(request.kind!==9734 || !verify(request) || one(request,'a')!==address || one(request,'p')!==recipient)return false;
        const invoice=invoiceDetails(one(receipt,'bolt11'));
        if(!invoice || this.payments.has(invoice.paymentHash))return false;
        const requested=one(request,'amount');
        if(requested!=null && (!/^\d+$/.test(requested) || BigInt(requested)!==BigInt(invoice.msats)))return false;
        if(await digest(description)!==invoice.descriptionHash)return false;
        if(this.payments.has(invoice.paymentHash) || !Number.isSafeInteger(this.msats+invoice.msats))return false;
        this.payments.add(invoice.paymentHash);this.msats+=invoice.msats;this.count++;
        this.authors.set(request.pubkey,(this.authors.get(request.pubkey) || 0)+invoice.msats);return true;
      } catch (_) { return false; }
    }
  }
  function mergeBookmarks(local,remote) {
    return [...new Map([...remote,...local].map(bookmark).filter(Boolean).map(item=>[item.key,item])).values()];
  }
  function encodeBookmarks(items) {
    const clean=mergeBookmarks(items,[]);
    const result=JSON.stringify({version:1,streams:clean});
    if(clean.length>200 || result.length>40000)throw new Error('Too many stream bookmarks');
    return result;
  }
  function decodeBookmarks(text) {
    if(typeof text!=='string' || text.length>40000)throw new Error('Invalid stream backup');
    const data=JSON.parse(text);
    if(data.version!==1 || !Array.isArray(data.streams) || data.streams.length>200)throw new Error('Invalid stream backup');
    if(data.streams.some(item=>!bookmark(item)))throw new Error('Invalid stream bookmark');
    return mergeBookmarks(data.streams,[]);
  }
  function topZappers(totals,limit=10) {
    return [...(totals?.authors || [])].map(([pubkey,msats])=>({pubkey,sats:msats/1000}))
      .sort((a,b)=>b.sats-a.sats || a.pubkey.localeCompare(b.pubkey)).slice(0,limit);
  }
  function runtime(starts,now=Date.now()/1000) {
    if(!Number.isSafeInteger(starts) || starts<=0 || starts>now)return null;
    const minutes=Math.floor((now-starts)/60);
    return {days:Math.floor(minutes/1440),hours:Math.floor(minutes/60)%24,minutes:minutes%60};
  }
  const api = { mergeBookmarks, encodeBookmarks, decodeBookmarks, topZappers, runtime, cocktailName, httpsUrl, parse, bookmark, zapProvider, relayPage, profileBatch, zapHistory, Directory, invoiceDetails, ZapTotals };
  if (typeof module !== 'undefined') module.exports = api;
  root.SidecarStreams = api;
})(globalThis);
