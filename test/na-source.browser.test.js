'use strict';

// Global name search in Settings, against the REAL extension: a selector for whose relay answers
// (only my follows, my search relays, the default, or one typed in) in place of an on/off
// switch. A relay of the user's choosing is saved only when its address is a wss:// one, and the
// choice is what the page shows after a reload.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timed out');
}

test('the selector saves the source, keeps a typed relay only when it is wss://, and survives a reload', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const stored = () => x.evaluate(`new Promise((r) => chrome.storage.local.get('sidecar_settings', (v) => r((v.sidecar_settings || {})))) `);
    const shown = () => x.evaluate(`(() => ({ value: document.getElementById('na-source').value, custom: !document.getElementById('na-custom').classList.contains('hidden'), hint: document.getElementById('na-hint').textContent }))()`);
    const pick = (value) => x.evaluate(`(() => { const s = document.getElementById('na-source'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const typeRelay = (v) => x.evaluate(`(() => { const i = document.getElementById('na-custom'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const openSettings = () => x.evaluate(`document.getElementById('settings-btn').click()`);

    await openSettings();
    // Nothing chosen and no search relays published: follows only, said plainly.
    let v = await until(async () => { const s = await shown(); return s.hint ? s : null; });
    assert.equal(v.value, 'follows');
    assert.match(v.hint, /follows only/i);

    // The default says what it does.
    await pick('default');
    await until(async () => (await stored()).nameSearch === 'default');
    v = await shown();
    assert.match(v.hint, /Brainstorm’s relay, which sees what you type/);

    // A relay of one's own: nothing is saved until the address is a wss:// one.
    await pick('custom');
    v = await until(async () => { const s = await shown(); return s.custom ? s : null; });
    assert.equal((await stored()).nameSearch, 'default', 'choosing it is not saving it');
    await typeRelay('http://typed.example');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await stored()).nameSearch, 'default');
    assert.match((await shown()).hint, /wss:\/\//);
    await typeRelay('wss://typed.example');
    await until(async () => { const s = await stored(); return s.nameSearch === 'custom' && s.nameSearchRelay === 'wss://typed.example'; });

    // It is what the page shows after a reload.
    await x.reload();
    await openSettings();
    v = await until(async () => { const s = await shown(); return s.hint ? s : null; });
    assert.equal(v.value, 'custom');
    assert.equal(v.custom, true);

    // And back to nothing leaving.
    await pick('follows');
    await until(async () => (await stored()).nameSearch === 'follows');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
