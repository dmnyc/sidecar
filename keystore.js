// Sidecar keystore — multi-account encrypted nostr key storage.
//
// Runs in the service worker (loaded via importScripts after nostr-tools.js and
// crypto.js). Owns the persistent encrypted records in chrome.storage.local AND the
// in-memory map of decrypted private keys that exists only while unlocked. Decrypted
// keys never touch disk; they are wiped on lock / browser restart / SW death.
//
// Storage layout (v2 — key slots):
//   sidecar_keystore = {
//     version: 2,
//     slots: [ { type:'pin', kdf:{...}, wrapped:{iv,ct} }, … ],
//     accounts: { <pubkeyHex>: { pubkey, label, enc:{iv,ct}, createdAt } },
//     verifier: { iv, ct }              // AES-GCM of a known constant
//   }
//   sidecar_active_pubkey = <pubkeyHex>
//
// Everything at rest is encrypted under one random data key, the DEK. Slots wrap
// the DEK — one per unlock factor — so adding a factor, removing one, or changing
// the PIN re-wraps 32 bytes and no account ciphertext ever moves.
//
// v1 had no DEK: the PIN-derived key encrypted every payload directly, which made
// each payload its own re-wrap site that changePin had to remember. It missed the
// NWC connection strings, and a PIN change silently turned every stored wallet
// into ciphertext under a key nobody had any more. That is the failure mode this
// layout removes structurally rather than by remembering harder. v1 stores are
// migrated in one write on the next successful unlock (see migrateToSlots).

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
  let dek = null;                 // non-extractable AES-GCM CryptoKey, held while unlocked
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
    if (dek) return;
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
    dek = key;
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

  // ---- key slots -----------------------------------------------------------
  //
  // A slot is one way to get at the DEK: a KEK (key-encrypting key) derived from
  // some factor, plus the DEK sealed under it. The DEK itself is random and never
  // derived from anything, so factors can be added and removed without touching a
  // byte of account ciphertext.
  //
  // The wrap IS the check for that factor: AES-GCM's tag fails on the wrong KEK,
  // so a bad PIN is a failed unwrap rather than a separate comparison. The
  // verifier survives for a different job — confirming that a DEK restored from
  // storage.session after a service-worker restart still belongs to this store.

  const SLOT_PIN = 'pin';
  // Backup of the pre-migration v1 store, kept for exactly one unlock cycle so a
  // migration that somehow produced a store this build can't read is recoverable
  // by hand rather than being the end of the vault. Cleared on the first unlock
  // that isn't itself the migration.
  const V1_BACKUP_KEY = 'sidecar_keystore_v1_backup';

  function pinSlot(store) {
    return (store.slots || []).find((s) => s.type === SLOT_PIN) || null;
  }

  // Seal `dekKey` under a KEK derived from `pin`. Returns a slot record.
  async function makePinSlot(dekKey, pin, kdfOverride) {
    const kdf = kdfOverride || C.newKdf();
    const kek = await C.deriveKey(pin, kdf);
    const raw = C.base64ToBytes(await C.exportKeyRaw(dekKey));
    const wrapped = await C.encryptBytes(kek, raw);
    C.wipe(raw);
    return { type: SLOT_PIN, kdf, wrapped };
  }

  // Unwrap the DEK using `pin`. Returns null when the PIN is wrong — the AES-GCM
  // tag failing on the wrap is exactly that signal, and is not an error worth
  // propagating.
  async function openWithPin(store, pin) {
    const slot = pinSlot(store);
    if (!slot) return null;
    const kek = await C.deriveKey(pin, slot.kdf);
    let raw;
    try {
      raw = await C.decryptBytes(kek, slot.wrapped);
    } catch (_) {
      return null;
    }
    const key = await C.importKeyRaw(C.bytesToBase64(raw));
    C.wipe(raw);
    return key;
  }

  // ---- public API ----

  async function isInitialized() {
    return (await loadStore()) !== null;
  }

  function isLocked() {
    return dek === null;
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
    const key = await C.importKeyRaw(C.bytesToBase64(C.randomBytes(32)));
    const store = {
      version: 2,
      slots: [await makePinSlot(key, pin)],
      accounts: {},
      verifier: await C.makeVerifier(key),
    };
    await set({ [STORE_KEY]: store });
    dek = key;
    unlocked = new Map();
    await persistSession(key);
    return getState();
  }

  // ---- v1 → v2 migration ---------------------------------------------------
  //
  // Mints a DEK, re-encrypts every payload under it, and wraps the DEK in a PIN
  // slot reusing the store's existing KDF (same PIN, same parameters — there is no
  // reason to make the user's PIN do more work here).
  //
  // Two properties carry the whole thing, because the cost of getting this wrong
  // is every private key in the vault:
  //
  //   Atomic. One set() carrying the store, the notes key, and the NWC records
  //   together. A crash lands wholly v1 or wholly v2, never half — a half-migrated
  //   store is precisely the state nothing could recover from.
  //
  //   Verified before it is trusted. Every account is decrypted back out of the
  //   NEW ciphertext with the NEW key and compared byte-for-byte against what came
  //   out of the old one. A single mismatch aborts and leaves the v1 store exactly
  //   as it was. Writing first and discovering the problem later is not an option
  //   available to us.
  //
  // Returns the migrated store plus the DEK. Throws rather than writing anything
  // if it cannot satisfy itself that the result is readable.
  async function migrateToSlots(store, oldKey, pin, plaintexts) {
    const key = await C.importKeyRaw(C.bytesToBase64(C.randomBytes(32)));
    const next = {
      version: 2,
      slots: [await makePinSlot(key, pin, store.kdf)],
      accounts: {},
      verifier: await C.makeVerifier(key),
    };
    if (store.order) next.order = store.order.slice();

    for (const [pubkey, acct] of Object.entries(store.accounts)) {
      const bytes = plaintexts.get(pubkey);
      if (!bytes) throw new Error('Keystore migration aborted: account ' + pubkey.slice(0, 8) + ' did not decrypt');
      const enc = await C.encryptBytes(key, bytes);
      // Read it straight back. An account that does not survive the round trip is
      // an account we would be destroying.
      const check = await C.decryptBytes(key, enc);
      if (check.length !== bytes.length || !check.every((b, i) => b === bytes[i])) {
        C.wipe(check);
        throw new Error('Keystore migration aborted: account ' + pubkey.slice(0, 8) + ' failed to round-trip');
      }
      C.wipe(check);
      next.accounts[pubkey] = Object.assign({}, acct, { enc });
    }

    const write = { [STORE_KEY]: next, [V1_BACKUP_KEY]: store };

    // The notes key and the NWC records are sealed under the same old key and move
    // in the same write. These are the exact payloads v1 made it possible to
    // forget; here they are unmissable, because forgetting one means it is not in
    // the write at all and the migration is visibly incomplete.
    const notesRec = (await get(NOTES_KEY))[NOTES_KEY];
    if (notesRec && notesRec.enc) {
      const raw = await C.decryptBytes(oldKey, notesRec.enc);
      write[NOTES_KEY] = { v: 1, enc: await C.encryptBytes(key, raw) };
      C.wipe(raw);
    }
    const nwcAll = await loadNwcStore();
    let nwcMoved = false;
    for (const [pk, rec] of Object.entries(nwcAll)) {
      let conn;
      try {
        conn = await C.decryptString(oldKey, rec);
      } catch (_) {
        // Already unreadable before we arrived — a connection orphaned by a PIN
        // change under the old layout. Carried across untouched: it cannot be
        // recovered, and quietly dropping user data during a migration they did
        // not ask for is the wrong instinct.
        continue;
      }
      nwcAll[pk] = await C.encryptString(key, conn);
      nwcMoved = true;
    }
    if (nwcMoved) write[NWC_KEY] = nwcAll;

    await set(write);
    return key;
  }

  // Unwrap the DEK with `pin`, then decrypt every account into memory. Migrates a
  // v1 store on the way through, which is the only moment we hold both the old
  // key and the user's PIN.
  async function unlock(pin) {
    const store = await loadStore();
    if (!store) throw new Error('Keystore not initialized');

    let key;
    let migrated = false;
    const map = new Map();

    if (store.version >= 2) {
      key = await openWithPin(store, pin);
      if (!key) throw new Error('Incorrect PIN');
      for (const acct of Object.values(store.accounts)) {
        map.set(acct.pubkey, await C.decryptBytes(key, acct.enc));
      }
    } else {
      // v1: the PIN-derived key is the payload key.
      const oldKey = await C.deriveKey(pin, store.kdf);
      if (!(await C.checkVerifier(oldKey, store.verifier))) {
        throw new Error('Incorrect PIN');
      }
      for (const acct of Object.values(store.accounts)) {
        map.set(acct.pubkey, await C.decryptBytes(oldKey, acct.enc));
      }
      key = await migrateToSlots(store, oldKey, pin, map);
      migrated = true;
    }

    dek = key;
    unlocked = map;
    await persistSession(key);
    // The v1 backup has served its purpose once a later unlock has read the
    // migrated store successfully. Not on the migrating unlock itself — that one
    // is still running on keys it just minted.
    if (!migrated) {
      const backup = (await get(V1_BACKUP_KEY))[V1_BACKUP_KEY];
      if (backup) await new Promise((res) => chrome.storage.local.remove(V1_BACKUP_KEY, res));
    }
    return getState();
  }

  async function lock() {
    for (const bytes of unlocked.values()) C.wipe(bytes);
    unlocked.clear();
    dek = null;
    notesKey = null;
    await sessClear();
  }

  // ---- notes key: envelope key for the encrypted local stores (drafts, pay-meta) ----
  // A random 32-byte key, stored ONLY wrapped under the DEK. background.js seals
  // those stores with it, so drafts never have to be re-encrypted when an unlock
  // factor changes.
  //
  // This is the same indirection the slots give the vault, discovered earlier and
  // applied to one subsystem: a random key, wrapped once. Under v2 the DEK makes it
  // redundant — drafts could hang off the DEK directly — but collapsing the two is
  // another at-rest migration for no user-visible gain, so it stays. The wrap now
  // only moves during the v1 migration; a PIN change no longer touches it at all.
  const NOTES_KEY = 'sidecar_notes_key';
  let notesKey = null;
  async function getNotesKey() {
    if (notesKey) return notesKey;
    if (!dek) return null; // locked: no envelope operations at all
    const rec = (await get(NOTES_KEY))[NOTES_KEY];
    if (rec && rec.enc) {
      // A corrupt/undecryptable wrap must PROPAGATE, not be replaced — generating
      // a fresh key here would orphan the wrapped one and silently destroy every
      // draft it still protects. Callers catch and treat the store as unreadable.
      const raw = await C.decryptBytes(dek, rec.enc);
      notesKey = await C.importKeyRaw(C.bytesToBase64(raw));
      C.wipe(raw);
      return notesKey;
    }
    // First use: generate and wrap. Its own single write, so there is no
    // partial-write window to close here.
    const raw = C.randomBytes(32);
    notesKey = await C.importKeyRaw(C.bytesToBase64(raw));
    await set({ [NOTES_KEY]: { v: 1, enc: await C.encryptBytes(dek, raw) } });
    C.wipe(raw);
    return notesKey;
  }

  // Verify a PIN without changing lock state — used to "step up" before sensitive
  // operations (reveal nsec / NWC string, publish profile changes).
  async function verifyPin(pin) {
    const store = await loadStore();
    if (!store) return false;
    if (store.version >= 2) return (await openWithPin(store, pin)) !== null;
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
      enc: await C.encryptBytes(dek, privBytes),
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
    all[pk] = await C.encryptString(dek, connectionString);
    await set({ [NWC_KEY]: all });
  }
  // A record that won't decrypt is gone for good — the key that sealed it no
  // longer exists. That is recoverable (re-pair from the wallet app) but only if
  // we say so: a raw OperationError from deep inside the wallet client tells the
  // user nothing they can act on.
  function unreadableNwc() {
    const err = new Error('Wallet connection could not be decrypted. Reconnect your wallet.');
    err.code = 'NWC_UNREADABLE';
    return err;
  }

  async function getNwc(pubkey) {
    requireUnlocked();
    const pk = pubkey || (await getActivePubkey());
    const all = await loadNwcStore();
    if (!all[pk]) return null;
    try {
      return await C.decryptString(dek, all[pk]);
    } catch (_) {
      throw unreadableNwc();
    }
  }
  // Presence AND readability. Every caller of this is a gate in front of an
  // operation that needs the string, so a record we can't open is not a wallet
  // as far as they're concerned — answering "yes" sends them into a failure they
  // can't interpret. While locked, presence is the only question we can answer,
  // which is fine: those paths unlock before they get any further.
  async function hasNwc(pubkey) {
    const pk = pubkey || (await getActivePubkey());
    const all = await loadNwcStore();
    if (!all[pk]) return false;
    if (isLocked()) return true;
    try {
      await C.decryptString(dek, all[pk]);
      return true;
    } catch (_) {
      return false;
    }
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

  // Change the PIN.
  //
  // Under v2 this re-wraps the DEK and touches nothing else — 32 bytes move, no
  // account ciphertext is rewritten, and there is no list of payloads to remember.
  // That list is what v1 got wrong: three of its four entries were re-wrapped and
  // the fourth, the NWC connections, was not, so a PIN change quietly destroyed
  // every stored wallet. There is no equivalent mistake available here.
  //
  // A v1 store migrates rather than being re-keyed in place. This is the other
  // moment we hold both the old key and a PIN, and re-keying it as v1 would just
  // preserve the shape that made that loss possible.
  async function changePin(oldPin, newPin) {
    const store = await loadStore();
    if (!store) throw new Error('Keystore not initialized');
    assertPinStrength(newPin);

    if (store.version >= 2) {
      const key = await openWithPin(store, oldPin);
      if (!key) throw new Error('Incorrect current PIN');
      // Replace only the PIN slot; any other factor keeps its own wrap of the
      // same unchanged DEK and goes on working.
      store.slots = (store.slots || []).filter((s) => s.type !== SLOT_PIN);
      store.slots.unshift(await makePinSlot(key, newPin));
      await set({ [STORE_KEY]: store });
      dek = key; // the DEK never changed, only the wrap around it
      await persistSession(key);
      return getState();
    }

    const oldKey = await C.deriveKey(oldPin, store.kdf);
    if (!(await C.checkVerifier(oldKey, store.verifier))) throw new Error('Incorrect current PIN');
    const plaintexts = new Map();
    for (const acct of Object.values(store.accounts)) {
      plaintexts.set(acct.pubkey, await C.decryptBytes(oldKey, acct.enc));
    }
    const key = await migrateToSlots(store, oldKey, newPin, plaintexts);
    // Those were decrypted only to be re-sealed. The live copies, if this keystore
    // is unlocked, are in `unlocked` and are unaffected — the private keys did not
    // change, only what encrypts them.
    for (const bytes of plaintexts.values()) C.wipe(bytes);
    dek = key; // stay unlocked
    await persistSession(key);
    return getState();
  }

  // ---- store-write serialization -------------------------------------------------
  //
  // Every mutator above does load → mutate → write of the WHOLE store object. Two
  // that overlap each save a snapshot taken before the other's change, so one update
  // is silently lost. Classic lost update, and it was not theoretical: importing a
  // vault and letting the avatar backfill run fires one setProfile per account at
  // once, and one or more pictures vanish. Which account loses depends on relay
  // timing, so it presents as intermittent.
  //
  // The stakes go well past avatars. A lost addAccountFromBytes write loses a
  // PRIVATE KEY. A lost changePin could leave the vault keyed to a PIN the user no
  // longer has. Serializing is cheap — these calls are rare, small, and never on a
  // hot path — and it removes a whole class of bug rather than the one symptom that
  // exposed it.
  //
  // Applied at the export boundary rather than inside each function so the bodies
  // stay readable and nothing internal can accidentally bypass it by calling a
  // sibling directly (an inner call runs inside the caller's own turn, which is
  // already serialized).
  let storeChain = Promise.resolve();
  function serialized(fn) {
    return function (...args) {
      const run = storeChain.then(() => fn.apply(this, args));
      // The caller must still see a rejection, but it must not poison the chain for
      // everyone after it — so the swallow happens on a separate branch.
      storeChain = run.then(() => {}, () => {});
      return run;
    };
  }

  root.SidecarKeystore = {
    bytesToHex,
    hexToBytes,
    decodeSecret,
    isInitialized,
    isLocked,
    ensureLoaded,
    verifyPin,
    // Serialized: every one of these reads the store, changes it, and writes the
    // whole thing back. getState is included because it too can write (it backfills
    // placeholder names), so it can lose an update just like the rest.
    getState: serialized(getState),
    reorderAccounts: serialized(reorderAccounts),
    initialize: serialized(initialize),
    // unlock() writes too, indirectly: it ends by returning getState(), which
    // backfills placeholder names and saves when it does. Left unserialized that was
    // the one store write still outside the chain.
    unlock: serialized(unlock),
    lock, // touches only in-memory state and the session key, never the store
    addAccountFromBytes: serialized(addAccountFromBytes),
    importSecret: serialized(importSecret),
    generateAccount: serialized(generateAccount),
    removeAccount: serialized(removeAccount),
    renameAccount: serialized(renameAccount),
    setProfile: serialized(setProfile),
    setActive: serialized(setActive),
    getActivePubkey,
    hasAccount,
    getPrivkey,
    ownerSign,
    // The NWC store is a separate key but the same read-modify-write shape, and
    // removeAccount also deletes from it — so it shares the chain rather than
    // getting a second one.
    setNwc: serialized(setNwc),
    getNwc,
    hasNwc,
    clearNwc: serialized(clearNwc),
    // Highest-stakes writer here: it re-encrypts every account's key under a new
    // derived key and rewrites the whole store. Losing this write, or interleaving
    // it with another, is how a vault ends up keyed to a PIN nobody has.
    changePin: serialized(changePin),
    // Envelope key for the encrypted local stores (drafts/pay-meta); null when
    // locked. Never a raw export — callers get the CryptoKey itself. Serialized:
    // its first-use wrap-write must not interleave with changePin's re-wrap, or a
    // wrap keyed to the old PIN could land after the vault moved to the new one.
    getNotesKey: serialized(getNotesKey),
    // expose the derived key getter for sibling modules (e.g. NWC string encryption)
    _getDek: () => dek,
  };
})(typeof self !== 'undefined' ? self : this);
