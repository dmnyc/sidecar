'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const panel = fs.readFileSync(require('node:path').join(__dirname, '../sidepanel.js'), 'utf8');
function between(start, end) {
  const at = panel.indexOf(start);
  assert.ok(at >= 0);
  return panel.slice(at, panel.indexOf(end, at));
}
function setup() {
  const profiles = new Map();
  const fetched = [];
  const ctx = {
    state: { accounts: [{ pubkey: 'amelia', name: 'Amelia' }] },
    _notifProfiles: new Map(), cachedProfile: (pk) => profiles.get(pk),
    NT: { nip19: { decode: (s) => {
      if (s === 'npub1bad') throw Error('invalid');
      return s.startsWith('npub') ? { type: 'npub', data: s.slice(5) }
        : { type: 'nprofile', data: { pubkey: s.slice(9) } };
    } } },
    IMG_RE: /never-image/g, AV_RE: /never-av/g,
    getProfile: async (pk) => { fetched.push(pk); profiles.set(pk, { name: 'Resolved ' + pk }); },
  };
  vm.createContext(ctx);
  vm.runInContext(between('  function notifProfileName(', '  function notifAuthorName(') +
    between('  function cleanSnippet(', '  // ---- mute matching'), ctx);
  return { ctx, profiles, fetched };
}
test('self mention uses the account name without another relay request', async () => {
  const { ctx, fetched } = setup();
  assert.equal(ctx.cleanSnippet('nostr:npub1amelia hello'), '@Amelia hello');
  await ctx.resolveNotifMentions('nostr:npub1amelia hello', () => assert.fail('already resolved'));
  assert.deepEqual(fetched, []);
});
test('shared profiles and notification profiles both resolve names', () => {
  const { ctx, profiles } = setup();
  profiles.set('gatsby', { name: 'Gatsby' });
  ctx._notifProfiles.set('other', 'Other');
  assert.equal(ctx.cleanSnippet('nostr:nprofile1gatsby nostr:npub1other'), '@Gatsby @Other');
});
test('missing names resolve and update a row, deduplicating repeated mentions', async () => {
  const { ctx, fetched } = setup();
  let updated;
  await ctx.resolveNotifMentions('nostr:npub1gatsby nostr:nprofile1gatsby', (text) => { updated = text; });
  assert.deepEqual(fetched, ['gatsby']);
  assert.equal(updated, '@Resolved gatsby @Resolved gatsby');
});
test('failed lookups and malformed mentions retain a safe fallback', async () => {
  const { ctx } = setup();
  ctx.getProfile = async () => { throw Error('offline'); };
  let updated;
  await ctx.resolveNotifMentions('nostr:npub1unknown nostr:npub1bad', (text) => { updated = text; });
  assert.equal(updated, '@npub1unknown… @…');
});
test('row hydration preserves expanded text and truncates collapsed text', async () => {
  const { ctx } = setup();
  const source = between('      if (isNoteLike && contentEl) {\n        resolveNotifMentions', '      return item;');
  for (const expanded of [false, true]) {
    const text = 'x'.repeat(160);
    const contentEl = { classList: { contains: () => expanded } };
    vm.runInNewContext(source, {
      isNoteLike: true, contentEl, ev: { content: text },
      resolveNotifMentions: (_, update) => update(text),
    });
    assert.equal(contentEl.textContent, expanded ? text : 'x'.repeat(140) + '…');
  }
  // buildItem is shared by initial pages, lazy outside-network rows, and live rows.
  assert.match(panel, /offNet\.forEach\(\(ev\) => inner\.insertBefore\(buildItem\(ev\), note\)\)/);
  assert.match(panel, /list\.prepend\(buildItem\(ev\)\)/);
});
