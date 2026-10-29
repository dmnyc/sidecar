'use strict';

// Unit coverage for relay-health.js — the probe behind the Profile tab's "Check relays".
//
// The point of this screen is a keep-or-drop decision, so the failure that matters is
// not "we said down when it was up". It is the reverse: calling a relay healthy when it
// will not serve you, or write-safe when it will refuse your posts. Someone acts on that
// by keeping a relay that is quietly costing them notes. Most of what follows pins the
// conservative direction rather than the happy path.
//
// relay-health.js is isolated (WebSocket/fetch only), so it runs in a vm against fakes.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

let RH;
before(() => {
  // URL is a host global the vm context does not grow on its own — normalizeRelayUrl
  // needs the real one, so the browser's parsing and the test's cannot disagree.
  const ctx = { self: {}, setTimeout, clearTimeout, Promise, Date, JSON, Object, Array, Error, AbortController, URL };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'relay-health.js'), 'utf8'), ctx, { filename: 'relay-health.js' });
  RH = ctx.globalThis.SidecarRelayHealth;
  assert.ok(RH, 'SidecarRelayHealth loaded');
});

// A scriptable relay. `script` is what the socket does once opened.
function fakeWs(script) {
  return function (url) {
    const ws = { url, close() {}, send() {} };
    setTimeout(() => script(ws), 0);
    return ws;
  };
}
const msg = (ws, arr) => ws.onmessage && ws.onmessage({ data: JSON.stringify(arr) });
const okNip11 = (over) => async () => ({
  ok: true, text: async () => JSON.stringify(Object.assign({ name: 'r' }, over)), status: 200,
});
const deadNip11 = async () => { throw new Error('network'); };

// ---- classify: the verdicts ------------------------------------------------------

test('a relay that serves is healthy, and write-safe only when NIP-11 says so', () => {
  const served = { up: true, served: true, connectMs: 10, readMs: 20 };
  const c = RH.classify(served, { ok: true });
  assert.equal(c.verdict, 'healthy');
  assert.equal(c.writeSafe, true);
  assert.equal(c.writeKnown, true);
});

test('UNREADABLE NIP-11 MEANS WRITES ARE UNKNOWN, NOT FINE', () => {
  // The one that would lose notes. A relay can serve reads perfectly and refuse every
  // write; NIP-11 is the only thing that reports that, so when it cannot be read the
  // honest answer is "unproven". Defaulting writeSafe to true here would tell someone to
  // keep a relay on evidence we do not have.
  const c = RH.classify({ up: true, served: true, connectMs: 10, readMs: 20 }, { ok: false });
  assert.equal(c.verdict, 'healthy', 'reads are genuinely proven');
  assert.equal(c.writeSafe, false, 'writes are not');
  assert.equal(c.writeKnown, false, 'and the UI must be able to say "unknown" rather than "bad"');
});

test('each write gate is named', () => {
  const served = { up: true, served: true };
  for (const [flag, why] of [
    ['paymentRequired', 'payment required'],
    ['restrictedWrites', 'restricted writes'],
    ['authRequired', 'auth required'],
  ]) {
    const c = RH.classify(served, { ok: true, [flag]: true });
    assert.equal(c.verdict, 'gated', flag);
    assert.equal(c.writeSafe, false);
    assert.equal(c.why, why);
  }
});

test('connected-but-silent is not healthy', () => {
  // The case a socket-open check gets wrong, and the reason this module exists.
  const c = RH.classify({ up: true, served: false, reason: 'no EOSE' }, { ok: true });
  assert.equal(c.verdict, 'not-serving');
  assert.equal(c.writeSafe, false);
});

test('down and auth-gated are distinguished', () => {
  assert.equal(RH.classify({ up: false, reason: 'connect timeout' }, {}).verdict, 'down');
  assert.equal(RH.classify({ up: true, authChallenge: true }, {}).verdict, 'auth-gated');
  // A missing probe is treated as down rather than throwing.
  assert.equal(RH.classify(null, {}).verdict, 'down');
});

// ---- probe: what the socket actually does ----------------------------------------

test('EOSE ends the probe and reports whether your notes are there', async () => {
  const withNote = await RH.probe('wss://r', 'a'.repeat(64), {
    WebSocket: fakeWs((ws) => {
      ws.onopen();
      msg(ws, ['EVENT', 'rh', { id: 'x' }]);
      msg(ws, ['EOSE', 'rh']);
    }),
  });
  assert.equal(withNote.served, true);
  assert.equal(withNote.hasAuthorData, true, 'the relay is holding this account');

  const empty = await RH.probe('wss://r', 'a'.repeat(64), {
    WebSocket: fakeWs((ws) => { ws.onopen(); msg(ws, ['EOSE', 'rh']); }),
  });
  assert.equal(empty.served, true);
  assert.equal(empty.hasAuthorData, false, 'up, serving, and empty of you — the drop candidate');
});

test('AUTH and CLOSED settle instead of hanging to the timeout', async () => {
  const auth = await RH.probe('wss://r', null, {
    WebSocket: fakeWs((ws) => { ws.onopen(); msg(ws, ['AUTH', 'challenge']); }),
  });
  assert.equal(auth.authChallenge, true);
  const closed = await RH.probe('wss://r', null, {
    WebSocket: fakeWs((ws) => { ws.onopen(); msg(ws, ['CLOSED', 'rh', 'restricted']); }),
  });
  assert.equal(closed.served, false);
  assert.match(closed.reason, /restricted/);
});

test('a constructor that throws is a verdict, not an exception', async () => {
  const r = await RH.probe('wss://nope', null, {
    WebSocket: function () { throw new Error('bad url'); },
  });
  assert.equal(r.up, false, 'one malformed entry must not take the whole audit down');
});

test('the probe settles exactly once', async () => {
  // onclose fires after close(), and an unguarded resolve would let a late error
  // overwrite a good verdict.
  let resolves = 0;
  const r = await RH.probe('wss://r', null, {
    WebSocket: fakeWs((ws) => {
      ws.onopen();
      msg(ws, ['EOSE', 'rh']);
      ws.onclose && ws.onclose();
      ws.onerror && ws.onerror();
    }),
  }).then((v) => { resolves++; return v; });
  assert.equal(r.served, true, 'the EOSE verdict survives the close that follows it');
  assert.equal(resolves, 1);
});

// ---- audit: the list ------------------------------------------------------------

test('every relay gets a verdict, and results stream as they land', async () => {
  const seen = [];
  const out = await RH.audit(['wss://a', 'wss://b'], null, {
    WebSocket: fakeWs((ws) => { ws.onopen(); msg(ws, ['EOSE', 'rh']); }),
    fetch: okNip11(),
    onResult: (r) => seen.push(r.url),
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.verdict), ['healthy', 'healthy']);
  assert.equal(seen.length, 2, 'rows settle one at a time rather than all at the end');
});

test('a dead NIP-11 does not fail the audit', async () => {
  const out = await RH.audit(['wss://a'], null, {
    WebSocket: fakeWs((ws) => { ws.onopen(); msg(ws, ['EOSE', 'rh']); }),
    fetch: deadNip11,
  });
  assert.equal(out[0].verdict, 'healthy');
  assert.equal(out[0].writeKnown, false);
});

test('httpFromWss maps the socket url to the document url', () => {
  assert.equal(RH.httpFromWss('wss://relay.example.com/'), 'https://relay.example.com');
  assert.equal(RH.httpFromWss('ws://localhost:7777//'), 'http://localhost:7777');
});

// ---- normalizeRelayUrl: what the Add fields accept --------------------------------
//
// Both relay-add fields (Settings and the NIP-65 editor) pass through this, so the
// rules cannot drift apart. The failure it exists for: the old handlers prepended
// wss:// to anything that lacked it, so the pasted https://relay.nostr.build became
// the mangled wss://https://relay.nostr.build and entered the list looking saved.

// Field-by-field rather than deepEqual: the result object comes from the vm context,
// whose Object.prototype is not this realm's, and strict deep equality sees that
// difference even when every value matches.
test("the address bar's version of a relay becomes its websocket form", () => {
  const cases = [
    ['https://relay.nostr.build/', 'wss://relay.nostr.build'],
    ['HTTPS://relay.nostr.build', 'wss://relay.nostr.build'],
    ['http://localhost:8008', 'ws://localhost:8008'],
  ];
  for (const [raw, url] of cases) {
    const n = RH.normalizeRelayUrl(raw);
    assert.equal(n.ok, true, raw);
    assert.equal(n.url, url, raw);
  }
});

test('a bare host means the wss:// the user omitted, and one relay is one entry', () => {
  const cases = [
    ['relay.nostr.build', 'wss://relay.nostr.build'],
    ['relay.nostr.build/', 'wss://relay.nostr.build'],
    // Trailing slashes off and the case URL already folded, so re-adding what is in
    // the list lands on the same key instead of a near-duplicate.
    ['  WSS://RELAY.NOSTR.BUILD//  ', 'wss://relay.nostr.build'],
    ['wss://relay.example.com:7777', 'wss://relay.example.com:7777'],
  ];
  for (const [raw, url] of cases) {
    const n = RH.normalizeRelayUrl(raw);
    assert.equal(n.ok, true, raw);
    assert.equal(n.url, url, raw);
  }
});

test('what is not a relay is refused before any socket is opened for it', () => {
  // An npub pasted into the relay field is the case the host rule exists for: it
  // parses as a URL once wss:// lands in front of it, and without the rule it would
  // wait out the whole connect timeout before being called unreachable.
  const npub = 'npub1' + 'a'.repeat(58);
  for (const bad of [npub, 'note1abc', 'hello', 'ftp://files.example.com', 'wss://', 'wss:///nohost', '']) {
    assert.equal(RH.normalizeRelayUrl(bad).ok, false, bad);
  }
});

test('the relays that are none of the above still get in', () => {
  // Tor (a dotted .onion), a LAN box with a port, IP literals, and a path — all
  // legitimate relay addresses that a stricter rule would have locked out.
  assert.equal(RH.normalizeRelayUrl('wss://' + 'a'.repeat(56) + '.onion').ok, true, 'onion');
  assert.equal(RH.normalizeRelayUrl('ws://nas:4848').ok, true, 'dotless host with a port');
  assert.equal(RH.normalizeRelayUrl('wss://127.0.0.1:7777').ok, true, 'IPv4 literal');
  assert.equal(RH.normalizeRelayUrl('wss://[::1]:7777').ok, true, 'IPv6 literal');
  assert.equal(RH.normalizeRelayUrl('wss://relay.example.com/nostr').url, 'wss://relay.example.com/nostr', 'path kept');
});

// ---- blocksAdd: the add-time gate --------------------------------------------------

test('a relay that answered, or that demanded sign-in, joins without a question', async () => {
  const served = await RH.probe('wss://r', null, {
    WebSocket: fakeWs((ws) => { ws.onopen(); msg(ws, ['EOSE', 'rh']); }),
  });
  assert.equal(RH.blocksAdd(served), false);
  // relay.nostr.build's shape for an anonymous reader: AUTH before any answer. Up and
  // speaking nostr is not a reason to interrogate whoever is adding it.
  const authed = await RH.probe('wss://r', null, {
    WebSocket: fakeWs((ws) => { ws.onopen(); msg(ws, ['AUTH', 'challenge']); }),
  });
  assert.equal(RH.blocksAdd(authed), false);
});

test('an unreachable or silent relay is added only on purpose', async () => {
  const refused = await RH.probe('wss://nope', null, {
    WebSocket: function () { throw new Error('connection refused'); },
  });
  assert.equal(RH.blocksAdd(refused), true);
  // Connected but never answered. Asserted directly rather than through a socket that
  // hangs, because the socket's own version of this waits out the read timeout — the
  // add flow's worst case, not the test's.
  assert.equal(RH.blocksAdd({ up: true, served: false, reason: 'no EOSE' }), true, 'up but not serving');
});

// ---- how the panel drives it ------------------------------------------------------
//
// Source assertions: the NIP-65 editor builds DOM inside the panel's closure. What is
// pinned here is the handful of properties that are easy to break and expensive to
// notice — the probe staying manual, verdicts surviving edits, and rows never getting
// stuck mid-check.

const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

test('the module is loaded before the panel that uses it', () => {
  assert.match(html, /<script src="relay-health\.js"><\/script>/);
  // The SCRIPT TAGS, not the first mention of each name — "sidepanel.js" appears in an
  // HTML comment hundreds of lines above its own tag, and comparing raw indexOf against
  // that compares nothing.
  assert.ok(
    html.indexOf('<script src="relay-health.js">') < html.indexOf('<script src="sidepanel.js">'),
    'relay-health.js must load first — the panel reads self.SidecarRelayHealth'
  );
});

test('probing is manual, never on render', () => {
  // A probe opens a socket to every relay in the list. On render that means hammering
  // them on every repaint, and it makes the panel's presence legible to anyone watching
  // the relay. It must be reachable only from the button.
  assert.match(panel, /checkBtn\.addEventListener\('click', runHealthCheck\)/);
  const calls = panel.match(/runHealthCheck\(\)/g) || [];
  assert.equal(calls.length, 1, 'runHealthCheck should only be referenced by its own definition');
  assert.doesNotMatch(panel, /renderRows\(\);\s*\n\s*runHealthCheck/, 'not chained onto a render');
});

test('verdicts are keyed by URL, not by row index', () => {
  // The list is editable while results are on screen — add, remove, and the rows
  // renumber. Keyed by index, a verdict would slide onto a different relay, which is
  // worse than showing none: it recommends dropping the wrong one.
  assert.match(panel, /const health = new Map\(\);/);
  assert.match(panel, /health\.set\(res\.url, res\)/);
  assert.match(panel, /function healthLine\(url\)/);
  assert.match(panel, /health\.get\(url\)/);
});

test('rows settle one at a time', () => {
  // A list containing one dead relay otherwise shows nothing at all until that relay's
  // connect timeout expires, because the audit resolves as a whole.
  //
  // Scoped to the callback rather than measured in characters: the handler picked up the
  // relay-icon cache write, and a character budget fails on unrelated growth inside a
  // block that is still doing the right thing.
  const cb = panel.slice(panel.indexOf('onResult: (res) => {'));
  const body = cb.slice(0, cb.indexOf('\n          },'));
  assert.ok(body.length > 0, 'could not isolate the onResult callback');
  assert.match(body, /renderRows\(\);/, 'every result must repaint, not just the last');
});

test('a thrown probe cannot leave rows stuck on "Checking…"', () => {
  const fn = panel.slice(panel.indexOf('async function runHealthCheck'));
  const body = fn.slice(0, fn.indexOf('\n    }\n'));
  assert.match(body, /catch \(_\) \{[\s\S]*?health\.get\(u\) === 'checking'[\s\S]*?health\.delete\(u\)/);
  assert.match(body, /finally \{[\s\S]*?checkBtn\.disabled = false/, 'and the button must come back');
});

test('the verdict is stated in words, not by color alone', () => {
  // WCAG 1.4.1. The dot is a second channel; a theme that renders it poorly, or a reader
  // who cannot distinguish it, still gets the whole verdict from the row.
  assert.match(panel, /const VERDICT_TEXT = \{/);
  for (const v of ['healthy', 'gated', "'auth-gated'", "'not-serving'", 'down']) {
    assert.ok(panel.includes(v + ':'), 'VERDICT_TEXT must name ' + v);
  }
});

test('an unverifiable write is reported as unverified, not as fine', () => {
  // The failure mode that costs notes: NIP-11 not answering says nothing about whether
  // posting works, and this screen is where someone decides to keep a relay.
  assert.match(panel, /writeKnown === false\) bits\.push\('writes unverified'\)/);
});

test('the module ships — it is not under scripts/', () => {
  // scripts/ is stripped from the packaged extension, which is why this is a port rather
  // than a require of relay-doctor.mjs.
  assert.ok(fs.existsSync(path.join(ROOT, 'relay-health.js')), 'relay-health.js must be at the root');
  const pkg = fs.readFileSync(path.join(ROOT, 'scripts', 'package.sh'), 'utf8');
  assert.match(pkg, /rm -rf .*\$\{STAGE\}\/scripts/, 'scripts/ is stripped, so the port must live outside it');
});

test('the button reads the same before and after a check', () => {
  // The label is written in three places: at construction, swapped to the in-flight text
  // when a check starts, and restored in the finally when it ends. Construction and
  // restore are far apart in the source, so renaming one and not the other leaves a
  // button that silently changes wording after its first use.
  const texts = [...panel.matchAll(/checkBtn(?:\.textContent = |[^\n]*textContent: )'([^']+)'/g)]
    .map((m) => m[1]);
  assert.equal(texts.length, 3, 'expected construction, in-flight, and restore');
  const [built, inFlight, restored] = texts;
  assert.equal(inFlight, 'Checking…', 'the in-flight label');
  assert.equal(built, restored, 'the restored label must match the original: ' + built + ' vs ' + restored);
  assert.equal(built, 'Check relay health');
  // "Check relays" alone sat directly above rows carrying two checkboxes each, where it
  // reads as "tick the relays". The noun is what removes that.
  assert.doesNotMatch(panel, /textContent: 'Check relays'/);
});

// ---- NIP-42: probing as the account rather than as a stranger --------------------
//
// The probe used to bail the instant a relay challenged, so relay.nostr.build and
// nostr.land were reported "demands NIP-42 AUTH" — advice to drop them — even after the
// panel gained the ability to sign in to both. A health screen that tells you to discard
// working relays is worse than none.
//
// The anonymous behavior has to survive intact, because relay-doctor shares this code
// and has no key.

// A relay that refuses to serve until it has been authenticated.
function authRelay({ challengeOnConnect = true, accept = true, closedFirst = false } = {}) {
  return fakeWs((ws) => {
    let authed = false;
    ws.send = (raw) => {
      const m = JSON.parse(raw);
      if (m[0] === 'REQ') {
        if (authed) return msg(ws, ['EOSE', 'rh']);
        if (closedFirst) return msg(ws, ['CLOSED', 'rh', 'auth-required: please sign in']);
        return;
      }
      if (m[0] === 'AUTH') {
        authed = accept;
        return msg(ws, ['OK', m[1].id, accept, accept ? '' : 'subscription expired']);
      }
    };
    ws.onopen();
    if (challengeOnConnect) msg(ws, ['AUTH', 'challenge-123']);
  });
}

const signer = (over) => async (template) => Object.assign({ id: 'auth-evt', sig: 'x' }, template, over);

test('an answered challenge on connect ends in a served read', async () => {
  const p = await RH.probe('wss://gated.example', null, { WebSocket: authRelay(), onauth: signer() });
  assert.equal(p.served, true, 'the point: sign in, then actually read');
  assert.equal(p.authed, true);
  assert.ok(!p.authChallenge, 'an answered challenge is not a gate');
});

test('an answered "auth-required" CLOSED also ends in a served read', async () => {
  // The other shape: no challenge until you ask for something.
  const ws = authRelay({ challengeOnConnect: false, closedFirst: true });
  const p = await RH.probe('wss://gated.example', null, {
    WebSocket: fakeWs((s) => {
      let authed = false;
      s.send = (raw) => {
        const m = JSON.parse(raw);
        if (m[0] === 'REQ') {
          if (authed) return msg(s, ['EOSE', 'rh']);
          return msg(s, ['CLOSED', 'rh', 'auth-required: please sign in']);
        }
        if (m[0] === 'AUTH') { authed = true; return msg(s, ['OK', m[1].id, true, '']); }
      };
      s.onopen();
      msg(s, ['AUTH', 'challenge-123']);
    }),
    onauth: signer(),
  });
  assert.equal(p.served, true);
  assert.equal(p.authed, true);
  void ws;
});

test('a signed-in read classifies as healthy, not auth-gated', () => {
  const c = RH.classify({ up: true, served: true, authed: true, connectMs: 9 }, { ok: true });
  assert.equal(c.verdict, 'healthy', 'this is what told the user to drop a working relay');
  assert.equal(c.authed, true, 'and the UI must be able to say which account it is healthy FOR');
});

test('a REFUSED sign-in is still auth-gated, and says why', async () => {
  // A lapsed subscription must not read as healthy.
  const p = await RH.probe('wss://gated.example', null, {
    WebSocket: authRelay({ accept: false }),
    onauth: signer(),
  });
  assert.equal(p.served, false);
  assert.equal(p.authChallenge, true);
  assert.equal(p.authFailed, true);
  const c = RH.classify(p, { ok: true });
  assert.equal(c.verdict, 'auth-gated');
  assert.match(c.why, /subscription expired/);
});

test('a signer that throws degrades to the anonymous verdict', async () => {
  // Locked keystore, no active account, or a relay the caller will not identify to.
  const p = await RH.probe('wss://gated.example', null, {
    WebSocket: authRelay(),
    onauth: async () => { throw new Error('locked'); },
  });
  assert.equal(p.authChallenge, true);
  assert.equal(RH.classify(p, { ok: true }).verdict, 'auth-gated');
});

test('WITHOUT a signer the anonymous behavior is unchanged', () => {
  // relay-doctor shares this file and has no key. Its verdicts must not move.
  return RH.probe('wss://gated.example', null, { WebSocket: authRelay() }).then((p) => {
    assert.equal(p.authChallenge, true);
    assert.equal(p.served, false);
    assert.equal(p.reason, 'demands AUTH');
    assert.ok(!p.authed);
  });
});

test('a relay that never challenges is untouched by any of this', async () => {
  const p = await RH.probe('wss://open.example', null, {
    WebSocket: fakeWs((ws) => { ws.onopen(); msg(ws, ['EOSE', 'rh']); }),
    onauth: signer(),
  });
  assert.equal(p.served, true);
  assert.ok(!p.authed, 'nothing was signed, so nothing should claim it was');
});

test('a stale auth-required CLOSED does not settle while sign-in is in flight', async () => {
  // relay.nostr.build, verified live: it challenges, and then also sends CLOSED
  // auth-required for the REQ we issued BEFORE the challenge — arriving while our AUTH
  // is still in flight. Settling on it reported "demands AUTH" one frame before the
  // relay was ready to answer, which is the exact wrong verdict for a relay we can use.
  const p = await RH.probe('wss://gated.example', null, {
    WebSocket: fakeWs((ws) => {
      let authed = false;
      ws.send = (raw) => {
        const m = JSON.parse(raw);
        if (m[0] === 'REQ') {
          if (authed) return msg(ws, ['EOSE', 'rh']);
          // the pre-auth REQ is refused, but only after the challenge is already out
          return setTimeout(() => msg(ws, ['CLOSED', 'rh', 'auth-required: sign in first']), 0);
        }
        if (m[0] === 'AUTH') {
          return setTimeout(() => { authed = true; msg(ws, ['OK', m[1].id, true, '']); }, 1);
        }
      };
      ws.onopen();
      msg(ws, ['AUTH', 'challenge-123']);
    }),
    onauth: signer(),
  });
  assert.equal(p.served, true, 'the stale CLOSED must not win the race');
  assert.equal(p.authed, true);
});

// ---- the panel's one-line reason -------------------------------------------------

test('a relay’s prose is reduced to the NIP-01 word', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const at = src.indexOf('function shortReason(');
  assert.ok(at !== -1, 'shortReason not found');
  const open = src.indexOf('{', at);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const words = src.match(/const REASON_WORDS = \{[\s\S]*?\};/)[0];
  const shortReason = new Function(words + '\n' + src.slice(at, end) + '\nreturn shortReason;')();

  // The one from the screenshot: three lines in a row with room for one.
  assert.equal(
    shortReason('CLOSED: rate-limited: there is a bug in the client, no one should be making so many requests'),
    'rate limited'
  );
  assert.equal(shortReason('CLOSED: blocked: you are not welcome'), 'blocked');
  assert.equal(shortReason('auth-required: sign in first'), 'needs sign-in');

  // No recognized word: keep it, but cap it so a row cannot grow without limit.
  const long = shortReason('CLOSED: ' + 'x'.repeat(200));
  assert.ok(long.length <= 44, 'got ' + long.length);
  assert.match(long, /…$/);

  // "error:" is a container, not a description — show what it contains.
  assert.equal(shortReason('error: failed to authenticate'), 'failed to authenticate');

  // Short and unrecognized survives untouched.
  assert.equal(shortReason('connect timeout'), 'connect timeout');
  assert.equal(shortReason(''), '');
});

test('the dot is green for anything the relay actually served', () => {
  // A paid relay in a subscriber's own list showed amber, which reads as a fault on a
  // relay that works. classify() only reaches `gated` after !p.served has been ruled
  // out, so gated ALWAYS means the relay answered — and with NIP-42 it answered after
  // signing in. Amber belongs to what the user can act on.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const green = css.match(/([^}]*)\{ background: var\(--success\); \}/g).join('\n');
  assert.match(green, /v-gated/, 'a served paid relay is working, not warning');
  assert.match(green, /v-healthy/);

  const amber = css.match(/([^}]*)\{ background: var\(--warn\); \}/g).join('\n');
  assert.match(amber, /v-auth-gated/, 'a sign-in that failed is actionable');
  assert.match(amber, /v-not-serving/);
  assert.doesNotMatch(amber, /v-gated \.nip65-dot,\n\.nip65-health\.v-auth/, 'gated must not be amber');
});

test('gated is only ever reached once the relay has served', () => {
  // The premise the dot color rests on.
  const c = RH.classify({ up: true, served: false, reason: 'no EOSE' }, { ok: true, paymentRequired: true });
  assert.equal(c.verdict, 'not-serving', 'an unanswered probe must never classify as gated');
});

// ---- the add fields: wired to the module, not to their own rules ------------------

test('both Add fields normalize through the module, and no handler builds a relay URL by hand', () => {
  // Two handlers used to carry two prefix-only normalizers, and both turned the pasted
  // https://relay.nostr.build into the mangled wss://https://relay.nostr.build. The
  // rules now live in one place; a handler that needs a rule changes the module.
  const calls = panel.match(/RH\.normalizeRelayUrl\(/g) || [];
  assert.equal(calls.length, 2, 'Settings and the NIP-65 editor, one call each');
  assert.doesNotMatch(panel, /= 'wss:\/\/' \+ /, 'no handler prepends wss:// on its own anymore');
  assert.equal((panel.match(/RH\.blocksAdd\(/g) || []).length, 2, 'both add flows gate on the same verdicts');
});

test('the add-anyway question gets its own full-width row, never the input line', () => {
  // The question carries words and two buttons; beside the input they collide inside
  // 300px of usable width (the recurring remove-button mistake). Below the input,
  // message on its own line and the answers stretched beneath — the same shape the
  // connected-site rows use.
  const at = (id) => html.indexOf('id="' + id + '"');
  assert.ok(at('relay-add-confirm') !== -1, 'the settings confirm row exists');
  assert.ok(at('relay-add-confirm') > at('relay-input'), 'below the input row');
  assert.ok(at('relay-add-anyway') !== -1 && at('relay-add-cancel') !== -1);
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.relay-add-confirm \{[^}]*flex-direction: column/, 'stacked, not beside');
  assert.match(css, /\.relay-add-confirm-actions button \{ flex: 1; \}/, 'answers share the row evenly');
  // The NIP-65 editor builds the same row in code, from the same classes.
  assert.match(panel, /className: 'relay-add-confirm'/);
  assert.match(panel, /className: 'relay-add-confirm-actions'/);
});
