'use strict';

// NIP-38 user status, kind 30315.
//
// An addressable event whose `d` tag names the TYPE of status, not an id, so each
// account has one per type and every new one replaces the last. Two things in the
// spec are easy to get wrong and both lose data when you do:
//
//   1. Empty content IS the clear. Not a kind:5 deletion request, which relays may
//      ignore and which leaves readers holding the old text regardless. Publishing
//      empty content replaces the addressable event wherever it already sits.
//   2. An expired event is not a status. Relays are asked to drop them and are not
//      required to, so a reader that trusts the event's presence shows "In a
//      meeting" for hours after the meeting.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
// composer-core.js is loaded beside the panel: the DOM toolkit moved there so the
// expanded composer page could share it rather than keep a second copy of 55 icons.
// Both files are the panel's source as far as these assertions are concerned.
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8') +
  '\n' + fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');

// The body brace, not the first one. `function statusEvent({ text, url }, now) {`
// destructures in the parameter list, so anchoring on the first `{` lifts the
// parameter object and stops there, yielding a fragment that won't parse.
function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  // Walk the parameter list to its matching `)`, then take the next `{`.
  let paren = 0;
  let i = source.indexOf('(', at);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const ctx = { console, JSON, Number, String, Math, Date };
vm.createContext(ctx);
vm.runInContext(
  [
    source.match(/const STATUS_KIND = \d+;/)[0],
    source.match(/const STATUS_D = '[^']*';/)[0],
    source.match(/const STATUS_DURATIONS = \[[\s\S]*?\];/)[0],
    lift('function statusEvent('),
    lift('function readStatus('),
    'globalThis.out = { statusEvent, readStatus, STATUS_KIND, STATUS_D, STATUS_DURATIONS };',
  ].join('\n'),
  ctx
);
const { statusEvent, readStatus, STATUS_KIND, STATUS_D, STATUS_DURATIONS } = ctx.out;

const NOW = 1_800_000_000;
// Array.from on BOTH levels, not filter().map(). The event is built inside the vm,
// so its arrays carry that realm's Array.prototype, and ArraySpeciesCreate keeps
// filter/map results in the same realm — which deepEqual rejects on prototype
// identity even when the contents match exactly.
const tagsOf = (ev, name) =>
  Array.from(ev.tags).filter((t) => t[0] === name).map((t) => Array.from(t));

// ---- the event shape ------------------------------------------------------------

test('it is an addressable kind 30315 keyed on the status type', () => {
  const ev = statusEvent({ text: 'Working' }, NOW);
  assert.equal(ev.kind, 30315);
  assert.equal(STATUS_KIND, 30315);
  // The d tag is the TYPE, shared by every status this account publishes, which is
  // what makes each one replace the last rather than pile up.
  assert.deepEqual(tagsOf(ev, 'd'), [['d', 'general']]);
  assert.equal(STATUS_D, 'general');
});

test('the content is the status text, trimmed', () => {
  assert.equal(statusEvent({ text: '  Hiking  ' }, NOW).content, 'Hiking');
});

test('an optional link rides an r tag', () => {
  const ev = statusEvent({ text: 'At the nest', url: 'https://nostrnests.com' }, NOW);
  assert.deepEqual(tagsOf(ev, 'r'), [['r', 'https://nostrnests.com']]);
});

test('no link means no r tag at all, not an empty one', () => {
  for (const url of [undefined, '', '   ']) {
    assert.deepEqual(tagsOf(statusEvent({ text: 'Working', url }, NOW), 'r'), [], JSON.stringify(url));
  }
});

// ---- expiry ---------------------------------------------------------------------

test('a duration becomes an absolute expiration timestamp', () => {
  const ev = statusEvent({ text: 'Back in an hour', seconds: 3600 }, NOW);
  assert.deepEqual(tagsOf(ev, 'expiration'), [['expiration', String(NOW + 3600)]]);
});

test('no expiry means no expiration tag', () => {
  for (const seconds of [0, undefined, null, NaN]) {
    assert.deepEqual(tagsOf(statusEvent({ text: 'Working', seconds }, NOW), 'expiration'), [], String(seconds));
  }
});

test('THE DEFAULT DURATION IS NO EXPIRY', () => {
  // The UI selects the first entry. A status that silently evaporates would be
  // worse than one that lingers: you would not know it had gone.
  assert.equal(STATUS_DURATIONS[0].seconds, 0);
});

// ---- clearing -------------------------------------------------------------------

test('EMPTY CONTENT IS THE CLEAR', () => {
  // The whole boundary. Not a deletion request.
  const ev = statusEvent({ text: '' }, NOW);
  assert.equal(ev.kind, 30315, 'still a status event, not a kind 5');
  assert.equal(ev.content, '');
  assert.deepEqual(tagsOf(ev, 'd'), [['d', 'general']], 'same d tag, so it replaces');
});

test('a clear never carries an expiration', () => {
  // An expiry on an empty status asks relays to eventually drop the very event
  // that says "no status", which resurrects whatever it replaced.
  const ev = statusEvent({ text: '', seconds: 3600 }, NOW);
  assert.deepEqual(tagsOf(ev, 'expiration'), []);
});

test('a whitespace-only status clears rather than publishing blanks', () => {
  assert.equal(statusEvent({ text: '   ' }, NOW).content, '');
});

// ---- reading back ---------------------------------------------------------------

test('a live status reads back with its text and link', () => {
  const st = readStatus({ content: 'Working', created_at: NOW, tags: [['d', 'general'], ['r', 'https://x.test']] }, NOW);
  assert.equal(st.text, 'Working');
  assert.equal(st.url, 'https://x.test');
  assert.equal(st.expiresAt, 0);
});

test('AN EXPIRED EVENT IS NOT A STATUS', () => {
  // Relays are asked to drop expired events, not required to. Trusting the
  // event's presence shows a status hours after it should have gone.
  const ev = { content: 'In a meeting', created_at: NOW - 7200, tags: [['d', 'general'], ['expiration', String(NOW - 60)]] };
  assert.equal(readStatus(ev, NOW), null);
});

test('an expiry still in the future is live, and is reported', () => {
  const ev = { content: 'In a meeting', created_at: NOW, tags: [['d', 'general'], ['expiration', String(NOW + 60)]] };
  const st = readStatus(ev, NOW);
  assert.ok(st);
  assert.equal(st.expiresAt, NOW + 60);
});

test('an empty event reads as no status', () => {
  assert.equal(readStatus({ content: '', created_at: NOW, tags: [['d', 'general']] }, NOW), null);
  assert.equal(readStatus(null, NOW), null);
  assert.equal(readStatus(undefined, NOW), null);
});

test('a malformed expiration does not hide a live status', () => {
  // Number('') is 0 and Number('soon') is NaN; either must mean "no expiry"
  // rather than "expired at the epoch", which would blank a real status.
  for (const bad of ['', 'soon', undefined]) {
    const ev = { content: 'Working', created_at: NOW, tags: [['d', 'general'], ['expiration', bad]] };
    assert.ok(readStatus(ev, NOW), JSON.stringify(bad));
  }
});

// ---- scope ----------------------------------------------------------------------

test('only the general type is written', () => {
  // `music` is meant to be published by whatever is playing the track, with an
  // expiry matching when it stops. A signer has no media player to read, and a
  // hand-typed music status is a worse version of what a music client does.
  assert.doesNotMatch(source, /\bSTATUS_D\s*=\s*'music'/);
  const fn = lift('function statusEvent(');
  assert.match(fn, /\['d', STATUS_D\]/, 'the d tag is always the one constant');
});

test('the status fetch asks only for the active account', () => {
  const fn = lift('async function fetchStatus(');
  assert.match(fn, /authors: \[pubkey\]/, 'scoped to one pubkey');
  assert.match(fn, /'#d': \[STATUS_D\]/, 'and to the general status');
  assert.doesNotMatch(fn, /follows|contacts|kinds: \[3\]/, 'never reads anyone else');
});

// ---- where it lives ---------------------------------------------------------------

test('THE STATUS IS NOT A SECTION ON THE PROFILE TAB', () => {
  // It is a remark, not a profile field. A labelled section with a text input, a
  // link input, a duration select and two buttons made the tab read like a
  // settings screen — which is what the first version of this did.
  assert.doesNotMatch(source, /renderStatusSection/, 'the form section is back');
  assert.doesNotMatch(
    fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'),
    /\.status-setting\b/,
    'the form section styles are back'
  );
});

test('the balloon rides on the banner and truncates rather than growing', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const balloon = css.match(/^\.status-balloon \{[^}]*\}/m)[0];
  assert.match(balloon, /position:\s*absolute/, 'not positioned over the banner');
  // .profile-header is position:relative for the avatar overlap; the balloon rides
  // the same containing block.
  assert.match(css, /^\.profile-header \{[^}]*position:\s*relative/m, '.profile-header is no longer the containing block');
  const text = css.match(/^\.status-balloon-text \{[^}]*\}/m)[0];
  assert.match(text, /text-overflow:\s*ellipsis/, 'a long status would grow the balloon over the avatar');
  assert.match(text, /min-width:\s*0/, 'without min-width:0 the flex child cannot shrink to ellipsize');
  // The balloon sits directly above the avatar with only the tail between them, so
  // wrapping to a second line grows downward into the face.
  assert.match(text, /white-space:\s*nowrap/, 'the status can wrap to a second line');
  assert.match(balloon, /max-width:\s*calc\(100% - \d+px\)/, 'the balloon can reach the banner edges');
});

test('THE BALLOON IS RINGED WITH A TEXT-GRADE TOKEN, NOT AN EDGE TOKEN', () => {
  // --border-strong and --gold-soft are alpha tokens tuned for edges on a flat
  // panel. On Cast Iron they are 5.5% and 12%, which measured 2.2:1 against the
  // banner — under the 3:1 a UI boundary needs — and the fill contributes nothing,
  // because the card gradient and the banner placeholder are both built from
  // --velvet-1. --muted is opaque and every theme guarantees it reads against its
  // own background, which took the same measurement to 8.3:1 dark and 6.5:1 light.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const balloon = css.match(/^\.status-balloon \{[^}]*\}/m)[0];
  assert.match(balloon, /border:\s*1px solid var\(--muted\)/, 'the ring is not a text-grade token');
  assert.doesNotMatch(balloon, /border:\s*1px solid var\(--(border-strong|gold-soft|border)\)/, 'the ring went back to an alpha edge token');
  // And it must not fall back to the page colour, which is what it floats on.
  assert.doesNotMatch(balloon, /background:\s*var\(--bg\)/, 'the balloon fill is the page background again');
});

test('HOVER CARRIES THE TAIL, AND BRIGHTENS RATHER THAN FADES', () => {
  // Two bugs shipped in one line here. The tail is a separate pseudo-element, so a
  // hover rule on the box alone leaves the outline broken where the tail joins it.
  // And the old hover went to --gold-soft, an alpha edge token that is 12% on Cast
  // Iron, so pointing at the balloon made it *harder* to see.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const hover = css.match(/^\.status-balloon:not\(\.peek-status\):hover \{[^}]*\}/m);
  assert.ok(hover, 'no hover state');
  assert.match(hover[0], /border-color:\s*var\(--text-2\)/, 'hover does not brighten the ring');
  assert.doesNotMatch(hover[0], /--gold-soft|--border-strong/, 'hover fades the ring to an alpha edge token');
  assert.match(
    css, /^\.status-balloon:not\(\.peek-status\):hover::before \{[^}]*border-top-color:\s*var\(--text-2\)/m,
    'the tail does not follow the box on hover'
  );
});

test('SOMEONE ELSE\'S STATUS IS NOT INTERACTIVE', () => {
  // Your own status opens an editor when tapped. Theirs is a fact you are reading,
  // so it takes no pointer and no hover treatment — an affordance that leads
  // nowhere is worse than none.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /^\.peek-status \{[^}]*cursor:\s*default/m, 'the read-only status still shows a pointer');
  // The exclusion has to be on BOTH hover rules or the tail lights up alone.
  const hovers = css.match(/^\.status-balloon[^\n{]*:hover[^\n{]*\{/gm) || [];
  assert.ok(hovers.length >= 2, 'expected a box and a tail hover rule');
  for (const h of hovers) {
    assert.match(h, /:not\(\.peek-status\)/, 'a hover rule still applies to the read-only status: ' + h.trim());
  }
});

test('a clamped bio fades out with a mask, not a painted overlay', () => {
  // An overlay has to be painted in the colour of whatever is behind the text, and
  // that differs per surface — the Profile tab sits on --bg, the peek sheet on
  // .modal's velvet gradient — so it left a visible band where the two disagreed.
  // A mask fades the text itself, so it is correct on every surface and all twelve
  // themes without naming a colour.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const clamp = css.match(/^\.about-clamp \{[^}]*\}/gm).join('\n');
  assert.match(clamp, /mask-image:\s*linear-gradient\(to bottom/, 'no fade on a clamped bio');
  assert.match(clamp, /-webkit-mask-image/, 'no webkit-prefixed mask');
  assert.doesNotMatch(css, /--clamp-fade/, 'the painted-overlay fade came back');
  // On .about-clamp specifically, so it lifts when the bio expands — that class is
  // what renderAbout toggles — and never shows on a bio too short to clamp.
  assert.doesNotMatch(css, /\.profile-about \{[^}]*mask-image/, 'the fade moved onto the unclamped container');
});

test('the editor is a modal, and its fields are not on the tab', () => {
  const fn = lift('function openStatusEditor(');
  assert.match(fn, /openModal\(/, 'the editor is not a modal');
  assert.match(fn, /STATUS_DURATIONS\.forEach/, 'the duration choice moved out of the editor');
});

test('editing prefills from the live status rather than making you retype it', () => {
  const fn = lift('function openStatusEditor(');
  assert.match(fn, /fetchStatus\(active\.pubkey\)/, 'the editor does not read the current status');
  assert.match(fn, /text\.value = st\.text/, 'the text is not prefilled');
});

test('CLEAR IS FULL-WIDTH BELOW, NEVER INLINE BESIDE THE FIELD', () => {
  // CLAUDE.md: a confirm that has words takes its own row. A labelled action in a
  // side slot is what collapses these rows at 360px.
  const fn = lift('function openStatusEditor(');
  const clear = fn.indexOf("textContent: 'Clear status'");
  assert.ok(clear !== -1, 'no clear control');
  assert.match(fn, /className: 'secondary hidden', textContent: 'Clear status'/, 'clear is not hidden by default');
  // It is appended into the modal's own column, not into an .item-actions slot.
  assert.doesNotMatch(fn, /item-actions/, 'clear was put in the inline action slot');
});

test('THE SET STATUS BUTTON IS ALWAYS THERE', () => {
  // The balloon is a way in too, but it is small, sits on the banner, and reads
  // as content rather than a control. The button is the one you can always find,
  // so it must not hide once a status exists.
  const fn = lift('async function renderProfile(');
  assert.match(fn, /balloon\.classList\.toggle\('hidden', !live\)/, 'the balloon does not follow the status');
  assert.doesNotMatch(fn, /statusBtn\.classList\.toggle\('hidden'/, 'the Set status button hides itself again');
});

test('the balloon has a tail pointing down at the avatar', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const tails = css.match(/^\.status-balloon::before,\n\.status-balloon::after \{[^}]*\}/m);
  assert.ok(tails, 'no tail pseudo-elements');
  // Transparent left/right with a solid top edge is a downward triangle. A
  // border-bottom would point it the wrong way, at the banner instead of the face.
  assert.match(tails[0], /border-left:\s*8px solid transparent/, 'tail is not a triangle');
  assert.match(css, /\.status-balloon::before \{[^}]*border-top:\s*\d+px solid var\(--muted\)/, 'no outlined tail');
  // The gradient's bottom stop, since the tail hangs off the bottom edge — not
  // --bg, which is the page behind the balloon rather than the balloon itself.
  assert.match(css, /\.status-balloon::after \{[^}]*border-top:\s*\d+px solid var\(--velvet-2\)/, 'no filled tail');
});

test('the button uses a speech bubble, and it is a real icon', () => {
  const fn = lift('async function renderProfile(');
  assert.match(fn, /icon\('message-circle'\)/, 'the Set status button is not a speech bubble');
  // A name missing from ICONS renders an empty <svg> — a silently blank button.
  const icons = source.match(/const ICONS = \{[\s\S]*?\n  \};/)[0];
  assert.ok(
    icons.includes("\n    'message-circle':") || icons.includes("\n    message-circle:"),
    'message-circle is not in ICONS'
  );
});
