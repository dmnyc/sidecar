# Changelog

All notable changes to Sidecar. This project follows [Keep a Changelog](https://keepachangelog.com/)
and [Semantic Versioning](https://semver.org/).

Release practice: the latest release's highlights are also summarized in-app, in the help
guide's **What's new** section (`help.html#whats-new`, linked from Settings → Updates).
Update that section alongside this file as part of every release.

## [1.4.0] — 2026-07-11

### Added
- **Expandable signing preview** — the approval prompt now shows event content in a compact, expandable pane with **Formatted / Raw / JSON** views and a Show more / less toggle in every view. "Formatted" renders a note the way a client would (mentions as @-names, media, and note/nevent/naddr embeds), so long content — like a repost whose content is an embedded event — no longer pushes the "Signing as" account card off-screen.
- **Wider event-kind recognition** — the signing prompt now labels roughly 40 more event kinds (Blossom upload authorization, polls, user status, zap goals, labels, communities, wiki articles, starter packs, voice messages, and many NIP-51 lists and sets), so routine actions no longer show the "unrecognized kind" caution. A **request to vanish** (kind 62) now carries a delete-style heads-up.
- **"Save your PIN" reminder** — right after creating a PIN, a one-time modal prompts you to write it down or store it in a password manager before moving on. There's no recovery if it's forgotten, so this is the one moment to make sure it's actually captured somewhere durable.
- **In-app release notes** — the help guide's new "What's new" section summarizes each release's highlights, linked from the help nav and from a new "What's new in this version" link in Settings → Updates.

### Changed
- **nostr-tools updated to 2.23.11** (from 2.16.2) — roughly a year of upstream fixes; the vendored bundle remains the byte-exact official npm artifact, and the app's relay-subscription call sites were adapted to the newer single-filter API. Cross-version interop (NIP-04/NIP-44 ciphertexts, event signatures) verified.
- **QR codes are now rendered by `qrcode-generator` (MIT)** with a small first-party canvas adapter, replacing the GPL-3.0-licensed QRious library and resolving a license conflict with the project's MIT terms. Every QR type the app shows (keys, ncryptsec, Lightning addresses, invoices, wallet strings) verified end-to-end: encoded, then scanned back with the same decoder the app uses.
- The standalone popup and the in-panel approval now share the same event-kind labels, so kinds — including the NIP-17 DM setup events — are recognized consistently in both places.
- **Readable identities** — approval prompts show the encrypt/decrypt counterparty by name with its npub kept beneath as a verifiable key (a display name alone is spoofable). Click the npub to reveal the full, untruncated key; the raw hex is on hover. Other pubkey fallbacks now use npubs, not hex.
- **Reject Primal's NWC string** — Primal's wallet is Spark-based and only works inside Primal's own apps, so its Nostr Wallet Connect string can't drive an external wallet. Sidecar now detects it and explains why, instead of hanging on connect.

### Security
- **Auto-lock now defaults to 15 minutes of inactivity**, instead of never. It only counts down when nothing has been signed, paid, or unlocked in that window, so active use is unaffected — this only shrinks the window a decrypted keystore is left exposed on an unattended browser. Still adjustable (including back to Never) in Settings, and anyone who's already chosen a value there keeps it. Existing users who'd never chosen a value get a one-time notice that auto-lock is now on — with a reminder that the unlock PIN is unrecoverable — the first time the panel opens unlocked.
- **Auto-lock changes apply immediately.** Changing the timer in Settings now re-arms (or clears) the countdown on the spot; previously the new value only took effect after the next sign, payment, or unlock — so enabling auto-lock and walking away would never actually lock.
- **Web pages can no longer read Sidecar's full settings.** The settings read available to visited pages is now clamped to the pay-card toggle, matching the existing clamp on writes — a page could previously see the auto-lock timing, budget, and auto-zap configuration.
- **Vendored-bundle provenance** (addresses the community audit in [#106](https://github.com/dmnyc/sidecar/issues/106)) — `VENDOR.md` now records the exact npm package, version, license, and SHA-256 of every bundled third-party file; `scripts/update-vendor.sh` regenerates all of them from official registry artifacts, including a byte-reproducible `nip49.js` build; and CI verifies the hashes on every push and pull request, so tampering with vendored code is mechanically detectable. Also fixes the version drift between `manifest.json` and `package.json` and removes the misleading `devDependencies` entry.

### Fixed
- The PIN/confirm fields on the "create a keystore" screen no longer show a stale green checkmark next to an empty box after a reset (erase-everything, or the 21-failed-unlock auto-wipe) — the validity indicators now recompute when the fields are cleared, instead of only on typing.
- Turning the on-page "Pay with Sidecar" card off now sticks across page loads — the content script was reading the saved setting from the wrong spot in the reply, so only the live toggle push ever applied.
- Resuming a saved composer draft that contains a mention now correctly re-renders it as the resolved @name — the Write tab and the "Resume your draft?" preview previously showed the raw `nostr:npub…` string instead.

## [1.3.0] — 2026-07-09

### Added
- **Help & guides page** — a built-in guide (one click from the top bar) covering accounts, how sites remember who you are, switching accounts, the client families, and the wallet.
- **Full encrypted vault backup** — export every account *and* wallet connection into a single password-encrypted file, and restore it on another device.
- **NIP-49 (`ncryptsec`) key import/export**, plus a consolidated tabbed per-account backup screen. Revealed keys and connection strings show a scannable QR with its own auto-hide countdown; for the long wallet string the QR and text are an either/or view.
- **NIP-05 verification** — check a profile's identifier against its `/.well-known/nostr.json`.
- **Clearer signing prompt** — human-readable event-kind labels and a heads-up on unusual or unrecognized kinds (including the NIP-17 DM setup kinds).
- **Connected Sites & Activity** split into sub-tabs, each filterable by site and ordered by most-recent use.
- **Auto-zap daily cap** — a rolling daily total across all sites, alongside the existing per-zap limit.
- Configurable post-review countdown, more "open notes in" clients, an option to reuse an open client tab, a refreshed in-panel app directory, and a "share Sidecar with a friend" flow.

### Changed
- **Multi-account signing** — on sites where you've signed in with more than one account (Jumble, YakiHonne, Primal, …), every content sign confirms who's posting, so a client's own account switcher can't silently sign as the wrong key. Smoother inline account switching on first login, and an offer to reload the open client after you switch.
- **Window-correct approvals** — a signing prompt now appears on the browser window the requesting page lives in, not wherever a pinned panel or the last-focused window happens to be.
- **Quieter approvals** — repetitive background app-data syncs and DM-inbox loads are handled without a prompt for each (kind-based auto-allow for app settings, and a single approval that covers a decrypt burst), while notes, reactions, and DMs still confirm.
- **Notifications** open instantly and reconcile in the background, live-append while the bell is open, and refresh the mute list on every open.

### Security
- **Wallet spend limits** — auto-zap now enforces a daily aggregate cap, and payments are serialized per account, so a signed-in site can't drain the wallet by firing many sub-cap zaps or a concurrent burst (this also closes a check-then-pay race in the per-site budgets).
- **Message origin gate** — control messages (unlock, key reveal, owner sign/encrypt/decrypt, NWC) are restricted to an extension-page origin as defense-in-depth.
- The keystore **auto-erases after 21 failed unlocks**, with escalating backoff between attempts.

### Fixed
- Numerous panel polish and robustness fixes: the approval popup keeps its action buttons in view, revealing a secret no longer collapses a long site list, list expansion and scroll position survive live re-renders, and button spacing across the reveal and vault screens.

## [1.2.0] — 2026-07-03

### Added
- Guided setup wizard for newly generated accounts, with a live PIN strength and match check.
- Lightning address receive (LNURL-pay), a wallet address card, and one-tap profile↔wallet address sync.
- Global @-mention search (via Nostr Archives), and rendered mentions/media inside quoted notes.
- Follow-list recovery (powered by Mutable), a NIP-65 outbox relay editor, following count on the profile, a client-tag toggle, and check-for-updates in Settings/About.

### Security
- Hardened NIP-42 auto-signing, PIN strength enforcement, and OG-fetch SSRF handling.

---

Earlier releases (v1.1.x and v1.0.x) predate this changelog — see the
[git tags](https://github.com/dmnyc/sidecar/tags) and commit history.
