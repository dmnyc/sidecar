#!/usr/bin/env node
'use strict';

// A private relay for the relay drafts lab (test/manual/relay-drafts-lab.html): the kind of relay NIP-37
// says drafts belong on. It answers nothing until the client has proved who it is (NIP-42), keeps a
// person's drafts and private relay list for that person alone, and replaces an addressable event with
// its newer copy, which is how a blanked draft ("deleted") supersedes the one it blanks.
//
//     node test/manual/nip42-relay.js [port]          (default 7447)
//
// No dependencies: a hand-written WebSocket server, and the extension's own nostr-tools bundle for
// checking signatures. Events live in memory; /reset (or restarting) clears them. The lab page reads
// http://127.0.0.1:<port>/state, which lists what the relay holds and what it has been asked, so the
// page can tick what happened without anyone reading the wire.
//
// Nothing here is a real relay: it never forwards, never persists, and listens on 127.0.0.1 only.

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PRIVATE_KINDS = new Set([31234, 1234, 10013]); // drafts, draft checkpoints, the private relay list
const AUTH_WINDOW_S = 600;

function loadTools() {
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout, console, URL });
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'nostr-tools.js'), 'utf8'), ctx);
  return ctx;
}

const frame = (text) => {
  const p = Buffer.from(text);
  let head;
  if (p.length < 126) head = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) head = Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(p.length), 2); }
  return Buffer.concat([head, p]);
};

function startNip42Relay({ port = 0 } = {}) {
  // Messages are parsed INSIDE the tools' realm: its validators check `instanceof Object`, which a
  // JSON.parse from this realm fails, so a perfectly good event would read as having the wrong shape.
  const ctx = loadTools();
  const NT = ctx.NostrTools;
  const parse = vm.runInContext('JSON.parse', ctx);
  let events = [];
  let log = [];
  const conns = new Set();
  const say = (kind, text) => { log.push({ at: Date.now(), kind, text }); if (log.length > 300) log = log.slice(-300); };
  let url = '';

  const identity = (ev) => (ev.kind >= 30000 && ev.kind < 40000)
    ? ev.kind + ':' + ev.pubkey + ':' + ((ev.tags.find((t) => t[0] === 'd') || [])[1] || '')
    : (ev.kind >= 10000 && ev.kind < 20000) || ev.kind === 0 || ev.kind === 3 ? ev.kind + ':' + ev.pubkey : null;

  const matches = (e, f) => {
    if (f.ids && !f.ids.includes(e.id)) return false;
    if (f.authors && !f.authors.includes(e.pubkey)) return false;
    if (f.kinds && !f.kinds.includes(e.kind)) return false;
    if (f.since && e.created_at < f.since) return false;
    if (f.until && e.created_at > f.until) return false;
    for (const k of Object.keys(f)) {
      if (k[0] === '#' && !e.tags.some((t) => t[0] === k.slice(1) && f[k].includes(t[1]))) return false;
    }
    return true;
  };
  // Who may read what: a draft and the private relay list only to their author, once identified.
  const visibleTo = (c, e) => !PRIVATE_KINDS.has(e.kind) || (c.authed && c.authed === e.pubkey);

  const sameRelay = (tag) => {
    try { const u = new URL(tag); return (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && String(u.port) === String(server.address().port); } catch (_) { return false; }
  };
  const checkAuth = (c, ev) => {
    if (!ev || ev.kind !== 22242) return 'not an auth event';
    if (!NT.verifyEvent(ev)) return 'bad signature';
    const rel = (ev.tags.find((t) => t[0] === 'relay') || [])[1];
    const ch = (ev.tags.find((t) => t[0] === 'challenge') || [])[1];
    if (!rel || !sameRelay(rel)) return 'relay tag does not name this relay (' + rel + ')';
    if (ch !== c.challenge) return 'challenge does not match this connection';
    if (Math.abs(Date.now() / 1000 - ev.created_at) > AUTH_WINDOW_S) return 'auth event is too old or too new';
    return '';
  };

  function store(ev) {
    const id = identity(ev);
    if (id) {
      const old = events.find((e) => identity(e) === id);
      if (old) {
        if (old.created_at > ev.created_at || (old.created_at === ev.created_at && old.id <= ev.id)) return false;
        events = events.filter((e) => e !== old);
      }
    }
    events.push(ev);
    return true;
  }

  const server = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/state') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        url,
        connections: conns.size,
        authed: [...new Set([...conns].map((c) => c.authed).filter(Boolean))],
        events: events.map((e) => ({
          id: e.id, kind: e.kind, pubkey: e.pubkey, created_at: e.created_at,
          d: (e.tags.find((t) => t[0] === 'd') || [])[1] || null,
          k: (e.tags.find((t) => t[0] === 'k') || [])[1] || null,
          expiration: (e.tags.find((t) => t[0] === 'expiration') || [])[1] || null,
          tags: e.tags.length, contentLength: e.content.length, blank: e.content === '',
        })),
        // The check no one can do by eye: a draft or list whose content reads as plaintext.
        leaks: events.filter((e) => PRIVATE_KINDS.has(e.kind) && e.content && (/LAB-/.test(e.content) || /^[\[{]/.test(e.content))).map((e) => e.id),
        log: log.slice(-80),
      }));
      return;
    }
    if (u.pathname === '/reset') {
      // A reset wipes what a person is in the middle of testing, so it takes a deliberate POST and says who asked.
      if (req.method !== 'POST') { say('relay', 'ignored a ' + req.method + ' /reset (resets must be POSTs)'); res.writeHead(405); res.end('POST to reset'); return; }
      say('relay', 'reset asked for by ' + (req.headers.origin || req.headers.referer || 'a client with no origin'));
      events = []; log = log.slice(-1); for (const c of conns) { c.authed = ''; c.challenge = crypto.randomBytes(16).toString('hex'); c.send(['AUTH', c.challenge]); } say('relay', 'reset: events cleared, clients asked to authenticate again'); res.end('ok'); return;
    }
    res.writeHead(426); res.end('this is a relay: connect with a WebSocket');
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '
      + crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
    const send = (arr) => { try { socket.write(frame(JSON.stringify(arr))); } catch (_) { /* closed */ } };
    const c = { send, socket, authed: '', challenge: crypto.randomBytes(16).toString('hex'), subs: new Map() };
    conns.add(c);
    say('conn', 'a client connected; sent an AUTH challenge');
    send(['AUTH', c.challenge]);
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15;
        let len = buf[1] & 127;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + 4 + len) return;
        const mask = buf.slice(off, off + 4);
        const data = Buffer.from(buf.slice(off + 4, off + 4 + len));
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
        buf = buf.slice(off + 4 + len);
        if (op === 8) { socket.end(); return; }
        if (op === 9) { try { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } catch (_) { /* closed */ } continue; }
        if (op !== 1) continue;
        let msg;
        try { msg = parse(data.toString('utf8')); } catch (_) { continue; }
        handle(c, msg);
      }
    });
    socket.on('close', () => { conns.delete(c); say('conn', 'a client disconnected'); });
    socket.on('error', () => {});
  });

  function handle(c, msg) {
    if (msg[0] === 'AUTH') {
      const why = checkAuth(c, msg[1]);
      if (why) { say('auth', 'AUTH refused: ' + why); send(c, ['OK', (msg[1] && msg[1].id) || '', false, 'invalid: ' + why]); return; }
      c.authed = msg[1].pubkey;
      say('auth', 'AUTH accepted for ' + msg[1].pubkey.slice(0, 8) + '…');
      send(c, ['OK', msg[1].id, true, '']);
    } else if (msg[0] === 'REQ') {
      const [, sub, ...filters] = msg;
      if (!c.authed) {
        say('denied', 'REQ ' + sub + ' before AUTH: closed with auth-required');
        c.send(['CLOSED', sub, 'auth-required: this relay answers only authenticated clients']);
        return;
      }
      const kinds = [...new Set(filters.flatMap((f) => f.kinds || []))];
      say('req', 'REQ ' + sub + ' kinds ' + (kinds.join(',') || 'any'));
      for (const f of filters) {
        let hit = events.filter((e) => matches(e, f) && visibleTo(c, e)).sort((a, b) => b.created_at - a.created_at);
        if (f.limit) hit = hit.slice(0, f.limit);
        for (const e of hit) c.send(['EVENT', sub, e]);
      }
      c.send(['EOSE', sub]);
      c.subs.set(sub, filters);
    } else if (msg[0] === 'CLOSE') {
      c.subs.delete(msg[1]);
    } else if (msg[0] === 'EVENT') {
      const ev = msg[1] || {};
      if (!c.authed) {
        say('denied', 'EVENT kind ' + ev.kind + ' before AUTH: refused with auth-required');
        c.send(['OK', ev.id || '', false, 'auth-required: authenticate first']);
        return;
      }
      if (!NT.verifyEvent(ev)) { say('denied', 'EVENT kind ' + ev.kind + ' has a bad signature'); c.send(['OK', ev.id || '', false, 'invalid: bad signature']); return; }
      if (PRIVATE_KINDS.has(ev.kind) && ev.pubkey !== c.authed) {
        say('denied', 'EVENT kind ' + ev.kind + ' for someone other than the authenticated key');
        c.send(['OK', ev.id, false, 'restricted: private events are kept for their author only']);
        return;
      }
      const kept = store(ev);
      const blank = ev.content === '' && (ev.kind === 31234 || ev.kind === 1234) ? ' (blanked: a deletion)' : '';
      say('event', 'EVENT kind ' + ev.kind + (kept ? ' stored' : ' ignored (older than the copy held)') + blank);
      c.send(['OK', ev.id, true, kept ? '' : 'duplicate: a newer copy is held']);
      if (kept) for (const o of conns) for (const [sub, fs_] of o.subs) if (o.authed && fs_.some((f) => matches(ev, f)) && visibleTo(o, ev)) o.send(['EVENT', sub, ev]);
    }
  }
  // The lab's own send helper takes the connection first.
  function send(c, arr) { c.send(arr); }

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    url = 'ws://127.0.0.1:' + server.address().port;
    resolve({ url, port: server.address().port, events: () => events, log: () => log, put: (ev) => store(ev), close: () => { for (const c of conns) c.socket.destroy(); server.close(); } });
  }));
}

module.exports = { startNip42Relay };

if (require.main === module) {
  const port = Number(process.argv[2]) || 7447;
  startNip42Relay({ port }).then((r) => {
    console.log('Private relay (NIP-42 required) listening on ' + r.url);
    console.log('State for the lab page: http://127.0.0.1:' + r.port + '/state');
    console.log('Add ' + r.url + ' to the test account’s relays in Sidecar, then open test/manual/relay-drafts-lab.html');
  });
}
