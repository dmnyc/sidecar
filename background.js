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
// Approval / unlock prompt orchestration
// ============================================================================
const pendingPrompts = new Map(); // promptId -> { resolve, windowId, data, settled }
let promptMutex = Promise.resolve(); // serialize prompts so only one window is open
let popupWindowId = null;  // the reusable prompt popup window
let popupPending = 0;      // count of unsettled popup-bound prompts

// The side panel keeps a long-lived port open while it's visible. When it's open
// we render approvals inline in the panel (it can't get lost behind a window);
// when it's closed we fall back to the popup window below — Chrome only lets us
// open the side panel from a user gesture, so the worker can't force it open.
let panelPort = null;
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  port.onDisconnect.addListener(() => {
    if (panelPort === port) panelPort = null;
    // Closing the panel mid-approval would otherwise leave the page hanging;
    // reject any inline (windowless) prompts that were awaiting a decision.
    for (const [id, p] of pendingPrompts) {
      if (p.windowId == null && !p.settled) {
        p.settled = true;
        pendingPrompts.delete(id);
        p.resolve({ action: 'reject' });
      }
    }
  });
});

// A page RPC can wake a fresh worker before the open side panel has reconnected
// its port to this instance. Without waiting, panelPort is null and we'd wrongly
// open a popup while the panel is sitting right there. Give the panel a brief
// moment to (re)connect; if it's genuinely closed, nothing connects and we
// fall through to the popup.
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

function openPrompt(data) {
  // Chain onto the mutex: each prompt waits for the previous to finish.
  const run = () =>
    new Promise(async (resolve) => {
      // Re-evaluate the lock at execution time. Prompts are serialized, so an
      // earlier one in the queue may have already unlocked the keystore — the
      // classic browser-restart case where several signed-in apps each fire a
      // request at once and would otherwise each demand the PIN. Once unlocked,
      // collapse the now-redundant unlock prompts: a pure unlock just proceeds,
      // and an approval still shows but without asking for the PIN again.
      if (data && data.needUnlock && !KS.isLocked()) {
        data.needUnlock = false;
        if (!data.needApproval) return resolve({ action: 'once' });
      }

      const promptId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2);

      // Panel open → render inline; the panel decides via SIDECAR_PROMPT_RESULT.
      const port = await waitForPanelPort(600);
      if (port) {
        pendingPrompts.set(promptId, { resolve, windowId: null, data, settled: false });
        try {
          port.postMessage({ type: 'SIDECAR_PANEL_APPROVAL', id: promptId, data });
          return;
        } catch (_) {
          // Port died between the check and post; fall through to the popup.
          pendingPrompts.delete(promptId);
          panelPort = null;
        }
      }

      const promptUrl = chrome.runtime.getURL('prompt.html?id=' + promptId);

      function openInNewWindow() {
        const W = 440, H = 600;
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
            { url: promptUrl, type: 'popup', width: W, height: H, left, top, focused: true },
            (win) => {
              popupWindowId = win ? win.id : null;
              popupPending++;
              pendingPrompts.set(promptId, { resolve, windowId: popupWindowId, data, settled: false });
            }
          );
        });
      }

      // Reuse the existing popup window when possible — navigate its tab to the
      // new prompt URL instead of spawning another window.
      if (popupWindowId != null) {
        chrome.windows.get(popupWindowId, { populate: true }, (win) => {
          const tab = win && win.tabs && win.tabs[0];
          if (!chrome.runtime.lastError && tab) {
            popupPending++;
            pendingPrompts.set(promptId, { resolve, windowId: popupWindowId, data, settled: false });
            chrome.tabs.update(tab.id, { url: promptUrl });
            chrome.windows.update(popupWindowId, { focused: true });
          } else {
            popupWindowId = null;
            openInNewWindow();
          }
        });
      } else {
        openInNewWindow();
      }
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
  if (windowId === popupWindowId) {
    popupWindowId = null;
    popupPending = 0;
  }
  for (const [id, p] of pendingPrompts) {
    if (p.windowId === windowId && !p.settled) {
      p.settled = true;
      pendingPrompts.delete(id);
      p.resolve({ action: 'reject' });
    }
  }
});

function settlePrompt(promptId, action, extra) {
  const p = pendingPrompts.get(promptId);
  if (!p || p.settled) return;
  p.settled = true;
  pendingPrompts.delete(promptId);
  if (p.windowId != null) {
    popupPending--;
    if (popupPending <= 0) {
      popupPending = 0;
      chrome.windows.remove(p.windowId).catch(() => {});
      popupWindowId = null;
    }
    // else: leave window alive — run() for the next queued prompt will navigate it
  }
  p.resolve(Object.assign({ action }, extra || {}));
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

    // The identity this host signs as — pinned to whatever it logged in with,
    // independent of the globally-active account (prevents NIP-07 desync).
    const activePubkey = await resolveSiteAccount(host);
    if (!activePubkey) throw new Error('No active Sidecar account');

    const status = await PERMS.getPermissionStatus(activePubkey, host, method); // allow | reject | ask
    if (status === 'reject') throw new Error('This site is blocked in Sidecar');

    // NIP-42 relay auth (kind 22242) is an automatic, ephemeral connection-auth
    // event that relays request frequently; an interactive prompt for it
    // guarantees client-side timeouts ("Signer did not respond in time"). Treat
    // it as pre-approved for any non-blocked site — only an unlock can gate it.
    // But the exemption is a silent signing oracle if abused, so we only skip the
    // prompt when the event is a *well-formed* auth event (see isNip42AuthEvent):
    // relay + challenge tags only, near-current timestamp, no arbitrary payload.
    // Anything else falls back to the normal approval prompt.
    let signKind = null;
    let signEvent = null;
    if (method === 'signEvent') {
      signEvent = params && (params.event || params);
      signKind = signEvent && signEvent.kind;
    }
    const isRelayAuth = method === 'signEvent' && isNip42AuthEvent(signEvent);

    const needsKey = SIGNER.needsPrivateKey(method);
    const needUnlock = needsKey && KS.isLocked();
    const needApproval = status === 'ask' && !isRelayAuth;

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
        accountPicture: (acct && acct.picture) || '',
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
  if (fails < 5) return 0;                    // first 5 tries: no wait (fat-finger grace)
  return Math.min(60000, (fails - 4) * 5000); // then 5s, 10s, … capped at 60s
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
    const p = pendingPrompts.get(message.id);
    sendResponse(p ? { ok: true, data: p.data } : { ok: false, error: 'Prompt expired' });
    return false;
  }
  if (message.type === 'SIDECAR_PROMPT_RESULT') {
    settlePrompt(message.id, message.action, message.extra);
    sendResponse({ ok: true });
    return false;
  }

  // Everything else is a keystore/config control message.
  handleControl(message, sendResponse);
  return true;
});
