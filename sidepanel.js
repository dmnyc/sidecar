// Main sidepanel script for Sidecar Nostr extension
console.log('🟢 SIDEPANEL.JS SCRIPT LOADED!');

class SidecarApp {
  constructor() {
    console.log('🏗️ SIDECAR APP CONSTRUCTOR CALLED');
    this.currentUser = null;
    this.currentFeed = 'trending';
    console.log('📝 Initial feed set to:', this.currentFeed);
    this.currentUserFeed = null;
    this.relays = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.snort.social',
      'wss://relay.nostr.band',
      'wss://nostr.wine'
    ];
    this.relayConnections = new Map();
    this.subscriptions = new Map();
    this.notes = new Map();
    this.threads = new Map(); // Map of parent note ID -> array of reply IDs
    this.noteParents = new Map(); // Map of note ID -> parent note ID
    this.orphanedReplies = new Map(); // Map of parent ID -> array of orphaned reply events
    this.userReactions = new Set(); // Track events user has already reacted to
    this.profiles = new Map(); // Cache for user profiles (pubkey -> profile data)
    this.profileRequests = new Set(); // Track pending profile requests
    this.initialFeedLoaded = false; // Track if initial feed has been loaded
    this.profileQueue = new Set(); // Queue profile requests for batching
    this.profileTimeout = null; // Timeout for batch processing
    this.userDropdownSetup = false; // Track if user dropdown is set up
    this.userFollows = new Set(); // Track who the current user follows
    this.contactListLoaded = false; // Track if contact list has been loaded
    this.loadingMore = false; // Track if we're currently loading more notes
    this.batchedLoadInProgress = false; // Track if batched load more is in progress
    this.loadMoreStartNoteCount = 0; // Track note count when load more started
    this.consecutiveEmptyLoads = 0; // Track consecutive empty load operations
    this.oldestNoteTimestamp = null; // Track oldest note for pagination
    this.feedHasMore = true; // Track if there are more notes to load
    this.batchNewNotesReceived = 0; // Track notes received in current batch operation
    this.expectedBatches = 0; // Track expected number of batches for completion
    this.completedBatches = new Set(); // Track which batches have completed
    this.currentBatchSubIds = []; // Track current batch subscription IDs for cleanup
    
    // Memory management settings - reduced to prevent browser freezing
    this.maxNotes = 300; // Maximum notes to keep in memory (reduced from 1000)
    this.maxProfiles = 150; // Maximum profiles to keep in cache (reduced from 500)
    this.maxDOMNotes = 50; // Maximum notes to keep in DOM (reduced from 100)
    this.memoryCheckInterval = 30000; // Check memory every 30 seconds (reduced from 60s)
    this.maxSubscriptions = 20; // Maximum concurrent subscriptions
    this.lastMemoryCheck = Date.now();
    
    this.init();
  }
  
  async init() {
    console.log('🚀 SIDECAR STARTING UP!');
    console.log('Current URL:', window.location.href);
    this.setupEventListeners();
    this.setupImageErrorHandling();
    this.setupInfiniteScroll();
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
    document.getElementById('cancel-compose-btn').addEventListener('click', () => this.hideComposeSection());
    
    // Reply modal
    document.getElementById('send-reply-btn').addEventListener('click', () => this.sendReply());
    document.getElementById('reply-text').addEventListener('input', this.updateReplyCharCount);
    
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
      if (e.target.classList.contains('emoji-btn')) {
        const emoji = e.target.dataset.emoji;
        this.selectEmoji(emoji);
      }
    });
    
    // Retry button
    document.getElementById('retry-btn').addEventListener('click', () => this.loadFeed());
    document.getElementById('load-more-btn').addEventListener('click', () => this.loadMoreNotes());
    
    // Generate keys when modal opens
    this.generateNewKeys();
    
    // Logo click for version modal
    document.querySelector('.logo').addEventListener('click', () => this.showVersionModal());
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
    // Set up periodic memory cleanup
    setInterval(() => {
      this.performMemoryCleanup();
    }, this.memoryCheckInterval);
    
    // Also check memory on visibility change (when user returns to tab)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - this.lastMemoryCheck > this.memoryCheckInterval) {
        this.performMemoryCleanup();
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
    
    // Clean up orphaned data
    this.cleanupOrphanedData();
    
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
    
    // Keep most recent notes + displayed notes
    const toKeep = new Set();
    let keptCount = 0;
    
    for (const [noteId, note] of notesArray) {
      if (displayedNoteIds.has(noteId) || keptCount < this.maxNotes * 0.8) {
        toKeep.add(noteId);
        keptCount++;
      }
    }
    
    // Remove old notes
    for (const [noteId] of this.notes) {
      if (!toKeep.has(noteId)) {
        this.notes.delete(noteId);
        // Also clean up related thread data
        this.threads.delete(noteId);
        this.noteParents.delete(noteId);
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
      console.log('🗑️ DOM cleanup triggered - preserving scroll position');
      
      // Preserve scroll position during cleanup
      const scrollContainer = document.querySelector('.feed-container') || document.documentElement;
      const scrollTop = scrollContainer.scrollTop;
      
      // Remove older DOM notes (keep newest) with safety limits
      const notesToRemove = Math.min(noteElements.length - this.maxDOMNotes, 100); // Safety limit
      
      // Convert to array and sort by timestamp (data-timestamp attribute)
      const sortedNotes = Array.from(noteElements)
        .sort((a, b) => {
          const timeA = parseInt(a.dataset.timestamp || '0');
          const timeB = parseInt(b.dataset.timestamp || '0');
          return timeA - timeB; // Oldest first
        });
      
      // Calculate height of notes we're about to remove to adjust scroll
      let removedHeight = 0;
      
      // Remove oldest notes with safety checks
      let removed = 0;
      for (let i = 0; i < notesToRemove && i < sortedNotes.length && removed < 100; i++) {
        if (sortedNotes[i] && sortedNotes[i].parentNode) {
          try {
            removedHeight += sortedNotes[i].offsetHeight;
            sortedNotes[i].remove();
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
  
  cleanupOrphanedData() {
    // Clean up orphaned replies that reference deleted notes
    for (const [parentId, replies] of this.orphanedReplies) {
      if (!this.notes.has(parentId)) {
        this.orphanedReplies.delete(parentId);
      }
    }
    
    // Clean up thread relationships for deleted notes
    for (const noteId of this.noteParents.keys()) {
      if (!this.notes.has(noteId)) {
        this.noteParents.delete(noteId);
      }
    }
    
    // Clean up user reactions for notes no longer in cache
    const validNoteIds = new Set(this.notes.keys());
    this.userReactions.forEach(reactionId => {
      // Extract note ID from reaction (if format is noteId:emoji)
      const noteId = reactionId.split(':')[0];
      if (!validNoteIds.has(noteId)) {
        this.userReactions.delete(reactionId);
      }
    });
  }
  
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
      this.threads.clear();
      this.orphanedReplies.clear();
      
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
    // Prevent multiple simultaneous requests
    if (this.loadingMore) {
      console.log('❌ Already loading more notes, skipping');
      return;
    }
    this.loadingMore = true;
    this.loadMoreStartNoteCount = this.notes.size; // Track starting note count
    
    // Show loading indicator
    const loadMoreBtn = document.getElementById('load-more-btn');
    const loadMoreLoading = document.getElementById('load-more-loading');
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    if (loadMoreLoading) loadMoreLoading.classList.remove('hidden');
    
    // Get the timestamp of the oldest note currently displayed
    const feed = document.getElementById('feed');
    const notes = Array.from(feed.children);
    if (notes.length === 0) return;
    
    const oldestNote = notes[notes.length - 1];
    const oldestTimestamp = parseInt(oldestNote.dataset.timestamp);
    
    // Create a subscription for older notes
    const subId = 'loadmore-' + Date.now();
    let filter;
    
    if (this.currentFeed === 'following' && this.userFollows.size > 0) {
      console.log('📋 Loading more for following feed, batching', this.userFollows.size, 'users');
      this.loadMoreFollowingFeedBatched(Array.from(this.userFollows), oldestTimestamp);
      return;
    } else if (this.currentFeed === 'following') {
      console.log('❌ Following feed but userFollows is empty:', this.userFollows.size);
    } else if (this.currentFeed === 'me' && this.currentUser) {
      console.log('📋 Creating me feed filter for user:', this.currentUser.publicKey.substring(0, 16) + '...');
      filter = {
        kinds: [1],
        authors: [this.currentUser.publicKey],
        until: oldestTimestamp,
        limit: 20
      };
    } else if (this.currentFeed === 'me') {
      console.log('❌ Me feed but currentUser is null/undefined');
    } else if (this.currentFeed === 'trending') {
      // For trending feed, we can't really paginate the nostr.band API easily
      // Instead, we'll load more recent notes that might be trending
      filter = {
        kinds: [1],
        until: oldestTimestamp,
        limit: 20
      };
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
      
      // Reset loading flag and cleanup subscription after timeout
      setTimeout(() => {
        this.loadingMore = false;
        
        // Hide loading indicator and restore button
        const loadMoreBtn = document.getElementById('load-more-btn');
        const loadMoreLoading = document.getElementById('load-more-loading');
        if (loadMoreBtn) loadMoreBtn.style.display = 'block';
        if (loadMoreLoading) loadMoreLoading.classList.add('hidden');
        
        // Close the load more subscription to free memory
        if (this.subscriptions.has(subId)) {
          this.relayConnections.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(['CLOSE', subId]));
            }
          });
          this.subscriptions.delete(subId);
          console.log(`🔌 Closed load more subscription: ${subId}`);
        }
        
        // Update Load More button visibility
        this.hideLoading();
      }, 5000);
    } else {
      console.log('❌ No filter created for loadMore - feed type not supported or missing data');
      this.loadingMore = false;
    }
  }
  
  async checkAuthState() {
    try {
      const response = await this.sendMessage({ type: 'GET_STORED_KEYS' });
      if (response.success && response.data) {
        this.currentUser = {
          publicKey: response.data.publicKey,
          privateKey: response.data.privateKey,
          useNip07: false
        };
        this.updateAuthUI();
        
        // Fetch contact list for already signed-in users
        setTimeout(() => {
          console.log('Fetching contact list for existing signed-in user...');
          this.fetchContactList();
        }, 2000); // Longer delay to ensure relays are connected
      }
    } catch (error) {
      console.error('Error checking auth state:', error);
    }
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
    this.currentUser = null;
    await this.sendMessage({ type: 'CLEAR_KEYS' });
    
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
        this.currentUser = {
          publicKey,
          privateKey: hexPrivateKey,
          useNip07: false
        };
        
        this.updateAuthUI();
        this.hideModal('auth-modal');
        this.loadFeed();
        input.value = '';
        
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
        this.currentUser = {
          ...this.generatedKeys,
          useNip07: false
        };
        
        this.updateAuthUI();
        this.hideModal('auth-modal');
        this.loadFeed();
        
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
  
  async signOut() {
    try {
      await this.sendMessage({ type: 'CLEAR_KEYS' });
      this.currentUser = null;
      this.userReactions.clear(); // Clear reaction tracking
      this.updateAuthUI();
      this.loadFeed();
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
      meFeedBtn.disabled = false;
      followingFeedBtn.disabled = false;
      
      // Update user info immediately
      this.updateUserProfile();
      
      // Setup user profile dropdown
      this.setupUserProfileDropdown();
      
      // Request user's own profile and load it immediately
      this.requestProfile(this.currentUser.publicKey);
      this.loadUserProfile();
      
      // Fetch user's contact list (following)
      this.fetchContactList();
    } else {
      signedOut.classList.remove('hidden');
      signedIn.classList.add('hidden');
      floatingBtn.classList.add('hidden');
      meFeedBtn.classList.add('hidden');
      followingFeedBtn.classList.add('hidden');
      meFeedBtn.disabled = true;
      followingFeedBtn.disabled = true;
      
      // Switch to top feed if on me or following
      if (this.currentFeed === 'me' || this.currentFeed === 'following') {
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
        window.open(profileUrl, '_blank');
      }
      profileBtn.classList.remove('open');
      dropdown.classList.remove('show');
    });
    
    document.getElementById('copy-key-btn').addEventListener('click', () => {
      if (this.currentUser) {
        const npub = window.NostrTools.nip19.npubEncode(this.currentUser.publicKey);
        this.copyToClipboard(npub, 'Your public key copied to clipboard');
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
        <img src="${profile.picture}" alt="" class="avatar-img" onerror="this.classList.add('broken'); this.remove(); this.parentElement.querySelector('.avatar-placeholder').style.display='flex';">
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
    
    // If switching away from user feed, close the user tab
    if (this.currentFeed === 'user-feed' && feedType !== 'user-feed') {
      console.log('🔄 Switching away from user feed, closing user tab');
      this.closeExistingUserTab();
    }
    
    this.currentFeed = feedType;
    
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
    document.getElementById('feed').innerHTML = '';
    this.notes.clear();
    this.threads.clear();
    this.noteParents.clear();
    this.orphanedReplies.clear();
    this.userReactions.clear();
    this.loadingMore = false;
    // Keep profiles cache - no need to refetch profile data
    
    // Mark as loaded since we're manually switching feeds
    this.initialFeedLoaded = true;
    this.loadFeed();
  }
  
  
  refreshFeed() {
    // Clear current feed and reload
    document.getElementById('feed').innerHTML = '';
    this.notes.clear();
    this.threads.clear();
    this.noteParents.clear();
    this.orphanedReplies.clear();
    this.userReactions.clear();
    this.loadingMore = false;
    // Keep profiles cache - no need to refetch profile data
    
    this.loadFeed();
  }
  
  connectToRelays() {
    this.relays.forEach(relay => {
      try {
        const ws = new WebSocket(relay);
        
        ws.onopen = () => {
          console.log(`Connected to ${relay}`);
          this.relayConnections.set(relay, ws);
          
          // Load feed when first relay connects
          if (!this.initialFeedLoaded) {
            this.initialFeedLoaded = true;
            this.loadFeed();
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
          // Attempt to reconnect after 5 seconds
          setTimeout(() => this.connectToRelays(), 5000);
        };
        
        ws.onerror = (error) => {
          console.error(`Error with ${relay}:`, error);
        };
      } catch (error) {
        console.error(`Failed to connect to ${relay}:`, error);
      }
    });
  }
  
  handleRelayMessage(relay, message) {
    const [type, subId, event] = message;
    
    if (type === 'EVENT' && event) {
      this.handleNote(event);
    } else if (type === 'EOSE') {
      // End of stored events
      console.log(`📋 EOSE received for subscription: ${subId}`);
      
      // For load more subscriptions, track EOSE completion
      if (subId.startsWith('loadmore-')) {
        // Track completed batches for batched operations
        if (subId.includes('batch')) {
          if (!this.completedBatches) this.completedBatches = new Set();
          
          // Only add to completed batches if not already present (prevent relay duplicates)
          const wasNew = !this.completedBatches.has(subId);
          this.completedBatches.add(subId);
          
          // Only log/track if this was a new completion (not a relay duplicate)
          if (wasNew) {
            console.log(`📋 Batch EOSE (NEW): ${subId}, completed: ${this.completedBatches.size}/${this.expectedBatches}`);
            
            // Check if all batches are complete
            if (this.completedBatches.size >= this.expectedBatches) {
              console.log('🎯 All batches completed! Finalizing batch load...');
              this.finalizeBatchedLoad();
            }
          } else {
            console.log(`📋 Batch EOSE (DUPLICATE): ${subId}, ignoring relay duplicate`);
          }
        } else {
          // Non-batched load more - check normally
          if (this.loadingMore) {
            const notesReceived = this.notes.size - this.loadMoreStartNoteCount;
            console.log(`📋 Load more received ${notesReceived} new notes`);
            if (notesReceived < 3) {
              console.log('📋 Load more returned few results, setting feedHasMore = false');
              this.feedHasMore = false;
            }
            this.loadingMore = false;
          }
        }
      }
      
      // Only call hideLoading for non-batched load more operations
      // Individual batch EOSE events should not update UI state
      if (!(subId.startsWith('loadmore-') && subId.includes('batch'))) {
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
  
  handleNote(event) {
    // Handle different event kinds
    if (event.kind === 1) {
      // Text notes
      // Avoid duplicates
      if (this.notes.has(event.id)) return;
      
      console.log('📝 Received note from:', event.pubkey.substring(0, 16) + '...', 'Content:', event.content.substring(0, 50) + '...');
      
      // Filter notes based on current feed type
      if (this.currentFeed === 'following') {
        // Only show notes from users we follow
        if (!this.userFollows.has(event.pubkey)) {
          console.log('🚫 Filtering out note from unfollowed user:', event.pubkey.substring(0, 16) + '...');
          return;
        }
        console.log('✅ Showing note from followed user:', event.pubkey.substring(0, 16) + '...');
      } else if (this.currentFeed === 'me') {
        // Only show notes from current user
        if (!this.currentUser || event.pubkey !== this.currentUser.publicKey) {
          console.log('🚫 Filtering out note from different user on Me feed:', event.pubkey.substring(0, 16) + '...');
          return;
        }
      } else if (this.currentFeed === 'user-feed') {
        // Only show notes from the selected user
        if (!this.currentUserFeed || event.pubkey !== this.currentUserFeed.pubkey) {
          console.log('🚫 Filtering out note from different user on user feed:', event.pubkey.substring(0, 16) + '...');
          return;
        }
      }
      // Global feed shows everything - no filtering needed
      
      this.notes.set(event.id, event);
      
      // Track notes received during batched load operations
      if (this.batchedLoadInProgress && this.batchNewNotesReceived !== undefined) {
        this.batchNewNotesReceived++;
        console.log(`📈 Batch note received! Total batch notes: ${this.batchNewNotesReceived}, Note ID: ${event.id.substring(0, 16)}...`);
      }
      
      // Memory monitoring to prevent browser freezes (but not during active loading)
      if (this.notes.size > this.maxNotes * 0.9 && !this.loadingMore) {
        console.warn(`⚠️ Approaching memory limit: ${this.notes.size}/${this.maxNotes} notes`);
        // Delayed cleanup to avoid interfering with active loading
        setTimeout(() => this.performMemoryCleanup(), 1000);
      }
      
      // Emergency cleanup only if we exceed limits significantly and not actively loading
      if (this.notes.size > this.maxNotes * 1.5 || this.subscriptions.size > this.maxSubscriptions * 3) {
        console.error(`🚨 EMERGENCY CLEANUP: notes=${this.notes.size}, subs=${this.subscriptions.size}`);
        if (!this.loadingMore) {
          this.performMemoryCleanup();
        }
      }
      
      // Track oldest note timestamp for pagination
      if (!this.oldestNoteTimestamp || event.created_at < this.oldestNoteTimestamp) {
        this.oldestNoteTimestamp = event.created_at;
      }
      
      // Build thread relationships
      this.buildThreadRelationships(event);
      
      // Request profile for this author if we don't have it
      this.requestProfile(event.pubkey);
      
      // Display note (will handle threading)
      this.displayNote(event);
    } else if (event.kind === 0) {
      console.log('👤 Received profile for:', event.pubkey.substring(0, 16) + '...');
      // Profile metadata
      this.handleProfile(event);
    } else if (event.kind === 3) {
      console.log('📋 Received contact list from:', event.pubkey.substring(0, 16) + '...');
      // Contact list
      this.handleContactList(event);
    }
  }
  
  handleProfile(event) {
    try {
      const profile = JSON.parse(event.content);
      this.profiles.set(event.pubkey, {
        ...profile,
        updatedAt: event.created_at
      });
      
      // Update any displayed notes from this author
      this.updateAuthorDisplay(event.pubkey);
      
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
    console.log('Event:', event);
    console.log('Event tags count:', event.tags.length);
    
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
      this.loadFeed();
    }
  }
  
  requestProfile(pubkey) {
    // Don't request if we already have it or if request is pending
    if (this.profiles.has(pubkey) || this.profileRequests.has(pubkey)) {
      return;
    }
    
    // Add to queue for batch processing
    this.profileQueue.add(pubkey);
    
    // Clear existing timeout and set new one
    if (this.profileTimeout) {
      clearTimeout(this.profileTimeout);
    }
    
    this.profileTimeout = setTimeout(() => {
      this.processBatchedProfileRequests();
    }, 100); // Batch requests over 100ms window
  }
  
  processBatchedProfileRequests() {
    if (this.profileQueue.size === 0) return;
    
    console.log(`Processing ${this.profileQueue.size} batched profile requests`);
    
    // Convert queue to array and clear it
    const pubkeys = Array.from(this.profileQueue);
    this.profileQueue.clear();
    
    // Mark all as pending
    pubkeys.forEach(pubkey => this.profileRequests.add(pubkey));
    
    // Create batch subscription for all pubkeys
    const subId = 'profiles-' + Date.now();
    const subscription = ['REQ', subId, {
      kinds: [0],
      authors: pubkeys,
      limit: pubkeys.length
    }];
    
    // Send to all connected relays
    let sentCount = 0;
    this.relayConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscription));
        sentCount++;
      }
    });
    
    console.log(`Batch profile request sent to ${sentCount} relays for ${pubkeys.length} authors`);
    
    // Remove from pending after timeout
    setTimeout(() => {
      pubkeys.forEach(pubkey => this.profileRequests.delete(pubkey));
    }, 5000);
  }
  
  updateAuthorDisplay(pubkey) {
    // Find all notes from this author and update their display
    const elements = document.querySelectorAll(`[data-author="${pubkey}"]`);
    elements.forEach(element => {
      const profile = this.profiles.get(pubkey);
      if (profile) {
        const nameElement = element.querySelector('.note-author, .reply-author');
        const idElement = element.querySelector('.note-npub, .reply-npub');
        const avatarContainer = element.querySelector('.note-avatar, .reply-avatar');
        
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
          avatarContainer.innerHTML = `
            <img src="${profile.picture}" alt="" class="avatar-img" onerror="this.classList.add('broken'); this.remove(); this.parentElement.querySelector('.avatar-placeholder').style.display='flex';">
            <div class="avatar-placeholder" style="display: none;">${this.getAvatarPlaceholder(authorName)}</div>
          `;
        }
      }
    });
    
    // Update nostr mentions for this user
    const mentionElements = document.querySelectorAll(`[data-pubkey="${pubkey}"]`);
    mentionElements.forEach(element => {
      if (element.classList.contains('nostr-mention')) {
        const profile = this.profiles.get(pubkey);
        const displayName = profile?.display_name || profile?.name || this.getAuthorName(pubkey);
        const truncatedDisplayName = this.truncateUsername(displayName, 20);
        element.textContent = `@${truncatedDisplayName}`;
        element.title = `@${displayName}`; // Full name in tooltip
      }
    });
    
    // Update user tab if it exists for this user
    const userTab = document.getElementById(`user-tab-${pubkey}`);
    if (userTab && profile) {
      const displayName = profile.display_name || profile.name || this.getAuthorName(pubkey);
      const truncatedDisplayName = this.truncateUsername(displayName, 12);
      userTab.innerHTML = `@${truncatedDisplayName}`;
      userTab.title = `@${displayName}`; // Full name in tooltip
    }
    
    // Also update user's own profile in header if this is the logged-in user
    if (this.currentUser && pubkey === this.currentUser.publicKey) {
      this.updateUserProfile();
    }
  }
  
  buildThreadRelationships(event) {
    // Check if this is a reply by looking for 'e' tags
    const eTags = event.tags.filter(tag => tag[0] === 'e');
    
    if (eTags.length > 0) {
      let parentId;
      
      // NIP-10: Look for reply marker first
      const replyTag = eTags.find(tag => tag[3] === 'reply');
      if (replyTag) {
        parentId = replyTag[1];
      } else {
        // Fallback: Use the last 'e' tag as parent (legacy behavior)
        parentId = eTags[eTags.length - 1][1];
      }
      
      // Store parent relationship
      this.noteParents.set(event.id, parentId);
      
      // Add to parent's replies list
      if (!this.threads.has(parentId)) {
        this.threads.set(parentId, []);
      }
      this.threads.get(parentId).push(event.id);
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
      
      // Historical notes subscription for this batch
      const filter = {
        kinds: [1],
        authors: batch,
        limit: Math.ceil(30 / batches.length) // Distribute limit across batches
      };
      
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      
      // Real-time subscription for this batch
      const realtimeFilter = {
        ...filter,
        since: Math.floor(Date.now() / 1000),
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
    
    // Additional safety check to prevent overlapping batched operations
    if (this.batchedLoadInProgress) {
      console.log('⚠️ Batched load already in progress, skipping');
      this.loadingMore = false;
      return;
    }
    this.batchedLoadInProgress = true;
    this.batchNewNotesReceived = 0; // Track notes received specifically for this batch operation
    
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
    
    let sentToRelays = 0;
    const timestamp = Date.now();
    this.currentBatchSubIds = []; // Store for cleanup
    
    // Create subscriptions for each batch
    batches.forEach((batch, batchIndex) => {
      const subId = `loadmore-following-batch-${batchIndex}-${timestamp}`;
      this.currentBatchSubIds.push(subId);
      
      console.log(`📤 LoadMore Batch ${batchIndex + 1}: Creating subscription for ${batch.length} authors`);
      
      // Historical notes subscription for this batch (older notes)
      const filter = {
        kinds: [1],
        authors: batch,
        until: untilTimestamp,
        limit: Math.ceil(20 / batches.length) // Distribute limit across batches
      };
      
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      
      console.log(`📤 LoadMore Batch ${batchIndex + 1} filter:`, JSON.stringify(filter));
      
      // Send to all connected relays
      this.relayConnections.forEach((ws, relay) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(subscription));
          if (batchIndex === 0) sentToRelays++; // Count once per relay
        }
      });
    });
    
    console.log('📤 LoadMore Following feed batches sent to', sentToRelays, 'relays');
    console.log('📦 Total loadMore subscriptions created:', batches.length);
    console.log('📦 Expecting EOSE from', this.expectedBatches, 'batches');
    
    // Safety timeout to prevent flag from getting stuck - longer timeout for proper completion
    setTimeout(() => {
      if (this.batchedLoadInProgress) {
        console.log('⚠️ Batched load timeout safety - clearing flags after 15s');
        this.finalizeBatchedLoad();
      }
    }, 15000); // 15 second safety timeout
  }
  
  finalizeBatchedLoad() {
    if (!this.batchedLoadInProgress) {
      console.log('📋 finalizeBatchedLoad called but batchedLoadInProgress is false, skipping');
      return;
    }
    
    // Check if we got enough notes from the entire batched operation
    const notesReceived = this.batchNewNotesReceived || 0;
    console.log(`📋 Batched load more completed: ${notesReceived} new notes received during batch operation`);
    
    if (notesReceived === 0) {
      this.consecutiveEmptyLoads++;
      console.log(`📋 Batched load more returned no results (${this.consecutiveEmptyLoads} consecutive empty loads)`);
      
      // Only stop after multiple consecutive empty loads to handle temporary gaps/relay issues
      if (this.consecutiveEmptyLoads >= 3) {
        console.log('📋 Multiple consecutive empty loads, setting feedHasMore = false');
        this.feedHasMore = false;
      } else {
        this.feedHasMore = true; // Explicitly keep it true for temporary gaps
        console.log('📋 Keeping feedHasMore = true, may be temporary gap or relay issue');
      }
    } else {
      this.consecutiveEmptyLoads = 0; // Reset counter when we get results
      this.feedHasMore = true; // Explicitly ensure feedHasMore is true when we get results
      console.log(`📋 Batched load more got ${notesReceived} results, setting feedHasMore = true`);
      console.log(`📋 feedHasMore is now: ${this.feedHasMore} (should be true)`);
    }
    
    // Reset the batch counter
    this.batchNewNotesReceived = 0;
    
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
    
    // Hide loading indicator and restore button/state
    const loadMoreBtn = document.getElementById('load-more-btn');
    const loadMoreLoading = document.getElementById('load-more-loading');
    if (loadMoreBtn) loadMoreBtn.style.display = 'block';
    if (loadMoreLoading) loadMoreLoading.classList.add('hidden');
    
    // Ensure Load More button visibility is updated
    console.log(`📋 About to call hideLoading() - feedHasMore: ${this.feedHasMore}`);
    this.hideLoading();
    console.log(`📋 After hideLoading() - feedHasMore: ${this.feedHasMore}`);
  }
  
  async loadTopFeed() {
    console.log('🔥 LOADING TRENDING FEED FROM NOSTR.BAND!!!');
    this.showLoading();
    
    try {
      // Fetch trending notes from nostr.band API
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      console.log('📡 Fetching trending notes from nostr.band for date:', dateStr);
      const response = await fetch(`https://api.nostr.band/v0/trending/notes/${dateStr}`);
      
      if (!response.ok) {
        throw new Error(`Nostr.band API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('📊 Nostr.band API response:', data);
      
      if (!data.notes || data.notes.length === 0) {
        this.hideLoading();
        document.getElementById('feed').innerHTML = `
          <div style="text-align: center; padding: 40px 20px; color: #ea6390;">
            <p>No trending notes available right now.</p>
            <p>Try refreshing or check back later!</p>
          </div>
        `;
        return;
      }
      
      // Extract note IDs from trending data
      const trendingNoteIds = data.notes.slice(0, 20).map(note => note.id);
      console.log('🎯 Fetching trending note IDs:', trendingNoteIds.length);
      
      // Clear existing subscriptions
      this.subscriptions.forEach((sub, id) => {
        this.relayConnections.forEach(ws => {
          ws.send(JSON.stringify(['CLOSE', id]));
        });
      });
      this.subscriptions.clear();
      
      // Create subscription to fetch the actual note events
      const filter = {
        kinds: [1],
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
      
    } catch (error) {
      console.error('❌ Error loading trending feed:', error);
      this.hideLoading();
      document.getElementById('feed').innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #ef4444;">
          <p>Error loading trending feed</p>
          <p style="font-size: 12px; color: #888;">${error.message}</p>
          <button onclick="window.sidecarApp.loadTopFeed()" style="margin-top: 16px; padding: 8px 16px; background: #ea6390; color: white; border: none; border-radius: 6px; cursor: pointer;">Try Again</button>
        </div>
      `;
    }
  }
  
  loadFeed(resetPagination = true) {
    console.log('🔄 === LOADING FEED ===');
    console.log('Feed type:', this.currentFeed);
    console.log('Contact list loaded:', this.contactListLoaded);
    console.log('User follows count:', this.userFollows.size);
    console.log('User follows (first 5):', Array.from(this.userFollows).slice(0, 5));
    console.log('Current user:', this.currentUser?.publicKey?.substring(0, 16) + '...');
    console.log('Relay connections:', this.relayConnections.size);
    
    // Reset pagination for new feed loads (but not for infinite scroll)
    if (resetPagination) {
      this.oldestNoteTimestamp = null;
      this.feedHasMore = true;
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
    
    if (this.currentFeed === 'user-feed' && this.currentUserFeed) {
      // User feed: delegate to loadUserFeed
      this.loadUserFeed(this.currentUserFeed.pubkey);
      return;
    } else if (this.currentFeed === 'trending') {
      // Top feed: trending notes from nostr.band
      console.log('🎯 DETECTED TOP FEED - CALLING loadTopFeed()');
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
          <div style="text-align: center; padding: 40px 20px; color: #ea6390;">
            <p>You're not following anyone yet.</p>
            <p>Switch to Top or Global feed to discover people to follow!</p>
            <br>
            <button id="retry-contact-list" class="btn btn-secondary" style="margin-top: 10px;">Retry Loading Follows</button>
          </div>
        `;
        
        // Add retry button functionality
        document.getElementById('retry-contact-list').addEventListener('click', () => {
          console.log('Manual retry of contact list...');
          this.contactListLoaded = false;
          this.fetchContactList();
          this.loadFeed();
        });
        return;
      }
    } else if (this.currentFeed === 'me' && this.currentUser) {
      // Me feed: current user's own notes with historical loading
      const baseFilter = {
        kinds: [1],
        authors: [this.currentUser.publicKey],
        limit: 30
      };
      
      // Add until timestamp for pagination if we have it
      if (this.oldestNoteTimestamp) {
        baseFilter.until = this.oldestNoteTimestamp - 1;
      }
      
      filter = baseFilter;
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
  
  displayNote(event) {
    const parentId = this.noteParents.get(event.id);
    
    if (parentId) {
      // This is a reply - display it under the parent
      this.displayReply(event, parentId);
    } else {
      // This is a top-level note - display it in the main feed
      this.displayTopLevelNote(event);
    }
  }
  
  displayTopLevelNote(event) {
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
    
    for (const existingNote of existingNotes) {
      const existingTimestamp = parseInt(existingNote.dataset.timestamp);
      if (event.created_at > existingTimestamp) {
        feed.insertBefore(noteElement, existingNote);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      feed.appendChild(noteElement);
    }
    
    // Check if there are any orphaned replies waiting for this parent
    this.displayOrphanedReplies(event.id);
  }
  
  displayReply(event, parentId) {
    // Find the parent note element in the DOM
    const parentElement = document.querySelector(`[data-event-id="${parentId}"]`);
    
    if (!parentElement) {
      // Parent not found in DOM yet, store as orphaned reply
      console.log(`Parent ${parentId} not found for reply ${event.id}, storing as orphaned`);
      if (!this.orphanedReplies.has(parentId)) {
        this.orphanedReplies.set(parentId, []);
      }
      this.orphanedReplies.get(parentId).push(event);
      return;
    }
    
    // Check if reply already exists in DOM to prevent duplicates
    const existingReplyElement = document.querySelector(`[data-event-id="${event.id}"]`);
    if (existingReplyElement) {
      console.log('📋 Reply already exists in DOM, skipping:', event.id.substring(0, 16) + '...');
      return;
    }
    
    const replyElement = this.createReplyElement(event);
    
    // Find or create replies container for parent
    let repliesContainer = parentElement.querySelector('.replies-container');
    if (!repliesContainer) {
      repliesContainer = document.createElement('div');
      repliesContainer.className = 'replies-container';
      parentElement.appendChild(repliesContainer);
    }
    
    // Insert reply in chronological order within replies
    const existingReplies = Array.from(repliesContainer.children);
    let inserted = false;
    
    for (const existingReply of existingReplies) {
      const existingTimestamp = parseInt(existingReply.dataset.timestamp);
      if (event.created_at < existingTimestamp) {
        repliesContainer.insertBefore(replyElement, existingReply);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      repliesContainer.appendChild(replyElement);
    }
  }
  
  displayOrphanedReplies(parentId) {
    const orphans = this.orphanedReplies.get(parentId);
    if (!orphans || orphans.length === 0) return;
    
    console.log(`Displaying ${orphans.length} orphaned replies for parent ${parentId}`);
    
    // Display each orphaned reply
    orphans.forEach(replyEvent => {
      this.displayReply(replyEvent, parentId);
    });
    
    // Clear orphaned replies for this parent
    this.orphanedReplies.delete(parentId);
  }
  
  buildReplyTags(replyToEvent) {
    const tags = [];
    
    // Find the root of this thread by examining the event's tags
    const rootId = this.findThreadRoot(replyToEvent);
    
    // NIP-10: Add root tag if this is part of a thread
    if (rootId && rootId !== replyToEvent.id) {
      // This is a reply to a reply - add both root and reply markers
      tags.push(['e', rootId, '', 'root']);
      tags.push(['e', replyToEvent.id, '', 'reply']);
    } else {
      // This is a direct reply to the original post
      tags.push(['e', replyToEvent.id, '', 'root']);
    }
    
    // NIP-10: Add p tags for all participants
    const participants = this.gatherThreadParticipants(replyToEvent);
    participants.forEach(pubkey => {
      tags.push(['p', pubkey]);
    });
    
    return tags;
  }
  
  findThreadRoot(event) {
    // Look for existing root marker in the event's tags
    const rootTag = event.tags.find(tag => tag[0] === 'e' && tag[3] === 'root');
    if (rootTag) {
      return rootTag[1]; // Return the root event ID
    }
    
    // If no root marker, check for any e tag (might be legacy format)
    const eTag = event.tags.find(tag => tag[0] === 'e');
    if (eTag) {
      return eTag[1]; // This event's parent becomes our root
    }
    
    // If no e tags, this event itself is the root
    return event.id;
  }
  
  gatherThreadParticipants(replyToEvent) {
    const participants = new Set();
    
    // Add the author of the event we're replying to
    participants.add(replyToEvent.pubkey);
    
    // Add any existing p tag participants from the parent event
    replyToEvent.tags
      .filter(tag => tag[0] === 'p')
      .forEach(tag => participants.add(tag[1]));
    
    return Array.from(participants);
  }
  
  createNoteElement(event) {
    const noteDiv = document.createElement('div');
    noteDiv.className = 'note';
    noteDiv.dataset.eventId = event.id;
    noteDiv.dataset.timestamp = event.created_at;
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
            `<img src="${avatarUrl}" alt="" class="avatar-img" onerror="this.classList.add('broken'); this.remove(); this.parentElement.querySelector('.avatar-placeholder').style.display='flex';">
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
      <div class="note-content">
${formattedContent.text}
${formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, event.id, event.pubkey) : ''}
${formattedContent.quotedNotes && formattedContent.quotedNotes.length > 0 ? this.createQuotedNotes(formattedContent.quotedNotes) : ''}
      </div>
      <div class="note-actions">
        <div class="note-action reply-action" data-event-id="${event.id}">
          💬
        </div>
        <div class="note-action reaction-action" data-event-id="${event.id}">
          🤙
        </div>
      </div>
    `;
    
    // Add event listeners
    noteDiv.querySelector('.reply-action').addEventListener('click', () => this.showReplyModal(event));
    this.setupReactionButton(noteDiv.querySelector('.reaction-action'), event);
    this.setupNoteMenu(noteDiv.querySelector('.note-menu'), event);
    this.setupClickableLinks(noteDiv, event);
    
    return noteDiv;
  }
  
  createReplyElement(event) {
    const replyDiv = document.createElement('div');
    replyDiv.className = 'reply';
    replyDiv.dataset.eventId = event.id;
    replyDiv.dataset.timestamp = event.created_at;
    replyDiv.dataset.author = event.pubkey; // For profile updates
    
    const profile = this.profiles.get(event.pubkey);
    const authorName = profile?.display_name || profile?.name || this.getAuthorName(event.pubkey);
    const authorId = this.formatProfileIdentifier(profile?.nip05, event.pubkey);
    const avatarUrl = profile?.picture;
    const timeAgo = this.formatTimeAgo(event.created_at);
    const formattedContent = this.formatNoteContent(event.content);
    
    replyDiv.innerHTML = `
      <div class="reply-header">
        <div class="reply-avatar" data-profile-link="${window.NostrTools.nip19.npubEncode(event.pubkey)}">
          ${avatarUrl ? 
            `<img src="${avatarUrl}" alt="" class="avatar-img small" onerror="this.classList.add('broken'); this.remove(); this.parentElement.querySelector('.avatar-placeholder').style.display='flex';">
             <div class="avatar-placeholder small" style="display: none;">${this.getAvatarPlaceholder(authorName)}</div>` :
            `<div class="avatar-placeholder small">${this.getAvatarPlaceholder(authorName)}</div>`
          }
        </div>
        <div class="reply-info" data-profile-link="${window.NostrTools.nip19.npubEncode(event.pubkey)}">
          <span class="reply-author">${authorName}</span>
          <span class="reply-npub" ${profile?.nip05 ? 'data-nip05="true"' : ''}>${authorId}</span>
        </div>
        <span class="reply-time" data-note-link="${event.id}">${timeAgo}</span>
        <div class="reply-menu">
          <button class="menu-btn" data-event-id="${event.id}">⋯</button>
          <div class="menu-dropdown" data-event-id="${event.id}">
            <div class="menu-item" data-action="open-note">Open Note</div>
            <div class="menu-item" data-action="copy-note-id">Copy Note ID</div>
            <div class="menu-item" data-action="copy-note-text">Copy Note Text</div>
            <div class="menu-item" data-action="copy-raw-data">Copy Raw Data</div>
            <div class="menu-item" data-action="copy-pubkey">Copy Author's Key</div>
            <div class="menu-item" data-action="view-user-profile">View User Profile</div>
          </div>
        </div>
      </div>
      <div class="reply-content">
${formattedContent.text}
${formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, event.id, event.pubkey) : ''}
${formattedContent.quotedNotes && formattedContent.quotedNotes.length > 0 ? this.createQuotedNotes(formattedContent.quotedNotes) : ''}
      </div>
      <div class="reply-actions">
        <div class="reply-action reply-to-reply-action" data-event-id="${event.id}">
          💬
        </div>
        <div class="reply-action reaction-reply-action" data-event-id="${event.id}">
          🤙
        </div>
      </div>
    `;
    
    // Add event listeners
    replyDiv.querySelector('.reply-to-reply-action').addEventListener('click', () => this.showReplyModal(event));
    this.setupReactionButton(replyDiv.querySelector('.reaction-reply-action'), event);
    this.setupNoteMenu(replyDiv.querySelector('.reply-menu'), event);
    this.setupClickableLinks(replyDiv, event);
    
    return replyDiv;
  }
  
  getAuthorName(pubkey) {
    const profile = this.profiles.get(pubkey);
    if (profile && (profile.display_name || profile.name)) {
      return profile.display_name || profile.name;
    }
    // Fallback to truncated pubkey if no profile name available
    return pubkey.substring(0, 8) + '...';
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
          const username = profile?.display_name || profile?.name || this.getAuthorName(pubkey);
          
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
    
    // Remove image URLs from text content
    images.forEach(img => {
      textContent = textContent.replace(img, '');
    });
    
    // Clean up extra whitespace and format text
    textContent = textContent
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/\n\s*\n/g, '\n') // Remove empty lines
      .trim()
      .replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    
    return { 
      text: textContent, 
      images,
      quotedNotes: nostrParsed.quotedNotes // Pass quoted notes to be rendered separately
    };
  }
  
  createImageGallery(images, eventId, pubkey) {
    if (images.length === 0) return '';
    
    // Check if user is followed to determine if images should be blurred
    // If not signed in or user not followed, blur the images
    const isFollowed = this.currentUser && this.userFollows.has(pubkey);
    const galleryClass = images.length === 1 ? 'single-image' : 'multi-image';
    const blurClass = !isFollowed ? 'blurred' : '';
    const maxDisplay = Math.min(images.length, 4); // Show max 4 images
    
    let galleryHTML = `<div class="image-gallery ${galleryClass} ${blurClass}" data-event-id="${eventId}" data-pubkey="${pubkey}">`;
    
    for (let i = 0; i < maxDisplay; i++) {
      const imageUrl = images[i];
      
      if (i === 3 && images.length > 4) {
        // Show "+X more" overlay on 4th image if there are more
        const remaining = images.length - 3;
        galleryHTML += `
          <div class="image-container more-images" data-image-url="${imageUrl}">
            <img src="${imageUrl}" alt="" loading="lazy" onerror="this.classList.add('broken'); this.parentElement.remove();">
            <div class="image-overlay">+${remaining} more</div>
          </div>
        `;
      } else {
        galleryHTML += `
          <div class="image-container" data-image-url="${imageUrl}">
            <img src="${imageUrl}" alt="" loading="lazy" onerror="this.classList.add('broken'); this.parentElement.remove();">
          </div>
        `;
      }
    }
    
    galleryHTML += '</div>';
    return galleryHTML;
  }
  
  createQuotedNotes(quotedNotes) {
    if (!quotedNotes || quotedNotes.length === 0) return '';
    
    let quotedHTML = '<div class="quoted-notes">';
    
    quotedNotes.forEach(quoted => {
      // Try to find the quoted event in our cache
      const quotedEvent = Array.from(this.notes.values()).find(e => e.id === quoted.eventId);
      
      if (quotedEvent) {
        // We have the event, render it as a quoted note
        const profile = this.profiles.get(quotedEvent.pubkey);
        const authorName = profile?.display_name || profile?.name || this.getAuthorName(quotedEvent.pubkey);
        const timeAgo = this.formatTimeAgo(quotedEvent.created_at);
        const content = quotedEvent.content.length > 200 ? 
          quotedEvent.content.substring(0, 200) + '...' : quotedEvent.content;
        
        quotedHTML += `
          <div class="quoted-note" data-event-id="${quoted.eventId}" data-bech32="${quoted.bech32}">
            <div class="quoted-header">
              <span class="quoted-author">@${authorName}</span>
              <span class="quoted-time">${timeAgo}</span>
            </div>
            <div class="quoted-content">${content.replace(/\n/g, '<br>')}</div>
            <div class="quoted-link">${quoted.bech32}</div>
          </div>
        `;
      } else {
        // Event not in cache, show a placeholder and try to fetch it
        quotedHTML += `
          <div class="quoted-note loading" data-event-id="${quoted.eventId}" data-bech32="${quoted.bech32}">
            <div class="quoted-header">
              <span class="quoted-author">Loading quoted note...</span>
            </div>
            <div class="quoted-content">
              <div class="spinner small"></div>
            </div>
            <div class="quoted-link">${quoted.bech32}</div>
          </div>
        `;
        
        // Try to fetch the quoted event
        this.fetchQuotedEvent(quoted);
      }
    });
    
    quotedHTML += '</div>';
    return quotedHTML;
  }
  
  fetchQuotedEvent(quotedNote) {
    // Create subscription to fetch the quoted event
    const subId = `quoted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let filter;
    
    if (quotedNote.type === 'note') {
      filter = { ids: [quotedNote.eventId] };
    } else if (quotedNote.type === 'nevent') {
      filter = { ids: [quotedNote.eventId] };
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
      }, 5000);
    }
  }
  
  openUserFeed(pubkey, bech32) {
    console.log('🔓 Opening user feed for:', pubkey.substring(0, 16) + '...');
    
    // Close any existing user tab first
    this.closeExistingUserTab();
    
    // Get or create user profile info
    const profile = this.profiles.get(pubkey);
    const displayName = profile?.display_name || profile?.name || this.getAuthorName(pubkey);
    
    // Create new tab data
    const userFeedTab = {
      id: `user-${pubkey}`,
      pubkey: pubkey,
      displayName: displayName,
      bech32: bech32,
      type: 'user-feed',
      active: true
    };
    
    // Switch to user feed mode
    this.currentUserFeed = userFeedTab;
    
    // Use switchFeed to properly manage active states, but set to user-feed after
    // to avoid the closeExistingUserTab call in switchFeed
    const previousFeed = this.currentFeed;
    this.currentFeed = 'user-feed';
    
    // Remove active from all buttons since we're switching to user tab
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
    
    // Update feed toggle to show user tab
    this.updateFeedToggle();
    
    // Load user's feed
    this.loadUserFeed(pubkey);
  }
  
  closeExistingUserTab() {
    // Remove any existing user tabs
    const existingUserTabs = document.querySelectorAll('.user-tab');
    existingUserTabs.forEach(tab => tab.remove());
    
    // Clear current user feed state
    this.currentUserFeed = null;
  }
  
  updateFeedToggle() {
    if (this.currentFeed === 'user-feed' && this.currentUserFeed) {
      // Create user tab (since we always close existing ones first, this will be fresh)
      const truncatedDisplayName = this.truncateUsername(this.currentUserFeed.displayName, 12);
      const userTabHTML = `
        <button id="user-tab-${this.currentUserFeed.pubkey}" class="toggle-btn user-tab active" data-pubkey="${this.currentUserFeed.pubkey}" title="@${this.currentUserFeed.displayName}">
          @${truncatedDisplayName}
        </button>
      `;
      
      // Insert at the end of feed toggle
      const feedToggle = document.querySelector('.feed-toggle');
      feedToggle.insertAdjacentHTML('beforeend', userTabHTML);
      
      // Add event listener for user tab click
      const userTab = document.getElementById(`user-tab-${this.currentUserFeed.pubkey}`);
      
      // Tab click handler (refresh user feed when clicked)
      userTab.addEventListener('click', (e) => {
        console.log('👤 User tab clicked - refreshing user feed');
        e.preventDefault();
        // Refresh the current user feed
        this.refreshFeed();
      });
      
      // Note: Active state management is now handled by switchFeed() function
      
    } else {
      // Regular feed toggle behavior - ensure correct button is active
      document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
      const activeFeedBtn = document.getElementById(`${this.currentFeed}-feed-btn`);
      if (activeFeedBtn) {
        activeFeedBtn.classList.add('active');
      }
    }
  }
  
  loadUserFeed(pubkey) {
    console.log('📊 Loading user feed for:', pubkey.substring(0, 16) + '...');
    
    // Clear existing feed to ensure clean user feed
    document.getElementById('feed').innerHTML = '';
    this.showLoading();
    
    // Clear existing subscriptions
    this.subscriptions.forEach((sub, id) => {
      this.relayConnections.forEach(ws => {
        ws.send(JSON.stringify(['CLOSE', id]));
      });
    });
    this.subscriptions.clear();
    
    // Create user feed subscription
    const subId = `user-feed-${Date.now()}`;
    const baseFilter = {
      kinds: [1], // Text notes only
      authors: [pubkey],
      limit: 50
    };
    
    // Add until timestamp for pagination if we have it
    if (this.oldestNoteTimestamp) {
      baseFilter.until = this.oldestNoteTimestamp - 1;
    }
    
    const filter = baseFilter;
    
    const subscription = ['REQ', subId, filter];
    this.subscriptions.set(subId, subscription);
    
    // Real-time subscription for new posts
    const realtimeSubId = `user-realtime-${Date.now()}`;
    const realtimeFilter = {
      ...filter,
      since: Math.floor(Date.now() / 1000),
      limit: undefined
    };
    const realtimeSubscription = ['REQ', realtimeSubId, realtimeFilter];
    this.subscriptions.set(realtimeSubId, realtimeSubscription);
    
    console.log('📤 User feed subscription:', JSON.stringify(subscription));
    
    let sentToRelays = 0;
    this.relayConnections.forEach((ws, relay) => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log('📡 Sending user subscription to:', relay);
        ws.send(JSON.stringify(subscription));
        ws.send(JSON.stringify(realtimeSubscription));
        sentToRelays++;
      }
    });
    
    console.log('📡 User feed sent to', sentToRelays, 'relays');
    
    // Hide loading after timeout
    setTimeout(() => {
      if (this.currentFeed === 'user-feed') {
        this.hideLoading();
      }
    }, 5000);
  }
  
  switchToUserFeed(pubkey) {
    this.currentFeed = 'user-feed';
    this.currentUserFeed = { pubkey: pubkey };
    this.updateFeedToggle();
    this.loadUserFeed(pubkey);
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
    document.getElementById('load-more-container').classList.remove('show');
  }
  
  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
    // Show load more button if we have content and might have more
    console.log('🔄 Hide loading - feedHasMore:', this.feedHasMore, 'notes count:', this.notes.size);
    if (this.feedHasMore && this.notes.size > 0) {
      console.log('📄 Showing Load More button');
      document.getElementById('load-more-container').classList.add('show');
    } else {
      console.log('📄 Load More button hidden - feedHasMore:', this.feedHasMore, 'notes:', this.notes.size);
      document.getElementById('load-more-container').classList.remove('show');
    }
  }
  
  showError() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error').classList.remove('hidden');
    document.getElementById('load-more-container').classList.remove('show');
  }
  
  updateCharCount() {
    const textarea = document.getElementById('compose-text');
    const counter = document.getElementById('char-count');
    const postBtn = document.getElementById('post-btn');
    
    const remaining = 2100 - textarea.value.length;
    
    // Only show counter when approaching limit (under 200 characters remaining)
    if (remaining < 200) {
      counter.textContent = remaining;
      counter.style.display = 'block';
      
      counter.className = 'char-count';
      if (remaining < 50) counter.classList.add('warning');
      if (remaining < 0) counter.classList.add('error');
    } else {
      counter.style.display = 'none';
    }
    
    postBtn.disabled = remaining < 0 || textarea.value.trim().length === 0;
  }
  
  updateReplyCharCount() {
    const textarea = document.getElementById('reply-text');
    const counter = document.getElementById('reply-char-count');
    const replyBtn = document.getElementById('send-reply-btn');
    
    const remaining = 2100 - textarea.value.length;
    
    // Only show counter when approaching limit (under 200 characters remaining)
    if (remaining < 200) {
      counter.textContent = remaining;
      counter.style.display = 'block';
      
      counter.className = 'char-count';
      if (remaining < 50) counter.classList.add('warning');
      if (remaining < 0) counter.classList.add('error');
    } else {
      counter.style.display = 'none';
    }
    
    replyBtn.disabled = remaining < 0 || textarea.value.trim().length === 0;
  }
  
  async publishNote() {
    if (!this.currentUser) {
      alert('Please sign in to post');
      return;
    }
    
    const content = document.getElementById('compose-text').value.trim();
    if (!content) return;
    
    try {
      const event = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: content,
        pubkey: this.currentUser.publicKey
      };
      
      const signedEvent = await this.signEvent(event);
      await this.publishEvent(signedEvent);
      
      // Clear compose area
      document.getElementById('compose-text').value = '';
      this.updateCharCount();
      
      // Add to feed
      this.handleNote(signedEvent);
      
      // Hide compose section after posting
      this.hideComposeSection();
    } catch (error) {
      console.error('Publish error:', error);
      alert('Failed to publish note');
    }
  }
  
  showComposeSection() {
    const composeSection = document.getElementById('compose-section');
    const floatingBtn = document.getElementById('floating-compose-btn');
    
    composeSection.classList.remove('hidden');
    floatingBtn.classList.add('hidden');
    
    // Focus on textarea
    setTimeout(() => {
      document.getElementById('compose-text').focus();
    }, 100);
  }
  
  hideComposeSection() {
    const composeSection = document.getElementById('compose-section');
    const floatingBtn = document.getElementById('floating-compose-btn');
    
    composeSection.classList.add('hidden');
    if (this.currentUser) {
      floatingBtn.classList.remove('hidden');
    }
    
    // Clear compose text
    document.getElementById('compose-text').value = '';
    this.updateCharCount();
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
  
  fetchContactList() {
    if (!this.currentUser) {
      console.log('❌ Cannot fetch contact list: no current user');
      return;
    }
    
    console.log('📋 === FETCHING CONTACT LIST ===');
    console.log('User pubkey:', this.currentUser.publicKey);
    console.log('Relay connections available:', this.relayConnections.size);
    
    const subId = 'contacts-' + Date.now();
    const filter = {
      kinds: [3],
      authors: [this.currentUser.publicKey],
      limit: 1
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
  
  showReplyModal(replyToEvent) {
    this.replyToEvent = replyToEvent;
    
    const modal = document.getElementById('reply-modal');
    const context = document.getElementById('reply-to-note');
    
    const formattedContent = this.formatNoteContent(replyToEvent.content);
    context.innerHTML = `
      <div class="note-author">${this.getAuthorName(replyToEvent.pubkey)}</div>
      <div class="note-content">
        ${formattedContent.text}
        ${formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, replyToEvent.id, replyToEvent.pubkey) : ''}
      </div>
    `;
    
    document.getElementById('reply-text').value = '';
    this.updateReplyCharCount();
    
    modal.classList.remove('hidden');
  }
  
  async sendReply() {
    if (!this.currentUser || !this.replyToEvent) return;
    
    const content = document.getElementById('reply-text').value.trim();
    if (!content) return;
    
    try {
      // Build NIP-10 compliant tags
      const tags = this.buildReplyTags(this.replyToEvent);
      console.log('Built reply tags:', tags);
      
      const event = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: content,
        pubkey: this.currentUser.publicKey
      };
      
      console.log('Event before signing:', event);
      
      const signedEvent = await this.signEvent(event);
      console.log('Signed event:', signedEvent);
      await this.publishEvent(signedEvent);
      
      this.hideModal('reply-modal');
      this.handleNote(signedEvent);
    } catch (error) {
      console.error('Reply error:', error);
      alert('Failed to send reply');
    }
  }
  
  
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
  }
  
  handleMenuAction(action, event) {
    switch (action) {
      case 'open-note':
        const noteId = window.NostrTools.nip19.noteEncode(event.id);
        const url = `https://jumble.social/notes/${noteId}`;
        window.open(url, '_blank');
        break;
      case 'copy-note-id':
        const formattedNoteId = window.NostrTools.nip19.noteEncode(event.id);
        this.copyToClipboard(formattedNoteId, 'Note ID copied to clipboard');
        break;
      case 'copy-note-text':
        this.copyToClipboard(event.content, 'Note text copied to clipboard');
        break;
      case 'copy-raw-data':
        this.copyToClipboard(JSON.stringify(event, null, 2), 'Raw note data copied to clipboard');
        break;
      case 'copy-pubkey':
        const npub = window.NostrTools.nip19.npubEncode(event.pubkey);
        this.copyToClipboard(npub, 'Author\'s key copied to clipboard');
        break;
      case 'view-user-profile':
        const userNpub = window.NostrTools.nip19.npubEncode(event.pubkey);
        const profileUrl = `https://jumble.social/users/${userNpub}`;
        window.open(profileUrl, '_blank');
        break;
    }
  }
  
  async copyToClipboard(text, successMessage) {
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
        e.preventDefault();
        e.stopPropagation(); // Prevent note click
        const pubkey = event.pubkey;
        const npub = window.NostrTools.nip19.npubEncode(pubkey);
        console.log('🔓 Opening user feed for:', pubkey.substring(0, 16) + '...');
        this.openUserFeed(pubkey, npub);
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
        e.stopPropagation(); // Prevent note click
        const noteId = window.NostrTools.nip19.noteEncode(event.id);
        const noteUrl = `https://jumble.social/notes/${noteId}`;
        window.open(noteUrl, '_blank');
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
              window.open(noteUrl, '_blank');
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
            window.open(noteUrl, '_blank');
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
    const buttons = eventElement.querySelectorAll(':scope > .note-actions > .reaction-action, :scope > .reply-actions > .reaction-reply-action');
    buttons.forEach(button => {
      // Update button to show the emoji that was used
      button.innerHTML = emoji;
      
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
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 DOM LOADED - Initializing SidecarApp!');
  window.sidecarApp = new SidecarApp();
});