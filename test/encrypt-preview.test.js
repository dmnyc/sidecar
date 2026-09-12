'use strict';

// Show what an app is asking to encrypt.
//
// From #305: an app storing its settings costs two approvals, one to encrypt the content
// and one to sign the event carrying it, and neither says what is inside. The encrypt
// prompt showed the recipient and nothing else, so "approve" was a decision taken blind,
// which is also the strongest argument in that issue for approving such things
// automatically. Answering it is cheaper than arguing about it: the plaintext is already
// in the prompt's payload, because `params` is handed over whole, and was simply never
// drawn.
//
// Nothing new is exposed by showing it. The page wrote that text and is asking Sidecar to
// seal it; the only party learning anything is the person being asked to approve.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const prompt = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
const promptHtml = fs.readFileSync(path.join(ROOT, 'prompt.html'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// BOTH APPROVAL SURFACES, every time. An approval renders in the popup window AND in the
// panel, and fixing one of them is not fixing it.
const SURFACES = [
  ['prompt.js', prompt],
  ['sidepanel.js', panel],
];

for (const [name, src] of SURFACES) {
  test(name + ' shows the plaintext on an encrypt approval', () => {
    const at = src.indexOf("data.method === 'nip04.encrypt'");
    assert.ok(at !== -1, 'the encrypt branch moved');
    const branch = stripComments(src.slice(at, at + 900));
    assert.match(branch, /params && data\.params\.plaintext/, 'the plaintext is still discarded');
    assert.match(branch, /Sealing/, 'the line has no label');
    // Clamped, because it is page-written text and a long one would push the buttons off
    // the card. The surfaces use their own clamp helper; both take a limit.
    assert.match(branch, /clamp\w*\(plain, 220\)/, 'unbounded page text goes straight onto the card');
    assert.match(branch, /sealed/, 'the line is not marked as about-to-be-encrypted');
  });
}

test('the recipient is still shown, not replaced', () => {
  // Who it is sealed to matters as much as what: an app encrypting to itself and an app
  // encrypting to a stranger are different decisions.
  for (const [name, src] of SURFACES) {
    const at = src.indexOf("data.method === 'nip04.encrypt'");
    const branch = stripComments(src.slice(at, at + 900));
    assert.match(branch, /'To'/, name + ' dropped the recipient row');
  }
});

test('both stylesheets mark the sealed line', () => {
  // prompt.html carries its own copy of the card styles, so a rule added to styles.css
  // alone reaches the panel and not the popup. The color lives on the padlock rather than
  // the words; theme-contrast.test.js is where that split is measured and defended.
  for (const [name, sheet] of [['styles.css', css], ['prompt.html', promptHtml]]) {
    assert.match(sheet, /\.card \.row\.sealed span:last-child::before \{[^}]*content: '\\1F512/, name + ' has no padlock');
    assert.match(sheet, /\.card \.row\.sealed span:last-child::before \{[^}]*color: var\(--success\)/, name + ' has no sealed color');
  }
});

test('nothing had to be added to the worker to make this possible', () => {
  // The payload already carried it. Recorded because the tempting version of this change
  // is a new field plumbed through the background, and that would be a second copy of
  // something already in flight.
  const at = background.indexOf('const decision = await openPrompt({');
  assert.ok(at !== -1, 'the prompt payload construction moved');
  const call = stripComments(background.slice(at, at + 400));
  assert.match(call, /\n\s*params,/, 'params are no longer handed to the prompt whole');
  assert.ok(!call.includes('plaintext'), 'the plaintext is being plumbed separately as well');
});
