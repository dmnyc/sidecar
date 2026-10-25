'use strict';

// The nsite core's pure half (nsite.js): name rules, manifest shapes, the aggregate
// hash, the Markdown renderer and the template, and the diff the approval card shows.
// The wire shapes are pinned to the NIP-5A draft text; the aggregate hash is computed
// here from the spec's own words rather than by calling the module, so the test can
// disagree with the code about what the spec says.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { withI18n } = require('./helpers/i18n.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'nsite.js'), 'utf8');
const ctx = withI18n({ console, crypto, TextEncoder, AbortSignal, fetch: async () => { throw new Error('no network in tests'); } });
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const NS = ctx.SidecarNsite;

// deepEqual across a vm realm compares Array prototypes and fails; values that come
// out of the module go through JSON once, which is also the shape a relay sees.
const j = (v) => JSON.parse(JSON.stringify(v));

const ALICE = 'a'.repeat(64);
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);

// The spec, restated: lines of "<hash> <path>\n" sorted ascending lexicographically,
// concatenated as UTF-8, SHA-256'd, lowercase hex.
function specAggregate(files) {
  const shape = files.map((f) => f.hash + ' ' + f.path + '\n').sort().join('');
  return crypto.createHash('sha256').update(Buffer.from(shape, 'utf8')).digest('hex');
}

test('site names: the DNS-label rule, and what normalization keeps of a wish', () => {
  assert.equal(NS.isValidSiteName('blog'), true);
  assert.equal(NS.isValidSiteName('a'), true);
  assert.equal(NS.isValidSiteName('abc-123'), true);
  assert.equal(NS.isValidSiteName(''), false);
  assert.equal(NS.isValidSiteName('Blog'), false);
  assert.equal(NS.isValidSiteName('ends-'), false);
  assert.equal(NS.isValidSiteName('thirteen chars'), false);
  // The spec's rule is exactly "must not end with -": a leading dash parses at the
  // gateway (the 50-char pubkey label can never end in one), so it stays allowed.
  assert.equal(NS.isValidSiteName('-lead'), true);
  assert.equal(NS.normalizeSiteName('  My Blog! '), 'my-blog');
  assert.equal(NS.normalizeSiteName('--a--'), 'a');
  assert.equal(NS.normalizeSiteName('way-more-than-thirteen-characters').length, 13);
});

test('the aggregate hash matches the spec computation and ignores file order', () => {
  const files = [{ path: '/index.html', hash: H1 }, { path: '/about.html', hash: H2 }];
  return NS.aggregateHash(files).then((got) => {
    assert.equal(got, specAggregate(files));
  });
});

test('the root manifest carries no d tag; the named manifest leads with it', async () => {
  const files = [{ path: '/index.html', hash: H1 }];
  const root = await NS.buildManifestTemplate({ name: '', files, servers: ['https://blossom.example'], title: 'Home page' });
  assert.equal(root.kind, 15128);
  assert.equal(root.content, '');
  assert.equal(root.tags.some((t) => t[0] === 'd'), false, 'the root site MUST NOT carry a d tag');
  assert.ok(root.tags.some((t) => t[0] === 'path' && t[1] === '/index.html' && t[2] === H1));
  assert.ok(root.tags.some((t) => t[0] === 'x' && t[2] === 'aggregate'));
  assert.equal(root.tags.find((t) => t[0] === 'x')[1], specAggregate(files));

  const named = await NS.buildManifestTemplate({ name: 'blog', files, servers: [] });
  assert.equal(named.kind, 35128);
  assert.deepEqual(j(named.tags[0]), ['d', 'blog'], 'the d tag leads, so readers find the record');
});

test('at most two servers are named, and an empty file list is refused', async () => {
  const files = [{ path: '/index.html', hash: H1 }];
  const many = await NS.buildManifestTemplate({
    name: '', files,
    servers: ['https://one.example', 'https://two.example', 'https://three.example'],
  });
  assert.equal(many.tags.filter((t) => t[0] === 'server').length, 2);
  await assert.rejects(() => NS.buildManifestTemplate({ name: '', files: [] }), /at least one page/);
  await assert.rejects(() => NS.buildManifestTemplate({ name: 'BAD NAME', files }), /not usable/);
});

test('a snapshot copies the paths, the aggregate and the servers, and names its site', async () => {
  const files = [{ path: '/index.html', hash: H1 }];
  const manifest = await NS.buildManifestTemplate({ name: 'blog', files, servers: ['https://blossom.example'], title: 'T' });
  const manifestEvent = { ...manifest, pubkey: ALICE, id: 'm'.repeat(64) };
  const snap = NS.buildSnapshotTemplate(manifestEvent, { manifestId: manifestEvent.id });
  assert.equal(snap.kind, 5128);
  assert.equal(snap.created_at, manifest.created_at);
  assert.deepEqual(j(snap.tags[0]), ['a', '35128:' + ALICE + ':blog']);
  assert.ok(snap.tags.some((t) => t[0] === 'path' && t[1] === '/index.html' && t[2] === H1));
  assert.ok(snap.tags.some((t) => t[0] === 'x' && t[2] === 'aggregate'));
  assert.ok(snap.tags.some((t) => t[0] === 'e' && t[1] === manifestEvent.id));
  assert.equal(NS.snapshotIsFor(snap, ALICE, 'blog'), true);
  assert.equal(NS.snapshotIsFor(snap, ALICE, 'other'), false);
});

test('reading a manifest back: paths, servers, title, name', async () => {
  const files = [{ path: '/index.html', hash: H1 }];
  const named = await NS.buildManifestTemplate({ name: 'blog', files, servers: ['https://s.example'], title: 'The Blog' });
  const ev = { kind: 35128, tags: named.tags, pubkey: ALICE };
  assert.deepEqual(j(NS.manifestFilesOf(ev)), files);
  assert.deepEqual(j(NS.manifestServersOf(ev)), ['https://s.example']);
  assert.equal(NS.manifestTitleOf(ev), 'The Blog');
  assert.equal(NS.manifestNameOf(ev), 'blog');
  assert.equal(NS.manifestNameOf({ kind: 15128, tags: named.tags }), null, 'a root manifest has no name even if tags lie');
  assert.equal(NS.manifestIsFor(ev, ALICE, 'blog'), true);
  assert.equal(NS.manifestIsFor(ev, 'b'.repeat(64), 'blog'), false);
});

test('gateway addresses: 50 base36 characters for the key, name appended with no separator', () => {
  const b36 = NS.pubkeyB36(ALICE);
  assert.match(b36, /^[0-9a-z]{50}$/);
  assert.equal(NS.gatewayUrl(ALICE, ''), 'https://' + b36 + '.nsite.lol');
  assert.equal(NS.gatewayUrl(ALICE, 'blog'), 'https://' + b36 + 'blog.nsite.lol');
  // Round-trip: the base36 label parses back to the key it came from.
  let acc = 0n;
  for (const c of b36) acc = acc * 36n + BigInt(parseInt(c, 36));
  assert.equal(acc.toString(16), ALICE);
});

test('the Markdown renderer: what it writes, and what it escapes', () => {
  assert.equal(NS.mdToHtml('# Hello'), '<h1>Hello</h1>');
  assert.equal(NS.mdToHtml('plain **bold** and *em* text'), '<p>plain <strong>bold</strong> and <em>em</em> text</p>');
  assert.equal(NS.mdToHtml('a `code` span'), '<p>a <code>code</code> span</p>');
  assert.equal(NS.mdToHtml('[text](https://x.example/a)'), '<p><a href="https://x.example/a">text</a></p>');
  assert.equal(NS.mdToHtml('![alt](https://x.example/i.png)'), '<p><img src="https://x.example/i.png" alt="alt"></p>');
  // A scheme the page must not grow is left as the text it was.
  assert.equal(NS.mdToHtml('[nope](javascript:alert(1))'), '<p>[nope](javascript:alert(1))</p>');
  // Raw HTML is escaped, not passed through: Markdown in, and only our markup out.
  assert.equal(NS.mdToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(NS.mdToHtml('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(NS.mdToHtml('1. a\n2. b'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  assert.equal(NS.mdToHtml('> quoted'), '<blockquote>\n<p>quoted</p>\n</blockquote>');
  assert.equal(NS.mdToHtml('---'), '<hr>');
  assert.equal(NS.mdToHtml('```\ncode <line>\n```'), '<pre><code>code &lt;line&gt;\n</code></pre>');
  // A blank line ends the paragraph; consecutive lines are one paragraph.
  assert.equal(NS.mdToHtml('one\ntwo\n\nthree'), '<p>one two</p>\n<p>three</p>');
});

test('page paths: index at the root, everything else slugged', () => {
  assert.equal(NS.pagePathFor('index'), '/index.html');
  assert.equal(NS.pagePathFor('about'), '/about.html');
  assert.equal(NS.normalizePageSlug('About Me!', new Set()), 'about-me');
  assert.equal(NS.normalizePageSlug('', new Set()), 'page');
  assert.equal(NS.normalizePageSlug('about', new Set(['about'])), 'about-2', 'slugs never collide');
});

test('rendering a site: the file list, the nav, and no script anywhere', () => {
  const draft = {
    name: 'blog',
    title: 'The Blog',
    pages: [
      { slug: 'index', title: 'Home', md: '# Welcome\n\nHello.' },
      { slug: 'about', title: 'About', md: 'About [me](/index.html).' },
    ],
  };
  const files = NS.renderSiteFiles(draft, (s) => s);
  assert.deepEqual(j(files.map((f) => f.path)), ['/index.html', '/about.html']);
  for (const f of files) {
    assert.ok(f.html.startsWith('<!DOCTYPE html>'), 'a full document, not a fragment');
    assert.equal(/\s<\s?script/i.test(f.html), false, 'the published site carries no script');
    assert.ok(f.html.includes('href="/about.html"'), 'the nav is complete on every page');
    assert.ok(f.html.includes('aria-current="page"'), 'the active page is marked');
  }
  assert.ok(files[0].html.includes('<h1>Welcome</h1>'));
});

test('renderSiteFiles: the entry page is not optional, and the byte cap holds', () => {
  assert.throws(() => NS.renderSiteFiles({ pages: [{ slug: 'only', title: '', md: 'x' }] }), /index page/);
  assert.throws(
    () => NS.renderSiteFiles({ pages: [{ slug: 'index', title: '', md: 'x'.repeat(NS.PAGE_MAX_BYTES) }] }),
    /1 MB page limit/,
  );
  assert.equal(NS.siteDraftIsPostable({ pages: [{ slug: 'index', md: '  ' }] }), false);
  assert.equal(NS.siteDraftIsPostable({ pages: [{ slug: 'index', md: 'written' }] }), true);
});

test('the diff a publish card shows: added, changed, removed', () => {
  const base = [
    { path: '/index.html', hash: H1 },
    { path: '/old.html', hash: H2 },
  ];
  const next = [
    { path: '/index.html', hash: H2 },          // changed
    { path: '/new.html', hash: '3'.repeat(64) }, // added
  ];
  const d = NS.manifestDiff(base, next);
  assert.deepEqual(j(d.added), ['/new.html']);
  assert.deepEqual(j(d.changed), ['/index.html']);
  assert.deepEqual(j(d.removed), ['/old.html']);
});

test('the diff that changes nothing is empty — the no-op publish is detectable', () => {
  const files = [{ path: '/index.html', hash: H1 }];
  const d = NS.manifestDiff(files, [{ path: '/index.html', hash: H1 }]);
  assert.deepEqual(j(d), { added: [], removed: [], changed: [] });
});
