'use strict';

// A NIP-19 event reference in a note body describes the REFERENCED event. It must never
// replace the kind of the outer event being approved for signing.
//
// Reported as: posting a kind:1 note whose body carried an `nevent` showed an
// unrecognized event kind on the approval screen. The first version of this test used
// the reference from the report — which decodes to kind 1 itself — and asserted that a
// kind:1 event labels as "1 — Note". That can't fail: if Sidecar DID substitute the
// referenced kind, the label would read "1 — Note" either way. The fixtures below carry
// a referenced kind that is deliberately NOT the outer kind, so a leak would show up as
// a wrong label instead of hiding behind a matching one.
//
// Both approval surfaces are covered, because there are two: the side panel's own card
// (sidepanel.js) and the standalone popup window (prompt.js). They keep separate copies
// of the kind tables, so the last test here pins them to each other — a kind that
// labels on one surface and not the other is the same bug wearing a different hat.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// The reference from the report, kept as the original fixture. It decodes to kind 1.
const REPORTED_NEVENT =
  'nevent1qvzqqqqqqypzpmnw5yatnljuff5w47d35d87q99xddqpzlzsac4xzn6vm22ekmn5qyt8wumn8ghj7mn0wd68yetvd96x2uewdaexwtcpzamhxue69uhhyetvv9ujuct60fsk6mewdejhgtcqyqqqpewddujmzj23fcfpaeygep2xl763u6r6n86ktwmcksalm0n4wxy2yhr';

// The two approval surfaces, and the names each gives the same four things.
const SURFACES = [
  {
    file: 'sidepanel.js',
    labels: 'APPROVAL_KIND_LABELS',
    warnings: 'APPROVAL_KIND_WARNINGS',
    labelFn: 'approvalKindLabel',
    warningFn: 'approvalKindWarning',
    unreadableFn: 'approvalKindUnreadable',
    unreadableWarning: 'APPROVAL_UNREADABLE_WARNING',
  },
  {
    file: 'prompt.js',
    labels: 'KIND_LABELS',
    warnings: 'KIND_WARNINGS',
    labelFn: 'kindLabel',
    warningFn: 'kindWarning',
    unreadableFn: 'kindUnreadable',
    unreadableWarning: 'UNREADABLE_WARNING',
  },
];

function approvalKindFns(s) {
  const source = fs.readFileSync(path.join(ROOT, s.file), 'utf8');
  const grab = (re, what) => {
    const m = source.match(re);
    if (!m) throw new Error('Could not lift ' + what + ' from ' + s.file);
    return m[0];
  };
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    [
      grab(new RegExp('const ' + s.labels + ' = \\{[\\s\\S]*?\\n  \\};'), s.labels),
      grab(new RegExp('const ' + s.warnings + ' = \\{[\\s\\S]*?\\n  \\};'), s.warnings),
      grab(new RegExp('function ' + s.labelFn + '\\(kind\\) \\{[\\s\\S]*?\\n  \\}'), s.labelFn),
      grab(new RegExp('function ' + s.warningFn + '\\(kind\\) \\{[\\s\\S]*?\\n  \\}'), s.warningFn),
      grab(new RegExp('function ' + s.unreadableFn + '\\(ev\\) \\{[\\s\\S]*?\\n  \\}'), s.unreadableFn),
      grab(new RegExp('const ' + s.unreadableWarning + ' =\\n?[\\s\\S]*?;'), s.unreadableWarning),
      'globalThis.label = ' + s.labelFn + ';',
      'globalThis.warning = ' + s.warningFn + ';',
      'globalThis.unreadable = ' + s.unreadableFn + ';',
      'globalThis.unreadableWarning = ' + s.unreadableWarning + ';',
      'globalThis.labels = ' + s.labels + ';',
      'globalThis.warnings = ' + s.warnings + ';',
    ].join('\n'),
    context
  );
  return context;
}

function nostrTools() {
  const c = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), c);
  return c.NostrTools;
}
const NT = nostrTools();

// A kind:1 note quoting a LONG-FORM ARTICLE (kind 30023). Outer kind and referenced
// kind now differ, which is the whole point.
const ARTICLE_NEVENT = NT.nip19.neventEncode({
  id: 'b'.repeat(64),
  author: 'c'.repeat(64),
  kind: 30023,
  relays: ['wss://relay.example.com/'],
});

test('the fixtures really do carry the kinds these tests assume', () => {
  assert.equal(NT.nip19.decode(REPORTED_NEVENT).data.kind, 1);
  assert.equal(NT.nip19.decode(ARTICLE_NEVENT).data.kind, 30023);
});

test('a body reference cannot change the kind of the event being signed', () => {
  const events = [
    // The reported case, kept verbatim.
    { kind: 1, tags: [], content: 'Replying to nostr:' + REPORTED_NEVENT },
    // The case that can actually catch a leak: if the referenced kind ever reached the
    // label, this would read "30023 — Long-form article".
    { kind: 1, tags: [], content: 'Worth reading: nostr:' + ARTICLE_NEVENT },
    // And the inverse — an article whose body quotes a note must stay an article.
    { kind: 30023, tags: [['d', 'my-post']], content: 'As I said in nostr:' + REPORTED_NEVENT },
  ];
  const expected = { 1: '1 — Note', 30023: '30023 — Long-form article' };
  for (const s of SURFACES) {
    const { label, warning } = approvalKindFns(s);
    for (const ev of events) {
      assert.equal(label(ev.kind), expected[ev.kind], s.file + ' must label the OUTER event');
      assert.equal(warning(ev.kind), null, s.file + ' must not warn about an unknown kind');
    }
  }
});

test('an event with no readable kind is called out, not shown as a blank row', () => {
  // The shapes normalizeSignEventParams now rejects at the RPC boundary. If one ever
  // reaches a prompt again, the card has to say so — the old behavior was a "Kind —"
  // row with Allow looking as ordinary as ever.
  for (const s of SURFACES) {
    const { unreadable, unreadableWarning, label } = approvalKindFns(s);
    for (const ev of [{}, { kind: null }, { kind: '1' }, { kind: 1.5 }, 'a json string', undefined]) {
      assert.equal(unreadable(ev), true, s.file + ': ' + JSON.stringify(ev) + ' is not a readable event');
    }
    assert.equal(unreadable({ kind: 1 }), false);
    assert.equal(unreadable({ kind: 30023 }), false);
    assert.match(unreadableWarning, /can't read this request/);
    // The label helper still has its own null answer; the surfaces just don't rely on
    // it to carry the warning any more.
    assert.equal(label(null), '—');
  }
});

test('both approval surfaces know exactly the same kinds', () => {
  // Two copies of the tables, one per surface. A kind added to one and not the other
  // means the same event reads as "unrecognized" in the panel and named in the popup
  // (or the reverse), which is how a "wrong kind" report gets filed in the first place.
  const [panel, popup] = SURFACES.map(approvalKindFns);
  assert.deepEqual(Object.keys(panel.labels).sort(), Object.keys(popup.labels).sort());
  for (const k of Object.keys(panel.labels)) {
    assert.equal(panel.labels[k], popup.labels[k], 'kind ' + k + ' must read the same on both surfaces');
  }
  assert.deepEqual(Object.keys(panel.warnings).sort(), Object.keys(popup.warnings).sort());
  for (const k of Object.keys(panel.warnings)) {
    assert.equal(panel.warnings[k], popup.warnings[k], 'kind ' + k + "'s warning must read the same on both surfaces");
  }
  assert.equal(panel.unreadableWarning, popup.unreadableWarning);
});
