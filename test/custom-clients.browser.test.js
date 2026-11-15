'use strict';

// "Your added clients", against the REAL extension: the sheet opens from Settings, a
// pasted link is read live (the line under each field says how the client writes its
// address), Save stays shut until both links read cleanly, the saved client joins the
// picker and opens links in the form it was shown, and removal takes the choice that
// named it along. The unit tests beside this one run the parser and the builder; this
// one runs the path a click takes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

const click = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`;
const text = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.innerText : ''; })()`;
// The sheet's three inputs, in DOM order: name, note link, profile link. Pasting is
// what the user does, so a value plus an input event is the whole gesture.
const fill = (i, v) => `(() => { const e = document.querySelectorAll('#modal input')[${i}]; if (!e) return false; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const ID = '00000021fa819996851be3c1ba8168f88cc89b3cfb848bfab5b485f4c281f344';
const AUTHOR = '460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c';
const NOTE_LINK = `https://notes.example/thread/${ID}`;
// An npub, built where npubs are built, so the test never carries a hand-typed bech32.
const profileLink = (x) => x.evaluate(`'https://notes.example/p/' + window.NostrTools.nip19.npubEncode(${JSON.stringify(AUTHOR)})`);
const saveDisabled = `document.querySelector('#modal .actions .primary').disabled`;

async function openAppsSection(x) {
  assert.ok(await x.evaluate(click('#settings-btn')), 'Settings did not open');
  assert.ok(await x.evaluate(click('[data-section="apps"] .settings-section-toggle')), 'the Apps section did not open');
}

async function withExtension(t, fn, settings = {}) {
  let x;
  try { x = await startExtension({ settings }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    // The panel opened before the account was added, so it does not know one yet; a
    // choice made now would have no account to be filed under. Reopen it, as a person's
    // panel is by the time they are in Settings.
    await x.reload();
    await fn(x);
  } finally { x.close(); }
}

test('a client not on the list can be added from pasted links, chosen, edited, and removed', opts, async (t) => {
  await withExtension(t, async (x) => {
    await openAppsSection(x);
    assert.ok(await x.evaluate(click('#add-client-btn')), 'the sheet did not open');
    assert.equal(await x.evaluate(saveDisabled), true, 'Save is open on an empty sheet');
    assert.equal(await x.evaluate(text('.custom-client-preview')), '', 'an empty field already has something to say');

    // Plain http is refused, and so is a link with no address in it.
    await x.evaluate(fill(0, 'Mine'));
    await x.evaluate(fill(1, `http://notes.example/thread/${ID}`));
    assert.equal(await x.evaluate(saveDisabled), true, 'Save opened for a plain-http link');
    assert.match(await x.evaluate(text('.custom-client-preview.error')), /https/);
    await x.evaluate(fill(1, 'https://notes.example/thread/'));
    assert.match(await x.evaluate(text('.custom-client-preview.error')), /No note address/);
    // A profile pasted where a note belongs is named for what it is.
    await x.evaluate(fill(1, await profileLink(x)));
    assert.match(await x.evaluate(text('.custom-client-preview.error')), /Paste a link to a note/);

    // The test button is shut until its field reads cleanly: nothing unread is ever opened.
    const tryShut = (i) => `document.querySelectorAll('#modal .row-actions .icon-btn')[${i}].disabled`;
    assert.equal(await x.evaluate(tryShut(0)), true, 'the note test button is open on a link that did not read');

    await x.evaluate(fill(1, NOTE_LINK));
    assert.equal(await x.evaluate(tryShut(0)), false, 'the note test button stayed shut on a good link');
    assert.equal(await x.evaluate(tryShut(1)), true, 'the profile test button opened with its field empty');
    assert.equal(await x.evaluate(saveDisabled), true, 'Save opened with the profile link still empty');
    await x.evaluate(fill(2, await profileLink(x)));
    assert.equal(await x.evaluate(saveDisabled), false, 'two good links still keep Save shut');
    // The line under each field says how the client writes its address: the form is read
    // from the pasted link, not asked for.
    const says = await x.evaluate(`[...document.querySelectorAll('#modal .custom-client-preview')].map((e) => e.innerText)`);
    assert.deepEqual(says, ['Notes are sent as a hex ID.', 'Profiles are sent as an npub.']);

    // Trying the link opens exactly what was pasted, through the same opener a saved
    // client uses. Nothing is requested until the button is pressed.
    await x.recordTabs();
    assert.ok(await x.evaluate(click('#modal .row-actions .icon-btn')), 'no test button');
    await sleep(500);
    const calls = await x.calls();
    assert.ok(calls.some((c) => c.call === 'create' && c.args[0] && c.args[0].url === NOTE_LINK), 'the test button did not open the pasted link: ' + JSON.stringify(calls));

    // Parameters that ride along are named, and do not stop the save.
    await x.evaluate(fill(1, NOTE_LINK + '?utm_source=share&token=abc'));
    assert.match(await x.evaluate(text('.custom-client-warn')), /utm_source, token/);
    assert.equal(await x.evaluate(saveDisabled), false, 'a warning shut Save');
    await x.evaluate(fill(1, NOTE_LINK));
    assert.equal(await x.evaluate(text('.custom-client-warn')), '', 'the warning outlived the parameters');

    await x.evaluate(click('#modal .actions .primary'));
    await x.waitFor(`document.getElementById('modal-overlay').classList.contains('hidden')`, 10000);
    await x.waitFor(`!!document.querySelector('#custom-clients .item .item-label')`, 10000);
    assert.match(await x.evaluate(text('#custom-clients .item .item-label')), /Mine/);
    assert.match(await x.evaluate(text('#custom-clients .item .item-sub')), /notes\.example/);

    // It is in the picker, and choosing it for this account sticks.
    assert.ok(
      await x.evaluate(`[...document.querySelectorAll('#client-select option')].some((o) => o.value === 'custom:notes.example' && o.textContent === 'Mine')`),
      'the saved client is not in the picker'
    );
    await x.evaluate(`(() => { const s = document.querySelector('#client-select'); s.value = 'custom:notes.example'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(600);
    await x.evaluate(click('#settings-close'));
    await openAppsSection(x);
    assert.equal(await x.evaluate(`document.querySelector('#client-select').value`), 'custom:notes.example', 'the choice did not stick');

    // The stored client opens what the app builds in the form it was shown: every call
    // site hands over a full nevent, and this client was seen taking hex.
    const opened = await x.evaluate(`(async () => {
      const r = await new Promise((res) => chrome.runtime.sendMessage({ type: 'SIDECAR_GET_SETTINGS' }, res));
      const settings = r.result;
      const pubkey = Object.keys(settings.defaultClientBy)[0];
      const nevent = window.NostrTools.nip19.neventEncode({ id: ${JSON.stringify(ID)}, author: ${JSON.stringify(AUTHOR)}, relays: [] });
      return window.SidecarCore.resolveClient(settings, pubkey).url(nevent);
    })()`);
    assert.equal(opened, NOTE_LINK, 'the saved client does not open the link it was made from');

    // Editing shows the link the entry stands for; saving it unchanged keeps the form.
    assert.ok(await x.evaluate(click('#custom-clients .item .item-actions .icon-btn:first-child')), 'the edit button is gone');
    assert.equal(await x.evaluate(saveDisabled), false, 'an unchanged edit cannot be saved');
    // The fields open on a stand-in address, not a pasted link: trying one would open a
    // note that does not exist. The buttons wait for something pasted this time.
    const editTryShut = (i) => `document.querySelectorAll('#modal .row-actions .icon-btn')[${i}].disabled`;
    assert.equal(await x.evaluate(editTryShut(0)), true, 'the test button is open on a stand-in link');
    assert.equal(await x.evaluate(editTryShut(1)), true, 'the test button is open on a stand-in link');
    assert.deepEqual(
      await x.evaluate(`[...document.querySelectorAll('#modal .custom-client-preview')].map((e) => e.innerText)`),
      ['Notes are sent as a hex ID.', 'Profiles are sent as an npub.'],
      'editing read the entry back as a different form'
    );
    // Pasting a different client's link replaces the form: Primal-style short nevent.
    await x.evaluate(fill(1, await x.evaluate(`'https://notes.example/e/' + window.NostrTools.nip19.neventEncode({ id: ${JSON.stringify(ID)} })`)));
    assert.match(await x.evaluate(text('#modal .custom-client-preview')), /short nevent/);
    assert.equal(await x.evaluate(editTryShut(0)), false, 'a link pasted during the edit cannot be tried');
    assert.equal(await x.evaluate(editTryShut(1)), true, 'the untouched profile field became testable');
    await x.evaluate(click('#modal .actions .primary'));
    await x.waitFor(`document.getElementById('modal-overlay').classList.contains('hidden')`, 10000);
    await sleep(400);
    const stored = (await x.message({ type: 'SIDECAR_GET_SETTINGS' })).result.customClients['custom:notes.example'];
    assert.equal(stored.urlForm, 'nevent-short');
    assert.equal(stored.url, 'https://notes.example/e/{ne}');

    // Removal is two taps, and the choice that named it goes with it.
    assert.ok(await x.evaluate(click('#custom-clients .item .item-actions .icon-btn:last-child')));
    assert.match(await x.evaluate(text('#custom-clients .item .item-label')), /Remove Mine\?/, 'the first tap removed without asking');
    assert.ok(await x.evaluate(click('#custom-clients .item .item-actions .icon-btn:last-child')));
    await x.waitFor(`!document.querySelector('#custom-clients .item')`, 10000);
    await sleep(400);
    assert.equal(await x.evaluate(`document.querySelector('#client-select').value`), '', 'a removed client kept the seat it was chosen for');
    assert.equal(
      await x.evaluate(`[...document.querySelectorAll('#client-select option')].some((o) => o.dataset.custom)`),
      false, 'the picker still offers the removed client'
    );
  });
});

test('the sheet holds together in the pseudo-locale, where every label is 40% longer', opts, async (t) => {
  // settings.language wins over the cached choice at boot, so the pseudo-locale is
  // chosen where a person chooses it.
  await withExtension(t, async (x) => {
    await openAppsSection(x);
    // An unbracketed label is one that never went through t() — the whole point of
    // reading this section in en-XA.
    assert.match(await x.evaluate(text('#add-client-btn')), /^\[.*·+\]$/, 'the Add button label is not wrapped');
    assert.ok(await x.evaluate(click('#add-client-btn')));
    await x.evaluate(fill(0, 'Mine'));
    await x.evaluate(fill(1, NOTE_LINK));
    await x.evaluate(fill(2, await profileLink(x)));
    assert.match(await x.evaluate(text('.custom-client-preview')), /^\[.*\]$/, 'a reading line is not wrapped');
    // And so is an error: a plain one is a sentence that never went through t().
    await x.evaluate(fill(1, 'http://notes.example/x'));
    assert.match(await x.evaluate(text('.custom-client-preview.error')), /^\[.*\]$/, 'an error line is not wrapped');
    // Nothing spills: the sheet, not the panel width, is what the labels must fit in.
    const spill = await x.evaluate(`(() => { const m = document.getElementById('modal'); return m.scrollWidth > m.clientWidth + 1 || document.body.scrollWidth > window.innerWidth + 1; })()`);
    assert.equal(spill, false, 'the sheet overflows in the pseudo-locale');
  }, { language: 'en-XA' });
});
