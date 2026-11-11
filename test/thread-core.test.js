'use strict';

// What a comment thread is made of: the root and parent a NIP-22 comment names, the tree
// its replies make, the tally of reactions under each, and the relays worth asking.
// thread-core.js is pure, so these run it directly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../thread-core.js');

const id = (c) => c.repeat(64);
const ME = id('a');
const THEM = id('b');
const URL1 = 'https://example.com/post';
const comment = (c, pubkey, tags, created = 100) => ({ id: id(c), pubkey, kind: 1111, content: 'c' + c, tags, created_at: created });
const WEB = [['I', URL1], ['K', 'web'], ['i', URL1], ['k', 'web']];

test('the root is the uppercase tag: a web page, a Nostr event, an address, or nothing', () => {
  assert.deepEqual(C.rootOf(comment('1', ME, WEB)), { kind: 'web', url: URL1 });
  assert.deepEqual(C.rootOf(comment('1', ME, [['E', id('5'), 'wss://r.example'], ['K', '1']])),
    { kind: 'event', id: id('5'), hint: 'wss://r.example' });
  assert.equal(C.rootOf(comment('1', ME, [['A', '30023:' + ME + ':essay']])).kind, 'address');
  assert.equal(C.rootOf(comment('1', ME, [['I', 'isbn:9780765382030']])).kind, 'other');
  assert.equal(C.rootOf(comment('1', ME, [])), null);
  // A scope that is not http(s) is never offered as a link.
  assert.equal(C.pageOf(comment('1', ME, [['I', 'javascript:alert(1)']])), '');
  assert.equal(C.pageOf(comment('1', ME, WEB)), URL1);
});

test('the parent is the LAST lowercase e tag, with its relay hint, and a top-level comment has none', () => {
  const reply = comment('2', THEM, [...WEB, ['e', id('8'), 'wss://root.example'], ['e', id('1'), 'wss://Parent.Example/']]);
  assert.deepEqual(C.parentOf(reply), { id: id('1'), hint: 'wss://parent.example' });
  assert.deepEqual(C.parentOf(comment('1', ME, WEB)), { id: '', hint: '' });
  // An uppercase E is the root, never the parent.
  assert.equal(C.parentOf(comment('2', THEM, [['E', id('1')]])).id, '');
});

test('a relay hint is only ever a plain websocket address', () => {
  assert.equal(C.normalizeRelay('wss://Relay.Example/'), 'wss://relay.example');
  assert.equal(C.normalizeRelay('wss://relay.example/path'), 'wss://relay.example/path');
  for (const bad of ['https://relay.example', 'javascript:alert(1)', 'relay.example', '', null, undefined, 42]) {
    assert.equal(C.normalizeRelay(bad), '', String(bad));
  }
});

test('replies make a tree, oldest first, and only comments that lead back to the root are in it', () => {
  const root = id('1');
  const events = [
    comment('4', ME, [...WEB, ['e', id('3')]], 400),
    comment('2', THEM, [...WEB, ['e', root]], 200),
    comment('3', ME, [...WEB, ['e', id('2')]], 300),
    comment('5', THEM, [...WEB, ['e', root]], 150),
    comment('6', THEM, [...WEB, ['e', id('9')]], 500),        // answers something not in the thread
  ];
  const tree = C.buildTree(root, events);
  assert.deepEqual(tree.children.map((n) => n.ev.id), [id('5'), id('2')], 'oldest first');
  const two = tree.children[1];
  assert.deepEqual(two.children.map((n) => n.ev.id), [id('3')]);
  assert.deepEqual(two.children[0].children.map((n) => n.ev.id), [id('4')]);
  assert.equal(two.descendants, 2);
  assert.equal(tree.total, 4, 'the stranger’s reply is not counted');
  assert.deepEqual(C.idsOf(tree), [id('5'), id('2'), id('3'), id('4')]);
});

test('repeats, loops, self-parents and non-comments cannot break or inflate the tree', () => {
  const root = id('1');
  const a = comment('2', THEM, [['e', root]], 200);
  const events = [
    a, a,                                                      // a relay answering twice
    comment('3', ME, [['e', id('4')]], 300),                   // 3 answers 4 ...
    comment('4', ME, [['e', id('3')]], 310),                   // ... and 4 answers 3: a loop, off the root
    comment('5', ME, [['e', id('5')]], 320),                   // answers itself
    { id: id('6'), pubkey: ME, kind: 1, content: 'a note', tags: [['e', root]], created_at: 330 },
    { id: 'nothex', pubkey: ME, kind: 1111, tags: [['e', root]], created_at: 340 },
    null,
  ];
  const tree = C.buildTree(root, events);
  assert.deepEqual(tree.children.map((n) => n.ev.id), [id('2')]);
  assert.equal(tree.total, 1);
});

test('indentation stops at four levels, but nesting is kept', () => {
  const root = id('1');
  const chain = ['2', '3', '4', '5', '6', '7'].map((c, i, all) =>
    comment(c, ME, [['e', i ? id(all[i - 1]) : root]], 100 + i));
  let node = C.buildTree(root, chain).children[0];
  const depths = [];
  while (node) { depths.push([node.depth, node.shown]); node = node.children[0]; }
  assert.deepEqual(depths, [[1, 1], [2, 2], [3, 3], [4, 4], [5, 4], [6, 4]]);
});

test('reactions are tallied under the LAST e tag, one per person per emoji, mine marked', () => {
  const r = (c, pubkey, content, tags) => ({ id: id(c), pubkey, kind: 7, content, tags, created_at: 1 });
  const tally = C.tallyReactions([
    r('1', THEM, '+', [['e', id('9')], ['e', id('2')]]),
    r('2', ME, '+', [['e', id('2')]]),
    r('3', ME, '+', [['e', id('2')]]),                         // the same person, the same emoji, again
    r('4', THEM, '🔥', [['e', id('2')]]),
    r('5', THEM, ':blob:', [['e', id('3')], ['emoji', 'blob', 'https://img.example/b.png']]),
    r('6', THEM, '+', [['p', ME]]),                            // aimed at a person, not a comment
    { id: id('7'), pubkey: THEM, kind: 1, content: '+', tags: [['e', id('2')]], created_at: 1 },
  ], ME);
  assert.deepEqual(tally.get(id('2')), [
    { glyph: '❤️', emojiUrl: '', count: 2, mine: true },
    { glyph: '🔥', emojiUrl: '', count: 1, mine: false },
  ]);
  assert.deepEqual(tally.get(id('3')), [{ glyph: ':blob:', emojiUrl: 'https://img.example/b.png', count: 1, mine: false }]);
  assert.equal(tally.has(id('9')), false, 'an earlier e tag is the thread above, not the target');
});

test('a reaction is drawn the way the panel’s notification list draws it', () => {
  // The panel's own function, lifted: the two must never disagree about one event.
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
  const at = src.indexOf('function reactionDisplay(ev)');
  let depth = 0; let end = at;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(at, end) + '\nthis.panel = reactionDisplay;', ctx);
  const emoji = (shortcode, url) => ['emoji', shortcode, url];
  const cases = [
    { content: '+' }, { content: '' }, { content: '-' }, { content: '🔥' }, { content: '👨‍👩‍👧' }, { content: 'lol' },
    { content: ':blob:', tags: [emoji('blob', 'https://img.example/b.png')] },
    { content: ':blob:', tags: [emoji('other', 'https://img.example/o.png')] },
    { content: ':blob:', tags: [] }, { content: ' + ' }, { content: '❤️' },
  ];
  for (const c of cases) {
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.panel(c))), JSON.parse(JSON.stringify(C.reactionDisplay(c))), JSON.stringify(c));
  }
});

test('a relay list gives the relays a person reads from and writes to', () => {
  const list = C.relayListOf({ tags: [
    ['r', 'wss://both.example'], ['r', 'wss://in.example', 'read'], ['r', 'wss://out.example/', 'write'],
    ['r', 'https://not-a-relay.example'], ['p', ME], ['r', 'wss://both.example'],
  ] });
  assert.deepEqual(list, { read: ['wss://both.example', 'wss://in.example'], write: ['wss://both.example', 'wss://out.example'] });
});

test('a set of relays has no repeats, keeps its order, and stops at the cap', () => {
  assert.deepEqual(C.relaySet([['wss://a.example', 'wss://B.example/'], ['wss://b.example', 'wss://c.example', 'junk']]),
    ['wss://a.example', 'wss://b.example', 'wss://c.example']);
  const many = Array.from({ length: 40 }, (_, i) => 'wss://r' + i + '.example');
  assert.equal(C.relaySet([many]).length, 14);
  assert.deepEqual(C.relaySet([many], 3), many.slice(0, 3));
});

test('a comment’s words split into text, addresses and nostr references, and nothing is trusted', () => {
  assert.deepEqual(C.tokenize('see https://a.example/x, and nostr:npub1abc23. ok'), [
    { type: 'text', value: 'see ' }, { type: 'url', value: 'https://a.example/x' }, { type: 'text', value: ', and ' },
    { type: 'nostr', value: 'nostr:npub1abc23' }, { type: 'text', value: '. ok' },
  ]);
  assert.deepEqual(C.tokenize('(https://a.example/p)'), [
    { type: 'text', value: '(' }, { type: 'url', value: 'https://a.example/p' }, { type: 'text', value: ')' },
  ]);
  // Only http(s) is a link: a script address is just words.
  assert.deepEqual(C.tokenize('javascript:alert(1)'), [{ type: 'text', value: 'javascript:alert(1)' }]);
  assert.deepEqual(C.tokenize(''), []);
  assert.deepEqual(C.tokenize(null), []);
});

test('the Jumble link for a page is the address, encoded', () => {
  assert.equal(C.jumbleThreadUrl('https://example.com/a?b=c&d'), 'https://jumble.social/external-content?id=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d');
  assert.equal(C.hostOf(URL1), 'example.com');
  assert.equal(C.hostOf('nonsense'), '');
});
