// Injected script for Sidecar Nostr extension
// This script runs in the page context to access window.nostr

(function() {
  'use strict';
  
  // Listen for messages from content script
  window.addEventListener('message', async function(event) {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    
    // Handle NIP-07 support check
    if (event.data && event.data.type === 'SIDECAR_CHECK_NIP07') {
      console.log('Checking for window.nostr...');
      const hasNostr = typeof window.nostr !== 'undefined' && 
                       typeof window.nostr.getPublicKey === 'function';
      
      console.log('window.nostr found:', hasNostr, window.nostr);
      
      // Send response back to content script
      window.postMessage({
        type: 'SIDECAR_NIP07_RESPONSE',
        requestId: event.data.requestId,
        data: { supported: hasNostr }
      }, window.location.origin);
      return;
    }
    
    // Handle NIP-07 requests
    if (event.data && event.data.type === 'SIDECAR_NIP07_REQUEST') {
      const { data, requestId } = event.data;
      console.log('Processing NIP-07 request:', data);
      
      try {
        let result;
        
        // Check if window.nostr is available
        if (!window.nostr) {
          throw new Error('NIP-07 extension not found');
        }
        
        // Execute the requested method
        switch (data.method) {
          case 'getPublicKey':
            console.log('Calling window.nostr.getPublicKey()...');
            result = await window.nostr.getPublicKey();
            console.log('Got public key:', result);
            break;
            
          case 'signEvent':
            console.log('Signing event:', data.params);
            result = await window.nostr.signEvent(data.params);
            break;
            
          case 'getRelays':
            if (window.nostr.getRelays) {
              result = await window.nostr.getRelays();
            } else {
              throw new Error('getRelays not supported');
            }
            break;
            
          case 'nip04.encrypt':
            if (window.nostr.nip04 && window.nostr.nip04.encrypt) {
              result = await window.nostr.nip04.encrypt(data.params.pubkey, data.params.plaintext);
            } else {
              throw new Error('NIP-04 encryption not supported');
            }
            break;
            
          case 'nip04.decrypt':
            if (window.nostr.nip04 && window.nostr.nip04.decrypt) {
              result = await window.nostr.nip04.decrypt(data.params.pubkey, data.params.ciphertext);
            } else {
              throw new Error('NIP-04 decryption not supported');
            }
            break;
            
          default:
            throw new Error(`Unknown method: ${data.method}`);
        }
        
        // Send success response
        window.postMessage({
          type: 'SIDECAR_NIP07_RESPONSE',
          requestId: requestId,
          data: { success: true, data: result }
        }, window.location.origin);
        
      } catch (error) {
        console.error('NIP-07 request error:', error);
        // Send error response
        window.postMessage({
          type: 'SIDECAR_NIP07_RESPONSE',
          requestId: requestId,
          data: { success: false, error: error.message }
        }, window.location.origin);
      }
    }
  });
  
  console.log('Sidecar injected script loaded');
})();