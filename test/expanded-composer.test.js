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
const strip = (src) => src
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, "''");
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
  // A page opened cold still works, on the configured write list, which is the panel's own
  // fallback when an account has declared nothing.
  const fn = bare.slice(bare.indexOf('async function targetRelays()'));
  assert.match(fn.slice(0, fn.indexOf('\n  }')), /return relayUrls\(true\);/);

  // READING IS NOT PUBLISHING. relayUrls(false) means every configured relay, read-only
  // ones included, which is what the core asks for when it looks up a profile, an embed
  // or the kind 10063 Blossom list. Answering all of those with the PUBLISH set meant the
  // server list was looked for on two or three write relays and, not found, every upload
  // fell through to the fallback host without a word.
  assert.match(bare, /relayUrls\(writableOnly\)/);
  assert.match(bare, /\(writableOnly \? map\[u\]\.write !== false : true\)/);
  assert.match(bare, /^\s*relayUrls,$/m, 'the core gets the reader, not the publish set');
  assert.ok(!/relayUrls: \(\) => targetRelays\(\)/.test(bare), 'that conflation was the bug');
});

test('THE BLOSSOM SERVER LIST IS ACTUALLY LOOKED FOR', () => {
  // BLOSSOM_SERVER_LIST_KIND stayed in the panel when the uploader moved to the core, so
  // fetchBlossomServers threw a ReferenceError inside its own try, returned an empty list,
  // and every upload in BOTH composers went to the fallback host instead of the account's
  // own server. An empty list and a failed lookup are not the same thing and must not read
  // the same, so the catch says so now.
  assert.match(core, /const BLOSSOM_SERVER_LIST_KIND = 10063;/);
  assert.match(core, /const BLOSSOM_AUTH_KIND = 24242;/);
  assert.ok(!/BLOSSOM_SERVER_LIST_KIND =/.test(panel), 'sidepanel.js kept a copy');
  const fn = core.slice(core.indexOf('async function fetchBlossomServers('));
  assert.match(fn.slice(0, fn.indexOf('\n  }')), /console\.warn\('\[Upload\] could not read the Blossom server list:'/);
  assert.ok(!/\} catch \(_\) \{\}\n    _blossomServerCache/.test(core), 'a swallowed lookup reads as no servers');
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

  // WRITE AND PREVIEW ARE TWO VIEWS OF ONE THING, so switching must not change the type
  // scale or the height of the card. At the panel's 14px the preview read as a thumbnail
  // of the 17px being written above it, which is the opposite of what a preview is for.
  assert.match(pageHtml, /class="compose-preview compose-preview-lg hidden"/);
  const prev = css.slice(css.indexOf('.compose-preview-lg {'), css.indexOf('.compose-preview-lg .embed-body'));
  assert.match(prev, /max-height: none/);
  assert.match(prev, /padding: 18px/);
  assert.match(prev, /\.compose-preview-lg \.preview-body \{ font-size: 17px/);
  // ONE VARIABLE, NOT TWO EQUAL NUMBERS. The two panes agreeing is the point, and it has
  // to survive the short-screen override that shrinks both of them at once.
  assert.match(rule, /min-height: var\(--compose-pane-h\)/, 'the two panes have to agree on height');
  assert.match(prev, /min-height: var\(--compose-pane-h\)/);
  assert.match(rule, /padding: 18px/);
  assert.match(css, /--compose-pane-h: 340px/);
});

test('A SHORT SCREEN DOES NOT PUT POST BELOW THE FOLD', () => {
  // The card is about 750px tall at rest, which is most of a laptop lid once the browser
  // has taken its chrome. Everything given back here is padding and one pane height:
  // 240px is still twice what the panel gives you, which is the whole reason to be here.
  const short = css.slice(css.indexOf('@media (max-height: 820px)'));
  const block = short.slice(0, short.indexOf('\n}') + 2);
  assert.match(block, /--compose-pane-h: 240px/);
  assert.match(block, /\.compose-body \{ padding: 16px 20px 24px; \}/);
  assert.match(block, /\.compose-sheet \{ gap: 11px; padding: 18px; \}/);

  // And the dead space that was there at every height: an empty thumbnail row is still a
  // flex item, so it charged 14px of margin plus the gap on either side of it.
  assert.match(css, /\.compose-thumbs:empty \{ display: none; \}/);
  // The sheet sets the rhythm with its own gap; the rows inside do not each add to it —
  // including the attachments' reference drawer and the ALT editor row that seat
  // themselves beside these.
  assert.match(css, /\.compose-sheet \.compose-actions,[\s\S]{0,240}margin: 0; \}/);
});

test('THE COMPOSER FLOATS, CENTERED BOTH WAYS, ON A SOLID SURFACE', () => {
  // A tab is a lot of empty field, and text laid straight onto it has nothing holding it.
  // The note being written is one object, so it gets one surface with an edge.
  // Indexes walked forward from the full .compose-body rule, because the short-screen
  // media query declares one-line overrides for both of these and sits earlier in the
  // file, which is what a plain indexOf finds.
  const bodyAt = css.indexOf('.compose-body {\n');
  const sheetAt = css.indexOf('.compose-sheet {\n', bodyAt);
  const sheet = css.slice(sheetAt, css.indexOf('.compose-head {'));
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
  // The FULL rule, not the one-liner inside the short-screen media query, which sits
  // earlier in the file now and is what a plain indexOf finds.
  const body = css.slice(bodyAt, sheetAt).replace(/\/\*[\s\S]*?\*\//g, '');
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

test('THE DIFFICULTY TRAVELS WITH THE NOTE, AND FALLS BACK TO THE ACCOUNT', () => {
  // Two mistakes with one shape. Starting every note at off meant an account that had
  // asked for 20 bits in Settings got none of them in a tab. Seeding from Settings over a
  // draft meant a rung chosen in the panel a second before pressing Expand was thrown
  // away on arrival. The difficulty is a decision about THIS note: it travels with it,
  // and the account's standing setting is the fallback, not the answer.
  const seed = bare.slice(bare.indexOf('async function seedPow(saved)'));
  const sbody = seed.slice(0, seed.indexOf('\n  }'));
  assert.match(sbody, /if \(saved && saved\.pow && typeof saved\.pow\.bits === 'number'\)/);
  assert.match(sbody, /return composer\.powSetting\(state\.activePubkey\);/);
  assert.match(bare, /powForThisPost = await seedPow\(saved\);/);

  // Written on every cycle of the button, on both sides, so the slot holds the rung the
  // moment it is chosen rather than at the next keystroke.
  assert.match(bare, /draft\.pow = powForThisPost;\s*\n\s*scheduleSave\(\);/);
  assert.match(panelBare, /draft\.pow = powForThisPost;\s*\n\s*scheduleSave\(\);/);
  assert.match(panelBare, /if \(draft\.pow\) all\[key\]\.pow = draft\.pow;/);
  assert.match(bare, /if \(draft\.pow\) all\[dkey\]\.pow = draft\.pow;/);
  // And restored when the panel resumes a draft, for the same reason replyTo is: finding
  // a resumed note's difficulty reset is the same surprise as finding its target reset.
  assert.match(panelBare, /powForThisPost = \{ on: !!saved\.pow\.on, bits: saved\.pow\.bits \};/);

  // One reading of the setting, not two. powBy is keyed by pubkey and the default is off
  // because a mine spends the user's own time; two copies of that judgment would drift.
  assert.ok(core.includes('async function powSetting(pubkey)'), 'the core should own it');
  assert.ok(!panel.includes('async function powSetting(pubkey)'), 'sidepanel.js kept a copy');
  assert.ok(!bare.includes('powBy'), 'compose.js reads the setting for itself');

  // And re-seeded when the account moves under the tab, since powBy is per account and
  // the new account has a draft of its own.
  const refresh = bare.slice(bare.indexOf('async function refreshWho()'));
  const body = refresh.slice(0, refresh.indexOf('\n  }'));
  assert.match(body, /powForThisPost = await seedPow\(saved\);/);
  assert.match(body, /repaintPow\(\);/);
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

test('THE REVIEW COUNTDOWN IS HONORED HERE TOO', () => {
  // noteCountdown defaults on and the panel has honored it since it existed. This page
  // published the instant Post was pressed, which is a setting somebody turned on and one
  // of two composers quietly ignoring it.
  // THROUGH THE CORE, not read again here. This page had its own copy of the reader with
  // its own default of five seconds, where the panel defaults to fifteen: the same account
  // got three times less time to catch a mistake depending on which composer it was in.
  assert.match(bare, /const \{ on, secs \} = await composer\.postCountdownSetting\(\);/);
  assert.match(bare, /if \(!on\) return doPost\(\);/);
  assert.match(bare, /composer\.showPostCountdown\(\{/);
  assert.ok(core.includes('async function postCountdownSetting()'), 'the core should own it');
  assert.ok(!panel.includes('async function postCountdownSetting()'), 'sidepanel.js kept a copy');
  assert.ok(!/noteCountdown/.test(bare), 'compose.js reads the setting for itself');
  assert.match(core, /const NOTE_COUNTDOWN_DEFAULT = 15;/);

  // THE REVIEW WINDOW IS NOT THE EDITOR, so it does not want the editor's height. The
  // pane inherits a 42vh cap sized for the panel, which on this page sits under a note
  // written at 17px with its images at full width: tall enough to push its own ring and
  // its own buttons off the screen, at the one moment everything in it matters.
  assert.match(css, /\.compose-countdown \.countdown-preview \{ max-height: 32vh; \}/);
  assert.match(css, /\.compose-countdown \.note-media \{ max-height: 160px/);
  assert.match(css, /\.compose-countdown \.countdown-wrap \{ flex-shrink: 0; \}/,
    'the ring and the buttons below it must never be what scrolls out of reach');

  // Its own container, not the card. Taking over the sheet the way the panel takes over
  // its modal would mean rebuilding the editor on cancel around a lost caret.
  assert.match(pageHtml, /id="compose-countdown"/);
  assert.match(bare, /modal: pane, secs,/);
  // NO AUTHOR STRIP HERE. The panel passes one because its countdown replaces the whole
  // modal, header and all, so nothing else on screen says who is posting. This card keeps
  // its own header up, and a second face and name six lines under the first is the same
  // sentence twice.
  assert.ok(!/author,/.test(bare), 'the card header already says who');
  assert.match(panelBare, /author: composeAuthorStrip\(\)/);

  // AND THE SAME ROW AS THE FOOTER IT REPLACES. .actions is only styled under .modal,
  // where it is a column with the primary on top; with no modal above it the buttons fell
  // out inline and left-aligned, at the opposite end of the card from where this page
  // puts Cancel and Post every other second of its life.
  assert.match(css, /\.compose-countdown \.actions \{[\s\S]{0,120}flex-direction: row-reverse/);
  assert.match(css, /\.compose-countdown \.actions \.primary \{[^}]*min-width: 184px/);
  // The whole footer goes, not its two buttons: hiding those alone left the character
  // count dangling under the countdown's own row, attached to nothing.
  assert.match(bare, /document\.querySelector\('\.compose-foot'\)\.classList\.toggle\('hidden', on\)/);
  const fn = bare.slice(bare.indexOf('const restore = () =>'));
  assert.match(fn.slice(0, 300), /countdown\.stop\(\); countdown = null;/);
  assert.match(fn.slice(0, 300), /pane\.classList\.add\('hidden'\)/);

  // One countdown at a time, and the editor inert while it is up, for the same reason it
  // is inert while a mine runs: what is being reviewed was decided when Post was pressed.
  assert.match(bare, /if \(countdown\) return;/);
  assert.match(bare, /function setReviewing\(on\)/);

  // The strip that says who is posting became a parameter for this, so the countdown no
  // longer reaches into the panel's own state to build it. Both panel call sites pass it,
  // including the page-comment one, which drew it before the change.
  assert.equal((panelBare.match(/author: composeAuthorStrip\(\)/g) || []).length, 2);
  assert.ok(core.includes('function showPostCountdown(opts)'), 'the core should own it');
  assert.ok(!panel.includes('function showPostCountdown(opts)'), 'sidepanel.js kept a copy');
});

test('MINING TAKES THE CARD, AND THE EDITOR COMES BACK', () => {
  // minePow works on a snapshot of the template taken when Post was pressed, so anything
  // typed while it runs is not in the note that publishes. This used to be handled by
  // leaving the editor on screen and switching off everything in it one control at a
  // time, which was a lot of code spent neutralizing a surface that had no business being
  // there, and it still showed you a note the mine had already taken a copy of as though
  // it were live text.
  //
  // showPosted turns the card into the receipt on the argument that a tab has nothing
  // underneath it. Mining is the same situation half a second earlier, so it gets the
  // same treatment, and the editor cannot be typed into because it is not on screen.
  const fn = bare.slice(bare.indexOf('function setMining(on, bits)'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /sheet\.classList\.add\('is-mining'\)/);
  assert.match(body, /mineCard = h\('div', \{ className: 'compose-mining' \}\)/);
  assert.match(body, /editorApi\.close\(\)/, 'a dropdown left hanging over a hidden box');

  // HIDDEN, NOT REPLACED, which is the whole difference from the receipt. A mine can be
  // stopped and can fail, so the editor has to return with the draft and the caret as
  // they were. Emptying the sheet here would be the bug the receipt is allowed to be.
  assert.doesNotMatch(body, /sheet\.innerHTML = ''/, 'a stopped mine would lose the draft');
  assert.match(body, /sheet\.classList\.remove\('is-mining'\)/);
  assert.match(body, /mineCard\.remove\(\); mineCard = null;/);
  // setMining(false) runs on every exit from doPost, which is what makes the above the
  // restore path for a success, a stop and a failure alike.
  assert.ok(bare.includes('setMining(false);\n    posting = false;'),
    'the tail of doPost no longer restores the card');

  // LEAVING IS ALWAYS ALLOWED, and it takes the worker with the page.
  assert.match(css, /\.compose-sheet\.is-mining > :not\(\.compose-mining\):not\(\.compose-x\) \{ display: none; \}/,
    'either the card is not hidden, or the close box went with it');
  // Same container as the receipt, which is the point: one padding, one alignment.
  assert.match(css, /\.compose-sheet\.is-mining \{ align-items: center; text-align: center; gap: 10px; padding: 48px 24px; \}/);

  // The best-so-far is read back off the live card rather than closed over, so a mine
  // that outlives its card cannot write into a node that has left the page.
  assert.match(bare, /function paintMineProgress\(best\) \{/);
  assert.match(bare, /if \(!mineCard \|\| !mineCard\._sub\) return;/);
  assert.match(bare, /\(p\) => paintMineProgress\(p\.best\)/);
  // No bar: every attempt is independent, so there is no progress that could honestly
  // fill one, and the best difficulty found is the only true number.
  assert.doesNotMatch(css, /\.compose-mining[^{]*\{[^}]*progress/s);
});

test('a note posted here reaches the bell as one of your own', () => {
  // _ownNoteIds is what the bell filters replies against, and it is the panel's memory. A
  // note posted from this tab was not in it, so replies stayed out of notifications until
  // the panel next re-queried its own notes from relays. The tab says so instead.
  assert.match(bare, /event: 'notePublished', pubkey: signed\.pubkey, id: signed\.id/);
  assert.match(panelBare, /if \(msg\.event === 'notePublished' && msg\.pubkey && msg\.id\) \{/);
  assert.match(panelBare, /rememberOwnNote\(msg\.pubkey, msg\.id\);/);

  // Only after the publish landed. Telling the bell about a note the relays refused would
  // put an id in that filter for an event nobody can reply to.
  const post = bare.slice(bare.indexOf('async function doPost()'));
  const body = post.slice(0, post.indexOf('\n  }'));
  assert.ok(body.indexOf('pool().publish(') < body.indexOf("event: 'notePublished'"));

  // And the worker ignores the broadcast rather than answering it. It falls through the
  // control switch otherwise and comes back as "Unknown control message" with a dev-log
  // line for company.
  const bgSrc = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.match(bgSrc, /if \(message\.type === 'SIDECAR_EVENT'\) return false;/);
});

test('A LOCKED STORE IS SAID ONCE, AND NOTHING PRETENDS TO FIX IT', () => {
  // getState carries `locked`, so the page can say so at boot and on every focus rather
  // than only after a Post that failed with a note already written. And the lock can land
  // while the tab sits open: fifteen idle minutes is shorter than a long note.
  const refresh = bare.slice(bare.indexOf('async function refreshWho()'));
  assert.match(refresh.slice(0, refresh.indexOf('\n  }')), /paintLocked\(\);/);

  // ONCE. A banner above the editor saying it and a button below saying it are the same
  // sentence twice, and the banner was the one carrying no other information.
  assert.ok(!/compose-locked/.test(pageHtml), 'the banner is redundant with the button');
  assert.ok(!/compose-locked/.test(css));
  assert.match(bare, /status\.textContent = \(state && state\.locked\) \? 'Sidecar is locked\.' : '';/);

  // NOTHING PRETENDS. chrome.sidePanel.open was the obvious way to offer the unlock from
  // here and it does not work: the API wants a user gesture and declines the click on an
  // extension tab page, so the button did nothing at all when pressed. A control that
  // lies about being a control is worse than the sentence it replaced.
  assert.ok(!/sidePanel/.test(strip(page)), 'that API does not work from this page');
  // And no PIN field either. SIDECAR_UNLOCK enumerates its callers because the throttle
  // and the 21st-strike wipe sit behind it; a fourth surface taking a PIN deserves a
  // security look, not a paragraph in a layout commit.
  assert.ok(!/SIDECAR_UNLOCK/.test(bare), 'this page must not take a PIN');

  // AND POST SAYS SO RATHER THAN DISAPPEARING INTO IT. Leaving it lit meant pressing it
  // sat through the whole review countdown and then a full proof-of-work mine, as much as
  // a minute, before the signer refused and a toast explained. A note vanishing for a
  // minute into no feedback is worse than anything that could follow it.
  const paint = bare.slice(bare.indexOf('function paintPostButton()'));
  const pbody = paint.slice(0, paint.indexOf('\n  }'));
  assert.match(pbody, /post\.textContent = 'Unlock to post';/);
  assert.match(pbody, /post\.disabled = true;/, 'there is no route from here, so it is inert');
  // Belt and braces on the route the button no longer offers.
  const review = bare.slice(bare.indexOf('async function reviewThenPost()'));
  assert.match(review.slice(0, 500), /if \(state && state\.locked\) return;/);
  // The editor stays writable behind it: the draft is safe either way, and refusing to
  // let somebody finish writing because the store is locked is the wrong way round.
  assert.ok(!/contentEditable = .*locked/.test(bare));

  // THE PANEL BESIDE THIS TAB NEVER TAKES ITS FOCUS, so unlocking there would leave this
  // page still saying Unlock to post. The worker broadcast the lock already; it says the
  // unlock now too.
  const bgSrc2 = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.match(bgSrc2, /event: 'unlocked' \}\)\.catch/);
  assert.match(bare, /if \(msg\.event !== 'locked' && msg\.event !== 'unlocked'\) return;/);
  assert.match(bare, /state\.locked = msg\.event === 'locked';/);

  assert.match(bare, /\/is locked\/i\.test\(e\.message \|\| ''\)/);
  assert.match(bare, /Unlock it, then press Post again\./);
  // And the draft is still there, which is the other half of why this is survivable: the
  // text is only cleared after a publish that landed.
  const post = bare.slice(bare.indexOf('async function doPost()'));
  const body = post.slice(0, post.indexOf('\n  }'));
  assert.ok(body.indexOf('pool().publish(') < body.indexOf("draft.text = '';"));
});

test('a mine can be stopped, and the button that started it is how', () => {
  // Ten seconds at 22 bits and sometimes a minute. The panel offers a Stop for exactly
  // that reason; here the only button that could be pressed is the one that started it.
  assert.match(bare, /post\.textContent = 'Stop mining';/);
  assert.match(bare, /if \(mining\) return composer\.powCancel\(\);/);
  // A stop is a decision, not a fault, so it takes the branch that says nothing at all
  // rather than falling through to an error toast.
  assert.match(bare, /if \(e && e\.canceled\) \{ \/\* nothing to say \*\/ \}/);
});

test('media is content on its own', () => {
  // An image with no caption is a thing people post, and an upload with no words yet is
  // still work: dropping it from the draft because nothing had been typed is the kind of
  // thing that makes a draft store worse than none.
  // Decided in paintPostButton, which is the one place that knows whether the button is
  // Post, Stop mining or Unlock to post right now.
  assert.match(bare, /post\.disabled = posting \|\| \(!n && !draft\.media\.length\);/);
  assert.match(bare, /const hasContent = !!\(\(draft\.text && draft\.text\.trim\(\)\) \|\| \(draft\.media && draft\.media\.length\)\)/);
  assert.match(bare, /if \(saved && Array\.isArray\(saved\.media\)\) draft\.media = saved\.media;/);
  // And the empty prose of a media-only note is not a reason to stop either: the URL
  // lives in the media slot now, so "no text" no longer means "no note".
  assert.match(bare, /if \(!text && !draft\.media\.length\) return;/);
  // The URL never enters the editor. It is appended to the content at publish — the
  // one composed string the review window previews too — so the prose the user sees
  // while writing is the prose they wrote.
  assert.match(bare, /content: SC\.composeNoteContent\(text, draft\.media\)/);
  assert.match(bare, /composer\.renderNotePreview\(body, SC\.composeNoteContent\(text, draft\.media\)\)/);
  assert.ok(!bare.includes('appendMediaUrl'), 'uploads must not write URLs into the editor');
});

test('THE WAY OUT IS A CORNER BOX AND A WORD, AND THE WAY TO PUBLISH IS NEITHER', () => {
  // The corner is where every sheet in the panel puts its close box. The word in the
  // footer is for anyone reading the row rather than the corner. Both keep the draft,
  // because neither is a decision to throw it away.
  assert.match(pageHtml, /class="modal-x compose-x" id="compose-x"/);
  assert.match(bare, /x\.addEventListener\('click', leave\)/);
  assert.match(bare, /\$\('compose-close'\)\.addEventListener\('click', leave\)/);
  assert.match(bare, /const leave = \(\) => \{ flushDraft\(\)\.then\(\(\) => window\.close\(\)\); \};/);

  // Cancel is not a button. Leaving is not an action with the same weight as publishing,
  // and two filled controls side by side claim it is.
  assert.match(pageHtml, /class="compose-cancel" id="compose-close">Cancel</);
  const cancel = css.slice(css.indexOf('.compose-cancel {'), css.indexOf('.compose-cancel:hover'));
  assert.match(cancel, /background: none/);
  assert.match(cancel, /border: none/);
  // And the one that cannot be taken back is the biggest thing in the row.
  const postRule = css.slice(css.indexOf('.compose-post {'), css.indexOf('.compose-post {') + 160);
  assert.match(postRule, /font-size: 15px/);
  assert.match(postRule, /padding: 12px 30px/);
  // A floor rather than more padding, so the width is the same whatever the label says.
  // It becomes Stop mining for as long as a mine runs, and a button that changes size
  // when it changes job reads as two buttons.
  assert.match(postRule, /min-width: 184px/);
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

test('ONE COMPOSER PER ACCOUNT, BECAUSE THERE IS ONE DRAFT SLOT PER ACCOUNT', () => {
  // Both ends autosave on a 400ms debounce into drafts[pubkey]. Two composers open is
  // last-writer-wins on every keystroke, and worse: posting from one clears the slot while
  // the other still holds the text, so its next keystroke republishes a note that already
  // went out as a fresh draft. Start fresh in the panel would delete what the tab is
  // editing and the tab would put it straight back.
  assert.match(panelBare, /const open = await liveComposeTab\(\);/);
  const fn = panelBare.slice(panelBare.indexOf('async function liveComposeTab()'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  // getContexts, not tabs.query. The manifest asks for https://*/* and nothing else, so
  // tab.url is blank for a chrome-extension:// page: a query filtered on compose.html
  // matches nothing, and adding "tabs" to see a document we own would widen what Sidecar
  // can read across every tab open. Scoped to this helper, since the panel legitimately
  // queries tabs elsewhere for the page it is looking at.
  assert.match(body, /chrome\.runtime\.getContexts\(\{ contextTypes: \['TAB'\] \}\)/);
  assert.ok(!/chrome\.tabs\.query/.test(body), 'tabs.query cannot see an extension page here');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.ok(!(manifest.permissions || []).includes('tabs'), 'this must not have cost a permission');
  assert.match(body, /return null;/, 'an older Chrome falls through to opening the panel one');

  // Focused rather than refused. The tab can be in another window, and a panel that does
  // nothing when you tap Compose is indistinguishable from a broken one.
  assert.match(panelBare, /chrome\.tabs\.update\(open\.tabId, \{ active: true \}\)/);
  assert.match(panelBare, /toast\('Your draft is already open in a tab', 'info'\)/);

  // A reply is a different slot, so only the main composer is held back.
  assert.match(panelBare, /if \(!\(opts && opts\.replyTo\)\) \{\n\s*const open = await liveComposeTab\(\)/);

  // And Expand reuses a tab rather than opening a second one with the same draft in it.
  const expand = panelBare.slice(panelBare.indexOf("expand.addEventListener('click'"));
  assert.match(expand.slice(0, 2000), /if \(open\) \{[\s\S]*?\} else \{\n\s*chrome\.tabs\.create\(/);
});

test('WHO THIS IS WRITTEN AS CAN CHANGE UNDER THE TAB', () => {
  // state was read once at boot and never again. Switch accounts in the panel and this
  // page went on showing the old name, went on writing the old account's draft slot, and
  // then failed at Post with a bare error, because owner-sign refuses when expectedPubkey
  // is not the account it would sign with. Failing closed is right; failing closed with
  // no explanation, after the note was written, is not.
  assert.match(bare, /window\.addEventListener\('focus', refreshWho\)/);
  assert.match(bare, /else refreshWho\(\);/);
  const fn = bare.slice(bare.indexOf('async function refreshWho()'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /if \(posting\) return;/, 'a swap mid-publish would be worse, not better');

  // The draft follows the account, because the slot is keyed by it. What is on screen
  // belongs to the account it was typed as, so it is written back THERE before the key
  // moves rather than being carried into someone else's slot.
  const flushAt = body.indexOf('await flushDraft();');
  const rekeyAt = body.indexOf('dkey = state.activePubkey;');
  assert.ok(flushAt > -1 && rekeyAt > -1, 'could not find the flush or the rekey');
  assert.ok(flushAt < rekeyAt, "the old account's text would be written to the new one's slot");

  // And everything the old account decided goes with it. A different account publishes
  // to its own relays and follows its own people.
  assert.match(body, /handoverRelays = null;/);
  assert.match(body, /followCache = null;/);
  assert.match(body, /toast\('Now writing as '/);
});

test('CLOSING THE TAB KEEPS WHAT WAS TYPED, AND BEFOREUNLOAD IS NOT HOW', () => {
  // The save is debounced 400ms, so the last sentence is the one at risk. beforeunload
  // fires as the document is being torn down and persistDraft is an async round trip
  // through the worker: the page can be gone before the write lands, which is why the
  // guidance everywhere is not to start async work there. Hiding a tab fires
  // visibilitychange first and the document stays alive afterwards, so the write
  // completes, and switching tabs saves too.
  assert.match(bare, /document\.addEventListener\('visibilitychange'/);
  const fn = bare.slice(bare.indexOf("document.addEventListener('visibilitychange'"));
  assert.match(fn.slice(0, fn.indexOf('});')), /document\.visibilityState === 'hidden'\) flushDraft\(\)/);
  // Kept as a backstop, not as the mechanism.
  assert.match(bare, /window\.addEventListener\('beforeunload', flushDraft\)/);
  // And the flush drops the pending debounce, so the two cannot race to put different
  // text in the same slot.
  const flush = bare.slice(bare.indexOf('function flushDraft()'));
  assert.match(flush.slice(0, flush.indexOf('\n  }')), /clearTimeout\(saveTimer\); saveTimer = null;/);
});
