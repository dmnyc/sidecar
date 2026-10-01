'use strict';

// Some containers have no horizontal padding in the shared sheet, because there they are
// open space: the profile, the On this day card, a settings section. A theme that draws
// one as a box (a border, an inset line, a background) has to pad it too, or its words
// run across the line. Turnstile's profile did: the bio started outside its own plate.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const THEMES = path.join(__dirname, '..', 'themes');
const UNPADDED = ['profile-body', 'otd', 'settings-section'];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

for (const file of fs.readdirSync(THEMES).filter((f) => f.endsWith('.css') && f !== 'patterns.css')) {
  test(`${file}: a container it boxes is padded too`, () => {
    const rules = [...strip(fs.readFileSync(path.join(THEMES, file), 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((m) => ({ sel: m[1], body: m[2] }));
    for (const c of UNPADDED) {
      const own = rules.filter((r) => r.sel.split(',').some((p) => new RegExp('\\.' + c + '(\\s*$|:not|\\[)').test(p.trim())));
      // A box is a full border, an inset line or a background. A top or bottom border alone
      // is a rule between sections, which no padding is needed beside.
      const boxed = own.some((r) => /(^|;)\s*(border(-left|-right|-inline)?\s*:\s*(?!none|0)|box-shadow\s*:[^;]*inset|background(-color)?\s*:\s*(?!transparent|none))/.test(r.body));
      const padded = own.some((r) => /(^|;)\s*padding(-left|-inline)?\s*:/.test(r.body));
      assert.ok(!boxed || padded, `.${c} is drawn as a box here but given no padding, so its text runs across the edge`);
    }
  });
}
