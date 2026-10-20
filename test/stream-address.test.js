'use strict';

// The stream box takes the naddr of a stream announcement as well as a video address, so a stream
// sent to you can be played without finding it in a list. The parser is pure; the form is run
// against a fake page and a fake relay pool.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), { filename: 'nostr-tools.js' });
const core = require('../stream-core');
const NT = globalThis.NostrTools;
const decode = (v) => NT.nip19.decode(v);

const PK = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const naddr = (over = {}) => NT.nip19.naddrEncode({ kind: 30311, pubkey: PK, identifier: 'show-1', relays: [], ...over });

test('a video address is a url, and nothing typed is nothing', () => {
  assert.deepEqual(core.parseStreamAddress('  https://example.com/live.m3u8 ', decode), { url: 'https://example.com/live.m3u8' });
  assert.equal(core.parseStreamAddress('', decode), null);
  assert.equal(core.parseStreamAddress('   ', decode), null);
  assert.equal(core.parseStreamAddress(null, decode), null);
});

test('an naddr is read with or without nostr:, spaces and capitals', () => {
  const a = naddr();
  const want = { naddr: { pubkey: PK, identifier: 'show-1', relays: [] } };
  assert.deepEqual(core.parseStreamAddress(a, decode), want);
  assert.deepEqual(core.parseStreamAddress('nostr:' + a, decode), want);
  assert.deepEqual(core.parseStreamAddress('  NOSTR:' + a.toUpperCase() + '  ', decode), want);
});

test('relay hints are kept only if wss, and no more than six', () => {
  const hints = ['ws://no.example', 'wss://a.example', 'https://b.example', ...Array.from({ length: 8 }, (_, i) => 'wss://r' + i + '.example')];
  const r = core.parseStreamAddress(naddr({ relays: hints }), decode);
  assert.equal(r.naddr.relays.length, 6);
  assert.ok(r.naddr.relays.every((u) => u.startsWith('wss://')));
  assert.equal(r.naddr.relays[0], 'wss://a.example');
});

test('an naddr of another kind is not a stream, and a damaged one is invalid', () => {
  assert.deepEqual(core.parseStreamAddress(naddr({ kind: 30023 }), decode), { error: 'not-a-stream' });
  const a = naddr();
  const broken = a.slice(0, -2) + (a.endsWith('qq') ? 'pp' : 'qq');
  assert.deepEqual(core.parseStreamAddress(broken, decode), { error: 'invalid' });
  assert.deepEqual(core.parseStreamAddress('naddr1notreal', decode), { error: 'invalid' });
});

test('everything else is invalid: other entities, non-https addresses, plain words', () => {
  for (const bad of [NT.nip19.npubEncode(PK), NT.nip19.noteEncode('c'.repeat(64)), 'http://example.com/live.m3u8', 'ftp://example.com/x', 'hello', 'javascript:alert(1)']) {
    assert.deepEqual(core.parseStreamAddress(bad, decode), { error: 'invalid' }, bad);
  }
});

test('a decoder that throws on something that looks like an naddr is invalid, not a crash', () => {
  assert.deepEqual(core.parseStreamAddress('naddr1abc', () => { throw new Error('bad'); }), { error: 'invalid' });
  assert.deepEqual(core.parseStreamAddress('naddr1abc', () => ({ type: 'nevent', data: {} })), { error: 'invalid' });
});

// ---- the form ----
const source = fs.readFileSync(path.join(ROOT, 'streams.js'), 'utf8');
const start = source.indexOf('  // The naddr of a stream announcement is looked up');
const slice = source.slice(start, source.indexOf('  // Keep approval space usable', start));

function event(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { id: 'e' + Math.random(), pubkey: PK, kind: 30311, created_at: now - 100, content: '', sig: 's',
    tags: [['d', 'show-1'], ['title', 'Show one'], ['status', 'ended'], ['recording', 'https://example.com/replay.mp4']], ...over };
}

function page({ events = [event()], saveOk = true, locked = false, enabled = true } = {}) {
  const els = {}, calls = { open: [], play: [], error: [], save: [], pools: [], queries: [] };
  const el = (id) => (els[id] ??= { id, value: '', checked: false, textContent: id === 'stream-form' ? '' : '', disabled: false, events: {},
    addEventListener(type, f) { this.events[type] = f; }, querySelector() { return els.submit; } });
  els.submit = { textContent: 'Watch', disabled: false };
  // The relay answers per source: setQuery(fn) decides what each relay returns, or throws to fail it.
  let query = async () => events;
  const ctx = {
    document: { getElementById: el },
    SidecarStreams: core,
    NostrTools: { nip19: NT.nip19, verifyEvent: () => true, SimplePool: class {
      constructor() { this.destroyed = false; calls.pools.push(this); }
      ensureRelay(url) {
        return Promise.resolve({ subscribe: (filters, opts) => {
          calls.queries.push({ sources: [url], filter: filters[0] });
          Promise.resolve().then(async () => {
            try { for (const e of await query(url, filters[0])) opts.onevent(e); opts.oneose(); } catch (_) { opts.onclose(); }
          });
          return { close() {} };
        } });
      }
      destroy() { this.destroyed = true; }
    } },
    AbortController, setTimeout, clearTimeout,
    model: new core.Directory(), relays: ['wss://default.example'], savedStreams: [], enabled, isLocked: () => locked,
    URL, t: (x) => x, directoryError: (m) => calls.error.push(m), openDirectoryItem: (i) => calls.open.push(i), play: (u, n) => calls.play.push({ u, n }),
    saveBookmarks: async (list) => { calls.save.push(list); return saveOk; },
  };
  vm.createContext(ctx);
  vm.runInContext(slice, ctx);
  return { ctx, calls, els, el, setQuery: (f) => { query = f; },
    submit: async (value, { save = false } = {}) => { el('stream-url').value = value; el('stream-url-save').checked = save; el('stream-url-name').value = ''; await el('stream-form').events.submit({ preventDefault() {} }); } };
}

test('an naddr is looked up by author and d tag on the hinted relays, then ours, and opened like a list row', async () => {
  const p = page();
  await p.submit(naddr({ relays: ['wss://hint.example'] }));
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls.queries[0].filter)), { kinds: [30311], authors: [PK], '#d': ['show-1'] });
  assert.deepEqual(p.calls.queries.map((q) => q.sources[0]), ['wss://hint.example', 'wss://default.example', 'wss://purplepag.es']);
  assert.equal(p.calls.open.length, 1);
  assert.equal(p.calls.open[0].key, '30311:' + PK + ':show-1');
  assert.equal(p.calls.open[0].recording, 'https://example.com/replay.mp4');
  assert.ok(p.calls.pools[0].destroyed, 'the lookup closes its connections');
  assert.equal(p.ctx.model.events.size, 1, 'the stream joins the directory');
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls.error)), ['']);
});

test('of several versions of the announcement the newest is used, and other authors are ignored', async () => {
  const now = Math.floor(Date.now() / 1000);
  const p = page({ events: [event({ created_at: now - 500, tags: [['d', 'show-1'], ['title', 'Old title'], ['status', 'planned']] }),
    event({ created_at: now - 50, tags: [['d', 'show-1'], ['title', 'New title'], ['status', 'ended'], ['recording', 'https://example.com/r.mp4']] }),
    event({ pubkey: OTHER, created_at: now - 10, tags: [['d', 'show-1'], ['title', 'Impostor'], ['status', 'ended']] })] });
  await p.submit(naddr());
  assert.equal(p.calls.open[0].title, 'New title');
});

test('a stream nobody has, or a lookup that fails, says so and leaves the box usable', async () => {
  const p = page({ events: [] });
  await p.submit(naddr());
  assert.equal(p.calls.open.length, 0);
  assert.equal(p.calls.error.at(-1), 'Could not find that stream. Check the address and try again.');
  assert.equal(p.els.submit.disabled, false);
  assert.equal(p.els.submit.textContent, 'Watch');
  p.setQuery(async () => { throw new Error('relays down'); });
  await p.submit(naddr());
  assert.equal(p.calls.error.at(-1), 'Could not find that stream. Check the address and try again.');
  assert.equal(p.els.submit.disabled, false);
  p.setQuery(async () => [event()]);
  await p.submit(naddr());
  assert.equal(p.calls.open.length, 1, 'the next try works');
});

test('while it looks, the button says so and a second press does nothing', async () => {
  let release;
  const p = page();
  p.setQuery(() => new Promise((r) => { release = () => r([event()]); }));
  // every relay waits on the same gate
  const first = p.submit(naddr());
  await new Promise(setImmediate);
  assert.equal(p.els.submit.textContent, 'Looking…');
  assert.equal(p.els.submit.disabled, true);
  p.submit(naddr());
  await new Promise(setImmediate);
  assert.equal(p.calls.pools.length, 1, 'the second press opened no lookup');
  release();
  await first;
  assert.equal(p.els.submit.textContent, 'Watch');
  assert.equal(p.calls.open.length, 1);
});

test('the wrong kind of address and the wrong kind of text are told apart', async () => {
  const p = page();
  await p.submit(naddr({ kind: 30023 }));
  assert.equal(p.calls.error.at(-1), 'That address is not a stream.');
  await p.submit('hello there');
  assert.equal(p.calls.error.at(-1), 'Enter a video link or a stream naddr.');
  assert.equal(p.calls.pools.length, 0, 'no relay was asked');
  assert.equal(p.calls.open.length + p.calls.play.length, 0);
});

test('a video address plays as it always did, and is saved when asked', async () => {
  const p = page();
  await p.submit('https://example.com/live.m3u8');
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls.play)), [{ u: 'https://example.com/live.m3u8', n: 'example.com' }]);
  assert.equal(p.calls.pools.length, 0);
  assert.equal(p.calls.save.length, 0);
  const q = page();
  await q.submit('https://example.com/live.m3u8', { save: true });
  assert.equal(q.calls.save.length, 1);
  assert.equal(q.calls.play.length, 1);
  const r = page({ saveOk: false });
  await r.submit('https://example.com/live.m3u8', { save: true });
  assert.equal(r.calls.play.length, 0, 'a save that fails does not play, as before');
});

test('Save stream applies to an naddr too, and a failed save does not open it', async () => {
  const p = page();
  await p.submit(naddr(), { save: true });
  assert.equal(p.calls.save.length, 1);
  assert.equal(p.calls.save[0].at(-1).key, '30311:' + PK + ':show-1');
  assert.equal(p.calls.open.length, 1);
  const q = page({ saveOk: false });
  await q.submit(naddr(), { save: true });
  assert.equal(q.calls.open.length, 0);
});

test('nothing happens while the player is off or locked', async () => {
  for (const opts of [{ enabled: false }, { locked: true }]) {
    const p = page(opts);
    await p.submit(naddr());
    assert.equal(p.calls.pools.length + p.calls.open.length + p.calls.play.length, 0);
  }
});

test('the box accepts text, labels itself for both, and the panel and its reference page agree', () => {
  for (const f of ['sidepanel.html', 'docs/streaming/layout.html', 'docs/streaming/preview.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(html, /<input id="stream-url" type="text" inputmode="url"[^>]*placeholder="https:\/\/…\/live\.m3u8 or naddr1…" required \/>/, f);
    assert.match(html, /data-i18n="Open a stream">Open a stream<\/button>/, f);
    assert.match(html, /<label for="stream-url" data-i18n="Stream link or naddr">Stream link or naddr<\/label>/, f);
    assert.doesNotMatch(html, /Enter stream URL/, f);
  }
});
