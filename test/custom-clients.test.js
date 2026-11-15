'use strict';

// A client that is not on the list — dropped, obscure, or brand new — could not be
// used at all: the picker offered only VIEW_CLIENTS, and nostrich's removal (deliberate,
// over its blacklist policy) was the complaint that proved the gap. The way back is not
// re-adding any client; it is letting the user bring one.
//
// The hard part is the link's shape, and it is two shapes: the ROUTE around the address
// (/thread/, /e/) and the FORM the address is written in (hex, note1, short nevent, full
// nevent). Clients differ on both and nothing declares either, so the user pastes a link
// that works in the client and Sidecar reads both from it. These tests use real links
// from real clients, run the parser and the builder, and check that what is stored
// rebuilds the link it came from.
//
// resolveClient keeps its contract: per-account choice first, then the global, then the
// default — custom clients are just more keys those maps can name. A key that names
// nothing falls back, because clients get deleted.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

// Same brace-matcher the per-account test uses: lift a declaration out of the file and
// run it in a bare context, so the assertions below RUN the resolution rather than read it.
function lift(src, decl) {
  const at = src.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  let paren = 0;
  let i = src.indexOf('(', at);
  for (; i < src.length; i++) {
    if (src[i] === '(') paren++;
    else if (src[i] === ')' && --paren === 0) break;
  }
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// The real nostr-tools, the way the panel has it: parsing and rebuilding decode and
// encode bech32, and a stand-in would agree with itself.
const tools = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
vm.createContext(tools);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), tools);
const NT = tools.NostrTools;

const CLIENTS = {
  jumble: { label: 'Jumble', url: (ne) => 'https://jumble.social/notes/' + ne, profile: (np) => 'https://jumble.social/users/' + np },
};

function api() {
  const ctx = { console, URL, deps: { NT }, VIEW_CLIENTS: CLIENTS, DEFAULT_CLIENT: 'jumble' };
  vm.createContext(ctx);
  vm.runInContext(
    core.match(/const ENTITY_RE = .*;/)[0] + '\n' +
    lift(core, 'function noteEntityFor(') + '\n' +
    lift(core, 'function profileEntityFor(') + '\n' +
    lift(core, 'function parseClientLink(') + '\n' +
    lift(core, 'function customClient(') + '\n' +
    lift(core, 'function resolveClient(') + '\n' +
    'globalThis.api = { parseClientLink, customClient, resolveClient };',
    ctx
  );
  // Results cross a vm boundary; compare their contents, not their prototypes.
  const plain = (fn) => (...a) => JSON.parse(JSON.stringify(fn(...a)));
  return { ...ctx.api, parseClientLink: plain(ctx.api.parseClientLink) };
}

// Real links, from the clients themselves, for the one note below.
const ID = '00000021fa819996851be3c1ba8168f88cc89b3cfb848bfab5b485f4c281f344';
const AUTHOR = '460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c';
const FULL = 'nevent1qvzqqqqqqypzq3svyhng9ld8sv44950j957j9vchdktj7cxumsep9mvvjthc2pjuqyghwumn8ghj7mn0wd68ytnhd9hx2tcpzemhxue69uhhyetvv9ujuerfw36x7tnsw43z7qpqqqqqqg06sxvedpgmu0qm4qtglzxv3xeulwzgh744kjzlfs5p7dzq2wywa7';
const SHORT = 'nevent1qqsqqqqqy8agrxvks5d78sd6s9503rxgnv70hpytl26mfp05c2qlx3q6v3wq7';
const NPUB = NT.nip19.npubEncode(AUTHOR);

// ---- reading a pasted link -------------------------------------------------------------

test('the same note, in the four ways real clients write it, reads as four forms', () => {
  const { parseClientLink } = api();
  // nostr.com takes hex and a full nevent at the same route; Primal writes the short one.
  assert.deepEqual(parseClientLink(`https://nostr.com/thread/${ID}`, 'note'), { template: 'https://nostr.com/thread/{ne}', form: 'hex' });
  assert.deepEqual(parseClientLink(`https://nostr.com/thread/${FULL}`, 'note'), { template: 'https://nostr.com/thread/{ne}', form: 'nevent' });
  assert.deepEqual(parseClientLink(`https://primal.net/e/${SHORT}`, 'note'), { template: 'https://primal.net/e/{ne}', form: 'nevent-short' });
  assert.deepEqual(parseClientLink(`https://primal.net/e/${NT.nip19.noteEncode(ID)}`, 'note'), { template: 'https://primal.net/e/{ne}', form: 'note' });
});

test('the address may sit anywhere in the link: path, query, or an escaped command', () => {
  const { parseClientLink } = api();
  assert.deepEqual(parseClientLink(`https://x.app/n?nostr=${SHORT}`, 'note'), { template: 'https://x.app/n?nostr={ne}', form: 'nevent-short' });
  assert.deepEqual(parseClientLink(`https://x.app/#/n/${SHORT}`, 'note'), { template: 'https://x.app/#/n/{ne}', form: 'nevent-short' });
  // The way Grimoire writes it: a command, percent-escaped, with the address inside.
  assert.deepEqual(parseClientLink(`https://g.rocks/run?cmd=open%20${SHORT}`, 'note'), { template: 'https://g.rocks/run?cmd=open%20{ne}', form: 'nevent-short' });
});

test('profiles read the same way: npub, nprofile, hex', () => {
  const { parseClientLink } = api();
  assert.deepEqual(parseClientLink(`https://primal.net/p/${NPUB}`, 'profile'), { template: 'https://primal.net/p/{np}', form: 'npub' });
  assert.deepEqual(parseClientLink(`https://x.app/u/${NT.nip19.nprofileEncode({ pubkey: AUTHOR, relays: ['wss://r.example'] })}`, 'profile'), { template: 'https://x.app/u/{np}', form: 'nprofile' });
  assert.deepEqual(parseClientLink(`https://x.app/u/${AUTHOR}`, 'profile'), { template: 'https://x.app/u/{np}', form: 'hex' });
});

test('a link that cannot be read is refused, and says why', () => {
  const { parseClientLink } = api();
  assert.equal(parseClientLink(`http://nostr.com/thread/${ID}`, 'note').error, 'parse', 'plain http was accepted');
  assert.equal(parseClientLink(`nostr.com/thread/${ID}`, 'note').error, 'parse', 'a bare host was accepted');
  assert.equal(parseClientLink('https://nostr.com/thread/', 'note').error, 'none', 'no address, accepted');
  assert.equal(parseClientLink(`https://nostr.com/thread/${ID}/${AUTHOR}`, 'note').error, 'many', 'two addresses, and it guessed');
  // A hex run longer than an id is not an id.
  assert.equal(parseClientLink(`https://nostr.com/thread/${ID}0`, 'note').error, 'none', 'a 65-character run read as an id');
  // The wrong sort of address in the slot: a profile pasted as a note, and the reverse.
  assert.equal(parseClientLink(`https://x.app/p/${NPUB}`, 'note').error, 'kind');
  assert.equal(parseClientLink(`https://x.app/e/${SHORT}`, 'profile').error, 'kind');
  // An article's address cannot be reduced to a note id, so it is not offered as a sample.
  const naddr = NT.nip19.naddrEncode({ identifier: 'a', pubkey: AUTHOR, kind: 30023, relays: [] });
  assert.equal(parseClientLink(`https://x.app/a/${naddr}`, 'note').error, 'kind');
  // Not a real bech32 even though it is shaped like one.
  assert.equal(parseClientLink('https://x.app/e/nevent1qqqqqqqq', 'note').error, 'none');
});

test('a pasted link that carries parameters of its own says which, and still reads', () => {
  const { parseClientLink } = api();
  // A share tag and a session token would ride on every link opened from now on.
  const got = parseClientLink(`https://x.app/e/${ID}?utm_source=share&token=abc123&utm_source=again`, 'note');
  assert.equal(got.template, 'https://x.app/e/{ne}?utm_source=share&token=abc123&utm_source=again');
  assert.deepEqual(got.extra, ['utm_source', 'token'], 'a rider parameter went unnamed, or was named twice');
  // A parameter that CARRIES the address is the route, not a rider: a query route and an
  // escaped command are how real clients write theirs.
  assert.equal(parseClientLink(`https://x.app/n?nostr=${SHORT}`, 'note').extra, undefined);
  assert.equal(parseClientLink(`https://g.rocks/run?cmd=open%20${SHORT}`, 'note').extra, undefined);
  // A fragment route is a route too, and a plain link has nothing to report.
  assert.equal(parseClientLink(`https://x.app/#/n/${SHORT}`, 'note').extra, undefined);
  assert.equal(parseClientLink(`https://primal.net/e/${SHORT}`, 'note').extra, undefined);
  // Riders next to a carrier are still named.
  assert.deepEqual(parseClientLink(`https://x.app/n?nostr=${SHORT}&ref=home`, 'note').extra, ['ref']);
});

test('a link whose address does not rebuild to itself is refused', () => {
  const { parseClientLink } = api();
  // A short nevent with a trailing field of a type nobody knows: it decodes as an id and
  // nothing else, so it reads as short — but writing it back out drops the field, and
  // a stored pair that cannot reproduce the link is a pair we cannot vouch for.
  const bytes = new Uint8Array(2 + 32 + 3);
  bytes.set([0, 32]);
  bytes.set(Uint8Array.from(Buffer.from(ID, 'hex')), 2);
  bytes.set([9, 1, 7], 34);
  const odd = NT.nip19.encodeBytes('nevent', bytes);
  assert.equal(parseClientLink(`https://x.app/e/${odd}`, 'note').error, 'mismatch');
});

// ---- building the link ------------------------------------------------------------------

// Every call site hands over a full nevent (or an naddr). A client that takes less is
// handed less; this is the half of the feature a typed template could not do.
test('what a call site hands over is written the way THIS client takes it', () => {
  const { parseClientLink, customClient } = api();
  const entry = (link, kind) => {
    const got = parseClientLink(link, kind);
    return { template: got.template, form: got.form };
  };
  const mk = (noteLink, profileLink) => {
    const n = entry(noteLink, 'note');
    const p = entry(profileLink, 'profile');
    return customClient({ label: 'X', url: n.template, urlForm: n.form, profile: p.template, profileForm: p.form });
  };
  const handedOver = NT.nip19.neventEncode({ id: ID, author: AUTHOR, relays: [] });

  // Primal's short nevent, from the link the user pasted: the id and nothing else.
  const primal = mk(`https://primal.net/e/${SHORT}`, `https://primal.net/p/${NPUB}`);
  assert.equal(primal.url(handedOver), `https://primal.net/e/${SHORT}`);
  // A client that takes hex gets hex.
  const nostrCom = mk(`https://nostr.com/thread/${ID}`, `https://nostr.com/p/${AUTHOR}`);
  assert.equal(nostrCom.url(handedOver), `https://nostr.com/thread/${ID}`);
  assert.equal(nostrCom.profile(NPUB), `https://nostr.com/p/${AUTHOR}`);
  // note1, and the full nevent unchanged, author and all.
  assert.equal(mk(`https://x.app/e/${NT.nip19.noteEncode(ID)}`, `https://x.app/p/${NPUB}`).url(handedOver), `https://x.app/e/${NT.nip19.noteEncode(ID)}`);
  assert.equal(mk(`https://x.app/e/${FULL}`, `https://x.app/p/${NPUB}`).url(handedOver), `https://x.app/e/${handedOver}`);
  // A profile written as nprofile.
  const nprof = mk(`https://x.app/e/${FULL}`, `https://x.app/u/${NT.nip19.nprofileEncode({ pubkey: AUTHOR })}`);
  assert.equal(nprof.profile(NPUB), `https://x.app/u/${NT.nip19.nprofileEncode({ pubkey: AUTHOR })}`);
  // The whole point of reading the link: what is stored rebuilds what was pasted.
  for (const link of [`https://nostr.com/thread/${ID}`, `https://primal.net/e/${SHORT}`, `https://x.app/e/${NT.nip19.noteEncode(ID)}`]) {
    const n = entry(link, 'note');
    assert.equal(customClient({ label: 'X', url: n.template, urlForm: n.form, profile: 'https://x/{np}' }).url(handedOver), link);
  }
});

test('an address the form cannot carry is passed through, not mangled', () => {
  const { customClient } = api();
  const naddr = NT.nip19.naddrEncode({ identifier: 'a', pubkey: AUTHOR, kind: 30023, relays: [] });
  const hexClient = customClient({ label: 'X', url: 'https://x.app/{ne}', urlForm: 'hex', profile: 'https://x.app/p/{np}', profileForm: 'hex' });
  assert.equal(hexClient.url(naddr), 'https://x.app/' + naddr, 'an article address was turned into something else');
});

// ---- resolution ----------------------------------------------------------------------

const MINE = { label: 'Mine', url: 'https://notes.example/e/{ne}', urlForm: 'hex', profile: 'https://notes.example/p/{np}', profileForm: 'npub' };

test('a saved custom client resolves, and both links build from what was saved', () => {
  const { resolveClient } = api();
  const s = { customClients: { 'custom:notes.example': MINE }, defaultClientBy: { bob: 'custom:notes.example' } };
  const c = resolveClient(s, 'bob');
  assert.equal(c.label, 'Mine');
  assert.equal(c.url(SHORT), 'https://notes.example/e/' + ID);
  assert.equal(c.profile(NPUB), 'https://notes.example/p/' + NPUB);
});

test('an account without a choice follows the global, and the global may name a custom client', () => {
  const { resolveClient } = api();
  const s = { customClients: { 'custom:notes.example': MINE }, defaultClient: 'custom:notes.example', defaultClientBy: { bob: 'jumble' } };
  assert.equal(resolveClient(s, 'alice').label, 'Mine', 'the global stopped naming custom clients');
  assert.equal(resolveClient(s, 'bob').label, 'Jumble', 'the global overrode an explicit choice');
});

test('a key that names nothing falls back to the default', () => {
  const { resolveClient } = api();
  const s = { defaultClientBy: { bob: 'custom:gone.example' } };
  const c = resolveClient(s, 'bob');
  assert.equal(c.label, 'Jumble');
  assert.equal(c.url('nevent1abc'), 'https://jumble.social/notes/nevent1abc');
});

test('a half-written entry falls back rather than crashing the opener', () => {
  const { resolveClient } = api();
  const s = { customClients: { 'custom:notes.example': { label: 'Mine', url: 'https://notes.example/e/{ne}' } }, defaultClientBy: { bob: 'custom:notes.example' } };
  assert.equal(resolveClient(s, 'bob').label, 'Jumble');
});

// ---- the write side --------------------------------------------------------------------

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

test('REMOVAL SCRUBS THE CHOICES THAT NAMED THE CLIENT', () => {
  // resolveClient already falls back for a dangling key, so scrubbing changes no
  // behavior — what it changes is the truth of the maps. A leftover choice would
  // snap back to life the moment a client reappears under the same key, with nobody
  // choosing it again. Run the scrub, don't read it.
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(lift(bg, 'function scrubClientChoice(') + '\nglobalThis.scrub = scrubClientChoice;', ctx);
  const s = { defaultClient: 'custom:gone.example', defaultClientBy: { alice: 'custom:gone.example', bob: 'iris', carol: 'custom:gone.example' } };
  ctx.scrub(s, 'custom:gone.example');
  assert.equal(s.defaultClient, undefined, 'the global choice naming the client is left behind');
  assert.deepEqual(s.defaultClientBy, { bob: 'iris' }, 'per-account choices naming the client are left behind');
  // And nothing to scrub is not a crash.
  ctx.scrub({}, 'custom:gone.example');
  const handler = stripComments(bg).match(/case 'SIDECAR_REMOVE_CUSTOM_CLIENT': \{[\s\S]*?\n      \}/);
  assert.ok(handler, 'the removal handler moved or changed shape');
  assert.match(handler[0], /delete map\[message\.key\]/, 'the entry itself is not removed');
  assert.match(handler[0], /scrubClientChoice\(next, message\.key\)/, 'the handler skips the scrub');
});

test('THE WRITE IS READ-MODIFY-WRITTEN HERE, NOT FROM THE PANEL', () => {
  const handler = stripComments(bg).match(/case 'SIDECAR_SET_CUSTOM_CLIENT': \{[\s\S]*?\n      \}/);
  assert.ok(handler, 'the write handler moved or changed shape');
  assert.match(handler[0], /\{ \.\.\.\(prev\.customClients \|\| \{\}\) \}/, 'the map is not read-modify-written');
  assert.match(handler[0], /replaceKey/, 'an edit whose host moved leaves the old entry behind');
  // An unknown form is not stored; the entry is kept without one and the opener passes
  // addresses through. Run the same filter the handler runs.
  assert.match(handler[0], /CUSTOM_NOTE_FORMS\.includes\(message\.urlForm\)/, 'a form is stored unchecked');
  assert.match(handler[0], /CUSTOM_PROFILE_FORMS\.includes\(message\.profileForm\)/, 'a form is stored unchecked');
});

// ---- the surfaces ----------------------------------------------------------------------

test('the settings page carries the add affordance and the list, outside the static select', () => {
  assert.match(html, /id="add-client-btn"/, 'no way in');
  assert.match(html, /id="custom-clients"/, 'no list to manage what was added');
  const sel = html.match(/<select id="client-select">[\s\S]*?<\/select>/)[0];
  assert.doesNotMatch(sel, /add-client-btn|custom-clients/, 'the static select was edited');
});
