// Sidecar — QR scanner window.
//
// Opened as its own popup by the side panel, because MV3 side panels can't surface
// the camera permission prompt (no address bar to anchor it to) and getUserMedia
// rejects there immediately. Pattern ported from Resolvr's apogee, which solved
// the same problem the same way.
//
// The decoded key is handed to the SERVICE WORKER (SIDECAR_QR_SECRET), which parks
// it for exactly one claim. It is deliberately NOT broadcast: runtime.sendMessage
// with no target reaches every extension context, and an nsec shouldn't depend on
// ours being the only listener. This page also never renders the decoded value —
// the whole point is that it doesn't linger anywhere visible.
(function () {
  'use strict';

  const video = document.getElementById('scanq-video');
  const status = document.getElementById('scanq-status');
  const cancel = document.getElementById('scanq-cancel');

  let stream = null;
  let raf = 0;
  let done = false;

  function cleanup() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (stream) {
      stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
      stream = null;
    }
    try { video.srcObject = null; } catch (_) {}
  }

  cancel.addEventListener('click', () => window.close());
  // pagehide rather than unload: fires on window.close() and on navigation, and
  // is not skipped by the back/forward cache the way unload can be.
  window.addEventListener('pagehide', cleanup);

  const KEY_RE = /(?:nostr:)?((?:nsec|ncryptsec)1[a-z0-9]{20,})/i;

  // Native BarcodeDetector where it exists (Chromium) — it's markedly faster than
  // pushing every frame through jsQR — with the vendored jsQR as the fallback that
  // covers Firefox.
  function makeDetector() {
    if (typeof BarcodeDetector === 'function') {
      let det;
      try { det = new BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { det = null; }
      if (det) {
        return async (el) => {
          const hits = await det.detect(el);
          return hits && hits.length ? hits[0].rawValue : '';
        };
      }
    }
    const canvas = document.createElement('canvas');
    return async (el) => {
      const w = el.videoWidth;
      const h = el.videoHeight;
      if (!w || !h) return '';
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(el, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const res = window.jsQR(data, w, h, { inversionAttempts: 'dontInvert' });
      return res && res.data ? res.data : '';
    };
  }

  async function start() {
    try {
      // facingMode is a hint, not an exact constraint — a laptop with only a front
      // camera must still work.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      });
    } catch (e) {
      const name = e && e.name;
      status.textContent =
        name === 'NotAllowedError'
          ? 'Camera access was denied. Close this and use "Choose file" instead.'
          : name === 'NotFoundError'
            ? 'No camera was found. Close this and use "Choose file" instead.'
            : "Couldn't start the camera. Close this and use \"Choose file\" instead.";
      status.classList.add('scanq-err');
      return;
    }
    video.srcObject = stream;
    try { await video.play(); } catch (_) { /* autoplay may reject; frames still arrive */ }
    status.textContent = 'Point the camera at the QR code on your sheet.';

    const detect = makeDetector();
    const tick = async () => {
      if (done) return;
      try {
        const value = await detect(video);
        const m = value ? KEY_RE.exec(value) : null;
        if (m) {
          const secret = m[1].toLowerCase();
          done = true;
          status.textContent = 'Found it — sending to Sidecar…';
          // Await the hand-off before closing. Tearing the window down mid-send
          // would drop the key and look like a scan that silently did nothing.
          let ok = false;
          try {
            const reply = await chrome.runtime.sendMessage({ type: 'SIDECAR_QR_SECRET', value: secret });
            // Two layers: the worker's envelope is { ok, result }, and the handler's
            // own verdict is result.ok — it rejects anything that isn't a key. Reading
            // only the outer ok would treat a rejected value as delivered and close
            // the window, losing the scan.
            ok = !!(reply && reply.ok && reply.result && reply.result.ok);
          } catch (_) { ok = false; }
          if (!ok) {
            // Leave the window open. Retrying is safe — nothing was stored.
            done = false;
            status.textContent = "Couldn't hand that to Sidecar. Try again.";
            status.classList.add('scanq-err');
          } else {
            cleanup();
            window.close();
            return;
          }
        }
      } catch (_) { /* transient per-frame decode errors are expected */ }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  start();
})();
