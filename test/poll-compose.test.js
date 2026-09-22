'use strict';

// What a poll actually publishes, and where a vote on it comes back.
//
// The tag builder is lifted and run, because the shape of a kind:1068 is the contract
// with every other client and a grep cannot tell a correct one from a plausible one.
// The wiring around it (which filters collect votes, which kind the composer signs) is
// source-asserted, since those call sites live inside render functions that need a DOM.

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

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const ctx = { console, Date, crypto: globalThis.crypto };
vm.createContext(ctx);
vm.runInContext(
  lift(/const POLL_SINGLE = '[^']*';/, 'POLL_SINGLE') + '\n' +
    lift(/const POLL_MULTIPLE = '[^']*';/, 'POLL_MULTIPLE') + '\n' +
    lift(/const POLL_DEFAULT_SECS = \d+;/, 'POLL_DEFAULT_SECS') + '\n' +
    lift(/const POLL_RELAY_LIMIT = \d+;/, 'POLL_RELAY_LIMIT') + '\n' +
    lift(/const POLL_DURATIONS = \[[\s\S]*?\n  \];/, 'POLL_DURATIONS') + '\n' +
    lift(/function pollOptionId\(\)\s*\{[\s\S]*?\n  \}/, 'pollOptionId') + '\n' +
    lift(/function pollOptions\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollOptions') + '\n' +
    lift(/function newPollDraft\(\)\s*\{[\s\S]*?\n  \}/, 'newPollDraft') + '\n' +
    lift(/function pollEndsAtFor\(pollDraft, nowSecs\)\s*\{[\s\S]*?\n  \}/, 'pollEndsAtFor') + '\n' +
    lift(/function pollDraftOptions\(pollDraft\)\s*\{[\s\S]*?\n  \}/, 'pollDraftOptions') + '\n' +
    lift(/function pollDraftIsPostable\(pollDraft\)\s*\{[\s\S]*?\n  \}/, 'pollDraftIsPostable') + '\n' +
    lift(/function buildPollTags\(pollDraft, nowSecs, relays\)\s*\{[\s\S]*?\n  \}/, 'buildPollTags') + '\n' +
    'globalThis.POLL_DEFAULT_SECS = POLL_DEFAULT_SECS;' +
    'globalThis.POLL_DURATIONS = POLL_DURATIONS;' +
    'globalThis.pollOptions = pollOptions;' +
    'globalThis.newPollDraft = newPollDraft;' +
    'globalThis.pollEndsAtFor = pollEndsAtFor;' +
    'globalThis.pollDraftIsPostable = pollDraftIsPostable;' +
    'globalThis.buildPollTags = buildPollTags;',
  ctx,
  { filename: 'sidepanel-poll-compose-slice.js' }
);
const {
  POLL_DEFAULT_SECS,
  POLL_DURATIONS,
  pollOptions,
  newPollDraft,
  pollEndsAtFor,
  pollDraftIsPostable,
  buildPollTags,
} = ctx;

const NOW = 1_700_000_000;
// The lifted functions run in a vm, so what they return carries that realm's
// prototypes and assert.deepEqual reports "same structure but not reference-equal".
const plain = (value) => JSON.parse(JSON.stringify(value));

const tagsOf = (tags, name) => tags.filter((t) => t[0] === name);
const firstValue = (tags, name) => (tagsOf(tags, name)[0] || [])[1];

// ---- the draft the editor starts from -------------------------------------------------

test('a new poll starts as two empty choices, single answer, twenty-four hours', () => {
  // A day, not the week this started at: a week is not what anyone means by "I'm asking".
  // Twitter defaults to a day and caps at seven, and Amethyst's poll composer opens on
  // oneDayAhead. Longer is still offered, which is where we differ from both.
  const d = newPollDraft();
  assert.equal(d.options.length, 2, 'one option is not a question');
  assert.equal(d.multiple, false);
  assert.deepEqual({ ...d.ends }, { kind: 'in', secs: POLL_DEFAULT_SECS });
  assert.equal(POLL_DEFAULT_SECS, 86400, 'the documented default');
});

test('the default is one of the offered durations, not just the initial value', () => {
  // Otherwise removing and re-adding the end date cannot get back to the default.
  const secs = POLL_DURATIONS.map((d) => d.secs);
  assert.ok(secs.includes(POLL_DEFAULT_SECS), 'the default must be reachable from the menu');
  // And the menu still reaches past a week. Twitter stops at seven days; the reason to go
  // further is a poll about something slow, which is a real thing to want.
  assert.ok(Math.max(...secs) > 7 * 86400, 'longer than Twitter allows is the point of the list');
  // The label a duration carries has to be the duration it is. Deriving '7 days' from the
  // default was what made changing the default silently mislabel a menu entry.
  const LABELED = { 3600: '1 hour', 21600: '6 hours', 86400: '1 day', 259200: '3 days',
    604800: '7 days', 1209600: '14 days', 2592000: '30 days' };
  POLL_DURATIONS.forEach((d) => assert.equal(d.label, LABELED[d.secs], String(d.secs)));
});

test('two filled options is the floor for posting', () => {
  assert.equal(pollDraftIsPostable({ options: ['', ''] }), false, 'both blank');
  assert.equal(pollDraftIsPostable({ options: ['Yay', '   '] }), false, 'whitespace is not a choice');
  assert.equal(pollDraftIsPostable({ options: ['Yay', 'Nay'] }), true);
  assert.equal(pollDraftIsPostable({ options: ['Yay', '', 'Nay'] }), true, 'a blank in the middle');
});

// ---- the clock ------------------------------------------------------------------------

test('A DURATION IS RESOLVED AT PUBLISH, NOT WHEN THE DRAFT WAS WRITTEN', () => {
  // This is the whole reason the draft stores `in` rather than a timestamp. A poll drafted
  // on Monday and posted on Thursday must still run its full duration; resolving at draft
  // time published it three days spent, and a draft left past that duration published
  // already closed. Asserted against the default rather than a hardcoded week, so changing
  // the default cannot quietly make this test about a duration nothing uses.
  const d = newPollDraft();
  const monday = NOW;
  const thursday = NOW + 3 * 86400;
  assert.equal(pollEndsAtFor(d, monday), monday + POLL_DEFAULT_SECS);
  assert.equal(pollEndsAtFor(d, thursday), thursday + POLL_DEFAULT_SECS, 'still the full run');
  // A week-long draft would have gone out closed under the old resolve-at-draft behavior,
  // whatever the default is.
  const nextWeek = NOW + 7 * 86400;
  assert.ok(pollEndsAtFor(d, nextWeek) > nextWeek, 'a stale draft must not publish closed');
});

test('no end date resolves to nothing, and writes no tag', () => {
  const d = { options: ['a', 'b'], multiple: false, ends: { kind: 'none' } };
  assert.equal(pollEndsAtFor(d, NOW), null);
  assert.equal(tagsOf(buildPollTags(d, NOW, []), 'endsAt').length, 0, 'an absent end is an absent tag');
});

test('a custom moment is passed through untouched', () => {
  // The one case where the author really did name a time, so it must not be re-based on
  // now the way a duration is.
  const at = NOW + 12345;
  const d = { options: ['a', 'b'], multiple: false, ends: { kind: 'at', at } };
  assert.equal(pollEndsAtFor(d, NOW + 999), at);
  assert.equal(firstValue(buildPollTags(d, NOW, []), 'endsAt'), String(at));
});

test('a custom moment that was never picked is not an endsAt of zero', () => {
  // The composer disables Post in this state, so it should not be reachable. If it ever
  // is, `["endsAt","0"]` reads as 1970 and every client shows the poll as long closed.
  const d = { options: ['a', 'b'], multiple: false, ends: { kind: 'at', at: 0 } };
  assert.equal(pollEndsAtFor(d, NOW), null);
  assert.equal(tagsOf(buildPollTags(d, NOW, []), 'endsAt').length, 0);
});

// ---- the published tags ---------------------------------------------------------------

test('options become option tags with unique ids, in the order they were written', () => {
  const d = { options: ['Yay', '  Nay  ', '', 'Undecided'], multiple: false, ends: { kind: 'none' } };
  const opts = tagsOf(buildPollTags(d, NOW, []), 'option');
  assert.equal(opts.length, 3, 'the blank row is dropped, not published as a choice');
  assert.deepEqual(plain(opts.map((t) => t[2])), ['Yay', 'Nay', 'Undecided'], 'trimmed, order kept');
  assert.equal(new Set(opts.map((t) => t[1])).size, 3, 'ids unique within the poll');
  opts.forEach((t) => assert.match(t[1], /^[a-z0-9]{9}$/));
});

test('a duplicate id would silently lose an option, so ids are deduped on the way out', () => {
  // pollOptions drops a repeated id rather than merging it. Round-tripping is what
  // proves the builder and the reader agree: every choice the author typed comes back.
  const labels = ['One', 'Two', 'Three', 'Four', 'Five'];
  const tags = buildPollTags({ options: labels, multiple: false, ends: { kind: 'none' } }, NOW, []);
  const back = pollOptions({ tags });
  assert.equal(back.length, labels.length);
  assert.deepEqual(plain(back.map((o) => o.label)), labels);
});

test('polltype is written for both kinds, including the default', () => {
  // NIP-88 treats an absent polltype as singlechoice, so writing it is redundant on
  // paper. It is the difference between a reader having to know the default and a
  // reader being told, and it costs one tag.
  const single = buildPollTags({ options: ['a', 'b'], multiple: false, ends: { kind: 'none' } }, NOW, []);
  const multi = buildPollTags({ options: ['a', 'b'], multiple: true, ends: { kind: 'none' } }, NOW, []);
  assert.equal(firstValue(single, 'polltype'), 'singlechoice');
  assert.equal(firstValue(multi, 'polltype'), 'multiplechoice');
});

test('relay tags say where to vote, capped so the count does not scatter', () => {
  const relays = ['wss://a', 'wss://b', 'wss://c', 'wss://d', 'wss://e', 'wss://f'];
  const tags = buildPollTags({ options: ['a', 'b'], multiple: false, ends: { kind: 'none' } }, NOW, relays);
  const written = tagsOf(tags, 'relay').map((t) => t[1]);
  assert.equal(written.length, 4, 'more relays is the same votes spread thinner, not more reach');
  assert.deepEqual(plain(written), relays.slice(0, 4));
});

test('an account with no relays still produces a valid poll', () => {
  const tags = buildPollTags({ options: ['a', 'b'], multiple: false, ends: { kind: 'none' } }, NOW, []);
  assert.equal(tagsOf(tags, 'relay').length, 0);
  assert.equal(tagsOf(tags, 'option').length, 2, 'the poll is still well formed');
});

// ---- the wiring -----------------------------------------------------------------------

// FULL-LINE // COMMENTS ONLY. The obvious next step, also stripping /* */ blocks with
// a regex, deletes 278KB of this file: something in the source opens what looks like a
// block comment to a regex and the strip runs on to the next */ it finds. Line comments
// anchored at the start of a line are safe, they carry all the prose these assertions
// could collide with, and a `wss://` inside a string is untouched because it never sits
// at the start of one.
const bare = source.replace(/^\s*\/\/.*$/gm, '');

test('the composer signs a poll as kind 1068', () => {
  assert.match(bare, /kind: asPoll \? POLL_KIND : reply \? reply\.kind : 1/);
  assert.match(bare, /const POLL_KIND = 1068;/);
  assert.match(bare, /const POLL_RESPONSE_KIND = 1018;/);
});

test('A VOTE REACHES THE BELL BY TWO ROUTES, BECAUSE ONE IS NOT ENOUGH', () => {
  // Jumble p-tags the poll author on a kind:1018, so the `#p` filter catches those.
  // NIP-88 never asks for that tag, so for every other client the only thing linking a
  // vote to its poll is the `e` tag. Dropping either filter loses a whole population of
  // voters, and which one depends on what the voter happened to be using.
  assert.match(
    bare,
    /kinds: \[1, 6, 7, 1111, 9735, POLL_RESPONSE_KIND\], '#p': \[a\.pubkey\]/,
    'votes that p-tag you must be collected with the other mentions'
  );
  assert.match(
    bare,
    /kinds: \[POLL_RESPONSE_KIND\], '#e': ownPollIdList/,
    'votes that only e-tag the poll must be collected by poll id'
  );
});

test('poll ids are loaded on their own budget, not shared with note ids', () => {
  // Merged into the 150-id note window, an account that posts often would push its own
  // polls out and quietly stop reporting votes on them.
  assert.match(bare, /function loadOwnPollIds\(pubkey, relays\)/);
  assert.match(bare, /kinds: \[POLL_KIND\], authors: \[pubkey\], limit: 50/);
  assert.match(
    bare,
    /const ownPollIdList = \[\.\.\.\(_ownPollIds\.get\(a\.pubkey\) \|\| \[\]\)\];/,
    'the vote filter wants bare ids'
  );
});

test('THE TAB OPENS ON WHAT IT SHOWED LAST TIME', () => {
  // The guard that stops a second fill (`filled`) is declared inside showNotifModal, so it
  // dies with the sheet: every reopen re-queried from "Looking for your polls…" through two
  // sequential 8s relay waits, while the notification list beside it opened from
  // _notifCache. Rows now paint from the cache at once and the query corrects them.
  assert.match(bare, /const _pollListCache = new Map\(\);/);
  const fn = bare.slice(bare.indexOf('async function fillPollsList'));
  const fill = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(fill, /const cached = _pollListCache\.get\(pubkey\);/);

  // Painted before the query, or the cache buys nothing: the point is not waiting.
  const paintedFromCache = fill.indexOf('rows = paint(cached.polls, cached.counts, cached.wins);');
  const firstQuery = fill.indexOf('kinds: [POLL_KIND], authors: [active.pubkey]');
  assert.ok(paintedFromCache > -1, 'nothing paints from the cache');
  assert.ok(firstQuery > -1 && paintedFromCache < firstQuery, 'the cache must paint before the relays are asked');

  // And the placeholder belongs to the cold case only. A list that already has rows in it
  // must never be cleared back to a waiting line to say it is checking.
  assert.match(fill, /waitingRow\('Looking for your polls…'\)/, 'a first open still says what it is doing');
  const placeholder = fill.indexOf("'Looking for your polls…'");
  assert.ok(placeholder > paintedFromCache, 'the placeholder must sit in the else branch');

  // ONE RENDERER, or a cached row and a fresh row drift apart in everything but the number.
  // Two calls: the cache paints, and the fresh set repaints when it differs. The definition
  // reads `paint = (`, so it is deliberately not one of them.
  // Three arguments now: the third carries the result of a finished poll, which is what
  // its row shows instead of its age.
  assert.match(fill, /const paint = \(polls, counts, wins\) =>/, 'the shared renderer');
  assert.equal((fill.match(/paint\(/g) || []).length, 2, 'one cache paint, one fresh paint');
  // Redrawn only when the set moved, since a rebuild puts the pane back at the top and the
  // usual news here is a number rather than a new row.
  assert.match(fill, /if \(!sameSet\) rows = paint\(polls, counts, wins\);/);
});

test('AN OPTION TITLE STARTS AT THE CHEVRON, WHATEVER ITS LENGTH', () => {
  // .poll-bar-head is space-between, written when it held [label, tally] and pinned one to
  // each edge. A row that can be opened holds [chev, label, tally], so the spare width went
  // into two gaps either side of a content-sized label and every title sat centered in the
  // room left over: "Hummus" started further in than "Guacamole" on the same sheet.
  //
  // flex: 1 is the fix, not text-align. The button already sets text-align: left and the
  // label box hugged its text, so it was the box being centered, not the text in it.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  // Anchored to the start of a line, or indexOf finds `.poll-bar-pick:hover .poll-bar-label`
  // first and the assertions below run against the hover color instead of the layout rule.
  const label = css.slice(css.indexOf('\n.poll-bar-label {'));
  const decls = label.slice(0, label.indexOf('}'));
  assert.match(decls, /flex: 1;/, 'the label must absorb the free space, or it floats');
  assert.match(decls, /min-width: 0;/, 'and still be allowed to truncate');

  // The head that has no chevron holds two children and must keep working the same way.
  assert.match(bare, /className: 'poll-bar-head' \}, \[label, tally\]\)/);
  assert.match(bare, /className: 'poll-bar-head poll-bar-pick', type: 'button' \}, \[\n\s+chev,\n\s+label,\n\s+tally,\n\s+\]/);
});

test('TURNING A NOTE INTO A POLL RE-ASKS WHETHER IT CAN BE POSTED', () => {
  // The bar goes UP at that moment: a note needs text or an image, a poll needs its
  // question and two filled options. Post was already enabled under the note rule, and the
  // add handler did not re-run the check, so question → Add a poll → Post published a
  // kind:1068 with zero option tags. Nothing downstream re-validates: the click handler
  // only asks whether Post is disabled.
  const add = bare.slice(bare.indexOf("pollAdd.addEventListener('click'"));
  const body = add.slice(0, add.indexOf('\n      });'));
  assert.match(body, /draft\.poll = newPollDraft\(\);/);
  assert.match(body, /updatePostState\(\);/, 'adding a poll must re-check whether Post is allowed');

  // Both directions, or the same bug returns wearing the other hat.
  const remove = bare.slice(bare.indexOf("remove.addEventListener('click'"));
  assert.match(remove.slice(0, remove.indexOf('\n        });')), /updatePostState\(\);/, 'and so must removing one');

  // The floor those checks enforce, which is the thing the gap let through.
  assert.match(bare, /post\.disabled = !draft\.text\.trim\(\) \|\| !pollDraftIsPostable\(draft\.poll\) \|\| !endsOk;/);
  assert.match(bare, /return pollDraftOptions\(pollDraft\)\.length >= 2;/, 'two filled options');
});

test('the waiting line reads as work, and cannot drift from its own shadow', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  // ::before paints itself from attr(data-text), so the attribute has to exist and has to
  // say what the element says. One writer sets both from the same argument, which is the
  // only way the two can never disagree. h() cannot do it: Object.assign would make
  // data-text a JS expando and attr() would find nothing.
  assert.match(bare, /function setWaiting\(el, text, waiting\)/);
  const fn = bare.slice(bare.indexOf('function setWaiting'));
  const set = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(set, /el\.textContent = text;/);
  assert.match(set, /el\.classList\.toggle\('t-shimmer', !!waiting\);/);
  assert.match(set, /if \(waiting\) el\.dataset\.text = text;/);
  assert.match(set, /else delete el\.dataset\.text;/, 'a landed value must stop sweeping');
  assert.match(css, /content: attr\(data-text\)/);

  // THE RULE IS BY SHAPE, NOT BY SURFACE. A region with room for a line gets the shared
  // spinner row; a value waiting in place, where a spinner does not fit beside it, shimmers.
  // These three are regions, so they take the row, and the row is what bookmarks uses too.
  for (const label of ['Looking for your polls…', 'Counting votes…', 'Fetching the poll…']) {
    assert.doesNotMatch(bare, new RegExp("textContent: '" + label + "'"), label + ' needs an indicator');
    assert.ok(bare.includes("waitingRow('" + label + "')"), label + ' must use the shared row');
  }
  // The count cell shimmers only while it is unknown, and is cleared when the value lands.
  //
  // `shown` rather than `known`, because the cell carries two different values now: a
  // running poll shows its vote total, a finished one shows the winner's share. One
  // setWaiting covers both, which is the point. A second call for the finished case would
  // be a second thing to remember to turn off, and the shimmer guard in
  // loading-indicators.test.js would have been loosened to let it through.
  assert.match(bare, /const known = counts\.get\(ev\.id\);/);
  assert.match(bare, /const shown = past && win \? win\.share : known;/);
  assert.match(bare, /setWaiting\(h\('span', \{ className: 'poll-row-count' \}\), shown \|\| '…', !shown\)/);
  assert.match(bare, /setWaiting\(cell, fresh\.get\(ev\.id\), false\)/, 'the landed count must stop sweeping');
  assert.match(bare, /setWaiting\(cell, win\.share, false\)/, 'a late result must stop sweeping too');

  // THE COLORS BELONG ON THE ELEMENT, NOT ON :root. A var() inside a custom property
  // resolves against the element the property is declared on, and :root is where the themes
  // set --muted and --text, so hoisting these would shimmer all twelve themes in whatever
  // palette :root happened to hold.
  const rule = css.slice(css.indexOf('.t-shimmer {'), css.indexOf('.t-shimmer::before'));
  assert.match(rule, /--shimmer-base: var\(--muted\);/, 'the base color must inherit');
  assert.match(rule, /--shimmer-highlight: var\(--text\);/, 'and so must the band');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  assert.doesNotMatch(root, /--shimmer-/, 'no shimmer token may sit on :root');

  // Required by the skill and by every other animation in this sheet.
  const guard = css.slice(css.indexOf('.t-shimmer::before'));
  assert.match(guard.slice(0, 900), /prefers-reduced-motion: reduce/);
});

test('A POLL YOU JUST POSTED IS ONE OF YOUR POLLS IMMEDIATELY', () => {
  // The bell's tab is gated on _ownPollIds, which was loaded once per account and memoized
  // for the life of the panel. So your first poll of a session left accountHasPolls() false:
  // no tab, and since Profile no longer lists them, no way back to that tally at all once
  // the post banner timed out. Seeded at publish rather than waited for.
  assert.match(bare, /if \(signed\.kind === POLL_KIND\) rememberOwnPoll\(signed\.pubkey, signed\.id\);/);
  const fn = bare.slice(bare.indexOf('function rememberOwnPoll'));
  assert.match(fn.slice(0, fn.indexOf('\n  }')), /ids\.add\(id\);/);

  // ADDED TO, NOT REPLACED. The relays have not necessarily caught up with a poll signed a
  // second ago, so a set rebuilt from that query would drop the seed and take the tab away
  // again. The set identity is stable and loadOwnPollIds adds into it.
  const load = bare.slice(bare.indexOf('function loadOwnPollIds'));
  assert.match(
    load.slice(0, load.indexOf('\n  }')),
    /const ids = _ownPollIds\.get\(pubkey\) \|\| new Set\(\);/,
    'a re-query must not discard a poll posted from this panel'
  );

  // And the filter reads that set when it is built, not when the subscription started, or
  // votes on a poll posted this session arrive only if the voter's client p-tagged you.
  const refresh = bare.slice(bare.indexOf("className: 'modal-x notif-refresh'"));
  assert.match(refresh.slice(0, 2000), /forgetOwnPollQuery\(a\.pubkey\);/, 'refresh asks again');
  assert.match(bare, /function forgetOwnPollQuery\(pubkey\)/);
  assert.match(bare, /_ownPollIdsPromises\.delete\(pubkey\);/, 'and the memo is what is dropped');
});

test('the tally is applied to what comes back, not just asked for in the filter', () => {
  // `until` is a request. tallyPollVotes enforces the same cut on the events that
  // actually arrive, because a relay is free to answer with whatever it likes.
  assert.match(bare, /if \(endsAt\) filter\.until = endsAt;/, 'the query asks');
  assert.match(bare, /if \(endsAt && v\.created_at > endsAt\) continue;/, 'the tally enforces');
});

test('a bookmarked poll is labelled a poll', () => {
  // 1068 read "live chat" here before polls existed; live chat messages are kind 1311.
  assert.match(bare, /1068: 'poll'/);
});

test('A POLL BANNER STACKS, BECAUSE TWO WORDED ACTIONS DO NOT SHARE A ROW', () => {
  // The banner was built for a note: one line of text, one link, a dismiss. Adding
  // See results beside Open in <client> left the message as the only thing in the row
  // that could give way, so "Your poll is live." wrapped to two lines while both links
  // sat at full width. CLAUDE.md already names this: a confirm with words takes its own
  // full-width row below the content.
  const fn = bare.slice(bare.indexOf('async function showPostBanner'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(
    body,
    /banner\.classList\.toggle\('post-banner-stacked', isPoll\)/,
    'a poll banner must become a column rather than a longer row'
  );
  assert.match(body, /className: 'post-banner-head' \}, \[msg, close\]/, 'the message keeps its own line');
  assert.match(
    body,
    /className: 'post-banner-actions' \}, \[results, open\]/,
    'both actions belong on the row beneath, not beside the message'
  );
  // The note banner is untouched: one row, in the original order.
  assert.match(body, /banner\.append\(msg, open, close\);/, 'a note still posts a single-row banner');
});

test('the stacked actions share the row and wrap rather than overflow', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rule = css.slice(css.indexOf('.post-banner-actions {'));
  const decls = rule.slice(0, rule.indexOf('}'));
  assert.match(decls, /flex-wrap: wrap/, 'below about a 310px panel the two actions need a row each');
  // margin-left: auto is what pushes the single link to the right of a one-row banner,
  // and it has to be undone here or the first action is shoved off its own row.
  const inner = css.slice(css.indexOf('.post-banner-actions .post-banner-link {'));
  assert.match(inner.slice(0, inner.indexOf('}')), /margin-left: 0/);
});

// ---- what posting a poll actually costs ---------------------------------------------

const CLIENT_WARNING = 'Some clients cannot show polls. On those, this will not appear at all.';

// Both of these functions are declared at a fixed indent, so the first closing brace at
// that indent is the end of the body. Slicing is what keeps these assertions from
// matching something identical elsewhere in a 17,000-line file.
// indexOf returns -1 when the anchor has moved, and slice(-1) hands back the last
// character of the file rather than an error. Every assertion against that slice then
// passes or fails for a reason that has nothing to do with the code under test, which is
// how a renamed signature reads as an unrelated failure. This refuses instead.
const fnBody = (anchor, indent = '  ') => {
  const at = bare.indexOf(anchor);
  assert.ok(at > -1, 'anchor moved, fix the test: ' + anchor);
  const fn = bare.slice(at);
  const end = fn.indexOf('\n' + indent + '}');
  assert.ok(end > -1, 'no closing brace at indent ' + indent.length + ' for: ' + anchor);
  return fn.slice(0, end);
};

const paintPollBody = () => {
  const fn = bare.slice(bare.indexOf('      function paintPoll() {'));
  return fn.slice(0, fn.indexOf('\n      }'));
};
const notifModalBody = () => {
  const fn = bare.slice(bare.indexOf('async function showNotifModal(a, place)'));
  return fn.slice(0, fn.indexOf('\n  }'));
};

test('THE COMPOSER SAYS A POLL MAY NOT SHOW UP AT ALL', () => {
  // A 1068 is not a kind:1, so a client that has not implemented NIP-88 generally does
  // not render it: it never appears in a feed filtered to notes, and the author gets no
  // signal. Silence from the other side is indistinguishable from nobody caring, and the
  // editor is the only screen where knowing that can still change the decision.
  const body = paintPollBody();
  assert.ok(body.includes(CLIENT_WARNING), 'the copy, verbatim');
  assert.match(body, /className: 'kind-warn'/, 'the amber caution box that already exists');
  // Between the second separator and Remove poll, which is where Jumble puts its own.
  assert.match(
    body,
    /endsNote,\n *h\('div', \{ className: 'poll-editor-sep' \}\),\n *clientWarn,\n *remove/,
    'below the clock, above the remove button'
  );
  // One line, one fact: the budget every hint in this panel is written to.
  assert.ok(CLIENT_WARNING.length <= 80, 'a panel hint fits one line: ' + CLIENT_WARNING.length);
});

test('the warning box invents no CSS of its own', () => {
  // .kind-warn is the generic inline caution: filled, bordered, amber, 12px. It needs no
  // glyph because a bordered and filled box is not carrying the warning by color alone,
  // the principle written above .destructive-warn. A second bare `.hint warn` line would
  // have been, and would have run straight into the amber ends note above it.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const decls = css.slice(css.indexOf('.kind-warn {')).split('}')[0];
  assert.match(decls, /background: rgba\(var\(--warn-rgb\), 0\.1\)/);
  assert.match(decls, /border: 1px solid rgba\(var\(--warn-rgb\), 0\.3\)/);
  assert.match(decls, /color: var\(--warn\)/);
});

test('an empty tally says it too, because that is when the author asks', () => {
  // The branch only renders when the count is zero, so this is not repeated copy: it is
  // the same fact arriving at the moment the question gets asked. A plain .hint rather
  // than .hint warn, because here it is an explanation, not a caution.
  const body = fnBody('function paintPollResults(');
  const empty = body.slice(body.indexOf('if (!voters)'));
  assert.match(empty, /Clients without poll support show nothing to vote on\./);
  assert.match(empty, /ended \? 'This poll closed without any votes\.' : 'No votes yet\.'/);
  assert.match(empty, /className: 'hint'/);
  assert.doesNotMatch(empty, /hint warn/, 'nothing has gone wrong for the reader to fix');
});

test('the amber ends note uses the warn class that already existed', () => {
  // .poll-ends-note.poll-warn was a verbatim duplicate of .hint.warn, which had eight
  // callers before polls were written. The element is already a .hint, so it picks the
  // original up with nothing else to change.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.hint\.warn \{ color: var\(--warn\); \}/, 'the one that was always there');
  assert.doesNotMatch(css, /poll-warn/, 'and no second copy of it');
  assert.doesNotMatch(bare, /poll-warn/);
  assert.match(bare, /className: 'hint poll-ends-note'/, 'the element is already a hint');
  assert.match(bare, /endsNote\.classList\.toggle\('warn', k === 'none'\)/);
});

// ---- who voted ----------------------------------------------------------------------

test('THE BALLOTS COME OUT OF THE SAME PASS AS THE COUNTS', () => {
  // A second walk over the votes to collect voters would be a second set of rules to keep
  // in step with NIP-88, and the first time they disagreed the list would name someone the
  // number above it had not counted. Same loop, same guards, one skip.
  const fn = bare.slice(bare.indexOf('function tallyPollVotes'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /ballots\.push\(\{ pubkey: v\.pubkey, picked, at: v\.created_at \}\);/);
  assert.ok(
    body.indexOf('ballots.push') > body.indexOf('if (!picked.length) continue;'),
    'a ballot for nothing is not a voter, in the list as well as in the count'
  );
  assert.match(body, /ballots\.sort\(\(x, y\) => y\.at - x\.at\);/, 'newest first, like everything else');
  assert.match(body, /return \{ options, counts, voters, multiple, endsAt, ballots \};/);
});

test('VOTERS HANG OFF THE CHOICE THEY PICKED, NOT A LIST THAT REPEATS IT', () => {
  // The first build was one flat list of every voter with their option beside each name.
  // On a 65-voter poll that is 65 rows repeating two strings, and the repetition is most
  // of what you read. The bar is the header now, so the names under it carry no label.
  const fn = bare.slice(bare.indexOf('function paintPollResults'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /const mine = ballots\.filter\(\(b\) => b\.picked\.includes\(opt\.id\)\);/);
  assert.match(body, /className: 'poll-bar-head poll-bar-pick', type: 'button'/, 'the bar is the header');
  assert.doesNotMatch(body, /poll-voter-pick/, 'the option must not be repeated on every name');
  assert.doesNotMatch(bare, /pollVoterList/, 'and the flat list is gone, not left alongside');

  // A choice nobody picked stays a plain row. A chevron on it would be a control that
  // does nothing, and the two kinds of row must sit at the same height regardless.
  assert.match(body, /if \(!mine\.length\) \{[\s\S]{0,400}?className: 'poll-bar-head' \}, \[label, tally\]\), track\);/);
});

test('one choice open at a time, each costing a fixed amount of height', () => {
  // Two open would spend the cap twice and start pushing choices off the sheet, which is
  // the thing the cap exists to prevent.
  const body = fnBody('function paintPollResults(');
  assert.match(body, /let openId = null;/);
  assert.match(body, /const opening = openId !== opt\.id;/, 'tapping the open one closes it');
  // Every header AND every list is reset before the new one is drawn, so the marks can
  // never say two are open at once.
  assert.ok(
    body.indexOf("bars.querySelectorAll('.poll-bar-pick')") < body.indexOf("headBtn.setAttribute('aria-expanded', 'true')"),
    'the reset has to run before the new selection is drawn'
  );
  assert.match(
    body,
    /bars\.querySelectorAll\('\.poll-voter-list'\)\.forEach\(\(l\) => l\.classList\.add\('hidden'\)\);/,
    'every other list has to close, not just the headers'
  );
  assert.match(body, /headBtn\.setAttribute\('aria-expanded', 'false'\)/, 'closed to start');
  assert.match(body, /headBtn\.setAttribute\('aria-expanded', 'true'\)/, 'and the state is announced');
  assert.match(body, /b\.setAttribute\('aria-expanded', 'false'\)/, 'the others are told they closed');
  // Built once and kept: reopening a choice must not rebuild or refetch it.
  assert.match(body, /if \(!list\.children\.length\) mine\.forEach\(\(b\) => list\.append\(pollVoterRow\(b\.pubkey, client\)\)\);/);
});

test('the name lookup runs once for the poll, however many choices are opened', () => {
  // Opening a second choice must not re-ask the relays for names already in hand. The
  // promise is memoized, so the lookup is one query for the whole sheet.
  const fn = bare.slice(bare.indexOf('function pollVoterNames(ballots)'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /let p = null;/);
  assert.match(body, /if \(!p\) \{/, 'a second open must reuse the first lookup');
  // Capped at the 100 the bell's own reaction lookup uses: a filter naming every author of
  // a poll with thousands of votes is one no relay will answer.
  assert.match(body, /prefetchNotifProfiles\(ballots\.slice\(0, 100\)\.map\(\(b\) => b\.pubkey\), relays\)/);

  const pbody = fnBody('function paintPollResults(');
  assert.ok(
    pbody.indexOf('mine.forEach') < pbody.indexOf('await resolveNames()'),
    'the rows must not wait on the relays to appear'
  );
  // The sheet can be shut, or another choice picked, while the lookup is in flight.
  assert.match(pbody, /if \(!list\.isConnected \|\| openId !== opt\.id\) return;/);
  // Every list that has been built, not only the one just opened: reopening an earlier
  // choice must not show the short npubs it was drawn with.
  assert.match(pbody, /repaint\(bars\);/);
});

test('OPENING A CHOICE DOES NOT MOVE THE BARS', () => {
  // The list sits inline under its own bar, which is the only placement that answers
  // "whose names are these" once the chevron has scrolled out of view. Inline it would
  // also push every choice below it down the sheet, so it caps its own height and scrolls
  // inside itself: the percentages stay where they are while the names move.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const listDecls = css.slice(css.indexOf('.poll-voter-list {')).split('}')[0];
  assert.match(listDecls, /overflow-y: auto/, 'the names scroll rather than growing the sheet');

  // NOT A FIXED SLICE OF ANYTHING. This was max-height: 34vh, which is about right on a
  // short panel and leaves a blank band above the actions on a tall one, because a third
  // of the viewport is not the same as what is actually spare. The open row grows into the
  // free space instead.
  assert.doesNotMatch(listDecls, /max-height/, 'a fixed cap is what left the blank band');
  const open = css.slice(css.indexOf('.poll-result-body.poll-open .poll-bar-open {')).split('}')[0];
  assert.match(open, /flex: 1 1 auto/, 'the open row takes what is left');
  // But never past what the list actually holds: eight voters on a tall panel should be
  // eight rows and then nothing, not eight rows adrift in a box stretched to the foot.
  assert.match(open, /max-height: max-content/);
  // And it stays usable when the options alone have taken the space.
  assert.match(open, /min-height: \d+px/);
  const barsOpen = css.slice(css.indexOf('.poll-result-body.poll-open .poll-bars {')).split('}')[0];
  assert.match(barsOpen, /flex: 1/);
  assert.match(barsOpen, /min-height: 0/, 'or the pane cannot shrink and nothing overflows');
  assert.match(barsOpen, /overflow-y: auto/, 'more options than fit still have to be reachable');

  // The layout is named by a class rather than inferred by a rule per state.
  const body = fnBody('function paintPollResults(');
  assert.match(body, /container\.classList\.toggle\('poll-open', opening\);/);
  assert.match(body, /row\.classList\.add\('poll-bar-open'\);/);
  assert.match(
    body,
    /bars\.querySelectorAll\('\.poll-bar-open'\)\.forEach\(\(r\) => r\.classList\.remove\('poll-bar-open'\)\);/,
    'the previous row has to give the space back'
  );

  // The list belongs to the bar row, not to a pane below all of them.
  assert.match(body, /row\.append\(headBtn, track, list\);/);
  assert.doesNotMatch(bare, /poll-voter-pane|poll-result-head/, 'the shared pane is gone');

  // The body is still the scroller, for the case a cap cannot fix: enough options that
  // the bars alone overrun the sheet. .modal-sheet is overflow: hidden at a fixed height,
  // so without this they simply run out under the actions with no way to reach them.
  const bodyDecls = css.slice(css.indexOf('.poll-result-body {')).split('}')[0];
  assert.match(bodyDecls, /overflow-y: auto/, 'many options still have to be reachable');
  // Handed to .poll-bars while a choice is open, or two nested scrollers fight over the
  // same wheel event.
  assert.match(css, /\.poll-result-body\.poll-open \{ overflow-y: hidden; \}/);
  // min-height is what makes that fire: a flex item will not shrink below its content, so
  // without it the body just grows and the clipping happens outside it, where there is no
  // scrollbar to reach.
  assert.match(bodyDecls, /min-height: 0/);
});

test('A VOTER ROW CARRIES A FACE AND GOES SOMEWHERE', () => {
  // Sidecar is the signer, not the reader, so the row hands off rather than opening a
  // profile in the panel. An anchor, not a button: that is what makes cmd-click and
  // middle-click open a tab of their own without any code for it.
  const body = fnBody('function pollVoterRow(pubkey, client)');
  assert.match(body, /avatarEl\(cachedProfile\(pubkey\) \|\| \{\}, 'poll-voter-av'\)/, 'the face');
  assert.match(body, /client \? client\.profile\(NT\.nip19\.npubEncode\(pubkey\)\) : ''/, 'the link');
  assert.match(body, /h\('a', \{ className: 'poll-voter poll-voter-link', href: url \}\)/);
  assert.match(body, /row\.rel = 'noreferrer noopener'/, 'an untrusted target window');
  // The tag is decided before anything is built, rather than a div being made and then
  // emptied into an anchor.
  assert.match(body, /const row = url\n +\? h\('a'/, 'one element, chosen up front');
  // Plain left-click reuses the client tab; modified clicks are left to the anchor.
  assert.match(
    body,
    /if \(e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey\) return;\n +e\.preventDefault\(\);\n +openInClient\(url\);/
  );
});

test('the picture costs no second query', () => {
  // prefetchNotifProfiles already parses the kind:0 it fetched for the name and puts it
  // through cacheProfile, which keeps the picture. Reading it back is free; fetching it
  // again would be one request per face.
  assert.match(bare, /avatarEl\(cachedProfile\(pubkey\) \|\| \{\}/);
  const prefetch = fnBody('async function prefetchNotifProfiles(pubkeys, relays)');
  assert.match(prefetch, /cacheProfile\(pk, m\);/, 'the batch has to keep the picture');
  const cache = fnBody('function cacheProfile(pubkey, content)');
  assert.match(cache, /picture: c\.picture \|\| '',/);

  // And the repaint after the lookup lands does the face as well as the name, or a row
  // drawn before it keeps a placeholder for good.
  const paint = fnBody('function paintPollResults(');
  assert.match(paint, /applyAvatar\(av, cachedProfile\(pk\) \|\| \{\}\)/);
});

test('a row with no client resolved is a row, not a dead link', () => {
  // Settings can fail to read. A link built on a guess would open the wrong place; a row
  // that merely says who voted is honest, and it must not take a pointer either.
  const body = fnBody('function pollVoterRow(pubkey, client)');
  assert.match(body, /if \(!url\) return row;/);
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.poll-voter-link \{ cursor: pointer; \}/, 'the pointer belongs to the link only');
  const plain = css.slice(css.indexOf('.poll-voter {')).split('}')[0];
  assert.doesNotMatch(plain, /cursor: pointer/, 'the bare row must not pretend to be clickable');
});

test('the poll and the people who voted on it open in the same client', () => {
  // Resolved once by openPollResults and handed down. Resolving it again in the rows
  // would let a per-account override drift between the two, so the poll opened in one
  // client and its voters in another.
  const body = fnBody('  async function openPollResults(poll, relayHints, returnTo)', '  ');
  assert.match(body, /let client = null;/, 'hoisted out of the try that builds the link out');
  assert.match(body, /client = resolveClient\(settings, state\.activePubkey\);/);
  assert.match(body, /paintPollResults\(body, pollEv, votes, client\);/, 'and handed down');
  assert.match(bare, /function paintPollResults\(container, pollEv, votes, client\)/);
  // One resolve in the whole sheet.
  assert.equal((body.match(/resolveClient\(/g) || []).length, 1);
});

test('the avatar keeps its metrics and the name truncates', () => {
  // CLAUDE.md's inline-action rule read the other way round: the fixed thing holds its
  // size and the prose beside it gives way. min-width: 0 is what lets it.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const av = css.slice(css.indexOf('.poll-voter-av {')).split('}')[0];
  assert.match(av, /flex-shrink: 0/);
  const name = css.slice(css.indexOf('.poll-voter-name {')).split('}')[0];
  assert.match(name, /min-width: 0/);
  assert.match(name, /text-overflow: ellipsis/);
});

test('the new avatar is squared off in Werkstatte like every other circle', () => {
  // The theme turns every circular thing in the app into a square. A new avatar that
  // misses the exception is a lone circle in a theme built entirely of right angles.
  const wk = fs.readFileSync(path.join(ROOT, 'themes/werkstatte.css'), 'utf8');
  assert.match(wk, /\[data-theme="werkstatte"\] \.poll-voter-av:not\(\.theme-card\)/);
});

test('a voter row is one line, and it truncates', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const decls = css.slice(css.indexOf('.poll-voter-name {')).split('}')[0];
  assert.match(decls, /text-overflow: ellipsis/);
  assert.match(decls, /white-space: nowrap/);
  assert.doesNotMatch(css, /\.poll-voter-pick/, 'the per-row option label is gone with its list');
});

test('a bar that opens keeps the metrics of one that does not', () => {
  // A choice with voters and a choice without sit side by side in the same stack. If the
  // button reset missed anything the two rows would stand at different heights, which
  // reads as the list being broken rather than as one of them being empty.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const decls = css.slice(css.indexOf('button.poll-bar-head {')).split('}')[0];
  for (const d of [/background: none/, /border: none/, /padding: 0/, /font: inherit/, /text-align: left/, /width: 100%/]) {
    assert.match(decls, d, 'button.poll-bar-head is missing a reset: ' + d);
  }

  // AND THE BAR ITSELF IS THE SAME THICKNESS EITHER WAY. Opening a row turns it into a flex
  // column, where the track is a flex item whose only child is height: 100%. That gives it
  // an automatic minimum size of zero, so it is the one thing in the column that will give
  // up its 8px when the voter list wants the room, and an open choice drew a visibly
  // thinner bar than the closed one beside it.
  const track = css.slice(css.indexOf('.poll-bar-track {')).split('}')[0];
  assert.match(track, /height: 8px/);
  assert.match(track, /flex-shrink: 0/, 'the track must not give up height to the voter list');
});

// ---- getting back to a poll --------------------------------------------------------

test('A POLL IS READ BACK FROM THE RELAYS IT WAS PUBLISHED TO', () => {
  // readRelayUrls is built for replaceable events: NIP-65 READ relays plus
  // purplepag.es, which aggregates kinds 0, 3 and 10002. A poll is none of those. It
  // goes to postRelays, the WRITE set, and NIP-65 lets those two lists be completely
  // disjoint, so reading from the read set alone found nothing on exactly the accounts
  // that declare a real split, and the poll list came up empty while the poll sat on the
  // relays it had just been published to.
  assert.match(bare, /async function pollReadRelays\(pubkey\)/);
  const fn = bare.slice(bare.indexOf('async function pollReadRelays'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /readRelayUrls\(pubkey\)/, 'the read set');
  assert.match(body, /relayUrls\(true\)/, 'and the write set, which is where a poll actually went');

  // Every poll read goes through it. A single caller left on the read-only set is the
  // whole bug back again, on whichever surface that caller happens to be.
  const pollQueries = bare.match(/kinds: \[POLL_KIND\], authors: \[active\.pubkey\]/g) || [];
  assert.equal(pollQueries.length, 1, 'exactly one place lists the account polls');
  assert.doesNotMatch(
    bare.slice(bare.indexOf('async function fillPollsList')),
    /readRelayUrls\(active\.pubkey\)/,
    'the poll list must not use the replaceable-event read set'
  );
  // The other two reads are the tally itself and fetching a poll named only by id.
  const results = bare.slice(bare.indexOf('async function fetchPollVotes'));
  assert.match(results, /pollReadRelays\(state\.activePubkey\)/, 'the vote query');
  assert.match(
    bare.slice(bare.indexOf('async function loadPollEvent')),
    /pollReadRelays\(state\.activePubkey\)/,
    'and fetching a poll a notification named by id'
  );
});

test('THE BELL CARRIES A POLLS TAB, NOT A BUTTON OUT OF THE BELL', () => {
  // A vote notification takes you to the tally once; close it and there is nothing to
  // return to unless somebody votes again, and the post banner dismisses itself after a
  // minute. The first answer was a worded button in the sheet's header that opened a
  // separate sheet, which is easy to miss and leaves the bell, the surface the question
  // is asked from. Gated on ids already loaded for the notification filters, so it still
  // costs no extra query.
  assert.match(bare, /function accountHasPolls\(pubkey\)/);
  const body = notifModalBody();
  assert.match(body, /if \(accountHasPolls\(a\.pubkey\)\) \{/, 'the tab is gated on having polls');
  assert.match(body, /className: 'modal-tabs'/, 'the same bar the Activity sub-tabs use');
  assert.match(
    body,
    /wireTabSlider\(tabs, '\.modal-tab'\)/,
    'or this is the one bar in the panel with no traveling underline'
  );

  // The second pane is the notification pane's own class again, so the scrolling and the
  // edge-to-edge negative margins cannot drift apart.
  assert.match(body, /pollPane = h\('div', \{ className: 'notif-scroll hidden' \}\)/);
  assert.match(body, /scroll\.classList\.toggle\('hidden', polls\)/, 'one pane goes');
  assert.match(body, /pollPane\.classList\.toggle\('hidden', !polls\)/, 'the other arrives');

  // Lazily. Opening the bell is the common case and must not pay for a poll query.
  assert.match(body, /if \(polls && !filled\) \{\n +filled = true;\n +fillPollsList\(pollList, a\.pubkey, \{/);

  // THE TAB IS THE ONLY LIST. A second surface listing the same polls is a second place
  // to keep in step, and the one that used to sit on Profile said the same thing twice.
  assert.match(bare, /async function fillPollsList\(list, pubkey, \{ openPoll, onCount \}\)/);
  assert.equal((bare.match(/fillPollsList\(/g) || []).length, 2, 'one definition, one caller');
});

test('THE NUMBER ON THE TAB IS HOW MANY POLLS ARE IN IT', () => {
  // It counted the OPEN ones first, which is a different question from the one a number
  // beside a tab asks. Against a list of three rows with two of them still running, it
  // just read as a wrong number.
  //
  // In a capsule, not loose in the label: "Polls 3" is one string to the eye and the
  // number has to be picked back out of it.
  const body = notifModalBody();
  assert.match(body, /className: 'modal-tab', type: 'button', textContent: 'Polls'/, 'the word');
  assert.match(body, /className: 'modal-tab-count', textContent: String\(n\)/, 'and the number');
  assert.doesNotMatch(bare, /openPollCount/, 'the open-only count is gone, not left alongside');
});

test('the count is seeded free, then corrected by the list that knows', () => {
  // ownPollCount is the notification filters' own ids: capped at 50 and fetched from the
  // notification relay set, where the list uses pollReadRelays. Free and usually right, so
  // it labels the tab the instant the sheet opens, but it is not the authority.
  const body = notifModalBody();
  assert.match(body, /setCount\(ownPollCount\(a\.pubkey\)\);/, 'the instant answer');
  assert.match(body, /onCount: setCount,/, 'and the real one when the list has it');
  assert.match(bare, /function ownPollCount\(pubkey\)/);
  assert.match(bare, /return ownPollCount\(pubkey\) > 0;/, 'one source for both questions');

  // Removed rather than shown as 0: a zero on a tab reads as something broken.
  const set = body.slice(body.indexOf('const setCount = (n) => {'));
  assert.match(set.slice(0, set.indexOf('};')), /if \(!n\) \{ if \(cap\) cap\.remove\(\); return; \}/);

  // Reported when the rows exist, not after the vote query, or the rows sit on screen
  // under a number that disagrees with them for as long as that query is allowed to run.
  const fn = bare.slice(bare.indexOf('async function fillPollsList'));
  const fill = fn.slice(0, fn.indexOf('\n  }'));
  // Both options have to be READ, not just passed: a hardcoded null here would leave
  // every assertion about the call sites above true and the feature gone. Destructured in
  // the signature and used unguarded, since the one caller passes both.
  assert.match(bare, /async function fillPollsList\(list, pubkey, \{ openPoll, onCount \}\)/);
  assert.match(fill, /onCount\(polls\.length\);/);
  const reported = fill.indexOf('onCount(polls.length)');
  const votes = fill.indexOf("kinds: [POLL_RESPONSE_KIND], '#e'");
  // > -1 first. indexOf returns -1 for a line that is simply gone, and -1 is less than
  // every real index, so the ordering check alone passes loudest when it should fail.
  assert.ok(reported > -1, 'nothing reports the real count');
  assert.ok(votes > -1 && reported < votes, 'the count must not wait on the votes');
  // One report covers both cases: polls.length is 0 for an account with none, and it goes
  // out BEFORE the empty-list return rather than from inside it, so a tab labeled with a
  // stale number from the cache is corrected even when the answer is that there are none.
  // Matched on the early return's own cache write, since `if (!polls.length)` also appears
  // inside the shared renderer above it and would be found there first.
  const emptyReturn = fill.indexOf('_pollListCache.set(pubkey, { polls, counts: new Map() });');
  assert.ok(emptyReturn > -1 && reported < emptyReturn, 'an account with none must still say so');
});

test('the count capsule takes its color from the tab it sits in', () => {
  // A fixed tint would have to be chosen per theme, and whichever one it was would make
  // the unselected tab the louder of the two. currentColor is muted beside an inactive
  // label and --lav beside the active one, in all twelve themes, with no theme work.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const decls = css.slice(css.indexOf('.modal-tab-count {')).split('}')[0];
  assert.match(decls, /background: color-mix\(in srgb, currentColor \d+%, transparent\)/);
  assert.match(decls, /border-radius: 999px/, 'a capsule, not a box');
  assert.doesNotMatch(decls, /\bcolor:/, 'the ink is inherited too, or the two could disagree');
});

test('a line about what the panel is doing is not put in a card', () => {
  // .list.flat draws one velvet capsule around its rows. With a single line of text
  // inside, that capsule reads as a result that has arrived rather than as waiting for
  // one. .empty is the class that already drops the chrome, used by the connected-sites
  // list and by budgets, and it covers Profile too since both share this function.
  const fn = bare.slice(bare.indexOf('async function fillPollsList'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  const added = body.indexOf("list.classList.add('empty')");
  assert.ok(added > -1 && added < body.indexOf("'Looking for your polls…'"), 'chrome off first');
  // AFTER the no-polls early return, or an empty list gets a card drawn round one line.
  const removed = body.indexOf("list.classList.remove('empty')");
  assert.ok(removed > body.indexOf("'No polls yet. The composer can post one.'"), 'rows only');

  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const decls = css.slice(css.indexOf('.list.flat.empty {')).split('}')[0];
  assert.match(decls, /background: none/);
  assert.match(decls, /border: none/);
});

test('the old route out of the bell is gone, not left beside the tab', () => {
  // Two ways to the same list, one of them a button that leaves the sheet, is the thing
  // the tab was meant to replace.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.doesNotMatch(bare, /openPollsList/, 'the separate sheet');
  assert.doesNotMatch(bare, /notif-modal-polls/, 'and the header button that opened it');
  assert.doesNotMatch(css, /notif-modal-polls/, 'along with its rules');
});

test('A TALLY OPENED FROM THE BELL HAS A WAY BACK TO THE BELL', () => {
  // openPollResults takes the whole panel. Both routes into it start in the notification
  // sheet, so without this the only exit drops the reader on the main view, having lost
  // the list they were working through. Same shape as the composer's returnTo, which
  // exists for the same reason on the same sheet.
  const fn = bare.slice(bare.indexOf('async function openPollResults'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(bare, /async function openPollResults\(poll, relayHints, returnTo\)/);
  // On the modal's own close handler, so Escape and a click on the overlay are the same
  // departure as the button. Guarded, because a throwing return must not break closing.
  assert.match(body, /if \(!dismissAll && typeof returnTo === 'function'\) \{\n +try \{ returnTo\(\); \} catch \(_\) \{\}/);
});

test('THE TWO CORNERS ARE TWO DIFFERENT EXITS', () => {
  // A tally is a screen pushed on top of the sheet it came from, so it needs both the way
  // back to that sheet and the way out of the whole stack. An arrow at the left, a close
  // box at the right, and the arrow only when there is something under it.
  const fn = bare.slice(bare.indexOf('async function openPollResults'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /className: 'modal-x', type: 'button', title: 'Close'/);
  assert.match(body, /if \(returnTo\) \{\n +const backBtn = h\('button', \{ className: 'modal-x modal-back', type: 'button', title: 'Back' \}\);/);
  assert.match(body, /backBtn\.append\(icon\('arrow-left'\)\)/);
  assert.match(bare, /'arrow-left': '<line/, 'the icon has to exist, or the button is empty');

  // Only the X skips the return. Back, Escape and the overlay all dismiss the top of a
  // stack, which means handing back what was under it.
  assert.match(body, /xBtn\.addEventListener\('click', \(\) => \{ dismissAll = true; closeModal\(\); \}\)/);
  assert.match(body, /backBtn\.addEventListener\('click', closeModal\)/, 'Back must not skip it');
  // Declared in openPollResults, not in the builder: the close handler is a sibling
  // argument to openModal and cannot see anything the builder declares. This threw at
  // close time, which is the one moment nothing is left on screen to show it.
  assert.ok(
    body.indexOf('let dismissAll = false;') < body.indexOf('openModal((modal) => {'),
    'dismissAll has to outlive the builder that sets it'
  );

  // And the actions column keeps only the things you DO to the poll.
  assert.match(body, /const actions = h\('div', \{ className: 'actions' \}, \[recount, openOut\]\);/);
  assert.doesNotMatch(body, /textContent: 'Close'/, 'one close affordance, not two');
});

test('a heading clears both corners and sits centered between them', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.modal-back \{ left: 12px; right: auto; \}/);
  // BOTH SIDES, always, which is what the centering rests on. The corners are inset 12px
  // and 30px wide, so 34px a side puts the title on the sheet's midline, exactly between
  // them. Reserving only the corner that happens to be occupied would center it on what
  // was left over instead, and the same tally opened from the bell and from the banner
  // after posting would put its heading in two different places.
  assert.match(
    css,
    /\.modal-sheet > h3 \{ padding-left: 34px; padding-right: 34px; text-align: center; \}/,
    'the sheet title is centered between the corners'
  );
  // Comments stripped before the negative match, or a rule explaining why the class went
  // away is enough to fail this for a reason that has nothing to do with the styling.
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /has-back/,
    'a class reserving one corner is what centering replaced');
  assert.doesNotMatch(bare, /has-back/, 'and nothing should still be setting it');
});

test('both routes into a tally read their place before the sheet is gone', () => {
  // notifPlace() reads the live sheet. Called from inside the return instead, it would
  // run after the bell had been torn down and report an offset of zero every time.
  const body = notifModalBody();
  // The vote notification.
  assert.match(
    body,
    /const place = notifPlace\(\);\n +afterModalClose\(\(\) =>\n +openPollResults\(pollTarget, hints, \(\) => showNotifModal\(a, place\)\)/
  );
  // And a row in the Polls tab. Read at the tap, not when the list was filled: the
  // notification list can be scrolled in between.
  assert.match(
    body,
    /openPoll: \(ev\) => \{\n +const place = notifPlace\(\);\n[\s\S]{0,600}?afterModalClose\(\(\) => openPollResults\(ev, null, \(\) => showNotifModal\(a, place\)\)\);/
  );
});

test('a tally never opens straight over the bell, or the bell never gets to clean up', () => {
  // openModal overwrites modalCleanup. Opening the tally on top of the open sheet would
  // therefore replace the bell's close handler before it ran, and that handler is what
  // clears _openNotifBell. Left set, addLive goes on prepending arrivals into a list that
  // is no longer on screen, for the rest of the session. The flicker afterModalClose was
  // written for is the smaller half of this.
  const body = notifModalBody();
  assert.match(body, /\}, \(\) => \{\n +if \(_openNotifBell && _openNotifBell\.pubkey === a\.pubkey\) _openNotifBell = null;/,
    'the bell must have a close handler worth running');
  // Every route from this sheet into a tally goes through the close first.
  const opens = body.match(/openPollResults\(/g) || [];
  const viaClose = body.match(/afterModalClose\(\(\) =>\s*\n? *openPollResults\(/g) || [];
  assert.equal(opens.length, viaClose.length, 'a route into the tally skips afterModalClose');
});

test('the way back lands on the tab you left, after the list has its place', () => {
  // Coming back to All from a poll you opened on the Polls tab is only half a way back.
  const body = notifModalBody();
  assert.match(body, /tab: onPollsTab \? 'polls' : 'all',/, 'the place has to carry the tab');
  assert.match(body, /onPollsTab = polls;/, 'and something has to set it');
  assert.match(body, /if \(place && place\.tab === 'polls' && showPollsTab\) setTimeout\(showPollsTab, 0\);/);
  // AFTER the offset restore. scrollTop does not apply to a display:none pane, so hiding
  // the notifications first throws away the place for the tab you are not landing on.
  assert.ok(
    body.indexOf("place.tab === 'polls'") > body.indexOf('scroll.scrollTop = want'),
    'the tab switch must come after the offset it would otherwise discard'
  );
  // Not animated: arriving back where you were is not a state change.
  assert.match(body, /tabs\.moveSlider\(tabPolls, false\)/);
});

test('THE LIST OF YOUR POLLS HAS ONE HOME, AND IT IS THE BELL', () => {
  // Profile carried the same list under its own heading. Two surfaces listing the same
  // polls is two things to keep in step for one question, and the bell is where you go to
  // ask what happened to something you posted, so the section went rather than the tab.
  assert.doesNotMatch(bare, /renderPollsSection/, 'the Profile section is back');
  assert.doesNotMatch(bare, /Your polls/, 'and so is its heading');
  // Which leaves the caller's opener as the only way a row opens. No fallback to a plain
  // openPollResults, because there is no longer a caller that hands over none, and a
  // branch nothing takes is a branch nothing keeps honest.
  assert.match(bare, /const open = \(\) => openPoll\(ev\);/);
});

test('the header title box can still shrink, which was never really about the button', () => {
  // .notif-modal-sub has carried overflow/text-overflow since it was written and never
  // truncated, because a flex child defaults to min-width: auto and grows to fit the
  // name. The Polls button is what made it visible, since a long display name pushed it
  // 145px past the edge of the sheet, but a name that never truncates is a bug with or
  // without something sitting to its right.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rule = css.slice(css.indexOf('.notif-modal-titlebox {'));
  assert.match(rule.slice(0, rule.indexOf('}')), /min-width: 0/);
  assert.match(bare, /className: 'notif-modal-titlebox'/, 'and the element has to carry the class');
});

test('a poll that is still running is listed above one that has closed', () => {
  // By created_at alone a poll taking votes right now sits wherever it was posted, under
  // everything written since, and a running poll is the one you opened the tab for.
  // The tab is this function, so the ordering belongs here rather than at the call site.
  const fn = bare.slice(bare.indexOf('async function fillPollsList'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  // pollIsPast, not pollHasEnded, and the difference is not cosmetic: the headings ask
  // pollIsPast, so sorting on the narrower question put an open-ended poll left a month at
  // the top of the list under a heading reading Ended, and split the finished ones into
  // two runs with the live ones between them.
  assert.match(body, /const xPast = pollIsPast\(x\)/);
  assert.match(body, /if \(xPast !== yPast\) return xPast \? 1 : -1;/, 'open ones first');
  assert.doesNotMatch(body, /pollHasEnded\(pollEndsAt\(x\)\)/,
    'the sort is back on the narrower question and will interleave the groups');
  assert.match(body, /return y\.created_at - x\.created_at;/, 'newest first inside each group');
});
