'use strict';

// KEYBOARD FOCUS CAN BE SEEN, AND THE QUIET TEXT CAN BE READ, in the real extension and the
// real themes. Measured on the pixels Chrome draws, not on the stylesheet: a theme's
// pattern, gradient or shadow is part of what the eye sees, and a rule can be right while a
// later one hides it.
//
// The ring: a control is focused from the keyboard and photographed, then blurred and
// photographed again. The pixels that changed are the indicator, and WCAG 1.4.11 asks 3:1
// between them and what they replaced. The old ring was a translucent glow at 1.1 to 2.7:1.
// Measuring the change rather than reading an outline is what lets Cast Iron keep its own
// grammar: there borders do not draw, and focus is a line of steel light along a well's
// floor or under a control's rim. It is held to the same 3:1, and to having no outline.
//
// The text: each line is photographed with its glyphs made transparent, the dominant color
// behind them is its background, and the text color is held to 4.5:1 against it (1.4.3).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 400000 };

// In the page: diff two PNG clips, and give the share of changed pixels and the contrast
// between their before and after colors (90th percentile, so antialiased corners do not
// decide it).
const DIFF = (a, b) => `(async () => {
  const load = async (d) => { const i = new Image(); i.src = 'data:image/png;base64,' + d; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height); };
  const A = await load(${JSON.stringify(a)}), B = await load(${JSON.stringify(b)});
  const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let changed = 0; const cr = [];
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
    if (d > 24) { changed++; const l1 = lum(A.data[i], A.data[i + 1], A.data[i + 2]), l2 = lum(B.data[i], B.data[i + 1], B.data[i + 2]); cr.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)); }
  }
  cr.sort((x, y) => x - y);
  return { changed, cr: cr.length ? +cr[Math.floor(cr.length * 0.9)].toFixed(2) : 0 };
})()`;

// In the page: the dominant color of a PNG clip, and the contrast of a CSS color against it.
const AGAINST = (png, color) => `(async () => {
  const i = new Image(); i.src = 'data:image/png;base64,${png}'; await i.decode();
  const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0);
  const d = g.getImageData(0, 0, i.width, i.height).data; const m = new Map();
  for (let k = 0; k < d.length; k += 4) { const key = (d[k] >> 2) + ',' + (d[k + 1] >> 2) + ',' + (d[k + 2] >> 2); const e = m.get(key) || { n: 0, s: [0, 0, 0] }; e.n++; e.s[0] += d[k]; e.s[1] += d[k + 1]; e.s[2] += d[k + 2]; m.set(key, e); }
  let best = null; for (const e of m.values()) if (!best || e.n > best.n) best = e;
  const bg = best.s.map((v) => v / best.n);
  const probe = document.createElement('i'); probe.style.color = ${JSON.stringify(color)}; document.body.append(probe);
  const fg = getComputedStyle(probe).color.match(/[\\d.]+/g).slice(0, 3).map(Number); probe.remove();
  const lum = (p) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
  const a = lum(fg), b = lum(bg);
  return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
})()`;

async function clip(tab, sel, pad = 6) {
  const r = await tab.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
  await sleep(150);
  // A clip is in page coordinates, so the scroll is added back to the box's viewport position.
  const r2 = await tab.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.width, r.height]; })()`);
  const [x, y, w, h] = r2 || r;
  const s = await tab.cdp('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: w + pad * 2, height: h + pad * 2, scale: 1 } });
  return s.data;
}

// The ring a control gets from the keyboard: photographed focused, then blurred. `around` is
// what to photograph when the focusable thing is not what is drawn (a switch's track).
async function ring(tab, sel, around = sel) {
  await tab.evaluate(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
  // A real key first, so the page knows the keyboard is in use and :focus-visible applies.
  await tab.press('Tab');
  await tab.evaluate(`document.querySelector(${JSON.stringify(sel)}).focus({ focusVisible: true })`);
  await sleep(120);
  const outline = await tab.evaluate(`getComputedStyle(document.activeElement).outlineStyle`);
  const on = await clip(tab, around);
  await tab.evaluate(`document.activeElement.blur()`);
  await sleep(120);
  const off = await clip(tab, around);
  return { ...(await tab.evaluate(DIFF(on, off))), outline };
}

// A line of text against what is drawn behind it, with its glyphs hidden. `kind` 'placeholder'
// reads the ::placeholder color.
async function readable(tab, sel, kind = 'text') {
  const color = await tab.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}), ${kind === 'placeholder' ? "'::placeholder'" : 'null'}).color`);
  await tab.evaluate(`(() => { const s = document.createElement('style'); s.id = '__hide'; s.textContent = '*, *::placeholder { -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }'; document.head.append(s); })()`);
  await sleep(100);
  const png = await clip(tab, sel, 0);
  await tab.evaluate(`document.getElementById('__hide').remove()`);
  return tab.evaluate(AGAINST(png, color));
}

async function panel(x, theme) {
  await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { theme, themeBy: {} } });
  const tab = await x.openPage(`chrome-extension://${x.extId}/sidepanel.html`);
  await tab.viewport({ width: 380, height: 900, scale: 1 });
  for (let i = 0; i < 40 && !(await tab.evaluate(`!!document.getElementById('settings-btn')`)); i++) await sleep(250);
  await sleep(1200);
  assert.equal(await tab.evaluate(`document.documentElement.dataset.theme`), theme);
  return tab;
}
async function openSettings(tab) {
  await tab.evaluate(`document.getElementById('settings-btn').click()`); await sleep(800);
  await tab.evaluate(`document.querySelectorAll('#view-settings .settings-section').forEach((s) => s.classList.add('open'))`); await sleep(400);
}

test('keyboard focus draws a ring of at least 3:1 on a button, a field, a checkbox and a switch', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const weak = [];
    for (const theme of ['speakeasy', 'industria', 'cast-iron', 'ben-day', 'werkstatte', 'populuxe']) {
      const tab = await panel(x, theme);
      await openSettings(tab);
      const cases = [
        ['button', '#settings-close'],
        ['field', '#relay-input'],
        ['checkbox', '#pow-toggle'],
        ['switch', '#bootstrap-toggle', '.switch:has(#bootstrap-toggle)'],
      ];
      for (const [what, sel, around] of cases) {
        const r = await ring(tab, sel, around);
        if (r.changed < 20 || r.cr < 3) weak.push(`${theme} ${what}: ${r.changed} px changed, ${r.cr}:1`);
        if (theme === 'cast-iron' && what !== 'switch' && r.outline !== 'none') weak.push(`cast-iron ${what}: drawn as an outline (${r.outline}), not as an edge of light`);
      }
      await tab.close();
    }
    assert.deepEqual(weak, [], 'focus that cannot be seen');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the quiet text the contrast sweep failed now reads at 4.5:1, and chosen chips stand out', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const low = [];
    const need = (label, r, min = 4.5) => { if (r < min) low.push(`${label}: ${r}:1`); };
    for (const theme of ['industria', 'cast-iron', 'metropolis']) {
      const tab = await panel(x, theme);
      await tab.evaluate(`document.querySelector('.tab[data-tab="activity"]').click()`); await sleep(800);
      need(`${theme} "No sites have connected yet."`, await readable(tab, '#sites-list .list-state'));
      await openSettings(tab);
      // Placeholders are held up in the two themes whose --faint failed outright; elsewhere
      // they sit between 3 and 4.5, which is the next pass's.
      if (theme !== 'metropolis') need(`${theme} relay placeholder`, await readable(tab, '#relay-input', 'placeholder'));
      await tab.evaluate(`(() => { const e = document.getElementById('relay-add-error'); e.textContent = 'That is not a relay address.'; e.classList.remove('hidden'); })()`);
      need(`${theme} relay error`, await readable(tab, '#relay-add-error'));
      if (theme === 'cast-iron') {
        // An unchecked box: its edge against the plate, the same before/after measure as the
        // ring, with the box hidden for the "after".
        await tab.evaluate(`document.getElementById('pow-toggle').scrollIntoView({ block: 'center' })`);
        const on = await clip(tab, '#pow-toggle', 3);
        await tab.evaluate(`document.getElementById('pow-toggle').style.visibility = 'hidden'`);
        const off = await clip(tab, '#pow-toggle', 3);
        await tab.evaluate(`document.getElementById('pow-toggle').style.visibility = ''`);
        need('cast-iron unchecked box', (await tab.evaluate(DIFF(on, off))).cr, 3);
      }
      await tab.close();
    }
    // The chosen countdown chip: its label on its fill, and its edge against the panel.
    for (const theme of ['werkstatte', 'industria', 'populuxe', 'jazz-age']) {
      const tab = await panel(x, theme);
      await openSettings(tab);
      const chip = '#countdown-presets .preset-chip.active';
      if (theme === 'werkstatte') need('werkstatte chosen chip label', await readable(tab, chip));
      const edge = await tab.evaluate(`getComputedStyle(document.querySelector('${chip}')).borderTopColor`);
      const around = await tab.evaluate(`(() => { const e = document.querySelector('${chip}'); e.scrollIntoView({ block: 'center' }); const r = e.parentElement.getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.width]; })()`);
      // The panel just above the row of chips.
      const s = await tab.cdp('Page.captureScreenshot', { format: 'png', clip: { x: around[0], y: Math.max(0, around[1] - 5), width: around[2], height: 4, scale: 1 } });
      need(`${theme} chosen chip edge`, await tab.evaluate(AGAINST(s.data, edge)), 3);
      await tab.close();
    }
    // The guide's pages: a card's address, and the footer line.
    const page = await x.openPage(`chrome-extension://${x.extId}/welcome.html`);
    await page.viewport({ width: 1280, height: 900, scale: 1 });
    await sleep(2500);
    need('welcome card address', await readable(page, '.card-url'));
    need('welcome footer tip', await readable(page, '.footer-tip'));
    assert.deepEqual(low, [], 'text or edges below the line');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
