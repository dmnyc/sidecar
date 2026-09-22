'use strict';

// ONE FILTER OBJECT PER SUBSCRIPTION, AND THE FRAME THAT PROVES IT.
//
// The vendored nostr-tools takes a single filter and wraps it itself:
// `subscribe(relays, filter, params)` pushes `{ url, filter }`, subscribeMap groups them
// into `filters`, and AbstractRelay serializes that array straight into the wire frame
// (`nostr-tools.js`: `'["REQ","' + id + '",' + JSON.stringify(this.filters).substring(1)`).
// Hand it a filter that is ALREADY in an array and the REQ goes out as
// `["REQ","<id>",[{…}]]`, an array sitting where the relay expects a filter object.
//
// WHAT THAT COSTS, because it is not a syntax error and nothing throws. strfry matches
// nothing against it, so no event is ever delivered, the subscription simply stays quiet,
// and whatever timeout the caller set fires instead. The CLINK pay button shipped this
// way: every offer reported "The offer did not answer. Its wallet may be offline." while
// the wallet was answering a request that had reached it perfectly well. The publish half
// takes an event and no filter, so it worked, which is what made it look like a relay
// problem rather than ours.
//
// The old nostr-tools signature took `filters[]`, so this is the shape muscle memory
// produces, and it survived a green suite once already: the pay test asserted `[filter]`
// verbatim, pinning the bug instead of catching it.
//
// So there are two halves here and both matter:
//   1. The frame itself, captured out of the REAL vendored bundle through a fake socket.
//      A convention test asserts what we agreed; this asserts what goes on the wire.
//   2. Every pool call site in the panel, checked for the pre-wrapped shape, because the
//      next one will be written by whoever remembers the old API.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'),
  { filename: 'nostr-tools.js' });
const NT = globalThis.NostrTools;
assert.ok(NT && NT.SimplePool, 'the vendored nostr-tools did not expose SimplePool');

// Enough of a WebSocket for AbstractRelay to drive: it assigns onopen/onmessage/onclose
// and calls send(). Nothing here connects to anything.
function recorder() {
  const sent = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 0);
    }
    send(s) { sent.push(s); }
    close() { this.readyState = 3; if (this.onclose) this.onclose({}); }
  }
  return { sent, FakeWS };
}

const FILTER = () => ({
  kinds: [21001],
  authors: ['ee'.repeat(32)],
  '#p': ['ab'.repeat(32)],
  since: 1700000000,
});

async function reqFrameFor(filterArg) {
  const { sent, FakeWS } = recorder();
  const pool = new NT.SimplePool({ websocketImplementation: FakeWS });
  pool.subscribeMany(['wss://relay.example'], filterArg, { onevent() {} });
  await new Promise((r) => setTimeout(r, 30));
  const req = sent.find((s) => s.startsWith('["REQ"'));
  assert.ok(req, 'no REQ frame was sent at all');
  return JSON.parse(req);
}

test('A BARE FILTER OBJECT PUTS A FILTER IN THE REQ FRAME', async () => {
  const frame = await reqFrameFor(FILTER());
  assert.equal(frame[0], 'REQ');
  assert.equal(typeof frame[1], 'string', 'no subscription id');
  // The position that decides whether anything is ever delivered.
  assert.ok(!Array.isArray(frame[2]), 'the filter position holds an array');
  assert.equal(typeof frame[2], 'object');
  assert.deepEqual(frame[2].kinds, [21001]);
  assert.deepEqual(frame[2]['#p'], ['ab'.repeat(32)]);
});

test('AND A PRE-WRAPPED ONE DOES NOT, WHICH IS THE WHOLE BUG', async () => {
  // Asserted rather than merely described: this is the frame the CLINK pay button sent
  // for five commits, and reading it back is the only way to show that nothing about it
  // fails loudly. It is a well-formed JSON array that no relay will ever match.
  const frame = await reqFrameFor([FILTER()]);
  assert.equal(frame[0], 'REQ');
  assert.ok(Array.isArray(frame[2]),
    'the trap this guard exists for is gone; if nostr-tools now accepts an array, simplify this file');
  assert.equal(frame[2].length, 1);
  assert.equal(frame[2][0].kinds[0], 21001, 'the filter is intact, it is just in the wrong place');
});

// ---- and every call site in the panel ----

// Whole-line comments only, the idiom the other source guards use. Without it a guard
// matches the comment that explains it, which has bitten this suite repeatedly.
const stripComments = (src) =>
  src.split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');

// Top-level arguments of a call, split on commas at depth zero with strings skipped.
function argsAt(src, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(src.slice(start, i).trim()); return args; }
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args;
}

const WRAPPERS = ['poolGet', 'poolQuerySync', 'poolSubscribeMany', 'poolSubscribeManyEose'];

test('NO CALL SITE HANDS THE POOL A PRE-WRAPPED FILTER', () => {
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8'));
  let checked = 0;
  for (const name of WRAPPERS) {
    // The definitions themselves take `filter` through, so skip the arrow bodies that
    // declare them and check the callers.
    const re = new RegExp(`(?<![\\w.])${name}\\(`, 'g');
    let m;
    while ((m = re.exec(src))) {
      const open = m.index + name.length;
      if (/^\s*\(relays, filter/.test(src.slice(open))) continue; // the wrapper's own definition
      const args = argsAt(src, open);
      if (args.length < 2) continue;
      checked++;
      assert.ok(!args[1].startsWith('['),
        `${name} at index ${m.index} wraps its filter in an array: ${args[1].slice(0, 80)}`);
    }
  }
  // A count, so a refactor that renames the wrappers fails here instead of passing by
  // checking nothing at all.
  assert.ok(checked >= 20, `only ${checked} pool call sites were checked; the scan stopped finding them`);
});
