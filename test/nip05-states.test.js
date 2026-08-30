'use strict';

// NIP-05 verification has six outcomes, not two (#179).
//
// verifyNip05 returned a bare boolean, so the badge read "Couldn't verify" for all of
// them — and got the severity backwards in BOTH directions at once. Someone offline saw
// an alarming badge on a perfectly good NIP-05. Someone whose handle had come to resolve
// to a different key saw the same mild warning, and no reason to act, when that is the
// one state here worth interrupting a person over.
//
// The distinction the whole fix rests on is verdict versus ignorance:
//   ok / mismatch / absent        — the domain answered; this IS the answer
//   http / malformed / unreachable — we never got one; says nothing about the person
//
// `known` carries that, and the badge colors follow it rather than following ok/!ok.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function lift(pattern, label) {
  const m = panel.match(pattern);
  if (!m) throw new Error('Could not find ' + label);
  return m[0];
}

const ME = 'a'.repeat(64);
const SOMEONE_ELSE = 'b'.repeat(64);

// `responder` stands in for the domain.
function harness(responder) {
  const ctx = {
    fetch: responder,
    AbortSignal: { timeout: () => ({}) },
    Map, Date, Object, Error, JSON, Promise, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(
    '(function () {\n' +
      lift(/  const NIP05_TIMEOUT = \d+;[\s\S]*?\n  async function checkNip05\(nip05, pubkey\) \{[\s\S]*?\n  \}/, 'checkNip05') +
      '\n' +
      lift(/  async function verifyNip05\(nip05, pubkey\) \{[\s\S]*?\n  \}/, 'verifyNip05') +
      '\nthis.check = checkNip05; this.verify = verifyNip05; this.cache = _nip05Cache;\n}).call(this)',
    ctx
  );
  return ctx;
}
const serves = (body, ok = true, status = 200) => async () => ({
  ok, status, json: async () => body,
});

test('a matching record verifies', async () => {
  const c = harness(serves({ names: { alice: ME } }));
  const r = await c.check('alice@example.com', ME);
  assert.equal(r.status, 'ok');
  assert.equal(r.ok, true);
  assert.equal(r.known, true);
});

test('THE POINTING-ELSEWHERE CASE IS ITS OWN VERDICT', async () => {
  // The one the old badge buried. The domain answered, it knows this name, and it says
  // someone else. That is a finding about the identifier, not a failure to check it.
  const c = harness(serves({ names: { alice: SOMEONE_ELSE } }));
  const r = await c.check('alice@example.com', ME);
  assert.equal(r.status, 'mismatch');
  assert.equal(r.known, true, 'we KNOW this — it must not be lumped with "could not check"');
  assert.equal(r.found, SOMEONE_ELSE);
});

test('a name the domain does not list is also a verdict', async () => {
  const c = harness(serves({ names: { bob: SOMEONE_ELSE } }));
  const r = await c.check('alice@example.com', ME);
  assert.equal(r.status, 'absent');
  assert.equal(r.known, true);
});

test('NOT REACHING THE DOMAIN IS NOT A VERDICT', async () => {
  // Offline, DNS, TLS, timeout. The old code returned false here, which put an alarming
  // badge on a NIP-05 that may be perfectly fine.
  const c = harness(async () => { throw new TypeError('Failed to fetch'); });
  const r = await c.check('alice@example.com', ME);
  assert.equal(r.status, 'unreachable');
  assert.equal(r.known, false, 'this says nothing about the person and must not look like it does');
});

test('a host that answers badly is separated from one that answers wrongly', async () => {
  const notFound = await harness(serves({}, false, 404)).check('alice@example.com', ME);
  assert.equal(notFound.status, 'http');
  assert.equal(notFound.known, false);
  assert.equal(notFound.code, 404);

  const badJson = await harness(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }))
    .check('alice@example.com', ME);
  assert.equal(badJson.status, 'malformed');
  assert.equal(badJson.known, false);

  const noNames = await harness(serves({ nope: 1 })).check('alice@example.com', ME);
  assert.equal(noNames.status, 'malformed');
});

test('the local part is matched case-insensitively, the key exactly', async () => {
  const c = harness(serves({ names: { Alice: ME } }));
  assert.equal((await c.check('alice@example.com', ME)).status, 'ok', 'name lookup is case-insensitive');
  // But the pubkey compare stays exact — a case-folded key comparison would be a way to
  // pass verification with a key that is not yours.
  const d = harness(serves({ names: { alice: ME.toUpperCase() } }));
  assert.equal((await d.check('alice@example.com', ME)).status, 'mismatch');
});

test('a bare domain verifies as the "_" name', async () => {
  const c = harness(serves({ names: { _: ME } }));
  assert.equal((await c.check('example.com', ME)).status, 'ok');
});

test('it is cached, and a failure to reach expires much sooner', async () => {
  // The overview drawer is expanded by default, so every render used to fire a request at
  // a third-party domain — telling that host when the user is active, and how often.
  let calls = 0;
  const c = harness(async () => { calls++; return { ok: true, status: 200, json: async () => ({ names: { alice: ME } }) }; });
  await c.verify('alice@example.com', ME);
  await c.verify('alice@example.com', ME);
  await c.verify('alice@example.com', ME);
  assert.equal(calls, 1, 'three renders, one request');

  const TTL = Number(panel.match(/const NIP05_TTL = ([^;]+);/)[1].replace(/[^0-9*]/g, '').split('*').reduce((a, b) => a * b));
  const UNKNOWN = Number(panel.match(/const NIP05_TTL_UNKNOWN = ([^;]+);/)[1].replace(/[^0-9*]/g, '').split('*').reduce((a, b) => a * b));
  assert.ok(UNKNOWN < TTL, 'someone on a train must not carry a stale "unreachable" for the full TTL');
});

test('a timeout is set — the badge cannot hang forever', () => {
  const fn = lift(/  async function checkNip05\(nip05, pubkey\) \{[\s\S]*?\n  \}/, 'checkNip05');
  assert.match(fn, /AbortSignal\.timeout\(NIP05_TIMEOUT\)/);
});

// ---- how it reaches the badge ----------------------------------------------------

test('severity follows certainty, not just failure', () => {
  const map = panel.match(/const NIP05_BADGE = \{[\s\S]*?\n  \};/)[0];
  // The verdict against you is the loud one.
  assert.match(map, /mismatch:\s*\{\s*cls: 'nip05-alarm',\s*glyph: 'alert'/);
  // Not reaching the host is neutral AND a different shape, so it cannot be misread as a
  // finding about the identifier.
  for (const s of ['http', 'malformed', 'unreachable']) {
    assert.ok(new RegExp(s + ":\\s*\\{\\s*cls: 'nip05-unknown',\\s*glyph: 'help'").test(map), s + ' must be neutral');
  }
  assert.match(map, /\bok:\s*\{\s*cls: 'nip05-ok',\s*glyph: 'check'/);
});

test('the three severities are visually distinct, and themeable', () => {
  assert.match(css, /\.nip05-badge\.nip05-alarm \{ color: var\(--red\); \}/);
  assert.match(css, /\.nip05-badge\.nip05-unknown \{ color: var\(--muted\); \}/);
  assert.match(css, /\.nip05-badge\.nip05-ok \{ color: var\(--success\); \}/);
});

test('no caller decides the badge for itself any more', () => {
  // Both surfaces — the overview drawer and the Profile tab — rendered their own
  // ok/!ok badge. Two places to get the new severity wrong is one too many.
  assert.doesNotMatch(panel, /nip05-ok' : 'nip05-bad'/);
  assert.equal((panel.match(/paintNip05Badge\(/g) || []).length, 3, 'one definition, two callers');
});
