// Injected script for Sidecar Nostr extension
// This script runs in the page context to access window.nostr

(function() {
  'use strict';
  
  // Track processed requests to prevent duplicate responses
  const processedWebLNRequests = new Set();
  
  // Global WebLN response tracker to prevent Alby from sending duplicates
  if (!window.sidecarWebLNTracker) {
    window.sidecarWebLNTracker = new Set();
  }
  
  // Global WebLN session mutex to prevent concurrent payments
  if (!window.sidecarWebLNMutex) {
    window.sidecarWebLNMutex = {
      locked: false,
      lockTime: null
    };
  }
  
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
    
    // Handle WebLN support check
    if (event.data && event.data.type === 'SIDECAR_CHECK_WEBLN') {
      console.log('Checking for window.webln...');
      const hasWebLN = typeof window.webln !== 'undefined' && 
                       typeof window.webln.enable === 'function';
      
      console.log('window.webln found:', hasWebLN, window.webln);
      
      // Send response back to content script
      window.postMessage({
        type: 'SIDECAR_WEBLN_RESPONSE',
        requestId: event.data.requestId,
        data: { supported: hasWebLN }
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
    
    // Handle WebLN requests
    if (event.data && event.data.type === 'SIDECAR_WEBLN_REQUEST') {
      const { data, requestId } = event.data;
      console.log('Processing WebLN request:', data);
      
      // Check if we've already processed this request
      if (processedWebLNRequests.has(requestId)) {
        console.log('🚫 Ignoring duplicate WebLN request:', requestId);
        return;
      }
      
      // Mark this request as being processed
      processedWebLNRequests.add(requestId);
      
      try {
        let result;
        
        // Check if window.webln is available
        if (!window.webln) {
          throw new Error('WebLN extension not found');
        }
        
        // Execute the requested method
        switch (data.method) {
          case 'enable':
            console.log('Calling window.webln.enable()...');
            result = await window.webln.enable();
            console.log('WebLN enabled');
            break;
            
          case 'getInfo':
            console.log('Calling window.webln.getInfo()...');
            result = await window.webln.getInfo();
            console.log('Got WebLN info:', result);
            break;
            
          case 'sendPayment':
            console.log('🚀 Starting WebLN sendPayment...');
            console.log('📄 Invoice:', data.params);
            console.log('🔍 WebLN object:', window.webln);
            
            // Check global WebLN mutex
            if (window.sidecarWebLNMutex.locked) {
              const lockAge = Date.now() - window.sidecarWebLNMutex.lockTime;
              if (lockAge < 30000) { // 30 second timeout
                console.log('🚫 WebLN mutex locked, rejecting request. Lock age:', lockAge + 'ms');
                throw new Error('Another WebLN payment is in progress');
              } else {
                console.log('⏰ WebLN mutex timeout, forcing unlock. Lock age:', lockAge + 'ms');
                window.sidecarWebLNMutex.locked = false;
              }
            }
            
            // Lock the global mutex
            window.sidecarWebLNMutex.locked = true;
            window.sidecarWebLNMutex.lockTime = Date.now();
            console.log('🔒 WebLN global mutex locked');
            
            try {
              // Try to ensure clean WebLN state before payment
              console.log('🔧 Checking WebLN state before payment...');
              
              console.log('⚡ Calling window.webln.sendPayment...');
              console.log('🔍 About to await sendPayment for request:', requestId);
              result = await window.webln.sendPayment(data.params);
              console.log('✅ WebLN sendPayment resolved successfully for request:', requestId);
              
              // Check if Alby has any cleanup methods we should call
              console.log('🔍 Checking for Alby cleanup methods...');
              console.log('🔍 window.webln methods:', Object.getOwnPropertyNames(window.webln));
              if (window.webln.close) {
                console.log('🔧 Found webln.close method, attempting cleanup...');
                try {
                  await window.webln.close();
                } catch (e) {
                  console.log('⚠️ webln.close failed:', e.message);
                }
              }
              
              // Add extra wait to ensure Alby processes completion
              console.log('⏳ Waiting for Alby to complete internal processing...');
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Try to signal completion to Alby more aggressively
              if (result && result.preimage) {
                console.log('💫 Attempting to force Alby cleanup...');
                
                // Dispatch a custom event to signal completion
                const completionEvent = new CustomEvent('sidecar-webln-complete', {
                  detail: { requestId, result }
                });
                window.dispatchEvent(completionEvent);
                
                // Try to blur/focus to trigger Alby's cleanup
                if (window.focus) {
                  setTimeout(() => {
                    window.blur();
                    setTimeout(() => window.focus(), 100);
                  }, 500);
                }
              }
              console.log('🔍 Payment result:', result);
              console.log('🔍 Result type:', typeof result);
              console.log('🔍 Result properties:', Object.keys(result || {}));
              
              // Validate the result has expected properties
              if (!result || typeof result !== 'object') {
                console.error('❌ Invalid payment result:', result);
                throw new Error('Invalid payment result received from WebLN');
              }
              
              if (!result.preimage) {
                console.warn('⚠️ No preimage in payment result:', result);
              }
              
              console.log('🎉 Payment completed successfully, preimage:', result.preimage);
              
            } catch (error) {
              console.error('❌ WebLN sendPayment failed:', error);
              console.error('❌ Error details:', error.message, error.stack);
              throw error;
            } finally {
              // Always unlock the global mutex
              window.sidecarWebLNMutex.locked = false;
              console.log('🔓 WebLN global mutex unlocked');
            }
            
            break;
            
          case 'makeInvoice':
            console.log('Making invoice:', data.params);
            result = await window.webln.makeInvoice(data.params);
            break;
            
          case 'signMessage':
            console.log('Signing message:', data.params);
            result = await window.webln.signMessage(data.params);
            break;
            
          default:
            throw new Error(`Unknown WebLN method: ${data.method}`);
        }
        
        // Send success response (only once using global tracker)
        if (window.sidecarWebLNTracker.has(requestId)) {
          console.log('🚫 Global tracker: Ignoring duplicate success response for:', requestId);
          return;
        }
        
        window.sidecarWebLNTracker.add(requestId);
        console.log('📤 Sending WebLN success response for request:', requestId);
        window.postMessage({
          type: 'SIDECAR_WEBLN_RESPONSE',
          requestId: requestId,
          data: { success: true, data: result }
        }, window.location.origin);
        
      } catch (error) {
        console.error('WebLN request error:', error);
        
        // Send error response (only once using global tracker)
        if (window.sidecarWebLNTracker.has(requestId)) {
          console.log('🚫 Global tracker: Ignoring duplicate error response for:', requestId);
          return;
        }
        
        window.sidecarWebLNTracker.add(requestId);
        console.log('📤 Sending WebLN error response for request:', requestId);
        window.postMessage({
          type: 'SIDECAR_WEBLN_RESPONSE',
          requestId: requestId,
          data: { success: false, error: error.message }
        }, window.location.origin);
      }
    }
  });
  
  console.log('Sidecar injected script loaded');
})();