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
    this.globalFeedPubkeys = []; // Popular pubkeys for global feed
    
    this.init();
  }
  
  async init() {
    this.setupEventListeners();
    await this.checkAuthState();
    await this.loadGlobalFeedPubkeys();
    this.connectToRelays();
    this.loadFeed();
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
    this.loadFeed();
  }
  
  connectToRelays() {
    this.relays.forEach(relay => {
      try {
        const ws = new WebSocket(relay);
        
        ws.onopen = () => {
          console.log(`Connected to ${relay}`);
          this.relayConnections.set(relay, ws);
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
    }
  }
  
  handleNote(event) {
    // Only handle text notes (kind 1)
    if (event.kind !== 1) return;
    
    // Avoid duplicates
    if (this.notes.has(event.id)) return;
    
    this.notes.set(event.id, event);
    this.displayNote(event);
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
  }
  
  createNoteElement(event) {
    const noteDiv = document.createElement('div');
    noteDiv.className = 'note';
    noteDiv.dataset.eventId = event.id;
    noteDiv.dataset.timestamp = event.created_at;
    
    const authorName = this.getAuthorName(event.pubkey);
    const npub = window.NostrTools.nip19.npubEncode(event.pubkey);
    const timeAgo = this.formatTimeAgo(event.created_at);
    
    noteDiv.innerHTML = `
      <div class="note-header">
        <span class="note-author">${authorName}</span>
        <span class="note-npub">${npub.substring(0, 16)}...</span>
        <span class="note-time">${timeAgo}</span>
      </div>
      <div class="note-content">${this.formatNoteContent(event.content)}</div>
      <div class="note-actions">
        <div class="note-action reply-action" data-event-id="${event.id}">
          💬 Reply
        </div>
        <div class="note-action like-action" data-event-id="${event.id}">
          ❤️ Like
        </div>
      </div>
    `;
    
    // Add event listeners
    noteDiv.querySelector('.reply-action').addEventListener('click', () => this.showReplyModal(event));
    noteDiv.querySelector('.like-action').addEventListener('click', () => this.likeNote(event));
    
    return noteDiv;
  }
  
  getAuthorName(pubkey) {
    // This would normally fetch from user profiles
    // For now, return truncated pubkey
    return pubkey.substring(0, 8) + '...';
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
    // Basic content formatting
    return content
      .replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
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
    
    const remaining = 280 - textarea.value.length;
    counter.textContent = remaining;
    
    counter.className = 'char-count';
    if (remaining < 20) counter.classList.add('warning');
    if (remaining < 0) counter.classList.add('error');
    
    postBtn.disabled = remaining < 0 || textarea.value.trim().length === 0;
  }
  
  updateReplyCharCount() {
    const textarea = document.getElementById('reply-text');
    const counter = document.getElementById('reply-char-count');
    const replyBtn = document.getElementById('send-reply-btn');
    
    const remaining = 280 - textarea.value.length;
    counter.textContent = remaining;
    
    counter.className = 'char-count';
    if (remaining < 20) counter.classList.add('warning');
    if (remaining < 0) counter.classList.add('error');
    
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
    
    context.innerHTML = `
      <div class="note-author">${this.getAuthorName(replyToEvent.pubkey)}</div>
      <div class="note-content">${this.formatNoteContent(replyToEvent.content)}</div>
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
      const event = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', this.replyToEvent.id],
          ['p', this.replyToEvent.pubkey]
        ],
        content: content,
        pubkey: this.currentUser.publicKey
      };
      
      const signedEvent = await this.signEvent(event);
      await this.publishEvent(signedEvent);
      
      this.hideModal('reply-modal');
      this.handleNote(signedEvent);
    } catch (error) {
      console.error('Reply error:', error);
      alert('Failed to send reply');
    }
  }
  
  async likeNote(event) {
    if (!this.currentUser) {
      alert('Please sign in to like notes');
      return;
    }
    
    try {
      const likeEvent = {
        kind: 7,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', event.id],
          ['p', event.pubkey]
        ],
        content: '+',
        pubkey: this.currentUser.publicKey
      };
      
      const signedEvent = await this.signEvent(likeEvent);
      await this.publishEvent(signedEvent);
      
      // Update UI
      const likeBtn = document.querySelector(`[data-event-id="${event.id}"] .like-action`);
      if (likeBtn) {
        likeBtn.classList.add('liked');
        likeBtn.textContent = '❤️ Liked';
      }
    } catch (error) {
      console.error('Like error:', error);
      alert('Failed to like note');
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
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SidecarApp();
});