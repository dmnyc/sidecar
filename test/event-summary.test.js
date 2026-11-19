'use strict';

// Reading an event for the approval card (event-summary.js), and what both approval
// surfaces say about a kind that is not in their table. The module runs for real, and the
// label and warning functions are lifted out of sidepanel.js and prompt.js and run against
// the real English i18n, the way approval-kind-isolation.test.js does it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n.js');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x)); // across the vm's realm

function loadModule() {
  const ctx = vm.createContext({});
  ctx.self = ctx; ctx.globalThis = ctx;
  vm.runInContext(src('event-summary.js'), ctx);
  return ctx.SidecarEventSummary;
}
const S = loadModule();

// What a site sent in the report: an MCP initialize carried in a kind 25910.
const REPORTED = '{"jsonrpc":"2.0","id":"9eb9894f-7474-4d07-a474-09eb9aa01eee","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"jank","version":"26.16.0"}}}';

test('NIP-01 ranges: ephemeral, replaceable, addressable, regular; no range for what is not a kind', () => {
  assert.equal(S.kindRange(25910), 'ephemeral');
  assert.equal(S.kindRange(20000), 'ephemeral');
  assert.equal(S.kindRange(29999), 'ephemeral');
  assert.equal(S.kindRange(10002), 'replaceable');
  assert.equal(S.kindRange(0), 'replaceable');
  assert.equal(S.kindRange(3), 'replaceable');
  assert.equal(S.kindRange(30023), 'addressable');
  assert.equal(S.kindRange(39999), 'addressable');
  assert.equal(S.kindRange(40000), 'regular');
  assert.equal(S.kindRange(1), 'regular');
  assert.equal(S.kindRange(9999), 'regular');
  for (const bad of [null, undefined, '25910', 25910.5, NaN, {}]) assert.equal(S.kindRange(bad), null, String(bad));
});

test('a JSON-RPC request names its method; a reply, a note and a non-object do not', () => {
  assert.deepEqual(plain(S.jsonRpc(REPORTED)), { method: 'initialize' });
  assert.equal(S.jsonRpc('{"jsonrpc":"2.0","id":1,"result":{}}'), null, 'a reply has no method');
  assert.equal(S.jsonRpc('{"jsonrpc":"1.0","method":"x"}'), null);
  assert.equal(S.jsonRpc('{"method":"x"}'), null, 'jsonrpc 2.0 is the test');
  assert.equal(S.jsonRpc('{"jsonrpc":"2.0","method":""}'), null);
  assert.equal(S.jsonRpc('hello'), null);
  assert.equal(S.jsonRpc('[1,2]'), null);
  assert.equal(S.jsonRpc(undefined), null);
});

test('the reported message becomes rows, nested objects flattened', () => {
  const f = S.fields(REPORTED);
  assert.deepEqual(plain(f.rows), [
    ['jsonrpc', '2.0'],
    ['id', '9eb9894f-7474-4d07-a474-09eb9aa01eee'],
    ['method', 'initialize'],
    ['params.protocolVersion', '2025-06-18'],
    ['params.capabilities', '{}'],
    ['params.clientInfo.name', 'jank'],
    ['params.clientInfo.version', '26.16.0'],
  ]);
  assert.equal(f.more, 0);
});

test('profile-like content is rows too, and anything that is not an object stays as it is', () => {
  assert.deepEqual(plain(S.fields('{"name":"A","about":"B","n":3,"ok":true,"gone":null}').rows),
    [['name', 'A'], ['about', 'B'], ['n', '3'], ['ok', 'true'], ['gone', 'null']]);
  for (const c of ['', 'plain words', '[1,2,3]', '"a string"', '42', '{', '{}', '{"a":{}}x', undefined, null]) {
    assert.equal(S.fields(c), null, JSON.stringify(c));
  }
  // An empty nested object is a value, not nothing: the row says it is there.
  assert.deepEqual(plain(S.fields('{"a":{}}').rows), [['a', '{}']]);
  // Arrays are values, shown compactly.
  assert.deepEqual(plain(S.fields('{"list":[1,2]}').rows), [['list', '1, 2']]);
});

test('rows are capped and the rest is counted, a long value is cut, a huge content is not parsed', () => {
  const big = {};
  for (let i = 0; i < 40; i++) big['k' + i] = i;
  const f = S.fields(JSON.stringify(big));
  assert.equal(f.rows.length, S.MAX_ROWS);
  assert.equal(f.more, 40 - S.MAX_ROWS);
  const long = S.fields(JSON.stringify({ a: 'x'.repeat(500) }));
  assert.ok(long.rows[0][1].length <= 201 && long.rows[0][1].endsWith('…'));
  assert.equal(S.fields('{"a":"' + 'x'.repeat(30000) + '"}'), null);
  // Depth is bounded: a page cannot make the walk deep.
  let deep = '1';
  for (let i = 0; i < 50; i++) deep = '{"a":' + deep + '}';
  assert.ok(S.fields(deep).rows.length === 1);
});

test('a key that is __proto__ is just a key', () => {
  const f = S.fields('{"__proto__":{"x":1},"y":2}');
  assert.deepEqual(plain(f.rows), [['__proto__.x', '1'], ['y', '2']]);
  assert.equal({}.x, undefined, 'Object.prototype was not touched');
});

test('tag names are counted in the order first seen, cut when long, and capped at six', () => {
  assert.equal(S.tagNames([['p', 'a']]), 'p');
  assert.equal(S.tagNames([['p', 'a'], ['e', 'b'], ['p', 'c'], ['t', 'x']]), 'p ×2, e, t');
  assert.equal(S.tagNames([['averyveryverylongtagname', 'x']]), 'averyveryver');
  assert.equal(S.tagNames(['not an array', [], [7]]), '? ×3');
  assert.equal(S.tagNames(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => [n])), 'a, b, c, d, e, f, …');
  assert.equal(S.tagNames(undefined), '');
});

// ---- both surfaces say the same thing about the same kind ----

const SURFACES = [
  { file: 'sidepanel.js', labels: 'approvalKindLabels', warnings: 'approvalKindWarnings', label: 'approvalKindLabel', warning: 'approvalKindWarning' },
  { file: 'prompt.js', labels: 'kindLabels', warnings: 'kindWarnings', label: 'kindLabel', warning: 'kindWarning' },
];

function surface(s) {
  const source = src(s.file);
  const grab = (name, arg) => {
    const m = source.match(new RegExp('function ' + name + '\\(' + arg + '\\) \\{[\\s\\S]*?\\n  \\}'));
    if (!m) throw new Error('could not lift ' + name + ' from ' + s.file);
    return m[0];
  };
  const ctx = withI18n({});
  vm.createContext(ctx);
  ctx.self = ctx;
  vm.runInContext(src('event-summary.js'), ctx);
  vm.runInContext([
    grab(s.labels, ''), grab(s.warnings, ''), grab(s.label, 'kind'), grab(s.warning, 'kind'),
    'globalThis.label = ' + s.label + '; globalThis.warning = ' + s.warning + ';',
  ].join('\n'), ctx);
  return ctx;
}
const surfaces = SURFACES.map((s) => ({ file: s.file, ...surface(s) }));

test('an ephemeral kind is named as one, with a line on what that means instead of "unrecognized"', () => {
  for (const s of surfaces) {
    assert.equal(s.label(25910), '25910 (ephemeral event)', s.file);
    assert.equal(s.warning(25910), 'Ephemeral: relays pass it on without keeping it. It’s still signed by your key.', s.file);
  }
});

test('an unrecognized replaceable or addressable kind says what it replaces, and keeps the caution', () => {
  for (const s of surfaces) {
    assert.equal(s.label(10099), '10099 (replaceable event)', s.file);
    assert.equal(s.warning(10099), 'Replaces your last event of this kind. Review carefully before approving.', s.file);
    assert.equal(s.label(30999), '30999 (addressable event)', s.file);
    assert.equal(s.warning(30999), 'Replaces your earlier event with the same identifier. Review carefully before approving.', s.file);
  }
});

test('a regular kind nobody recognizes keeps the plain warning; a known kind keeps its own', () => {
  for (const s of surfaces) {
    assert.equal(s.label(4999), '4999 (unrecognized kind)', s.file);
    assert.equal(s.warning(4999), 'Unrecognized event kind. Review carefully before approving.', s.file);
    assert.equal(s.label(1), '1 · Note', s.file);
    assert.equal(s.warning(1), null, s.file);
    assert.equal(s.label(22242), '22242 · Relay auth', s.file, 'a known ephemeral kind is still its own name');
    assert.equal(s.warning(5), 'Deletes other events. Make sure you intended this.', s.file);
    assert.equal(s.warning(24133).startsWith('This is a remote-signing handshake'), true, s.file);
    assert.equal(s.label(null), '—', s.file);
  }
});

test('the two surfaces answer the same for every kind in a spread across the ranges', () => {
  const kinds = [0, 1, 3, 5, 7, 4999, 9999, 10000, 10002, 10099, 19999, 20000, 22242, 25910, 29999, 30000, 30023, 30999, 39999, 40000, 65535];
  const [panel, popup] = surfaces;
  for (const k of kinds) {
    assert.equal(panel.label(k), popup.label(k), 'label ' + k);
    assert.equal(panel.warning(k), popup.warning(k), 'warning ' + k);
  }
});

test('both approval pages load the module before the script that uses it', () => {
  for (const [html, js] of [['prompt.html', 'prompt.js'], ['sidepanel.html', 'sidepanel.js']]) {
    const page = src(html);
    const mod = page.indexOf('<script src="event-summary.js"></script>');
    const use = page.indexOf('<script src="' + js + '"></script>');
    assert.ok(mod > -1, html + ' does not load event-summary.js');
    assert.ok(mod < use, html + ' loads event-summary.js after ' + js);
  }
});

test('a list of plain values reads as a list, and a list of objects stays JSON', () => {
  const f = S.fields('{"relays":["wss://relay.example.com","wss://relay2.example.com"],"n":[1,2],"mixed":[{"a":1}],"empty":[]}');
  assert.deepEqual(plain(f.rows), [
    ['relays', 'wss://relay.example.com, wss://relay2.example.com'],
    ['n', '1, 2'],
    ['mixed', '[{"a":1}]'],
    ['empty', '[]'],
  ]);
});

test('a reaction says its emoji, a like or dislike says so, and anything else is passed through', () => {
  const r = (kind, content) => plain(S.reaction({ kind, content }));
  assert.deepEqual(r(7, '🤙'), { glyph: '🤙', note: '', big: true });
  assert.deepEqual(r(17, '🔥🔥'), { glyph: '🔥🔥', note: '', big: true });
  assert.deepEqual(r(7, '+'), { glyph: '❤️', note: 'like', big: true });
  assert.deepEqual(r(7, ''), { glyph: '❤️', note: 'like', big: true });
  assert.deepEqual(r(7, '-'), { glyph: '👎', note: 'dislike', big: true });
  // A custom emoji stays a shortcode (its picture would come from an address the page chose),
  // and a word is shown as the word, not as a heart: no guess about what the page meant.
  assert.deepEqual(r(7, ':shakingeyes:'), { glyph: ':shakingeyes:', note: '', big: false });
  assert.deepEqual(r(7, 'lol'), { glyph: 'lol', note: '', big: false });
  // Long text is cut, and a long run of emoji is not drawn large.
  assert.equal(S.reaction({ kind: 7, content: 'x'.repeat(200) }).glyph.length, 64);
  assert.equal(S.reaction({ kind: 7, content: '😀'.repeat(20) }).big, false);
  // Not a reaction.
  assert.equal(S.reaction({ kind: 1, content: '🤙' }), null);
  assert.equal(S.reaction(null), null);
});
