# Sidecar - Nostr Feed Chrome Extension

A lightweight Nostr client that lives in your browser sidebar, allowing you to browse and interact with the Nostr network without leaving your current page.

## Features

- **Browse Nostr feeds** - View global feed or your home timeline
- **Multiple authentication methods**:
  - Generate new Nostr keys
  - Import existing private keys (nsec/hex)
  - Use NIP-07 browser extensions (Alby, nos2x)
- **Post and interact** - Create notes, reply to posts, and like content
- **Non-custodial** - Your keys stay in your browser or extension
- **Real-time updates** - Connect to multiple Nostr relays

## Installation

### Development Setup

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `sidecar` directory
5. The extension will appear in your extensions list

### Using the Extension

1. Click the Sidecar extension icon in your toolbar
2. The sidebar will open with the Nostr feed
3. Sign in with existing keys or generate new ones
4. Browse the global feed or switch to your home timeline when signed in

## Architecture

### Files Structure

- `manifest.json` - Extension configuration
- `sidepanel.html` - Main UI for the sidebar
- `sidepanel.js` - Core application logic
- `styles.css` - UI styling
- `background.js` - Service worker for extension functionality
- `content.js` - Content script for NIP-07 communication
- `injected.js` - Injected script to access window.nostr
- `nostr-tools.js` - Minimal Nostr protocol implementation

### Key Features

#### Authentication
- **NIP-07 Integration**: Seamlessly works with Alby and nos2x extensions
- **Key Generation**: Create new Nostr identities securely
- **Key Import**: Support for nsec and hex private key formats
- **Secure Storage**: Keys stored locally in browser extension storage

#### Nostr Protocol
- **Multi-relay Support**: Connects to multiple Nostr relays for redundancy
- **Real-time Updates**: WebSocket connections for live feed updates
- **Event Signing**: Support for both local signing and NIP-07 delegation
- **Feed Management**: Global feed from popular accounts, home feed from follows

#### User Interface
- **Sidebar Design**: Optimized for narrow sidebar viewing
- **Responsive Layout**: Works well in different sidebar widths
- **Modal Dialogs**: Clean authentication and reply interfaces
- **Real-time Feedback**: Loading states, character counts, error handling

## Security Considerations

- Private keys are stored in Chrome's extension storage (encrypted in production)
- NIP-07 integration allows using hardware wallets through compatible extensions
- No private keys are transmitted over the network
- Users can delete stored keys at any time

## Development Notes

### Current Limitations

1. **Simplified Cryptography**: The current `nostr-tools.js` is a minimal implementation for demonstration. In production, use the full nostr-tools library or similar.

2. **Basic Profile Handling**: Currently shows truncated pubkeys instead of profile names. Profile metadata fetching should be implemented.

3. **Limited Feed Algorithm**: Global feed uses hardcoded popular pubkeys. Should integrate with following.space or similar services.

4. **No Media Support**: Currently only supports text notes. Image/video embedding should be added.

### Production Improvements Needed

1. **Real Cryptography**: Implement proper secp256k1 signing
2. **Profile Metadata**: Fetch and cache user profiles (kind 0 events)
3. **Follow Lists**: Implement proper follow list management (kind 3 events)
4. **Media Handling**: Support for images, videos, and other media
5. **Notification System**: Desktop notifications for mentions and replies
6. **Relay Management**: User-configurable relay lists
7. **Performance**: Event deduplication, pagination, and caching
8. **Accessibility**: Screen reader support and keyboard navigation

### Adding Real Cryptography

To use real cryptography, replace the `nostr-tools.js` file with the actual nostr-tools library:

```bash
npm install nostr-tools
# Then bundle for browser use
```

Or include it via CDN in the HTML:

```html
<script src="https://unpkg.com/nostr-tools/lib/nostr.bundle.js"></script>
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test the extension thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Relays Used

Default relays (configurable in future versions):
- wss://relay.damus.io
- wss://nos.lol
- wss://relay.snort.social
- wss://relay.nostr.band
- wss://nostr.wine

## Support

For issues and feature requests, please use the GitHub issue tracker.