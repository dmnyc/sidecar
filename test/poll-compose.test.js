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
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

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

// ---- getting back to a poll --------------------------------------------------------

test('A POLL IS READ BACK FROM THE RELAYS IT WAS PUBLISHED TO', () => {
  // readRelayUrls is built for replaceable events: NIP-65 READ relays plus
  // purplepag.es, which aggregates kinds 0, 3 and 10002. A poll is none of those. It
  // goes to postRelays, the WRITE set, and NIP-65 lets those two lists be completely
  // disjoint, so reading from the read set alone found nothing on exactly the accounts
  // that declare a real split, and Your polls came up empty while the poll sat on the
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

test('the bell offers a way back, because a vote notification is a one-shot route', () => {
  // The notification takes you to the tally once; close it and there is nothing to
  // return to unless somebody votes again, and the post banner dismisses itself after a
  // minute. Gated on ids that are already loaded for the notification filters, so it
  // costs no extra query, and Profile still lists polls unconditionally.
  assert.match(bare, /function accountHasPolls\(pubkey\)/);
  assert.match(bare, /if \(accountHasPolls\(a\.pubkey\)\) \{/, 'the bell header must offer it');
  assert.match(bare, /afterModalClose\(openPollsList\)/, 'and hand off after the sheet closes');
  // One list, filled by one function, or the sheet and the Profile section drift.
  assert.match(bare, /async function fillPollsList\(list, pubkey\)/);
  assert.match(bare, /await fillPollsList\(list, active\.pubkey\)/, 'Profile uses it');
  assert.match(bare, /fillPollsList\(list, state\.activePubkey\)/, 'and so does the sheet');
});

test('the header title box can shrink, or the button it sits beside is pushed off', () => {
  // .notif-modal-sub has carried overflow/text-overflow since it was written and never
  // truncated, because a flex child defaults to min-width: auto and grows to fit the
  // name. Harmless while nothing sat to its right; with a Polls button there, a long
  // display name pushed it 145px past the edge of the sheet.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rule = css.slice(css.indexOf('.notif-modal-titlebox {'));
  assert.match(rule.slice(0, rule.indexOf('}')), /min-width: 0/);
  assert.match(bare, /className: 'notif-modal-titlebox'/, 'and the element has to carry the class');
});
