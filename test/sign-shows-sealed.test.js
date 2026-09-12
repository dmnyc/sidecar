'use strict';

// The second prompt says what the first one sealed.
//
// From #305, and the half that #316 did not do: "the event signing request only shows the
// encrypted payload". An app storing its settings asks twice, once to encrypt and once to
// sign the event carrying the result, and the second card could only ever show base64.
//
// We hold the plaintext at encrypt time and threw it away. Keeping it for a moment closes
// the gap without asking anyone to trust anything new: the page wrote that text, we sealed
// it for them, and the only party shown it is the person being asked to approve.
//
// The whole design is about giving it back quickly. It lives in the service worker, which
// MV3 evicts at about 30 seconds idle, so a sign arriving later simply shows ciphertext,
// which is exactly today's behavior. Everything else here is the narrowing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const prompt = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(src, decl) {
  const at = src.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = src.indexOf('{', src.indexOf('(', at));
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

function store(now = Date.now()) {
  const ctx = { Date: { now: () => now } };
  vm.createContext(ctx);
  vm.runInContext(
    [
      bg.match(/const SEAL_TTL_MS = .*/)[0],
      bg.match(/const SEAL_MAX = .*/)[0],
      'const sealedText = new Map();',
      bg.match(/const sealKey = .*/)[0],
      lift(bg, 'function rememberSealed('),
      lift(bg, 'function recallSealed('),
    ].join('\n') +
      '\nglobalThis.out = { remember: rememberSealed, recall: recallSealed, map: sealedText, ttl: SEAL_TTL_MS, max: SEAL_MAX };',
    ctx
  );
  return ctx.out;
}

const CIPHER = 'AbC123+/=' .repeat(8);

test('the sign card can be told what the encrypt card sealed', () => {
  const s = store();
  s.remember('ditto.pub', 'alice', CIPHER, 'my settings');
  assert.equal(s.recall('ditto.pub', 'alice', CIPHER), 'my settings');
});

test('ANOTHER SITE CANNOT READ IT', () => {
  // The key is host AND account AND the exact ciphertext. A page that somehow obtained
  // someone else's ciphertext still gets nothing, because it is not the site that sealed
  // it, and a second account on the same site is a different key again.
  const s = store();
  s.remember('ditto.pub', 'alice', CIPHER, 'my settings');
  assert.equal(s.recall('evil.example', 'alice', CIPHER), '');
  assert.equal(s.recall('ditto.pub', 'bob', CIPHER), '');
  assert.equal(s.recall('ditto.pub', 'alice', CIPHER + 'x'), '');
});

test('it forgets on its own', () => {
  const s = store(5000);
  s.remember('ditto.pub', 'alice', CIPHER, 'my settings');
  // Age the entry past the TTL rather than sleeping for two minutes.
  s.map.set('ditto.pub|alice|' + CIPHER, { text: 'my settings', at: 5000 - s.ttl - 1 });
  assert.equal(s.recall('ditto.pub', 'alice', CIPHER), '', 'an expired entry is still readable');
  assert.equal(s.map.size, 0, 'an expired entry is not dropped when it is read');
});

test('it holds a handful, not a history', () => {
  const s = store();
  for (let i = 0; i < s.max + 5; i++) s.remember('ditto.pub', 'alice', 'c' + i, 'text ' + i);
  assert.equal(s.map.size, s.max, 'the cap is not applied');
  assert.equal(s.recall('ditto.pub', 'alice', 'c0'), '', 'the oldest entry survived');
  assert.equal(s.recall('ditto.pub', 'alice', 'c' + (s.max + 4)), 'text ' + (s.max + 4), 'the newest was evicted');
});

test('nothing empty is ever stored', () => {
  const s = store();
  s.remember('', 'alice', CIPHER, 'x');
  s.remember('ditto.pub', '', CIPHER, 'x');
  s.remember('ditto.pub', 'alice', '', 'x');
  s.remember('ditto.pub', 'alice', CIPHER, '');
  s.remember('ditto.pub', 'alice', CIPHER, undefined);
  assert.equal(s.map.size, 0, 'a blank key or value is being kept');
});

// ---- the wiring ---------------------------------------------------------------------------

test('only encrypt methods are remembered', () => {
  const src = stripComments(bg);
  assert.match(src, /const SEAL_METHODS = new Set\(\['nip04\.encrypt', 'nip44\.encrypt'\]\)/,
    'the seal set changed shape');
  assert.match(src, /if \(SEAL_METHODS\.has\(method\) && typeof result === 'string'\)/,
    'something other than an encrypt result is being remembered');
});

test('the plaintext goes to the PROMPT and never back to the page', () => {
  // The page gets `result`, which is ciphertext. `sealed` rides in the openPrompt payload,
  // which only ever reaches the approval window and the panel.
  const src = stripComments(bg);
  const at = src.indexOf('const decision = await openPrompt({');
  const call = src.slice(at - 500, at + 300);
  assert.match(call, /recallSealed\(host, activePubkey, params\.event\.content\)/,
    'the lookup is not scoped to this host and account');
  assert.match(call, /\n\s*sealed,/, 'the prompt is not given the sealed text');
  const rpc = stripComments(lift(bg, 'async function handleNostrRpc('));
  assert.ok(!/sendResponse\([^)]*sealed/.test(rpc), 'the plaintext is being handed back to the page');
});

test('a sign we did NOT seal shows nothing new', () => {
  // recallSealed returns '' and the row is conditional, so an ordinary note is unchanged.
  for (const [name, src, guard] of [
    ['prompt.js', prompt, /if \(data\.sealed\) \{/],
    ['sidepanel.js', panel, /if \(data\.sealed\) \{/],
  ]) {
    assert.match(stripComments(src), guard, name + ' shows the row unconditionally');
  }
});

test('BOTH approval surfaces show it, marked the same way', () => {
  for (const [name, src] of [['prompt.js', prompt], ['sidepanel.js', panel]]) {
    const s = stripComments(src);
    assert.match(s, /Sealed content/, name + ' has no sealed row');
    assert.match(s, /prose sealed/, name + ' does not mark the row as sealed');
    assert.match(s, /220/, name + ' does not clamp page-written text');
  }
});

test('the event preview is still shown alongside it', () => {
  // The row is a convenience, not a replacement: what is being signed is the event, and
  // the JSON view remains the literal answer to "what am I approving".
  for (const [name, src, call] of [
    ['prompt.js', prompt, 'appendEventContent(els.preview, ev)'],
    ['sidepanel.js', panel, 'appendEventContent(box, ev)'],
  ]) {
    assert.ok(stripComments(src).includes(call), name + ' dropped the event preview');
  }
});

test('THE PANEL PINS ITS BUTTONS THE WAY THE POPUP DOES', () => {
  // Found by adding the sealed row: the panel's approval card was one scroll region,
  // buttons included, so a tall approval pushed Allow and Reject off the bottom and the
  // one thing you came to do was the thing you had to go find. prompt.html has split
  // scroll from footer since it was written; the panel never did.
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const block = html.slice(html.indexOf('id="view-approval"'), html.indexOf('Modal host'));
  assert.match(block, /class="approval-scroll"/, 'the card has no scroll region');
  assert.match(block, /class="approval-footer"/, 'the card has no pinned footer');
  // Everything that ASKS belongs below the fold line; everything that DESCRIBES above it.
  const footer = block.slice(block.indexOf('approval-footer'));
  for (const id of ['approval-unlock', 'approval-remember', 'approval-relax-row', 'approval-allow', 'approval-reject']) {
    assert.ok(footer.includes(id), id + ' can scroll out of reach again');
  }
  const scroll = block.slice(block.indexOf('approval-scroll'), block.indexOf('approval-footer'));
  assert.ok(scroll.includes('approval-preview'), 'the event preview no longer scrolls');

  assert.match(css, /\.approval-card \{[^}]*display: flex[^}]*flex-direction: column[^}]*overflow: hidden/s,
    'the card is a single scroller again');
  assert.match(css, /\.approval-scroll \{[^}]*overflow-y: auto/, 'the scroll region does not scroll');
  assert.match(css, /\.approval-footer \{[^}]*flex-shrink: 0/, 'the footer can be squeezed');
});
