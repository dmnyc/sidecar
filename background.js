// Sidecar service worker — NIP-07 signer backend.
//
// Loads the crypto/keystore/permissions/signer modules and routes:
//   1. Page RPCs (window.nostr.* from a web page, via content.js) — gated by per-host
//      permission and the keystore lock; opens an approval/unlock popup when needed.
//   2. Side-panel & prompt control messages (init/unlock/lock/account management, etc.).
//
// Decrypted private keys live only in the keystore's in-memory map here. If this worker
// is killed (MV3 ~30s idle), that map is gone and the keystore re-locks — a feature.

importScripts('nostr-tools.js', 'crypto.js', 'keystore.js', 'permissions.js', 'signer.js');

const KS = self.SidecarKeystore;
const PERMS = self.SidecarPermissions;
const SIGNER = self.SidecarSigner;

const DEFAULT_RELAYS = {
  'wss://relay.damus.io': { read: true, write: true },
  'wss://nos.lol': { read: true, write: true },
  'wss://relay.primal.net': { read: true, write: true },
};

const AUTO_LOCK_ALARM = 'sidecar-auto-lock';

// ---- storage helpers ----
function sget(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function sset(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

async function getConfiguredRelays() {
  return (await sget('sidecar_relays')).sidecar_relays || DEFAULT_RELAYS;
}

// ---- per-site account binding ----
// A web client caches the pubkey from its first getPublicKey() and has no way to
// learn about an account switch. So we PIN each host to the account it logged in
// with: that host keeps signing as its bound identity regardless of which account
// is globally active. The global active account only drives new logins + the panel UI.
const SITE_ACCTS_KEY = 'sidecar_site_accounts';

async function getSiteAccount(host) {
  return ((await sget(SITE_ACCTS_KEY))[SITE_ACCTS_KEY] || {})[host] || null;
}
async function getAllSiteAccounts() {
  return (await sget(SITE_ACCTS_KEY))[SITE_ACCTS_KEY] || {};
}
async function setSiteAccount(host, pubkey) {
  const all = (await sget(SITE_ACCTS_KEY))[SITE_ACCTS_KEY] || {};
  if (all[host] === pubkey) return; // no-op when already bound (called on every RPC)
  all[host] = pubkey;
  await sset({ [SITE_ACCTS_KEY]: all });
}
async function clearSiteAccount(host) {
  const all = (await sget(SITE_ACCTS_KEY))[SITE_ACCTS_KEY] || {};
  delete all[host];
  await sset({ [SITE_ACCTS_KEY]: all });
}
async function clearSiteAccountsForPubkey(pubkey) {
  const all = (await sget(SITE_ACCTS_KEY))[SITE_ACCTS_KEY] || {};
  let changed = false;
  for (const h of Object.keys(all)) if (all[h] === pubkey) { delete all[h]; changed = true; }
  if (changed) await sset({ [SITE_ACCTS_KEY]: all });
}

// Resolve which account a host signs as: its valid binding, else the active
// account. Does NOT persist — we bind only after a request actually succeeds
// (see handleNostrRpc), so rejected/unused sites leave no stale binding.
async function resolveSiteAccount(host) {
  const bound = await getSiteAccount(host);
  if (bound && (await KS.hasAccount(bound))) return bound;
  return KS.getActivePubkey();
}

// ---- signing activity log (newest first, capped) ----
const ACTIVITY_KEY = 'sidecar_activity';
const ACTIVITY_MAX = 200;
async function logActivity(entry) {
  const cur = (await sget(ACTIVITY_KEY))[ACTIVITY_KEY] || [];
  cur.unshift(entry);
  if (cur.length > ACTIVITY_MAX) cur.length = ACTIVITY_MAX;
  await sset({ [ACTIVITY_KEY]: cur });
}

// ---- side panel open on toolbar click ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

// ============================================================================
// Approval / unlock prompt orchestration
// ============================================================================
const pendingPrompts = new Map(); // promptId -> { resolve, windowId, data, settled }
let promptMutex = Promise.resolve(); // serialize prompts so only one window is open

function openPrompt(data) {
  // Chain onto the mutex: each prompt waits for the previous to finish.
  const run = () =>
    new Promise((resolve) => {
      const promptId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const W = 440;
      const H = 600;
      chrome.windows.getCurrent((cur) => {
        const left =
          cur && cur.left != null && cur.width != null
            ? Math.round(cur.left + (cur.width - W) / 2)
            : undefined;
        const top =
          cur && cur.top != null && cur.height != null
            ? Math.round(cur.top + (cur.height - H) / 3)
            : undefined;
        chrome.windows.create(
          {
            url: chrome.runtime.getURL('prompt.html?id=' + promptId),
            type: 'popup',
            width: W,
            height: H,
            left,
            top,
            focused: true,
          },
          (win) => {
            pendingPrompts.set(promptId, { resolve, windowId: win && win.id, data, settled: false });
          }
        );
      });
    });
  const result = promptMutex.then(run, run);
  // Keep the chain alive regardless of outcome.
  promptMutex = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// If the user closes the popup without deciding, treat it as a cancel/reject.
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, p] of pendingPrompts) {
    if (p.windowId === windowId && !p.settled) {
      p.settled = true;
      pendingPrompts.delete(id);
      p.resolve({ action: 'reject' });
    }
  }
});

function settlePrompt(promptId, action) {
  const p = pendingPrompts.get(promptId);
  if (!p || p.settled) return;
  p.settled = true;
  pendingPrompts.delete(promptId);
  if (p.windowId != null) chrome.windows.remove(p.windowId).catch(() => {});
  p.resolve({ action });
}

// ============================================================================
// Page RPC handling (window.nostr.*)
// ============================================================================
async function handleNostrRpc(method, params, host, sendResponse) {
  try {
    if (!host) throw new Error('Missing host');
    await KS.ensureLoaded(); // rehydrate unlocked session if the SW was restarted
    if (!(await KS.isInitialized())) throw new Error('Sidecar has no accounts set up yet');

    // The identity this host signs as — pinned to whatever it logged in with,
    // independent of the globally-active account (prevents NIP-07 desync).
    const activePubkey = await resolveSiteAccount(host);
    if (!activePubkey) throw new Error('No active Sidecar account');

    const status = await PERMS.getPermissionStatus(activePubkey, host, method); // allow | reject | ask
    if (status === 'reject') throw new Error('This site is blocked in Sidecar');

    const needsKey = SIGNER.needsPrivateKey(method);
    const needUnlock = needsKey && KS.isLocked();
    const needApproval = status === 'ask';

    // Once unlocked, signing only needs site approval — no PIN re-entry.
    if (needApproval || needUnlock) {
      const st = await KS.getState();
      const acct = st.accounts.find((a) => a.pubkey === activePubkey);
      const decision = await openPrompt({
        host,
        method,
        params,
        activePubkey,
        npub: self.NostrTools.nip19.npubEncode(activePubkey),
        accountName: (acct && acct.name) || '',
        needUnlock,
        needApproval,
        level: await PERMS.getLevel(activePubkey, host),
      });
      if (decision.action === 'reject') throw new Error('You rejected this request');
      if (decision.action === 'block') {
        await PERMS.setLevel(activePubkey, host, 'blocked');
        throw new Error('This site is now blocked');
      }
      if (decision.action === 'trust') await PERMS.setLevel(activePubkey, host, 'trusted');
      // 'once' | 'trust' → proceed (after a successful unlock, if one was needed)
    }

    bumpAutoLock();

    let result;
    if (method === 'getRelays') {
      result = await getConfiguredRelays();
    } else {
      const privBytes = needsKey ? await KS.getPrivkey(activePubkey) : null;
      result = await SIGNER.perform(method, params, privBytes, activePubkey);
    }

    // Pin this host to the account it just successfully used (idempotent).
    await setSiteAccount(host, activePubkey);

    let kind;
    if (method === 'signEvent') {
      const ev = params && (params.event || params);
      kind = ev && ev.kind;
    }
    logActivity({ ts: Date.now(), host, method, kind, pubkey: activePubkey });

    sendResponse({ ok: true, result });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

// ============================================================================
// Keystore control messages (from side panel and prompt)
// ============================================================================
async function lockKeystore() {
  await KS.lock();
  SIGNER.clearCache();
  chrome.alarms.clear(AUTO_LOCK_ALARM);
}

function bumpAutoLock() {
  sget('sidecar_settings').then(({ sidecar_settings }) => {
    const minutes = (sidecar_settings && sidecar_settings.autoLockMinutes) || 0;
    if (minutes > 0 && !KS.isLocked()) {
      chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) lockKeystore();
});

async function handleControl(message, sendResponse) {
  try {
    await KS.ensureLoaded(); // reflect a session unlock that survived SW restart
    let result;
    switch (message.type) {
      case 'SIDECAR_GET_STATE':
        result = await KS.getState();
        break;
      case 'SIDECAR_INIT':
        result = await KS.initialize(message.pin);
        bumpAutoLock();
        break;
      case 'SIDECAR_UNLOCK':
        result = await KS.unlock(message.pin);
        bumpAutoLock();
        break;
      case 'SIDECAR_LOCK':
        await lockKeystore();
        result = await KS.getState();
        break;
      case 'SIDECAR_ADD_ACCOUNT':
        if (message.generate) result = await KS.generateAccount(message.name);
        else result = await KS.importSecret(message.secret, message.name);
        break;
      case 'SIDECAR_REMOVE_ACCOUNT': {
        result = await KS.removeAccount(message.pubkey);
        await PERMS.clearAccount(message.pubkey);
        await clearSiteAccountsForPubkey(message.pubkey);
        const acts = (await sget(ACTIVITY_KEY))[ACTIVITY_KEY] || [];
        await sset({ [ACTIVITY_KEY]: acts.filter((e) => e.pubkey !== message.pubkey) });
        break;
      }
      case 'SIDECAR_RENAME_ACCOUNT':
        result = await KS.renameAccount(message.pubkey, message.name);
        break;
      case 'SIDECAR_REORDER_ACCOUNTS':
        result = await KS.reorderAccounts(message.pubkeys);
        break;
      case 'SIDECAR_SET_PROFILE':
        result = await KS.setProfile(message.pubkey, { name: message.name, picture: message.picture });
        break;
      case 'SIDECAR_SET_ACTIVE':
        result = await KS.setActive(message.pubkey);
        break;
      case 'SIDECAR_CHANGE_PIN':
        result = await KS.changePin(message.oldPin, message.newPin);
        break;
      case 'SIDECAR_VERIFY_PIN':
        // Step-up re-auth for sensitive ops (reveal nsec/NWC, publish profile).
        result = { valid: await KS.verifyPin(message.pin) };
        break;
      case 'SIDECAR_REVEAL_NSEC': {
        // Extract private data — always step-up PIN, even while unlocked.
        if (KS.isLocked()) throw new Error('Keystore is locked');
        if (!(await KS.verifyPin(message.pin))) throw new Error('Incorrect PIN');
        const bytes = await KS.getPrivkey(message.pubkey);
        result = { nsec: self.NostrTools.nip19.nsecEncode(bytes) };
        break;
      }

      // ---- owner actions: sign/encrypt with the ACTIVE account's key ----
      // The panel builds events; signing happens here so the key never leaves the SW.
      case 'SIDECAR_OWNER_SIGN': {
        if (KS.isLocked()) throw new Error('Keystore is locked');
        if (message.pin != null && !(await KS.verifyPin(message.pin))) throw new Error('Incorrect PIN');
        const pk = await KS.getActivePubkey();
        result = self.NostrTools.finalizeEvent(message.event, await KS.getPrivkey(pk));
        break;
      }
      case 'SIDECAR_OWNER_ENCRYPT': {
        if (KS.isLocked()) throw new Error('Keystore is locked');
        const pk = await KS.getActivePubkey();
        const peer = message.peer || pk; // default: encrypt to self (backups)
        const m = message.nip === 44 ? 'nip44.encrypt' : 'nip04.encrypt';
        result = await SIGNER.perform(m, { pubkey: peer, plaintext: message.plaintext }, await KS.getPrivkey(pk), pk);
        break;
      }
      case 'SIDECAR_OWNER_DECRYPT': {
        if (KS.isLocked()) throw new Error('Keystore is locked');
        const pk = await KS.getActivePubkey();
        const peer = message.peer || pk;
        const m = message.nip === 44 ? 'nip44.decrypt' : 'nip04.decrypt';
        result = await SIGNER.perform(m, { pubkey: peer, ciphertext: message.ciphertext }, await KS.getPrivkey(pk), pk);
        break;
      }
      case 'SIDECAR_GET_RELAYS':
        result = await getConfiguredRelays();
        break;
      case 'SIDECAR_SET_RELAYS':
        await sset({ sidecar_relays: message.relays });
        result = message.relays;
        break;
      case 'SIDECAR_GET_SETTINGS':
        result = (await sget('sidecar_settings')).sidecar_settings || { autoLockMinutes: 0 };
        break;
      case 'SIDECAR_SET_SETTINGS': {
        const prev = (await sget('sidecar_settings')).sidecar_settings || {};
        const merged = { ...prev, ...message.settings };
        await sset({ sidecar_settings: merged });
        result = merged;
        break;
      }
      case 'SIDECAR_GET_PERMISSIONS':
        result = await PERMS.getAll(await KS.getActivePubkey());
        break;
      case 'SIDECAR_SET_LEVEL':
        result = await PERMS.setLevel(await KS.getActivePubkey(), message.host, message.level);
        break;
      case 'SIDECAR_REMOVE_HOST':
        result = await PERMS.removeHost(await KS.getActivePubkey(), message.host);
        await clearSiteAccount(message.host); // forget the binding so a re-login can pick a new account
        break;
      case 'SIDECAR_GET_SITE_BINDINGS':
        result = await getAllSiteAccounts();
        break;
      case 'SIDECAR_CLEAR_BINDING':
        // Detach only the account binding (leaves the bound account's
        // permissions intact) so a re-login on that site picks a new account.
        await clearSiteAccount(message.host);
        result = true;
        break;
      case 'SIDECAR_GET_ACTIVITY': {
        const me = await KS.getActivePubkey();
        const all = (await sget(ACTIVITY_KEY))[ACTIVITY_KEY] || [];
        result = all.filter((e) => e.pubkey === me);
        break;
      }
      case 'SIDECAR_CLEAR_ACTIVITY': {
        const me = await KS.getActivePubkey();
        const all = (await sget(ACTIVITY_KEY))[ACTIVITY_KEY] || [];
        const kept = all.filter((e) => e.pubkey !== me);
        await sset({ [ACTIVITY_KEY]: kept });
        result = [];
        break;
      }
      case 'SIDECAR_SET_NWC':
        await KS.setNwc(message.pubkey, message.connection);
        result = { ok: true };
        break;
      case 'SIDECAR_GET_NWC':
        result = { connection: await KS.getNwc(message.pubkey) };
        break;
      case 'SIDECAR_HAS_NWC':
        result = { has: await KS.hasNwc(message.pubkey) };
        break;
      case 'SIDECAR_CLEAR_NWC':
        await KS.clearNwc(message.pubkey);
        result = { ok: true };
        break;
      default:
        throw new Error('Unknown control message: ' + message.type);
    }
    sendResponse({ ok: true, result });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

// ============================================================================
// Message router
// ============================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    sendResponse({ ok: false, error: 'Invalid message' });
    return false;
  }

  // Page RPC from content script.
  if (message.type === 'SIDECAR_NOSTR_RPC') {
    handleNostrRpc(message.method, message.params, message.host, sendResponse);
    return true;
  }

  // Prompt window asking for its context, or returning a decision.
  if (message.type === 'SIDECAR_GET_PROMPT_DATA') {
    const p = pendingPrompts.get(message.id);
    sendResponse(p ? { ok: true, data: p.data } : { ok: false, error: 'Prompt expired' });
    return false;
  }
  if (message.type === 'SIDECAR_PROMPT_RESULT') {
    settlePrompt(message.id, message.action);
    sendResponse({ ok: true });
    return false;
  }

  // Everything else is a keystore/config control message.
  handleControl(message, sendResponse);
  return true;
});
