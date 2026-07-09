// Sidecar service worker — NIP-07 signer backend.
//
// Loads the crypto/keystore/permissions/signer modules and routes:
//   1. Page RPCs (window.nostr.* from a web page, via content.js) — gated by per-host
//      permission and the keystore lock; opens an approval/unlock popup when needed.
//   2. Side-panel & prompt control messages (init/unlock/lock/account management, etc.).
//
// Decrypted private keys live only in the keystore's in-memory map here. If this worker
// is killed (MV3 ~30s idle), that map is gone and the keystore re-locks — a feature.

importScripts('nostr-tools.js', 'crypto.js', 'keystore.js', 'permissions.js', 'signer.js', 'wallet-budgets.js', 'nwc-client.js');

const KS = self.SidecarKeystore;
const PERMS = self.SidecarPermissions;
const SIGNER = self.SidecarSigner;
const BUDGETS = self.SidecarBudgets;
const NWC = self.SidecarNWC;

const DEFAULT_RELAYS = {
  'wss://nos.lol': { read: true, write: true },
  'wss://relay.snort.social': { read: true, write: true },
  'wss://nostr.mom': { read: true, write: true },
  'wss://offchain.pub': { read: true, write: true },
  'wss://relay.primal.net': { read: true, write: false },
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

// ---- side panel open on toolbar click ----
chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  createPayMenu();
  if (details.reason === 'install') {
    chrome.storage.local.remove('firstPostTipDismissed');
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
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
let graceTimer = null;          // panel-disconnect grace before falling back to a popup
const REQUEST_TTL = 175000;     // < content.js's 180s page timeout, so we never surface a dead request
const TOMBSTONE_TTL = 600000;   // interrupted tombstones self-clear after 10 min
const QUEUE_SESSION_KEY = 'sidecar_prompt_queue';
const QUEUE_KEEPALIVE_ALARM = 'sidecar-queue-keepalive';

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
function ensureKeepalive() {
  if (keepaliveOn) return;
  keepaliveOn = true;
  chrome.alarms.create(QUEUE_KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
}
function stopKeepaliveIfIdle() {
  if (liveEntries().length) return;
  if (!keepaliveOn) return;
  keepaliveOn = false;
  chrome.alarms.clear(QUEUE_KEEPALIVE_ALARM);
}

// ---- panel port lifecycle ----
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  clearTimeout(graceTimer);
  driveDisplay(); // re-surface anything waiting for a panel
  port.onDisconnect.addListener(() => {
    if (panelPort !== port) return;
    panelPort = null;
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
function openPrompt(data) {
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
    });
    callbacks.set(id, { resolve, settled: false });
    ensureKeepalive();
    qPersist();
    broadcastQueue();
    driveDisplay();
  });
}

// ---- popup window helpers ----
function closePopupWindow() {
  if (popupWindowId == null) return;
  const wid = popupWindowId;
  popupWindowId = null;
  chrome.windows.remove(wid).catch(() => {});
}
function createPopup(url) {
  return new Promise((resolve) => {
    const W = 440, H = 660;
    chrome.windows.getCurrent((cur) => {
      const left = cur && cur.left != null && cur.width != null ? Math.round(cur.left + (cur.width - W) / 2) : undefined;
      const top = cur && cur.top != null && cur.height != null ? Math.round(cur.top + (cur.height - H) / 3) : undefined;
      chrome.windows.create({ url, type: 'popup', width: W, height: H, left, top, focused: true }, (win) => {
        popupWindowId = win ? win.id : null;
        resolve();
      });
    });
  });
}
function navigatePopup(url) {
  return new Promise((resolve) => {
    chrome.windows.get(popupWindowId, { populate: true }, (win) => {
      const tab = win && win.tabs && win.tabs[0];
      if (chrome.runtime.lastError || !tab) return resolve(false);
      chrome.tabs.update(tab.id, { url });
      chrome.windows.update(popupWindowId, { focused: true });
      resolve(true);
    });
  });
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
  // panel came back while an entry sits in a popup (hand it off to the panel).
  const showing = queue.find((e) => e.state === 'showing');
  if (showing) {
    if (showing.display === 'panel' && !panelPort) { showing.state = 'queued'; showing.display = 'none'; }
    else if (showing.display === 'popup' && panelPort) {
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

  // Choose a surface. Prefer the panel; briefly wait for a reconnecting panel
  // before falling back to a popup.
  let port = panelPort || (await waitForPanelPort(600));
  if (port) {
    head.state = 'showing'; head.display = 'panel';
    qPersist(); broadcastQueue();
  } else {
    head.state = 'showing'; head.display = 'popup';
    qPersist();
    const url = chrome.runtime.getURL('prompt.html?id=' + head.id);
    if (popupWindowId != null) { if (!(await navigatePopup(url))) { popupWindowId = null; await createPopup(url); } }
    else await createPopup(url);
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
  cb.settled = true;
  callbacks.delete(id);
  const i = queue.findIndex((e) => e.id === id);
  if (i >= 0) queue.splice(i, 1);
  qPersist();
  cb.resolve(Object.assign({ action }, extra || {}));
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

async function handleNostrRpc(method, params, host, sendResponse) {
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
    // A shared-identity content sign always confirms, regardless of trust tier —
    // unless it's a coalesced app-data sign the user just approved.
    const needApproval =
      coalesced || appDataAutoAllow ? false : ((status === 'ask' && !isRelayAuth) || sharedIdentity);

    // Every getPublicKey is a login, and a login is the safe moment to pick an
    // identity: whatever pubkey we return is the identity the site adopts from
    // here on, so offering the account switcher in the prompt can't desync
    // anything. A shared-identity content sign also offers the switcher — scoped
    // to the accounts that have actually logged into this host. Other session
    // methods never offer it: their identity is fixed by the binding.
    const canOfferAccountSwitch = method === 'getPublicKey' || sharedIdentity;

    // Once unlocked, signing only needs site approval — no PIN re-entry.
    if (needApproval || needUnlock) {
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
      const decision = await openPrompt({
        host,
        method,
        params,
        activePubkey,
        npub: self.NostrTools.nip19.npubEncode(activePubkey),
        accountName: (acct && acct.name) || '',
        accountPicture: (acct && acct.picture) || '',
        needUnlock,
        needApproval,
        sharedIdentity,
        level: await PERMS.getLevel(activePubkey, host),
        otherAccounts: otherAccounts && otherAccounts.length ? otherAccounts : null,
      });
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
      await setSiteAccount(host, activePubkey);
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
async function weblnUnlockGate(host, method, pubkey) {
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
  });
  if (decision.action === 'reject') throw new Error('You rejected this request');
  if (KS.isLocked()) throw new Error('Keystore is locked');
}

async function handleWeblnRpc(method, params, host, sendResponse) {
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
      await weblnUnlockGate(host, method, pubkey);
      const c = await getSwNwc(pubkey);
      const info = (await c.getInfo()) || {};
      result = {
        node: { alias: info.alias || 'Sidecar wallet', pubkey: info.pubkey || '', color: info.color || '' },
        methods: ['getInfo', 'makeInvoice', 'sendPayment', 'getBalance'],
        supports: ['lightning'],
      };
    } else if (method === 'getBalance') {
      await weblnUnlockGate(host, method, pubkey);
      const c = await getSwNwc(pubkey);
      const b = await c.getBalance();
      result = { balance: msatToSat(b && b.balance), currency: 'sats' };
    } else if (method === 'makeInvoice') {
      await weblnUnlockGate(host, method, pubkey);
      const c = await getSwNwc(pubkey);
      const sats = parseInt(params && params.amount, 10);
      if (!sats || sats < 1) throw new Error('A positive amount is required to make an invoice');
      const res = await c.makeInvoice(sats * 1000, (params && params.memo) || '');
      const invoice = res && (res.invoice || res.payment_request || res.bolt11);
      if (!invoice) throw new Error('Wallet returned no invoice');
      result = { paymentRequest: invoice };
    } else if (method === 'sendPayment') {
      result = await weblnSendPayment(params, host, pubkey);
    } else {
      throw new Error('Sidecar does not support webln.' + method);
    }

    await setSiteAccount(host, pubkey);
    sendResponse({ ok: true, result });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

async function weblnSendPayment(params, host, pubkey) {
  const invoice = (params && (params.paymentRequest || params.invoice)) || '';
  return payInvoiceCore(invoice, host, pubkey, params && params.memo);
}

// Decode just the BOLT11 description ('d', tag 13) — bech32, no deps. A zap
// invoice carries the NIP-57 zap request (kind 9734) JSON there, which is how we
// tell a genuine zap apart from any other payment for the auto-approve setting.
const BECH32_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bolt11Description(invoice) {
  try {
    const s = String(invoice).toLowerCase();
    const sep = s.lastIndexOf('1');
    if (sep < 1) return '';
    const words = [];
    for (const c of s.slice(sep + 1)) {
      const v = BECH32_CHARS.indexOf(c);
      if (v < 0) return '';
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
      if (tag === 13) {
        let acc = 0, bits = 0;
        const bytes = [];
        for (let k = start; k < start + len; k++) {
          acc = (acc << 5) | body[k];
          bits += 5;
          if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
        }
        return new TextDecoder().decode(new Uint8Array(bytes));
      }
      i = start + len;
    }
  } catch (_) {}
  return '';
}
function isZapInvoice(invoice) {
  const desc = bolt11Description(invoice);
  if (!desc || desc[0] !== '{') return false;
  try {
    const ev = JSON.parse(desc);
    return !!ev && ev.kind === 9734;
  } catch (_) {
    return false;
  }
}

// Shared payment core: budget-gate (prompt if needed), pay via NWC, decrement
// budget, log, and notify the panel. Used by window.webln.sendPayment AND the
// "Pay with Sidecar" context menu. Assumes the caller resolved `pubkey` and
// checked the account/site is usable.
async function payInvoiceCore(invoiceRaw, host, pubkey, memo) {
  const invoice = String(invoiceRaw || '').replace(/^lightning:/i, '').trim();
  if (!invoice) throw new Error('No invoice provided');
  if (!/^ln(bc|tb)[0-9]/i.test(invoice)) throw new Error('Not a BOLT11 Lightning invoice');
  const sats = invoiceSats(invoice);

  // Pay without a prompt when unlocked and either the site's budget covers a known
  // amount, or "auto-approve zaps" is on and this is a genuine zap within the limit.
  const settings = (await sget('sidecar_settings')).sidecar_settings || {};
  const unlocked = !KS.isLocked() && sats != null;
  const budgetOk = unlocked && (await BUDGETS.covers(pubkey, host, sats));
  const zapMax = settings.autoZap === true ? Number(settings.autoZapMaxSats) || 0 : 0;
  const zapOk = unlocked && zapMax > 0 && sats <= zapMax && isZapInvoice(invoice);
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
    });
    if (decision.action === 'reject') throw new Error('You rejected this payment');
    if (KS.isLocked()) throw new Error('Keystore is locked');
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
  const res = await c.payInvoice(invoice);
  const preimage = res && (res.preimage || res.payment_preimage);

  // Decrement the budget by the paid amount (known amount only).
  if (sats != null) await BUDGETS.consume(pubkey, host, sats);

  await setSiteAccount(host, pubkey);
  logActivity({ ts: Date.now(), host, method: 'webln.sendPayment', amountSats: sats, pubkey });
  // Tell an open side panel to refresh its balance/history.
  chrome.runtime.sendMessage({ type: 'SIDECAR_EVENT', event: 'walletChanged' }).catch(() => {});
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
function notifyTabPaid(tabId, invoice) {
  if (tabId != null && chrome.tabs) {
    chrome.tabs.sendMessage(tabId, { type: 'SIDECAR_EVENT', event: 'paid', invoice }, () => void chrome.runtime.lastError);
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
async function payFromPage(invoiceRaw, host) {
  await KS.ensureLoaded();
  if (!(await KS.isInitialized())) throw new Error('Sidecar has no accounts set up yet');
  const pubkey = await resolveSiteAccount(host);
  if (!pubkey) throw new Error('No active Sidecar account');
  if ((await PERMS.getLevel(pubkey, host)) === 'blocked') throw new Error('This site is blocked in Sidecar');
  if (!(await KS.hasNwc(pubkey))) throw new Error('No wallet connected in Sidecar');
  return payInvoiceCore(invoiceRaw, host, pubkey);
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
  if (!jsqrReady) { importScripts('jsqr.js'); jsqrReady = true; }
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
  chrome.contextMenus.removeAll(() => {
    // Only on lightning: links (not every link), on any text selection, and on
    // QR images. (Canvas/SVG QRs have no image context — a later pass.)
    chrome.contextMenus.create({ id: 'sidecar-pay-link', title: 'Pay this invoice with Sidecar', contexts: ['link'], targetUrlPatterns: ['lightning:*'] });
    chrome.contextMenus.create({ id: 'sidecar-pay-selection', title: 'Pay Lightning invoice with Sidecar', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'sidecar-pay-qr', title: 'Pay QR code with Sidecar', contexts: ['image'] });
  });
}
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(createPayMenu);

chrome.contextMenus &&
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    let host = '';
    try { host = new URL(info.pageUrl || (tab && tab.url) || '').host; } catch (_) {}
    const pay = (getInvoice) =>
      Promise.resolve(getInvoice)
        .then((inv) => payFromPage(inv, host).then((r) => ({ r, inv })))
        .then(({ r, inv }) => {
          notify(r.sats != null ? 'Payment sent — ' + r.sats.toLocaleString('en-US') + ' sats' : 'Payment sent');
          notifyTabPaid(tab && tab.id, inv);
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

async function lockKeystore() {
  await KS.lock();
  SIGNER.clearCache();
  closeSwNwc();
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
  // Best-effort heartbeat while the approval queue is non-empty: sweeps expired
  // requests and re-drives the display so nothing stalls if the SW was napping.
  else if (alarm.name === QUEUE_KEEPALIVE_ALARM) driveDisplay();
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
        // Push the pay-pill setting to content scripts so it toggles live.
        if (chrome.tabs) {
          chrome.tabs.query({}, (tabs) => {
            for (const t of tabs) {
              if (t.id != null) {
                chrome.tabs.sendMessage(
                  t.id,
                  { type: 'SIDECAR_EVENT', event: 'settings', showPayButton: merged.showPayButton },
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
        // Export the raw connection string — always step-up PIN, even while unlocked.
        if (KS.isLocked()) throw new Error('Keystore is locked');
        if (!(await KS.verifyPin(message.pin))) throw new Error('Incorrect PIN');
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

  // Page RPC from content script.
  if (message.type === 'SIDECAR_NOSTR_RPC') {
    handleNostrRpc(message.method, message.params, message.host, sendResponse);
    return true;
  }
  if (message.type === 'SIDECAR_WEBLN_RPC') {
    handleWeblnRpc(message.method, message.params, message.host, sendResponse);
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

  if (message.type === 'SIDECAR_PAY_PAGE_INVOICE') {
    const tabId = sender && sender.tab && sender.tab.id;
    let host = '';
    try { host = new URL((sender && sender.url) || '').host; } catch (_) {}
    payFromPage(message.invoice, host)
      .then((r) => {
        notify(r.sats != null ? 'Payment sent — ' + r.sats.toLocaleString('en-US') + ' sats' : 'Payment sent');
        notifyTabPaid(tabId, message.invoice);
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

  // Everything else is a keystore/config control message.
  handleControl(message, sendResponse);
  return true;
});
