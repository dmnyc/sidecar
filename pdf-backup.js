// Sidecar — printable account backup, styled as an old-fashioned telegram.
//
// Why a hand-rolled PDF writer instead of a library: VENDOR.md keeps this repo to
// four vendored bundles, each byte-traceable to an npm artifact and SHA-256 verified
// by CI. A PDF library would add a fifth (~350KB) and a new supply-chain surface for
// what is, in the end, ruled lines and monospace text. PDF 1.4 is a text format, and
// Courier is one of the standard-14 fonts every reader ships — so nothing is embedded
// and nothing new is trusted.
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
      raw(s) { ops.push(s); return api; },
      toString() { return ops.join('\n'); },
    };
    return api;
  }

  // Assemble the object graph, xref table and trailer. Offsets are computed on
  // ENCODED BYTES, not string length, so a stray multi-byte character can't slide
  // the xref and corrupt the file.
  function assemble(objects) {
    const enc = new TextEncoder();
    const parts = ['%PDF-1.4\n'];
    let bytes = enc.encode(parts[0]).length;
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(bytes);
      const chunk = `${i + 1} 0 obj\n${body}\nendobj\n`;
      parts.push(chunk);
      bytes += enc.encode(chunk).length;
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
  function markPath(c, d, x, yTop, scale) {
    const px = (v) => x + v * scale;
    const py = (v) => PAGE_H - (yTop + v * scale);
    // Split into command letters plus their number runs.
    const tokens = d.match(/[MHVCZ][^MHVCZ]*/gi) || [];
    let cx = 0, cy = 0;
    for (const t of tokens) {
      const cmd = t[0];
      const n = (t.slice(1).match(/-?\d*\.?\d+/g) || []).map(Number);
      if (cmd === 'M') { cx = n[0]; cy = n[1]; c.raw(`${px(cx)} ${py(cy)} m`); }
      else if (cmd === 'H') { cx = n[0]; c.raw(`${px(cx)} ${py(cy)} l`); }
      else if (cmd === 'V') { cy = n[0]; c.raw(`${px(cx)} ${py(cy)} l`); }
      else if (cmd === 'C') {
        for (let i = 0; i + 5 < n.length; i += 6) {
          c.raw(`${px(n[i])} ${py(n[i + 1])} ${px(n[i + 2])} ${py(n[i + 3])} ${px(n[i + 4])} ${py(n[i + 5])} c`);
          cx = n[i + 4]; cy = n[i + 5];
        }
      } else if (cmd === 'Z') c.raw('h');
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
    const quiet = 2;
    const scale = size / (count + quiet * 2);
    const origin = { x: x + quiet * scale, y: yTop + quiet * scale };
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
    const when = opts.date instanceof Date ? opts.date : new Date();
    const stamp = when.toISOString().slice(0, 16).replace('T', '  ');

    const c = content();
    const M = 40; // page margin

    // Paper, then the double rule that frames every telegram blank.
    c.fill(...PAPER).rect(0, 0, PAGE_W, PAGE_H);
    c.stroke(...INK).width(2).rect(M, M, PAGE_W - M * 2, PAGE_H - M * 2, 'S');
    c.width(0.6).rect(M + 5, M + 5, PAGE_W - (M + 5) * 2, PAGE_H - (M + 5) * 2, 'S');

    // ---- letterhead
    let y = M + 20;
    const markH = 30;
    drawMark(c, (PAGE_W - MARK_VIEWBOX.w * (markH / MARK_VIEWBOX.h)) / 2, y, markH);
    y += markH + 20;
    c.fill(...INK).trackedCentered(y, 'SIDECAR TELEGRAPH COMPANY', 15, 'F2', 2.2);
    y += 16;
    c.fill(...BRONZE).trackedCentered(y, 'KEY CUSTODY DIVISION', 8, 'F1', 1.6);
    y += 14;
    c.stroke(...BRONZE).width(1).line(M + 22, y, PAGE_W - M - 22, y);
    y += 3;
    c.width(0.5).line(M + 22, y, PAGE_W - M - 22, y);

    // ---- the form strip a real blank carried across the top
    y += 20;
    const colX = [M + 22, M + 190, M + 350];
    c.fill(...BRONZE);
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
    c.fill(...BRONZE).text(colX[0], y, 'TO', 6.5, 'F1');
    // At account creation there is no profile yet — nsecModal runs before the setup
    // wizard — so the name is only available when printing for an existing account.
    const to = (opts.name || '').trim();
    c.fill(...INK).text(colX[0] + 26, y, to ? to.toUpperCase() : 'THE BEARER OF THIS SHEET', 9, 'F2');
    y += 13;
    c.fill(...BRONZE).text(colX[0], y, 'FROM', 6.5, 'F1');
    c.fill(...INK).text(colX[0] + 26, y, 'SIDECAR SIGNER, YOUR OWN DEVICE', 9, 'F2');
    y += 13;
    // KEY, not NPUB: the value on this line already begins "npub1", so an NPUB label
    // prints the same word twice on one line. "PUBLIC KEY" would be more precise but
    // overruns the 26pt label gutter TO and FROM share — and the value self-identifies
    // anyway, with the secret half explicitly labelled on the box below.
    c.fill(...BRONZE).text(colX[0], y, 'KEY', 6.5, 'F1');
    c.fill(...INK).text(colX[0] + 26, y, npub, 7.4, 'F1');
    y += 10;
    c.stroke(...BRONZE).width(0.5).line(M + 22, y, PAGE_W - M - 22, y);

    // ---- message (the conceit lives here and nowhere else)
    y += 20;
    c.fill(...BRONZE).trackedCentered(y, 'M E S S A G E', 7.5, 'F1', 1.2);
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
    c.fill(...BRONZE).text(M + 30, y + 12, 'SECRET KEY (NSEC) - SELECTABLE TEXT, COPY IT EXACTLY', 6.5, 'F1');
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
    c.fill(...BRONZE).centered(y, 'SCAN TO RESTORE - THIS CODE IS THE KEY', 7, 'F1');

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
      'Sidecar erases every key on this device after 21 wrong PIN attempts.',
      'If that happens, this sheet is the only way back. Store it offline -',
      "anywhere that syncs is a copy you don't control.",
    ]) { if (l) c.text(colX[0], y, l, 8.6, 'F1'); y += 12; }

    // ---- footer
    const footY = PAGE_H - M - 22;
    c.stroke(...BRONZE).width(0.5).line(M + 22, footY - 12, PAGE_W - M - 22, footY - 12);
    c.fill(...BRONZE).text(colX[0], footY, 'SIDECAR - A CLASSY NOSTR SIGNER', 7, 'F1');
    const site = 'sidecar.top';
    c.text(PAGE_W - M - 22 - textWidth(site, 7), footY, site, 7, 'F1');

    // ---- object graph
    const stream = c.toString();
    const streamBytes = new TextEncoder().encode(stream).length;
    const font = (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
    return assemble([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`,
      font('Courier'),
      font('Courier-Bold'),
    ]);
  }

  // Filename mirrors the vault export's convention (sidecar-backup-<npub12>.json).
  function filename(npub) {
    return 'sidecar-key-' + ascii(npub).slice(0, 12) + '.pdf';
  }

  root.SidecarBackupPdf = { build, filename };
})(window);
