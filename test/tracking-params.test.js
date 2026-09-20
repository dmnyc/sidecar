'use strict';

// Taking the tracking tail off a link pasted into a composer.
//
// The functions are LIFTED AND RUN rather than grepped, because every claim this makes
// is about a string transformation and a source assertion cannot tell a correct one from
// a plausible one. The load-bearing promise is narrow and mechanical: the output is the
// input minus whole query parameters. Nothing else moves. A path stays, a fragment
// stays, and a parameter being kept comes back encoded exactly as it arrived.
//
// The list of what counts as tracking is SHARED with normalizeWebUrl next door, which
// builds thread identifiers for web comments. That is deliberate and it is why this file
// also pins the difference between the two: normalizeWebUrl sorts the query and drops the
// fragment, both of which would be edits to a link nobody asked us to edit.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bare = source.replace(/^\s*\/\/.*$/gm, '');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const ctx = { console, URL, Set };
vm.createContext(ctx);
vm.runInContext(
  lift(/const TRACKING_PARAMS = \[[\s\S]*?\n  \];/, 'TRACKING_PARAMS') + '\n' +
  lift(/const TRACKING_PREFIXES = \[[^\]]*\];/, 'TRACKING_PREFIXES') + '\n' +
  lift(/const HOST_TRACKING_PARAMS = \[[\s\S]*?\n  \];/, 'HOST_TRACKING_PARAMS') + '\n' +
  lift(/function isTrackingParam\(name\)\s*\{[\s\S]*?\n  \}/, 'isTrackingParam') + '\n' +
  lift(/function hostTrackingParams\(hostname\)\s*\{[\s\S]*?\n  \}/, 'hostTrackingParams') + '\n' +
  lift(/function cleanTrackedUrl\(raw\)\s*\{[\s\S]*?\n  \}/, 'cleanTrackedUrl') + '\n' +
  lift(/function trimUrlTail\(url\)\s*\{[\s\S]*?\n  \}/, 'trimUrlTail') + '\n' +
  lift(/function findTrackedUrls\(text\)\s*\{[\s\S]*?\n  \}/, 'findTrackedUrls') + '\n' +
  'globalThis.cleanTrackedUrl = cleanTrackedUrl;' +
  'globalThis.findTrackedUrls = findTrackedUrls;' +
  'globalThis.trimUrlTail = trimUrlTail;',
  ctx
);
const { cleanTrackedUrl, findTrackedUrls, trimUrlTail } = ctx;

test('a utm tail comes off and the rest of the link does not move', () => {
  assert.equal(
    cleanTrackedUrl('https://example.com/a/b?id=7&utm_source=newsletter&utm_medium=email'),
    'https://example.com/a/b?id=7'
  );
  // The whole query was tracking, so the question mark goes with it. A trailing ? is a
  // different string than no query at all, and some servers treat it as one.
  assert.equal(cleanTrackedUrl('https://example.com/a?utm_campaign=x'), 'https://example.com/a');
  // Nothing to take off is null, not a copy. The offer must not appear for a clean link.
  assert.equal(cleanTrackedUrl('https://example.com/a?id=7'), null);
  assert.equal(cleanTrackedUrl('https://example.com/a'), null);
});

test('THE OUTPUT IS THE INPUT MINUS WHOLE PARAMETERS, AND NOTHING ELSE', () => {
  // The promise that makes this safe to run against a site nobody here has heard of. Any
  // rebuild through URL or URLSearchParams breaks it, which is why the implementation
  // works on the query string as text.
  const cases = [
    'https://example.com/path/with.dots/and-dashes?q=a%20b&utm_source=x',
    'https://example.com/?keep=%5Bbracketed%5D&fbclid=123',
    'https://example.com/p?a=1&utm_term=t&b=2&gclid=9&c=3',
    'https://user.example.com:8443/deep/path?x=1&utm_id=7',
  ];
  for (const raw of cases) {
    const out = cleanTrackedUrl(raw);
    assert.ok(out, raw);
    const rawParts = raw.slice(raw.indexOf('?') + 1).split('&');
    const outParts = out.includes('?') ? out.slice(out.indexOf('?') + 1).split('&') : [];
    for (const part of outParts) {
      assert.ok(rawParts.includes(part), 'parameter was rewritten, not kept: ' + part);
    }
    assert.ok(outParts.length < rawParts.length);
    // And the half before the query is byte-identical, port, case, dots and all.
    assert.equal(out.split('?')[0], raw.split('?')[0]);
  }
});

test('encoding survives, because re-encoding is an edit', () => {
  // URLSearchParams turns %20 into + and escapes brackets it was handed raw. Both are a
  // different URL than the one that was pasted, on a path whose whole claim is that it
  // changes nothing it was not asked to.
  assert.equal(
    cleanTrackedUrl('https://example.com/s?q=one%20two&utm_source=x'),
    'https://example.com/s?q=one%20two'
  );
  assert.equal(
    cleanTrackedUrl('https://example.com/s?q=a+b&fbclid=1'),
    'https://example.com/s?q=a+b'
  );
});

test('the fragment stays, and the order of what is kept stays', () => {
  // normalizeWebUrl drops the fragment and sorts the query, which is right for a thread
  // identifier and wrong for somebody's link: #installation is where they meant to send
  // you, and a reordered query is a link they did not write.
  assert.equal(
    cleanTrackedUrl('https://docs.example.com/guide?utm_source=x&v=2#installation'),
    'https://docs.example.com/guide?v=2#installation'
  );
  assert.equal(
    cleanTrackedUrl('https://example.com/?z=1&utm_medium=m&a=2'),
    'https://example.com/?z=1&a=2'
  );
});

test('the path is never touched', () => {
  // Several sites carry tracking in path segments, and nothing tells those apart from an
  // id without knowing the site. Refusing to touch a path is what keeps the rule general.
  assert.equal(cleanTrackedUrl('https://example.com/ref=abc123/page?utm_source=x'),
    'https://example.com/ref=abc123/page');
  assert.equal(cleanTrackedUrl('https://example.com/utm_source/page'), null);
});

test('A SHORT NAME IS ONLY TRACKING ON THE HOST THAT OWNS IT', () => {
  // `t` and `s` on x.com are a share token and where the share came from. As global rules
  // they would gut a search URL on some unrelated site, so they are scoped to the host.
  assert.equal(cleanTrackedUrl('https://x.com/someone/status/123?s=20&t=AbCd'),
    'https://x.com/someone/status/123');
  assert.equal(cleanTrackedUrl('https://example.com/search?s=20&t=AbCd'), null);
  // YouTube keeps the video id and loses the share id, which is the case this list was
  // written for in the first place.
  assert.equal(cleanTrackedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(cleanTrackedUrl('https://youtu.be/dQw4w9WgXcQ?si=xyz&t=43'),
    'https://youtu.be/dQw4w9WgXcQ?t=43', 'youtu.be t= is a timestamp, not x.com t=');
});

test("Amazon's affiliate tag is deliberately left alone", () => {
  // Sometimes the affiliate code is the entire reason somebody shared the link. A button
  // offering to remove tracking must not quietly be a button that removes their earnings.
  assert.equal(cleanTrackedUrl('https://www.amazon.com/dp/B000?tag=someone-20'), null);
  // utm on the same URL still comes off, since that one is nobody's income.
  assert.equal(cleanTrackedUrl('https://www.amazon.com/dp/B000?tag=someone-20&utm_source=x'),
    'https://www.amazon.com/dp/B000?tag=someone-20');
});

test('only http and https, so a nostr: or mailto: link is left where it is', () => {
  assert.equal(cleanTrackedUrl('nostr:npub1abc?utm_source=x'), null);
  assert.equal(cleanTrackedUrl('mailto:someone@example.com?utm_source=x'), null);
  assert.equal(cleanTrackedUrl('not a url at all'), null);
  assert.equal(cleanTrackedUrl(''), null);
  assert.equal(cleanTrackedUrl(null), null);
});

test('trailing punctuation belongs to the sentence, not the link', () => {
  assert.equal(trimUrlTail('https://example.com/a?utm_source=x.'), 'https://example.com/a?utm_source=x');
  assert.equal(trimUrlTail('https://example.com/a),'), 'https://example.com/a');
  // A closing bracket the URL opened itself is part of the URL. Wikipedia depends on it.
  assert.equal(trimUrlTail('https://en.wikipedia.org/wiki/Foo_(bar)'),
    'https://en.wikipedia.org/wiki/Foo_(bar)');
});

test('finding them in a line of writing', () => {
  const hits = findTrackedUrls(
    'read this https://example.com/a?utm_source=x. and this https://example.com/b?id=1'
  );
  assert.equal(hits.length, 1, 'the clean link must not be offered');
  assert.equal(hits[0].raw, 'https://example.com/a?utm_source=x');
  assert.equal(hits[0].clean, 'https://example.com/a');
  // Lengths rather than deepEqual: these arrays are made inside the vm realm, so their
  // prototype is not this one's and a strict structural compare fails on identity alone.
  assert.equal(findTrackedUrls('nothing here').length, 0);
  assert.equal(findTrackedUrls('').length, 0);
  assert.equal(findTrackedUrls(null).length, 0);
});

test('LONGEST FIRST, or replacing one link eats the front of another', () => {
  // Two shares of the same page with different campaign ids produce exactly this: one
  // URL is a strict prefix of the other, and replacing the short one first would leave
  // the long one spliced.
  const hits = findTrackedUrls(
    'https://example.com/a?utm_source=x https://example.com/a?utm_source=xy&id=1'
  );
  assert.equal(hits.length, 2);
  assert.ok(hits[0].raw.length >= hits[1].raw.length);
  // And the replacement the composer performs leaves both links intact.
  let text = 'https://example.com/a?utm_source=x https://example.com/a?utm_source=xy&id=1';
  for (const hit of hits) text = text.split(hit.raw).join(hit.clean);
  assert.equal(text, 'https://example.com/a https://example.com/a?id=1');
});

test('the same link twice is offered once and cleaned everywhere', () => {
  const dup = 'https://example.com/a?utm_source=x';
  const hits = findTrackedUrls(dup + ' and again ' + dup);
  assert.equal(hits.length, 1);
  let text = dup + ' and again ' + dup;
  for (const hit of hits) text = text.split(hit.raw).join(hit.clean);
  assert.equal(text, 'https://example.com/a and again https://example.com/a');
});

// ---- the offer, rather than the cleaning ---------------------------------------------

test('OFFERED, NEVER DONE FOR YOU', () => {
  // The whole reason this is a button. Sidecar's claim is that it signs what you asked it
  // to sign, and rewriting the words in a composer on the way in is the same kind of act
  // as rewriting an event on the way out. So the paste handler observes and does not
  // touch the text, and the one place the replacement happens is a click listener.
  const paste = bare.match(/editor\.addEventListener\('paste', [^\n]*\n?/);
  assert.ok(paste, 'no paste hook in the editor factory');
  assert.ok(!/preventDefault/.test(paste[0]), 'the scan must not interfere with the paste');
  assert.match(paste[0], /setTimeout\(scanTracking, 0\)/);

  const replacements = bare.match(/text\.split\(hit\.raw\)\.join\(hit\.clean\)/g) || [];
  assert.equal(replacements.length, 1, 'the text is rewritten in exactly one place');
  const click = bare.slice(bare.indexOf("trackBtn.addEventListener('click'"));
  assert.match(click.slice(0, click.indexOf('});') + 3), /text\.split\(hit\.raw\)\.join\(hit\.clean\)/,
    'and that place is the button');
});

test('one tap, with nothing to put right afterwards', () => {
  // The rewrite replaces every node in the editor. focus() alone would leave the caret at
  // the top of it, so cleaning a link mid-sentence would cost a click to get back to
  // where you were typing, which is most of the convenience this is for.
  const click = bare.slice(bare.indexOf("trackBtn.addEventListener('click'"));
  const body = click.slice(0, click.indexOf('\n    });') + 7);
  assert.match(body, /editor\.focus\(\);/);
  assert.match(body, /end\.selectNodeContents\(editor\);\s*\n\s*end\.collapse\(false\);/);
  // And no confirm anywhere on the path: the button IS the decision.
  assert.ok(!/confirm|Are you sure/i.test(body), 'the offer must not ask twice');
});

test('BOTH COMPOSERS, because it is built where both of them are', () => {
  // The note composer and the page-comment box are two call sites of one factory. Adding
  // this to the note composer's own toolbar would have shipped it to one of them, which
  // is the recurring shape of a half-done change in this codebase.
  const factory = bare.slice(bare.indexOf('function createMentionEditor(opts) {'));
  const body = factory.slice(0, factory.indexOf('\n  }\n'));
  assert.match(body, /wrap\.append\(trackRow\);/, 'the offer must live in the shared factory');
  assert.equal((bare.match(/createMentionEditor\(\{/g) || []).length, 2,
    'a third composer appeared; check it goes through the factory');
});

test('the count is only spoken when there is more than one', () => {
  assert.match(bare, /\? 'Remove tracking tags'\s*\n\s*: 'Remove tracking tags from ' \+ tracked\.length \+ ' links'/);
});

test('a restored draft is scanned too, not only a fresh paste', () => {
  // The draft is written to storage with whatever was pasted into it, so the tail comes
  // back with the text on the next session.
  const set = bare.slice(bare.indexOf('setText(text) {'));
  assert.match(set.slice(0, set.indexOf('},')), /scanTracking\(\);/);
});

test('the row is hidden until there is something to offer, and spans when shown', () => {
  assert.match(bare, /const trackRow = h\('div', \{ className: 'track-row hidden' \}\);/);
  assert.match(bare, /if \(!tracked\.length\) \{ hide\(trackRow\); return; \}/);
  // A .mini.ghost compose-add: the composer's own control metrics, inheriting
  // `flex: 1 0 auto` so a control with words on it takes its own full-width row. Nothing
  // here invents a smaller button to make something fit, which is the panel's one
  // standing prohibition.
  assert.match(bare, /className: 'mini ghost compose-add track-clean'/);
  assert.match(css, /\.track-row \{ display: flex; margin: 7px 0 0; \}/);
});
