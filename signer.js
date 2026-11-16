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

  function nip44v3() {
    if (!root.SidecarNip44v3) throw new Error('NIP-44 v3 is not loaded');
    return root.SidecarNip44v3;
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

      // NIP-44 v3 (draft), nip44v3.js. No conversation-key cache: v3 has no conversation
      // key, and derives fresh keys for every message from the ECDH secret and its nonce.
      // Bytes cross the extension's messaging as base64, in both directions: the page's
      // ArrayBuffer arrives as plaintextBase64, and the decrypted bytes go back the same
      // way for nostr-provider.js to turn into an ArrayBuffer again.
      case 'nip44v3.encrypt': {
        const V3 = nip44v3();
        const p = V3.checkRequest(type, params);
        return V3.encrypt(privBytes, p.pubkey, p.kind, p.scope, V3.base64Decode(p.plaintextBase64));
      }

      case 'nip44v3.decrypt': {
        const V3 = nip44v3();
        const p = V3.checkRequest(type, params);
        return V3.base64Encode(V3.decrypt(privBytes, p.pubkey, p.kind, p.scope, p.ciphertext));
      }

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
