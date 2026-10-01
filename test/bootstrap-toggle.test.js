'use strict';

// "USE BOOTSTRAP RELAYS" IS STORED INVERTED, AND ONLY THE CONTROL KNOWS IT.
//
// The switch under Settings → Relays → Bootstrap relays was "NIP-65 only". It now reads
// the other way round: ON means the bootstrap relays are in use. What is stored did not
// change (nip65OnlyBy, which every relay read and publish consults), so the control is
// the one place the inversion lives. Get it backwards and a privacy setting silently does
// the opposite of what the user chose, with nothing on screen to say so.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.html'), 'utf8');

// The change handler, as written: everything from the listener to its closing `});`.
function handlerSource() {
  const at = src.indexOf("$('bootstrap-toggle').addEventListener('change', async (e) => {");
  assert.notEqual(at, -1, 'the bootstrap switch has no change handler');
  const open = src.indexOf('{', src.indexOf('=>', at));
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1);
  }
  throw new Error('unbalanced handler');
}

function run(checked) {
  const sent = [];
  const dim = { on: null, notifRowHidden: null, refetched: 0 };
  const notifToggle = { checked: null };
  const $ = (id) => {
    if (id === 'relay-section-body') return { classList: { toggle: (cls, v) => { if (cls === 'hidden') dim.on = v; } } };
    if (id === 'notif-bootstrap-row') return { classList: { toggle: (cls, v) => { if (cls === 'hidden') dim.notifRowHidden = v; } } };
    if (id === 'notif-bootstrap-toggle') return notifToggle;
    return null;
  };
  const call = async (msg) => { sent.push(msg); };
  const state = { activePubkey: 'a'.repeat(64) };
  const notifBootstrapFor = async () => true;
  const _notifCache = new Map([[state.activePubkey, { refetch: () => { dim.refetched++; } }]]);
  // eslint-disable-next-line no-new-func
  const handler = new Function('$', 'call', 'state', 'notifBootstrapFor', '_notifCache',
    `return async (e) => ${handlerSource()};`)($, call, state, notifBootstrapFor, _notifCache);
  return handler({ target: { checked } }).then(() => ({ sent, dim: dim.on, notifRowHidden: dim.notifRowHidden, refetched: dim.refetched, notifToggle }));
}

test('SWITCHING BOOTSTRAP RELAYS OFF TURNS NIP-65 ONLY ON', async () => {
  const { sent, dim } = await run(false);
  assert.deepEqual(sent, [{ type: 'SIDECAR_SET_NIP65_ONLY', pubkey: 'a'.repeat(64), on: true }]);
  assert.equal(dim, true, 'and the bootstrap list it no longer uses is hidden');
});

test('switching them back on turns NIP-65 only off', async () => {
  const { sent, dim } = await run(true);
  assert.deepEqual(sent, [{ type: 'SIDECAR_SET_NIP65_ONLY', pubkey: 'a'.repeat(64), on: false }]);
  assert.equal(dim, false);
});

test('the switch is drawn from the stored value, inverted the same way', () => {
  assert.match(src, /\$\('bootstrap-toggle'\)\.checked = !nip65Only;/);
  assert.match(src, /relayBody\.classList\.toggle\('hidden', nip65Only\)/, 'hidden when NIP-65 only is on');
  assert.doesNotMatch(src, /toggle\('dimmed', nip65Only\)/, 'no longer dimmed in place');
});

test('the old control is gone, so nothing can still write it the old way round', () => {
  assert.doesNotMatch(src + html, /nip65-only-toggle/);
  assert.match(html, /<input type="checkbox" id="bootstrap-toggle" \/>/);
  assert.match(html, /Use bootstrap relays/);
});

test('with bootstrap relays off, "Use them for notifications" appears, and on is the default', async () => {
  const off = await run(false);
  assert.equal(off.notifRowHidden, false, 'shown while bootstrap relays are off');
  assert.equal(off.notifToggle.checked, true);
  assert.equal(off.refetched, 1, 'the bell re-reads its relays at once');
  const on = await run(true);
  assert.equal(on.notifRowHidden, true, 'hidden while they are on: it decides nothing then');
  assert.match(html, /<label class="switch-label switch-nested hidden" id="notif-bootstrap-row">/);
  assert.match(html, /<input type="checkbox" id="notif-bootstrap-toggle" checked \/>/);
  assert.match(html, /data-i18n="Use them for notifications">Use them for notifications</);
});

test('the notification switch is stored per account as the accounts that said no', () => {
  const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const at = bg.indexOf("case 'SIDECAR_SET_NOTIF_BOOTSTRAP': {");
  assert.ok(at > 0);
  const body = bg.slice(at, bg.indexOf('break;', at));
  assert.match(body, /if \(message\.on\) delete map\[message\.pubkey\];\s*else map\[message\.pubkey\] = true;/);
  assert.match(body, /notifBootstrapOffBy: map/);
  assert.match(src, /return !\(s && s\.notifBootstrapOffBy && s\.notifBootstrapOffBy\[pubkey\]\);/, 'absent reads as on');
  assert.match(src, /\$\('notif-bootstrap-toggle'\)\.addEventListener\('change', async \(e\) => \{\s*await call\(\{ type: 'SIDECAR_SET_NOTIF_BOOTSTRAP', pubkey: state\.activePubkey, on: e\.target\.checked \}\);/);
});
