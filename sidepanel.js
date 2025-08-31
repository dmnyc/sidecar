// Main sidepanel script for Sidecar Nostr extension
console.log('🟢 SIDEPANEL.JS SCRIPT LOADED!');

class SidecarApp {
  constructor() {
    console.log('🏗️ SIDECAR APP CONSTRUCTOR CALLED');
    this.currentUser = null;
    this.currentFeed = 'trending';
    console.log('📝 Initial feed set to:', this.currentFeed);
    this.relays = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://nostr.wine'
    ];
    this.relayConnections = new Map();
    this.subscriptions = new Map();
    this.notes = new Map();
    this.userReactions = new Set(); // Track events user has already reacted to
    this.profiles = new Map(); // Cache for user profiles (pubkey -> profile data)
    this.profileRequests = new Set(); // Track pending profile requests
    this.profileNotFound = new Set(); // Track pubkeys that don't have profiles
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
    document.getElementById('cancel-compose-btn').addEventListener('click', () => this.hideComposeSection());
    
    // Reply modal
    document.getElementById('close-reply-modal').addEventListener('click', () => this.hideModal('reply-modal'));
    document.getElementById('cancel-reply-btn').addEventListener('click', () => this.hideModal('reply-modal'));
    document.getElementById('send-reply-btn').addEventListener('click', () => this.sendReply());
    document.getElementById('reply-text').addEventListener('input', this.updateReplyCharCount.bind(this));
    
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
    
    // Reload feed button (replaces Load More button)
    document.getElementById('reload-feed-btn').addEventListener('click', () => this.loadFeed());
    
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
  
  handleNote(event) {
    // Handle different event kinds
    if (event.kind === 1) {
      // Text notes
      
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
    
    // Determine delay based on whether we have the profile
    const hasProfile = this.profiles.has(event.pubkey);
    const baseDelay = hasProfile ? 50 : 300; // 50ms if profile cached, 300ms if not
    
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
  
  handleProfile(event) {
    try {
      const profile = JSON.parse(event.content);
      
      this.profiles.set(event.pubkey, {
        ...profile,
        updatedAt: event.created_at
      });
      
      // Remove from pending sets since we got the profile
      this.profileRequests.delete(event.pubkey);
      
      // Update any displayed notes from this author (including quoted notes)
      this.updateAuthorDisplay(event.pubkey);
      
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
        kinds: [1],
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
        kinds: [1],
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
        kinds: [1],
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
            kinds: [1],
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
        
      }, 5000); // Give 5 seconds for notes to arrive
      
    } catch (error) {
      console.error('❌ Error loading Me feed:', error);
      this.hideLoading();
      
      document.getElementById('feed').innerHTML = `
        <div style="text-align: center; padding: 40px; color: #888;">
          <h3>Error loading your notes</h3>
          <p>Error loading Me feed</p>
          <p style="font-size: 12px; color: #888;">${error.message}</p>
          <button class="retry-me-btn" style="margin-top: 16px; padding: 8px 16px; background: #ea6390; color: white; border: none; border-radius: 6px; cursor: pointer;">Try Again</button>
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
          kinds: [1],
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
              <p style="margin-bottom: 8px; color: #ea6390; font-weight: bold;">The trending data service is currently offline.</p>
              <p style="margin-bottom: 24px; color: #a78bfa;">Please try again later${this.currentUser ? ' or switch to Following feed' : ''}.</p>
              <div style="display: flex; justify-content: center; gap: 12px;">
                <button class="retry-trending-btn" style="padding: 12px 24px; background: #ea6390; color: white; border: none; border-radius: 8px; cursor: pointer;">Try Again</button>
                ${this.currentUser ? '<button class="switch-to-following-btn" style="padding: 12px 24px; background: #a78bfa; color: white; border: none; border-radius: 8px; cursor: pointer;">Go to Following</button>' : ''}
              </div>
            </div>
          `;
          
        } else {
          // Some API calls succeeded but returned no data
          document.getElementById('feed').innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #ea6390;">
              <p>No trending notes available right now.</p>
              <p>Try refreshing or check back later!</p>
              <button class="retry-trending-btn" style="margin-top: 16px; padding: 8px 16px; background: #ea6390; color: white; border: none; border-radius: 6px; cursor: pointer;">Try Again</button>
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
          <p style="margin-bottom: 8px; color: #ea6390; font-weight: bold;">The trending data service is currently offline.</p>
          <p style="margin-bottom: 24px; color: #a78bfa;">Please try again later${this.currentUser ? ' or switch to Following feed' : ''}.</p>
          <div style="display: flex; justify-content: center; gap: 12px;">
            <button class="retry-trending-btn" style="padding: 12px 24px; background: #ea6390; color: white; border: none; border-radius: 8px; cursor: pointer;">Try Again</button>
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
    // Safety check: Don't display notes from other users in Me feed
    if (this.currentFeed === 'me' && this.currentUser && event.pubkey !== this.currentUser.publicKey) {
      console.log('🚨 SAFETY: Prevented display of other user note in Me feed:', event.pubkey.substring(0, 16) + '...');
      return;
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
        </div>
        <div class="note-action reaction-action" data-event-id="${event.id}">
          <svg width="18" height="16" viewBox="0 0 23 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.18607 11.8832C9.51685 11.8832 9.79674 11.7814 10.0766 11.6033L13.1809 9.49142C13.9187 8.98253 14.1223 7.96475 13.6134 7.25231C13.1045 6.51442 12.0867 6.31086 11.3743 6.81975L8.29552 8.9062C7.55763 9.41509 7.35407 10.4329 7.86296 11.1453C8.16829 11.6288 8.67718 11.8832 9.18607 11.8832Z" fill="currentColor"/>
            <path d="M6.61619 9.28787C6.94697 9.28787 7.22686 9.18609 7.53219 9.00798L10.5855 6.92153C11.3234 6.41264 11.5015 5.39486 11.0181 4.68241C10.5092 3.94452 9.49142 3.76641 8.77897 4.24986L5.72563 6.33631C4.98774 6.84519 4.80963 7.86298 5.29308 8.57542C5.59841 9.03342 6.08186 9.28787 6.61619 9.28787Z" fill="currentColor"/>
            <path d="M11.756 14.4531C12.0868 14.4531 12.3666 14.3513 12.6465 14.1732L15.7253 12.0868C16.4632 11.5779 16.6668 10.5601 16.1579 9.84765C15.649 9.10976 14.6312 8.9062 13.9188 9.41509L10.84 11.4761C10.1021 11.985 9.89853 13.0028 10.4074 13.7152C10.7382 14.1987 11.2471 14.4531 11.756 14.4531Z" fill="currentColor"/>
            <path d="M8.42276 20C10.3311 20 12.2903 19.3639 13.8679 18.0917C14.4531 17.6082 15.191 17.1248 16.107 16.5395L22.1119 12.7992C22.8752 12.3158 23.1042 11.3234 22.6462 10.5601C22.1882 9.79676 21.1705 9.56776 20.4071 10.0258L14.4022 13.7661C13.3844 14.3768 12.5448 14.962 11.8069 15.5218C9.74588 17.1757 6.81976 17.1502 4.93687 15.42C3.53742 14.1223 3.00309 12.1377 3.51198 10.3056C4.50431 6.6162 4.37709 3.76641 3.07942 0.942077C2.69775 0.127853 1.73086 -0.228369 0.942084 0.153298C0.127861 0.534965 -0.228362 1.50186 0.153305 2.29063C1.1202 4.37708 1.17108 6.48898 0.40775 9.41509C-0.431918 12.4175 0.45864 15.6235 2.74864 17.7609C4.35165 19.2367 6.36176 20 8.42276 20Z" fill="currentColor"/>
          </svg>
        </div>
      </div>
    `;
    
    // Add event listeners
    this.setupReactionButton(noteDiv.querySelector('.reaction-action'), event);
    this.setupReplyButton(noteDiv.querySelector('.reply-action'), event);
    this.setupNoteMenu(noteDiv.querySelector('.note-menu'), event);
    this.setupClickableLinks(noteDiv, event);
    
    // Add click-to-expand/open functionality for note content
    this.setupNoteContentClick(noteDiv, event);
    
    return noteDiv;
  }
  
  setupReplyButton(button, event) {
    if (!button) return;
    
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('💬 Reply button clicked for note:', event.id.substring(0, 16) + '...');
      this.showReplyModal(event);
    });
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
    
    // Clear reply text
    const replyText = document.getElementById('reply-text');
    replyText.value = '';
    document.getElementById('reply-char-count').textContent = '2100';
    document.getElementById('send-reply-btn').disabled = true;
    
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
    charCount.style.color = remaining < 100 ? '#ea6390' : '#9e4280';
    
    sendBtn.disabled = replyText.value.trim().length === 0 || remaining < 0;
  }

  async sendReply() {
    if (!this.currentUser || !this.replyingToEvent) return;
    
    const replyText = document.getElementById('reply-text').value.trim();
    if (!replyText) return;
    
    console.log('💬 Sending reply:', replyText.substring(0, 50) + '...');
    console.log('💬 Replying to:', this.replyingToEvent.id.substring(0, 16) + '...');
    
    const event = {
      kind: 1,
      content: replyText,
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
      
      // Optional: Show success message
      // You could add a toast notification here
      
    } catch (error) {
      console.error('❌ Failed to send reply:', error);
      alert('Failed to send reply. Please try again.');
    }
  }

  
  getAuthorName(pubkey) {
    const profile = this.profiles.get(pubkey);
    if (profile && (profile.display_name || profile.name)) {
      return (profile.display_name || profile.name).trim();
    }
    
    // If no profile available and we haven't tried yet or marked as not found, request it
    if (!profile && !this.profileRequests.has(pubkey) && !this.profileNotFound.has(pubkey)) {
      this.requestProfile(pubkey);
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
        quotedHTML += `<div id="${uniqueId}" class="quoted-note error" style="cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px 12px; min-height: 60px; color: #c4b5fd;" data-note-id="${quoted.eventId}">
          <span>Unable to display quoted content</span>
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
        <div id="${uniqueId}" class="quoted-note error" style="cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px 12px; min-height: 60px;">
          <span>Unable to display quoted content</span>
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
        
        // Remove any remaining loading placeholders for this event
        const stillLoadingPlaceholders = document.querySelectorAll(`.quoted-note.loading[data-event-id="${quotedNote.eventId}"]`);
        console.log(`🧹 Removing ${stillLoadingPlaceholders.length} unfound quoted note placeholders for:`, quotedNote.eventId.substring(0, 16) + '...');
        stillLoadingPlaceholders.forEach(placeholder => {
          placeholder.remove();
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
  
  // updateReplyCharCount removed - replies no longer supported
  
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
        tags: [
          ['client', 'sidecar', 'https://github.com/dmnyc/sidecar', 'wss://relay.damus.io']
        ],
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
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 DOM LOADED - Initializing SidecarApp!');
  window.sidecarApp = new SidecarApp();
});