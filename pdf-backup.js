// Sidecar — printable account backup: a telegram for the plain key, a
// masquerade invitation for the password-encrypted one.
//
// Why a hand-rolled PDF writer instead of a library: VENDOR.md keeps this repo to
// four vendored bundles, each byte-traceable to an npm artifact and SHA-256 verified
// by CI. A PDF library would add a fifth (~350KB) and a new supply-chain surface for
// what is, in the end, ruled lines and text. PDF 1.4 is a text format, and the
// telegram needs nothing beyond the standard-14 fonts every reader ships.
//
// The masquerade invitation is the one exception, and a deliberate one: its
// script and formal faces can't come from the standard 14, so it embeds four
// open-license (OFL) TrueType files already shipped in fonts/ — subset here to
// just the glyphs the page sets, so the sheet stays ~100KB of lettering, not
// 1MB of font program.
//
// The QR is emitted as vector rectangles from the existing qrcode-generator modules,
// not a raster: it stays crisp at any zoom and survives printing at any DPI.
//
// DESIGN NOTE: the telegram conceit is deliberately confined to the letterhead and the
// MESSAGE block. The security warnings below it are plain sentences. A pastiche that
// rendered "anyone holding this controls your account" as jokey caps-and-STOP would
// trade a real warning for a gag, and this sheet exists precisely for the moment
// someone has lost everything else.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- PDF primitives

  const PAGE_W = 612; // US Letter, 72dpi points
  const PAGE_H = 792;

  // PDF text strings are ASCII here by construction (bech32 is [a-z0-9], and the
  // static copy is written plain). Fold anything stray rather than emit bytes a
  // WinAnsiEncoding reader would render as mojibake.
  function ascii(s) {
    return String(s == null ? '' : s)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      // Decompose then drop combining marks, so "André" prints ANDRE rather than
      // ANDR. Bech32 is pure ASCII, so this is a no-op for the nsec and npub.
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x20-\x7E]/g, '');
  }
  // Escape the three characters that terminate or nest a PDF literal string.
  const esc = (s) => ascii(s).replace(/([\\()])/g, '\\$1');

  // Courier is monospace at exactly 600/1000 em, so text width is arithmetic — which
  // is why every centered element on this page is set in Courier. No metrics table.
  const COURIER_EM = 0.6;
  const textWidth = (s, size) => ascii(s).length * COURIER_EM * size;

  function content() {
    const ops = [];
    const api = {
      // PDF's origin is bottom-left; the layout below thinks top-down, so every
      // helper takes a top-down y and flips it here. One conversion, one place.
      fill(r, g, b) { ops.push(`${r} ${g} ${b} rg`); return api; },
      stroke(r, g, b) { ops.push(`${r} ${g} ${b} RG`); return api; },
      width(w) { ops.push(`${w} w`); return api; },
      rect(x, yTop, w, h, mode) {
        // `re` builds the path; the mode operator (f/S) then paints it. Emitting the
        // numbers without `re` is silently valid-looking and draws nothing at all.
        ops.push(`${x} ${PAGE_H - yTop - h} ${w} ${h} re ${mode || 'f'}`);
        return api;
      },
      line(x1, y1, x2, y2) {
        ops.push(`${x1} ${PAGE_H - y1} m ${x2} ${PAGE_H - y2} l S`);
        return api;
      },
      text(x, yTop, str, size, font) {
        ops.push(`BT /${font || 'F1'} ${size} Tf ${x} ${PAGE_H - yTop} Td (${esc(str)}) Tj ET`);
        return api;
      },
      centered(yTop, str, size, font) {
        return api.text((PAGE_W - textWidth(str, size)) / 2, yTop, str, size, font);
      },
      // Letter-spaced display type for the letterhead. Tc would be simpler but it
      // breaks the monospace width math the centering relies on, so space manually.
      trackedCentered(yTop, str, size, font, track) {
        const chars = ascii(str).split('');
        const w = chars.length * (COURIER_EM * size + track) - track;
        let x = (PAGE_W - w) / 2;
        for (const ch of chars) {
          if (ch !== ' ') api.text(x, yTop, ch, size, font);
          x += COURIER_EM * size + track;
        }
        return api;
      },
      // A rectangular ring (outer minus inner), painted with the even-odd rule so the
      // middle stays untouched. Filling a solid rect and covering it with white would
      // paint over whatever is beneath — which for the paper band means erasing the
      // optional-content tint on screen.
      ring(x, yTop, w, h, inset) {
        ops.push(`${x} ${PAGE_H - yTop - h} ${w} ${h} re`);
        ops.push(`${x + inset} ${PAGE_H - yTop - h + inset} ${w - inset * 2} ${h - inset * 2} re`);
        ops.push('f*');
        return api;
      },
      raw(s) { ops.push(s); return api; },
      // Optional content: everything between these is tagged with an OCG whose usage
      // dictionary turns it off for printing. Viewers show it; renderers that honor
      // /PrintState drop it. See PAPER_OCG in build().
      beginOptional(tag) { ops.push(`/OC /${tag} BDC`); return api; },
      endOptional() { ops.push('EMC'); return api; },
      toString() { return ops.join('\n'); },
    };
    return api;
  }

  // Assemble the object graph, xref table and trailer. Offsets are computed on
  // ENCODED BYTES, not string length, so a stray multi-byte character can't slide
  // the xref and corrupt the file.
  // 1.5, not 1.4: optional content groups (the non-printing page tint) were
  // introduced in 1.5, and a reader that only understands 1.4 must ignore the
  // /OCProperties graph rather than misread it.
  function assemble(objects) {
    const enc = new TextEncoder();
    // A part is a string (ASCII by construction below) or raw bytes; either way
    // its byte size is what advances the xref cursor.
    const size = (p) => (typeof p === 'string' ? enc.encode(p).length : p.byteLength);
    const parts = ['%PDF-1.5\n'];
    let bytes = size(parts[0]);
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(bytes);
      // An object is either indirect text, or { head, bytes } for a binary
      // stream — an embedded font program that must reach the Blob un-mangled,
      // never round-tripped through a string encoding.
      if (body && body.bytes) {
        const head = `${i + 1} 0 obj\n${body.head}\nstream\n`;
        const tail = '\nendstream\nendobj\n';
        parts.push(head, body.bytes, tail);
        bytes += size(head) + body.bytes.byteLength + size(tail);
      } else {
        const chunk = `${i + 1} 0 obj\n${body}\nendobj\n`;
        parts.push(chunk);
        bytes += size(chunk);
      }
    });
    const xrefAt = bytes;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    parts.push(xref);
    return new Blob(parts, { type: 'application/pdf' });
  }

  // ---------------------------------------------------------------- the mark

  // icons/sidecar-mark.svg, transcribed. Only M/H/V/C/Z appear in that file — no
  // arcs, no quadratics — so the mapping to PDF path operators is mechanical and
  // the mark stays vector (prints crisp at any size). Kept as data rather than
  // parsed from the SVG at runtime: the extension would have to fetch and parse a
  // file to draw a logo it already ships.
  //
  // The sheet is monochrome, so the mark is too. The source is four stacked paths —
  // a white bowl, a grey right-hand shade, and two oranges for the glass — a scheme
  // that only reads in colour. Flattened to two tones of the page ink instead, which
  // keeps the dimensional read of the original without any hue.
  //
  // Each pair draws a full shape then overlays its right-hand half, so the LIT side
  // is whichever colour goes down first. Base light + right-hand overlay dark puts
  // the highlight on the left, matching a light source at upper left.
  const MARK_VIEWBOX = { w: 201, h: 226 };
  const MARK_INK = [0.16, 0.12, 0.09];
  const MARK_SHADE = [0.58, 0.51, 0.43];
  const MARK_PATHS = [
    { fill: MARK_SHADE, d: 'M200.381 0C200.381 55.1291 155.609 99.8203 100.381 99.8203C45.1539 99.8203 0.381226 55.1281 0.381226 0H200.381Z' },
    { fill: MARK_INK, d: 'M200.381 0H100.929V99.807C155.904 99.5108 200.381 54.9449 200.381 0Z' },
    { fill: MARK_SHADE, d: 'M194.685 33.2253H6.07739C19.1073 70.0701 53.1779 96.9858 93.8872 99.5944V213.036H62.2426C58.6556 213.036 55.7495 215.937 55.7495 219.518C55.7495 223.098 58.6556 225.999 62.2426 225.999H138.52C142.107 225.999 145.013 223.098 145.013 219.518C145.013 215.937 142.107 213.036 138.52 213.036H106.876V99.5944C147.584 96.9858 181.655 70.0701 194.685 33.2253Z' },
    { fill: MARK_INK, d: 'M194.685 33.2253H100.927V226H138.519C142.106 226 145.012 223.099 145.012 219.519C145.012 215.938 142.106 213.037 138.519 213.037H106.874V99.5944C147.584 96.9858 181.655 70.0701 194.685 33.2253Z' },
  ];

  // Convert one SVG path to PDF operators, scaled into a box whose top-left is
  // (x, yTop). SVG's y grows downward and PDF's grows upward, hence the flip.
  // Handles absolute AND relative M/L/H/V/C plus S (smooth cubic, which
  // reflects the previous curve's second control point) and Z — the telegraph
  // mark only uses absolutes, the masquerade mask below only relatives.
  function markPath(c, d, x, yTop, scale) {
    const px = (v) => x + v * scale;
    const py = (v) => PAGE_H - (yTop + v * scale);
    // Split into command letters plus their number runs.
    const tokens = d.match(/[MLHVCZS][^MLHVCZS]*/gi) || [];
    let cx = 0, cy = 0;
    let p2x = 0, p2y = 0; // last curve's second control point, for S
    for (const t of tokens) {
      const rel = t[0] >= 'a'; // lowercase command = relative to the current point
      const cmd = t[0].toUpperCase();
      const n = (t.slice(1).match(/-?\d*\.?\d+/g) || []).map(Number);
      if (cmd === 'M') {
        for (let i = 0; i + 1 < n.length; i += 2) {
          cx = rel ? cx + n[i] : n[i];
          cy = rel ? cy + n[i + 1] : n[i + 1];
          c.raw(`${px(cx)} ${py(cy)} m`);
        }
      } else if (cmd === 'L') {
        for (let i = 0; i + 1 < n.length; i += 2) {
          cx = rel ? cx + n[i] : n[i];
          cy = rel ? cy + n[i + 1] : n[i + 1];
          c.raw(`${px(cx)} ${py(cy)} l`);
        }
      } else if (cmd === 'H') {
        for (const v of n) { cx = rel ? cx + v : v; c.raw(`${px(cx)} ${py(cy)} l`); }
      } else if (cmd === 'V') {
        for (const v of n) { cy = rel ? cy + v : v; c.raw(`${px(cx)} ${py(cy)} l`); }
      } else if (cmd === 'C') {
        for (let i = 0; i + 5 < n.length; i += 6) {
          const x1 = rel ? cx + n[i] : n[i], y1 = rel ? cy + n[i + 1] : n[i + 1];
          const x2 = rel ? cx + n[i + 2] : n[i + 2], y2 = rel ? cy + n[i + 3] : n[i + 3];
          cx = rel ? cx + n[i + 4] : n[i + 4];
          cy = rel ? cy + n[i + 5] : n[i + 5];
          c.raw(`${px(x1)} ${py(y1)} ${px(x2)} ${py(y2)} ${px(cx)} ${py(cy)} c`);
          p2x = x2; p2y = y2;
        }
      } else if (cmd === 'S') {
        for (let i = 0; i + 3 < n.length; i += 4) {
          // No previous curve in this subpath: the reflection is the point itself.
          const x1 = 2 * cx - p2x, y1 = 2 * cy - p2y;
          const x2 = rel ? cx + n[i] : n[i], y2 = rel ? cy + n[i + 1] : n[i + 1];
          cx = rel ? cx + n[i + 2] : n[i + 2];
          cy = rel ? cy + n[i + 3] : n[i + 3];
          c.raw(`${px(x1)} ${py(y1)} ${px(x2)} ${py(y2)} ${px(cx)} ${py(cy)} c`);
          p2x = x2; p2y = y2;
        }
      } else if (cmd === 'Z') c.raw('h');
      if (cmd !== 'C' && cmd !== 'S') { p2x = cx; p2y = cy; }
    }
  }

  function drawMark(c, x, yTop, height) {
    const scale = height / MARK_VIEWBOX.h;
    for (const p of MARK_PATHS) {
      c.fill(...p.fill);
      markPath(c, p.d, x, yTop, scale);
      c.raw('f');
    }
    return MARK_VIEWBOX.w * scale; // width consumed, so callers can center
  }

  // ---------------------------------------------------------------- QR as vectors

  function drawQr(c, value, x, yTop, size) {
    const qr = root.qrcode(0, 'M'); // typeNumber 0 = smallest version that fits
    qr.addData(String(value));
    qr.make();
    const count = qr.getModuleCount();
    // 4 modules is the spec's recommended quiet zone. A clean render decodes at 2,
    // but the real case is a creased sheet under a phone camera at an angle, where
    // the extra margin is what lets the scanner find the finder patterns.
    const quiet = 4;
    const scale = size / (count + quiet * 2);
    const origin = { x: x + quiet * scale, y: yTop + quiet * scale };
    // Explicit white backing. Costs nothing to print (printers lay down no white
    // toner) but guarantees the quiet zone stays light if this is ever run on
    // tinted stock, which is what scanners need to lock on.
    c.fill(1, 1, 1).rect(x, yTop, size, size);
    c.fill(0.11, 0.09, 0.07);
    for (let r = 0; r < count; r++) {
      for (let col = 0; col < count; col++) {
        if (!qr.isDark(r, col)) continue;
        // +0.02 overlap: adjacent module edges can hairline-crack in some renderers.
        c.rect(origin.x + col * scale, origin.y + r * scale, scale + 0.02, scale + 0.02);
      }
    }
    return c;
  }

  // ---------------------------------------------------------------- the telegram

  const INK = [0.16, 0.12, 0.09];
  const BRONZE = [0.55, 0.42, 0.25];
  const PAPER = [0.961, 0.933, 0.875];

  // A telegram carried a serial, and it's what makes the letterhead read as a real
  // blank rather than a decorated note. Six leading and six trailing characters of
  // the npub, so one account always prints the same serial.
  //
  // Twelve bech32 characters is 32^12 (~1.15e18) combinations, which stays collision-
  // free past a billion accounts. Four-and-four (32^8) would have been ample for
  // telling apart the sheets one person holds, but two strangers comparing serials
  // is a coin flip once Nostr passes a million accounts.
  //
  // The "npub1" prefix is dropped before slicing — it's constant on every account, so
  // including it would spend characters that distinguish nothing. The NP- prefix says
  // what the number is derived from without eating into the entropy.
  //
  // Both halves are visible in Sidecar's own truncated display (shortNpub renders
  // npub1aeh2zw4el...cq4nwx), so a sheet can be eyeballed against the account list.
  function serialFor(npub) {
    const s = ascii(npub).replace(/^npub1/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    return `NP-${s.slice(0, 6)}-${s.slice(-6)}`;
  }

  function build(opts) {
    const nsec = ascii(opts.nsec);
    const npub = ascii(opts.npub);
    // Encrypted mode: the same key as a NIP-49 ncryptsec, password-encrypted
    // with the vendored encryptor. A photo or copy of this sheet alone is
    // useless without the password — which is deliberately not printed
    // anywhere. The caller collects the password interactively; an empty value
    // means the plain sheet, as before.
    const ncryptsec = opts.ncryptsec ? ascii(opts.ncryptsec) : '';
    // toISOString rather than instanceof Date: the panel and this file share a
    // realm, but a test sandbox (or any embedder) has its own Date constructor,
    // and a silently-ignored date is a wrong stamp, not an error.
    const when = opts.date && opts.date.toISOString ? opts.date : new Date();
    const stamp = when.toISOString().slice(0, 16).replace('T', '  ');

    // The invitation's embedded faces: { script, text, textItalic, display }
    // as raw TTF bytes from fonts/. Absent — a test, or a failed fetch in the
    // panel — the page falls back to the standard-14 Times trio and keeps the
    // same layout in plainer letter.
    const raw = opts.fonts || null;
    const fonts = raw && {
      script: parseTtf(raw.script), text: parseTtf(raw.text),
      textItalic: parseTtf(raw.textItalic), display: parseTtf(raw.display),
    };
    if (fonts) for (const key of Object.keys(fonts)) fonts[key].seen = new Set();

    const c = content();
    // One sheet, one page — plain or encrypted, never both in one file. A PDF
    // carrying both would make the encryption pointless: the plain page alone
    // restores (and steals) the account, so the encrypted page would add
    // nothing to that document. The panel still passes the nsec (it needed it
    // to mint the ncryptsec), but only the ncryptsec decides which page this is.
    if (ncryptsec) drawEncryptedPage(c, { ncryptsec, npub, name: opts.name, stamp, fonts });
    else drawPlainPage(c, { nsec, npub, name: opts.name, stamp });

    // ---- object graph
    // 1 catalog, 2 pages, 3 the page, 4 its contents, 5-9 the standard-14
    // fonts, 10 the OCG. The invitation appends 11-18 when it embeds its four
    // faces; the telegram never does, so its numbering is frozen at ten.
    //   F1 Courier, F2 Courier-Bold, F3 Times-Roman, F4 Times-Bold, F5 Times-Italic
    //   F6 Pinyon Script, F7 EB Garamond, F8 EB Garamond Italic, F9 Playfair Display
    const stream = c.toString();
    const streamBytes = new TextEncoder().encode(stream).length;
    const font = (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
    // Object 10 is the optional content group holding the full-page tint.
    //   /Usage      declares what it is FOR (view yes, print no)
    //   /D /AS      is what actually applies that usage automatically per event —
    //               a /Usage dictionary alone is only advisory and readers ignore it
    //   /D /ON      leaves the group visible in the default configuration
    // F6-F9 (the embedded invitation faces) join the page's resources — and the
    // object graph — only when the faces were actually supplied, so the plain
    // telegram's numbering is exactly what it always was.
    const embedded = fonts ? ' /F6 11 0 R /F7 12 0 R /F8 13 0 R /F9 14 0 R' : '';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [10 0 R] ' +
        '/D << /ON [10 0 R] /Order [] ' +
        '/AS [ << /Event /Print /Category [/Print] /OCGs [10 0 R] >> ] >> >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 8 0 R /F5 9 0 R' + embedded + ' >> ' +
        '/Properties << /MC0 10 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`,
      font('Courier'),
      font('Courier-Bold'),
      font('Times-Roman'),
      font('Times-Bold'),
      font('Times-Italic'),
      '<< /Type /OCG /Name (Paper tint) /Usage << /View << /ViewState /ON >> ' +
        '/Print << /PrintState /OFF >> >> >>',
    ];
    if (fonts) {
      // 11-14: the face dictionaries. 15-18: their subset programs, each a
      // binary stream. The subset prefix (SDCARx+) marks them as subsets, as
      // the spec's convention asks; the letters run A-script, B-roman,
      // C-italic, D-display.
      const faces = [
        ['SDCARA+PinyonScript', fonts.script],
        ['SDCARB+EBGaramond', fonts.text],
        ['SDCARC+EBGaramond-Italic', fonts.textItalic],
        ['SDCARD+PlayfairDisplay', fonts.display],
      ];
      faces.forEach(([name, f], i) => objects.push(embeddedFontDict(name, f, `${15 + i} 0 R`)));
      faces.forEach(([, f]) => {
        const sub = subsetTtf(f);
        objects.push({ head: `<< /Length ${sub.byteLength} /Length1 ${sub.byteLength} >>`, bytes: sub });
      });
    }
    return assemble(objects);
  }

  // ---------------------------------------------------------------- the plain sheet

  // The classic telegram: the raw key as text and QR, warnings in plain
  // sentences. What day-one users get — and the only version the
  // just-finished-setup prompts ever offer.
  function drawPlainPage(c, opts) {
    const nsec = opts.nsec;
    const npub = opts.npub;
    const stamp = opts.stamp;
    const M = 40; // page margin

    // Paper, in two layers, because a full-bleed tint is a ~7% halftone screen over
    // every square inch on a mono laser — real toner and visible mottling on the one
    // artifact meant to sit in a drawer for years.
    //
    // 1. The BORDER BAND always prints. It's ~5% of the page rather than 100%, so the
    //    sheet still reads as warm stock on plain white paper at a twentieth of the ink.
    // 2. The FULL-PAGE fill is wrapped in an optional content group whose usage
    //    dictionary sets /PrintState /OFF. Viewers show a fully cream page; renderers
    //    that honor optional content drop it and print only the band.
    //
    // Support for /PrintState is uneven (Acrobat honors it, many hardware RIPs ignore
    // usage dictionaries), so this is built to degrade well rather than to be relied
    // on: if it's ignored the sheet simply prints fully tinted, which is merely the
    // ink cost, not a broken document.
    c.beginOptional('MC0');
    c.fill(...PAPER).rect(0, 0, PAGE_W, PAGE_H);
    c.endOptional();

    const BAND = 12; // width of the printing tint band, between the two frame rules
    c.fill(...PAPER).ring(M, M, PAGE_W - M * 2, PAGE_H - M * 2, BAND);

    c.stroke(...INK).width(2).rect(M, M, PAGE_W - M * 2, PAGE_H - M * 2, 'S');
    c.width(0.6).rect(M + BAND, M + BAND, PAGE_W - (M + BAND) * 2, PAGE_H - (M + BAND) * 2, 'S');

    // ---- letterhead
    let y = M + 20;
    const markH = 30;
    drawMark(c, (PAGE_W - MARK_VIEWBOX.w * (markH / MARK_VIEWBOX.h)) / 2, y, markH);
    y += markH + 20;
    c.fill(...INK).trackedCentered(y, 'SIDECAR TELEGRAPH COMPANY', 15, 'F2', 2.2);
    y += 16;
    c.fill(...INK).trackedCentered(y, 'KEY CUSTODY DIVISION', 8, 'F1', 1.6);
    y += 14;
    c.stroke(...BRONZE).width(1).line(M + 22, y, PAGE_W - M - 22, y);
    y += 3;
    c.width(0.5).line(M + 22, y, PAGE_W - M - 22, y);

    // ---- the form strip a real blank carried across the top
    y += 20;
    const colX = [M + 22, M + 190, M + 350];
    c.fill(...INK);
    c.text(colX[0], y, 'CLASS OF SERVICE', 6.5, 'F1');
    c.text(colX[1], y, 'SERIAL', 6.5, 'F1');
    c.text(colX[2], y, 'FILED (UTC)', 6.5, 'F1');
    y += 11;
    c.fill(...INK);
    // A real blank's classes (FULL RATE, DAY LETTER, NIGHT LETTER) all describe
    // delivery speed, which means nothing for a key backup. Same visual slot, but
    // spend it on an instruction the holder can act on.
    c.text(colX[0], y, 'PERMANENT RECORD', 9, 'F2');
    c.text(colX[1], y, serialFor(npub), 9, 'F2');
    c.text(colX[2], y, stamp, 9, 'F2');
    y += 9;
    c.stroke(...INK).width(0.5).line(M + 22, y, PAGE_W - M - 22, y);

    // ---- addressing
    y += 18;
    c.fill(...INK).text(colX[0], y, 'TO', 6.5, 'F1');
    // At account creation there is no profile yet — nsecModal runs before the setup
    // wizard — so the name is only available when printing for an existing account.
    // Test what will ACTUALLY print, not what was passed in. A name written wholly
    // in a non-Latin script survives this check but is emptied by ascii() inside
    // text(), which printed a blank TO line instead of falling back.
    const to = ascii(opts.name || '').trim();
    c.fill(...INK).text(colX[0] + 26, y, to ? to.toUpperCase() : 'THE BEARER OF THIS SHEET', 9, 'F2');
    y += 13;
    c.fill(...INK).text(colX[0], y, 'FROM', 6.5, 'F1');
    c.fill(...INK).text(colX[0] + 26, y, 'SIDECAR SIGNER, YOUR OWN DEVICE', 9, 'F2');
    y += 13;
    // KEY, not NPUB: the value on this line already begins "npub1", so an NPUB label
    // prints the same word twice on one line. "PUBLIC KEY" would be more precise but
    // overruns the 26pt label gutter TO and FROM share — and the value self-identifies
    // anyway, with the secret half explicitly labelled on the box below.
    c.fill(...INK).text(colX[0], y, 'KEY', 6.5, 'F1');
    c.fill(...INK).text(colX[0] + 26, y, npub, 7.4, 'F1');
    y += 10;
    c.stroke(...BRONZE).width(0.5).line(M + 22, y, PAGE_W - M - 22, y);

    // ---- message (the conceit lives here and nowhere else)
    y += 20;
    c.fill(...INK).trackedCentered(y, 'M E S S A G E', 7.5, 'F1', 1.2);
    y += 18;
    c.fill(...INK);
    // STOP on the closing line only. Telegrams used it because punctuation cost
    // extra and read ambiguously over the wire — it was sparing, not rhythmic.
    for (const l of [
      // "Identity", not "account": there is no account here, no provider and nothing
      // to log into, which is exactly why nobody can reset it for you. Borrowing the
      // web word would import the mental model this sheet exists to correct.
      'THIS SHEET RESTORES YOUR NOSTR IDENTITY.',
      'THE KEY BELOW IS THAT IDENTITY.',
      'SIDECAR KEEPS NO COPY AND CANNOT REISSUE IT.',
      'STORE IT WHERE YOU STORE PASSPORTS. STOP',
    ]) { c.text(colX[0], y, l, 9.5, 'F2'); y += 14; }

    // ---- the key, in a box, as selectable text
    y += 8;
    const boxH = 44;
    c.fill(1, 1, 1).rect(M + 22, y, PAGE_W - (M + 22) * 2, boxH);
    c.stroke(...INK).width(1).rect(M + 22, y, PAGE_W - (M + 22) * 2, boxH, 'S');
    // Not "SELECTABLE TEXT": that describes the PDF, but this label prints, and on
    // paper it's nonsense. "COPY IT EXACTLY" is true in both media — select-and-copy
    // on screen, transcribe carefully from the page.
    c.fill(...INK).text(M + 30, y + 12, 'SECRET KEY (NSEC) - COPY IT EXACTLY', 6.5, 'F1');
    // 8.2pt Courier keeps all 63 bech32 characters on one unbroken line: a wrapped
    // key invites a transcription error at the one moment that must not go wrong.
    c.fill(...INK).text(M + 30, y + 31, nsec, 8.2, 'F2');
    y += boxH + 22;

    // ---- QR, captioned
    const qrSize = 150;
    const qrX = (PAGE_W - qrSize) / 2;
    c.stroke(...INK).width(1).rect(qrX - 6, y - 6, qrSize + 12, qrSize + 12, 'S');
    drawQr(c, nsec, qrX, y, qrSize);
    y += qrSize + 16;
    // This caption is now honest: Sidecar's own import reads a photo of this code
    // (Import account -> Read from image), so "scan to restore" is an instruction
    // the app can actually honor rather than a hope about other clients.
    c.fill(...INK).centered(y, 'SCAN TO RESTORE - THIS CODE IS THE KEY', 7, 'F1');

    // ---- warnings, in plain sentences on purpose
    y += 26;
    c.stroke(...INK).width(0.5).line(M + 22, y, PAGE_W - M - 22, y);
    y += 16;
    c.fill(...INK).text(colX[0], y, 'Keep this safe', 10, 'F2');
    y += 15;
    for (const l of [
      'Anyone who photographs or copies this sheet becomes you on Nostr.',
      'It cannot be undone or revoked. Treat it like cash.',
      '',
      // Not "store it offline / anywhere that syncs is a copy you don't control":
      // a password manager or an encrypted drive syncs and is a perfectly good home
      // for this. The thing that actually loses keys is sending them somewhere with
      // no protection at all, so name that instead of banning sync wholesale.
      'Sidecar erases every key on this device after 21 wrong PIN attempts.',
      'If that happens, this sheet is the only way back. Keep the paper',
      'somewhere safe, and never send this key by email or chat.',
    ]) { if (l) c.text(colX[0], y, l, 8.6, 'F1'); y += 12; }

    // ---- footer
    const footY = PAGE_H - M - 22;
    c.stroke(...BRONZE).width(0.5).line(M + 22, footY - 12, PAGE_W - M - 22, footY - 12);
    c.fill(...INK).text(colX[0], footY, 'SIDECAR - A CLASSY NOSTR SIGNER', 7, 'F1');
    const site = 'sidecar.top';
    c.text(PAGE_W - M - 22 - textWidth(site, 7), footY, site, 7, 'F1');

    // (page drawing above; object graph assembled in build())
  }

  // ---------------------------------------------------------------- the mask

  // A Venetian mask for the encrypted sheet's letterhead, as one path: the
  // silhouette with its ornate top-corner hooks, and the two eye sockets as
  // interior subpaths. Kept as data rather than parsed from an SVG file at
  // runtime, same as the telegraph mark. Authored in relative commands
  // (lowercase c, plus one S), which is why markPath handles relatives.
  const MASK_VIEWBOX = { w: 872.68, h: 429.13 };
  const MASK_D =
    'M871.37.63c-.93-.84-2.78-.84-3.71,0-20.38,13.35-47.29,43.22-83.82,66.35-15.35,9.72-36.14,13.35-52.82,21.69-10.19,5.01-22.24,14.18-29.65,24.2-1.85-11.68-10.19-23.36-21.31-26.7-15.75-5.01-33.36,0-44.48,5.01-25.02,10.85-45.41,30.88-55.6,54.24-.93-1.67-2.78-3.34-3.71-5.01-7.41-9.18-18.53-14.18-29.65-15.02-15.76-.84-32.44,5.84-50.97,20.03-25.95,20.03-46.34,45.06-59.31,72.6-12.97-27.54-33.36-52.57-59.31-72.6-18.53-14.18-35.21-20.86-50.97-20.03-11.12.84-22.24,5.84-29.65,15.02-.93,1.67-2.78,3.34-3.71,5.01-10.19-23.37-30.58-43.39-55.6-54.24-11.12-5.01-28.73-10.01-44.48-5.01-11.12,3.34-19.46,15.02-21.31,26.7-7.41-10.01-19.46-19.19-29.65-24.2-16.68-8.35-37.47-11.97-52.82-21.69C52.31,43.85,25.4,13.97,5.02.63,4.09-.21,2.24-.21,1.31.63S-.54,3.13.38,3.96c13.9,39.22,23.57,114.75,28.21,157.31.93,12.52,2.78,24.2,3.71,35.88,7.41,62.58,25.02,111.82,55.6,151.04,37.07,48.4,91.74,78.44,148.27,80.94h9.27c17.61,0,35.21-2.5,48.19-4.17,34.29-5.84,94.52-36.7,126.03-48.39,7.32-2.93,13.91-5.22,16.68-5.73,2.77.52,9.36,2.8,16.68,5.73,31.51,11.69,91.74,42.54,126.03,48.39,12.98,1.67,30.58,4.17,48.19,4.17h9.27c56.53-2.5,111.2-32.54,148.27-80.94,30.58-39.22,48.19-88.45,55.6-151.04.93-11.69,2.78-23.37,3.71-35.88,4.64-42.56,14.31-118.09,28.21-157.31.92-.83,0-2.49-.93-3.33h0ZM274.17,311.48h0c-24.09.83-46.33-4.18-63.02-14.19-28.73-16.69-42.63-45.06-49.11-68.43,12.05.84,25.02.84,37.07.84,19.46,0,53.66,3.64,72.2,8.65,35.21,8.35,73.03,34.79,86,64.83-23.17,8.35-64.6,7.46-83.14,8.3ZM661.53,297.29c-16.69,10.01-38.93,15.02-63.02,14.18h0c-18.54-.83-59.97.06-83.14-8.29,12.97-30.04,50.79-56.49,86-64.83,18.54-5.01,52.74-8.65,72.2-8.65,12.05,0,25.02,0,37.07-.84-6.48,23.37-20.38,51.74-49.11,68.43Z';

  function drawMask(c, x, yTop, height) {
    const scale = height / MASK_VIEWBOX.h;
    c.fill(...INK);
    markPath(c, MASK_D, x, yTop, scale);
    // Even-odd, so the eye sockets knock out of the silhouette regardless of
    // which way the authored subpaths happen to wind.
    c.raw('f*');
    return MASK_VIEWBOX.w * scale;
  }

  // ---------------------------------------------------------------- embedded type

  // The standard-14 set has no script face and nothing more formal than Times,
  // and this sheet wants both: a copperplate script for the guest's name, a
  // Garamond for the body, the Playfair the Speakeasy theme already wears for
  // display. So the encrypted page embeds four open-license (OFL) TrueType
  // faces, shipped in fonts/ beside the UI's own webfonts.
  //
  // Embedding means reading enough of the TrueType format to (a) take advance
  // widths from hmtx via cmap — the same job the Times AFM tables below do, so
  // centering stays exact — and (b) subset: keep only the glyphs the page
  // actually sets, recursing into composite outlines, and drop the shaping
  // tables (GSUB/GPOS/GDEF), which a PDF simple font never consults anyway.
  // A full four faces is ~1MB; the subset of one page's lettering is ~100KB.
  //
  // Everything here is read-only arithmetic over bytes the extension itself
  // ships — no new trust, just new letterforms.

  function parseTtf(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tab = {};
    const nTables = dv.getUint16(4);
    for (let i = 0; i < nTables; i++) {
      const o = 12 + i * 16;
      const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
      tab[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
    }
    const t = (name) => tab[name] && tab[name].off;

    const head = t('head');
    const unitsPerEm = dv.getUint16(head + 18);
    const locFmt = dv.getInt16(head + 50); // 0 = short loca offsets (×2), 1 = long
    const bbox = [0, 1, 2, 3].map((i) => dv.getInt16(head + 36 + i * 2));

    const hhea = t('hhea');
    const ascent = dv.getInt16(hhea + 4);
    const descent = dv.getInt16(hhea + 6);
    const nHM = dv.getUint16(hhea + 34);

    const numGlyphs = dv.getUint16(t('maxp') + 4);
    const hm = t('hmtx');
    const lastAdv = nHM ? dv.getUint16(hm + (nHM - 1) * 4) : 0;
    const advance = (gid) => (gid < nHM ? dv.getUint16(hm + gid * 4) : lastAdv);

    const post = t('post');
    const italicAngle = post ? dv.getInt16(post + 4) + dv.getUint16(post + 6) / 65536 : 0;

    const os2 = t('OS/2');
    // sCapHeight only exists from table version 2; older faces fall back on the
    // ascent, which is what the field is for anyway.
    const capHeight = os2 && dv.getUint16(os2) >= 2 ? dv.getInt16(os2 + 88) : Math.round(ascent * 0.7);

    // cmap: prefer the (3,1) Windows Unicode subtable — every Google-static TTF
    // carries it as format 4, which covers the BMP and is all ASCII needs.
    let cmapFn = null;
    const cm = t('cmap');
    if (cm) {
      const count = dv.getUint16(cm + 2);
      let sub = 0, any = 0;
      for (let i = 0; i < count; i++) {
        const o = cm + 4 + i * 8;
        const plat = dv.getUint16(o), enc = dv.getUint16(o + 2), off = dv.getUint32(o + 4);
        if (plat === 3 && enc === 1) { sub = cm + off; break; }
        if (!any && plat === 0) any = cm + off;
      }
      if (!sub) sub = any;
      if (sub && dv.getUint16(sub) === 4) {
        const segX2 = dv.getUint16(sub + 6);
        const segs = segX2 / 2;
        const endAt = sub + 14, startAt = endAt + segX2 + 2, deltaAt = startAt + segX2, rangeAt = deltaAt + segX2;
        cmapFn = (code) => {
          for (let i = 0; i < segs; i++) {
            if (code > dv.getUint16(endAt + i * 2)) continue;
            if (code < dv.getUint16(startAt + i * 2)) return 0;
            const delta = dv.getInt16(deltaAt + i * 2);
            const range = dv.getUint16(rangeAt + i * 2);
            if (range === 0) return (code + delta) & 0xffff;
            const g = dv.getUint16(rangeAt + i * 2 + range + (code - dv.getUint16(startAt + i * 2)) * 2);
            return g ? (g + delta) & 0xffff : 0;
          }
          return 0;
        };
      }
    }

    return {
      bytes, dv, tab, unitsPerEm, locFmt, bbox, ascent, descent, capHeight,
      italicAngle, numGlyphs,
      glyph: (code) => (cmapFn ? cmapFn(code) : 0),
      // Advance as a fraction of the em — the units cancel at the use site.
      width: (ch) => {
        const gid = cmapFn ? cmapFn(ch.charCodeAt(0)) : 0;
        return gid ? advance(gid) / unitsPerEm : 0.5; // unmapped: half an em, the AFM fallback's habit
      },
      seen: null, // filled in by build(): the chars this page sets, for the subset
    };
  }

  // Rebuild the font with only the glyphs in f.seen (plus .notdef, plus
  // composite components, plus everything empty). Kept tables are the ones a
  // PDF consumer reads; checksums are recomputed and checkSumAdjustment reset,
  // because a validator that checks them must not find the subset's lies.
  function subsetTtf(f) {
    const { dv, bytes: u8 } = f;
    const gOff = f.tab.glyf.off;
    const locaAt = (i) => (f.locFmt === 0 ? 2 * dv.getUint16(f.tab.loca.off + i * 2) : dv.getUint32(f.tab.loca.off + i * 4));

    const keep = new Uint8Array(f.numGlyphs);
    keep[0] = 1; // .notdef
    const mark = (gid) => {
      if (keep[gid]) return;
      keep[gid] = 1;
      const s = locaAt(gid), e = locaAt(gid + 1);
      if (e <= s || dv.getInt16(gOff + s) !== -1) return; // empty or simple glyph
      // Composite: walk the component records and keep the children too.
      let p = gOff + s + 10; // past numberOfContours and the bbox
      for (;;) {
        const flags = dv.getUint16(p);
        mark(dv.getUint16(p + 2));
        p += 4 + (flags & 1 ? 4 : 2); // args: words or bytes
        if (flags & 8) p += 2; // F2Dot14 scale
        else if (flags & 0x40) p += 8; // 2×2 matrix
        else if (flags & 0x80) p += 4; // x-y scale pair
        if (!(flags & 0x20)) break; // MORE_COMPONENTS
      }
    };
    for (const ch of f.seen) {
      const gid = f.glyph(ch.charCodeAt(0));
      if (gid) mark(gid);
    }

    // New glyf: kept glyphs in place, dropped ones emptied; loca rebuilt around
    // it. Glyph count is unchanged, so hmtx/maxp stay valid untouched.
    const chunks = [];
    const newLoca = [];
    let cur = 0;
    for (let g = 0; g < f.numGlyphs; g++) {
      newLoca.push(cur);
      if (!keep[g]) continue;
      const s = locaAt(g), e = locaAt(g + 1);
      const n = e - s;
      const padded = (n + 3) & ~3;
      chunks.push(u8.subarray(gOff + s, gOff + e));
      if (padded > n) chunks.push(new Uint8Array(padded - n));
      cur += padded;
    }
    newLoca.push(cur);

    const pad4 = (n) => (n + 3) & ~3;
    const checksumOf = (d) => {
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum += d[i] * 0x1000000 + (d[i + 1] || 0) * 0x10000 + (d[i + 2] || 0) * 0x100 + (d[i + 3] || 0);
      }
      return sum >>> 0;
    };
    const concat = (list) => {
      const out = new Uint8Array(list.reduce((a, p) => a + p.length, 0));
      let o = 0;
      for (const p of list) { out.set(p, o); o += p.length; }
      return out;
    };
    const locaBytes = (() => {
      const b = new Uint8Array(newLoca.length * (f.locFmt === 0 ? 2 : 4));
      const w = new DataView(b.buffer);
      newLoca.forEach((v, i) => (f.locFmt === 0 ? w.setUint16(i * 2, v / 2) : w.setUint32(i * 4, v)));
      return b;
    })();

    // Sorted by tag, as the spec demands; layout tables dropped (see above).
    const tables = [];
    for (const tag of ['OS/2', 'cmap', 'cvt ', 'fpgm', 'gasp', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post', 'prep']) {
      const src = f.tab[tag];
      if (!src) continue;
      let data;
      if (tag === 'glyf') data = concat(chunks);
      else if (tag === 'loca') data = locaBytes;
      else data = u8.slice(src.off, src.off + src.len);
      if (tag === 'head') new DataView(data.buffer).setUint32(8, 0); // checkSumAdjustment, zeroed while summing
      tables.push({ tag, data });
    }

    const total = 12 + 16 * tables.length + tables.reduce((a, t) => a + pad4(t.data.length), 0);
    const out = new Uint8Array(total);
    const w = new DataView(out.buffer);
    const entries = Math.floor(Math.log2(tables.length));
    w.setUint32(0, 0x00010000);
    w.setUint16(4, tables.length);
    w.setUint16(6, 2 ** entries * 16);
    w.setUint16(8, entries);
    w.setUint16(10, tables.length * 16 - 2 ** entries * 16);
    let off = 12 + 16 * tables.length;
    let headAt = 0;
    tables.forEach((t, i) => {
      const o = 12 + i * 16;
      for (let k = 0; k < 4; k++) out[o + k] = t.tag.charCodeAt(k);
      w.setUint32(o + 4, checksumOf(t.data));
      w.setUint32(o + 8, off);
      w.setUint32(o + 12, t.data.length);
      out.set(t.data, off);
      if (t.tag === 'head') headAt = off;
      off += pad4(t.data.length);
    });
    w.setUint32(headAt + 8, (0xb1b0afba - checksumOf(out)) >>> 0);
    return out;
  }

  // The PDF side of an embedded face: a simple TrueType font over WinAnsi,
  // widths in thousandths of an em taken from the parsed tables. Only codes
  // 32-126 are declared because ascii() guarantees nothing else is emitted.
  function embeddedFontDict(name, f, fileRef) {
    const k = 1000 / f.unitsPerEm;
    const widths = [];
    for (let code = 32; code <= 126; code++) widths.push(Math.round(f.width(String.fromCharCode(code)) * 1000));
    return `<< /Type /Font /Subtype /TrueType /BaseFont /${name} /FirstChar 32 /LastChar 126 ` +
      `/Widths [${widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor << /Type /FontDescriptor ` +
      `/FontName /${name} /Flags 32 /FontBBox [${f.bbox.map((v) => Math.round(v * k)).join(' ')}] ` +
      `/ItalicAngle ${Math.round(f.italicAngle * 100) / 100} /Ascent ${Math.round(f.ascent * k)} ` +
      `/Descent ${Math.round(f.descent * k)} /CapHeight ${Math.round(f.capHeight * k)} /StemV 80 ` +
      `/FontFile2 ${fileRef} >> >>`;
  }

  // ---------------------------------------------------------------- invitation type

  // Adobe's standard AFM advance widths (units/1000) for the Times faces, chars
  // 32-126 — public constants of the standard-14 metrics, so centering serif
  // text is as exact as the Courier arithmetic above. These are the fallback
  // faces when the embedded ones aren't supplied; anything outside the table
  // falls back to 500 (the figures' width).
  const TIMES_ROMAN = [
    250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
    921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
    556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
    333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
    500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
  ];
  const TIMES_BOLD = [
    250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500,
    930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778,
    611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500,
    333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500,
    556, 500, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520,
  ];
  const TIMES_ITALIC = [
    250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500,
    920, 611, 611, 667, 722, 611, 611, 722, 722, 333, 444, 667, 556, 833, 667, 722,
    611, 722, 611, 500, 556, 722, 611, 833, 611, 556, 556, 389, 278, 389, 422, 500,
    333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 500, 278, 778, 500, 500,
    500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
  ];

  // Advance width of a string in one of the Times faces, in page units.
  function serifWidth(s, size, table) {
    let w = 0;
    for (const ch of ascii(s)) {
      const code = ch.charCodeAt(0);
      w += (code >= 32 && code <= 126 ? table[code - 32] : 500) / 1000 * size;
    }
    return w;
  }

  // A small filled diamond — the engraved ornament this sheet's frame corners
  // and rules are dressed with. Letterpress invitations earn their look from
  // exactly these repeated tiny cuts, not from more ink.
  function diamond(c, cx, yTop, r, color) {
    const y = PAGE_H - yTop;
    c.fill(...color);
    c.raw(`${cx} ${y + r} m ${cx + r} ${y} l ${cx} ${y - r} l ${cx - r} ${y} l h f`);
  }

  // A centered rule broken by a diamond where the telegram used a plain line.
  function diamondRule(c, x1, x2, yTop, color, w) {
    const mid = (x1 + x2) / 2;
    c.stroke(...color).width(w).line(x1, yTop, mid - 9, yTop);
    c.line(mid + 9, yTop, x2, yTop);
    diamond(c, mid, yTop, 3, color);
  }

  // ---------------------------------------------------------------- the encrypted sheet

  // Deliberately nothing like the telegram, in genre or in type. The plain
  // sheet is an urgent message set in typewriter mono; this one is an artifact
  // you keep, so it's an engraved invitation — classic letterpress in the Times
  // faces, with the guest's name in italic as the inked hand. The only Courier
  // on the page is the key itself: everything else is read by a person, but
  // that string is transcribed by one, character by character.
  //
  // Every flourish still carries real information: the invitation language is
  // literally true (the password IS required for entry; the key DOES attend in
  // disguise), the serial still eyeballs against the account list, and the
  // warnings at the bottom stay plain sentences, as on the telegram.
  function drawEncryptedPage(c, opts) {
    const ncryptsec = opts.ncryptsec;
    const M = 40;

    // The faces. With embedded fonts (the panel always sends them): a
    // copperplate script for the guest's name, the Garamond the body is set
    // in, and the Playfair the Speakeasy theme already wears for display — so
    // the sheet and the app share a wardrobe. Without them the Times trio
    // stands in: same layout, plainer letter.
    const F = (opts.fonts && {
      script: { f: 'F6', font: opts.fonts.script },
      roman: { f: 'F7', font: opts.fonts.text },
      ital: { f: 'F8', font: opts.fonts.textItalic },
      display: { f: 'F9', font: opts.fonts.display },
    }) || {
      script: { f: 'F5', w: TIMES_ITALIC },
      roman: { f: 'F3', w: TIMES_ROMAN },
      ital: { f: 'F5', w: TIMES_ITALIC },
      display: { f: 'F4', w: TIMES_BOLD },
    };
    // One advance lookup for both worlds: embedded metrics from hmtx, AFM
    // tables for the standard-14 stand-ins.
    const adv = (face, ch, size) => (face.font
      ? face.font.width(ch) * size
      : ((face.w[ch.charCodeAt(0) - 32] || 500) / 1000) * size);
    // Centered line with optional tracking. Per character rather than through
    // Tc, same discipline as the telegram's trackedCentered: the real advance
    // widths drive both the centering and the letter-spacing, and proportional
    // faces have no shortcut the way Courier's 600-em did. Every glyph drawn
    // is recorded on its face — that set is what the subset keeps.
    const set = (yTop, str, face, size, track) => {
      const chars = ascii(str).split('');
      let w = 0;
      for (let i = 0; i < chars.length; i++) w += adv(face, chars[i], size) + (i ? track : 0);
      let x = (PAGE_W - w) / 2;
      c.fill(...INK);
      for (const ch of chars) {
        if (ch !== ' ') {
          c.text(x, yTop, ch, size, face.f);
          if (face.font) face.font.seen.add(ch);
        }
        x += adv(face, ch, size) + track;
      }
    };
    // Flush-left text in an embedded face (labels, warnings, footer) — routed
    // through here for the same glyph-recording reason.
    const txt = (x, yTop, str, size, face) => {
      if (face.font) for (const ch of ascii(str)) if (ch !== ' ') face.font.seen.add(ch);
      c.text(x, yTop, str, size, face.f);
    };
    const widthIn = (face, str, size) => {
      let w = 0;
      for (const ch of ascii(str)) w += adv(face, ch, size);
      return w;
    };

    c.beginOptional('MC0');
    c.fill(...PAPER).rect(0, 0, PAGE_W, PAGE_H);
    c.endOptional();
    const BAND = 12;
    c.fill(...PAPER).ring(M, M, PAGE_W - M * 2, PAGE_H - M * 2, BAND);
    c.stroke(...INK).width(2).rect(M, M, PAGE_W - M * 2, PAGE_H - M * 2, 'S');
    c.width(0.6).rect(M + BAND, M + BAND, PAGE_W - (M + BAND) * 2, PAGE_H - (M + BAND) * 2, 'S');
    // Engraved corner ornaments, sitting where the inner frame's rules meet.
    const IB = M + BAND;
    for (const [cx, cy] of [
      [IB, IB], [PAGE_W - IB, IB], [IB, PAGE_H - IB], [PAGE_W - IB, PAGE_H - IB],
    ]) diamond(c, cx, cy, 3.2, BRONZE);

    // ---- invitation, on a single centered axis
    let y = M + 30;
    set(y, 'Sidecar invites you to a private masquerade', F.ital, 12, 0.6);
    y += 18;
    const maskH = 42;
    drawMask(c, (PAGE_W - MASK_VIEWBOX.w * (maskH / MASK_VIEWBOX.h)) / 2, y, maskH);
    y += maskH + 34;
    // The save-the-date slot. Where an invitation begs a place on your
    // calendar, this one begs a place in your safe.
    set(y, 'SAVE YOUR KEY', F.display, 30, 3);
    y += 26;
    diamondRule(c, M + 30, PAGE_W - M - 30, y, BRONZE, 1);

    // ---- the guest, in ink: the one line set in script, oversized because a
    // copperplate's tiny x-height reads small next to print. Under it, the
    // guest's "address" — enough of the npub to eyeball the sheet against the
    // account list, in the body's roman because the script is for names, not
    // keys. No name at hand (the sheet can print before any profile exists)
    // reads as "the bearer", which is also literally who the sheet restores.
    // The name block centers IN the band between the two diamond rules, not
    // just below the first: the script's ink rises 0.906em (30.8pt at 34pt)
    // above its baseline, the npub line's ink sits ~2pt below its own, and the
    // two are one tight unit 18pt apart — 51pt of ink in a 94pt band, so ~21pt
    // of air either side. Measured from the face's glyf boxes, not eyeballed:
    // script at 34 clears by 21, npub at 7.5 clears by 22.
    y += 52;
    const guest = ascii(opts.name || '').trim() || 'the bearer of this sheet';
    set(y, guest, F.script, 34, 0);
    // The name and its "address" line are one unit — tight under the script
    // (which carries its own air in the loops).
    y += 18;
    set(y, opts.npub.slice(0, 14) + '...' + opts.npub.slice(-6), F.roman, 7.5, 1.2);
    y += 24;
    diamondRule(c, M + 30, PAGE_W - M - 30, y, BRONZE, 1);

    // ---- the date, centered where the telegram had its form strip. An
    // invitation states its occasion, it doesn't itemize — so no serial, no
    // "ENCRYPTED RECORD" banner, just when it was issued. The hour, not only
    // the day, is what tells two sheets apart when one was printed under each
    // of two passwords; and the zone rides inline ("UTC") because there is no
    // column label here to declare it, as the telegram's FILED field has.
    y += 20;
    set(y, opts.stamp + ' UTC', F.roman, 7, 1.4);

    // ---- the invitation's body
    y += 20;
    set(y, 'Your key attends in disguise.', F.ital, 11, 0);
    y += 15;
    set(y, 'The string and the code below are your key, masked.', F.ital, 11, 0);
    y += 15;
    set(y, 'No password, no entry - and the password is not printed on this page.', F.ital, 11, 0);

    // ---- QR — the primary restore path, and the guest list at the door
    y += 22;
    const qrSize = 150;
    const qrX = (PAGE_W - qrSize) / 2;
    c.stroke(...INK).width(1).rect(qrX - 6, y - 6, qrSize + 12, qrSize + 12, 'S');
    drawQr(c, ncryptsec, qrX, y, qrSize);
    y += qrSize + 22;
    // The one joke the sheet is allowed: a masquerade's password at the door
    // and a NIP-49 password are the same sentence here.
    set(y, 'PASSWORD REQUIRED FOR ENTRY', F.display, 7.5, 2.2);

    // ---- the masked key, in a box, as selectable text
    y += 16;
    const boxH = 48;
    c.fill(1, 1, 1).rect(M + 22, y, PAGE_W - (M + 22) * 2, boxH);
    c.stroke(...INK).width(1).rect(M + 22, y, PAGE_W - (M + 22) * 2, boxH, 'S');
    // Everything above sits on the page's centered axis, so the box joins it:
    // label and code centered, the code block's padding even top and bottom.
    // The halves are equal length, so centering keeps them flush with each
    // other — still one left-to-right transcription.
    const label = 'THE KEY, IN DISGUISE (NCRYPTSEC) - COPY IT EXACTLY';
    txt((PAGE_W - widthIn(F.roman, label, 6.5)) / 2, y + 11, label, 6.5, F.roman);
    // ~118 bech32 characters: split once near the middle at full 8pt rather
    // than shrinking the type, so transcription stays readable. The split is
    // mid-string on a character boundary — bech32 has no delimiters, and both
    // halves together are the value. Set in Courier-Bold, the page's one piece
    // of typewriter mono, because this is the part a human copies by hand.
    // The pair is centered on the box, not the label-plus-pair: the code is
    // the content, the label its caption hugging the top edge.
    const mid = Math.ceil(ncryptsec.length / 2);
    const codeX = (half) => (PAGE_W - half.length * 0.6 * 8) / 2;
    c.fill(...INK).text(codeX(ncryptsec.slice(0, mid)), y + 20, ncryptsec.slice(0, mid), 8, 'F2');
    c.text(codeX(ncryptsec.slice(mid)), y + 32, ncryptsec.slice(mid), 8, 'F2');
    y += boxH + 14;

    // ---- warnings, in plain sentences on purpose (as the telegram). The
    // conceit stops at the rules: the heading is a plain instruction.
    c.stroke(...INK).width(0.5).line(M + 22, y, PAGE_W - M - 22, y);
    y += 18;
    c.fill(...INK);
    txt(M + 30, y, 'Keep your password secure', 10, F.display);
    y += 13;
    for (const l of [
      'Anyone holding this page AND its password becomes you on Nostr.',
      'Keep the password somewhere separate, like a password manager.',
      'Without the password this page is just paper: it cannot recover',
      'your account, and neither can Sidecar. Lose both and it is gone.',
    ]) { txt(M + 30, y, l, 8.6, F.roman); y += 12; }

    // ---- the house's mark, signing the invitation at the foot, flush right —
    // the way an engraver's chop signs a plate from the corner. Its right edge
    // aligns with the rules above and sits directly over `sidecar.top`, and it
    // keeps clear of the warnings' column entirely.
    const footY = PAGE_H - M - 22;
    const chopH = 22;
    drawMark(c, PAGE_W - M - 30 - MARK_VIEWBOX.w * (chopH / MARK_VIEWBOX.h), footY - 42, chopH);

    c.stroke(...BRONZE).width(0.5).line(M + 22, footY - 12, PAGE_W - M - 22, footY - 12);
    c.fill(...INK);
    txt(M + 30, footY, 'SIDECAR - A CLASSY NOSTR SIGNER', 7, F.roman);
    const site = 'sidecar.top';
    // 10pt where the left footer line sits at 7. Garamond's lowercase is low-
    // waisted — its x-height is under half the em — so the size gap has to come
    // from the ascenders (t, d, c's overshoot), not the body of the letters:
    // at 10 the tall strokes clear the caps line's 4.1pt caps while the x-height
    // stays level with them, which is the whole difference. (The telegram's
    // Courier footer stays 7 — mono at 7 reads as large as Garamond at 9.)
    txt(PAGE_W - M - 30 - widthIn(F.roman, site, 10), footY, site, 10, F.roman);
  }

  // Filenames mirror the vault export's convention (sidecar-backup-<npub12>.json).
  // The two variants must never share one: side by side in a Downloads folder
  // they are indistinguishable until opened, and the difference is the whole
  // point — the encrypted sheet is safe to keep, the plain one is the account
  // in the clear. The variant word sits before the npub so both names stay
  // prefix-adjacent and still sort together per account.
  function filename(npub, ncryptsec) {
    return (ncryptsec ? 'sidecar-encrypted-key-' : 'sidecar-key-') + ascii(npub).slice(0, 12) + '.pdf';
  }

  root.SidecarBackupPdf = { build, filename };
})(window);
