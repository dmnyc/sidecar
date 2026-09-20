'use strict';

// The composer, in a tab.
//
// The panel is 360px wide. That is right for approving a signature and wrong for writing
// anything you would want to read back, so compose.html is the same editor at a size and
// a type scale you can think in. What makes it safe rather than a second composer that
// drifts is that it shares three things and duplicates none of them: the editor itself
// (composer-core.js), the draft slot in the background's encrypted store, and the relay
// set the panel worked out for the account.
//
// Every assertion here is about one of the ways that sharing could quietly stop being
// true, because none of them fail loudly. A draft cleared before the publish lands loses
// the note. A relay list re-derived on the page publishes a NIP-65-only account to relays
// it asked to stop using. A reply opened in the tab publishes as a top-level note.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
const pageHtml = fs.readFileSync(path.join(ROOT, 'compose.html'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const bare = page.replace(/^\s*\/\/.*$/gm, '');
const panelBare = panel.replace(/^\s*\/\/.*$/gm, '');

test('THE DRAFT IS SHARED, NOT HANDED OVER', () => {
  // Both ends read and write the one slot in the background's draft store, keyed by
  // account. A handover instead, the text in a URL or a message the tab waits for, has a
  // moment where the note exists in one place only, and that is the moment a tab gets
  // closed. It also means the panel already holds what you typed in the tab.
  assert.match(bare, /store: 'drafts'/);
  assert.match(bare, /dkey = state\.activePubkey;/);
  assert.match(panelBare, /const draftKey = \(pubkey, replyTo\) =>/);
  // The URL carries nothing at all.
  assert.match(panelBare, /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\('compose\.html'\) \}\)/);
  assert.ok(!/getURL\('compose\.html\?/.test(panelBare), 'the draft must not ride in the URL');
});

test('THE DRAFT IS CLEARED ONLY AFTER THE NOTE IS OUT', () => {
  // A cleared draft plus a failed publish is the one outcome worth engineering against:
  // the relays rejected it, and the text is gone too.
  const post = bare.slice(bare.indexOf('async function doPost()'));
  const body = post.slice(0, post.indexOf('\n  }'));
  const publishAt = body.indexOf('pool().publish(');
  const clearAt = body.indexOf("draft.text = '';");
  assert.ok(publishAt > -1 && clearAt > -1, 'could not find the publish or the clear');
  assert.ok(publishAt < clearAt, 'the draft is cleared before the publish resolves');
  // And a publish no relay accepted is a failure, not a quiet success.
  assert.match(body, /if \(!ok\) throw new Error\(/);
});

test('THE PAGE DOES NOT GUESS WHERE TO PUBLISH', () => {
  // Working out an account's write set means its NIP-65 list, the configured relays, or
  // the declared set ALONE when the account asked for NIP-65 only. That last case is why
  // the page must not re-derive it: publishing a NIP-65-only account to the configured
  // list is exactly what the setting exists to stop. The panel already knows how, so it
  // decides at expand time and leaves the answer with the draft.
  assert.match(panelBare, /relays = await postRelays\(\)/);
  assert.match(panelBare, /all\[dkey\]\.expandRelays = relays;/);
  assert.match(bare, /if \(saved && Array\.isArray\(saved\.expandRelays\)\) handoverRelays = saved\.expandRelays;/);
  // A page opened cold still works, on the configured list, which is the panel's own
  // fallback when an account has declared nothing.
  const fn = bare.slice(bare.indexOf('async function targetRelays()'));
  assert.match(fn.slice(0, fn.indexOf('\n  }')), /SIDECAR_GET_RELAYS/);
});

test('A REPLY IS NOT OFFERED THE TAB', () => {
  // The page composes a top-level note. A reply that arrived there would publish as one,
  // silently, which is the exact failure the draft store learned to carry replyTo to
  // avoid. Same for a poll, which is a different kind with its own editor.
  assert.match(panelBare, /const expand = replyTo \? null : h\('button', \{/);
  assert.match(panelBare, /if \(expand\) expand\.classList\.toggle\('hidden', !!draft\.poll\);/);
});

test('it signs through the worker, like everything else that signs', () => {
  // The page holds no key and gains no new way to reach one: the same owner-sign message
  // the panel uses, with the same expectedPubkey, which fails closed if the active
  // account moved while the tab was open.
  assert.match(bare, /type: 'SIDECAR_OWNER_SIGN', event: template, expectedPubkey: state\.activePubkey/);
  assert.ok(!/nsec|privateKey|getSecretKey/.test(bare), 'the page must never handle a key');
});

test('its pool is its own, and small', () => {
  // The panel's pool carries reconnect handling, NIP-42 auth, relay health and the
  // notification subscriptions. This page publishes and reads two kinds, so it gets a
  // plain SimplePool rather than a share of that machinery, and cannot destabilize it.
  assert.match(bare, /new NT\.SimplePool\(\{ enableReconnect: true, websocketImplementation: ws \}\)/);
  assert.match(bare, /window\.SidecarWsGuard && window\.SidecarWsGuard\.impl\(\)/,
    'the guarded socket is what closes a connect-timeout socket nostr-tools abandons');
});

test('the type is bigger, which is the whole point of the page', () => {
  // 17px over the panel's 14. If this ever matches the panel again the page has no reason
  // to exist, so it is worth an assertion rather than a preference.
  assert.match(bare, /classList\.add\('compose-editor-lg'\)/);
  const rule = css.slice(css.indexOf('.compose-editor-lg {'), css.indexOf('.compose-editor-lg:focus'));
  assert.match(rule, /font-size: 17px/);
  assert.match(rule, /max-height: none/, 'the panel caps the editor at 240px; a page should not');
  // And a measure, not the whole window: past about 70 characters a line is measurably
  // harder to come back to, which would undo the readability this page is for.
  assert.match(css, /\.compose-sheet \{[^}]*max-width: 720px/);
});

test('the page dresses itself from the panel stylesheet and themes', () => {
  // The same product at a different size. A second stylesheet would be a second place for
  // every button to drift.
  assert.match(pageHtml, /<link rel="stylesheet" href="styles\.css" \/>/);
  assert.match(pageHtml, /themes\/speakeasy\.css/);
  assert.match(bare, /document\.documentElement\.setAttribute\('data-theme', name\)/);
  // Per account, like the panel: themeBy first, then the global choice.
  assert.match(bare, /\(by && pubkey && by\[pubkey\]\) \|\| \(settings && settings\.theme\)/);
});

test('closing the tab keeps what was typed', () => {
  // The save is debounced 400ms. A close inside that window would lose the last sentence,
  // which is the one just written.
  assert.match(bare, /window\.addEventListener\('beforeunload'/);
  const fn = bare.slice(bare.indexOf("window.addEventListener('beforeunload'"));
  assert.match(fn.slice(0, fn.indexOf('});')), /persistDraft\(\)/);
});
