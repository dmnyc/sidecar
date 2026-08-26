'use strict';

// The Settings view is a stack of collapsible sections, and a new setting lands
// as one more <div class="setting">. Nothing stops that div from being pasted
// under <h2> instead of inside a section body — no error, no crash; the control
// simply can never be opened (it lives behind no header, outside every toggle),
// and it would silently sit there on top of the collapsed stack. Same class of
// half-change as view-clients.test.js: two places that must agree.
//
// This pins the structure: every block inside a section body except the danger
// zone, every toggle's aria-controls pointing at a real body id, and the
// section keys matching SETTINGS_SECTION_DEFAULTS in sidepanel.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

// #view-settings ends where the approval overlay begins — slice rather than try
// to balance tags across the whole document.
function viewHtml() {
  const start = html.indexOf('<section id="view-settings"');
  const end = html.indexOf('<div id="view-approval"');
  assert.ok(start > -1 && end > start, 'view-settings boundaries not found');
  return html.slice(start, end);
}

// Matching </div> for an opening <div ...> by counting tokens from its end.
function closingDivIndex(haystack, openStart) {
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = openStart;
  let m;
  while ((m = re.exec(haystack))) {
    depth += m[0] === '<div' ? 1 : -1;
    if (depth === 0) return m.index;
  }
  return -1;
}

function sectionBodies(view) {
  const out = [];
  const re = /<div class="settings-section-body" id="([^"]+)">/g;
  let m;
  while ((m = re.exec(view))) {
    const close = closingDivIndex(view, m.index);
    assert.ok(close > m.index, 'unbalanced settings-section-body for ' + m[1]);
    out.push({ id: m[1], text: view.slice(m.index, close) });
  }
  return out;
}

test('every settings block sits inside a collapsible section except danger zone', () => {
  const view = viewHtml();
  const bodies = sectionBodies(view).map((b) => b.text).join('\n');
  const outside = view.replace(/<div class="settings-section-body"[\s\S]*?<\/section>\s*/g, '');

  // Inside sections there must be blocks, not zero (an empty section renders a
  // header that opens onto nothing).
  for (const b of sectionBodies(view)) {
    assert.ok(b.text.includes('<div class="setting'), 'empty section body: ' + b.id);
  }

  // Outside them, exactly one block remains and it is the danger zone.
  const leftovers = [];
  const re = /<div class="(setting[^"]*)"/g;
  let m;
  while ((m = re.exec(outside))) leftovers.push(m[1]);
  assert.deepEqual(leftovers.sort(), ['setting danger-zone'],
    'blocks found outside any section: ' + JSON.stringify(leftovers));
  assert.ok(bodies.includes('<div class="setting'));
});

test("aria-controls on every section toggle resolves to that body's id", () => {
  const view = viewHtml();
  const bodies = new Set(sectionBodies(view).map((b) => b.id));
  const seen = new Set();
  const re = /<button[^>]*class="settings-section-toggle"[^>]*>/g;
  let m;
  while ((m = re.exec(view))) {
    const target = (m[0].match(/aria-controls="([^"]+)"/) || [])[1];
    assert.ok(target, 'toggle without aria-controls: ' + m[0]);
    assert.ok(bodies.has(target), 'aria-controls points at missing body: ' + target);
    assert.ok(!seen.has(target), 'two toggles share aria-controls: ' + target);
    seen.add(target);
  }
  assert.deepEqual(seen.size, bodies.size, 'some section body has no toggle');
});

test('data-section keys match SETTINGS_SECTION_DEFAULTS in sidepanel.js', () => {
  const view = viewHtml();
  // Tolerates state classes on the section tag (e.g. "open") but nothing else.
  const htmlKeys = [...view.matchAll(/<section class="settings-section(?: [a-z-]+)*" data-section="([^"]+)">/g)]
    .map((m) => m[1]);

  const jsBlock = js.match(/const SETTINGS_SECTION_DEFAULTS = \{[\s\S]*?\};/);
  assert.ok(jsBlock, 'SETTINGS_SECTION_DEFAULTS not found in sidepanel.js');
  const jsKeys = [...jsBlock[0].matchAll(/^\s*([a-z]+): (?:true|false),/gm)].map((m) => m[1]);
  assert.ok(jsKeys.length, 'no keys parsed from SETTINGS_SECTION_DEFAULTS');

  assert.deepEqual(htmlKeys.slice().sort(), jsKeys.slice().sort(),
    'sections in HTML and defaults in JS disagree');
});
