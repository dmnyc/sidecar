'use strict';

// GIFs from nostr.build, in both composers.
//
// The read side is the API's JSON, which this file checks against a page trimmed from
// the shape gifs.nostr.build documents in /api/v1/openapi.json. What matters is what a
// bad answer must not do: put a non-https link or an unknown format into a published
// note, or ask for an offset the API rejects. The wiring checks hold the parts a source
// test can see: both composers mount the picker, a pick goes into the media slot rather
// than the editor, the picker stands down with Media when a poll holds the draft, and
// the credit line nostr.build asked for is built from nodes, never markup.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n.js');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// The REAL functions, lifted out of composer-core.js, so the tests cannot pass against a
// copy that has drifted from the file both composers load.
function lift(pattern, label) {
  const m = core.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in composer-core.js');
  return m[0];
}
const ctx = withI18n({ URLSearchParams });
vm.createContext(ctx);
vm.runInContext([
  lift(/const GIF_API = [^\n]*/, 'GIF_API'),
  lift(/const GIF_PAGE_SIZE = [^\n]*/, 'GIF_PAGE_SIZE'),
  lift(/const GIF_LAST_OFFSET = [^\n]*/, 'GIF_LAST_OFFSET'),
  lift(/const GIF_QUERY_MAX = [^\n]*/, 'GIF_QUERY_MAX'),
  lift(/const GIF_SUGGEST_LIMIT = [^\n]*/, 'GIF_SUGGEST_LIMIT'),
  lift(/const GIF_FORMATS = [^\n]*/, 'GIF_FORMATS'),
  lift(/function gifSearchUrl\(query, offset\) \{[\s\S]*?\n  \}/, 'gifSearchUrl'),
  lift(/function gifSuggestUrl\(query\) \{[\s\S]*?\n  \}/, 'gifSuggestUrl'),
  lift(/const isHttps = [^\n]*/, 'isHttps'),
  lift(/function gifFromItem\(item\) \{[\s\S]*?\n  \}/, 'gifFromItem'),
  lift(/function parseGifPage\(body\) \{[\s\S]*?\n  \}/, 'parseGifPage'),
  lift(/function parseGifSuggestions\(body\) \{[\s\S]*?\n  \}/, 'parseGifSuggestions'),
  lift(/function gifErrorMessage\(status\) \{[\s\S]*?\n  \}/, 'gifErrorMessage'),
  'this.api = { gifSearchUrl, gifSuggestUrl, gifFromItem, parseGifPage, parseGifSuggestions, gifErrorMessage };',
].join('\n'), ctx);
const api = ctx.api;
// Values made in the vm context carry its prototypes, which deepStrictEqual tells apart.
const plain = (v) => JSON.parse(JSON.stringify(v));

const preview = (animated, still) => ({ width: 240, height: 135, animated, still });
function item(over) {
  return Object.assign({
    id: 'aa.gif',
    url: 'https://image.nostr.build/aa.gif',
    width: 480,
    height: 270,
    bytes: 123456,
    format: 'gif',
    title: ' Good morning ',
    previews: {
      small: preview(null, 'https://p/aa-s.png'),
      medium: preview(null, 'https://p/aa-m.png'),
      w240: preview('https://p/aa-240.webp', 'https://p/aa-240.png'),
    },
  }, over);
}

test('a search asks for safe results, one page at a time', () => {
  const u = new URL(api.gifSearchUrl('  good morning  ', 24));
  assert.equal(u.origin + u.pathname, 'https://gifs.nostr.build/api/v1/search');
  assert.equal(u.searchParams.get('q'), 'good morning');
  assert.equal(u.searchParams.get('offset'), '24');
  assert.equal(u.searchParams.get('limit'), '24');
  assert.equal(u.searchParams.get('safe'), '1');
  assert.equal(new URL(api.gifSearchUrl('x'.repeat(900), 0)).searchParams.get('q').length, 500);
  const s = new URL(api.gifSuggestUrl('gm'));
  assert.equal(s.pathname, '/api/v1/suggest');
  assert.equal(s.searchParams.get('safe'), '1');
});

test('A RESULT CARRIES ITS LINK, ITS SIZE AND THE ANIMATED w240 PREVIEW', () => {
  assert.deepEqual(plain(api.gifFromItem(item())), {
    url: 'https://image.nostr.build/aa.gif',
    preview: 'https://p/aa-240.webp',
    width: 480,
    height: 270,
    title: 'Good morning',
  });
  // Too big to animate: the first frame stands in.
  const still = api.gifFromItem(item({ previews: { w240: preview(null, 'https://p/bb.png') } }));
  assert.equal(still.preview, 'https://p/bb.png');
  // No w240 at all: medium is the next size down that fills a cell.
  const medium = api.gifFromItem(item({ previews: { medium: preview(null, 'https://p/m.png') } }));
  assert.equal(medium.preview, 'https://p/m.png');
});

test('NOTHING THAT CANNOT GO INTO A NOTE AS IT IS GETS INTO THE GRID', () => {
  for (const bad of [
    item({ url: 'http://image.nostr.build/aa.gif' }),
    item({ url: 'javascript:alert(1)' }),
    item({ url: undefined }),
    item({ format: 'mp4' }),
    item({ width: 0 }),
    item({ height: 'tall' }),
    item({ previews: null }),
    item({ previews: { w240: preview('http://p/x.webp', null) } }),
    null,
    'aa.gif',
  ]) {
    assert.equal(api.gifFromItem(bad), null, JSON.stringify(bad));
  }
});

test('a page drops what it cannot show and says where the next one starts', () => {
  const page = api.parseGifPage({ count: 3, offset: 0, items: [item(), item({ format: 'mp4' })] });
  assert.equal(page.gifs.length, 1);
  // The offset counts every item the API sent, shown or not, or the next page repeats one.
  assert.equal(page.next, 2);
  assert.equal(api.parseGifPage({ count: 3, offset: 2, items: [item()] }).next, null);
});

test('PAGING STOPS AT THE LIST AND AT THE LAST OFFSET THE API ACCEPTS', () => {
  assert.equal(api.parseGifPage({ count: 200, offset: 192, items: Array(8).fill(item()) }).next, null);
  assert.equal(api.parseGifPage({ count: 500, offset: 168, items: Array(24).fill(item()) }).next, 192);
  assert.equal(api.parseGifPage({ count: 500, offset: 192, items: Array(24).fill(item()) }).next, null);
  // An empty page ends the list whatever count claims.
  assert.equal(api.parseGifPage({ count: 50, offset: 0, items: [] }).next, null);
  assert.deepEqual(plain(api.parseGifPage(null)), { gifs: [], next: null });
  assert.deepEqual(plain(api.parseGifPage({ items: 'nope' })), { gifs: [], next: null });
});

test('suggestions are trimmed, unique and capped', () => {
  const terms = api.parseGifSuggestions({
    terms: [{ term: ' gm ' }, { term: 'gm' }, { term: '' }, { nope: 1 }, null,
      { term: 'gn' }, { term: 'good' }, { term: 'great' }, { term: 'gg' }, { term: 'go' }, { term: 'gl' }],
  });
  assert.deepEqual(plain(terms), ['gm', 'gn', 'good', 'great', 'gg', 'go']);
  assert.deepEqual(plain(api.parseGifSuggestions({})), []);
});

test('a refused key reads as unavailable, not as something to retry', () => {
  assert.equal(api.gifErrorMessage(403), 'GIF search isn’t available right now.');
  assert.equal(api.gifErrorMessage(401), 'GIF search isn’t available right now.');
  assert.equal(api.gifErrorMessage(429), 'Too many searches. Try again in a minute.');
  assert.match(api.gifErrorMessage(500), /Couldn’t load GIFs/);
  assert.match(api.gifErrorMessage(0), /Couldn’t load GIFs/);
});

test('THE CREDIT NOSTR.BUILD ASKED FOR IS IN THE PICKER, BUILT FROM NODES', () => {
  const body = lift(/function buildGifPicker\(d\) \{[\s\S]*?\n  \}/, 'buildGifPicker');
  assert.match(body, /I18N\.fill\(t\('GIFs from \{\{source\}\}'\), \{ source: link \}\)/);
  assert.match(body, /href: 'https:\/\/nostr\.build'/);
  assert.match(body, /rel: 'noopener noreferrer'/);
  assert.doesNotMatch(body, /innerHTML\s*=(?!\s*'')/, 'the picker sets no markup but an empty reset');
});

test('both composers mount the picker and attach a pick by URL', () => {
  for (const [name, src] of [['sidepanel.js', panel], ['compose.js', page]]) {
    assert.match(src, /buildGifPicker\(\{/, name + ' builds the picker');
    assert.match(src, /gif: \(\) => gifPicker/, name + ' hands it to the poll editor');
    assert.match(src, /draft\.media\.push\(\{ url: gif\.url, isVideo: false \}\)/, name + ' puts the pick in the media slot');
    assert.match(src, /gifPicker\.addBtn/, name + ' puts the button in the toolbar');
    assert.match(src, /gifPicker\.wrap/, name + ' mounts the picker');
  }
});

test('A POLL SENDS THE GIF BUTTON OFF WITH MEDIA, AND CLOSES THE PICKER', () => {
  const body = lift(/function paintEitherOr\(\) \{[\s\S]*?\n    \}/, 'paintEitherOr');
  assert.match(body, /gif\.addBtn\.classList\.toggle\('hidden', !!d\.poll\(\)\)/);
  assert.match(body, /if \(d\.poll\(\)\) gif\.close\(\)/);
});

test('the picker keeps the panel row rules: the close box is fixed and the credit truncates', () => {
  const rule = (sel) => {
    const m = css.match(new RegExp('\\n' + sel.replace('.', '\\.') + ' \\{([^}]*)\\}'));
    assert.ok(m, sel + ' is styled');
    return m[1];
  };
  assert.match(rule('.gif-x'), /flex-shrink: 0/);
  assert.match(rule('.gif-credit'), /min-width: 0/);
  assert.match(rule('.gif-credit'), /text-overflow: ellipsis/);
  assert.match(rule('.gif-chips'), /flex-wrap: wrap/);
});
