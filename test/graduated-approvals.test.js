'use strict';

// The graduated approval card. A sign card asks one question, "may this happen?", with
// Sign and Reject and nothing else: no scope row, no Trust, a button that always says Sign.
// The second question, "should it stop asking?", is earned: once the same site has asked
// the same account for the same KIND a few times this session, the next card for that kind
// grows one row offering the standing kind grant ("Always sign"), or on a shared-identity
// card the 30-minute window. Only kinds that can carry a grant ever take part.
//
// The scope row this replaced offered Once / 30 min / Always on every sign card beside a
// Trust button, and the grant was only saved when the decision was 'once', so choosing
// Always and then pressing the bigger Trust button lost it.
//
// What runs here is the real code, lifted out of background.js, sidepanel.js and prompt.js:
// the tally against a chrome.storage.session mock, the eligibility expressions against the
// real kind-grants.js and relax-grants.js, the batch handler, and both surfaces' row
// renderers against a small fake DOM. The full click path is in
// graduated-approvals.browser.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const bgSrc = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const panelSrc = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const promptSrc = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
const noComments = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// A whole function (or block), by brace depth from where `decl` starts.
function liftFrom(src, decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}
const liftBg = (decl) => liftFrom(bgSrc, decl);

const HOST = 'jank.example';
const OTHER_HOST = 'coracle.example';
const PK = 'a'.repeat(64);
const PK2 = 'b'.repeat(64);
const REACTION = 7;
const NOTE = 1;

// ---- the tally, against session storage ------------------------------------------

function worker() {
  // structuredClone on get/set, as real chrome.storage does. There is no storage.local:
  // the tally must live in session storage (it survives worker eviction, dies with the
  // browser), and touching local here throws.
  const store = {};
  const chrome = {
    storage: {
      session: {
        get: (keys, cb) => {
          const out = {};
          for (const k of (typeof keys === 'string' ? [keys] : keys)) if (k in store) out[k] = structuredClone(store[k]);
          cb(out);
        },
        set: (obj, cb) => {
          for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v);
          if (cb) cb();
        },
      },
      get local() { throw new Error('the approval tally touched chrome.storage.local'); },
    },
  };
  const ctx = vm.createContext({ chrome, structuredClone });
  vm.runInContext([
    bgSrc.match(/const APPROVE_NUDGE_AFTER = \d+;/)[0],
    bgSrc.match(/const APPROVE_COUNT_KEY = '[^']+';/)[0],
    ...['function sgetSession(', 'function ssetSession(', 'function approveCountKey(',
      'async function approveCountMap(', 'async function approveCount(', 'async function bumpApproveCount(',
      'async function shouldNudgeTrust(', 'async function clearApproveCount(', 'async function graduatedOfferFor(',
      'function kindGrantWanted(', 'async function recordApprovalTally('].map(liftBg),
    'this.api = { AFTER: APPROVE_NUDGE_AFTER, approveCount, shouldNudgeTrust, clearApproveCount, graduatedOfferFor, recordApprovalTally };',
  ].join('\n'), ctx);
  const api = ctx.api;
  // One decided sign card for (host, account, kind), as handleNostrRpc records it.
  api.sign = (decision, { host = HOST, pk = PK, kind = REACTION, graduated = true } = {}) =>
    api.recordApprovalTally('signEvent', decision, host, pk, kind, graduated);
  api.offer = ({ host = HOST, pk = PK, kind = REACTION, eligible = true, shared = false } = {}) =>
    api.graduatedOfferFor(eligible, host, pk, kind, shared);
  api.store = store;
  return api;
}

test('the offer appears exactly at the threshold, and not one card before', async () => {
  const w = worker();
  assert.equal(w.AFTER, 3);
  for (let i = 1; i < w.AFTER; i++) {
    await w.sign({ action: 'once' });
    assert.equal(await w.offer(), null, 'offered after only ' + i);
  }
  await w.sign({ action: 'once' });
  assert.deepEqual(JSON.parse(JSON.stringify(await w.offer())), { mode: 'always', count: 3 });
});

test('it is keyed host + account + kind: nothing else borrows the count', async () => {
  const w = worker();
  for (let i = 0; i < 3; i++) await w.sign({ action: 'once' });
  assert.ok(await w.offer());
  assert.equal(await w.offer({ kind: NOTE }), null, 'another kind starts fresh');
  assert.equal(await w.offer({ host: OTHER_HOST }), null, 'another site starts fresh');
  assert.equal(await w.offer({ pk: PK2 }), null, 'another account starts fresh');
  // Three approvals spread over three kinds are not three of one.
  const v = worker();
  for (const kind of [REACTION, NOTE, 1111]) await v.sign({ action: 'once' }, { kind });
  for (const kind of [REACTION, NOTE, 1111]) assert.equal(await v.offer({ kind }), null);
});

test('a shared-identity card is offered the 30-minute window instead of the grant', async () => {
  const w = worker();
  for (let i = 0; i < 3; i++) await w.sign({ action: 'once' });
  assert.equal((await w.offer({ shared: true })).mode, 'relax');
  assert.equal((await w.offer({ shared: false })).mode, 'always');
});

test('a card that cannot carry the row never shows it and never counts', async () => {
  const w = worker();
  for (let i = 0; i < 5; i++) await w.sign({ action: 'once' }, { kind: 9734, graduated: false });
  assert.equal(await w.approveCount(HOST, PK, 9734), 0, 'an ineligible kind accumulated a tally');
  assert.deepEqual(w.store, {}, 'and wrote nothing at all');
  for (let i = 0; i < 3; i++) await w.sign({ action: 'once' });
  assert.equal(await w.offer({ eligible: false }), null, 'an ineligible card never offers, whatever the count');
});

test('taking the offer saves nothing here but settles the count: Always sign and the window both clear it', async () => {
  for (const decision of [{ action: 'once', alwaysKind: true }, { action: 'relax', relaxMs: 1800000 }]) {
    const w = worker();
    for (let i = 0; i < 3; i++) await w.sign({ action: 'once' });
    await w.sign(decision);
    assert.equal(await w.approveCount(HOST, PK, REACTION), 0, JSON.stringify(decision) + ' left the count standing');
    assert.equal(await w.offer(), null);
  }
});

test('“Not now” starts the count over, whether the card is then signed or rejected', async () => {
  for (const action of ['once', 'reject']) {
    const w = worker();
    for (let i = 0; i < 4; i++) await w.sign({ action: 'once' });
    await w.sign({ action, declineGraduated: true });
    assert.equal(await w.approveCount(HOST, PK, REACTION), 0, 'Not now + ' + action);
    // And the row comes back only after another full three.
    for (let i = 0; i < 2; i++) await w.sign({ action: 'once' });
    assert.equal(await w.offer(), null);
    await w.sign({ action: 'once' });
    assert.ok(await w.offer());
  }
});

test('ignoring the row and pressing Sign keeps it coming; a plain Reject counts for nothing', async () => {
  const w = worker();
  for (let i = 0; i < 3; i++) await w.sign({ action: 'once' });
  await w.sign({ action: 'reject' });
  assert.equal(await w.approveCount(HOST, PK, REACTION), 3);
  await w.sign({ action: 'once' });
  assert.equal((await w.offer()).count, 4);
});

test('a settle that is not its own approval is never counted', async () => {
  const w = worker();
  for (let i = 0; i < 5; i++) await w.sign({ action: 'once', uncounted: true });
  assert.equal(await w.approveCount(HOST, PK, REACTION), 0);
});

test('sign tallies and the Trust nudge never feed each other', async () => {
  const w = worker();
  for (let i = 0; i < 5; i++) await w.sign({ action: 'once' });
  assert.equal(await w.shouldNudgeTrust(HOST, PK), false, 'Trust is not on a sign card to point at');
  for (let i = 0; i < 3; i++) await w.recordApprovalTally('nip44.decrypt', { action: 'once' }, HOST, PK, null, false);
  assert.equal(await w.shouldNudgeTrust(HOST, PK), true, 'decrypt cards keep the nudge');
  assert.equal(await w.approveCount(HOST, PK, REACTION), 5, 'and leave the kind count alone');
  // A coalesced login is the same one approval, as before.
  const v = worker();
  for (let i = 0; i < 5; i++) await v.recordApprovalTally('getPublicKey', { action: 'once', coalesced: true }, HOST, PK, null, false);
  assert.equal(await v.shouldNudgeTrust(HOST, PK), false);
});

test('Trust or Block clears the pair and every kind under it; one kind clears only itself', async () => {
  const w = worker();
  for (const kind of [REACTION, NOTE]) for (let i = 0; i < 3; i++) await w.sign({ action: 'once' }, { kind });
  for (let i = 0; i < 3; i++) await w.sign({ action: 'once' }, { host: OTHER_HOST });
  await w.clearApproveCount(HOST, PK, REACTION);
  assert.equal(await w.approveCount(HOST, PK, REACTION), 0);
  assert.equal(await w.approveCount(HOST, PK, NOTE), 3);
  await w.clearApproveCount(HOST, PK);
  assert.equal(await w.approveCount(HOST, PK, NOTE), 0);
  assert.equal(await w.approveCount(OTHER_HOST, PK, REACTION), 3, 'another site keeps its count');
  // A host that merely starts with this one is not under it.
  for (let i = 0; i < 3; i++) await w.sign({ action: 'once' }, { host: HOST + '.evil' });
  await w.clearApproveCount(HOST, PK);
  assert.equal(await w.approveCount(HOST + '.evil', PK, REACTION), 3);
});

test('THE TALLY STAYS SESSION-SCOPED', () => {
  // Every read and write of the tally goes through the session helpers; a Map would reset
  // on every worker eviction (the first cut never fired), and local storage would keep a
  // record of which sites someone uses across browser restarts.
  const code = noComments(bgSrc);
  for (const fn of ['approveCountMap', 'bumpApproveCount', 'clearApproveCount']) {
    const body = liftBg('async function ' + fn + '(');
    assert.doesNotMatch(body, /chrome\.storage\.local|new Map/, fn + ' left session storage');
  }
  assert.match(liftBg('function sgetSession('), /chrome\.storage\.session\.get/);
  assert.match(liftBg('function ssetSession('), /chrome\.storage\.session\.set/);
  // And no line touches the key except through them (or to declare it).
  for (const line of code.split('\n').filter((l) => l.includes('APPROVE_COUNT_KEY'))) {
    assert.ok(/^const APPROVE_COUNT_KEY = |sgetSession\(APPROVE_COUNT_KEY\)|ssetSession\(\{ \[APPROVE_COUNT_KEY\]/.test(line.trim()),
      'the tally is reached another way: ' + line.trim());
  }
});

// ---- eligibility: the real expressions, the real modules ------------------------

function eligibility() {
  const store = {};
  const area = {
    get: (k, cb) => cb({}), set: (o, cb) => { Object.assign(store, o); if (cb) cb(); },
    remove: (k, cb) => cb && cb(),
  };
  const ctx = vm.createContext({ chrome: { storage: { local: area, session: area } }, console });
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'kind-grants.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'relax-grants.js'), 'utf8'), ctx);
  const grab = (re, label) => { const m = bgSrc.match(re); assert.ok(m, label + ' is gone'); return m[0]; };
  const body = [
    grab(/const isContentSign =[\s\S]*?;/, 'isContentSign'),
    grab(/const relaxEligible = [^;]*;/, 'relaxEligible'),
    grab(/const kindGrantEligible = [\s\S]*?;/, 'kindGrantEligible'),
    grab(/const graduatedCapable = [^;]*;/, 'graduatedCapable'),
    'return graduatedCapable;',
  ].join('\n');
  vm.runInContext('this.KINDS = SidecarKindGrants; this.RELAX = SidecarRelax;', ctx);
  return (method, signKind, { destructive = null, isRelayAuth = false, sharedHost = false } = {}) =>
    vm.runInContext(`(function (method, signKind, destructive, isRelayAuth, sharedHost) {\n${body}\n})`, ctx)(method, signKind, destructive, isRelayAuth, sharedHost);
}

test('the offer reaches the ordinary content kinds', () => {
  const eligible = eligibility();
  for (const kind of [1, 6, 7, 9, 14, 16, 1068, 1111, 1311, 9802, 30023, 30078]) {
    assert.equal(eligible('signEvent', kind), true, 'kind ' + kind + ' should be able to earn the row');
  }
});

test('ELIGIBILITY IS THE GRANT’S OWN: no row on kinds that can never carry a grant', () => {
  const eligible = eligibility();
  const never = {
    0: 'profile', 3: 'follow list', 10000: 'mute list', 10002: 'relay list', 10040: 'trust providers',
    10050: 'DM relays', 5: 'deletion', 9734: 'zap request', 22242: 'relay auth (malformed)',
    24133: 'remote signing', 23194: 'wallet request', 23195: 'wallet response',
  };
  for (const [kind, name] of Object.entries(never)) {
    assert.equal(eligible('signEvent', Number(kind)), false, name + ' offered the row');
  }
  assert.equal(eligible('signEvent', 1, { destructive: { message: 'wipe' } }), false, 'a destructive overwrite');
  assert.equal(eligible('signEvent', 22242, { isRelayAuth: true }), false, 'well-formed relay auth');
  for (const method of ['nip04.encrypt', 'nip44.encrypt', 'nip44.decrypt', 'getPublicKey']) {
    assert.equal(eligible(method, null), false, method + ' is not a sign card');
  }
});

test('ON A SHARED HOST THE ROW IS THE WINDOW: the relax rules apply, not the grant\u2019s', () => {
  const eligible = eligibility();
  // On a host with 2+ accounts the row offers the 30-minute window, whose own rule is
  // relax eligibility: wallet control and zap requests still never relax, while kinds
  // that can carry a grant keep earning it exactly as on a one-account host.
  for (const kind of [1, 7, 1068, 1111]) {
    assert.equal(eligible('signEvent', kind, { sharedHost: true }), true, 'kind ' + kind + ' should earn the window');
  }
  assert.equal(eligible('signEvent', 23194, { sharedHost: true }), false, 'wallet control offered the window');
  assert.equal(eligible('signEvent', 9734, { sharedHost: true }), true,
    'a zap request rides the window, as relax always has: the payment itself still asks');
  assert.equal(eligible('signEvent', 1, { sharedHost: true, destructive: { message: 'wipe' } }), false, 'a destructive overwrite');
  assert.equal(eligible('nip44.encrypt', null, { sharedHost: true }), false, 'an encrypt offered the window');
});

test('THE QUIET SHORTCUT: the hint rides the background, and opens the same window', () => {
  const code = noComments(bgSrc);
  // Asks 2 and 3 only: count >= 1, and the UIs hide it once the earned row is up.
  assert.match(code, /relaxHint: !!\(graduatedCapable && needApproval &&/);
  assert.match(code, /\(await approveCount\(host, activePubkey, signKind\)\) >= 1\)/);
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const popup = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
  assert.match(panel, /data\.relaxHint && !payment && groupN === 1 && !data\.graduatedOffer/);
  assert.match(popup, /data\.relaxHint && !data\.graduatedOffer/);
  assert.match(panel, /hint\.onclick = \(\) => decideApproval\('relax', \{ relaxMs: 30 \* 60000 \}\);/);
  assert.match(popup, /els\.relaxHint\.addEventListener\('click', \(\) => decide\('relax', \{ relaxMs: 30 \* 60000 \}\)\);/);
});

test('THE MOMENT-CUE: opening a window announces itself to the panel', () => {
  const code = noComments(bgSrc);
  assert.match(code, /event: 'relaxStarted',\n          host, name: \(who && who\.name\) \|\| ''/);
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  assert.match(panel, /msg\.event === 'relaxStarted'/);
  assert.match(panel, /Signing for \{\{host\}\} as \{\{name\}\} without asking for 30 minutes\./);
});

test('the background hands the row only to a card that asks, and the grant handler is unchanged', () => {
  const code = noComments(bgSrc);
  // The offer mode keys on the HOST having 2+ accounts, never on the card's own
  // shared-identity flag: a client naming the author skips that confirm, and an Always
  // offer on such a card would let a shared client earn a permanent identity grant.
  assert.match(code, /graduatedOffer: await graduatedOfferFor\(graduatedCapable && needApproval, host, activePubkey, signKind, sharedHost\)/);
  assert.match(code, /canKindGrant: kindGrantEligible && !destructive && !sharedIdentity && !sharedHost,/);
  assert.match(code, /if \(kindGrantWanted\(decision\) && kindGrantEligible && !destructive && !sharedHost\) \{\s*await KINDS\.grant\(host, activePubkey, signKind, signDTag\);/);
  // Both the reject path and the decided path record the card, with the same eligibility.
  assert.equal((code.match(/await recordApprovalTally\(method, decision, host, activePubkey, signKind, graduatedCapable && needApproval\);/g) || []).length, 2);
});

// ---- the sweep and the batch: one card, one approval ------------------------------

test('siblings swept by a fresh grant settle as the one approval they are', () => {
  const code = noComments(bgSrc);
  assert.match(code, /const swept = KINDS\.matchTargets\(queue, host, activePubkey, signKind, signDTag\);\s*for \(const id of swept\) settlePrompt\(id, 'once', \{ uncounted: true \}\);/);
  // And the flag reaches the decision each sibling's handleNostrRpc reads: settlePrompt
  // resolves with Object.assign({ action }, extra).
  const resolved = [];
  const ctx = vm.createContext({
    callbacks: new Map([['s1', { settled: false, resolve: (d) => resolved.push(d) }]]),
    queue: [], qPersist() {}, DECRYPT_METHODS: new Set(), grantDecrypt() {}, flushDecryptSiblings() {},
    broadcastQueue() {}, dlog() {}, driveDisplay() {}, stopKeepaliveIfIdle() {},
  });
  vm.runInContext(liftBg('function settlePrompt(') + '\nthis.settlePrompt = settlePrompt;', ctx);
  ctx.settlePrompt('s1', 'once', { uncounted: true });
  assert.equal(resolved[0].uncounted, true);
  assert.equal(resolved[0].action, 'once');
});

test('a batch card counts once: its first member carries the decision, the rest are uncounted', async () => {
  const handler = liftBg("if (message.type === 'SIDECAR_PROMPT_RESULT_BATCH') {");
  const settled = [];
  const run = new Function('message', 'sendResponse', 'settlePrompt', handler + '\nreturn undefined;');
  run({ type: 'SIDECAR_PROMPT_RESULT_BATCH', ids: ['a', 'b', 'c'], action: 'once', extra: { switchToPubkey: PK2 } },
    () => {}, (id, action, extra) => settled.push({ id, action, extra }));
  assert.deepEqual(settled.map((s) => s.id), ['a', 'b', 'c']);
  assert.ok(settled.every((s) => s.action === 'once' && s.extra.switchToPubkey === PK2), 'every member keeps the decision');
  assert.equal(settled[0].extra.uncounted, undefined);
  assert.ok(settled.slice(1).every((s) => s.extra.uncounted === true));
  // Through the real tally: three signed in one batch are one approval.
  const w = worker();
  for (const s of settled) await w.sign(Object.assign({ action: s.action }, s.extra));
  assert.equal(await w.approveCount(HOST, PK, REACTION), 1);
});

test('a request re-collapsed into a relax window that opened while it waited is not counted', () => {
  assert.match(noComments(bgSrc), /\(await RELAX\.has\(head\.host, head\.data\.activePubkey\)\)\) \{\s*settlePrompt\(head\.id, 'once', \{ uncounted: true \}\);/);
});

// ---- the cards ----------------------------------------------------------------------

function fakeEl() {
  const classes = new Set();
  return {
    textContent: '', onclick: null, disabled: false,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : !!on; if (want) classes.add(c); else classes.delete(c); return want; },
    },
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  };
}

const i18nFakes = {
  t: (k, p) => k.replace(/\{\{(\w+)\}\}/g, (_, n) => (p && n in p ? p[n] : '{{' + n + '}}')),
  tn: (one, other, n, p) => (n === 1 ? one : other).replace(/\{\{(\w+)\}\}/g, (_, k) => (k === 'count' ? String(n) : p[k])),
  I18N: { fmtNum: String },
};
i18nFakes.tSec = i18nFakes.t;

function panelCard() {
  const els = {};
  const $ = (id) => (els[id] = els[id] || fakeEl());
  const decided = [];
  const ctx = vm.createContext(Object.assign({
    $, els, decided,
    show: (e) => e.classList.remove('hidden'),
    hide: (e) => e.classList.add('hidden'),
    approvalKindLabels: () => ({ 7: 'Reaction', 1: 'Note' }),
    decideApproval: (action, opts) => decided.push([action, opts]),
    pendingApproval: { id: 'p1' },
  }, i18nFakes));
  vm.runInContext(liftFrom(panelSrc, 'function renderGraduated(') + '\nthis.render = renderGraduated;', ctx);
  return ctx;
}

const signCard = (over) => Object.assign({
  method: 'signEvent', host: HOST, needApproval: true, canKindGrant: true, kindDTag: null,
  params: { event: { kind: REACTION, content: '+', tags: [] } },
  graduatedOffer: { mode: 'always', count: 3 },
}, over);

test('panel: the row says what happened and what Always does, and Always sign saves the grant with this signature', () => {
  const c = panelCard();
  c.render(signCard(), false, 1);
  const row = c.els['approval-graduated'];
  assert.equal(row.classList.contains('hidden'), false);
  assert.equal(c.els['approval-graduated-msg'].textContent, "You've signed " + HOST + ' 3 times in a row.');
  assert.equal(c.els['approval-graduated-cap'].textContent, 'Keep signing future Reaction events without asking.');
  assert.equal(c.els['approval-graduated-yes'].textContent, 'Always sign');
  c.els['approval-graduated-yes'].onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(c.decided)), [['once', { alwaysKind: true }]]);
});

test('panel: a record-scoped grant says which record', () => {
  const c = panelCard();
  c.render(signCard({ kindDTag: 'settings', params: { event: { kind: 30078, tags: [['d', 'settings']] } } }), false, 1);
  assert.equal(c.els['approval-graduated-cap'].textContent, 'Keep signing future versions of “settings” without asking.');
});

test('panel: on a shared-identity card the row offers the window, and opens it', () => {
  const c = panelCard();
  c.render(signCard({ canKindGrant: false, graduatedOffer: { mode: 'relax', count: 4 }, accountName: 'Zap Cooking' }), false, 1);
  assert.equal(c.els['approval-graduated-yes'].textContent, 'Sign for 30 min');
  assert.equal(c.els['approval-graduated-cap'].textContent, 'Keep signing as Zap Cooking for 30 minutes.');
  c.els['approval-graduated-yes'].onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(c.decided)), [['relax', { relaxMs: 1800000 }]]);
});

test('panel: Not now hides the row for this card and marks the decision', () => {
  const c = panelCard();
  c.render(signCard(), false, 1);
  c.els['approval-graduated-no'].onclick();
  assert.equal(c.els['approval-graduated'].classList.contains('hidden'), true);
  assert.equal(c.pendingApproval.graduatedDeclined, true);
  c.render(signCard(), false, 1); // an incidental re-render must not bring it back
  assert.equal(c.els['approval-graduated'].classList.contains('hidden'), true);
  assert.equal(c.decided.length, 0, 'Not now answers nothing by itself');
  assert.match(noComments(panelSrc), /if \(pendingApproval && pendingApproval\.graduatedDeclined\) \{\s*extra = Object\.assign\(\{\}, extra, \{ declineGraduated: true \}\);/);
});

test('panel: no row without an offer, on a batch, on a payment, on a pure unlock, or for a grant the card cannot save', () => {
  const cases = [
    ['no offer', signCard({ graduatedOffer: null }), false, 1],
    ['batch', signCard(), false, 3],
    ['payment', signCard(), true, 1],
    ['pure unlock', signCard({ needApproval: false }), false, 1],
    ['always without canKindGrant', signCard({ canKindGrant: false }), false, 1],
    ['not a sign', signCard({ method: 'nip44.decrypt' }), false, 1],
  ];
  for (const [name, data, payment, groupN] of cases) {
    const c = panelCard();
    c.$('approval-graduated').classList.remove('hidden'); // left up by a previous card
    c.render(data, payment, groupN);
    assert.equal(c.els['approval-graduated'].classList.contains('hidden'), true, name);
  }
});

function popupCard(data) {
  const els = {
    graduated: fakeEl(), graduatedMsg: fakeEl(), graduatedCap: fakeEl(), graduatedYes: fakeEl(), graduatedNo: fakeEl(),
  };
  const ctx = vm.createContext(Object.assign({
    els, data, isPayment: false, graduatedDeclined: false,
    kindLabels: () => ({ 7: 'Reaction' }),
  }, i18nFakes));
  vm.runInContext(liftFrom(promptSrc, 'function renderGraduated(') + '\nthis.render = renderGraduated;', ctx);
  return ctx;
}

test('popup: the same row, the same words, the same gates', () => {
  const c = popupCard(signCard());
  c.render();
  assert.equal(c.els.graduated.classList.contains('hidden'), false);
  assert.equal(c.els.graduatedMsg.textContent, "You've signed " + HOST + ' 3 times in a row.');
  assert.equal(c.els.graduatedYes.textContent, 'Always sign');
  const r = popupCard(signCard({ canKindGrant: false, graduatedOffer: { mode: 'relax', count: 3 } }));
  r.render();
  assert.equal(r.els.graduatedYes.textContent, 'Sign for 30 min');
  for (const data of [signCard({ graduatedOffer: null }), signCard({ needApproval: false }), signCard({ canKindGrant: false })]) {
    const n = popupCard(data);
    n.render();
    assert.equal(n.els.graduated.classList.contains('hidden'), true);
  }
  const p = popupCard(signCard());
  p.isPayment = true;
  p.render();
  assert.equal(p.els.graduated.classList.contains('hidden'), true, 'payment');
});

test('popup: the row’s buttons answer from the offer, and Not now rides on the decision', () => {
  const code = noComments(promptSrc);
  assert.match(code, /if \(offer\.mode === 'relax'\) decide\('relax', \{ relaxMs: 30 \* 60000 \}\);\s*else decide\('once', \{ alwaysKind: true \}\);/);
  assert.match(code, /if \(data\.canKindGrant && action === 'once' && opts && opts\.alwaysKind === true\)/);
  assert.match(code, /if \(graduatedDeclined\) extra = Object\.assign\(\{\}, extra, \{ declineGraduated: true \}\);/);
  assert.match(code, /els\.allow\.addEventListener\('click', \(\) => decide\('once'\)\);/, 'the Sign button is one answer');
});

test('SIGN CARDS CARRY NO SCOPE ROW AND NO TRUST, on both surfaces', () => {
  const panel = noComments(panelSrc);
  const popup = noComments(promptSrc);
  for (const [name, src] of [['sidepanel.js', panel], ['prompt.js', popup]]) {
    assert.doesNotMatch(src, /scopeRelax|scopeAlways|approval-scope|Sign for 30 min'\) : t\('Sign'\)|t\('Always sign'\)\s*:/, name + ' still drives a scope row');
    assert.doesNotMatch(src, /Allow for 30 min/, name + ' still relabels Allow once for a window');
  }
  assert.match(panel, /if \(data\.method === 'signEvent'\) hide\(trust\);\s*else show\(trust\);/);
  assert.match(popup, /if \(data\.method === 'signEvent'\) els\.trust\.classList\.add\('hidden'\);/);
  // The primary button says Sign on a sign card and is never relabeled by a selection.
  assert.match(panel, /: data\.method === 'signEvent' \? t\('Sign'\) : tSec\('Allow once'\);/);
  assert.match(panel, /\$\('approval-allow'\)\.addEventListener\('click', \(\) => decideApproval\('once'\)\);/);
});

test('the cards that keep Trust keep it: decrypt, payments, pure unlock and shared identity are unchanged', () => {
  const panel = noComments(panelSrc);
  // A decrypt still names what Trust would mean, beside the button.
  assert.match(panel, /Trust this site and it can read your messages without asking, until you revoke\./);
  // Payments: no Trust, the budget box.
  assert.match(panel, /paintApprovalPay\(pendingApproval && pendingApproval\.id, data\);\s*hide\(trust\);\s*show\(remember\);/);
  // A pure unlock: relabeled, no Trust.
  assert.match(panel, /allow\.textContent = t\('Unlock & continue'\);\s*hide\(trust\);/);
  // Shared identity and batches hide it after everything else.
  assert.match(panel, /if \(data\.sharedIdentity\) hide\(trust\);/);
  assert.match(panel, /allow\.textContent = tSec\('Allow all \(\{\{count\}\}\)', \{ count: I18N\.fmtNum\(groupN\) \}\);\s*hide\(trust\);/);
  // And the nudge still renders beside a visible Trust only.
  assert.match(panel, /if \(data\.nudgeTrust && !payment && !trust\.classList\.contains\('hidden'\)\)/);
});
