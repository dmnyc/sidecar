'use strict';

// The wallet's payment details link to the note a zap landed on, so the note can be
// opened — in the client this account chose, like the post receipt's link — and
// replied to there.
//
// Source assertions, like test/sent-zap-label.test.js: txRow builds DOM inside the
// panel's closure and there is no DOM in node. What is pinned here is the wiring —
// where the note id comes from on each side, and that the link goes through the
// account's client rather than a hard-coded one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function fnSource(name) {
  const start = panel.indexOf('  function ' + name + '(');
  assert.notEqual(start, -1, name + ' not found');
  let depth = 0;
  for (let i = panel.indexOf('{', start); i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(start, i + 1);
  }
  throw new Error(name + ' braces never balanced');
}

test('the note id is read off the event first, the recorded request second, outgoing-only', () => {
  // An incoming zap carries the 9734 with its e tag; a sent zap's invoice is a
  // description_hash with nothing to parse, so the id comes from the request Sidecar
  // signed. payMeta is keyed by an invoice WE paid, so its half must stay outgoing-only
  // or a received payment could link to whatever we last paid at that invoice.
  assert.match(
    panel,
    /const zapNoteId = \(zap && zap\.eventId\) \|\| \(!incoming && meta\.zapEvent\) \|\| '';/
  );
});

test('the details pane offers the row only when the zap names a note', () => {
  const row = fnSource('zapNoteRow');
  assert.match(panel, /txDetailRow\(t\('Note'\), note, null, true\),\s*\n\s*zapNoteId \? zapNoteRow\(zapNoteId\) : null,/);
  // A profile zap (no e tag) and a plain payment both leave zapNoteId empty — the row
  // is absent, not rendered empty.
  assert.match(row, /function zapNoteRow\(id\) \{/);
});

test('the link opens the note in the client this account chose', () => {
  // Sidecar is a companion, not a client: the link must go through preferredClient —
  // the account's own choice — the same resolveClient the post receipt uses, never a
  // hard-coded web client.
  const row = fnSource('zapNoteRow');
  assert.match(row, /NT\.nip19\.neventEncode\(\{ id, relays: \[\] \}\)/, 'the note as an nevent');
  assert.match(row, /preferredClient\(\)/, 'the account\'s client');
  assert.match(row, /openInClient\(client\.url\(nevent\)\)/, 'opened through it');
});

test('the click does not collapse the pane it lives in', () => {
  // The details head toggles open/closed on any click that reaches it; a link click
  // must stop at the link or the pane swallows the very tap meant to open the note.
  const row = fnSource('zapNoteRow');
  assert.match(row, /e\.stopPropagation\(\);/);
});

test('every string the row shows goes through t()', () => {
  const row = fnSource('zapNoteRow');
  assert.match(row, /t\('Zapped note'\)/);
  assert.match(row, /t\('Open the note'\)/);
  // The client's name arrives after the row is drawn; the upgrade is a template of
  // its own, so no locale can glue fragments around a client's name.
  assert.match(row, /t\('Open the note in \{\{client\}\}', \{ client: c\.label \}\)/);
});
