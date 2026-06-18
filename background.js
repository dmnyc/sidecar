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
    if (!(await KS.isInitialized())) throw new Error('Sidecar has no accounts set up yet');

    const activePubkey = await KS.getActivePubkey();
    if (!activePubkey) throw new Error('No active Sidecar account');

    const status = await PERMS.getPermissionStatus(host, method);
    if (status === 'reject') throw new Error('Request rejected by user policy');

    const needsKey = SIGNER.needsPrivateKey(method);
    const needUnlock = needsKey && KS.isLocked();
    const needApproval = status !== 'allow';

    if (needApproval || needUnlock) {
      const decision = await openPrompt({
        host,
        method,
        params,
        activePubkey,
        npub: self.NostrTools.nip19.npubEncode(activePubkey),
        needUnlock,
        needApproval,
      });
      if (decision.action === 'reject' || decision.action === 'reject-forever') {
        if (decision.action === 'reject-forever') await PERMS.setPermission(host, method, 'reject');
        throw new Error('User rejected the request');
      }
      if (decision.action === 'allow-forever') await PERMS.setPermission(host, method, 'allow');
      // The prompt only returns allow* after a successful unlock (if one was needed).
    }

    bumpAutoLock();

    let result;
    if (method === 'getRelays') {
      result = await getConfiguredRelays();
    } else {
      const privBytes = needsKey ? await KS.getPrivkey(activePubkey) : null;
      result = await SIGNER.perform(method, params, privBytes, activePubkey);
    }
    sendResponse({ ok: true, result });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

// ============================================================================
// Keystore control messages (from side panel and prompt)
// ============================================================================
async function lockKeystore() {
  KS.lock();
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
      case 'SIDECAR_REMOVE_ACCOUNT':
        result = await KS.removeAccount(message.pubkey);
        break;
      case 'SIDECAR_RENAME_ACCOUNT':
        result = await KS.renameAccount(message.pubkey, message.name);
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
      case 'SIDECAR_SET_SETTINGS':
        await sset({ sidecar_settings: message.settings });
        result = message.settings;
        break;
      case 'SIDECAR_GET_PERMISSIONS':
        result = await PERMS.getAll();
        break;
      case 'SIDECAR_REMOVE_PERMISSION':
        result = await PERMS.removePermission(message.host, message.method);
        break;
      case 'SIDECAR_CLEAR_HOST':
        result = await PERMS.clearHost(message.host);
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
