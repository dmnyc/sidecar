'use strict';

// Connected sites, per-account themes, the About dialog and dev tools through i18n.
//
// Two of the activity tab's tables are functions now, LEVELS and activityKindName, so
// they are read after the language file has loaded and each label is a literal t() the
// key script can list. A table of bare strings translated at the call site would reach
// the page in English on first paint, and its keys would never reach a translator.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFromJs } = require('../scripts/i18n-keys-core.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const bare = src.replace(/^\s*\/\/.*$/gm, '');
const keys = new Set(extractFromJs(src).map((k) => k.key));

test('the permission tiers and the activity kind names reach the translators', () => {
  for (const k of ['Ask every time', 'Read only', 'Trusted', 'Blocked', 'note', 'reaction', 'relay auth', 'web bookmark']) {
    assert.ok(keys.has(k), k + ' is not a key the script finds');
  }
  assert.match(bare, /const LEVELS = \(\) => \[/);
  assert.ok(!/t\(KIND_NAMES\[/.test(bare) && !/textContent: t\(l\)/.test(bare), 'a key is passed as a variable again');
});

test('sentences around a host or a name are single templates', () => {
  for (const tpl of [
    "t('Signs in as {{name}}'", "t('Switch {{host}} to the active account'", "t('Detach {{host}}'",
    "t('On {{host}}, sign out and sign back in.'", "t('{{name}} removed from {{host}}'",
    "t('{{host}} is signing in as {{bound}}. To use {{active}} instead:'", "t('Signed {{what}}'",
  ]) assert.ok(bare.includes(tpl), tpl + ' is missing');
  assert.match(bare, /tn\('\{\{count\}\} account has signed in here', '\{\{count\}\} accounts have signed in here'/);
  for (const glued of ["'Signs in as ' +", "'Detach ' + host", "'Switch ' + host", "' removed from ' +", "document.createTextNode(host + ' is signing in as ')"]) {
    assert.ok(!bare.includes(glued), glued + ' is glued again');
  }
});
