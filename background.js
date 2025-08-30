// Background script for Sidecar Nostr extension

// Track pending NIP-07 requests
const pendingNip07Requests = new Map();

// Enable side panel on extension install
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Also handle action clicks explicitly for better compatibility
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Handle messages from content script and sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_NIP07_SUPPORT':
      // Check if NIP-07 extension is available
      checkNip07Support(sendResponse);
      return true; // Keep message channel open for async response
      
    case 'NIP07_REQUEST':
      // Forward NIP-07 requests to content script
      forwardNip07Request(message.data, sendResponse);
      return true;
      
    case 'STORE_KEYS':
      // Store user keys securely
      storeUserKeys(message.data, sendResponse);
      return true;
      
    case 'GET_STORED_KEYS':
      // Retrieve stored keys
      getStoredKeys(sendResponse);
      return true;
      
    case 'CLEAR_KEYS':
      // Clear stored keys
      clearStoredKeys(sendResponse);
      return true;
      
    case 'NIP07_RESPONSE':
      // Handle NIP-07 response from content script
      handleNip07Response(message.data, message.requestId);
      return false; // Don't keep channel open
      
    default:
      sendResponse({ error: 'Unknown message type' });
  }
});

async function checkNip07Support(sendResponse) {
  console.log('🔍 Checking NIP-07 support via content script bridge...');
  try {
    // Get all tabs, prioritizing active tabs and regular web pages
    const allTabs = await chrome.tabs.query({});
    const activeTabs = allTabs.filter(tab => tab.active);
    const regularTabs = allTabs.filter(tab => 
      tab.url && 
      (tab.url.startsWith('http://') || tab.url.startsWith('https://')) &&
      !tab.url.includes('chrome://') &&
      !tab.url.includes('extension://')
    );
    
    // Check active tabs first, then regular tabs
    const tabsToCheck = [...new Set([...activeTabs, ...regularTabs])];
    console.log(`📋 Found ${tabsToCheck.length} suitable tabs to check (${activeTabs.length} active)`);
    
    if (tabsToCheck.length === 0) {
      console.log('❌ No suitable tabs found. User needs to open a regular webpage.');
      sendResponse({ 
        supported: false, 
        error: 'No regular webpages open. Please open a website like google.com first.' 
      });
      return;
    }
    
    let found = false;
    let checkedTabs = 0;
    
    for (const tab of tabsToCheck) {
      try {
        console.log(`🔍 Checking tab: ${tab.url} (active: ${tab.active})`);
        checkedTabs++;
        
        let response;
        try {
          // First try with existing content script (with timeout)
          response = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: 'CHECK_NIP07_SUPPORT' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
          ]);
        } catch (error) {
          console.log(`💉 Need to inject content script into ${tab.url}: ${error.message}`);
          
          try {
            // Inject content script
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            });
            
            // Wait longer for script to fully initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Try again with timeout
            response = await Promise.race([
              chrome.tabs.sendMessage(tab.id, { type: 'CHECK_NIP07_SUPPORT' }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after injection')), 3000))
            ]);
          } catch (injectionError) {
            console.log(`❌ Failed to inject/communicate with ${tab.url}: ${injectionError.message}`);
            continue;
          }
        }
        
        console.log(`📊 Tab ${tab.url} NIP-07 result:`, response);
        
        if (response && response.supported) {
          found = true;
          console.log('✅ NIP-07 extension found!');
          break;
        }
      } catch (error) {
        console.log(`⚠️ Error checking tab ${tab.url}: ${error.message}`);
        continue;
      }
    }
    
    console.log(`📈 Checked ${checkedTabs}/${tabsToCheck.length} tabs, NIP-07 support: ${found}`);
    sendResponse({ supported: found });
    
  } catch (error) {
    console.error('💥 Error checking NIP-07 support:', error);
    sendResponse({ supported: false, error: error.message });
  }
}

async function forwardNip07Request(data, sendResponse) {
  console.log('Forwarding NIP-07 request via content script bridge:', data);
  try {
    // Find a tab with NIP-07 support and use content script bridge
    const tabs = await chrome.tabs.query({});
    let success = false;
    
    for (const tab of tabs) {
      try {
        // Skip extension pages and special URLs
        if (!tab.url || tab.url.startsWith('chrome://') || 
            tab.url.startsWith('chrome-extension://') ||
            tab.url.startsWith('moz-extension://') ||
            tab.url.startsWith('about:') ||
            tab.url.startsWith('edge://') ||
            tab.url.startsWith('opera://')) {
          continue;
        }
        
        console.log(`Trying NIP-07 request on tab via content script: ${tab.url}`);
        
        // Generate request ID for tracking
        const requestId = 'req_' + Date.now() + '_' + Math.random();
        
        // Store the response callback
        pendingNip07Requests.set(requestId, sendResponse);
        
        try {
          // Try to send request via existing content script
          await chrome.tabs.sendMessage(tab.id, {
            type: 'NIP07_REQUEST',
            data: data,
            requestId: requestId
          });
          
          success = true;
          break;
        } catch (error) {
          // If content script doesn't exist, inject it
          console.log(`Content script not found for request, injecting into ${tab.url}`);
          
          try {
            // Inject content script
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            });
            
            // Wait a moment for script to initialize (longer wait for reliability)
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Try sending request again
            await chrome.tabs.sendMessage(tab.id, {
              type: 'NIP07_REQUEST',
              data: data,
              requestId: requestId
            });
            
            success = true;
            break;
          } catch (injectionError) {
            console.log(`Failed to inject content script for request into ${tab.url}:`, injectionError.message);
            // Clean up pending request
            pendingNip07Requests.delete(requestId);
            continue;
          }
        }
        
      } catch (error) {
        console.log(`Error on tab ${tab.url}:`, error.message);
        continue;
      }
    }
    
    if (!success) {
      console.log('No tab could handle NIP-07 request via content script');
      sendResponse({ success: false, error: 'No tab with content script found for NIP-07 request' });
    }
    
  } catch (error) {
    console.error('Error forwarding NIP-07 request:', error);
    sendResponse({ success: false, error: error.message });
  }
}

function handleNip07Response(data, requestId) {
  const sendResponse = pendingNip07Requests.get(requestId);
  if (sendResponse) {
    sendResponse(data);
    pendingNip07Requests.delete(requestId);
  }
}

async function storeUserKeys(data, sendResponse) {
  try {
    await chrome.storage.local.set({
      'sidecar_user_keys': {
        publicKey: data.publicKey,
        privateKey: data.privateKey, // This should be encrypted in production
        timestamp: Date.now()
      }
    });
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error storing keys:', error);
    sendResponse({ error: error.message });
  }
}

async function getStoredKeys(sendResponse) {
  try {
    const result = await chrome.storage.local.get(['sidecar_user_keys']);
    sendResponse({ 
      success: true, 
      data: result.sidecar_user_keys || null 
    });
  } catch (error) {
    console.error('Error retrieving keys:', error);
    sendResponse({ error: error.message });
  }
}

async function clearStoredKeys(sendResponse) {
  try {
    await chrome.storage.local.remove(['sidecar_user_keys']);
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error clearing keys:', error);
    sendResponse({ error: error.message });
  }
}

// Handle extension updates
chrome.runtime.onUpdateAvailable.addListener(() => {
  console.log('Extension update available');
});

// Keep service worker alive
let keepAlive = () => setInterval(chrome.runtime.getPlatformInfo, 20000);
chrome.runtime.onStartup.addListener(keepAlive);
keepAlive();