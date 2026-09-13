'use strict';

// Relay Rider.
//
// A canvas game is the one thing in this extension that no other test can see: contrast
// cannot be measured on pixels, and a sprite draws whatever its grid says. So this locks
// down the handful of properties that are checkable and that would actually break
// something, and leaves the rest to playing it.
//
// Four of them:
//
//   1. The page must load its script from a file. An extension page runs under MV3's
//      default `script-src 'self'` and an inline block is not a style mistake, it is a
//      page that silently does nothing.
//   2. The trigger sits inside .brand-foot, which sidepanel.js turns into the About
//      button. Without stopPropagation a tap opens the About card instead, and the door
//      is simply not there.
//   3. Sprite rows are strings. A row one character short paints one column short and
//      nobody notices until the shape looks wrong at 2x.
//   4. The road wanders by a sine and the boxes stand past its right edge. The screen is
//      160px wide. That bound is arithmetic, so it gets checked rather than eyeballed.
//
// And the claim the page makes about itself: it reads nothing and connects to nothing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'relay-rider.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'relay-rider.html'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// Guards have to be matched against code, not against the comments explaining the guard.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

test('the page cannot use an inline script', () => {
  const body = stripComments(html);
  assert.match(body, /<script src="relay-rider\.js"><\/script>/, 'the script is not loaded from a file');
  for (const tag of body.match(/<script[^>]*>/g) || []) {
    assert.match(tag, /\ssrc=/, 'an inline <script> would never run under MV3: ' + tag);
  }
});

test('THE TRIGGER CLOSES THE CARD IT LIVES IN', () => {
  // The mark sits at the foot of the About card now. Closing that card before opening the
  // game is not tidiness: .modal-overlay is z-index 100 and .rider-overlay is 95, so a game
  // opened with the card still up is drawn behind it and the panel looks frozen.
  const src = stripComments(panel);
  const at = src.indexOf("className: 'about-rig'");
  assert.ok(at !== -1, 'the About card has no mark on it');
  const block = src.slice(at, at + 260);
  assert.match(block, /closeModal\(\);\s*openRider\(\);/, 'the game opens behind the card that opened it');

  // Appended to the card, not merely constructed.
  const about = src.slice(src.indexOf('function aboutModal('), src.indexOf('async function creatorZapModal('));
  assert.match(about, /about-links'[^;]*\),\s*\n\s*rig,/s, 'the mark is built but never added to the card');

  // Emptied rather than left off: a missing title is inherited from an ancestor, and an
  // ornament reading "About Sidecar" on hover is a small lie.
  assert.match(block, /title: '',/, 'the mark has no suppressed tooltip');
  assert.match(block, /ariaLabel: 'Relay Rider'/, 'the mark is an unlabeled button to a screen reader');

  // And nothing is left behind in the settings footer it used to live in.
  assert.doesNotMatch(panelHtml, /foot-rig/, 'the old footer button is still in the markup');
  assert.doesNotMatch(css, /\.foot-rig/, 'the old footer rule is still in the stylesheet');
  const feet = [...panelHtml.matchAll(/<div class="brand-foot">/g)];
  assert.equal(feet.length, 2, 'the footer count changed');

  // A mask, not an <img>: an <img> is its own document and cannot inherit the theme's ink.
  assert.match(css, /\.about-rig \{[^}]*background-color: var\(--muted\)/s, 'the mark stopped following the theme');
  assert.match(css, /-webkit-mask: url\('icons\/sidecar-rig\.svg'\)/, 'the mask lost its art');
  assert.ok(fs.existsSync(path.join(ROOT, 'icons/sidecar-rig.svg')), 'the art file is missing, so the button is a blank rectangle');

  // The supplied art sat in a 1200x1200 square with 210 units of nothing above and below.
  // Left that way it renders at two thirds the size it should and the detail turns to mud,
  // so the tight box is the thing worth holding onto, not the fact that a file exists.
  const art = fs.readFileSync(path.join(ROOT, 'icons/sidecar-rig.svg'), 'utf8');
  const vb = art.match(/viewBox="([^"]+)"/);
  assert.ok(vb, 'the art has no viewBox, so it cannot scale');
  const [, , vw, vh] = vb[1].split(/\s+/).map(Number);
  assert.ok(vw / vh > 1.2, 'the art is back in a square box and renders small');
  assert.doesNotMatch(art, /\sfill="/, 'a fill on the art fights the mask');
});

test('NOTHING OF THE GAME RUNS UNTIL IT IS ASKED FOR', () => {
  // It lives in a frame inside the panel. A frame with a src in the markup would start a
  // render loop the moment the panel opened, every time, forever, for a page nobody asked
  // to see; and clearing that src is the entire teardown, audio context included.
  assert.match(panelHtml, /<iframe id="rider-frame" title="Relay Rider"><\/iframe>/,
    'the frame carries a src in the markup, so the game loads with the panel');

  const src = stripComments(panel);
  const open = src.slice(src.indexOf('function openRider('), src.indexOf('function closeRider('));
  assert.match(open, /frame\.src = 'relay-rider\.html'/, 'opening does not load the game');
  assert.match(open, /contentWindow\.focus\(\)/, 'keys would go to the panel behind it, not the game');

  const close = src.slice(src.indexOf('function closeRider('), src.indexOf('function closeRider(') + 500);
  assert.match(close, /\$\('rider-frame'\)\.src = ''/, 'closing leaves the game running in the background');
});

test('AN APPROVAL IS NEVER BEHIND A GAME', () => {
  // A signing request is a security surface. Rather than trusting every route that reveals
  // one to also close the game, the elements are watched, so a caller added later cannot
  // forget. The z-index ordering is the second line of defense behind that.
  const src = stripComments(panel);
  const at = src.indexOf("for (const id of ['view-approval', 'view-lock'])");
  assert.ok(at !== -1, 'nothing watches the approval and lock views');
  const block = src.slice(at, at + 320);
  assert.match(block, /new MutationObserver/, 'the watch is not a watch');
  assert.match(block, /closeRider\(\)/, 'the game is not closed when one appears');

  // Comments stripped first: styles.css has prose that names other selectors, and a
  // comment-blind match will happily bridge from a selector mentioned in a comment to the
  // next real rule's z-index. That is how this very rule was first measured wrong.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const z = (sel) => Number(bare.match(new RegExp(sel.replace('.', '\\.') + '\\s*\\{[^}]*?z-index:\\s*(\\d+)', 's'))[1]);
  // Under EVERY modal, not merely under the approval. The 100..120 band is reserved by
  // approval-over-modal.test.js so that nothing clickable can take a click meant for
  // Allow or Reject, and a game is not worth an exception to that.
  assert.ok(z('.rider-overlay') < z('.modal-overlay'),
    'the game is in the reserved band where it could intercept an approval click');
});

test('every sprite row is the same length', () => {
  const names = ['RIG', 'BOX', 'CAN', 'BIKE', 'HOLE_S', 'HOLE_M', 'HOLE_L'];
  for (const name of names) {
    const m = js.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'));
    assert.ok(m, name + ' is gone');
    const rows = [...m[1].matchAll(/'([^']*)'/g)].map((r) => r[1]);
    assert.ok(rows.length > 3, name + ' has almost no rows');
    const widths = new Set(rows.map((r) => r.length));
    assert.equal(widths.size, 1, name + ' is ragged: widths ' + [...widths].join(', '));
    // Every character has to be in the palette or it paints undefined, which is invisible.
    const legend = new Set(js.match(/const key = \{([\s\S]*?)\};/)[1].match(/(\w|'\w')(?=:)/g).map((c) => c.replace(/'/g, '')));
    for (const row of rows) {
      for (const ch of row) {
        assert.ok(ch === '.' || ch === '#' || legend.has(ch), name + ' uses an unmapped color "' + ch + '"');
      }
    }
  }
});

test('THE LETTERS THAT NEED A MIDDLE COLUMN HAVE ONE', () => {
  // Found by reading the screen: MAIL read as HAIL. The font was four wide, so there was
  // no middle column, and M could only be drawn as H with its top row filled in. A tiny
  // font's failure mode is not an ugly letter, it is a word that reads as a different word.
  //
  // Pixel distance is the wrong test for it: that bad M was three pixels from H and would
  // have passed. What was actually missing is a stroke reaching the middle of the cell with
  // space either side, which is the one thing four columns cannot hold, so that is what is
  // checked. It is also, exactly, why the font is five wide and not four.
  const body = js.slice(js.indexOf('const F = {'), js.indexOf('const textW'));
  const glyphs = {};
  for (const m of body.matchAll(/^\s+('.'|[A-Z0-9]): \[([^\]]*)\],$/gm)) {
    glyphs[m[1].replace(/'/g, '')] = m[2].split(',').map((c) => c.trim().replace(/'/g, ''));
  }
  const names = Object.keys(glyphs);
  assert.ok(names.length >= 40, 'only parsed ' + names.length + ' glyphs, the font moved');
  for (const n of names) {
    assert.equal(glyphs[n].length, 5, JSON.stringify(n) + ' is not 5 rows');
    for (const row of glyphs[n]) assert.equal(row.length, 5, JSON.stringify(n) + ' has a row that is not 5 wide');
  }

  // An interior stroke: the center column lit, with air on at least one side of it. A
  // solid bar through the middle does not count, because that is what H already has.
  const hasStem = (g) => g.some((r) => r[2] === '#' && (r[1] === '.' || r[3] === '.'));
  for (const n of ['M', 'N', 'W', 'X', 'Y', 'V', 'T', 'I']) {
    assert.ok(hasStem(glyphs[n]), n + ' has no interior stroke, so it reads as a filled-in neighbor');
  }
  assert.ok(!hasStem(glyphs.H), 'H grew a stem, which is the collision from the other side');

  // And nothing may be an outright duplicate or one pixel from one.
  const blank = (n) => glyphs[n].every((r) => r === '.....');
  for (const a of names) {
    for (const b of names) {
      if (a >= b || blank(a) || blank(b)) continue;
      let d = 0;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (glyphs[a][r][c] !== glyphs[b][r][c]) d++;
      assert.ok(d >= 2, JSON.stringify(a) + ' and ' + JSON.stringify(b) + ' are ' + d + ' pixel apart');
    }
  }
});

test('EVERY PANEL SIZE FILLS, AND NO FIELD IS TOO SHORT TO STEER', () => {
  // "It fills the panel" is a claim, and a claim checked at the three sizes someone
  // happened to try is not checked. playfield() is pure for exactly this: run the shipped
  // rule across the whole range Chrome gives a side panel and look at every answer.
  const ctx = { Math };
  vm.createContext(ctx);
  const lift = (decl) => {
    const at = js.indexOf(decl);
    assert.ok(at !== -1, 'could not find ' + decl);
    const open = js.indexOf('{', js.indexOf('(', at));
    let depth = 0;
    for (let i = open; i < js.length; i++) {
      if (js[i] === '{') depth++;
      else if (js[i] === '}' && --depth === 0) return js.slice(at, i + 1);
    }
    throw new Error('unbalanced braces after ' + decl);
  };
  vm.runInContext(
    [
      js.match(/const TARGET_W = \d+;/)[0],
      js.match(/const MIN_H = \d+;/)[0],
      js.match(/const MIN_W = \d+;/)[0],
      js.match(/const RATIO = .*/)[0],
      lift('function playfield('),
      'globalThis.pf = playfield;',
      'globalThis.consts = { MIN_W, MIN_H, RATIO };',
    ].join('\n'),
    ctx
  );
  const { MIN_W, MIN_H, RATIO } = ctx.consts;
  assert.ok(Math.abs(RATIO - 9 / 16) < 1e-9, 'the ceiling is no longer 9:16');

  // Panels and browser tabs both, because the ceiling is what stops a maximized tab from
  // turning the game into a rig adrift in a field of grass.
  const sizes = [];
  for (let pw = 320; pw <= 520; pw += 10) for (let ph = 420; ph <= 960; ph += 20) sizes.push([pw, ph, true]);
  for (const wide of [[1280, 577], [1440, 900], [1680, 1050], [1920, 1080], [2560, 1440]]) sizes.push([...wide, false]);

  for (const [pw, ph, isPanel] of sizes) {
    const p = ctx.pf(pw, ph);
    const at = pw + 'x' + ph + ' at ' + p.s + 'x: ';
    // NEVER WIDER THAN 9:16. This is the ceiling, so it is checked as one.
    assert.ok(p.w / p.h <= RATIO + 1e-9, at + 'field is ' + (p.w / p.h).toFixed(3) + ' wide, past 9:16');
    // Height fills; width letterboxes by whatever the ceiling costs, and never more.
    assert.ok(ph - p.h * p.s < p.s, at + 'letterboxed ' + (ph - p.h * p.s) + 'px vertically');
    assert.ok(p.w * p.s <= pw, at + 'canvas is wider than the window');
    assert.ok(p.h >= MIN_H, at + 'only ' + p.h + ' rows of road, too short to see a box coming');
    assert.ok(p.w >= MIN_W, at + 'only ' + p.w + ' columns, narrower than the text drawn on it');
    if (isPanel) assert.ok(p.s > 1, at + 'a 15px rig drawn 15px wide is not a rig');
  }

  // The title panel grew when the name got its own face and its own air either side of it.
  // It has to fit between the HUD and the bottom of the SHORTEST field the rule above can
  // hand out, and there it is exact, so it is worth a line rather than a hope.
  const titleFn = js.slice(js.indexOf('function overlayTitle('), js.indexOf('function overlayOver('));
  const panelH = Number(titleFn.match(/blockTop\((\d+)\)/)[1]);
  const hud = Number(js.match(/const HUD_H = (\d+);/)[1]);
  assert.ok(panelH + hud + 4 <= MIN_H,
    'the title panel is ' + panelH + ' tall and will not fit a ' + MIN_H + ' row field under a ' + hud + ' row HUD');
  // blockTop is what keeps it on screen once it no longer centers comfortably.
  assert.match(stripComments(js), /Math\.max\(HUD_H \+ 2, Math\.min\(Math\.round\(\(H - h\) \/ 2\), H - h - 2\)\)/,
    'blockTop no longer clamps to the bottom, so a tall panel can fall off it');
});

test('ARROWS AND WASD STAY PAIRED, AND SOUND IS NOT ONE OF THEM', () => {
  // Both sets have always worked and nothing said so, which for a player is the same as
  // not working. The pairing is what to hold onto: every action an arrow reaches, a letter
  // must reach, or the title screen starts telling a lie.
  const src = stripComments(js);
  const map = src.match(/const ACTION = \{([\s\S]*?)\};/)[1];
  const keys = Object.fromEntries([...map.matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]));
  for (const [arrow, letter] of [['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD'], ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']]) {
    assert.ok(keys[arrow], arrow + ' is unmapped');
    assert.equal(keys[letter], keys[arrow], letter + ' does not do what ' + arrow + ' does');
  }
  // Nothing on screen names WASD any more: the arrows are drawn because they are the keys
  // someone needs, and the letters are left for finding. That makes this test the only
  // thing in the project that would notice them breaking, which is the reason to keep it.
  assert.doesNotMatch(src, /textMid\('[^']*WASD/, 'the title advertises WASD, which is meant to be found');
  assert.match(src, /textMid\('←→ ARROWS TO STEER'/, 'the steering line no longer shows the arrow keys');
  // All four directions drawn, none of them spelled. Naming two in words while the other
  // two are arrows made the block read as two different legends stacked on each other.
  assert.match(src, /textMid\('↑ GAS {2}↓ BRAKE'/, 'gas and brake no longer show their arrows');
  assert.doesNotMatch(src, /textMid\('UP [^']*DOWN/, 'two directions are spelled out while the others are drawn');
  for (const arrow of ['←', '→', '↑', '↓']) {
    assert.ok(js.includes("'" + arrow + "': ["), 'the font has no ' + arrow + ' glyph, so that line draws a gap');
  }

  // THE FOUR ARROWS ARE ONE GLYPH TURNED. Drawn freehand, the vertical pair came out with a
  // solid bar across the middle, which is a horizontal arrow's shaft: both rendered as a
  // cross and up was one row from down. Transposing is the definition, so it is the check.
  const arrow = (ch) => {
    const m = js.match(new RegExp("'" + ch + "': \\[([^\\]]*)\\]"));
    return [...m[1].matchAll(/'([^']*)'/g)].map((r) => r[1]);
  };
  const transpose = (rows) => rows[0].split('').map((_, c) => rows.map((r) => r[c]).join(''));
  assert.deepEqual(transpose(arrow('←')), arrow('↑'), 'the up arrow is not the left arrow turned');
  assert.deepEqual(transpose(arrow('→')), arrow('↓'), 'the down arrow is not the right arrow turned');

  // Sound cannot sit on a letter the movement keys need, which is exactly why it is not on
  // S. Whatever it is, the title has to name the same one the handler listens for.
  const sound = src.match(/if \(e\.code === '(\w+)'\) \{ toggleSound\(\)/)[1];
  assert.ok(!keys[sound], sound + ' is a movement key as well as the sound key');
  assert.ok(!['KeyP', 'Space', 'Enter'].includes(sound), sound + ' collides with pause or start');
  assert.match(src, new RegExp('\\b' + sound.replace('Key', '') + ' SOUND\\b'),
    'the title names a different sound key than the handler listens for');
});

test('EVERY POP IS LEGIBLE WHEREVER IT LANDS', () => {
  // Reported as "MISSED too hard to see", and it measured 1.07:1 against the road. The one
  // message that teaches the delivery window was invisible on the surface it most often
  // landed on, and it blinked off a third of the time while it was there.
  //
  // A pop can land on road, grass, water or a mailbox, so no single ink is safe. The fix is
  // a dark plate under every one of them, which is checkable: the plate has to be drawn,
  // and each ink has to clear the floor over it on all four.
  const src = stripComments(js);
  assert.match(src, /ctx\.fillStyle = C\.plate;/, 'pops no longer draw a plate');
  assert.match(src, /ctx\.fillRect\(x - 3, y - 3, textW\(p\.txt, p\.k\) \+ 6/, 'the plate does not cover the text');

  const pal = Object.fromEntries([...src.matchAll(/(\w+): '(#[0-9a-f]{6})'/g)].map((m) => [m[1], m[2]]));
  const alpha = Number(src.match(/plate: 'rgba\(14, 14, 20, ([\d.]+)\)'/)[1]);
  const hx = (h) => [0, 2, 4].map((i) => parseInt(h.slice(1).substr(i, 2), 16));
  const lum = (c) => {
    const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const plateOver = (bg) => hx(bg).map((v) => v * (1 - alpha) + 14 * alpha);

  // WCAG's floor for a graphical object, the same one the panel's own themes are held to.
  const FLOOR = 3;
  for (const bgName of ['road', 'grass', 'water', 'red']) {
    const plate = plateOver(pal[bgName]);
    for (const inkName of ['miss', 'cream', 'fuelOk']) {
      const got = ratio(hx(pal[inkName]), plate);
      assert.ok(got >= FLOOR,
        inkName + ' on a plate over ' + bgName + ' is ' + got.toFixed(2) + ':1, under ' + FLOOR + ':1');
    }
  }

  // And it should not spend a third of its life invisible: blink only as it runs out.
  assert.match(src, /if \(p\.t < 14 && p\.t % 4 < 2\) continue;/, 'pops blink throughout again');
  // Single size, not double. The plate is what made it readable; at double it was shouting
  // a correction at someone who had only been a few pixels out.
  assert.match(src, /pop\('MISSED'[^;]*, 1, 84\);/, 'the miss is no longer held long, or went back to double size');
});

test('the HUD fits on the narrowest field, close button and all', () => {
  // Two counters, one at each edge, on a field that can be 116 wide. They do not both fit
  // there, so the rule is a fallback chain rather than a layout, and the chain is what
  // gets checked: shorter label first, then drop the scene, and never overlap either way.
  const width = (t) => t.length * 6 - 1;
  const MIN_W = Number(js.match(/const MIN_W = (\d+);/)[1]);
  for (const W of [MIN_W, 130, 146, 162, 174, 202, 260]) {
    const gutter = Math.ceil(46 / 2);
    const sc = 'SCENE 99';
    let label = 'DELIVERED 999';
    if (4 + width(label) + 8 + width(sc) + gutter > W) label = 'SENT 999';
    const scX = W - gutter - width(sc);
    const shown = scX >= 4 + width(label) + 8;
    assert.ok(4 + width(label) <= W - 4, 'W=' + W + ': the counter alone runs off');
    if (shown) assert.ok(scX + width(sc) <= W, 'W=' + W + ': the scene counter runs off');
    if (shown) assert.ok(scX >= 4 + width(label) + 8, 'W=' + W + ': the counters collide');
  }
  // And the source has to actually do that, not just be capable of it.
  const src = stripComments(js);
  assert.match(src, /label = 'SENT ' \+ pad\(mail, 3\)/, 'the label has no narrow fallback');
  assert.match(src, /if \(scX >= 4 \+ textW\(label\) \+ 8\) text\(sc/, 'the scene counter is drawn unconditionally');

  // THE FUEL GAUGE ENDS BEFORE THE CLOSE BUTTON. The panel floats that button over the
  // top-right corner in CSS pixels, and the gauge used to run the full width underneath it.
  // Of everything that could be covered there, the gauge is the worst choice: it is the
  // only thing on screen that ends a run, and it is the LAST quarter of it that matters.
  assert.match(src, /const bw = W - 6 - gutter;/, 'the gauge no longer stops short of the button');
  for (const W of [MIN_W, 146, 162, 174, 202, 260]) {
    const gutter = Math.ceil(46 / 2);           // at 2x, the scale a side panel lands on
    const gaugeRight = 4 + (W - 6 - gutter) + 2;
    const buttonLeft = W - Math.ceil(40 / 2);   // 30px button plus its 10px inset
    assert.ok(gaugeRight <= buttonLeft,
      'W=' + W + ': the gauge reaches ' + gaugeRight + ' and the button starts at ' + buttonLeft);
  }
});

test('RESIZING DOES NOT TURN THE GAME INTO A SMEAR', () => {
  // Assigning canvas.width resets the entire 2D context, imageSmoothingEnabled with it.
  // fit() does exactly that on load and on every resize, so it has to put the flag back
  // afterwards. Miss it and a resized game is a bilinear blur of an 8-bit one, which is
  // the whole look gone, and nothing else in the file would notice.
  const src = stripComments(js);
  const at = src.indexOf('function fit(');
  assert.ok(at !== -1, 'fit() moved');
  const fn = src.slice(at, src.indexOf('\n  }', at));
  assert.match(fn, /cv\.width = W/, 'the backing store is no longer sized to the playfield');
  assert.ok(fn.indexOf('imageSmoothingEnabled = false') > fn.indexOf('cv.width = W'),
    'smoothing is not restored after the context reset, so a resize blurs everything');
  // And the playfield has to come from the window, or "fills the panel" is a claim only.
  // The rule itself lives in playfield(), which the test above exercises directly.
  assert.match(fn, /playfield\(innerWidth, innerHeight\)/, 'the playfield is no longer sized from the window');
  assert.match(stripComments(js), /const w = Math\.min\(Math\.floor\(pw \/ s\), Math\.floor\(h \* RATIO\)\)/,
    'the scale is not an integer divisor of the window, or the ratio stopped capping it');
});

test('no line of text runs off the narrowest playfield', () => {
  // The playfield is the panel width over an integer scale, so it is not one number. It is
  // narrowest just above a rounding boundary: at a 285px panel the scale ticks to 2 and
  // leaves 142 logical pixels, which is the tightest case the rule can produce.
  const SCREEN = Number(js.match(/const MIN_W = (\d+);/)[1]);
  const width = (t) => t.length * 6 - 1;   // 5px glyph plus a 1px gap, matching textW
  const lits = [];
  for (const line of js.split('\n')) {
    if (line.trim().startsWith('//')) continue;
    if (!/\b(text|textMid|pop)\(/.test(line)) continue;
    for (const m of line.matchAll(/'([^']*)'/g)) lits.push(m[1]);
  }
  assert.ok(lits.length > 10, 'the draw calls moved, only found ' + lits.length + ' strings');
  for (const t of lits) {
    assert.ok(width(t) <= SCREEN - 8, JSON.stringify(t) + ' is ' + width(t) + 'px wide, past the margins');
  }
  // The title is set in its own display face, which the scan above cannot measure. It is
  // used only when the field is wide enough, and the guard is written in terms of the same
  // titleW() that draws it, so the two cannot drift apart.
  assert.match(js, /if \(W >= titleW\('RELAY RIDER'\) \+ 8\) titleText\('RELAY RIDER'/,
    'the title no longer checks it fits before using the display face');

  const tf = js.slice(js.indexOf('const TF = {'), js.indexOf('const titleW'));
  const glyphs = Object.fromEntries(
    [...tf.matchAll(/^\s+([A-Z]): \[([\s\S]*?)\],$/gm)]
      .map((m) => [m[1], [...m[2].matchAll(/'([^']*)'/g)].map((r) => r[1])])
  );
  const gh = Number(js.match(/const TITLE_H = (\d+);/)[1]);
  for (const ch of 'RELAYID') {
    assert.ok(glyphs[ch], 'the display face has no ' + ch + ', so the title draws a gap');
    assert.equal(glyphs[ch].length, gh, ch + ' is not ' + gh + ' rows');
    const w = glyphs[ch][0].length;
    for (const row of glyphs[ch]) assert.equal(row.length, w, ch + ' has a row that is not ' + w + ' wide');
  }

  // EVERY GLYPH TIGHT TO ITS OWN INK. This is what makes the spacing even, and it is what
  // the first cut got wrong: with a fixed cell, an I carried four columns of built-in
  // margin that an A did not, so the letters were evenly spaced by arithmetic and visibly
  // uneven to the eye. An empty edge column is a hidden margin, so there must not be one,
  // and then the gap between letters is the only thing setting the rhythm.
  for (const ch of 'RELAYID') {
    const rows = glyphs[ch];
    const w = rows[0].length;
    assert.ok(rows.some((r) => r[0] === '#'), ch + ' has an empty first column, a margin the gap cannot see');
    assert.ok(rows.some((r) => r[w - 1] === '#'), ch + ' has an empty last column, a margin the gap cannot see');
  }
  // And the widths must actually differ, or it is a grid again wearing proportional clothes.
  const widths = new Set([...'RELAYID'].map((ch) => glyphs[ch][0].length));
  assert.ok(widths.size >= 3, 'every letter is the same width, so this is still a fixed cell');
  // Two-pixel stems, and slab serifs. The serif is the point of this face: an arm or a foot
  // that overhangs its stem by a pixel each side. Checked as "the first or last row is
  // wider than the rows between", which is what a slab IS at ten pixels.
  for (const ch of 'RELAYID') {
    assert.ok(glyphs[ch].some((r) => /##/.test(r)), ch + ' has no two-pixel stem');
  }
  // L I D Y are the four whose stem simply ends at the top AND the bottom, with no arm or
  // apex doing the work. Both ends of each must overhang the stem, which is what a slab is
  // at ten pixels. Checked on both ends, because one end passing is how a face loses half
  // its serifs without anything noticing.
  for (const ch of 'LIDY') {
    const ink = glyphs[ch].map((r) => r.replace(/\./g, '').length);
    assert.ok(ink[0] > ink[7], ch + ' has no slab at the top: ' + ink[0] + ' wide against a ' + ink[7] + ' wide stem');
    assert.ok(ink[13] > ink[7], ch + ' has no slab at the foot: ' + ink[13] + ' wide against a ' + ink[7] + ' wide stem');
  }
});

test('NO MAILBOX CAN LEAVE THE SCREEN, AT ANY ROAD WIDTH OR PANEL SIZE', () => {
  // Runs the shipped applyScene and roadMid rather than restating them, so the day the
  // curve gets a third sine term this fails instead of agreeing with a stale copy.
  //
  // The playfield is no longer 160 wide: it is whatever the panel gave us divided by an
  // integer scale, so the bound has to hold across the whole range of that, not at one
  // number. Both ends are covered: 140 is about the narrowest the scale rule can produce,
  // and a maximized browser tab lands near 240.
  const ctx = { Math, roadHalf: 0, curveAmp: 0, maxSpeed: 0, scene: 1, W: 160, BOX_W: 9, VERGE: 3 };
  vm.createContext(ctx);
  const lift = (decl) => {
    const at = js.indexOf(decl);
    assert.ok(at !== -1, 'could not find ' + decl);
    const open = js.indexOf('{', js.indexOf('(', at));
    let depth = 0;
    for (let i = open; i < js.length; i++) {
      if (js[i] === '{') depth++;
      else if (js[i] === '}' && --depth === 0) return js.slice(at, i + 1);
    }
    throw new Error('unbalanced braces after ' + decl);
  };
  // roadMid's body is on its own line, and `const f = (wy) =>` followed by the next
  // statement is valid JavaScript that quietly swallows it. Match to the semicolon, and
  // assert the arrow actually arrived rather than finding out by way of an empty export.
  const roadMidSrc = js.match(/const roadMid = \(wy\) =>[\s\S]*?;/)[0];
  assert.match(roadMidSrc, /Math\.sin/, 'the curve was lifted without its body');
  vm.runInContext(
    [
      lift('function applyScene('),
      roadMidSrc,
      js.match(/const roadL = .*/)[0],
      js.match(/const roadR = .*/)[0],
      'globalThis.out = { applyScene, roadL, roadR };',
    ].join('\n'),
    ctx
  );

  // The grid and the planting distance, both checked elsewhere in this file.
  const BOX_W = 9;
  const VERGE = 3;
  for (const W of [140, 150, 160, 180, 190, 210, 240, 280]) {
  ctx.W = W;
  for (let scene = 1; scene <= 25; scene++) {
    ctx.scene = scene;
    ctx.out.applyScene();
    let worst = 0;
    let leftMost = W;
    // Two sines of incommensurate period: sample far enough to catch them in phase.
    for (let wy = 0; wy < 40000; wy += 7) {
      worst = Math.max(worst, ctx.out.roadR(wy) + VERGE + BOX_W);
      leftMost = Math.min(leftMost, ctx.out.roadL(wy));
    }
    const where = 'W=' + W + ' scene ' + scene + ': ';
    assert.ok(worst <= W, where + 'a mailbox reaches x=' + worst.toFixed(1) + ', off a ' + W + 'px screen');
    assert.ok(leftMost >= 0, where + 'the road reaches x=' + leftMost.toFixed(1) + ', off the left edge');
    // A road you cannot fit the rig down is not a difficulty curve, it is a wall. The rig
    // is 15 wide and has to have somewhere to be that is not against a box.
    assert.ok(ctx.roadHalf * 2 >= 40, where + 'the road narrowed to ' + (ctx.roadHalf * 2).toFixed(1) + 'px');
  }
  }
});

test('it reads nothing and connects to nothing', () => {
  // The page says so in its own header comment, and a claim in a comment is worth what
  // the test under it is worth. localStorage for a high score is the whole of its state.
  const src = stripComments(js) + stripComments(html);
  for (const forbidden of [/chrome\.storage/, /chrome\.runtime/, /\bfetch\s*\(/, /WebSocket/, /XMLHttpRequest/, /sidecar_settings/]) {
    assert.doesNotMatch(src, forbidden, 'the game touches ' + forbidden + ', which its header says it does not');
  }
  assert.match(src, /localStorage/, 'the high score is not stored at all');
  // No remote anything: a store review treats one <img> from a CDN as a policy problem.
  assert.doesNotMatch(src, /https?:\/\/(?!www\.w3\.org)/, 'the page references a remote URL');
});
