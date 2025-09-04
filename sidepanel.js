// Main sidepanel script for Sidecar Nostr extension
console.log('🟢 SIDEPANEL.JS SCRIPT LOADED!');

// Simple thread manager for tracking reply relationships (Phase 1: tracking only)
class ThreadManager {
  constructor() {
    this.replyCounts = new Map(); // eventId -> number of direct replies
    this.replyRelationships = new Map(); // replyId -> parentId
    this.parentReplies = new Map(); // parentId -> Set of replyIds
  }

  // Detect if a note is a reply by checking 'e' tags
  getParentEventId(event) {
    if (!event.tags) return null;
    
    const eTags = event.tags.filter(tag => tag[0] === 'e');
    if (eTags.length === 0) return null;
    
    // Look for explicit 'reply' marker, otherwise use the last e-tag
    for (let i = eTags.length - 1; i >= 0; i--) {
      const tag = eTags[i];
      if (tag[3] === 'reply' || i === eTags.length - 1) {
        return tag[1]; // Return parent event ID
      }
    }
    
    return null;
  }

  // Track a note and its reply relationships (silent operation)
  trackNote(event) {
    const eventId = event.id;
    const parentId = this.getParentEventId(event);
    
    if (parentId) {
      // This is a reply
      this.replyRelationships.set(eventId, parentId);
      
      // Track replies for the parent
      if (!this.parentReplies.has(parentId)) {
        this.parentReplies.set(parentId, new Set());
      }
      this.parentReplies.get(parentId).add(eventId);
      
      // Update reply count for parent
      const count = this.parentReplies.get(parentId).size;
      this.replyCounts.set(parentId, count);
      
      console.log('🔗 Reply tracked:', eventId.substring(0, 8) + '...', '→', parentId.substring(0, 8) + '...', `(${count} replies)`);
      
      // Update UI to show new count
      this.updateReplyCountInUI(parentId);
    }
  }

  // Get reply count for a note (0 if no replies)
  getReplyCount(eventId) {
    return this.replyCounts.get(eventId) || 0;
  }

  // Check if a note has replies
  hasReplies(eventId) {
    return this.getReplyCount(eventId) > 0;
  }

  // Fetch historical replies for a note from relays
  async fetchRepliesForNote(eventId, relayConnections) {
    if (!relayConnections || relayConnections.size === 0) return;
    
    const subscriptionId = `replies_${eventId.substring(0, 8)}_${Date.now()}`;
    const filter = {
      kinds: [1],
      '#e': [eventId],
      limit: 50
    };

    const subscription = ["REQ", subscriptionId, filter];
    console.log('📡 Fetching historical replies for:', eventId.substring(0, 8) + '...');
    
    let relaySent = 0;
    relayConnections.forEach((ws, relayUrl) => {
      if (relaySent >= 5) return; // Limit to first 5 relays
      if (ws.readyState !== WebSocket.OPEN) return;
      
      try {
        ws.send(JSON.stringify(subscription));
        relaySent++;
        console.log(`📤 Requesting replies from: ${relayUrl}`);
      } catch (error) {
        console.log('⚠️ Error fetching replies from relay:', relayUrl, error);
      }
    });
    
    // Auto-close subscription after 5 seconds
    setTimeout(() => {
      const closeMsg = ["CLOSE", subscriptionId];
      relayConnections.forEach((ws, relayUrl) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(closeMsg));
          } catch (error) {
            console.log('⚠️ Error closing subscription:', error);
          }
        }
      });
    }, 5000);
  }

  // Update reply count display in the DOM
  updateReplyCountInUI(eventId) {
    const replyCountElements = document.querySelectorAll(`.reply-count[data-event-id="${eventId}"]`);
    const newCount = this.getReplyCount(eventId);
    
    replyCountElements.forEach(element => {
      if (newCount > 0) {
        element.textContent = newCount;
        element.style.display = '';
      } else {
        element.textContent = '';
        element.style.display = 'none';
      }
    });
  }
}

class SidecarApp {
  constructor() {
    console.log('🏗️ SIDECAR APP CONSTRUCTOR CALLED');
    this.currentUser = null;
    this.currentFeed = 'trending';
    console.log('📝 Initial feed set to:', this.currentFeed);
    this.relays = [
      // Original relays
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://nostr.wine',
      
      // Additional major relays for better coverage
      'wss://relay.snort.social',
      'wss://relay.current.fyi',
      'wss://brb.io',
      'wss://relay.primal.net',
      'wss://purplepag.es',
      'wss://offchain.pub',
      'wss://relayable.org',
      'wss://relay.nostrgraph.net'
    ];
    this.relayConnections = new Map();
    this.subscriptions = new Map();
    this.notes = new Map();
    this.userReactions = new Set(); // Track events user has already reacted to
    this.zapReceipts = new Map(); // Track zap receipts for notes (eventId -> [zapInfo])
    this.zapReceiptRequests = new Set(); // Track which note IDs we've requested zap receipts for
    this.repostAggregation = new Map(); // Track multiple reposts of same note (originalNoteId -> repostInfo)
    this.profiles = new Map(); // Cache for user profiles (pubkey -> profile data)
    this.profileRequests = new Set(); // Track pending profile requests
    this.profileNotFound = new Set(); // Track pubkeys that don't have profiles
    this.userRelays = new Set(); // Track relays discovered from user's relay list
    
    // Initialize thread manager for reply tracking (Phase 1: tracking only)
    this.threadManager = new ThreadManager();
    this.pendingNoteDisplays = new Map(); // Track notes waiting to be displayed (eventId -> timeoutId)
    this.initialFeedLoaded = false; // Track if initial feed has been loaded
    this.profileQueue = new Set(); // Queue profile requests for batching
    this.profileTimeout = null; // Timeout for batch processing
    this.userDropdownSetup = false; // Track if user dropdown is set up
    this.userFollows = new Set(); // Track who the current user follows
    this.userMutes = new Set(); // Track who the current user has muted (NIP-51)
    this.contactListLoaded = false; // Track if contact list has been loaded
    this.muteListLoaded = false; // Track if mute list has been loaded
    this.lastContactListTimestamp = null; // Track most recent contact list timestamp
    this.loadingMore = false; // Track if we're currently loading more notes
    this.batchedLoadInProgress = false; // Track if batched load more is in progress
    this.loadMoreStartNoteCount = 0; // Track note count when load more started
    this.consecutiveEmptyLoads = 0; // Track consecutive empty load operations
    this.oldestNoteTimestamp = null; // Track oldest note for pagination
    this.feedHasMore = true; // Track if there are more notes to load
    this.definitelyNoMoreNotes = false; // Track if we've definitively determined there are no more notes
    this.batchNewNotesReceived = 0; // Track notes received in current batch operation
    this.batchNotesDisplayed = 0; // Track notes actually displayed (passed filtering)
    this.expectedBatches = 0; // Track expected number of batches for completion
    this.completedBatches = new Set(); // Track which batches have completed
    this.currentBatchSubIds = []; // Track current batch subscription IDs for cleanup
    
    // Wallet connection state
    this.walletConnected = false;
    this.walletProvider = null;
    this.webLNSessionActive = false; // Prevent multiple concurrent WebLN sessions
    this.lastWebLNRequest = null; // Track last WebLN request to prevent duplicates
    
    // Initialize WebLN detection
    this.initWebLN();
    
    // Memory management settings - balanced for good UX and performance
    this.maxNotes = 1000; // Maximum notes to keep in memory - increased for better scroll experience
    this.maxProfiles = 500; // Maximum profiles to keep in cache
    this.maxDOMNotes = 150; // Maximum notes to keep in DOM - increased for longer scroll history
    this.memoryCheckInterval = 60000; // Check memory every 60 seconds - less frequent cleanup
    this.maxSubscriptions = 50; // Maximum concurrent subscriptions
    this.lastMemoryCheck = Date.now();
    this.trendingNoteIds = new Set(); // Track which notes are from trending feed
    this.trendingDaysLoaded = 0; // Track how many days of trending data we've loaded
    this.meDaysLoaded = 0; // Track how many days of Me feed data we've loaded
    
    this.init();
  }
  
  async init() {
    console.log('🚀 SIDECAR STARTING UP!');
    console.log('Current URL:', window.location.href);
    this.setupEventListeners();
    this.setupImageErrorHandling();
    this.setupInfiniteScroll();
    this.setupGlobalRefresh();
    this.setupMemoryManagement();
    this.setupErrorHandling();
    await this.checkAuthState();
    this.loadVersionInfo();
    this.connectToRelays();
    // loadFeed() will be called automatically when first relay connects
  }
  
  loadVersionInfo() {
    // Load version info and git commit hash for build number
    this.getGitCommitHash().then(buildHash => {
      const buildElement = document.getElementById('app-build');
      if (buildElement) {
        buildElement.textContent = buildHash;
      }
    }).catch(err => {
      console.log('Could not load git commit hash:', err);
      const buildElement = document.getElementById('app-build');
      if (buildElement) {
        buildElement.textContent = 'unknown';
      }
    });
  }
  
  async getGitCommitHash() {
    // Try to get git commit hash - this will work if .git directory is accessible
    // For production, you might want to embed this during build time
    try {
      // First try to get from GitHub API if we know the repo
      const response = await fetch('https://api.github.com/repos/dmnyc/sidecar/commits/main');
      if (response.ok) {
        const data = await response.json();
        return data.sha.substring(0, 8);
      }
    } catch (error) {
      console.log('GitHub API not available:', error);
    }
    
    // Fallback to timestamp-based build
    const buildTime = new Date().toISOString().replace(/[:\-T]/g, '').substring(0, 14);
    return `dev-${buildTime}`;
  }
  
  showVersionModal() {
    console.log('🔍 Opening version modal');
    const modal = document.getElementById('version-modal');
    modal.classList.remove('hidden');
    
    // Add click outside to close
    setTimeout(() => {
      const handleClickOutside = (e) => {
        if (e.target === modal) {
          this.hideModal('version-modal');
          document.removeEventListener('click', handleClickOutside);
        }
      };
      document.addEventListener('click', handleClickOutside);
    }, 100);
  }
  
  setupEventListeners() {
    // Auth buttons
    document.getElementById('sign-in-btn').addEventListener('click', () => this.showAuthModal('signin'));
    document.getElementById('generate-keys-btn').addEventListener('click', () => this.showAuthModal('generate'));
    document.getElementById('sign-out-btn').addEventListener('click', () => this.signOut());
    
    // Modal controls
    document.getElementById('close-modal').addEventListener('click', () => this.hideModal('auth-modal'));
    document.getElementById('nip07-btn').addEventListener('click', () => this.signInWithNip07());
    document.getElementById('import-key-btn').addEventListener('click', () => this.importPrivateKey());
    document.getElementById('save-generated-keys-btn').addEventListener('click', () => this.saveGeneratedKeys());
    
    // Feed toggle
    console.log('🔗 Setting up feed toggle event listeners');
    document.getElementById('following-feed-btn').addEventListener('click', () => this.handleFeedButtonClick('following'));
    document.getElementById('trending-feed-btn').addEventListener('click', () => {
      console.log('🔥 TRENDING FEED BUTTON CLICKED!');
      this.handleFeedButtonClick('trending');
    });
    document.getElementById('me-feed-btn').addEventListener('click', () => this.handleFeedButtonClick('me'));
    
    // Floating compose button
    document.getElementById('floating-compose-btn').addEventListener('click', () => this.showComposeSection());
    
    // Compose
    document.getElementById('compose-text').addEventListener('input', this.updateCharCount);
    document.getElementById('post-btn').addEventListener('click', () => this.publishNote());
    document.getElementById('cancel-compose-btn').addEventListener('click', () => this.handleCancelClick());
    
    // Reply modal
    document.getElementById('close-reply-modal').addEventListener('click', () => this.hideModal('reply-modal'));
    document.getElementById('cancel-reply-btn').addEventListener('click', () => this.handleReplyCancelClick());
    document.getElementById('send-reply-btn').addEventListener('click', () => this.sendReply());
    document.getElementById('reply-text').addEventListener('input', this.updateReplyCharCount.bind(this));
    
    // Repost modal
    document.getElementById('close-repost-modal').addEventListener('click', () => this.hideModal('repost-modal'));
    document.getElementById('simple-repost-btn').addEventListener('click', () => this.sendSimpleRepost());
    document.getElementById('quote-repost-btn').addEventListener('click', () => this.showQuoteCompose());
    document.getElementById('cancel-quote-btn').addEventListener('click', () => this.handleQuoteCancelClick());
    document.getElementById('send-quote-btn').addEventListener('click', () => this.sendQuotePost());
    document.getElementById('quote-text').addEventListener('input', this.updateQuoteCharCount.bind(this));
    
    // Zap modal
    document.getElementById('close-zap-modal').addEventListener('click', () => this.hideModal('zap-modal'));
    document.getElementById('send-zap-btn').addEventListener('click', () => this.generateZapInvoice());
    document.getElementById('copy-zap-invoice').addEventListener('click', () => this.copyZapInvoice());
    document.getElementById('show-invoice-btn').addEventListener('click', () => this.toggleInvoiceDisplay());
    
    // Emoji picker
    document.getElementById('custom-emoji-btn').addEventListener('click', () => this.useCustomEmoji());
    document.getElementById('custom-emoji-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.useCustomEmoji();
    });
    
    // Copy buttons
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('copy-btn')) {
        this.copyToClipboard(e.target);
      }
      if (e.target.classList.contains('toggle-visibility')) {
        this.togglePasswordVisibility(e.target);
      }
      if (e.target.classList.contains('close-btn')) {
        const modal = e.target.closest('.modal');
        if (modal) this.hideModal(modal.id);
      }
      // Close modal when clicking outside of modal content
      if (e.target.classList.contains('modal')) {
        this.hideModal(e.target.id);
      }
      if (e.target.classList.contains('emoji-btn')) {
        const emoji = e.target.dataset.emoji;
        this.selectEmoji(emoji);
      }
    });
    
    // Retry button
    document.getElementById('retry-btn').addEventListener('click', () => this.loadFeed());
    
    // Reload feed button (replaces Load More button)
    document.getElementById('reload-feed-btn').addEventListener('click', () => this.loadFeed());
    
    // Generate keys when modal opens
    this.generateNewKeys();
    
    // Logo click for version modal
    document.querySelector('.logo').addEventListener('click', () => this.showVersionModal());
    
    // Wallet connection event listeners
    this.setupWalletEventListeners();
  }
  
  async initWebLN() {
    try {
      console.log('🔌 Checking for WebLN support via background script...');
      
      // Check WebLN support through the background script bridge
      const response = await this.sendMessage({ type: 'GET_WEBLN_SUPPORT' });
      
      if (response && response.supported) {
        console.log('✅ WebLN detected via background script');
        this.walletProvider = true; // Mark as available
        
        // If user is already signed in with NIP-07 (Alby), we can auto-connect WebLN
        if (this.currentUser && this.currentUser.useNip07) {
          console.log('🔗 User already signed in with NIP-07 - auto-connecting WebLN...');
          await this.autoConnectWebLN();
        }
      } else {
        console.log('ℹ️ WebLN not available - wallet features will be disabled');
        console.log('Error:', response?.error);
        this.walletProvider = null;
      }
      
      // Update UI based on WebLN availability
      this.updateWalletAvailability();
      
    } catch (error) {
      console.error('❌ Error initializing WebLN:', error);
      this.walletProvider = null;
      this.updateWalletAvailability();
    }
  }
  
  async autoConnectWebLN() {
    try {
      if (this.walletProvider && !this.walletConnected) {
        console.log('🔗 Auto-connecting to WebLN since user is already authenticated with Alby...');
        
        // Enable WebLN via background script
        const enableResponse = await this.sendMessage({
          type: 'WEBLN_REQUEST',
          data: { method: 'enable' }
        });
        
        if (enableResponse && enableResponse.success) {
          console.log('✅ WebLN enabled via background script');
          
          // Try to get wallet info
          try {
            const infoResponse = await this.sendMessage({
              type: 'WEBLN_REQUEST',
              data: { method: 'getInfo' }
            });
            
            if (infoResponse && infoResponse.success) {
              console.log('💰 Wallet info:', infoResponse.data);
              this.walletInfo = infoResponse.data;
            }
          } catch (e) {
            console.log('ℹ️ Could not get wallet info:', e.message);
          }
          
          this.walletConnected = true;
          this.updateWalletUI(); // Update UI to show connected state
          console.log('✅ WebLN auto-connected successfully');
        } else {
          console.log('❌ WebLN auto-enable failed:', enableResponse?.error);
        }
      }
    } catch (error) {
      console.log('ℹ️ Auto-connect failed:', error.message);
      // Don't show error to user for auto-connect failures
    }
  }
  
  setupWalletEventListeners() {
    // Connect wallet button
    document.getElementById('connect-wallet-btn').addEventListener('click', () => this.connectWallet());
    
    // Disconnect wallet button  
    document.getElementById('disconnect-wallet-btn').addEventListener('click', () => this.disconnectWallet());
    
    // Pay with wallet button
    document.getElementById('pay-with-wallet-btn').addEventListener('click', () => this.payWithWallet());
  }
  
  async connectWallet() {
    try {
      console.log('🔌 Connecting to WebLN wallet...');
      
      if (!this.walletProvider) {
        // Show setup instructions if user has Alby for Nostr but not WebLN
        if (this.currentUser && this.currentUser.useNip07) {
          this.showWebLNSetupInstructions();
          return;
        } else {
          throw new Error('No WebLN provider available. Please install a Lightning wallet extension like Alby.');
        }
      }
      
      // Enable WebLN via background script
      const enableResponse = await this.sendMessage({
        type: 'WEBLN_REQUEST',
        data: { method: 'enable' }
      });
      
      if (!enableResponse || !enableResponse.success) {
        throw new Error(enableResponse?.error || 'Failed to enable WebLN');
      }
      
      console.log('✅ WebLN enabled via background script');
      
      // Get wallet info if available
      try {
        const infoResponse = await this.sendMessage({
          type: 'WEBLN_REQUEST',
          data: { method: 'getInfo' }
        });
        
        if (infoResponse && infoResponse.success) {
          console.log('💰 Wallet info:', infoResponse.data);
          this.walletInfo = infoResponse.data;
        }
      } catch (e) {
        console.log('ℹ️ Could not get wallet info:', e.message);
      }
      
      this.walletConnected = true;
      
      // Update UI
      this.updateWalletUI();
      
      console.log('✅ WebLN wallet connected successfully');
    } catch (error) {
      console.error('❌ Failed to connect wallet:', error);
      alert(`Failed to connect wallet: ${error.message}`);
    }
  }
  
  disconnectWallet() {
    console.log('🔌 Disconnecting wallet...');
    this.walletConnected = false;
    this.walletInfo = null;
    // Keep the provider reference for re-connection, but update both UI states
    this.updateWalletUI();
    this.updateWalletAvailability();
    console.log('✅ Wallet disconnected');
  }
  
  
  showWebLNSetupInstructions() {
    const instructions = `To enable Lightning payments with your Alby extension:

1. Click the Alby extension icon in your browser
2. Go to Settings → Advanced
3. Enable "WebLN" or "Lightning Wallet" features
4. Refresh this page and try connecting again

Note: You might need to connect a Lightning wallet to your Alby account first if you haven't already.`;
    
    alert(instructions);
  }
  
  updateWalletAvailability() {
    const walletSection = document.querySelector('.wallet-connection-section');
    const connectBtn = document.getElementById('connect-wallet-btn');
    
    if (!this.walletProvider) {
      // No WebLN available
      if (this.currentUser && this.currentUser.useNip07) {
        connectBtn.disabled = false;
        connectBtn.textContent = '⚡ Setup Lightning Wallet';
      } else {
        connectBtn.disabled = true;
        connectBtn.textContent = '⚡ Install Alby Extension';
      }
      walletSection.style.opacity = '0.6';
    } else {
      // WebLN available
      connectBtn.disabled = false;
      if (this.walletConnected) {
        connectBtn.textContent = '⚡ Connected';
        connectBtn.disabled = true;
      } else {
        connectBtn.textContent = '⚡ Connect Wallet';
      }
      walletSection.style.opacity = '1';
    }
  }
  
  updateWalletUI() {
    const walletDisconnected = document.getElementById('wallet-disconnected');
    const walletConnected = document.getElementById('wallet-connected');
    const sendZapBtn = document.getElementById('send-zap-btn');
    const payWithWalletBtn = document.getElementById('pay-with-wallet-btn');
    
    if (this.walletConnected) {
      // Show connected state
      walletDisconnected.classList.add('hidden');
      walletConnected.classList.remove('hidden');
      
      // Show pay with wallet button, hide generate invoice button
      sendZapBtn.classList.add('hidden');
      payWithWalletBtn.classList.remove('hidden');
      
      // Update wallet name with info if available
      const walletName = document.getElementById('wallet-name');
      if (this.walletInfo && this.walletInfo.node && this.walletInfo.node.alias) {
        walletName.textContent = this.walletInfo.node.alias;
      } else {
        walletName.textContent = 'Wallet Connected';
      }
    } else {
      // Show disconnected state
      walletDisconnected.classList.remove('hidden');
      walletConnected.classList.add('hidden');
      
      // Show generate invoice button, hide pay with wallet button
      sendZapBtn.classList.remove('hidden');
      sendZapBtn.disabled = false; // Ensure generate invoice button is always enabled
      payWithWalletBtn.classList.add('hidden');
    }
  }
  
  async payWithWallet() {
    try {
      if (!this.walletConnected || !this.walletProvider) {
        throw new Error('No wallet connected');
      }
      
      // Check if a WebLN session is already active
      if (this.webLNSessionActive) {
        console.log('🚫 WebLN session already active, ignoring request');
        alert('Payment already in progress. Please wait for current payment to complete.');
        return;
      }
      
      // Lock the WebLN session
      this.webLNSessionActive = true;
      this.webLNSessionStart = Date.now();
      console.log('🔒 WebLN session locked');
      
      console.log('💰 Paying with connected wallet...');
      
      // Get zap details from the modal
      const zapAmount = parseInt(document.getElementById('zap-amount').value) || 21;
      const zapComment = document.getElementById('zap-comment').value || '';
      
      if (!zapAmount || zapAmount < 1) {
        alert('Please enter a valid amount');
        return;
      }
      
      if (!this.zappingEvent) {
        console.error('No event to zap');
        return;
      }
      
      // Show loading state
      const payWithWalletBtn = document.getElementById('pay-with-wallet-btn');
      const originalText = payWithWalletBtn.textContent;
      payWithWalletBtn.textContent = '⚡ Processing...';
      payWithWalletBtn.disabled = true;
      
      // Generate the invoice using existing logic but return the invoice string
      console.log(`⚡ Generating ${zapAmount} sat zap for wallet payment...`);
      const invoice = await this.generateZapInvoiceForWallet(zapAmount, zapComment);
      
      if (!invoice) {
        throw new Error('Failed to generate invoice');
      }
      
      // Set up payment tracking for WebLN payments (same as regular payments)
      this.currentZapInvoice = {
        invoice: invoice,
        eventId: this.zappingEvent.id,
        amount: zapAmount,
        timestamp: Date.now()
      };
      
      // Start payment monitoring for zap receipt detection
      this.startPaymentMonitoring();
      
      // Try to reset WebLN state before payment
      console.log('🔄 Attempting to reset WebLN state...');
      try {
        await this.sendMessage({
          type: 'WEBLN_REQUEST',
          data: { method: 'enable' }
        });
        console.log('✅ WebLN re-enabled before payment');
      } catch (e) {
        console.log('⚠️ WebLN reset failed, proceeding anyway:', e.message);
      }
      
      // Check for duplicate invoice payments
      if (this.lastWebLNRequest === invoice) {
        console.log('🚫 Duplicate WebLN payment detected, blocking request');
        throw new Error('Payment already in progress for this invoice');
      }
      
      this.lastWebLNRequest = invoice;
      console.log('📝 WebLN request recorded for duplicate prevention');
      
      // Pay the invoice using the connected wallet via background script
      console.log('⚡ Sending payment through wallet...');
      console.log('📄 Invoice being paid:', invoice.substring(0, 50) + '...');
      
      const paymentResponse = await this.sendMessage({
        type: 'WEBLN_REQUEST',
        data: { 
          method: 'sendPayment',
          params: invoice
        }
      });
      
      console.log('📨 Payment response received:', paymentResponse);
      
      if (!paymentResponse || !paymentResponse.success) {
        throw new Error(paymentResponse?.error || 'Payment failed');
      }
      
      // WebLN sendPayment returns an object with preimage
      const preimage = paymentResponse.data?.preimage;
      if (!preimage) {
        throw new Error('Payment may have failed - no preimage received');
      }
      
      console.log('✅ Payment successful! Preimage:', preimage);
      console.log('🔍 Full payment response data:', paymentResponse.data);
      
      // Give Alby some time to process and close its popup
      console.log('⏳ Waiting for Alby popup to close...');
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Show success message with preimage info, but keep monitoring for zap receipt
      this.showPaymentSuccessMessage(zapAmount, preimage);
      
      // Note: We don't stop payment monitoring here because we want to detect the zap receipt
      console.log('⏳ Continuing to monitor for zap receipt confirmation...');
      
      // The real-time subscription should catch the zap receipt immediately
      console.log('📡 Real-time zap subscription active - waiting for zap receipt...');
      
      // Also request fresh zap receipts as a backup after a short delay
      setTimeout(() => {
        console.log('🔄 Backup: Requesting fresh zap receipts after WebLN payment...');
        if (this.zapReceiptRequests.has(this.zappingEvent.id)) {
          this.zapReceiptRequests.delete(this.zappingEvent.id);
        }
        this.requestZapReceipts(this.zappingEvent.id);
      }, 1000); // Reduced from 2000ms to 1000ms
      
      // Add a note about Alby popup behavior
      console.log('💡 If Alby popup is still open, you can safely close it - payment was successful!');
      
      return paymentResponse;
      
    } catch (error) {
      console.error('❌ Payment failed:', error);
      
      // Reset button state on error
      const payWithWalletBtn = document.getElementById('pay-with-wallet-btn');
      if (payWithWalletBtn) {
        payWithWalletBtn.textContent = 'Zap!';
        payWithWalletBtn.disabled = false;
      }
      
      alert(`Payment failed: ${error.message}`);
      throw error;
    } finally {
      // Always unlock WebLN session
      this.webLNSessionActive = false;
      console.log('🔓 WebLN session unlocked');
      
      // Clear last request after delay to allow for retries of different invoices
      setTimeout(() => {
        this.lastWebLNRequest = null;
        console.log('🧹 WebLN request history cleared');
      }, 5000);
    }
  }
  
  async generateZapInvoiceForWallet(amount, comment) {
    try {
      // Get recipient's profile to find Lightning address
      const profile = this.profiles.get(this.zappingEvent.pubkey);
      let lightningAddress = null;
      
      // Look for Lightning address in profile metadata (NIP-57 fields)
      if (profile?.lud06) {
        lightningAddress = profile.lud06; // LNURL
        console.log('🔍 Using LNURL from profile:', lightningAddress);
      } else if (profile?.lud16) {
        lightningAddress = profile.lud16; // Lightning Address
        console.log('🔍 Using Lightning Address from profile:', lightningAddress);
      }
      
      if (!lightningAddress) {
        throw new Error('Recipient has no Lightning address configured in their profile');
      }
      
      // Generate real Lightning invoice using LNURL-pay
      const invoice = await this.getLightningInvoice(lightningAddress, amount * 1000, comment);
      return invoice;
      
    } catch (error) {
      console.error('❌ Error generating invoice for wallet:', error);
      throw error;
    }
  }
  
  setupImageErrorHandling() {
    // Global image error handler using event delegation
    document.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') {
        const img = e.target;
        console.log('Image failed to load:', img.src);
        
        // Add broken class for CSS targeting
        img.classList.add('broken');
        
        // Try to find and show avatar placeholder if this is an avatar
        const avatarContainer = img.closest('.note-avatar, .reply-avatar, .user-avatar');
        if (avatarContainer) {
          const placeholder = avatarContainer.querySelector('.avatar-placeholder');
          if (placeholder) {
            img.style.display = 'none';
            placeholder.style.display = 'flex';
          } else {
            // Complete removal if no placeholder available
            img.remove();
          }
        } else {
          // For content images, remove the entire container
          const imageContainer = img.closest('.image-container');
          if (imageContainer) {
            imageContainer.remove();
          } else {
            img.remove();
          }
        }
      }
    }, true); // Use capture phase to catch errors early
  }
  
  setupMemoryManagement() {
    // Set up periodic memory CHECK (not cleanup) - only cleanup if needed
    setInterval(() => {
      // Only cleanup if we're approaching memory limits
      if (this.notes.size > this.maxNotes * 0.8) {
        console.log(`🧹 Scheduled cleanup check: ${this.notes.size}/${this.maxNotes} notes (${Math.round(this.notes.size/this.maxNotes*100)}%)`);
        this.performMemoryCleanup();
      }
    }, this.memoryCheckInterval);
    
    // Also check memory on visibility change (when user returns to tab)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - this.lastMemoryCheck > this.memoryCheckInterval) {
        // Only cleanup if approaching limits
        if (this.notes.size > this.maxNotes * 0.8) {
          this.performMemoryCleanup();
        }
      }
    });
  }
  
  performMemoryCleanup() {
    console.log('🧹 Performing memory cleanup...');
    const startTime = Date.now();
    
    
    // Get current memory usage info
    const notesCount = this.notes.size;
    const profilesCount = this.profiles.size;
    const domNotesCount = document.querySelectorAll('.note').length;
    
    console.log(`📊 Before cleanup: ${notesCount} notes, ${profilesCount} profiles, ${domNotesCount} DOM notes`);
    
    // Clean up notes cache
    if (notesCount > this.maxNotes) {
      this.cleanupNotesCache();
    }
    
    // Clean up profiles cache
    if (profilesCount > this.maxProfiles) {
      this.cleanupProfilesCache();
    }
    
    // Clean up DOM notes
    if (domNotesCount > this.maxDOMNotes) {
      this.cleanupDOMNotes();
    }
    
    // Orphaned data cleanup removed - no longer using threading
    
    // Clean up excessive subscriptions
    this.cleanupSubscriptions();
    
    this.lastMemoryCheck = Date.now();
    
    const endTime = Date.now();
    const finalNotesCount = this.notes.size;
    const finalProfilesCount = this.profiles.size;
    const finalDomNotesCount = document.querySelectorAll('.note').length;
    
    console.log(`✅ Cleanup completed in ${endTime - startTime}ms`);
    console.log(`📊 After cleanup: ${finalNotesCount} notes, ${finalProfilesCount} profiles, ${finalDomNotesCount} DOM notes`);
  }
  
  cleanupNotesCache() {
    // Keep only the most recent notes and currently displayed notes
    const notesArray = Array.from(this.notes.entries())
      .sort((a, b) => b[1].created_at - a[1].created_at); // Sort by timestamp, newest first
    
    // Get IDs of currently displayed notes to preserve them
    const displayedNoteIds = new Set();
    document.querySelectorAll('.note[data-event-id]').forEach(el => {
      displayedNoteIds.add(el.dataset.eventId);
    });
    
    // Keep most recent notes + displayed notes - more aggressive during memory crisis
    const toKeep = new Set();
    let keptCount = 0;
    
    // Determine how aggressive to be based on memory pressure
    const memoryPressure = this.notes.size / this.maxNotes;
    let keepRatio;
    
    if (memoryPressure > 1.5) {
      keepRatio = 0.5; // Emergency: keep only 50% during severe memory crisis
    } else if (memoryPressure > 1.2) {
      keepRatio = 0.6; // High pressure: keep 60%
    } else {
      keepRatio = 0.8; // Normal: keep 80%
    }
    
    const maxKeep = Math.floor(this.maxNotes * keepRatio);
    console.log(`🧹 Memory pressure: ${Math.round(memoryPressure * 100)}%, keeping max ${maxKeep} notes (${Math.round(keepRatio * 100)}%)`);
    
    for (const [noteId, note] of notesArray) {
      if (displayedNoteIds.has(noteId) || keptCount < maxKeep) {
        toKeep.add(noteId);
        if (!displayedNoteIds.has(noteId)) keptCount++; // Only count non-displayed notes toward limit
      }
    }
    
    // Remove old notes
    for (const [noteId] of this.notes) {
      if (!toKeep.has(noteId)) {
        this.notes.delete(noteId);
      }
    }
    
    console.log(`🗑️ Removed ${notesArray.length - toKeep.size} old notes from cache`);
  }
  
  cleanupProfilesCache() {
    // Keep profiles that are currently being displayed and recently accessed
    const displayedPubkeys = new Set();
    
    // Get pubkeys from currently displayed notes
    document.querySelectorAll('.note[data-author]').forEach(el => {
      displayedPubkeys.add(el.dataset.author);
    });
    
    // Add current user and followed users
    if (this.currentUser) {
      displayedPubkeys.add(this.currentUser.publicKey);
    }
    this.userFollows.forEach(pubkey => displayedPubkeys.add(pubkey));
    
    // Remove profiles not currently needed
    const profilesToRemove = [];
    for (const [pubkey, profile] of this.profiles) {
      if (!displayedPubkeys.has(pubkey)) {
        profilesToRemove.push(pubkey);
      }
    }
    
    // Keep only most recent profiles beyond displayed ones
    const profilesToRemoveCount = Math.max(0, profilesToRemove.length - (this.maxProfiles - displayedPubkeys.size));
    
    // Sort by access time and remove oldest
    profilesToRemove
      .sort((a, b) => (this.profiles.get(b).updatedAt || 0) - (this.profiles.get(a).updatedAt || 0))
      .slice(-profilesToRemoveCount)
      .forEach(pubkey => {
        this.profiles.delete(pubkey);
        this.profileRequests.delete(pubkey);
      });
    
    console.log(`🗑️ Removed ${profilesToRemoveCount} old profiles from cache`);
  }
  
  cleanupDOMNotes() {
    const noteElements = document.querySelectorAll('.note');
    
    if (noteElements.length > this.maxDOMNotes) {
      console.log('🗑️ DOM cleanup triggered - preserving scroll position and viewport notes');
      
      // Don't cleanup during loading operations - notes are being actively viewed
      if (this.loadingMore || this.batchedLoadInProgress) {
        console.log('🗑️ Skipping DOM cleanup during loading operation');
        return;
      }
      
      // Get viewport information to preserve visible and nearby notes
      const scrollContainer = document.querySelector('.feed-container') || document.documentElement;
      const scrollTop = scrollContainer.scrollTop;
      const viewportHeight = scrollContainer.clientHeight;
      const viewportTop = scrollTop;
      const viewportBottom = scrollTop + viewportHeight;
      
      // Find notes that are visible or within reasonable buffer
      const buffer = viewportHeight * 1.5;
      const protectedNotes = new Set();
      
      console.log(`🔍 Viewport: ${viewportTop}-${viewportBottom} (height: ${viewportHeight}), buffer: ${buffer}`);
      
      let protectedCount = 0;
      let totalCount = 0;
      
      noteElements.forEach(note => {
        totalCount++;
        const rect = note.getBoundingClientRect();
        const noteTop = rect.top + scrollTop;
        const noteBottom = rect.bottom + scrollTop;
        
        // Protect notes in extended viewport area
        if (noteBottom >= (viewportTop - buffer) && noteTop <= (viewportBottom + buffer)) {
          protectedNotes.add(note.dataset.eventId);
          protectedCount++;
        }
      });
      
      console.log(`🔍 Protected ${protectedCount}/${totalCount} notes within viewport + buffer`);
      
      // Only remove notes that are far from the viewport
      const sortedNotes = Array.from(noteElements)
        .filter(note => !protectedNotes.has(note.dataset.eventId))
        .sort((a, b) => {
          const timeA = parseInt(a.dataset.timestamp || '0');
          const timeB = parseInt(b.dataset.timestamp || '0');
          return timeA - timeB; // Oldest first
        });
      
      // Calculate how many to remove - more aggressive when near memory limit
      const memoryPressure = this.notes.size / this.maxNotes;
      let removalPercentage;
      
      if (memoryPressure > 0.95) {
        removalPercentage = 0.5; // Remove 50% of non-protected notes when very close to limit
      } else if (memoryPressure > 0.90) {
        removalPercentage = 0.4; // Remove 40% when approaching limit
      } else {
        removalPercentage = 0.3; // Remove 30% during normal cleanup
      }
      
      const maxToRemove = Math.min(sortedNotes.length, Math.floor(noteElements.length * removalPercentage));
      const notesToRemove = sortedNotes.slice(0, maxToRemove);
      
      console.log(`🗑️ Memory pressure: ${Math.round(memoryPressure * 100)}%, will remove up to ${Math.round(removalPercentage * 100)}% (${maxToRemove} notes)`);
      
      console.log(`🗑️ Protecting ${protectedNotes.size} viewport notes, removing ${notesToRemove.length} distant notes`);
      
      // Calculate height of notes we're about to remove to adjust scroll
      let removedHeight = 0;
      
      // Remove distant notes with safety checks - more aggressive during memory crisis
      const maxRemoval = this.notes.size > this.maxNotes * 1.5 ? 500 : 100; // Allow more removal during emergencies
      let removed = 0;
      for (const note of notesToRemove) {
        if (note && note.parentNode && removed < maxRemoval) {
          try {
            removedHeight += note.offsetHeight;
            note.remove();
            removed++;
          } catch (error) {
            console.warn('Error removing DOM note:', error);
            break; // Stop if we encounter errors
          }
        }
      }
      
      // Adjust scroll position to maintain visual position
      scrollContainer.scrollTop = Math.max(0, scrollTop - removedHeight);
      
      console.log(`🗑️ Removed ${removed} old notes from DOM, adjusted scroll by ${removedHeight}px`);
    }
  }
  
  // cleanupOrphanedData removed - no longer using threading data structures
  
  cleanupSubscriptions() {
    const subsCount = this.subscriptions.size;
    if (subsCount > this.maxSubscriptions) {
      console.log(`🧹 Cleaning up subscriptions: ${subsCount} > ${this.maxSubscriptions}`);
      
      // Get subscription IDs sorted by creation time (older first)
      const subscriptionEntries = Array.from(this.subscriptions.entries());
      const oldSubscriptions = subscriptionEntries.slice(0, subsCount - this.maxSubscriptions);
      
      // Close old subscriptions
      oldSubscriptions.forEach(([subId, subscription]) => {
        console.log(`🔌 Closing old subscription: ${subId}`);
        this.relayConnections.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(['CLOSE', subId]));
          }
        });
        this.subscriptions.delete(subId);
      });
      
      console.log(`✅ Cleaned up ${oldSubscriptions.length} old subscriptions`);
    }
  }
  
  setupErrorHandling() {
    // Global error handler for memory issues
    window.addEventListener('error', (event) => {
      console.error('🚨 Global error:', event.error);
      if (event.error && event.error.message && 
          (event.error.message.includes('memory') || 
           event.error.message.includes('Maximum call stack') ||
           event.error.message.includes('out of memory'))) {
        console.error('🚨 MEMORY ERROR DETECTED - Emergency cleanup');
        this.emergencyCleanup();
      }
    });
    
    // Monitor performance
    if ('performance' in window && 'memory' in window.performance) {
      setInterval(() => {
        const memory = window.performance.memory;
        if (memory.usedJSHeapSize > memory.jsHeapSizeLimit * 0.9) {
          console.warn('⚠️ High JS heap usage:', Math.round(memory.usedJSHeapSize / 1024 / 1024) + 'MB');
          this.performMemoryCleanup();
        }
      }, 10000); // Check every 10 seconds
    }
  }
  
  emergencyCleanup() {
    console.log('🚨 EMERGENCY CLEANUP INITIATED');
    try {
      // Clear all subscriptions immediately
      this.subscriptions.forEach((sub, id) => {
        this.relayConnections.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(['CLOSE', id]));
          }
        });
      });
      this.subscriptions.clear();
      
      // Aggressive data cleanup
      this.notes.clear();
      this.profiles.clear();
        
      // Clear DOM
      const feed = document.getElementById('feed');
      if (feed) {
        feed.innerHTML = '';
      }
      
      console.log('✅ Emergency cleanup completed');
    } catch (error) {
      console.error('Emergency cleanup failed:', error);
    }
  }
  
  // Note: Infinite scroll is now handled by the main setupInfiniteScroll function below
  
  loadMoreNotes() {
    console.log('🔄 LoadMoreNotes called - currentFeed:', this.currentFeed);
    console.log('🔄 feedHasMore:', this.feedHasMore, 'loadingMore:', this.loadingMore, 'definitelyNoMoreNotes:', this.definitelyNoMoreNotes);
    console.log('🔍 DEBUG: Oldest timestamp:', this.oldestNoteTimestamp, this.oldestNoteTimestamp ? new Date(this.oldestNoteTimestamp * 1000).toLocaleString() : 'none');
    console.log('🔍 DEBUG: Notes in cache:', this.notes.size);
    console.log('🔍 DEBUG: Consecutive empty loads:', this.consecutiveEmptyLoads);
    
    // Don't load more if we've definitively determined there are no more notes
    if (this.definitelyNoMoreNotes) {
      console.log('🛑 definitelyNoMoreNotes is true, not loading more');
      return;
    }
    
    // Prevent multiple simultaneous requests
    if (this.loadingMore) {
      console.log('❌ Already loading more notes, skipping');
      return;
    }
    
    this.loadingMore = true;
    this.loadMoreStartNoteCount = this.notes.size; // Track starting note count
    this.loadMoreStartTimestamp = this.oldestNoteTimestamp; // Track starting timestamp for Me feed
    
    // Safety timeout to prevent loadingMore flag from getting stuck
    setTimeout(() => {
      if (this.loadingMore) {
        console.log('⚠️ SAFETY TIMEOUT: loadingMore flag stuck, resetting after 30s');
        this.loadingMore = false;
      }
    }, 30000);
    
    // Show loading indicator for load more
    const autoLoading = document.getElementById('auto-loading');
    const endOfFeed = document.getElementById('end-of-feed');
    if (autoLoading) autoLoading.classList.remove('hidden');
    if (endOfFeed) endOfFeed.classList.add('hidden');
    
    // Get the timestamp of the oldest note currently displayed
    const feed = document.getElementById('feed');
    const notes = Array.from(feed.children);
    if (notes.length === 0) {
      console.log('❌ No notes in feed, resetting loadingMore flag');
      this.loadingMore = false;
      // Reset UI elements
      this.showAutoLoader();
      return;
    }
    
    const oldestNote = notes[notes.length - 1];
    const oldestTimestamp = parseInt(oldestNote.dataset.timestamp);
    
    console.log(`🕰️ Oldest note in feed: ${new Date(oldestTimestamp * 1000).toLocaleString()}`);
    console.log(`🔍 Raw timestamp: ${oldestTimestamp}`);
    console.log(`🔍 Event ID: ${oldestNote.dataset.eventId}`);
    console.log(`🔍 Will request notes older than: ${new Date((oldestTimestamp - 1) * 1000).toLocaleString()}`);
    
    // Double-check if this timestamp makes sense
    const now = Math.floor(Date.now() / 1000);
    
    // Check if timestamp looks like milliseconds instead of seconds
    if (oldestTimestamp > 9999999999) {
      console.error(`🚨 TIMESTAMP ERROR: Oldest note timestamp ${oldestTimestamp} looks like milliseconds, not seconds!`);
      console.error(`🚨 Converting to seconds and using as until timestamp`);
      const correctedTimestamp = Math.floor(oldestTimestamp / 1000);
      console.log(`🔧 Corrected timestamp: ${correctedTimestamp} (${new Date(correctedTimestamp * 1000).toLocaleString()})`);
      this.loadMoreFollowingFeedBatched(Array.from(this.userFollows), correctedTimestamp);
      return;
    }
    
    // Check if timestamp is unreasonably old or new
    const oneYearAgo = now - (365 * 24 * 60 * 60);
    const oneYearFromNow = now + (365 * 24 * 60 * 60);
    if (oldestTimestamp < oneYearAgo || oldestTimestamp > oneYearFromNow) {
      console.error(`🚨 TIMESTAMP ERROR: Oldest note timestamp ${oldestTimestamp} is unreasonable!`);
      console.error(`🚨 Date: ${new Date(oldestTimestamp * 1000).toLocaleString()}`);
      console.error(`🚨 FALLBACK: Using current time minus 1 day as until timestamp`);
      const correctedTimestamp = now - (24 * 60 * 60);
      this.loadMoreFollowingFeedBatched(Array.from(this.userFollows), correctedTimestamp);
      return;
    }
    
    // Create a subscription for older notes
    const subId = 'loadmore-' + Date.now();
    let filter;
    
    if (this.currentFeed === 'following' && this.userFollows.size > 0) {
      console.log('📋 Loading more for following feed, batching', this.userFollows.size, 'users');
      this.loadMoreFollowingFeedBatched(Array.from(this.userFollows), oldestTimestamp);
      return;
    } else if (this.currentFeed === 'following') {
      console.log('❌ Following feed but userFollows is empty:', this.userFollows.size);
      this.loadingMore = false;
      // Reset UI elements
      this.showAutoLoader();
      return;
    } else if (this.currentFeed === 'me') {
      // Me feed: use trending-style approach for user's own notes
      console.log('🙋 Loading more for Me feed using trending-style approach');
      this.loadMoreMeFeed();
      return;
    } else if (this.currentFeed === 'trending') {
      // For trending feed, load more days of trending data
      console.log('📡 TRENDING LOAD MORE TRIGGERED - calling loadMoreTrendingDays()');
      this.loadMoreTrendingDays();
      return;
    }
    
    if (filter) {
      console.log('✅ Sending loadMore subscription:', JSON.stringify(filter));
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      
      let sentToRelays = 0;
      this.relayConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(subscription));
          sentToRelays++;
        }
      });
      console.log('📡 LoadMore subscription sent to', sentToRelays, 'relays');
      
      // For Me feed and other simple feeds, rely on EOSE completion
      // Only use timeout as fallback safety mechanism  
      setTimeout(() => {
        if (this.loadingMore) {
          console.log('⚠️ SAFETY TIMEOUT: Load more timeout after 10s, completing operation');
          const notesReceivedDuringLoad = this.notes.size - this.loadMoreStartNoteCount;
          console.log(`📊 Timeout completion: ${notesReceivedDuringLoad} new notes received`);
          
          if (notesReceivedDuringLoad === 0) {
            this.consecutiveEmptyLoads++;
            console.log(`📊 Timeout: No new notes (${this.consecutiveEmptyLoads} consecutive empty loads)`);
            
            let emptyLoadThreshold = 3;
            if (this.currentFeed === 'me') {
              // Smart threshold for Me feed based on total notes
              const totalNotes = this.notes.size;
              if (totalNotes <= 3) {
                emptyLoadThreshold = 1;
              } else if (totalNotes <= 10) {
                emptyLoadThreshold = 2;
              } else {
                emptyLoadThreshold = 3;
              }
            }
            
            if (this.consecutiveEmptyLoads >= emptyLoadThreshold) {
              console.log(`📊 ${this.consecutiveEmptyLoads} consecutive empty loads (threshold: ${emptyLoadThreshold}), setting feedHasMore = false`);
              this.feedHasMore = false;
            }
          } else {
            this.consecutiveEmptyLoads = 0;
            // Only set feedHasMore to true if we haven't definitively determined there are no more notes
            if (!this.definitelyNoMoreNotes) {
              this.feedHasMore = true;
            }
          }
          
          this.loadingMore = false;
          
          // Close the subscription
          if (this.subscriptions.has(subId)) {
            this.relayConnections.forEach(ws => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(['CLOSE', subId]));
              }
            });
            this.subscriptions.delete(subId);
          }
          
          this.showAutoLoader();
        }
      }, 10000);
    } else {
      console.log('❌ No filter created for loadMore - feed type not supported or missing data');
      this.loadingMore = false;
    }
  }
  
  async checkAuthState() {
    // For security reasons, we don't auto-login users on extension reload
    // Users must explicitly sign in each time the extension is reloaded
    console.log('🔒 Extension reloaded - user must sign in again for security');
    
    // Clear any stored keys to ensure clean state
    try {
      await this.sendMessage({ type: 'CLEAR_KEYS' });
    } catch (error) {
      console.error('Error clearing stored keys on startup:', error);
    }
    
    // Ensure UI shows signed-out state
    this.updateAuthUI();
  }
  
  
  showAuthModal(type) {
    const modal = document.getElementById('auth-modal');
    const title = document.getElementById('modal-title');
    const signinForm = document.getElementById('sign-in-form');
    const generateForm = document.getElementById('generate-keys-form');
    
    if (type === 'signin') {
      title.textContent = 'Sign In';
      signinForm.classList.remove('hidden');
      generateForm.classList.add('hidden');
    } else {
      title.textContent = 'Generate New Keys';
      signinForm.classList.add('hidden');
      generateForm.classList.remove('hidden');
      this.generateNewKeys();
    }
    
    modal.classList.remove('hidden');
  }
  
  hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
  }
  
  async signInWithNip07() {
    console.log('Starting NIP-07 sign in...');
    
    // Clear any existing auth state first
    console.log('Clearing existing auth state...');
    await this.sendMessage({ type: 'CLEAR_KEYS' });
    this.clearUserData();
    
    try {
      console.log('Checking NIP-07 support...');
      const response = await this.sendMessage({ type: 'GET_NIP07_SUPPORT' });
      console.log('NIP-07 support response:', response);
      
      if (!response.supported) {
        console.log('NIP-07 not supported');
        alert('No NIP-07 extension found. Please install Alby or nos2x extension and make sure you have a regular webpage (like google.com) open in another tab.');
        return;
      }
      
      console.log('Getting public key via NIP-07...');
      // Get public key using NIP-07
      const pubkeyResponse = await this.sendMessage({
        type: 'NIP07_REQUEST',
        data: { method: 'getPublicKey' }
      });
      console.log('Public key response:', pubkeyResponse);
      
      if (pubkeyResponse.success) {
        console.log('Successfully got public key:', pubkeyResponse.data);
        this.currentUser = {
          publicKey: pubkeyResponse.data,
          privateKey: null,
          useNip07: true
        };
        
        this.updateAuthUI();
        this.hideModal('auth-modal');
        this.loadFeed();
        
        // Auto-connect WebLN since user just signed in with Alby
        setTimeout(() => {
          this.autoConnectWebLN();
          this.updateWalletAvailability(); // Update wallet UI after sign-in
        }, 1000);
        
        // Fetch user's relay list (NIP-65) to discover their preferred relays
        setTimeout(() => {
          this.requestUserRelayList();
        }, 500);
        
        // Fetch contact list after a short delay to ensure relays are connected
        setTimeout(() => {
          console.log('Fetching contact list after NIP-07 sign-in delay...');
          this.fetchContactList();
        }, 1000);
      } else {
        console.error('Failed to get public key:', pubkeyResponse.error);
        alert('Failed to get public key: ' + pubkeyResponse.error);
      }
    } catch (error) {
      console.error('NIP-07 sign in error:', error);
      alert('Error signing in with NIP-07 extension: ' + error.message);
    }
  }
  
  async importPrivateKey() {
    const input = document.getElementById('private-key-input');
    const privateKey = input.value.trim();
    
    if (!privateKey) {
      alert('Please enter a private key');
      return;
    }
    
    try {
      let hexPrivateKey;
      
      // Handle nsec format
      if (privateKey.startsWith('nsec1')) {
        const decoded = window.NostrTools.nip19.decode(privateKey);
        hexPrivateKey = decoded.data;
      } else if (privateKey.length === 64) {
        // Assume hex format - convert to Uint8Array if needed
        hexPrivateKey = privateKey;
      } else {
        throw new Error('Invalid private key format');
      }
      
      // Ensure private key is in correct format for nostr-tools
      const privateKeyBytes = typeof hexPrivateKey === 'string' ? 
        this.hexToBytes(hexPrivateKey) : hexPrivateKey;
      
      // Generate public key
      const publicKey = window.NostrTools.getPublicKey(privateKeyBytes);
      
      // Store keys (store as hex string for compatibility)
      const privateKeyHex = typeof hexPrivateKey === 'string' ? 
        hexPrivateKey : this.bytesToHex(hexPrivateKey);
      
      const response = await this.sendMessage({
        type: 'STORE_KEYS',
        data: { publicKey, privateKey: privateKeyHex }
      });
      
      if (response.success) {
        // Clear previous user data before setting new user
        this.clearUserData();
        
        this.currentUser = {
          publicKey,
          privateKey: hexPrivateKey,
          useNip07: false
        };
        
        this.updateAuthUI();
        this.hideModal('auth-modal');
        this.loadFeed();
        input.value = '';
        
        // Fetch user's relay list (NIP-65) to discover their preferred relays
        setTimeout(() => {
          this.requestUserRelayList();
        }, 500);
        
        // Fetch contact list after a short delay to ensure relays are connected
        setTimeout(() => {
          console.log('Fetching contact list after private key import delay...');
          this.fetchContactList();
        }, 1000);
      } else {
        alert('Failed to store keys: ' + response.error);
      }
    } catch (error) {
      console.error('Import key error:', error);
      alert('Invalid private key format');
    }
  }
  
  generateNewKeys() {
    try {
      const privateKey = window.NostrTools.generateSecretKey();
      const publicKey = window.NostrTools.getPublicKey(privateKey);
      
      const npub = window.NostrTools.nip19.npubEncode(publicKey);
      const nsec = window.NostrTools.nip19.nsecEncode(privateKey);
      
      document.getElementById('generated-npub').value = npub;
      document.getElementById('generated-nsec').value = nsec;
      
      // Store for saving later (convert to hex for storage)
      const privateKeyHex = Array.isArray(privateKey) || privateKey instanceof Uint8Array ?
        this.bytesToHex(privateKey) : privateKey;
      this.generatedKeys = { publicKey, privateKey: privateKeyHex };
    } catch (error) {
      console.error('Key generation error:', error);
    }
  }
  
  async saveGeneratedKeys() {
    if (!this.generatedKeys) {
      alert('No keys generated');
      return;
    }
    
    try {
      const response = await this.sendMessage({
        type: 'STORE_KEYS',
        data: this.generatedKeys
      });
      
      if (response.success) {
        // Clear previous user data before setting new user
        this.clearUserData();
        
        this.currentUser = {
          ...this.generatedKeys,
          useNip07: false
        };
        
        this.updateAuthUI();
        this.hideModal('auth-modal');
        this.loadFeed();
        
        // Fetch user's relay list (NIP-65) to discover their preferred relays
        setTimeout(() => {
          this.requestUserRelayList();
        }, 500);
        
        // Fetch contact list after a short delay to ensure relays are connected
        setTimeout(() => {
          console.log('Fetching contact list after key generation delay...');
          this.fetchContactList();
        }, 1000);
      } else {
        alert('Failed to save keys: ' + response.error);
      }
    } catch (error) {
      console.error('Save keys error:', error);
      console.error('Error details:', error.message, error.stack);
      alert('Error saving keys: ' + error.message);
    }
  }
  
  clearUserData() {
    console.log('🧹 === CLEARING USER DATA ===');
    
    // Clear user state
    this.currentUser = null;
    
    // Clear user-specific data structures
    this.notes.clear();
    this.userFollows.clear();
    this.userMutes.clear();
    this.userReactions.clear();
    this.profiles.clear();
    this.profileRequests.clear();
    this.profileNotFound.clear();
    this.pendingNoteDisplays.clear();
    
    // Clear loading states
    this.contactListLoaded = false;
    this.muteListLoaded = false;
    this.lastContactListTimestamp = null;
    this.loadingMore = false;
    this.batchedLoadInProgress = false;
    this.feedHasMore = true;
    this.consecutiveEmptyLoads = 0;
    this.definitelyNoMoreNotes = false;
    
    // Clear feed content
    const feedElement = document.getElementById('feed');
    if (feedElement) {
      feedElement.innerHTML = '';
    }
    
    // Close all user-specific subscriptions
    const userSubscriptions = Array.from(this.subscriptions.keys()).filter(id => 
      id.startsWith('contacts-') || id.startsWith('mutes-') || id.startsWith('feed-') || id.startsWith('loadmore-')
    );
    userSubscriptions.forEach(subId => this.closeSubscription(subId));
    
    console.log('✅ User data cleared successfully');
  }

  async signOut() {
    try {
      await this.sendMessage({ type: 'CLEAR_KEYS' });
      this.clearUserData();
      
      // Force switch to trending feed if currently on Me feed
      if (this.currentFeed === 'me') {
          this.switchFeed('trending');
      } else {
        this.updateAuthUI();
        this.loadFeed();
      }
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }
  
  updateAuthUI() {
    const signedOut = document.getElementById('signed-out');
    const signedIn = document.getElementById('signed-in');
    const floatingBtn = document.getElementById('floating-compose-btn');
    const meFeedBtn = document.getElementById('me-feed-btn');
    const followingFeedBtn = document.getElementById('following-feed-btn');
    
    if (this.currentUser) {
      signedOut.classList.add('hidden');
      signedIn.classList.remove('hidden');
      floatingBtn.classList.remove('hidden');
      meFeedBtn.classList.remove('hidden');
      followingFeedBtn.classList.remove('hidden');
      
      // Switch to Following feed when user logs in (unless already on a specific feed)
      if (this.currentFeed === 'trending') {
        console.log('🔄 User logged in, switching from Trending to Following feed');
        this.currentFeed = 'following';
        this.updateFeedToggle();
      }
      meFeedBtn.disabled = false;
      followingFeedBtn.disabled = false;
      
      // Update user info immediately
      this.updateUserProfile();
      
      // Setup user profile dropdown
      this.setupUserProfileDropdown();
      
      // Request user's own profile and load it immediately
      this.requestProfile(this.currentUser.publicKey);
      this.loadUserProfile();
      
      // Fetch user's contact list (following) and mute list
      this.fetchContactList();
      this.fetchMuteList();
    } else {
      signedOut.classList.remove('hidden');
      signedIn.classList.add('hidden');
      floatingBtn.classList.add('hidden');
      meFeedBtn.classList.add('hidden');
      followingFeedBtn.classList.add('hidden');
      meFeedBtn.disabled = true;
      followingFeedBtn.disabled = true;
      
      // Switch to trending feed if on following
      if (this.currentFeed === 'following') {
        this.switchFeed('trending');
      }
    }
  }
  
  setupUserProfileDropdown() {
    if (this.userDropdownSetup) return;
    this.userDropdownSetup = true;
    
    const profileBtn = document.getElementById('user-profile-btn');
    const dropdown = document.getElementById('user-dropdown');
    
    if (!profileBtn || !dropdown) {
      console.error('Profile dropdown elements not found:', { profileBtn, dropdown });
      return;
    }
    
    // Toggle dropdown
    profileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      profileBtn.classList.toggle('open');
      dropdown.classList.toggle('show');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      profileBtn.classList.remove('open');
      dropdown.classList.remove('show');
    });
    
    // Handle dropdown actions
    document.getElementById('view-profile-btn').addEventListener('click', () => {
      if (this.currentUser) {
        const npub = window.NostrTools.nip19.npubEncode(this.currentUser.publicKey);
        const profileUrl = `https://jumble.social/users/${npub}`;
        window.open(profileUrl, 'jumble-social-tab');
      }
      profileBtn.classList.remove('open');
      dropdown.classList.remove('show');
    });
    
    document.getElementById('copy-key-btn').addEventListener('click', () => {
      if (this.currentUser) {
        const npub = window.NostrTools.nip19.npubEncode(this.currentUser.publicKey);
        this.copyTextToClipboard(npub, 'Your public key copied to clipboard');
      }
      profileBtn.classList.remove('open');
      dropdown.classList.remove('show');
    });
    
    document.getElementById('sign-out-btn').addEventListener('click', () => {
      this.signOut();
      profileBtn.classList.remove('open');
      dropdown.classList.remove('show');
    });
  }
  
  updateUserProfile() {
    if (!this.currentUser) return;
    
    const profile = this.profiles.get(this.currentUser.publicKey);
    const dropdownUserNameEl = document.getElementById('dropdown-user-name');
    const dropdownUserNpubEl = document.getElementById('dropdown-user-npub');
    const userAvatarEl = document.getElementById('user-avatar');
    const avatarPlaceholder = document.getElementById('user-avatar-placeholder');
    
    // Always show immediate feedback even without profile data
    const npub = window.NostrTools.nip19.npubEncode(this.currentUser.publicKey);
    const displayName = profile?.display_name || profile?.name || this.getUserDisplayName();
    const nip05 = profile?.nip05;
    
    // Set name in dropdown - show "Loading..." if no profile yet
    if (dropdownUserNameEl) {
      dropdownUserNameEl.textContent = profile ? displayName : 'Loading...';
    }
    if (dropdownUserNpubEl) {
      const formattedId = this.formatProfileIdentifier(nip05, this.currentUser.publicKey);
      dropdownUserNpubEl.textContent = formattedId;
      
      if (nip05) {
        dropdownUserNpubEl.setAttribute('data-nip05', 'true');
      } else {
        dropdownUserNpubEl.removeAttribute('data-nip05');
      }
    }
    
    // Update avatar immediately
    if (profile?.picture) {
      userAvatarEl.innerHTML = `
        <img src="${profile.picture}" alt="" class="avatar-img">
        <div class="avatar-placeholder" style="display: none;">${this.getAvatarPlaceholder(displayName)}</div>
      `;
    } else {
      // Show placeholder with initial characters from npub
      const placeholder = this.getAvatarPlaceholder(profile ? displayName : npub);
      if (avatarPlaceholder) {
        avatarPlaceholder.textContent = placeholder;
      }
    }
  }
  
  getUserDisplayName() {
    // This would normally fetch from user's profile
    // For now, return a truncated pubkey
    return this.currentUser.publicKey.substring(0, 8) + '...';
  }
  
  formatProfileIdentifier(nip05, pubkey) {
    // Handle the profile identifier (NIP-05 or npub)
    if (!nip05) {
      // No NIP-05, use truncated npub
      return window.NostrTools.nip19.npubEncode(pubkey).substring(0, 16) + '...';
    }
    
    // Check if it's a URL instead of proper NIP-05
    if (nip05.startsWith('http://') || nip05.startsWith('https://')) {
      return this.minifyUrl(nip05);
    }
    
    // Check if it's a very long string that should be truncated
    if (nip05.length > 30) {
      return nip05.substring(0, 27) + '...';
    }
    
    return nip05;
  }
  
  minifyUrl(url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      const path = urlObj.pathname;
      
      // For very short domains, show more
      if (domain.length <= 15) {
        if (path && path !== '/') {
          const shortPath = path.length > 10 ? path.substring(0, 7) + '...' : path;
          return domain + shortPath;
        }
        return domain;
      }
      
      // For longer domains, truncate
      return domain.length > 20 ? domain.substring(0, 17) + '...' : domain;
    } catch (e) {
      // If URL parsing fails, just truncate the string
      return url.length > 25 ? url.substring(0, 22) + '...' : url;
    }
  }
  
  handleFeedButtonClick(feedType) {
    console.log('🎯 FEED BUTTON CLICKED! Type:', feedType, 'Current:', this.currentFeed);
    
    if (this.currentFeed === feedType) {
      // Same feed clicked - refresh it
      console.log('🔄 Refreshing current feed:', feedType);
      this.refreshFeed();
    } else {
      // Different feed clicked - switch to it
      console.log('🔀 Switching feed from', this.currentFeed, 'to', feedType);
      this.switchFeed(feedType);
    }
  }
  
  switchFeed(feedType) {
    console.log('🔄 SWITCH FEED CALLED! Type:', feedType, 'Current:', this.currentFeed);
    
    // Close all existing subscriptions BEFORE changing currentFeed to prevent cross-feed contamination
    console.log('🚫 Closing all subscriptions before feed switch');
    this.subscriptions.forEach((subscription, subId) => {
      this.relayConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['CLOSE', subId]));
        }
      });
    });
    this.subscriptions.clear();
    
    this.currentFeed = feedType;
    
    // If switching to Following feed, refresh contact list to catch any external updates
    if (feedType === 'following' && this.currentUser) {
      console.log('🔄 Refreshing contact list when switching to Following feed');
      this.fetchContactList();
    }
    
    // Update UI - remove active from ALL buttons first (including user tabs)
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
    
    // Add active class to the selected button
    if (feedType === 'following') {
      document.getElementById('following-feed-btn').classList.add('active');
    } else if (feedType === 'trending') {
      document.getElementById('trending-feed-btn').classList.add('active');
    } else if (feedType === 'me') {
      document.getElementById('me-feed-btn').classList.add('active');
    }
    
    // Clear current feed and load new one
    const feedElement = document.getElementById('feed');
    feedElement.innerHTML = '';
    
    // Force DOM clearing with immediate re-render for Me feed
    if (feedType === 'me') {
      // Force immediate DOM update
      feedElement.style.display = 'none';
      setTimeout(() => {
        feedElement.style.display = 'block';
      }, 10);
    }
    
    // Subscriptions already closed above
    
    this.notes.clear();
    this.userReactions.clear();
    this.loadingMore = false;
    
    // Clear feed-specific data
    if (feedType === 'me') {
      this.trendingNoteIds.clear();
      this.trendingAuthors = null;
      this.meDaysLoaded = 0;
    } else if (feedType === 'trending') {
      this.meDaysLoaded = 0;
    }
    // Keep profiles cache - no need to refetch profile data
    
    // Mark as loaded since we're manually switching feeds
    this.initialFeedLoaded = true;
    this.loadFeed();
  }
  
  
  refreshFeed() {
    console.log('🔄 refreshFeed called - currentFeed:', this.currentFeed);
    // Clear current feed and reload
    document.getElementById('feed').innerHTML = '';
    this.notes.clear();
    this.userReactions.clear();
    this.profileNotFound.clear(); // Clear profile not found set to allow retry
    this.loadingMore = false;
    // Keep profiles cache - no need to refetch profile data
    
    this.loadFeed();
  }
  
  connectToRelays() {
    this.relays.forEach(relay => this.connectToRelay(relay));
  }

  async requestUserRelayList() {
    if (!this.currentUser) return;
    
    console.log('📡 Requesting user relay list (NIP-65)...');
    
    // Request user's relay list (kind 10002)
    const relayListFilter = {
      kinds: [10002],
      authors: [this.currentUser.publicKey],
      limit: 1
    };
    
    const subId = `relay-list-${Date.now()}`;
    const subscription = ['REQ', subId, relayListFilter];
    this.subscriptions.set(subId, subscription);
    
    // Send to all connected relays
    this.relayConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscription));
      }
    });
  }

  handleRelayListEvent(event) {
    console.log('📡 Processing user relay list event...');
    
    // Extract relay URLs from tags
    const relayUrls = event.tags
      .filter(tag => tag[0] === 'r')
      .map(tag => tag[1])
      .filter(url => url && url.startsWith('wss://'));
    
    console.log('📡 Found user relays:', relayUrls);
    
    // Add discovered relays to our relay list
    let newRelaysAdded = 0;
    relayUrls.forEach(relay => {
      if (!this.relays.includes(relay)) {
        this.relays.push(relay);
        this.userRelays.add(relay);
        newRelaysAdded++;
        
        // Connect to the new relay
        this.connectToRelay(relay);
      }
    });
    
    if (newRelaysAdded > 0) {
      console.log(`📡 Added ${newRelaysAdded} new user relays, total relays: ${this.relays.length}`);
      
      // Refresh the current feed to get content from new relays
      setTimeout(() => {
        console.log('🔄 Refreshing feed to include content from user relays...');
        this.loadFeed();
      }, 2000); // Wait 2 seconds for relay connections
    }
  }
  
  connectToRelay(relay) {
    // Don't reconnect if already connected
    if (this.relayConnections.has(relay)) {
      console.log(`Already connected to ${relay}, skipping`);
      return;
    }
    
    // Initialize reconnection attempt counter if not exists
    if (!this.reconnectAttempts) {
      this.reconnectAttempts = new Map();
    }
    
    try {
      const ws = new WebSocket(relay);
      
      ws.onopen = () => {
        console.log(`Connected to ${relay}`);
        this.relayConnections.set(relay, ws);
        // Reset reconnection attempts on successful connection
        this.reconnectAttempts.set(relay, 0);
        
        // Load feed when first relay connects
        console.log('🔌 Relay connected, checking if initial feed needs loading. initialFeedLoaded:', this.initialFeedLoaded);
        if (!this.initialFeedLoaded) {
          console.log('🔄 Loading initial feed after relay connection');
          this.initialFeedLoaded = true;
          this.loadFeed();
        } else {
          console.log('📋 Initial feed already loaded, skipping');
        }
        
        // Fetch contact list if user is signed in but we haven't loaded it yet
        if (this.currentUser && !this.contactListLoaded) {
          console.log('Fetching contact list on relay connection...');
          this.fetchContactList();
        }
      };
      
      ws.onmessage = (event) => {
        this.handleRelayMessage(relay, JSON.parse(event.data));
      };
      
      ws.onclose = () => {
        console.log(`Disconnected from ${relay}`);
        this.relayConnections.delete(relay);
        
        // Implement exponential backoff to prevent aggressive reconnection
        const attempts = this.reconnectAttempts.get(relay) || 0;
        if (attempts >= 5) {
          console.log(`Max reconnection attempts reached for ${relay}, giving up`);
          return;
        }
        
        const backoffDelay = Math.min(5000 * Math.pow(2, attempts), 60000); // Cap at 60 seconds
        console.log(`Will reconnect to ${relay} in ${backoffDelay}ms (attempt ${attempts + 1})`);
        this.reconnectAttempts.set(relay, attempts + 1);
        
        setTimeout(() => {
          if (!this.relayConnections.has(relay)) {
            console.log(`Attempting to reconnect to ${relay}`);
            this.connectToRelay(relay);
          }
        }, backoffDelay);
      };
      
      ws.onerror = (error) => {
        console.error(`Error with ${relay}:`, error);
      };
    } catch (error) {
      console.error(`Failed to connect to ${relay}:`, error);
    }
  }
  
  handleRelayMessage(relay, message) {
    const [type, subId, event] = message;
    
    if (type === 'EVENT' && event) {
      this.handleNote(event);
    } else if (type === 'EOSE') {
      // End of stored events
      console.log(`📋 EOSE received for subscription: ${subId}`);
      
      // Special handling for trending feed to show summary
      if (subId.startsWith('trending-feed-')) {
        console.log(`🎯 TRENDING FEED LOADED - Authors collected: ${this.trendingAuthors ? this.trendingAuthors.size : 0}`);
        console.log(`🎯 First 5 trending authors:`, this.trendingAuthors ? [...this.trendingAuthors].slice(0, 5).map(a => a.substring(0, 16) + '...') : 'None');
      }
      
      // For load more subscriptions, track EOSE completion (excluding Me feed which uses its own system)
      if (subId.startsWith('loadmore-') || subId.startsWith('trending-loadmore-')) {
        // Track completed batches for batched operations
        if (subId.includes('batch')) {
          if (!this.completedBatches) this.completedBatches = new Set();
          
          // Check if this EOSE is from the current batch operation
          const isCurrentBatchOperation = (this.currentBatchTimestamp && subId.includes(this.currentBatchTimestamp)) && this.batchedLoadInProgress;
          
          if (isCurrentBatchOperation) {
            // Only add to completed batches if not already present (prevent relay duplicates)
            const wasNew = !this.completedBatches.has(subId);
            this.completedBatches.add(subId);
            
            // Only log/track if this was a new completion (not a relay duplicate)
            if (wasNew) {
              if (subId.startsWith('me-loadmore-')) {
                console.log(`🙋 Me feed batch EOSE (NEW): ${subId.substring(0, 30)}..., completed: ${this.completedBatches.size}/${this.expectedBatches}`);
              } else {
                const batchIndex = subId.match(/batch-(\d+)-/)?.[1] || 'unknown';
                console.log(`📋 Following feed batch EOSE (NEW): batch-${batchIndex}, completed: ${this.completedBatches.size}/${this.expectedBatches}`);
                
              }
              
              // Check if all batches are complete
              if (this.completedBatches.size >= this.expectedBatches && this.batchedLoadInProgress) {
                console.log('🎯 All batches completed! Finalizing batch load...');
                this.finalizeBatchedLoad();
              }
            } else {
              const batchIndex = subId.match(/batch-(\d+)-/)?.[1] || 'unknown';
              console.log(`📋 Batch EOSE (DUPLICATE): batch-${batchIndex}, ignoring relay duplicate`);
            }
          } else {
            console.log(`📋 Batch EOSE (OLD OPERATION): ${subId}, ignoring from previous batch operation`);
          }
        } else {
          // Non-batched load more - check normally (includes Me feed)
          if (this.loadingMore) {
            const notesReceived = this.notes.size - this.loadMoreStartNoteCount;
            console.log(`📋 Load more received ${notesReceived} new notes`);
            
            if (notesReceived === 0) {
              this.consecutiveEmptyLoads++;
              console.log(`📋 EOSE: Load more returned no results and no timestamp advancement (${this.consecutiveEmptyLoads} consecutive empty loads)`);
              
              const emptyLoadThreshold = 3;
              if (this.consecutiveEmptyLoads >= emptyLoadThreshold) {
                console.log(`📋 EOSE: ${this.consecutiveEmptyLoads} consecutive empty loads (threshold: ${emptyLoadThreshold}), setting feedHasMore = false`);
                this.feedHasMore = false;
              }
            } else {
              this.consecutiveEmptyLoads = 0; // Reset counter when we get results
              this.feedHasMore = true;
              console.log(`📋 EOSE: Got ${notesReceived} new notes, feedHasMore = true`);
            }
            this.loadingMore = false;
            
            // Reset the loadMore tracking variables for next operation
            this.loadMoreStartNoteCount = this.notes.size;
            this.loadMoreStartTimestamp = this.oldestNoteTimestamp;
          }
        }
      }
      
      // Only call hideLoading for non-batched load more operations
      // Individual batch EOSE events should not update UI state
      if (!((subId.startsWith('loadmore-') || subId.startsWith('trending-loadmore-')) && subId.includes('batch'))) {
        this.hideLoading();
      } else {
        console.log(`📋 Skipping hideLoading for batch EOSE: ${subId}`);
      }
    } else if (type === 'CLOSED') {
      // Subscription closed - remove from pending if it was a profile request
      if (subId.startsWith('profile-')) {
        const pubkey = subId.replace('profile-', '');
        this.profileRequests.delete(pubkey);
      }
    }
  }

  handleRepost(repostEvent) {
    console.log('🔁 Handling repost from:', repostEvent.pubkey.substring(0, 16) + '...', 'Event ID:', repostEvent.id.substring(0, 16) + '...', 'Current feed:', this.currentFeed);
    
    // Proactively fetch reposter's profile if not cached
    if (!this.profiles.has(repostEvent.pubkey)) {
      this.fetchProfileForAuthor(repostEvent.pubkey);
    }
    
    // Find the original note being reposted from the 'e' tag
    const eTags = repostEvent.tags?.filter(tag => tag[0] === 'e') || [];
    if (eTags.length === 0) {
      console.log('🚫 Repost event has no e tags, skipping');
      return;
    }
    
    const originalNoteId = eTags[0][1];
    console.log('🔁 Repost of note:', originalNoteId.substring(0, 16) + '...');
    
    // Check if we have the original note
    const originalNote = this.notes.get(originalNoteId);
    if (originalNote) {
      // We have the original note, display it as a repost
      this.displayRepost(repostEvent, originalNote);
    } else {
      // We don't have the original note yet, try to fetch it
      console.log('🔄 Original note not found, attempting to fetch:', originalNoteId.substring(0, 16) + '...');
      this.fetchOriginalNoteForRepost(repostEvent, originalNoteId);
    }
  }

  async fetchOriginalNoteForRepost(repostEvent, originalNoteId) {
    // Create subscription to fetch the specific original note
    const subscription = ['REQ', `repost-${Date.now()}`, {
      ids: [originalNoteId]
    }];
    
    // Send to all connected relays
    this.relayConnections.forEach((ws, relay) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscription));
        console.log(`📤 Fetching original note for repost from: ${relay}`);
      }
    });
    
    // Store the repost event temporarily
    if (!this.pendingReposts) {
      this.pendingReposts = new Map();
    }
    this.pendingReposts.set(originalNoteId, repostEvent);
  }

  displayRepost(repostEvent, originalNote) {
    // Check if we have both profiles
    const hasReposterProfile = this.profiles.has(repostEvent.pubkey);
    const hasOriginalProfile = this.profiles.has(originalNote.pubkey);
    
    console.log('🔁 displayRepost - Reposter profile cached:', hasReposterProfile, 'Original profile cached:', hasOriginalProfile);
    
    // If we have both profiles, check for repost aggregation
    if (hasReposterProfile && hasOriginalProfile) {
      console.log('✅ Both profiles available, checking for repost aggregation');
      this.handleRepostAggregation(repostEvent, originalNote);
      return;
    }
    
    // Missing profiles - queue the repost and fetch profiles
    console.log('⏸️ Queueing repost until profiles are available');
    this.queueRepostForProfiles(repostEvent, originalNote);
    
    // Fetch missing profiles
    if (!hasReposterProfile) {
      console.log('📤 Fetching reposter profile:', repostEvent.pubkey.substring(0, 16) + '...');
      this.fetchProfileForAuthor(repostEvent.pubkey);
    }
    if (!hasOriginalProfile) {
      console.log('📤 Fetching original author profile:', originalNote.pubkey.substring(0, 16) + '...');
      this.fetchProfileForAuthor(originalNote.pubkey);
    }
  }
  
  // Handle repost aggregation - group multiple reposts of the same note
  handleRepostAggregation(repostEvent, originalNote) {
    const originalNoteId = originalNote.id;
    
    // Check if this note has already been reposted
    if (this.repostAggregation.has(originalNoteId)) {
      // Add this reposter to the existing aggregation
      const aggregation = this.repostAggregation.get(originalNoteId);
      
      // Avoid duplicate reposters (same user reposting multiple times)
      if (!aggregation.reposters.some(r => r.pubkey === repostEvent.pubkey)) {
        aggregation.reposters.push({
          pubkey: repostEvent.pubkey,
          timestamp: repostEvent.created_at,
          eventId: repostEvent.id
        });
        
        // Sort reposters by timestamp (most recent first)
        aggregation.reposters.sort((a, b) => b.timestamp - a.timestamp);
        
        console.log(`📚 Added reposter to aggregation - Total reposters: ${aggregation.reposters.length}`);
        
        // Update the existing repost display
        this.updateAggregatedRepostDisplay(originalNoteId);
      } else {
        console.log('🔄 Duplicate repost from same user, ignoring');
      }
    } else {
      // First repost of this note - create new aggregation
      const aggregation = {
        originalNote,
        reposters: [{
          pubkey: repostEvent.pubkey,
          timestamp: repostEvent.created_at,
          eventId: repostEvent.id
        }],
        displayTimestamp: repostEvent.created_at,
        domElementId: `repost-aggregated-${originalNoteId}`
      };
      
      this.repostAggregation.set(originalNoteId, aggregation);
      console.log('📝 Created new repost aggregation for note:', originalNoteId.substring(0, 16) + '...');
      
      // Display the repost normally (first one shows as regular repost)
      this.displayRepostImmediate(repostEvent, originalNote);
    }
  }
  
  // Update the display of an aggregated repost to show multiple reposters
  updateAggregatedRepostDisplay(originalNoteId) {
    const aggregation = this.repostAggregation.get(originalNoteId);
    if (!aggregation || aggregation.reposters.length <= 1) return;
    
    // Find the DOM element for this repost
    const repostElement = document.querySelector(`[data-original-event-id="${originalNoteId}"]`);
    if (!repostElement) {
      console.log('⚠️ Could not find DOM element for repost aggregation update');
      return;
    }
    
    // Update the repost indicator text
    const repostIndicator = repostElement.querySelector('.repost-indicator span');
    if (!repostIndicator) {
      console.log('⚠️ Could not find repost indicator for aggregation update');
      return;
    }
    
    const primaryReposter = aggregation.reposters[0];
    const primaryProfile = this.profiles.get(primaryReposter.pubkey);
    const primaryName = primaryProfile?.display_name || primaryProfile?.name || this.getAuthorName(primaryReposter.pubkey);
    
    let repostText;
    if (aggregation.reposters.length === 2) {
      const secondReposter = aggregation.reposters[1];
      const secondProfile = this.profiles.get(secondReposter.pubkey);
      const secondName = secondProfile?.display_name || secondProfile?.name || this.getAuthorName(secondReposter.pubkey);
      repostText = `${primaryName} and ${secondName} reposted`;
    } else {
      const otherCount = aggregation.reposters.length - 1;
      repostText = `${primaryName} and ${otherCount} others reposted`;
    }
    
    repostIndicator.textContent = repostText;
    
    // Add aggregated styling and click handler
    const repostIndicatorElement = repostIndicator.parentElement;
    if (!repostIndicatorElement.classList.contains('aggregated')) {
      repostIndicatorElement.classList.add('aggregated');
      repostIndicatorElement.title = 'Click to see all reposters';
      
      // Add click handler to show all reposters
      repostIndicatorElement.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showRepostDetails(originalNoteId);
      });
    }
    
    console.log(`📚 Updated repost display: ${repostText}`);
  }
  
  // Show details of all reposters when clicking on aggregated repost indicator
  showRepostDetails(originalNoteId) {
    const aggregation = this.repostAggregation.get(originalNoteId);
    if (!aggregation) return;
    
    console.log('📋 Showing repost details for', aggregation.reposters.length, 'reposters');
    
    // Create a simple tooltip-style display
    const repostElement = document.querySelector(`[data-original-event-id="${originalNoteId}"]`);
    if (!repostElement) return;
    
    // Remove any existing tooltip
    const existingTooltip = document.querySelector('.repost-details-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }
    
    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'repost-details-tooltip';
    tooltip.innerHTML = `
      <div class="repost-details-header">Reposted by:</div>
      <div class="repost-details-list">
        ${aggregation.reposters.map(reposter => {
          const profile = this.profiles.get(reposter.pubkey);
          const name = profile?.display_name || profile?.name || this.getAuthorName(reposter.pubkey);
          const timeAgo = this.formatTimeAgo(reposter.timestamp);
          return `<div class="repost-details-item">
            <strong>${name}</strong>
            <span class="repost-time">${timeAgo}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="repost-details-close">✕</div>
    `;
    
    // Position tooltip near the repost indicator
    const rect = repostElement.getBoundingClientRect();
    tooltip.style.position = 'fixed';
    tooltip.style.top = (rect.top + window.scrollY - 10) + 'px';
    tooltip.style.left = (rect.left + 20) + 'px';
    tooltip.style.zIndex = '1000';
    
    document.body.appendChild(tooltip);
    
    // Add close handlers
    tooltip.querySelector('.repost-details-close').addEventListener('click', () => {
      tooltip.remove();
    });
    
    // Close when clicking outside
    setTimeout(() => {
      document.addEventListener('click', function closeTooltip(e) {
        if (!tooltip.contains(e.target)) {
          tooltip.remove();
          document.removeEventListener('click', closeTooltip);
        }
      });
    }, 10);
  }
  
  // Queue reposts that are waiting for profiles
  queueRepostForProfiles(repostEvent, originalNote) {
    if (!this.pendingRepostQueue) {
      this.pendingRepostQueue = [];
    }
    
    const queueEntry = {
      repostEvent,
      originalNote,
      timestamp: Date.now()
    };
    
    this.pendingRepostQueue.push(queueEntry);
    console.log(`📋 Queued repost - Queue size: ${this.pendingRepostQueue.length}`);
  }
  
  // Process queued reposts when profiles become available
  processRepostQueue() {
    if (!this.pendingRepostQueue || this.pendingRepostQueue.length === 0) {
      return;
    }
    
    console.log(`🔄 Processing repost queue - ${this.pendingRepostQueue.length} items`);
    
    const readyReposts = [];
    const stillWaiting = [];
    
    for (const entry of this.pendingRepostQueue) {
      const hasReposterProfile = this.profiles.has(entry.repostEvent.pubkey);
      const hasOriginalProfile = this.profiles.has(entry.originalNote.pubkey);
      
      if (hasReposterProfile && hasOriginalProfile) {
        readyReposts.push(entry);
      } else {
        // Only keep items that aren't too old (avoid infinite queue buildup)
        const age = Date.now() - entry.timestamp;
        if (age < 30000) { // Keep for max 30 seconds
          stillWaiting.push(entry);
        } else {
          console.log('⏰ Dropping old queued repost after 30s timeout');
        }
      }
    }
    
    // Update queue with items still waiting
    this.pendingRepostQueue = stillWaiting;
    
    // Display ready reposts with aggregation
    for (const entry of readyReposts) {
      console.log('✅ Profile now available, processing queued repost with aggregation');
      this.handleRepostAggregation(entry.repostEvent, entry.originalNote);
    }
  }
  
  displayRepostImmediate(repostEvent, originalNote) {
    // FILTER OUT MUTED USERS - Check if the reposter is muted
    if (this.userMutes.has(repostEvent.pubkey)) {
      console.log('🔇 Filtering out repost from muted user:', repostEvent.pubkey.substring(0, 16) + '...');
      return;
    }
    
    // Apply feed-specific filtering for reposts
    if (this.currentFeed === 'following') {
      if (!this.userFollows.has(repostEvent.pubkey)) {
        console.log('🚫 Filtering out repost from unfollowed user in following feed:', repostEvent.pubkey.substring(0, 16) + '...');
        return;
      }
    } else if (this.currentFeed === 'me') {
      if (repostEvent.pubkey !== this.currentUser?.publicKey) {
        console.log('🚫 Me feed: Filtering out repost from different user:', repostEvent.pubkey.substring(0, 16) + '...');
        return;
      }
    }
    
    // Check if we already displayed this repost
    const repostId = `repost-${repostEvent.id}`;
    if (document.querySelector(`[data-event-id="${repostId}"]`)) {
      console.log('📋 Repost already displayed, skipping:', repostEvent.id.substring(0, 16) + '...');
      return;
    }
    
    // Create repost display
    const repostDiv = this.createRepostElement(repostEvent, originalNote);
    
    // Insert into feed in chronological order
    const feed = document.getElementById('feed');
    const existingNotes = Array.from(feed.children);
    let inserted = false;
    
    for (const existingNote of existingNotes) {
      const existingTimestamp = parseInt(existingNote.dataset.timestamp);
      if (repostEvent.created_at > existingTimestamp) {
        feed.insertBefore(repostDiv, existingNote);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      feed.appendChild(repostDiv);
    }
  }

  handleZapReceipt(event) {
    console.log('⚡ Processing zap receipt:', event.id.substring(0, 16) + '...');
    console.log('🔍 Full zap receipt event:', event);
    
    // Check if this is for our target debug note
    const debugNevent = 'nevent1qvzqqqqqqypzpkz9z7qz5s682lzk46ry90lmf5nwtt0qwys9xagzz45q7kyku4umqqsrvnl4cw04pfz0lfxj4wshfdrelvqzpcnzm9wcz7rreuqe5hmddlq3fqthk';
    let isDebugNote = false;
    
    try {
      // Parse the zap receipt according to NIP-57
      let zapRequest = null;
      let zappedEventId = null;
      let amount = 0;
      
      // Look for the zap request in the description tag
      const descriptionTag = event.tags.find(tag => tag[0] === 'description');
      if (descriptionTag && descriptionTag[1]) {
        try {
          zapRequest = JSON.parse(descriptionTag[1]);
          console.log('📋 Zap request parsed from description:', zapRequest);
          
          // Extract zapped event ID and amount from zap request
          const eventTag = zapRequest.tags?.find(tag => tag[0] === 'e');
          const amountTag = zapRequest.tags?.find(tag => tag[0] === 'amount');
          
          if (eventTag) {
            zappedEventId = eventTag[1];
            console.log('🎯 Zapped event ID from zap request:', zappedEventId.substring(0, 16) + '...');
          }
          
          if (amountTag) {
            const msats = parseInt(amountTag[1]);
            amount = msats / 1000; // Convert from msats to sats
            console.log('💰 Zap amount from zap request:', msats, 'msats =', amount, 'sats');
          }
        } catch (parseError) {
          console.error('❌ Failed to parse zap request:', parseError);
          return;
        }
      }
      
      // Also check for bolt11 invoice to extract amount if not found in zap request
      const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
      console.log('🎫 Bolt11 tag found:', bolt11Tag);
      
      if (bolt11Tag && bolt11Tag[1] && amount === 0) {
        try {
          // Simple bolt11 amount extraction (look for amount in invoice)
          const invoice = bolt11Tag[1];
          console.log('🎫 Parsing bolt11 invoice:', invoice.substring(0, 50) + '...');
          
          // Lightning invoice format: lnbc[amount][multiplier]1...
          // Multipliers: m (milli, 0.001), u (micro, 0.000001), n (nano, 0.000000001), p (pico, 0.000000000001)
          // If no multiplier, amount is in bitcoin
          const amountMatch = invoice.match(/lnbc(\d+)([munp])?1/);
          console.log('🎫 Amount match result:', amountMatch);
          
          if (amountMatch) {
            const value = parseInt(amountMatch[1]);
            const unit = amountMatch[2] || ''; // Could be empty (bitcoin)
            
            console.log('🎫 Parsed values - value:', value, 'unit:', unit || 'btc');
            
            // Convert to sats based on unit (1 BTC = 100,000,000 sats)
            if (unit === 'm') {
              amount = value * 100000; // milli-bitcoin to sats (0.001 BTC * 100M sats/BTC)
            } else if (unit === 'u') {
              amount = value * 100; // micro-bitcoin to sats (0.000001 BTC * 100M sats/BTC)
            } else if (unit === 'n') {
              amount = value / 10; // nano-bitcoin to sats (0.000000001 BTC * 100M sats/BTC)
            } else if (unit === 'p') {
              amount = value / 10000; // pico-bitcoin to sats (0.000000000001 BTC * 100M sats/BTC)
            } else {
              // No unit means bitcoin
              amount = value * 100000000; // bitcoin to sats
            }
            
            console.log('💰 Extracted amount from bolt11:', value, unit || 'btc', '=', amount, 'sats');
          }
        } catch (invoiceError) {
          console.error('❌ Failed to parse bolt11 amount:', invoiceError);
        }
      }
      
      // If we still don't have the zapped event ID, try to find it in the zap receipt tags directly
      if (!zappedEventId) {
        const eventTags = event.tags.filter(tag => tag[0] === 'e');
        if (eventTags.length > 0) {
          zappedEventId = eventTags[0][1]; // Use the first 'e' tag
          console.log('🎯 Found zapped event ID from zap receipt tags:', zappedEventId.substring(0, 16) + '...');
        }
      }
      
      // Check if this is our debug note (try to decode nevent if needed)
      try {
        const decodedNevent = window.NostrTools.nip19.decode(debugNevent);
        if (decodedNevent.type === 'nevent' && decodedNevent.data.id === zappedEventId) {
          isDebugNote = true;
          console.log('🎯🎯🎯 DEBUG NOTE FOUND! Processing zap receipt for target note:', zappedEventId);
        }
      } catch (e) {
        // Ignore decode errors
      }
      
      // Also check if the zapped event ID matches our target (in case we have the raw note ID)
      if (zappedEventId === '04a4cde010c7fe69720ac4e7e07b1b15e30b1ac64da6ad9d7d46eb0ff0ff11ba') {
        isDebugNote = true;
        console.log('🎯🎯🎯 DEBUG NOTE FOUND! Processing zap receipt for raw note ID');
      }
      
      if (!zappedEventId) {
        console.log('❌ No zapped event ID found in zap receipt');
        return;
      }
      
      // Store the zap receipt
      if (!this.zapReceipts) {
        this.zapReceipts = new Map();
      }
      
      if (!this.zapReceipts.has(zappedEventId)) {
        this.zapReceipts.set(zappedEventId, []);
      }
      
      const zapInfo = {
        id: event.id,
        sender: zapRequest?.pubkey || event.pubkey,
        amount: amount,
        comment: zapRequest?.content || '',
        timestamp: event.created_at,
        bolt11: bolt11Tag?.[1] || ''
      };
      
      // Check for duplicates before adding
      const existingZaps = this.zapReceipts.get(zappedEventId);
      const isDuplicate = existingZaps.some(existing => existing.id === event.id);
      
      if (isDuplicate) {
        if (isDebugNote) {
          console.log('🎯⚠️ DEBUG NOTE: Duplicate zap receipt detected, skipping:', event.id.substring(0, 16) + '...');
        } else {
          console.log('⚠️ Duplicate zap receipt detected, skipping:', event.id.substring(0, 16) + '...');
        }
        return;
      }
      
      this.zapReceipts.get(zappedEventId).push(zapInfo);
      
      if (isDebugNote) {
        console.log('🎯✅ DEBUG NOTE: Zap receipt stored for event:', zappedEventId.substring(0, 16) + '...', 'Amount:', amount, 'sats');
        console.log('🎯📊 DEBUG NOTE: Total zaps for this note:', existingZaps.length + 1, 'zaps');
        console.log('🎯📋 DEBUG NOTE: All zap receipts so far:', this.zapReceipts.get(zappedEventId));
      } else {
        console.log('✅ Zap receipt stored for event:', zappedEventId.substring(0, 16) + '...', 'Amount:', amount, 'sats');
        console.log('📊 Total zaps for this note:', existingZaps.length + 1, 'zaps');
      }
      
      // Update the zap display for the note with retry logic
      this.updateZapDisplayWithRetry(zappedEventId);
      
      // Check if this zap receipt matches our current payment monitoring
      this.checkPaymentCompletion(zapInfo, zappedEventId);
      
    } catch (error) {
      console.error('❌ Error processing zap receipt:', error);
    }
  }
  
  updateZapDisplayWithRetry(eventId, attempt = 1, maxAttempts = 5) {
    const success = this.updateZapDisplay(eventId);
    
    if (!success && attempt < maxAttempts) {
      console.log(`🔄 Retrying zap display update for ${eventId.substring(0, 16)}... (attempt ${attempt + 1}/${maxAttempts})`);
      
      // Use shorter delays for more responsive updates
      const delay = attempt <= 2 ? 500 * attempt : 1000 * attempt; // 500ms, 1s, 3s, 4s, 5s
      
      setTimeout(() => {
        this.updateZapDisplayWithRetry(eventId, attempt + 1, maxAttempts);
      }, delay);
    } else if (success) {
      console.log(`✅ Zap display updated successfully for ${eventId.substring(0, 16)} on attempt ${attempt}`);
    } else {
      console.log(`❌ Failed to update zap display for ${eventId.substring(0, 16)} after ${maxAttempts} attempts`);
    }
  }

  updateZapDisplay(eventId) {
    console.log('🔄 updateZapDisplay called for:', eventId.substring(0, 16) + '...');
    
    // Look for regular note first
    let noteElement = document.querySelector(`.note[data-event-id="${eventId}"]`);
    let zapButton = null;
    
    if (noteElement) {
      zapButton = noteElement.querySelector('.zap-action');
      console.log('📋 Found regular note element and zap button:', !!zapButton);
    } else {
      // If not found as regular note, look for repost containing this note
      noteElement = document.querySelector(`.repost[data-event-id="repost-${eventId}"]`);
      if (noteElement) {
        zapButton = noteElement.querySelector('.zap-action');
        console.log('📋 Found repost element and zap button:', !!zapButton);
      } else {
        // Last resort: search for zap button directly with this event ID (for cases where zap button uses original note ID)
        zapButton = document.querySelector(`.zap-action[data-event-id="${eventId}"]`);
        if (zapButton) {
          noteElement = zapButton.closest('.note, .repost');
          console.log('📋 Found zap button directly and parent element:', !!noteElement);
        } else {
          console.log('❌ No note element or zap button found for event ID:', eventId.substring(0, 16) + '...');
          console.log('🔍 All note elements:', document.querySelectorAll('.note, .repost').length);
          console.log('🔍 All zap buttons:', document.querySelectorAll('.zap-action').length);
          return false;
        }
      }
    }
    
    if (!noteElement || !zapButton) {
      console.log('📝 Note element not found for zap update:', eventId.substring(0, 16) + '...');
      return false;
    }
    
    const zapReceipts = this.zapReceipts?.get(eventId) || [];
    if (zapReceipts.length === 0) {
      console.log('📝 No zap receipts found for event:', eventId.substring(0, 16) + '...');
      return false;
    }
    
    // Calculate total zap amount (round to whole sats)
    console.log('🧮 Calculating zap total for note:', eventId.substring(0, 16) + '...');
    console.log('📋 All zap receipts for this note:', zapReceipts);
    
    const amounts = zapReceipts.map(zap => {
      console.log(`💰 Zap ${zap.id.substring(0, 8)}: ${zap.amount} sats`);
      return zap.amount;
    });
    
    const totalAmount = Math.round(zapReceipts.reduce((sum, zap) => sum + zap.amount, 0));
    console.log('🧮 Total calculation:', amounts, '= Sum:', zapReceipts.reduce((sum, zap) => sum + zap.amount, 0), '= Rounded:', totalAmount);
    
    // Update zap button to show total amount - keep same SVG, change color to yellow
    zapButton.innerHTML = `
      <svg width="14" height="16" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15.9025 6.11111C15.7069 5.64316 15.2505 5.34188 14.7353 5.34188H12.3358L14.6919 1.9359C14.9549 1.55342 14.9831 1.0641 14.7636 0.660256C14.5441 0.254273 14.1181 0 13.6486 0H6.9109C6.48925 0 6.09585 0.207265 5.86112 0.551282L0.212306 8.88462C-0.046335 9.26496 -0.070243 9.75214 0.149276 10.156C0.368795 10.5598 0.794793 10.8098 1.25991 10.8098H4.65485L0.996924 18.2179C0.727416 18.7628 0.894772 19.4124 1.39684 19.7671C1.61201 19.9188 1.86631 20 2.13147 20C2.46401 20 2.77699 19.8739 3.01607 19.6453L15.6221 7.46581C15.9894 7.11111 16.1003 6.57906 15.9047 6.11325L15.9025 6.11111ZM11.2687 2.47863L8.91265 5.88462C8.64967 6.26709 8.62141 6.75641 8.84093 7.16026C9.06045 7.56624 9.48645 7.82051 9.95591 7.82051H11.6556L6.45447 12.8462L7.80419 10.1154C7.99546 9.72863 7.97155 9.27991 7.73899 8.91667C7.50643 8.55128 7.10869 8.33547 6.66965 8.33547H3.61594L7.58685 2.48077H11.2687V2.47863Z" fill="currentColor"/>
      </svg>
      <span class="zap-count">${totalAmount}</span>
    `;
    
    // Add visual indicator for successful zap - yellow color
    zapButton.style.color = '#eab308'; // Yellow color for zapped notes
    
    console.log('✅ Updated zap display for note:', eventId.substring(0, 16) + '...', 'Total:', totalAmount, 'sats');
    return true; // Successfully updated
  }
  
  requestZapReceipts(eventId) {
    // Don't request if we already have zap receipts for this event
    if (this.zapReceipts?.has(eventId) && this.zapReceipts.get(eventId).length > 0) {
      console.log('⚡ Already have zap receipts for:', eventId.substring(0, 16) + '...');
      return;
    }
    
    // Also check if we've recently requested this to avoid spam
    if (!this.zapReceiptRequests) {
      this.zapReceiptRequests = new Set();
    }
    
    if (this.zapReceiptRequests.has(eventId)) {
      console.log('⚡ Already requested zap receipts for:', eventId.substring(0, 16) + '...');
      return;
    }
    
    this.zapReceiptRequests.add(eventId);
    console.log('📡 Requesting zap receipts for note:', eventId.substring(0, 16) + '...');
    
    // Create a subscription specifically for zap receipts for this note
    const subId = `zap-receipts-${eventId.substring(0, 8)}-${Date.now()}`;
    const filter = {
      kinds: [9735], // Zap receipts only
      '#e': [eventId], // Events that reference this note ID
      limit: 50 // Get up to 50 zap receipts
    };
    
    const subscription = ['REQ', subId, filter];
    this.subscriptions.set(subId, subscription);
    
    // Send to all connected relays
    this.relayConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscription));
        console.log('📤 Sent zap receipt request to relay for:', eventId.substring(0, 16) + '...');
      }
    });
    
    // Clean up subscription after 10 seconds
    setTimeout(() => {
      this.relayConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['CLOSE', subId]));
        }
      });
      this.subscriptions.delete(subId);
      console.log('🧹 Cleaned up zap receipt subscription for:', eventId.substring(0, 16) + '...');
    }, 10000);
  }
  
  checkPaymentCompletion(zapInfo, zappedEventId) {
    // Check if we're currently monitoring a payment and if this zap receipt matches
    if (!this.currentZapInvoice) {
      return;
    }
    
    // Check if the zapped event matches the one we're monitoring
    if (zappedEventId === this.currentZapInvoice.eventId) {
      console.log('🎯 Received zap receipt for monitored event!');
      
      // Check if this zap receipt includes our invoice (bolt11 match)
      if (zapInfo.bolt11 && zapInfo.bolt11 === this.currentZapInvoice.invoice) {
        console.log('💰 Payment confirmed! Invoice matches exactly.');
        this.showPaymentSuccessMessage(this.currentZapInvoice.amount);
        
        // Stop monitoring immediately since we found our exact payment
        setTimeout(() => {
          this.stopPaymentMonitoring();
          this.currentZapInvoice = null;
        }, 2000); // Brief delay to show success message
        return;
      }
      
      // Alternative check: if the amount and timing are close, it's likely our payment
      const timeDiff = Math.abs(zapInfo.timestamp - (this.currentZapInvoice.timestamp / 1000));
      const amountMatches = zapInfo.amount === this.currentZapInvoice.amount;
      
      if (amountMatches && timeDiff < 300) { // Within 5 minutes
        console.log('💰 Payment likely confirmed based on amount and timing.');
        console.log('⏰ Time difference:', timeDiff, 'seconds');
        this.showPaymentSuccessMessage(this.currentZapInvoice.amount);
        
        // Stop monitoring after likely match found
        setTimeout(() => {
          this.stopPaymentMonitoring();
          this.currentZapInvoice = null;
        }, 3000); // Slightly longer delay for likely matches
      } else {
        console.log('❓ Zap receipt received for monitored event but doesn\'t match our payment details');
        console.log('🔍 Amount match:', amountMatches, '(expected:', this.currentZapInvoice.amount, 'got:', zapInfo.amount, ')');
        console.log('🔍 Time diff:', timeDiff, 'seconds');
      }
    }
  }

  handleReaction(reactionEvent) {
    // Only show reactions from the current user
    if (!this.currentUser || reactionEvent.pubkey !== this.currentUser.publicKey) {
      return;
    }
    
    // Find the note being reacted to from the 'e' tag
    const eTags = reactionEvent.tags?.filter(tag => tag[0] === 'e') || [];
    if (eTags.length === 0) {
      console.log('🚫 Reaction event has no e tags, skipping');
      return;
    }
    
    const targetNoteId = eTags[0][1];
    
    // Find all note elements that display this note (could be original note or reposts)
    const noteElements = document.querySelectorAll(`[data-event-id="${targetNoteId}"], [data-original-event-id="${targetNoteId}"]`);
    
    if (noteElements.length === 0) {
      return;
    }
    
    // Update reaction display on all relevant elements
    noteElements.forEach(noteElement => {
      const reactionButton = noteElement.querySelector('.reaction-action');
      if (reactionButton) {
        // Show the reaction emoji
        reactionButton.textContent = reactionEvent.content;
        reactionButton.classList.add('reacted');
      }
    });
  }
  
  handleNote(event) {
    // Handle different event kinds
    if (event.kind === 6) {
      // Repost events
      console.log('📨 Received kind 6 repost event from:', event.pubkey.substring(0, 16) + '...', 'Event ID:', event.id.substring(0, 16) + '...', 'Current feed:', this.currentFeed);
      this.handleRepost(event);
      return;
    } else if (event.kind === 7) {
      // Reaction events
      console.log('😊 Received kind 7 reaction event from:', event.pubkey.substring(0, 16) + '...', 'Reaction:', event.content);
      this.handleReaction(event);
      return;
    } else if (event.kind === 9735) {
      // Zap receipt events
      console.log('⚡ Received zap receipt from:', event.pubkey.substring(0, 16) + '...');
      this.handleZapReceipt(event);
      return;
    } else if (event.kind === 10002) {
      // Relay list events (NIP-65)
      console.log('📡 Received relay list event from:', event.pubkey.substring(0, 16) + '...');
      if (this.currentUser && event.pubkey === this.currentUser.publicKey) {
        this.handleRelayListEvent(event);
      }
      return;
    } else if (event.kind === 1) {
      // Text notes
      
      // Track reply relationships silently (Phase 1: tracking only, no UI changes)
      this.threadManager.trackNote(event);
      
      // FILTER OUT ALL REPLIES - Check for 'e' tags which indicate this is a reply
      const eTags = event.tags?.filter(tag => tag[0] === 'e') || [];
      if (eTags.length > 0) {
        console.log('🚫 Filtering out reply from:', event.pubkey.substring(0, 16) + '...', 'Reply to:', eTags[0][1].substring(0, 16) + '...');
        
        
        // Still cache the event for quoted note updates but don't display it
        this.notes.set(event.id, event);
        this.updateQuotedNotePlaceholders(event);
        return;
      }
      
      // FILTER OUT MUTED USERS - Check if the author is in the mute list
      if (this.userMutes.has(event.pubkey)) {
        console.log('🔇 Filtering out note from muted user:', event.pubkey.substring(0, 16) + '...');
        // Still cache the event for quoted note updates but don't display it
        this.notes.set(event.id, event);
        this.updateQuotedNotePlaceholders(event);
        return;
      }
      
      // Check if this is a quoted note that needs to be updated in the DOM
      const wasAlreadyCached = this.notes.has(event.id);
      
      // Avoid duplicates
      if (wasAlreadyCached) {
        // Even if cached, check if this is a quoted event that needs DOM updates
        this.updateQuotedNotePlaceholders(event);
        return;
      }
      
      console.log('📝 Received note from:', event.pubkey.substring(0, 16) + '...', 'Content:', event.content.substring(0, 50) + '...');
      
      // Filter notes based on current feed type
      if (this.currentFeed === 'following') {
        // Only show notes from users we follow
        if (!this.userFollows.has(event.pubkey)) {
          // Before filtering out, check if this event can update any quoted note placeholders
          // Cache it temporarily for quoted note updates even if it won't be displayed
          this.notes.set(event.id, event);
          this.updateQuotedNotePlaceholders(event);
          console.log('🚫 Filtering out note from unfollowed user (cached for quotes):', event.pubkey.substring(0, 16) + '...');
          return;
        }
        console.log('✅ Showing note from followed user:', event.pubkey.substring(0, 16) + '...');
      } else if (this.currentFeed === 'me') {
        // Me feed: only show notes from current user
        if (!this.currentUser || event.pubkey !== this.currentUser.publicKey) {
          // Cache for quoted note updates but don't display
          this.notes.set(event.id, event);
          this.updateQuotedNotePlaceholders(event);
          console.log('🚫 Me feed: Filtering out note from different user:', event.pubkey.substring(0, 16) + '...');
          return;
        }
        console.log('✅ Me feed: Showing note from current user:', event.pubkey.substring(0, 16) + '...');
      } else if (this.currentFeed === 'trending') {
        // Show notes that are either in our trending note IDs list OR from trending authors 
        const isTrendingNote = this.trendingNoteIds.has(event.id);
        const isTrendingAuthor = this.trendingAuthors && this.trendingAuthors.has(event.pubkey);
        
        // During initial trending load (when we have trending IDs but no authors yet),
        // allow through any note that is in trending IDs list
        // For load-more operations, also check trending authors
        if (!isTrendingNote && !isTrendingAuthor) {
          // Before filtering out, check if this event can update any quoted note placeholders
          // Cache it temporarily for quoted note updates even if it won't be displayed
          this.notes.set(event.id, event);
          this.updateQuotedNotePlaceholders(event);
          
          // If this is initial load (we have trending IDs but no authors yet), only show trending notes
          if (this.trendingNoteIds.size > 0 && (!this.trendingAuthors || this.trendingAuthors.size === 0)) {
            console.log('🚫 Filtering out non-curated note during initial trending load (cached for quotes):', event.id.substring(0, 16) + '...');
            return;
          }
          // If this is load-more operation, filter out completely
          console.log('🚫 Filtering out non-trending note (cached for quotes):', event.id.substring(0, 16) + '...', 'from author:', event.pubkey.substring(0, 16) + '...');
          return;
        }
        
        if (isTrendingNote) {
          console.log('✅ Showing curated trending note:', event.id.substring(0, 16) + '...');
          // Add this author to trending authors set for future filtering
          if (!this.trendingAuthors) this.trendingAuthors = new Set();
          this.trendingAuthors.add(event.pubkey);
          console.log('👥 Added trending author:', event.pubkey.substring(0, 16) + '...', 'Total trending authors:', this.trendingAuthors.size);
        } else {
          console.log('✅ Showing note from trending author:', event.id.substring(0, 16) + '...', 'author:', event.pubkey.substring(0, 16) + '...');
        }
      }
      // Other feeds (if any) show everything - no additional filtering needed
      
      this.notes.set(event.id, event);
      
      
      // Update any loading quoted note placeholders for this event
      this.updateQuotedNotePlaceholders(event);
      
      // Check if this event was requested for a pending repost
      if (this.pendingReposts && this.pendingReposts.has(event.id)) {
        const repostEvent = this.pendingReposts.get(event.id);
        console.log('🔁 Found original note for pending repost:', event.id.substring(0, 16) + '...');
        this.displayRepost(repostEvent, event);
        this.pendingReposts.delete(event.id);
      }
      
      // Track notes that actually get displayed during batched operations
      if (this.batchedLoadInProgress && this.batchNotesDisplayed !== undefined) {
        this.batchNotesDisplayed++;
        console.log(`📈 Batch note displayed! Total displayed notes: ${this.batchNotesDisplayed}, Note ID: ${event.id.substring(0, 16)}...`);
      }
      
      // Memory monitoring to prevent browser freezes (but not during active loading)
      if (this.notes.size > this.maxNotes * 0.95 && !this.loadingMore && !this.batchedLoadInProgress) {
        console.warn(`⚠️ Approaching memory limit: ${this.notes.size}/${this.maxNotes} notes`);
        
        // Debounce cleanup calls to prevent rapid successive executions
        if (!this.cleanupScheduled) {
          this.cleanupScheduled = true;
          setTimeout(() => {
            if (!this.loadingMore && !this.batchedLoadInProgress) {
              this.performMemoryCleanup();
            }
            this.cleanupScheduled = false;
          }, 2000);
        }
      }
      
      // Emergency cleanup only if we exceed limits significantly
      if (this.notes.size > this.maxNotes * 1.5 || this.subscriptions.size > this.maxSubscriptions * 3) {
        console.error(`🚨 EMERGENCY CLEANUP: notes=${this.notes.size}, subs=${this.subscriptions.size}`);
        if (!this.loadingMore && !this.emergencyCleanupScheduled) {
          this.emergencyCleanupScheduled = true;
          setTimeout(() => {
            this.performMemoryCleanup();
            this.emergencyCleanupScheduled = false;
          }, 500);
        }
      }
      
      // Track oldest note timestamp for pagination
      if (!this.oldestNoteTimestamp || event.created_at < this.oldestNoteTimestamp) {
        const oldValue = this.oldestNoteTimestamp;
        this.oldestNoteTimestamp = event.created_at;
        console.log(`🕐 Updated oldest timestamp: ${oldValue ? new Date(oldValue * 1000).toLocaleString() : 'none'} → ${new Date(this.oldestNoteTimestamp * 1000).toLocaleString()}`);
        console.log(`🔍 DEBUG: Note that updated timestamp: ${event.id.substring(0, 16)}... from ${event.pubkey.substring(0, 16)}...`);
      }
      
      // Track notes that will actually be displayed during batched load operations
      if (this.batchedLoadInProgress && this.batchNewNotesReceived !== undefined) {
        this.batchNewNotesReceived++;
        console.log(`📈 Batch note will be displayed! Total batch notes: ${this.batchNewNotesReceived}, Note ID: ${event.id.substring(0, 16)}..., From: ${event.pubkey.substring(0, 16)}..., Time: ${new Date(event.created_at * 1000).toLocaleTimeString()}`);
      }
      
      // Request profile for this author if we don't have it
      this.requestProfile(event.pubkey);
      
      // Add a subtle delay to give profiles time to load
      this.scheduleNoteDisplay(event);
    } else if (event.kind === 0) {
      console.log('👤 Received profile for:', event.pubkey.substring(0, 16) + '...');
      // Profile metadata
      this.handleProfile(event);
    } else if (event.kind === 3) {
      console.log('📋 Received contact list from:', event.pubkey.substring(0, 16) + '...');
      // Contact list
      this.handleContactList(event);
    } else if (event.kind === 10000) {
      console.log('🔇 Received mute list from:', event.pubkey.substring(0, 16) + '...');
      // Mute list (NIP-51)
      this.handleMuteList(event);
    }
  }
  
  scheduleNoteDisplay(event) {
    // If note is already scheduled or displayed, skip
    if (this.pendingNoteDisplays.has(event.id)) {
      return;
    }
    
    // Check if we have the profile, if not - proactively fetch it
    const hasProfile = this.profiles.has(event.pubkey);
    if (!hasProfile) {
      this.fetchProfileForAuthor(event.pubkey);
    }
    
    // Determine delay based on whether we have the profile
    const baseDelay = hasProfile ? 50 : 500; // 50ms if profile cached, 500ms if not (increased from 300ms)
    
    // Add a small random stagger (0-100ms) to avoid all notes appearing simultaneously
    const stagger = Math.random() * 100;
    const delay = baseDelay + stagger;
    
    const timeoutId = setTimeout(() => {
      this.pendingNoteDisplays.delete(event.id);
      this.displayTopLevelNote(event);
    }, delay);
    
    // Track this pending display
    this.pendingNoteDisplays.set(event.id, timeoutId);
  }
  
  // Proactively fetch profile for unknown authors
  fetchProfileForAuthor(pubkey) {
    // Avoid duplicate requests
    if (this.profileFetchRequests && this.profileFetchRequests.has(pubkey)) {
      return;
    }
    
    if (!this.profileFetchRequests) {
      this.profileFetchRequests = new Set();
    }
    
    this.profileFetchRequests.add(pubkey);
    console.log('👤 Fetching profile for:', pubkey.substring(0, 16) + '...');
    
    const subscriptionId = `profile_${pubkey.substring(0, 8)}_${Date.now()}`;
    const filter = {
      kinds: [0],
      authors: [pubkey],
      limit: 1
    };

    const subscription = ["REQ", subscriptionId, filter];
    
    let sentCount = 0;
    this.relayConnections.forEach((ws, relayUrl) => {
      if (sentCount >= 3) return; // Limit to 3 relays for profile fetching
      if (ws.readyState !== WebSocket.OPEN) {
        console.log('⚠️ Relay not ready for profile fetch:', relayUrl);
        return;
      }
      
      try {
        ws.send(JSON.stringify(subscription));
        sentCount++;
        console.log(`📤 Profile request sent to: ${relayUrl}`);
      } catch (error) {
        console.log('⚠️ Error fetching profile from relay:', relayUrl, error);
      }
    });
    
    console.log(`📡 Profile fetch requests sent to ${sentCount} relays for:`, pubkey.substring(0, 16) + '...');
    
    // Auto-close subscription after 3 seconds
    setTimeout(() => {
      const closeMsg = ["CLOSE", subscriptionId];
      this.relayConnections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(closeMsg));
          } catch (error) {
            console.log('⚠️ Error closing profile subscription:', error);
          }
        }
      });
      // Remove from pending requests
      if (this.profileFetchRequests) {
        this.profileFetchRequests.delete(pubkey);
      }
    }, 3000);
  }
  
  handleProfile(event) {
    try {
      const profile = JSON.parse(event.content);
      
      console.log('👤 handleProfile - Received profile for:', event.pubkey.substring(0, 16) + '...', 'Display name:', profile?.display_name, 'Name:', profile?.name);
      
      this.profiles.set(event.pubkey, {
        ...profile,
        updatedAt: event.created_at
      });
      
      // Remove from pending sets since we got the profile
      this.profileRequests.delete(event.pubkey);
      if (this.profileFetchRequests) {
        this.profileFetchRequests.delete(event.pubkey);
      }
      
      // Update any displayed notes from this author (including quoted notes)
      this.updateAuthorDisplay(event.pubkey);
      
      // Process any reposts that were waiting for this profile
      this.processRepostQueue();
      
      // Check for any pending note displays from this author and show them immediately
      this.displayPendingNotesFromAuthor(event.pubkey);
      
      const loadingQuotedNotes = document.querySelectorAll(`.quoted-note.loading[data-pubkey="${event.pubkey}"]`);
      loadingQuotedNotes.forEach(placeholder => {
        // Try to find the event for this quoted note
        const eventId = placeholder.dataset.eventId;
        if (eventId) {
          const quotedEvent = this.notes.get(eventId);
          if (quotedEvent && quotedEvent.kind === 1) {
            console.log('📝 Updating loading quoted note with new profile data:', eventId.substring(0, 16) + '...');
            this.updateQuotedNotePlaceholders(quotedEvent);
          }
        }
      });
      
      // If this is the current user's profile, update the UI immediately
      if (this.currentUser && event.pubkey === this.currentUser.publicKey) {
        this.updateUserProfile();
      }
    } catch (error) {
      console.error('Error parsing profile:', error);
    }
  }
  
  handleContactList(event) {
    // Only process contact lists from the current user
    if (!this.currentUser || event.pubkey !== this.currentUser.publicKey) {
      console.log('❌ Ignoring contact list from different user:', event.pubkey, '(expected:', this.currentUser?.publicKey, ')');
      return;
    }
    
    console.log('✅ === PROCESSING CONTACT LIST ===');
    
    // Only process if this contact list is newer than what we have
    if (this.lastContactListTimestamp && event.created_at <= this.lastContactListTimestamp) {
      console.warn('⚠️ IGNORING OLDER CONTACT LIST:', 
        `current: ${new Date(this.lastContactListTimestamp * 1000).toLocaleString()}`,
        `received: ${new Date(event.created_at * 1000).toLocaleString()}`);
      return;
    }
    
    this.lastContactListTimestamp = event.created_at;
    // Clear existing follows
    this.userFollows.clear();
    
    // Parse p tags (people the user follows)
    let followCount = 0;
    for (const tag of event.tags) {
      if (tag[0] === 'p' && tag[1]) {
        this.userFollows.add(tag[1]);
        followCount++;
        if (followCount <= 5) {
          console.log('➕ Added follow #' + followCount + ':', tag[1].substring(0, 16) + '...');
        }
      }
    }
    
    console.log('✅ CONTACT LIST LOADED: User follows', this.userFollows.size, 'accounts');
    if (this.userFollows.size === 0) {
      console.log('⚠️  Contact list is empty - user follows no one');
    } else {
      console.log('👥 First 5 follows:', Array.from(this.userFollows).slice(0, 5).map(pk => pk.substring(0, 16) + '...'));
    }
    this.contactListLoaded = true;
    
    // If we're currently viewing the following feed, reload it with real data
    if (this.currentFeed === 'following') {
      console.log('🔄 Reloading following feed with contact list data');
      // Clear the current feed content to ensure fresh reload
      document.getElementById('feed').innerHTML = '';
      this.loadFeed();
    }
  }
  
  handleMuteList(event) {
    // Only process mute lists from the current user
    if (!this.currentUser || event.pubkey !== this.currentUser.publicKey) {
      console.log('❌ Ignoring mute list from different user:', event.pubkey, '(expected:', this.currentUser?.publicKey, ')');
      return;
    }
    
    // Check if this is a mute list by looking for 'd' tag with 'mute' value
    const dTag = event.tags.find(tag => tag[0] === 'd');
    if (!dTag || dTag[1] !== 'mute') {
      console.log('❌ Not a mute list - missing or incorrect "d" tag:', dTag);
      return;
    }
    
    console.log('✅ === PROCESSING MUTE LIST ===');
    console.log('Event:', event);
    console.log('Event tags count:', event.tags.length);
    
    // Clear existing mutes
    this.userMutes.clear();
    
    // Parse p tags (people the user has muted)
    let muteCount = 0;
    for (const tag of event.tags) {
      if (tag[0] === 'p' && tag[1]) {
        this.userMutes.add(tag[1]);
        muteCount++;
        if (muteCount <= 5) {
          console.log('🔇 Added mute #' + muteCount + ':', tag[1].substring(0, 16) + '...');
        }
      }
    }
    
    console.log('✅ MUTE LIST LOADED: User muted', this.userMutes.size, 'accounts');
    if (this.userMutes.size === 0) {
      console.log('⚠️  Mute list is empty - user muted no one');
    } else {
      console.log('🔇 First 5 mutes:', Array.from(this.userMutes).slice(0, 5).map(pk => pk.substring(0, 16) + '...'));
    }
    this.muteListLoaded = true;
    
    // Reload current feed to apply mute filters
    console.log('🔄 Reloading feed to apply mute list');
    this.loadFeed();
  }
  
  requestProfile(pubkey) {
    // Don't request if we already have it or if request is pending
    if (this.profiles.has(pubkey) || this.profileRequests.has(pubkey)) {
      return;
    }
    
    // Mark as pending
    this.profileRequests.add(pubkey);
    
    // Send request immediately to all connected relays
    const subId = 'profile-' + pubkey.substring(0, 16);
    const subscription = ['REQ', subId, {
      kinds: [0],
      authors: [pubkey],
      limit: 1
    }];
    
    this.relayConnections.forEach((ws, relay) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscription));
      }
    });
    
    // Clean up after 5 seconds
    setTimeout(() => {
      this.profileRequests.delete(pubkey);
    }, 5000);
  }
  
  displayPendingNotesFromAuthor(pubkey) {
    // Find notes from this author that are waiting to be displayed
    for (const [eventId, timeoutId] of this.pendingNoteDisplays.entries()) {
      const event = this.notes.get(eventId);
      if (event && event.pubkey === pubkey) {
        // Cancel the timeout and display immediately
        clearTimeout(timeoutId);
        this.pendingNoteDisplays.delete(eventId);
        this.displayTopLevelNote(event);
      }
    }
  }
  
  updateAuthorDisplay(pubkey) {
    // Find all notes from this author and update their display
    const elements = document.querySelectorAll(`[data-author="${pubkey}"], [data-pubkey="${pubkey}"]`);
    elements.forEach(element => {
      const profile = this.profiles.get(pubkey);
      if (profile) {
        const nameElement = element.querySelector('.note-author, .reply-author, .quoted-author');
        const idElement = element.querySelector('.note-npub, .reply-npub, .quoted-npub');
        const avatarContainer = element.querySelector('.note-avatar, .reply-avatar, .quoted-avatar');
        
        if (nameElement) {
          nameElement.textContent = profile.display_name || profile.name || this.getAuthorName(pubkey);
        }
        
        if (idElement) {
          const formattedId = this.formatProfileIdentifier(profile.nip05, pubkey);
          idElement.textContent = formattedId;
          
          if (profile.nip05) {
            idElement.setAttribute('data-nip05', 'true');
          } else {
            idElement.removeAttribute('data-nip05');
          }
        }
        
        if (avatarContainer && profile.picture) {
          // Update avatar if profile picture is available
          const authorName = profile.display_name || profile.name || this.getAuthorName(pubkey);
          // Use appropriate avatar class based on container type
          const isQuotedAvatar = avatarContainer.classList.contains('quoted-avatar');
          const avatarClass = isQuotedAvatar ? 'quoted-avatar-img' : 'avatar-img';
          const errorHandler = isQuotedAvatar ? "this.style.display='none'; this.nextElementSibling.style.display='flex';" : "";
          
          avatarContainer.innerHTML = `<img src="${profile.picture}" alt="" class="${avatarClass}" ${errorHandler ? `onerror="${errorHandler}"` : ''}><div class="avatar-placeholder" style="display: none;">${this.getAvatarPlaceholder(authorName)}</div>`;
        }
      }
    });
    
    // Update nostr mentions for this user
    const mentionElements = document.querySelectorAll(`[data-pubkey="${pubkey}"]`);
    mentionElements.forEach(element => {
      if (element.classList.contains('nostr-mention')) {
        const profile = this.profiles.get(pubkey);
        const displayName = (profile?.display_name || profile?.name || this.getAuthorName(pubkey))?.trim();
        const truncatedDisplayName = this.truncateUsername(displayName, 20);
        element.textContent = `@${truncatedDisplayName}`;
        element.title = `@${displayName}`; // Full name in tooltip
      }
    });
    
    // Update user tab if it exists for this user
    const userTab = document.getElementById(`user-tab-${pubkey}`);
    if (userTab) {
      const profile = this.profiles.get(pubkey);
      if (profile) {
        const displayName = (profile.display_name || profile.name || this.getAuthorName(pubkey))?.trim();
        const truncatedDisplayName = this.truncateUsername(displayName, 12);
        userTab.innerHTML = `@${truncatedDisplayName}`;
        userTab.title = `@${displayName}`; // Full name in tooltip
      }
    }
    
    // Also update user's own profile in header if this is the logged-in user
    if (this.currentUser && pubkey === this.currentUser.publicKey) {
      this.updateUserProfile();
    }
  }
  
  
  loadFollowingFeedBatched(followsArray) {
    console.log('📦 === BATCHING FOLLOWING FEED ===');
    console.log('Total authors to batch:', followsArray.length);
    
    
    const BATCH_SIZE = 100; // Safe limit for most relays
    const batches = [];
    
    // Split authors into batches
    for (let i = 0; i < followsArray.length; i += BATCH_SIZE) {
      batches.push(followsArray.slice(i, i + BATCH_SIZE));
    }
    
    console.log('📦 Created', batches.length, 'batches of', BATCH_SIZE, 'authors each');
    console.log('📦 Batch sizes:', batches.map(batch => batch.length));
    
    
    // Clear existing subscriptions
    this.subscriptions.forEach((sub, id) => {
      this.relayConnections.forEach(ws => {
        ws.send(JSON.stringify(['CLOSE', id]));
      });
    });
    this.subscriptions.clear();
    
    let sentToRelays = 0;
    
    // Create subscriptions for each batch
    batches.forEach((batch, batchIndex) => {
      const subId = `following-batch-${batchIndex}-${Date.now()}`;
      const realtimeSubId = `following-realtime-batch-${batchIndex}-${Date.now()}`;
      
      console.log(`📤 Batch ${batchIndex + 1}: Creating subscription for ${batch.length} authors`);
      
      // Historical notes subscription for this batch (last 24 hours to get recent notes)
      const dayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
      const filter = {
        kinds: [1, 6, 7, 9735],
        authors: batch,
        since: dayAgo, // Only get notes from the last 24 hours
        limit: 15 // Reduced from 40 to 15 to avoid overwhelming profile fetching
      };
      
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      
      // Real-time subscription for this batch (from now forward)
      const now = Math.floor(Date.now() / 1000);
      const realtimeFilter = {
        ...filter,
        since: now, // Only new notes from this moment forward
        limit: undefined
      };
      
      const realtimeSubscription = ['REQ', realtimeSubId, realtimeFilter];
      this.subscriptions.set(realtimeSubId, realtimeSubscription);
      
      console.log(`📤 Batch ${batchIndex + 1} filter:`, JSON.stringify(filter));
      
      // Send to all connected relays
      this.relayConnections.forEach((ws, relay) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(subscription));
          ws.send(JSON.stringify(realtimeSubscription));
          if (batchIndex === 0) sentToRelays++; // Count once per relay
        }
      });
    });
    
    console.log('📤 Following feed batches sent to', sentToRelays, 'relays');
    console.log('📦 Total subscriptions created:', batches.length * 2, '(historical + realtime)');
    
    // Hide loading after timeout if no response
    setTimeout(() => {
      if (this.currentFeed === 'following') {
        this.hideLoading();
      }
    }, 5000);
  }
  
  
  loadMoreFollowingFeedBatched(followsArray, untilTimestamp) {
    console.log('📦 === LOADING MORE FOLLOWING FEED (BATCHED) ===');
    console.log('Total authors to batch:', followsArray.length);
    console.log('Loading notes older than timestamp:', untilTimestamp);
    console.log('Until date:', new Date(untilTimestamp * 1000).toLocaleString());
    
    // Additional safety check to prevent overlapping batched operations
    if (this.batchedLoadInProgress) {
      console.log('⚠️ Batched load already in progress, skipping');
      this.loadingMore = false;
      return;
    }
    
    // Close any existing batch subscriptions before starting new ones
    if (this.currentBatchSubIds && this.currentBatchSubIds.length > 0) {
      console.log('🧹 Cleaning up old batch subscriptions before starting new batch');
      this.currentBatchSubIds.forEach(subId => {
        this.relayConnections.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(['CLOSE', subId]));
          }
        });
        this.subscriptions.delete(subId);
      });
    }
    this.batchedLoadInProgress = true;
    this.batchNewNotesReceived = 0; // Track notes received specifically for this batch operation
    this.batchNotesDisplayed = 0; // Track notes actually displayed after filtering
    
    const BATCH_SIZE = 100; // Safe limit for most relays
    const batches = [];
    
    // Split authors into batches
    for (let i = 0; i < followsArray.length; i += BATCH_SIZE) {
      batches.push(followsArray.slice(i, i + BATCH_SIZE));
    }
    
    console.log('📦 Created', batches.length, 'batches for loadMore');
    
    // Store batch info for completion tracking
    this.expectedBatches = batches.length;
    if (!this.completedBatches) this.completedBatches = new Set();
    this.completedBatches.clear();
    
    // Create unique timestamp for this batch operation to avoid confusion with old operations
    this.currentBatchTimestamp = Date.now();
    console.log(`📦 Starting new batch operation with timestamp: ${this.currentBatchTimestamp}`);
    
    let sentToRelays = 0;
    this.currentBatchSubIds = []; // Store for cleanup
    
    // Create subscriptions for each batch
    batches.forEach((batch, batchIndex) => {
      const subId = `loadmore-following-batch-${batchIndex}-${this.currentBatchTimestamp}`;
      this.currentBatchSubIds.push(subId);
      
      console.log(`📤 LoadMore Batch ${batchIndex + 1}: Creating subscription for ${batch.length} authors`);
      
      // Historical notes subscription for this batch (older notes)
      const filter = {
        kinds: [1, 6, 7, 9735],
        authors: batch,
        until: untilTimestamp,
        limit: Math.max(5, Math.ceil(20 / batches.length)) // At least 5 per batch, distribute 20 total for better performance
      };
      
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      
      console.log(`📤 LoadMore Batch ${batchIndex + 1} filter:`, JSON.stringify(filter));
      console.log(`📤 Batch ${batchIndex + 1}: ${batch.length} authors, until: ${new Date(untilTimestamp * 1000).toLocaleString()}, limit: ${filter.limit}`);
      
      // Send to all connected relays
      this.relayConnections.forEach((ws, relay) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(subscription));
          if (batchIndex === 0) sentToRelays++; // Count once per relay
          console.log(`📤 Batch ${batchIndex + 1} sent to relay: ${relay}`);
        } else {
          console.log(`❌ Batch ${batchIndex + 1} NOT sent to relay ${relay} - connection state: ${ws.readyState}`);
        }
      });
    });
    
    console.log('📤 LoadMore Following feed batches sent to', sentToRelays, 'relays');
    console.log('📦 Total loadMore subscriptions created:', batches.length);
    console.log('📦 Expecting EOSE from', this.expectedBatches, 'batches');
    
    // Safety timeout to prevent flag from getting stuck - longer timeout for proper completion
    setTimeout(() => {
      if (this.batchedLoadInProgress) {
        console.log('⚠️ TIMEOUT SAFETY TRIGGERED - Batched load timeout after 15s, clearing flags forcibly');
        console.log(`⚠️ TIMEOUT STATE: batchedLoadInProgress=${this.batchedLoadInProgress}, completedBatches=${this.completedBatches.size}, expectedBatches=${this.expectedBatches}`);
        this.finalizeBatchedLoad();
      } else {
        console.log('⚠️ Timeout safety checked - batchedLoadInProgress was already false');
      }
    }, 20000); // 20 second safety timeout - increased for larger batch requests
  }
  
  async loadMoreTrendingDays() {
    console.log('🔥 loadMoreTrendingDays() called!');
    this.loadMoreStartNoteCount = this.notes.size; // Track starting note count
    
    // Since nostr.band API doesn't support pagination (confirmed by testing), 
    // we'll load older content from trending authors using Nostr relays
    
    const notes = document.querySelectorAll('.note');
    if (notes.length === 0) {
      console.log('📊 No notes in DOM to determine oldest timestamp');
      this.feedHasMore = false;
      this.loadingMore = false;
      this.hideLoading();
      return;
    }
    
    const oldestNote = notes[notes.length - 1];
    const oldestTimestamp = parseInt(oldestNote.dataset.timestamp);
    
    if (!oldestTimestamp) {
      console.log('📊 No timestamp found on oldest note');
      this.feedHasMore = false;
      this.loadingMore = false;
      this.hideLoading();
      return;
    }
    
    console.log('🕰️ Loading more trending content older than:', new Date(oldestTimestamp * 1000).toLocaleString());
    
    // Use cached trending authors set
    const trendingAuthorsList = this.trendingAuthors ? [...this.trendingAuthors] : [];
      
    console.log('👥 Found', trendingAuthorsList.length, 'cached trending authors for load more');
    console.log('📋 Trending authors:', trendingAuthorsList.slice(0, 5).map(a => a.substring(0, 16) + '...'));
    
    if (trendingAuthorsList.length === 0) {
      console.log('📊 No trending authors found, ending load more');
      console.log('📋 Current trending note IDs count:', this.trendingNoteIds.size);
      console.log('📋 Current trending authors set:', this.trendingAuthors);
      this.feedHasMore = false;
      this.loadingMore = false;
      this.hideLoading();
      return;
    }
    
    try {
      // Create subscription for older notes from trending authors
      const filter = {
        kinds: [1, 6, 7, 9735],
        authors: trendingAuthorsList.slice(0, 20), // Limit to top 20 authors to avoid huge queries
        until: oldestTimestamp - 1,
        limit: 30
      };
      
      const subId = 'trending-loadmore-' + Date.now();
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      
      console.log('📤 Trending load more subscription:', JSON.stringify(subscription));
      
      // Send to all connected relays
      let sentToRelays = 0;
      this.relayConnections.forEach((ws, relay) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(subscription));
          sentToRelays++;
          console.log('📡 Sending trending load more subscription to:', relay);
        }
      });
      
      console.log('📡 Trending load more subscription sent to', sentToRelays, 'relays');
      
      // Set up timeout to prevent infinite loading
      setTimeout(() => {
        if (this.loadingMore) {
          console.log('⏰ Trending load more timeout reached');
          this.loadingMore = false;
          this.hideLoading();
        }
      }, 8000); // 8 second timeout
      
    } catch (error) {
      console.error('❌ Error in trending load more:', error);
      this.loadingMore = false;
      this.feedHasMore = false;
      this.hideLoading();
    }
  }

  finalizeBatchedLoad() {
    if (!this.batchedLoadInProgress) {
      console.log('📋 finalizeBatchedLoad called but batchedLoadInProgress is false, skipping');
      return;
    }
    
    console.log('📋 finalizeBatchedLoad() called - starting cleanup process');
    console.log(`📋 STATE: completedBatches=${this.completedBatches.size}, expectedBatches=${this.expectedBatches}, loadingMore=${this.loadingMore}`);
    
    // Check if we got enough notes from the entire batched operation
    const notesReceived = this.batchNewNotesReceived || 0;
    const notesDisplayed = this.batchNotesDisplayed || 0;
    console.log(`📋 Batched load more completed: ${notesReceived} notes received, ${notesDisplayed} notes displayed after filtering`);
    
    if (notesDisplayed === 0) {
      this.consecutiveEmptyLoads++;
      console.log(`📋 Batched load more returned no results (${this.consecutiveEmptyLoads} consecutive empty loads)`);
      
      // Use smart thresholds based on feed type and size
      let emptyLoadThreshold = 3;
      if (this.currentFeed === 'me') {
        const totalNotes = this.notes.size;
        if (totalNotes <= 3) {
          emptyLoadThreshold = 1;
        } else if (totalNotes <= 10) {
          emptyLoadThreshold = 2;
        } else {
          emptyLoadThreshold = 3;
        }
      }
      
      if (this.consecutiveEmptyLoads >= emptyLoadThreshold) {
        console.log(`📋 Multiple consecutive empty loads (${this.consecutiveEmptyLoads}/${emptyLoadThreshold}), setting feedHasMore = false`);
        this.feedHasMore = false;
      } else {
        // Only keep it true if we haven't definitively determined there are no more notes
        if (!this.definitelyNoMoreNotes) {
          this.feedHasMore = true; // Keep it true for temporary gaps
        }
        console.log(`📋 Keeping feedHasMore = ${this.feedHasMore} (${this.consecutiveEmptyLoads}/${emptyLoadThreshold} empty loads), may be temporary gap`);
      }
    } else {
      this.consecutiveEmptyLoads = 0; // Reset counter when we get results
      // Only set feedHasMore to true if we haven't definitively determined there are no more notes
      if (!this.definitelyNoMoreNotes) {
        this.feedHasMore = true; // Explicitly ensure feedHasMore is true when we get results
      }
      console.log(`📋 Batched load more got ${notesDisplayed} displayed results, setting feedHasMore = true`);
      console.log(`📋 feedHasMore is now: ${this.feedHasMore} (should be true)`);
    }
    
    // Reset the batch counters
    this.batchNewNotesReceived = 0;
    this.batchNotesDisplayed = 0;
    this.batchRepliesFiltered = 0; // Reset filtered replies counter
    
    this.loadingMore = false;
    this.batchedLoadInProgress = false; // Clear batched operation flag
    
    // Clear completed batches tracking
    if (this.completedBatches) {
      this.completedBatches.clear();
    }
    
    // Close all batch subscriptions to free memory using stored IDs
    if (this.currentBatchSubIds) {
      this.currentBatchSubIds.forEach(subId => {
        if (this.subscriptions.has(subId)) {
          this.relayConnections.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(['CLOSE', subId]));
            }
          });
          this.subscriptions.delete(subId);
        }
      });
      console.log(`🔌 Closed ${this.currentBatchSubIds.length} batched load more subscriptions`);
    }
    
    // Update auto-loader visibility
    console.log(`📋 About to call showAutoLoader() - feedHasMore: ${this.feedHasMore}`);
    this.showAutoLoader();
    console.log(`📋 After showAutoLoader() - feedHasMore: ${this.feedHasMore}`);
  }
  
  async loadMeFeed() {
    console.log('🙋 LOADING ME FEED - USER NOTES ONLY');
    
    if (!this.currentUser) {
      console.log('❌ Cannot load Me feed - no current user');
      return;
    }
    
    this.showLoading();
    
    try {
      console.log('✅ loadMeFeed started for user:', this.currentUser.publicKey.substring(0, 16) + '...');
      
      // Load user's notes from last 30 days for good coverage
      const daysToFetch = 30;
      const allNoteIds = [];
      
      console.log('📡 Fetching user notes from the last', daysToFetch, 'days...');
      
      for (let daysBack = 0; daysBack < daysToFetch; daysBack++) {
        const date = new Date();
        date.setDate(date.getDate() - daysBack);
        const dateStr = date.toISOString().split('T')[0];
        
        console.log(`📅 Day ${daysBack + 1}: Fetching notes for ${dateStr}`);
        
        try {
          // Use a simple relay subscription for user's notes on this day
          const dayStart = Math.floor(new Date(dateStr).getTime() / 1000);
          const dayEnd = dayStart + 86400; // 24 hours later
          
          const filter = {
            kinds: [1, 6, 7, 9735],
            authors: [this.currentUser.publicKey],
            since: dayStart,
            until: dayEnd,
            limit: 50
          };
          
          const subId = `me-day-${daysBack}-${Date.now()}`;
          const subscription = ['REQ', subId, filter];
          this.subscriptions.set(subId, subscription);
          
          // Send to all connected relays
          this.relayConnections.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(subscription));
            }
          });
          
        } catch (dayError) {
          console.error(`❌ Error processing day ${daysBack}:`, dayError);
        }
      }
      
      // Wait for notes to be received
      setTimeout(() => {
        console.log('🎯 Me feed initial load completed, collected notes:', this.notes.size);
        this.hideLoading();
        
        // Initialize pagination tracking
        this.meDaysLoaded = daysToFetch;
        
        // Apply smart cutoff logic for small feeds
        const currentNoteCount = this.notes.size;
        const startDay = this.meDaysLoaded || 30;
        
        console.log(`🔍 Initial load cutoff check: ${currentNoteCount} notes, searched ${startDay} days`);
        
        // For initial load, apply smart cutoffs to prevent infinite loading
        if (currentNoteCount === 0) {
          console.log(`📋 Initial load smart cutoff: No notes found after searching ${startDay} days - definitely no more notes`);
          this.feedHasMore = false;
          this.definitelyNoMoreNotes = true;
        } else if (currentNoteCount === 1 && startDay >= 30) {
          // For single note users after 30 days, assume that's all they have
          // This prevents infinite loading while being reasonable for most users
          console.log(`📋 Initial load smart cutoff: Only 1 note found after searching ${startDay} days - probably no more notes`);
          this.feedHasMore = false;
          this.definitelyNoMoreNotes = true;
        } else {
          // For feeds with 2+ notes, or 1 note with less than 30 days searched, allow loadMore
          console.log(`📋 Initial load: ${currentNoteCount} notes found, allowing loadMore to handle further cutoffs`);
          this.feedHasMore = true;
        }
        
        // Update auto-loader display after cutoff logic
        console.log(`🔧 Updating auto-loader after cutoff logic: feedHasMore=${this.feedHasMore}, definitelyNoMoreNotes=${this.definitelyNoMoreNotes}`);
        this.showAutoLoader();
        
        // Make sure auto-loader is visible
        setTimeout(() => {
          if (this.feedHasMore) {
            console.log('🔄 Making sure auto-loader is visible for Me feed');
            this.showAutoLoader();
          }
        }, 2000);
        
      }, 3000); // Give 3 seconds for notes to arrive
      
    } catch (error) {
      console.error('❌ Error loading Me feed:', error);
      this.hideLoading();
      
      document.getElementById('feed').innerHTML = `
        <div style="text-align: center; padding: 40px; color: #888;">
          <h3>Error loading your notes</h3>
          <p>Error loading Me feed</p>
          <p style="font-size: 12px; color: #888;">${error.message}</p>
          <button class="retry-me-btn" style="margin-top: 16px; padding: 8px 16px; background: #ea772f; color: white; border: none; border-radius: 6px; cursor: pointer;">Try Again</button>
        </div>
      `;
      
      // Add event listener for retry button
      setTimeout(() => {
        const retryBtn = document.querySelector('.retry-me-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => this.loadMeFeed());
        }
      }, 0);
    }
  }
  
  async loadMoreMeFeed() {
    console.log('🔥 loadMoreMeFeed() called!');
    this.loadMoreStartNoteCount = this.notes.size;
    
    if (!this.currentUser) {
      console.log('❌ Cannot load more Me feed - no current user');
      this.loadingMore = false;
      this.feedHasMore = false;
      return;
    }
    
    // Implement smarter cutoff logic for small feeds
    const currentNoteCount = this.notes.size;
    const startDay = this.meDaysLoaded || 30;
    
    // Tiered cutoff logic to balance stopping infinite loading vs protecting intermittent users
    console.log(`🔍 LoadMore cutoff check: ${currentNoteCount} notes, searched ${startDay} days`);
    
    if (currentNoteCount === 1) {
      // For single note users, be more aggressive but still reasonable
      if (startDay >= 90) { // 3 months should be enough for most single-note users
        console.log(`📋 Single note optimization: Only 1 note after searching ${startDay} days - probably no more notes`);
        this.loadingMore = false;
        this.feedHasMore = false;
        this.definitelyNoMoreNotes = true;
        this.hideLoading();
        return;
      } else {
        console.log(`📋 Single note: Only searched ${startDay} days, continuing (need 90+ for cutoff)`);
      }
    } else if (currentNoteCount === 2) {
      // For two note users, be more conservative (could be 6 months apart)
      if (startDay >= 365) { // Full year for two-note users
        console.log(`📋 Two note optimization: Only 2 notes after searching ${startDay} days - probably no more notes`);
        this.loadingMore = false;
        this.feedHasMore = false;
        this.definitelyNoMoreNotes = true;
        this.hideLoading();
        return;
      } else {
        console.log(`📋 Two notes: Only searched ${startDay} days, continuing (need 365+ for cutoff)`);
      }
    }
    
    // If we've searched back more than 2 years, definitely stop (protect against infinite search)
    if (startDay >= 730) {
      console.log(`📋 Time cutoff: Searched back ${startDay} days (2+ years) - definitely no more notes`);
      this.loadingMore = false;
      this.feedHasMore = false;
      this.definitelyNoMoreNotes = true;
      this.hideLoading();
      return;
    }
    
    try {
      // Load more days of user's notes
      const additionalDays = 7; // Load 7 more days each time
      
      console.log(`📅 Loading ${additionalDays} more days of notes, starting from day ${startDay}`);
      
      for (let daysBack = startDay; daysBack < startDay + additionalDays; daysBack++) {
        const date = new Date();
        date.setDate(date.getDate() - daysBack);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayStart = Math.floor(new Date(dateStr).getTime() / 1000);
        const dayEnd = dayStart + 86400;
        
        const filter = {
          kinds: [1, 6, 7, 9735],
          authors: [this.currentUser.publicKey],
          since: dayStart,
          until: dayEnd,
          limit: 50
        };
        
        const subId = `me-loadmore-day-${daysBack}-${Date.now()}`;
        const subscription = ['REQ', subId, filter];
        this.subscriptions.set(subId, subscription);
        
        this.relayConnections.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(subscription));
          }
        });
      }
      
      this.meDaysLoaded = startDay + additionalDays;
      
      // Set timeout to complete load more operation
      setTimeout(() => {
        console.log('⏰ Me feed load more timeout reached');
        const notesReceived = this.notes.size - this.loadMoreStartNoteCount;
        const totalNotes = this.notes.size;
        console.log(`📊 Me feed load more completed: ${notesReceived} new notes (total: ${totalNotes})`);
        
        if (notesReceived === 0) {
          this.consecutiveEmptyLoads++;
          
          // More aggressive cutoff for small feeds
          let emptyLoadThreshold = 3;
          if (totalNotes <= 3) {
            emptyLoadThreshold = 1; // Stop after 1 empty load for very small feeds
          } else if (totalNotes <= 10) {
            emptyLoadThreshold = 2; // Stop after 2 empty loads for small feeds
          }
          
          console.log(`📋 Empty loads: ${this.consecutiveEmptyLoads}/${emptyLoadThreshold} (total notes: ${totalNotes})`);
          
          if (this.consecutiveEmptyLoads >= emptyLoadThreshold) {
            console.log(`📋 No more notes available for Me feed (${this.consecutiveEmptyLoads} empty loads, ${totalNotes} total notes)`);
            this.feedHasMore = false;
            this.definitelyNoMoreNotes = true;
          }
        } else {
          this.consecutiveEmptyLoads = 0;
          this.feedHasMore = true;
        }
        
        this.loadingMore = false;
        this.hideLoading();
      }, 5000); // 5 second timeout
      
    } catch (error) {
      console.error('❌ Error in Me feed load more:', error);
      this.loadingMore = false;
      this.feedHasMore = false;
      this.hideLoading();
    }
  }
  
  async loadTopFeed() {
    console.log('🔥 LOADING TRENDING FEED FROM NOSTR.BAND!!!');
    this.showLoading();
    
    try {
      console.log('✅ loadTopFeed started successfully');
      // Fetch trending notes from multiple days for a richer feed experience
      const allTrendingNoteIds = [];
      const daysToFetch = 3; // Conservative initial fetch to prevent crashes
      let apiFailures = 0;
      let totalAttempts = 0;
      
      console.log('📡 Fetching trending notes from the last', daysToFetch, 'days...');
      
      for (let daysBack = 0; daysBack < daysToFetch; daysBack++) {
        const date = new Date();
        date.setDate(date.getDate() - daysBack);
        const dateStr = date.toISOString().split('T')[0];
        totalAttempts++;
        
        try {
          console.log(`📡 Fetching trending notes for ${dateStr} (${daysBack === 0 ? 'today' : daysBack + ' days ago'})`);
          
          // Add timeout to prevent hanging on slow/down API
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
          
          const response = await fetch(`https://api.nostr.band/v0/trending/notes/${dateStr}`, {
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const data = await response.json();
            if (data.notes && data.notes.length > 0) {
              const noteIds = data.notes.map(note => note.id);
              allTrendingNoteIds.push(...noteIds);
              console.log(`📈 Added ${noteIds.length} trending notes from ${dateStr}`);
            } else {
              console.log(`📊 No trending data for ${dateStr}`);
            }
          } else {
            console.warn(`⚠️ Failed to fetch trending data for ${dateStr}: ${response.status}`);
            apiFailures++;
          }
        } catch (error) {
          console.warn(`⚠️ Error fetching trending data for ${dateStr}:`, error.message);
          apiFailures++;
          // Continue with other days even if one fails
        }
        
        // Small delay to be nice to the API
        if (daysBack < daysToFetch - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      if (allTrendingNoteIds.length === 0) {
        // Only show error if user is still on trending feed
        if (this.currentFeed !== 'trending') {
          console.log('🔄 User switched away from trending feed, skipping error display');
          return;
        }
        
        this.hideLoading();
        this.hideAutoLoader(); // Ensure auto-loader is hidden when showing error
        this.feedHasMore = false; // Prevent auto-loader from showing again
        
        // Cancel any pending auto-loader timeout
        if (this.trendingAutoLoaderTimeout) {
          clearTimeout(this.trendingAutoLoaderTimeout);
          this.trendingAutoLoaderTimeout = null;
        }
        
        // Check if all API calls failed vs. just no data available
        if (apiFailures === totalAttempts) {
          // All API calls failed - likely service is down
          document.getElementById('feed').innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #a78bfa;">
              <div style="margin-bottom: 16px;">
                <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 16C11.1046 16 12 15.1046 12 14C12 12.8954 11.1046 12 10 12C8.89543 12 8 12.8954 8 14C8 15.1046 8.89543 16 10 16Z" fill="currentColor"/>
                  <path d="M22 16C23.1046 16 24 15.1046 24 14C24 12.8954 23.1046 12 22 12C20.8954 12 20 12.8954 20 14C20 15.1046 20.8954 16 22 16Z" fill="currentColor"/>
                  <path d="M16.36 18C15.8053 17.9499 15.2462 18.0161 14.7185 18.1946C14.1909 18.373 13.7063 18.6597 13.2958 19.0363C12.8854 19.4128 12.5581 19.871 12.335 20.3813C12.1118 20.8917 11.9977 21.443 12 22V23C12 23.2652 12.1054 23.5196 12.2929 23.7071C12.4804 23.8946 12.7348 24 13 24H19C19.2652 24 19.5196 23.8946 19.7071 23.7071C19.8946 23.5196 20 23.2652 20 23V22.205C20.0236 21.1773 19.6641 20.1775 18.9912 19.4003C18.3184 18.623 17.3805 18.1239 16.36 18Z" fill="currentColor"/>
                  <path d="M16 0C12.8355 0 9.74207 0.938384 7.11088 2.69649C4.4797 4.45459 2.42894 6.95345 1.21793 9.87706C0.0069325 12.8007 -0.309921 16.0177 0.307443 19.1214C0.924806 22.2251 2.44866 25.0761 4.6863 27.3137C6.92394 29.5513 9.77486 31.0752 12.8786 31.6926C15.9823 32.3099 19.1993 31.9931 22.1229 30.7821C25.0466 29.5711 27.5454 27.5203 29.3035 24.8891C31.0616 22.2579 32 19.1645 32 16C32 11.7565 30.3143 7.68687 27.3137 4.68629C24.3131 1.68571 20.2435 0 16 0ZM16 28C13.6266 28 11.3066 27.2962 9.33316 25.9776C7.35977 24.6591 5.8217 22.7849 4.91345 20.5922C4.0052 18.3995 3.76756 15.9867 4.23058 13.6589C4.6936 11.3311 5.83649 9.19295 7.51472 7.51472C9.19295 5.83649 11.3311 4.6936 13.6589 4.23058C15.9867 3.76755 18.3995 4.00519 20.5922 4.91344C22.7849 5.8217 24.6591 7.35976 25.9776 9.33315C27.2962 11.3065 28 13.6266 28 16C28 19.1826 26.7357 22.2348 24.4853 24.4853C22.2348 26.7357 19.1826 28 16 28Z" fill="currentColor"/>
                </svg>
              </div>
              <p style="margin-bottom: 8px; color: #ea772f; font-weight: bold;">The trending data service is currently offline.</p>
              <p style="margin-bottom: 24px; color: #a78bfa;">Please try again later${this.currentUser ? ' or switch to Following feed' : ''}.</p>
              <div style="display: flex; justify-content: center; gap: 12px;">
                <button class="retry-trending-btn" style="padding: 12px 24px; background: #ea772f; color: white; border: none; border-radius: 8px; cursor: pointer;">Try Again</button>
                ${this.currentUser ? '<button class="switch-to-following-btn" style="padding: 12px 24px; background: #a78bfa; color: white; border: none; border-radius: 8px; cursor: pointer;">Go to Following</button>' : ''}
              </div>
            </div>
          `;
          
        } else {
          // Some API calls succeeded but returned no data
          document.getElementById('feed').innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #ea772f;">
              <p>No trending notes available right now.</p>
              <p>Try refreshing or check back later!</p>
              <button class="retry-trending-btn" style="margin-top: 16px; padding: 8px 16px; background: #ea772f; color: white; border: none; border-radius: 6px; cursor: pointer;">Try Again</button>
            </div>
          `;
        }
        
        // Add button functionality for both cases with a longer timeout to ensure DOM is ready
        setTimeout(() => {
          const retryBtn = document.querySelector('.retry-trending-btn');
          const switchBtn = document.querySelector('.switch-to-following-btn');
          
          if (retryBtn) {
            retryBtn.addEventListener('click', () => {
              console.log('User clicked retry trending feed');
              this.loadTopFeed();
            });
          }
          
          if (switchBtn) {
            switchBtn.addEventListener('click', () => {
              console.log('User switching to following feed from trending error');
              this.switchFeed('following');
            });
          }
        }, 200);
        return;
      }
      
      // Remove duplicates and limit total count for performance
      const uniqueTrendingNoteIds = [...new Set(allTrendingNoteIds)];
      const trendingNoteIds = uniqueTrendingNoteIds.slice(0, 50); // Reduced from 200 to 50 to avoid overwhelming profile fetching
      console.log('🎯 Collected', uniqueTrendingNoteIds.length, 'unique trending notes from', allTrendingNoteIds.length, 'total, using', trendingNoteIds.length);
      
      // Store trending note IDs for filtering
      this.trendingNoteIds.clear();
      trendingNoteIds.forEach(id => this.trendingNoteIds.add(id));
      
      // Initialize trending authors set - will be populated as we receive trending notes
      this.trendingAuthors = new Set();
      
      this.trendingDaysLoaded = daysToFetch; // Track that we loaded this many days
      this.feedHasMore = true; // Enable load more for trending feed
      console.log('🎯 Set feedHasMore = true for trending feed');
      
      // Clear existing subscriptions
      this.subscriptions.forEach((sub, id) => {
        this.relayConnections.forEach(ws => {
          ws.send(JSON.stringify(['CLOSE', id]));
        });
      });
      this.subscriptions.clear();
      
      // Create subscription to fetch the actual note events
      const filter = {
        kinds: [1, 6, 7, 9735],
        ids: trendingNoteIds
      };
      
      const subId = 'trending-feed-' + Date.now();
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      console.log('📤 Trending feed subscription:', JSON.stringify(subscription));
      
      // Send to all connected relays
      let sentToRelays = 0;
      this.relayConnections.forEach((ws, relay) => {
        if (ws.readyState === WebSocket.OPEN) {
          console.log('📡 Sending trending feed subscription to:', relay);
          ws.send(JSON.stringify(subscription));
          sentToRelays++;
        } else {
          console.log('❌ Relay not ready for subscription:', relay);
        }
      });
      console.log('📡 Trending feed subscription sent to', sentToRelays, 'relays');
      
      // Make sure auto-loader is visible for trending feed
      this.trendingAutoLoaderTimeout = setTimeout(() => {
        if (this.feedHasMore) {
          console.log('🔄 Making sure auto-loader is visible for trending feed');
          this.showAutoLoader();
        }
      }, 2000);
      
    } catch (error) {
      console.error('❌ Error loading trending feed:', error);
      
      // Only show error if user is still on trending feed
      if (this.currentFeed !== 'trending') {
        console.log('🔄 User switched away from trending feed, skipping error display');
        return;
      }
      
      this.hideLoading();
      this.hideAutoLoader(); // Ensure auto-loader is hidden when showing error
      this.feedHasMore = false; // Prevent auto-loader from showing again
      
      // Cancel any pending auto-loader timeout
      if (this.trendingAutoLoaderTimeout) {
        clearTimeout(this.trendingAutoLoaderTimeout);
        this.trendingAutoLoaderTimeout = null;
      }
      
      // Show service unavailable message for any unexpected errors
      document.getElementById('feed').innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #a78bfa;">
          <div style="margin-bottom: 16px;">
            <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 16C11.1046 16 12 15.1046 12 14C12 12.8954 11.1046 12 10 12C8.89543 12 8 12.8954 8 14C8 15.1046 8.89543 16 10 16Z" fill="currentColor"/>
              <path d="M22 16C23.1046 16 24 15.1046 24 14C24 12.8954 23.1046 12 22 12C20.8954 12 20 12.8954 20 14C20 15.1046 20.8954 16 22 16Z" fill="currentColor"/>
              <path d="M16.36 18C15.8053 17.9499 15.2462 18.0161 14.7185 18.1946C14.1909 18.373 13.7063 18.6597 13.2958 19.0363C12.8854 19.4128 12.5581 19.871 12.335 20.3813C12.1118 20.8917 11.9977 21.443 12 22V23C12 23.2652 12.1054 23.5196 12.2929 23.7071C12.4804 23.8946 12.7348 24 13 24H19C19.2652 24 19.5196 23.8946 19.7071 23.7071C19.8946 23.5196 20 23.2652 20 23V22.205C20.0236 21.1773 19.6641 20.1775 18.9912 19.4003C18.3184 18.623 17.3805 18.1239 16.36 18Z" fill="currentColor"/>
              <path d="M16 0C12.8355 0 9.74207 0.938384 7.11088 2.69649C4.4797 4.45459 2.42894 6.95345 1.21793 9.87706C0.0069325 12.8007 -0.309921 16.0177 0.307443 19.1214C0.924806 22.2251 2.44866 25.0761 4.6863 27.3137C6.92394 29.5513 9.77486 31.0752 12.8786 31.6926C15.9823 32.3099 19.1993 31.9931 22.1229 30.7821C25.0466 29.5711 27.5454 27.5203 29.3035 24.8891C31.0616 22.2579 32 19.1645 32 16C32 11.7565 30.3143 7.68687 27.3137 4.68629C24.3131 1.68571 20.2435 0 16 0ZM16 28C13.6266 28 11.3066 27.2962 9.33316 25.9776C7.35977 24.6591 5.8217 22.7849 4.91345 20.5922C4.0052 18.3995 3.76756 15.9867 4.23058 13.6589C4.6936 11.3311 5.83649 9.19295 7.51472 7.51472C9.19295 5.83649 11.3311 4.6936 13.6589 4.23058C15.9867 3.76755 18.3995 4.00519 20.5922 4.91344C22.7849 5.8217 24.6591 7.35976 25.9776 9.33315C27.2962 11.3065 28 13.6266 28 16C28 19.1826 26.7357 22.2348 24.4853 24.4853C22.2348 26.7357 19.1826 28 16 28Z" fill="currentColor"/>
            </svg>
          </div>
          <p style="margin-bottom: 8px; color: #ea772f; font-weight: bold;">The trending data service is currently offline.</p>
          <p style="margin-bottom: 24px; color: #a78bfa;">Please try again later${this.currentUser ? ' or switch to Following feed' : ''}.</p>
          <div style="display: flex; justify-content: center; gap: 12px;">
            <button class="retry-trending-btn" style="padding: 12px 24px; background: #ea772f; color: white; border: none; border-radius: 8px; cursor: pointer;">Try Again</button>
            ${this.currentUser ? '<button class="switch-to-following-btn" style="padding: 12px 24px; background: #a78bfa; color: white; border: none; border-radius: 8px; cursor: pointer;">Go to Following</button>' : ''}
          </div>
        </div>
      `;
      
      // Add button functionality
      setTimeout(() => {
        const retryBtn = document.querySelector('.retry-trending-btn');
        const switchBtn = document.querySelector('.switch-to-following-btn');
        
        if (retryBtn) {
          retryBtn.addEventListener('click', () => {
            console.log('User clicked retry trending feed from catch block');
            this.loadTopFeed();
          });
        }
        
        if (switchBtn) {
          switchBtn.addEventListener('click', () => {
            console.log('User switching to following feed from trending catch block');
            this.switchFeed('following');
          });
        }
      }, 200);
    }
  }
  
  loadFeed(resetPagination = true) {
    console.log('🔄 === LOADING FEED ===');
    console.log('Feed type:', this.currentFeed);
    console.log('Contact list loaded:', this.contactListLoaded);
    console.log('User follows count:', this.userFollows.size);
    console.log('User follows (first 5):', Array.from(this.userFollows).slice(0, 5).map(pk => pk.substring(0, 16) + '...'));
    
    
    console.log('Current user:', this.currentUser?.publicKey?.substring(0, 16) + '...');
    console.log('Relay connections:', this.relayConnections.size);
    
    // Reset pagination for new feed loads (but not for infinite scroll)
    if (resetPagination) {
      this.oldestNoteTimestamp = null;
      this.feedHasMore = true;
      this.definitelyNoMoreNotes = false;
    }
    
    this.showLoading();
    
    // Clear existing subscriptions
    this.subscriptions.forEach((sub, id) => {
      this.relayConnections.forEach(ws => {
        ws.send(JSON.stringify(['CLOSE', id]));
      });
    });
    this.subscriptions.clear();
    
    const subId = 'feed-' + Date.now();
    let filter;
    
    if (this.currentFeed === 'trending') {
      // Trending feed: trending notes from nostr.band
      console.log('🎯 DETECTED TRENDING FEED - CALLING loadTopFeed()');
      this.loadTopFeed();
      return;
    } else if (this.currentFeed === 'following' && this.currentUser) {
      // Following feed: notes from accounts we follow
      if (this.userFollows.size > 0) {
        const followsArray = Array.from(this.userFollows);
        console.log('✅ Creating following feed filter for', followsArray.length, 'authors');
        console.log('👥 Following authors (first 3):', followsArray.slice(0, 3).map(pk => pk.substring(0, 16) + '...'));
        
        // Handle large following lists by batching authors
        this.loadFollowingFeedBatched(followsArray);
        return;
        
      } else if (!this.contactListLoaded) {
        // Still loading contact list, try to fetch it again
        console.log('Contact list not loaded yet, fetching...');
        this.fetchContactList();
        setTimeout(() => {
          if (this.currentFeed === 'following') {
            this.loadFeed();
          }
        }, 2000);
        return;
      } else {
        // User follows no one, show empty feed message
        console.log('User follows no accounts, showing empty state');
        this.hideLoading();
        document.getElementById('feed').innerHTML = `
          <div style="text-align: center; padding: 40px 20px; color: #a78bfa;">
            <p>You're not following anyone yet.</p>
            <p>Switch to Trending feed to discover interesting content and people!</p>
            <br>
            <button id="switch-to-trending" class="btn btn-primary" style="margin-top: 10px;">Go to Trending</button>
            <button id="retry-contact-list" class="btn btn-secondary" style="margin-top: 10px; margin-left: 8px;">Retry</button>
          </div>
        `;
        
        // Add button functionality
        document.getElementById('switch-to-trending').addEventListener('click', () => {
          console.log('Switching to trending feed from empty following state');
          this.switchFeed('trending');
        });
        
        document.getElementById('retry-contact-list').addEventListener('click', () => {
          console.log('Manual retry of contact list...');
          this.contactListLoaded = false;
          this.fetchContactList();
          this.loadFeed();
        });
        return;
      }
    } else if (this.currentFeed === 'me') {
      // Me feed: use trending-style approach for user's own notes  
      this.loadMeFeed();
      return;
    }
    
    if (filter) {
      console.log('📡 === SENDING FEED SUBSCRIPTIONS ===');
      // Historical notes subscription
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      console.log('📤 Historical subscription:', JSON.stringify(subscription));
      
      // Real-time subscription for new notes
      const realtimeSubId = 'realtime-' + Date.now();
      const realtimeFilter = {
        ...filter,
        since: Math.floor(Date.now() / 1000), // Only new notes from now
        limit: undefined // No limit for real-time
      };
      const realtimeSubscription = ['REQ', realtimeSubId, realtimeFilter];
      this.subscriptions.set(realtimeSubId, realtimeSubscription);
      console.log('📤 Real-time subscription:', JSON.stringify(realtimeSubscription));
      
      let sentToRelays = 0;
      this.relayConnections.forEach((ws, relay) => {
        if (ws.readyState === WebSocket.OPEN) {
          console.log('📡 Sending subscriptions to:', relay);
          ws.send(JSON.stringify(subscription));
          ws.send(JSON.stringify(realtimeSubscription));
          sentToRelays++;
        } else {
          console.log('❌ Relay not ready for subscription:', relay);
        }
      });
      console.log('📡 Subscriptions sent to', sentToRelays, 'relays');
    } else {
      console.log('❌ No filter created for feed:', this.currentFeed);
    }
    
    // Hide loading after 5 seconds if no response
    setTimeout(() => this.hideLoading(), 5000);
  }
  
  
  displayTopLevelNote(event) {
    // Proactively fetch profile if not cached
    if (!this.profiles.has(event.pubkey)) {
      this.fetchProfileForAuthor(event.pubkey);
    }
    
    // Comprehensive safety checks: Validate event belongs to current feed
    if (this.currentFeed === 'me' && this.currentUser && event.pubkey !== this.currentUser.publicKey) {
      console.log('🚨 SAFETY: Prevented display of other user note in Me feed:', event.pubkey.substring(0, 16) + '...');
      return;
    }
    
    if (this.currentFeed === 'following' && this.currentUser) {
      // Only show notes from followed users in Following feed
      if (!this.userFollows.has(event.pubkey) && event.pubkey !== this.currentUser.publicKey) {
        console.log('🚨 SAFETY: Prevented display of unfollowed user note in Following feed:', event.pubkey.substring(0, 16) + '...');
        return;
      }
    }
    
    const feed = document.getElementById('feed');
    
    // Check if note already exists in DOM to prevent duplicates
    const existingElement = document.querySelector(`[data-event-id="${event.id}"]`);
    if (existingElement) {
      console.log('📋 Note already exists in DOM, skipping:', event.id.substring(0, 16) + '...');
      return;
    }
    
    const noteElement = this.createNoteElement(event);
    
    // Insert note in chronological order
    const existingNotes = Array.from(feed.children);
    let inserted = false;
    
    // Debug chronological ordering during batched loads
    if (this.batchedLoadInProgress) {
      console.log(`📅 Inserting batched note (${new Date(event.created_at * 1000).toLocaleTimeString()}): ${event.id.substring(0, 16)}...`);
    }
    
    for (const existingNote of existingNotes) {
      const existingTimestamp = parseInt(existingNote.dataset.timestamp);
      if (event.created_at > existingTimestamp) {
        if (this.batchedLoadInProgress) {
          console.log(`📅 Inserted before note from ${new Date(existingTimestamp * 1000).toLocaleTimeString()}`);
        }
        feed.insertBefore(noteElement, existingNote);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      if (this.batchedLoadInProgress) {
        console.log(`📅 Appended to end (oldest note in batch)`);
      }
      feed.appendChild(noteElement);
    }
  }
  
  // displayReply and displayOrphanedReplies removed - replies no longer supported
  
  
  createNoteElement(event) {
    const noteDiv = document.createElement('div');
    noteDiv.className = 'note';
    noteDiv.dataset.eventId = event.id;
    // Validate timestamp is reasonable (should be in seconds, not milliseconds)
    const now = Math.floor(Date.now() / 1000);
    let timestamp = event.created_at;
    
    // If timestamp looks like milliseconds (13+ digits), convert to seconds
    if (timestamp > 9999999999) { // More than 10 digits = likely milliseconds
      console.warn(`⚠️ Note ${event.id.substring(0, 16)}... has timestamp that looks like milliseconds: ${timestamp}, converting to seconds`);
      timestamp = Math.floor(timestamp / 1000);
    }
    
    // Sanity check: timestamp should be reasonable (not way in the past or future)
    const oneYearAgo = now - (365 * 24 * 60 * 60);
    const oneYearFromNow = now + (365 * 24 * 60 * 60);
    if (timestamp < oneYearAgo || timestamp > oneYearFromNow) {
      console.warn(`⚠️ Note ${event.id.substring(0, 16)}... has unreasonable timestamp: ${timestamp} (${new Date(timestamp * 1000).toLocaleString()}), clamping to current time`);
      timestamp = now;
    }
    
    noteDiv.dataset.timestamp = timestamp;
    noteDiv.dataset.author = event.pubkey; // For profile updates
    
    const profile = this.profiles.get(event.pubkey);
    const authorName = profile?.display_name || profile?.name || this.getAuthorName(event.pubkey);
    const authorId = this.formatProfileIdentifier(profile?.nip05, event.pubkey);
    const avatarUrl = profile?.picture;
    const timeAgo = this.formatTimeAgo(event.created_at);
    const formattedContent = this.formatNoteContent(event.content);
    
    noteDiv.innerHTML = `
      <div class="note-header">
        <div class="note-avatar" data-profile-link="${window.NostrTools.nip19.npubEncode(event.pubkey)}">
          ${avatarUrl ? 
            `<img src="${avatarUrl}" alt="" class="avatar-img">
             <div class="avatar-placeholder" style="display: none;">${this.getAvatarPlaceholder(authorName)}</div>` :
            `<div class="avatar-placeholder">${this.getAvatarPlaceholder(authorName)}</div>`
          }
        </div>
        <div class="note-info" data-profile-link="${window.NostrTools.nip19.npubEncode(event.pubkey)}">
          <span class="note-author">${authorName}</span>
          <span class="note-npub" ${profile?.nip05 ? 'data-nip05="true"' : ''}>${authorId}</span>
        </div>
        <span class="note-time" data-note-link="${event.id}">${timeAgo}</span>
        <div class="note-menu">
          <button class="menu-btn" data-event-id="${event.id}">⋯</button>
          <div class="menu-dropdown" data-event-id="${event.id}">
            <div class="menu-item" data-action="open-note">Open Note</div>
            <div class="menu-item" data-action="copy-note-id">Copy Note ID</div>
            <div class="menu-item" data-action="copy-note-text">Copy Note Text</div>
            <div class="menu-item" data-action="copy-raw-data">Copy Raw Data</div>
            <div class="menu-item" data-action="copy-pubkey">Copy Public Key</div>
            <div class="menu-item" data-action="view-user-profile">View User Profile</div>
          </div>
        </div>
      </div>
      <div class="note-content">${formattedContent.text}${formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, event.id, event.pubkey) : ''}${formattedContent.quotedNotes && formattedContent.quotedNotes.length > 0 ? this.createQuotedNotes(formattedContent.quotedNotes) : ''}</div>
      <div class="note-actions">
        <div class="note-action reply-action" data-event-id="${event.id}">
          <svg width="16" height="15" viewBox="0 0 20 19" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g clip-path="url(#clip0_21_172)">
              <path d="M18.8398 1.17375C18.1031 0.430985 17.081 0 16.0405 0H3.95948C2.90055 0 1.90608 0.412645 1.16022 1.17375C0.414365 1.92568 0 2.93436 0 3.99807V16.2215C0 16.7717 0.156538 17.3036 0.460405 17.7621C0.764273 18.2206 1.18785 18.5782 1.69429 18.7891C2.02578 18.9266 2.3849 19 2.74401 19C2.92818 19 3.10313 18.9817 3.27808 18.945C3.81215 18.8349 4.30018 18.5782 4.68692 18.1839L6.29834 16.5516H16.0405C17.081 16.5516 18.1031 16.1207 18.8398 15.3779C19.5856 14.626 20 13.6173 20 12.5536V3.99807C20 2.93436 19.5856 1.92568 18.8398 1.17375ZM3.07551 3.99807C3.07551 3.75965 3.16759 3.53041 3.33333 3.36535C3.49908 3.20029 3.72007 3.10859 3.95028 3.10859H16.0313C16.2615 3.10859 16.4825 3.20029 16.6483 3.36535C16.814 3.53041 16.9061 3.75965 16.9061 3.99807V12.5536C16.9061 12.792 16.814 13.0212 16.6483 13.1863C16.4825 13.3514 16.2615 13.4431 16.0313 13.4431H5.24862C5.1105 13.4431 4.97238 13.4981 4.87109 13.5989L3.08471 15.4054V3.99807H3.07551Z" fill="currentColor"/>
            </g>
            <defs>
              <clipPath id="clip0_21_172">
                <rect width="20" height="19" fill="white"/>
              </clipPath>
            </defs>
          </svg>
          <span class="reply-count" data-event-id="${event.id}">${this.threadManager.getReplyCount(event.id) > 0 ? this.threadManager.getReplyCount(event.id) : ''}</span>
        </div>
        <div class="note-action repost-action" data-event-id="${event.id}">
          <svg width="16" height="18" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16.0352 8.11791C16.8237 8.11808 17.4883 8.70721 17.582 9.48998V11.4831C17.582 14.8189 14.8533 17.5476 11.5176 17.5476H5.99316V19.5603C5.99316 19.7272 5.9061 19.8709 5.75879 19.948C5.6104 20.0251 5.44428 20.0153 5.30664 19.9206L0.189453 16.3884C0.0676321 16.3046 0.000140374 16.1772 0 16.029C0 15.8807 0.0674907 15.7526 0.189453 15.6687L5.30664 12.1365C5.44428 12.0418 5.61139 12.032 5.75879 12.1091C5.90611 12.1872 5.99316 12.3299 5.99316 12.4968V14.4519H11.5176C13.1449 14.4519 14.4873 13.1095 14.4873 11.4822V9.48998C14.581 8.70709 15.2464 8.11791 16.0352 8.11791ZM11.8242 0.0515075C11.9726 -0.02561 12.1387 -0.0158394 12.2764 0.0788513L17.3936 3.6101C17.5156 3.69403 17.583 3.82211 17.583 3.97045C17.583 4.11883 17.5156 4.24685 17.3936 4.3308L12.2764 7.86303C12.1388 7.95759 11.9715 7.96744 11.8242 7.89037C11.6769 7.81232 11.5899 7.66949 11.5898 7.50268V5.5476H6.06543C4.43821 5.5476 3.0959 6.88922 3.0957 8.51635V10.5095C3.00183 11.2922 2.33647 11.8816 1.54785 11.8816C0.759382 11.8814 0.094857 11.2921 0.000976562 10.5095V8.51635C0.00115355 5.1808 2.72984 2.45287 6.06543 2.45287L11.5898 2.4519V0.438226C11.59 0.271594 11.6771 0.128595 11.8242 0.0515075Z" fill="currentColor"/>
          </svg>
        </div>
        <div class="note-action reaction-action" data-event-id="${event.id}">
          <svg width="18" height="16" viewBox="0 0 23 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.18607 11.8832C9.51685 11.8832 9.79674 11.7814 10.0766 11.6033L13.1809 9.49142C13.9187 8.98253 14.1223 7.96475 13.6134 7.25231C13.1045 6.51442 12.0867 6.31086 11.3743 6.81975L8.29552 8.9062C7.55763 9.41509 7.35407 10.4329 7.86296 11.1453C8.16829 11.6288 8.67718 11.8832 9.18607 11.8832Z" fill="currentColor"/>
            <path d="M6.61619 9.28787C6.94697 9.28787 7.22686 9.18609 7.53219 9.00798L10.5855 6.92153C11.3234 6.41264 11.5015 5.39486 11.0181 4.68241C10.5092 3.94452 9.49142 3.76641 8.77897 4.24986L5.72563 6.33631C4.98774 6.84519 4.80963 7.86298 5.29308 8.57542C5.59841 9.03342 6.08186 9.28787 6.61619 9.28787Z" fill="currentColor"/>
            <path d="M11.756 14.4531C12.0868 14.4531 12.3666 14.3513 12.6465 14.1732L15.7253 12.0868C16.4632 11.5779 16.6668 10.5601 16.1579 9.84765C15.649 9.10976 14.6312 8.9062 13.9188 9.41509L10.84 11.4761C10.1021 11.985 9.89853 13.0028 10.4074 13.7152C10.7382 14.1987 11.2471 14.4531 11.756 14.4531Z" fill="currentColor"/>
            <path d="M8.42276 20C10.3311 20 12.2903 19.3639 13.8679 18.0917C14.4531 17.6082 15.191 17.1248 16.107 16.5395L22.1119 12.7992C22.8752 12.3158 23.1042 11.3234 22.6462 10.5601C22.1882 9.79676 21.1705 9.56776 20.4071 10.0258L14.4022 13.7661C13.3844 14.3768 12.5448 14.962 11.8069 15.5218C9.74588 17.1757 6.81976 17.1502 4.93687 15.42C3.53742 14.1223 3.00309 12.1377 3.51198 10.3056C4.50431 6.6162 4.37709 3.76641 3.07942 0.942077C2.69775 0.127853 1.73086 -0.228369 0.942084 0.153298C0.127861 0.534965 -0.228362 1.50186 0.153305 2.29063C1.1202 4.37708 1.17108 6.48898 0.40775 9.41509C-0.431918 12.4175 0.45864 15.6235 2.74864 17.7609C4.35165 19.2367 6.36176 20 8.42276 20Z" fill="currentColor"/>
          </svg>
        </div>
        <div class="note-action zap-action" data-event-id="${event.id}">
          <svg width="14" height="16" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15.9025 6.11111C15.7069 5.64316 15.2505 5.34188 14.7353 5.34188H12.3358L14.6919 1.9359C14.9549 1.55342 14.9831 1.0641 14.7636 0.660256C14.5441 0.254273 14.1181 0 13.6486 0H6.9109C6.48925 0 6.09585 0.207265 5.86112 0.551282L0.212306 8.88462C-0.046335 9.26496 -0.070243 9.75214 0.149276 10.156C0.368795 10.5598 0.794793 10.8098 1.25991 10.8098H4.65485L0.996924 18.2179C0.727416 18.7628 0.894772 19.4124 1.39684 19.7671C1.61201 19.9188 1.86631 20 2.13147 20C2.46401 20 2.77699 19.8739 3.01607 19.6453L15.6221 7.46581C15.9894 7.11111 16.1003 6.57906 15.9047 6.11325L15.9025 6.11111ZM11.2687 2.47863L8.91265 5.88462C8.64967 6.26709 8.62141 6.75641 8.84093 7.16026C9.06045 7.56624 9.48645 7.82051 9.95591 7.82051H11.6556L6.45447 12.8462L7.80419 10.1154C7.99546 9.72863 7.97155 9.27991 7.73899 8.91667C7.50643 8.55128 7.10869 8.33547 6.66965 8.33547H3.61594L7.58685 2.48077H11.2687V2.47863Z" fill="currentColor"/>
          </svg>
        </div>
      </div>
    `;
    
    // Add event listeners
    this.setupReactionButton(noteDiv.querySelector('.reaction-action'), event);
    this.setupReplyButton(noteDiv.querySelector('.reply-action'), event);
    this.setupRepostButton(noteDiv.querySelector('.repost-action'), event);
    this.setupZapButton(noteDiv.querySelector('.zap-action'), event);
    this.setupNoteMenu(noteDiv.querySelector('.note-menu'), event);
    this.setupClickableLinks(noteDiv, event);
    
    // Fetch historical replies to get accurate counts
    this.threadManager.fetchRepliesForNote(event.id, this.relayConnections);
    
    // Add click-to-expand/open functionality for note content
    this.setupNoteContentClick(noteDiv, event);
    
    return noteDiv;
  }

  createRepostElement(repostEvent, originalNote) {
    console.log('🏗️ createRepostElement - Repost ID:', repostEvent.id.substring(0, 16) + '...', 'Original ID:', originalNote.id.substring(0, 16) + '...', 'Original author:', originalNote.pubkey.substring(0, 16) + '...');
    
    // Proactively fetch original note author's profile if not cached
    if (!this.profiles.has(originalNote.pubkey)) {
      console.log('📤 createRepostElement fetching profile for original author:', originalNote.pubkey.substring(0, 16) + '...');
      this.fetchProfileForAuthor(originalNote.pubkey);
    } else {
      console.log('✅ createRepostElement - Original author profile already cached');
    }
    
    const repostDiv = document.createElement('div');
    repostDiv.className = 'note repost';
    repostDiv.dataset.eventId = `repost-${repostEvent.id}`;
    repostDiv.dataset.originalEventId = originalNote.id;
    repostDiv.dataset.timestamp = repostEvent.created_at;

    // Get reposter info
    const reposterProfile = this.profiles.get(repostEvent.pubkey);
    const reposterName = reposterProfile?.display_name || reposterProfile?.name || this.getAuthorName(repostEvent.pubkey);
    
    // Get original note info
    const originalProfile = this.profiles.get(originalNote.pubkey);
    const originalAuthorName = originalProfile?.display_name || originalProfile?.name || this.getAuthorName(originalNote.pubkey);
    const repostTimeAgo = this.formatTimeAgo(repostEvent.created_at);
    const originalAvatarUrl = originalProfile?.picture;
    const originalAuthorId = this.formatProfileIdentifier(originalProfile?.nip05, originalNote.pubkey);
    
    console.log('👤 createRepostElement profile info - Original profile found:', !!originalProfile, 'Display name:', originalProfile?.display_name, 'Name:', originalProfile?.name, 'Final name used:', originalAuthorName);

    // Process original note content
    const formattedContent = this.formatNoteContent(originalNote.content);

    // Create repost HTML with repost indicator
    repostDiv.innerHTML = `
      <div class="repost-indicator">
        <svg width="14" height="16" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 6px;">
          <path d="M16.0352 8.11791C16.8237 8.11808 17.4883 8.70721 17.582 9.48998V11.4831C17.582 14.8189 14.8533 17.5476 11.5176 17.5476H5.99316V19.5603C5.99316 19.7272 5.9061 19.8709 5.75879 19.948C5.6104 20.0251 5.44428 20.0153 5.30664 19.9206L0.189453 16.3884C0.0676321 16.3046 0.000140374 16.1772 0 16.029C0 15.8807 0.0674907 15.7526 0.189453 15.6687L5.30664 12.1365C5.44428 12.0418 5.61139 12.032 5.75879 12.1091C5.90611 12.1872 5.99316 12.3299 5.99316 12.4968V14.4519H11.5176C13.1449 14.4519 14.4873 13.1095 14.4873 11.4822V9.48998C14.581 8.70709 15.2464 8.11791 16.0352 8.11791ZM11.8242 0.0515075C11.9726 -0.02561 12.1387 -0.0158394 12.2764 0.0788513L17.3936 3.6101C17.5156 3.69403 17.583 3.82211 17.583 3.97045C17.583 4.11883 17.5156 4.24685 17.3936 4.3308L12.2764 7.86303C12.1388 7.95759 11.9715 7.96744 11.8242 7.89037C11.6769 7.81232 11.5899 7.66949 11.5898 7.50268V5.5476H6.06543C4.43821 5.5476 3.0959 6.88922 3.0957 8.51635V10.5095C3.00183 11.2922 2.33647 11.8816 1.54785 11.8816C0.759382 11.8814 0.094857 11.2921 0.000976562 10.5095V8.51635C0.00115355 5.1808 2.72984 2.45287 6.06543 2.45287L11.5898 2.4519V0.438226C11.59 0.271594 11.6771 0.128595 11.8242 0.0515075Z" fill="currentColor"/>
        </svg>
        <span>${reposterName} reposted</span>
      </div>
      <div class="note-header">
        <div class="note-avatar" data-profile-link="${window.NostrTools.nip19.npubEncode(originalNote.pubkey)}">
          ${originalAvatarUrl ? 
            `<img src="${originalAvatarUrl}" alt="" class="avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="avatar-placeholder" style="display: none;">${this.getAvatarPlaceholder(originalAuthorName)}</div>` :
            `<div class="avatar-placeholder">${this.getAvatarPlaceholder(originalAuthorName)}</div>`
          }
        </div>
        <div class="note-info">
          <span class="note-author" data-profile-link="${window.NostrTools.nip19.npubEncode(originalNote.pubkey)}">${originalAuthorName}</span>
          <span class="note-npub" ${originalProfile?.nip05 ? 'data-nip05="true"' : ''}>${originalAuthorId}</span>
        </div>
        <span class="note-time" data-note-link="${repostEvent.id}">${repostTimeAgo}</span>
        <div class="note-menu">
          <button class="menu-btn" data-event-id="${originalNote.id}">⋯</button>
          <div class="menu-dropdown" data-event-id="${originalNote.id}">
            <div class="menu-item" data-action="open-note">Open Note</div>
            <div class="menu-item" data-action="copy-note-id">Copy Note ID</div>
            <div class="menu-item" data-action="copy-note-text">Copy Note Text</div>
            <div class="menu-item" data-action="copy-raw-data">Copy Raw Data</div>
            <div class="menu-item" data-action="copy-pubkey">Copy Public Key</div>
            <div class="menu-item" data-action="view-user-profile">View User Profile</div>
          </div>
        </div>
      </div>
      <div class="note-content">${formattedContent.text}${formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, originalNote.id, originalNote.pubkey) : ''}${formattedContent.quotedNotes && formattedContent.quotedNotes.length > 0 ? this.createQuotedNotes(formattedContent.quotedNotes) : ''}</div>
      <div class="note-actions">
        <div class="note-action reply-action" data-event-id="${originalNote.id}">
          <svg width="16" height="15" viewBox="0 0 20 19" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g clip-path="url(#clip0_21_172)">
              <path d="M18.8398 1.17375C18.1031 0.430985 17.081 0 16.0405 0H3.95948C2.90055 0 1.90608 0.412645 1.16022 1.17375C0.414365 1.92568 0 2.93436 0 3.99807V16.2215C0 16.7717 0.156538 17.3036 0.460405 17.7621C0.764273 18.2206 1.18785 18.5782 1.69429 18.7891C2.02578 18.9266 2.3849 19 2.74401 19C2.92818 19 3.10313 18.9817 3.27808 18.945C3.81215 18.8349 4.30018 18.5782 4.68692 18.1839L6.29834 16.5516H16.0405C17.081 16.5516 18.1031 16.1207 18.8398 15.3779C19.5856 14.626 20 13.6173 20 12.5536V3.99807C20 2.93436 19.5856 1.92568 18.8398 1.17375ZM3.07551 3.99807C3.07551 3.75965 3.16759 3.53041 3.33333 3.36535C3.49908 3.20029 3.72007 3.10859 3.95028 3.10859H16.0313C16.2615 3.10859 16.4825 3.20029 16.6483 3.36535C16.814 3.53041 16.9061 3.75965 16.9061 3.99807V12.5536C16.9061 12.792 16.814 13.0212 16.6483 13.1863C16.4825 13.3514 16.2615 13.4431 16.0313 13.4431H5.24862C5.1105 13.4431 4.97238 13.4981 4.87109 13.5989L3.08471 15.4054V3.99807H3.07551Z" fill="currentColor"/>
            </g>
            <defs>
              <clipPath id="clip0_21_172">
                <rect width="20" height="19" fill="white"/>
              </clipPath>
            </defs>
          </svg>
          <span class="reply-count" data-event-id="${originalNote.id}">${this.threadManager.getReplyCount(originalNote.id) > 0 ? this.threadManager.getReplyCount(originalNote.id) : ''}</span>
        </div>
        <div class="note-action repost-action" data-event-id="${originalNote.id}">
          <svg width="16" height="18" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16.0352 8.11791C16.8237 8.11808 17.4883 8.70721 17.582 9.48998V11.4831C17.582 14.8189 14.8533 17.5476 11.5176 17.5476H5.99316V19.5603C5.99316 19.7272 5.9061 19.8709 5.75879 19.948C5.6104 20.0251 5.44428 20.0153 5.30664 19.9206L0.189453 16.3884C0.0676321 16.3046 0.000140374 16.1772 0 16.029C0 15.8807 0.0674907 15.7526 0.189453 15.6687L5.30664 12.1365C5.44428 12.0418 5.61139 12.032 5.75879 12.1091C5.90611 12.1872 5.99316 12.3299 5.99316 12.4968V14.4519H11.5176C13.1449 14.4519 14.4873 13.1095 14.4873 11.4822V9.48998C14.581 8.70709 15.2464 8.11791 16.0352 8.11791ZM11.8242 0.0515075C11.9726 -0.02561 12.1387 -0.0158394 12.2764 0.0788513L17.3936 3.6101C17.5156 3.69403 17.583 3.82211 17.583 3.97045C17.583 4.11883 17.5156 4.24685 17.3936 4.3308L12.2764 7.86303C12.1388 7.95759 11.9715 7.96744 11.8242 7.89037C11.6769 7.81232 11.5899 7.66949 11.5898 7.50268V5.5476H6.06543C4.43821 5.5476 3.0959 6.88922 3.0957 8.51635V10.5095C3.00183 11.2922 2.33647 11.8816 1.54785 11.8816C0.759382 11.8814 0.094857 11.2921 0.000976562 10.5095V8.51635C0.00115355 5.1808 2.72984 2.45287 6.06543 2.45287L11.5898 2.4519V0.438226C11.59 0.271594 11.6771 0.128595 11.8242 0.0515075Z" fill="currentColor"/>
          </svg>
        </div>
        <div class="note-action reaction-action" data-event-id="${originalNote.id}">
          <svg width="18" height="16" viewBox="0 0 23 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.18607 11.8832C9.51685 11.8832 9.79674 11.7814 10.0766 11.6033L13.1809 9.49142C13.9187 8.98253 14.1223 7.96475 13.6134 7.25231C13.1045 6.51442 12.0867 6.31086 11.3743 6.81975L8.29552 8.9062C7.55763 9.41509 7.35407 10.4329 7.86296 11.1453C8.16829 11.6288 8.67718 11.8832 9.18607 11.8832Z" fill="currentColor"/>
            <path d="M6.61619 9.28787C6.94697 9.28787 7.22686 9.18609 7.53219 9.00798L10.5855 6.92153C11.3234 6.41264 11.5015 5.39486 11.0181 4.68241C10.5092 3.94452 9.49142 3.76641 8.77897 4.24986L5.72563 6.33631C4.98774 6.84519 4.80963 7.86298 5.29308 8.57542C5.59841 9.03342 6.08186 9.28787 6.61619 9.28787Z" fill="currentColor"/>
            <path d="M11.756 14.4531C12.0868 14.4531 12.3666 14.3513 12.6465 14.1732L15.7253 12.0868C16.4632 11.5779 16.6668 10.5601 16.1579 9.84765C15.649 9.10976 14.6312 8.9062 13.9188 9.41509L10.84 11.4761C10.1021 11.985 9.89853 13.0028 10.4074 13.7152C10.7382 14.1987 11.2471 14.4531 11.756 14.4531Z" fill="currentColor"/>
            <path d="M8.42276 20C10.3311 20 12.2903 19.3639 13.8679 18.0917C14.4531 17.6082 15.191 17.1248 16.107 16.5395L22.1119 12.7992C22.8752 12.3158 23.1042 11.3234 22.6462 10.5601C22.1882 9.79676 21.1705 9.56776 20.4071 10.0258L14.4022 13.7661C13.3844 14.3768 12.5448 14.962 11.8069 15.5218C9.74588 17.1757 6.81976 17.1502 4.93687 15.42C3.53742 14.1223 3.00309 12.1377 3.51198 10.3056C4.50431 6.6162 4.37709 3.76641 3.07942 0.942077C2.69775 0.127853 1.73086 -0.228369 0.942084 0.153298C0.127861 0.534965 -0.228362 1.50186 0.153305 2.29063C1.1202 4.37708 1.17108 6.48898 0.40775 9.41509C-0.431918 12.4175 0.45864 15.6235 2.74864 17.7609C4.35165 19.2367 6.36176 20 8.42276 20Z" fill="currentColor"/>
          </svg>
        </div>
        <div class="note-action zap-action" data-event-id="${originalNote.id}">
          <svg width="14" height="16" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15.9025 6.11111C15.7069 5.64316 15.2505 5.34188 14.7353 5.34188H12.3358L14.6919 1.9359C14.9549 1.55342 14.9831 1.0641 14.7636 0.660256C14.5441 0.254273 14.1181 0 13.6486 0H6.9109C6.48925 0 6.09585 0.207265 5.86112 0.551282L0.212306 8.88462C-0.046335 9.26496 -0.070243 9.75214 0.149276 10.156C0.368795 10.5598 0.794793 10.8098 1.25991 10.8098H4.65485L0.996924 18.2179C0.727416 18.7628 0.894772 19.4124 1.39684 19.7671C1.61201 19.9188 1.86631 20 2.13147 20C2.46401 20 2.77699 19.8739 3.01607 19.6453L15.6221 7.46581C15.9894 7.11111 16.1003 6.57906 15.9047 6.11325L15.9025 6.11111ZM11.2687 2.47863L8.91265 5.88462C8.64967 6.26709 8.62141 6.75641 8.84093 7.16026C9.06045 7.56624 9.48645 7.82051 9.95591 7.82051H11.6556L6.45447 12.8462L7.80419 10.1154C7.99546 9.72863 7.97155 9.27991 7.73899 8.91667C7.50643 8.55128 7.10869 8.33547 6.66965 8.33547H3.61594L7.58685 2.48077H11.2687V2.47863Z" fill="currentColor"/>
          </svg>
        </div>
      </div>
    `;

    // Set up event listeners for the repost (using original note ID for actions)
    this.setupReactionButton(repostDiv.querySelector('.reaction-action'), originalNote);
    this.setupReplyButton(repostDiv.querySelector('.reply-action'), originalNote);
    this.setupRepostButton(repostDiv.querySelector('.repost-action'), originalNote);
    this.setupZapButton(repostDiv.querySelector('.zap-action'), originalNote);
    this.setupNoteMenu(repostDiv.querySelector('.note-menu'), originalNote);
    this.setupClickableLinks(repostDiv, originalNote);
    
    // Fetch historical replies to get accurate counts for the original note
    this.threadManager.fetchRepliesForNote(originalNote.id, this.relayConnections);
    console.log('🔗 Setting up click-to-open for repost of note:', originalNote.id.substring(0, 16) + '...');
    this.setupNoteContentClick(repostDiv, originalNote);

    return repostDiv;
  }
  
  setupReplyButton(button, event) {
    if (!button) return;
    
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('💬 Reply button clicked for note:', event.id.substring(0, 16) + '...');
      this.showReplyModal(event);
    });
  }

  setupRepostButton(button, event) {
    if (!button) {
      console.log('❌ Repost button not found for note:', event.id.substring(0, 16) + '...');
      return;
    }
    
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('🔁 Repost button clicked for note:', event.id.substring(0, 16) + '...');
      this.showRepostModal(event);
    });
  }

  setupZapButton(button, event) {
    console.log('🔧 Setting up zap button for note:', event.id.substring(0, 16) + '...');
    
    if (!button) {
      console.log('❌ Zap button not found for note:', event.id.substring(0, 16) + '...');
      return;
    }
    
    console.log('✅ Zap button found, adding click listener for note:', event.id.substring(0, 16) + '...');
    
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('⚡ Zap button clicked for note:', event.id.substring(0, 16) + '...');
      this.showZapModal(event);
    });
    
    // Initialize zap display for this note if it has zap receipts
    this.updateZapDisplay(event.id);
    
    // Request zap receipts for this note
    this.requestZapReceipts(event.id);
  }

  showReplyModal(event) {
    if (!this.currentUser) {
      alert('Please sign in to reply to notes');
      return;
    }
    
    console.log('💬 Opening reply modal for note:', event.id.substring(0, 16) + '...');
    
    // Show the original note context
    const replyContext = document.getElementById('reply-to-note');
    const profile = this.profiles.get(event.pubkey);
    const authorName = profile?.display_name || profile?.name || this.getAuthorName(event.pubkey);
    const timeAgo = this.formatTimeAgo(event.created_at);
    
    replyContext.innerHTML = `
      <div class="reply-original-note">
        <div class="reply-author">${authorName}</div>
        <div class="reply-time">${timeAgo}</div>
        <div class="reply-content">${event.content.length > 200 ? event.content.substring(0, 200) + '...' : event.content}</div>
      </div>
    `;
    
    // Clear reply text and reset state
    const replyText = document.getElementById('reply-text');
    const sendBtn = document.getElementById('send-reply-btn');
    const cancelBtn = document.getElementById('cancel-reply-btn');
    const charCount = document.getElementById('reply-char-count');
    
    replyText.value = '';
    replyText.disabled = false;
    charCount.textContent = '2100';
    charCount.style.display = 'none';
    sendBtn.disabled = true;
    sendBtn.textContent = 'Reply';
    cancelBtn.textContent = 'Cancel';
    
    // Reset countdown state
    if (this.currentCountdownInterval) {
      clearInterval(this.currentCountdownInterval);
      this.currentCountdownInterval = null;
    }
    this.isPublishingCountdown = false;
    
    // Store the event we're replying to
    this.replyingToEvent = event;
    
    // Show modal
    document.getElementById('reply-modal').classList.remove('hidden');
    replyText.focus();
  }

  updateReplyCharCount() {
    const replyText = document.getElementById('reply-text');
    const charCount = document.getElementById('reply-char-count');
    const sendBtn = document.getElementById('send-reply-btn');
    
    const remaining = 2100 - replyText.value.length;
    charCount.textContent = remaining;
    charCount.style.display = replyText.value.length > 0 ? 'inline' : 'none';
    charCount.style.color = remaining < 100 ? '#ea772f' : '#9e4280';
    
    sendBtn.disabled = replyText.value.trim().length === 0 || remaining < 0;
  }

  async sendReply() {
    if (!this.currentUser || !this.replyingToEvent) return;
    
    const replyText = document.getElementById('reply-text').value.trim();
    if (!replyText) return;

    // Show countdown for reply
    this.showReplyCountdown(replyText);
  }

  async showReplyCountdown(replyContent) {
    const sendBtn = document.getElementById('send-reply-btn');
    const undoBtn = document.getElementById('cancel-reply-btn');
    const replyText = document.getElementById('reply-text');
    
    // Set publishing state flag
    this.isPublishingCountdown = true;
    
    // Disable text editing during countdown
    replyText.disabled = true;
    
    // Store original button states
    const originalSendText = sendBtn.textContent;
    const originalSendDisabled = sendBtn.disabled;
    
    // Change cancel button to "Undo"
    undoBtn.textContent = 'Undo';
    sendBtn.disabled = true;
    
    let countdown = 5;
    let countdownInterval;
    
    // Store the countdown interval so we can cancel it
    this.currentCountdownInterval = countdownInterval;
    
    // Start countdown
    const updateCountdown = () => {
      sendBtn.textContent = `Publishing in ${countdown}...`;
      countdown--;
      
      if (countdown < 0) {
        clearInterval(countdownInterval);
        this.actuallyPublishReply(replyContent, originalSendText, originalSendDisabled);
      }
    };
    
    updateCountdown(); // Show initial countdown
    countdownInterval = setInterval(updateCountdown, 1000);
    this.currentCountdownInterval = countdownInterval;
  }

  async actuallyPublishReply(replyContent, originalSendText, originalSendDisabled) {
    console.log('💬 Publishing reply:', replyContent.substring(0, 50) + '...');
    console.log('💬 Replying to:', this.replyingToEvent.id.substring(0, 16) + '...');
    
    const event = {
      kind: 1,
      content: replyContent,
      tags: [
        ['e', this.replyingToEvent.id, '', 'reply'],
        ['p', this.replyingToEvent.pubkey],
        ['client', 'sidecar', 'https://github.com/dmnyc/sidecar', 'wss://relay.damus.io']
      ],
      created_at: Math.floor(Date.now() / 1000),
    };
    
    try {
      const signedEvent = await this.signEvent(event);
      await this.publishEvent(signedEvent);
      
      console.log('✅ Reply published successfully');
      this.hideModal('reply-modal');
      
      // Reset state
      this.isPublishingCountdown = false;
      this.currentCountdownInterval = null;
      
    } catch (error) {
      console.error('❌ Failed to send reply:', error);
      alert('Failed to send reply. Please try again.');
      
      // Restore button states on error
      const sendBtn = document.getElementById('send-reply-btn');
      const undoBtn = document.getElementById('cancel-reply-btn');
      const replyText = document.getElementById('reply-text');
      
      sendBtn.textContent = originalSendText;
      sendBtn.disabled = originalSendDisabled;
      undoBtn.textContent = 'Cancel';
      replyText.disabled = false;
      
      this.isPublishingCountdown = false;
      this.currentCountdownInterval = null;
    }
  }

  showRepostModal(event) {
    console.log('🔁 showRepostModal called for note:', event.id.substring(0, 16) + '...');
    
    if (!this.currentUser) {
      alert('Please sign in to repost notes');
      return;
    }

    console.log('🔁 Opening repost modal for note:', event.id.substring(0, 16) + '...');

    // Store the event we're reposting
    this.repostingEvent = event;

    // Show note context in modal
    const profile = this.profiles.get(event.pubkey);
    const authorName = profile?.display_name || profile?.name || this.getAuthorName(event.pubkey);
    const timeAgo = this.formatTimeAgo(event.created_at);
    
    document.getElementById('repost-note').innerHTML = `
      <div class="note-author">${authorName} • ${timeAgo}</div>
      <div class="reply-content">${event.content.length > 200 ? event.content.substring(0, 200) + '...' : event.content}</div>
    `;

    // Reset modal state
    this.hideQuoteCompose();
    
    // Reset countdown state
    if (this.currentCountdownInterval) {
      clearInterval(this.currentCountdownInterval);
      this.currentCountdownInterval = null;
    }
    this.isPublishingCountdown = false;
    
    // Show the repost modal
    document.getElementById('repost-modal').classList.remove('hidden');
  }

  showZapModal(event) {
    console.log('⚡ showZapModal called for note:', event.id.substring(0, 16) + '...');
    
    // Clean up any stuck WebLN session when opening modal
    if (this.webLNSessionActive) {
      console.log('⚠️ WebLN session active during modal open, forcing unlock');
      this.webLNSessionActive = false;
    }
    
    // Store the event we're zapping
    this.zappingEvent = event;
    
    // Stop any existing payment monitoring from previous zaps
    this.stopPaymentMonitoring();
    this.currentZapInvoice = null;
    
    // Get recipient info (the note author)
    const profile = this.profiles.get(event.pubkey);
    const authorName = profile?.display_name || profile?.name || this.getAuthorName(event.pubkey);
    const npub = window.NostrTools.nip19.npubEncode(event.pubkey).substring(0, 16) + '...';
    
    // Update modal with recipient info
    document.getElementById('zap-recipient-name').textContent = authorName;
    document.getElementById('zap-recipient-npub').textContent = npub;
    
    // Reset modal state
    document.getElementById('zap-amount').value = 21;
    document.getElementById('zap-comment').value = '';
    
    // Clear and hide invoice display (removes any previous success messages)
    const zapInvoiceDisplay = document.getElementById('zap-invoice-display');
    zapInvoiceDisplay.innerHTML = '';
    zapInvoiceDisplay.classList.add('hidden');
    
    // Reset button visibility - show Create Invoice button
    const sendZapBtn = document.getElementById('send-zap-btn');
    if (sendZapBtn) {
      sendZapBtn.style.display = 'block';
    }
    
    // Unlock amount and comment fields for new invoice
    const zapAmountField = document.getElementById('zap-amount');
    const zapCommentField = document.getElementById('zap-comment');
    if (zapAmountField) {
      zapAmountField.disabled = false;
      zapAmountField.style.opacity = '1';
    }
    if (zapCommentField) {
      zapCommentField.disabled = false;
      zapCommentField.style.opacity = '1';
    }
    
    // Remove any success overlays from previous payments
    const existingOverlays = document.querySelectorAll('.payment-success-overlay');
    existingOverlays.forEach(overlay => overlay.remove());
    
    // Reset Zap button state
    const payWithWalletBtn = document.getElementById('pay-with-wallet-btn');
    if (payWithWalletBtn) {
      payWithWalletBtn.textContent = 'Zap!';
      payWithWalletBtn.disabled = false;
    }
    
    // Initialize wallet UI state
    this.updateWalletAvailability(); // Check if WebLN is available
    this.updateWalletUI(); // Update connection status
    
    // Show the zap modal
    document.getElementById('zap-modal').classList.remove('hidden');
  }

  async sendSimpleRepost() {
    if (!this.currentUser || !this.repostingEvent) return;

    console.log('🔁 Sending simple repost for note:', this.repostingEvent.id.substring(0, 16) + '...');

    const event = {
      kind: 6, // Repost event kind
      content: '',
      tags: [
        ['e', this.repostingEvent.id],
        ['p', this.repostingEvent.pubkey],
        ['client', 'sidecar', 'https://github.com/dmnyc/sidecar', 'wss://relay.damus.io']
      ],
      created_at: Math.floor(Date.now() / 1000),
    };

    try {
      const signedEvent = await this.signEvent(event);
      await this.publishEvent(signedEvent);
      
      console.log('✅ Simple repost published successfully');
      
      // Immediately handle the repost locally to display it
      this.handleRepost(signedEvent);
      
      this.hideModal('repost-modal');
      this.showNotePostedNotification();
      
    } catch (error) {
      console.error('❌ Failed to send repost:', error);
      alert('Failed to repost. Please try again.');
    }
  }

  showQuoteCompose() {
    // Hide the repost modal and show the regular compose section
    this.hideModal('repost-modal');
    
    // Show the regular compose section
    this.showComposeSection();
    
    // Add the quoted note preview below the compose area
    this.addQuotePreview();
    
    // Focus on the compose text area
    document.getElementById('compose-text').focus();
  }

  addQuotePreview() {
    if (!this.repostingEvent) return;

    // Get or create the quote preview container
    let quotePreview = document.getElementById('quote-preview');
    if (!quotePreview) {
      quotePreview = document.createElement('div');
      quotePreview.id = 'quote-preview';
      quotePreview.className = 'quote-preview';
      
      // Insert after the compose textarea
      const composeSection = document.getElementById('compose-section');
      const composeActions = composeSection.querySelector('.compose-actions');
      composeSection.insertBefore(quotePreview, composeActions);
    }

    // Show quote preview with the note content
    const event = this.repostingEvent;
    const profile = this.profiles.get(event.pubkey);
    const authorName = profile?.display_name || profile?.name || this.getAuthorName(event.pubkey);
    const timeAgo = this.formatTimeAgo(event.created_at);
    
    quotePreview.innerHTML = `
      <div class="quote-preview-header">
        <span>Quoting:</span>
        <button id="remove-quote-btn" class="remove-quote-btn">×</button>
      </div>
      <div class="quote-preview-content">
        <div class="note-author">${authorName} • ${timeAgo}</div>
        <div class="quote-preview-text">${event.content.length > 200 ? event.content.substring(0, 200) + '...' : event.content}</div>
      </div>
    `;

    // Add remove quote functionality
    document.getElementById('remove-quote-btn').addEventListener('click', () => {
      this.removeQuotePreview();
    });

    // Mark that we're in quote mode
    this.isQuoting = true;
    
    // Update the post button text
    const postBtn = document.getElementById('post-btn');
    postBtn.textContent = 'Quote Post';
  }

  removeQuotePreview() {
    const quotePreview = document.getElementById('quote-preview');
    if (quotePreview) {
      quotePreview.remove();
    }
    
    this.isQuoting = false;
    this.repostingEvent = null;
    
    // Restore the post button text
    const postBtn = document.getElementById('post-btn');
    postBtn.textContent = 'Post';
  }

  hideQuoteCompose() {
    const quoteCompose = document.getElementById('quote-compose');
    const quoteText = document.getElementById('quote-text');
    const sendBtn = document.getElementById('send-quote-btn');
    const cancelBtn = document.getElementById('cancel-quote-btn');
    const charCount = document.getElementById('quote-char-count');
    
    quoteCompose.classList.add('hidden');
    quoteText.value = '';
    quoteText.disabled = false;
    sendBtn.textContent = 'Post Quote';
    sendBtn.disabled = true;
    cancelBtn.textContent = 'Cancel';
    charCount.style.display = 'none';
    
    this.updateQuoteCharCount();
  }

  updateQuoteCharCount() {
    const quoteText = document.getElementById('quote-text');
    const charCount = document.getElementById('quote-char-count');
    const sendBtn = document.getElementById('send-quote-btn');
    
    const remaining = 2100 - quoteText.value.length;
    const hasText = quoteText.value.trim().length > 0;
    
    // Always show character count when there's text
    if (hasText) {
      charCount.textContent = remaining;
      charCount.style.display = 'inline';
      
      charCount.className = 'char-count';
      if (remaining < 100) charCount.classList.add('warning');
      if (remaining < 0) charCount.classList.add('error');
    } else {
      charCount.style.display = 'none';
    }
    
    // Enable/disable Post Quote button only
    sendBtn.disabled = remaining < 0 || !hasText;
  }

  async sendQuotePost() {
    if (!this.currentUser || !this.repostingEvent) return;
    
    const quoteText = document.getElementById('quote-text').value.trim();
    if (!quoteText) return;

    // Show countdown for quote post
    this.showQuoteCountdown(quoteText);
  }

  async showQuoteCountdown(quoteContent) {
    const sendBtn = document.getElementById('send-quote-btn');
    const cancelBtn = document.getElementById('cancel-quote-btn');
    const quoteText = document.getElementById('quote-text');
    
    // Set publishing state flag
    this.isPublishingCountdown = true;
    
    // Disable text editing during countdown
    quoteText.disabled = true;
    
    // Store original button states
    const originalSendText = sendBtn.textContent;
    const originalSendDisabled = sendBtn.disabled;
    
    // Change cancel button to "Undo"
    cancelBtn.textContent = 'Undo';
    sendBtn.disabled = true;
    
    let countdown = 5;
    let countdownInterval;
    
    // Store the countdown interval so we can cancel it
    this.currentCountdownInterval = countdownInterval;
    
    // Start countdown
    const updateCountdown = () => {
      sendBtn.textContent = `Publishing in ${countdown}...`;
      countdown--;
      
      if (countdown < 0) {
        clearInterval(countdownInterval);
        this.actuallyPublishQuote(quoteContent, originalSendText, originalSendDisabled);
      }
    };
    
    updateCountdown(); // Show initial countdown
    countdownInterval = setInterval(updateCountdown, 1000);
    this.currentCountdownInterval = countdownInterval;
  }

  async actuallyPublishQuote(quoteContent, originalSendText, originalSendDisabled) {
    console.log('🔁 Publishing quote post:', quoteContent.substring(0, 50) + '...');
    console.log('🔁 Quoting note:', this.repostingEvent.id.substring(0, 16) + '...');

    // Create quote post with the original note ID at the end
    const noteId = window.NostrTools.nip19.noteEncode(this.repostingEvent.id);
    const content = `${quoteContent}\n\nnostr:${noteId}`;

    const event = {
      kind: 1,
      content: content,
      tags: [
        ['e', this.repostingEvent.id, '', 'mention'],
        ['p', this.repostingEvent.pubkey],
        ['client', 'sidecar', 'https://github.com/dmnyc/sidecar', 'wss://relay.damus.io']
      ],
      created_at: Math.floor(Date.now() / 1000),
    };

    try {
      const signedEvent = await this.signEvent(event);
      await this.publishEvent(signedEvent);
      
      console.log('✅ Quote post published successfully');
      this.hideModal('repost-modal');
      this.showNotePostedNotification();
      
      // Reset state
      this.isPublishingCountdown = false;
      this.currentCountdownInterval = null;
      
      // Add to feed
      this.handleNote(signedEvent);
      
    } catch (error) {
      console.error('❌ Failed to send quote post:', error);
      alert('Failed to send quote post. Please try again.');
      
      // Restore button states on error
      const sendBtn = document.getElementById('send-quote-btn');
      const cancelBtn = document.getElementById('cancel-quote-btn');
      const quoteText = document.getElementById('quote-text');
      
      sendBtn.textContent = originalSendText;
      sendBtn.disabled = originalSendDisabled;
      cancelBtn.textContent = 'Cancel';
      quoteText.disabled = false;
      
      this.isPublishingCountdown = false;
      this.currentCountdownInterval = null;
    }
  }

  
  getAuthorName(pubkey) {
    const profile = this.profiles.get(pubkey);
    if (profile && (profile.display_name || profile.name)) {
      return (profile.display_name || profile.name).trim();
    }
    
    // If no profile available, use the new profile fetching system
    if (!profile) {
      // Check both old and new request tracking systems
      const oldSystemRequesting = this.profileRequests.has(pubkey);
      const newSystemRequesting = this.profileFetchRequests?.has(pubkey);
      const notFound = this.profileNotFound?.has(pubkey);
      
      if (!oldSystemRequesting && !newSystemRequesting && !notFound) {
        console.log('🔄 getAuthorName triggering profile fetch for:', pubkey.substring(0, 16) + '...');
        this.fetchProfileForAuthor(pubkey);
      }
    }
    
    // Provide a more user-friendly fallback while waiting for profile
    return 'User ' + pubkey.substring(0, 8);
  }
  
  truncateUsername(username, maxLength = 15) {
    if (!username) return '';
    if (username.length <= maxLength) return username;
    return username.substring(0, maxLength) + '...';
  }
  
  getAvatarPlaceholder(name) {
    // Generate a simple initial from the name
    const initial = (name?.charAt(0) || '?').toUpperCase();
    return initial;
  }
  
  formatTimeAgo(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }
  
  parseNostrLinks(content) {
    const results = {
      inlineProfiles: [], // npub/nprofile -> @username
      quotedNotes: [], // note/nevent/naddr -> quoted reposts
      cleanContent: content
    };
    
    // Match all nostr: links
    const nostrLinkRegex = /nostr:([a-zA-Z0-9]+)/g;
    let match;
    
    while ((match = nostrLinkRegex.exec(content)) !== null) {
      const fullMatch = match[0]; // "nostr:npub1..."
      const bech32 = match[1]; // "npub1..."
      
      try {
        const decoded = window.NostrTools.nip19.decode(bech32);
        
        if (decoded.type === 'npub' || decoded.type === 'nprofile') {
          // User profiles - display inline as @username
          const pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey;
          const profile = this.profiles.get(pubkey);
          const username = (profile?.display_name || profile?.name || this.getAuthorName(pubkey))?.trim();
          
          // If we don't have the profile, fetch it
          if (!profile) {
            this.requestProfile(pubkey);
          }
          
          results.inlineProfiles.push({
            original: fullMatch,
            pubkey: pubkey,
            username: username,
            bech32: bech32
          });
          
          // Don't remove inline profiles from content - they'll be replaced inline
          
        } else if (decoded.type === 'note' || decoded.type === 'nevent' || decoded.type === 'naddr') {
          // Notes/events - display as quoted reposts at end
          const eventId = decoded.type === 'note' ? decoded.data : 
                         decoded.type === 'nevent' ? decoded.data.id : 
                         decoded.data.identifier; // for naddr
          
          results.quotedNotes.push({
            original: fullMatch,
            eventId: eventId,
            type: decoded.type,
            bech32: bech32,
            data: decoded.data
          });
          
          // Remove quoted notes from content (will be processed separately)
          results.cleanContent = results.cleanContent.replace(fullMatch, '');
        }
        
      } catch (error) {
        console.log('Failed to decode nostr link:', bech32, error);
        // Leave invalid links as-is
      }
    }
    
    return results;
  }
  
  formatNoteContent(content) {
    // First parse nostr: links
    const nostrParsed = this.parseNostrLinks(content);
    
    // Start with original content and process inline mentions
    let textContent = content;
    
    // Process inline profile mentions (npub/nprofile -> @username)
    nostrParsed.inlineProfiles.forEach(profile => {
      const truncatedUsername = this.truncateUsername(profile.username, 20);
      const inlineMention = `<span class="nostr-mention" data-pubkey="${profile.pubkey}" data-bech32="${profile.bech32}" title="@${profile.username}">@${truncatedUsername}</span>`;
      textContent = textContent.replace(profile.original, inlineMention);
    });
    
    // Remove quoted notes from text (they'll be displayed separately)
    nostrParsed.quotedNotes.forEach(quoted => {
      textContent = textContent.replace(quoted.original, '');
    });
    
    // Extract image URLs (common image extensions)
    const imageRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?[^\s]*)?)/gi;
    const images = textContent.match(imageRegex) || [];
    
    // Remove image URLs from text content and any line breaks they leave
    images.forEach(img => {
      // Remove the image URL and any surrounding line breaks/whitespace
      textContent = textContent.replace(new RegExp('\\s*' + img.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'g'), ' ');
    });
    
    // Clean up extra whitespace and format text
    textContent = textContent
      .replace(/\n/g, '<br>') // Convert newlines to HTML breaks - preserve user intent
      .replace(/(https?:\/\/[^\s]+)/g, (match, url) => {
        // Use single tab for jumble.social links, new tabs for others
        const target = url.includes('jumble.social') ? 'jumble-social-tab' : '_blank';
        return `<a href="${url}" target="${target}">${url}</a>`;
      });
      
    // If text is empty or only whitespace after processing, return empty string
    if (!textContent || textContent.trim() === '') {
      textContent = '';
    }
    
    return { 
      text: textContent, 
      images,
      quotedNotes: nostrParsed.quotedNotes // Pass quoted notes to be rendered separately
    };
  }
  
  createImageGallery(images, eventId, pubkey) {
    if (images.length === 0) return '';
    
    // Check if images should be blurred based on NSFW tags and follow status
    let shouldBlur = false;
    
    // First check for NSFW/content warning tags (applies to all feeds)
    const event = Array.from(this.notes.values()).find(note => note.id === eventId);
    if (event && event.tags) {
      const nsfwKeywords = ['nsfw', 'adult', 'porn', 'sex', 'nude', 'naked', 'explicit', 'mature', '18+', 'xxx', 'erotic', 'sexual', 'graphic', 'lewd', 'nsfl', 'gore', 'violence'];
      
      const hasNSFWTag = event.tags.some(tag => {
        if (tag[0] === 't') {
          const tagValue = tag[1].toLowerCase();
          return nsfwKeywords.some(keyword => tagValue.includes(keyword));
        }
        return (tag[0] === 'content-warning') || (tag[0] === 'L' && tag[1] === 'content-warning');
      });
      
      if (hasNSFWTag) {
        shouldBlur = true;
        console.log('🔞 Blurring image due to NSFW tag');
      }
    }
    
    // If not NSFW, check feed-specific blur rules
    if (!shouldBlur) {
      if (this.currentFeed === 'trending') {
        // Don't blur images in trending feed - it's curated content
        shouldBlur = false;
      } else if (this.currentFeed === 'me') {
        // Don't blur images in Me feed - they're your own photos
        shouldBlur = false;
      } else {
        // For other feeds, blur if user is not signed in or doesn't follow the author
        const isFollowed = this.currentUser && this.userFollows.has(pubkey);
        shouldBlur = !isFollowed;
      }
    }
    
    const galleryClass = images.length === 1 ? 'single-image' : 'multi-image';
    const blurClass = shouldBlur ? 'blurred' : '';
    const maxDisplay = Math.min(images.length, 4); // Show max 4 images
    
    let galleryHTML = `<div class="image-gallery ${galleryClass} ${blurClass}" data-event-id="${eventId}" data-pubkey="${pubkey}">`;
    
    for (let i = 0; i < maxDisplay; i++) {
      const imageUrl = images[i];
      
      if (i === 3 && images.length > 4) {
        // Show "+X more" overlay on 4th image if there are more
        const remaining = images.length - 3;
        galleryHTML += `<div class="image-container more-images" data-image-url="${imageUrl}"><img src="${imageUrl}" alt="" loading="lazy"><div class="image-overlay">+${remaining} more</div></div>`;
      } else {
        galleryHTML += `<div class="image-container" data-image-url="${imageUrl}"><img src="${imageUrl}" alt="" loading="lazy"></div>`;
      }
    }
    
    galleryHTML += '</div>';
    return galleryHTML;
  }
  
  createQuotedNotes(quotedNotes) {
    console.log('📝 createQuotedNotes called with', quotedNotes?.length || 0, 'quoted notes');
    if (!quotedNotes || quotedNotes.length === 0) return '';
    
    try {
      let quotedHTML = '<div class="quoted-notes">';
      
      quotedNotes.forEach(quoted => {
        try {
        console.log('📝 Processing quoted note in createQuotedNotes:', quoted.eventId.substring(0, 16) + '...');
        console.log('🔍 Current quoted note structure will use .quoted-header, .quoted-avatar, .quoted-info');
        // Try to find the quoted event in our cache
        const quotedEvent = Array.from(this.notes.values()).find(e => e.id === quoted.eventId);
        
        if (quotedEvent && quotedEvent.kind === 1) {
        // Only display text notes (kind 1) as quoted content to prevent layout breaks
        const profile = this.profiles.get(quotedEvent.pubkey);
        const authorName = profile?.display_name || profile?.name || this.getAuthorName(quotedEvent.pubkey);
        const timeAgo = this.formatTimeAgo(quotedEvent.created_at);
        
        // Process content to extract images and format text
        const formattedContent = this.formatNoteContent(quotedEvent.content);
        const content = formattedContent.text.length > 200 ? 
          formattedContent.text.substring(0, 200) + '...' : formattedContent.text;
        const imagesHTML = formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, quotedEvent.id, quotedEvent.pubkey) : '';
        
        const avatarUrl = profile?.picture;
        const authorId = this.formatProfileIdentifier(profile?.nip05, quotedEvent.pubkey);
        
        console.log('📥 Quoted note data:', { 
          eventId: quoted.eventId.substring(0, 16) + '...',
          pubkey: quotedEvent.pubkey.substring(0, 16) + '...',
          authorName: `"${authorName}"`, 
          avatarUrl: avatarUrl ? avatarUrl.substring(0, 50) + '...' : 'NONE', 
          authorId: `"${authorId}"`, 
          hasProfile: !!profile,
          profileName: profile?.name || 'none',
          profileDisplayName: profile?.display_name || 'none',
          PROBLEM: authorName === (quotedEvent.pubkey.substring(0, 8) + '...') ? 'PUBKEY FALLBACK' : 'OK'
        });
        
        // If we don't have the profile, try to fetch it
        if (!profile) {
          console.log('🔄 No profile found for quoted note author, requesting profile for:', quotedEvent.pubkey.substring(0, 16) + '...');
          this.requestProfile(quotedEvent.pubkey);
        } else {
          console.log('✅ Profile found:', { 
            name: profile.name, 
            display_name: profile.display_name, 
            picture: profile.picture ? 'has picture' : 'no picture' 
          });
        }
        
        // Create a compact quoted note design - simplified HTML
        const avatarHTML = avatarUrl ? 
          `<img src="${avatarUrl}" alt="" class="quoted-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="avatar-placeholder" style="display: none;">${this.getAvatarPlaceholder(authorName)}</div>` :
          `<div class="avatar-placeholder">${this.getAvatarPlaceholder(authorName)}</div>`;
        
        // Create a compact quoted note design - simplified HTML
        // Ensure content is safely escaped and won't break parent HTML structure
        let safeContent;
        try {
          safeContent = content.replace(/\n/g, '<br>');
          // Check for potentially malformed HTML that could break the parent structure
          if (safeContent.includes('<') && !safeContent.match(/<\/[^>]+>/)) {
            console.warn('🚫 Quoted content contains potentially malformed HTML, re-escaping');
            safeContent = this.escapeHtml(content).replace(/\n/g, '<br>');
          }
        } catch (error) {
          console.error('❌ Error processing quoted note content:', error);
          safeContent = this.escapeHtml(content).replace(/\n/g, '<br>');
        }
        
        const generatedHTML = `<div class="quoted-note" data-event-id="${quoted.eventId}" data-pubkey="${quotedEvent.pubkey}" data-author="${quotedEvent.pubkey}"><div class="quoted-header"><div class="quoted-avatar" data-profile-link="${window.NostrTools.nip19.npubEncode(quotedEvent.pubkey)}">${avatarHTML}</div><div class="quoted-info" data-profile-link="${window.NostrTools.nip19.npubEncode(quotedEvent.pubkey)}"><span class="quoted-author">${authorName}</span><span class="quoted-npub" ${profile?.nip05 ? 'data-nip05="true"' : ''}>${authorId}</span></div><div class="quoted-time-menu"><span class="quoted-time" data-note-link="${quotedEvent.id}">${timeAgo}</span><div class="quoted-menu"><button class="menu-btn" data-event-id="${quotedEvent.id}">⋯</button><div class="menu-dropdown" data-event-id="${quotedEvent.id}"><div class="menu-item" data-action="open-note">Open Note</div><div class="menu-item" data-action="copy-note-id">Copy Note ID</div><div class="menu-item" data-action="copy-note-text">Copy Note Text</div><div class="menu-item" data-action="copy-raw-data">Copy Raw Data</div><div class="menu-item" data-action="copy-pubkey">Copy Public Key</div><div class="menu-item" data-action="view-user-profile">View User Profile</div></div></div></div></div><div class="quoted-content">${safeContent}${imagesHTML}</div></div>`;
        
        console.log('📝 Generated quoted note HTML preview:', generatedHTML.substring(0, 200) + '...');
        quotedHTML += generatedHTML;
        
        // If we requested a profile for this quoted note author, it might update later
        if (!profile) {
          console.log('📝 Quoted note rendered without profile - will update when profile loads');
        }
      } else if (quotedEvent && quotedEvent.kind !== 1) {
        // Event found but not kind 1, skip it to prevent layout breaks
        console.log(`🚫 Skipping non-text quoted note (kind ${quotedEvent.kind}):`, quoted.eventId.substring(0, 16) + '...');
      } else {
        // Event not in cache, show a compact loading state and try to fetch it
        quotedHTML += `<div class="quoted-note loading" data-event-id="${quoted.eventId}" data-bech32="${quoted.bech32}">
          <div class="quoted-loading">Loading quoted note...</div>
        </div>`;
        
        // Try to fetch the quoted event
        this.fetchQuotedEvent(quoted);
      }
      } catch (error) {
        console.error('❌ Error processing individual quoted note:', quoted.eventId, error);
        // Create error message with specific note ID for better jumble.social link
        const uniqueId = 'quoted-error-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        quotedHTML += `<div id="${uniqueId}" class="quoted-note fallback" style="cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px 12px; min-height: 60px; color: #c4b5fd; border: 1px dashed rgba(167, 139, 250, 0.3);" data-note-id="${quoted.eventId}">
          <span>View quoted note</span>
          <svg width="16" height="16" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
            <path d="M2.37397e-06 16.565V6.72967C2.37397e-06 6.02624 -0.00101785 5.4207 0.0395463 4.92407C0.0813371 4.41244 0.173631 3.9034 0.423157 3.41367H0.423119C0.795321 2.68314 1.38897 2.08947 2.11949 1.71726C2.60923 1.46772 3.11831 1.37544 3.62997 1.33365C4.12659 1.29309 4.7321 1.29411 5.43553 1.29411H7.76494C8.47966 1.29411 9.05908 1.8735 9.05909 2.58821C9.05909 3.30293 8.47967 3.88236 7.76494 3.88236H5.43553C4.68943 3.88236 4.20752 3.88333 3.84069 3.91329C3.48889 3.94203 3.35845 3.99083 3.29455 4.0234H3.29451C3.05102 4.14746 2.85335 4.34516 2.72929 4.58865V4.58869C2.69673 4.65259 2.64792 4.783 2.61919 5.1348C2.58923 5.50162 2.58822 5.98356 2.58822 6.72967V16.565C2.58822 17.3111 2.58923 17.7928 2.61919 18.1593C2.64791 18.5108 2.69664 18.641 2.72925 18.705H2.72929C2.84986 18.9417 3.03946 19.1349 3.2718 19.2591L3.29443 19.2709L3.29462 19.271C3.3583 19.3035 3.48841 19.3522 3.83948 19.3808C4.20563 19.4108 4.68659 19.4118 5.43128 19.4118H15.2746C16.0193 19.4118 16.5 19.4108 16.8658 19.3808C17.2165 19.3522 17.3464 19.3035 17.4103 19.271L17.4104 19.2709C17.6541 19.1468 17.8529 18.9479 17.9768 18.7048L17.9769 18.7046C18.0094 18.6408 18.0581 18.5109 18.0867 18.1601C18.1167 17.7942 18.1176 17.3134 18.1176 16.5687V14.2353C18.1177 13.5206 18.6971 12.9412 19.4118 12.9412C20.1265 12.9412 20.7059 13.5206 20.7059 14.2353V16.5687C20.7059 17.2707 20.7069 17.8752 20.6664 18.371C20.6246 18.882 20.5323 19.3903 20.283 19.8796C19.9107 20.6104 19.3155 21.2051 18.5853 21.5771L18.5852 21.5771C18.096 21.8264 17.5878 21.9187 17.0768 21.9605C16.581 22.001 15.9766 22 15.2746 22H5.43128C4.72927 22 4.12466 22.001 3.62864 21.9605C3.11757 21.9187 2.60888 21.8265 2.11945 21.5771V21.577C1.39959 21.2103 0.813511 20.6283 0.440748 19.9142L0.423157 19.8801C0.173666 19.3905 0.0813545 18.8817 0.0395463 18.3701C-0.001023 17.8737 2.37397e-06 17.2684 2.37397e-06 16.565ZM22 7.76471C22 8.47943 21.4206 9.05882 20.7059 9.05882C19.9912 9.05882 19.4118 8.47943 19.4118 7.76471V4.41838L12.5622 11.268C12.0568 11.7734 11.2374 11.7734 10.732 11.268C10.2266 10.7626 10.2266 9.94323 10.732 9.43784L17.5816 2.58821H14.2353C13.5206 2.58821 12.9412 2.00882 12.9412 1.29411C12.9412 0.579388 13.5206 6.56327e-06 14.2353 0H20.7059C21.4206 4.00228e-07 22 0.579384 22 1.29411V7.76471Z" fill="currentColor"/>
          </svg>
        </div>`;
        
        // Set up click handler with specific note ID
        setTimeout(() => {
          const errorElement = document.getElementById(uniqueId);
          if (errorElement) {
            errorElement.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              const noteId = errorElement.getAttribute('data-note-id');
              let jumbleUrl = 'https://jumble.social';
              
              if (noteId) {
                try {
                  // Convert hex event ID to note bech32 format for jumble.social
                  const noteBech32 = window.NostrTools.nip19.noteEncode(noteId);
                  jumbleUrl = `https://jumble.social/${noteBech32}`;
                  console.log('🔗 Converted hex ID to bech32:', noteId.substring(0, 16) + '... -> ' + noteBech32);
                } catch (error) {
                  console.error('❌ Error converting note ID to bech32:', error);
                  // Fallback to homepage if conversion fails
                }
              }
              
              console.log('🔗 Opening jumble.social URL:', jumbleUrl);
              window.open(jumbleUrl, '_blank');
            });
          }
        }, 10);
      }
    });
    
    quotedHTML += '</div>';
    
    // Set up interactions after the HTML is inserted into the DOM
    setTimeout(() => {
      console.log('🔧 Setting up interactions for', quotedNotes.length, 'quoted notes');
      quotedNotes.forEach(quoted => {
        console.log('🔧 Processing quoted note:', quoted.eventId.substring(0, 16) + '...');
        const quotedEvent = Array.from(this.notes.values()).find(e => e.id === quoted.eventId);
        if (quotedEvent) {
          console.log('✅ Found event in cache for:', quoted.eventId.substring(0, 16) + '...');
          const quotedElements = document.querySelectorAll(`.quoted-note[data-event-id="${quoted.eventId}"]`);
          console.log('🔧 Found', quotedElements.length, 'DOM elements for this event ID');
          
          quotedElements.forEach((quotedElement, index) => {
            console.log('🔧 Processing element', index, 'loading:', quotedElement?.classList.contains('loading'));
            if (quotedElement && !quotedElement.classList.contains('loading')) {
              this.setupQuotedNoteInteractions(quotedElement, quotedEvent);
            }
          });
        } else {
          console.log('❌ No event found in cache for:', quoted.eventId.substring(0, 16) + '...');
        }
      });
    }, 100);
    
      return quotedHTML;
    } catch (error) {
      console.error('❌ Error creating quoted notes:', error);
      // Return a safe fallback that won't break the parent note layout
      const uniqueId = 'quoted-error-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      
      // Set up click handler after DOM insertion
      setTimeout(() => {
        const errorElement = document.getElementById(uniqueId);
        if (errorElement) {
          errorElement.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open('https://jumble.social', '_blank');
          });
        }
      }, 10);
      
      return `<div class="quoted-notes">
        <div id="${uniqueId}" class="quoted-note fallback" style="cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px 12px; min-height: 60px; color: #c4b5fd; border: 1px dashed rgba(167, 139, 250, 0.3);">
          <span>View quoted note</span>
          <svg width="16" height="16" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
            <path d="M2.37397e-06 16.565V6.72967C2.37397e-06 6.02624 -0.00101785 5.4207 0.0395463 4.92407C0.0813371 4.41244 0.173631 3.9034 0.423157 3.41367H0.423119C0.795321 2.68314 1.38897 2.08947 2.11949 1.71726C2.60923 1.46772 3.11831 1.37544 3.62997 1.33365C4.12659 1.29309 4.7321 1.29411 5.43553 1.29411H7.76494C8.47966 1.29411 9.05908 1.8735 9.05909 2.58821C9.05909 3.30293 8.47967 3.88236 7.76494 3.88236H5.43553C4.68943 3.88236 4.20752 3.88333 3.84069 3.91329C3.48889 3.94203 3.35845 3.99083 3.29455 4.0234H3.29451C3.05102 4.14746 2.85335 4.34516 2.72929 4.58865V4.58869C2.69673 4.65259 2.64792 4.783 2.61919 5.1348C2.58923 5.50162 2.58822 5.98356 2.58822 6.72967V16.565C2.58822 17.3111 2.58923 17.7928 2.61919 18.1593C2.64791 18.5108 2.69664 18.641 2.72925 18.705H2.72929C2.84986 18.9417 3.03946 19.1349 3.2718 19.2591L3.29443 19.2709L3.29462 19.271C3.3583 19.3035 3.48841 19.3522 3.83948 19.3808C4.20563 19.4108 4.68659 19.4118 5.43128 19.4118H15.2746C16.0193 19.4118 16.5 19.4108 16.8658 19.3808C17.2165 19.3522 17.3464 19.3035 17.4103 19.271L17.4104 19.2709C17.6541 19.1468 17.8529 18.9479 17.9768 18.7048L17.9769 18.7046C18.0094 18.6408 18.0581 18.5109 18.0867 18.1601C18.1167 17.7942 18.1176 17.3134 18.1176 16.5687V14.2353C18.1177 13.5206 18.6971 12.9412 19.4118 12.9412C20.1265 12.9412 20.7059 13.5206 20.7059 14.2353V16.5687C20.7059 17.2707 20.7069 17.8752 20.6664 18.371C20.6246 18.882 20.5323 19.3903 20.283 19.8796C19.9107 20.6104 19.3155 21.2051 18.5853 21.5771L18.5852 21.5771C18.096 21.8264 17.5878 21.9187 17.0768 21.9605C16.581 22.001 15.9766 22 15.2746 22H5.43128C4.72927 22 4.12466 22.001 3.62864 21.9605C3.11757 21.9187 2.60888 21.8265 2.11945 21.5771V21.577C1.39959 21.2103 0.813511 20.6283 0.440748 19.9142L0.423157 19.8801C0.173666 19.3905 0.0813545 18.8817 0.0395463 18.3701C-0.001023 17.8737 2.37397e-06 17.2684 2.37397e-06 16.565ZM22 7.76471C22 8.47943 21.4206 9.05882 20.7059 9.05882C19.9912 9.05882 19.4118 8.47943 19.4118 7.76471V4.41838L12.5622 11.268C12.0568 11.7734 11.2374 11.7734 10.732 11.268C10.2266 10.7626 10.2266 9.94323 10.732 9.43784L17.5816 2.58821H14.2353C13.5206 2.58821 12.9412 2.00882 12.9412 1.29411C12.9412 0.579388 13.5206 6.56327e-06 14.2353 0H20.7059C21.4206 4.00228e-07 22 0.579384 22 1.29411V7.76471Z" fill="currentColor"/>
          </svg>
        </div>
      </div>`;
    }
  }
  
  fetchQuotedEvent(quotedNote) {
    console.log('📥 Fetching quoted event:', quotedNote);
    // Create subscription to fetch the quoted event
    const subId = `quoted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let filter;
    
    if (quotedNote.type === 'note') {
      filter = { ids: [quotedNote.eventId], kinds: [1] };
    } else if (quotedNote.type === 'nevent') {
      filter = { ids: [quotedNote.eventId], kinds: [1] };
    } else if (quotedNote.type === 'naddr') {
      // For naddr (parameterized replaceable events)
      filter = {
        kinds: [quotedNote.data.kind || 30023], // Default to long-form content
        authors: [quotedNote.data.pubkey],
        '#d': [quotedNote.data.identifier]
      };
    }
    
    if (filter) {
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      
      this.relayConnections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(subscription));
        }
      });
      
      // Auto-close subscription after 5 seconds
      setTimeout(() => {
        this.relayConnections.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(['CLOSE', subId]));
          }
        });
        this.subscriptions.delete(subId);
        
        // Replace any remaining loading placeholders with fallback links
        const stillLoadingPlaceholders = document.querySelectorAll(`.quoted-note.loading[data-event-id="${quotedNote.eventId}"]`);
        console.log(`🔗 Converting ${stillLoadingPlaceholders.length} unfound quoted note placeholders to fallback links for:`, quotedNote.eventId.substring(0, 16) + '...');
        stillLoadingPlaceholders.forEach(placeholder => {
          // Create fallback link instead of removing
          const bech32 = placeholder.dataset.bech32 || quotedNote.bech32;
          const uniqueId = 'quoted-fallback-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const fallbackHTML = `<div id="${uniqueId}" class="quoted-note fallback" style="cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px 12px; min-height: 60px; color: #c4b5fd; border: 1px dashed rgba(167, 139, 250, 0.3);" data-note-id="${quotedNote.eventId}" data-bech32="${bech32}">
            <span>View quoted note</span>
            <svg width="16" height="16" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
              <path d="M2.37397e-06 16.565V6.72967C2.37397e-06 6.02624 -0.00101785 5.4207 0.0395463 4.92407C0.0813371 4.41244 0.173631 3.9034 0.423157 3.41367H0.423119C0.795321 2.68314 1.38897 2.08947 2.11949 1.71726C2.60923 1.46772 3.11831 1.37544 3.62997 1.33365C4.12659 1.29309 4.7321 1.29411 5.43553 1.29411H7.76494C8.47966 1.29411 9.05908 1.8735 9.05909 2.58821C9.05909 3.30293 8.47967 3.88236 7.76494 3.88236H5.43553C4.68943 3.88236 4.20752 3.88333 3.84069 3.91329C3.48889 3.94203 3.35845 3.99083 3.29455 4.0234H3.29451C3.05102 4.14746 2.85335 4.34516 2.72929 4.58865V4.58869C2.69673 4.65259 2.64792 4.783 2.61919 5.1348C2.58923 5.50162 2.58822 5.98356 2.58822 6.72967V16.565C2.58822 17.3111 2.58923 17.7928 2.61919 18.1593C2.64791 18.5108 2.69664 18.641 2.72925 18.705H2.72929C2.84986 18.9417 3.03946 19.1349 3.2718 19.2591L3.29443 19.2709L3.29462 19.271C3.3583 19.3035 3.48841 19.3522 3.83948 19.3808C4.20563 19.4108 4.68659 19.4118 5.43128 19.4118H15.2746C16.0193 19.4118 16.5 19.4108 16.8658 19.3808C17.2165 19.3522 17.3464 19.3035 17.4103 19.271L17.4104 19.2709C17.6541 19.1468 17.8529 18.9479 17.9768 18.7048L17.9769 18.7046C18.0094 18.6408 18.0581 18.5109 18.0867 18.1601C18.1167 17.7942 18.1176 17.3134 18.1176 16.5687V14.2353C18.1177 13.5206 18.6971 12.9412 19.4118 12.9412C20.1265 12.9412 20.7059 13.5206 20.7059 14.2353V16.5687C20.7059 17.2707 20.7069 17.8752 20.6664 18.371C20.6246 18.882 20.5323 19.3903 20.283 19.8796C19.9107 20.6104 19.3155 21.2051 18.5853 21.5771L18.5852 21.5771C18.096 21.8264 17.5878 21.9187 17.0768 21.9605C16.581 22.001 15.9766 22 15.2746 22H5.43128C4.72927 22 4.12466 22.001 3.62864 21.9605C3.11757 21.9187 2.60888 21.8265 2.11945 21.5771V21.577C1.39959 21.2103 0.813511 20.6283 0.440748 19.9142L0.423157 19.8801C0.173666 19.3905 0.0813545 18.8817 0.0395463 18.3701C-0.001023 17.8737 2.37397e-06 17.2684 2.37397e-06 16.565ZM22 7.76471C22 8.47943 21.4206 9.05882 20.7059 9.05882C19.9912 9.05882 19.4118 8.47943 19.4118 7.76471V4.41838L12.5622 11.268C12.0568 11.7734 11.2374 11.7734 10.732 11.268C10.2266 10.7626 10.2266 9.94323 10.732 9.43784L17.5816 2.58821H14.2353C13.5206 2.58821 12.9412 2.00882 12.9412 1.29411C12.9412 0.579388 13.5206 6.56327e-06 14.2353 0H20.7059C21.4206 4.00228e-07 22 0.579384 22 1.29411V7.76471Z" fill="currentColor"/>
            </svg>
          </div>`;
          
          placeholder.outerHTML = fallbackHTML;
          
          // Set up click handler for fallback link
          setTimeout(() => {
            const fallbackElement = document.getElementById(uniqueId);
            if (fallbackElement) {
              fallbackElement.addEventListener('click', () => {
                const noteId = fallbackElement.dataset.noteId;
                const bech32Id = fallbackElement.dataset.bech32;
                if (bech32Id) {
                  // Open with bech32 ID (more precise)
                  window.open(`https://jumble.social/${bech32Id}`, '_blank');
                } else if (noteId) {
                  // Fallback to hex ID
                  window.open(`https://jumble.social/note${window.NostrTools.nip19.noteEncode(noteId)}`, '_blank');
                }
              });
            }
          }, 100);
        });
      }, 5000);
    }
  }
  
  updateQuotedNotePlaceholders(event) {
    // Only process text notes (kind 1) as quoted content
    if (event.kind !== 1) {
      console.log(`⏭️ Ignoring non-text note (kind ${event.kind}) for quoted display:`, event.id.substring(0, 16) + '...');
      return;
    }
    
    // Find all loading quoted note placeholders that match this event ID
    const placeholders = document.querySelectorAll(`.quoted-note.loading[data-event-id="${event.id}"]`);
    
    console.log(`🔄 Updating quoted note placeholders for ${event.id.substring(0, 16)}... - found ${placeholders.length} placeholders`);
    
    placeholders.forEach(placeholder => {
      // Get the author profile
      let authorName = this.getAuthorName(event.pubkey);
      const profile = this.profiles.get(event.pubkey);
      if (profile) {
        authorName = profile.display_name || profile.name || authorName;
      }
      
      // Create the updated quoted note HTML
      const formattedContent = this.formatNoteContent(event.content);
      const content = formattedContent.text;
      const imagesHTML = formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, event.id, event.pubkey) : '';
      const avatarUrl = profile?.picture;
      const authorId = this.formatProfileIdentifier(profile?.nip05, event.pubkey);
      const timeAgo = this.formatTimeAgo(event.created_at);
      
      const avatarHTML = avatarUrl ? 
        `<img src="${avatarUrl}" alt="" class="quoted-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="avatar-placeholder" style="display: none;">${this.getAvatarPlaceholder(authorName)}</div>` :
        `<div class="avatar-placeholder">${this.getAvatarPlaceholder(authorName)}</div>`;
      
      const updatedHTML = `<div class="quoted-header"><div class="quoted-avatar" data-profile-link="${window.NostrTools.nip19.npubEncode(event.pubkey)}">${avatarHTML}</div><div class="quoted-info" data-profile-link="${window.NostrTools.nip19.npubEncode(event.pubkey)}"><span class="quoted-author">${authorName}</span><span class="quoted-npub" ${profile?.nip05 ? 'data-nip05="true"' : ''}>${authorId}</span></div><div class="quoted-time-menu"><span class="quoted-time" data-note-link="${event.id}">${timeAgo}</span><div class="quoted-menu"><button class="menu-btn" data-event-id="${event.id}">⋯</button><div class="menu-dropdown" data-event-id="${event.id}"><div class="menu-item" data-action="open-note">Open Note</div><div class="menu-item" data-action="copy-note-id">Copy Note ID</div><div class="menu-item" data-action="copy-note-text">Copy Note Text</div><div class="menu-item" data-action="copy-raw-data">Copy Raw Data</div><div class="menu-item" data-action="copy-pubkey">Copy Public Key</div><div class="menu-item" data-action="view-user-profile">View User Profile</div></div></div></div></div><div class="quoted-content">${content.replace(/\n/g, '<br>')}${imagesHTML}</div>`;
      
      // Replace the placeholder content and remove loading class
      console.log('🔄 Replacing placeholder innerHTML...');
      console.log('🔄 Old innerHTML:', placeholder.innerHTML.substring(0, 100) + '...');
      placeholder.innerHTML = updatedHTML;
      placeholder.classList.remove('loading');
      console.log('🔄 New innerHTML:', placeholder.innerHTML.substring(0, 100) + '...');
      placeholder.dataset.pubkey = event.pubkey; // Add pubkey for profile interactions
      placeholder.dataset.author = event.pubkey; // Add author for profile updates
      
      // Set up event handlers for the updated quoted note
      console.log('🔧 Setting up interactions for updated placeholder:', event.id.substring(0, 16) + '...');
      this.setupQuotedNoteInteractions(placeholder, event);
      
      console.log('✅ Updated quoted note placeholder for:', event.id.substring(0, 16) + '...');
      console.log('📊 Placeholder update data:', {
        authorName,
        hasProfile: !!profile,
        avatarUrl: avatarUrl ? 'HAS_AVATAR' : 'NO_AVATAR',
        authorId,
        profileName: profile?.name || 'none',
        profileDisplayName: profile?.display_name || 'none'
      });
    });
  }
  
  setupNoteContentClick(noteElement, event) {
    const noteContent = noteElement.querySelector('.note-content');
    if (!noteContent) return;
    
    // Always apply truncation since we no longer have single note views
    const isTimelineView = true;
    const contentText = event.content || '';
    
    // Count only readable text, excluding nostr: tags for truncation decision
    const textWithoutNostrTags = contentText.replace(/nostr:[a-z0-9]+1[a-z0-9]+/gi, '');
    const isLongContent = textWithoutNostrTags.length > 1200; // Check readable content length
    
    if (isLongContent && isTimelineView) {
      // Create truncated version with "Read more..." link, avoiding breaking user mentions
      const originalHTML = noteContent.innerHTML;
      
      // Calculate truncation point based on readable text, accounting for nostr tags
      const readableLength = textWithoutNostrTags.length;
      const targetReadableLength = 900; // Target readable characters to show
      
      // Find the position in the full text that corresponds to our target readable length
      let readableCount = 0;
      let truncateAt = 0;
      
      for (let i = 0; i < contentText.length; i++) {
        // Skip over nostr: tags when counting readable characters
        if (contentText.substring(i).match(/^nostr:[a-z0-9]+1[a-z0-9]+/i)) {
          // Find the end of this nostr tag
          const tagMatch = contentText.substring(i).match(/^nostr:[a-z0-9]+1[a-z0-9]+/i);
          if (tagMatch) {
            i += tagMatch[0].length - 1; // Skip the tag (-1 because loop will increment)
            continue;
          }
        }
        
        readableCount++;
        if (readableCount >= targetReadableLength) {
          truncateAt = i + 1;
          break;
        }
      }
      
      // If we didn't find enough readable content, use the full length
      if (truncateAt === 0) truncateAt = contentText.length;
      
      // Look for a good place to truncate that doesn't break user mentions or nostr links
      let safeEnd = truncateAt;
      const textToCheck = contentText.substring(0, Math.min(contentText.length, truncateAt + 100));
      
      // Find last complete word that doesn't break @mentions or nostr: links
      for (let i = truncateAt; i < Math.min(textToCheck.length, truncateAt + 50); i++) {
        const char = contentText[i];
        const prev = contentText[i - 1];
        
        // If we hit a space after non-mention content, this is a safe place to cut
        if (char === ' ' && prev !== '@' && !contentText.substring(Math.max(0, i - 20), i).includes('nostr:')) {
          safeEnd = i;
          break;
        }
      }
      
      // Fallback: if no good break point found, find last space before truncateAt
      if (safeEnd === truncateAt) {
        const lastSpace = contentText.lastIndexOf(' ', truncateAt);
        if (lastSpace > truncateAt - 100) { // Don't go too far back
          safeEnd = lastSpace;
        }
      }
      
      const truncatedText = contentText.substring(0, safeEnd).trim() + '...';
      const formattedContent = this.formatNoteContent(truncatedText);
      
      noteContent.innerHTML = `<span class="truncated-text">${formattedContent.text}<span class="read-more"> Read more...</span></span><span class="full-text">${originalHTML}</span>`;
      
      noteContent.classList.add('truncated');
      
      // Add click handler for "Read more" link
      const readMoreLink = noteContent.querySelector('.read-more');
      if (readMoreLink) {
        readMoreLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('📄 Expanding note content:', event.id.substring(0, 16) + '...');
          noteContent.classList.remove('truncated');
          noteContent.classList.add('expanded');
        });
      }
    }
    
    noteContent.addEventListener('click', (e) => {
      // Don't trigger if clicking on links, images, or other interactive elements
      if (e.target.tagName === 'A' || e.target.tagName === 'IMG' || e.target.closest('.image-gallery') || e.target.closest('.quoted-note') || e.target.classList.contains('read-more')) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      // Click anywhere else: open on jumble.social
      console.log('🔗 Opening note on jumble.social:', event.id.substring(0, 16) + '...');
      const noteId = window.NostrTools.nip19.noteEncode(event.id);
      const noteUrl = `https://jumble.social/notes/${noteId}`;
      window.open(noteUrl, 'jumble-social-tab');
    });
  }

  setupQuotedNoteInteractions(quotedElement, event) {
    console.log('🔧 Setting up quoted note interactions for:', event.id.substring(0, 16) + '...');
    
    // Set up menu functionality using quoted note structure
    const menuContainer = quotedElement.querySelector('.quoted-menu');
    if (menuContainer) {
      this.setupNoteMenu(menuContainer, event);
    }
    
    // Set up click to open note - use capture phase to run before profile links
    quotedElement.addEventListener('click', (e) => {
      console.log('🖱️ Quoted note clicked!', event.id.substring(0, 16) + '...');
      
      // Don't trigger if clicking on menu buttons 
      if (e.target.closest('.quoted-menu')) {
        console.log('🚫 Click on menu, ignoring');
        return;
      }
      
      // Stop the event from bubbling to profile links
      e.stopPropagation();
      e.preventDefault();
      console.log('🔗 Opening quoted note on jumble.social:', event.id.substring(0, 16) + '...');
      const noteId = window.NostrTools.nip19.noteEncode(event.id);
      const noteUrl = `https://jumble.social/notes/${noteId}`;
      window.open(noteUrl, 'jumble-social-tab');
    }, true); // Use capture phase
    
    // Set up clickable links for profile using quoted note structure  
    this.setupClickableLinks(quotedElement, event);
    console.log('✅ Quoted note interactions setup complete');
  }
  
  // Force refresh the page to reload all content with new quoted note structure
  forceRefreshFeed() {
    console.log('🔄 Force refreshing feed to apply quoted note changes...');
    location.reload();
  }

  // Make refresh available globally for console debugging
  setupGlobalRefresh() {
    window.refreshQuotedNotes = () => this.forceRefreshFeed();
    window.inspectQuotedNotes = () => this.inspectQuotedNotesDOM();
    console.log('🔧 Available: window.refreshQuotedNotes() to force reload');
    console.log('🔧 Available: window.inspectQuotedNotes() to inspect DOM structure');
  }

  inspectQuotedNotesDOM() {
    const quotedNotes = document.querySelectorAll('.quoted-note');
    console.log('🔍 Found', quotedNotes.length, 'quoted notes in DOM');
    quotedNotes.forEach((note, index) => {
      console.log(`📋 Quoted note ${index}:`, {
        classes: Array.from(note.classList),
        innerHTML: note.innerHTML.substring(0, 200) + '...',
        hasQuotedHeader: !!note.querySelector('.quoted-header'),
        hasQuotedAvatar: !!note.querySelector('.quoted-avatar'),
        hasQuotedInfo: !!note.querySelector('.quoted-info'),
        hasReplyHeader: !!note.querySelector('.reply-header'),
        text: note.textContent.substring(0, 100) + '...'
      });
    });
  }

  loadNoteReplies(noteId) {
    console.log('📄 Loading replies for note:', noteId.substring(0, 16) + '...');
    
    // Subscribe to get replies to this note
    const subId = `note-replies-${Date.now()}`;
    const subscription = ['REQ', subId, 
      { '#e': [noteId], kinds: [1] } // Get replies to this note
    ];
    
    this.subscriptions.set(subId, subscription);
    this.relayConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscription));
      }
    });
  }
  
  loadSingleNote(noteId, pubkey) {
    console.log('📄 Loading single note:', noteId.substring(0, 16) + '...');
    
    // Clear current feed
    document.getElementById('feed').innerHTML = '';
    this.showLoading();
    
    // Check if we already have the note
    const existingNote = this.notes.get(noteId);
    if (existingNote) {
      // Display the note immediately
      this.displaySingleNote(existingNote);
    }
    
    // Subscribe to get the note and its replies
    const subId = `single-note-${Date.now()}`;
    const subscription = ['REQ', subId, 
      { ids: [noteId] }, // Get the specific note
      { '#e': [noteId], kinds: [1] } // Get replies to this note
    ];
    
    this.subscriptions.set(subId, subscription);
    this.relayConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscription));
      }
    });
    
    // Set timeout to hide loading
    setTimeout(() => {
      this.hideLoading();
    }, 3000);
  }
  
  displaySingleNote(note) {
    console.log('📄 Displaying single note:', note.id.substring(0, 16) + '...');
    
    const feed = document.getElementById('feed');
    
    // Create and display the main note
    const noteElement = this.createNoteElement(note);
    feed.appendChild(noteElement);
    
    // Replies removed - no longer supported
  }

  
  
  updateFeedToggle() {
    // Simple feed toggle behavior - ensure correct button is active
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
    const activeFeedBtn = document.getElementById(`${this.currentFeed}-feed-btn`);
    if (activeFeedBtn) {
      activeFeedBtn.classList.add('active');
    }
  }
  
  
  
  
  
  setupInfiniteScroll() {
    // Remove existing scroll listener
    if (this.scrollListener) {
      document.removeEventListener('scroll', this.scrollListener);
    }
    
    // Create new scroll listener
    this.scrollListener = () => {
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
      const clientHeight = document.documentElement.clientHeight || window.innerHeight;
      
      // Load more when user scrolls to bottom 200px
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        this.loadMoreNotes();
      }
    };
    
    // Add scroll listener
    document.addEventListener('scroll', this.scrollListener);
  }
  
  showLoading() {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('error').classList.add('hidden');
    this.hideAutoLoader();
  }
  
  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
    this.showAutoLoader();
  }
  
  showAutoLoader() {
    // Show appropriate auto-loader state based on feed status
    console.log('🔄 Show auto-loader - feedHasMore:', this.feedHasMore, 'definitelyNoMoreNotes:', this.definitelyNoMoreNotes, 'notes count:', this.notes.size);
    
    const autoLoading = document.getElementById('auto-loading');
    const endOfFeed = document.getElementById('end-of-feed');
    
    // Don't show auto-loader if we definitely know there are no more notes
    if (this.definitelyNoMoreNotes || !this.feedHasMore) {
      console.log('📄 Showing end-of-feed state (definitelyNoMoreNotes or !feedHasMore)');
      autoLoading.classList.add('hidden');
      endOfFeed.classList.remove('hidden');
    } else if (this.feedHasMore && this.notes.size > 0) {
      console.log('📄 Showing auto-loading state');
      autoLoading.classList.remove('hidden');
      endOfFeed.classList.add('hidden');
    } else if (this.notes.size > 0) {
      console.log('📄 Showing end-of-feed state');
      autoLoading.classList.add('hidden');
      endOfFeed.classList.remove('hidden');
    } else {
      // Hide both if no notes
      autoLoading.classList.add('hidden');
      endOfFeed.classList.add('hidden');
    }
  }
  
  hideAutoLoader() {
    // Hide all auto-loader states
    document.getElementById('auto-loading').classList.add('hidden');
    document.getElementById('end-of-feed').classList.add('hidden');
  }
  
  showError() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error').classList.remove('hidden');
    this.hideAutoLoader();
  }
  
  updateCharCount() {
    const textarea = document.getElementById('compose-text');
    const counter = document.getElementById('char-count');
    const postBtn = document.getElementById('post-btn');
    
    const remaining = 2100 - textarea.value.length;
    const hasText = textarea.value.trim().length > 0;
    
    // Always show character count when there's text
    if (hasText) {
      counter.textContent = remaining;
      counter.style.display = 'inline';
      
      counter.className = 'char-count';
      if (remaining < 100) counter.classList.add('warning');
      if (remaining < 0) counter.classList.add('error');
    } else {
      counter.style.display = 'none';
    }
    
    // Enable/disable Post button only
    postBtn.disabled = remaining < 0 || !hasText;
  }
  
  updateReplyCharCount() {
    const replyText = document.getElementById('reply-text');
    const charCount = document.getElementById('reply-char-count');
    const sendBtn = document.getElementById('send-reply-btn');
    
    const remaining = 2100 - replyText.value.length;
    const hasText = replyText.value.trim().length > 0;
    
    // Always show character count when there's text
    if (hasText) {
      charCount.textContent = remaining;
      charCount.style.display = 'inline';
      
      charCount.className = 'char-count';
      if (remaining < 100) charCount.classList.add('warning');
      if (remaining < 0) charCount.classList.add('error');
    } else {
      charCount.style.display = 'none';
    }
    
    // Enable/disable Reply button only
    sendBtn.disabled = remaining < 0 || !hasText;
  }
  
  async publishNote() {
    if (!this.currentUser) {
      alert('Please sign in to post');
      return;
    }
    
    const content = document.getElementById('compose-text').value.trim();
    if (!content) return;

    // Check if this is a quote post
    if (this.isQuoting && this.repostingEvent) {
      // Handle as quote post
      this.publishQuotePost(content);
    } else {
      // Handle as regular post
      this.showPublishingCountdown(content);
    }
  }

  async publishQuotePost(userContent) {
    // Create quote post with the original note ID at the end
    const noteId = window.NostrTools.nip19.noteEncode(this.repostingEvent.id);
    const content = `${userContent}\n\nnostr:${noteId}`;

    // Show publishing state with countdown
    this.showPublishingCountdown(content);
  }

  async showPublishingCountdown(content) {
    const postBtn = document.getElementById('post-btn');
    const cancelBtn = document.getElementById('cancel-compose-btn');
    const composeText = document.getElementById('compose-text');
    
    // Set publishing state flag
    this.isPublishingCountdown = true;
    
    // Disable text editing during countdown
    composeText.disabled = true;
    
    // Store original button states
    const originalPostText = postBtn.textContent;
    const originalPostDisabled = postBtn.disabled;
    
    // Change cancel button to "Undo"
    cancelBtn.textContent = 'Undo';
    postBtn.disabled = true;
    
    let countdown = 5;
    let countdownInterval;
    
    // Store the countdown interval so we can cancel it
    this.currentCountdownInterval = countdownInterval;
    
    // Start countdown
    const updateCountdown = () => {
      postBtn.textContent = `Publishing in ${countdown}...`;
      countdown--;
      
      if (countdown < 0) {
        clearInterval(countdownInterval);
        this.actuallyPublishNote(content, originalPostText, originalPostDisabled);
      }
    };
    
    updateCountdown(); // Show initial countdown
    countdownInterval = setInterval(updateCountdown, 1000);
    this.currentCountdownInterval = countdownInterval;
  }

  handleCancelClick() {
    if (this.isPublishingCountdown) {
      // This is the "Undo" action during countdown
      this.cancelPublishing();
    } else {
      // This is the regular "Cancel" action - clear and close
      this.hideComposeSection();
    }
  }

  cancelPublishing() {
    const postBtn = document.getElementById('post-btn');
    const cancelBtn = document.getElementById('cancel-compose-btn');
    const composeText = document.getElementById('compose-text');
    
    // Clear countdown interval
    if (this.currentCountdownInterval) {
      clearInterval(this.currentCountdownInterval);
      this.currentCountdownInterval = null;
    }
    
    // Clear publishing state
    this.isPublishingCountdown = false;
    
    // Restore button states
    postBtn.textContent = 'Post';
    postBtn.disabled = composeText.value.trim().length === 0;
    cancelBtn.textContent = 'Cancel';
    
    // Re-enable text editing - compose window stays open
    composeText.disabled = false;
    composeText.focus();
    
    console.log('📝 Post undone - compose window stays open for editing');
  }

  hideComposeSectionPreservingContent() {
    const composeSection = document.getElementById('compose-section');
    const floatingBtn = document.getElementById('floating-compose-btn');
    
    // Hide the compose section but don't clear the text
    composeSection.classList.add('hidden');
    if (this.currentUser) {
      floatingBtn.classList.remove('hidden');
    }
    
    console.log('📝 Compose section hidden - content preserved');
  }

  handleReplyCancelClick() {
    if (this.isPublishingCountdown) {
      // This is the "Undo" action during countdown
      this.cancelReplyPublishing();
    } else {
      // This is the regular "Cancel" action - close modal
      this.hideModal('reply-modal');
    }
  }

  cancelReplyPublishing() {
    const sendBtn = document.getElementById('send-reply-btn');
    const cancelBtn = document.getElementById('cancel-reply-btn');
    const replyText = document.getElementById('reply-text');
    
    // Clear countdown interval
    if (this.currentCountdownInterval) {
      clearInterval(this.currentCountdownInterval);
      this.currentCountdownInterval = null;
    }
    
    // Reset publishing state
    this.isPublishingCountdown = false;
    
    // Restore button text
    sendBtn.textContent = 'Reply';
    sendBtn.disabled = replyText.value.trim().length === 0;
    cancelBtn.textContent = 'Cancel';
    
    // Re-enable text editing
    replyText.disabled = false;
    replyText.focus();
    
    console.log('💬 Reply undone - modal stays open for editing');
  }

  handleQuoteCancelClick() {
    if (this.isPublishingCountdown) {
      // This is the "Undo" action during countdown
      this.cancelQuotePublishing();
    } else {
      // This is the regular "Cancel" action - hide quote compose
      this.hideQuoteCompose();
    }
  }

  cancelQuotePublishing() {
    const sendBtn = document.getElementById('send-quote-btn');
    const cancelBtn = document.getElementById('cancel-quote-btn');
    const quoteText = document.getElementById('quote-text');
    
    // Clear countdown interval
    if (this.currentCountdownInterval) {
      clearInterval(this.currentCountdownInterval);
      this.currentCountdownInterval = null;
    }
    
    // Reset publishing state
    this.isPublishingCountdown = false;
    
    // Restore button text
    sendBtn.textContent = 'Post Quote';
    sendBtn.disabled = quoteText.value.trim().length === 0;
    cancelBtn.textContent = 'Cancel';
    
    // Re-enable text editing
    quoteText.disabled = false;
    quoteText.focus();
    
    console.log('🔁 Quote post undone - compose stays open for editing');
  }

  showNotePostedNotification() {
    const notification = document.getElementById('note-posted-notification');
    
    // Show the notification
    notification.classList.remove('hidden');
    notification.classList.add('show');
    
    // Hide it after 3 seconds
    setTimeout(() => {
      notification.classList.remove('show');
      
      // Wait for fade out animation before hiding completely
      setTimeout(() => {
        notification.classList.add('hidden');
      }, 300); // Match the CSS transition duration
    }, 3000);
  }

  async actuallyPublishNote(content, originalPostText, originalPostDisabled) {
    const postBtn = document.getElementById('post-btn');
    const cancelBtn = document.getElementById('cancel-compose-btn');
    const composeText = document.getElementById('compose-text');
    
    // Clear publishing state
    this.isPublishingCountdown = false;
    this.currentCountdownInterval = null;
    
    try {
      const event = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['client', 'sidecar', 'https://github.com/dmnyc/sidecar', 'wss://relay.damus.io']
        ],
        content: content,
        pubkey: this.currentUser.publicKey
      };
      
      const signedEvent = await this.signEvent(event);
      await this.publishEvent(signedEvent);
      
      // Clear compose area
      composeText.value = '';
      this.updateCharCount();
      
      // Add to feed
      this.handleNote(signedEvent);
      
      // Hide compose section after posting
      this.hideComposeSection();
      
      // Show "Note posted" notification
      this.showNotePostedNotification();
      
      console.log('📝 Post published successfully');
    } catch (error) {
      console.error('Publish error:', error);
      alert('Failed to publish note');
      
      // Restore UI state on error
      postBtn.textContent = originalPostText;
      postBtn.disabled = originalPostDisabled;
      cancelBtn.textContent = 'Cancel';
      composeText.disabled = false;
      composeText.focus();
      
      // Restore original cancel handler  
      cancelBtn.removeEventListener('click', this.cancelPublishing);
      cancelBtn.addEventListener('click', () => this.hideComposeSectionPreservingContent());
    }
  }
  
  showComposeSection() {
    const composeSection = document.getElementById('compose-section');
    const floatingBtn = document.getElementById('floating-compose-btn');
    const composeText = document.getElementById('compose-text');
    const postBtn = document.getElementById('post-btn');
    const cancelBtn = document.getElementById('cancel-compose-btn');
    const charCount = document.getElementById('char-count');
    
    composeSection.classList.remove('hidden');
    floatingBtn.classList.add('hidden');
    
    // Reset state
    composeText.disabled = false;
    postBtn.textContent = 'Post';
    cancelBtn.textContent = 'Cancel';
    charCount.style.display = 'none';
    
    // Reset countdown state
    if (this.currentCountdownInterval) {
      clearInterval(this.currentCountdownInterval);
      this.currentCountdownInterval = null;
    }
    this.isPublishingCountdown = false;
    
    // Focus on textarea
    setTimeout(() => {
      composeText.focus();
    }, 100);
  }
  
  hideComposeSection() {
    const composeSection = document.getElementById('compose-section');
    const floatingBtn = document.getElementById('floating-compose-btn');
    
    composeSection.classList.add('hidden');
    if (this.currentUser) {
      floatingBtn.classList.remove('hidden');
    }
    
    // Clear compose text - only used after successful posting
    document.getElementById('compose-text').value = '';
    this.updateCharCount();
    
    // Remove quote preview if present
    this.removeQuotePreview();
  }
  
  async loadUserProfile() {
    if (!this.currentUser) return;
    
    // Immediately set basic info from public key
    const userNameElement = document.getElementById('user-name');
    const userNpubElement = document.getElementById('user-npub');
    const userAvatarElement = document.getElementById('user-avatar');
    
    if (userNameElement) {
      // Set npub immediately
      const npub = window.NostrTools.nip19.npubEncode(this.currentUser.publicKey);
      userNpubElement.textContent = npub.slice(0, 16) + '...';
      
      // Set placeholder name
      userNameElement.textContent = 'Loading...';
      
      // Set placeholder avatar
      const placeholder = userAvatarElement.querySelector('.avatar-placeholder');
      if (placeholder) {
        placeholder.textContent = npub.slice(4, 6).toUpperCase();
      }
    }
  }
  
  closeSubscription(subId) {
    if (this.subscriptions.has(subId)) {
      console.log('🔒 Closing subscription:', subId);
      this.relayConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['CLOSE', subId]));
        }
      });
      this.subscriptions.delete(subId);
    }
  }
  
  fetchContactList() {
    if (!this.currentUser) {
      console.log('❌ Cannot fetch contact list: no current user');
      return;
    }
    
    console.log('📋 === SETTING UP CONTACT LIST SUBSCRIPTION ===');
    console.log('User pubkey:', this.currentUser.publicKey);
    console.log('Relay connections available:', this.relayConnections.size);
    
    // Close existing contact list subscription if it exists
    const existingSubId = Array.from(this.subscriptions.keys()).find(id => id.startsWith('contacts-'));
    if (existingSubId) {
      console.log('🔄 Closing existing contact list subscription:', existingSubId);
      this.closeSubscription(existingSubId);
    }
    
    const subId = 'contacts-persistent';
    const filter = {
      kinds: [3],
      authors: [this.currentUser.publicKey]
      // Removed limit: 1 to make it persistent and catch updates
    };
    
    const subscription = ['REQ', subId, filter];
    console.log('Contact list subscription:', JSON.stringify(subscription));
    this.subscriptions.set(subId, subscription);
    
    let sentToRelays = 0;
    this.relayConnections.forEach((ws, relay) => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log('📤 Sending contact list request to:', relay);
        ws.send(JSON.stringify(subscription));
        sentToRelays++;
      } else {
        console.log('❌ Relay not ready:', relay, 'state:', ws.readyState);
      }
    });
    
    console.log('📤 Contact list request sent to', sentToRelays, 'out of', this.relayConnections.size, 'relays');
    
    // Set a timeout to mark as loaded even if no contact list found
    setTimeout(() => {
      if (!this.contactListLoaded) {
        console.log('⏰ TIMEOUT: No contact list received after 5 seconds, assuming user follows no one');
        this.contactListLoaded = true;
        if (this.currentFeed === 'following') {
          this.loadFeed();
        }
      }
    }, 5000);
  }

  fetchMuteList() {
    if (!this.currentUser) {
      console.log('❌ Cannot fetch mute list: no current user');
      return;
    }
    
    console.log('🔇 === FETCHING MUTE LIST ===');
    console.log('User pubkey:', this.currentUser.publicKey);
    console.log('Relay connections available:', this.relayConnections.size);
    
    const subId = 'mutes-' + Date.now();
    const filter = {
      kinds: [10000],
      authors: [this.currentUser.publicKey],
      '#d': ['mute'],
      limit: 1
    };
    
    const subscription = ['REQ', subId, filter];
    console.log('Mute list subscription:', JSON.stringify(subscription));
    this.subscriptions.set(subId, subscription);
    
    let sentToRelays = 0;
    this.relayConnections.forEach((ws, relay) => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log('📤 Sending mute list request to:', relay);
        ws.send(JSON.stringify(subscription));
        sentToRelays++;
      } else {
        console.log('❌ Relay not ready:', relay, 'state:', ws.readyState);
      }
    });
    
    console.log('📤 Mute list request sent to', sentToRelays, 'out of', this.relayConnections.size, 'relays');
    
    // Set a timeout to mark as loaded even if no mute list found
    setTimeout(() => {
      if (!this.muteListLoaded) {
        console.log('⏰ TIMEOUT: No mute list received after 5 seconds, assuming user mutes no one');
        this.muteListLoaded = true;
      }
    }, 5000);
  }
  
  // showReplyModal removed - replies no longer supported
  
  // sendReply removed - replies no longer supported
  
  
  async signEvent(event) {
    if (this.currentUser.useNip07) {
      // Use NIP-07 extension
      const response = await this.sendMessage({
        type: 'NIP07_REQUEST',
        data: { method: 'signEvent', params: event }
      });
      
      if (response.success) {
        return response.data;
      } else {
        throw new Error(response.error);
      }
    } else {
      // Sign locally - convert hex string to Uint8Array if needed
      const privateKeyBytes = typeof this.currentUser.privateKey === 'string' ?
        this.hexToBytes(this.currentUser.privateKey) : this.currentUser.privateKey;
      return window.NostrTools.finalizeEvent(event, privateKeyBytes);
    }
  }
  
  async publishEvent(event) {
    const publishMessage = ['EVENT', event];
    
    this.relayConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(publishMessage));
      }
    });
  }
  
  copyToClipboard(button) {
    const copyType = button.dataset.copy;
    let text;
    
    if (copyType === 'npub') {
      text = document.getElementById('generated-npub').value;
    } else if (copyType === 'nsec') {
      text = document.getElementById('generated-nsec').value;
    }
    
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        button.textContent = '✓';
        setTimeout(() => {
          button.textContent = '📋';
        }, 1000);
      });
    }
  }
  
  togglePasswordVisibility(button) {
    const targetId = button.dataset.target;
    const input = document.getElementById(targetId);
    
    if (input.type === 'password') {
      input.type = 'text';
      button.textContent = '🙈';
    } else {
      input.type = 'password';
      button.textContent = '👁️';
    }
  }
  
  sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }
  
  hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
  
  bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  
  setupReactionButton(button, event) {
    // Check if user has already reacted to this event
    if (this.userReactions.has(event.id)) {
      // Just don't add event listeners - keep visual appearance the same
      return;
    }
    
    let longPressTimer = null;
    let isLongPress = false;
    
    // Mouse/touch start
    const startLongPress = () => {
      isLongPress = false;
      longPressTimer = setTimeout(() => {
        isLongPress = true;
        this.showEmojiPicker(event);
      }, 500); // 500ms for long press
    };
    
    // Mouse/touch end
    const endLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      
      // If not long press, do quick reaction with default emoji
      if (!isLongPress) {
        this.sendReaction(event, '🤙');
      }
      
      isLongPress = false;
    };
    
    // Mouse/touch cancel (when moving away)
    const cancelLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      isLongPress = false;
    };
    
    // Add event listeners for both mouse and touch
    button.addEventListener('mousedown', startLongPress);
    button.addEventListener('mouseup', endLongPress);
    button.addEventListener('mouseleave', cancelLongPress);
    
    // Touch events for mobile
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startLongPress();
    });
    button.addEventListener('touchend', (e) => {
      e.preventDefault();
      endLongPress();
    });
    button.addEventListener('touchcancel', cancelLongPress);
  }
  
  setupNoteMenu(menuContainer, event) {
    const menuBtn = menuContainer.querySelector('.menu-btn');
    const dropdown = menuContainer.querySelector('.menu-dropdown');
    
    if (!menuBtn || !dropdown) {
      return;
    }
    
    // Toggle dropdown visibility
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Close any other open dropdowns
      document.querySelectorAll('.menu-dropdown.show').forEach(other => {
        if (other !== dropdown) {
          other.classList.remove('show');
        }
      });
      
      dropdown.classList.toggle('show');
    });
    
    // Handle menu item clicks
    dropdown.addEventListener('click', (e) => {
      if (e.target.classList.contains('menu-item')) {
        e.stopPropagation();
        const action = e.target.dataset.action;
        this.handleMenuAction(action, event);
        dropdown.classList.remove('show');
      }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      dropdown.classList.remove('show');
    });
    
    // Close dropdown when scrolling
    document.addEventListener('scroll', () => {
      dropdown.classList.remove('show');
    }, true);
  }
  
  handleMenuAction(action, event) {
    switch (action) {
      case 'open-note':
        const noteId = window.NostrTools.nip19.noteEncode(event.id);
        const url = `https://jumble.social/notes/${noteId}`;
        window.open(url, 'jumble-social-tab');
        break;
      case 'copy-note-id':
        const formattedNoteId = window.NostrTools.nip19.noteEncode(event.id);
        this.copyTextToClipboard(formattedNoteId, 'Note ID copied to clipboard');
        break;
      case 'copy-note-text':
        this.copyTextToClipboard(event.content, 'Note text copied to clipboard');
        break;
      case 'copy-raw-data':
        this.copyTextToClipboard(JSON.stringify(event, null, 2), 'Raw note data copied to clipboard');
        break;
      case 'copy-pubkey':
        const npub = window.NostrTools.nip19.npubEncode(event.pubkey);
        this.copyTextToClipboard(npub, 'Author\'s key copied to clipboard');
        break;
      case 'view-user-profile':
        const userNpub = window.NostrTools.nip19.npubEncode(event.pubkey);
        const profileUrl = `https://jumble.social/users/${userNpub}`;
        window.open(profileUrl, 'jumble-social-tab');
        break;
    }
  }
  
  async copyTextToClipboard(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      console.log(successMessage);
      // You could add a toast notification here
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      console.log(successMessage + ' (fallback method)');
    }
  }
  
  setupClickableLinks(element, event) {
    // Setup nostr mentions
    const mentionElements = element.querySelectorAll('.nostr-mention');
    mentionElements.forEach(mentionElement => {
      mentionElement.addEventListener('click', (e) => {
        e.stopPropagation();
        const pubkey = mentionElement.dataset.pubkey;
        const bech32 = mentionElement.dataset.bech32;
        this.openUserFeed(pubkey, bech32);
      });
    });
    
    // Setup profile links
    const profileElements = element.querySelectorAll('[data-profile-link]');
    console.log('🔗 Setting up profile links for', profileElements.length, 'elements');
    profileElements.forEach((profileElement, index) => {
      profileElement.style.cursor = 'pointer';
      profileElement.addEventListener('click', (e) => {
        console.log('👤 Profile click detected on element', index, 'for user:', event.pubkey.substring(0, 16) + '...');
        
        // Check if we're inside a quoted note - if so, don't interfere with quoted note click
        const isInQuotedNote = e.target.closest('.quoted-note');
        if (isInQuotedNote) {
          console.log('📝 Profile click inside quoted note - allowing quoted note click to handle');
          return; // Don't handle profile click, let quoted note click take precedence
        }
        
        e.preventDefault();
        e.stopPropagation(); // Prevent note click (only for non-quoted contexts)
        const pubkey = event.pubkey;
        const npub = window.NostrTools.nip19.npubEncode(pubkey);
        console.log('🔗 Opening user profile on jumble.social:', pubkey.substring(0, 16) + '...');
        const profileUrl = `https://jumble.social/${npub}`;
        window.open(profileUrl, 'jumble-social-tab');
      });
      
      // Also add pointer cursor styling to make it clear these are clickable
      profileElement.style.userSelect = 'none';
      profileElement.title = 'Click to view user feed';
    });
    
    // Setup note links (timestamp)
    const noteElements = element.querySelectorAll('[data-note-link]');
    noteElements.forEach(noteElement => {
      noteElement.style.cursor = 'pointer';
      noteElement.addEventListener('click', (e) => {
        // Check if we're inside a quoted note - if so, don't interfere with quoted note click
        const isInQuotedNote = e.target.closest('.quoted-note');
        if (isInQuotedNote) {
          console.log('📝 Timestamp click inside quoted note - allowing quoted note click to handle');
          return; // Don't handle timestamp click, let quoted note click take precedence
        }
        
        e.stopPropagation(); // Prevent note click (only for non-quoted contexts)
        const noteId = window.NostrTools.nip19.noteEncode(event.id);
        const noteUrl = `https://jumble.social/notes/${noteId}`;
        window.open(noteUrl, 'jumble-social-tab');
      });
    });
    
    // Setup image gallery clicks
    const imageGallery = element.querySelector('.image-gallery');
    if (imageGallery) {
      if (imageGallery.classList.contains('blurred')) {
        // For blurred images, add click-to-reveal functionality
        imageGallery.style.cursor = 'pointer';
        imageGallery.title = 'Click to reveal images';
        imageGallery.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent note click
          imageGallery.classList.remove('blurred');
          imageGallery.classList.add('revealed');
          imageGallery.style.cursor = 'default';
          imageGallery.title = '';
          
          // After revealing, set up normal image click behavior
          const imageContainers = imageGallery.querySelectorAll('.image-container');
          imageContainers.forEach(container => {
            container.style.cursor = 'pointer';
            container.addEventListener('click', (e) => {
              e.stopPropagation(); // Prevent note click
              const noteId = window.NostrTools.nip19.noteEncode(event.id);
              const noteUrl = `https://jumble.social/notes/${noteId}`;
              window.open(noteUrl, 'jumble-social-tab');
            });
          });
        });
      } else {
        // For non-blurred images, set up normal click behavior
        const imageContainers = imageGallery.querySelectorAll('.image-container');
        imageContainers.forEach(container => {
          container.style.cursor = 'pointer';
          container.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent note click
            const noteId = window.NostrTools.nip19.noteEncode(event.id);
            const noteUrl = `https://jumble.social/notes/${noteId}`;
            window.open(noteUrl, 'jumble-social-tab');
          });
        });
      }
    }
  }
  
  showEmojiPicker(event) {
    // Don't show emoji picker if user has already reacted
    if (this.userReactions.has(event.id)) {
      return;
    }
    
    this.currentReactionEvent = event;
    document.getElementById('emoji-picker-modal').classList.remove('hidden');
  }
  
  async sendReaction(event, emoji) {
    if (!this.currentUser) {
      alert('Please sign in to react to notes');
      return;
    }
    
    // Check if user has already reacted to this event
    if (this.userReactions.has(event.id)) {
      console.log('User has already reacted to this event:', event.id);
      return;
    }
    
    try {
      console.log('Sending reaction:', emoji, 'to event:', event.id);
      
      // Create Nostr reaction event (kind 7)
      const reactionEvent = {
        kind: 7,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', event.id],
          ['p', event.pubkey],
          ['k', '1'] // React to kind 1 events (text notes)
        ],
        content: emoji,
        pubkey: this.currentUser.publicKey
      };
      
      const signedEvent = await this.signEvent(reactionEvent);
      await this.publishEvent(signedEvent);
      
      // Track that user has reacted to this event
      this.userReactions.add(event.id);
      
      // Immediately handle the reaction locally to show it
      this.handleReaction(signedEvent);
      
      // Update the UI
      this.updateReactionButton(event, emoji);
      
      console.log('Reaction sent successfully:', signedEvent);
    } catch (error) {
      console.error('Reaction error:', error);
      alert('Failed to send reaction');
    }
  }
  
  updateReactionButton(event, emoji) {
    // Find reaction buttons specifically for this event (not nested replies)
    const eventElement = document.querySelector(`[data-event-id="${event.id}"]`);
    if (!eventElement) return;
    
    // Select reaction buttons that are direct children of this event's actions
    const buttons = eventElement.querySelectorAll(':scope > .note-actions > .reaction-action');
    buttons.forEach(button => {
      // Replace the button content with just the emoji at the same size as the icon
      button.innerHTML = `<span style="font-size: 16px; line-height: 1;">${emoji}</span>`;
      
      // Remove all event listeners by cloning the button
      const newButton = button.cloneNode(true);
      button.parentNode.replaceChild(newButton, button);
    });
  }
  
  selectEmoji(emoji) {
    if (this.currentReactionEvent) {
      this.sendReaction(this.currentReactionEvent, emoji);
      this.hideModal('emoji-picker-modal');
    }
  }
  
  useCustomEmoji() {
    const input = document.getElementById('custom-emoji-input');
    const emoji = input.value.trim();
    
    if (emoji && this.currentReactionEvent) {
      this.sendReaction(this.currentReactionEvent, emoji);
      this.hideModal('emoji-picker-modal');
      input.value = '';
    }
  }

  // Basic Zap Functions (simplified for now)
  async generateZapInvoice() {
    if (!this.zappingEvent) {
      alert('Error: No event selected for zapping');
      return;
    }
    
    // Wait a moment for modal to fully render
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const amount = document.getElementById('zap-amount').value;
    const comment = document.getElementById('zap-comment').value;
    
    if (!amount || amount < 1) {
      alert('Please enter a valid amount');
      return;
    }
    
    console.log(`⚡ Generating ${amount} sat zap for note:`, this.zappingEvent.id.substring(0, 16) + '...');
    console.log('💬 Comment:', comment || '(none)');
    
    try {
      // Get recipient's profile to find Lightning address
      const profile = this.profiles.get(this.zappingEvent.pubkey);
      let lightningAddress = null;
      
      // Look for Lightning address in profile metadata (NIP-57 fields)
      if (profile?.lud06) {
        lightningAddress = profile.lud06; // LNURL
        console.log('🔍 Using LNURL from profile:', lightningAddress);
      } else if (profile?.lud16) {
        lightningAddress = profile.lud16; // Lightning Address
        console.log('🔍 Using Lightning Address from profile:', lightningAddress);
      }
      
      if (!lightningAddress) {
        throw new Error('Recipient has no Lightning address configured in their profile');
      }
      
      // Show invoice display and ensure elements exist
      const zapInvoiceDisplay = document.getElementById('zap-invoice-display');
      zapInvoiceDisplay.classList.remove('hidden');
      
      // Create missing elements if needed
      let zapQRCode = document.getElementById('zap-qr-code');
      if (!zapQRCode) {
        zapInvoiceDisplay.innerHTML = `
          <div class="zap-qr-section">
            <div id="zap-qr-code"></div>
            <button id="copy-zap-invoice" class="btn btn-secondary">Copy Invoice</button>
          </div>
          <div class="zap-invoice-section">
            <button id="show-invoice-btn" class="btn-link-small">Show invoice details</button>
            <div id="zap-invoice-text" class="hidden"></div>
          </div>
        `;
        zapQRCode = document.getElementById('zap-qr-code');
        
        // Add event listeners
        document.getElementById('copy-zap-invoice').addEventListener('click', () => this.copyZapInvoice());
        document.getElementById('show-invoice-btn').addEventListener('click', () => this.toggleInvoiceDisplay());
      }
      zapQRCode.innerHTML = '<p style="color: #ea772f;">⚡ Generating invoice...</p>';
      
      // Generate real Lightning invoice using LNURL-pay
      const invoice = await this.getLightningInvoice(lightningAddress, amount * 1000, comment);
      
      // Generate QR code
      this.generateQRCode(invoice);
      
      // Hide the Create Invoice button since QR is now shown
      const sendZapBtn = document.getElementById('send-zap-btn');
      if (sendZapBtn) {
        sendZapBtn.style.display = 'none';
      }
      
      // Lock the amount and comment fields since invoice is generated
      const zapAmountField = document.getElementById('zap-amount');
      const zapCommentField = document.getElementById('zap-comment');
      if (zapAmountField) {
        zapAmountField.disabled = true;
        zapAmountField.style.opacity = '0.6';
      }
      if (zapCommentField) {
        zapCommentField.disabled = true;
        zapCommentField.style.opacity = '0.6';
      }
      
      // Show the invoice in the modal
      const zapInvoiceText = document.getElementById('zap-invoice-text');
      
      if (!zapInvoiceText) {
        throw new Error('Zap invoice text element not found');
      }
      
      zapInvoiceText.textContent = invoice;
      // zapInvoiceDisplay is already visible from earlier
      
      // Store the invoice for payment tracking
      this.currentZapInvoice = {
        invoice: invoice,
        eventId: this.zappingEvent.id,
        amount: amount,
        timestamp: Date.now()
      };
      
      // Start listening for payment completion
      this.startPaymentMonitoring();
      
      console.log('✅ Real Lightning invoice generated');
      
    } catch (error) {
      console.error('❌ Failed to generate zap invoice:', error);
      console.error('❌ Error details:', error.message, error.stack);
      
      // Show error message in UI
      const errorMessage = error.message || 'Unknown error occurred';
      
      const zapQRCode = document.getElementById('zap-qr-code');
      const zapInvoiceText = document.getElementById('zap-invoice-text');
      const zapInvoiceDisplay = document.getElementById('zap-invoice-display');
      
      if (zapQRCode) {
        zapQRCode.innerHTML = `<p style="color: #ea772f;">Error: ${errorMessage}</p>`;
      }
      if (zapInvoiceText) {
        zapInvoiceText.textContent = 'Failed to generate invoice';
      }
      if (zapInvoiceDisplay) {
        zapInvoiceDisplay.classList.remove('hidden');
      }
      
      // Also show alert for immediate user feedback
      alert(`Failed to generate invoice: ${errorMessage}`);
    }
  }
  
  copyZapInvoice() {
    const invoiceText = document.getElementById('zap-invoice-text').textContent;
    
    if (!invoiceText) {
      console.log('❌ No invoice to copy');
      return;
    }
    
    navigator.clipboard.writeText(invoiceText).then(() => {
      console.log('✅ Invoice copied to clipboard');
      
      // Visual feedback
      const btn = document.getElementById('copy-zap-invoice');
      const originalText = btn.textContent;
      btn.textContent = '✅ Copied!';
      
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
      
    }).catch(err => {
      console.error('❌ Failed to copy invoice:', err);
      alert('Failed to copy invoice to clipboard');
    });
  }
  
  toggleInvoiceDisplay() {
    const invoiceText = document.getElementById('zap-invoice-text');
    const showButton = document.getElementById('show-invoice-btn');
    
    if (invoiceText.classList.contains('hidden')) {
      invoiceText.classList.remove('hidden');
      showButton.textContent = 'Hide invoice details';
    } else {
      invoiceText.classList.add('hidden');
      showButton.textContent = 'Show invoice details';
    }
  }
  
  startPaymentMonitoring() {
    // Clear any existing payment monitoring
    if (this.paymentMonitoringInterval) {
      clearInterval(this.paymentMonitoringInterval);
    }
    
    console.log('👀 Starting payment monitoring for invoice...');
    
    // Create a real-time subscription for zap receipts during payment monitoring
    if (this.currentZapInvoice && this.currentZapInvoice.eventId) {
      this.createRealTimeZapSubscription(this.currentZapInvoice.eventId);
    }
    
    // Monitor for payment completion via zap receipts
    // The payment monitoring will be handled by the existing handleZapReceipt function
    // We just need to set up a timeout for the monitoring period
    this.paymentMonitoringTimeout = setTimeout(() => {
      console.log('⏰ Payment monitoring timeout reached');
      this.stopPaymentMonitoring();
    }, 300000); // 5 minutes timeout
  }
  
  stopPaymentMonitoring() {
    if (this.paymentMonitoringInterval) {
      clearInterval(this.paymentMonitoringInterval);
      this.paymentMonitoringInterval = null;
    }
    if (this.paymentMonitoringTimeout) {
      clearTimeout(this.paymentMonitoringTimeout);
      this.paymentMonitoringTimeout = null;
    }
    
    // Clean up real-time zap subscription
    if (this.realTimeZapSubId) {
      this.relayConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['CLOSE', this.realTimeZapSubId]));
        }
      });
      this.subscriptions.delete(this.realTimeZapSubId);
      console.log('🧹 Cleaned up real-time zap subscription:', this.realTimeZapSubId);
      this.realTimeZapSubId = null;
    }
  }
  
  createRealTimeZapSubscription(eventId) {
    // Create a subscription specifically for real-time zap receipts during payment monitoring
    this.realTimeZapSubId = `realtime-zap-${eventId.substring(0, 8)}-${Date.now()}`;
    
    // Use a since filter starting from now to catch only new zap receipts
    const now = Math.floor(Date.now() / 1000);
    const filter = {
      kinds: [9735], // Zap receipts only
      '#e': [eventId], // Events that reference this note ID
      since: now - 30 // Start from 30 seconds ago to catch any that just happened
    };
    
    const subscription = ['REQ', this.realTimeZapSubId, filter];
    this.subscriptions.set(this.realTimeZapSubId, subscription);
    
    // Send to all connected relays
    let sentCount = 0;
    this.relayConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscription));
        sentCount++;
      }
    });
    
    console.log('📡 Created real-time zap subscription for payment monitoring:', eventId.substring(0, 16) + '...', `(sent to ${sentCount} relays)`);
  }
  
  showPaymentSuccessMessage(zapAmount, preimage = null) {
    console.log('🎉 Showing payment success message for', zapAmount, 'sats', preimage ? 'with preimage' : '');
    
    // Replace the zap invoice display with success message
    const zapInvoiceDisplay = document.getElementById('zap-invoice-display');
    if (zapInvoiceDisplay && !zapInvoiceDisplay.classList.contains('hidden')) {
      
      zapInvoiceDisplay.innerHTML = `
        <div class="zap-success">
          <div class="success-icon"><svg width="96" height="96" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M50 0C22.449 0 0 22.449 0 50C0 77.551 22.449 100 50 100C77.551 100 100 77.551 100 50C100 22.449 77.551 0 50 0ZM50 93.1973C26.1905 93.1973 6.80272 73.8095 6.80272 50C6.80272 26.1905 26.1905 6.80272 50 6.80272C73.8095 6.80272 93.1973 26.1905 93.1973 50C93.1973 73.8095 73.8095 93.1973 50 93.1973Z" fill="#EA772F"/>
<path d="M64.9787 43.3578H53.2654C52.3406 43.3578 52.0324 42.4187 52.3406 42.1056L62.821 19.2522C63.2834 18.7826 62.3586 18 61.8963 18H42.785C42.3226 18 41.8603 18.4696 41.8603 18.9392L34 54.1584C34 55.0976 34.4624 55.4106 34.9247 55.4106H45.4051C45.8675 55.4106 46.3298 55.8802 46.3298 56.3498L43.5556 80.612C43.4015 82.0207 45.251 82.4903 45.8675 81.3946L65.9034 44.9231C66.2117 44.297 65.7493 43.3578 64.9787 43.3578Z" fill="#EA772F"/>
</svg></div>
          <div class="success-message">
            <h3>Payment Successful!</h3>
            <p>Your ${zapAmount} sat zap has been sent</p>
          </div>
          <button id="close-success-btn" class="btn btn-secondary">Close</button>
        </div>
      `;
      
      // Add event listener for close button
      document.getElementById('close-success-btn').addEventListener('click', () => {
        this.hideModal('zap-modal');
      });
      
      // Auto-close after 5 seconds
      setTimeout(() => {
        const modal = document.getElementById('zap-modal');
        if (modal && !modal.classList.contains('hidden')) {
          this.hideModal('zap-modal');
        }
      }, 5000);
    } else {
      // If no invoice display (e.g., direct wallet payment), show success in modal
      const zapModal = document.getElementById('zap-modal');
      if (zapModal && !zapModal.classList.contains('hidden')) {
        // Create a temporary success overlay in the modal
        const successOverlay = document.createElement('div');
        successOverlay.className = 'payment-success-overlay';
        
        successOverlay.innerHTML = `
          <div class="zap-success">
            <div class="success-icon"><svg width="96" height="96" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M50 0C22.449 0 0 22.449 0 50C0 77.551 22.449 100 50 100C77.551 100 100 77.551 100 50C100 22.449 77.551 0 50 0ZM50 93.1973C26.1905 93.1973 6.80272 73.8095 6.80272 50C6.80272 26.1905 26.1905 6.80272 50 6.80272C73.8095 6.80272 93.1973 26.1905 93.1973 50C93.1973 73.8095 73.8095 93.1973 50 93.1973Z" fill="#EA772F"/>
<path d="M64.9787 43.3578H53.2654C52.3406 43.3578 52.0324 42.4187 52.3406 42.1056L62.821 19.2522C63.2834 18.7826 62.3586 18 61.8963 18H42.785C42.3226 18 41.8603 18.4696 41.8603 18.9392L34 54.1584C34 55.0976 34.4624 55.4106 34.9247 55.4106H45.4051C45.8675 55.4106 46.3298 55.8802 46.3298 56.3498L43.5556 80.612C43.4015 82.0207 45.251 82.4903 45.8675 81.3946L65.9034 44.9231C66.2117 44.297 65.7493 43.3578 64.9787 43.3578Z" fill="#EA772F"/>
</svg></div>
            <div class="success-message">
              <h3>Payment Successful!</h3>
              <p>Your ${zapAmount} sat zap has been sent</p>
            </div>
            <button id="close-success-overlay-btn" class="btn btn-secondary">Close</button>
          </div>
        `;
        
        zapModal.appendChild(successOverlay);
        
        // Close button handler
        document.getElementById('close-success-overlay-btn').addEventListener('click', () => {
          this.hideModal('zap-modal');
        });
        
        // Auto-close after 3 seconds
        setTimeout(() => {
          if (!zapModal.classList.contains('hidden')) {
            this.hideModal('zap-modal');
          }
        }, 3000);
      }
    }
    
    // Stop payment monitoring
    this.stopPaymentMonitoring();
    this.currentZapInvoice = null;
  }

  async getLightningInvoice(lightningAddress, amountMsat, comment) {
    console.log('🔗 Processing Lightning address:', lightningAddress);
    
    let lnurlEndpoint;
    
    // Handle Lightning Address (user@domain.com) vs LNURL
    if (lightningAddress.includes('@')) {
      // Lightning Address format (NIP-57)
      const [username, domain] = lightningAddress.split('@');
      lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${username}`;
      console.log('📧 Lightning Address endpoint:', lnurlEndpoint);
    } else if (lightningAddress.startsWith('lnurl')) {
      // LNURL format - need to decode
      try {
        const decoded = this.decodeLnurl(lightningAddress);
        lnurlEndpoint = decoded;
        console.log('🔗 Decoded LNURL endpoint:', lnurlEndpoint);
      } catch (error) {
        throw new Error('Invalid LNURL format: ' + error.message);
      }
    } else {
      throw new Error('Invalid Lightning address format');
    }
    
    // Step 1: Get LNURL-pay parameters
    console.log('📡 Fetching LNURL-pay parameters...');
    const response = await fetch(lnurlEndpoint);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch LNURL endpoint: ${response.status}`);
    }
    
    const lnurlResponse = await response.json();
    
    if (lnurlResponse.status === 'ERROR') {
      throw new Error(lnurlResponse.reason || 'LNURL endpoint returned error');
    }
    
    // Validate response
    if (!lnurlResponse.callback || !lnurlResponse.minSendable || !lnurlResponse.maxSendable) {
      throw new Error('Invalid LNURL-pay response: missing required fields');
    }
    
    // Check amount limits
    const minMsat = parseInt(lnurlResponse.minSendable);
    const maxMsat = parseInt(lnurlResponse.maxSendable);
    
    if (amountMsat < minMsat) {
      throw new Error(`Amount too small. Minimum: ${minMsat / 1000} sats`);
    }
    
    if (amountMsat > maxMsat) {
      throw new Error(`Amount too large. Maximum: ${maxMsat / 1000} sats`);
    }
    
    console.log(`✅ LNURL-pay parameters validated. Range: ${minMsat / 1000} - ${maxMsat / 1000} sats`);
    
    // Step 2: Create zap request (NIP-57)
    const zapRequest = await this.createZapRequest(amountMsat, comment);
    
    // Step 3: Request invoice from callback
    const callbackUrl = new URL(lnurlResponse.callback);
    callbackUrl.searchParams.set('amount', amountMsat.toString());
    
    if (comment && comment.trim()) {
      callbackUrl.searchParams.set('comment', comment.trim());
    }
    
    if (zapRequest) {
      callbackUrl.searchParams.set('nostr', JSON.stringify(zapRequest));
    }
    
    console.log('📡 Requesting invoice from callback:', callbackUrl.toString());
    
    const invoiceResponse = await fetch(callbackUrl.toString());
    
    if (!invoiceResponse.ok) {
      throw new Error(`Failed to get invoice: ${invoiceResponse.status}`);
    }
    
    const invoiceData = await invoiceResponse.json();
    
    if (invoiceData.status === 'ERROR') {
      throw new Error(invoiceData.reason || 'Failed to generate invoice');
    }
    
    if (!invoiceData.pr) {
      throw new Error('No payment request in response');
    }
    
    console.log('✅ Lightning invoice received');
    return invoiceData.pr;
  }
  
  decodeLnurl(lnurl) {
    // Basic LNURL decoding (this is a simplified version)
    // In a real implementation, you'd use a proper bech32 decoder
    throw new Error('LNURL decoding not implemented yet. Please use Lightning Address format (user@domain.com)');
  }
  
  async createZapRequest(amountMsat, comment) {
    console.log('🔍 Creating zap request - Current user:', this.currentUser);
    console.log('🔍 Zapping event:', this.zappingEvent?.id?.substring(0, 16) + '...');
    
    if (!this.currentUser) {
      console.log('⚠️ No current user, creating zap request without signature');
      return null;
    }
    
    if (!this.zappingEvent) {
      console.error('❌ No zapping event set!');
      return null;
    }
    
    try {
      console.log('📝 Creating NIP-57 zap request...');
      
      // Create zap request event according to NIP-57
      const zapRequest = {
        kind: 9734, // Zap request kind
        content: comment || '',
        tags: [
          ['e', this.zappingEvent.id], // Event being zapped
          ['p', this.zappingEvent.pubkey], // Recipient pubkey
          ['amount', amountMsat.toString()], // Amount in millisats
          ['relays', ...this.relays], // Relays where the zap receipt should be published (NIP-57 requirement)
        ],
        pubkey: this.currentUser.pubkey,
        created_at: Math.floor(Date.now() / 1000),
      };
      
      console.log('📝 Zap request before signing:', zapRequest);
      
      // Sign the zap request
      const signedZapRequest = await this.signEvent(zapRequest);
      console.log('✅ Zap request created and signed:', signedZapRequest);
      
      return signedZapRequest;
      
    } catch (error) {
      console.error('❌ Failed to create zap request:', error);
      // Continue without zap request for now
      return null;
    }
  }

  generateQRCode(text) {
    console.log('🔧 Generating QR code with QRious for text:', text.substring(0, 20) + '...');
    
    const tryGenerateQR = (retries = 3) => {
      try {
        // Check if QRious is available
        if (typeof QRious === 'undefined') {
          if (retries > 0) {
            console.log('⏳ QRious not ready, retrying in 100ms...', `(${retries} attempts left)`);
            setTimeout(() => tryGenerateQR(retries - 1), 100);
            return;
          } else {
            console.error('❌ QRious library not available after retries');
            document.getElementById('zap-qr-code').innerHTML = '<p style="color: #ea772f;">QR code library not loaded</p>';
            return;
          }
        }
        
        console.log('✅ QRious library found, generating QR code...');
        
        // Create canvas element
        const canvas = document.createElement('canvas');
        const qr = new QRious({
          element: canvas,
          value: text,
          size: 200,
          background: 'white',
          foreground: 'black',
          level: 'M'
        });
        
        // Clear previous QR code and display new one
        const qrContainer = document.getElementById('zap-qr-code');
        qrContainer.innerHTML = '';
        qrContainer.appendChild(canvas);
        
        console.log('✅ QR code generated successfully');
        
      } catch (error) {
        console.error('❌ Error generating QR code:', error);
        document.getElementById('zap-qr-code').innerHTML = '<p style="color: #ea772f;">Error generating QR code: ' + error.message + '</p>';
      }
    };
    
    tryGenerateQR();
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 DOM LOADED - Initializing SidecarApp!');
  window.sidecarApp = new SidecarApp();
});