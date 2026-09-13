'use strict';

// Relay Rider.
//
// Atari's Motocross (1983) is an overhead scroller with four controls: throttle, brake,
// and lateral steering. You weave through riders, the scene counter ticks over, and the
// fuel gauge is the clock. Everything below is that loop with one substitution.
//
// The substitution is the sidecar. Ours hangs off the right, so the mail goes in it and
// the boxes stand on the right verge: a delivery is a close pass on the blind side, with
// the pavement ending a few pixels past the box. Too far out and you miss the box; too
// far in and you hit it. That window is the game, and it is the silhouette in the
// wordmark doing the work rather than being decoration.
//
// Drawn at 160x240 and integer-scaled, every coordinate rounded, no sub-pixel anything.

(() => {
  // THE PLAYFIELD IS SIZED TO THE WINDOW, not fixed. This runs in a side panel, and
  // letterboxing a game inside a 360px panel wastes the only space there is.
  //
  // Integer scale is not negotiable: a fractional one resamples, and the whole look is a
  // hard edge between one pixel and the next. So the LOGICAL size moves instead. Pick the
  // scale from the width, then divide: a 360x620 panel at 2x is a 180x310 playfield, a
  // little more road than the 160x240 this was drawn for, reading exactly the same.
  //
  // Everything downstream is written as a fraction of W or an offset from H rather than as
  // a number that happens to suit 160x240.
  const TARGET_W = 190;        // the playfield width we aim for when there is a choice
  const MIN_H = 190;           // rows of road below which you cannot see far enough to steer
  const MIN_W = 116;           // narrower than this and the title text runs off the sides
  const RATIO = 9 / 16;        // the widest the field may ever get; past it, letterbox
  const HUD_H = 20;            // dark band along the top; the road starts under it
  let W = 160;
  let H = 240;
  let scale = 2;
  let RIG_Y = 200;             // the rider never moves vertically, the world does
  let AHEAD = 300;             // spawn this far up-road, comfortably off screen

  const cv = document.getElementById('screen');
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  // ---- palette ------------------------------------------------------------------------
  // Yellow rig, red boxes, gray road: the livery of a Danish post office sidecar, which is
  // also the only three-color scheme where the thing you steer, the thing you aim at, and
  // the thing you stay on can never be confused at this size.
  const C = {
    grass: '#3b4a2b', grassLit: '#46583a', grassDot: '#55683f',
    road: '#6e6e6e', edge: '#8f8f8f', dash: '#d9d2bd',
    yellow: '#f2c12e', yellowDim: '#b9902a',
    dark: '#1b1b22', rider: '#2f2f3a',
    cream: '#efe6cd', red: '#c0272d', redDull: '#6c3a3c',
    hud: '#14141a', ink: '#efe6cd', inkDim: '#7e788c',
    guide: '#caa23c', miss: '#ff6a5e', plate: 'rgba(14, 14, 20, 0.84)',
    fuelOk: '#6fbf5e', fuelLow: '#d8452f',
    hole: '#23232a',
    water: '#33566f', ripple: '#4b7695', shore: '#6d7049',
    bikes: ['#2f5d8a', '#6b3f7a', '#3c6b4a', '#8a5a2a', '#5a5a6e'],
  };

  // ---- 5x5 bitmap font ----------------------------------------------------------------
  // Hand-set rather than canvas fillText: a system font scaled up is a system font, and
  // the one thing an 8-bit screen cannot have on it is anti-aliased Helvetica.
  //
  // Five wide, not four. At four there is no middle column, so M could only be H with its
  // top row filled in, and MAIL read as HAIL. The letters that need a center stroke are M,
  // N, W, X and Y, and all five of them are the reason for the extra pixel.
  const F = {
    A: ['.###.', '#...#', '#####', '#...#', '#...#'],
    B: ['####.', '#...#', '####.', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '.####'],
    D: ['####.', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '####.', '#....', '#####'],
    F: ['#####', '#....', '####.', '#....', '#....'],
    G: ['.####', '#....', '#..##', '#...#', '.###.'],
    H: ['#...#', '#...#', '#####', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '#####'],
    J: ['....#', '....#', '....#', '#...#', '.###.'],
    K: ['#...#', '#..#.', '###..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '####.', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#..#.', '.##.#'],
    R: ['####.', '#...#', '####.', '#..#.', '#...#'],
    S: ['.####', '#....', '.###.', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
    Z: ['#####', '...#.', '..#..', '.#...', '#####'],
    0: ['.###.', '#..##', '#.#.#', '##..#', '.###.'],
    1: ['..#..', '.##..', '..#..', '..#..', '.###.'],
    2: ['####.', '....#', '.###.', '#....', '#####'],
    3: ['####.', '....#', '.###.', '....#', '####.'],
    4: ['#..#.', '#..#.', '#####', '...#.', '...#.'],
    5: ['#####', '#....', '####.', '....#', '####.'],
    6: ['.###.', '#....', '####.', '#...#', '.###.'],
    7: ['#####', '....#', '...#.', '..#..', '..#..'],
    8: ['.###.', '#...#', '.###.', '#...#', '.###.'],
    9: ['.###.', '#...#', '.####', '....#', '.###.'],
    ' ': ['.....', '.....', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '..#..'],
    ':': ['.....', '..#..', '.....', '..#..', '.....'],
    '!': ['..#..', '..#..', '..#..', '.....', '..#..'],
    '-': ['.....', '.....', '.###.', '.....', '.....'],
    '+': ['.....', '..#..', '.###.', '..#..', '.....'],
    '/': ['....#', '...#.', '..#..', '.#...', '#....'],
    // Keyed by the actual arrow characters rather than by ASCII stand-ins, so a line of
    // control text reads in the source as what it draws on screen. toUpperCase leaves them
    // alone, which is the only thing text() does to a string before looking it up.
    '←': ['..#..', '.#...', '#####', '.#...', '..#..'],
    '→': ['..#..', '...#.', '#####', '...#.', '..#..'],
    // Each of these four is the same glyph turned a quarter, which is why the set reads as
    // a set. The first cut drew the vertical pair with a solid bar across the middle, which
    // is a HORIZONTAL arrow's shaft: both of them came out as a cross, and up and down were
    // one row apart from each other.
    '↑': ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
    '↓': ['..#..', '..#..', '#.#.#', '.###.', '..#..'],
  };

  // `k` draws each font pixel as a k by k block, which is how a bitmap font gets bigger
  // without getting soft. Everything stays on the same grid.
  const textW = (s, k) => s.length * 6 * (k || 1) - (k || 1);

  function text(s, x, y, color, k) {
    k = k || 1;
    ctx.fillStyle = color;
    let cx = x;
    for (const ch of String(s).toUpperCase()) {
      const g = F[ch] || F[' '];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) if (g[r][c] === '#') ctx.fillRect(cx + c * k, y + r * k, k, k);
      }
      cx += 6 * k;
    }
  }

  const textMid = (s, y, color, k) => text(s, Math.round((W - textW(s, k)) / 2), y, color, k);

  // ---- title face ----------------------------------------------------------------------
  // A display face for the title alone: seven letters and a space, which is all the name
  // needs. The body font is 5x5 and deliberately utilitarian, which is right for a HUD and
  // wrong for a name, because doubled up it is just a bigger HUD.
  //
  // 10 by 14, two-pixel stems, and SLAB SERIFS: at ten pixels a bracketed serif is a guess
  // and a slab is a fact, so the feet and arms simply overhang the stem by a pixel each
  // side. That overhang is the whole difference between a name and a label.
  const TITLE_H = 14;
  const TITLE_GAP = 2;     // the space between two letters, the same for every pair
  const TITLE_SPACE = 7;   // a word space, narrower than a letter, so the name holds together

  // PROPORTIONAL, not a grid. The first cut set every letter in a fixed ten-wide cell, and
  // with slab serifs that does not work: an I is six pixels wide and an A is ten, so a
  // constant cell leaves four pixels of air beside the I and none beside the A. The letters
  // were evenly spaced by the numbers and visibly uneven to the eye.
  //
  // So each glyph is trimmed to its own ink, edge column to edge column, and the gap is
  // added between them. Nothing has a built-in margin, which means the gap is the only
  // thing setting the rhythm and every pair gets the same one.
  const TF = {
    R: ['#######.', '#######.', '.##..##.', '.##...##', '.##...##', '.##..##.', '.#####..',
        '.#####..', '.##.##..', '.##..##.', '.##..##.', '.##...##', '####.###', '####.###'],
    E: ['########', '########', '.##.....', '.##.....', '.##.....', '.######.', '.######.',
        '.##.....', '.##.....', '.##.....', '.##.....', '.##.....', '########', '########'],
    L: ['####....', '####....', '.##.....', '.##.....', '.##.....', '.##.....', '.##.....',
        '.##.....', '.##.....', '.##.....', '.##.....', '.##.....', '########', '########'],
    A: ['..######..', '..######..', '..##..##..', '.##....##.', '.##....##.', '.########.',
        '.########.', '.##....##.', '.##....##.', '.##....##.', '.##....##.', '.##....##.',
        '####..####', '####..####'],
    Y: ['####..####', '####..####', '.##....##.', '..##..##..', '..##..##..', '...####...',
        '....##....', '....##....', '....##....', '....##....', '....##....', '....##....',
        '..######..', '..######..'],
    I: ['######', '######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..',
        '..##..', '..##..', '..##..', '..##..', '######', '######'],
    D: ['#######.', '#######.', '.##..##.', '.##...##', '.##...##', '.##...##', '.##...##',
        '.##...##', '.##...##', '.##...##', '.##...##', '.##..##.', '#######.', '#######.'],
  };

  const glyphW = (ch) => TF[ch][0].length;
  const titleW = (s) =>
    [...s].reduce((n, ch) => n + (ch === ' ' ? TITLE_SPACE : glyphW(ch) + TITLE_GAP), 0) - TITLE_GAP;

  function titleText(s, y, color) {
    let x = Math.round((W - titleW(s)) / 2);
    ctx.fillStyle = color;
    for (const ch of s) {
      if (ch === ' ') { x += TITLE_SPACE; continue; }
      const g = TF[ch];
      const w = glyphW(ch);
      for (let r = 0; r < TITLE_H; r++) {
        for (let c = 0; c < w; c++) if (g[r][c] === '#') ctx.fillRect(x + c, y + r, 1, 1);
      }
      x += w + TITLE_GAP;
    }
  }
  const pad = (n, len) => String(n).padStart(len, '0');

  // ---- sprites ------------------------------------------------------------------------
  // Written as grids so a shape can be judged in the source rather than run to be seen.
  const key = {
    k: C.dark, y: C.yellow, s: C.yellowDim, r: C.rider, c: C.cream,
    R: C.red, D: C.redDull, w: C.cream, h: C.hole, g: C.fuelOk,
  };

  const RIG = [
    '...kk..........',
    '...kk..........',
    '..kyyk.........',
    '.kkkkkk........',
    '..yyyy...kkkkk.',
    '..yyyy..kyyyyyk',
    '..yyyykkkycccyk',
    '..yrry..kycccyk',
    '..yrry..kycccyk',
    '..yrry..kycccyk',
    '..yyyykkkyyyyyk',
    '..yyyy...kkkkk.',
    '..yyyy......kk.',
    '..kyyk......kk.',
    '...kk..........',
    '...kk..........',
  ];
  const RIG_W = RIG[0].length;
  const RIG_H = RIG.length;
  // Where the mail actually leaves from: the sidecar's outer wall, which is the last
  // painted column of the sprite and not the bike's center. Every delivery, every
  // collision and the off-road test all measure from here.
  const SIDECAR_EDGE = RIG_W;

  const BOX = [
    '.kkkkkkk.',
    'kRRRRRRRk',
    'kRRRRRRRk',
    'kkkkkkkkk',
    'kRRRRRRRk',
    'kRRRRRRRk',
    'kRRRRRRRk',
    'kRRRRRRRk',
    '.kkkkkkk.',
  ];
  const BOX_W = BOX[0].length;
  const BOX_H = BOX.length;

  const CAN = [
    '.kkkkkkk.',
    'kgggggggk',
    'kgggggggk',
    'kggkkkggk',
    'kgggggggk',
    'kggkkkggk',
    'kgggggggk',
    'kgggggggk',
    '.kkkkkkk.',
  ];
  const CAN_W = CAN[0].length;
  const CAN_H = CAN.length;

  // The same machine as yours with the sidecar taken off, which is the point.
  const BIKE = [
    '...kk...',
    '...kk...',
    '..k##k..',
    '.kkkkkk.',
    '..####..',
    '..####..',
    '..#rr#..',
    '..#rr#..',
    '..#rr#..',
    '..####..',
    '..####..',
    '..####..',
    '..k##k..',
    '...kk...',
    '...kk...',
  ];
  const BIKE_W = BIKE[0].length;
  const BIKE_H = BIKE.length;

  // Three sizes, all lopsided and none a scaled copy of another: a pothole that is
  // symmetrical reads as a manhole, and three of the same shape read as one shape.
  const HOLE_S = [
    '.hhhh.',
    'hhhhhh',
    'hhhhhh',
    'hhhhh.',
    '.hhh..',
  ];
  const HOLE_M = [
    '..hhhhhh..',
    '.hhhhhhhh.',
    'hhhhhhhhhh',
    'hhhhhhhhhh',
    'hhhhhhhhhh',
    'hhhhhhhhh.',
    '.hhhhhhh..',
    '..hhhh....',
  ];
  const HOLE_L = [
    '...hhhhhhhh...',
    '..hhhhhhhhhhh.',
    '.hhhhhhhhhhhhh',
    'hhhhhhhhhhhhhh',
    'hhhhhhhhhhhhhh',
    'hhhhhhhhhhhhhh',
    'hhhhhhhhhhhhh.',
    '.hhhhhhhhhhhh.',
    '.hhhhhhhhhh...',
    '..hhhhhh......',
  ];
  const HOLES = [HOLE_S, HOLE_M, HOLE_L];
  const holeW = (g) => HOLES[g][0].length;
  const holeH = (g) => HOLES[g].length;

  // `swap` recolors the '#' cells, which is how one grid becomes five colors of rider.
  function sprite(grid, x, y, swap) {
    x = Math.round(x);
    y = Math.round(y);
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        ctx.fillStyle = ch === '#' ? swap : key[ch];
        ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
  }

  // ---- the road -----------------------------------------------------------------------
  // A straight strip reads as a treadmill after ten seconds. Two sine terms of different
  // wavelengths give a road that wanders without ever repeating visibly, and because it
  // is a pure function of world distance every part of the game agrees about where the
  // pavement is: the drawing code, the off-road test, and where a box gets planted.
  let curveAmp = 6;
  let roadHalf = 48;

  const roadMid = (wy) =>
    W / 2 + Math.sin(wy * 0.0115) * curveAmp + Math.sin(wy * 0.0041) * curveAmp * 0.55;

  const roadL = (wy) => roadMid(wy) - roadHalf;
  const roadR = (wy) => roadMid(wy) + roadHalf;

  // ---- state --------------------------------------------------------------------------
  const BEST_KEY = 'relay-rider.best';
  let best = 0;
  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (_) { best = 0; }

  let mode = 'title';          // title | play | pause | over
  let dist, speed, maxSpeed, rx, fuel, mail, scene, sceneMail;
  let crashT, wobbleT, bannerT, flashT, record;
  let boxes, bikes, holes, cans, pops;
  let spawn;

  const MAIL_PER_SCENE = 8;
  const BANK = 6;              // grass between the pavement and the water, your warning strip
  const CRUISE = 0.62;         // the fraction of top speed it holds with no input
  const REACH = 12;            // how far the sidecar can reach a box, in pixels
  const VERGE = 3;             // how far past the pavement a mailbox is planted

  function applyScene() {
    // Each scene tightens exactly three things: less pavement, more bend, more speed to
    // hold. Everything else stays put so a run gets harder in a way you can name.
    //
    // Fractions of the playfield, not pixels, so a wider panel gets a proportionally wider
    // road rather than the same strip with more grass either side of it. At W=160 these
    // come out as the 48, 31 and 3 they were written as.
    roadHalf = Math.max(W * 0.19, W * 0.3 - (scene - 1) * W * 0.019);
    // The two sine terms peak at amp * 1.55 between them, and the far side of a box sits
    // at roadR + VERGE + BOX_W, which has to land inside the screen. Solve for amp and the
    // boxes stay on screen at every road width AND at every panel size, which is why this
    // reads off W and roadHalf rather than off the scene, and why it needs no ceiling of
    // its own: a narrower road buys the bend, and the sum is fixed.
    curveAmp = Math.max(0, (W / 2 - 2 - BOX_W - VERGE - roadHalf) / 1.55);
    maxSpeed = Math.min(4.6, 2.5 + (scene - 1) * 0.22);
  }

  function reset() {
    dist = 0; speed = 0; rx = W / 2 - RIG_W / 2;
    fuel = 100; mail = 0; scene = 1; sceneMail = 0;
    crashT = 0; wobbleT = 0; bannerT = 0; flashT = 0; record = false;
    boxes = []; bikes = []; holes = []; cans = []; pops = [];
    applyScene();
    spawn = { box: 210, bike: 320, hole: 260, can: 520 };
    advance();   // so the title screen shows a road with mail on it, not bare tarmac
  }

  // ---- input --------------------------------------------------------------------------
  const held = new Set();
  // Arrows and WASD, every action on both. Which hand you use is not a thing to have an
  // opinion about, and the pairing is the reason sound cannot live on S.
  const ACTION = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'gas', KeyW: 'gas', Space: 'gas', ArrowDown: 'brake', KeyS: 'brake',
  };

  addEventListener('keydown', (e) => {
    // Q, for being as far from the driving keys as the board goes. M is the convention for
    // mute, but the sound starts OFF here so the first press un-mutes and the mnemonic is
    // backwards exactly when someone meets it; S is the brake; and V sits under the hand
    // that is already busy.
    if (e.code === 'KeyQ') { toggleSound(); e.preventDefault(); return; }
    if (e.code === 'KeyP' && (mode === 'play' || mode === 'pause')) {
      mode = mode === 'play' ? 'pause' : 'play';
      if (mode === 'pause') hush();
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      if (mode === 'title' || mode === 'over') { reset(); mode = 'play'; }
    }
    if (ACTION[e.code]) { held.add(ACTION[e.code]); e.preventDefault(); }
  });
  addEventListener('keyup', (e) => { if (ACTION[e.code]) held.delete(ACTION[e.code]); });
  // A window that loses focus mid-throttle should not come back still accelerating.
  addEventListener('blur', () => { held.clear(); if (mode === 'play') mode = 'pause'; hush(); });

  // ---- sound --------------------------------------------------------------------------
  // OFF until asked for. A page that starts buzzing the moment it opens is a page nobody
  // opens twice, and creating the context lazily also satisfies the autoplay rule for
  // free: the first thing that ever builds it is a keypress.
  let ac = null, engine = null, engineGain = null, soundOn = false;

  function toggleSound() {
    soundOn = !soundOn;
    if (!soundOn) { hush(); return; }
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { soundOn = false; return; }
      ac = new AC();
      engineGain = ac.createGain();
      engineGain.gain.value = 0;
      const tone = ac.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 760;
      engine = ac.createOscillator();
      engine.type = 'sawtooth';
      engine.frequency.value = 70;
      engine.connect(engineGain).connect(tone).connect(ac.destination);
      engine.start();
    }
    if (ac.state === 'suspended') ac.resume();
  }

  function hush() { if (engineGain && ac) engineGain.gain.setTargetAtTime(0, ac.currentTime, 0.05); }

  function engineTo(v) {
    if (!soundOn || !ac) return;
    const t = ac.currentTime;
    engine.frequency.setTargetAtTime(58 + v * 96, t, 0.08);
    engineGain.gain.setTargetAtTime(0.035 + v * 0.05, t, 0.08);
  }

  function blip(freq, len, type) {
    if (!soundOn || !ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  function thud() {
    if (!soundOn || !ac) return;
    const t = ac.currentTime;
    const n = ac.createBufferSource();
    const buf = ac.createBuffer(1, 4410, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    n.connect(f).connect(g).connect(ac.destination);
    n.start(t);
  }

  // ---- events -------------------------------------------------------------------------
  // A pop lands on grass, road, water or a mailbox depending on where you happened to be,
  // and the old miss red measured 1.07:1 against the road: the word was there and could
  // simply not be seen. Every pop now carries a dark plate, which makes its color a
  // question of what it means rather than of what happens to be behind it. Clamped here
  // rather than at each call site, so a pop cannot be half off the edge of a narrow field.
  function pop(txt, x, y, color, k, life) {
    k = k || 1;
    const w = textW(txt, k);
    pops.push({
      txt,
      x: Math.max(3, Math.min(x, W - 3 - w)),
      y,
      t: life || 46,
      color,
      k,
    });
  }

  function crash() {
    if (crashT > 0) return;
    crashT = 46;
    speed = 0;
    flashT = 10;
    thud();
  }

  function deliver(box) {
    box.done = true;
    box.resolved = true;
    mail++;
    sceneMail++;
    pop('+1', box.x - 4, box.sy - 8, C.cream, 2);
    blip(940, 0.06);
    setTimeout(() => blip(1390, 0.07), 55);
    if (sceneMail >= MAIL_PER_SCENE) {
      sceneMail = 0;
      scene++;
      applyScene();
      bannerT = 100;
      fuel = Math.min(100, fuel + 8);    // a finished scene buys a little road back
      blip(680, 0.09, 'triangle');
    }
  }

  // ---- step ---------------------------------------------------------------------------
  function step() {
    if (crashT > 0) {
      crashT--;
      if (flashT > 0) flashT--;
      hush();
      // The world still drifts while you are down, so a crash costs ground and not just
      // seconds, and the boxes you were lining up scroll away without you.
      dist += 0.35;
      advance();
      return;
    }

    // THE RIG RUNS ON ITS OWN and the throttle is a boost on top of it. Holding a key
    // down for three minutes to keep a game moving is worth asking for only when the
    // holding is itself the skill, and here the skill is where you put the sidecar.
    // Braking still takes it to a dead stop, which is how you wait out a jam.
    const gas = held.has('gas');
    const brake = held.has('brake');
    const target = brake ? 0 : gas ? maxSpeed : maxSpeed * CRUISE;
    if (speed < target) speed += 0.075;
    else speed -= brake ? 0.16 : 0.05;

    // Grass is not pavement. Off the road you bleed speed and the bars fight you.
    const offRoad = rx < roadL(dist) || rx + RIG_W > roadR(dist);
    if (offRoad) speed -= 0.085;
    // Water is not grass. The bank is six pixels of warning and then the run stops; the
    // rig is put back on the tarmac afterwards, because a rig left sitting in the river
    // would crash again the instant it got up.
    if (rx < roadL(dist) - BANK) {
      crash();
      rx = roadL(dist);
    }
    speed = Math.max(0, Math.min(maxSpeed, speed));

    // Steering authority rises with speed: at a standstill you cannot turn, which is
    // both true of a motorcycle and the thing that stops braking to a crawl being the
    // safe answer to every close pass.
    const grip = 0.55 + (speed / maxSpeed) * 1.45;
    if (held.has('left')) rx -= grip;
    if (held.has('right')) rx += grip;
    if (wobbleT > 0) { wobbleT--; rx += (Math.random() - 0.5) * 2.6; }
    if (offRoad) rx += (Math.random() - 0.5) * 1.4;
    rx = Math.max(-6, Math.min(W - RIG_W + 6, rx));

    dist += speed;

    // Fuel burns even at idle, so stopping is never a way to wait out a hard stretch.
    fuel -= (0.006 + (speed / maxSpeed) * 0.017) * (1 + (scene - 1) * 0.06);
    if (fuel <= 0) {
      fuel = 0;
      mode = 'over';
      hush();
      if (mail > best) {
        record = true;
        best = mail;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (_) { /* private mode */ }
      }
      blip(300, 0.5, 'sawtooth');
      return;
    }

    engineTo(speed / maxSpeed);
    advance();
    collide();
    if (bannerT > 0) bannerT--;
    for (let i = pops.length - 1; i >= 0; i--) {
      pops[i].t--;
      pops[i].y -= 0.35;
      if (pops[i].t <= 0) pops.splice(i, 1);
    }
  }

  // Screen y of a world position. Objects live in world coordinates and only ever become
  // pixels here, so there is exactly one place the scroll can be wrong.
  const screenY = (wy) => RIG_Y - (wy - dist);

  function advance() {
    for (const c of bikes) c.wy += c.speed;
    // Everything on the road holds an offset from the center line and gets its x here, so
    // one place decides where things are and a resize moves them all together.
    for (const o of bikes) o.x = roadMid(o.wy) + o.off;
    for (const o of holes) o.x = roadMid(o.wy) + o.off;
    for (const o of cans) o.x = roadMid(o.wy) + o.off;

    const drop = (list, wy, extra) => list.push(Object.assign({ wy }, extra));

    while (spawn.box < dist + AHEAD) {
      // Planted 3px off the pavement: close enough that the reach is a real decision,
      // far enough that the box is not sitting in the lane.
      drop(boxes, spawn.box, { done: false, resolved: false, near: Infinity, seen: false });
      spawn.box += Math.max(84, 150 - scene * 8) + Math.random() * 60;
    }
    while (spawn.bike < dist + AHEAD) {
      const mid = roadMid(spawn.bike);
      // Traffic bunches, which is what traffic does, and braking always gets you out
      // because every rider moves faster than a standstill. What is not survivable is two
      // arriving side by side with no room between them, so a new one has to leave
      // the rig a way past anything already abreast of it. Six tries, then skip: thinner
      // traffic is a better failure than a wall.
      const near = bikes.filter((c) => Math.abs(c.wy - spawn.bike) < BIKE_H * 1.5);
      const room = BIKE_W + RIG_W + 2;
      let x = null;
      for (let i = 0; i < 6 && x === null; i++) {
        const t = mid - roadHalf + 3 + Math.random() * (roadHalf * 2 - BIKE_W - 6);
        if (near.every((c) => Math.abs(c.x - t) >= room)) x = t;
      }
      if (x !== null) {
        drop(bikes, spawn.bike, {
          x,
          off: x - mid,
          // A narrow spread: the wider it was, the faster a quick rider ran up the back of
          // a slow one and made the jam this is trying to avoid.
          speed: maxSpeed * (0.35 + Math.random() * 0.25),
          color: C.bikes[(Math.random() * C.bikes.length) | 0],
        });
      }
      spawn.bike += Math.max(95, 230 - scene * 14) + Math.random() * 90;
    }
    while (spawn.hole < dist + AHEAD) {
      // Weighted small: a road of nothing but craters is a road you cannot read.
      const r = Math.random();
      const g = r < 0.45 ? 0 : r < 0.82 ? 1 : 2;
      drop(holes, spawn.hole, { g, off: -roadHalf + 2 + Math.random() * (roadHalf * 2 - holeW(g) - 4) });
      spawn.hole += Math.max(90, 180 - scene * 6) + Math.random() * 80;
    }
    while (spawn.can < dist + AHEAD) {
      drop(cans, spawn.can, { off: -roadHalf + 4 + Math.random() * (roadHalf * 2 - CAN_W - 8), got: false });
      spawn.can += Math.max(1100, 1900 - scene * 60) + Math.random() * 700;
    }

    const gone = (o, h) => screenY(o.wy) > H + h + 4;
    boxes = boxes.filter((o) => !gone(o, BOX_H));
    bikes = bikes.filter((o) => !gone(o, BIKE_H));
    holes = holes.filter((o) => !gone(o, holeH(o.g)));
    cans = cans.filter((o) => !gone(o, CAN_H));
  }

  function overlaps(ay, ah, by, bh) { return ay < by + bh && by < ay + ah; }

  function collide() {
    const rigL = rx;
    const rigR = rx + SIDECAR_EDGE;
    const rigT = RIG_Y;

    for (const b of boxes) {
      b.x = roadR(b.wy) + VERGE;
      b.sy = screenY(b.wy);
      if (!overlaps(rigT, RIG_H, b.sy, BOX_H)) {
        // Resolved on the way out rather than at one instant, so the delivery is judged
        // on the closest the sidecar ever got, not on wherever it happened to be when
        // some single frame ticked.
        if (b.seen && !b.resolved && b.sy > rigT) {
          b.resolved = true;
          if (b.near <= REACH) deliver(b);
          // Only when you were near it. Every box you never went for saying MISSED is
          // noise; the one you were four pixels short of is the lesson.
          else if (b.near < REACH * 3) pop('MISSED', b.x - textW('MISSED') - 6, b.sy - 2, C.miss, 1, 84);
        }
        continue;
      }
      b.seen = true;
      if (b.resolved) continue;
      // Positive is clearance from the sidecar wall to the near face of the box.
      const gap = b.x - rigR;
      if (gap < 0) { crash(); b.resolved = true; continue; }
      b.near = Math.min(b.near, gap);
    }

    for (const c of bikes) {
      const sy = screenY(c.wy);
      if (!overlaps(rigT, RIG_H, sy, BIKE_H)) continue;
      if (rigL < c.x + BIKE_W && c.x < rigR) crash();
    }

    for (const h of holes) {
      if (h.hit) continue;
      const sy = screenY(h.wy);
      if (!overlaps(rigT, RIG_H, sy, holeH(h.g))) continue;
      if (rigL < h.x + holeW(h.g) && h.x < rigR) {
        h.hit = true;
        // A bigger hole takes more out of you, in both the wobble and the speed.
        wobbleT = 22 + h.g * 12;
        speed *= 0.72 - h.g * 0.11;
        blip(190 - h.g * 35, 0.07 + h.g * 0.02, 'square');
      }
    }

    for (const f of cans) {
      if (f.got) continue;
      const sy = screenY(f.wy);
      if (!overlaps(rigT, RIG_H, sy, CAN_H)) continue;
      if (rigL < f.x + CAN_W && f.x < rigR) {
        f.got = true;
        fuel = Math.min(100, fuel + 16);
        pop('FUEL', f.x - 6, sy - 8, C.fuelOk);
        blip(620, 0.05, 'triangle');
        setTimeout(() => blip(830, 0.07, 'triangle'), 50);
      }
    }
  }

  // ---- draw ---------------------------------------------------------------------------
  // A cheap deterministic hash. The verge needs speckle that belongs to a place on the
  // road rather than to a frame, or the grass boils instead of scrolling.
  function hash(a, b) {
    let n = (a * 73856093) ^ (b * 19349663);
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function drawRoad() {
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, HUD_H, W, H - HUD_H);

    for (let y = HUD_H; y < H; y++) {
      const wy = dist + (RIG_Y - y);
      const l = Math.round(roadL(wy));
      const r = Math.round(roadR(wy));

      ctx.fillStyle = C.road;
      ctx.fillRect(l, y, r - l, 1);
      ctx.fillStyle = C.edge;
      ctx.fillRect(l, y, 1, 1);
      ctx.fillRect(r - 1, y, 1, 1);

      // Center line: 6 on, 10 off, measured in world distance so the dashes travel with
      // the road instead of crawling against it.
      if ((((wy % 16) + 16) % 16) < 6) {
        ctx.fillStyle = C.dash;
        ctx.fillRect(Math.round(roadMid(wy)) - 1, y, 2, 1);
      }

      // THE RIVER. Every mailbox is on the right, so the left had nothing to say and
      // nothing to fear. Water says both without a sign: it is the reason not to drift
      // that way, and it makes the two verges tell you which one you are near at a glance.
      // It follows the road, so the bank stays a constant strip and the river widens and
      // narrows as the road weaves toward it.
      const bank = Math.round(l) - BANK;
      if (bank > 0) {
        ctx.fillStyle = C.water;
        ctx.fillRect(0, y, bank, 1);
        ctx.fillStyle = C.shore;
        ctx.fillRect(bank, y, 1, 1);
      }

      // Texture on both verges, keyed to world position and not to a screen row, or it
      // shimmers in place instead of travelling with the ground under it.
      const band = ((wy % 4) + 4) % 4 < 1;
      if (band) {
        const row = Math.floor(wy / 4);
        ctx.fillStyle = C.grassDot;
        for (let i = 0; i < 3; i++) {
          const hx = hash(row, i);
          const px = Math.round(hx < 0.5
            ? Math.max(bank + 2, 0) + hx * 2 * Math.max(0, l - Math.max(bank + 2, 0) - 4)
            : r + 4 + (hx - 0.5) * 2 * (W - r - 6));
          if (px >= 0 && px < W) ctx.fillRect(px, y, 2, 2);
        }
        if (bank > 10) {
          ctx.fillStyle = C.ripple;
          for (let i = 0; i < 2; i++) {
            if (hash(row, 20 + i) < 0.55) continue;
            const rw = 3 + Math.floor(hash(row, 30 + i) * 4);
            const rx0 = 1 + Math.floor(hash(row, 40 + i) * Math.max(1, bank - rw - 2));
            ctx.fillRect(rx0, y, rw, 1);
          }
        }
      }
    }
  }

  function drawHud() {
    ctx.fillStyle = C.hud;
    ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = '#2a2a36';
    ctx.fillRect(0, HUD_H - 1, W, 1);

    // Keep the top-right clear: the panel floats its close button there, and a scene
    // counter underneath one is a scene counter nobody can read. The button is sized in
    // CSS pixels, so what it costs in playfield pixels depends on the scale.
    const gutter = Math.ceil(46 / scale);
    const sc = 'SCENE ' + scene;
    // On a narrow field the two counters do not both fit. The label gives way first, and
    // only then the scene counter, which is the one already announced by a banner every
    // time it changes and shown again at the end. SENT says the same thing as DELIVERED in
    // four letters and keeps the direction unambiguous, which MAIL did not.
    let label = 'DELIVERED ' + pad(mail, 3);
    if (4 + textW(label) + 8 + textW(sc) + gutter > W) label = 'SENT ' + pad(mail, 3);
    text(label, 4, 3, C.ink);
    const scX = W - gutter - textW(sc);
    if (scX >= 4 + textW(label) + 8) text(sc, scX, 3, C.inkDim);

    // Stops short of the same corner the scene counter avoids. The panel floats its close
    // button over the top-right, and a gauge running underneath one cannot be read to the
    // end, which for the only thing on screen that ends a run is the wrong half to lose.
    const bw = W - 6 - gutter;
    ctx.fillStyle = '#2a2a36';
    ctx.fillRect(4, 12, bw + 2, 5);
    ctx.fillStyle = fuel < 25 ? C.fuelLow : C.fuelOk;
    // Blink the last quarter tank. It is the only thing on screen that ends a run.
    const blink = fuel < 25 && (performance.now() % 620) < 310;
    if (!blink) ctx.fillRect(5, 13, Math.max(0, Math.round((bw * fuel) / 100)), 3);
  }

  function drawRig() {
    if (crashT > 0 && (crashT >> 2) % 2 === 0) return;   // flicker while you are down
    sprite(RIG, Math.round(rx), RIG_Y);
  }

  function draw() {
    drawRoad();

    // THE DELIVERY LINE. How close is close enough is the one thing a title screen cannot
    // teach, because it is a question about a distance of about eight pixels. So the road
    // teaches it: when a box is coming, dots appear on the pavement marking where the
    // sidecar's outer wall has to be, curving down to you as the box does. Ride the dots
    // and the mail goes out. They are the rig's own yellow rather than road cream, so they
    // read as your line and not as another marking.
    let next = null;
    for (const b of boxes) {
      if (b.resolved) continue;
      const sy = screenY(b.wy);
      // Largest sy is the box nearest the rig. One line at a time, or three overlapping
      // boxes draw one permanent lane and the dots stop meaning "a box is coming".
      if (sy <= RIG_Y && (!next || sy > next)) next = sy;
    }
    if (next !== null) {
      ctx.fillStyle = C.guide;
      for (let y = Math.max(HUD_H + 2, Math.round(next)); y < RIG_Y + RIG_H; y += 5) {
        const wy = dist + (RIG_Y - y);
        ctx.fillRect(Math.round(roadR(wy)) - 4, y, 2, 2);
      }
    }

    for (const h of holes) sprite(HOLES[h.g], h.x, screenY(h.wy));
    for (const f of cans) if (!f.got) sprite(CAN, f.x, screenY(f.wy));

    for (const b of boxes) {
      const sy = screenY(b.wy);
      const x = roadR(b.wy) + VERGE;
      sprite(BOX, x, sy);
      if (b.done) {
        // Flag down and the box goes quiet. Delivered boxes stop being targets, which is
        // what stops a missed one looking the same as a made one on the next glance.
        ctx.fillStyle = C.redDull;
        ctx.fillRect(Math.round(x) + 1, Math.round(sy) + 1, BOX_W - 2, BOX_H - 2);
        ctx.fillStyle = C.cream;
        ctx.fillRect(Math.round(x) - 4, Math.round(sy) + 5, 4, 1);
      } else {
        ctx.fillStyle = C.cream;
        ctx.fillRect(Math.round(x) - 2, Math.round(sy) - 1, 2, 6);
      }
    }

    for (const c of bikes) sprite(BIKE, c.x, screenY(c.wy), c.color);
    drawRig();

    for (const p of pops) {
      // Blink only as it expires, the way an arcade counter runs down. Blinking for a
      // third of its life throughout was costing legibility and buying nothing.
      if (p.t < 14 && p.t % 4 < 2) continue;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      ctx.fillStyle = C.plate;
      ctx.fillRect(x - 3, y - 3, textW(p.txt, p.k) + 6, 5 * p.k + 6);
      text(p.txt, x, y, p.color, p.k);
    }

    if (bannerT > 0 && bannerT % 10 < 7) {
      const s = 'SCENE ' + scene;
      textMid(s, 96, C.cream);
    }

    drawHud();

    if (mode === 'title') overlayTitle();
    else if (mode === 'over') overlayOver();
    else if (mode === 'pause') overlayPause();

    if (flashT > 0) {
      ctx.fillStyle = 'rgba(239,230,205,0.45)';
      ctx.fillRect(0, HUD_H, W, H - HUD_H);
    }
  }

  function panel(top, height) {
    ctx.fillStyle = 'rgba(14,14,20,0.86)';
    ctx.fillRect(0, top, W, height);
    ctx.fillStyle = C.yellow;
    ctx.fillRect(0, top, W, 1);
    ctx.fillRect(0, top + height - 1, W, 1);
  }

  // The instruction as a picture, because it is a question about a distance and no
  // sentence answers that as fast as seeing it. Drawn from the same pieces at the same
  // size the game uses, so recognizing the arrangement on a live road takes no
  // translation: the pavement running out, the dots along its edge, your rig lined up on
  // them, and a box standing just past the tarmac, close enough to reach.
  function titleDiagram(top) {
    const cx = Math.round(W / 2);
    const L = cx - 38, R = cx + 14, h = 30;
    ctx.fillStyle = C.grass;
    ctx.fillRect(R, top, 24, h);
    ctx.fillStyle = C.road;
    ctx.fillRect(L, top, R - L, h);
    ctx.fillStyle = C.edge;
    ctx.fillRect(R - 1, top, 1, h);
    ctx.fillStyle = C.dash;
    for (let y = top + 1; y < top + h; y += 6) ctx.fillRect(L + 24, y, 2, 3);
    ctx.fillStyle = C.guide;
    for (let y = top; y < top + h; y += 5) ctx.fillRect(R - 4, y, 2, 2);
    sprite(RIG, R - 4 - RIG_W, top + 7);
    sprite(BOX, R + 3, top + 11);
    ctx.fillStyle = C.cream;
    ctx.fillRect(R + 1, top + 16, 2, 6);
  }

  // Centered in whatever height the panel gave us, and laid out from `top` rather than
  // from numbers that happened to suit a 240px screen.
  function blockTop(h) {
    // Centered where there is room, never under the HUD, never off the bottom. The last
    // clamp is what lets the title panel grow without falling off the shortest field.
    return Math.max(HUD_H + 2, Math.min(Math.round((H - h) / 2), H - h - 2));
  }

  function overlayTitle() {
    // The controls live here now. The page used to carry a line of text under the canvas,
    // and in a side panel that line was costing a whole step of scale.
    const top = blockTop(152);
    panel(top, 152);
    // The name gets air on both sides of it. Everything under it is a caption and can sit
    // close together; the title is the one thing on this screen that should not be crowded.
    if (W >= titleW('RELAY RIDER') + 8) titleText('RELAY RIDER', top + 14, C.yellow);
    else textMid('RELAY RIDER', top + 18, C.yellow);
    textMid('DELIVER THE NOTES!', top + 38, C.cream);
    titleDiagram(top + 50);
    // WASD works too and is deliberately not written down. The arrows are the ones drawn,
    // because a legend is for the keys someone needs, and the rest is for finding.
    textMid('←→ ARROWS TO STEER', top + 90, C.inkDim);
    // Drawn, not spelled. Naming two of the four directions in words while the other two
    // are arrows made the block read as two different legends.
    textMid('↑ GAS  ↓ BRAKE', top + 100, C.inkDim);
    textMid('Q SOUND  P PAUSE', top + 110, C.inkDim);
    textMid('YOUR BEST ' + pad(best, 3), top + 124, C.inkDim);
    if ((performance.now() % 900) < 560) textMid('PRESS SPACE', top + 140, C.cream);
  }

  function overlayOver() {
    const top = blockTop(112);
    panel(top, 112);
    // Out of fuel is the end of the run, so it says so at the size of one. Same trick as
    // the title: doubled where the field holds it, single where it does not.
    if (W >= 138) textMid('OUT OF FUEL', top + 10, C.fuelLow, 2);
    else textMid('OUT OF FUEL', top + 12, C.fuelLow);
    // The count is the whole point of the run, so it is the biggest thing on the card and
    // the word above it is only a label.
    textMid('DELIVERED', top + 32, C.inkDim);
    textMid(pad(mail, 3), top + 42, C.cream, 3);
    textMid('SCENE ' + scene, top + 64, C.inkDim);
    textMid(record ? 'NEW BEST' : 'YOUR BEST ' + pad(best, 3), top + 80, record ? C.yellow : C.inkDim);
    if ((performance.now() % 900) < 560) textMid('PRESS SPACE', top + 98, C.cream);
  }

  function overlayPause() {
    const top = blockTop(30);
    panel(top, 30);
    textMid('PAUSED', top + 10, C.cream);
    textMid('P TO RIDE ON', top + 20, C.inkDim);
  }

  // ---- loop ---------------------------------------------------------------------------
  // Fixed 60Hz steps with an accumulator. requestAnimationFrame runs at whatever the
  // display does, and a 120Hz monitor would otherwise ride twice as fast.
  const STEP = 1000 / 60;
  let acc = 0;
  let last = performance.now();

  function frame(now) {
    // A backgrounded tab hands back a gap of seconds. Cap it, or the catch-up teleports
    // the rig through everything that was on the road.
    acc = Math.min(acc + (now - last), 120);
    last = now;
    while (acc >= STEP) {
      if (mode === 'play') step();
      acc -= STEP;
    }
    draw();
    requestAnimationFrame(frame);
  }

  // Pick the scale from the width, then divide to get the playfield. Rounding toward
  // TARGET_W keeps the rig a sensible size at any panel width: a 360px panel lands on 2x
  // and a full browser tab on 6x or 7x, rather than one of them getting a speck and the
  // other a wall of road.
  //
  // The leftover is at most scale-1 pixels in each direction, which is why the canvas can
  // be said to fill the panel without ever resampling.
  // Window in, playfield out, and nothing else: kept pure so the sizing rule can be
  // checked at every panel size without a DOM, which is the only way to know a claim about
  // how it fills is true rather than true on the three sizes someone tried.
  //
  // NINE BY SIXTEEN IS THE CEILING. The road is a fixed share of the field, so a field that
  // keeps widening with the window is not the same game at a larger size: it is a road with
  // two screens of grass either side of it and a rig lost in the middle. Height is left
  // uncapped, because more rows is only more road to read ahead.
  //
  // Height fills, width letterboxes. Everything else falls out of picking the scale.
  function playfield(pw, ph) {
    pw = Math.max(140, pw);
    ph = Math.max(200, ph);
    const options = [];
    for (let s = 1; s <= 8; s++) {
      const h = Math.floor(ph / s);
      const w = Math.min(Math.floor(pw / s), Math.floor(h * RATIO));
      if (w >= MIN_W && h >= MIN_H) options.push({ s, w, h });
    }
    if (!options.length) {
      // A window too small for any of it. Keep the text on screen and let the ratio go,
      // because a title you cannot read is worse than a field that is too wide.
      const h = Math.floor(ph);
      return { s: 1, w: Math.min(pw, Math.max(MIN_W, Math.floor(h * RATIO))), h };
    }
    // One pixel per pixel makes a 15px rig 15 pixels wide on a monitor, which is not a rig.
    const usable = options.filter((o) => o.s > 1);
    return (usable.length ? usable : options)
      .reduce((a, b) => (Math.abs(b.w - TARGET_W) < Math.abs(a.w - TARGET_W) ? b : a));
  }

  function fit() {
    const p = playfield(innerWidth, innerHeight);
    scale = p.s;
    W = p.w;
    H = p.h;
    cv.width = W;
    cv.height = H;
    cv.style.width = W * scale + 'px';
    cv.style.height = H * scale + 'px';
    // Resizing the backing store resets the 2D context, this flag included, and losing it
    // is the difference between 8-bit and a smear.
    ctx.imageSmoothingEnabled = false;
    RIG_Y = H - 40;
    AHEAD = H + 80;
    // A resize mid-run changes where the road is. Everything on it holds an offset from
    // the center line so it moves along; the rig is the one thing that has to be caught.
    if (typeof rx === 'number') rx = Math.max(-6, Math.min(W - RIG_W + 6, rx));
    if (scene) applyScene();
  }

  addEventListener('resize', fit);
  fit();
  reset();
  requestAnimationFrame(frame);
})();
