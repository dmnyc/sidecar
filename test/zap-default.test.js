'use strict';

// A zap amount you set once.
//
// The zap forms offered 21 / 100 / 1,000 / 5,000, and the fourth was somebody's guess.
// It is now yours: set in Settings, saved, and drawn in that slot wherever a zap is sent.
//
// Two things this file is really protecting. The row is built ONCE and shared by the
// profile sheet and the notification row — they were two hand-rolled copies of the same
// four buttons, which is how one of them ends up a release behind the other. And the
// number is clamped on the way OUT as well as in, so a value that reached storage by any
// other route still cannot put an absurd amount in front of a Send button.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  let paren = 0;
  let i = source.indexOf('(', at);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// The constants come from the source too, so a changed ceiling changes the test with it.
function consts() {
  const ctx = { console };
  vm.createContext(ctx);
  const grab = (name) => source.match(new RegExp('const ' + name + ' = ([^;]+);'))[1];
  vm.runInContext(
    'const ZAP_PRESETS_FIXED = ' + grab('ZAP_PRESETS_FIXED') + ';' +
    'const ZAP_DEFAULT_SATS = ' + grab('ZAP_DEFAULT_SATS') + ';' +
    'const ZAP_DEFAULT_MAX = ' + grab('ZAP_DEFAULT_MAX') + ';' +
    lift('function clampZapDefault(') +
    '\nlet defaultZapSats = ZAP_DEFAULT_SATS;' +
    lift('function zapPresets(') +
    '\nglobalThis.out = { clampZapDefault, zapPresets, ZAP_PRESETS_FIXED, ZAP_DEFAULT_SATS, ZAP_DEFAULT_MAX,' +
    ' set: (v) => { defaultZapSats = v; } };',
    ctx
  );
  return ctx.out;
}

// ---- the number -----------------------------------------------------------------------

test('AN UNSET DEFAULT IS 21', () => {
  // The zap everyone sends. It also means a fresh install draws three chips rather than
  // four, because the fourth would be a second 21 — the slot earns its place once set.
  const { clampZapDefault, ZAP_DEFAULT_SATS, zapPresets } = consts();
  assert.equal(ZAP_DEFAULT_SATS, 21);
  for (const v of [undefined, null, '', 0, NaN, 'abc', -50, {}]) {
    assert.equal(clampZapDefault(v), 21, JSON.stringify(v) + ' should fall back');
  }
  assert.equal(row(zapPresets()), '21,100,1000', 'an untouched install should not show 21 twice');
});

test('a typed amount is taken as whole sats', () => {
  const { clampZapDefault } = consts();
  assert.equal(clampZapDefault('2100'), 2100);
  assert.equal(clampZapDefault(2100), 2100);
  assert.equal(clampZapDefault('2100.9'), 2100, 'a fraction of a sat is not a sat');
  assert.equal(clampZapDefault(1), 1, 'one sat is a legitimate default');
});

test('A STRAY ZERO IS CAUGHT, NOT SAVED', () => {
  // The field is free text, and this number ends up in an amount box one tap from a
  // payment. The ceiling is nobody's real default and every real one is under it.
  const { clampZapDefault, ZAP_DEFAULT_MAX } = consts();
  assert.equal(clampZapDefault(ZAP_DEFAULT_MAX + 1), ZAP_DEFAULT_MAX);
  assert.equal(clampZapDefault('50000000'), ZAP_DEFAULT_MAX);
  assert.equal(clampZapDefault(ZAP_DEFAULT_MAX), ZAP_DEFAULT_MAX, 'the ceiling itself is allowed');
});

test('CLAMPED ON THE WAY OUT, NOT ONLY ON THE WAY IN', () => {
  // Storage is not the only way a value gets there, and the panel is the last thing
  // between it and a Send button — so the read path clamps too, both where the row is
  // built from and where the setting is shown.
  const boot = stripComments(source);
  assert.match(boot, /defaultZapSats = clampZapDefault\(settings && settings\.defaultZapSats\)/,
    'the cached preset is taken from storage unchecked');
  const settings = stripComments(lift('async function renderSettings('));
  assert.match(settings, /\$\('default-zap'\)\.value = String\(clampZapDefault\(settings\.defaultZapSats\)\)/,
    'the field can show a value the app would not use');
});

// ---- the row --------------------------------------------------------------------------

// Joined rather than deepEqual'd: the array comes out of a vm realm, so its prototype is
// not the host's and assert/strict compares prototypes — a same-shaped array fails as
// "same structure but not reference-equal", which reads like a real defect and is not one.
const row = (fnOut) => fnOut.join(',');

test('THE ROW STAYS AN ASCENDING SCALE', () => {
  // Appended, a default of 500 sat next to 1,000 and read as a mistake. Sorted, it lands
  // between 100 and 1,000 where the eye is already looking for it.
  const { zapPresets, set } = consts();
  set(2100);
  assert.equal(row(zapPresets()), '21,100,1000,2100', 'a large default belongs last');
  set(500);
  assert.equal(row(zapPresets()), '21,100,500,1000', 'a middling default is not appended');
  set(1);
  assert.equal(row(zapPresets()), '1,21,100,1000', 'a default under every preset belongs first');
});

test('A DEFAULT THAT IS ALREADY A PRESET DOES NOT DRAW TWICE', () => {
  // Set it to 100 and the row would otherwise carry two identical buttons, which reads
  // as a rendering bug rather than a preference.
  const { zapPresets, set } = consts();
  for (const n of [21, 100, 1000]) {
    set(n);
    assert.equal(row(zapPresets()), '21,100,1000', n + ' duplicated a fixed preset');
  }
});

test('BOTH ZAP FORMS SHARE ONE ROW', () => {
  // The profile sheet and the notification row. Two copies is how a settable preset gets
  // added to one and not the other.
  const src = stripComments(source);
  assert.equal((src.match(/zapPresetRow\(/g) || []).length, 3,
    'expected the definition plus exactly two call sites');
  assert.doesNotMatch(src, /\[21, 100, 1000, 5000\]/, 'a hand-rolled preset row came back');
  const peek = src.indexOf('const presets = zapPresetRow(amount);');
  const notif = src.indexOf('const presets = zapPresetRow(amount, stop);');
  assert.ok(peek !== -1, 'the profile sheet no longer uses the shared row');
  assert.ok(notif !== -1, 'the notification form no longer uses the shared row');
});

test('a preset inside a clickable row does not also follow the link', () => {
  // The notification row is an anchor that opens the note in a client, so the tap has to
  // be stopped — which is why the shared row takes a `stop` at all.
  const fn = stripComments(lift('function zapPresetRow('));
  assert.match(fn, /if \(stop\) stop\(e\)/, 'the shared row cannot stop a click');
  assert.match(fn, /type: 'button'/, 'a preset can submit a form it sits in');
});

// ---- the setting ----------------------------------------------------------------------

test('the setting is in Settings, and saved', () => {
  assert.match(html, /<h3>Default zap amount<\/h3>/, 'no setting for it');
  assert.match(html, /id="default-zap"/, 'the input is gone');
  const src = stripComments(source);
  assert.match(src, /settings: \{ defaultZapSats: sats \}/, 'the amount is never persisted');
  // Written back into the field, like the autozap caps: a value the app refused would
  // otherwise sit on screen looking saved.
  assert.match(src, /e\.target\.value = String\(sats\)/, 'a clamped value is not shown back');
  // And into the cache the rows read, so the next zap form drawn shows it without a
  // round trip or a reopen.
  assert.match(src, /defaultZapSats = sats;/, 'the open panel keeps the old preset until a reload');
});
