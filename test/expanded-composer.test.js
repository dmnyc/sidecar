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
const welcomeCss = fs.readFileSync(path.join(ROOT, 'welcome.css'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
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

test('the way in is a word on the tab bar, not an icon in the corner', () => {
  // The corner already belongs to the close box, so a second button there landed on top
  // of it. And the outward arrow that means "expand" in most apps reads here as leaving
  // the browser, which is the one thing it does not do. Write / Preview / Expand is a row
  // of three things you can do with what you are writing.
  assert.match(panelBare, /textContent: 'Expand'/);
  assert.match(panelBare, /if \(expand\) tabBar\.append\(expand\);/);
  assert.ok(!/compose-expand[^']*modal-x|modal-x compose-expand/.test(panelBare),
    'the expand control must not take the corner slot the close box owns');
  assert.ok(!/expand\.append\(icon\(/.test(panelBare), 'no arrow: it does not leave the browser');
  // No bottom border, so it cannot read as a third tab that could be selected.
  const rule = css.slice(css.indexOf('.compose-expand {'), css.indexOf('.compose-expand:hover'));
  assert.match(rule, /margin-left: auto/);
  assert.ok(!/border-bottom/.test(rule));
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

test('THE COMPOSER FLOATS, CENTERED BOTH WAYS, ON A SOLID SURFACE', () => {
  // A tab is a lot of empty field, and text laid straight onto it has nothing holding it.
  // The note being written is one object, so it gets one surface with an edge.
  const sheet = css.slice(css.indexOf('.compose-sheet {'), css.indexOf('.compose-head {'));
  assert.match(sheet, /background: var\(--velvet-1\)/, 'solid, and from the theme');
  assert.ok(!/gradient|rgba\(\d/.test(sheet.split('box-shadow')[0]), 'the surface is solid, not a wash');
  assert.match(sheet, /border: 1px solid var\(--border-strong\)/);
  assert.match(sheet, /border-radius: 18px/);
  assert.match(sheet, /box-shadow:/, 'a card with no shadow is not floating, it is a box');

  // Horizontally by the flex container, vertically by auto margins. Not align-items:
  // center, which pushes the top of an oversized card off the top of the window with no
  // way to scroll back to it; auto margins resolve to zero instead and stay reachable.
  // Comments stripped before the doesNotMatch, or the rule's own explanation of why it is
  // not align-items: center is what the guard finds.
  const body = css.slice(css.indexOf('.compose-body {'), css.indexOf('.compose-sheet'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(body, /justify-content: center/);
  assert.match(body, /min-height: calc\(100vh - var\(--compose-topbar-h\)\)/);
  assert.match(sheet, /margin: auto 0/);
  assert.ok(!/align-items: center/.test(body), 'align-items clips an oversized card');

  // The bar's height is written once, because the card subtracts it.
  assert.match(css, /--compose-topbar-h: 47px/);
  const bar = css.slice(css.indexOf('.compose-topbar {'), css.indexOf('.compose-brand {'));
  assert.match(bar, /padding: 12px 24px/);
  assert.match(css, /\.compose-brand img \{ height: 22px/); // 12 + 22 + 12 + 1px rule

  // And the editor cannot be the same plane as the card it sits on.
  const ed = css.slice(css.indexOf('.compose-editor-lg {'), css.indexOf('.compose-editor-lg:focus'));
  assert.ok(!/background: var\(--velvet-1\)/.test(ed), 'the field would vanish into the card');
  assert.match(ed, /background: var\(--input-bg/);
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

test('A PAGE THAT OPENS IN A TAB SAYS WHOSE IT IS', () => {
  // The panel has chrome around it that answers this; a tab has nothing but the page. The
  // guide and the app directory already settled the shape, so this is the same bar at the
  // same height: 12px of padding around a 22px wordmark.
  assert.match(pageHtml, /<header class="compose-topbar">/);
  assert.match(pageHtml, /id="compose-logo"/);
  const nav = welcomeCss.slice(welcomeCss.indexOf('.helpnav {'), welcomeCss.indexOf('.helpnav-brand'));
  const bar = css.slice(css.indexOf('.compose-topbar {'), css.indexOf('.compose-brand {'));
  assert.match(nav, /padding: 12px 24px/);
  assert.match(bar, /padding: 12px 24px/, 'the bars have to be the same height');
  assert.match(welcomeCss, /\.helpnav-brand img \{ height: 22px/);
  assert.match(css, /\.compose-brand img \{ height: 22px/);

  // IN THE THEME, which is where it parts company with the guide. That bar's background is
  // a hardcoded rgba of Speakeasy's velvet, so on the six light themes it would be a black
  // stripe above a marble page.
  assert.match(nav, /background: rgba\(/, 'if the guide went theme-aware, this note is stale');
  assert.match(bar, /background: var\(--velvet-1\)/);
  assert.ok(!/rgba\(/.test(bar), 'no hardcoded color in the composer bar');
  // And the wordmark itself swaps, since the default is baked lavender and vanishes on a
  // light field. Same function and same set the panel uses.
  assert.match(bare, /logo\.src = logoSrcFor\(name\)/);
  assert.match(bare, /const \{ h, icon, logoSrcFor, avatarPhSrc \} = SC;/);
});

test('the theme artwork helpers live in the core, not a fifth copy', () => {
  // Their own comment says LIGHT_THEMES is "the fourth place a theme has to be registered
  // and the chain form is the one that gets forgotten". This page would have been the
  // fifth, so they moved to the core and the panel takes them back.
  assert.match(core, /const LIGHT_THEMES = new Set\(\[/);
  assert.ok(!/const LIGHT_THEMES = new Set/.test(panel), 'a second copy defeats the point');
  assert.match(panel, /const \{ LIGHT_THEMES, logoSrcFor, avatarPhSrc \} = window\.SidecarCore;/);
  // The avatar placeholder is drawn in white, so a light theme needs the other cut. The
  // page was appending an <img> with no src at all before this.
  assert.match(bare, /img\.src = avatarPhSrc\(\);/);
});

test('THE FURNITURE IS THE PANEL\u2019S, NOT A SECOND SET', () => {
  // Media, proof of work and the preview renderer all moved to composer-core.js rather
  // than being rebuilt here. A second preview renderer is the worst of them: it would
  // disagree with the panel's about a mention, an embed or a link card, and the whole
  // point of a preview is that it is what will be published.
  for (const name of ['renderNotePreview', 'uploadMedia', 'minePow', 'powCancel']) {
    assert.ok(core.includes('function ' + name + '('), 'the core should own ' + name);
    assert.ok(!new RegExp('function ' + name + '\\(').test(page), 'compose.js reimplements ' + name);
    assert.ok(!new RegExp('function ' + name + '\\(').test(panel), 'sidepanel.js kept a copy of ' + name);
  }
  assert.match(bare, /composer\.renderNotePreview\(box, body\)/);
  assert.match(bare, /composer\.uploadMedia\(file, state\.activePubkey\)/);
  // Its relay reads go through this page's own pool, so the core never learns which
  // sockets it is using and cannot reach the panel's.
  assert.match(bare, /poolGet: \(relays, filter, params\) => pool\(\)\.get\(/);
  assert.match(bare, /poolQuerySync: \(relays, filter, params\) => pool\(\)\.querySync\(/);
});

test('MINE FIRST, THEN SIGN', () => {
  // The event id commits to the pubkey, so the nonce has to be found against the key that
  // will sign it. Signing afterwards recomputes the id without touching created_at or the
  // tags the miner wrote; mining afterwards would invalidate the signature.
  const post = bare.slice(bare.indexOf('async function doPost()'));
  const body = post.slice(0, post.indexOf('\n  }'));
  const mineAt = body.indexOf('composer.minePow(');
  const signAt = body.indexOf('SIDECAR_OWNER_SIGN');
  assert.ok(mineAt > -1 && signAt > -1);
  assert.ok(mineAt < signAt, 'mining after signing would invalidate the signature');
  // And the pubkey the miner needed is dropped again, so the signer sets it from the key
  // it actually signs with rather than agreeing with a copy we sent.
  assert.match(body, /const \{ pubkey: _mined, \.\.\.rest \} = mined\.event;/);
});

test('a mine can be stopped, and the button that started it is how', () => {
  // Ten seconds at 22 bits and sometimes a minute. The panel offers a Stop for exactly
  // that reason; here the only button that could be pressed is the one that started it.
  assert.match(bare, /post\.textContent = on \? 'Stop mining' : 'Post';/);
  assert.match(bare, /if \(mining\) return composer\.powCancel\(\);/);
  // A stop is a decision, not a fault, so it does not raise an error toast.
  assert.match(bare, /if \(!\(e && e\.canceled\)\) toast\(/);
});

test('media is content on its own', () => {
  // An image with no caption is a thing people post, and an upload with no words yet is
  // still work: dropping it from the draft because nothing had been typed is the kind of
  // thing that makes a draft store worse than none.
  assert.match(bare, /\$\('compose-post'\)\.disabled = posting \|\| \(!n && !draft\.media\.length\)/);
  assert.match(bare, /const hasContent = !!\(\(draft\.text && draft\.text\.trim\(\)\) \|\| \(draft\.media && draft\.media\.length\)\)/);
  assert.match(bare, /if \(saved && Array\.isArray\(saved\.media\)\) draft\.media = saved\.media;/);
  // The URL goes on its own line, decided from the serialized text, because a URL glued
  // to a bech32 or a hashtag corrupts both when the note is parsed.
  assert.match(bare, /const existing = composer\.serializeEditor\(ed\);/);
});

test('THE WAY OUT IS A CORNER BOX AND A WORD, AND THE WAY TO PUBLISH IS NEITHER', () => {
  // The corner is where every sheet in the panel puts its close box. The word in the
  // footer is for anyone reading the row rather than the corner. Both keep the draft,
  // because neither is a decision to throw it away.
  assert.match(pageHtml, /class="modal-x compose-x" id="compose-x"/);
  assert.match(bare, /x\.addEventListener\('click', leave\)/);
  assert.match(bare, /\$\('compose-close'\)\.addEventListener\('click', leave\)/);
  assert.match(bare, /const leave = \(\) => \{ persistDraft\(\)[\s\S]{0,60}window\.close\(\)/);

  // Cancel is not a button. Leaving is not an action with the same weight as publishing,
  // and two filled controls side by side claim it is.
  assert.match(pageHtml, /class="compose-cancel" id="compose-close">Cancel</);
  const cancel = css.slice(css.indexOf('.compose-cancel {'), css.indexOf('.compose-cancel:hover'));
  assert.match(cancel, /background: none/);
  assert.match(cancel, /border: none/);
  // And the one that cannot be taken back is the biggest thing in the row.
  const postRule = css.slice(css.indexOf('.compose-post {'), css.indexOf('.compose-post {') + 120);
  assert.match(postRule, /font-size: 15px/);
  assert.match(postRule, /padding: 12px 30px/);
});

test('AFTER POSTING, THE CARD BECOMES THE RECEIPT', () => {
  // The panel drops a banner because its composer is a modal that closes onto a whole
  // app. A tab has nothing underneath it: the card IS the page, and leaving an empty
  // editor sitting there reads as a note lost rather than published.
  assert.match(bare, /await showPosted\(signed, ok\)/);
  const fn = bare.slice(bare.indexOf('async function showPosted('));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /sheet\.innerHTML = '';/);
  assert.match(body, /textContent: 'Your note is live\.'/);
  assert.match(body, /'Published to ' \+ relayCount/);

  // Only after the publish resolved. A receipt for a note no relay took is a lie.
  const post = bare.slice(bare.indexOf('async function doPost()'));
  const pbody = post.slice(0, post.indexOf('\n  }'));
  assert.ok(pbody.indexOf('pool().publish(') < pbody.indexOf('showPosted('));
});

test('the receipt links to the note, in the client this ACCOUNT chose', () => {
  // Sidecar is a companion, not a client: it cannot show the note in a thread with its
  // replies, and the client this account already picked can. Resolved against the account
  // that SIGNED it rather than whatever is active by the time this paints, since the
  // panel can switch while the tab is open.
  const fn = bare.slice(bare.indexOf('async function showPosted('));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /composer\.resolveClient\(settings, signed\.pubkey \|\| state\.activePubkey\)/);
  assert.match(body, /client\.url\(await neventFor\(signed\)\)/);
  assert.match(body, /open\.target = '_blank'/);
  assert.match(body, /open\.rel = 'noreferrer noopener'/);
  // A failure to work out the link leaves the receipt without one rather than breaking it.
  assert.match(body, /catch \(_\) \{ \/\* no link is better than a broken one \*\/ \}/);
  assert.match(body, /if \(href\) \{/);

  // The nevent carries relay hints, or the client has nowhere to look the note up.
  assert.match(bare, /NT\.nip19\.neventEncode\(\{ id: signed\.id, author: signed\.pubkey, relays \}\)/);

  // One directory, shared. The panel's banner and this receipt ask the same question, and
  // two copies would answer it differently the first time a client changes its routes.
  assert.ok(core.includes('const VIEW_CLIENTS = {'), 'the core should own the directory');
  assert.ok(!panel.includes('const VIEW_CLIENTS = {'), 'sidepanel.js kept a copy');
  assert.ok(!page.includes('const VIEW_CLIENTS = {'), 'compose.js built its own');
});

test('closing the tab keeps what was typed', () => {
  // The save is debounced 400ms. A close inside that window would lose the last sentence,
  // which is the one just written.
  assert.match(bare, /window\.addEventListener\('beforeunload'/);
  const fn = bare.slice(bare.indexOf("window.addEventListener('beforeunload'"));
  assert.match(fn.slice(0, fn.indexOf('});')), /persistDraft\(\)/);
});
