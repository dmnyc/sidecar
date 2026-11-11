'use strict';

// THE REAL EXTENSION, RUNNING. Not a page with its worker faked: the unpacked extension loaded
// into a real Chrome, its real service worker holding a real keystore, its real side panel page
// talking to it, and a relay it reads from that is a socket on localhost.
//
// Why this exists. The browser tests next to it fake the worker and the relay pool and lift
// functions out of the panel, which is right for a decision inside one function and blind to
// everything between functions: what the worker answers, how the panel's own boot order and
// caches and timers interact, what chrome.tabs really does with a call. A report that "clicking
// does nothing" lives in exactly that gap, and could not be reproduced from the other side of it.
//
// How. Branded Chrome ignores --load-extension, so the extension is loaded the way automation
// tools do it: Extensions.loadUnpacked over a --remote-debugging-pipe. The panel is opened as a
// tab (chrome-extension://<id>/sidepanel.html), which runs the same document and scripts the side
// panel does, and is driven by Runtime.evaluate. The relay is a hand-rolled WebSocket server
// speaking just enough of NIP-01 (REQ, EVENT, CLOSE) to be read from.
//
// Nothing here touches the network or the user's browser: a fresh profile in a temp directory, a
// relay on 127.0.0.1, and an account made from a secret key written below.

const { spawn } = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.EXTENSION_ROOT || path.join(__dirname, '..', '..');   // EXTENSION_ROOT: a scratch copy, to prove a test fails on old code
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p)) || null;

const SK = { me: '05'.repeat(32), bea: '06'.repeat(32), cal: '07'.repeat(32) };
const PIN = 'testpin1234';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- signing: nostr-tools, run in its own context so it sees its own Array and Uint8Array ----
let _nt = null;
function nostrTools() {
  if (_nt) return _nt;
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout, console, URL, queueMicrotask });
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), ctx);
  vm.runInContext(`
    const bytes = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
    this.__sign = (json, sk) => NostrTools.finalizeEvent(JSON.parse(json), bytes(sk));
    this.__pk = (sk) => NostrTools.getPublicKey(bytes(sk));
    this.__decode = (code) => JSON.stringify(NostrTools.nip19.decode(code));
  `, ctx);
  _nt = {
    sign: (template, who) => JSON.parse(JSON.stringify(ctx.__sign(JSON.stringify(template), SK[who]))),
    pubkey: (who) => ctx.__pk(SK[who]),
    decode: (code) => JSON.parse(ctx.__decode(code)),
  };
  return _nt;
}

// ---- a relay: REQ, EVENT, CLOSE, over a WebSocket server written by hand ----
function startRelay({ delayMs = 0 } = {}) {
  const events = [];
  const log = [];
  const live = new Set();   // open subscriptions, so an event arriving later is pushed to them
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
  const frame = (text) => {
    const p = Buffer.from(text);
    let head;
    if (p.length < 126) head = Buffer.from([0x81, p.length]);
    else if (p.length < 65536) head = Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(p.length), 2); }
    return Buffer.concat([head, p]);
  };
  // A new event: kept, and sent to every open subscription whose filter it matches.
  function push(ev) {
    events.push(ev);
    for (const e of live) if (e.filters.some((f) => matches(ev, f))) e.send(['EVENT', e.sub, ev]);
  }
  const server = http.createServer((q, r) => { r.writeHead(426); r.end(); });
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '
      + crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
    const send = (arr) => { try { socket.write(frame(JSON.stringify(arr))); } catch (_) { /* a closed socket */ } };
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
        if (op !== 1) continue;
        let msg;
        try { msg = JSON.parse(data.toString('utf8')); } catch (_) { continue; }
        if (msg[0] === 'REQ') {
          const [, sub, ...filters] = msg;
          log.push(filters);
          const answer = () => {
            for (const f of filters) {
              let hit = events.filter((e) => matches(e, f)).sort((a, b) => b.created_at - a.created_at);
              if (f.limit) hit = hit.slice(0, f.limit);
              for (const e of hit) send(['EVENT', sub, e]);
            }
            send(['EOSE', sub]);
          };
          const wait = typeof delayMs === 'function' ? delayMs(filters) : delayMs;
          if (wait) setTimeout(answer, wait); else answer();
          const entry = { send, sub, filters, socket };
          live.add(entry);
        } else if (msg[0] === 'CLOSE') {
          for (const e of [...live]) if (e.socket === socket && e.sub === msg[1]) live.delete(e);
        } else if (msg[0] === 'EVENT') {
          push(msg[1]);
          send(['OK', msg[1].id, true, '']);
        }
      }
    });
    socket.on('close', () => { for (const e of [...live]) if (e.socket === socket) live.delete(e); });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ events, log, push, url: 'ws://127.0.0.1:' + server.address().port, close: () => server.close() });
  }));
}

// ---- Chrome over a debugging pipe ----
function launchChrome(userDataDir) {
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`,
    '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const toChrome = proc.stdio[3];
  const fromChrome = proc.stdio[4];
  let n = 0;
  const pending = new Map();
  const listeners = [];
  let buf = '';
  fromChrome.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      } else listeners.forEach((f) => f(msg));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++n;
    pending.set(id, { res, rej });
    toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  return { proc, send, on: (f) => listeners.push(f), kill: () => { try { proc.kill('SIGKILL'); } catch (_) { /* gone */ } } };
}

// Starts everything and returns a handle. Throws an error with .skip = true when this Chrome cannot load an unpacked
// extension over the pipe, which the tests turn into a skip rather than a failure.
async function startExtension({ relayDelayMs = 0, settings = {} } = {}) {
  if (!CHROME) { const e = new Error('no Chrome found'); e.skip = true; throw e; }
  const relay = await startRelay({ delayMs: relayDelayMs });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-real-'));
  const chrome = launchChrome(path.join(dir, 'profile'));
  const cleanup = () => { chrome.kill(); relay.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ } };
  try {
    await sleep(2000);
    let extId;
    try { extId = (await chrome.send('Extensions.loadUnpacked', { path: ROOT })).id; }
    catch (e) { const err = new Error('this Chrome cannot load an unpacked extension: ' + e.message); err.skip = true; throw err; }

    const errors = [];
    let session = null;
    const attach = async (url) => {
      const { targetId } = await chrome.send('Target.createTarget', { url });
      const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
      await chrome.send('Runtime.enable', {}, sessionId);
      return { targetId, sessionId };
    };
    chrome.on((m) => {
      if (session && m.sessionId === session.sessionId && m.method === 'Runtime.exceptionThrown') {
        errors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).split('\n')[0]);
      }
    });
    session = await attach(`chrome-extension://${extId}/sidepanel.html`);
    const evaluate = async (expression) => {
      const r = await chrome.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session.sessionId);
      if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      return r.result.value;
    };
    const message = (m) => evaluate(`new Promise((res) => chrome.runtime.sendMessage(${JSON.stringify(m)}, (r) => res(r)))`);
    const waitFor = async (expression, ms = 8000) => {
      const end = Date.now() + ms;
      let last;
      while (Date.now() < end) {
        try { last = await evaluate(expression); } catch (e) { last = undefined; }
        if (last) return last;
        await sleep(100);
      }
      throw new Error('timed out waiting for: ' + expression + ' (last: ' + JSON.stringify(last) + ')');
    };
    await sleep(1000);

    const nt = nostrTools();
    const me = nt.pubkey('me');
    const handle = {
      extId, relay, errors, nt, me, bea: nt.pubkey('bea'), cal: nt.pubkey('cal'),
      sleep, evaluate, message, waitFor,
      sign: (template, who) => nt.sign(template, who),
      // An event on the relay, signed by `who`.
      put: (template, who) => { const e = nt.sign(template, who); relay.events.push(e); return e; },
      // The same, arriving now: open subscriptions are sent it as it happens, as when another device publishes.
      push: (template, who) => { const e = nt.sign(template, who); relay.push(e); return e; },
      // The panel, reloaded: what opening it again after a reload is.
      reload: async () => { await evaluate('location.reload()'); await sleep(2500); await waitFor(`!document.getElementById('view-main').classList.contains('hidden')`, 15000); },
      // Every call the panel makes to chrome.tabs and chrome.windows, from now on, in order.
      recordTabs: () => evaluate(`(() => { window.__calls = []; for (const [o, n] of [[chrome.tabs, 'create'], [chrome.tabs, 'update'], [chrome.tabs, 'query'], [chrome.windows, 'update']]) { if (o[n].__wrapped) continue; const orig = o[n].bind(o); const w = (...a) => { __calls.push({ call: n, args: a.filter((x) => typeof x !== 'function') }); return orig(...a); }; w.__wrapped = true; o[n] = w; } })()`),
      calls: () => evaluate('JSON.parse(JSON.stringify(window.__calls || []))'),
      clearCalls: () => evaluate('window.__calls = []'),
      // A picture of the panel at its real width, as a PNG file: for looking at a change where it is seen.
      screenshot: async (file, { width = 360, height = 780 } = {}) => {
        await chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, session.sessionId);
        await chrome.send('Page.bringToFront', {}, session.sessionId);
        await sleep(1200);
        const shot = await chrome.send('Page.captureScreenshot', { format: 'png' }, session.sessionId);
        require('fs').writeFileSync(file, Buffer.from(shot.data, 'base64'));
      },
      close: cleanup,
    };
    // A real account, signed in, reading from and writing to the local relay.
    //
    // AUTO-LOCK OFF FIRST. The worker locks the keystore when the system reports itself idle or
    // locked, and a new keystore auto-locks at thirty minutes. A Mac whose screen is asleep says
    // "locked" at any moment, which locked the account between one message and the next. Settings
    // written before the keystore exists win over its defaults, and 0 means never on a timer.
    await message({ type: 'SIDECAR_SET_SETTINGS', settings: { autoLockMinutes: 0, autoLockNoticeShown: true } });
    const init = await message({ type: 'SIDECAR_INIT', pin: PIN });
    if (!init || !init.ok) throw new Error('keystore init failed: ' + JSON.stringify(init));
    let add = await message({ type: 'SIDECAR_ADD_ACCOUNT', secret: SK.me, name: 'Tester' });
    if (add && !add.ok && /locked/i.test(add.error || '')) {
      await message({ type: 'SIDECAR_UNLOCK', pin: PIN });
      add = await message({ type: 'SIDECAR_ADD_ACCOUNT', secret: SK.me, name: 'Tester' });
    }
    if (!add || !add.ok) throw new Error('adding the account failed: ' + JSON.stringify(add));
    await message({ type: 'SIDECAR_SET_RELAYS', relays: { [relay.url]: { read: true, write: true } } });
    await message({ type: 'SIDECAR_SET_SETTINGS', settings: { seasonalOffers: false, literaryQuotes: true, ...settings } });
    return handle;
  } catch (e) {
    cleanup();
    throw e;
  }
}

module.exports = { startExtension, CHROME, sleep };
