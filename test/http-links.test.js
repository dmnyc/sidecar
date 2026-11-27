'use strict';

// LINKS THAT GO OUT OVER PLAIN HTTP, which every composer asks about before it publishes:
// which links count, and what Use https changes. Run from composer-core.js itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = fs.readFileSync(path.join(__dirname, '..', 'composer-core.js'), 'utf8');
const from = core.indexOf('  const HTTP_LINK_RE = ');
const to = core.indexOf('  function secureLinksInEditor(');
assert.ok(from > 0 && to > from, 'the http link block was not found in composer-core.js');
const ctx = { URL };
vm.runInNewContext(core.slice(from, to) + '\nthis.plainHttpLinks = plainHttpLinks; this.secureLinks = secureLinks;', ctx);
const { plainHttpLinks, secureLinks } = ctx;
const list = (text) => JSON.parse(JSON.stringify(plainHttpLinks(text)));

test('an http link is found, as written, without the sentence’s punctuation', () => {
  assert.deepEqual(list('see http://example.com/a?b=1.'), ['http://example.com/a?b=1']);
  assert.deepEqual(list('(http://example.com/x), then http://other.org!'), ['http://example.com/x', 'http://other.org']);
  assert.deepEqual(list('[the post](http://blog.example.com/p/1)'), ['http://blog.example.com/p/1']);
  assert.deepEqual(list('Original recipe: <http://food.example.com/r>'), ['http://food.example.com/r']);
  assert.deepEqual(list('HTTP://Example.com/Path'), ['HTTP://Example.com/Path']);
  assert.deepEqual(list('http://a.com and http://a.com again'), ['http://a.com'], 'once each');
});

test('https, code, and hosts with no https to switch to are left alone', () => {
  assert.deepEqual(list('https://example.com and wss://relay.example.com'), []);
  assert.deepEqual(list('run `curl http://example.com` or\n```\nhttp://example.com/api\n```'), []);
  for (const local of ['http://localhost:3000', 'http://dev.localhost', 'http://127.0.0.1:8080/x', 'http://192.168.1.1',
    'http://[::1]:80/', 'http://printer.local', 'http://abc.onion/page', 'http://site.i2p', 'http://router/', 'http://nas.home.arpa']) {
    assert.deepEqual(list('try ' + local), [], local);
  }
  assert.deepEqual(list('http:// on its own, and nostr:npub1abc'), []);
});

test('Use https switches the listed links and touches nothing else', () => {
  const text = 'Read HTTP://Example.com/Path?Q=1. Not http://other.org, and `http://example.com/code` stays.';
  assert.equal(
    secureLinks(text, ['HTTP://Example.com/Path?Q=1']),
    'Read https://Example.com/Path?Q=1. Not http://other.org, and `http://example.com/code` stays.',
  );
  assert.equal(secureLinks('[a](http://a.com/x) and http://a.com/x.', ['http://a.com/x']), '[a](https://a.com/x) and https://a.com/x.');
  assert.equal(secureLinks('no links here', ['http://a.com']), 'no links here');
  assert.deepEqual(list(secureLinks('http://a.com http://b.com', list('http://a.com http://b.com'))), []);
});
