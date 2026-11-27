'use strict';

// The "Reload client window" offer is drawn in every theme's own button grammar. Measured in a
// real Chrome: its corners, lettering face and case match the theme's primary button (Send), and its
// dismiss button's corners match too, so a theme that squares or letters its buttons does not leave
// this one rounded and in the stock face. Fails on the code before the pass: Departures kept 10px
// corners against Send's 3px, and Ben Day, Turnstile, Departures and Jazz Age kept the stock face.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const ROOT = process.env.EXTENSION_ROOT || path.join(__dirname, '..');
const THEMES = fs.readdirSync(path.join(ROOT, 'themes')).filter((f) => f.endsWith('.css') && f !== 'patterns.css').map((f) => f.replace('.css', ''));

test('the reload offer wears each theme\'s button corners and lettering', { skip: CHROME ? false : 'no Chrome found', timeout: 120000 }, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const mismatches = [];
    for (const theme of THEMES) {
      const m = await x.evaluate(`(() => {
        document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
        document.getElementById('__m')?.remove();
        const box = document.createElement('div'); box.id = '__m';
        box.innerHTML = '<div class="reload-banner"><button class="reload-banner-btn">Reload client window</button><button class="reload-banner-x">x</button></div><button class="primary">Send</button>';
        document.body.appendChild(box);
        const g = (s) => { const c = getComputedStyle(box.querySelector(s)); return { r: c.borderRadius, ff: c.fontFamily, tt: c.textTransform }; };
        const out = { btn: g('.reload-banner-btn'), x: g('.reload-banner-x'), primary: g('.primary') };
        box.remove();
        return out;
      })()`);
      if (m.btn.r !== m.primary.r) mismatches.push(`${theme}: reload button corners ${m.btn.r}, Send ${m.primary.r}`);
      if (m.x.r !== m.primary.r) mismatches.push(`${theme}: dismiss corners ${m.x.r}, Send ${m.primary.r}`);
      if (m.btn.ff !== m.primary.ff) mismatches.push(`${theme}: reload button face ${m.btn.ff}, Send ${m.primary.ff}`);
      if (m.btn.tt !== m.primary.tt) mismatches.push(`${theme}: reload button case ${m.btn.tt}, Send ${m.primary.tt}`);
    }
    assert.deepEqual(mismatches, [], mismatches.join('\n'));
  } finally { await x.close(); }
});
