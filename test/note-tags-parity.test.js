'use strict';

// THE SAME NOTE, TAGGED THE SAME WAY, FROM EITHER COMPOSER.
//
// The expanded tab built its own tag list and left out what the text tags: from its first
// release a mention written there carried no p tag (so the person was never notified), a
// quote carried no q tag (so it did not read as a quote), and the client tag ignored its
// Settings switch. The panel did all three. Both now take the text's tags from
// composer-core's noteBodyTags, and this runs the real publish code of each page on the
// same drafts and requires the same event out of both.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const panel = read('sidepanel.js');
const page = read('compose.js');

// The real core, loaded the way a page loads it: nostr-tools, i18n, then composer-core.
function loadCore() {
  const ctx = {
    console, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder,
    navigator: { language: 'en' },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { lang: 'en', setAttribute() {}, dir: '' }, querySelectorAll: () => [] },
    chrome: { runtime: { getURL: (p) => p } },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('nostr-tools.js'), ctx);
  vm.runInContext(read('i18n.js'), ctx);
  vm.runInContext(read('composer-core.js'), ctx);
  return ctx;
}
const core = loadCore();
const SC = core.SidecarCore;
const NT = core.NostrTools;

const ME = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const BOB = 'c'.repeat(64);
const QUOTED = 'd'.repeat(64);
const nevent = NT.nip19.neventEncode({ id: QUOTED, author: BOB, relays: ['wss://hint.example/'] });

// The panel's publish lines, from the prose to the event, run as they are.
async function panelTags({ text, media = [], replyTo = null, showClientTag = true }) {
  const at = panel.indexOf('      const prose = window.SidecarCore.linkBareRefs(draft.text.trim(), NT);');
  assert.ok(at !== -1, 'the panel\'s publish no longer starts where this test reads it');
  const seg = panel.slice(at, panel.indexOf('      const event = {', at));
  const ctx = {
    draft: { text, media, poll: null }, replyTo, NT, Set, Math, Date,
    window: { SidecarCore: SC },
    composeNoteContent: SC.composeNoteContent, imetaTagsForMedia: SC.imetaTagsForMedia,
    buildPollTags: SC.buildPollTags, CLIENT_TAG: ['client', 'Sidecar'],
    call: async () => ({ showClientTag }),
    isDevBuild: () => false, devKindEnabled: false, devSilentEnabled: false, devKind: 0, devSilentInput: null,
    replyTags: (target) => SC.replyTags(target, ME),
    relayUrls: async () => [],
  };
  vm.createContext(ctx);
  await vm.runInContext('(async () => {' + seg + '; globalThis.OUT = { tags, content }; })()', ctx);
  return JSON.parse(JSON.stringify(ctx.OUT));
}

// The tab's publish lines, from the reply to the template, run as they are.
async function tabTags({ text, media = [], replyTo = null, showClientTag = true }) {
  const at = page.indexOf("      const settings = (await call({ type: 'SIDECAR_GET_SETTINGS' }).catch(() => null)) || {};");
  assert.ok(at !== -1, 'the tab\'s publish no longer starts where this test reads it');
  const end = page.indexOf('      // MINE FIRST, THEN SIGN.', at);
  const seg = page.slice(at, end);
  const ctx = {
    // doPost's own first line: a bare reference becomes its nostr: form.
    SC, NT, Math, Date, text: SC.linkBareRefs(text.trim(), NT),
    draft: { text, media, poll: null }, replyTo,
    state: { activePubkey: ME },
    call: async () => ({ showClientTag }),
    targetRelays: async () => [],
    // A store build: the dev aids are off.
    devBuild: false, devOn: {}, devKind: 0, devSilentText: '', devAuthorOf: async () => null,
  };
  vm.createContext(ctx);
  await vm.runInContext('(async () => {' + seg + '; globalThis.OUT = { tags: template.tags, content: template.content }; })()', ctx);
  return JSON.parse(JSON.stringify(ctx.OUT));
}

const mention = (pk) => 'nostr:' + NT.nip19.npubEncode(pk);

const CASES = [
  { name: 'a mention and a quote, client tag on',
    draft: { text: 'hi ' + mention(ALICE) + ' look nostr:' + nevent } },
  { name: 'the same with the client tag off',
    draft: { text: 'hi ' + mention(ALICE) + ' look nostr:' + nevent, showClientTag: false } },
  { name: 'a reply that also mentions the person it answers, and someone else',
    draft: { text: mention(BOB) + ' and ' + mention(ALICE),
      replyTo: { id: 'e'.repeat(64), pubkey: BOB, kind: 1, tags: [], content: 'parent' } } },
  { name: 'a bare npub and a bare nevent, as people paste them',
    draft: { text: 'GM ' + NT.nip19.npubEncode(ALICE) + '\n' + nevent } },
  { name: 'an image with a description',
    draft: { text: 'a picture', media: [{ url: 'https://x.example/a.jpg', alt: 'a cat', type: 'image' }] } },
];

for (const { name, draft } of CASES) {
  test('both composers tag the same note the same way: ' + name, async () => {
    const fromPanel = await panelTags(draft);
    const fromTab = await tabTags(draft);
    assert.deepEqual(fromTab, fromPanel);
  });
}

test('a mention written in the tab notifies, and a quote reads as a quote', async () => {
  const { tags } = await tabTags({ text: 'hi ' + mention(ALICE) + ' look nostr:' + nevent });
  assert.ok(tags.some((t) => t[0] === 'p' && t[1] === ALICE), 'the person mentioned is not p-tagged');
  assert.ok(tags.some((t) => t[0] === 'q' && t[1] === QUOTED), 'the quote has no q tag');
  assert.ok(tags.some((t) => t[0] === 'p' && t[1] === BOB), 'the quoted author is not p-tagged');
});

test('the tab honors the client tag setting', async () => {
  const off = await tabTags({ text: 'plain', showClientTag: false });
  assert.equal(off.tags.some((t) => t[0] === 'client'), false, 'the client tag ignored its switch');
  const on = await tabTags({ text: 'plain' });
  assert.deepEqual(on.tags.filter((t) => t[0] === 'client'), [['client', 'Sidecar']]);
});

test('a bare reference posts as a mention and a quote, from either composer', async () => {
  const draft = { text: 'GM ' + NT.nip19.npubEncode(ALICE) + '\n' + nevent };
  for (const out of [await panelTags(draft), await tabTags(draft)]) {
    assert.ok(out.content.includes('nostr:' + nevent), 'the quote went out bare, as text');
    assert.ok(out.content.includes('nostr:' + NT.nip19.npubEncode(ALICE)), 'the mention went out bare');
    assert.ok(out.tags.some((t) => t[0] === 'q' && t[1] === QUOTED), 'no q tag for a pasted nevent');
    assert.ok(out.tags.some((t) => t[0] === 'p' && t[1] === ALICE), 'no p tag for a pasted npub');
  }
});

test('references already linked, inside a URL, inside code, or not real are left alone', () => {
  const link = (s) => SC.linkBareRefs(s, NT);
  const npub = NT.nip19.npubEncode(ALICE);
  assert.equal(link('hi nostr:' + npub), 'hi nostr:' + npub);
  assert.equal(link('see https://njump.me/' + nevent), 'see https://njump.me/' + nevent);
  assert.equal(link('`' + npub + '`'), '`' + npub + '`');
  assert.equal(link('```\n' + nevent + '\n```'), '```\n' + nevent + '\n```');
  assert.equal(link('note1notarealref'), 'note1notarealref');
  assert.equal(link('(' + npub + ')'), '(nostr:' + npub + ')');
});
