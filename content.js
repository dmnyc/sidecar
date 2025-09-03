// Content script for Sidecar Nostr extension
// This script runs in the context of web pages to facilitate NIP-07 communication

(function() {
  'use strict';
  
  // Store pending requests
  const pendingRequests = new Map();
  
  // Inject script into page context to access window.nostr
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
  
  // Listen for messages from injected script
  window.addEventListener('message', function(event) {
    // Only accept messages from same origin
    if (event.origin !== window.location.origin) {
      return;
    }
    
    // Check if this is a Sidecar NIP-07 response
    if (event.data && event.data.type === 'SIDECAR_NIP07_RESPONSE') {
      const { requestId, data } = event.data;
      
      // Send response back to background script
      chrome.runtime.sendMessage({
        type: 'NIP07_RESPONSE',
        requestId: requestId,
        data: data
      });
    }
    
    // Check if this is a Sidecar WebLN response
    if (event.data && event.data.type === 'SIDECAR_WEBLN_RESPONSE') {
      const { requestId, data } = event.data;
      
      // Send response back to background script
      chrome.runtime.sendMessage({
        type: 'WEBLN_RESPONSE',
        requestId: requestId,
        data: data
      });
    }
  });
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received message:', message);
    
    if (message.type === 'CHECK_NIP07_SUPPORT') {
      // Check if window.nostr is available by asking injected script
      const requestId = 'check_' + Date.now();
      
      // Store callback for this request
      pendingRequests.set(requestId, (result) => {
        sendResponse(result);
        pendingRequests.delete(requestId);
      });
      
      // Ask injected script to check for NIP-07 support
      window.postMessage({
        type: 'SIDECAR_CHECK_NIP07',
        requestId: requestId
      }, window.location.origin);
      
      return true; // Keep message channel open for async response
    }
    
    if (message.type === 'CHECK_WEBLN_SUPPORT') {
      // Check if window.webln is available by asking injected script
      const requestId = 'check_webln_' + Date.now();
      
      // Store callback for this request
      pendingRequests.set(requestId, (result) => {
        sendResponse(result);
        pendingRequests.delete(requestId);
      });
      
      // Ask injected script to check for WebLN support
      window.postMessage({
        type: 'SIDECAR_CHECK_WEBLN',
        requestId: requestId
      }, window.location.origin);
      
      return true; // Keep message channel open for async response
    }
    
    if (message.type === 'NIP07_REQUEST') {
      console.log('Forwarding NIP-07 request to injected script:', message.data);
      
      // Store callback for this request
      pendingRequests.set(message.requestId, (result) => {
        sendResponse(result);
        pendingRequests.delete(message.requestId);
      });
      
      // Forward to injected script
      window.postMessage({
        type: 'SIDECAR_NIP07_REQUEST',
        data: message.data,
        requestId: message.requestId
      }, window.location.origin);
      
      return true; // Keep message channel open for async response
    }
    
    if (message.type === 'WEBLN_REQUEST') {
      console.log('Forwarding WebLN request to injected script:', message.data);
      
      // Store callback for this request
      pendingRequests.set(message.requestId, (result) => {
        sendResponse(result);
        pendingRequests.delete(message.requestId);
      });
      
      // Forward to injected script
      window.postMessage({
        type: 'SIDECAR_WEBLN_REQUEST',
        data: message.data,
        requestId: message.requestId
      }, window.location.origin);
      
      return true; // Keep message channel open for async response
    }
  });
  
  // Handle responses from injected script
  window.addEventListener('message', function(event) {
    if (event.origin !== window.location.origin) return;
    
    if (event.data && event.data.type === 'SIDECAR_NIP07_RESPONSE') {
      const callback = pendingRequests.get(event.data.requestId);
      if (callback) {
        callback(event.data.data);
      }
    }
    
    if (event.data && event.data.type === 'SIDECAR_WEBLN_RESPONSE') {
      const callback = pendingRequests.get(event.data.requestId);
      if (callback) {
        callback(event.data.data);
        // Clean up the callback to prevent duplicate handling
        pendingRequests.delete(event.data.requestId);
      }
    }
  });
  
  console.log('Sidecar content script loaded');
})();