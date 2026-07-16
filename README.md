# Sidecar 🍸

**A Classy Nostr Signer.**

A NIP-07 Nostr signing extension that lives in your browser's side panel. Sidecar
holds your keys locally — encrypted behind a PIN — and provides `window.nostr` to the
web apps you use, so you can sign in and sign events across Nostr clients without
pasting your nsec anywhere. It also has a built-in Lightning wallet (Nostr Wallet
Connect) and a composer for posting notes directly from the panel.

**[Website](https://sidecar.top)** · **[Chrome Web Store](https://chromewebstore.google.com/detail/sidecar-a-classy-nostr-si/moimlikilhheabdafocpmneehpblhiln)** · **[Privacy Policy](https://sidecar.top/privacy.php)** · **[Changelog](CHANGELOG.md)**

<img width="3456" height="1944" alt="Sidecar" src="https://i.nostr.build/jCcJyt3Jb5HDTUhK.jpg" />

> "Best Nostr Extension ever! Every Nostr app should take notes on this onboarding flow. This makes me want to use Nostr."
>
> — [Car](https://github.com/thrillerxx), Co-Founder of [PlebLab](https://github.com/PlebLab)

> "Best UX for a browser key signer so far. And the nsec is encrypted using PBKDF2/AES-GCM, then stored in chrome.storage.local, so other potentially malicious add-ons can't get to it. In my broad testing across multiple browser key signers last year, only Alby did this, though I don't know if others have added it since. Sidecar also has a better UX than Alby. [...] I'm thinking about replacing Alby with Sidecar in NoorNote's onboarding wizard because Sidecar is better for beginners right now."
>
> — [77elements](https://github.com/77elements), creator of [NoorNote](https://github.com/77elements/noornote)

> "I think Sidecar is the best full-fledged Nostr signer/wallet (browser extension) I've used so far! It covers all my needs [...] If you need a Nostr signer that's a browser extension, I highly recommend Sidecar."
>
> — [Hollywood stuntman & make-up artist](https://jumble.social/notes/nevent1qvzqqqqqqypzpqh68q0mpzgpvuv6aphzvdndvcshrgk9tgpcerhn0c5zshl7ptshqythwumn8ghj7un9d3shjtnswf5k6ctv9ehx2ap0qy88wumn8ghj7mn0wvhxcmmv9uqzp7uu04hygk8uk0at69k3wm89hdeecgethaxkfhfa74n9gnuz260xtatdyk), on Nostr

## Features

- **Multiple accounts** — store as many nsecs as you like, drag to reorder, switch the active one in a click. Importing shows a profile preview (name + avatar) so you can confirm the right key before saving. Generating a new key runs a quick guided setup (name, photo, bio). Reveal a key behind your PIN — with a QR for quick sign-in on mobile clients.
- **PIN-protected** — every private key is encrypted at rest (PBKDF2 → AES-GCM, WebCrypto) under a PIN of at least 8 characters, with a live strength and match check when you set it. Nothing is stored in plaintext, and the keystore re-locks automatically. A paste guard blocks dropping an nsec anywhere except the import field.
- **In-extension signing** — implements the full NIP-07 surface: `getPublicKey`, `signEvent`, `nip04`/`nip44` encrypt & decrypt, and `getRelays`.
- **Per-site permissions** — approve or reject each site, per method, with a clear prompt that previews what you're signing (human-readable event-kind labels, plus a heads-up on unusual or unrecognized kinds). Relay auth (NIP-42) signs automatically so clients stay connected. A burst of requests queues visibly — you can see how many are waiting and clear the whole backlog in one tap — and nothing is silently lost if the panel closes or the extension restarts. The prompt appears on the browser window you're actually using, and repetitive background work — app-settings syncs, loading a DM inbox — is handled without a prompt for each, while notes, reactions, and DMs still confirm.
- **Per-site account binding & wrong-account guard** — each site stays pinned to the account it logged in with (no NIP-07 desync), and you can move a site to another account from **Connected Sites**. When a site is signed in with more than one of your accounts — as multi-login clients like Jumble, YakiHonne, and Primal allow — every content sign confirms who's posting, so a client's own account switcher can't silently sign as the wrong key. After you switch the active account, Sidecar offers to reload the open client so the change takes effect there.
- **Identity from your profile** — account names and avatars are imported from your kind 0 metadata; view and edit your profile, see your following count, and publish kind 0. If your profile's lightning address doesn't match your connected wallet, Sidecar offers a one-tap sync.
- **Outbox relays (NIP-65)** — view, edit, and publish your relay list (kind:10002) with per-relay read/write markers, right from your profile.
- **Backups** — encrypt your profile, follows, and mute list to your own key and store them on your relays (NIP-78), or export a signed JSON bundle. Back up a single account's key as an `nsec` or a password-encrypted NIP-49 `ncryptsec`, each revealed behind your PIN with an auto-hiding QR.
- **Vault backup** — export every account *and* its wallet connection into one password-encrypted file, and restore it on another device (separate from a single account's key backup).
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
- **Auto-approve zaps** (optional, off by default) — pay zaps without a prompt up to a per-zap limit *and* a daily total you set. Verified zaps only; larger zaps, anything over the daily total, non-zaps, and a locked wallet still ask.
- **Help & guides** — a built-in guide page, one click from the top bar, walks through accounts, how sites remember who you are, switching accounts, the client families, and the wallet.

## Install

The easiest way is the **[Chrome Web Store](https://chromewebstore.google.com/detail/sidecar-a-classy-nostr-si/moimlikilhheabdafocpmneehpblhiln)** — open the link and click **Add to Chrome**. Works in Chrome, Brave, and Edge.

### Advanced: install from this release zip

For advanced users who'd rather not use the Chrome Web Store: every tagged version is published as a **[GitHub Release](https://github.com/dmnyc/sidecar/releases)** with a ready-to-load zip attached — the exact same build submitted to the Chrome Web Store, so you can inspect it before installing.

1. **Download the zip.** Grab `sidecar-X.Y.Z.zip` from the **[latest release](https://github.com/dmnyc/sidecar/releases/latest)**, then unzip it — you'll get a folder containing `manifest.json`.

2. **Open the extensions page** in a Chromium browser:
   - Chrome / Brave: visit `chrome://extensions`
   - Edge: visit `edge://extensions`

3. **Enable Developer mode** (toggle in the top-right on Chrome/Brave, left sidebar on Edge).

4. **Click "Load unpacked"** and select the unzipped folder (the one containing `manifest.json`).

5. **Pin it (optional).** Click the puzzle-piece toolbar icon and pin Sidecar so its icon is always visible.

6. **Open the side panel.** Click the Sidecar toolbar icon. On first run you'll set a PIN, then add an account (generate a new key or import an existing `nsec`).

**Updating:** release zips don't auto-update — watch the **[releases page](https://github.com/dmnyc/sidecar/releases)** for a new version, download it, and repeat steps 1 and 4 (removing the old unpacked folder first, or pointing "Load unpacked" at the new one, is fine either way). If you'd rather updates happen automatically, use the Chrome Web Store install instead.

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
| Standalone pages | `welcome.html`/`welcome.js` (Nostr app directory, first-run), `wallets.html`/`wallets.js`/`wallets.css` (NWC wallet suggestions), `help.html`/`help.js`/`help.css` (help & guides) |
| Lightning (NWC / NIP-47) | `nwc-client.js`, `wallet-budgets.js` |
| Vendored | `nostr-tools.js`, `qrious.min.js` (receive QR), `jsqr.js` (scan QR to pay), `fonts/` (Playfair Display + Manrope, SIL OFL) |
| Generated | `version.js` (build stamp), `scripts/stamp-version.sh` |

Decrypted private keys live only in the service worker's in-memory map. If the worker
is killed (MV3 idles after ~30s), that map is cleared and the keystore re-locks.

## Nostr protocol support

Sidecar signs whatever event a connected site asks for via NIP-07, so in principle it can
sign any kind. Beyond that, these are the NIPs (and one Blossom convention) it has
dedicated, named support for:

| NIP | Title | Used for |
|-----|-------|----------|
| [01](https://nips.nostr.com/1) | Basic protocol flow | Core event/profile handling (kind:0, kind:1) |
| [02](https://nips.nostr.com/2) | Follow List | Follow count, follow-list recovery |
| [04](https://nips.nostr.com/4) | Encrypted Direct Messages (legacy) | `nip04.encrypt`/`.decrypt` NIP-07 methods; fallback encoding for large backups and private mute lists |
| [05](https://nips.nostr.com/5) | Mapping Nostr keys to DNS identifiers | Verifying a profile's NIP-05 against its `/.well-known/nostr.json` |
| [07](https://nips.nostr.com/7) | `window.nostr` capability | The signer interface itself |
| [09](https://nips.nostr.com/9) | Event Deletion Request | Recognized and flagged in the signing prompt |
| [10](https://nips.nostr.com/10) | Text Notes and Threads | Reply/mention recognition in notifications |
| [18](https://nips.nostr.com/18) | Reposts | Repost and quote-repost recognition |
| [19](https://nips.nostr.com/19) | bech32-encoded entities | npub/nsec/note/nevent/naddr encode & decode throughout |
| [21](https://nips.nostr.com/21) | `nostr:` URI scheme | Mention/embed rendering in the composer |
| [25](https://nips.nostr.com/25) | Reactions | Reaction notifications |
| [27](https://nips.nostr.com/27) | Text Note References | Inline `nostr:` mention rendering |
| [42](https://nips.nostr.com/42) | Authentication of clients to relays | Relay AUTH challenges are signed automatically |
| [44](https://nips.nostr.com/44) | Encrypted Payloads (Versioned) | `nip44.encrypt`/`.decrypt` NIP-07 methods; preferred encryption for backups and mute lists |
| [47](https://nips.nostr.com/47) | Nostr Wallet Connect | The built-in Lightning wallet |
| [49](https://nips.nostr.com/49) | Private Key Encryption (`ncryptsec`) | Password-encrypted key import/export |
| [51](https://nips.nostr.com/51) | Lists | Mute list handling |
| [57](https://nips.nostr.com/57) | Lightning Zaps | Zap notifications, automatic zaps |
| [65](https://nips.nostr.com/65) | Relay List Metadata | Outbox relay list editor |
| [78](https://nips.nostr.com/78) | Application-specific Data | Encrypted profile/follows/mutes/wallet backups |
| [89](https://nips.nostr.com/89) | Recommended Application Handlers | `client` tag on posts |
| [98](https://nips.nostr.com/98) | HTTP Auth | Upload auth for Blossom and nostr.build |
| [Blossom](https://github.com/hzrd149/blossom) (BUD-02) | Blob upload | Media uploads to a user's own Blossom servers, from their kind:10063 list |

## Acknowledgments

- Inspired by [Nostr Build Shack](https://apps.apple.com/us/app/nostr-build-shack/id6752591477) by [Fishcake](https://github.com/fishcakeday) and [Clave](https://github.com/DocNR/clave) by [Doc](https://github.com/DocNR)
- Standing on the shoulders of [nos2x](https://github.com/fiatjaf/nos2x) by [fiatjaf](https://github.com/fiatjaf), [Alby](https://github.com/getAlby/lightning-browser-extension) extension, and [Amber](https://github.com/greenart7c3/Amber) by [greenart7c3](https://github.com/greenart7c3) — the OG reliable signers most of Nostr grew up with
- Global @-mention search is powered by the [nostrarchives-api](https://github.com/barrydeen/nostrarchives-api) by [barrydeen](https://github.com/barrydeen)

## Author

- Created by The Daniel 🖖
- Mixed with Claude 🍸

## License

MIT. Bundled fonts are licensed under the SIL Open Font License (see `fonts/`).
The `qrious` QR library is bundled for the wallet's receive flow.

---

> “If it’s a class war, you should be a classy warrior.” — Mos Def
