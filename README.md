# Sidecar 🍸

**A Classy Nostr Signer.**

A NIP-07 nostr signing extension that lives in your browser's side panel. Sidecar
holds your keys locally — encrypted behind a PIN — and provides `window.nostr` to the
web apps you use, so you can sign in and sign events across nostr clients without
pasting your nsec anywhere.

## Features

- **Multiple accounts** — store as many nsecs as you like, switch the active one in a click.
- **PIN-protected** — every private key is encrypted at rest (PBKDF2 → AES-GCM, WebCrypto). Nothing is stored in plaintext, and the keystore re-locks automatically.
- **In-extension signing** — implements the full NIP-07 surface: `getPublicKey`, `signEvent`, `nip04`/`nip44` encrypt & decrypt, and `getRelays`.
- **Per-site permissions** — approve or reject each site, per method, with a clear prompt that previews what you're signing.
- **Identity from your profile** — account names and avatars are imported from your kind 0 metadata.

### Coming next

- **Lightning wallet** — pay and receive over WebLN, backed by Nostr Wallet Connect (NIP-47).
- **Profile management** — view, edit, and back up your profile, follows, and lists.

## Install (developer / unpacked)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Click the Sidecar toolbar icon to open the side panel, set a PIN, and add an account.

## Architecture

No build step — plain JavaScript loaded directly.

| Area | Files |
|------|-------|
| Service worker (RPC router, permissions, prompt orchestration, auto-lock) | `background.js` |
| Page bridge | `content.js`, `nostr-provider.js` |
| Crypto & keystore | `crypto.js`, `keystore.js`, `permissions.js`, `signer.js` |
| Approval prompt | `prompt.html`, `prompt.js` |
| Side panel UI | `sidepanel.html`, `sidepanel.js`, `styles.css`, `fonts.css` |
| Vendored | `nostr-tools.js`, `qrious.min.js`, `fonts/` (Playfair Display + Manrope, SIL OFL) |

## License

MIT. Bundled fonts are licensed under the SIL Open Font License (see `fonts/`).
