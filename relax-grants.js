// Sidecar — timed "relax approvals" grant (isolated module).
//
// A user-initiated, time-bounded auto-approve for a (host, account): the escape
// hatch from the shared-host per-sign confirm, and a middle rung between "Allow
// once" and "Trust this site" on any ask-tier site. Unlike the coalesce grants in
// background.js (in-memory, 60s), this window is user-chosen in minutes and must
// outlive a service-worker restart, so it lives in chrome.storage.session with a
// chrome.alarm firing the revoke.
//
// ONE WINDOW AT A TIME: relaxing on a new site takes over the countdown — a fresh
// grant revokes any prior one, so the panel's single status bar always reflects
// the one active site/account. Revoked early on a re-login to a different account
// on the same host and on lock; the residual, undetectable case (a pure in-client
// switcher flip that fires no getPublicKey) is what the panel's relax bar reminds
// the user about.
//
// Isolated (like keystore.js / permissions.js) so it can be unit-tested directly
// against a chrome mock — see test/relax-grant.test.js.

(function () {
  'use strict';

  const STORAGE_KEY = 'sidecar_relax_grants';
  const ALARM_PREFIX = 'sidecar-relax:';
  const MAX_MS = 30 * 60 * 1000;      // hard cap, matching the prompt's presets
  const DEFAULT_MS = 15 * 60 * 1000;  // fallback when a decision carries no duration
  // Kinds that hand control of the account/wallet to another app or device. These
  // never relax — a per-sign confirm is exactly what gates them, even mid-window.
  const CONTROL_KINDS = new Set([24133, 23194, 23195]);

  function sgetS(keys) {
    return new Promise((r) => chrome.storage.session.get(keys, r));
  }
  function ssetS(obj) {
    return new Promise((r) => chrome.storage.session.set(obj, r));
  }
  function broadcast() {
    try { chrome.runtime.sendMessage({ type: 'SIDECAR_EVENT', event: 'relaxChanged' }).catch(() => {}); } catch (_) {}
  }

  function key(host, pubkey) { return host + '|' + pubkey; }
  function splitKey(k) {
    const i = k.indexOf('|');
    return i < 0 ? null : { host: k.slice(0, i), pubkey: k.slice(i + 1) };
  }

  async function map() {
    return (await sgetS(STORAGE_KEY))[STORAGE_KEY] || {};
  }

  async function has(host, pubkey) {
    const m = await map();
    const v = m[key(host, pubkey)];
    if (!v) return false;
    if (Date.now() >= v.exp) { await deleteKey(key(host, pubkey)); return false; } // lazy self-expire
    return true;
  }

  async function grant(host, pubkey, ms) {
    const dur = Math.min(ms || 0, MAX_MS);
    if (dur <= 0) return;
    const k = key(host, pubkey);
    // One window at a time: clear any other grant (and its alarm) so the new site
    // takes over the countdown. (The target's own alarm is cleared + re-armed
    // below, so a re-grant extends rather than stacks.)
    try {
      const alarms = await chrome.alarms.getAll();
      for (const a of alarms) {
        if (a.name.startsWith(ALARM_PREFIX) && a.name !== ALARM_PREFIX + k) chrome.alarms.clear(a.name);
      }
    } catch (_) {}
    const m = {};
    m[k] = { exp: Date.now() + dur, dur };
    await ssetS({ [STORAGE_KEY]: m });
    try { await chrome.alarms.clear(ALARM_PREFIX + k); } catch (_) {}
    chrome.alarms.create(ALARM_PREFIX + k, { delayInMinutes: dur / 60000 });
    broadcast();
  }

  async function deleteKey(k) {
    const m = await map();
    if (m[k] == null) return;
    delete m[k];
    await ssetS({ [STORAGE_KEY]: m });
    broadcast();
  }

  async function revoke(host, pubkey) {
    const k = key(host, pubkey);
    try { await chrome.alarms.clear(ALARM_PREFIX + k); } catch (_) {}
    await deleteKey(k);
  }

  async function revokeForHost(host) {
    const prefix = host + '|';
    const m = await map();
    let changed = false;
    for (const k of Object.keys(m)) {
      if (k.startsWith(prefix)) { delete m[k]; changed = true; }
    }
    if (!changed) return;
    await ssetS({ [STORAGE_KEY]: m });
    try {
      const alarms = await chrome.alarms.getAll();
      for (const a of alarms) {
        if (a.name.startsWith(ALARM_PREFIX + prefix)) chrome.alarms.clear(a.name);
      }
    } catch (_) {}
    broadcast();
  }

  async function revokeAll() {
    await ssetS({ [STORAGE_KEY]: {} });
    try {
      const alarms = await chrome.alarms.getAll();
      for (const a of alarms) {
        if (a.name.startsWith(ALARM_PREFIX)) chrome.alarms.clear(a.name);
      }
    } catch (_) {}
    broadcast();
  }

  // Active grants for the panel status bar; drops expired entries on the way out.
  // In practice one entry (grant enforces single-window), but returns an array.
  async function active() {
    const m = await map();
    const now = Date.now();
    const out = [];
    const expired = [];
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (now >= v.exp) { expired.push(k); continue; }
      const parts = splitKey(k);
      if (parts) out.push({ host: parts.host, pubkey: parts.pubkey, expiresAt: v.exp, duration: v.dur });
    }
    if (expired.length) {
      for (const k of expired) delete m[k];
      await ssetS({ [STORAGE_KEY]: m });
    }
    return out;
  }

  // chrome.alarms.onAlarm handler hook: if this is one of our expiry alarms,
  // drop the grant and return true (handled). Safe to call for any alarm name.
  function onAlarm(name) {
    if (typeof name === 'string' && name.startsWith(ALARM_PREFIX)) {
      deleteKey(name.slice(ALARM_PREFIX.length));
      return true;
    }
    return false;
  }

  const api = {
    STORAGE_KEY, ALARM_PREFIX, MAX_MS, DEFAULT_MS, CONTROL_KINDS,
    has, grant, revoke, revokeForHost, revokeAll, active, onAlarm,
    isControlKind: (k) => k != null && CONTROL_KINDS.has(k),
  };
  if (typeof self !== 'undefined') self.SidecarRelax = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarRelax = api;
})();
