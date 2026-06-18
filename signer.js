// Sidecar signer — performs the actual NIP-07 crypto using a decrypted private key.
//
// Runs in the service worker (importScripts after nostr-tools.js). Pure-ish: every op
// is given the active account's private-key bytes + pubkey by the caller (background.js,
// which pulls them from the unlocked keystore). Caches nip44 conversation keys per peer
// since getConversationKey (ECDH) is the expensive part.

(function (root) {
  'use strict';

  const NT = root.NostrTools;

  // key: `${selfPubkey}:${peerPubkey}` -> conversationKey (Uint8Array)
  const convKeyCache = new Map();

  function convKey(privBytes, selfPubkey, peerPubkey) {
    const cacheId = `${selfPubkey}:${peerPubkey}`;
    let k = convKeyCache.get(cacheId);
    if (!k) {
      k = NT.nip44.getConversationKey(privBytes, peerPubkey);
      convKeyCache.set(cacheId, k);
    }
    return k;
  }

  function clearCache() {
    convKeyCache.clear();
  }

  // Perform a crypto op. `type` is the NIP-07 method name.
  //   privBytes  : Uint8Array(32) of the active account (not needed for getPublicKey)
  //   selfPubkey : hex pubkey of the active account
  //   params     : method params from the page
  async function perform(type, params, privBytes, selfPubkey) {
    switch (type) {
      case 'getPublicKey':
        return selfPubkey;

      case 'signEvent': {
        const event = params && (params.event || params);
        if (!event || typeof event !== 'object') throw new Error('signEvent: missing event');
        return NT.finalizeEvent(event, privBytes); // sets pubkey, id, sig
      }

      case 'nip04.encrypt':
        return NT.nip04.encrypt(privBytes, params.pubkey, params.plaintext);

      case 'nip04.decrypt':
        return NT.nip04.decrypt(privBytes, params.pubkey, params.ciphertext);

      case 'nip44.encrypt':
        return NT.nip44.encrypt(params.plaintext, convKey(privBytes, selfPubkey, params.pubkey));

      case 'nip44.decrypt':
        return NT.nip44.decrypt(params.ciphertext, convKey(privBytes, selfPubkey, params.pubkey));

      default:
        throw new Error(`Unsupported method: ${type}`);
    }
  }

  // Methods that need the private key (everything except getPublicKey, which only
  // needs the public active pubkey and getRelays, handled in background from config).
  function needsPrivateKey(type) {
    return type !== 'getPublicKey' && type !== 'getRelays';
  }

  root.SidecarSigner = { perform, clearCache, needsPrivateKey };
})(typeof self !== 'undefined' ? self : this);
