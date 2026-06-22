# Sidecar 🍸

**A Classy Nostr Signer.**

A NIP-07 nostr signing extension that lives in your browser's side panel. Sidecar
holds your keys locally — encrypted behind a PIN — and provides `window.nostr` to the
web apps you use, so you can sign in and sign events across nostr clients without
pasting your nsec anywhere. It also has a built-in Lightning wallet (Nostr Wallet
Connect) for sending and receiving sats.

<img width="2816" height="1566" alt="Sidecar" src="https://i.nostr.build/Sr11DBpz7pVITHoS.png" />

## Features

- **Multiple accounts** — store as many nsecs as you like, drag to reorder, switch the active one in a click. Importing shows a profile preview (name + avatar) so you can confirm the right key before saving.
- **PIN-protected** — every private key is encrypted at rest (PBKDF2 → AES-GCM, WebCrypto). Nothing is stored in plaintext, and the keystore re-locks automatically. A paste guard blocks dropping an nsec anywhere except the import field.
- **In-extension signing** — implements the full NIP-07 surface: `getPublicKey`, `signEvent`, `nip04`/`nip44` encrypt & decrypt, and `getRelays`.
- **Per-site permissions** — approve or reject each site, per method, with a clear prompt that previews what you're signing. Relay auth (NIP-42) signs automatically so clients stay connected.
- **Per-site account binding** — each site stays pinned to the account it logged in with (no NIP-07 desync). Switch a site to another account from **Connected Sites**.
- **Identity from your profile** — account names and avatars are imported from your kind 0 metadata; view and edit your profile and publish kind 0.
- **Backups** — encrypt your profile, follows, and mute list to your own key and store them on your relays (NIP-78), or export a signed JSON bundle.
- **Lightning wallet (NWC)** — connect any Nostr Wallet Connect wallet (Alby Hub, Rizful, YakiHonne, …). Send (BOLT11 or lightning address via LNURL-pay), receive (invoice or your lightning address QR), view paginated history, and back up the connection to your relays. Sidecar never holds your funds.
- **WebLN provider** — web apps can pay and make invoices through your connected wallet (`window.webln`), gated by an approval prompt with an optional per-site daily budget you can edit or revoke any time.
- **Pay invoices from any page** — when a nostr client you're signed into shows a Lightning invoice, a **Pay with Sidecar** card appears so you can pay in a tap. You can also right-click a `lightning:` link, a selected BOLT11 invoice, or a QR image.
- **Auto-approve zaps** (optional, off by default) — pay zaps without a prompt up to a per-zap limit you set. Verified zaps only; larger zaps, non-zaps, and a locked wallet still ask.

## Install (unpacked / developer build)

Sidecar has **no build step** — it's plain JavaScript loaded directly. To run it from source:

1. **Get the code.**
   ```sh
   git clone https://github.com/dmnyc/sidecar.git
   ```
   (or download the ZIP from GitHub and unzip it).

2. **Open the extensions page** in a Chromium browser:
   - Chrome / Brave: visit `chrome://extensions`
   - Edge: visit `edge://extensions`

3. **Enable Developer mode** (toggle in the top-right on Chrome/Brave, left sidebar on Edge).

4. **Click "Load unpacked"** and select the `sidecar` folder (the one containing `manifest.json`).

5. **Pin it (optional).** Click the puzzle-piece toolbar icon and pin Sidecar so its icon is always visible.

6. **Open the side panel.** Click the Sidecar toolbar icon. On first run you'll set a PIN, then add an account (generate a new key or import an existing `nsec`).

7. **Use it on a nostr site.** Open any NIP-07 client (e.g. [Jumble](https://jumble.social), [Coracle](https://coracle.social), [noStrudel](https://nostrudel.ninja)) and choose "log in with extension" — Sidecar will prompt you to approve.

**Updating:** pull the latest code (`git pull`), then return to the extensions page and click the **reload** (↻) icon on the Sidecar card. Reloading is required after changing `background.js` or any provider script.

### Build version stamp (optional)

The About dialog shows a version + git commit read from `version.js` (gitignored, generated). A `post-commit` hook keeps it current automatically — install it once with:

```sh
printf '#!/usr/bin/env bash\nexec "$(git rev-parse --show-toplevel)/scripts/stamp-version.sh" >/dev/null 2>&1 || true\n' > .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

Or regenerate it manually any time:

```sh
./scripts/stamp-version.sh
```

## Architecture

| Area | Files |
|------|-------|
| Service worker (RPC router, permissions, prompt orchestration, auto-lock) | `background.js` |
| Page bridge / provider | `content.js`, `nostr-provider.js` |
| Crypto & keystore | `crypto.js`, `keystore.js`, `permissions.js`, `signer.js` |
| Approval prompt | `prompt.html`, `prompt.js` |
| Side panel UI | `sidepanel.html`, `sidepanel.js`, `styles.css`, `fonts.css` |
| Lightning (NWC / NIP-47) | `nwc-client.js`, `wallet-budgets.js` |
| Vendored | `nostr-tools.js`, `qrious.min.js` (receive QR), `jsqr.js` (scan QR to pay), `fonts/` (Playfair Display + Manrope, SIL OFL) |
| Generated | `version.js` (build stamp), `scripts/stamp-version.sh` |

Decrypted private keys live only in the service worker's in-memory map. If the worker
is killed (MV3 idles after ~30s), that map is cleared and the keystore re-locks.

## Acknowledgments

- Inspired by Nostr Build Shack by [Fishcake](https://github.com/fishcakeday) and [Clave](https://github.com/DocNR/clave) by [Doc](https://github.com/DocNR)

## Author

- Created by The Daniel 🖖
- Vibed with Claude ☕️

## License

MIT. Bundled fonts are licensed under the SIL Open Font License (see `fonts/`).
The `qrious` QR library is bundled for the wallet's receive flow.
