// Sidecar service worker — NIP-07 signer backend.
//
// Loads the crypto/keystore/permissions/signer modules and routes:
//   1. Page RPCs (window.nostr.* from a web page, via content.js) — gated by per-host
//      permission and the keystore lock; opens an approval/unlock popup when needed.
//   2. Side-panel & prompt control messages (init/unlock/lock/account management, etc.).
//
// Decrypted private keys live only in the keystore's in-memory map here. If this worker
// is killed (MV3 ~30s idle), that map is gone and the keystore re-locks — a feature.
//
// Chrome runs this file as a service worker and pulls its deps in via importScripts;
// Firefox has no MV3 service workers and runs it as an event page (a window, where
// importScripts doesn't exist) with the same files already loaded, in the same order,
// via manifest background.scripts. Both suspend after ~30s idle, so the
// survive-restart machinery below applies equally to both.

if (typeof importScripts === 'function') {
  importScripts('nostr-tools.js', 'crypto.js', 'keystore.js', 'permissions.js', 'signer.js', 'wallet-budgets.js', 'nwc-client.js', 'relax-grants.js', 'replaceable-baseline.js', 'zap-requests.js');
}

const KS = self.SidecarKeystore;
const PERMS = self.SidecarPermissions;
const SIGNER = self.SidecarSigner;
const BUDGETS = self.SidecarBudgets;
const NWC = self.SidecarNWC;
const RELAX = self.SidecarRelax;
const BASELINE = self.SidecarBaseline;
const ZAPREQ = self.SidecarZapRequests;

const DEFAULT_RELAYS = {
  'wss://nos.lol': { read: true, write: true },
  'wss://relay.snort.social': { read: true, write: true },
  'wss://nostr.mom': { read: true, write: true },
  'wss://offchain.pub': { read: true, write: true },
  'wss://relay.primal.net': { read: true, write: false },
};

const AUTO_LOCK_ALARM = 'sidecar-auto-lock';
// Idle auto-lock, in minutes. Applied only when the user has never touched the
// Settings dropdown — an explicit choice (including "Never", stored as 0) is
// always respected once saved. Keys shouldn't stay decrypted indefinitely in a
// browser that's left open; this only fires on true inactivity (bumpAutoLock is
// called on every sign/pay/unlock), so normal active use never hits it.
const DEFAULT_AUTO_LOCK_MINUTES = 15;
function resolveSettings(sidecar_settings) {
  return { autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES, ...(sidecar_settings || {}) };
}

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

// ---- SSRF guard for server-side fetches (link previews) ----
// The service worker fetch bypasses CORS and can reach the user's private
// network, so refuse hostnames that resolve to loopback / private / link-local
// space (incl. cloud metadata at 169.254.169.254) and non-http(s) schemes.
function isPrivateHostname(host) {
  const h = (host || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = +v4[1], b = +v4[2];
    if ([a, b, +v4[3], +v4[4]].some((n) => n > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;         // this-host, private, loopback
    if (a === 169 && b === 254) return true;                    // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;           // private
    if (a === 192 && b === 168) return true;                    // private
    if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
    if (a >= 224) return true;                                  // multicast / reserved
    return false;
  }
  // IPv6 literals (URL.hostname strips the brackets).
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true; // link-local / ULA
  if (h.startsWith('::ffff:')) return true; // IPv4-mapped
  return false;
}

// Validate a URL intended for a server-side fetch. Returns the parsed URL or null.
function safeFetchUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null; // no embedded credentials
  if (isPrivateHostname(u.hostname)) return null;
  return u;
}

// ---- per-site account binding ----
// A web client caches the pubkey from its last getPublicKey() and has no way to
// learn about an account switch. So we PIN each host to the account it logged in
// with: session-shaped requests (signEvent, nip04/nip44, relay auth) keep signing
// as the bound identity regardless of which account is globally active.
// getPublicKey() is the exception: it's a login — the site is asking "who are you
// now?" — so it follows the globally-active account and re-pairs the host to it
// (see handleNostrRpc). Log out of a site, switch accounts in the panel, log back
// in, and the site follows; open sessions on other sites never desync.
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
  await removeAuthorizedAccountEverywhere(pubkey);
}

// ---- multi-login safeguard: accounts that have signed in per host ----
// The binding above is a single account per host. But multi-login clients
// (Jumble, YakiHonne, Ditto, …) keep several sessions on ONE host and only tell
// us which account they mean at getPublicKey (login) — never at signing time,
// and their event templates carry no pubkey. So once 2+ of your accounts have
// used a host, the single binding can silently reflect the wrong slot. We track
// the SET of accounts that have acted on each host; a host with 2+ is "shared",
// and content signs there confirm who's posting when the binding and your active
// account disagree (see handleNostrRpc).
const SITE_AUTHZ_KEY = 'sidecar_site_authorized';

async function getAllAuthorized() {
  return (await sget(SITE_AUTHZ_KEY))[SITE_AUTHZ_KEY] || {};
}
// Accounts on `host` that STILL EXIST (a deleted account can't make a host shared).
async function getAuthorizedAccounts(host) {
  const list = (await getAllAuthorized())[host] || [];
  const existing = [];
  for (const pk of list) if (await KS.hasAccount(pk)) existing.push(pk);
  return existing;
}
async function addAuthorizedAccount(host, pubkey) {
  const all = await getAllAuthorized();
  const list = all[host] || [];
  if (list.includes(pubkey)) return;
  list.push(pubkey);
  all[host] = list;
  await sset({ [SITE_AUTHZ_KEY]: all });
}
async function removeAuthorizedAccount(host, pubkey) {
  const all = await getAllAuthorized();
  if (!all[host]) return;
  all[host] = all[host].filter((pk) => pk !== pubkey);
  if (!all[host].length) delete all[host];
  await sset({ [SITE_AUTHZ_KEY]: all });
}
async function removeAuthorizedAccountEverywhere(pubkey) {
  const all = await getAllAuthorized();
  let changed = false;
  for (const h of Object.keys(all)) {
    const next = all[h].filter((pk) => pk !== pubkey);
    if (next.length !== all[h].length) { changed = true; if (next.length) all[h] = next; else delete all[h]; }
  }
  if (changed) await sset({ [SITE_AUTHZ_KEY]: all });
}
async function clearAuthorizedForHost(host) {
  const all = await getAllAuthorized();
  if (!all[host]) return;
  delete all[host];
  await sset({ [SITE_AUTHZ_KEY]: all });
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

// ---- debug log (dev builds only) ----
// An in-memory ring buffer for the dev bug button's debug panel — separate
// from the user-facing Activity log above (which tracks signed events/
// payments per account). This is internal diagnostics: message dispatch,
// timings, and uncaught errors. In-memory only, so it resets on a service
// worker restart (~30s idle) — same tradeoff as the keystore re-locking.
// Chrome: the Web Store injects `update_url` when it packages a release, so its
// absence reliably means an unpacked dev load. Firefox/AMO never injects one, so
// that heuristic would flag every production install as dev — there, start closed
// and let management.getSelf() (async; getSelf is exempt from the "management"
// permission) flip it on for temporary about:debugging loads only.
let IS_DEV_BUILD = (() => {
  if (typeof browser !== 'undefined') return false; // Firefox: resolved async below
  try { return !chrome.runtime.getManifest().update_url; } catch (_) { return false; }
})();
const DEBUG_LOG_MAX = 300;
const debugLog = [];
function dlog(level, tag, msg, data) {
  if (!IS_DEV_BUILD) return;
  debugLog.push({ ts: Date.now(), level, tag, msg, data });
  if (debugLog.length > DEBUG_LOG_MAX) debugLog.shift();
  if (panelPort) { try { panelPort.postMessage({ type: 'SIDECAR_LOG_UPDATED' }); } catch (_) {} }
}
// ---- side panel open on toolbar click ----
chrome.runtime.onInstalled.addListener((details) => {
  if (chrome.sidePanel) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  createPayMenu();
  if (details.reason === 'install') {
    chrome.storage.local.remove('firstPostTipDismissed');
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});
chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  } else if (typeof browser !== 'undefined' && browser.sidebarAction) {
    // Firefox sidebar. toggle() only works when called synchronously from the
    // user-input handler — no awaits before this line.
    browser.sidebarAction.toggle();
  }
});

// ============================================================================
// Approval / unlock prompt queue — an OBSERVABLE, no-loss request queue.
// ============================================================================
// Every request needing approval/unlock is registered synchronously (never lost
// behind an invisible promise chain), mirrored to chrome.storage.session (which
// survives service-worker eviction but clears on browser restart — exactly a
// request's max lifetime), and shown one-at-a-time by an idempotent head-pointer
// (driveDisplay) rather than a promise mutex. A never-resolving display can't
// wedge the queue: reverting a shown entry to `queued` on a panel-port blip just
// re-drives. The resolve callbacks (which fulfill the live page request) live in
// memory only; an entry whose callback is gone after an SW restart becomes a
// dismissible "interrupted" tombstone — never signable, never pretending to be.
//
// Entry: { id, host, method, kind, scope, data, ts, deadline,
//          state: 'queued'|'showing'|'interrupted', display: 'none'|'panel'|'popup' }
const queue = [];               // ordered, observable (in-memory; metadata mirrored to session)
const callbacks = new Map();    // id -> { resolve, settled }  (in-memory only; the live page channel)
let popupWindowId = null;       // the reusable prompt popup window
let panelPort = null;           // the side panel's long-lived port while it's open
let panelWindowId = null;       // the browser window the open panel lives in (window-correct routing)
let graceTimer = null;          // panel-disconnect grace before falling back to a popup
const REQUEST_TTL = 175000;     // < content.js's 180s page timeout, so we never surface a dead request
const TOMBSTONE_TTL = 600000;   // interrupted tombstones self-clear after 10 min
const QUEUE_SESSION_KEY = 'sidecar_prompt_queue';
const QUEUE_KEEPALIVE_ALARM = 'sidecar-queue-keepalive';

// dlog() reads panelPort (declared above) to ping the panel on a new entry, so
// this must run after that declaration — the Chrome-path log call is synchronous.
function startDebugLog() {
  dlog('info', 'bg', 'Background started', { version: chrome.runtime.getManifest().version });
  self.addEventListener('error', (e) => {
    dlog('error', 'bg', 'Uncaught error', { message: e.message, filename: e.filename, lineno: e.lineno });
  });
  self.addEventListener('unhandledrejection', (e) => {
    dlog('error', 'bg', 'Unhandled rejection', { reason: String((e.reason && e.reason.message) || e.reason) });
  });
}
if (IS_DEV_BUILD) {
  startDebugLog();
} else if (typeof browser !== 'undefined') {
  // Firefox: the answer arrives async, so the first moments of logs are dropped —
  // failing closed beats showing dev UI to every AMO install.
  try {
    browser.management.getSelf().then((info) => {
      if (info.installType !== 'development') return;
      IS_DEV_BUILD = true;
      startDebugLog();
    }).catch(() => {});
  } catch (_) {}
}

// ---- session mirror (metadata only — no callbacks, no signable material) ----
function qGet() {
  return new Promise((r) => chrome.storage.session.get(QUEUE_SESSION_KEY, (x) => r(x[QUEUE_SESSION_KEY])));
}
function sanitizeEntry(e) {
  return {
    id: e.id, host: e.host, method: e.method, kind: e.kind, scope: e.scope,
    ts: e.ts, deadline: e.deadline, state: e.state,
    accountName: e.data ? e.data.accountName : e.accountName,
  };
}
function qPersist() {
  chrome.storage.session.set({ [QUEUE_SESSION_KEY]: queue.map(sanitizeEntry) }, () => void chrome.runtime.lastError);
}
// A bare "queue changed" ping — the panel re-queries SIDECAR_GET_PENDING (pull
// model: the background is the single source of truth, no push/pull desync).
function broadcastQueue() {
  if (!panelPort) return;
  try { panelPort.postMessage({ type: 'SIDECAR_QUEUE_UPDATED' }); } catch (_) {}
}
function liveEntries() { return queue.filter((e) => e.state !== 'interrupted'); }

// A content sign (note/reaction/DM/profile/app-data — not relay auth) that can be
// batched. Apps like Primal fire a burst of these on load (e.g. several kind:30078
// app-data syncs); confirming each separately is pure nag and trains users to
// click through. We batch only entries that share host + signing account + KIND —
// same-kind means a site can't slip a different event type into a batch, and the
// card names the kind + count so the user sees exactly what they're approving.
function isBatchableEntry(e) {
  if (e.state === 'interrupted' || !e.data) return false;
  const m = e.method;
  return (m === 'signEvent' || m === 'nip04.encrypt' || m === 'nip44.encrypt') &&
    !isNip42AuthEvent(e.data && e.data.params && (e.data.params.event || e.data.params));
}
function batchKeyOf(e) { return e.host + '|' + (e.data && e.data.activePubkey) + '|' + e.kind; }

// What the panel renders from (metadata only, plus the head's full data).
function pendingView() {
  const head = queue.find((e) => e.state === 'showing' && e.display === 'panel') || null;
  // Group the head with other live queued entries sharing host+account+kind.
  let groupIds = head ? [head.id] : [];
  if (head && isBatchableEntry(head)) {
    const key = batchKeyOf(head);
    for (const e of queue) {
      if (e === head) continue;
      if (e.state === 'queued' && isBatchableEntry(e) && batchKeyOf(e) === key) groupIds.push(e.id);
    }
  }
  const inGroup = new Set(groupIds);
  const waiting = queue.filter((e) => e.state !== 'interrupted' && e !== head && !inGroup.has(e.id))
    .map((e) => ({ id: e.id, host: e.host, method: e.method, kind: e.kind, accountName: e.data && e.data.accountName, ts: e.ts }));
  const interrupted = queue.filter((e) => e.state === 'interrupted')
    .map((e) => ({ id: e.id, host: e.host, method: e.method, kind: e.kind, ts: e.ts }));
  return {
    head: head ? { id: head.id, data: head.data, groupIds } : null,
    waiting, interrupted,
  };
}

// ---- keepalive (best-effort; correctness rests on the queue + reconcile) ----
let keepaliveOn = false;
// Payments in flight. An approved payment outlives the queue entry that authorized
// it: settleEntry() splices the entry and resolves the prompt, and only THEN does
// the NWC round trip begin. Without this counter, liveEntries() is already empty at
// that moment, so approving a payment cleared the keepalive alarm at exactly the
// instant the money was about to move — leaving the worker eligible for recycling
// during a wait that can run to the full 30s NWC timeout. See issue #138.
let payInFlight = 0;
// The queue alarm fires at most every 30s, which is a coin-flip against MV3's own
// ~30s idle timeout — fine for a prompt the user is looking at, not good enough to
// carry a payment. Touching a chrome API on a shorter cycle is the documented way to
// hold the worker up, so payments get a real heartbeat rather than a hopeful alarm.
let payHeartbeat = null;
function startPayHeartbeat() {
  if (payHeartbeat) return;
  payHeartbeat = setInterval(() => {
    try { chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError); } catch (_) {}
  }, 20000);
}
function stopPayHeartbeat() {
  if (!payHeartbeat) return;
  clearInterval(payHeartbeat);
  payHeartbeat = null;
}
function ensureKeepalive() {
  if (keepaliveOn) return;
  keepaliveOn = true;
  chrome.alarms.create(QUEUE_KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
}
function stopKeepaliveIfIdle() {
  if (liveEntries().length) return;
  if (payInFlight > 0) return; // never go idle with money in the air
  if (!keepaliveOn) return;
  keepaliveOn = false;
  chrome.alarms.clear(QUEUE_KEEPALIVE_ALARM);
}

// ---- panel port lifecycle ----
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  // Which window this panel lives in — a side panel is per-window, so a request
  // from a DIFFERENT window must not surface its approval here (see driveOnce).
  // The panel reports its window id right after connecting; seed it from the
  // port sender when Chrome provides one, else leave it unknown until the report.
  panelWindowId = (port.sender && port.sender.tab && port.sender.tab.windowId != null)
    ? port.sender.tab.windowId : null;
  clearTimeout(graceTimer);
  driveDisplay(); // re-surface anything waiting for a panel
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'panelWindow' && typeof msg.windowId === 'number') {
      panelWindowId = msg.windowId;
      driveDisplay(); // window now known — re-evaluate a possibly wrong-window surface
    }
  });
  port.onDisconnect.addListener(() => {
    if (panelPort !== port) return;
    panelPort = null;
    panelWindowId = null;
    // Revert (do NOT reject) anything showing in the panel — Chrome recycles this
    // port ~every 5 min; auto-rejecting here is the classic silent event loss.
    // The callback stays live; a reconnect re-surfaces it, a real close falls back
    // to a popup after a short grace.
    for (const e of queue) {
      if (e.display === 'panel' && e.state === 'showing') { e.state = 'queued'; e.display = 'none'; }
    }
    qPersist();
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => { if (!panelPort) driveDisplay(); }, 1500);
  });
});

// A page RPC can wake a fresh worker before the open panel has reconnected its
// port. Give it a brief window before falling back to a popup.
function waitForPanelPort(ms) {
  if (panelPort) return Promise.resolve(panelPort);
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      if (panelPort || Date.now() >= deadline) return resolve(panelPort);
      setTimeout(tick, 40);
    };
    tick();
  });
}

// ---- T1: accept a request. Synchronous registration; never blocks. ----
function openPrompt(data, originWindowId) {
  // Fast path: the keystore may have unlocked via an earlier approval. Collapse a
  // now-redundant pure-unlock request without queuing anything.
  if (data && data.needUnlock && !KS.isLocked()) {
    data.needUnlock = false;
    if (!data.needApproval) return Promise.resolve({ action: 'once' });
  }
  return new Promise((resolve) => {
    const id = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const now = Date.now();
    const ev = data.method === 'signEvent' ? (data.params && (data.params.event || data.params)) : null;
    queue.push({
      id, host: data.host, method: data.method, scope: data.scope || 'nostr',
      kind: ev ? ev.kind : null, data, ts: now, deadline: now + REQUEST_TTL,
      state: 'queued', display: 'none',
      // The window the requesting page lives in, so the approval surfaces on the
      // window the user is actually looking at (see driveOnce). undefined ⇒ unknown.
      originWindowId: originWindowId != null ? originWindowId : undefined,
    });
    callbacks.set(id, { resolve, settled: false });
    ensureKeepalive();
    qPersist();
    broadcastQueue();
    driveDisplay();
  });
}

// ---- popup window helpers ----
const POPUP_W = 440, POPUP_H = 660;
function closePopupWindow() {
  if (popupWindowId == null) return;
  const wid = popupWindowId;
  popupWindowId = null;
  chrome.windows.remove(wid).catch(() => {});
}
// Where to center the prompt popup: over the window the requesting page lives in
// (originWindowId), so it never opens on a window/monitor the user isn't looking
// at. Falls back to the last-focused window when the origin is unknown, and to
// Chrome's default placement when even that has no usable bounds.
function popupPlacement(originWindowId) {
  return new Promise((resolve) => {
    const place = (win) => {
      if (chrome.runtime.lastError || !win || win.left == null || win.width == null) return resolve({});
      resolve({
        left: Math.round(win.left + (win.width - POPUP_W) / 2),
        top: win.top != null && win.height != null ? Math.round(win.top + (win.height - POPUP_H) / 3) : undefined,
      });
    };
    if (originWindowId != null) {
      // Resolve against the origin window; if it's gone, fall back to current.
      chrome.windows.get(originWindowId, (win) => {
        if (chrome.runtime.lastError || !win) chrome.windows.getCurrent(place);
        else place(win);
      });
    } else {
      chrome.windows.getCurrent(place);
    }
  });
}
function createPopup(url, originWindowId) {
  return new Promise((resolve) => {
    popupPlacement(originWindowId).then(({ left, top }) => {
      chrome.windows.create({ url, type: 'popup', width: POPUP_W, height: POPUP_H, left, top, focused: true }, (win) => {
        popupWindowId = win ? win.id : null;
        resolve();
      });
    });
  });
}
function navigatePopup(url, originWindowId) {
  return new Promise((resolve) => {
    chrome.windows.get(popupWindowId, { populate: true }, (win) => {
      const tab = win && win.tabs && win.tabs[0];
      if (chrome.runtime.lastError || !tab) return resolve(false);
      chrome.tabs.update(tab.id, { url });
      // Reposition over the origin window too — the reused popup may have been
      // created over a different window than this request came from.
      popupPlacement(originWindowId).then(({ left, top }) => {
        const upd = { focused: true };
        if (left != null) upd.left = left;
        if (top != null) upd.top = top;
        chrome.windows.update(popupWindowId, upd);
        resolve(true);
      });
    });
  });
}
// Use the panel only when we're NOT confident it's in a different window than
// the request came from. Unknowns default to "yes" so the panel-first behavior
// is preserved for the common single-window case; we divert to a popup only on a
// definite window mismatch.
function panelServesWindow(originWindowId) {
  if (!panelPort) return false;
  if (originWindowId == null || panelWindowId == null) return true;
  return panelWindowId === originWindowId;
}

// ---- T6: expire a request past its deadline (or drop a stale tombstone) ----
function expireEntry(id, reason) {
  const i = queue.findIndex((e) => e.id === id);
  if (i >= 0) queue.splice(i, 1);
  const cb = callbacks.get(id);
  callbacks.delete(id);
  if (cb && !cb.settled) { cb.settled = true; cb.resolve({ action: 'reject', reason: reason || 'expired' }); }
}

// ---- head-pointer: idempotent, re-entrant, self-healing ----
let driving = false;
let driveAgain = false;
async function driveDisplay() {
  if (driving) { driveAgain = true; return; }
  driving = true;
  try {
    do { driveAgain = false; await driveOnce(); } while (driveAgain);
  } finally { driving = false; }
}
async function driveOnce() {
  const now = Date.now();
  // Sweep expired live requests and stale tombstones.
  for (const e of [...queue]) {
    if (e.state === 'interrupted') { if (now - e.ts > TOMBSTONE_TTL) expireEntry(e.id); }
    else if (now > e.deadline) expireEntry(e.id, 'timeout');
  }

  // If something's already showing on a valid surface, we're done — unless the
  // surface no longer fits: the panel closed (or turned out to be in a different
  // window than the request), or a popup can now hand off to a same-window panel.
  const showing = queue.find((e) => e.state === 'showing');
  if (showing) {
    if (showing.display === 'panel' && !panelServesWindow(showing.originWindowId)) {
      // Panel gone, or we've since learned it's in the wrong window — pull it
      // back and let the popup path (below) take over on the right window.
      showing.state = 'queued'; showing.display = 'none';
    } else if (showing.display === 'popup' && panelServesWindow(showing.originWindowId)) {
      showing.state = 'queued'; showing.display = 'none'; // revert BEFORE closing so onRemoved won't reject it
      closePopupWindow();
    } else { return; }
  }

  // Pick the oldest live queued entry with a still-live callback.
  const head = queue.find((e) => e.state === 'queued' && callbacks.has(e.id) && !callbacks.get(e.id).settled);
  if (!head) {
    if (popupWindowId != null) closePopupWindow();
    qPersist(); broadcastQueue(); stopKeepaliveIfIdle();
    return;
  }

  // Re-collapse a now-redundant unlock (keystore may have unlocked while queued).
  if (head.data.needUnlock && !KS.isLocked()) {
    head.data.needUnlock = false;
    if (!head.data.needApproval) { settlePrompt(head.id, 'once'); driveAgain = true; return; }
  }

  // Re-collapse a now-redundant approval: a relax window may have opened for
  // this host+account (via another queued request settling 'relax') while this
  // one was still waiting its turn — see the relaxEligible comment in
  // handleNostrRpc for why the check has to be repeated here rather than once
  // up front. Never short-circuits a still-needed unlock.
  if (head.data.needApproval && !head.data.needUnlock && head.data.relaxEligible &&
      (await RELAX.has(head.host, head.data.activePubkey))) {
    settlePrompt(head.id, 'once');
    driveAgain = true;
    return;
  }

  // Choose a surface. Prefer the panel — but only when it isn't in a different
  // window than the page that made the request; briefly wait for a reconnecting
  // panel before falling back to a popup positioned over the origin window.
  const origin = head.originWindowId;
  if (!panelPort) await waitForPanelPort(600);
  if (panelServesWindow(origin)) {
    head.state = 'showing'; head.display = 'panel';
    qPersist(); broadcastQueue();
  } else {
    head.state = 'showing'; head.display = 'popup';
    qPersist();
    const url = chrome.runtime.getURL('prompt.html?id=' + head.id);
    if (popupWindowId != null) { if (!(await navigatePopup(url, origin))) { popupWindowId = null; await createPopup(url, origin); } }
    else await createPopup(url, origin);
    broadcastQueue();
  }
}

// ---- T5: user closed the popup without deciding = reject that one entry ----
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId !== popupWindowId) return;
  popupWindowId = null;
  const e = queue.find((x) => x.display === 'popup' && x.state === 'showing');
  if (e) settlePrompt(e.id, 'reject');
  else driveDisplay();
});

// ---- T3: resolve a request by explicit decision ----
function settlePrompt(id, action, extra) {
  const cb = callbacks.get(id);
  if (!cb || cb.settled) return; // the `settled` guard makes any double-result a no-op → can't double-sign
  const entry = queue.find((e) => e.id === id); // capture before splicing, for decrypt coalescing
  cb.settled = true;
  callbacks.delete(id);
  const i = queue.findIndex((e) => e.id === id);
  if (i >= 0) queue.splice(i, 1);
  qPersist();
  cb.resolve(Object.assign({ action }, extra || {}));

  // Decrypt-burst coalescing: one decision on the first decrypt covers the whole
  // same-host, same-account burst (see grantDecrypt). Skip when this settle is
  // itself a coalesced sibling, so the window isn't extended by its own flush.
  if (entry && entry.data && DECRYPT_METHODS.has(entry.method) && !(extra && extra.coalesced)) {
    const { host, activePubkey } = entry.data;
    if (host && activePubkey) {
      if (action === 'reject') {
        flushDecryptSiblings(host, activePubkey, 'reject');
      } else if (action === 'once' || action === 'trust') {
        grantDecrypt(host, activePubkey);
        flushDecryptSiblings(host, activePubkey, 'once');
      }
    }
  }

  broadcastQueue();
  stopKeepaliveIfIdle();
  driveDisplay();
}

// ---- T7: on SW startup, rebuild the queue as interrupted tombstones ----
// Their callbacks (and the page channels) are gone, so they can never sign — the
// pages already failed via content.js's lastError/180s. Surface them honestly.
async function reconcileQueue() {
  const saved = await qGet();
  if (!Array.isArray(saved) || !saved.length) return;
  const now = Date.now();
  let added = false;
  for (const m of saved) {
    if (callbacks.has(m.id) || queue.some((e) => e.id === m.id)) continue;
    if (now - m.ts > TOMBSTONE_TTL) continue;
    queue.push({ id: m.id, host: m.host, method: m.method, kind: m.kind, scope: m.scope,
      accountName: m.accountName, data: null, ts: m.ts, deadline: m.deadline,
      state: 'interrupted', display: 'none' });
    added = true;
  }
  if (added) { qPersist(); broadcastQueue(); }
}
reconcileQueue();

// ---- app-data burst coalescing ----
// Clients like Primal fire a SERIES of app-data (NIP-78, kind:30078) signs on
// load/account-switch — sync settings, home feeds, membership — each awaited, so
// they never share the queue and can't be batched. On a shared host every one
// forces its own confirm, which is both maddening and self-defeating (it trains
// users to reflex-approve). After the user explicitly confirms one such sign, we
// auto-approve further signs of the SAME low-stakes kind, SAME account, SAME host
// for a short window. Scoped tightly: only these app-config kinds (a site
// spamming its own kind:30078 is harmless — it's app-namespaced data, not a note
// or DM), only the account the user just confirmed, and only briefly. A different
// kind, account, or host still confirms; the window is short enough that a
// realistic client account-switch can't slip inside it.
const COALESCE_KINDS = new Set([30078]);
const COALESCE_WINDOW_MS = 60000;
const contentGrants = new Map(); // `host|pubkey|kind` -> expiry ms

// ---- "you keep approving this" nudge ----
// How many times the user has picked Allow once for a (host, account). Nothing in
// the prompt says WHICH button ends the asking, so someone on a single account can
// approve the same site forever without ever noticing Trust is the answer. After a
// few, the prompt adds one line pointing at it.
//
// chrome.storage.session, NOT a Map — same reasoning as relax-grants.js spells out.
// The MV3 service worker is evicted after ~30s idle, and the gap between two
// approvals is however long the user takes, so an in-memory tally resets between
// almost every pair and never reaches the threshold. (That was the first cut of this,
// and it simply never fired.) The 60s coalesce grants above can stay in memory
// precisely because their window is shorter than the eviction timer.
//
// Session storage also has exactly the retention this wants: survives eviction,
// clears on browser restart. It catches a habit within one browsing session rather
// than accumulating a record of which sites someone uses.
const APPROVE_NUDGE_AFTER = 3;
const APPROVE_COUNT_KEY = 'sidecar_approve_counts';
function sgetSession(keys) {
  return new Promise((resolve) => chrome.storage.session.get(keys, resolve));
}
function ssetSession(obj) {
  return new Promise((resolve) => chrome.storage.session.set(obj, resolve));
}
function approveCountKey(host, pubkey) { return host + '|' + pubkey; }
async function approveCountMap() {
  return (await sgetSession(APPROVE_COUNT_KEY))[APPROVE_COUNT_KEY] || {};
}
async function bumpApproveCount(host, pubkey) {
  const m = await approveCountMap();
  const k = approveCountKey(host, pubkey);
  m[k] = (m[k] || 0) + 1;
  await ssetSession({ [APPROVE_COUNT_KEY]: m });
}
async function shouldNudgeTrust(host, pubkey) {
  const m = await approveCountMap();
  return (m[approveCountKey(host, pubkey)] || 0) >= APPROVE_NUDGE_AFTER;
}
// Trusting (or blocking) settles the question, so the tally stops being useful.
async function clearApproveCount(host, pubkey) {
  const m = await approveCountMap();
  delete m[approveCountKey(host, pubkey)];
  await ssetSession({ [APPROVE_COUNT_KEY]: m });
}
function grantKey(host, pubkey, kind) { return host + '|' + pubkey + '|' + kind; }
function hasContentGrant(host, pubkey, kind) {
  const exp = contentGrants.get(grantKey(host, pubkey, kind));
  if (!exp) return false;
  if (Date.now() >= exp) { contentGrants.delete(grantKey(host, pubkey, kind)); return false; }
  return true;
}
function grantContent(host, pubkey, kind) {
  contentGrants.set(grantKey(host, pubkey, kind), Date.now() + COALESCE_WINDOW_MS);
}

// ---- decrypt-burst coalescing ----
// A client loading a DM inbox can fire dozens of nip04/nip44.decrypt calls at
// once — one per event it's trying to read (and a sloppy one, like gamestr.io,
// sprays them at every event, most of which aren't even addressed to you). At
// the default "ask" tier that's one prompt per message: a signer flood. So the
// user's decision on the FIRST decrypt covers the whole same-host, same-account
// burst: allow flushes the already-queued siblings through and opens a short
// window so late arrivals skip the prompt too; reject drops the burst. Scoped
// tightly — only decrypt methods, only that host+account, only briefly, and the
// window is set solely by the explicit approval (never extended by the
// auto-approved siblings), so the decryption-oracle exposure stays bounded. This
// still requires a real first approval, so it never silently decrypts for a site
// you haven't OK'd — much narrower than "Trust this site".
const DECRYPT_METHODS = new Set(['nip04.decrypt', 'nip44.decrypt']);
const DECRYPT_WINDOW_MS = 60000;
const decryptGrants = new Map(); // `host|pubkey` -> expiry ms
function decryptGrantKey(host, pubkey) { return host + '|' + pubkey; }
function hasDecryptGrant(host, pubkey) {
  const exp = decryptGrants.get(decryptGrantKey(host, pubkey));
  if (!exp) return false;
  if (Date.now() >= exp) { decryptGrants.delete(decryptGrantKey(host, pubkey)); return false; }
  return true;
}
function grantDecrypt(host, pubkey) {
  decryptGrants.set(decryptGrantKey(host, pubkey), Date.now() + DECRYPT_WINDOW_MS);
}
// Propagate one decrypt decision to the rest of the same-host, same-account burst
// already sitting in the queue. `coalesced: true` on the resolution marks these
// as auto-approved so they don't re-trigger the grant/flush (bounded window).
function flushDecryptSiblings(host, pubkey, action) {
  for (const e of [...queue]) {
    if (e.state === 'interrupted' || !e.data) continue;
    if (!DECRYPT_METHODS.has(e.method)) continue;
    if (e.data.host !== host || e.data.activePubkey !== pubkey) continue;
    const cb = callbacks.get(e.id);
    if (cb && !cb.settled) settlePrompt(e.id, action, { coalesced: true });
  }
}

// Timed "relax approvals" grant lives in relax-grants.js (loaded via
// importScripts above, exposed as RELAX / self.SidecarRelax) so it can be unit-
// tested in isolation — see test/relax-grant.test.js. It's the user-opted escape
// hatch from the shared-host per-sign confirm; see that module for the full
// safety rationale (per-(host,pubkey) scoping, control-kind exclusion, and the
// re-login/lock revocation hooks wired into handleNostrRpc and lockKeystore).

// ============================================================================
// Page RPC handling (window.nostr.*)
// ============================================================================

// A genuine NIP-42 AUTH event (kind 22242): its only tags are `relay` and
// `challenge`, its content is empty (per spec), and its timestamp is close to
// now. We auto-approve only these — a kind-22242 event carrying arbitrary tags,
// content, or a skewed created_at is treated as a normal signing request that
// needs the user's approval, so the exemption can't be used as a silent oracle.
const NIP42_MAX_CLOCK_SKEW = 600; // seconds
function isNip42AuthEvent(ev) {
  if (!ev || ev.kind !== 22242 || !Array.isArray(ev.tags)) return false;
  let hasRelay = false;
  let hasChallenge = false;
  for (const t of ev.tags) {
    if (!Array.isArray(t) || typeof t[0] !== 'string') return false;
    if (t[0] === 'relay') {
      if (typeof t[1] !== 'string' || !t[1]) return false;
      hasRelay = true;
    } else if (t[0] === 'challenge') {
      if (typeof t[1] !== 'string' || !t[1]) return false;
      hasChallenge = true;
    } else {
      return false; // any other tag ⇒ not a plain auth event
    }
  }
  if (!hasRelay || !hasChallenge) return false;
  if (ev.content != null && ev.content !== '') return false;
  if (ev.created_at != null) {
    const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(ev.created_at));
    if (!Number.isFinite(skew) || skew > NIP42_MAX_CLOCK_SKEW) return false;
  }
  return true;
}

async function handleNostrRpc(method, params, host, sendResponse, originWindowId) {
  try {
    if (!host) throw new Error('Missing host');
    await KS.ensureLoaded(); // rehydrate unlocked session if the SW was restarted
    if (!(await KS.isInitialized())) throw new Error('Sidecar has no accounts set up yet');

    let signKind = null;
    let signEvent = null;
    if (method === 'signEvent') {
      signEvent = params && (params.event || params);
      signKind = signEvent && signEvent.kind;
    }

    // The identity this request signs as. getPublicKey is a login: it
    // establishes identity, so it follows the globally-active account (and, on
    // success, re-pairs the host to it below). Everything session-shaped —
    // signEvent, nip04/nip44, relay auth — stays pinned to the account the host
    // logged in with, so open sessions never desync on a panel account switch.
    //
    // One exception: applesauce-based clients (noStrudel and friends) stamp the
    // intended author's pubkey on the event template. That's the client
    // explicitly naming which identity it wants, so when it names another
    // account we hold, honor it — the requested account's own per-site
    // permissions still gate the signature below, so a site can never quietly
    // reach an identity that hasn't approved it.
    let activePubkey;
    let authorSwitched = false;
    if (method === 'getPublicKey') {
      activePubkey = await KS.getActivePubkey();
    } else {
      activePubkey = await resolveSiteAccount(host);
      const requestedAuthor = signEvent && typeof signEvent.pubkey === 'string' ? signEvent.pubkey : null;
      if (requestedAuthor && requestedAuthor !== activePubkey && (await KS.hasAccount(requestedAuthor))) {
        activePubkey = requestedAuthor;
        authorSwitched = true;
      }
    }
    if (!activePubkey) throw new Error('No active Sidecar account');

    // `let`, not `const`: the shared-identity block below can swap activePubkey to
    // the active account, and the permission status must follow the account that
    // will actually sign (see the recompute there).
    let status = await PERMS.getPermissionStatus(activePubkey, host, method); // allow | reject | ask
    if (status === 'reject') throw new Error('This site is blocked in Sidecar');

    // NIP-42 relay auth (kind 22242) is an automatic, ephemeral connection-auth
    // event that relays request frequently; an interactive prompt for it
    // guarantees client-side timeouts ("Signer did not respond in time"). Treat
    // it as pre-approved for any non-blocked site — only an unlock can gate it.
    // But the exemption is a silent signing oracle if abused, so we only skip the
    // prompt when the event is a *well-formed* auth event (see isNip42AuthEvent):
    // relay + challenge tags only, near-current timestamp, no arbitrary payload.
    // Anything else falls back to the normal approval prompt. An auth event that
    // names a DIFFERENT account than the site's binding never gets the exemption:
    // silently relay-authing as an identity that hasn't approved this site would
    // let a page link the user's accounts without any consent moment.
    const isRelayAuth = method === 'signEvent' && !authorSwitched && isNip42AuthEvent(signEvent);

    // Multi-login safeguard. A "content sign" — a note, reaction, DM, or profile
    // edit, but NOT relay auth — carries your identity publicly. On a host where
    // 2+ of your accounts have signed in (a multi-login client), the single
    // binding can't be trusted to match the slot the client is showing, and the
    // client never names the account at signing time.
    //
    // Critically, this ALWAYS confirms on a shared host — not just when the
    // binding and active account disagree. A binding/active AGREEMENT is not
    // evidence of correctness: the client's own switcher can flip which slot is
    // selected with zero signal to Sidecar, so "our two guesses match" can still
    // both be wrong relative to what the page is showing (e.g. Jumble displaying
    // account A while Sidecar's binding and active account both happen to be B —
    // there is no disagreement for us to detect, yet the post would go out under
    // the wrong identity). Only an explicit confirm from the user closes that
    // gap, since only the user can see the client's UI.
    const isContentSign =
      (method === 'signEvent' && !isRelayAuth) ||
      method === 'nip04.encrypt' || method === 'nip44.encrypt';

    // App-data sync (NIP-78, kind:30078 &c. — the COALESCE_KINDS set) is
    // replaceable, app-namespaced state, NOT an attributable social post: no
    // client renders it in a feed as "you said X", and a wrong-account write is
    // low-value and self-healing (the next sync overwrites it). The shared-
    // identity confirm below exists to stop a note/reaction/DM going out under
    // the wrong identity — a risk app-data doesn't carry — so we exempt it: it
    // never triggers that confirm, and on a shared host (where "Trust this site"
    // is hidden, so it can't be elevated out of the ask tier any other way) it
    // auto-allows outright. A block still applies, the account still resolves to
    // the site's binding, and every sign is still logged to Activity. Users who
    // want to see each one can turn the exemption off with the "Confirm
    // background app-data syncs" setting. This is kind-based, not client-based,
    // so it needs no upkeep as clients change or new ones appear.
    const isAppDataSync =
      method === 'signEvent' && !isRelayAuth && signKind != null && COALESCE_KINDS.has(signKind);
    const appDataExempt =
      isAppDataSync &&
      ((await sget('sidecar_settings')).sidecar_settings || {}).confirmDataSync !== true;

    let sharedIdentity = false;
    let authorizedPool = null;
    // Whether 2+ of your accounts have logged into this host (a multi-login
    // client). Drives both the shared-identity confirm and the app-data
    // auto-allow, so we resolve it once for either content sign or exempt sync.
    let sharedHost = false;
    if ((isContentSign || appDataExempt) && !authorSwitched) {
      const authorized = await getAuthorizedAccounts(host);
      sharedHost = authorized.length >= 2;
      if (sharedHost && isContentSign && !appDataExempt) {
        sharedIdentity = true;
        authorizedPool = authorized;
        // Default to the active account when it's authorized here — that's the
        // one the user just deliberately chose in Sidecar, and the one our own
        // guidance tells them to keep in sync with the client's selected slot.
        const globalActive = await KS.getActivePubkey();
        if (authorized.includes(globalActive) && globalActive !== activePubkey) {
          activePubkey = globalActive;
          // `status` above was computed for the binding account; re-evaluate it
          // for the account we just swapped to and honor a block on THIS account.
          // Without this, a site blocked for the active account could still be
          // signed via the default swap (the explicit-switch path already
          // re-checks; this closes the default-path gap).
          status = await PERMS.getPermissionStatus(activePubkey, host, method);
          if (status === 'reject') throw new Error('This site is blocked in Sidecar');
        }
      }
    }

    // App-data burst coalescing: if the user just confirmed this exact
    // (host, account, kind) app-data sign, auto-approve the rest of the serial
    // burst without re-nagging. Only bypasses the confirm/ask — never a block
    // (that already threw above) or an unlock. (When the sync exemption above is
    // active this rarely fires — an exempt sync isn't confirmed to begin with —
    // but it still covers the non-shared "ask" host, where a deliberate ask tier
    // is honored and the exemption's auto-allow doesn't apply.)
    const coalesced = isContentSign && signKind != null && COALESCE_KINDS.has(signKind) &&
      hasContentGrant(host, activePubkey, signKind);
    if (coalesced) sharedIdentity = false;

    const needsKey = SIGNER.needsPrivateKey(method);
    const needUnlock = needsKey && KS.isLocked();
    // An exempt app-data sync auto-allows on a shared host — the only place it
    // otherwise couldn't escape the ask tier. On a non-shared host it stays on
    // the normal ask tier + coalescing, so a deliberate "ask" is still honored.
    const appDataAutoAllow = appDataExempt && sharedHost;
    // Decrypt-burst coalescing: within the short window opened by an explicit
    // decrypt approval (see grantDecrypt), further decrypts from the same host +
    // account skip the prompt. Never bypasses a block (that already threw above)
    // or an unlock.
    const decryptCoalesced = DECRYPT_METHODS.has(method) && hasDecryptGrant(host, activePubkey);
    // Timed "relax approvals" window: a user-opted auto-approve for this
    // (host, account). Like the coalesce grants it only bypasses the prompt —
    // never a block (already threw above) or an unlock (still required below).
    // Account/wallet-control kinds (hand-over-the-keys actions) never relax, so
    // the worst abuse still gets a per-sign confirm even mid-window.
    // Split from relaxActive (below) so the "kind of request relax ever covers"
    // half can ride along on the queued entry — see driveOnce()'s re-collapse,
    // which re-checks RELAX.has() right before a prompt surfaces. A burst of
    // near-simultaneous requests can all compute relaxActive=false before any of
    // them has actually granted the window, so a later request in the same burst
    // would otherwise still show a full prompt for a window that's active by the
    // time its turn comes up.
    const relaxEligible = isContentSign && !RELAX.neverRelaxes(signKind);
    const relaxActive = relaxEligible && (await RELAX.has(host, activePubkey));
    if (relaxActive) sharedIdentity = false;

    // Destructive-overwrite check. Kinds 0/3/10000 REPLACE their previous version, so
    // a client publishing a short or empty list wipes the real one everywhere. Compare
    // against what Sidecar last signed and, if this looks like a wipe, always confirm —
    // even on a trusted site and even mid relax window, on the same reasoning that
    // exempts the account/wallet-control kinds: losing your whole follow list is not
    // something to auto-approve. Purely local state, so it costs no network time.
    // Fails open (null) — it can raise a confirm, never suppress one.
    const destructive = method === 'signEvent' && !isRelayAuth
      ? await BASELINE.check(activePubkey, signEvent)
      : null;

    // A shared-identity content sign always confirms, regardless of trust tier —
    // unless it's a coalesced app-data sign, under an active relax window, etc.
    // A destructive overwrite overrides every skip.
    // A zap request within the auto-zap caps signs without asking, so "auto-approve
    // zaps" covers the whole zap rather than just its second half. See autoZapMaySign.
    const zapAutoSign = method === 'signEvent' && signKind === 9734
      ? await autoZapMaySign(signEvent)
      : false;

    const needApproval = destructive
      ? true
      : (coalesced || appDataAutoAllow || decryptCoalesced || relaxActive || zapAutoSign
          ? false
          : ((status === 'ask' && !isRelayAuth) || sharedIdentity));

    // Every getPublicKey is a login, and a login is the safe moment to pick an
    // identity: whatever pubkey we return is the identity the site adopts from
    // here on, so offering the account switcher in the prompt can't desync
    // anything. A shared-identity content sign also offers the switcher — scoped
    // to the accounts that have actually logged into this host. Other session
    // methods never offer it: their identity is fixed by the binding.
    const canOfferAccountSwitch = method === 'getPublicKey' || sharedIdentity;

    // Set below when this very request opens a relax window, so the rebind
    // block further down (which drops a now-stale relax window on an account
    // change) can tell "stale window for the account we're leaving" apart from
    // "the window we just opened for the account we're arriving at" — see there.
    let relaxJustGrantedFor = null;

    // Once unlocked, signing only needs site approval — no PIN re-entry.
    if (needApproval || needUnlock) {
      // Read once — the payload below needs both the theme and the auto-lock choice.
      const promptSettings = (await sget('sidecar_settings')).sidecar_settings || {};
      const st = await KS.getState();
      const acct = st.accounts.find((a) => a.pubkey === activePubkey);
      const otherAccounts = canOfferAccountSwitch
        ? st.accounts
            .filter((a) => a.pubkey !== activePubkey)
            // Shared-identity: you can only post as an account that's logged into
            // this host — never silently introduce a new identity to the site.
            .filter((a) => !sharedIdentity || authorizedPool.includes(a.pubkey))
            .map((a) => ({
              pubkey: a.pubkey,
              npub: self.NostrTools.nip19.npubEncode(a.pubkey),
              name: a.name || '',
              picture: a.picture || '',
            }))
        : null;
      // For encrypt/decrypt, translate the counterparty's hex pubkey to an npub so
      // the prompt can show a recognizable identity instead of raw hex. Pure offline
      // encoding — no relay lookup. Falls back to the raw hex if it isn't valid.
      let peerNpub = null;
      if (params && params.pubkey && /\.(encrypt|decrypt)$/.test(method)) {
        try { peerNpub = self.NostrTools.nip19.npubEncode(params.pubkey); } catch (_) {}
      }
      const decision = await openPrompt({
        host,
        method,
        params,
        peerNpub,
        activePubkey,
        npub: self.NostrTools.nip19.npubEncode(activePubkey),
        accountName: (acct && acct.name) || '',
        accountPicture: (acct && acct.picture) || '',
        needUnlock,
        needApproval,
        sharedIdentity,
        relaxEligible,
        // True once this (host, account) has been approved one-time a few times over —
        // the prompt turns it into a line pointing at Trust. Suppressed while a
        // destructive warning is showing: that screen is asking for full attention on
        // what's about to be lost, and "trust this site to stop asking" is the last
        // advice it should be carrying.
        nudgeTrust: !destructive && (await shouldNudgeTrust(host, activePubkey)),
        // The popup window loads every theme stylesheet but has no settings access of
        // its own, so without this it renders whatever the default is — Speakeasy
        // purple over someone's Brownstone panel. Carried on the payload rather than
        // fetched in prompt.js so the window paints themed on first frame instead of
        // flashing the default.
        theme: promptSettings.theme || 'speakeasy',
        // Auto-lock is off, so this unlock is the once-per-browser-session one rather
        // than an idle timeout. The UI says so — otherwise "Never" looks broken to
        // someone who set it and is then asked for a PIN the next morning.
        autoLockNever: resolveSettings(promptSettings).autoLockMinutes === 0,
        destructive, // null, or { kind, type, from, to, lost, fields, message }
        level: await PERMS.getLevel(activePubkey, host),
        otherAccounts: otherAccounts && otherAccounts.length ? otherAccounts : null,
      }, originWindowId);
      if (decision.action === 'reject') throw new Error('You rejected this request');

      // Resolve a chosen switch-to account BEFORE block/trust, so those apply to
      // the account actually signing, not the one the prompt originally opened with.
      if (
        canOfferAccountSwitch &&
        decision.switchToPubkey &&
        decision.switchToPubkey !== activePubkey &&
        otherAccounts &&
        otherAccounts.some((a) => a.pubkey === decision.switchToPubkey)
      ) {
        const switchedStatus = await PERMS.getPermissionStatus(decision.switchToPubkey, host, method);
        if (switchedStatus === 'reject') throw new Error('This site is blocked in Sidecar for that account');
        activePubkey = decision.switchToPubkey;
        await KS.setActive(activePubkey);
      }

      if (decision.action === 'block') {
        await clearApproveCount(host, activePubkey);
        await PERMS.setLevel(activePubkey, host, 'blocked');
        throw new Error('This site is now blocked');
      }
      if (decision.action === 'trust') {
        await clearApproveCount(host, activePubkey);
        await PERMS.setLevel(activePubkey, host, 'trusted');
      }
      // Tally the one-time approvals so the prompt can eventually point at Trust.
      // Only 'once' — picking 'relax' or 'trust' IS acting on that advice.
      if (decision.action === 'once') await bumpApproveCount(host, activePubkey);
      // 'relax' → open a timed auto-approve window for this (host, account), then
      // proceed like 'once'. The risk acceptance happened in the prompt UI.
      if (decision.action === 'relax') {
        await RELAX.grant(host, activePubkey, decision.relaxMs || RELAX.DEFAULT_MS);
        relaxJustGrantedFor = activePubkey;
        syncRelaxBadge();
      }
      // 'once' | 'trust' | 'relax' → proceed (after a successful unlock, if one was needed)
    }

    bumpAutoLock();

    let result;
    if (method === 'getRelays') {
      result = await getConfiguredRelays();
    } else {
      const privBytes = needsKey ? await KS.getPrivkey(activePubkey) : null;
      result = await SIGNER.perform(method, params, privBytes, activePubkey);
    }

    // The user approved this replaceable overwrite, so it becomes the new baseline —
    // otherwise a deliberate list cut would keep re-warning against the old size on
    // every subsequent edit. Recorded from the SIGNED event so created_at is the one
    // that actually went out. Best-effort: a bookkeeping failure must not fail a sign
    // that already succeeded.
    if (method === 'signEvent' && !isRelayAuth && result && BASELINE.isTracked(result.kind)) {
      try { await BASELINE.record(activePubkey, result, result.created_at || 0); } catch (_) {}
    }

    // A zap request the user just authorized. Remember it so the payment that follows
    // can be recognized as that zap (see zap-requests.js). Best-effort, same as above.
    if (method === 'signEvent' && !isRelayAuth && result && result.kind === 9734) {
      try { await ZAPREQ.record(host, activePubkey, result); } catch (_) {}
    }

    // Pin this host to the account it just successfully used. Only an explicit
    // identity choice may MOVE an existing binding: a login (getPublicKey) or a
    // template that named its author (authorSwitched). A session-shaped request
    // that resolved against the old binding but completed after a re-login
    // (a pending approval, an in-flight batch of DM decrypts) must not write
    // the old account back over the new one. Following an honored author keeps
    // the site's implicit requests (nip04/nip44) on the identity the client
    // last exercised.
    // sharedIdentity is also an explicit choice (the user just confirmed who's
    // posting in the prompt), so it may move the binding too.
    if (method === 'getPublicKey' || authorSwitched || sharedIdentity || !(await getSiteAccount(host))) {
      // A re-login to a DIFFERENT account is the one detectable moment the identity
      // context for this host can change, so a prior relax window for it is no
      // longer trustworthy — drop it. A same-account re-fetch leaves the binding
      // unchanged and is left alone. Exception: if THIS request is the one that
      // just opened the relax window for the account we're rebinding TO (the
      // shared-host relax chip, granted a few lines up), it's not stale — it's
      // the window the user just asked for. Without this guard, choosing "relax"
      // on a shared host where the site's prior pin differs from the signing
      // account would grant the window and then immediately revoke that same
      // grant in this same request, so the status bar never appears.
      const prevBound = await getSiteAccount(host);
      await setSiteAccount(host, activePubkey);
      if (prevBound && prevBound !== activePubkey && relaxJustGrantedFor !== activePubkey) {
        await RELAX.revokeForHost(host); syncRelaxBadge();
      }
    }
    // Record every account that acts on a host, so a second one makes it "shared".
    await addAuthorizedAccount(host, activePubkey);

    // The user just explicitly confirmed a low-stakes app-data sign — coalesce the
    // rest of the serial burst (same host/account/kind) for a short window so a
    // client's on-load sync doesn't fire a modal per subkey. Only on an explicit
    // confirm (needApproval), never extended by the coalesced signs themselves,
    // so exposure stays bounded.
    if (isContentSign && signKind != null && COALESCE_KINDS.has(signKind) && needApproval && !coalesced) {
      grantContent(host, activePubkey, signKind);
    }

    logActivity({ ts: Date.now(), host, method, kind: signKind, pubkey: activePubkey });

    sendResponse({ ok: true, result });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

// ============================================================================
// Page WebLN handling (window.webln.*) — backed by the account's NWC wallet
// ============================================================================
// The NWC client runs here in the SW (it only needs NostrTools + WebSocket), so
// WebLN works whether or not the side panel is open.
let swNwc = null; // { client, pubkey }
async function getSwNwc(pubkey) {
  if (swNwc && swNwc.pubkey === pubkey) return swNwc.client;
  if (swNwc) { try { swNwc.client.close(); } catch (_) {} swNwc = null; }
  const connection = await KS.getNwc(pubkey); // requires unlocked
  if (!connection) return null;
  swNwc = { client: NWC.makeClient(connection), pubkey };
  return swNwc.client;
}
function closeSwNwc() {
  if (swNwc) { try { swNwc.client.close(); } catch (_) {} swNwc = null; }
}

const msatToSat = (m) => Math.floor((m || 0) / 1000);

// Parse the sat amount out of a BOLT11 invoice's human-readable part, without a
// full decoder. Returns null for amountless invoices (caller must then prompt).
function invoiceSats(bolt11) {
  if (!bolt11) return null;
  const m = /^ln(?:bc|tb|bcrt)(\d+)([munp]?)/i.exec(String(bolt11).replace(/^lightning:/i, '').trim());
  if (!m) return null;
  const digits = m[1];
  const mult = m[2].toLowerCase();
  if (!digits) return null; // amountless invoice
  // BOLT11 amount is in BTC * multiplier; convert to sats (1 BTC = 1e8 sats).
  const FACTOR = { m: 1e5, u: 1e2, n: 1e-1, p: 1e-4, '': 1e8 };
  return Math.round(Number(digits) * FACTOR[mult]);
}

// Open an unlock-only popup for low-risk wallet reads when the keystore is locked.
async function weblnUnlockGate(host, method, pubkey, originWindowId) {
  if (!KS.isLocked()) return;
  const st = await KS.getState();
  const acct = st.accounts.find((a) => a.pubkey === pubkey);
  const decision = await openPrompt({
    scope: 'webln',
    host,
    method: 'webln.' + method,
    npub: self.NostrTools.nip19.npubEncode(pubkey),
    accountName: (acct && acct.name) || '',
        accountPicture: (acct && acct.picture) || '',
    needUnlock: true,
    needApproval: false,
  }, originWindowId);
  if (decision.action === 'reject') throw new Error('You rejected this request');
  if (KS.isLocked()) throw new Error('Keystore is locked');
}

async function handleWeblnRpc(method, params, host, sendResponse, originWindowId) {
  try {
    if (!host) throw new Error('Missing host');
    await KS.ensureLoaded();
    if (!(await KS.isInitialized())) throw new Error('Sidecar has no accounts set up yet');
    const pubkey = await resolveSiteAccount(host);
    if (!pubkey) throw new Error('No active Sidecar account');

    // A site blocked for signing is blocked for payments too.
    if ((await PERMS.getLevel(pubkey, host)) === 'blocked') throw new Error('This site is blocked in Sidecar');

    const hasWallet = await KS.hasNwc(pubkey);

    // isEnabled reports availability without throwing. enable() rejects when no
    // wallet is connected, so apps get the standard WebLN "unavailable" signal
    // and can fall back. Neither needs an unlock.
    if (method === 'isEnabled') {
      sendResponse({ ok: true, result: { enabled: hasWallet } });
      return;
    }
    if (!hasWallet) throw new Error('No wallet connected in Sidecar');
    if (method === 'enable') {
      sendResponse({ ok: true, result: { enabled: true } });
      return;
    }

    let result;
    if (method === 'getInfo') {
      await weblnUnlockGate(host, method, pubkey, originWindowId);
      const c = await getSwNwc(pubkey);
      const info = (await c.getInfo()) || {};
      result = {
        node: { alias: info.alias || 'Sidecar wallet', pubkey: info.pubkey || '', color: info.color || '' },
        methods: ['getInfo', 'makeInvoice', 'sendPayment', 'getBalance'],
        supports: ['lightning'],
      };
    } else if (method === 'getBalance') {
      await weblnUnlockGate(host, method, pubkey, originWindowId);
      const c = await getSwNwc(pubkey);
      const b = await c.getBalance();
      result = { balance: msatToSat(b && b.balance), currency: 'sats' };
    } else if (method === 'makeInvoice') {
      await weblnUnlockGate(host, method, pubkey, originWindowId);
      const c = await getSwNwc(pubkey);
      const sats = parseInt(params && params.amount, 10);
      if (!sats || sats < 1) throw new Error('A positive amount is required to make an invoice');
      const res = await c.makeInvoice(sats * 1000, (params && params.memo) || '');
      const invoice = res && (res.invoice || res.payment_request || res.bolt11);
      if (!invoice) throw new Error('Wallet returned no invoice');
      result = { paymentRequest: invoice };
    } else if (method === 'sendPayment') {
      result = await weblnSendPayment(params, host, pubkey, originWindowId);
    } else {
      throw new Error('Sidecar does not support webln.' + method);
    }

    // Answer the page FIRST, then do bookkeeping. setSiteAccount is a storage read
    // plus a write, and it used to sit between a completed payment and the reply —
    // so if MV3 recycled the worker in that gap the sats had already moved, the
    // Activity log already had it, and the page's webln.sendPayment promise was left
    // hanging forever. That's issue #138: a stuck Bitcoin Connect modal on a payment
    // that demonstrably succeeded (valid preimage, balance decremented).
    sendResponse({ ok: true, result });
    // Fire-and-forget: the binding is useful but must never be able to cost the page
    // its answer. A failure here is invisible and self-heals on the next request.
    setSiteAccount(host, pubkey).catch(() => {});
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

async function weblnSendPayment(params, host, pubkey, originWindowId) {
  const invoice = (params && (params.paymentRequest || params.invoice)) || '';
  return payInvoiceCore(invoice, host, pubkey, params && params.memo, originWindowId);
}

// Minimal BOLT11 tagged-field reader — bech32, no deps.
const BECH32_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
// Read one BOLT11 tagged field as raw bytes; null when absent or malformed.
function bolt11Field(invoice, wantTag) {
  try {
    const s = String(invoice).toLowerCase();
    const sep = s.lastIndexOf('1');
    if (sep < 1) return null;
    const words = [];
    for (const c of s.slice(sep + 1)) {
      const v = BECH32_CHARS.indexOf(c);
      if (v < 0) return null;
      words.push(v);
    }
    const body = words.slice(0, words.length - 6); // drop checksum
    const end = body.length - 104; // signature occupies the final 104 words
    let i = 7; // skip the 35-bit timestamp
    while (i + 3 <= end) {
      const tag = body[i];
      const len = body[i + 1] * 32 + body[i + 2];
      const start = i + 3;
      if (start + len > end) break;
      if (tag === wantTag) {
        let acc = 0, bits = 0;
        const bytes = [];
        for (let k = start; k < start + len; k++) {
          acc = (acc << 5) | body[k];
          bits += 5;
          if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
        }
        return new Uint8Array(bytes);
      }
      i = start + len;
    }
  } catch (_) {}
  return null;
}
// The 'p' field — the one identifier that lets us ask a wallet, after the fact,
// whether an invoice was actually paid.
function bolt11PaymentHash(invoice) {
  const b = bolt11Field(invoice, 1); // 'p'
  if (!b || b.length !== 32) return '';
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ---- payment serialization + auto-zap aggregate cap ----
// Payments run one-at-a-time per account: without this, a burst of concurrent
// webln.sendPayment calls could each pass the budget / auto-zap check before any
// of them records a debit (a check-then-pay-then-record race that lets a site
// overspend its limit). Auto-zaps additionally count against a rolling daily
// total, so a signed-in site can't drain the wallet by firing many zaps that are
// each under the per-zap cap — the per-zap limit alone bounds nothing in aggregate.
const PAY_DAY_MS = 24 * 60 * 60 * 1000;
const AUTOZAP_DAILY_MULTIPLE = 100; // default daily cap = 100× the per-zap cap when unset
// Hard ceilings on the no-confirmation path. Auto-zap spends with nothing to click,
// so the limits that bound it shouldn't be whatever was last typed into a text field:
// a stray zero on that input would otherwise widen the automatic path by 10×. Above
// these, zaps fall back to a normal approval — which is the right behavior for an
// amount large enough to want a second look.
// What enabling auto-zap from a payment card sets it to. The panel mirrors this as
// AUTOZAP_DEFAULT_MAX for its own input default.
const AUTOZAP_DEFAULT_MAX = 200;
const AUTOZAP_ABS_MAX = 1000; // sats, per zap
const AUTOZAP_ABS_DAILY_MAX = 100000; // sats, rolling day

// The auto-zap limits in force, clamped. Applied on READ as well as on write, so a
// value stored before these ceilings existed can't outlive them. Returns zeros when
// the setting is off, which every caller treats as "ask".
function autoZapLimits(settings) {
  if (!settings || settings.autoZap !== true) return { perZap: 0, daily: 0 };
  const perZap = Math.min(Math.max(0, Number(settings.autoZapMaxSats) || 0), AUTOZAP_ABS_MAX);
  const set = Number(settings.autoZapDailyMaxSats);
  const daily = Math.min(
    set > 0 ? set : perZap * AUTOZAP_DAILY_MULTIPLE,
    AUTOZAP_ABS_DAILY_MAX
  );
  return { perZap, daily };
}
const AUTOZAP_WINDOW_KEY = 'sidecar_autozap_window';
const payLocks = new Map(); // pubkey -> tail of the serialized payment chain
function withPayLock(pubkey, fn) {
  const prev = payLocks.get(pubkey) || Promise.resolve();
  const run = prev.then(fn, fn); // run whether or not the previous payment threw
  payLocks.set(pubkey, run.then(() => {}, () => {})); // keep the chain alive; swallow on the tail
  return run;
}
async function autoZapWindow() {
  const w = (await sget(AUTOZAP_WINDOW_KEY))[AUTOZAP_WINDOW_KEY];
  const now = Date.now();
  if (!w || !w.resetAt || now >= w.resetAt) return { spent: 0, resetAt: now + PAY_DAY_MS };
  return { spent: Number(w.spent) || 0, resetAt: w.resetAt };
}
async function recordAutoZap(sats) {
  const { spent, resetAt } = await autoZapWindow();
  await sset({ [AUTOZAP_WINDOW_KEY]: { spent: spent + Math.max(0, Math.floor(sats || 0)), resetAt } });
}

// Auto-zap covers BOTH gates of a zap: signing the kind:9734 request, and paying the
// invoice the lnurl server returns for it. Raising the cap only ever silenced the
// second one, which is why a small zap could still stop to ask — the signing prompt is
// governed by the site's permission tier and the shared-host override, not by any
// wallet setting.
//
// A zap request carries its own `amount` tag, so the very same per-zap and daily caps
// can be applied at signing time. This check is advisory: the payment path re-checks
// and is the thing that actually records the spend, so the caps are still enforced
// there even if several requests get signed before any of them is paid.
//
// Like relax mode, this overrides the shared-host confirm — and unlike relax mode it
// is bounded by an amount, not just a clock. Fails closed on anything unexpected.
async function autoZapMaySign(ev) {
  try {
    if (!ev || ev.kind !== 9734) return false;
    if (KS.isLocked()) return false;
    const settings = (await sget('sidecar_settings')).sidecar_settings || {};
    const { perZap: zapMax, daily: dailyMax } = autoZapLimits(settings);
    if (zapMax <= 0) return false;
    const tag = Array.isArray(ev.tags) ? ev.tags.find((t) => Array.isArray(t) && t[0] === 'amount') : null;
    const msat = tag ? Number(tag[1]) : 0;
    // NIP-57 makes `amount` optional, and a request that declares no amount can't be
    // held to a cap. Ask for those.
    if (!Number.isFinite(msat) || msat <= 0) return false;
    const sats = Math.round(msat / 1000);
    if (sats > zapMax) return false;
    if (dailyMax <= 0) return false;
    const { spent } = await autoZapWindow();
    return spent + sats <= dailyMax;
  } catch (_) {
    return false;
  }
}

// The page-invoice card asks this before it appears: is this invoice simply the one
// for a zap the user already authorized here? Jumble and other Bitcoin Connect clients
// render a QR rather than calling window.webln, so the card — not the approval prompt —
// is what stands between picking an amount and paying.
//
// Answers true only when an unconsumed zap request signed on THIS host and account,
// for THIS exact amount, is waiting, and the auto-zap caps allow it. Then there is
// nothing left to confirm. Every other case returns false and the card appears.
//
// Peeks rather than claims: payInvoiceCore does the real, single-use claim, and
// consuming the record here would make it prompt instead.
//
// `host` MUST come from the sender's URL, never from the message body — see the call
// site in the router.
async function tryZapAutopay(invoiceRaw, host, originWindowId, tabId) {
  const no = (why) => {
    dlog('info', 'zap', 'auto-pay declined', { why, host });
    return { handled: false, paid: false };
  };
  const inv = String(invoiceRaw || '');
  if (!host || !inv) return no('no host or invoice');
  if (KS.isLocked()) return no('keystore locked');
  const settings = (await sget('sidecar_settings')).sidecar_settings || {};
  const { perZap: cap } = autoZapLimits(settings);
  if (cap <= 0) return no('auto-approve zaps is off, or the per-zap cap is 0');
  const amt = invoiceSats(inv);
  if (amt == null) return no('invoice has no amount');
  if (amt > cap) return no(amt + ' sats exceeds the ' + cap + ' cap');
  const who = await resolveSiteAccount(host);
  if (!who) return no('no account resolved for ' + host);
  if ((await PERMS.getLevel(who, host)) === 'blocked') return no('site is blocked');
  if (!(await ZAPREQ.peek(host, who, amt))) {
    return no('no zap request signed here matches ' + amt + ' sats (' + amt * 1000 + ' msat)');
  }
  // Show the card in its auto form first. Money moving with nothing on screen is the
  // wrong trade even when the user opted out of being asked — and it means a failure
  // has somewhere to be reported instead of vanishing.
  notifyTabAutopaying(tabId, inv);
  try {
    const r = await payInvoiceCore(inv, host, who, undefined, originWindowId);
    notifyTabPaid(tabId, inv, r && r.preimage);
    return { handled: true, paid: true };
  } catch (e) {
    // Still handled: the auto card is up and is where this error belongs. Replacing it
    // with a fresh manual card would throw the reason away.
    notifyTabPayFailed(tabId, inv, e && e.message);
    return { handled: true, paid: false };
  }
}

// Ask the wallet whether an invoice actually settled. Called ONLY to resolve a
// pay_invoice whose outcome we couldn't hear — never to decide whether to pay.
// lookup_invoice is read-only, so this can't double-spend.
//
// A payment can still be in flight when we first ask (a slow route is the very
// reason the response was missed), so poll briefly rather than taking one "not yet"
// as a no. An explicit 'failed' is authoritative and stops early.
const naptime = (ms) => new Promise((r) => setTimeout(r, ms));
const invSettled = (inv) => !!(inv && (inv.settled_at || inv.preimage || inv.state === 'settled'));
const invFailed = (inv) => !!(inv && (inv.state === 'failed' || inv.state === 'expired'));

// When to stop trusting silence. Most zaps settle in a few seconds; past that the
// ephemeral response is more likely lost than late, and the wallet's own record is
// both faster and more truthful than waiting out the 30s NWC timeout.
const LOOKUP_START_MS = 8000;
// NIP-47 defines a RATE_LIMITED error ("sending commands too fast"), so poll at a
// pace that answers quickly without giving the wallet a reason to start refusing.
const LOOKUP_EVERY_MS = 5000;
// How long to keep asking after pay_invoice has given up. A payment that outran the
// NWC timeout is usually a slow route still completing, so it's worth a bounded wait
// rather than immediately reporting a failure we haven't verified.
const CONFIRM_GRACE_MS = 12000;

// Pay, and watch the wallet's own ledger at the same time.
//
// pay_invoice alone is a single point of failure: the kind:23195 reply is ephemeral,
// so if it goes missing the request just sits there until the 30s timeout, and the
// page waits the whole time for an answer that already exists. Polling lookup_invoice
// in parallel from 8s means the usual outcome is "we found out at ~8s" rather than
// "we gave up at 30s" — and what we report is what the wallet actually did.
//
// One watcher serves both jobs: racing the payment, and confirming an indeterminate
// failure afterwards. Running a second poller for the latter would just double the
// traffic to the wallet relay. lookup_invoice is read-only, so watching a payment
// alongside it can never cause a second one.
async function payAndConfirm(c, invoice) {
  const hash = bolt11PaymentHash(invoice);
  const arg = hash ? { payment_hash: hash } : { invoice };
  let stop = false;
  let deadline = Infinity; // tightened once pay_invoice gives up

  const paying = c.payInvoice(invoice).then(
    (res) => ({ kind: 'paid', res }),
    (err) => ({ kind: 'error', err })
  );

  const watching = (async () => {
    await naptime(LOOKUP_START_MS);
    let attempt = 0;
    while (!stop && Date.now() < deadline) {
      try {
        attempt++;
        const inv = await c.lookupInvoice(arg);
        dlog('info', 'pay', 'lookup_invoice', { attempt, state: inv && inv.state, type: inv && inv.type });
        if (invSettled(inv)) return { kind: 'paid', res: inv };
        if (invFailed(inv)) return { kind: 'error', err: new Error('The payment failed') };
      } catch (e) {
        // Early on the wallet may not know this invoice yet ("not found"), and the
        // lookup can fail on the same connection that lost the reply. Keep watching.
        dlog('info', 'pay', 'lookup_invoice failed', { attempt, error: (e && e.message) || String(e) });
      }
      await naptime(LOOKUP_EVERY_MS);
    }
    return { kind: 'unknown' };
  })();

  try {
    const first = await Promise.race([paying, watching]);
    if (first.kind === 'paid') return first.res;
    // The wallet gave a definitive no. Nothing moved, so don't go looking.
    if (first.kind === 'error' && first.err && first.err.walletDenied) throw first.err;
    // Indeterminate. Let the watcher already in flight run on a little longer.
    dlog('info', 'pay', 'no usable answer from pay_invoice; confirming', {
      error: (first.err && first.err.message) || first.kind,
      graceMs: CONFIRM_GRACE_MS,
    });
    deadline = Date.now() + CONFIRM_GRACE_MS;
    const second = await watching;
    if (second.kind === 'paid') {
      dlog('info', 'pay', 'rescued — wallet confirms the payment settled');
      return second.res;
    }
    // The one outcome worth finding in a log later: we are about to tell the page a
    // payment failed without the wallet ever having confirmed it either way.
    dlog('error', 'pay', 'reporting failure; wallet never confirmed a settlement', {
      error: (first.err && first.err.message) || 'unknown',
    });
    throw first.err || (second.kind === 'error' ? second.err : new Error('Payment status unknown'));
  } finally {
    stop = true;
  }
}

// Shared payment core: budget-gate (prompt if needed), pay via NWC, decrement
// budget, log, and notify the panel. Used by window.webln.sendPayment AND the
// "Pay with Sidecar" context menu. Assumes the caller resolved `pubkey` and
// checked the account/site is usable. Serialized per account (see withPayLock).
function payInvoiceCore(invoiceRaw, host, pubkey, memo, originWindowId, offerAutoZap) {
  // Hold the worker up for the whole payment, approval prompt included.
  payInFlight++;
  ensureKeepalive();
  startPayHeartbeat();
  return withPayLock(pubkey, () => payInvoiceLocked(invoiceRaw, host, pubkey, memo, originWindowId, offerAutoZap))
    .finally(() => {
      payInFlight--;
      if (payInFlight === 0) stopPayHeartbeat();
      stopKeepaliveIfIdle();
    });
}
async function payInvoiceLocked(invoiceRaw, host, pubkey, memo, originWindowId, offerAutoZap) {
  const invoice = String(invoiceRaw || '').replace(/^lightning:/i, '').trim();
  if (!invoice) throw new Error('No invoice provided');
  if (!/^ln(bc|tb)[0-9]/i.test(invoice)) throw new Error('Not a BOLT11 Lightning invoice');
  const sats = invoiceSats(invoice);

  // Pay without a prompt when unlocked and either the site's budget covers a known
  // amount, or "auto-approve zaps" is on and this is a genuine zap within the limit.
  const settings = (await sget('sidecar_settings')).sidecar_settings || {};
  const unlocked = !KS.isLocked() && sats != null;
  const budgetOk = unlocked && (await BUDGETS.covers(pubkey, host, sats));
  // Auto-zap is gated by BOTH a per-zap cap and a rolling daily aggregate cap, each
  // held under a hard ceiling (see autoZapLimits).
  const { perZap: zapMax, daily: zapDailyMax } = autoZapLimits(settings);
  let zapOk = false;
  // Claim only if the payment actually needs it: the site's budget already covering
  // this one makes autoOk true either way, and a zap approval is single-use, so
  // spending one here would be for nothing. The amount is likewise checked first so
  // an over-cap payment doesn't burn a record it can't use.
  if (!budgetOk && unlocked && zapMax > 0 && sats <= zapMax && (await ZAPREQ.claim(host, pubkey, sats))) {
    const { spent } = await autoZapWindow();
    zapOk = zapDailyMax > 0 && spent + sats <= zapDailyMax;
  }
  const autoOk = budgetOk || zapOk;

  if (!autoOk) {
    const st = await KS.getState();
    const acct = st.accounts.find((a) => a.pubkey === pubkey);
    const decision = await openPrompt({
      scope: 'webln',
      host,
      method: 'sendPayment',
      npub: self.NostrTools.nip19.npubEncode(pubkey),
      accountName: (acct && acct.name) || '',
      accountPicture: (acct && acct.picture) || '',
      amountSats: sats, // null for amountless invoices
      memo: memo || '',
      needUnlock: KS.isLocked(),
      needApproval: true,
      // The card offered to switch automatic zaps on. It is confirmed HERE, on
      // Sidecar's own surface, and written only if the user approves the payment —
      // a page must not be able to enable automatic spending on its own say-so.
      // Offered only when it would actually cover this payment, so the amount in
      // front of the user is one the setting would have handled.
      offerAutoZap:
        offerAutoZap && settings.autoZap !== true && sats != null && sats <= AUTOZAP_DEFAULT_MAX
          ? AUTOZAP_DEFAULT_MAX
          : 0,
    }, originWindowId);
    if (decision.action === 'reject') throw new Error('You rejected this payment');
    if (KS.isLocked()) throw new Error('Keystore is locked');
    // Approved with the offer still ticked → turn it on, at the documented defaults.
    // Reached only from an approval on an extension page; a rejected or dismissed
    // prompt leaves the setting alone.
    if (decision.enableAutoZap) {
      const prev = (await sget('sidecar_settings')).sidecar_settings || {};
      await sset({
        sidecar_settings: {
          ...prev,
          autoZap: true,
          autoZapMaxSats: AUTOZAP_DEFAULT_MAX,
          autoZapDailyMaxSats: AUTOZAP_DEFAULT_MAX * AUTOZAP_DAILY_MULTIPLE,
        },
      });
    }
    // 'budget' → remember an allowance for this site before paying.
    if (decision.action === 'budget' && decision.budgetSats) {
      await BUDGETS.setBudget(pubkey, host, {
        budgetSats: decision.budgetSats,
        perPaymentSats: decision.perPaymentSats || 0,
      });
    }
  }

  bumpAutoLock();
  const c = await getSwNwc(pubkey);
  if (!c) throw new Error('No wallet connected in Sidecar');
  // Never report a payment as failed on the strength of not having heard back.
  // Publishing the NIP-47 request is what commits the money; hearing the reply is a
  // separate thing that can fail on its own (a slow route outrunning the 30s timeout,
  // a relay blip losing the ephemeral kind:23195, an undecryptable response). Each of
  // those used to surface to the page as an error while the sats were gone, or hang
  // it for the full 180s — issue #138. The wallet is the only authority on what
  // actually happened, so payAndConfirm asks it rather than inferring from silence.
  const res = await payAndConfirm(c, invoice);
  const preimage = res && (res.preimage || res.payment_preimage);

  // ---- the money has moved; from here nothing may delay the caller ----
  // Everything below is bookkeeping. It used to be awaited one item at a time
  // BEFORE returning, which meant several storage round-trips sat between a
  // settled payment and the page hearing about it. If MV3 recycled the worker in
  // that window the sats were gone, the balance was right, the Activity log had the
  // entry — and the page's promise never resolved. See issue #138: a Bitcoin
  // Connect modal stuck on "waiting" for a payment with a valid preimage.
  //
  // These still run, and still run in order where order matters (budget accounting
  // must not be dropped or the spend under-counts). They just no longer stand
  // between the payment and the reply.
  // Counted as still in flight until the bookkeeping lands. Without this the
  // heartbeat stopped the moment the payment resolved — while these writes were
  // still pending — so a worker recycled in that gap would drop the budget debit
  // and the auto-zap daily total. Both are spending limits: dropping them lets the
  // next payment through on a stale count. The reply is not delayed by this; only
  // the worker's eligibility to sleep is.
  payInFlight++;
  (async () => {
    // Decrement the budget by the paid amount (known amount only).
    if (sats != null) await BUDGETS.consume(pubkey, host, sats);
    // Count an auto-zap (one authorized solely by the zap allowance) against the
    // rolling daily total, so the aggregate cap is enforced across the window.
    if (zapOk && !budgetOk && sats != null) await recordAutoZap(sats);
    await setSiteAccount(host, pubkey);
  })()
    .catch(() => {})
    .then(() => {
      payInFlight--;
      if (payInFlight === 0) stopPayHeartbeat();
      stopKeepaliveIfIdle();
    });
  logActivity({ ts: Date.now(), host, method: 'webln.sendPayment', amountSats: sats, pubkey });
  // Tell an open side panel to refresh its balance/history.
  chrome.runtime.sendMessage({ type: 'SIDECAR_EVENT', event: 'walletChanged' }).catch(() => {});
  // Let the paying page celebrate (the content script's lightning strike). This is the
  // WebLN path — a zap from a client's own UI, where notifyTabPaid isn't otherwise
  // called because there's no "Pay with Sidecar" card involved. Best-effort: the page
  // may have navigated away, and a missing flourish is not an error.
  notifyTabsPaidByHost(host).catch(() => {}); // deliberately not awaited — a flourish must not delay the reply
  return { preimage: preimage || '', sats };
}

// ============================================================================
// "Pay with Sidecar" — pay an invoice found on a page (context menu)
// ============================================================================
function notify(message) {
  chrome.notifications.create(
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Sidecar',
      message: String(message),
    },
    () => void chrome.runtime.lastError
  );
}

// Tell a tab a page invoice was paid, so its "Pay with Sidecar" pill clears
// (the invoice link often lingers in the DOM after the modal shows "Paid").
// Tell the tabs on `host` that a payment settled, so the content script can throw its
// lightning strike. Scoped to the paying host — never broadcast to every open tab, or
// an unrelated page would flash for a payment that had nothing to do with it. Carries
// no invoice: this is a visual cue, and the pay-card dismissal keys off the invoice via
// notifyTabPaid instead.
async function notifyTabsPaidByHost(host) {
  if (!host || !chrome.tabs) return;
  // Gate here rather than in the content script: the page-facing settings read is
  // deliberately clamped to showPayButton (see SIDECAR_GET_SETTINGS above), and
  // widening it would hand every visited site another config bit to fingerprint.
  // Default on — only an explicit false disables it.
  const settings = (await sget('sidecar_settings')).sidecar_settings || {};
  if (settings.zapFlash === false) return;
  try {
    chrome.tabs.query({}, (tabs) => {
      void chrome.runtime.lastError;
      for (const t of tabs || []) {
        let h = '';
        try { h = new URL(t.url || '').host; } catch (_) { continue; }
        if (h !== host || t.id == null) continue;
        chrome.tabs.sendMessage(t.id, { type: 'SIDECAR_EVENT', event: 'paidflash' }, () => void chrome.runtime.lastError);
      }
    });
  } catch (_) {}
}

// Tell a tab an auto-zap is going out, so the page-invoice card can show what's
// happening instead of money moving with nothing on screen. Sent BEFORE the payment,
// so the card is already up when the result lands on it.
function notifyTabAutopaying(tabId, invoice) {
  if (tabId != null && chrome.tabs) {
    chrome.tabs.sendMessage(tabId, { type: 'SIDECAR_EVENT', event: 'autopaying', invoice }, () => void chrome.runtime.lastError);
  }
}

// `preimage` is what proves the payment to the page. Bitcoin Connect clients hand it
// to their onPaid callback, so the content script needs it to close a modal that has
// no other way of learning the invoice settled — see the bridge in nostr-provider.js.
function notifyTabPaid(tabId, invoice, preimage) {
  if (tabId != null && chrome.tabs) {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'SIDECAR_EVENT', event: 'paid', invoice, preimage: String(preimage || '') },
      () => void chrome.runtime.lastError
    );
  }
}

// Tell a tab a page-invoice payment failed, so its pending "Pay with Sidecar"
// card stops spinning and offers a retry instead of hanging forever.
function notifyTabPayFailed(tabId, invoice, error) {
  if (tabId != null && chrome.tabs) {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'SIDECAR_EVENT', event: 'payfailed', invoice, error: String(error || 'Payment failed') },
      () => void chrome.runtime.lastError
    );
  }
}

// Resolve the account/wallet for the page, then pay via the shared core.
async function payFromPage(invoiceRaw, host, originWindowId, offerAutoZap) {
  await KS.ensureLoaded();
  if (!(await KS.isInitialized())) throw new Error('Sidecar has no accounts set up yet');
  const pubkey = await resolveSiteAccount(host);
  if (!pubkey) throw new Error('No active Sidecar account');
  if ((await PERMS.getLevel(pubkey, host)) === 'blocked') throw new Error('This site is blocked in Sidecar');
  if (!(await KS.hasNwc(pubkey))) throw new Error('No wallet connected in Sidecar');
  return payInvoiceCore(invoiceRaw, host, pubkey, undefined, originWindowId, offerAutoZap);
}

// First BOLT11 invoice inside a blob of text (selection, link, decoded QR).
function extractInvoice(text) {
  const m = /ln(?:bc|tb)[0-9][a-z0-9]+/i.exec(String(text || '').replace(/^lightning:/i, ''));
  return m ? m[0].toLowerCase() : '';
}

// Decode a QR <img> entirely in the worker: fetch it, draw to an OffscreenCanvas,
// run jsQR. jsQR is heavy (~250KB) so it's imported lazily, only on first QR pay.
let jsqrReady = false;
function ensureJsQR() {
  // Firefox (event page) has no importScripts — jsqr.js is loaded up front via
  // manifest background.scripts there, so it's already on self.
  if (!jsqrReady) {
    if (typeof importScripts === 'function') importScripts('jsqr.js');
    jsqrReady = true;
  }
  return self.jsQR;
}
async function invoiceFromQrImage(srcUrl) {
  if (!srcUrl) throw new Error('No image to read');
  const blob = await (await fetch(srcUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const res = ensureJsQR()(data.data, data.width, data.height);
  if (!res || !res.data) throw new Error('No QR code found in that image');
  const invoice = extractInvoice(res.data);
  if (!invoice) throw new Error('That QR is not a Lightning invoice');
  return invoice;
}

function createPayMenu() {
  if (!chrome.contextMenus) return;
  // Failures surface synchronously (throw, Firefox) or via lastError in the
  // callback (Chrome) — cover both so one bad item can't take out the menu.
  const create = (props, onFail) => {
    try {
      chrome.contextMenus.create(props, () => {
        if (chrome.runtime.lastError && onFail) onFail();
      });
    } catch (_) { if (onFail) onFail(); }
  };
  chrome.contextMenus.removeAll(() => {
    // Only on lightning: links (not every link), on any text selection, and on
    // QR images. (Canvas/SVG QRs have no image context — a later pass.)
    // Both browsers document targetUrlPatterns as accepting any URL scheme, but
    // if a build ever rejects the lightning: pattern, fall back to a pattern-less
    // link item — the click handler's extractInvoice already fails safe on
    // non-lightning links with a "no invoice found" notice.
    create(
      { id: 'sidecar-pay-link', title: 'Pay this invoice with Sidecar', contexts: ['link'], targetUrlPatterns: ['lightning:*'] },
      () => create({ id: 'sidecar-pay-link', title: 'Pay this invoice with Sidecar', contexts: ['link'] })
    );
    create({ id: 'sidecar-pay-selection', title: 'Pay Lightning invoice with Sidecar', contexts: ['selection'] });
    create({ id: 'sidecar-pay-qr', title: 'Pay QR code with Sidecar', contexts: ['image'] });
  });
}
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(createPayMenu);

chrome.contextMenus &&
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    let host = '';
    try { host = new URL(info.pageUrl || (tab && tab.url) || '').host; } catch (_) {}
    const originWindowId = tab && tab.windowId != null ? tab.windowId : undefined;
    const pay = (getInvoice) =>
      Promise.resolve(getInvoice)
        .then((inv) => payFromPage(inv, host, originWindowId).then((r) => ({ r, inv })))
        .then(({ r, inv }) => {
          notify(r.sats != null ? 'Payment sent — ' + r.sats.toLocaleString('en-US') + ' sats' : 'Payment sent');
          notifyTabPaid(tab && tab.id, inv, r.preimage);
        })
        .catch((e) => notify((e && e.message) || 'Payment failed'));

    if (info.menuItemId === 'sidecar-pay-qr') {
      pay(invoiceFromQrImage(info.srcUrl));
    } else if (info.menuItemId === 'sidecar-pay-link' || info.menuItemId === 'sidecar-pay-selection') {
      const invoice = extractInvoice(info.linkUrl || info.selectionText);
      if (!invoice) return notify('No Lightning invoice found in the selection.');
      pay(invoice);
    }
  });

// ============================================================================
// Keystore control messages (from side panel and prompt)
// ============================================================================

// ---- unlock throttle + auto-wipe guard ----
// Persisted (survives service-worker death / browser restart), so an attacker
// can't reset the counter by killing the worker. After MAX_UNLOCK_FAILS
// consecutive bad PINs the keystore self-erases (Passport-style), with an
// escalating delay between tries so a genuine user can't blow through the budget
// by accident and offline brute force stays infeasible. Reset on any success.
const MAX_UNLOCK_FAILS = 21;
function unlockDelayMs(fails) {
  if (fails < 10) return 0;                    // first 10 tries: no wait (generous typo grace)
  return Math.min(60000, (fails - 9) * 5000);  // then 5s, 10s, … capped at 60s
}
async function loadUnlockGuard() {
  const g = (await sget('sidecar_unlock_guard')).sidecar_unlock_guard;
  return g && typeof g.fails === 'number' ? g : { fails: 0, lastAt: 0 };
}
const saveUnlockGuard = (g) => sset({ sidecar_unlock_guard: g });
const clearUnlockGuard = () => new Promise((res) => chrome.storage.local.remove('sidecar_unlock_guard', res));

async function lockKeystore(auto = false) {
  await KS.lock();
  SIGNER.clearCache();
  closeSwNwc();
  chrome.alarms.clear(AUTO_LOCK_ALARM);
  // A lock ends any active relax window: the keys are gone, so auto-approving
  // signs makes no sense, and idle auto-lock is exactly the "walked away" case
  // where a lingering auto-sign shouldn't survive.
  RELAX.revokeAll().then(syncRelaxBadge);
  // Same reasoning for pending zap requests: they authorize a payment to go out with
  // no prompt, so a locked keystore must not leave any of them spendable.
  ZAPREQ.clear().catch(() => {});
  // Tell any open panel/popup to drop to the unlock screen immediately — otherwise
  // it keeps showing whatever was open (e.g. the composer) and only discovers the
  // lock on its next action, which then fails with a "locked" error. `auto` marks an
  // idle-timeout lock (vs. manual lock / wipe / reset, which show their own message)
  // so the panel can toast why it suddenly jumped to the unlock screen.
  chrome.runtime.sendMessage({ type: 'SIDECAR_EVENT', event: 'locked', auto }).catch(() => {});
}

function bumpAutoLock() {
  sget('sidecar_settings').then(({ sidecar_settings }) => {
    const minutes = resolveSettings(sidecar_settings).autoLockMinutes;
    if (minutes > 0 && !KS.isLocked()) {
      chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
    }
  });
}

// Reflect an active relax window on the toolbar icon badge (remaining minutes),
// so auto-sign is visible EVEN WHEN THE SIDE PANEL IS CLOSED — the panel's
// bottom bar is the detailed view; the badge is the always-on "something's
// active" signal, and clicking the icon opens the panel to that bar. A 1-min
// alarm ticks the countdown down; both clear when no window is live.
const RELAX_BADGE_ALARM = 'sidecar-relax-badge';
function syncRelaxBadge() {
  RELAX.active().then((grants) => {
    if (grants && grants.length) {
      const mins = Math.max(0, Math.round((grants[0].expiresAt - Date.now()) / 60000));
      chrome.action.setBadgeText({ text: String(mins) });
      chrome.action.setBadgeBackgroundColor({ color: '#cba14e' });
      if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#1a0a33' });
      chrome.alarms.create(RELAX_BADGE_ALARM, { periodInMinutes: 1 });
    } else {
      chrome.action.setBadgeText({ text: '' });
      chrome.alarms.clear(RELAX_BADGE_ALARM);
    }
  }).catch(() => {});
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    // Re-check the live setting at fire time: an alarm armed under an older
    // choice (before the user switched to Never) must not lock.
    sget('sidecar_settings').then(({ sidecar_settings }) => {
      if (resolveSettings(sidecar_settings).autoLockMinutes > 0) lockKeystore(true);
    });
  }
  // A relax window expired — RELAX.onAlarm drops the grant and returns true.
  // Alarms persist across a service-worker restart, so this fires even if the
  // worker idled for the whole window.
  else if (RELAX.onAlarm(alarm.name)) {
    syncRelaxBadge(); // a window expired — drop the badge
  }
  // Tick the toolbar countdown down each minute while a window is active.
  else if (alarm.name === RELAX_BADGE_ALARM) syncRelaxBadge();
  // Best-effort heartbeat while the approval queue is non-empty: sweeps expired
  // requests and re-drives the display so nothing stalls if the SW was napping.
  else if (alarm.name === QUEUE_KEEPALIVE_ALARM) driveDisplay();
});

// ---- step-up PIN gate (reveal nsec/NWC, PIN-confirmed owner ops, change PIN) ----
// The PIN is the keystore's ONE credential, so two rules follow:
//   1. A correct PIN is never refused just because auto-lock fired while a modal
//      was open (the panel can be a beat behind the background's lock state).
//      If the keystore is locked, a verified PIN unlocks it and the operation
//      proceeds — exactly as if it had been typed on the unlock screen. The old
//      behavior ("Keystore is locked" thrown at a correct PIN) forced a manual
//      lock/unlock round trip.
//   2. A wrong PIN here costs the same as a wrong PIN on the unlock screen.
//      Step-up attempts share the persisted unlock guard (escalating delays,
//      self-wipe on the 21st strike) — otherwise VERIFY_PIN / reveal / change-PIN
//      would be unthrottled oracles for brute-forcing the very PIN that guard
//      protects.
// guardPinAttempt wraps any PIN-checking `attempt` (which must throw
// /incorrect .*pin/i on a bad PIN) in that shared accounting. Throws
// human-readable errors — the step-up modals display e.message as-is.
async function guardPinAttempt(attempt) {
  const guard = await loadUnlockGuard();
  const waitMs = unlockDelayMs(guard.fails) - (Date.now() - guard.lastAt);
  if (waitMs > 0) throw new Error('Too many attempts — try again in ' + Math.ceil(waitMs / 1000) + 's');
  let result;
  try {
    result = await attempt();
  } catch (e) {
    if (!/incorrect (current )?pin/i.test(e.message || '')) throw e; // not a PIN verdict (e.g. not initialized)
    const fails = guard.fails + 1;
    if (fails >= MAX_UNLOCK_FAILS) {
      // Final strike: same erase as the unlock screen (in-memory + all persisted data).
      await lockKeystore();
      await new Promise((res) => chrome.storage.local.clear(() => res()));
      throw new Error('Too many failed attempts — Sidecar has been erased');
    }
    await saveUnlockGuard({ fails, lastAt: Date.now() });
    const remaining = MAX_UNLOCK_FAILS - fails;
    if (remaining <= 5) {
      throw new Error(e.message + ' — ' + remaining + (remaining === 1 ? ' attempt' : ' attempts') + ' left before Sidecar erases itself');
    }
    throw e;
  }
  await clearUnlockGuard();
  return result;
}
async function stepUpPin(pin) {
  if (typeof pin !== 'string' || !pin) throw new Error('PIN required');
  await guardPinAttempt(async () => {
    if (KS.isLocked()) {
      await KS.unlock(pin); // throws 'Incorrect PIN' on a bad one
      bumpAutoLock();
    } else if (!(await KS.verifyPin(pin))) {
      throw new Error('Incorrect PIN');
    }
  });
}

async function handleControl(message, sendResponse) {
  try {
    await KS.ensureLoaded(); // reflect a session unlock that survived SW restart
    let result;
    switch (message.type) {
      case 'SIDECAR_GET_STATE':
        result = await KS.getState();
        break;
      case 'SIDECAR_ACTIVITY':
        // Panel-side activity (e.g. actively composing a note) counts as use, so
        // re-arm the idle auto-lock timer — otherwise it can fire mid-compose,
        // since typing never round-trips to the background. No-ops when locked or
        // when auto-lock is off/Never (bumpAutoLock guards both).
        bumpAutoLock();
        result = { ok: true };
        break;
      case 'SIDECAR_INIT': {
        result = await KS.initialize(message.pin);
        // A new keystore adopts the current auto-lock default as an explicit
        // setting (and needs no migration notice) — the "no stored value" state
        // is reserved for keystores that predate the 15-minute default.
        const prev = (await sget('sidecar_settings')).sidecar_settings || {};
        await sset({
          sidecar_settings: { autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES, autoLockNoticeShown: true, ...prev },
        });
        bumpAutoLock();
        break;
      }
      case 'SIDECAR_UNLOCK': {
        // CONTRACT: resolves { ok:true, result:{ status } } — it does NOT throw
        // ok:false for a wrong PIN. `status` is one of:
        //   'ok'        → unlocked; result.state is the keystore state
        //   'bad'       → wrong PIN; result.remaining, result.nextWaitMs
        //   'throttled' → in cooldown; result.waitMs, result.remaining
        //   'wiped'     → 21st strike, all data erased
        //   'error'     → unexpected (e.g. keystore not initialized); result.error
        // Every caller must branch on result.status — NOT on the outer `ok`
        // envelope (which is now always true). Callers:
        //   • sidepanel.js  unlock-form submit handler
        //   • sidepanel.js  approval submit (in-panel signing/pay prompt)
        //   • prompt.js     approval popup submit
        // Throttle + auto-wipe are enforced here (trusted context), not the UI.
        const guard = await loadUnlockGuard();
        const waitMs = unlockDelayMs(guard.fails) - (Date.now() - guard.lastAt);
        if (waitMs > 0) {
          result = { status: 'throttled', waitMs, remaining: MAX_UNLOCK_FAILS - guard.fails };
          break;
        }
        try {
          const state = await KS.unlock(message.pin);
          await clearUnlockGuard();
          bumpAutoLock();
          result = { status: 'ok', state };
        } catch (e) {
          if (/not initialized/i.test(e.message || '')) { result = { status: 'error', error: e.message }; break; }
          const fails = guard.fails + 1;
          if (fails >= MAX_UNLOCK_FAILS) {
            // Final strike: erase everything (in-memory + all persisted data).
            await lockKeystore();
            await new Promise((res) => chrome.storage.local.clear(() => res()));
            result = { status: 'wiped' };
          } else {
            await saveUnlockGuard({ fails, lastAt: Date.now() });
            result = { status: 'bad', remaining: MAX_UNLOCK_FAILS - fails, nextWaitMs: unlockDelayMs(fails) };
          }
        }
        break;
      }
      case 'SIDECAR_LOCK':
        await lockKeystore();
        result = await KS.getState();
        break;
      case 'SIDECAR_FETCH_OG': {
        // Fetch a URL from the SW (no CORS restriction) and parse OG/meta tags.
        // Returns { title, description, image, site } or null on failure.
        const ogTarget = safeFetchUrl(message.url);
        if (!ogTarget) { result = null; break; }
        const ogUrl = ogTarget.href;
        try {
          const resp = await fetch(ogUrl, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
          if (!resp.ok) { result = null; break; }
          // A redirect can bounce a public URL onto the private network; reject if
          // the final response landed on a blocked host.
          const finalUrl = safeFetchUrl(resp.url || ogUrl);
          if (!finalUrl) { result = null; break; }
          const ct = resp.headers.get('content-type') || '';
          if (!ct.includes('text/html')) { result = null; break; }
          const html = await resp.text();
          const pick = (html, ...patterns) => {
            for (const p of patterns) { const m = html.match(p); if (m) return m[1].trim(); }
            return null;
          };
          result = {
            title: pick(html,
              /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"'<>]+)["']/i,
              /<meta[^>]+content=["']([^"'<>]+)["'][^>]+property=["']og:title["']/i,
              /<title[^>]*>([^<]{1,200})<\/title>/i),
            description: pick(html,
              /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"'<>]+)["']/i,
              /<meta[^>]+content=["']([^"'<>]+)["'][^>]+property=["']og:description["']/i,
              /<meta[^>]+name=["']description["'][^>]+content=["']([^"'<>]+)["']/i,
              /<meta[^>]+content=["']([^"'<>]+)["'][^>]+name=["']description["']/i),
            image: pick(html,
              /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"'<>]+)["']/i,
              /<meta[^>]+content=["']([^"'<>]+)["'][^>]+property=["']og:image["']/i),
            site: pick(html,
              /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"'<>]+)["']/i,
              /<meta[^>]+content=["']([^"'<>]+)["'][^>]+property=["']og:site_name["']/i),
          };
          if (!result.title && !result.description) result = null;
        } catch (_) { result = null; }
        break;
      }
      case 'SIDECAR_RESET_ALL':
        // Wipe everything: in-memory keys/session/wallet (lockKeystore) plus all
        // persisted data (keystore, accounts, permissions, relays, settings, site
        // bindings, activity, NWC connections, budgets). Unrecoverable.
        await lockKeystore();
        await new Promise((res) => chrome.storage.local.clear(() => res()));
        result = true;
        break;
      case 'SIDECAR_ADD_ACCOUNT':
        if (message.generate) result = await KS.generateAccount(message.name);
        else result = await KS.importSecret(message.secret, message.name);
        break;
      case 'SIDECAR_REMOVE_ACCOUNT': {
        result = await KS.removeAccount(message.pubkey);
        await PERMS.clearAccount(message.pubkey);
        await BUDGETS.clearAccount(message.pubkey);
        await clearSiteAccountsForPubkey(message.pubkey);
        await BASELINE.forget(message.pubkey); // don't leave overwrite baselines behind
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
      case 'SIDECAR_SET_ACTIVE': {
        const prevActive = await KS.getActivePubkey();
        result = await KS.setActive(message.pubkey);
        // Switching identity ends any active relax window: its countdown is for an
        // account you've moved off of, and a lingering auto-sign shouldn't follow
        // you across an identity change. Only on a real change — tapping the
        // already-active account is a no-op and must not kill the window. Awaited
        // so the panel's immediate re-query finds the grants already gone (no
        // flicker of the disappearing indicator).
        if (prevActive && prevActive !== message.pubkey) { await RELAX.revokeAll(); syncRelaxBadge(); }
        break;
      }
      case 'SIDECAR_CHANGE_PIN':
        // changePin verifies the old PIN itself (and works from either lock
        // state); guardPinAttempt adds the shared throttle/wipe accounting.
        result = await guardPinAttempt(() => KS.changePin(message.oldPin, message.newPin));
        break;
      case 'SIDECAR_VERIFY_PIN':
        // Step-up re-auth for sensitive ops (reveal nsec/NWC, publish profile).
        // A plain wrong PIN keeps the { valid:false } contract; throttle/wipe/
        // near-wipe warnings throw so the modal shows why (callers render e.message).
        try {
          await stepUpPin(message.pin);
          result = { valid: true };
        } catch (e) {
          if ((e.message || '') === 'Incorrect PIN') result = { valid: false };
          else throw e;
        }
        break;
      case 'SIDECAR_REVEAL_NSEC': {
        // Extract private data — always step-up PIN, even while unlocked. If
        // auto-lock won a race with the modal, the verified PIN unlocks instead
        // of the old illogical "correct PIN, but locked" rejection.
        await stepUpPin(message.pin);
        const bytes = await KS.getPrivkey(message.pubkey);
        result = { nsec: self.NostrTools.nip19.nsecEncode(bytes) };
        break;
      }

      // ---- owner actions: sign/encrypt with the ACTIVE account's key ----
      // The panel builds events; signing happens here so the key never leaves the SW.
      case 'SIDECAR_OWNER_SIGN': {
        if (message.pin != null) await stepUpPin(message.pin); // unlocks if auto-lock raced the modal
        else if (KS.isLocked()) throw new Error('Keystore is locked');
        // expectedPubkey (when the caller supplies it) makes this fail closed if
        // the active account changed out from under the caller — see KS.ownerSign.
        result = await KS.ownerSign(message.event, message.expectedPubkey);
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
      case 'SIDECAR_GET_SETTINGS': {
        const raw = (await sget('sidecar_settings')).sidecar_settings || {};
        // autoLockDefaulted: the user has never chosen an auto-lock value, so the
        // resolved 15 minutes is the migration default. The panel uses this to
        // show existing users a one-time notice that auto-lock is now on.
        result = { ...resolveSettings(raw), autoLockDefaulted: !('autoLockMinutes' in raw) };
        break;
      }
      case 'SIDECAR_SET_SETTINGS': {
        const prev = (await sget('sidecar_settings')).sidecar_settings || {};
        const merged = { ...prev, ...message.settings };
        // Hold the auto-zap limits under their ceilings here, not just in the panel
        // that draws the input. This is the value every payment gate then trusts, so
        // it is validated where it is stored rather than where it is typed.
        if ('autoZapMaxSats' in merged) {
          merged.autoZapMaxSats = Math.min(Math.max(1, Number(merged.autoZapMaxSats) || 1), AUTOZAP_ABS_MAX);
        }
        if ('autoZapDailyMaxSats' in merged) {
          merged.autoZapDailyMaxSats = Math.min(Math.max(1, Number(merged.autoZapDailyMaxSats) || 1), AUTOZAP_ABS_DAILY_MAX);
        }
        await sset({ sidecar_settings: merged });
        // Apply an auto-lock change immediately: drop any alarm armed under the
        // old value, then re-arm from the new one (no-op when Never or locked).
        // Without this the change only took effect on the next sign/pay/unlock —
        // enabling auto-lock and walking away would never actually lock.
        if (message.settings && 'autoLockMinutes' in message.settings) {
          await chrome.alarms.clear(AUTO_LOCK_ALARM);
          bumpAutoLock();
        }
        // Push the pay-pill setting to content scripts so it toggles live.
        if (chrome.tabs) {
          chrome.tabs.query({}, (tabs) => {
            for (const t of tabs) {
              if (t.id != null) {
                chrome.tabs.sendMessage(
                  t.id,
                  {
                    type: 'SIDECAR_EVENT',
                    event: 'settings',
                    showPayButton: merged.showPayButton,
                    // Keep the card's auto-zap offer in step: turning the setting on
                    // in Settings should retire the offer without a page reload.
                    autoZapOffer: merged.autoZap === true ? 0 : AUTOZAP_DEFAULT_MAX,
                  },
                  () => void chrome.runtime.lastError
                );
              }
            }
          });
        }
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
        await clearAuthorizedForHost(message.host); // and the shared-identity history
        break;
      case 'SIDECAR_GET_SITE_BINDINGS':
        result = await getAllSiteAccounts();
        break;
      case 'SIDECAR_GET_SITE_AUTHORIZED':
        // host -> [pubkeys that have signed in there]; a host with 2+ is "shared".
        result = await getAllAuthorized();
        break;
      case 'SIDECAR_REMOVE_SITE_ACCOUNT':
        // Drop one account from a host's authorized set (e.g. "I don't use this
        // account here anymore"). Collapsing back to one account stops the
        // shared-identity confirms. If it was the current binding, forget that too
        // so the next login re-pairs cleanly.
        await removeAuthorizedAccount(message.host, message.pubkey);
        if ((await getSiteAccount(message.host)) === message.pubkey) {
          await clearSiteAccount(message.host);
        }
        result = true;
        break;
      case 'SIDECAR_CLEAR_BINDING':
        // Detach only the account binding (leaves the bound account's
        // permissions intact) so a re-login on that site picks a new account.
        await clearSiteAccount(message.host);
        result = true;
        break;
      // The page-invoice card asks before it appears: is this invoice simply the one
      // for a zap the user already authorized here? Jumble and other Bitcoin Connect
      // clients render a QR rather than calling window.webln, so the card — not the
      // approval prompt — is what stands between picking an amount and paying. When
      // the invoice matches a zap request signed moments ago on this same host and
      // account, for this exact amount, and the auto-zap caps allow it, there is
      // nothing left to confirm: pay it and let the card stay away.
      //
      // Peek rather than claim — payInvoiceCore does the real, single-use claim, and
      // consuming the record here would make it prompt instead.
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
        closeSwNwc(); // rebuild against the new connection on next use
        result = { ok: true };
        break;
      case 'SIDECAR_GET_NWC':
        result = { connection: await KS.getNwc(message.pubkey) };
        break;
      case 'SIDECAR_REVEAL_NWC': {
        // Export the raw connection string — always step-up PIN, even while
        // unlocked. Locked + verified PIN unlocks (see stepUpPin).
        await stepUpPin(message.pin);
        result = { connection: await KS.getNwc(message.pubkey) };
        break;
      }
      case 'SIDECAR_HAS_NWC':
        result = { has: await KS.hasNwc(message.pubkey) };
        break;
      case 'SIDECAR_CLEAR_NWC':
        await KS.clearNwc(message.pubkey);
        closeSwNwc();
        result = { ok: true };
        break;
      case 'SIDECAR_GET_BUDGETS':
        result = await BUDGETS.getAll(await KS.getActivePubkey());
        break;
      case 'SIDECAR_SET_BUDGET':
        result = await BUDGETS.setBudget(await KS.getActivePubkey(), message.host, {
          budgetSats: message.budgetSats,
          perPaymentSats: message.perPaymentSats,
        });
        break;
      case 'SIDECAR_REVOKE_BUDGET':
        result = await BUDGETS.revoke(await KS.getActivePubkey(), message.host);
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

  // ---- debug log: trace every dispatched message + its outcome/timing ----
  // Central instrumentation point — covers page RPCs, control messages, and
  // prompt/queue traffic alike. Deliberately logs only type/method/host/timing/
  // error-message, never message bodies or response payloads, so PINs, nsecs,
  // NWC strings, and signed event content never land in the log.
  if (IS_DEV_BUILD && message.type !== 'SIDECAR_GET_DEBUG_LOG' && message.type !== 'SIDECAR_CLEAR_DEBUG_LOG') {
    const t0 = Date.now();
    const rawSendResponse = sendResponse;
    sendResponse = (resp) => {
      try {
        dlog(resp && resp.ok === false ? 'error' : 'info', 'msg', message.type, {
          method: message.method, host: message.host,
          ms: Date.now() - t0,
          error: resp && resp.ok === false ? resp.error : undefined,
        });
      } catch (_) {}
      return rawSendResponse(resp);
    };
  }

  // The window the requesting page lives in — used to surface the approval on
  // the window the user is actually looking at (see driveOnce), not wherever a
  // pinned panel or the last-focused window happens to be.
  const originWindowId = sender && sender.tab && sender.tab.windowId != null ? sender.tab.windowId : undefined;

  // ---- sender gate (defense in depth) ----
  // A web page can't reach chrome.runtime messaging at all (no
  // externally_connectable), and our content script only ever forwards the types
  // in CONTENT_OK. But the keystore/wallet/owner-crypto/prompt handlers below are
  // the crown jewels, so we ALSO hard-require an extension-page origin for
  // everything a content script doesn't legitimately need — the identity check is
  // whether the sender's URL is under OUR extension origin, taken from
  // runtime.getURL (chrome-extension://<id>/ on Chrome, moz-extension://<uuid>/ on
  // Firefox — so this is correct on both). A content script carries the web page's
  // URL instead. NOT sender.tab (prompt.html and welcome.html are extension pages
  // that DO have a tab). This way no future content-script bug can pivot a hostile
  // page into signing, key reveal, decryption, unlock, or settling an approval.
  const EXT_URL_PREFIX = chrome.runtime.getURL('/');
  const fromExtPage = !!sender && (
    (typeof sender.url === 'string' && sender.url.startsWith(EXT_URL_PREFIX)) ||
    (typeof sender.origin === 'string' && sender.origin + '/' === EXT_URL_PREFIX)
  );
  // SIDECAR_TRY_ZAP_AUTOPAY belongs here for the same reason SIDECAR_PAY_PAGE_INVOICE
  // does — the page-invoice card lives in the content script — and it is strictly
  // more restrictive than that one: it pays only when auto-zap is on, the amount is
  // inside both caps, and an unconsumed zap request signed on THIS host and account
  // for THIS exact amount is waiting. A content script can't forge that record; only
  // a signature the user authorized through Sidecar creates one.
  const CONTENT_OK = new Set([
    'SIDECAR_NOSTR_RPC', 'SIDECAR_WEBLN_RPC', 'SIDECAR_PAY_PAGE_INVOICE',
    'SIDECAR_TRY_ZAP_AUTOPAY',
    'SIDECAR_IS_CONNECTED', 'SIDECAR_GET_SETTINGS', 'SIDECAR_SET_SETTINGS',
  ]);
  if (!fromExtPage && !CONTENT_OK.has(message.type)) {
    sendResponse({ ok: false, error: 'Not allowed from this context' });
    return false;
  }
  if (!fromExtPage && message.type === 'SIDECAR_SET_SETTINGS') {
    // Clamp a web-origin settings write to the pay-card toggle only — never
    // autozap, budgets, autolock, or any other setting.
    const s = message.settings || {};
    message = { type: 'SIDECAR_SET_SETTINGS', settings: 'showPayButton' in s ? { showPayButton: !!s.showPayButton } : {} };
  }
  if (!fromExtPage && message.type === 'SIDECAR_GET_SETTINGS') {
    // Clamp the read side the same way: a visited page gets the pay-card toggle
    // and nothing else. The full object would tell it the auto-lock timing (how
    // long an unattended unlocked keystore stays warm) plus budget/autozap
    // config it has no business fingerprinting.
    sget('sidecar_settings').then(({ sidecar_settings }) => {
      // Plus whether the auto-zap offer is worth showing on the payment card. This
      // reveals nothing the card doesn't already imply — if auto-zap were on and
      // covered the amount, no card would have appeared at all. The cap is a product
      // constant, not the user's configuration.
      const st = sidecar_settings || {};
      sendResponse({
        ok: true,
        result: {
          showPayButton: st.showPayButton,
          autoZapOffer: st.autoZap === true ? 0 : AUTOZAP_DEFAULT_MAX,
        },
      });
    });
    return true;
  }

  // Page RPC from content script.
  if (message.type === 'SIDECAR_NOSTR_RPC') {
    handleNostrRpc(message.method, message.params, message.host, sendResponse, originWindowId);
    return true;
  }
  if (message.type === 'SIDECAR_WEBLN_RPC') {
    handleWeblnRpc(message.method, message.params, message.host, sendResponse, originWindowId);
    return true;
  }
  // "Pay with Sidecar" pill clicked on a page.
  // Has this (trusted) host ever connected to Sidecar's signer? The content
  // script uses this to scope the "Pay with Sidecar" card to nostr clients the
  // user is actually signed into — a live invoice elsewhere is almost always noise.
  if (message.type === 'SIDECAR_IS_CONNECTED') {
    let h = '';
    try { h = new URL((sender && sender.url) || '').host; } catch (_) {}
    getSiteAccount(h)
      .then((pk) => sendResponse({ ok: true, connected: !!pk }))
      .catch(() => sendResponse({ ok: true, connected: false }));
    return true; // async response
  }

  // Is a side panel currently connected? The welcome page uses this to decide
  // whether to nudge the user to open/pin Sidecar from the toolbar.
  if (message.type === 'SIDECAR_PANEL_OPEN') {
    waitForPanelPort(300).then((port) => sendResponse({ ok: true, open: !!port }));
    return true; // async response
  }

  // Card auto-pay probe. Host comes from the sender's own URL, like the handlers
  // around it — a content script must not be able to name a different site and spend
  // against its zap approvals.
  if (message.type === 'SIDECAR_TRY_ZAP_AUTOPAY') {
    let h = '';
    try { h = new URL((sender && sender.url) || '').host; } catch (_) {}
    tryZapAutopay(message.invoice, h, originWindowId, sender && sender.tab && sender.tab.id)
      .then((r) => sendResponse({ ok: true, result: r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async response
  }

  if (message.type === 'SIDECAR_PAY_PAGE_INVOICE') {
    const tabId = sender && sender.tab && sender.tab.id;
    let host = '';
    try { host = new URL((sender && sender.url) || '').host; } catch (_) {}
    payFromPage(message.invoice, host, originWindowId, message.enableAutoZap === true)
      .then((r) => {
        notify(r.sats != null ? 'Payment sent — ' + r.sats.toLocaleString('en-US') + ' sats' : 'Payment sent');
        notifyTabPaid(tabId, message.invoice, r.preimage);
      })
      .catch((e) => {
        const m = (e && e.message) || 'Payment failed';
        notify(m);
        notifyTabPayFailed(tabId, message.invoice, m);
      });
    sendResponse({ ok: true });
    return false;
  }

  // Prompt window asking for its context, or returning a decision.
  if (message.type === 'SIDECAR_GET_PROMPT_DATA') {
    const e = queue.find((x) => x.id === message.id);
    sendResponse(e && e.data && callbacks.has(e.id)
      ? { ok: true, data: e.data }
      : { ok: false, error: 'Prompt expired' });
    return false;
  }
  if (message.type === 'SIDECAR_PROMPT_RESULT') {
    settlePrompt(message.id, message.action, message.extra);
    sendResponse({ ok: true });
    return false;
  }
  // Batch decision: apply the same action (+ account choice) to a group of
  // same-site/same-account/same-kind content signs the user approved together.
  if (message.type === 'SIDECAR_PROMPT_RESULT_BATCH') {
    for (const id of message.ids || []) settlePrompt(id, message.action, message.extra);
    sendResponse({ ok: true });
    return false;
  }
  // Active "relax approvals" windows — the panel banner queries these, and the
  // "End now" button revokes one. Extension-page only (not in CONTENT_OK).
  if (message.type === 'SIDECAR_GET_RELAX') {
    RELAX.active().then((result) => sendResponse({ ok: true, result }));
    return true; // async response
  }
  // The panel seeds an overwrite baseline from a version it fetched off relays, so a
  // fresh install isn't blind until its first sign of that kind. recordIfNewer means a
  // late-arriving older relay copy can't clobber what Sidecar itself just signed.
  // Extension-page only (not in CONTENT_OK) — a page must never write these.
  if (message.type === 'SIDECAR_SEED_BASELINE') {
    BASELINE.recordIfNewer(message.pubkey, message.event, (message.event && message.event.created_at) || 0)
      .then((updated) => sendResponse({ ok: true, result: updated }))
      .catch(() => sendResponse({ ok: true, result: false }));
    return true; // async response
  }
  if (message.type === 'SIDECAR_REVOKE_RELAX') {
    RELAX.revoke(message.host, message.pubkey).then(() => { syncRelaxBadge(); sendResponse({ ok: true }); });
    return true; // async response
  }
  // Observable-queue queries/actions (see the approval-queue section up top).
  if (message.type === 'SIDECAR_GET_PENDING') {
    sendResponse({ ok: true, result: pendingView() });
    return false;
  }
  if (message.type === 'SIDECAR_REJECT_ALL_PENDING') {
    for (const e of [...queue]) {
      if (e.state === 'interrupted') continue;
      if (callbacks.has(e.id)) settlePrompt(e.id, 'reject');
      else { const i = queue.indexOf(e); if (i >= 0) queue.splice(i, 1); }
    }
    closePopupWindow();
    qPersist(); broadcastQueue(); stopKeepaliveIfIdle();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'SIDECAR_DISMISS_INTERRUPTED') {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].state === 'interrupted') queue.splice(i, 1);
    qPersist(); broadcastQueue();
    sendResponse({ ok: true });
    return false;
  }
  // Dev bug button's debug panel — reads the in-memory trace log. Gated to
  // extension pages only (not in CONTENT_OK above), and IS_DEV_BUILD means
  // debugLog is always empty on a Web Store install anyway.
  if (message.type === 'SIDECAR_GET_DEBUG_LOG') {
    sendResponse({ ok: true, result: debugLog });
    return false;
  }
  if (message.type === 'SIDECAR_CLEAR_DEBUG_LOG') {
    debugLog.length = 0;
    sendResponse({ ok: true, result: [] });
    return false;
  }

  // Everything else is a keystore/config control message.
  handleControl(message, sendResponse);
  return true;
});
