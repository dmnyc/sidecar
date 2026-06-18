// Sidecar permissions — per-ACCOUNT, per-site trust TIERS for window.nostr.
//
// Each host (under a given account pubkey) has one level:
//   blocked   — reject everything
//   ask       — prompt for every request (default when unset)
//   readonly  — auto-allow read methods (getPublicKey, getRelays); prompt to sign/encrypt
//   trusted   — auto-allow everything
//
// Storage: sidecar_permissions = { <pubkey>: { <host>: { level, updatedAt } } }
// Trust granted to one identity never leaks to another.

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

  async function loadRoot() {
    return (await get(PERM_KEY))[PERM_KEY] || {};
  }

  // Legacy (pre-scoping) shape was flat host→{level}. Detect by a top-level
  // value carrying a `level` string (new shape nests host-maps under pubkeys).
  function isLegacy(rootMap) {
    return Object.values(rootMap).some((v) => v && typeof v.level === 'string');
  }

  // Migrate a legacy global map onto the currently-active account, once.
  async function migrate(pubkey) {
    const rootMap = await loadRoot();
    if (!isLegacy(rootMap)) return rootMap;
    if (!pubkey) return rootMap; // don't discard legacy data before we know the active account
    const migrated = { [pubkey]: rootMap }; // attribute existing grants to active account
    await set({ [PERM_KEY]: migrated });
    return migrated;
  }

  async function accountMap(pubkey) {
    const rootMap = await migrate(pubkey);
    return rootMap[pubkey] || {};
  }

  async function getLevel(pubkey, host) {
    const m = await accountMap(pubkey);
    return (m[host] && m[host].level) || 'ask';
  }

  async function setLevel(pubkey, host, level) {
    if (!LEVELS.includes(level)) throw new Error('Invalid permission level: ' + level);
    const rootMap = await migrate(pubkey);
    if (!rootMap[pubkey]) rootMap[pubkey] = {};
    rootMap[pubkey][host] = { level, updatedAt: Date.now() };
    await set({ [PERM_KEY]: rootMap });
    return rootMap[pubkey];
  }

  async function removeHost(pubkey, host) {
    const rootMap = await migrate(pubkey);
    if (rootMap[pubkey]) delete rootMap[pubkey][host];
    await set({ [PERM_KEY]: rootMap });
    return rootMap[pubkey] || {};
  }

  // Drop an account's entire permission set (called when an account is removed).
  async function clearAccount(pubkey) {
    const rootMap = await loadRoot();
    delete rootMap[pubkey];
    await set({ [PERM_KEY]: rootMap });
    return rootMap;
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

  async function getPermissionStatus(pubkey, host, method) {
    return statusForLevel(await getLevel(pubkey, host), method);
  }

  root.SidecarPermissions = {
    LEVELS,
    READ_METHODS,
    getLevel,
    setLevel,
    removeHost,
    clearAccount,
    getPermissionStatus,
    getAll: accountMap,
  };
})(typeof self !== 'undefined' ? self : this);
