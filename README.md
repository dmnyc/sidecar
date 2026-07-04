# Sidecar 🍸

**A Classy Nostr Signer.**

A NIP-07 Nostr signing extension that lives in your browser's side panel. Sidecar
holds your keys locally — encrypted behind a PIN — and provides `window.nostr` to the
web apps you use, so you can sign in and sign events across Nostr clients without
pasting your nsec anywhere. It also has a built-in Lightning wallet (Nostr Wallet
Connect) and a composer for posting notes directly from the panel.

<img width="2816" height="1566" alt="Sidecar" src="https://i.nostr.build/Sr11DBpz7pVITHoS.png" />

> "Best Nostr Extension ever! Every Nostr app should take notes on this onboarding flow. This makes me want to use Nostr."
>
> — [Car](https://github.com/thrillerxx), Co-Founder of [PlebLab](https://github.com/PlebLab)

> "Best UX for a browser key signer so far. And the nsec is encrypted using PBKDF2/AES-GCM, then stored in chrome.storage.local, so other potentially malicious add-ons can't get to it. In my broad testing across multiple browser key signers last year, only Alby did this, though I don't know if others have added it since. Sidecar also has a better UX than Alby. [...] I'm thinking about replacing Alby with Sidecar in NoorNote's onboarding wizard because Sidecar is better for beginners right now."
>
> — [77elements](https://github.com/77elements), creator of [NoorNote](https://github.com/77elements/noornote)

## Features

- **Multiple accounts** — store as many nsecs as you like, drag to reorder, switch the active one in a click. Importing shows a profile preview (name + avatar) so you can confirm the right key before saving. Generating a new key runs a quick guided setup (name, photo, bio). Reveal a key behind your PIN — with a QR for quick sign-in on mobile clients.
- **PIN-protected** — every private key is encrypted at rest (PBKDF2 → AES-GCM, WebCrypto) under a PIN of at least 8 characters, with a live strength and match check when you set it. Nothing is stored in plaintext, and the keystore re-locks automatically. A paste guard blocks dropping an nsec anywhere except the import field.
- **In-extension signing** — implements the full NIP-07 surface: `getPublicKey`, `signEvent`, `nip04`/`nip44` encrypt & decrypt, and `getRelays`.
- **Per-site permissions** — approve or reject each site, per method, with a clear prompt that previews what you're signing. Relay auth (NIP-42) signs automatically so clients stay connected.
- **Per-site account binding** — each site stays pinned to the account it logged in with (no NIP-07 desync). Switch a site to another account from **Connected Sites**.
- **Identity from your profile** — account names and avatars are imported from your kind 0 metadata; view and edit your profile, see your following count, and publish kind 0. If your profile's lightning address doesn't match your connected wallet, Sidecar offers a one-tap sync.
- **Outbox relays (NIP-65)** — view, edit, and publish your relay list (kind:10002) with per-relay read/write markers, right from your profile.
- **Backups** — encrypt your profile, follows, and mute list to your own key and store them on your relays (NIP-78), or export a signed JSON bundle.
- **Follow-list recovery** — if a buggy client overwrites your follows with an empty or shorter list, scan your relays for an earlier kind:3 and republish a healthy version. Powered by [Mutable](https://mutable.top).
- **Note composer** — post kind:1 notes directly from the panel with a send countdown you can review (the full note renders) and cancel. Drafts autosave per account, so you can close the composer and resume — or start fresh — later. Features include:
  - **@mention autocomplete** — type `@` to search your follows *and* all of Nostr (global search via [Nostr Archives](https://github.com/barrydeen/nostrarchives-api)), so you can tag anyone; selecting inserts an atomic pill that serializes to `nostr:npub1…` and adds a `p` tag automatically.
  - **Nostr event embeds** — paste a `note1`, `nevent1`, or `naddr1` entity and the preview renders a fetched embed card (author, timestamp, content excerpt).
  - **Link previews** — plain URLs show an OG meta card (title, description, thumbnail) fetched through the extension with no third-party service.
  - **Media upload** — attach images and video; uploads go to your own Blossom servers (from your kind:10063 list) when available, falling back to nostr.build.
  - **Client tag, your call** — posts carry a `client` tag attributing them to Sidecar; turn it off in Settings to post untagged.
- **Notifications** — a bell in the header shows replies, mentions, reposts, reactions, and zaps for the active account — each with the sender's name, a content preview, and a tap-through that opens the note in your preferred client. Muted users (public and private mute lists) are filtered out.
- **Lightning wallet (NWC)** — connect any Nostr Wallet Connect wallet (Alby Hub, Rizful, YakiHonne, …). Send (BOLT11 or lightning address via LNURL-pay), receive (invoice or your lightning address, with a QR — also surfaced as a card on the wallet page), view paginated history, and back up the connection to your relays — or export it (PIN-gated, with a QR) to move it to another app. New to Lightning? Built-in **wallet suggestions** point you to NWC-capable options. Sidecar never holds your funds.
- **WebLN provider** — web apps can pay and make invoices through your connected wallet (`window.webln`), gated by an approval prompt with an optional per-site daily budget you can edit or revoke any time.
- **Pay invoices from any page** — when a Nostr client you're signed into shows a Lightning invoice, a **Pay with Sidecar** card appears so you can pay in a tap. You can also right-click a `lightning:` link, a selected BOLT11 invoice, or a QR image.
- **Auto-approve zaps** (optional, off by default) — pay zaps without a prompt up to a per-zap limit you set. Verified zaps only; larger zaps, non-zaps, and a locked wallet still ask.

## Install

The easiest way is the **[Chrome Web Store](https://chromewebstore.google.com/detail/sidecar-a-classy-nostr-si/moimlikilhheabdafocpmneehpblhiln)** — open the link and click **Add to Chrome**. Works in Chrome, Brave, and Edge.

### From source (unpacked / developer build)

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

7. **Use it on a Nostr site.** Open any NIP-07 client (e.g. [Jumble](https://jumble.social), [Coracle](https://coracle.social), [noStrudel](https://nostrudel.ninja)) and choose "log in with extension" — Sidecar will prompt you to approve.

**Updating:** Chrome Web Store installs update automatically — you can trigger a check any time from **Settings → Updates** or the About dialog. For a source build, pull the latest code (`git pull`), then return to the extensions page and click the **reload** (↻) icon on the Sidecar card. Reloading is required after changing `background.js` or any provider script.

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
| Standalone pages | `welcome.html`/`welcome.js` (Nostr app directory, first-run), `wallets.html`/`wallets.js`/`wallets.css` (NWC wallet suggestions) |
| Lightning (NWC / NIP-47) | `nwc-client.js`, `wallet-budgets.js` |
| Vendored | `nostr-tools.js`, `qrious.min.js` (receive QR), `jsqr.js` (scan QR to pay), `fonts/` (Playfair Display + Manrope, SIL OFL) |
| Generated | `version.js` (build stamp), `scripts/stamp-version.sh` |

Decrypted private keys live only in the service worker's in-memory map. If the worker
is killed (MV3 idles after ~30s), that map is cleared and the keystore re-locks.

## Acknowledgments

- Inspired by Nostr Build Shack by [Fishcake](https://github.com/fishcakeday) and [Clave](https://github.com/DocNR/clave) by [Doc](https://github.com/DocNR)
- Standing on the shoulders of [nos2x](https://github.com/fiatjaf/nos2x) by [fiatjaf](https://github.com/fiatjaf) and the [Alby](https://github.com/getAlby/lightning-browser-extension) browser extension — the OG reliable browser signers most of Nostr grew up with
- And [Amber](https://github.com/greenart7c3/Amber) by [greenart7c3](https://github.com/greenart7c3) — for showing how good a dedicated Nostr signer can feel on mobile
- Global @-mention search is powered by the [nostrarchives-api](https://github.com/barrydeen/nostrarchives-api) by [barrydeen](https://github.com/barrydeen)

## Author

- Created by The Daniel 🖖
- Mixed with Claude 🍸

## License

MIT. Bundled fonts are licensed under the SIL Open Font License (see `fonts/`).
The `qrious` QR library is bundled for the wallet's receive flow.

---

> “If it’s a class war, you should be a classy warrior.” — Mos Def
