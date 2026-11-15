'use strict';

// The notification zap form asked the configured relays alone for the recipient's
// profile, and read finding nothing there as "They have no lightning address" for people
// who have one. The address now comes from the relays the recipient publishes to, with
// the configured set and the aggregator only as a fallback. These run the real
// zapRecipientProfile against stub relays.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = panel.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = panel.indexOf('{', at); i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

function liftLine(re) {
  const m = panel.match(re);
  assert.ok(m, re + ' is gone');
  return m[0];
}

const PK = 'a'.repeat(64);
const EOSE_CLOSE = 'closed automatically on eose';
const kind0 = (lud16, created_at = 100) =>
  ({ kind: 0, pubkey: PK, created_at, id: 'k' + created_at, content: JSON.stringify({ name: 'carol', lud16 }) });
const relayList = (...write) =>
  ({ kind: 10002, pubkey: PK, created_at: 50, id: 'l', tags: write.map((u) => ['r', u, 'write']) });

// relays: url -> { ms, events } (answers after ms with those events, then EOSE) | 'down'
// (connects and never says anything until closed). Unlisted relays answer at once, empty.
function panelWith({ relays, cachedList, configured = ['wss://mine.example'], maxWait = 400 }) {
  const asked = [];
  const cached = {};
  const nip65Cache = new Map();
  if (cachedList !== undefined) nip65Cache.set(PK, cachedList);
  const ctx = vm.createContext({
    PROFILE_MAX_WAIT: maxWait, BASE_EOSE_TIMEOUT: 4400, EOSE_CLOSE, setTimeout, clearTimeout, Promise, JSON, Date, nip65Cache,
    self: { SidecarRelayPolicy: { listFromTags: (tags) => ({ read: [], write: tags.filter((t) => t[0] === 'r').map((t) => t[1]) }) } },
    relayUrls: async () => configured,
    cacheProfile: (pk, c) => { cached[pk] = c; },
    poolSubscribeManyEose: ([url], filter, params) => {
      asked.push({ url, kind: filter.kinds[0] });
      const r = relays[url] === undefined ? { ms: 0, events: [] } : relays[url];
      let open = true;
      const close = (reason) => { if (open) { open = false; params.onclose([reason]); } };
      if (r === 'down') {
        // What nostr-tools does with a relay that never answers: a synthetic EOSE once its
        // eoseTimeout (maxWait) runs out.
        setTimeout(() => close(EOSE_CLOSE), (params.maxWait || 4400) + 5);
      } else {
        setTimeout(() => {
          if (!open) return;
          for (const ev of r.events) if (filter.kinds.includes(ev.kind)) params.onevent(ev);
          close(EOSE_CLOSE);
        }, r.ms);
      }
      return { close: () => close('closed by caller') };
    },
  });
  vm.runInContext([
    lift('function poolQueryAnswered('), lift('async function poolGetProfileInfo('),
    liftLine(/const ZAP_LOOKUP = [^\n]+/), lift('async function zapRecipientProfile('),
    'this.zapRecipientProfile = zapRecipientProfile; this.query = poolQueryAnswered;',
  ].join('\n'), ctx);
  return { run: () => ctx.zapRecipientProfile(PK), query: (...a) => ctx.query(...a), asked, cached };
}

const timed = async (fn) => { const t0 = Date.now(); const out = await fn(); return { out, ms: Date.now() - t0 }; };

test('one relay that never answers no longer holds the read: the first answer settles it', async () => {
  const p = panelWith({ relays: { 'wss://fast.example': { ms: 20, events: [kind0('x@fast.example')] }, 'wss://dead.example': 'down' }, maxWait: 3000 });
  const { out, ms } = await timed(() => p.query(['wss://fast.example', 'wss://dead.example'], { kinds: [0], authors: [PK] }, { maxWait: 3000, settleAfter: 50 }));
  assert.equal(JSON.parse(out.events[0].content).lud16, 'x@fast.example');
  assert.ok(ms < 1000, 'waited ' + ms + 'ms on a relay that never answers');
});

test('a newer copy landing within the pause is still collected', async () => {
  const p = panelWith({ relays: {
    'wss://a.example': { ms: 10, events: [kind0('old@a.example', 100)] },
    'wss://b.example': { ms: 60, events: [kind0('new@b.example', 200)] },
  } });
  const { events } = await p.query(['wss://a.example', 'wss://b.example'], { kinds: [0], authors: [PK] }, { settleAfter: 200 });
  assert.equal(events.length, 2, 'the newer copy did not land within the pause');
});

test('another author\'s event does not start the clock', async () => {
  const p = panelWith({ relays: {
    'wss://crossed.example': { ms: 0, events: [Object.assign(kind0('wrong@x.example'), { pubkey: 'b'.repeat(64), id: 'crossed' })] },
    'wss://real.example': { ms: 150, events: [kind0('real@x.example')] },
  } });
  const { events } = await p.query(['wss://crossed.example', 'wss://real.example'], { kinds: [0], authors: [PK] }, { settleAfter: 30 });
  assert.ok(events.some((e) => e.pubkey === PK), 'a crossed event settled the read before the real one arrived');
});

test('without settleAfter the query waits for every relay, as before', async () => {
  const p = panelWith({ relays: {
    'wss://a.example': { ms: 0, events: [kind0('a@x.example', 100)] },
    'wss://b.example': { ms: 120, events: [kind0('b@x.example', 200)] },
  } });
  const { events } = await p.query(['wss://a.example', 'wss://b.example'], { kinds: [0], authors: [PK] }, {});
  assert.equal(events.length, 2);
});

test('the address comes from the recipient\'s own write relays, even when a newer copy sits elsewhere', async () => {
  const p = panelWith({ relays: {
    'wss://purplepag.es': { ms: 0, events: [relayList('wss://theirs.example'), kind0('stale@elsewhere.example', 200)] },
    'wss://theirs.example': { ms: 30, events: [kind0('real@theirs.example', 100)] },
  } });
  const { profile, answered } = await p.run();
  assert.equal(profile.lud16, 'real@theirs.example');
  assert.equal(answered, true);
  assert.equal(p.cached[PK].lud16, 'real@theirs.example', 'the copy used was not cached');
});

test('a relay list already in the session cache is used without asking for it again', async () => {
  const p = panelWith({ cachedList: { read: [], write: ['wss://theirs.example'] }, relays: {
    'wss://theirs.example': { ms: 0, events: [kind0('real@theirs.example')] },
  } });
  assert.equal((await p.run()).profile.lud16, 'real@theirs.example');
  assert.ok(!p.asked.some((a) => a.kind === 10002), 'asked for a relay list it already had');
});

test('a dead relay on their list, and the address still arrives fast', async () => {
  const p = panelWith({ maxWait: 3000, relays: {
    'wss://mine.example': { ms: 0, events: [] },
    'wss://purplepag.es': { ms: 40, events: [relayList('wss://dead.example', 'wss://live.example'), kind0('carol@wallet.example')] },
    'wss://dead.example': 'down',
    'wss://live.example': { ms: 20, events: [kind0('carol@wallet.example')] },
  } });
  const { out, ms } = await timed(() => p.run());
  assert.equal(out.profile.lud16, 'carol@wallet.example');
  assert.ok(ms < 1500, 'took ' + ms + 'ms; the dead relay is holding the form again');
});

test('a profile found only on the aggregator is found, not reported as no address', async () => {
  const p = panelWith({ relays: { 'wss://purplepag.es': { ms: 0, events: [kind0('carol@wallet.example')] } } });
  const { profile } = await p.run();
  assert.equal(profile.lud16, 'carol@wallet.example');
  assert.ok(p.asked.some((a) => a.kind === 0 && a.url === 'wss://mine.example'), 'the fallback skipped the configured set');
});

test('their relays holding no profile, or being down, falls back', async () => {
  for (const theirs of [{ ms: 0, events: [] }, 'down']) {
    const p = panelWith({ relays: {
      'wss://purplepag.es': { ms: 0, events: [relayList('wss://theirs.example'), kind0('carol@wallet.example')] },
      'wss://theirs.example': theirs,
    } });
    assert.equal((await p.run()).profile.lud16, 'carol@wallet.example');
  }
});

test('nobody answering is reported as not loaded, not as no profile', async () => {
  const p = panelWith({ maxWait: 100, relays: { 'wss://purplepag.es': 'down', 'wss://mine.example': 'down' } });
  assert.deepEqual(JSON.parse(JSON.stringify(await p.run())), { profile: null, answered: false });
});

test('relays that answered with no profile say so', async () => {
  const p = panelWith({ relays: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(await p.run())), { profile: null, answered: true });
});

test('the notification zap form reads through it, and tells "could not load" from "no address"', () => {
  const form = lift('function buildZapForm(');
  const code = form.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(code, /zapRecipientProfile\(who\)/);
  assert.doesNotMatch(code, /poolGetProfile\(relays, who\)/, 'the configured-only read is back');
  assert.match(code, /if \(!profile && !answered\) throw new Error\(t\('Could not load their profile\.'\)\)/);
});

test('capMs resolves with what arrived by then, says it was cut off, and closes the rest', async () => {
  const p = panelWith({ relays: {
    'wss://fast.example': { ms: 10, events: [kind0('x@fast.example')] },
    'wss://dead.example': 'down',
  }, maxWait: 5000 });
  const { out, ms } = await timed(() => p.query(['wss://fast.example', 'wss://dead.example'], { kinds: [0], authors: [PK] }, { maxWait: 5000, capMs: 120 }));
  assert.ok(ms < 1000, 'the cap did not cut the read short: ' + ms + 'ms');
  assert.equal(out.events.length, 1);
  assert.equal(out.complete, false, 'a read cut off by the cap claimed to be complete');
});

test('a read every relay finished is complete', async () => {
  const p = panelWith({ relays: { 'wss://a.example': { ms: 0, events: [] } } });
  const out = await p.query(['wss://a.example'], { kinds: [0], authors: [PK] }, { capMs: 2000 });
  assert.equal(out.complete, true);
});
