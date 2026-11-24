'use strict';

// A mention pill with a word typed straight after it, in the real extension. The pill
// wrote its key and the word with nothing between, `nostr:npub1…challenged`, and since a
// word is made of the same letters as a key, everything that read the text took the word
// for more of the key: the draft came back as one pill named by the whole run, other
// clients would show the same, and the mention's p tag was lost because the run does not
// decode. Now a space goes between them, and a draft already saved joined is read back
// up to where the key's checksum says it ends.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

async function openCompose(x) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  await sleep(500);
  return tab;
}
const storedText = async (x) => {
  const all = (await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })).result || {};
  return Object.values(all).map((d) => (d && d.text) || '').join('\n');
};
async function until(fn, what) {
  for (let i = 0; i < 40; i++) { if (await fn()) return; await sleep(250); }
  throw new Error('timed out: ' + what);
}

test('a word typed straight after a mention is spaced off from it in what is saved', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    const npub = await tab.evaluate(`NostrTools.nip19.npubEncode('${'ab'.repeat(32)}')`);
    await tab.evaluate(`(() => {
      const ed = document.querySelector('.compose-editor');
      ed.innerHTML = '';
      const pill = document.createElement('span');
      pill.className = 'mention-pill'; pill.contentEditable = 'false';
      pill.dataset.bech32 = 'nostr:${npub}'; pill.textContent = '@friend';
      ed.append(pill, document.createTextNode('challenged me'));
      ed.focus();
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await until(async () => (await storedText(x)).includes('challenged'), 'the draft to save');
    const saved = await storedText(x);
    assert.ok(saved.includes(`nostr:${npub} challenged me`), 'saved as: ' + saved);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a draft saved with the word joined comes back as the mention, then the word', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
    const probe = await openCompose(x);
    const npub = await probe.evaluate(`NostrTools.nip19.npubEncode('${'ab'.repeat(32)}')`);
    await probe.close();
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [pk]: { text: `nostr:${npub}challenged me to make a super dark mode`, media: [], savedAt: Date.now() } } });
    const tab = await openCompose(x);
    await until(() => tab.evaluate(`!!document.querySelector('.compose-editor .mention-pill')`), 'the pill');
    const pill = await tab.evaluate(`(() => { const p = document.querySelector('.compose-editor .mention-pill'); return { bech32: p.dataset.bech32, text: p.textContent, next: p.nextSibling && p.nextSibling.textContent }; })()`);
    assert.equal(pill.bech32, `nostr:${npub}`, 'the pill took the word into its key');
    assert.ok(!pill.text.includes('challenged'), 'the pill shows the word: ' + pill.text);
    assert.match(pill.next || '', /^challenged me/, 'the word is not the text after the pill');
    // Saved again, it is saved spaced.
    await tab.evaluate(`document.querySelector('.compose-editor').dispatchEvent(new Event('input', { bubbles: true }))`);
    await until(async () => (await storedText(x)).includes(`${npub} challenged`), 'the respaced draft');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a note already joined still tags the person and the quoted note', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    const got = await tab.evaluate(`(() => {
      const NT = NostrTools;
      const pk = '${'ab'.repeat(32)}', id = '${'cd'.repeat(32)}';
      const content = 'hi nostr:' + NT.nip19.npubEncode(pk) + 'challenged, see nostr:' + NT.nip19.noteEncode(id) + 'thanks';
      return { p: SidecarCore.mentionPTags(content, NT), q: SidecarCore.quoteTags(content, NT).tags };
    })()`);
    assert.deepEqual(got.p, [['p', 'ab'.repeat(32)]]);
    assert.deepEqual(got.q.map((q) => q.slice(0, 2)), [['q', 'cd'.repeat(32)]]);
  } finally { x.close(); }
});

// The way it happens in use: a name typed and picked at the start of a line, then the next
// word typed straight away. Picking left the space there but put the caret in front of it
// (the line-start anchor moved every child of the editor one place on), so the word went
// against the pill. Enter, Tab and a click each pick, in both composers.
for (const PAGE of ['compose', 'panel']) {
  test(`a name picked at the start of a line, then a word: the word comes after the space (${PAGE})`, opts, async (t) => {
    let x;
    try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
    try {
      const now = Math.floor(Date.now() / 1000);
      x.put({ kind: 3, created_at: now - 100, tags: [['p', x.bea]], content: '' }, 'me');
      x.put({ kind: 0, created_at: now - 100, tags: [], content: JSON.stringify({ name: 'Bfgreen' }) }, 'bea');
      await x.reload();
      const ED = PAGE === 'panel' ? '#modal .compose-editor' : '.compose-editor';
      const tab = await x.openPage(`chrome-extension://${x.extId}/${PAGE === 'panel' ? 'sidepanel' : 'compose'}.html`);
      if (PAGE === 'panel') {
        await tab.viewport({ width: 380, height: 820, scale: 1 });
        await until(() => tab.evaluate(`!!document.getElementById('compose-fab')`), 'the panel');
        await sleep(800);
        await tab.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
        await tab.evaluate(`document.getElementById('compose-note-btn').click()`); await sleep(800);
      }
      await until(() => tab.evaluate(`!!document.querySelector('${ED}') && !document.documentElement.classList.contains('compose-booting')`), 'the editor');
      await sleep(600);
      const shown = `document.querySelector('${ED}').innerHTML.replace(/\\u200B/g, '').replace(/<span[^>]*>(@[^<]*)<\\/span>/g, '[$1]').replace(/&nbsp;/g, ' ')`;
      for (const how of ['Enter', 'Tab', 'click']) {
        await tab.evaluate(`(() => { const e = document.querySelector('${ED}'); e.innerHTML = ''; e.focus(); })()`);
        for (const ch of '@bfgreen') { await tab.type(ch); await sleep(60); }
        await until(() => tab.evaluate(`[...document.querySelectorAll('.ac-dropdown .ac-item')].some((i) => /Bfgreen/.test(i.textContent))`), 'the suggestion');
        if (how === 'click') {
          const p = await tab.evaluate(`(() => { const it = [...document.querySelectorAll('.ac-dropdown .ac-item')].find((i) => /Bfgreen/.test(i.textContent)); const r = it.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
          await tab.clickAt(p.x, p.y);
        } else await tab.press(how);
        await sleep(300);
        for (const ch of 'challenged') { await tab.type(ch); await sleep(30); }
        await sleep(200);
        assert.equal(await tab.evaluate(shown), '[@Bfgreen] challenged', `picked with ${how}`);
      }
      assert.deepEqual(x.errors, []);
    } finally { x.close(); }
  });
}
