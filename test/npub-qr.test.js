'use strict';

// A scannable npub, in the Profile tab and the accounts menu.
//
// TWO ENCODINGS, because the clients that draw one of these do not agree. Jumble encodes
// `nostr:npub1…` (NIP-21, so a Nostr app deep-links into the profile); Wisp encodes the
// bare `npub1…`, and deliberately — its rich-text parser handles nostr: URIs elsewhere,
// so that is a choice. Both scan. Rather than pick one and be wrong for half the people
// holding a phone at the screen, the view offers both.
//
// `nostr:` is the default: it matches every other QR Sidecar draws (both Lightning
// address codes and the invoice all carry their scheme) and it is the form a client can
// act on rather than merely read.
//
// The drawing itself is verified in a browser rather than here — the rendered canvas is
// decoded back with jsQR and compared to the string on screen, for both modes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function modalSource() {
  const start = panel.indexOf('  function npubQrModal(a) {');
  assert.notEqual(start, -1, 'npubQrModal not found');
  let depth = 0;
  for (let i = start; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(start, i + 1);
  }
  throw new Error('npubQrModal braces never balanced');
}
const modal = modalSource();

test('both encodings are offered, and nostr: is the default', () => {
  assert.match(panel, /let _npubQrScheme = 'nostr';/, 'the default');
  assert.match(
    modal,
    /_npubQrScheme === 'nostr' \? 'nostr:' \+ npub : npub/,
    'nostr: prefixes, bare does not'
  );
  assert.match(modal, /\[\['nostr', 'nostr:'\], \['bare', 'npub'\]\]/, 'both modes, labeled as what they produce');
});

test('COPY HANDS OVER WHAT WAS SCANNED', () => {
  // The screen shows one encoding and the button sits directly under it. Copying the bare
  // npub while the code encodes a nostr: URI would hand someone a different string from
  // the one they just pointed a camera at.
  const i = modal.indexOf("value.addEventListener('click'");
  assert.notEqual(i, -1);
  assert.match(modal.slice(i, i + 300), /copyPlain\(encoded\(\)\)/);
});

test('the QR is repainted when the encoding changes', () => {
  // Otherwise the label flips and the code keeps saying the other thing — the worst
  // possible outcome for a control whose entire job is to change what is encoded.
  const i = modal.indexOf("b.addEventListener('click'");
  const body = modal.slice(i, modal.indexOf('chips.append(b)'));
  assert.match(body, /_npubQrScheme = mode;/);
  assert.match(body, /paint\(\);/);
});

test('both surfaces reach it', () => {
  // The two places the backlog named, and the two places an npub is already shown.
  assert.match(panel, /menuItem\('Show npub QR', 'qr', \(\) => npubQrModal\(a\)\)/);
  assert.match(panel, /iconButton\('Show npub QR', 'qr', \(\) => npubQrModal\(active\)\)/);
});

test('the copy chip keeps its one meaning', () => {
  // npubChip is copy-on-tap. Overloading that tap to also open a QR would make neither
  // behavior discoverable, so the QR is its own control beside it.
  assert.match(panel, /className: 'profile-npub-row'/);
  const chip = panel.slice(panel.indexOf('function npubChip(npub)'));
  assert.doesNotMatch(chip.slice(0, chip.indexOf('\n  }')), /npubQrModal/);
});

test('the code is drawn light-on-dark-proof', () => {
  // A QR that inherits a dark theme is a QR that does not scan. The quiet zone is forced
  // white regardless of palette, which is why this is a hardcoded color and not a token.
  assert.match(css, /\.npub-qr \{[^}]*background: #fff;/);
  assert.match(css, /\.npub-qr \{[^}]*padding: 10px;/, 'and it needs a quiet zone around it');
});

test('the face forces a higher error-correction level', () => {
  // Every other QR in the panel uses 'M'. This one carries a picture over its middle,
  // which covers modules — H recovers ~30% of a code against M's ~15%, and that margin is
  // the only reason covering any of it is safe. Dropping back to M to match the others
  // would look tidy and quietly break scanning.
  assert.match(modal, /SidecarQR\.draw\(canvas, v, 220, 'H'\)/);
});

test('the face is an overlay, and only when there is one', () => {
  // Drawn INTO the canvas it would taint it (a remote picture), and it would mean
  // reimplementing applyAvatar's loading and fallback. Stacked, it costs nothing.
  assert.match(modal, /className: 'npub-qr-stack'/);
  assert.match(modal, /if \(a && a\.picture\) \{/, 'no picture, no hole punched in the code');
  assert.match(modal, /applyAvatar\(face, a\);/);
  // The placeholder garnish would cover the same modules while telling a scanner nothing.
  assert.doesNotMatch(modal, /avatarEl\(/);
});

test('the face is small enough to be recoverable, with a clean boundary', () => {
  // ~19% of the code's width against H's ~30% recovery. Verified by decoding the drawn
  // code with the face composited over it; a control run showed decoding survives to
  // ~40% occlusion and fails at 50%, so the check is sensitive rather than trivially green.
  const face = css.match(/\.npub-qr-face \{[^}]*\}/)[0];
  const w = Number(face.match(/width: (\d+)px/)[1]);
  assert.ok(w > 0 && w <= 48, 'face is ' + w + 'px on a 220px code — too large stops it scanning');
  assert.match(face, /border: 3px solid #fff/, 'the ring separates picture from modules');
});
