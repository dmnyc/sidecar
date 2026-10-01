'use strict';

// The loading spinner is an arc turning on a track. If the two are close in tone it cannot
// be seen to turn, which is what happened on the light themes: the track was
// --border-strong, a dark ink there (near-black in two themes), and the arc a dark accent.
// The track is now a faint tint of the theme's border, and every theme's arc has to clear
// 3:1 against it on the card surface, the contrast WCAG asks of a graphic.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));

const hex = (c) => {
  let h = c.trim().replace('#', '');
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => p - q); return (y + 0.05) / (x + 0.05); };

test('the spinner track is a faint tint, the arc the accent', () => {
  const at = css.indexOf('.recv-spinner,\n.ac-spinner {');
  assert.ok(at > -1, 'the spinner rule moved');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /border: 2px solid rgba\(var\(--border-rgb\), 0\.16\); border-top-color: var\(--lav\);/);
});

const THEMES = path.join(ROOT, 'themes');
for (const file of fs.readdirSync(THEMES).filter((f) => f.endsWith('.css') && f !== 'patterns.css')) {
  const name = file.replace('.css', '');
  test(`${name}: the spinner's arc stands off its track`, () => {
    const sheet = fs.readFileSync(path.join(THEMES, file), 'utf8');
    const block = (sheet.match(new RegExp('\\[data-theme="' + name + '"\\] \\{([\\s\\S]*?)\\n\\}')) || [])[1] || '';
    const tok = (n) => {
      const m = block.match(new RegExp('--' + n + ':\\s*([^;]+);')) || rootBlock.match(new RegExp('--' + n + ':\\s*([^;]+);'));
      assert.ok(m, 'no --' + n + ' for ' + name);
      const v = m[1].trim();
      const ref = v.match(/^var\(--([\w-]+)\)$/);
      return ref ? tok(ref[1]) : v;
    };
    const surface = hex(tok('velvet-1'));
    const border = tok('border-rgb').split(',').map(Number);
    const track = surface.map((v, i) => v * 0.84 + border[i] * 0.16);
    const r = ratio(hex(tok('lav')), track);
    assert.ok(r >= 3, `${name}: the arc measures ${r.toFixed(2)}:1 on its track, under 3:1`);
  });
}
