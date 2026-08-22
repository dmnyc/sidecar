'use strict';

// LNURL-pay recipient resolution for the Send form.
//
// Typing a lightning address now resolves it before you commit to an amount, so
// the form can show who it reached, what they say, and what they will accept.
// Previously the limits were only discovered by having a payment rejected.
//
// Everything these functions parse is written by whoever runs the recipient's
// domain: the description, the identifier, the image, the limits. So the tests
// that matter most are the hostile ones — a description that tries to be a
// kilometre long, an image that is not an image, limits that are backwards or
// missing, metadata that is not even JSON. The rule being pinned is that a
// recipient reports, and never gets to reshape the dialog or smuggle markup
// into it.

const { test, before } = require('node:test');
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

let ctx;

before(() => {
  ctx = {
    console,
    LN_DESC_MAX: 200,
    LN_IMAGE_MAX: 200000,
    fetchResult: null,
    // The one network call, stubbed. Returns whatever the test planted.
    // Mirrors the real Response shape closely enough to exercise the failure
    // branches: a status, and a json() that can itself reject the way a
    // 404 HTML page does.
    fetchOk: true,
    fetchThrows: false,
    jsonThrows: false,
    fetch: async () => {
      if (ctx.fetchThrows) throw new TypeError('Failed to fetch');
      return {
        ok: ctx.fetchOk,
        json: async () => {
          if (ctx.jsonThrows) throw new SyntaxError('Unexpected token \'<\'');
          return ctx.fetchResult;
        },
      };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/const LN_DESC_MAX = [\s\S]*?const LN_IMAGE_MAX = \d+;/, 'the clamp constants') + '\n' +
      lift(/function parseLnMetadata\(raw\) \{[\s\S]*?\n  \}/, 'parseLnMetadata') + '\n' +
      lift(/async function lnAddressParams\(addr\) \{[\s\S]*?\n  \}/, 'lnAddressParams') + '\n' +
      'globalThis.parseLnMetadata = parseLnMetadata;' +
      'globalThis.lnAddressParams = lnAddressParams;',
    ctx
  );
});

const meta = (entries) => JSON.stringify(entries);

// ---- metadata parsing ----

test('pulls the description, identifier, and image out of metadata', () => {
  const r = ctx.parseLnMetadata(meta([
    ['text/plain', 'Send me sats'],
    ['text/identifier', 'thedaniel@breez.tips'],
    ['image/png;base64', 'aGVsbG8='],
  ]));
  assert.equal(r.description, 'Send me sats');
  assert.equal(r.identifier, 'thedaniel@breez.tips');
  assert.equal(r.image, 'data:image/png;base64,aGVsbG8=');
});

// Fields are asserted individually rather than with deepEqual: these objects are
// built inside the vm context, so they carry that realm's Object.prototype and
// deepEqual's prototype check fails on structurally identical values.
const assertEmpty = (r, why) => {
  assert.equal(r.description, '', why + ': description');
  assert.equal(r.identifier, '', why + ': identifier');
  assert.equal(r.image, '', why + ': image');
};

test('metadata that is not JSON yields empty fields rather than throwing', () => {
  assertEmpty(ctx.parseLnMetadata('this is not json'), 'not json');
});

test('metadata that is JSON but not an array is handled', () => {
  assertEmpty(ctx.parseLnMetadata('{"description":"nope"}'), 'json object');
  assertEmpty(ctx.parseLnMetadata('null'), 'json null');
  assertEmpty(ctx.parseLnMetadata(''), 'empty string');
});

test('malformed entries are skipped, good ones still read', () => {
  const r = ctx.parseLnMetadata(meta([
    'not-a-pair',
    ['text/plain'],
    [42, 'wrong types'],
    ['text/plain', 'the real one'],
  ]));
  assert.equal(r.description, 'the real one');
});

test('a description cannot run away with the dialog', () => {
  const r = ctx.parseLnMetadata(meta([['text/plain', 'x'.repeat(5000)]]));
  assert.equal(r.description.length, 200);
});

test('newlines in a description are collapsed, not rendered as height', () => {
  const r = ctx.parseLnMetadata(meta([['text/plain', 'line one\n\n\n\n\nline two\t\tend']]));
  assert.equal(r.description, 'line one line two end');
});

test('the first description wins, so a second cannot override it', () => {
  const r = ctx.parseLnMetadata(meta([
    ['text/plain', 'first'],
    ['text/plain', 'second'],
  ]));
  assert.equal(r.description, 'first');
});

// ---- the image, which is the sharpest edge ----

test('only png and jpeg are accepted as images', () => {
  for (const type of ['image/svg+xml;base64', 'image/gif;base64', 'text/html;base64', 'image/png']) {
    const r = ctx.parseLnMetadata(meta([[type, 'aGVsbG8=']]));
    assert.equal(r.image, '', type + ' must not become an image');
  }
});

test('an image payload that is not base64 is refused', () => {
  // The shape that matters: anything that could break out of the data: URI.
  for (const payload of ['"><script>alert(1)</script>', 'aGVsbG8=" onerror="x', 'not base64!']) {
    const r = ctx.parseLnMetadata(meta([['image/png;base64', payload]]));
    assert.equal(r.image, '', 'refused: ' + payload);
  }
});

test('an oversized image is dropped rather than embedded', () => {
  const r = ctx.parseLnMetadata(meta([['image/png;base64', 'A'.repeat(200001)]]));
  assert.equal(r.image, '');
});

test('an image exactly at the cap is still accepted', () => {
  const r = ctx.parseLnMetadata(meta([['image/png;base64', 'A'.repeat(200000)]]));
  assert.ok(r.image.startsWith('data:image/png;base64,AAAA'));
});

// ---- resolving an address ----

function plant({ min, max, comment, nostr, entries }) {
  ctx.fetchResult = {
    tag: 'payRequest',
    callback: 'https://breez.tips/lnurlp/callback',
    minSendable: min,
    maxSendable: max,
    commentAllowed: comment,
    allowsNostr: !!nostr,
    nostrPubkey: nostr ? 'abc123' : undefined,
    metadata: meta(entries || [['text/plain', 'Zap me']]),
  };
}

test('resolves limits into sats, rounding so both ends are payable', async () => {
  // 1500 msat cannot be paid as 1 sat, and 2500 msat cannot be paid as 3.
  plant({ min: 1500, max: 2500 });
  const p = await ctx.lnAddressParams('thedaniel@breez.tips');
  assert.equal(p.minSats, 2, 'min rounds up');
  assert.equal(p.maxSats, 2, 'max rounds down');
});

test('reads comment allowance and zappability', async () => {
  plant({ min: 1000, max: 100000000, comment: 120, nostr: true });
  const p = await ctx.lnAddressParams('thedaniel@breez.tips');
  assert.equal(p.commentAllowed, 120);
  assert.equal(p.zappable, true);
});

test('a wallet that allows no comments reports zero', async () => {
  plant({ min: 1000, max: 1000, comment: 0 });
  const p = await ctx.lnAddressParams('a@b.com');
  assert.equal(p.commentAllowed, 0);
});

test('a missing or absurd comment allowance is normalized', async () => {
  plant({ min: 1000, max: 1000 });
  assert.equal((await ctx.lnAddressParams('a@b.com')).commentAllowed, 0, 'absent');
  plant({ min: 1000, max: 1000, comment: -5 });
  assert.equal((await ctx.lnAddressParams('a@b.com')).commentAllowed, 0, 'negative');
  plant({ min: 1000, max: 1000, comment: 99999 });
  assert.equal((await ctx.lnAddressParams('a@b.com')).commentAllowed, 1000, 'capped');
});

test('allowsNostr without a pubkey is not zappable', async () => {
  ctx.fetchResult = {
    tag: 'payRequest', callback: 'https://x/y', minSendable: 1, maxSendable: 2,
    allowsNostr: true, metadata: meta([['text/plain', 'x']]),
  };
  assert.equal((await ctx.lnAddressParams('a@b.com')).zappable, false);
});

test('an address without an @ is rejected before any request', async () => {
  ctx.fetchResult = null;
  await assert.rejects(() => ctx.lnAddressParams('not-an-address'), /does not look like a lightning address/);
  await assert.rejects(() => ctx.lnAddressParams(''), /does not look like a lightning address/);
});

test('a response that is not a payRequest is rejected', async () => {
  ctx.fetchResult = { tag: 'withdrawRequest', callback: 'https://x/y' };
  await assert.rejects(() => ctx.lnAddressParams('a@b.com'), /not with a lightning address/);
});

test('a payRequest with no callback is rejected', async () => {
  ctx.fetchResult = { tag: 'payRequest', minSendable: 1, maxSendable: 2 };
  await assert.rejects(() => ctx.lnAddressParams('a@b.com'), /not with a lightning address/);
});

test('backwards or missing limits are rejected, not shown', async () => {
  plant({ min: 100000, max: 1000 });
  await assert.rejects(() => ctx.lnAddressParams('a@b.com'), /limits that make no sense/);
  plant({ min: undefined, max: 1000 });
  await assert.rejects(() => ctx.lnAddressParams('a@b.com'), /limits that make no sense/);
  plant({ min: -1, max: 1000 });
  await assert.rejects(() => ctx.lnAddressParams('a@b.com'), /limits that make no sense/);
});

// ---- failures a person has to read ----
//
// The first version of this surfaced the raw parser error when a domain served
// an HTML 404: "Unexpected token '<', "<!DOCTYPE "... is not valid JSON". That
// is a true statement about a JSON parser and a useless one about an address, so
// each failure now says which thing went wrong in a sentence.

test('a domain serving an HTML 404 says the address does not exist', async () => {
  ctx.fetchOk = false;
  ctx.jsonThrows = true;
  await assert.rejects(
    () => ctx.lnAddressParams('bfgreen@sidecar.top'),
    (e) => {
      assert.match(e.message, /sidecar\.top has no lightning address for bfgreen/);
      assert.doesNotMatch(e.message, /JSON|token|DOCTYPE/i, 'no parser jargon');
      return true;
    }
  );
  ctx.fetchOk = true;
  ctx.jsonThrows = false;
});

test('a 200 that is actually a web page is treated the same way', async () => {
  ctx.fetchOk = true;
  ctx.jsonThrows = true;
  await assert.rejects(
    () => ctx.lnAddressParams('bfgreen@sidecar.top'),
    (e) => {
      assert.match(e.message, /has no lightning address for bfgreen/);
      assert.doesNotMatch(e.message, /JSON|token|DOCTYPE/i);
      return true;
    }
  );
  ctx.jsonThrows = false;
});

test('an unreachable domain names the domain, not the network stack', async () => {
  ctx.fetchThrows = true;
  await assert.rejects(
    () => ctx.lnAddressParams('someone@nowhere.example'),
    (e) => {
      assert.match(e.message, /Couldn't reach nowhere\.example/);
      assert.doesNotMatch(e.message, /TypeError|Failed to fetch/);
      return true;
    }
  );
  ctx.fetchThrows = false;
});

test('every failure message is short enough and plain enough to show as-is', async () => {
  // Mirrors the panel's own last-resort filter: anything longer than 90 chars or
  // carrying jargon gets replaced with a generic line, so a message that trips
  // that filter is one the user will never actually see.
  const speakable = (m) => m.length <= 90 && !/[{}<>]|JSON|token|undefined|TypeError/i.test(m);
  const cases = [
    () => { ctx.fetchThrows = true; },
    () => { ctx.fetchOk = false; },
    () => { ctx.jsonThrows = true; },
    () => { ctx.fetchResult = { tag: 'withdrawRequest', callback: 'https://x/y' }; },
    () => { plant({ min: 999999, max: 1 }); },
  ];
  for (const setup of cases) {
    ctx.fetchThrows = false; ctx.fetchOk = true; ctx.jsonThrows = false;
    setup();
    await assert.rejects(() => ctx.lnAddressParams('someone@example.com'), (e) => {
      assert.ok(speakable(e.message), 'not showable as-is: ' + e.message);
      return true;
    });
  }
  ctx.fetchThrows = false; ctx.fetchOk = true; ctx.jsonThrows = false;
});

test('a description survives resolution intact and clamped', async () => {
  plant({ min: 1000, max: 2000, entries: [['text/plain', 'y'.repeat(500)]] });
  const p = await ctx.lnAddressParams('a@b.com');
  assert.equal(p.description.length, 200);
});
