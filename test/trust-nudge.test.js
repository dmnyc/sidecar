'use strict';

// Unit coverage for the "you keep approving this" tally in background.js.
//
// Why it exists: the approval prompt offers Allow once / Trust this site / Reject,
// plus timed auto-sign chips. Only Trust ends the asking, and nothing on the screen
// says so — "Allow once" is the one that reads like the default answer, so a user on
// a single account with a single app can approve the same site indefinitely without
// ever noticing there was a way out. After a few one-time approvals the prompt adds a
// line pointing at Trust.
//
// Stored in chrome.storage.session, which is the whole reason these tests exist. The
// first cut used a plain Map and NEVER FIRED: the MV3 service worker is evicted after
// ~30s idle, and the gap between two approvals is however long the user takes, so the
// tally reset between almost every pair. Session storage survives eviction and clears
// on browser restart — exactly the retention wanted.
//
// The chrome mock below is deliberately backed by a plain object that persists across
// calls within a test but is rebuilt per test, standing in for that lifetime.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in background.js');
  return m[0];
}

const HOST_A = 'jumble.social';
const HOST_B = 'coracle.social';
const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

function harness() {
  // structuredClone on get/set, mirroring what real chrome.storage does — without it a
  // mock hands every caller the same live object and a read-modify-write looks
  // idempotent whether or not the code actually writes back.
  const store = {};
  const chrome = {
    storage: {
      session: {
        get: (keys, cb) => {
          const k = typeof keys === 'string' ? [keys] : keys;
          const out = {};
          for (const key of k) if (key in store) out[key] = structuredClone(store[key]);
          cb(out);
        },
        set: (obj, cb) => {
          for (const [key, val] of Object.entries(obj)) store[key] = structuredClone(val);
          if (cb) cb();
        },
      },
    },
  };
  const ctx = { console, chrome, structuredClone };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/const APPROVE_NUDGE_AFTER = \d+;/, 'APPROVE_NUDGE_AFTER') + '\n' +
    lift(/const APPROVE_COUNT_KEY = '[^']+';/, 'APPROVE_COUNT_KEY') + '\n' +
    lift(/function sgetSession\(keys\) \{[\s\S]*?\n\}/, 'sgetSession') + '\n' +
    lift(/function ssetSession\(obj\) \{[\s\S]*?\n\}/, 'ssetSession') + '\n' +
    lift(/function approveCountKey\(host, pubkey\) \{[^}]*\}/, 'approveCountKey') + '\n' +
    lift(/async function approveCountMap\(\) \{[\s\S]*?\n\}/, 'approveCountMap') + '\n' +
    lift(/async function bumpApproveCount\(host, pubkey\) \{[\s\S]*?\n\}/, 'bumpApproveCount') + '\n' +
    lift(/async function shouldNudgeTrust\(host, pubkey\) \{[\s\S]*?\n\}/, 'shouldNudgeTrust') + '\n' +
    lift(/async function clearApproveCount\(host, pubkey\) \{[\s\S]*?\n\}/, 'clearApproveCount') + '\n' +
    'globalThis.bump = bumpApproveCount;' +
    'globalThis.should = shouldNudgeTrust;' +
    'globalThis.clear = clearApproveCount;' +
    'globalThis.AFTER = APPROVE_NUDGE_AFTER;',
    ctx
  );
  ctx.__store = store;
  return ctx;
}

// ---- the threshold -------------------------------------------------------------

test('the nudge stays quiet until the threshold', async () => {
  const c = harness();
  for (let i = 1; i < c.AFTER; i++) {
    await c.bump(HOST_A, PK_A);
    assert.equal(await c.should(HOST_A, PK_A), false, 'fired early at ' + i);
  }
  await c.bump(HOST_A, PK_A);
  assert.equal(await c.should(HOST_A, PK_A), true, 'should fire at ' + c.AFTER);
});

test('it keeps firing once the threshold is passed', async () => {
  // Someone who ignores it and keeps clicking Allow once should keep seeing it —
  // the advice doesn't stop being true.
  const c = harness();
  for (let i = 0; i < c.AFTER + 5; i++) await c.bump(HOST_A, PK_A);
  assert.equal(await c.should(HOST_A, PK_A), true);
});

test('a site never approved gets no nudge', async () => {
  const c = harness();
  assert.equal(await c.should(HOST_A, PK_A), false);
});

test('the threshold is high enough not to nag, low enough to help', async () => {
  const c = harness();
  assert.ok(c.AFTER >= 3, 'firing on the first or second approval would be nagging');
  assert.ok(c.AFTER <= 5, 'past this it arrives long after the annoyance set in');
});

// ---- scoping -------------------------------------------------------------------

test('the tally is per host', async () => {
  const c = harness();
  for (let i = 0; i < c.AFTER; i++) await c.bump(HOST_A, PK_A);
  assert.equal(await c.should(HOST_A, PK_A), true);
  assert.equal(await c.should(HOST_B, PK_A), false, 'a different site starts fresh');
});

test('the tally is per account', async () => {
  // Permissions are per-account, so the advice has to be too: trusting a site for one
  // account grants nothing to another, and suggesting it there would be wrong.
  const c = harness();
  for (let i = 0; i < c.AFTER; i++) await c.bump(HOST_A, PK_A);
  assert.equal(await c.should(HOST_A, PK_B), false);
});

test('approvals on two hosts do not add up', async () => {
  const c = harness();
  for (let i = 0; i < c.AFTER - 1; i++) await c.bump(HOST_A, PK_A);
  for (let i = 0; i < c.AFTER - 1; i++) await c.bump(HOST_B, PK_A);
  assert.equal(await c.should(HOST_A, PK_A), false);
  assert.equal(await c.should(HOST_B, PK_A), false);
});

test('the key cannot collide across the host/pubkey boundary', async () => {
  const c = harness();
  for (let i = 0; i < c.AFTER; i++) await c.bump(HOST_A, PK_A);
  // A naive concatenation would let host+pubkey pairs impersonate each other.
  assert.equal(await c.should(HOST_A + PK_A, ''), false);
});

// ---- clearing ------------------------------------------------------------------

test('taking the advice clears the tally', async () => {
  // Trusting settles the question; if trust is later revoked, the count should start
  // over rather than nudging again immediately.
  const c = harness();
  for (let i = 0; i < c.AFTER; i++) await c.bump(HOST_A, PK_A);
  await c.clear(HOST_A, PK_A);
  assert.equal(await c.should(HOST_A, PK_A), false);
});

test('clearing one pair leaves the others alone', async () => {
  const c = harness();
  for (let i = 0; i < c.AFTER; i++) { await c.bump(HOST_A, PK_A); await c.bump(HOST_B, PK_A); }
  await c.clear(HOST_A, PK_A);
  assert.equal(await c.should(HOST_A, PK_A), false);
  assert.equal(await c.should(HOST_B, PK_A), true);
});

// ---- wiring --------------------------------------------------------------------

test('only a one-time approval is counted', async () => {
  // 'relax' and 'trust' ARE the user acting on the advice — counting them would mean
  // nudging someone who already listened.
  assert.match(source, /if \(decision\.action === 'once'\) await bumpApproveCount\(/,
    "the tally must be bumped only on the 'once' branch");
  assert.ok(!/if \(decision\.action === 'relax'\)[\s\S]{0,200}bumpApproveCount/.test(source),
    "'relax' must not count toward the nudge");
});

test('trusting and blocking both clear the tally', async () => {
  for (const action of ['trust', 'block']) {
    const re = new RegExp("decision\\.action === '" + action + "'\\)[\\s\\S]{0,220}clearApproveCount\\(");
    assert.match(source, re, action + ' should clear the tally');
  }
});

test('the nudge is suppressed while a destructive warning is showing', async () => {
  // That screen is asking for full attention on what is about to be lost. "Trust this
  // site to stop asking" is the last advice it should be carrying.
  assert.match(source, /nudgeTrust: !destructive && \(await shouldNudgeTrust\(/);
});

// ---- both approval UIs -----------------------------------------------------------
//
// Sidecar renders approvals in TWO places: prompt.html (a popup window, shown when the
// side panel is closed) and the in-panel view in sidepanel.js. Separate DOM, separate
// code. The first cut of this work only touched the popup, so the same request showed
// the relax chips in one and not the other, and the nudge in one and not the other.
// These pin both.

test('both approval UIs honor relaxEligible', () => {
  const promptSrc = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
  const panelSrc = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  for (const [name, src] of [['prompt.js', promptSrc], ['sidepanel.js', panelSrc]]) {
    assert.match(src, /data\.relaxEligible !== false/,
      name + ' must gate the relax offer on relaxEligible');
  }
});

test('both approval UIs render the trust nudge', () => {
  const promptSrc = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
  const panelSrc = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  for (const [name, src] of [['prompt.js', promptSrc], ['sidepanel.js', panelSrc]]) {
    assert.match(src, /data\.nudgeTrust/, name + ' must render the nudge');
    assert.match(src, /Approving this often\? Trust /, name + ' must carry the copy');
  }
});

test('both approval UIs have a nudge container, and a rule to style it', () => {
  const promptHtml = fs.readFileSync(path.join(ROOT, 'prompt.html'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(promptHtml, /id="trust-nudge"/);
  assert.match(panelHtml, /id="approval-trust-nudge"/);
  // prompt.html carries its own <style>; the panel uses styles.css.
  assert.match(promptHtml, /\.trust-nudge \{/, 'prompt.html needs the rule inline');
  assert.match(css, /\.trust-nudge \{/, 'styles.css needs the rule for the panel');
});

test('the popup applies the panel theme', () => {
  // prompt.html links all five theme stylesheets, which key off [data-theme]. Nothing
  // set that attribute, so the popup always rendered Speakeasy purple over whatever
  // theme the panel was wearing.
  const promptSrc = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
  assert.match(promptSrc, /setAttribute\(\s*'data-theme'/, 'popup must set data-theme');
  assert.match(source, /theme: promptSettings\.theme \|\| 'speakeasy'/,
    'the payload must carry the theme');
  // Unknown values fall back rather than writing an arbitrary string into the DOM.
  assert.match(promptSrc, /THEMES\.includes\(data\.theme\) \? data\.theme : 'speakeasy'/);
});

test('the popup theme allowlist matches the panel', () => {
  const promptSrc = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
  const panelSrc = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const grab = (src, re) => {
    const m = src.match(re);
    assert.ok(m, 'could not find the theme list');
    return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).sort();
  };
  const promptThemes = grab(promptSrc, /const THEMES = \[([^\]]+)\]/);
  const panelThemes = grab(panelSrc, /const validThemes = \[([^\]]+)\]/);
  assert.deepEqual(promptThemes, panelThemes,
    'a theme added to the panel but not the popup renders as Speakeasy there');
});

// ---- "Never" does not mean "never asks for a PIN" --------------------------------
//
// autoLockMinutes: 0 disables the IDLE TIMER only. The unlocked state is a derived key
// in chrome.storage.session — memory-only, and cleared when the browser closes — so
// there is still one PIN per browser session. Persisting the key to disk would defeat
// encrypting it at rest, so this is a floor, not a bug. But "Never" reads as an
// absolute promise, and being asked anyway looks like the setting failed.
//
// THREE surfaces can ask for that PIN. Same enumerate-the-surfaces lesson as the relax
// gate: the popup, the in-panel approval, and the panel's own lock screen.

test('the auto-lock setting explains the once-per-session PIN', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const block = html.match(/<h3>Auto-lock<\/h3>[\s\S]*?<\/div>/);
  assert.ok(block, 'could not find the auto-lock setting');
  assert.match(block[0], /once per browser session/,
    'Never needs a hint, or it reads as an absolute promise');
});

test('all three unlock surfaces explain a fresh-browser lock', () => {
  const promptSrc = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
  const panelSrc = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  // 1 + 2: the popup and the in-panel approval, both driven by the payload flag.
  assert.match(promptSrc, /data\.autoLockNever/, 'popup must react to the flag');
  assert.match(panelSrc, /data\.autoLockNever/, 'in-panel approval must react to it');
  for (const [name, src] of [['prompt.js', promptSrc], ['sidepanel.js', panelSrc]]) {
    assert.match(src, /first unlock since your browser started/, name + ' copy');
  }
  // 3: the panel's own lock screen, which reads the setting directly.
  assert.match(panelSrc, /Locked since your browser closed/, 'lock screen copy');
});

test('the in-panel unlock label resets when auto-lock is NOT Never', () => {
  // The label is a persistent DOM node reused across approvals, so setting it on the
  // Never path without an else would leave the wrong text behind after the user
  // switches to a timed lock.
  const panelSrc = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  assert.match(panelSrc, /: 'Enter your PIN to unlock';/,
    'the non-Never branch must restore the default label');
});

test('the payload derives autoLockNever through resolveSettings', () => {
  // Not `settings.autoLockMinutes === 0` on the raw object: unset must mean the
  // 15-minute default, not Never. resolveSettings applies that default.
  assert.match(source, /autoLockNever: resolveSettings\(promptSettings\)\.autoLockMinutes === 0/);
});

test('the prompt builds the nudge without innerHTML', async () => {
  // The host is attacker-controlled and the string is assembled from it.
  const promptSrc = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
  const block = promptSrc.match(/if \(data\.nudgeTrust[\s\S]*?\n    \}/);
  assert.ok(block, 'could not find the nudge block in prompt.js');
  assert.ok(!/innerHTML/.test(block[0]), 'the nudge must not use innerHTML');
  assert.match(block[0], /textContent/);
});
