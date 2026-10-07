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
  const api = { httpsUrl, parse, Directory };
  if (typeof module !== 'undefined') module.exports = api;
  root.SidecarStreams = api;
})(globalThis);
