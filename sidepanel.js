// Main sidepanel script for Sidecar Nostr extension

class SidecarApp {
  constructor() {
    this.currentUser = null;
    this.currentFeed = 'global';
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
    this.globalFeedPubkeys = []; // Popular pubkeys for global feed
    this.initialFeedLoaded = false; // Track if initial feed has been loaded
    
    this.init();
  }
  
  async init() {
    this.setupEventListeners();
    await this.checkAuthState();
    await this.loadGlobalFeedPubkeys();
    this.connectToRelays();
    // loadFeed() will be called automatically when first relay connects
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
    document.getElementById('global-feed-btn').addEventListener('click', () => this.switchFeed('global'));
    document.getElementById('home-feed-btn').addEventListener('click', () => this.switchFeed('home'));
    
    // Compose
    document.getElementById('compose-text').addEventListener('input', this.updateCharCount);
    document.getElementById('post-btn').addEventListener('click', () => this.publishNote());
    
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
    
    // Generate keys when modal opens
    this.generateNewKeys();
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
      }
    } catch (error) {
      console.error('Error checking auth state:', error);
    }
  }
  
  async loadGlobalFeedPubkeys() {
    // For now, use a hardcoded list of popular pubkeys
    // In production, this could be fetched from following.space or similar
    this.globalFeedPubkeys = [
      // Add some popular Nostr pubkeys here
      // These are example pubkeys - replace with real ones
      '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
      '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9'
    ];
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
      } else {
        alert('Failed to save keys: ' + response.error);
      }
    } catch (error) {
      console.error('Save keys error:', error);
      alert('Error saving keys');
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
    const composeSection = document.getElementById('compose-section');
    const homeFeedBtn = document.getElementById('home-feed-btn');
    
    if (this.currentUser) {
      signedOut.classList.add('hidden');
      signedIn.classList.remove('hidden');
      composeSection.classList.remove('hidden');
      homeFeedBtn.disabled = false;
      
      // Update user info
      const npub = window.NostrTools.nip19.npubEncode(this.currentUser.publicKey);
      document.getElementById('user-name').textContent = this.getUserDisplayName();
      document.getElementById('user-npub').textContent = npub.substring(0, 16) + '...';
    } else {
      signedOut.classList.remove('hidden');
      signedIn.classList.add('hidden');
      composeSection.classList.add('hidden');
      homeFeedBtn.disabled = true;
      
      // Switch to global feed if on home
      if (this.currentFeed === 'home') {
        this.switchFeed('global');
      }
    }
  }
  
  getUserDisplayName() {
    // This would normally fetch from user's profile
    // For now, return a truncated pubkey
    return this.currentUser.publicKey.substring(0, 8) + '...';
  }
  
  switchFeed(feedType) {
    this.currentFeed = feedType;
    
    // Update UI
    document.getElementById('global-feed-btn').classList.toggle('active', feedType === 'global');
    document.getElementById('home-feed-btn').classList.toggle('active', feedType === 'home');
    
    // Clear current feed and load new one
    document.getElementById('feed').innerHTML = '';
    this.notes.clear();
    this.threads.clear();
    this.noteParents.clear();
    this.orphanedReplies.clear();
    this.userReactions.clear();
    // Keep profiles cache - no need to refetch profile data
    
    // Mark as loaded since we're manually switching feeds
    this.initialFeedLoaded = true;
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
      this.hideLoading();
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
      
      this.notes.set(event.id, event);
      
      // Build thread relationships
      this.buildThreadRelationships(event);
      
      // Request profile for this author if we don't have it
      this.requestProfile(event.pubkey);
      
      // Display note (will handle threading)
      this.displayNote(event);
    } else if (event.kind === 0) {
      // Profile metadata
      this.handleProfile(event);
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
    } catch (error) {
      console.error('Error parsing profile:', error);
    }
  }
  
  requestProfile(pubkey) {
    // Don't request if we already have it or if request is pending
    if (this.profiles.has(pubkey) || this.profileRequests.has(pubkey)) {
      return;
    }
    
    // Mark as pending
    this.profileRequests.add(pubkey);
    
    // Create profile request subscription
    const subId = 'profile-' + pubkey;
    const subscription = ['REQ', subId, {
      kinds: [0],
      authors: [pubkey],
      limit: 1
    }];
    
    // Send to all connected relays
    this.relayConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscription));
      }
    });
    
    // Remove from pending after timeout
    setTimeout(() => {
      this.profileRequests.delete(pubkey);
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
          if (profile.nip05) {
            idElement.textContent = profile.nip05;
            idElement.setAttribute('data-nip05', 'true');
          } else {
            // Keep the truncated npub if no NIP-05
            idElement.textContent = window.NostrTools.nip19.npubEncode(pubkey).substring(0, 16) + '...';
            idElement.removeAttribute('data-nip05');
          }
        }
        
        if (avatarContainer && profile.picture) {
          // Update avatar if profile picture is available
          const authorName = profile.display_name || profile.name || this.getAuthorName(pubkey);
          avatarContainer.innerHTML = `
            <img src="${profile.picture}" alt="${authorName}" class="avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="avatar-placeholder" style="display: none;">${this.getAvatarPlaceholder(authorName)}</div>
          `;
        }
      }
    });
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
  
  loadFeed() {
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
    
    if (this.currentFeed === 'global') {
      // Global feed: recent notes from popular accounts
      filter = {
        kinds: [1],
        authors: this.globalFeedPubkeys,
        limit: 50,
        since: Math.floor(Date.now() / 1000) - (24 * 60 * 60) // Last 24 hours
      };
    } else if (this.currentFeed === 'home' && this.currentUser) {
      // Home feed: notes from followed accounts
      // For now, just show user's own notes
      filter = {
        kinds: [1],
        authors: [this.currentUser.publicKey],
        limit: 50
      };
    }
    
    if (filter) {
      const subscription = ['REQ', subId, filter];
      this.subscriptions.set(subId, subscription);
      
      this.relayConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(subscription));
        }
      });
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
    const authorId = profile?.nip05 || window.NostrTools.nip19.npubEncode(event.pubkey).substring(0, 16) + '...';
    const avatarUrl = profile?.picture;
    const timeAgo = this.formatTimeAgo(event.created_at);
    const formattedContent = this.formatNoteContent(event.content);
    
    noteDiv.innerHTML = `
      <div class="note-header">
        <div class="note-avatar" data-profile-link="${window.NostrTools.nip19.npubEncode(event.pubkey)}">
          ${avatarUrl ? 
            `<img src="${avatarUrl}" alt="${authorName}" class="avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
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
            <div class="menu-item" data-action="copy-pubkey">Copy Author's Key</div>
          </div>
        </div>
      </div>
      <div class="note-content">
        ${formattedContent.text}
        ${formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, event.id) : ''}
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
    const authorId = profile?.nip05 || window.NostrTools.nip19.npubEncode(event.pubkey).substring(0, 12) + '...';
    const avatarUrl = profile?.picture;
    const timeAgo = this.formatTimeAgo(event.created_at);
    const formattedContent = this.formatNoteContent(event.content);
    
    replyDiv.innerHTML = `
      <div class="reply-header">
        <div class="reply-avatar" data-profile-link="${window.NostrTools.nip19.npubEncode(event.pubkey)}">
          ${avatarUrl ? 
            `<img src="${avatarUrl}" alt="${authorName}" class="avatar-img small" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
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
          </div>
        </div>
      </div>
      <div class="reply-content">
        ${formattedContent.text}
        ${formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, event.id) : ''}
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
    // This would normally fetch from user profiles
    // For now, return truncated pubkey
    return pubkey.substring(0, 8) + '...';
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
  
  formatNoteContent(content) {
    // Extract image URLs (common image extensions)
    const imageRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?[^\s]*)?)/gi;
    const images = content.match(imageRegex) || [];
    
    // Remove image URLs from text content and format remaining text
    let textContent = content;
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
    
    return { text: textContent, images };
  }
  
  createImageGallery(images, eventId) {
    if (images.length === 0) return '';
    
    const galleryClass = images.length === 1 ? 'single-image' : 'multi-image';
    const maxDisplay = Math.min(images.length, 4); // Show max 4 images
    
    let galleryHTML = `<div class="image-gallery ${galleryClass}" data-event-id="${eventId}">`;
    
    for (let i = 0; i < maxDisplay; i++) {
      const imageUrl = images[i];
      
      if (i === 3 && images.length > 4) {
        // Show "+X more" overlay on 4th image if there are more
        const remaining = images.length - 3;
        galleryHTML += `
          <div class="image-container more-images" data-image-url="${imageUrl}">
            <img src="${imageUrl}" alt="Note image ${i + 1}" loading="lazy">
            <div class="image-overlay">+${remaining} more</div>
          </div>
        `;
      } else {
        galleryHTML += `
          <div class="image-container" data-image-url="${imageUrl}">
            <img src="${imageUrl}" alt="Note image ${i + 1}" loading="lazy">
          </div>
        `;
      }
    }
    
    galleryHTML += '</div>';
    return galleryHTML;
  }
  
  showLoading() {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('error').classList.add('hidden');
  }
  
  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
  }
  
  showError() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error').classList.remove('hidden');
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
    } catch (error) {
      console.error('Publish error:', error);
      alert('Failed to publish note');
    }
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
        ${formattedContent.images.length > 0 ? this.createImageGallery(formattedContent.images, replyToEvent.id) : ''}
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
    // Setup profile links
    const profileElements = element.querySelectorAll('[data-profile-link]');
    profileElements.forEach(profileElement => {
      profileElement.style.cursor = 'pointer';
      profileElement.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent note click
        const npub = window.NostrTools.nip19.npubEncode(event.pubkey);
        const profileUrl = `https://jumble.social/users/${npub}`;
        window.open(profileUrl, '_blank');
      });
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
    const imageContainers = element.querySelectorAll('.image-container');
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
  new SidecarApp();
});