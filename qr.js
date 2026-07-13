// Sidecar QR rendering — a thin canvas adapter over the vendored
// qrcode-generator.js (Kazuhiko Arase's MIT-licensed encoder; see VENDOR.md).
// Replaces the GPL-3.0-licensed QRious so the combined extension stays
// MIT-distributable. Same visual contract as before: a white card with dark
// modules and a quiet zone, drawn onto an existing <canvas> at a fixed size.
(function (root) {
  'use strict';

  // Draw `value` as a QR code onto `canvas` at exactly `size`×`size` pixels.
  // `level` is the QR error-correction level ('L', 'M', 'Q', 'H'; default 'M').
  // Modules are drawn at an integer scale (crisper than fractional scaling)
  // and centered; the leftover margin doubles as the quiet zone.
  function draw(canvas, value, size, level) {
    const qr = root.qrcode(0, level || 'M'); // typeNumber 0 → smallest version that fits
    qr.addData(String(value));
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 2; // minimum quiet-zone modules per side
    const scale = Math.max(1, Math.floor(size / (count + quiet * 2)));
    const offset = Math.floor((size - count * scale) / 2);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(offset + c * scale, offset + r * scale, scale, scale);
      }
    }
  }

  root.SidecarQR = { draw };
})(window);
