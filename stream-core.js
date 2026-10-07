/* Public NIP-53 discovery. No account, signing, or wallet state belongs here. */
(function (root) {
  'use strict';
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
    constructor() { this.payments=new Set(); this.msats=0; this.count=0; }
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
        this.payments.add(invoice.paymentHash);this.msats+=invoice.msats;this.count++;return true;
      } catch (_) { return false; }
    }
  }
  const api = { httpsUrl, parse, bookmark, zapProvider, Directory, invoiceDetails, ZapTotals };
  if (typeof module !== 'undefined') module.exports = api;
  root.SidecarStreams = api;
})(globalThis);
