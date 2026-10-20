'use strict';

// A wheel over the approval overlay that the card could not use was handed on as a scroll of
// the panel behind it: the blurred list moved under a card that stayed put. The overlay now
// holds any wheel its own scroll regions cannot take. These run the real guard.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function lift(src, decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}
const ctx = vm.createContext({ getComputedStyle: () => ({ overflowY: 'visible' }) });
vm.runInContext(lift(panel, 'function approvalWheelShouldBeHeld(') + '\nthis.f = approvalWheelShouldBeHeld;', ctx);
const held = (target, dy, overlay, styleOf) => ctx.f(target, dy, overlay, styleOf);

// overlay > card > scroll region > content, with the numbers a real card has.
function chain({ sh, ch, top = 0, overflowY = 'auto' } = {}) {
  const overlay = { scrollHeight: 640, clientHeight: 640, scrollTop: 0, parentElement: null, ov: 'visible' };
  const card = { scrollHeight: 600, clientHeight: 600, scrollTop: 0, parentElement: overlay, ov: 'hidden' };
  const region = { scrollHeight: sh, clientHeight: ch, scrollTop: top, parentElement: card, ov: overflowY };
  const content = { scrollHeight: sh, clientHeight: sh, scrollTop: 0, parentElement: region, ov: 'visible' };
  return { overlay, card, region, content, styleOf: (n) => ({ overflowY: n.ov }) };
}

test('a region that can still move in the direction asked takes the wheel', () => {
  const c = chain({ sh: 1000, ch: 400, top: 100 });
  assert.equal(held(c.content, 120, c.overlay, c.styleOf), false, 'down, with room below');
  assert.equal(held(c.content, -120, c.overlay, c.styleOf), false, 'up, with room above');
});

test('a region at its end does not spill into the panel behind', () => {
  const atBottom = chain({ sh: 1000, ch: 400, top: 600 });
  assert.equal(held(atBottom.content, 120, atBottom.overlay, atBottom.styleOf), true, 'down at the bottom');
  assert.equal(held(atBottom.content, -120, atBottom.overlay, atBottom.styleOf), false, 'up from the bottom');
  const atTop = chain({ sh: 1000, ch: 400, top: 0 });
  assert.equal(held(atTop.content, -120, atTop.overlay, atTop.styleOf), true, 'up at the top');
  assert.equal(held(atTop.content, 120, atTop.overlay, atTop.styleOf), false, 'down from the top');
});

test('a card that fits holds every wheel, over the content, the footer and the backdrop', () => {
  const c = chain({ sh: 400, ch: 400 });
  assert.equal(held(c.content, 120, c.overlay, c.styleOf), true, 'over the content');
  assert.equal(held(c.card, 120, c.overlay, c.styleOf), true, 'over the pinned buttons');
  assert.equal(held(c.overlay, -120, c.overlay, c.styleOf), true, 'over the dimmed edge');
});

test('a sideways wheel is held, since nothing in the card scrolls sideways', () => {
  const c = chain({ sh: 1000, ch: 400, top: 100 });
  assert.equal(held(c.content, 0, c.overlay, c.styleOf), true);
});

test('overflow that cannot scroll does not count as room', () => {
  const c = chain({ sh: 1000, ch: 400, top: 100, overflowY: 'hidden' });
  assert.equal(held(c.content, 120, c.overlay, c.styleOf), true);
});

test('a scroller inside the card (a code block) takes the wheel before the card does', () => {
  const c = chain({ sh: 1000, ch: 400, top: 600 });
  const pre = { scrollHeight: 500, clientHeight: 100, scrollTop: 50, parentElement: c.content, ov: 'auto' };
  assert.equal(held(pre, 120, c.overlay, c.styleOf), false, 'the block has room, though the card is at its end');
});

test('the overlay actually holds the wheel it is told to, and the card contains its overscroll', () => {
  const strip = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(strip(panel), /\$\('view-approval'\)\.addEventListener\('wheel', \(e\) => \{\s*if \(approvalWheelShouldBeHeld\(e\.target, e\.deltaY, e\.currentTarget\)\) e\.preventDefault\(\);\s*\}, \{ passive: false \}\);/);
  const rule = css.match(/\.approval-scroll\s*\{[^}]*\}/);
  assert.ok(rule && /overscroll-behavior:\s*contain/.test(rule[0]), '.approval-scroll lost overscroll-behavior: contain');
});

// The card fades its last N px so a long card reads as "more below". With less bottom
// padding than N, the last (N - padding) px of real content stayed dimmed even scrolled to
// the end, and a card that fit had nothing to scroll to reveal it. The invariant, for the
// panel's card and the popup's copy of it: bottom padding >= the fade's height.
test('the approval card never fades real content: bottom padding covers the fade', () => {
  const popup = fs.readFileSync(path.join(ROOT, 'prompt.html'), 'utf8');
  for (const [name, src, selector] of [['styles.css', css, /\.approval-scroll\s*\{[^}]*\}/], ['prompt.html', popup, /\.prompt-scroll\s*\{[^}]*\}/]]) {
    const rule = src.match(selector);
    assert.ok(rule, name + ': the scroll region rule is gone');
    const body = rule[0].replace(/\/\*[\s\S]*?\*\//g, '');
    const pad = body.match(/padding:\s*\d+px\s+\d+px\s+(\d+)px/);
    const fade = body.match(/mask-image:\s*linear-gradient\(to bottom,\s*#000 calc\(100% - (\d+)px\)/);
    assert.ok(pad && fade, name + ': could not read the padding and the fade');
    assert.ok(Number(pad[1]) >= Number(fade[1]), name + ': ' + pad[1] + 'px of bottom padding under a ' + fade[1] + 'px fade dims the end of the content');
  }
});
