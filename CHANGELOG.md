# Changelog

All notable changes to Sidecar. This project follows [Keep a Changelog](https://keepachangelog.com/)
and [Semantic Versioning](https://semver.org/).

Release practice: the latest release's highlights are also summarized in-app, in the help
guide's **What's new** section (`help.html#whats-new`, linked from Settings → Updates).
Update that section alongside this file as part of every release.

## [1.8.0] — 2026-08-12

### Added
- **Sixth theme: Bauhaus.** Flat planes of primary color, black rule lines, and a Futura-lineage display face — the school's own geometric sans. White walls instead of cream keep it unmistakably separate from Art Deco. In Settings → Theme. (#170)
- **Every theme now has its own display font.** Each of the six themes is set in a typeface from a different category — Playfair (Didone serif), Oswald (condensed grotesque), Bitter (slab serif), Josefin Sans (1920s geometric), Cinzel (Roman caps), Jost (Futura geometric). The theme picker reads as a type specimen: each card shows its name in the face you'd get by choosing it. (#170)
- **A distinct icon per event kind in Recent activity.** Reactions, zaps, reposts, mentions and replies each carry their own glyph instead of sharing a single feather. (#164)
- **"Wrong account?" escape on the signing prompt.** When a site is signed in with more than one of your accounts, the approval prompt says so and lets you switch — without closing the prompt, losing the request, or reloading the page. (#169)

### Fixed
- **A signing approval now outranks any open modal.** With notifications, the composer, or settings open, a signing request could be hidden behind the modal — invisible and impossible to reject. The approval overlay now closes any open modal before showing itself. (#168)
- **A signing request the sleeping service worker never received is retried.** The MV3 service worker can be evicted mid-message; the request now reaches the signer on a second attempt instead of hanging. (#167)
- **Relay connections are no longer exhausted.** A connection leak could leave the wallet and publisher unable to reach any relay until a reload; publish failures now say something useful instead of reporting success. (#166)
- **The panel no longer repaints behind an open overlay.** A deferred render was firing through the modal, causing a flash of stale account names behind the approval prompt. (#165)
- **One NWC pool per client — the wallet no longer dies until a reload.** (#162)
- **Copied secrets are cleared from the clipboard after 60 seconds.** An exported nsec or ncryptsec left on the clipboard is now removed automatically. (#163)
- **Wallet view no longer flashes on zap; the composer background is stable across theme switches.** (#161)
- **Drag-to-reorder works at the top and bottom of the list.** (#160)
- **Relax exclusion is looser for replaceable kinds.** App-settings syncs, DM inbox loads and other background work that the user didn't initiate no longer prompt during a relax window, while notes, reactions and DMs still confirm. (#160)
- **Follow count and @-mention list now read the account's NIP-65 relays.** The profile's follow count and the follow list behind @-mentions were querying only the user's configured relays, missing the healthy kind:3 that lives on NIP-65 declared relays when a configured relay holds a stale or wiped copy. The same gap let a zero-follow event seed the destructive-guard baseline, which would have suppressed the wipe warning for the next real kind:3. (#172)

### Changed
- **Art Deco contrast fixed.** The gold accent ink was 1.67:1 as text on cream — the lightning address, the relax countdown, and the About links were effectively unreadable. The bright metallic is now fill-only; a deep bronze carries all text at 5.23:1. (#170)
- **Film Noir background reworked.** The Victorian filigree tile is replaced by venetian-blind stripes — the genre's own signature, rendered as one resolution-independent gradient. (#170)
- **Relax countdown dots are visible on light themes.** Both dot colors were tuned for dark surfaces and measured 1.28–1.74:1 on light theme status bars — invisible. Each light theme now uses its own success and warning values. (#170)

## [1.7.0] — 2026-07-29

### Added
- **Comment on any webpage.** A speech-bubble icon in the top bar opens a composer addressed to the page you're reading, publishing a kind 1111 comment (NIP-22) tagged with the page's URL (NIP-73). Mentions work — type `@` and tag someone the same way you do in a note; the person tagged gets a `p` tag and will be notified. A link card fetched from the page sits above the editor so you can always see what you're commenting on, and the review countdown (the same one notes use) fires before it goes out. Since almost nothing but Jumble renders a kind 1111 over a web target today, both links after posting — view your comment, and see all comments on the page — point there, named explicitly. (#156, #159)
- **Quick-start a Lightning wallet.** When you don't have a wallet connected, the wallet screen offers a quick start through Rizful: enter a one-time code, and Sidecar receives an NWC connection string — no separate app, no manual paste. A Lightning address comes back with it. For users who already have a wallet, the same screen still offers manual NWC entry and relay restore as before. (#152)
- **Historical price chart with hover.** The wallet's price chart now shows more than the last 24 hours, and a hover indicator tracks the price at any point along the curve. (#155)
- **Add an account from the dropdown.** The account switcher's dropdown now carries an "Add account" link alongside the accounts panel, so you don't have to navigate to settings to bring in a second identity. (#155)
- **Review countdown for comments.** Comments go through the same review window as notes — a ring counts down, with the page card and comment text visible for a last look. Reads the same "Review countdown before posting" setting; no separate toggle. (#159)
- **Tracker stripping for web comments.** The comment's target URL is normalized before tagging — fragment stripped, query sorted, host case-folded — so share links with different tracking parameters don't fork the same page into separate threads. The whole `utm_` family is matched by prefix (not just the common six), plus ~20 more exact params, and YouTube's share token `si` is stripped on YouTube only. (#159)
- **Comment drafts.** A stray click outside the modal no longer loses a half-written comment. The draft is held in memory, keyed by account and page URL, and restored when you reopen the modal on the same page. Nothing is written to disk — a comment belongs to a page you're looking at, not a permanent record. (#159)

### Fixed
- **Smarter wallet backup.** The check was a bare existence test — any backup event on your relays read as "Backed up ✓". Sidecar now decrypts the backup and compares it to the wallet actually connected, reporting four states: backed up, not backed up, a different wallet is backed up, or couldn't check. Both Back up and Restore warn before overwriting a different wallet, pointing at Restore (not Export) for recovery — Export reveals the *connected* wallet, so it would save the wrong string. (#158)
- **Restoring a wallet showed the previous wallet's balance.** The NWC client was cached under the account alone, so swapping wallets within one account (Restore, or connecting a different string) handed back a client still pointed at the wallet you'd just replaced. A restored wallet with 400 sats displayed 0 until you removed and re-imported the same string. Now keyed on the connection, fixed at the choke point so every writer path is covered. (#158)
- **Keystore lost-update race.** Concurrent writes to `chrome.storage` could silently overwrite each other — the last writer won, every time. The vault-import avatar bug (imported accounts showed no profile pictures until a reload) was the visible symptom: a profile write and an account-list write racing. All keystore writes are now serialized through a single promise chain. (#154)
- **Vault import loads profile pictures immediately.** The race above meant a freshly imported account's profile fetch landed and was stored, then got overwritten by the stale account list. Fixed by the serialization, plus a bounded retry on the profile fetch so a slow relay doesn't leave a placeholder name permanently. (#154)
- **Interface text is no longer selectable.** Dragging across the panel highlighted tab labels, headings and button text, reading as a web page rather than an app. Chrome is unselectable by default; content — identifiers, prose, form fields, balances — opts back in. (#157)

### Changed
- **Comment button icon.** Feather's message-square-with-dots replaced by message-circle, scaled 1.10× to match the optical weight of the neighboring search and help icons. The dots collapsed to a smudge at the topbar's 19px. (#159)
- **WALLET_BACKENDS.md** documents the public reasoning behind the wallet-backend decisions: Breez Spark ruled out (Firefox/11 MB/API key/CSP), Cashu/NIP-60 ruled out (no Lightning address, no zaps), Bitcoin Connect ruled out, and NWC-first with Rizful as the on-ramp. (#152)

## [1.6.0] — 2026-07-28

### Added
- **Zap animations.** A bolt of lightning strikes across the page whenever a payment goes out — procedurally drawn, never the same twice. It fires for zaps sent from a client's own UI as well as from Sidecar, and can be turned off in Settings.
- **Tap the balance to change units.** The wallet balance and the pinned balance bar cycle through sats, BTC, and your local currency on tap. Pick the currency in Settings or from the wallet screen; sixteen are supported, defaulting to USD.
- **24-hour bitcoin price chart.** A round button on the wallet card opens a gradient-filled chart of the last 24 hours against your chosen currency.
- **A warning before an app erases your data.** Follow lists, mute lists, and profiles are *replaceable* events: a new version wholly replaces the old one, with no merge and no undo, so a buggy or careless client can wipe years of follows in a single signature. Sidecar now compares what it's being asked to sign against what it last signed for you and stops to warn you — in plain language, naming what would be lost — before an event that would erase your follows, your mutes, or fields from your profile. The approval buttons stay disabled until you acknowledge it, a timed relax window can't wave it through, and the check is entirely local, so it costs no network time.
- **Auto Zaps now cover the whole zap.** Previously it never fired at all: it looked for the zap request inside the invoice's description, but NIP-57 issues description-*hash* invoices, so that field is empty on every spec-compliant zap. Sidecar now matches the payment against the zap request it signed for you moments earlier — same site, same account, same amount — and, when the amount is within your limits, signs and pays without a prompt or a payment card. Starts at 200 sats per zap and 20,000 per day, with a hard ceiling of 1,000 and 100,000 that holds whatever you type into the settings. When a zap is small enough to qualify, the payment card offers to switch Auto Zaps on — confirmed on Sidecar's own approval screen, never written on a page's say-so.
- **The Bitcoin Connect modal closes itself.** A zap paid from Sidecar's card settled with the page none the wiser — the invoice was read from the page and paid over NWC, so the client's modal sat spinning on an invoice that had already gone through. Sidecar now tells the modal its payment landed.
- **Refresh your profile from the Profile screen** — the circular arrow now actually re-fetches, for when a change made elsewhere hasn't reached Sidecar yet.
- **Search.** A magnifier in the top bar opens a search field: paste an `npub`, `note`, `nevent` or `naddr` and it opens in whichever client you've set as your preferred one, then closes itself. Type a name instead and it suggests people as you go — your follows first, then a wider search. A NIP-05 address (`name@domain`) resolves against that domain directly. Pasted client links work too, so a `njump.me` or `primal.net` link someone sent you reopens in the client you actually use. Identifiers are decoded locally, with no lookup service involved, so that path can't hang or leak what you searched for. Room for the icon came from dropping the account name out of the bar — it's in the chip's tooltip now, and the switcher still lists it. (#150)
- **Two new themes, bringing the total to five.** *Aegean* — whitewashed plaster, cobalt doors and sun-bleached stone, with the Greek key running behind the panel; Sidecar's second light theme after Art Deco. *Brownstone* — New York sandstone after dark: warm stone, lamplight gold, ivy green and black iron, over a tile of interlocking masonry courses. Both ship with matching palettes for the in-page payment card.

### Fixed
- **Notes could be signed, reported as posted, and published nowhere.** Two faults compounded: Sidecar published only to the write relays declared in your relay list, so if those lapsed or gated on a web of trust the note had nowhere else to go; and a relay that couldn't be reached was being counted as a successful publish, so no error was ever raised. Posts now go to those relays *and* the ones configured in Settings, and an unreachable relay is reported as the failure it is, naming each relay and why. The same faults affected profile edits, relay-list updates, and follow lists.
- **Payments could succeed while the page was told they failed** — or left waiting up to three minutes. Approving a payment canceled the keepalive at the moment the money moved, and a lost confirmation from the wallet was being read as a failed payment. Sidecar now holds itself awake for the whole payment and asks the wallet what actually happened rather than inferring it from silence, so the answer arrives in seconds and is the truth.
- **The approval popup no longer hides the PIN field, the auto-sign options, or the site asking.** On a long request the PIN scrolled out of view beneath the button demanding it — and because the field takes focus automatically, the popup opened scrolled to the bottom, pushing the site name and the multiple-accounts warning off-screen. Everything you act on now sits below the fold line, and a wrong-PIN message appears against the PIN field instead of down beside the buttons.
- **A hidden wallet balance no longer leaks its own size.** The mask drew one dot per character, so the number of dots told you the order of magnitude of the balance you'd just hidden. Every hidden balance now shows a fixed four, in the same color the number itself is drawn in for that theme.
- **The reload notice can be dismissed.** The banner asking you to reload the page after an account switch now carries an X.
- **Outgoing payment toasts name the amount** instead of a bare "Payment sent".
- **Repeated actions no longer stack duplicate toasts.**
- **Sidecar's own pages reuse their tab.** Clicking the help icon opened a second help tab with one already open; the same went for What's new, the switching guide, the welcome page, and the wallet guide.
- **Firefox Add-ons links point at the real listing.** (#133)

### Changed
- **Art Deco is gold and tan rather than purple.** The theme's accents, buttons and chart all pull from the same warm palette as its border; only the Sidecar logo keeps its original color.
- **Every theme's background pattern is centered** rather than anchored to the top-left, so the tile is no longer clipped along one edge.
- The help guide documents relax mode and the new data-erasure warning, with screenshots.
- The payment card's toggle now reads **"Don't show this prompt again"** and starts off, rather than "Show this automatically" starting on. Same setting, stated the way you'd actually think about it.

## [1.5.1] — 2026-07-24

### Added
- **Relax mode.** Timed auto-sign window (5, 15, or 30 minutes) for trusted sites. A persistent status bar counts down the remaining time with an End button to revoke early. Resolves the friction of approving every action during active sessions on shared hosts.
- **Pinned wallet balance bar.** Lightning balance is pinned to the panel and visible at all times, not just from the wallet section. Incoming payments update automatically via NIP-47 notifications (with a 30-second polling fallback) and trigger a gold glow pulse on the balance number. Appears immediately on wallet connect or restore. Unpin with a single click.

### Changed
- Tightened the switch-account tip and wallet onboarding copy for clarity.
- Shortened the shared-identity heads-up blurb shown during signing approvals.
- **Film Noir's balance numbers are now gold** (matching Speakeasy) instead of silver, so Lightning amounts read warm even in the monochrome theme.

## [1.5.0] — 2026-07-21

### Added
- **Firefox support.** The full signer — multi-account, NIP-07, the built-in Lightning wallet, and the approval flow — now runs on Firefox 128+ at parity with the Chrome build, from a single shared codebase. On Firefox, Sidecar lives in the sidebar rather than the side panel, and (because Firefox lets you decline site access at install) offers a one-click grant from the panel if you skipped it. Distributed through Firefox Add-ons (AMO).
- **Three themes, selectable in Settings.** **Speakeasy** (the original after-hours velvet) stays the default, joined by **Film Noir** (matte black-on-black with silver accents) and **Art Deco** (a daylight eggshell-and-bronze palette with a geometric pattern background). Your choice persists across sessions, and the injected "Pay with Sidecar" card on web pages adopts the same theme.

### Changed
- **Toasts now appear at the bottom** of the panel instead of dropping over the top menu, so a confirmation like "Unlocked" no longer covers the account switcher and toolbar for a few seconds.
- The follow-list recovery button is now labeled **"Follow List Recovery"**, matching what Mutable — the service that powers it — calls the feature.

### Fixed
- **Art Deco legibility pass.** On the light theme, several elements colored for a dark backdrop were washing out: the key-backup box and its warning text, the signing-approval event preview and caution banner, the wallet balance and transaction colors, the NIP-05 verification badges, and the "Pay with Sidecar" card's logo, error, and paid states. All now read clearly against the eggshell background.
- **The Close button on an expired standalone approval popup now works.** Previously, when a request timed out in the popup shown with the sidebar closed, "Close" did nothing — the request had already been purged, so the approval message had nothing to act on and the window never closed. Close now dismisses the popup directly.

## [1.4.1] — 2026-07-16

### Added
- **Eight new apps in the welcome directory** — Flotilla, Tunestr, Wavlake, WaveFunc Radio, Boost Me Bitch, Cordn, Imwald, and ContextVM — and every app description got a copy pass for a consistent, scannable length. The same directory (and the wallet guide) is now published on the web at [sidecar.top/apps](https://sidecar.top/apps) and [sidecar.top/wallets](https://sidecar.top/wallets), generated from the extension's own list so the two never drift.

### Changed
- **Auto-lock now surfaces in the UI.** When the idle timer fires, the panel drops straight to the unlock screen with a "Locked due to inactivity" notice, instead of staying on whatever was open (a composer, a modal) and only revealing the lock on the next action. Composer typing counts as activity so auto-lock can't fire mid-draft, and unlocking directly from a key-reveal or export prompt now proceeds in one step.
- Quoted-note notifications use a lighter ornamental quote mark; the previous speech-bubble emoji rendered nearly black on the dark panel.
- The About screen's Privacy Policy and Support links use the site's extensionless URLs.

### Security
- **Every step-up PIN prompt now shares the unlock screen's brute-force protection.** The reveal-key, reveal-wallet, and change-PIN prompts use the same persisted guard as unlocking — escalating delays between wrong attempts and the self-erase on the final strike.

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
