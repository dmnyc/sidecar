'use strict';

// "Failed to like: Sidecar was updated — reload this page to reconnect", almost every day,
// from a store build, on days with no release.
//
// An update, a disable/enable, or the browser repairing the install cuts every open tab's
// content script off from the extension, and the browser never injects a fresh copy into
// a tab that was already open. A client tab kept open for days failed every signature
// until the user reloaded it. The worker now re-injects content.js into tabs with no live
// copy, and the cut-off copy stands aside so the fresh one answers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// Runs content.js against a fake page. `runtime` is what the script sees as chrome.runtime;
// `sandbox` may be shared between two copies, the way one isolated world can be.
function load({ runtime, sandbox }) {
  const sb = sandbox || makeSandbox();
  sb.chrome = {
    runtime,
    storage: { onChanged: { addListener() {} } },
  };
  vm.runInContext(content, sb);
  return sb;
}

function makeSandbox() {
  const listeners = [];
  const posted = [];
  const timers = [];
  const el = () => ({
    style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {},
    attachShadow: () => ({ querySelector: () => null }), querySelector: () => null,
    querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null,
  });
  const window = {
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener() {},
    postMessage(data) { posted.push(data); },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  const sb = {
    window,
    location: { host: 'jumble.social', href: 'https://jumble.social/' },
    document: {
      body: el(), documentElement: el(), createElement: el, addEventListener() {},
      querySelectorAll: () => [], getElementById: () => null,
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    requestAnimationFrame() {},
    navigator: { language: 'en' },
    console,
    // The page's own traffic, as every copy's listener hears it.
    send(data) { for (const fn of listeners.slice()) fn({ source: sb.self, data }); },
    posted, timers, listeners,
  };
  // `window` and the global are the same object in a browser.
  Object.assign(sb, window);
  sb.window = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  // Inside the context the global is a proxy, not `sb`; the page's messages come from it.
  sb.self = vm.runInContext('globalThis', sb);
  return sb;
}

function deadRuntime() {
  // What a cut-off copy sees: no id, and every call throws.
  return {
    get id() { return undefined; },
    sendMessage() { throw new Error('Extension context invalidated.'); },
    get lastError() { throw new Error('Extension context invalidated.'); },
    onMessage: { addListener() {} },
  };
}

function liveRuntime(answer) {
  const onMsg = [];
  return {
    id: 'sidecar',
    lastError: undefined,
    sendMessage(msg, cb) { if (cb) cb(answer ? answer(msg) : undefined); },
    onMessage: { addListener(fn) { onMsg.push(fn); } },
    onMsg,
  };
}

const request = (id) => ({ ext: 'sidecar', scope: 'nostr', kind: 'request', id, method: 'signEvent', params: {} });
const responsesFor = (sb, id) => sb.posted.filter((p) => p.kind === 'response' && p.id === id);
const runTimers = (sb, ms) => {
  for (const t of sb.timers) if (t.fn && t.ms === ms) { const f = t.fn; t.fn = null; f(); }
};

test('A CUT-OFF COPY STANDS ASIDE WHEN A FRESH ONE ANSWERS', () => {
  const sb = load({ runtime: deadRuntime() });
  sb.send(request('n1'));
  assert.equal(responsesFor(sb, 'n1').length, 0, 'the cut-off copy answered before the fresh one could');
  // The fresh copy's answer arrives on the same channel.
  sb.send({ ext: 'sidecar', scope: 'nostr', kind: 'response', id: 'n1', response: { ok: true } });
  runTimers(sb, 2000);
  const errs = responsesFor(sb, 'n1').filter((p) => p.response && p.response.ok === false);
  assert.equal(errs.length, 0, 'a working signature was followed by a "reload this page" error');
});

test('WITH NO FRESH COPY, THE PAGE STILL GETS ONE ANSWER', () => {
  // A page the worker could not inject into must not be left with a promise that never settles.
  const sb = load({ runtime: deadRuntime() });
  sb.send(request('n2'));
  runTimers(sb, 2000);
  const got = responsesFor(sb, 'n2');
  assert.equal(got.length, 1);
  assert.equal(got[0].response.ok, false);
  assert.match(got[0].response.error, /reload this page/);
});

test('A LIVE COPY ANSWERS AT ONCE, AND A SECOND LIVE COPY STAYS OUT', () => {
  const sb = load({ runtime: liveRuntime(() => ({ ok: true, result: 'sig' })) });
  // The worker's injection racing the manifest's on the same page.
  load({ runtime: liveRuntime(() => ({ ok: true, result: 'sig2' })), sandbox: sb });
  sb.send(request('n3'));
  const got = responsesFor(sb, 'n3');
  assert.equal(got.length, 1, 'two live copies both answered');
  assert.equal(got[0].response.ok, true);
});

test('A CUT-OFF COPY DOES NOT STOP A FRESH ONE FROM LOADING', () => {
  const sb = load({ runtime: deadRuntime() });
  load({ runtime: liveRuntime(() => ({ ok: true, result: 'fresh' })), sandbox: sb });
  sb.send(request('n4'));
  const ok = responsesFor(sb, 'n4').filter((p) => p.response && p.response.ok);
  assert.equal(ok.length, 1, 'the fresh copy bailed because the old one had registered first');
  assert.equal(ok[0].response.result, 'fresh');
});

test('A LIVE COPY ANSWERS THE WORKER\'S PING', () => {
  const rt = liveRuntime();
  load({ runtime: rt });
  let answered;
  for (const fn of rt.onMsg) fn({ type: 'SIDECAR_PING' }, {}, (v) => { answered = v; });
  assert.equal(answered, true);
});

test('"UPDATED" IS ONLY SAID WHEN THE EXTENSION REALLY WAS', () => {
  const rt = liveRuntime();
  rt.sendMessage = () => { throw new Error('Some other failure'); };
  const sb = load({ runtime: rt });
  sb.send(request('n5'));
  const got = responsesFor(sb, 'n5');
  assert.equal(got.length, 1);
  assert.doesNotMatch(got[0].response.error, /updated/i);
  assert.match(got[0].response.error, /Some other failure/);
});

test('THE WORKER RE-INJECTS AFTER A RESTART, ONCE, AND ONLY WHERE NOTHING ANSWERS', () => {
  assert.ok(manifest.permissions.includes('scripting'), 'executeScript needs the scripting permission');
  const fn = background.slice(background.indexOf('async function reconnectOpenTabs('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /chrome\.storage\.session/, 'the marker must reset on exactly the restarts that cut tabs off');
  assert.match(body, /SIDECAR_PING/, 'a tab with a live copy must be left alone');
  assert.match(body, /files: \['content\.js'\]/);
  assert.doesNotMatch(body, /nostr-provider\.js/, 'the page provider survives a restart; injecting it again would redefine window.nostr');
  assert.match(background, /\nreconnectOpenTabs\(\)\.catch\(/, 'nothing runs the sweep');
});
