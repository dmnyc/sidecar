'use strict';

// The accounts area through i18n: the switcher, the welcome card, importing a key, the
// npub QR, rename and remove, and the auto-lock notice. Each sentence that used to be
// glued around a name or a number is one template now.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

test('the switcher confirms a switch in one sentence, with the name as a parameter', () => {
  assert.match(panel, /t\('Switch to \{\{name\}\}\?', \{ name: displayName\(a\) \}\)/);
  assert.ok(!/'Switch to ' \+ displayName/.test(panel));
  assert.match(panel, /t\('Switch account: \{\{name\}\}', \{ name: displayName\(active\) \}\)/);
});

test('removing an account names it inside the warning, marked for security review', () => {
  assert.match(panel, /tSec\('Removing \{\{name\}\} deletes its encrypted key from this device\./);
  assert.ok(!/'Removing ' \+/.test(panel));
});

test('the auto-lock notice is one sentence with its warning set inside it', () => {
  const at = panel.indexOf('function autoLockNoticeModal(minutes)');
  const body = panel.slice(at, panel.indexOf('\n  }\n', at));
  assert.match(body, /I18N\.fill\(tn\(/);
  assert.match(body, /\{\{count\}\} minute of inactivity/);
  assert.match(body, /\{\{count\}\} minutes of inactivity/);
  assert.ok(!/createTextNode\('Sidecar now locks/.test(body), 'the notice is glued from fragments again');
});

test('importing a key goes through t() and tSec(), from the label to its errors', () => {
  for (const s of ["tSec('Private key')", "t('Import account')", "tSec('Decryption password')",
    "tSec('Enter an nsec, ncryptsec, or hex private key.')", "tSec('Incorrect password, or not a valid ncryptsec key.')"]) {
    assert.ok(panel.includes(s), s + ' is missing');
  }
});
