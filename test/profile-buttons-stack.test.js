'use strict';

// THE PROFILE'S TWO BUTTONS STACK RATHER THAN SHRINK. Side by side they shrank to share
// the row and truncated both labels at German's length ("Profil bearbeiten", "Status
// festlegen"), in every theme. The row-controls rule in CLAUDE.md: a label never shrinks
// to fit; the layout stacks instead.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const i = css.indexOf(sel + ' {');
  assert.ok(i !== -1, sel + ' moved');
  return css.slice(i, css.indexOf('}', i));
};

test('the row wraps and a button keeps its label width', () => {
  assert.match(rule('.profile-cta-row'), /flex-wrap: wrap/, 'the row cannot stack');
  const btn = rule('.profile-body .profile-cta-row > button');
  assert.match(btn, /flex: 1 0 auto/, 'a button shrinks to share the row again (truncating its label), or no longer fills its row once stacked');
  assert.match(btn, /max-width: 100%/, 'a stacked button can overflow the panel');
});
