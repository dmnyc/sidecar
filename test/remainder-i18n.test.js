'use strict';

// The last of the panel's interface text through i18n: the page-comment sheet, offers,
// mention suggestions, polls, the account overview and bookmarks. What used to be glued
// around a number, a client or a list is one template, and the two buttons labeled
// before the language file loads are labeled again once it has.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bare = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

test('a poll\'s winning share is one phrase, and an empty tally is whole sentences', () => {
  assert.match(bare, /t\('\{\{top\}\} of \{\{voters\}\}', \{ top: I18N\.fmtNum\(top\), voters: I18N\.fmtNum\(voters\) \}\)/);
  assert.ok(!/share: top \+ ' of ' \+ voters/.test(bare));
  assert.ok(!/' Clients without poll support show nothing to vote on\.'/.test(bare), 'the empty tally is glued again');
});

test('labels set before the language file loads are set again after it', () => {
  assert.match(bare, /labelAddButtons\(\);\s*I18N\.ready\.catch\(\(\) => \{\}\)\.then\(labelAddButtons\);/);
});

test('names and lists go in as parameters', () => {
  for (const tpl of [
    "t('Open in {{client}}', { client: client.label })",
    "t('View your comment on {{client}} \\u2192', { client: 'Jumble' })",
    "t('Also muted: {{list}}. Only people are counted here.', { list: extras.join(', ') })",
  ]) assert.ok(bare.includes(tpl), tpl + ' is missing');
  // The post banner's "Open in" is translated with connected sites, in its own change.
  assert.ok(!/'Also muted: ' \+/.test(bare) && !/openOut\.textContent = 'Open in ' \+/.test(bare));
});
