'use strict';

// The idle auto-lock can fire while an approval card sits unanswered — one queued
// while the keystore was unlocked, so it has no PIN field. Approved as-is, the request
// reached the sign and died on requireUnlocked(): the page heard "Keystore is locked",
// nothing signed, and the only way out was detouring into the panel to unlock. The fix
// re-marks the queued entries on lock, and the showing card re-renders with its PIN
// field so the approval unlocks inline.
//
// The worker half runs the real markPendingUnlocks against a real queue. The panel and
// popup halves are DOM inside closures with no DOM in node, so their wiring is pinned
// the same way test/sent-zap-label.test.js pins txRow's.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const vm = require('node:vm');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const prompt = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');

function lift(src, decl) {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

// The real queue shape, and the one dependency markPendingUnlocks consults. The stub
// mirrors signer.js's needsPrivateKey exactly (no key material for getPublicKey and
// getRelays); the branch below pins that the code asks the signer, not its own list.
function worker(entries) {
  const queue = entries.map((e, i) => ({
    id: 'q' + i,
    method: e.method || 'signEvent',
    scope: e.scope || 'nostr',
    state: e.state || 'queued',
    display: 'none',
    data: e.data === null ? null : Object.assign({ host: 'site.example', needUnlock: false }, e.data),
  }));
  const counts = { persisted: 0, broadcast: 0 };
  const ctx = vm.createContext({
    queue,
    counts,
    SIGNER: { needsPrivateKey: (m) => m !== 'getPublicKey' && m !== 'getRelays' },
    qPersist() { counts.persisted++; },
    broadcastQueue() { counts.broadcast++; },
  });
  vm.runInContext(lift(bg, 'function markPendingUnlocks(') + '\nthis.mark = markPendingUnlocks;', ctx);
  return { ctx, queue, counts };
}

test('a card queued while unlocked is re-marked, once, with one broadcast', () => {
  const w = worker([{ method: 'signEvent' }, { method: 'signEvent' }, { method: 'signEvent' }]);
  w.ctx.mark();
  for (const e of w.queue) assert.equal(e.data.needUnlock, true, e.id + ' still PIN-less');
  assert.equal(w.counts.persisted, 1, 'the queue is persisted once, not per entry');
  assert.equal(w.counts.broadcast, 1, 'the surfaces are told once');
});

test('a card that needs no key material stays PIN-less', () => {
  // Answering a getPublicKey or getRelays never touches the keystore, so demanding a
  // PIN there would be the over-asking this fix exists to remove.
  const w = worker([{ method: 'getPublicKey' }, { method: 'getRelays' }]);
  w.ctx.mark();
  for (const e of w.queue) assert.equal(e.data.needUnlock, false, e.method + ' must not ask for a PIN');
  assert.equal(w.counts.persisted, 0, 'nothing changed, so nothing was written');
  assert.equal(w.counts.broadcast, 0);
});

test('a payment card is re-marked too', () => {
  // The payment path throws on a locked keystore of its own, so its card asks as well.
  const w = worker([{ method: 'webln.sendPayment', scope: 'webln' }]);
  w.ctx.mark();
  assert.equal(w.queue[0].data.needUnlock, true);
});

test('a card already asking for the PIN is left alone', () => {
  const w = worker([{ method: 'signEvent', data: { needUnlock: true } }]);
  w.ctx.mark();
  assert.equal(w.queue[0].data.needUnlock, true);
  assert.equal(w.counts.broadcast, 0, 'an already-marked card re-renders nothing');
});

test('an interrupted tombstone is skipped, not thrown on', () => {
  const w = worker([{ method: 'signEvent', data: null, state: 'interrupted' }]);
  w.ctx.mark();
  assert.equal(w.queue[0].data, null, 'tombstones carry no data to mark');
  assert.equal(w.counts.persisted, 0);
});

test('the gate consults the signer and the webln scope, and the lock runs it', () => {
  const fn = lift(bg, 'function markPendingUnlocks(');
  assert.match(fn, /if \(e\.scope !== 'webln' && !SIGNER\.needsPrivateKey\(e\.method\)\) continue;/);
  const lock = lift(bg, 'async function lockKeystore(');
  assert.match(lock, /markPendingUnlocks\(\);/, 'the lock must re-mark the pending cards');
});

test('the panel re-renders a showing card whose entry was re-marked', () => {
  // syncApprovalOverlay used to treat an unchanged head as "nothing to do" — the card
  // stayed PIN-less and the approval failed at the sign. It must follow the entry.
  const fn = lift(panel, 'async function syncApprovalOverlay(');
  assert.match(fn, /head\.data\.needUnlock !== pendingApproval\.data\.needUnlock/);
  assert.match(fn, /pendingApproval\.data = head\.data;\s*\n\s*showApproval\(\);/);
});

// The popup's lock handler, run against a stub worker that answers SIDECAR_GET_PROMPT_DATA
// with `fresh` (the entry as markPendingUnlocks left it) and a card showing `data`.
async function popupOnLock(data, fresh, msg = { type: 'SIDECAR_EVENT', event: 'locked', auto: true }) {
  const hidden = new Set(['unlock']);
  const asked = [];
  const ctx = vm.createContext({
    data,
    promptId: 'q0',
    els: { unlock: { classList: { remove: (c) => c === 'hidden' && hidden.delete('unlock') } }, pin: { focus() {} } },
    setTimeout: () => {},
    send: async (m) => { asked.push(m); if (fresh instanceof Error) throw fresh; return fresh; },
  });
  vm.runInContext(lift(prompt, 'async function onLockedWhileShowing(') + '\nthis.onLock = onLockedWhileShowing;', ctx);
  await ctx.onLock(msg);
  return { pinShown: !hidden.has('unlock'), needUnlock: data.needUnlock, asked };
}

test('the popup shows the PIN field when the worker re-marked its entry', async () => {
  // The popup is a one-shot view of one entry; it never sees the queue broadcast, so
  // it has to hear the lock itself. decide() gates on data.needUnlock, so the flip is
  // what makes the next Approve unlock instead of fail.
  const r = await popupOnLock({ method: 'signEvent', needUnlock: false }, { ok: true, data: { method: 'signEvent', needUnlock: true } });
  // JSON, because the message is built inside the vm context and carries its Object.
  assert.equal(JSON.stringify(r.asked), JSON.stringify([{ type: 'SIDECAR_GET_PROMPT_DATA', id: 'q0' }]), 'the worker is asked, by this card\'s id');
  assert.equal(r.needUnlock, true);
  assert.equal(r.pinShown, true);
});

test('the popup keeps a login card PIN-less when the worker did not mark it', async () => {
  // The first cut flipped every card on the lock, so a getPublicKey card demanded a PIN
  // and refused Approve without one. The worker is the one that knows which methods
  // need the key.
  for (const method of ['getPublicKey', 'getRelays']) {
    const r = await popupOnLock({ method, needUnlock: false }, { ok: true, data: { method, needUnlock: false } });
    assert.equal(r.needUnlock, false, method + ' must not ask for a PIN');
    assert.equal(r.pinShown, false, method + ' must not show the PIN field');
  }
});

test('the popup changes nothing when its entry is gone, the worker is silent, or the event is not a lock', async () => {
  const expired = await popupOnLock({ method: 'signEvent', needUnlock: false }, { ok: false, error: 'Prompt expired' });
  assert.equal(expired.pinShown, false);
  const silent = await popupOnLock({ method: 'signEvent', needUnlock: false }, new Error('did not respond'));
  assert.equal(silent.pinShown, false);
  const other = await popupOnLock({ method: 'signEvent', needUnlock: false }, { ok: true, data: { needUnlock: true } }, { type: 'SIDECAR_EVENT', event: 'unlocked' });
  assert.equal(other.pinShown, false);
  assert.equal(other.asked.length, 0, 'only the lock asks the worker');
});
