'use strict';

// A POLL HAS A DRAFT OF ITS OWN, in the real extension. The full-size composer's Poll tab used
// to turn a poll on in the note's draft, so the note's words became the poll's question, Note
// asked to be tapped twice to take the poll off, and a note could carry poll options. Now the
// two tabs keep two drafts: moving between them asks nothing and loses nothing, the poll has
// no Remove poll button, and a note never holds a poll.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

const ready = `!!document.querySelector('.compose-editor') && !!window.SidecarLongform && !!window.SidecarComposePublish && !document.documentElement.classList.contains('compose-booting')`;
async function openCompose(x, query) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html${query || ''}`);
  for (let i = 0; i < 60 && !(await tab.evaluate(ready).catch(() => false)); i++) await sleep(250);
  await sleep(500);
  return tab;
}
const tabBtn = (name) => `[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(name)}))`;
const click = async (tab, name) => { await tab.evaluate(`${tabBtn(name)}.click()`); await sleep(600); };
const typeText = (text) => `(() => { const e = document.querySelector('#compose-slot .compose-editor'); e.focus(); document.execCommand('insertText', false, ${JSON.stringify(text)}); })()`;
const editorText = `document.querySelector('#compose-slot .compose-editor').textContent`;
const options = `[...document.querySelectorAll('.poll-editor .poll-option-input')].map((i) => i.value)`;
const fillOption = (i, v) => `(() => { const el = document.querySelectorAll('.poll-editor .poll-option-input')[${i}]; el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const screen = `({
  lit: [...document.querySelectorAll('.compose-mode.active')].map((b) => b.textContent.trim()),
  poll: !document.querySelector('.poll-editor').classList.contains('hidden'),
  remove: !!document.querySelector('.poll-editor .poll-remove'),
  err: document.getElementById('compose-err').textContent,
})`;
const drafts = async (x) => (await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })).result || {};

test('Note and Poll keep a draft each, and moving between them asks nothing', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
    const tab = await openCompose(x);

    await tab.evaluate(typeText('A note in progress'));
    await click(tab, 'Poll');
    // The poll opens on its own draft: an empty question, two empty options, and no button
    // to remove it, since Note is the way out.
    assert.equal(await tab.evaluate(editorText), '');
    assert.deepEqual(await tab.evaluate(screen), { lit: ['Poll'], poll: true, remove: false, err: '' });
    assert.deepEqual(await tab.evaluate(options), ['', '']);
    await tab.evaluate(typeText('Tea or coffee?'));
    await tab.evaluate(fillOption(0, 'Tea'));
    await tab.evaluate(fillOption(1, 'Coffee'));

    // One tap on Note, nothing asked: the note comes back as it was, with no poll.
    await click(tab, 'Note');
    assert.deepEqual(await tab.evaluate(screen), { lit: ['Note'], poll: false, remove: false, err: '' });
    assert.equal(await tab.evaluate(editorText), 'A note in progress');

    // Two drafts in the store, and the note's has no poll in it.
    const all = await drafts(x);
    assert.equal(all[pk].text, 'A note in progress');
    assert.equal('poll' in all[pk], false, 'the note carries a poll');
    assert.equal(all[pk + '|p'].text, 'Tea or coffee?');
    assert.deepEqual(all[pk + '|p'].poll.options, ['Tea', 'Coffee']);

    // And back to the poll, as it was left.
    await click(tab, 'Poll');
    assert.equal(await tab.evaluate(editorText), 'Tea or coffee?');
    assert.deepEqual(await tab.evaluate(options), ['Tea', 'Coffee']);

    // A reload stays on the poll: the address names its slot.
    await tab.evaluate('location.reload()');
    await sleep(1500);
    for (let i = 0; i < 60 && !(await tab.evaluate(ready).catch(() => false)); i++) await sleep(250);
    await sleep(500);
    assert.deepEqual(await tab.evaluate(screen), { lit: ['Poll'], poll: true, remove: false, err: '' });
    assert.equal(await tab.evaluate(editorText), 'Tea or coffee?');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a note saved with a poll in it, from before, becomes the poll draft', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
    const poll = { options: ['Yes', 'No'], multiple: false, ends: { kind: 'in', secs: 86400 } };
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [pk]: { text: 'Is it Friday?', media: [], poll, savedAt: Date.now() } } });
    const tab = await openCompose(x);
    // It opens where it was being written, the Poll tab, whole.
    assert.deepEqual(await tab.evaluate(screen), { lit: ['Poll'], poll: true, remove: false, err: '' });
    assert.equal(await tab.evaluate(editorText), 'Is it Friday?');
    assert.deepEqual(await tab.evaluate(options), ['Yes', 'No']);
    const all = await drafts(x);
    assert.equal(all[pk], undefined, 'the note slot still holds the poll');
    assert.deepEqual(all[pk + '|p'].poll.options, ['Yes', 'No']);
    // And the Note tab is an empty note.
    await click(tab, 'Note');
    assert.deepEqual(await tab.evaluate(screen), { lit: ['Note'], poll: false, remove: false, err: '' });
    assert.equal(await tab.evaluate(editorText), '');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the panel lists the poll draft, and opens it in the full-size composer\'s Poll tab', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
    const poll = { options: ['Tea', 'Coffee'], multiple: false, ends: { kind: 'in', secs: 86400 } };
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: {
      [pk]: { text: 'A note', media: [], savedAt: Date.now() },
      [pk + '|p']: { text: 'Tea or coffee?', media: [], poll, savedAt: Date.now() },
    } });
    await x.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await x.evaluate(`document.getElementById('compose-note-btn').click()`);
    await x.waitFor(`[...document.querySelectorAll('#modal button')].some((b) => b.textContent === 'Resume draft')`);
    await x.evaluate(`[...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Resume draft').click()`);
    await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden)')`);
    // The panel's note is the note alone.
    assert.equal(await x.evaluate(`document.querySelector('#modal .compose-editor').textContent`), 'A note');
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .poll-editor:not(.hidden)')`), false);
    await x.evaluate(`document.querySelector('#modal .compose-drafts-btn').click()`);
    const pollRow = `[...document.querySelectorAll('#modal .saved-draft')].find((r) => r.querySelector('.saved-draft-label').textContent === 'Your poll')`;
    await x.waitFor(`!!${pollRow}`);
    await x.recordTabs();
    await x.evaluate(`${pollRow}.querySelector('.saved-draft-open').click()`);
    await sleep(800);
    const created = (await x.calls()).filter((c) => c.call === 'create');
    assert.ok(created.some((c) => /compose\.html#poll$/.test(c.args[0].url)), 'the poll did not open in the full-size composer: ' + JSON.stringify(created));
    // That address opens on the Poll tab, with the poll's draft, and keeps ?poll for a reload.
    const tab = await openCompose(x, '#poll');
    assert.deepEqual(await tab.evaluate(screen), { lit: ['Poll'], poll: true, remove: false, err: '' });
    assert.equal(await tab.evaluate(editorText), 'Tea or coffee?');
    assert.equal(await tab.evaluate(`location.search + location.hash`), '?poll');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
