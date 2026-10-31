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
    documentElement: {
      style: {
        setProperty(k, v) { this[k] = v; },
        removeProperty(k) { delete this[k]; },
      },
    },
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

test('ZOOM SETS THE BODY, PUBLISHES ITS FACTOR, AND 100 LEAVES NOTHING BEHIND', () => {
  applyPanelZoom(120);
  assert.equal(ctx.document.body.style.zoom, '1.2');
  assert.equal(ctx.document.documentElement.style['--panel-zoom'], '1.2',
    'viewport units divide by this');
  applyPanelZoom(80);
  assert.equal(ctx.document.body.style.zoom, '0.8');
  applyPanelZoom(110);
  assert.equal(ctx.document.body.style.zoom, '1.1');
  applyPanelZoom(100);
  assert.equal(ctx.document.body.style.zoom, '', 'the default panel carries no inline zoom');
  assert.ok(!('--panel-zoom' in ctx.document.documentElement.style), 'and the divisor goes with it');
});

test('EVERY VIEWPORT UNIT DIVIDES BY THE PUBLISHED ZOOM', () => {
  // Viewport units do not shrink with CSS zoom: 100vh inside a zoomed subtree is
  // still the physical viewport, which is how the lock screen rendered one-and-a-half
  // panels tall and the PIN sat below the fold. Stylesheets may use them only
  // divided by the published factor.
  const files = ['styles.css', ...fs.readdirSync(path.join(ROOT, 'themes')).map((d) => 'themes/' + d)];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(new RegExp('\\d(?:\\.\\d+)?(?:d?vh|d?vw|svh|lvh|svw|lvw)\\b(?!\\s*/\\s*var\\(--panel-zoom)', 'g'));
    assert.equal(bad, null, f + ' uses a raw viewport unit: ' + (bad || []).join(', '));
  }
});

// ---- the wiring, against the source ---------------------------------------------

// ---- the stops and the stepper ----------------------------------------------------

test('FIVE STOPS, 80 TO 120, AND 100 IS ONE OF THEM', () => {
  assert.deepEqual([...PANEL_ZOOM_STOPS], [80, 90, 100, 110, 120], 'the stops moved');
  assert.equal(PANEL_ZOOM_DEFAULT, 100);
  assert.ok(PANEL_ZOOM_STOPS.includes(PANEL_ZOOM_DEFAULT), 'the default is a stop, not a wish');
  // The ceiling is a decision: a narrow panel cannot hold the content at 125 or 150, and
  // rows that fit at 100 clipped, wrapped mid-word or overflowed there.
  assert.ok(Math.max(...PANEL_ZOOM_STOPS) <= 120, 'nothing above 120');
});

test('A STOP INDEX READS AS A PERCENT, AND GARBAGE WEARS THE DEFAULT', () => {
  assert.equal(panelZoomPercent(0), 80);
  assert.equal(panelZoomPercent(2), 100);
  assert.equal(panelZoomPercent(4), 120);
  assert.equal(panelZoomPercent('3'), 110, 'a string index is read as the number it is');
  assert.equal(panelZoomPercent(1.4), 90);
  assert.equal(panelZoomPercent(1.5), 100);
  // Out of range is the default, never a made-up stop.
  assert.equal(panelZoomPercent(-1), 100);
  assert.equal(panelZoomPercent(5), 100);
  assert.equal(panelZoomPercent('spin'), 100);
});

test('A STORED PERCENT SNAPS TO ITS NEAREST STOP', () => {
  assert.equal(panelZoomIndex(80), 0);
  assert.equal(panelZoomIndex(100), 2);
  assert.equal(panelZoomIndex(120), 4);
  assert.equal(panelZoomIndex(150), 4, 'above the ceiling is the ceiling');
  assert.equal(panelZoomIndex(50), 0, 'and below the floor is the floor');
  // A dead tie goes to the lower stop: nobody should land on a larger size by an accident
  // of rounding.
  assert.equal(panelZoomIndex(95), 1);
  assert.equal(panelZoomIndex(105), 2);
  // Absent, null or not a number: the default, not stop zero.
  assert.equal(panelZoomIndex(undefined), 2);
  assert.equal(panelZoomIndex(null), 2);
  assert.equal(panelZoomIndex('spin'), 2);
});

// ---- the control, against the markup ---------------------------------------------

test('THE STEPPER SITS IN APPEARANCE, FIRST, LABELED AND SELF-DESCRIBING', () => {
  const at = html.indexOf('id="panel-zoom-setting"');
  assert.ok(at > -1, 'the setting block exists');
  const sectionAt = html.indexOf('data-section="appearance"');
  const sectionEnd = html.indexOf('</section>', sectionAt);
  assert.ok(at > sectionAt && at < sectionEnd, 'and it lives in the Appearance section');
  // FIRST in the section: the control you reach for when the panel is unusable must not
  // sit below a scroll of everything it makes unusable.
  const langAt = html.indexOf('id="language-setting"');
  assert.ok(langAt > -1 && at < langAt, 'it opens the section, ahead of Language');
  const block = html.slice(html.lastIndexOf('<div class="setting"', at), sectionEnd);
  assert.match(block, /<h3 data-i18n="Panel zoom">Panel zoom<\/h3>/);
  assert.match(block, /data-i18n="Make everything in the panel larger or smaller\."/);
  assert.match(block, /role="group" aria-label="Panel zoom" data-i18n-aria-label="Panel zoom"/);
  // Three controls, each named for a screen reader through the translation table.
  for (const [id, label] of [['panel-zoom-down', 'Smaller'], ['panel-zoom-up', 'Larger'], ['panel-zoom-reset', 'Reset to 100%']]) {
    const i = block.indexOf('id="' + id + '"');
    assert.ok(i > -1, id + ' exists');
    const tag = block.slice(block.lastIndexOf('<button', i), block.indexOf('>', i));
    assert.match(tag, new RegExp('aria-label="' + label + '"'), id + ' is named');
    assert.match(tag, new RegExp('data-i18n-aria-label="' + label + '"'), id + ' is named through i18n');
  }
  // Down is the minus, up is the plus, and the glyphs are drawn, so no font decides them.
  assert.match(block, /id="panel-zoom-down"[\s\S]*?<line x1="5" y1="12" x2="19" y2="12"><\/line>[\s\S]*?<\/button>/);
  assert.match(block, /id="panel-zoom-up"[\s\S]*?<line x1="12" y1="5" x2="12" y2="19"><\/line>/);
  // Nothing of the earlier controls is left behind.
  assert.doesNotMatch(block, /type="range"|zoom-slider|zoom-track|zoom-thumb|zoom-input|zoom-stop\b|zoom-stops/);
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\.zoom-(slider|track|thumb|input|stop|stops|row|value|reset)\b/, 'dead rules for controls that are gone');
  assert.match(css, /\.zoom-stepper \{[^}]*display: flex/);
  assert.match(css, /\.zoom-step \{[^}]*flex: 0 0 44px/, 'the ends are fixed cells; the readout takes the rest');
  assert.match(css, /\.zoom-readout\.is-changed \{/, 'the readout wears the accent off 100');
});

// ---- the control, run -------------------------------------------------------------

// The REAL stepper code, lifted out of initPanelZoom and run against stand-in elements.
// A source match here would pass on a stepper whose buttons did nothing: that is the
// failure the six-button version had, where every tap read its stop's percent as an index.
function runStepper(stored) {
  const fn = liftFn('function initPanelZoom(');
  const body = fn.slice(fn.indexOf("const down = $('panel-zoom-down');"), fn.lastIndexOf('}'));
  class El {
    constructor() { this.listeners = {}; this.disabled = false; this.textContent = ''; this.classes = new Set(); }
    get classList() { return { toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)), contains: (c) => this.classes.has(c) }; }
    addEventListener(type, f) { this.listeners[type] = f; }
    click() { if (!this.disabled && this.listeners.click) this.listeners.click(); }
  }
  const els = { 'panel-zoom-down': new El(), 'panel-zoom-up': new El(), 'panel-zoom-reset': new El() };
  const saved = [];
  const doc = { body: { style: {} }, documentElement: { style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } } } };
  const c = {
    document: doc, Promise, Number, String, Math, Intl,
    $: (id) => els[id],
    updatePanelNarrow() {},
    I18N: { fmtNum: (n, o) => new Intl.NumberFormat('en', o).format(n) },
    call: async (m) => {
      if (m.type === 'SIDECAR_SET_SETTINGS') { saved.push(m.settings.panelZoom); return {}; }
      if (stored === 'fail') throw new Error('Request failed');
      return { panelZoom: stored };
    },
  };
  vm.createContext(c);
  vm.runInContext([
    liftLine('const PANEL_ZOOM_STOPS = '), liftLine('const PANEL_ZOOM_DEFAULT = '),
    liftFn('function panelZoomPercent('), liftFn('function panelZoomIndex('), liftFn('function applyPanelZoom('),
    'globalThis.start = () => {' + body + '};',
  ].join('\n'), c);
  c.start();
  return { els, saved, doc, down: els['panel-zoom-down'], up: els['panel-zoom-up'], readout: els['panel-zoom-reset'] };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('THE STEPPER STEPS, STOPS AT BOTH ENDS, AND WRITES ONCE PER TAP', async () => {
  const s = runStepper(undefined);
  await settle();
  assert.equal(s.readout.textContent, '100%');
  assert.equal(s.doc.body.style.zoom, '', 'nothing stored, nothing applied');
  assert.ok(!s.readout.classes.has('is-changed'), 'plain at the default');
  assert.ok(!s.down.disabled && !s.up.disabled);

  s.up.click();
  assert.equal(s.readout.textContent, '110%');
  assert.equal(s.doc.body.style.zoom, '1.1');
  s.up.click();
  assert.equal(s.readout.textContent, '120%');
  assert.ok(s.up.disabled, 'the + goes off at the ceiling');
  s.up.click(); // a tap on the disabled end does nothing
  assert.equal(s.readout.textContent, '120%');
  assert.deepEqual(s.saved, [110, 120], 'one write per step, none for the refused tap');
  assert.ok(s.readout.classes.has('is-changed'));

  for (let i = 0; i < 5; i++) s.down.click();
  assert.equal(s.readout.textContent, '80%');
  assert.equal(s.doc.body.style.zoom, '0.8');
  assert.ok(s.down.disabled, 'the - goes off at the floor');
  assert.deepEqual(s.saved, [110, 120, 110, 100, 90, 80]);
});

test('THE READOUT IS THE RESET: ONE TAP TO 100, AND NOTHING AT 100', async () => {
  const s = runStepper(undefined);
  await settle();
  s.readout.click();
  assert.deepEqual(s.saved, [], 'at 100 there is nothing to reset, so nothing is written');
  s.up.click(); s.up.click();
  s.readout.click();
  assert.equal(s.readout.textContent, '100%');
  assert.equal(s.doc.body.style.zoom, '', 'back to a panel with no inline zoom');
  assert.ok(!s.readout.classes.has('is-changed'));
  assert.deepEqual(s.saved, [110, 120, 100]);
});

test('THE STORED SIZE IS RESTORED, SNAPPED, AND A FAILED READ STILL SHOWS 100', async () => {
  let s = runStepper(110); await settle();
  assert.equal(s.readout.textContent, '110%'); assert.equal(s.doc.body.style.zoom, '1.1');
  s = runStepper(150); await settle();
  assert.equal(s.readout.textContent, '120%', 'a value above the ceiling snaps to it');
  assert.ok(s.up.disabled);
  s = runStepper('spin'); await settle();
  assert.equal(s.readout.textContent, '100%');
  s = runStepper('fail'); await settle();
  assert.equal(s.readout.textContent, '100%', 'the readout is never blank while the read is lost');
  assert.deepEqual(s.saved, [], 'restoring writes nothing');
});

// ---- what zoom exposed ------------------------------------------------------------
//
// Each of these was a layout that held at 100% and broke at the larger sizes, and each
// belongs in a narrow panel at any zoom. They were measured in a browser; these keep the
// rules from being edited away.

test('RELAY RIDER IGNORES PANEL ZOOM', () => {
  // The game sizes itself from its frame, and the frame sits inside the zoomed body: it saw
  // two thirds of the window at 150 and picked a pixel scale to match, then got stretched.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.rider-overlay \{[^}]*zoom: calc\(1 \/ var\(--panel-zoom, 1\)\)/);
});

test('OVERVIEW VALUES SHRINK AT THE END, AND THE WALLET BADGES STACK WHOLE', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // A bare text node in the right-aligned flex row spilled off the left edge: "el@sidecar.top".
  assert.match(css, /\.account-stat-id-text \{[^}]*min-width: 0[^}]*text-overflow: ellipsis[^}]*white-space: nowrap/);
  assert.match(bare, /h\('span', \{ className: 'account-stat-id-text', textContent: nip05, title: nip05 \}\)/);
  assert.match(bare, /h\('span', \{ className: 'account-stat-id-text', textContent: content\.lud16, title: content\.lud16 \}\)/);
  assert.match(css, /\.wallet-status \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.wallet-badge \{[^}]*white-space: nowrap/);
});

test('A SIGNING ROW\u2019S HOST AND AGE WRAP AS PIECES, AND THE WALLET RANGE AS FIGURES', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(bare, /function actSub\(host, ts\)/);
  assert.equal((bare.match(/actSub\(/g) || []).length, 3, 'defined once, used by both rows');
  assert.match(css, /\.act-sub \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.act-host \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.wallet-chart-meta \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.wallet-chart-meta > span \{ white-space: nowrap; \}/);
  assert.match(css, /\.relay-add-confirm-actions \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.relay-add-confirm-actions button \{ min-width: max-content; white-space: nowrap; \}/);
});

// ---- the narrow collapse (at 150% the rows clipped; the ceiling is 120 now, the collapse stays) ----

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
  const endRule = css.indexOf('body.panel-narrow .wallet-budgets .item-actions');
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
  // The wallet backup pair floors at min-content too (Back up broke across lines).
  assert.match(rules, /body\.panel-narrow \.wallet-backup-card \{ padding: 10px; \}/,
    'the card gives back a notch so the export link keeps one line');
  assert.match(rules, /body\.panel-narrow \.wallet-backup-actions \{ flex-direction: column; align-items: stretch; \}/);
  // Budget rows stack like transaction rows instead of cramming three columns.
  assert.match(rules, /body\.panel-narrow \.wallet-budgets \.item \{ flex-direction: column; align-items: stretch; \}/);
  assert.match(rules, /body\.panel-narrow \.wallet-budgets \.item-actions \{ justify-content: flex-end; \}/);
  // Onboarding is taller than the viewport at 150% whatever the layout does; centered
  // overflow in a scroll container clips the TOP. Top-align so scrolling reaches all.
  assert.match(rules, /body\.panel-narrow #view-onboarding \{ justify-content: flex-start; padding-top: 24px; \}/);
  // Account npubs are data lines: they truncate on one line instead of word-break
  // orphaning a character or two onto a second line. Scoped to the account list —
  // prose rows elsewhere (budget sentences, transaction details) keep wrapping.
  // (Always-on, so it lives beside .item-sub, not in the narrow block.)
  assert.match(css, /#account-list \.item-sub \{\n  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; word-break: normal;\n\}/);
  assert.match(css, /#account-list \.item-sub/);
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
