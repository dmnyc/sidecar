// Sidecar permissions — per-host, per-method allow/reject policy for window.nostr.
//
// Runs in the service worker (importScripts). A web page's call to a window.nostr
// method is gated by the policy stored for (host, method). "Allow forever" / "Reject
// forever" persist here; "Allow once" does not write anything.
//
// Storage layout:
//   sidecar_permissions = { <host>: { <type>: { policy:'allow'|'reject', created } } }

(function (root) {
  'use strict';

  const PERM_KEY = 'sidecar_permissions';

  function get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function set(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  async function loadAll() {
    return (await get(PERM_KEY))[PERM_KEY] || {};
  }

  // 'allow' | 'reject' | 'unknown'
  async function getPermissionStatus(host, type) {
    const all = await loadAll();
    const entry = all[host] && all[host][type];
    return entry ? entry.policy : 'unknown';
  }

  async function setPermission(host, type, policy) {
    const all = await loadAll();
    if (!all[host]) all[host] = {};
    all[host][type] = { policy, created: Date.now() };
    await set({ [PERM_KEY]: all });
    return all;
  }

  async function removePermission(host, type) {
    const all = await loadAll();
    if (all[host]) {
      delete all[host][type];
      if (Object.keys(all[host]).length === 0) delete all[host];
      await set({ [PERM_KEY]: all });
    }
    return all;
  }

  async function clearHost(host) {
    const all = await loadAll();
    delete all[host];
    await set({ [PERM_KEY]: all });
    return all;
  }

  root.SidecarPermissions = {
    getPermissionStatus,
    setPermission,
    removePermission,
    clearHost,
    getAll: loadAll,
  };
})(typeof self !== 'undefined' ? self : this);
