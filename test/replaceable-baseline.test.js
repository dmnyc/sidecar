'use strict';

// Unit coverage for destructive-overwrite detection (replaceable-baseline.js).
//
// Kinds 0/3/10000 are replaceable: the signed event wholly REPLACES the previous one,
// so a client publishing a short or empty list destroys the real one everywhere. This
// module compares an incoming event against a locally-kept baseline of what Sidecar
// last signed and reports a plain-language warning for the prompt.
//
// The invariants worth pinning, because the feature's usefulness AND its
// trustworthiness both rest on them:
//   - a total wipe is always flagged, however small the original list;
//   - a big proportional loss is flagged, but routine unfollowing is NOT (or the
//     warning gets trained away — the failure mode that would make this worse than
//     nothing);
//   - kind:0 flags only known meaningful fields going missing, since many clients
//     legitimately don't round-trip fields they don't understand;
//   - no baseline ⇒ no warning (absence of a warning never means "safe");
//   - check() NEVER throws — it must not be able to block a signature.
//
// replaceable-baseline.js is isolated (talks only to globalThis.chrome), so we load it
// in a vm against a small chrome mock — same approach as test/relax-grant.test.js.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function makeStorageArea() {
  const data = {};
  return {
    get(keys, cb) {
      let out = {};
      if (keys == null) out = { ...data };
      else if (typeof keys === 'string') { if (keys in data) out[keys] = data[keys]; }
      else if (Array.isArray(keys)) { for (const k of keys) if (k in data) out[k] = data[k]; }
      else { for (const k of Object.keys(keys)) out[k] = (k in data) ? data[k] : keys[k]; }
      cb(out);
    },
    set(obj, cb) { Object.assign(data, obj); cb && cb(); },
    remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k]; cb && cb(); },
    clear(cb) { for (const k of Object.keys(data)) delete data[k]; cb && cb(); },
  };
}

let B;
const pk = 'a'.repeat(64);
const pk2 = 'b'.repeat(64);

// A kind:3 (or 10000) carrying `n` distinct p-tags.
function listEvent(kind, n, extraTags) {
  const tags = [];
  for (let i = 0; i < n; i++) tags.push(['p', String(i).padStart(64, '0')]);
  return { kind, tags: tags.concat(extraTags || []), content: '' };
}
function profileEvent(obj) {
  return { kind: 0, tags: [], content: JSON.stringify(obj) };
}

before(() => {
  globalThis.self = globalThis;
  globalThis.chrome = { storage: { local: makeStorageArea() } };
  vm.runInThisContext(
    fs.readFileSync(path.join(ROOT, 'replaceable-baseline.js'), 'utf8'),
    { filename: 'replaceable-baseline.js' }
  );
  B = globalThis.SidecarBaseline;
  assert.ok(B, 'SidecarBaseline loaded');
});

beforeEach(async () => {
  await B.forget(pk);
  await B.forget(pk2);
});

// ---- summarize ----

test('summarize counts unique p-tags and ignores other tags', () => {
  const ev = listEvent(3, 5, [['e', 'x'], ['t', 'nostr']]);
  assert.equal(B.summarize(ev).count, 5);
});

test('summarize dedupes repeated p-tags — the same pubkey twice is one follow', () => {
  const dup = 'c'.repeat(64);
  const ev = { kind: 3, tags: [['p', dup], ['p', dup], ['p', 'd'.repeat(64)]], content: '' };
  assert.equal(B.summarize(ev).count, 2);
});

test('summarize ignores untracked kinds', () => {
  assert.equal(B.summarize({ kind: 1, tags: [], content: 'hi' }), null);
  assert.equal(B.summarize({ kind: 10002, tags: [], content: '' }), null);
});

test('summarize reports only known meaningful profile fields', () => {
  const s = B.summarize(profileEvent({ name: 'x', about: 'bio', picture: 'u', weird: 'v' }));
  assert.deepEqual(s.fields.sort(), ['about', 'picture']);
});

test('summarize treats empty-string profile fields as absent', () => {
  const s = B.summarize(profileEvent({ about: '   ', picture: 'u' }));
  assert.deepEqual(s.fields, ['picture']);
});

test('summarize returns null for unreadable kind:0 content (unknown, not empty)', () => {
  assert.equal(B.summarize({ kind: 0, tags: [], content: 'not json' }), null);
});

// ---- no baseline ----

test('no baseline means no warning — a first-ever sign cannot be judged', async () => {
  assert.equal(await B.check(pk, listEvent(3, 0)), null);
});

test('baselines are per account', async () => {
  await B.record(pk, listEvent(3, 500), 1);
  // pk2 has no baseline of its own, so its wipe is unjudgeable.
  assert.equal(await B.check(pk2, listEvent(3, 0)), null);
});

// ---- follows ----

test('emptying a follow list is always flagged', async () => {
  await B.record(pk, listEvent(3, 814), 1);
  const w = await B.check(pk, listEvent(3, 0));
  assert.equal(w.type, 'emptied');
  assert.equal(w.from, 814);
  assert.match(w.message, /all 814 accounts you follow/);
});

test('emptying is flagged even for a tiny list (the total-wipe case)', async () => {
  await B.record(pk, listEvent(3, 2), 1);
  const w = await B.check(pk, listEvent(3, 0));
  assert.equal(w.type, 'emptied');
});

test('a large proportional loss is flagged', async () => {
  await B.record(pk, listEvent(3, 814), 1);
  const w = await B.check(pk, listEvent(3, 12));
  assert.equal(w.type, 'shrink');
  assert.equal(w.lost, 802);
  assert.match(w.message, /from 814 to 12/);
});

test('routine unfollowing is NOT flagged — the warning must not be trained away', async () => {
  await B.record(pk, listEvent(3, 500), 1);
  assert.equal(await B.check(pk, listEvent(3, 495)), null); // unfollowed five
  assert.equal(await B.check(pk, listEvent(3, 260)), null); // just under half lost
});

test('a small list losing a few is NOT flagged (floor guards new accounts)', async () => {
  await B.record(pk, listEvent(3, 6), 1);
  // 6 -> 2 is a two-thirds loss but only 4 entries; below the floor, so quiet.
  assert.equal(await B.check(pk, listEvent(3, 2)), null);
});

test('growing or unchanged lists are never flagged', async () => {
  await B.record(pk, listEvent(3, 100), 1);
  assert.equal(await B.check(pk, listEvent(3, 100)), null);
  assert.equal(await B.check(pk, listEvent(3, 140)), null);
});

// ---- growth: another account's list signed as this one ----
//
// The case that prompted this (2026-09-29): a client whose own account switcher had the
// main account selected built a follow list from its 1,095 follows plus one, and asked
// Sidecar to sign it as a second account that followed 30. A shrink check sees 30 -> 1096
// as harmless. It is not: publishing it replaces the account's own list.

test('A FOLLOW LIST THAT JUMPS BY HUNDREDS IS FLAGGED, WHEN THE CALLER ASKS', async () => {
  await B.record(pk, listEvent(3, 30), 1);
  const w = await B.check(pk, listEvent(3, 1096), { growth: true });
  assert.equal(w.type, 'growth');
  assert.equal(w.added, 1066);
  assert.match(w.message, /Adds 1066 follows at once, taking your list from 30 to 1096/);
  assert.match(w.message, /another account’s follow list/);
});

test('without the option, growth is never flagged: Sidecar\'s own restores grow lists legitimately', async () => {
  await B.record(pk, listEvent(3, 30), 1);
  assert.equal(await B.check(pk, listEvent(3, 1096)), null);
});

test('real bulk following stays quiet: under the floor, or short of doubling', async () => {
  await B.record(pk, listEvent(3, 100), 1);
  assert.equal(await B.check(pk, listEvent(3, 399), { growth: true }), null, '299 added is under the floor');
  await B.record(pk, listEvent(3, 400), 2);
  assert.equal(await B.check(pk, listEvent(3, 750), { growth: true }), null, '350 added but not doubling');
  const w = await B.check(pk, listEvent(3, 800), { growth: true });
  assert.equal(w && w.type, 'growth', '400 added and doubled');
});

test('a mute list growing is never a growth finding', async () => {
  await B.record(pk, listEvent(10000, 5), 1);
  assert.equal(await B.check(pk, listEvent(10000, 900), { growth: true }), null);
});

test('WITH A NAME, EVERY FINDING SAYS WHOSE LIST IT IS', async () => {
  await B.record(pk, listEvent(3, 814), 1);
  assert.match((await B.check(pk, listEvent(3, 12), { name: 'Sidecar' })).message, /^Drops Sidecar’s follows from 814 to 12\.$/);
  assert.match((await B.check(pk, listEvent(3, 0), { name: 'Sidecar' })).message, /^Removes all 814 accounts Sidecar follows\.$/);
  await B.record(pk, listEvent(3, 30), 2);
  assert.match((await B.check(pk, listEvent(3, 1096), { growth: true, name: 'Sidecar' })).message, /taking Sidecar’s list from 30 to 1096/);
  await B.record(pk, listEvent(10000, 40), 3);
  assert.match((await B.check(pk, listEvent(10000, 0), { name: 'Sidecar' })).message, /^Clears Sidecar’s mute list of 40 accounts\.$/);
  await B.record(pk, profileEvent({ about: 'x', nip05: 'a@b.c' }), 4);
  assert.match((await B.check(pk, profileEvent({ about: 'x' }), { name: 'Sidecar' })).message, /^Clears Sidecar’s verified name\.$/);
});

test('without a name the wording is unchanged', async () => {
  await B.record(pk, listEvent(3, 814), 1);
  assert.match((await B.check(pk, listEvent(3, 12))).message, /^Drops your follows from 814 to 12\.$/);
  assert.match((await B.check(pk, listEvent(3, 0))).message, /^Removes all 814 accounts you follow\.$/);
});

test('sites get the growth check and the name; Sidecar\'s own signing path does not ask for growth', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.match(bg, /await BASELINE\.check\(activePubkey, signEvent, \{ growth: true, name \}\)/);
  assert.match(bg, /accts\.length > 1 \? accts\.find\(\(x\) => x\.pubkey === activePubkey\) : null/, 'named only when there is more than one account');
  assert.match(bg, /await BASELINE\.check\(ownerPk, message\.event\);/, 'the owner path must not flag growth: a Lazarus restore grows a list by hundreds');
});

test('both approval cards title a growth finding as another account\'s list, not as erasing data', () => {
  for (const f of ['prompt.js', 'sidepanel.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /type === 'growth'[\s\S]{0,160}tSec\('This may be another account’s list'\)/, f);
  }
});

// ---- translation: the screens build the sentence from the finding's data ----
//
// check()'s message is English for the error paths. The approval screens call
// describe(finding, I18N), so every finding type has to come out through t()/tn() with
// its numbers formatted by the language, and never as the background's English.

const fakeI18n = {
  lang: 'en',
  tSec: (k, p) => '⟦' + k.replace(/\{\{(\w+)\}\}/g, (m, x) => (p && p[x] != null ? p[x] : m)) + '⟧',
  tn: (one, other, n, p) => '⟦' + (n === 1 ? one : other).replace(/\{\{(\w+)\}\}/g, (m, x) => {
    const q = Object.assign({ count: n.toLocaleString('en-US') }, p);
    return q[x] != null ? q[x] : m;
  }) + '⟧',
  fmtNum: (n) => n.toLocaleString('en-US'),
};

test('EVERY FINDING TYPE COMES OUT THROUGH THE TRANSLATION CALLS, NUMBERS FORMATTED', async () => {
  const cases = [];
  await B.record(pk, listEvent(3, 30), 1);
  cases.push([await B.check(pk, listEvent(3, 1096), { growth: true, name: 'Sidecar' }), /^⟦Adds 1,066 follows at once, taking Sidecar’s list from 30 to 1,096\. This may be another account’s follow list\.⟧$/]);
  await B.record(pk, listEvent(3, 1096), 2);
  cases.push([await B.check(pk, listEvent(3, 31)), /^⟦Drops your follows from 1,096 to 31\.⟧$/]);
  cases.push([await B.check(pk, listEvent(3, 0), { name: 'Sidecar' }), /^⟦Removes all 1,096 accounts Sidecar follows\.⟧$/]);
  await B.record(pk, listEvent(10000, 40), 3);
  cases.push([await B.check(pk, listEvent(10000, 0)), /^⟦Clears your mute list of 40 accounts\.⟧$/]);
  cases.push([await B.check(pk, listEvent(10000, 5), { name: 'Sidecar' }), /^⟦Drops Sidecar’s mute list from 40 to 5\.⟧$/]);
  await B.record(pk, profileEvent({ about: 'x', nip05: 'a@b.c' }), 4);
  cases.push([await B.check(pk, profileEvent({})), /^⟦Clears your ⟦bio⟧ and ⟦verified name⟧\.⟧$/]);
  for (const [f, want] of cases) {
    assert.ok(f, 'no finding for ' + want);
    assert.match(B.describe(f, fakeI18n), want);
  }
});

test('a list of one is singular, not "all 1 accounts"', async () => {
  await B.record(pk, listEvent(3, 1), 1);
  assert.equal((await B.check(pk, listEvent(3, 0))).message, 'Removes the 1 account you follow.');
});

test('BOTH APPROVAL SCREENS AND THE RESTORE SCREEN TRANSLATE THE FINDING, NOT THE ENGLISH', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const page of ['prompt.html', 'sidepanel.html']) {
    const html = read(page);
    const i18n = html.indexOf('<script src="i18n.js">');
    const base = html.indexOf('<script src="replaceable-baseline.js">');
    assert.ok(i18n !== -1 && base > i18n, page + ' must load replaceable-baseline.js, after i18n.js');
  }
  assert.match(read('prompt.js'), /body\.textContent = \(self\.SidecarBaseline && self\.SidecarBaseline\.describe\(data\.destructive, I18N\)\)/);
  const panel = read('sidepanel.js');
  assert.match(panel, /className: 'destructive-warn-body', textContent: describeFinding\(data\.destructive\)/);
  assert.match(panel, /textContent: describeFinding\(finding\) \|\|/, 'the Lazarus refusal screen');
  assert.doesNotMatch(panel, /textContent: (data\.destructive|finding)\.message/, 'a screen still shows the background’s English');
  assert.match(read('scripts/i18n-keys-core.js'), /'replaceable-baseline\.js'/, 'the extractor would never list these sentences');
});

// ---- mute list ----

test('clearing a mute list is flagged with mute-specific wording', async () => {
  await B.record(pk, listEvent(10000, 40), 1);
  const w = await B.check(pk, listEvent(10000, 0));
  assert.equal(w.type, 'emptied');
  assert.equal(w.kind, 10000);
  assert.match(w.message, /mute list of 40 accounts/);
});

test('a mute list that was already empty is not flagged', async () => {
  await B.record(pk, listEvent(10000, 0), 1);
  assert.equal(await B.check(pk, listEvent(10000, 0)), null);
});

// ---- profile ----

test('losing a profile field is flagged in plain language', async () => {
  await B.record(pk, profileEvent({ about: 'bio', picture: 'u', nip05: 'a@b' }), 1);
  const w = await B.check(pk, profileEvent({ picture: 'u', nip05: 'a@b' }));
  assert.equal(w.type, 'profile-fields');
  assert.deepEqual(w.lost, ['about']);
  assert.match(w.message, /Clears your bio/);
});

test('losing several fields reads as a list', async () => {
  await B.record(pk, profileEvent({ about: 'b', picture: 'u', lud16: 'a@b' }), 1);
  const w = await B.check(pk, profileEvent({ picture: 'u' }));
  assert.match(w.message, /bio and Lightning address|Lightning address and bio/);
});

test('unknown custom fields disappearing is NOT flagged', async () => {
  await B.record(pk, profileEvent({ about: 'b', myCustomThing: 'x' }), 1);
  assert.equal(await B.check(pk, profileEvent({ about: 'b' })), null);
});

test('adding or keeping profile fields is not flagged', async () => {
  await B.record(pk, profileEvent({ about: 'b' }), 1);
  assert.equal(await B.check(pk, profileEvent({ about: 'b', picture: 'u' })), null);
});

test('an unreadable incoming kind:0 is not flagged as field loss', async () => {
  await B.record(pk, profileEvent({ about: 'b', picture: 'u' }), 1);
  assert.equal(await B.check(pk, { kind: 0, tags: [], content: '<html>' }), null);
});

// ---- baseline bookkeeping ----

test('record overwrites the baseline so the next check compares against it', async () => {
  await B.record(pk, listEvent(3, 800), 1);
  await B.record(pk, listEvent(3, 20), 2); // user really did cut the list
  // 20 is the new normal; going to 18 is now unremarkable.
  assert.equal(await B.check(pk, listEvent(3, 18)), null);
});

test('recordIfNewer will not clobber a fresher baseline', async () => {
  await B.record(pk, listEvent(3, 800), 500);
  await B.recordIfNewer(pk, listEvent(3, 3), 100); // older relay copy arriving late
  const w = await B.check(pk, listEvent(3, 0));
  assert.equal(w.from, 800, 'still comparing against the fresher 800-entry baseline');
});

test('recordIfNewer does update when the event is newer', async () => {
  await B.record(pk, listEvent(3, 800), 100);
  const updated = await B.recordIfNewer(pk, listEvent(3, 900), 500);
  assert.equal(updated, true);
  assert.equal(await B.check(pk, listEvent(3, 880)), null);
});

test('record ignores untracked kinds', async () => {
  assert.equal(await B.record(pk, { kind: 1, tags: [], content: 'note' }, 1), false);
});

test('forget drops only that account’s baselines', async () => {
  await B.record(pk, listEvent(3, 500), 1);
  await B.record(pk2, listEvent(3, 500), 1);
  await B.forget(pk);
  assert.equal(await B.check(pk, listEvent(3, 0)), null);      // gone
  assert.ok(await B.check(pk2, listEvent(3, 0)), 'pk2 kept');  // intact
});

// ---- fail open ----

test('check never throws on malformed input', async () => {
  await B.record(pk, listEvent(3, 100), 1);
  for (const bad of [null, undefined, {}, { kind: 3 }, { kind: 3, tags: 'nope' }, 42, 'x']) {
    assert.equal(await B.check(pk, bad), null, 'returned null for ' + JSON.stringify(bad));
  }
});

test('check returns null when pubkey is missing', async () => {
  await B.record(pk, listEvent(3, 100), 1);
  assert.equal(await B.check(null, listEvent(3, 0)), null);
});
