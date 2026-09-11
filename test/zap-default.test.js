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
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

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
    lift('function resolveZapDefault(') +
    '\nlet defaultZapSats = ZAP_DEFAULT_SATS; let defaultZapIsOwn = true;' +
    lift('function zapPresets(') +
    '\nglobalThis.out = { clampZapDefault, resolveZapDefault, zapPresets, ZAP_PRESETS_FIXED,' +
    ' ZAP_DEFAULT_SATS, ZAP_DEFAULT_MAX,' +
    ' set: (v) => { defaultZapSats = v; }, own: (b) => { defaultZapIsOwn = b; } };',
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
  const { own } = consts();
  void own;
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
  // Both read paths go through resolveZapDefault, which clamps whatever it resolves —
  // this account's entry or the fallback.
  const resolver = stripComments(lift('function resolveZapDefault('));
  assert.match(resolver, /clampZapDefault\(by && pubkey && by\[pubkey\]\)/,
    'resolution hands back a stored number unchecked');
  const boot = stripComments(source);
  assert.match(boot, /defaultZapSats = resolveZapDefault\(/, 'the cached preset skips resolution');
  const settings = stripComments(lift('async function renderSettings('));
  assert.match(settings, /\$\('default-zap'\)\.value = String\(resolveZapDefault\(/,
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
  // Definition, the two forms, and the rebuild inside zapDefaultSaver when the default
  // changes under an open form. A fifth means someone hand-rolled a row again.
  assert.equal((src.match(/zapPresetRow\(/g) || []).length, 4,
    'expected the definition, two call sites, and the rebuild');
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

// ---- whose amount ---------------------------------------------------------------------

test('AN ACCOUNT WITH ITS OWN AMOUNT GETS IT', () => {
  // A zap is a habit rather than a preference: a brand account tipping in hundreds and a
  // personal one in tens is the normal case, and one global number made the second
  // borrow the first's.
  const { resolveZapDefault } = consts();
  const st = { defaultZapSats: 100, zapDefaultBy: { alice: 2100 } };
  assert.equal(resolveZapDefault(st, 'alice'), 2100);
});

test('ONE ACCOUNT\'S AMOUNT NEVER REACHES ANOTHER', () => {
  // Reported: an 84 set for a personal account showed up on every other account. It had
  // been set while the field was global, and "per account with a global fallback" then
  // handed that number to everyone who had not chosen. The right shape for a theme,
  // where a new account should look like something; the wrong one for an amount of money.
  const { resolveZapDefault } = consts();
  const st = { defaultZapSats: 84, zapDefaultBy: { alice: 2100 } };
  assert.equal(resolveZapDefault(st, 'bob'), 21, "a leftover global is still somebody else's amount");
  assert.equal(resolveZapDefault(st, 'alice'), 2100, 'an explicit choice was overridden');
  // And the old field is not read at all, by anyone.
  assert.equal(resolveZapDefault({ defaultZapSats: 84 }, 'carol'), 21);
  const resolver = stripComments(lift('function resolveZapDefault('));
  assert.doesNotMatch(resolver, /defaultZapSats/, 'the global is read again');
});

test('LOCKED, OR A FRESH INSTALL, STILL RESOLVES TO 21', () => {
  // The lock screen paints before the panel knows who is unlocking, so activePubkey is
  // empty — and nothing about a zap row should depend on that.
  const { resolveZapDefault } = consts();
  assert.equal(resolveZapDefault({ zapDefaultBy: { alice: 2100 } }, ''), 21);
  assert.equal(resolveZapDefault({ defaultZapSats: 500 }, null), 21);
  for (const st of [null, undefined, {}, { zapDefaultBy: {} }]) {
    assert.equal(resolveZapDefault(st, 'alice'), 21, JSON.stringify(st));
  }
});

test('a tampered per-account amount is still clamped', () => {
  // The clamp is on the way out as well as in, so the map cannot put an absurd number in
  // front of a Send button either.
  const { resolveZapDefault, ZAP_DEFAULT_MAX } = consts();
  assert.equal(resolveZapDefault({ zapDefaultBy: { alice: 50000000 } }, 'alice'), ZAP_DEFAULT_MAX);
  assert.equal(resolveZapDefault({ zapDefaultBy: { alice: -5 } }, 'alice'), 21);
});

test('THE MAP IS EDITED IN THE BACKGROUND, NOT SENT WHOLE', () => {
  // SIDECAR_SET_SETTINGS merges shallowly, so a panel sending the whole map would clobber
  // another account's amount and two racing panels would lose one. Same reasoning as
  // SIDECAR_SET_NIP65_ONLY beside it.
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.match(bg, /case 'SIDECAR_SET_ZAP_DEFAULT_FOR'/, 'no dedicated setter');
  const h = bg.slice(bg.indexOf("case 'SIDECAR_SET_ZAP_DEFAULT_FOR'"), bg.indexOf("case 'SIDECAR_SET_SETTINGS'"));
  assert.match(h, /\{ \.\.\.\(prev\.zapDefaultBy \|\| \{\}\) \}/, 'the map is read-modify-written');
  assert.match(h, /delete map\[message\.pubkey\]/, 'clearing stores a zero instead of removing the entry');
  // Fails closed with no account rather than parking the number somewhere shared.
  assert.match(h, /if \(!message\.pubkey\) \{\s*result = \{ ok: false/,
    'a write with no account is still accepted somewhere');
  // Clamped where it is stored too, not only where it is typed.
  assert.match(h, /ZAP_DEFAULT_ABS_MAX/, 'the stored amount is unclamped');
  // And a web page cannot reach it.
  const allow = bg.slice(bg.indexOf('const CONTENT_OK = new Set('), bg.indexOf('if (!fromExtPage && !CONTENT_OK'));
  assert.doesNotMatch(allow, /SET_ZAP_DEFAULT_FOR/, 'a visited page can set your zap amount');
});

test('THE AMOUNT FOLLOWS AN ACCOUNT SWITCH', () => {
  // Resolved in the render path, which runs on every state change including a switch, so
  // a zap row drawn afterwards offers the amount of whoever you switched to.
  const src = stripComments(source);
  assert.match(src, /defaultZapSats = resolveZapDefault\(settings, state\.activePubkey\)/,
    'the cached amount is not re-resolved per account');
  const settings = stripComments(lift('async function renderSettings('));
  assert.match(settings, /resolveZapDefault\(settings, state\.activePubkey\)/,
    'Settings shows an amount that is not the active account\'s');
});

test('both writers target the account you are in, or do not write', () => {
  const src = stripComments(source);
  const writes = src.match(/SIDECAR_SET_ZAP_DEFAULT_FOR', pubkey: state\.activePubkey, sats/g) || [];
  assert.equal(writes.length, 2, 'expected the Settings field and the in-form line');
  assert.doesNotMatch(src, /settings: \{ defaultZapSats:/, 'a writer sets the global for every account again');
  // Guarded in the panel too, so onboarding cannot reach a setter that would refuse it.
  assert.equal((src.match(/if \(!state\.activePubkey\) return/g) || []).length >= 2, true,
    'a writer can fire with no account active');
});

test('A [+] SITS IN THE SLOT UNTIL AN AMOUNT IS CHOSEN', () => {
  // With 21 built in and the row deduped, an account that has never set an amount shows
  // three chips and no sign a fourth is available. The only way in was to know you could
  // type a number and watch a line appear, which is not a way in.
  const { zapPresets, own, set } = consts();
  own(false);
  set(21);
  assert.equal(row(zapPresets()), '21,100,1000', 'an unchosen amount still takes the slot');
  // Even a resolved amount that differs from the fixed three stays out of the row until
  // it is the account's own — otherwise [+] would never appear for anybody.
  set(500);
  assert.equal(row(zapPresets()), '21,100,1000', 'a value nobody chose is drawn as a preset');
  own(true);
  assert.equal(row(zapPresets()), '21,100,500,1000', 'a chosen amount is not drawn');

  const fn = stripComments(lift('function zapPresetRow('));
  assert.match(fn, /if \(!defaultZapIsOwn\) \{/, 'the row never offers a way to set one');
  assert.match(fn, /textContent: '\+'/, 'the invitation is not a [+]');
  assert.match(fn, /amountEl\.focus\(\)/, '[+] does not put the cursor where you type the amount');
  assert.match(fn, /aria-label', 'Set your own zap amount'/, '[+] has no accessible name');
  assert.match(css, /\.peek-preset-add \{[^}]*border-style: dashed/, '[+] reads as an amount rather than an invitation');
});

test('choosing an amount replaces the [+], without a reopen', () => {
  // Both writers flip the ownership flag, or the row rebuilt under an open form would
  // still be offering to set the amount that was just set.
  const src = stripComments(source);
  assert.equal((src.match(/defaultZapIsOwn = true/g) || []).length, 2,
    'expected the Settings field and the in-form line to both claim the slot');
  assert.match(src, /defaultZapIsOwn = !!\(settings && settings\.zapDefaultBy && state\.activePubkey/,
    'ownership is not re-read per account, so a switch keeps the wrong slot');
});

// ---- setting it from the zap form -----------------------------------------------------

test('THE AMOUNT CAN BE SAVED FROM WHERE IT IS TYPED', () => {
  // Settings is the wrong place to have to go: the amount worth keeping is the one you
  // just typed into a zap form, and the alternative was remembering it, closing the
  // sheet, opening Settings and expanding a section.
  const f = stripComments(lift('function zapDefaultSaver('));
  assert.match(f, /SIDECAR_SET_ZAP_DEFAULT_FOR', pubkey: state\.activePubkey, sats/,
    'the form cannot save the amount for this account');
  assert.match(f, /defaultZapSats = sats/, 'the open panel keeps the old preset');
  assert.match(f, /clampZapDefault\(amountEl\.value\)/, 'the typed amount is saved unchecked');
  // Both zap forms offer it, since they share everything else about the form.
  const src = stripComments(source);
  assert.equal((src.match(/zapDefaultSaver\(/g) || []).length, 3,
    'expected the definition plus exactly two call sites');
});

test('it is absent when there is nothing to save', () => {
  // A blank field, or an amount that is already the default. Offered inert, it would be
  // one more dead control in a form that already has an amount and a Send.
  const f = stripComments(lift('function zapDefaultSaver('));
  assert.match(f, /clampZapDefault\(n\) !== defaultZapSats/, 'it offers to save the amount already saved');
  assert.match(f, /btn\.classList\.toggle\('hidden', !worth\)/, 'it is disabled rather than absent');
  assert.match(f, /!!n && n > 0/, 'a blank or junk field still offers to be saved');
});

test('SAVING REBUILDS THE ROW, BECAUSE THE CHIP MAY MOVE', () => {
  // The row is sorted, so a newly saved 500 belongs between 100 and 1,000 — patching the
  // old chip in place would leave it in the position the previous amount had.
  const f = stripComments(lift('function zapDefaultSaver('));
  assert.match(f, /const fresh = zapPresetRow\(amountEl, stop, sync\)/, 'the row is not rebuilt');
  assert.match(f, /row\.replaceWith\(fresh\)/, 'the rebuilt row is never swapped in');
  assert.match(f, /row = fresh/, 'a second save would replace a row that is no longer there');
});

test('a preset tap is heard, and Settings is kept honest', () => {
  // Setting .value fires no input event, so the row tells its watcher directly — and a
  // listener on the row itself would not survive the row being rebuilt.
  const rowFn = stripComments(lift('function zapPresetRow('));
  assert.match(rowFn, /if \(onPick\) onPick\(n\)/, 'a preset tap is invisible to the saver');
  // Settings is a hidden view already rendered with the old number.
  const f = stripComments(lift('function zapDefaultSaver('));
  assert.match(f, /\$\('default-zap'\)/, 'Settings would show a value that is no longer the setting');
});

// ---- the setting ----------------------------------------------------------------------

test('the setting is in Settings, and saved', () => {
  assert.match(html, /<h3>Default zap amount<\/h3>/, 'no setting for it');
  assert.match(html, /id="default-zap"/, 'the input is gone');
  const src = stripComments(source);
  assert.match(src, /SIDECAR_SET_ZAP_DEFAULT_FOR/, 'the amount is never persisted');
  // Written back into the field, like the autozap caps: a value the app refused would
  // otherwise sit on screen looking saved.
  assert.match(src, /e\.target\.value = String\(sats\)/, 'a clamped value is not shown back');
  // And into the cache the rows read, so the next zap form drawn shows it without a
  // round trip or a reopen.
  assert.match(src, /defaultZapSats = sats;/, 'the open panel keeps the old preset until a reload');
});
