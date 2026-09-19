'use strict';

// An opt-out from the multi-login safeguard, per host.
//
// The safeguard: once 2+ of your accounts have signed in to one host, every content sign
// there asks who is posting, even on Trusted, because a client's own account switcher
// can change identity without telling Sidecar. It is right by default and it was the fix
// for a version that silently posted as the wrong account.
//
// It is also wrong for a particular user, who asked for this: one client, identity
// switched in Sidecar rather than in the client, and a preference for Sidecar simply
// signing as whatever is active. This file pins the three things that make giving them
// that safe to ship: it is off until turned on, it is scoped to one host, and it
// suppresses the confirm WITHOUT touching anything else the same flag drives.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const bgBare = bg.replace(/^\s*\/\/.*$/gm, '');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

test('OFF UNTIL TURNED ON, AND SCOPED TO ONE HOST', () => {
  // Host-scoped, not account-scoped, and that is not an implementation detail. "Do not
  // ask me which account on this host" is a claim about the host. Per account, A could
  // opt out while B had not, on the one host where the point is that they share it.
  assert.match(bgBare, /const SITE_ALWAYS_ACTIVE_KEY = 'sidecar_site_always_active';/);
  assert.match(bgBare, /async function isAlwaysActiveHost\(host\)/);
  // Absent means off: a plain lookup with no default that could read as enabled.
  const fn = bgBare.slice(bgBare.indexOf('async function isAlwaysActiveHost('));
  assert.match(fn.slice(0, fn.indexOf('\n}')), /\[host\] === true/);
  // Turning it off deletes rather than storing false, so the map cannot grow forever
  // with hosts nobody opted into.
  const setFn = bgBare.slice(bgBare.indexOf('async function setAlwaysActiveHost('));
  assert.match(setFn.slice(0, setFn.indexOf('\n}')), /else delete all\[host\];/);
});

test('IT SUPPRESSES THE CONFIRM AND NOTHING ELSE', () => {
  // The trap, and it was live in the first cut of this: sharedHost drives BOTH the
  // shared-identity confirm and appDataAutoAllow. Clearing sharedHost would make app-data
  // signs start asking, which is more prompts rather than fewer, exactly backwards.
  assert.match(bgBare, /const appDataAutoAllow = appDataExempt && sharedHost;/);
  const block = bgBare.slice(bgBare.indexOf('let sharedHost = false;'), bgBare.indexOf('const appDataAutoAllow'));
  assert.match(block, /sharedIdentity = !alwaysActive;/, 'the opt-out must gate sharedIdentity');
  assert.ok(!/sharedHost = false;/.test(block.slice(block.indexOf('alwaysActive'))),
    'the opt-out must not clear sharedHost, which also drives appDataAutoAllow');
});

test('it takes the same account the confirm would have defaulted to', () => {
  // This is not a different choice, only a skipped question. The swap to the global
  // active account already ran before this setting existed, and still runs either way.
  const block = bgBare.slice(bgBare.indexOf('let sharedHost = false;'), bgBare.indexOf('const appDataAutoAllow'));
  assert.match(block, /const globalActive = await KS\.getActivePubkey\(\);/);
  assert.match(block, /if \(authorized\.includes\(globalActive\) && globalActive !== activePubkey\)/);
  // And a block on the account it swaps to is still honored.
  assert.match(block, /if \(status === 'reject'\) throw new Error\('This site is blocked in Sidecar'\);/);
});

test('forgetting a site forgets the opt-out with it', () => {
  // A host the user erased must not keep a standing instruction to skip the check if
  // they ever go back.
  const one = bgBare.slice(bgBare.indexOf("case 'SIDECAR_REMOVE_HOST'"));
  assert.match(one.slice(0, one.indexOf('break;')), /await clearAlwaysActiveHost\(message\.host\)/);
  const all = bgBare.slice(bgBare.indexOf("case 'SIDECAR_FORGET_ALL_SITES'"));
  assert.match(all.slice(0, all.indexOf('break;')), /\[SITE_ALWAYS_ACTIVE_KEY\]: \{\}/);
});

test('THE UI SAYS WHAT IT COSTS, NOT ONLY WHAT IT SAVES', () => {
  // A setting that removes a safety prompt has to name the consequence in the same
  // breath, or it reads as a convenience toggle.
  const fn = bare.slice(bare.indexOf('async function sharedSiteModal('));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /Always sign as Sidecar/);
  assert.match(body, /Posts may go out from a different account than the client is showing/);
  assert.match(body, /SIDECAR_SET_ALWAYS_ACTIVE/);
  // A failed write must not leave the switch showing a state that was never stored.
  assert.match(body, /toggle\.checked = !on;/);
});

test('the toggle knows its state before the sheet opens', () => {
  // openModal calls its builder synchronously and does not await it, so an async builder
  // would show the card and pop the rest of it in afterwards.
  const fn = bare.slice(bare.indexOf('async function sharedSiteModal('));
  const head = fn.slice(0, fn.indexOf('openModal('));
  assert.match(head, /SIDECAR_GET_ALWAYS_ACTIVE/, 'the state has to be fetched before openModal');
  assert.match(fn, /openModal\(\(modal\) => \{/, 'the builder itself must stay synchronous');
});

test('the row is drawn to the narrow-panel rules', () => {
  const rule = css.slice(css.indexOf('.always-active-row {'));
  assert.match(rule.slice(0, rule.indexOf('}')), /display: flex/);
  const copy = css.slice(css.indexOf('.always-active-copy {'));
  assert.match(copy.slice(0, copy.indexOf('}')), /min-width: 0/);
});
