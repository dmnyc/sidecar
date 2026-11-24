'use strict';

// nspam.js against the model's own reference cases (test/fixtures/nspam, from the model
// repository at the revision scripts/build-nspam-model.py pins): the hashing token by token,
// and fifty real bundles of replies with the scores the trained pipeline gave them. A port that
// drifts from the pipeline anywhere, in a regular expression's idea of a space or in a tree's
// comparison, moves a score here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../nspam.js');
const N = globalThis.SidecarNspam;

const ROOT = path.join(__dirname, '..');
const lines = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'nspam', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const bin = fs.readFileSync(path.join(ROOT, 'models', 'nspam.bin'));
const MODEL = N.load(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));

// Signed counts per bucket, sorted by bucket, as the fixtures list them.
function buckets(grams) {
  const m = new Map();
  for (const g of grams) { const { index, sign } = N.bucket(g); m.set(index, (m.get(index) || 0) + sign); }
  return [...m].filter(([, v]) => v).sort((a, b) => a[0] - b[0]).map(([index, value]) => ({ index, value }));
}

test('every token hashes to the buckets and signs scikit-learn gives it', () => {
  const cases = lines('hash_fixtures.jsonl');
  assert.ok(cases.length >= 10);
  for (const c of cases) {
    // The fixtures list at most 32 buckets, the lowest first.
    const sorted = (a) => a.slice().sort((x, y) => x.index - y.index);
    assert.deepEqual(buckets(N.wordGrams(c.token)).slice(0, 32), sorted(c.word_buckets), 'word n-grams of ' + c.token);
    assert.deepEqual(buckets(N.charGrams(c.token)).slice(0, 32), sorted(c.char_wb_buckets), 'character n-grams of ' + c.token);
  }
});

test('EVERY REFERENCE BUNDLE SCORES WHAT THE TRAINED MODEL GAVE IT', () => {
  const cases = lines('parity_fixtures.jsonl');
  assert.equal(cases.length, 50);
  for (const [i, c] of cases.entries()) {
    const r = N.score(MODEL, c.notes);
    const rel = Math.abs(r.raw - c.expected_raw_score) / Math.max(1e-12, c.expected_raw_score);
    assert.ok(rel < 1e-9, `case ${i + 1}: raw ${r.raw}, the model gave ${c.expected_raw_score}`);
    assert.ok(Math.abs(r.score - c.expected_calibrated_score) < 1e-9, `case ${i + 1}: calibrated ${r.score}, expected ${c.expected_calibrated_score}`);
  }
});

test('the bots in the reference set score as bots, and the people as people', () => {
  // Not a test of the model's quality, which is its authors' to state: a check that the
  // labels and the scores line up the way the fixtures say, so a sign flipped somewhere in
  // the port cannot pass by matching numbers it inverted.
  const cases = lines('parity_fixtures.jsonl');
  const right = cases.filter((c) => (N.score(MODEL, c.notes).score >= 0.5) === (c.label === 1)).length;
  assert.ok(right >= 45, `${right} of 50 on the right side of one half`);
});

test('text is case-folded as Python folds it, not merely lowercased', () => {
  assert.equal(N.casefold('Straße'), 'strasse');
  assert.equal(N.casefold('ΣΟΦΟΣ'), 'σοφοσ', 'a final sigma folds to σ, not ς');
  assert.equal(N.casefold('ſ'), 's');
  assert.equal(N.casefold('GM'), 'gm');
});

test('the bundled model is the one VENDOR.md records, byte for byte', () => {
  const sha = require('node:crypto').createHash('sha256').update(bin).digest('hex');
  assert.equal(sha, '67e3f69c5bcde9e5ec14d68382665aa3f5d72b6deed8d9235dd2d110e7b642c8',
    'models/nspam.bin changed: rebuild it with scripts/build-nspam-model.py and update VENDOR.md');
  assert.match(fs.readFileSync(path.join(ROOT, 'VENDOR.md'), 'utf8'), new RegExp(sha));
});

test('the model file is checked before it is trusted', () => {
  assert.throws(() => N.load(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]).buffer), /not an nspam model/);
  const extra = new Uint8Array(bin.length + 1);
  extra.set(bin);
  assert.throws(() => N.load(extra.buffer), /trailing bytes/);
  assert.equal(MODEL.trees.length, 500);
});

test('ONLY A REPLY, MOSTLY IN LATIN SCRIPT, IS SCORED: THE MODEL KNOWS LITTLE ELSE', () => {
  const reply = (content, extra = {}) => ({ kind: 1, content, tags: [['e', 'a'.repeat(64)], ['p', 'b'.repeat(64)]], ...extra });
  assert.equal(N.scorable(reply('Great point, thanks for sharing')), true);
  assert.equal(N.scorable(reply('Crème brûlée à la française')), true, 'accented Latin is Latin');
  assert.equal(N.scorable(reply('ボトル：0通が漂流中')), false, 'Japanese is not what it was trained on');
  assert.equal(N.scorable(reply('Привет, как дела?')), false);
  assert.equal(N.scorable(reply('🔥🔥🔥')), false, 'nothing to read');
  // The words decide, not the links in them: an Urdu reply with a long Latin URL is Urdu.
  assert.equal(N.scorable(reply('مکمل ویڈیو اس لنک پر دیکھیں 👇\nhttps://www.google.com/share.google?q=1Uk3ErPbVsYk4W5yg')), false, 'a link does not make Urdu Latin');
  assert.equal(N.scorable(reply('Привет nostr:npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')), false, 'nor does a mention');
  assert.equal(N.scorable(reply('Look at this https://example.com/a')), true);
  assert.equal(N.scorable(reply('https://media.tenor.com/abc/homer.gif')), true, 'a reply that is only a link is read whole, as before');
  assert.equal(N.scorable(reply('hello', { kind: 7 })), false, 'a reaction is not a reply');
  assert.equal(N.scorable({ kind: 1, content: 'hello there', tags: [['p', 'b'.repeat(64)]] }), false, 'a mention without an e tag is not a reply');
  assert.equal(N.score(MODEL, []), null);
});

test('a bundle is the newest ten at most, as the model was trained', () => {
  const notes = Array.from({ length: 14 }, (_, i) => ({ content: 'reply ' + i, tags: [['e', 'x']], created_at: 1700000000 + i }));
  assert.deepEqual(N.score(MODEL, notes), N.score(MODEL, notes.slice(0, 10)));
});

// ---- the bell's use of it (sidepanel.js) ----------------------------------------------------

// judgeStrangers, lifted out of the panel and run with the real model.
function judge(model) {
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const src = panel.match(/\n {2}function judgeStrangers\(events\) \{[\s\S]*?\n {2}\}\n/);
  assert.ok(src, 'judgeStrangers not found in sidepanel.js');
  // And the link test it asks before lifting (const NSPAM_URL … carriesLink).
  const link = panel.match(/\n {2}const NSPAM_URL = [\s\S]*?\n {2}\};\n/);
  assert.ok(link, 'carriesLink not found in sidepanel.js');
  const vm = require('node:vm');
  const ctx = { self: { SidecarNspam: N }, _nspamModel: model, NSPAM_LIFT: 0.05, Map, Set };
  vm.runInNewContext(link[0] + src[0] + '\nthis.judgeStrangers = judgeStrangers;', ctx);
  return ctx.judgeStrangers;
}
// The reference bundles as bell events: kind 1, from one author each.
const asEvents = (c) => c.notes.map((n) => ({ ...n, kind: 1, pubkey: c.pubkey }));

test('THE BELL LIFTS A PERSON OUT OF THE STRANGERS AND LEAVES A BOT THERE, MARKED', () => {
  const judgeStrangers = judge(MODEL);
  const cases = lines('parity_fixtures.jsonl');
  // The people's replies are lifted; the bots' are scored high and stay. A Japanese bundle (a
  // bot in the reference set) is not the model's to judge, so it is neither lifted nor scored.
  const person = cases.find((c) => c.label === 0 && c.notes.length >= 3);
  const bot = cases.find((c) => c.label === 1 && c.notes.length >= 3 && c.notes.every((n) => N.scorable({ ...n, kind: 1 })));
  const events = [...asEvents(person), ...asEvents(bot)];
  const { scores, lift } = judgeStrangers(events);
  // Their plain replies; one of the three is a bare link to a page, which is never lifted.
  for (const ev of asEvents(person)) assert.equal(lift.has(ev.id), !/https?:/.test(ev.content), 'a person\'s plain reply stayed among the strangers, or a link was lifted');
  for (const ev of asEvents(bot)) {
    assert.equal(lift.has(ev.id), false, 'a bot was lifted into the list');
    assert.ok(scores.get(ev.id) >= 0.9, 'a bot was not scored as one: ' + scores.get(ev.id));
  }
  // A zap or a reaction from a stranger is left where the trust set put it.
  const reaction = { id: 'r'.repeat(64), kind: 7, pubkey: person.pubkey, content: '+', tags: [['e', 'x']], created_at: 1 };
  assert.equal(judgeStrangers([reaction]).scores.size, 0);
});

test('A LINK IS NEVER LIFTED, HOWEVER SURE THE MODEL IS', () => {
  // A real spam reply the model scored 0: one short line pushing a domain. Lifted, it sat at the
  // top of the bell. It is scored, so it is not marked spam either; it stays with the strangers.
  const judgeStrangers = judge(MODEL);
  const person = lines('parity_fixtures.jsonl').find((c) => c.label === 0 && c.notes.length >= 3);
  const bait = { id: 'b'.repeat(64), kind: 1, pubkey: person.pubkey, content: '👀 LOok At tHis: one.example.cc', tags: [['e', 'x'], ['p', 'y']], created_at: 1 };
  const url = { ...bait, id: 'c'.repeat(64), content: 'free sats https://example.com/claim' };
  const { scores, lift } = judgeStrangers([...asEvents(person), bait, url]);
  assert.ok(scores.get(bait.id) <= 0.05, 'the model no longer clears it; pick another bait: ' + scores.get(bait.id));
  assert.equal(lift.has(bait.id), false);
  assert.equal(lift.has(url.id), false);
  for (const ev of asEvents(person)) assert.equal(lift.has(ev.id), !/https?:/.test(ev.content), 'the person\'s plain replies are still lifted');
  // A picture or a GIF is not bait: people answer with them, and they are lifted as words are.
  const gif = { ...bait, id: 'd'.repeat(64), content: 'https://media.tenor.com/abc/homer.gif' };
  assert.ok(judgeStrangers([...asEvents(person), gif]).lift.has(gif.id), 'a GIF reply was held back as a link');
});

test('with no model loaded the bell sorts as it always did', () => {
  const judgeStrangers = judge(null);
  const c = lines('parity_fixtures.jsonl')[0];
  const r = judgeStrangers(asEvents(c));
  assert.equal(r.scores.size, 0);
  assert.equal(r.lift.size, 0);
});
