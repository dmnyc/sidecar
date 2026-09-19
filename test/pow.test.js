'use strict';

// NIP-13 proof of work on the way out of the composer.
//
// The mining loop is LIFTED AND RUN rather than grepped, because the only thing that
// matters about it is arithmetic: an id with the right number of leading zero bits, that
// still has them after the signer recomputes it. A source assertion cannot tell a correct
// count from a plausible one, and the difficulty is counted in bits rather than hex
// characters, which is the part that is easy to get wrong.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const workerSrc = fs.readFileSync(path.join(ROOT, 'pow-worker.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

// The worker plus the real vendored bundle, in one realm. importScripts is dropped
// because the bundle is loaded directly; everything else runs byte-identical to what
// ships, which is the point.
function miner() {
  const ctx = { self: {}, window: {}, console, TextDecoder, TextEncoder, crypto: require('node:crypto').webcrypto };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), ctx);
  vm.runInContext(workerSrc.replace(/^importScripts\(.*$/m, ''), ctx);
  return ctx;
}

// ---- counting ------------------------------------------------------------------------

test('DIFFICULTY IS LEADING ZERO BITS, NOT ZERO CHARACTERS', () => {
  const ctx = miner();
  const lz = (hex) => vm.runInContext('leadingZeroBits(' + JSON.stringify(hex) + ')', ctx);

  // NIP-13's own worked example: 002f… is 0000 0000 0010 1111, which is ten, not eight.
  // Counting hex zeroes would say eight and a spam note aiming at eight would pass a
  // ten-bit door.
  assert.equal(lz('002f' + '0'.repeat(60)), 10, 'hex digits <= 7 carry leading zeroes of their own');
  // And the spec's example id, which it states is difficulty 36.
  assert.equal(lz('000000000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d'), 36);
  assert.equal(lz('f' + '0'.repeat(63)), 0, 'a full first nibble is no work at all');
  assert.equal(lz('1' + '0'.repeat(63)), 3);
  assert.equal(lz('8' + '0'.repeat(63)), 0, '8 is 1000: no leading zero');
});

// ---- the round trip ------------------------------------------------------------------

test('A MINED EVENT KEEPS ITS ZEROS THROUGH SIGNING', () => {
  // The whole design rests on this. The signature covers the id, and the id is the hash
  // of pubkey/created_at/kind/tags/content, so mining has to happen BEFORE signing and
  // the signer has to recompute the same id from the same fields. finalizeEvent sets
  // pubkey, rehashes and signs, touching neither created_at nor tags, which is what makes
  // it safe. If that ever changes, this fails and the feature is silently worthless:
  // every post would carry a nonce tag and no actual proof.
  const ctx = miner();
  vm.runInContext(`
    const sk = NostrTools.generateSecretKey();
    const ev = { pubkey: NostrTools.getPublicKey(sk), created_at: Math.floor(Date.now()/1000),
      kind: 1, tags: [['client','Sidecar']], content: 'mining test' };
    const out = minePowEvent(ev, 12, null);
    globalThis.minedBits = leadingZeroBits(NostrTools.getEventHash(out.event));
    globalThis.nonce = out.event.tags.filter((t) => t[0] === 'nonce');
    // Exactly what doPublish does: drop pubkey, hand the rest to the signer.
    const { pubkey: _p, ...rest } = out.event;
    const signed = NostrTools.finalizeEvent(rest, sk);
    globalThis.signedBits = leadingZeroBits(signed.id);
    globalThis.verified = NostrTools.verifyEvent(signed);
  `, ctx);

  assert.ok(ctx.minedBits >= 12, 'the miner returned an event under its own target');
  assert.equal(ctx.signedBits, ctx.minedBits, 'signing changed the id, so the work was lost');
  assert.ok(ctx.verified, 'the mined event did not survive as a valid signature');
});

test('the nonce commits the target it was aiming for', () => {
  // NIP-13 SHOULD. Without it a reader cannot tell a note mined FOR 12 bits from bulk
  // spam aiming at 4 that got lucky, so a door set at 12 cannot reject the second one.
  const ctx = miner();
  vm.runInContext(`
    const ev = { pubkey: 'a'.repeat(64), created_at: 1700000000, kind: 1, tags: [], content: 'x' };
    globalThis.tags = minePowEvent(ev, 8, null).event.tags.filter((t) => t[0] === 'nonce');
  `, ctx);
  const nonce = ctx.tags;
  assert.equal(nonce.length, 1);
  assert.equal(nonce[0][2], '8', 'the third entry must be the target difficulty');
  assert.match(String(nonce[0][1]), /^\d+$/, 'the second entry is the counter');
});

test('re-mining replaces the nonce rather than stacking another', () => {
  // A draft mined twice (cancel, change a word, post) would otherwise carry two nonce
  // tags, and a reader counting the committed target has two answers to choose from.
  const ctx = miner();
  vm.runInContext(`
    let ev = { pubkey: 'a'.repeat(64), created_at: 1700000000, kind: 1,
      tags: [['nonce', '999', '20'], ['client', 'Sidecar']], content: 'x' };
    const out = minePowEvent(ev, 6, null);
    globalThis.nonces = out.event.tags.filter((t) => t[0] === 'nonce');
    globalThis.kept = out.event.tags.filter((t) => t[0] === 'client').length;
  `, ctx);
  assert.equal(ctx.nonces.length, 1, 'a stale nonce tag survived a re-mine');
  assert.equal(ctx.nonces[0][2], '6', 'and it is the new target, not the old one');
  assert.equal(ctx.kept, 1, 'other tags must be left alone');
});

test('zero difficulty finishes rather than spinning', () => {
  // Reachable if a stored powBits is ever 0. Every hash has at least zero leading zero
  // bits, so the first attempt wins; a loop written with > instead of >= would not stop.
  const ctx = miner();
  vm.runInContext(`
    const ev = { pubkey: 'a'.repeat(64), created_at: 1700000000, kind: 1, tags: [], content: 'x' };
    globalThis.attempts = minePowEvent(ev, 0, null).attempts;
  `, ctx);
  assert.equal(ctx.attempts, 1);
});

// ---- the four rungs --------------------------------------------------------------------

test('THE PANEL AND THE BACKGROUND AGREE ON THE RUNGS', () => {
  // Two copies exist on purpose: the panel's decides what is drawn, the background's
  // decides what is STORED, and the storage one is the one a miner then trusts. They are
  // pinned to each other here because a value the panel offers and the background clamps
  // away would be a level that silently does something else.
  const levels = panel.match(/const POW_LEVELS = \[([\s\S]*?)\];/);
  assert.ok(levels, 'POW_LEVELS is gone from the panel');
  const panelBits = [...levels[1].matchAll(/bits: (\d+)/g)].map((m) => Number(m[1]));
  const bgBits = JSON.parse(bg.match(/const POW_BITS = (\[[^\]]*\]);/)[1]);
  assert.deepEqual(panelBits, bgBits, 'the panel offers a level the background would clamp away');
  assert.deepEqual(panelBits, [16, 18, 20, 22]);

  // Each rung is two bits, which is four times the work. An uneven ladder would make
  // "one step up" mean something different at each end.
  for (let i = 1; i < panelBits.length; i++) {
    assert.equal(panelBits[i] - panelBits[i - 1], 2, 'the ladder must stay even');
  }

  // And the chips in the markup are those same four, in that order.
  const chips = [...panelHtml.matchAll(/data-bits="(\d+)">([^<]*)</g)];
  assert.deepEqual(chips.map((m) => Number(m[1])), panelBits, 'the settings chips drifted from POW_LEVELS');

  // LABELED IN BITS, WITH NO ADJECTIVE. A name is a second thing to map, and a relay
  // asking for proof of work states a number rather than a word. Pinned because the
  // obvious "improvement" here is to put Low/Medium/High back on, which reintroduces both
  // the mapping and the fact that four even rungs have no natural four-word ladder.
  for (const m of chips) {
    assert.equal(m[2].trim(), m[1], 'a chip is labeled with something other than its bits');
  }

  // A level carries what it COSTS, which is the half a bare number cannot say.
  const costs = [...levels[1].matchAll(/cost: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(costs.length, panelBits.length, 'every rung needs its cost written down');
  assert.ok(costs.every((c) => /\.$/.test(c)), 'costs read as sentences');
  assert.doesNotMatch(levels[1], /name:/, 'the adjective labels are meant to be gone');

  const panelDefault = Number(panel.match(/const POW_DEFAULT_BITS = (\d+);/)[1]);
  const bgDefault = Number(bg.match(/const POW_DEFAULT_BITS = (\d+);/)[1]);
  assert.equal(panelDefault, bgDefault, 'the two defaults disagree');
  assert.ok(panelBits.includes(panelDefault), 'the default must be one of the rungs');
});

test('IT IS PER ACCOUNT, AND OFF UNTIL ASKED FOR', () => {
  // What a mine costs is a judgment about one identity, so it lives in a pubkey-keyed map
  // like nip65OnlyBy and themeBy rather than as a flag on the flat settings object.
  // Absent means off, and the bits ARE the value: there is no separate enabled flag that
  // could drift out of step with the level it is meant to be gating.
  assert.doesNotMatch(bare, /powEnabled/, 'a global enabled flag is what per-account replaces');
  assert.match(bare, /const bits = \(\(s && s\.powBy\) \|\| \{\}\)\[pubkey\];/);
  assert.match(bare, /const powStored = \(\(settings\.powBy\) \|\| \{\}\)\[state\.activePubkey\];/);

  // The map is edited in the BACKGROUND. SIDECAR_SET_SETTINGS merges shallowly, so a
  // panel sending the whole map would clobber another account's choice, and two panels
  // racing would lose one. Same reason, same shape as the two maps beside it.
  assert.match(bare, /type: 'SIDECAR_SET_POW', pubkey: state\.activePubkey/);
  assert.doesNotMatch(bare, /SIDECAR_SET_SETTINGS', settings: \{ pow/, 'powBy must not be written from the panel');
  const set = bg.slice(bg.indexOf("case 'SIDECAR_SET_POW'"));
  const body = set.slice(0, set.indexOf('\n      }'));
  assert.match(body, /const map = \{ \.\.\.\(prev\.powBy \|\| \{\}\) \};/, 'it must merge, not replace');
  assert.match(body, /else delete map\[message\.pubkey\];/, 'off is an absent entry');

  // Pinned to the four rungs where it is STORED, not only where the chip is drawn: this
  // is the number the miner then trusts, and an arbitrary one is a mine that either costs
  // nothing or never finishes.
  assert.match(body, /POW_BITS\.includes\(bits\)/);
});

test('THE COMPOSER MINES FOR THE ACCOUNT IT WILL SIGN AS', () => {
  // openComposer fixes its account in `pubkey` when it opens, and the active account can
  // be switched underneath it while it stays open. Resolving the level from whatever is
  // active at post time would mine at one identity's setting and publish under another's,
  // which is the same class of mistake the per-site theme lookup had to be fixed for.
  assert.match(bare, /async function powSetting\(pubkey\)/);
  assert.match(bare, /let powForThisPost = await powSetting\(pubkey\);/);
  assert.doesNotMatch(bare, /powSetting\(state\.activePubkey\)/, 'that is the live account, not the one posting');
});

// ---- the wiring ------------------------------------------------------------------------

test('MINING HAPPENS BEFORE SIGNING, AND THE PUBKEY IT MINED FOR IS THE ONE THAT SIGNS', () => {
  const fn = bare.slice(bare.indexOf('async function doPublish'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  const mineAt = body.indexOf('minePow(');
  const signAt = body.indexOf('SIDECAR_OWNER_SIGN');
  assert.ok(mineAt > -1, 'the composer never mines');
  assert.ok(signAt > -1 && mineAt < signAt, 'mining after signing would invalidate the signature');

  // The id commits to the pubkey, so the miner has to use the key that will sign. It is
  // handed the same one passed as expectedPubkey, which ownerSign refuses to sign under
  // if the active account moved, so work can never be spent on one identity and published
  // under another.
  assert.match(body, /minePow\(\{ \.\.\.event, pubkey \}/);
  assert.match(body, /expectedPubkey: pubkey/);
  // And it is dropped again before sending, so our copy cannot disagree with the signer's.
  assert.match(body, /const \{ pubkey: _mined, \.\.\.rest \} = mined\.event;/);
});

test('the worker hashes through getEventHash, not a second serialization', () => {
  // The id it mines has to equal the one finalizeEvent recomputes. Reimplementing the
  // NIP-01 serialization here to skip its per-call validateEvent was measured at 1.2x,
  // which does not buy a second copy of the one thing that must never disagree.
  assert.match(workerSrc, /NostrTools\.getEventHash\(ev\)/);
  assert.match(workerSrc, /importScripts\('nostr-tools\.js'\)/);
  assert.doesNotMatch(workerSrc.replace(/^\s*\/\/.*$/gm, ''), /JSON\.stringify\(\[0,/,
    'the worker must not serialize events itself');
});

test('cancel terminates the worker rather than asking it to stop', () => {
  // The mining loop never yields, so a stop message would sit unread in the queue until
  // the work it was meant to interrupt had already finished.
  const fn = bare.slice(bare.indexOf('function powCancel('));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /powWorker\.terminate\(\);/);
  assert.match(body, /powWorker = null;/, 'the next mine needs a fresh worker');
  assert.match(body, /powWorkerSettleAll\(/, 'a canceled mine must settle, not hang');

  // And a worker that fails to load settles too, or the composer sits on "Mining" for ever.
  const onerr = bare.slice(bare.indexOf('powWorker.onerror'));
  assert.match(onerr.slice(0, 400), /powWorkerSettleAll\(/);
});

test('the worker file is packaged', () => {
  // It is loaded with chrome.runtime.getURL, so it has to survive scripts/package.sh.
  // That drops test/ and *.md; a new top-level .js is kept, but this is the assertion
  // that fails loudly if the packaging rules ever change under it.
  assert.match(bare, /new Worker\(chrome\.runtime\.getURL\('pow-worker\.js'\)\)/);
  assert.ok(fs.existsSync(path.join(ROOT, 'pow-worker.js')));
  const pkg = fs.readFileSync(path.join(ROOT, 'scripts/package.sh'), 'utf8');
  assert.doesNotMatch(pkg, /pow-worker/, 'the packager must not be excluding it');
});

test('A FAILED OR STOPPED POST GOES BACK TO BEING A DRAFT', () => {
  // Mining can hold a post for the better part of a minute and publishing can fail after
  // it, so the window in which the only copy of a note lives in a 400ms debounce is
  // exactly the window this feature made longer. finishPublish flushes it before trying.
  const fn = bare.slice(bare.indexOf('async function finishPublish'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  const flush = body.indexOf('persistDraft();');
  const attempt = body.indexOf('await doPublish()');
  assert.ok(flush > -1, 'the draft is never written before the attempt');
  assert.ok(attempt > -1 && flush < attempt, 'the flush must happen BEFORE the attempt');
  assert.match(body, /if \(saveTimer\) \{ clearTimeout\(saveTimer\); saveTimer = null; \}/,
    'a pending debounce would fire again after the draft was cleared');

  // Every failure path lands back in the editor, and the draft is only cleared on the
  // success path, so the note is still there to retry or edit.
  assert.match(body, /showEditor\(\);/, 'a failure must return to the editor');
  const cleared = body.indexOf('clearComposeDraft(dkey)');
  const caught = body.indexOf('} catch');
  assert.ok(cleared > -1 && cleared < caught, 'the draft may only be cleared once it is published');

  // A stopped mine is a decision, not a fault, and must not be reported as one.
  assert.match(body, /if \(!\(e && e\.canceled\)\) toast\(e\.message, 'error'\);/);
  const cancelFn = bare.slice(bare.indexOf('function powCancel('));
  assert.match(cancelFn.slice(0, cancelFn.indexOf('\n  }')), /stopped\.canceled = true;/,
    'cancel has to be distinguishable from a mine that broke');
});

test('the three add buttons share a row, and it wraps rather than shrinks', () => {
  // Media, Poll and PoW are peers, so they read as a toolbar rather than three stacked
  // decisions. Short labels are what makes that fit: "Media", "Poll", "PoW 18".
  assert.match(bare, /h\('div', \{ className: 'compose-actions' \}, \[addBtn, pollAdd, powBtn\]\)/);
  const row = css.slice(css.indexOf('.compose-actions {'));
  const decls = row.slice(0, row.indexOf('}'));
  assert.match(decls, /display: flex/);
  assert.match(decls, /flex-wrap: wrap/, 'at the narrow end a button must drop, not squash');

  // The panel's standing rule: nothing fits by being made smaller. The poll button is
  // absent on a reply and once a poll is open, so this is a row of two or three, and a
  // font-size or padding override here would be the shrink that rule forbids.
  const addRule = css.slice(css.indexOf('.compose-add {'));
  const addDecls = addRule.slice(0, addRule.indexOf('}'));
  assert.doesNotMatch(addDecls, /font-size|padding/, 'compose-add must not shrink itself to fit the row');

  // THEY SPAN THE ROW at whatever count is showing, two or three, so the toolbar reaches
  // the same edge the Post button below it does instead of stopping short.
  //
  // `flex: 1 0 auto` and not `flex: 1`. Both grow; only the second also lets a button
  // shrink BELOW its label, which is the one thing this panel never does. With shrink at
  // zero an impossible row wraps, and the wrapped line spans in its turn.
  assert.match(addDecls, /flex: 1 0 auto/, 'the buttons must fill the row, and never squash');
  assert.doesNotMatch(addDecls, /flex: 1;/, 'flex: 1 would let a label be shaved to fit');
  assert.match(addDecls, /justify-content: center/, 'a grown button centers what is in it');

  // Both PoW states are the same width, so cycling never makes the row reflow under the
  // thumb that is cycling it.
  assert.match(bare, /'PoW ' \+ lvl\.bits : 'PoW off'/);
});

test('the proof-of-work icon does not mean something else already', () => {
  // badge-check is NIP-05 verification in this panel and bar-chart is polls, which is the
  // button sitting next to this one, so neither was available. A pickaxe rather than the
  // hash it computes: a button needs the verb, and a # reads as a tag everywhere else on
  // nostr, which is the one thing it must not be taken for here.
  assert.match(bare, /powBtn\.append\(icon\('pickaxe'\), powBtnLabel\)/);
  assert.match(panel, /^\s+pickaxe: '<path /m, 'the pickaxe glyph is missing from ICONS');
  // Three uses, and all three are proof of work: the composer's button, the mining
  // pane's glyph, and the footer bar a minimized mine draws. The assertion is that
  // nothing ELSE adopts it, since a shape meaning two things is exactly why badge-check
  // was unavailable.
  const uses = (panel.match(/icon\('pickaxe'\)/g) || []).length;
  assert.equal(uses, 3, 'the pickaxe means proof of work here and nothing else');
  assert.match(bare, /const glyph = icon\('pickaxe'\);\n\s+glyph\.classList\.add\('mining-glyph'\);/);
});

test('MINING OWNS THE MODAL, BECAUSE THE COUNTDOWN WIPES IT', () => {
  // showPostCountdown opens with modal.innerHTML = '', and the countdown is ON by default.
  // A status row built into the editor is therefore already detached by the time mining
  // starts on the common path, which left it showing "Posting…" for up to a minute with
  // no elapsed time, no difficulty reached, and a Stop button that had been thrown away.
  // The pane takes the modal the same way the countdown does, so both paths land in it.
  assert.match(bare, /function showMiningPane\(bits, minePubkey\)/);
  const fn = bare.slice(bare.indexOf('function showMiningPane('));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.match(body, /modal\.innerHTML = '';/, 'the pane has to own the modal, not sit in the editor');
  assert.match(body, /stopCountdown\(\);/, 'the countdown must not keep ticking underneath it');
  assert.match(body, /textContent: 'Stop mining'/);
  assert.match(body, /stop\.addEventListener\('click', powCancel\)/, 'stop must be reachable on both paths');

  // Its own clock. Worker reports arrive per block of attempts, so on a slow machine they
  // can be seconds apart, and a pane that only repainted with them would look frozen at
  // exactly the difficulty where the user most needs to see it is alive.
  assert.match(body, /setInterval\(paint, 1000\)/);
  assert.match(body, /clearInterval\(timer\)/, 'and it has to stop when the mine does');

  // Held back briefly: at 16 bits a mine is about a quarter of a second, and a pane that
  // appears and vanishes inside that reads as a glitch rather than as work.
  const pub = bare.slice(bare.indexOf('async function doPublish'));
  const pubBody = pub.slice(0, pub.indexOf('\n    }'));
  assert.match(pubBody, /setTimeout\(\(\) => \{ pane = showMiningPane\(powForThisPost\.bits, pubkey\); \}, 300\)/);
  assert.match(pubBody, /clearTimeout\(showPane\);/, 'a fast mine must never leave the timer armed');
});

test('the pane stops claiming to mine once it has', () => {
  // Signing and the relays still have to happen after the work is found, and a pane still
  // offering to stop the mining it already finished offers something that is not there.
  const fn = bare.slice(bare.indexOf('function showMiningPane('));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.match(body, /stop\.disabled = true;/);
  assert.match(body, /line\.textContent = 'Found it\. Posting…';/);
});

test('THE MINING GLYPH IS SIZED ON ITSELF, NOT AS A DESCENDANT', () => {
  // icon() returns the <svg>, not a wrapper, so a class added to its result lands on the
  // svg. `.mining-glyph svg` therefore matches nothing, and an svg no rule sizes falls
  // back to the default replaced-element size and renders enormous. That shipped: a
  // giant pickaxe at the foot of the mining pane.
  //
  // The rest of the panel styles icons through a CONTAINER (.compose-add svg), which is
  // why the descendant-shaped selector was the wrong instinct to copy. Every other class
  // added straight to an icon() result here already has a direct rule.
  assert.match(bare, /glyph\.classList\.add\('mining-glyph'\)/);
  assert.doesNotMatch(css, /\.mining-glyph\s+svg\s*\{/, 'that selector can never match');
  const rule = css.slice(css.indexOf('.mining-glyph {'));
  const decls = rule.slice(0, rule.indexOf('}'));
  assert.match(decls, /width: 40px/, 'an unsized svg renders at the default replaced size');
  assert.match(decls, /height: 40px/);

  // The button's icon is the other shape and stays that way: there the class is on the
  // BUTTON and the svg is its child, so a descendant selector is correct.
  assert.match(css, /\.compose-add svg \{[^}]*width: 15px/);
});

test('A MINE DOES NOT OUTLIVE A COMPOSER THAT WAS WALKED AWAY FROM', () => {
  // The worker keeps hashing after the modal closes, and doPublish resumes on the other
  // side of that await to sign and publish a note the user has already walked away from.
  // The countdown has always been stopped in onClose for the same reason; this is the
  // same hazard with a much longer fuse.
  //
  // MINIMIZING IS THE ONE EXCEPTION, and it is an exception to the UI rather than to the
  // hazard: the footer bar is on screen saying a post is still coming, and its Stop is
  // the only way out. So closing still cancels, and the flag that says otherwise must be
  // true for no longer than the closeModal call it wraps. A flag left set would turn
  // every later close into a silent publish, which is the original bug with a worse fuse.
  assert.match(bare, /stopCountdown\(\);\s*\n\s*if \(!powMinimizing\) powCancel\(\);/,
    'closing the composer must abandon the mine, beside stopping the countdown');

  const mini = bare.slice(bare.indexOf('mini.addEventListener'));
  const body = mini.slice(0, mini.indexOf('});') + 3);
  assert.match(body, /powMinimizing = true;\s*\n\s*closeModal\(\);\s*\n\s*powMinimizing = false;/,
    'the minimize flag has to be cleared on the same tick it was set');
  assert.match(body, /beginMinimizedMine\(bits, minePubkey, startedAt, best\)/,
    'the bar must be up BEFORE the modal goes, or the mine is invisible for a frame');

  // Withdrawn in done(), which doPublish calls from a finally, so it covers cancel and
  // success alike: minimizing a mine that has already finished buys a footer bar that
  // lives for as long as signing takes and says a post is still being mined.
  const pane = bare.slice(bare.indexOf('function showMiningPane('));
  const paneBody = pane.slice(0, pane.indexOf('\n    }'));
  assert.match(paneBody, /hide\(mini\);/);

  // And cancelling when nothing is in flight leaves the warm worker alone, since this now
  // runs on EVERY composer close and a Low mine should not pay to reload nostr-tools.
  const fn = bare.slice(bare.indexOf('function powCancel('));
  assert.match(fn.slice(0, fn.indexOf('\n  }')), /if \(!powPending\.size\) return;/);
});

test('the minimize offer costs the pane no height and no wait', () => {
  // As a worded button under Stop it was held back three seconds and grew the pane under
  // the pointer when it landed, on the one screen whose whole job is to look calm while
  // it makes you wait. The corner slot .modal-x defines is absolute, so it is out of
  // flow: it costs no height, which is what lets it be there from the start.
  const pane = bare.slice(bare.indexOf('function showMiningPane('));
  const paneBody = pane.slice(0, pane.indexOf('\n    }'));
  assert.match(paneBody, /const mini = h\('button', \{ className: 'modal-x mining-mini'/);

  const slot = css.slice(css.indexOf('.modal-x {'), css.indexOf('.modal-x:hover'));
  assert.match(slot, /position: absolute/, 'in flow, the button would move everything below it');

  // NO DELAY, and no hiding it to build one. The delay existed because the reveal was a
  // layout event; with nothing to move, a control that is missing when you reach for it
  // is the worse failure, and the pane's own 300ms already filters out every mine too
  // short to be worth escaping.
  assert.ok(!/MINIMIZE_OFFER/.test(bare), 'the reveal delay came back');
  assert.ok(!/mining-mini hidden/.test(bare), 'the offer must not start hidden');
  assert.ok(!/show\(mini\)/.test(paneBody), 'the offer must not be revealed on a timer');

  // And it is not a third button in the stack: .actions holds Stop alone.
  assert.match(paneBody, /className: 'actions' \}, \[stop\]/);

  // A chevron, not an X. It does not close anything, it sends the mine to the bar at the
  // foot of the panel, which is the direction it points. The X in this slot everywhere
  // else means "gone", and on a mine that reading costs the post.
  assert.match(paneBody, /mini\.append\(icon\('chevron-down'\)\)/);
  assert.doesNotMatch(paneBody, /icon\('x'\)/);
  // Icon only, so it says what it is to a screen reader and on hover.
  assert.match(paneBody, /title: 'Keep mining in the background'/);
  assert.match(paneBody, /mini\.setAttribute\('aria-label', 'Keep mining in the background'\)/);
});

// ---- a mine that has left the composer ---------------------------------------------

test('THE BAR IS THE PROMISE THAT A POST IS STILL COMING', () => {
  // Minimizing does not move the mine. The worker was always module scope and always
  // outlived its pane; what never existed was anything on screen saying so. Without the
  // bar, "keep mining in the background" is indistinguishable from losing the post.
  assert.match(bare, /function renderMiningStatus\(\)/);
  assert.match(bare, /function beginMinimizedMine\(bits, pubkey, startedAt, best\)/);
  assert.match(bare, /function endMinimizedMine\(\)/);

  const begin = bare.slice(bare.indexOf('function beginMinimizedMine('));
  assert.match(begin.slice(0, begin.indexOf('\n  }')), /setComposeLocked\(true\)/);
  const end = bare.slice(bare.indexOf('function endMinimizedMine('));
  const endBody = end.slice(0, end.indexOf('\n  }'));
  assert.match(endBody, /clearInterval\(miningStatus\.tick\)/, 'the clock outlives the bar');
  assert.match(endBody, /setComposeLocked\(false\)/);
});

test('NO PROGRESS TRACK, UNLIKE THE RELAX BAR IT SITS ON', () => {
  // The relax bar has a fill because a timer genuinely runs down. Proof of work has
  // nothing to fill: every attempt is independent, so a mine running twice as long as
  // average is no nearer than one that just started. A bar creeping rightwards would be
  // a lie about the only question the user is asking, which is whether to keep waiting.
  const rule = css.slice(css.indexOf('.mining-status {'), css.indexOf('.relax-status {'));
  assert.ok(!/mining-status-fill|mining-status-track/.test(rule), 'a progress track appeared');
  assert.ok(!/mining-status-fill/.test(html), 'a progress track appeared in the markup');
  // And the relax bar still has its own, so this is a deliberate difference rather than
  // something that fell off both.
  assert.match(css, /\.relax-status-fill \{/);

  // What it has INSTEAD is the pane's own pulse. Minimizing moves the work, not its
  // nature: a still pickaxe over numbers that tick once a second reads as stalled, and a
  // spinner or a sweep would claim the progress this feature deliberately refuses to
  // draw. Same keyframes as the pane, so the two cannot drift apart.
  assert.match(css, /\.mining-status-glyph svg \{[^}]*animation: mining-pulse/);
  assert.match(css, /\.mining-glyph, \.mining-status-glyph svg \{ animation: none;/,
    'the footer pulse has to honor prefers-reduced-motion like the pane does');
});

test('BOTH CONTROLS THAT COULD RUIN THE MINE GO INERT', () => {
  // The composer, because one worker hashing two jobs halves both and the second reads
  // as broken rather than slow. The account switcher, because the event id commits to
  // the pubkey: switching is already safe, in that ownerSign refuses and the draft
  // survives, but safe means the post FAILS after the work is done. Minimizing turns a
  // rare race into an easy mistake.
  const fn = bare.slice(bare.indexOf('function setComposeLocked('));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /\$\('compose-fab'\)/);
  assert.match(body, /\$\('acct-btn'\)/);
  assert.match(body, /fab\.disabled = locked/);
  // Unlocking must not enable a switcher that was disabled for its own reason: with no
  // accounts the chip is inert regardless.
  assert.match(body, /acct\.disabled = locked \|\| !\(\(state && state\.accounts\) \|\| \[\]\)\.length/);
});

test('the bar is retired on every way out', () => {
  // Three exits: it published, it failed, or Stop was pressed. A bar left up after any of
  // them claims a post is coming that is not, and keeps the composer locked forever.
  const pub = bare.slice(bare.indexOf('async function doPublish'));
  assert.match(pub, /endMinimizedMine\(\); \/\/ no-op unless this one was minimized/);
  assert.match(pub, /const wasMinimized = !!miningStatus;\s*\n\s*endMinimizedMine\(\);/);
  // Stop goes through powCancel, which rejects the pending promise and lands in the
  // catch above, so there is one retirement path rather than two.
  assert.match(bare, /miningStop\.addEventListener\('click', \(\) => powCancel\(\)\)/);
});

test('a minimized failure does not rebuild an editor that is gone', () => {
  // showEditor writes into the composer's modal. Minimized, that modal is closed, so the
  // user would get a toast and no route back to their text. The draft is force-written
  // before publishing, so reopening the composer offers it through the resume prompt.
  const pub = bare.slice(bare.indexOf('async function doPublish'));
  assert.match(pub, /if \(!wasMinimized\) showEditor\(\);/);
});

test('a locked control cannot be re-lit by hovering it', () => {
  // A disabled button still matches :hover in CSS; it only stops taking the click. Both
  // of these had a :hover rule declared AFTER their :disabled rule at equal specificity,
  // so the FAB lifted and went back to full opacity under the pointer and the account
  // chip still highlighted, each of them advertising an action that would not happen.
  // Guarding the state rather than racing it also means a rule added below cannot undo
  // this by accident.
  assert.match(css, /\.fab:not\(:disabled\):hover \{/);
  assert.match(css, /\.fab:not\(:disabled\):active \{/);
  assert.match(css, /\.acct-chip:not\(:disabled\):hover \{/);
  assert.ok(!/^\.fab:hover \{/m.test(css), 'an unguarded .fab:hover is back');
  assert.ok(!/^\.acct-chip:hover \{/m.test(css), 'an unguarded .acct-chip:hover is back');
});

test('THE BAR IS TOLD APART FROM THE RELAX BAR WITHOUT A SECOND ANIMATION', () => {
  // The two sit on top of each other, are built alike, and mean opposite things: one is
  // a window running down, this is work with no end in view. The obvious fix was to
  // shimmer the line, and loading-indicators.test.js refuses it for a good reason: that
  // idiom is for a value with no room for an indicator beside it, and this line has a
  // pulsing pickaxe two millimetres away. Two animations in a 40px bar is busy.
  const rule = css.slice(css.indexOf('.mining-status {'), css.indexOf('.mining-status.hidden'));
  assert.match(rule, /border-top: 1px solid var\(--gold-soft\)/, 'the two bars share an edge color');
  assert.match(rule, /rgba\(var\(--accent-rgb\)/, 'the wash has to be a token, not a literal');
  // --accent-rgb specifically: the relax bar's own comment records that colors tuned for
  // a dark surface vanish on a light theme, and every theme redefines this one.
  assert.ok(!/rgba\(\d+, *\d+, *\d+/.test(rule), 'a hardcoded color will disappear on the light themes');
  // And the line itself stays still.
  assert.ok(!/t-shimmer/.test(css.slice(css.indexOf('.mining-status-line'), css.indexOf('.mining-status-who'))),
    'the mining line shimmers as well as pulsing');
});

test('A MINE DISABLES THE WAYS IN, IT DOES NOT REFUSE AT THE DOOR', () => {
  // The first cut let Reply be pressed and then refused with "stop it first", which
  // closed the notifications sheet on the way (the handler calls closeModal BEFORE
  // openComposer) and told the user to throw away a minute of work to do something else.
  // The buttons go inert instead, and the bell stays open.
  assert.match(bare, /replyBtn\.classList\.add\('needs-composer'\)/);
  assert.match(bare, /notif-repost-choice needs-composer/, 'Quote opens the composer too');
  assert.match(bare, /document\.querySelectorAll\('\.needs-composer'\)\.forEach\(\(b\) => \{ b\.disabled = locked; \}\)/);
  // Rows are built and thrown away as the bell paginates, so a row created while a mine
  // is already running has to come up inert on its own.
  assert.match(bare, /if \(miningStatus\) \{ replyBtn\.disabled = true; quoteNow\.disabled = true; \}/);

  // The rest of the bell keeps working: none of these needs the composer.
  for (const other of ['reactBtn', 'repostNow', 'zapBtn', 'bmBtn']) {
    const at = bare.indexOf('const ' + other);
    assert.ok(at > -1, other + ' is gone');
    assert.ok(!/needs-composer/.test(bare.slice(at, at + 160)), other + ' should not be locked by a mine');
  }

  // The door guard stays as a backstop, and says nothing.
  const fn = bare.slice(bare.indexOf('async function openComposer('));
  const head = fn.slice(0, fn.indexOf('const pubkey = state.activePubkey;'));
  assert.match(head, /if \(miningStatus\) return;/);
  assert.ok(!/Stop it first/.test(head), 'the backstop must not tell anyone to stop mining');

  // And a disabled action must not light up under the pointer, same trap as the FAB.
  assert.match(css, /\.notif-act:not\(:disabled\):hover/);
  assert.match(css, /\.notif-act:disabled, \.notif-repost-choice:disabled \{[^}]*opacity/);
});

test('A RE-RENDER CANNOT HAND BACK THE CONTROLS A MINE TOOK', () => {
  // renderMain runs on almost anything and sets acct-btn.disabled and compose-fab.disabled
  // from hasAccounts alone, so any re-render quietly unlocked both mid-mine. The lock is
  // re-applied at the end of that function rather than guarded at each line, so a control
  // added later is covered by being written the ordinary way.
  const fn = bare.slice(bare.indexOf('function renderMain()'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  const reassert = body.indexOf('if (miningStatus) setComposeLocked(true);');
  assert.ok(reassert > -1, 'renderMain does not re-apply the mining lock');
  assert.ok(reassert > body.indexOf("$('compose-fab').disabled"), 'the lock must be re-applied AFTER the disabled flags are written');
  assert.ok(reassert > body.indexOf("$('acct-btn').title"), 'and after the title is written, or it is clobbered too');
});

test('LOCKING THE KEYSTORE STOPS THE MINE', () => {
  // The bar lives inside view-main, so locking hid it while the worker kept hashing. The
  // mine then finished into "Keystore is locked" minutes later, on a screen where nobody
  // sees the toast, having spent the whole wait for nothing. Lock is a security boundary
  // that already tears down the composer; a mine is composer work.
  const at = bare.indexOf('} else if (state.locked) {');
  assert.ok(at > -1, 'the lock branch moved');
  const branch = bare.slice(at, bare.indexOf('show($(\'view-lock\'))', at));
  assert.match(branch, /powCancel\(\);/, 'a mine survives the lock and fails later');
  assert.match(branch, /endMinimizedMine\(\);/, 'the bar is left ticking behind the lock screen');
  // Cancelling is silent: the publish catch treats a deliberate stop as no news, so the
  // user is not told off for locking their own panel.
  assert.match(bare, /if \(!\(e && e\.canceled\)\) toast\(e\.message, 'error'\);/);
});

test('an unavailable control says so with the pointer', () => {
  // Reply and Quote are only ever disabled by a mine, so they can carry not-allowed
  // unconditionally. The FAB and the account chip are also inert before any account
  // exists, where a "no entry" pointer would be scolding someone mid-onboarding, so
  // those are scoped to the root class a mine sets.
  assert.match(css, /\.notif-act:disabled, \.notif-repost-choice:disabled \{[^}]*cursor: not-allowed/);
  assert.match(css, /\.mining-locked \.fab:disabled,\s*\n\.mining-locked \.acct-chip:disabled \{ cursor: not-allowed; \}/);
  assert.match(bare, /document\.documentElement\.classList\.toggle\('mining-locked', locked\)/);
  // The unscoped rules keep their own cursor, so onboarding is unchanged.
  assert.match(css, /\.fab:disabled \{[^}]*cursor: default/);
  assert.match(css, /\.acct-chip:disabled \{ cursor: default; \}/);
});
