// Sidecar keystore — multi-account encrypted nostr key storage.
//
// Runs in the service worker (loaded via importScripts after nostr-tools.js and
// crypto.js). Owns the persistent encrypted records in chrome.storage.local AND the
// in-memory map of decrypted private keys that exists only while unlocked. Decrypted
// keys never touch disk; they are wiped on lock / browser restart / SW death.
//
// Storage layout:
//   sidecar_keystore = {
//     version, kdf:{name,hash,iterations,salt},
//     accounts: { <pubkeyHex>: { pubkey, label, enc:{iv,ct}, createdAt } },
//     verifier: { iv, ct }              // AES-GCM of a known constant (PIN check)
//   }
//   sidecar_active_pubkey = <pubkeyHex>

(function (root) {
  'use strict';

  const C = root.SidecarCrypto;
  const STORE_KEY = 'sidecar_keystore';
  const ACTIVE_KEY = 'sidecar_active_pubkey';

  // Minimum PIN/passphrase length. The panel enforces this in the UI, but we also
  // check here so the trusted context never wraps keys under a trivially weak
  // secret regardless of how the request arrived.
  const MIN_PIN_LENGTH = 8;
  function assertPinStrength(pin) {
    if (typeof pin !== 'string' || pin.length < MIN_PIN_LENGTH) {
      throw new Error(`PIN must be at least ${MIN_PIN_LENGTH} characters`);
    }
  }

  // ---- in-memory unlocked state (module scope; gone when SW is killed) ----
  let derivedKey = null;                 // non-extractable AES-GCM CryptoKey, held while unlocked
  let unlocked = new Map();              // pubkeyHex -> Uint8Array(32) private key

  // ---- promisified chrome.storage.local ----
  function get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function set(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  // chrome.storage.session is in-memory (never written to disk) and cleared when the
  // browser closes — but it SURVIVES service-worker eviction. We stash the exported
  // derived key here so the keystore stays unlocked across SW restarts.
  const SESSION_KEY = 'sidecar_session';
  function sessGet() {
    return new Promise((resolve) => chrome.storage.session.get(SESSION_KEY, (r) => resolve(r[SESSION_KEY])));
  }
  function sessSet(value) {
    return new Promise((resolve) => chrome.storage.session.set({ [SESSION_KEY]: value }, resolve));
  }
  function sessClear() {
    return new Promise((resolve) => chrome.storage.session.remove(SESSION_KEY, resolve));
  }

  async function persistSession(key) {
    await sessSet({ k: await C.exportKeyRaw(key) });
  }

  // Rebuild the in-memory unlocked state from storage.session after a SW restart.
  // No-op if already loaded in this worker, or if there's no live session (locked).
  async function ensureLoaded() {
    if (derivedKey) return;
    const sess = await sessGet();
    if (!sess || !sess.k) return;
    const store = await loadStore();
    if (!store) return;
    const key = await C.importKeyRaw(sess.k);
    if (!(await C.checkVerifier(key, store.verifier))) {
      await sessClear();
      return;
    }
    const map = new Map();
    for (const acct of Object.values(store.accounts)) {
      map.set(acct.pubkey, await C.decryptBytes(key, acct.enc));
    }
    derivedKey = key;
    unlocked = map;
  }

  // ---- hex helpers ----
  function bytesToHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }
  function hexToBytes(hex) {
    if (hex.length % 2) throw new Error('invalid hex');
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function pubkeyOf(privBytes) {
    return root.NostrTools.getPublicKey(privBytes);
  }

  // Decode an nsec (NIP-19) or 64-char hex string into 32 private-key bytes.
  function decodeSecret(input) {
    const s = (input || '').trim();
    if (s.startsWith('nsec')) {
      const decoded = root.NostrTools.nip19.decode(s);
      if (decoded.type !== 'nsec') throw new Error('Not an nsec key');
      return decoded.data instanceof Uint8Array ? decoded.data : hexToBytes(decoded.data);
    }
    if (/^[0-9a-fA-F]{64}$/.test(s)) return hexToBytes(s.toLowerCase());
    throw new Error('Enter a valid nsec or 64-character hex private key');
  }

  async function loadStore() {
    return (await get(STORE_KEY))[STORE_KEY] || null;
  }

  // ---- public API ----

  async function isInitialized() {
    return (await loadStore()) !== null;
  }

  function isLocked() {
    return derivedKey === null;
  }

  // Safe metadata for the UI — works locked or unlocked, never exposes secrets.
  async function getState() {
    const store = await loadStore();
    const active = (await get(ACTIVE_KEY))[ACTIVE_KEY] || null;
    if (store) {
      let dirty = false;
      for (const a of Object.values(store.accounts)) {
        if (!a.name) { a.name = randomName(); a.placeholderName = true; dirty = true; }
      }
      if (dirty) await set({ [STORE_KEY]: store });
    }
    const order = store && store.order ? store.order : (store ? Object.keys(store.accounts) : []);
    const sorted = store
      ? order.filter(pk => store.accounts[pk]).concat(
          Object.keys(store.accounts).filter(pk => !order.includes(pk))
        )
      : [];
    const accounts = sorted.map((pk) => {
      const a = store.accounts[pk];
      return {
        pubkey: a.pubkey,
        npub: root.NostrTools.nip19.npubEncode(a.pubkey),
        name: a.name || '',
        picture: a.picture || '',
        placeholderName: !!a.placeholderName,
        createdAt: a.createdAt,
      };
    });
    return {
      initialized: store !== null,
      locked: isLocked(),
      activePubkey: active,
      accounts,
    };
  }

  // Create a brand-new keystore protected by `pin`. Leaves it unlocked (empty).
  async function initialize(pin) {
    if (await isInitialized()) throw new Error('Keystore already initialized');
    assertPinStrength(pin);
    const kdf = C.newKdf();
    derivedKey = await C.deriveKey(pin, kdf);
    const store = {
      version: 1,
      kdf,
      accounts: {},
      verifier: await C.makeVerifier(derivedKey),
    };
    await set({ [STORE_KEY]: store });
    unlocked = new Map();
    await persistSession(derivedKey);
    return getState();
  }

  // Derive the key from `pin`, verify it, and decrypt every account into memory.
  async function unlock(pin) {
    const store = await loadStore();
    if (!store) throw new Error('Keystore not initialized');
    const key = await C.deriveKey(pin, store.kdf);
    if (!(await C.checkVerifier(key, store.verifier))) {
      throw new Error('Incorrect PIN');
    }
    const map = new Map();
    for (const acct of Object.values(store.accounts)) {
      map.set(acct.pubkey, await C.decryptBytes(key, acct.enc));
    }
    derivedKey = key;
    unlocked = map;
    await persistSession(key);
    return getState();
  }

  async function lock() {
    for (const bytes of unlocked.values()) C.wipe(bytes);
    unlocked.clear();
    derivedKey = null;
    await sessClear();
  }

  // Verify a PIN without changing lock state — used to "step up" before sensitive
  // operations (reveal nsec / NWC string, publish profile changes).
  async function verifyPin(pin) {
    const store = await loadStore();
    if (!store) return false;
    const key = await C.deriveKey(pin, store.kdf);
    return C.checkVerifier(key, store.verifier);
  }

  function requireUnlocked() {
    if (isLocked()) throw new Error('Keystore is locked');
  }

  // Add an account from raw private-key bytes. Sets it active if it's the first.
  // name/picture default empty — they're populated from the account's kind:0 profile.
  async function addAccountFromBytes(privBytes, name) {
    requireUnlocked();
    if (!(privBytes instanceof Uint8Array) || privBytes.length !== 32) {
      throw new Error('Private key must be 32 bytes');
    }
    const pubkey = pubkeyOf(privBytes);
    const store = await loadStore();
    if (store.accounts[pubkey]) {
      C.wipe(privBytes);
      throw new Error('Account already exists');
    }
    store.accounts[pubkey] = {
      pubkey,
      name: name || '',
      picture: '',
      enc: await C.encryptBytes(derivedKey, privBytes),
      createdAt: Date.now(),
    };
    if (!store.order) store.order = Object.keys(store.accounts).filter(pk => pk !== pubkey);
    store.order.push(pubkey);
    await set({ [STORE_KEY]: store });
    unlocked.set(pubkey, privBytes);
    const wasEmpty = Object.keys(store.accounts).length === 1;
    if (wasEmpty) await set({ [ACTIVE_KEY]: pubkey });
    return { pubkey, npub: root.NostrTools.nip19.npubEncode(pubkey) };
  }

  async function importSecret(nsecOrHex, label) {
    return addAccountFromBytes(decodeSecret(nsecOrHex), label);
  }

  // Friendly default name for a fresh key — drinks you'd order at a fancy bar.
  const COCKTAILS = ['Negroni', 'Martini', 'Manhattan', 'Boulevardier', 'Sidecar', 'Daiquiri',
    'Margarita', 'Sazerac', 'Aviation', 'Gimlet', 'Cosmopolitan', 'Vesper', 'Bellini', 'Mojito',
    'Paloma', 'Spritz', 'Mule', 'Sour', 'Highball', 'Collins', 'Julep', 'Cobbler', 'Americano',
    'Bramble', 'Gibson', 'Stinger', 'Hurricane', 'Gascogne', 'Martinez', 'Bijou'];
  const ADJECTIVES = ['Velvet', 'Smoky', 'Golden', 'Midnight', 'Gilded', 'Bitter', 'Spiced',
    'Twilight', 'Crimson', 'Amber', 'Dry', 'Vintage', 'Frosted', 'Burnt', 'Silken', 'Oaked',
    'Sparkling', 'Top-Shelf', 'Neat', 'Mahogany', 'Botanical', 'Barrel-Aged', 'Hush', 'Last-Call'];
  function randomName() {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    return pick(ADJECTIVES) + ' ' + pick(COCKTAILS);
  }

  // Generate a fresh account with a default cocktail name. Returns the nsec ONCE so the
  // panel can prompt the user to back it up immediately after creation.
  async function generateAccount(providedName) {
    const sk = root.NostrTools.generateSecretKey();
    const name = providedName || randomName();
    const nsec = root.NostrTools.nip19.nsecEncode(sk);
    const res = await addAccountFromBytes(sk, name);
    return { pubkey: res.pubkey, npub: res.npub, name, nsec };
  }

  async function removeAccount(pubkey) {
    const store = await loadStore();
    if (!store || !store.accounts[pubkey]) throw new Error('No such account');
    delete store.accounts[pubkey];
    if (store.order) store.order = store.order.filter(pk => pk !== pubkey);
    await set({ [STORE_KEY]: store });
    const bytes = unlocked.get(pubkey);
    if (bytes) C.wipe(bytes);
    unlocked.delete(pubkey);
    // Drop the account's encrypted NWC connection too.
    const nwc = await loadNwcStore();
    if (nwc[pubkey]) { delete nwc[pubkey]; await set({ [NWC_KEY]: nwc }); }
    // Reassign active if we just removed it.
    const active = (await get(ACTIVE_KEY))[ACTIVE_KEY] || null;
    if (active === pubkey) {
      const next = Object.keys(store.accounts)[0] || null;
      await set({ [ACTIVE_KEY]: next });
    }
    return getState();
  }

  async function reorderAccounts(pubkeys) {
    const store = await loadStore();
    if (!store) throw new Error('Keystore not initialized');
    store.order = pubkeys.filter(pk => store.accounts[pk]);
    await set({ [STORE_KEY]: store });
    return getState();
  }

  async function renameAccount(pubkey, name) {
    const store = await loadStore();
    if (!store || !store.accounts[pubkey]) throw new Error('No such account');
    store.accounts[pubkey].name = name;
    await set({ [STORE_KEY]: store });
    return getState();
  }

  // Cache public profile fields (name/picture) pulled from the account's kind:0 event.
  async function setProfile(pubkey, profile) {
    const store = await loadStore();
    if (!store || !store.accounts[pubkey]) throw new Error('No such account');
    if (profile.name != null && profile.name !== '') {
      store.accounts[pubkey].name = profile.name;
      store.accounts[pubkey].placeholderName = false;
    }
    if (profile.picture != null) store.accounts[pubkey].picture = profile.picture;
    await set({ [STORE_KEY]: store });
    return getState();
  }

  async function setActive(pubkey) {
    const store = await loadStore();
    if (!store || !store.accounts[pubkey]) throw new Error('No such account');
    await set({ [ACTIVE_KEY]: pubkey });
    return getState();
  }

  async function getActivePubkey() {
    return (await get(ACTIVE_KEY))[ACTIVE_KEY] || null;
  }

  // Does this pubkey still correspond to a stored account?
  async function hasAccount(pubkey) {
    if (!pubkey) return false;
    const store = await loadStore();
    return !!(store && store.accounts[pubkey]);
  }

  // ---- NWC connection strings (per account, encrypted at rest like the nsec) ----
  // The connection string embeds a spendable secret, so it is wrapped with the
  // same derived key and only ever decrypted in memory while unlocked.
  const NWC_KEY = 'sidecar_nwc_connections';

  async function loadNwcStore() {
    return (await get(NWC_KEY))[NWC_KEY] || {};
  }
  async function setNwc(pubkey, connectionString) {
    requireUnlocked();
    const pk = pubkey || (await getActivePubkey());
    if (!pk) throw new Error('No active account');
    const all = await loadNwcStore();
    all[pk] = await C.encryptString(derivedKey, connectionString);
    await set({ [NWC_KEY]: all });
  }
  async function getNwc(pubkey) {
    requireUnlocked();
    const pk = pubkey || (await getActivePubkey());
    const all = await loadNwcStore();
    if (!all[pk]) return null;
    return C.decryptString(derivedKey, all[pk]);
  }
  async function hasNwc(pubkey) {
    const pk = pubkey || (await getActivePubkey());
    const all = await loadNwcStore();
    return !!all[pk];
  }
  async function clearNwc(pubkey) {
    const pk = pubkey || (await getActivePubkey());
    const all = await loadNwcStore();
    delete all[pk];
    await set({ [NWC_KEY]: all });
  }

  // Return decrypted private-key bytes for signing. Defaults to the active account.
  async function getPrivkey(pubkey) {
    requireUnlocked();
    const pk = pubkey || (await getActivePubkey());
    if (!pk) throw new Error('No active account');
    const bytes = unlocked.get(pk);
    if (!bytes) throw new Error('Account not unlocked');
    return bytes;
  }

  // Sign an event as the OWNER — first-party panel actions (note publish, image /
  // Blossom upload auth). Fails closed: when the caller names the account it
  // believes is active (`expectedPubkey`) and the keystore has since switched
  // (e.g. Sidecar switched accounts in another window and this panel went stale),
  // refuse rather than silently sign as the wrong account. Omitting
  // `expectedPubkey` preserves the old "sign as whatever is active" behavior.
  async function ownerSign(event, expectedPubkey) {
    requireUnlocked();
    const pk = await getActivePubkey();
    if (!pk) throw new Error('No active account');
    if (expectedPubkey && expectedPubkey !== pk) {
      throw new Error(
        'Active account changed — not signing (expected ' +
          expectedPubkey.slice(0, 8) + '…, active ' + pk.slice(0, 8) + '…)'
      );
    }
    return root.NostrTools.finalizeEvent(event, await getPrivkey(pk));
  }

  // Re-wrap every account (and the verifier) under a new PIN.
  async function changePin(oldPin, newPin) {
    const store = await loadStore();
    if (!store) throw new Error('Keystore not initialized');
    assertPinStrength(newPin);
    const oldKey = await C.deriveKey(oldPin, store.kdf);
    if (!(await C.checkVerifier(oldKey, store.verifier))) throw new Error('Incorrect current PIN');
    const kdf = C.newKdf();
    const newKey = await C.deriveKey(newPin, kdf);
    for (const acct of Object.values(store.accounts)) {
      const bytes = await C.decryptBytes(oldKey, acct.enc);
      acct.enc = await C.encryptBytes(newKey, bytes);
      C.wipe(bytes);
    }
    store.kdf = kdf;
    store.verifier = await C.makeVerifier(newKey);
    await set({ [STORE_KEY]: store });
    derivedKey = newKey; // stay unlocked
    await persistSession(newKey);
    return getState();
  }

  root.SidecarKeystore = {
    bytesToHex,
    hexToBytes,
    decodeSecret,
    isInitialized,
    isLocked,
    ensureLoaded,
    verifyPin,
    getState,
    reorderAccounts,
    initialize,
    unlock,
    lock,
    addAccountFromBytes,
    importSecret,
    generateAccount,
    removeAccount,
    renameAccount,
    setProfile,
    setActive,
    getActivePubkey,
    hasAccount,
    getPrivkey,
    ownerSign,
    setNwc,
    getNwc,
    hasNwc,
    clearNwc,
    changePin,
    // expose the derived key getter for sibling modules (e.g. NWC string encryption)
    _getDerivedKey: () => derivedKey,
  };
})(typeof self !== 'undefined' ? self : this);
