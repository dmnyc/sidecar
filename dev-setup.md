# Development Setup for Sidecar

## Quick Start

1. **Load Extension in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Toggle "Developer mode" ON (top right)
   - Click "Load unpacked"
   - Select the `sidecar` folder
   - The extension should now appear in your extensions list

2. **Test the Extension**:
   - Click the Sidecar extension icon in your toolbar
   - The sidebar should open with the Nostr feed interface
   - Try signing in with generated keys or NIP-07

3. **Development Workflow**:
   - Make changes to the code
   - Go to `chrome://extensions/`
   - Click the refresh icon on the Sidecar extension
   - Test your changes

## Creating Icons

The extension needs icon files. To create them:

1. Open `icons/create_icons.html` in a browser
2. It will automatically generate and download the required icon files
3. Place them in the `icons/` directory:
   - `icon16.png`
   - `icon32.png` 
   - `icon48.png`
   - `icon128.png`

## Testing NIP-07 Integration

To test NIP-07 functionality:

1. Install Alby extension from Chrome Web Store
2. Set up your Alby wallet
3. In Sidecar, click "Use Browser Extension" when signing in
4. Grant permissions when prompted

## Debugging

### Chrome DevTools
- Right-click in the sidebar → "Inspect" to open DevTools for the sidepanel
- Check Console for JavaScript errors
- Use Network tab to monitor WebSocket connections to Nostr relays

### Background Script Debugging
- Go to `chrome://extensions/`
- Click "Inspect views: service worker" under Sidecar
- This opens DevTools for the background script

### Common Issues

1. **WebSocket Connection Errors**:
   - Check if relay URLs are accessible
   - Some networks block WebSocket connections
   - Try different relays

2. **NIP-07 Not Working**:
   - Ensure Alby or nos2x is installed and configured
   - Check browser permissions
   - Look for errors in both extension consoles

3. **Keys Not Persisting**:
   - Check Chrome storage in DevTools → Application → Storage
   - Ensure extension has storage permissions

## Production Improvements

For a production version, consider:

1. **Replace Crypto Implementation**:
   ```bash
   npm install nostr-tools
   # Bundle for browser use with webpack/rollup
   ```

2. **Add Build Process**:
   - TypeScript compilation
   - CSS preprocessing
   - Asset optimization
   - Code minification

3. **Enhanced Security**:
   - Encrypt stored private keys
   - Implement key derivation
   - Add PIN protection

4. **Better UX**:
   - Profile picture caching
   - Rich text formatting
   - Image/video support
   - Notification system

## File Structure

```
sidecar/
├── manifest.json          # Extension configuration
├── sidepanel.html         # Main UI
├── sidepanel.js          # Core logic
├── styles.css            # Styling
├── background.js         # Service worker
├── content.js           # Content script
├── injected.js          # Page context script
├── nostr-tools.js       # Minimal Nostr implementation
├── package.json         # Dependencies
├── README.md           # Documentation
├── dev-setup.md        # This file
└── icons/              # Extension icons
    ├── create_icons.html
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Next Steps

1. Test basic functionality
2. Generate proper icons
3. Test with real Nostr accounts
4. Implement missing features
5. Add proper cryptography
6. Optimize performance
7. Publish to Chrome Web Store