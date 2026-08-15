// Sidecar — NIP-49 scrypt off the panel's main thread.
//
// The vendored nip49.js encrypt/decrypt is synchronous pure-JS scrypt (N=2^16
// at its default logn: ~64MB of memory-hard work), so every mint or import
// stalled the whole panel for a second or more — countdown timers, buttons,
// everything. This worker loads the SAME vendored file with importScripts, so
// nip49.js stays byte-identical and CI's sha256sum -c still passes; only the
// thread it runs on changes.
//
// Message shape: { id, op: 'encrypt' | 'decrypt', args } in, and
// { id, ok: true, result } | { id, ok: false, error } back. One id per call,
// no shared state — args and results are structured-cloneable by construction
// (byte arrays and strings).
importScripts('nip49.js');

onmessage = (e) => {
  const { id, op, args } = e.data || {};
  try {
    const fn = SidecarNip49[op === 'decrypt' ? 'decrypt' : 'encrypt'];
    postMessage({ id, ok: true, result: fn.apply(null, args) });
  } catch (err) {
    postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
