// Sidecar permissions — per-site trust TIERS for window.nostr (modeled on nos2x / Alby).
//
// Each host has one level:
//   blocked   — reject everything
//   ask       — prompt for every request (default when unset)
//   readonly  — auto-allow read methods (getPublicKey, getRelays); prompt to sign/encrypt
//   trusted   — auto-allow everything
//
// Storage: sidecar_permissions = { <host>: { level, updatedAt } }

(function (root) {
  'use strict';

  const PERM_KEY = 'sidecar_permissions';
  const LEVELS = ['blocked', 'ask', 'readonly', 'trusted'];
  const READ_METHODS = ['getPublicKey', 'getRelays'];

  function get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function set(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  async function loadAll() {
    return (await get(PERM_KEY))[PERM_KEY] || {};
  }

  async function getLevel(host) {
    const all = await loadAll();
    return (all[host] && all[host].level) || 'ask';
  }

  async function setLevel(host, level) {
    if (!LEVELS.includes(level)) throw new Error('Invalid permission level: ' + level);
    const all = await loadAll();
    all[host] = { level, updatedAt: Date.now() };
    await set({ [PERM_KEY]: all });
    return all;
  }

  async function removeHost(host) {
    const all = await loadAll();
    delete all[host];
    await set({ [PERM_KEY]: all });
    return all;
  }

  // 'allow' | 'reject' | 'ask' for a (host, method) given its tier.
  function statusForLevel(level, method) {
    switch (level) {
      case 'blocked':
        return 'reject';
      case 'trusted':
        return 'allow';
      case 'readonly':
        return READ_METHODS.includes(method) ? 'allow' : 'ask';
      default:
        return 'ask';
    }
  }

  async function getPermissionStatus(host, method) {
    return statusForLevel(await getLevel(host), method);
  }

  root.SidecarPermissions = {
    LEVELS,
    READ_METHODS,
    getLevel,
    setLevel,
    removeHost,
    getPermissionStatus,
    getAll: loadAll,
  };
})(typeof self !== 'undefined' ? self : this);
