'use strict';

// THE PANEL IS OUR PAGE, SO THE ZOOM IS OURS TO OFFER (issue #565).
//
// A tester on a monitor with a low height-to-width ratio could not make the panel
// narrower (Chrome floors the side panel's width; no API changes that) and asked to
// zoom the contents instead. That half is cheap: CSS zoom on the panel body reflows
// everything uniformly. Six stops, not a continuum, so a stored value always means one
// size a person can hold a preference about.
//
// It is deliberately NOT built on --display-scale. That token changes the theme's face
// while line boxes stay pinned, so switching themes never reflows the panel; a zoom is
// the opposite contract, and a root zoom multiplies the pinned values along with
// everything else, so the reflow guards on those tokens still hold.
//
// The stops, the mapping and the apply are lifted and run. The wiring (persistence,
// the feature-detect gate, the boot call) is held against the source, the way
// overview-reads.test.js holds its function.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

// Balanced-brace lift, for whole functions.
function liftFn(decl) {
  const at = bare.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = bare.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < bare.length; j++) {
    if (bare[j] === '{') depth++;
    else if (bare[j] === '}' && --depth === 0) return bare.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const bare = source.replace(/^\s*\/\/.*$/gm, '');

// One-statement lift, for declarations (liftFn needs braces to grab).
function liftLine(decl) {
  const at = bare.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const end = bare.indexOf(';', at);
  return bare.slice(at, end + 1);
}

const ctx = {
  console,
  document: {
    body: { style: {}, classList: { last: null, toggle(c, on) { this.last = [c, on]; } } },
    documentElement: {},
  },
  window: { innerWidth: 400 },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  setTimeout: (fn) => { fn(); return 0; },
  Date, Math, Number, isFinite, Set, Map, Array,
};
vm.createContext(ctx);
vm.runInContext(
  liftLine('const PANEL_ZOOM_STOPS = ') + '\n' +
  liftLine('const PANEL_ZOOM_DEFAULT = ') + '\n' +
  liftFn('function panelZoomPercent(') + '\n' +
  liftFn('function panelZoomIndex(') + '\n' +
  liftFn('function applyPanelZoom(') + '\n' +
  liftLine('const PANEL_NARROW_PX = ') + '\n' +
  liftFn('function effectivePanelWidth(') + '\n' +
  liftFn('function updatePanelNarrow(') + '\n' +
  liftLine('const TOPBAR_FOLD = ') + '\n' +
  liftLine('let topbarFolded = false;') + '\n' +
  liftLine('const topbarRestore = new Map();') + '\n' +
  liftFn('function applyTopbarFold(') + '\n' +
  liftFn('function topbarMoreOpen(') + '\n' +
  liftFn('function closeTopbarMore(') + '\n' +
  // A DOM small enough to run the fold for real: parents, siblings, classes.
  'const __els = {};\n' +
  'const __makeEl = (id) => { const el = { id, children: [], parentElement: null, classes: new Set(), attrs: {},\n' +
  '  get nextSibling() { if (!this.parentElement) return null; const s = this.parentElement.children; return s[s.indexOf(this) + 1] || null; },\n' +
  '  classList: { add: (...c) => c.forEach((x) => el.classes.add(x)), remove: (...c) => c.forEach((x) => el.classes.delete(x)), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined) { el.classes.has(c) ? el.classes.delete(c) : el.classes.add(c); } else if (on) { el.classes.add(c); } else { el.classes.delete(c); } } },\n' +
  '  setAttribute: (k, v) => { el.attrs[k] = v; },\n' +
  '  appendChild: (c) => { if (c.parentElement) c.parentElement.removeChild(c); c.parentElement = el; el.children.push(c); return c; },\n' +
  '  insertBefore: (c, ref) => { if (c.parentElement) c.parentElement.removeChild(c); c.parentElement = el; const i = ref ? el.children.indexOf(ref) : -1; el.children.splice(i === -1 ? el.children.length : i, 0, c); return c; },\n' +
  '  removeChild: (c) => { const i = el.children.indexOf(c); if (i > -1) { el.children.splice(i, 1); c.parentElement = null; } } }; return el; };\n' +
  'globalThis.__els = __els; globalThis.$ = (id) => __els[id] || null;\n' +
  'const __actions = __els["topbar-actions"] = __makeEl("topbar-actions");\n' +
  'const __content = __els["group-content"] = __makeEl("group-content");\n' +
  'const __chrome = __els["group-chrome"] = __makeEl("group-chrome");\n' +
  'const __more = __els["topbar-more-btn"] = __makeEl("topbar-more-btn"); __more.classes.add("hidden");\n' +
  'const __menu = __els["topbar-more-menu"] = __makeEl("topbar-more-menu"); __menu.classes.add("hidden");\n' +
  '__actions.appendChild(__content); __actions.appendChild(__chrome); __actions.appendChild(__more);\n' +
  'for (const id of ["notif-bell-btn", "search-btn", "stream-entry", "bookmarks-btn"]) __content.appendChild(__els[id] || (__els[id] = __makeEl(id)));\n' +
  'for (const id of ["help-btn", "settings-btn", "lock-btn"]) __chrome.appendChild(__els[id] || (__els[id] = __makeEl(id)));\n' +
  '__actions.appendChild(__makeEl("acct-chip"));' + '\n' +
  'globalThis.PANEL_NARROW_PX = PANEL_NARROW_PX;' +
  'globalThis.effectivePanelWidth = effectivePanelWidth;' +
  'globalThis.updatePanelNarrow = updatePanelNarrow;' +
  'globalThis.__document = document;' +
  'globalThis.__window = window;' +
  'globalThis.PANEL_ZOOM_STOPS = PANEL_ZOOM_STOPS;' +
  'globalThis.PANEL_ZOOM_DEFAULT = PANEL_ZOOM_DEFAULT;' +
  'globalThis.panelZoomPercent = panelZoomPercent;' +
  'globalThis.panelZoomIndex = panelZoomIndex;' +
  'globalThis.applyPanelZoom = applyPanelZoom;',
  ctx
);
const { PANEL_ZOOM_STOPS, PANEL_ZOOM_DEFAULT, panelZoomPercent, panelZoomIndex, applyPanelZoom,
        PANEL_NARROW_PX, effectivePanelWidth, updatePanelNarrow, __document, __window, __els } = ctx;

test('SIX STOPS, AND 100 IS ONE OF THEM', () => {
  assert.deepEqual([...PANEL_ZOOM_STOPS], [80, 90, 100, 110, 125, 150], 'the stops moved');
  assert.equal(PANEL_ZOOM_DEFAULT, 100);
  assert.ok(PANEL_ZOOM_STOPS.includes(PANEL_ZOOM_DEFAULT), 'the default is a stop, not a wish');
});

test('THE SLIDER INDEX READS AS A PERCENT, AND GARBAGE WEARS THE DEFAULT', () => {
  assert.equal(panelZoomPercent(0), 80);
  assert.equal(panelZoomPercent(2), 100);
  assert.equal(panelZoomPercent(5), 150);
  // slider.value is a string; the mapping takes it as it comes.
  assert.equal(panelZoomPercent('4'), 125);
  // Half a step rounds to the nearer stop, like the thumb does.
  assert.equal(panelZoomPercent(1.4), 90);
  assert.equal(panelZoomPercent(1.5), 100);
  // Out of range is the default, never a made-up stop.
  assert.equal(panelZoomPercent(-1), 100);
  assert.equal(panelZoomPercent(6), 100);
  assert.equal(panelZoomPercent('spin'), 100);
});

test('A STORED PERCENT SNAPS TO ITS NEAREST STOP', () => {
  assert.equal(panelZoomIndex(80), 0);
  assert.equal(panelZoomIndex(100), 2);
  assert.equal(panelZoomIndex(150), 5);
  assert.equal(panelZoomIndex(120), 4, '120 is five from 125 and ten from 110');
  // A dead tie goes to the lower stop. Nobody stores 95 by choice; nobody should land
  // on 110 by accident of rounding either.
  assert.equal(panelZoomIndex(95), 1);
  // Absent setting, or a stored null: the default, not stop zero.
  assert.equal(panelZoomIndex(undefined), 2);
  assert.equal(panelZoomIndex(null), 2);
  assert.equal(panelZoomIndex('spin'), 2);
});

test('ZOOM SETS THE BODY, AND 100 LEAVES NO INLINE ZOOM', () => {
  applyPanelZoom(125);
  assert.equal(ctx.document.body.style.zoom, '1.25');
  applyPanelZoom(80);
  assert.equal(ctx.document.body.style.zoom, '0.8');
  applyPanelZoom(150);
  assert.equal(ctx.document.body.style.zoom, '1.5');
  applyPanelZoom(100);
  assert.equal(ctx.document.body.style.zoom, '', 'the default panel carries no inline zoom');
});

// ---- the wiring, against the source ---------------------------------------------

test('THE CONTROL SITS IN APPEARANCE, LABELED AND SELF-DESCRIBING', () => {
  const at = html.indexOf('id="panel-zoom-setting"');
  assert.ok(at > -1, 'the setting block exists');
  const sectionAt = html.indexOf('data-section="appearance"');
  const sectionEnd = html.indexOf('</section>', sectionAt);
  assert.ok(at > sectionAt && at < sectionEnd, 'and it lives in the Appearance section');
  const block = html.slice(html.lastIndexOf('<div class="setting"', at), sectionEnd);
  assert.match(block, /<h3 data-i18n="Panel zoom">Panel zoom<\/h3>/);
  assert.match(block, /data-i18n="Make everything in the panel larger or smaller\."/);
  assert.match(block, /id="panel-zoom-slider" min="0" max="5" step="1"/);
  assert.match(block, /aria-label="Panel zoom" data-i18n-aria-label="Panel zoom"/);
  assert.match(block, /id="panel-zoom-value"/, 'the percent readout');
});

test('PERSISTED ON RELEASE, NOT ON EVERY TICK OF THE DRAG', () => {
  const fn = liftFn('function initPanelZoom(');
  const input = fn.slice(fn.indexOf("addEventListener('input'"), fn.indexOf("addEventListener('change'"));
  assert.match(input, /paint\(panelZoomPercent\(slider\.value\)\)/, 'input only paints');
  assert.doesNotMatch(input, /SIDECAR_SET_SETTINGS/, 'a drag would be dozens of writes');
  const commit = fn.slice(fn.indexOf("addEventListener('change'"));
  assert.match(commit, /SIDECAR_SET_SETTINGS/, 'the write happens on release');
  assert.match(commit, /panelZoom: pct/, 'under the settings key the issue named');
});

test('HIDDEN WHERE ZOOM WOULD DO NOTHING, APPLIED FROM STORAGE AT BOOT', () => {
  const fn = liftFn('function initPanelZoom(');
  assert.match(fn, /CSS\.supports\('zoom', '1'\)/, 'the feature-detect the issue asked for');
  const gate = fn.indexOf('CSS.supports');
  const hide = fn.indexOf("setting.classList.add('hidden')");
  assert.ok(gate > -1 && hide > gate, 'the block hides only where zoom would do nothing');
  assert.match(fn, /SIDECAR_GET_SETTINGS/, 'restored from sidecar_settings');
  assert.match(fn, /panelZoomIndex\(settings && settings\.panelZoom\)/);
  assert.match(bare, /initPanelZoom\(\);/, 'wired once at boot');
  assert.match(bare, /value\.textContent = I18N\.fmtNum\(pct, \{ style: 'unit', unit: 'percent' \}\)/,
    'the readout is a formatted number, not a glued string');
});

// ---- the narrow collapse (issue review: at 150% the rows clipped) ----------------

test('NARROW IS JUDGED ON THE WIDTH THE CONTENT ACTUALLY HAS', () => {
  assert.equal(PANEL_NARROW_PX, 340);
  __window.innerWidth = 400;
  __document.body.style.zoom = '';
  assert.equal(effectivePanelWidth(), 400, 'no zoom: the viewport is the width');
  __document.body.style.zoom = '1.5';
  assert.ok(Math.abs(effectivePanelWidth() - 400 / 1.5) < 1e-9, 'zoom divides');
  updatePanelNarrow();
  assert.deepEqual(__document.body.classList.last, ['panel-narrow', true], '400/1.5 = 267: narrow');

  __document.body.style.zoom = '0.8';
  updatePanelNarrow();
  assert.deepEqual(__document.body.classList.last, ['panel-narrow', false], '400/0.8 = 500: roomy');

  __window.innerWidth = 320;
  __document.body.style.zoom = '';
  updatePanelNarrow();
  assert.deepEqual(__document.body.classList.last, ['panel-narrow', true],
    'a sidebar at Chrome’s floor is narrow with no zoom at all');

  // A zoom string the panel never wrote cannot divide by NaN.
  __document.body.style.zoom = 'spin';
  assert.ok(Math.abs(effectivePanelWidth() - 320) < 1e-9, 'ungarbage: the factor falls back to 1');
});

test('NARROW IS WIRED BEFORE THE ZOOM GATE, AND ON EVERY PAINT AND RESIZE', () => {
  const fn = liftFn('function initPanelZoom(');
  const gate = fn.indexOf('CSS.supports');
  const wired = fn.indexOf('updatePanelNarrow();');
  const resize = fn.indexOf("addEventListener('resize', updatePanelNarrow)");
  assert.ok(wired > -1 && wired < gate, 'a narrow sidebar matters with no zoom at all');
  assert.ok(resize > -1, 'and again on resize');
  assert.match(fn, /applyPanelZoom\(pct\);\s*updatePanelNarrow\(\);/, 'every zoom paint re-judges');
});

test('THE COLLAPSE STACKS ON GROUP BOUNDARIES, IT DOES NOT SHRINK', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const at = css.indexOf('PANEL NARROW');
  assert.ok(at > -1, 'the rules exist');
  const endRule = css.indexOf('body.panel-narrow .theme-special-cards');
  const rules = css.slice(at, css.indexOf('}', endRule) + 1);
  assert.match(rules, /body\.panel-narrow \.topbar \{ flex-wrap: wrap;/, 'the topbar wraps');
  assert.match(rules, /body\.panel-narrow \.topbar-actions \{ flex-wrap: wrap; justify-content: flex-end; gap: 2px; \}/,
    'icon groups wrap as whole units, right-aligned');
  assert.match(rules, /body\.panel-narrow \.tabs \{ flex-wrap: wrap; \}/, 'the tabs wrap');
  assert.match(rules, /body\.panel-narrow \.tab \{ flex: 1 1 45%; \}/, 'two rows of two');
  // Send/Receive floor at min-content (icon + word + padding), wider than a zoomed
  // 320px panel: they stack.
  assert.match(rules, /body\.panel-narrow \.wallet-actions \{ flex-direction: column; align-items: stretch; \}/);
  assert.match(rules, /body\.panel-narrow \.modal-tabs \{ flex-wrap: wrap; \}/, 'the Activity sub-tabs wrap');
  assert.match(rules, /body\.panel-narrow \.modal-tab \{ flex: 1 1 45%; \}/, 'same two-per-row treatment');
  // A theme's name is set in its own display face at specimen size; two narrow
  // columns amputate it (Cast Iron broke mid-word). One card per row at narrow.
  // Written as a selector list on purpose: theme-gallery.test.js anchors its
  // minmax(0, 1fr) guard on the literal '.theme-selector {', and the narrow rule
  // must not shadow that anchor.
  assert.match(rules, /body\.panel-narrow \.theme-selector,\s*body\.panel-narrow \.theme-special-cards \{\s*grid-template-columns: 1fr;/);
  // No font-size, no padding reductions: the narrow-panel rule is stack, never shrink.
  assert.doesNotMatch(rules, /font-size/, 'no shrinking the controls');
});

test('THE TOPBAR ICONS CARRY THE GROUPS THE COMMENTS ALWAYS NAMED', () => {
  const at = html.indexOf('class="topbar-actions"');
  const end = html.indexOf('</div>', at);
  const row = html.slice(at, end);
  const groups = row.match(/class="topbar-group[^"]*"/g) || [];
  assert.equal(groups.length, 2, 'content and chrome, nothing else');
  const chrome = row.indexOf('topbar-group-chrome');
  assert.ok(chrome > -1, 'the chrome group is marked as such');
  for (const id of ['notif-bell-btn', 'search-btn', 'stream-entry', 'bookmarks-btn']) {
    const at2 = row.indexOf(id);
    assert.ok(at2 > -1 && at2 < chrome, id + ' acts on content, and sits in the content group');
  }
  for (const id of ['help-btn', 'settings-btn', 'lock-btn']) {
    assert.ok(row.indexOf(id) > chrome, id + ' is app chrome, and sits in the chrome group');
  }
  // The groups are atomic at every width, and seamless when unwrapped: the gaps
  // inside a group equal the gaps between groups, so one row of seven is unchanged.
  const css0 = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css0, /\.topbar-group \{ display: inline-flex; align-items: center; gap: 4px; \}/);
});

test('THE TRAVELING MARK FOLLOWS A WRAPPED TAB\u2019S OWN ROW', () => {
  const fn = liftFn('function wireTabSlider(');
  assert.match(fn, /slider\.style\.top = \(target\.offsetTop \+ target\.offsetHeight - 1\) \+ 'px'/,
    'positioned from the measured item, not the bar\u2019s bottom edge');
});

// ---- the expandable ⋯ menu (review: five icons folding is better than wrapping) --

test('THE ⋯ FOLDS THE REST INTO THE TRAY AND GIVES THEM BACK WHOLE', () => {
  __window.innerWidth = 400;
  __document.body.style.zoom = '1.5';
  updatePanelNarrow();
  assert.equal(__els['topbar-more-btn'].attrs['aria-expanded'], 'true');
  assert.ok(!__els['topbar-more-btn'].classes.has('hidden'), 'the affordance shows');
  for (const id of ['stream-entry', 'bookmarks-btn', 'help-btn', 'search-btn']) {
    assert.equal(__els[id].parentElement, __els['topbar-more-menu'], id + ' moved, not rebuilt');
  }
  // The three that never fold: the badge, and the ways out.
  for (const id of ['notif-bell-btn', 'settings-btn', 'lock-btn']) {
    assert.ok(__els[id].parentElement.id !== 'topbar-more-menu', id + ' stays inline');
  }

  __document.body.style.zoom = '';
  updatePanelNarrow();
  assert.equal(__els['topbar-more-btn'].attrs['aria-expanded'], 'false');
  assert.ok(__els['topbar-more-btn'].classes.has('hidden'), 'the affordance hides');
  assert.ok(__els['topbar-more-menu'].classes.has('hidden'), 'the tray closed');
  // The inline row is exactly what it was: search back between bell and stream,
  // settings between help and lock. (Joined strings, not deepEqual: the children
  // array is vm-realm and the harness compares prototypes before contents.)
  assert.equal(__els['group-content'].children.map((c) => c.id).join(','),
    'notif-bell-btn,search-btn,stream-entry,bookmarks-btn');
  assert.equal(__els['group-chrome'].children.map((c) => c.id).join(','), 'help-btn,settings-btn,lock-btn');
});

test('FOLDING IS IDEMPOTENT, AND A SECOND ROUND TRIP STILL RESTORES', () => {
  __document.body.style.zoom = '1.5'; updatePanelNarrow(); updatePanelNarrow();
  assert.equal(__els['stream-entry'].parentElement, __els['topbar-more-menu'], 'no double move');
  __document.body.style.zoom = ''; updatePanelNarrow(); updatePanelNarrow();
  assert.equal(__els['stream-entry'].parentElement.id, 'group-content', 'no double restore');
  __document.body.style.zoom = '1.5'; updatePanelNarrow();
  assert.equal(__els['stream-entry'].parentElement, __els['topbar-more-menu'], 'folds again cleanly');
  __document.body.style.zoom = ''; updatePanelNarrow();
});

test('THE TRAY IS WIRED LIKE THE ACCOUNT MENU, ON EVERY NARROW JUDGMENT', () => {
  const fn = liftFn('function initPanelZoom(');
  assert.match(fn, /topbar-more-btn'\)\.addEventListener\('click'/);
  assert.match(fn, /!menu\.contains\(e\.target\) && !\$\('topbar-more-btn'\)\.contains\(e\.target\)/,
    'a click outside the tray closes it');
  assert.match(bare, /applyTopbarFold\(narrow\);/, 'every narrow judgment folds or unfolds');
  assert.match(bare,
    /const TOPBAR_FOLD = \['stream-entry', 'bookmarks-btn', 'help-btn', 'search-btn'\];/,
    'bell, settings and lock stay visible: the badge, and the ways out');
  const menuAt = html.indexOf('id="topbar-more-menu"');
  assert.ok(menuAt > -1, 'the tray exists in the markup');
  assert.match(html.slice(html.lastIndexOf('<button id="topbar-more-btn"', menuAt), menuAt + 60),
    /data-i18n-title="More" data-i18n-aria-label="More"/);
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.topbar-more-menu \{[^}]*transform-origin: top right/, 'anchored right, under the button');
  assert.match(css, /\.topbar-more-menu\.is-open \{[^}]*pointer-events: auto/, 'and it opens');
});
